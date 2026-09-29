// Les règlements d'une facture de vente, tenus par le serveur (0012 ; docs/avoirs-reglements.md) :
//   - `tenirReglements` (serveur/reglements.ts, partagé avec les achats) met la table au même état
//     que ce que l'interface a enregistré, et chaque geste laisse sa trace (D2) ;
//   - `etatDeFacture` lit ce que la facture doit encore, son statut et la retenue née de chaque
//     règlement, par le moteur (moteur/reglements.ts, comparé à la v10 depuis l'étape 1).
// Les montants sont des entiers dans l'unité de la devise de la FACTURE (D3).

import { versTexte } from '../../moteur/argent.ts';
import { retenueAuFil, soldeFacture, statutFacture, type PieceLiee, type Reglement } from '../../moteur/reglements.ts';
import { requetes, type Transaction } from '../base.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import type { PieceLue } from './pieces.ts';
import './textes.ts';

// Ce que la facture doit encore, son statut, et la retenue née de chaque règlement (R8 : cela se
// DÉDUIT, rien ne s'enregistre). Les avoirs sont dans la devise de la facture (0012 le garantit).
export async function etatDeFacture(tx: Transaction, entreprise: string, f: PieceLue, decimales: number, aujourdhui = aujourdhuiATunis()) {
  if (f.type !== 'facture' || f.statut !== 'emise' || !f.totaux) return null;
  const db = requetes(tx);
  const reglements = await db.selectFrom('ventes.reglement').selectAll()
    .where('entreprise', '=', entreprise).where('piece', '=', f.id).orderBy('rang').execute();
  const avoirs = await db.selectFrom('ventes.piece').select(['id', 'numero_texte', 'date_piece', 'net_a_payer', 'retenue'])
    .where('entreprise', '=', entreprise).where('corrige', '=', f.id).where('statut', '=', 'emise').orderBy('date_piece').orderBy('id').execute();
  const net = f.totaux.net_a_payer ?? 0n, retenue = f.totaux.retenue ?? 0n;
  const liees: PieceLiee[] = avoirs.map((a) => ({ cle: a.id, date: a.date_piece, net: a.net_a_payer ?? 0n, brut: (a.net_a_payer ?? 0n) + (a.retenue ?? 0n) }));
  const regles: Reglement[] = reglements.map((r) => ({ cle: r.id, date: r.date_reglement, montant: r.montant, cours: r.cours ?? undefined }));
  const fil = retenueAuFil(net, net + retenue, liees, regles);
  const solde = (await soldesDeFactures(tx, entreprise, [{ id: f.id, net }])).get(f.id) ?? soldeFacture(net, [], []);
  const m = (v: bigint) => versTexte(v, decimales);
  return {
    reste: m(solde.reste), paye: m(solde.paye), credite: m(solde.credite),
    statut: statutFacture(net, solde, f.echeance ?? undefined, aujourdhui),
    retenueDue: m(fil.due), retenueOperee: m(fil.operee),
    reglements: reglements.map((r) => ({
      id: r.id, date: r.date_reglement, montant: m(r.montant), cours: r.cours === null ? null : versTexte(r.cours, 6),
      mode: r.mode, reference: r.reference, retenue: m(fil.parts.get(r.id) ?? 0n),
    })),
    avoirs: avoirs.map((a) => ({ id: a.id, numero: a.numero_texte, date: a.date_piece, netAPayer: m(a.net_a_payer ?? 0n), regularisation: m(fil.ajustements.get(a.id) ?? 0n) })),
  };
}

// Ce que chaque facture émise d'une page doit encore (la liste, comme la lecture d'une facture) :
// UNE fonction, donc un seul chiffre ; deux requêtes pour toute la page.
export async function soldesDeFactures(tx: Transaction, entreprise: string, factures: { id: string; net: bigint }[]) {
  const soldes = new Map<string, ReturnType<typeof soldeFacture>>();
  if (!factures.length) return soldes;
  const ids = factures.map((f) => f.id);
  const db = requetes(tx);
  const reglements = await db.selectFrom('ventes.reglement').select(['piece', 'montant']).where('entreprise', '=', entreprise).where('piece', 'in', ids).execute();
  const avoirs = await db.selectFrom('ventes.piece').select(['corrige', 'net_a_payer'])
    .where('entreprise', '=', entreprise).where('corrige', 'in', ids).where('statut', '=', 'emise').execute();
  for (const f of factures) {
    soldes.set(f.id, soldeFacture(f.net, avoirs.filter((a) => a.corrige === f.id).map((a) => a.net_a_payer ?? 0n),
      reglements.filter((r) => r.piece === f.id).map((r) => r.montant)));
  }
  return soldes;
}
