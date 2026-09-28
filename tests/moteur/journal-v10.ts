// Le journal d'une entreprise v10 écrit par le NOUVEAU moteur : chaque vente, avoir, encaissement,
// achat, imputation d'acompte et règlement fournisseur, à sa date. Sert aux bancs qui comparent ce
// que les livres disent (les déclarations, les soldes) à ce que la v10 calcule par ses propres chemins.

import { TND } from '../../moteur/argent.ts';
import {
  calculerAchat, ecritureDAchat, ecritureDeReglementFournisseur, ecritureDImputationAcompte, imputationAchat,
  type Achat, type ComptesAchat, type ComptesReglementFournisseur,
} from '../../moteur/achats.ts';
import { dansLaDeviseDe, ecritureDeVente, type ComptesVente } from '../../moteur/ecritures.ts';
import type { EcritureDatee } from '../../moteur/declarations.ts';
import { calculerPiece, type Piece } from '../../moteur/piece.ts';
import { ecritureDEncaissement, retenueAuFil, type ComptesEncaissement, type PieceLiee, type Reglement } from '../../moteur/reglements.ts';
import { convertirAchat, type AchatDonne, type PaiementV10 } from './v10-achats.ts';
import { convertir, entier, exiger, type DocV10, type Societe } from './v10.ts';

export type DocumentV10 = DocV10 & { id: string; number?: string; date?: string; status?: string; creditOf?: string; payments?: PaiementV10[] };
export type EntrepriseV10 = { documents: DocumentV10[]; purchases: AchatDonne[] };

const P = (exiger('../../banc/v10/core.js') as { DEFAULT_ACCOUNTS: Record<string, string> }).DEFAULT_ACCOUNTS;
const c = (k: string) => P[k] ?? '';
export const COMPTES = {
  vente: { clients: c('clients'), ventes: c('ventes'), tvaCollectee: c('tvaCollectee'), timbre: c('timbre'), gainsChange: c('gainsChange'), pertesChange: c('pertesChange'), retenueSubie: c('rsSubie') } as ComptesVente,
  encaissement: { clients: c('clients'), tresorerie: c('banque'), retenueSubie: c('rsSubie'), gainsChange: c('gainsChange'), pertesChange: c('pertesChange') } as ComptesEncaissement,
  achat: {
    fournisseurs: c('fournisseurs'), charges: c('charges'), achatsStock: c('achatsStock'), immobilisations: c('immobilisations'), fraisAccessoires: c('fraisAccessoires'),
    tvaDeductible: c('tvaDeductible'), avancesFournisseurs: c('avancesFournisseurs'), gainsChange: c('gainsChange'), pertesChange: c('pertesChange'), retenueOperee: c('rsOperee'),
  } as ComptesAchat,
  reglement: { fournisseurs: c('fournisseurs'), tresorerie: c('banque'), retenueOperee: c('rsOperee'), gainsChange: c('gainsChange'), pertesChange: c('pertesChange') } as ComptesReglementFournisseur,
  declaration: { tvaCollectee: c('tvaCollectee'), tvaDeductible: c('tvaDeductible'), timbre: c('timbre'), retenueSubie: c('rsSubie'), retenueOperee: c('rsOperee') },
};

function reglements(payments: PaiementV10[] | undefined, decimales: number): Reglement[] {
  return (payments ?? []).map((y, i) => {
    const montant = entier(Number(y.amount), decimales), cours = Number(y.exchangeRate) > 0 ? entier(Number(y.exchangeRate), 6) : undefined;
    if (montant === null || cours === null) throw new Error(`règlement non représentable : ${JSON.stringify(y)}`);
    return { cle: y.id || `#${i}`, date: y.date ?? '', montant, cours };
  });
}
function piece(d: DocV10, societe: Societe): Piece {
  const p = convertir(d, societe);
  if (typeof p === 'string') throw new Error(p);
  return p;
}
function achat(p: AchatDonne, societe: Societe): Achat {
  const a = convertirAchat(p, societe);
  if (typeof a === 'string') throw new Error(a);
  return a;
}

