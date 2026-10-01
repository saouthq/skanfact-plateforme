// La situation d'un client en un appel (brique 127 ; docs/api-situation.md, S1 à S5) : pour la console d'un
// partenaire (SkanEcom, d'abord) qui ne refait pas le métier de la facturation et lit celle de SkanFact.
// Tout se calcule par les fonctions des écrans : le reste d'une facture est celui de `soldesDeFactures`, comme
// la liste et la lecture d'une facture (deux chemins, un chiffre).

import { sql } from 'kysely';
import { versTexte } from '../../moteur/argent.ts';
import { requetes, type Transaction } from '../base.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { soldesDeFactures } from './reglements.ts';

// L'écran de SkanFact qui montre une facture ou un client : une adresse RELATIVE au serveur de SkanFact (la
// console la préfixe de l'adresse qu'elle appelle déjà). Seules les pièces et les fiches nées des écrans en ont un.
export const lienEcran = (entreprise: string, vue: 'doc' | 'client', ref: string | null) =>
  (ref ? `/v10/?e=${entreprise}#/${vue}/${ref}` : null);

// Les jours entre deux jours du calendrier (en UTC : une date n'est jamais un instant).
const joursEntre = (de: string, a: string) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) / 86_400_000);

// Ses factures émises, ce qu'elles doivent encore, par devise ; ce qui est échu ; le plus vieux retard ; le dernier
// règlement (le plus récent par sa date, puis le dernier saisi ; un remboursement y compte, en négatif). `null` : ce
// n'est pas un client de cette entreprise.
export async function situationClient(tx: Transaction, entreprise: string, client: string, aujourdhui = aujourdhuiATunis()) {
  const db = requetes(tx);
  const fiche = await db.selectFrom('socle.tiers').select(['id', 'raison_sociale', 'identifiant', 'ref_v10'])
    .where('entreprise', '=', entreprise).where('id', '=', client).where(sql<boolean>`'client' = any(roles)`).executeTakeFirst();
  if (!fiche) return null;
  const factures = await db.selectFrom('ventes.piece as p').innerJoin('socle.devise as d', 'd.code', 'p.devise')
    .select(['p.id', 'p.numero_texte', 'p.echeance', 'p.devise', 'd.decimales', 'p.net_a_payer', 'p.ref_v10'])
    .where('p.entreprise', '=', entreprise).where('p.tiers', '=', client).where('p.type', '=', 'facture').where('p.statut', '=', 'emise')
    .orderBy('p.echeance').execute();
  const soldes = await soldesDeFactures(tx, entreprise, factures.map((f) => ({ id: f.id, net: f.net_a_payer ?? 0n })));
  const parDevise = new Map<string, { decimales: number; reste: bigint; echu: bigint; aPayer: number; echues: number }>();
  let retard: { depuis: string; jours: number; numero: string | null; ecran: string | null } | null = null;
  for (const f of factures) {
    const reste = soldes.get(f.id)?.reste ?? 0n;
    if (reste <= 0n) continue;
    const d = parDevise.get(f.devise) ?? { decimales: f.decimales, reste: 0n, echu: 0n, aPayer: 0, echues: 0 };
    d.reste += reste; d.aPayer += 1;
    if (f.echeance && f.echeance < aujourdhui) {
      d.echu += reste; d.echues += 1;
      // Lues par échéance : la première échue est la plus vieille.
      if (!retard) retard = { depuis: f.echeance, jours: joursEntre(f.echeance, aujourdhui), numero: f.numero_texte, ecran: lienEcran(entreprise, 'doc', f.ref_v10) };
    }
    parDevise.set(f.devise, d);
  }
  const dernier = await db.selectFrom('ventes.reglement as r').innerJoin('ventes.piece as p', 'p.id', 'r.piece').innerJoin('socle.devise as d', 'd.code', 'p.devise')
    .select(['r.date_reglement', 'r.montant', 'p.devise', 'd.decimales', 'p.numero_texte'])
    .where('r.entreprise', '=', entreprise).where('p.tiers', '=', client)
    .orderBy('r.date_reglement', 'desc').orderBy('r.id', 'desc').limit(1).executeTakeFirst();
  return {
    client: { id: fiche.id, raisonSociale: fiche.raison_sociale, identifiant: fiche.identifiant, ecran: lienEcran(entreprise, 'client', fiche.ref_v10) },
    au: aujourdhui,
    soldes: [...parDevise].map(([devise, d]) => ({ devise, reste: versTexte(d.reste, d.decimales), echu: versTexte(d.echu, d.decimales), facturesAPayer: d.aPayer, facturesEchues: d.echues })),
    retard,
    dernierReglement: dernier ? { date: dernier.date_reglement, montant: versTexte(dernier.montant, dernier.decimales), devise: dernier.devise, facture: dernier.numero_texte } : null,
  };
}
