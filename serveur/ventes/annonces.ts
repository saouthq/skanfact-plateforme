// Les avis des règlements d'une facture de vente (brique 128 ; docs/api-situation.md, S6) : pour la console d'un
// partenaire qui suit ce que ses clients doivent sans relire toutes les factures. Ils naissent dans la transaction du
// fait (un enregistrement refusé n'annonce rien), l'argent en texte décimal, comme `facture.emise`.
//   - `reglement.enregistre` : chaque règlement NOUVEAU d'une facture (pas un ticket de caisse, payé dans son geste) ;
//   - `facture.reglee` : la facture qui devait encore quelque chose et ne doit plus rien, par un règlement ou par un
//     avoir (`par`).
// Le reste est celui de `soldesDeFactures`, comme partout (deux chemins, un chiffre).

import { versTexte } from '../../moteur/argent.ts';
import { emettreAvis } from '../avis.ts';
import { requetes, type Transaction } from '../base.ts';
import type { ReglementSaisi } from '../reglements.ts';
import { soldesDeFactures } from './reglements.ts';
import { lienEcran } from './situation.ts';

async function lireFacture(tx: Transaction, entreprise: string, piece: string) {
  const f = await requetes(tx).selectFrom('ventes.piece as p').innerJoin('socle.tiers as t', 't.id', 'p.tiers').innerJoin('socle.devise as d', 'd.code', 'p.devise')
    .select(['p.id', 'p.numero_texte', 'p.devise', 'd.decimales', 'p.net_a_payer', 'p.ref_v10', 'p.tiers', 't.raison_sociale'])
    .where('p.entreprise', '=', entreprise).where('p.id', '=', piece).executeTakeFirstOrThrow();
  const reste = (await soldesDeFactures(tx, entreprise, [{ id: f.id, net: f.net_a_payer ?? 0n }])).get(f.id)?.reste ?? 0n;
  return { ...f, reste };
}

// Ce que la facture doit encore, AVANT le geste qui peut la régler.
export async function resteAvant(tx: Transaction, entreprise: string, piece: string) {
  return (await lireFacture(tx, entreprise, piece)).reste;
}

// Après le geste : les règlements nouveaux, puis la facture réglée si elle vient de l'être.
export async function annoncerReglements(tx: Transaction, entreprise: string, piece: string, avant: bigint,
  nouveaux: { id: string; saisi: ReglementSaisi }[], par: { par: 'reglement' | 'avoir'; date: string } | null = null) {
  const f = await lireFacture(tx, entreprise, piece);
  const m = (x: bigint) => versTexte(x, f.decimales);
  const facture = { id: f.id, numero: f.numero_texte, ecran: lienEcran(entreprise, 'doc', f.ref_v10) };
  const client = { id: f.tiers, raisonSociale: f.raison_sociale };
  for (const r of nouveaux) {
    await emettreAvis(tx, entreprise, 'reglement.enregistre', {
      id: r.id, date: r.saisi.date, montant: m(r.saisi.montant), mode: r.saisi.mode, reference: r.saisi.reference, devise: f.devise, facture, client, reste: m(f.reste),
    });
  }
  if (avant > 0n && f.reste <= 0n) {
    // Réglée par des règlements : le jour du plus récent.
    const date = par?.date ?? (await requetes(tx).selectFrom('ventes.reglement').select((eb) => eb.fn.max('date_reglement').as('d'))
      .where('entreprise', '=', entreprise).where('piece', '=', piece).executeTakeFirst())?.d ?? null;
    await emettreAvis(tx, entreprise, 'facture.reglee', { ...facture, client, devise: f.devise, netAPayer: m(f.net_a_payer ?? 0n), date, par: par?.par ?? 'reglement' });
  }
}
