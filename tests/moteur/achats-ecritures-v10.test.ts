// Le banc des écritures d'achat (cadrage 08 § 1.2) : la v10 (`journalEntries`, partie « achats »)
// et le nouveau moteur écrivent chaque achat (journal AC) et chaque imputation d'acompte (OD).
// Même compte, même colonne, même millime, dans le même ordre ; deux écarts tranchés, vérifiés
// ci-dessous un à un.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import { calculerAchat, ecritureDAchat, ecritureDImputationAcompte, imputationAchat, type Achat, type ComptesAchat } from '../../moteur/achats.ts';
import { dansLaDeviseDe } from '../../moteur/ecritures.ts';
import { retenueAuFil, type PieceLiee, type Reglement } from '../../moteur/reglements.ts';
import { convertirAchat, factureDAchatAuHasard, type AchatDonne } from './v10-achats.ts';
import { demo, entier, exiger, hasard, v10, type Societe } from './v10.ts';

type Donnees = { purchases: AchatDonne[]; suppliers?: { id: string; name: string }[] };
type LigneV10 = { docId: string; journal: string; account: string; debit: number; credit: number };
const core = exiger('../../banc/v10/core.js') as {
  journalEntries: (data: Donnees, societe: Societe, periode: object, options: object) => LigneV10[];
  retenueDesReglements: (p: AchatDonne, c: Societe, data?: Donnees) => { ajustements: Record<string, number>; operee: number };
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const P = core.DEFAULT_ACCOUNTS;
const COMPTES: ComptesAchat = {
  fournisseurs: P.fournisseurs ?? '', charges: P.charges ?? '', achatsStock: P.achatsStock ?? '', immobilisations: P.immobilisations ?? '',
  fraisAccessoires: P.fraisAccessoires ?? '', tvaDeductible: P.tvaDeductible ?? '', avancesFournisseurs: P.avancesFournisseurs ?? '',
  gainsChange: P.gainsChange ?? '', pertesChange: P.pertesChange ?? '', retenueOperee: P.rsOperee ?? '',
};
const texte = (l: { compte: string; debit: bigint; credit: bigint }) => `${l.compte} ${l.debit} ${l.credit}`;

// La v10 « absorbe » l'écart de conversion d'une pièce en devise sur sa plus grosse ligne qui n'est
// pas celle du fournisseur ; le nouveau moteur l'écrit au change (règle des ventes, 10.14.1).
// Tranché le 28/09/2026 : les deux écritures sont les mêmes à cette ligne près, et l'écart que la v10
// y a ajouté est exactement celui que le nouveau moteur met au change.
type Ligne = { compte: string; nature: string; debit: bigint; credit: bigint };
// `filtre` retire de la comparaison les lignes qu'un autre écart tranché peut toucher.
function memeAuChangePres(ancienne: string[], nouvelle: Ligne[], filtre: (l: string[]) => string[] = (l) => l): boolean {
  const essais: { lignes: Ligne[]; ecart: bigint }[] = [];
  const derniere = nouvelle.at(-1);
  // L'écart d - c que le nouveau moteur a écrit au change, en dernière ligne.
  if (derniere && derniere.nature === 'change') essais.push({ lignes: nouvelle.slice(0, -1), ecart: derniere.credit - derniere.debit });
  essais.push({ lignes: nouvelle, ecart: 0n });
  return essais.some(({ lignes, ecart }) => {
    const n = filtre(lignes.map(texte)), a = filtre(ancienne);
    if (n.length !== a.length) return false;
    const differentes = n.map((l, i) => [l, a[i] ?? ''] as const).filter(([x, y]) => x !== y);
    if (differentes.length === 0) return ecart === 0n;
    if (differentes.length !== 1 || ecart === 0n) return false;
    const [[ln, la]] = differentes as [readonly [string, string]];
    const [cn, dn, crn] = ln.split(' '), [ca, da, cra] = la.split(' ');
    if (cn !== ca) return false;
    // L'absorbeur de la v10 : au crédit, il ajoute l'écart ; au débit, il le retire.
    return BigInt(crn ?? 0) > 0n ? BigInt(cra ?? 0) === BigInt(crn ?? 0) + ecart && da === dn : BigInt(da ?? 0) === BigInt(dn ?? 0) - ecart && cra === crn;
  });
}

const horsTiers = (l: string[]) => l.filter((x) => ![COMPTES.fournisseurs, COMPTES.retenueOperee, COMPTES.gainsChange, COMPTES.pertesChange].includes(x.split(' ')[0] ?? ''));

type Vus = { ecritures: number; imputations: number; avoirsRattaches: number; regularises: number; auChange: number; centimes: number };

function comparer(data: Donnees, societe: Societe, vus: Vus): string[] {
  const faux: string[] = [];
  const lignes10 = core.journalEntries(data, societe, {}, { sections: ['achats'] });
  const convertis = new Map<string, Achat>();
  for (const p of data.purchases) {
    const a = convertirAchat(p, societe);
    if (typeof a === 'string') return [];
    convertis.set(p.id, a);
  }
  const reglements = (p: AchatDonne, dec: number): Reglement[] =>
    (p.payments ?? []).map((y, i) => ({ cle: y.id || `#${i}`, date: y.date ?? '', montant: entier(Number(y.amount), dec) ?? 0n }));
  for (const p of data.purchases) {
    const a = convertis.get(p.id) as Achat;
    const t = calculerAchat(a, TND);
    const f = p.achatLie ? data.purchases.find((x) => x.id === p.achatLie) : undefined;
    let rattachement;
    let centime = false;
    if (a.nature === 'avoir' && f) {
      const af = convertis.get(f.id) as Achat;
      const tf = calculerAchat(af, TND);
      const liees: PieceLiee[] = data.purchases.filter((x) => x.achatLie === f.id).map((x) => {
        const ax = convertis.get(x.id) as Achat;
        const im = imputationAchat(calculerAchat(ax, TND), ax.nature, reglements(x, ax.devise.decimales));
        return { cle: x.id, date: ax.nature === 'acompte' ? '' : (x.date ?? ''), net: dansLaDeviseDe(im.net, ax, af, TND), brut: dansLaDeviseDe(im.brut, ax, af, TND) };
      });
      const regul = retenueAuFil(tf.netAPayer, tf.netAPayer + tf.retenue, liees, reglements(f, af.devise.decimales)).ajustements.get(p.id) ?? 0n;
      const brutImpute = imputationAchat(t, 'avoir', reglements(p, a.devise.decimales)).brut;
      rattachement = { facture: af, brutImpute, regularisationRetenue: regul };
      vus.avoirsRattaches++;
      if (regul) vus.regularises++;
      // L'écart tranché des règlements : en devise, la v10 tient la retenue au millième d'euro.
      const ancien = core.retenueDesReglements(f, societe, data).ajustements[p.id] ?? 0;
      if (af.devise.code !== 'TND' && entier(ancien, af.devise.decimales) !== regul) centime = true;
      if (a.devise.code !== 'TND' && (p.payments ?? []).length && Number(p.withholdingRate) > 0) centime = true;
    }
    const nouvelle = ecritureDAchat(t, a, TND, COMPTES, rattachement).lignes;
    const ancienne = lignes10.filter((l) => l.docId === p.id && l.journal === 'AC').map((l) => `${l.account} ${Math.round(l.debit * 1000)} ${Math.round(l.credit * 1000)}`);
    vus.ecritures++;
    if (JSON.stringify(nouvelle.map(texte)) !== JSON.stringify(ancienne)) {
      if (a.devise.code !== 'TND' && memeAuChangePres(ancienne, nouvelle)) vus.auChange++;
      // L'écart tranché des règlements (la retenue au centime) ne touche que le fournisseur, la
      // retenue opérée et le change ; tout le reste est le même.
      else if (centime && memeAuChangePres(ancienne, nouvelle, horsTiers)) vus.centimes++;
      else faux.push(`${p.id} (${a.nature}) : v10 [${ancienne.join(' | ')}] ; nouveau [${nouvelle.map(texte).join(' | ')}]`);
    }
    // Les imputations des acomptes de cette facture, dans l'ordre des pièces.
    if (a.nature !== 'avoir' && a.nature !== 'acompte') {
      const imputations10 = lignes10.filter((l) => l.docId === p.id && l.journal === 'OD');
      const nouvelles = data.purchases.filter((x) => x.achatLie === p.id && x.kind === 'acompte').flatMap((x) => {
        const ax = convertis.get(x.id) as Achat;
        return ecritureDImputationAcompte(calculerAchat(ax, TND), ax, a, TND, COMPTES).lignes;
      });
      const anciennes = imputations10.map((l) => `${l.account} ${Math.round(l.debit * 1000)} ${Math.round(l.credit * 1000)}`);
      if (nouvelles.length) vus.imputations++;
      if (JSON.stringify(nouvelles.map(texte)) !== JSON.stringify(anciennes) && !memeAuChangePres(anciennes, nouvelles)) {
        faux.push(`${p.id} imputation : v10 [${anciennes.join(' | ')}] ; nouveau [${nouvelles.map(texte).join(' | ')}]`);
      }
    }
  }
  return faux;
}

describe('le banc des écritures d\'achat, contre la v10', () => {
  it('chaque achat de l\'exemple de cinq ans s\'écrit au même millime, et chaque acompte s\'impute de même', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as Donnees & { company: Societe };
    const vus: Vus = { ecritures: 0, imputations: 0, avoirsRattaches: 0, regularises: 0, auChange: 0, centimes: 0 };
    expect(comparer(donnees, donnees.company, vus)).toEqual([]);
    expect(vus.ecritures).toBeGreaterThan(100);
    expect(vus.imputations).toBeGreaterThan(0);
  });

  it('3 000 factures d\'achat tirées au hasard, avec leurs avoirs, acomptes et règlements : les mêmes, sauf les écarts tranchés', () => {
    const societe = { ...v10.DEFAULT_COMPANY };
    const h = hasard(20261002);
    const faux: string[] = [];
    const vus: Vus = { ecritures: 0, imputations: 0, avoirsRattaches: 0, regularises: 0, auChange: 0, centimes: 0 };
    for (let i = 0; i < 3000 && faux.length < 5; i++) {
      const achats = factureDAchatAuHasard(h, i);
      faux.push(...comparer({ purchases: achats, suppliers: [{ id: 's1', name: 'Fournisseur' }] }, societe, vus).map((x) => `${i} : ${x}`));
    }
    expect(faux).toEqual([]);
    // Le tirage atteint chaque cas, et chaque écart tranché existe bien (sinon sa règle n'a rien vérifié).
    expect(vus.ecritures).toBeGreaterThan(4000);
    expect(vus.imputations).toBeGreaterThan(400);
    expect(vus.avoirsRattaches).toBeGreaterThan(1000);
    expect(vus.regularises).toBeGreaterThan(150);
    expect(vus.auChange).toBeGreaterThan(300);
    expect(vus.centimes).toBeGreaterThan(0);
  });
});