export function journalDuNouveauMoteur(data: EntrepriseV10, societe: Societe): EcritureDatee[] {
  const out: EcritureDatee[] = [];
  const docs = new Map(data.documents.map((d) => [d.id, d]));
  // La retenue d'une facture de vente au fil de ses règlements, ses avoirs déduits.
  const retenueVente = (f: DocumentV10) => {
    const pf = piece(f, societe);
    if (f.status === 'brouillon' || f.status === 'annulée') return { pf, rs: retenueAuFil(0n, 0n, [], []) };
    const tf = calculerPiece(pf);
    const liees: PieceLiee[] = data.documents.filter((a) => a.type === 'avoir' && a.creditOf === f.id && a.status !== 'brouillon').map((a) => {
      const pa = piece(a, societe), ta = calculerPiece(pa);
      return { cle: a.id, date: a.date ?? '', net: dansLaDeviseDe(ta.netAPayer, pa, pf, TND), brut: dansLaDeviseDe(ta.netAPayer + ta.retenue, pa, pf, TND) };
    });
    return { pf, rs: retenueAuFil(tf.netAPayer, tf.netAPayer + tf.retenue, liees, reglements(f.payments, pf.devise.decimales)) };
  };
  for (const d of data.documents) {
    if (d.status === 'brouillon' || !d.number) continue;
    if (d.type === 'facture' && d.status !== 'annulée') {
      const p = piece(d, societe);
      out.push({ date: d.date ?? '', lignes: ecritureDeVente(calculerPiece(p), p, TND, COMPTES.vente).lignes });
    } else if (d.type === 'avoir') {
      const p = piece(d, societe);
      const f = d.creditOf ? docs.get(d.creditOf) : undefined;
      const rattachement = f ? (() => { const { pf, rs } = retenueVente(f); return { facture: pf, regularisationRetenue: rs.ajustements.get(d.id) ?? 0n }; })() : undefined;
      out.push({ date: d.date ?? '', lignes: ecritureDeVente(calculerPiece(p), p, TND, COMPTES.vente, rattachement).lignes });
    }
  }
  // Les encaissements (la v10 les écrit pour toute facture qui porte un règlement).
  for (const f of data.documents.filter((d) => d.type === 'facture' && (d.payments ?? []).length)) {
    const { pf, rs } = retenueVente(f);
    const avecRetenue = Number(f.withholdingRate) > 0;
    for (const r of reglements(f.payments, pf.devise.decimales)) {
      out.push({ date: r.date, lignes: ecritureDEncaissement(pf, r, avecRetenue ? rs.parts.get(r.cle) ?? 0n : 0n, TND, COMPTES.encaissement).lignes });
    }
  }
  // Les achats, leurs imputations d'acompte et leurs règlements.
  const achats = new Map(data.purchases.map((p) => [p.id, p]));
  const retenueAchat = (f: AchatDonne) => {
    const af = achat(f, societe), tf = calculerAchat(af, TND);
    if (af.nature === 'avoir' || af.nature === 'acompte') return { af, rs: retenueAuFil(tf.netAPayer, tf.netAPayer + tf.retenue, [], reglements(f.payments, af.devise.decimales)) };
    const liees: PieceLiee[] = data.purchases.filter((x) => x.achatLie === f.id).map((x) => {
      const ax = achat(x, societe);
      const im = imputationAchat(calculerAchat(ax, TND), ax.nature, reglements(x.payments, ax.devise.decimales));
      return { cle: x.id, date: ax.nature === 'acompte' ? '' : (x.date ?? ''), net: dansLaDeviseDe(im.net, ax, af, TND), brut: dansLaDeviseDe(im.brut, ax, af, TND) };
    });
    return { af, rs: retenueAuFil(tf.netAPayer, tf.netAPayer + tf.retenue, liees, reglements(f.payments, af.devise.decimales)) };
  };
  for (const p of data.purchases) {
    const a = achat(p, societe), t = calculerAchat(a, TND);
    const f = p.achatLie ? achats.get(p.achatLie) : undefined;
    let rattachement;
    if (a.nature === 'avoir' && f) {
      const { af, rs } = retenueAchat(f);
      rattachement = { facture: af, brutImpute: imputationAchat(t, 'avoir', reglements(p.payments, a.devise.decimales)).brut, regularisationRetenue: rs.ajustements.get(p.id) ?? 0n };
    }
    out.push({ date: p.date ?? '', lignes: ecritureDAchat(t, a, TND, COMPTES.achat, rattachement).lignes });
    if (a.nature !== 'avoir' && a.nature !== 'acompte') {
      for (const x of data.purchases.filter((y) => y.achatLie === p.id && y.kind === 'acompte')) {
        const ax = achat(x, societe);
        out.push({ date: p.date ?? '', lignes: ecritureDImputationAcompte(calculerAchat(ax, TND), ax, a, TND, COMPTES.achat).lignes });
      }
    }
    const { rs } = retenueAchat(p);
    for (const r of reglements(p.payments, a.devise.decimales)) {
      out.push({ date: r.date, lignes: ecritureDeReglementFournisseur(a, r, rs.parts.get(r.cle) ?? 0n, TND, COMPTES.reglement).lignes });
    }
  }
  return out;
}
