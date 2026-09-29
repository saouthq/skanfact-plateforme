// Ce qu'un achat doit encore, son statut, et la retenue née de chacun de ses règlements (0013 ;
// docs/achats.md). Cela se DÉDUIT (R8) : rien ne s'enregistre. Calculé en LOT pour une page entière
// (la liste) comme pour une seule pièce (sa lecture) : une seule fonction, donc un seul chiffre.
// Les montants sont des entiers dans l'unité de la devise de la pièce ; une pièce rattachée est
// dans la devise de sa facture (D3).

import { versTexte } from '../../moteur/argent.ts';
import { imputationAchat, soldeAchat, statutAchat, type NatureAchat } from '../../moteur/achats.ts';
import { retenueAuFil, type PieceLiee, type Reglement } from '../../moteur/reglements.ts';
import { requetes, type Transaction } from '../base.ts';
import { aujourdhuiATunis } from '../reglements.ts';

export type EtatAchat = {
  reste: string; paye: string; impute: string; statut: ReturnType<typeof statutAchat>;
  retenueDue: string; retenueOperee: string;
  reglements: { id: string; date: string; montant: string; cours: string | null; mode: string; reference: string | null; retenue: string }[];
  rattachees: { id: string; nature: NatureAchat; numero: string | null; date: string; impute: string; regularisation: string }[];
};

export async function etatsDAchats(tx: Transaction, entreprise: string, ids: string[], aujourdhui = aujourdhuiATunis()): Promise<Map<string, EtatAchat>> {
  const etats = new Map<string, EtatAchat>();
  if (!ids.length) return etats;
  const db = requetes(tx);
  const pieces = await db.selectFrom('achats.piece as p').innerJoin('socle.devise as d', 'd.code', 'p.devise')
    .select(['p.id', 'p.nature', 'p.lie', 'p.echeance', 'p.net_a_payer', 'p.retenue', 'd.decimales'])
    .where('p.entreprise', '=', entreprise).where('p.id', 'in', ids).execute();
  const liees = await db.selectFrom('achats.piece').select(['id', 'lie', 'nature', 'numero_fournisseur', 'date_piece', 'net_a_payer', 'retenue'])
    .where('entreprise', '=', entreprise).where('lie', 'in', ids).orderBy('date_piece').orderBy('id').execute();
  const tous = [...ids, ...liees.map((l) => l.id)];
  const reglements = await db.selectFrom('achats.reglement').selectAll()
    .where('entreprise', '=', entreprise).where('piece', 'in', tous).orderBy('rang').execute();
  const reglementsDe = (piece: string): Reglement[] => reglements.filter((r) => r.piece === piece)
    .map((r) => ({ cle: r.id, date: r.date_reglement, montant: r.montant, cours: r.cours ?? undefined }));

  for (const p of pieces) {
    const nature = p.nature as NatureAchat;
    const t = { netAPayer: p.net_a_payer, retenue: p.retenue };
    const regs = reglementsDe(p.id);
    // Ce que chaque pièce rattachée couvre : un acompte dès l'origine, un avoir à SA date.
    const siennes = nature === 'facture' || nature === 'depense' ? liees.filter((l) => l.lie === p.id) : [];
    const couvertes = siennes.map((l) => ({ l, im: imputationAchat({ netAPayer: l.net_a_payer, retenue: l.retenue }, l.nature as NatureAchat, reglementsDe(l.id)) }));
    const pl: PieceLiee[] = couvertes.map(({ l, im }) => ({ cle: l.id, date: l.nature === 'acompte' ? '' : l.date_piece, net: im.net, brut: im.brut }));
    const fil = retenueAuFil(t.netAPayer, t.netAPayer + t.retenue, pl, regs);
    const solde = soldeAchat(t, nature, p.lie !== null, regs.map((r) => r.montant), pl.map((x) => x.net));
    const m = (v: bigint) => versTexte(v, p.decimales);
    etats.set(p.id, {
      reste: m(solde.reste), paye: m(solde.paye), impute: m(solde.impute),
      statut: statutAchat(nature, p.lie !== null, solde, p.echeance ?? undefined, aujourdhui),
      retenueDue: m(fil.due), retenueOperee: m(fil.operee),
      reglements: reglements.filter((r) => r.piece === p.id).map((r) => ({
        id: r.id, date: r.date_reglement, montant: m(r.montant), cours: r.cours === null ? null : versTexte(r.cours, 6),
        mode: r.mode, reference: r.reference, retenue: m(fil.parts.get(r.id) ?? 0n),
      })),
      rattachees: couvertes.map(({ l, im }) => ({
        id: l.id, nature: l.nature as NatureAchat, numero: l.numero_fournisseur, date: l.date_piece, impute: m(im.net), regularisation: m(fil.ajustements.get(l.id) ?? 0n),
      })),
    });
  }
  return etats;
}
