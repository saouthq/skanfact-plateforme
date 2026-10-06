// Le banc de comparaison (cadrage 08 § 1.2, point 2) : l'ancien moteur (v10, figé dans banc/v10) et
// le nouveau calculent les MÊMES pièces ; ils doivent tomber sur le même millime (ou centime), champ
// par champ. Un écart est soit un défaut du portage, soit un défaut de l'ancien moteur que les
// entiers révèlent : dans les deux cas il s'écrit ci-dessous et se tranche. Il ne se tolère jamais.
//
// Les pièces : celles de l'exemple de cinq ans de la v10, et des pièces tirées au hasard (toujours
// les mêmes : le tirage part d'une graine fixe).

import { describe, expect, it } from 'vitest';
import { calculerPiece } from '../../moteur/piece.ts';
import { convertir, demo, ecranDeLaPlateforme, entier, hasard, pieceAuHasard, v10, type DocV10, type ResultatV10, type Societe } from './v10.ts';

// Compare les deux calculs d'une pièce ; rend la liste des champs qui diffèrent.
function ecarts(d: DocV10, societe: Societe, calcul: (d: DocV10, c: Societe) => ResultatV10 = v10.computeTotals): string[] {
  const p = convertir(d, societe);
  if (typeof p === 'string') return [p];
  const a = calcul(d, societe);
  const n = calculerPiece(p);
  const s = 10 ** p.devise.decimales;
  const en = (x: number, echelle = s) => BigInt(Math.round(x * echelle));
  const faux: string[] = [];
  const cmp = (champ: string, ancien: bigint, nouveau: bigint) => { if (ancien !== nouveau) faux.push(`${champ} : v10 ${ancien}, nouveau ${nouveau}`); };
  a.lines.forEach((l, i) => {
    const m = n.lignes[i];
    if (!m) { faux.push(`ligne ${i} absente`); return; }
    cmp(`ligne ${i} HT`, en(l.ht), m.ht); cmp(`ligne ${i} TVA`, en(l.vat), m.tva); cmp(`ligne ${i} TTC`, en(l.ttc), m.ttc);
  });
  cmp('totalHT', en(a.totalHT), n.totalHT);
  cmp('remise', en(a.discount), n.remise);
  cmp('netHT', en(a.netHT), n.netHT);
  for (const [t, v] of Object.entries(a.vatByRate)) {
    const m = n.tvaParTaux.get(entier(t, 4) ?? -1n);
    cmp(`base ${t} %`, en(v.base), m?.base ?? -1n); cmp(`TVA ${t} %`, en(v.vat), m?.tva ?? -1n);
  }
  if (Object.keys(a.vatByRate).length !== n.tvaParTaux.size) faux.push('nombre de taux');
  cmp('totalTVA', en(a.totalVAT), n.totalTVA);
  cmp('timbre', en(a.stamp), n.timbre);
  cmp('timbre déclaré', en(a.stampBase, 1000), n.timbreBase);
  cmp('totalTTC', en(a.totalTTC), n.totalTTC);
  cmp('retenue', en(a.withholding), n.retenue);
  cmp('net à payer', en(a.netToPay), n.netAPayer);
  return faux;
}

// Les écarts TRANCHÉS : chacun dit pourquoi le nouveau moteur a raison et l'ancien tort (sinon
// c'est le portage qu'on corrige, et la ligne disparaît). Vérifiés à la main en fractions exactes le
// 28/09/2026 ; chaque situation est aussi tenue par un test de tests/moteur/piece.test.ts.
const ECARTS_EXEMPLE = new Map<string, string>();
const ECARTS_TIRAGE = new Map<number, string>([
  [2811, 'TVA 19 % : 401,727 − 385,9375 = 15,7895 exactement, soit 15,790 ; la v10 calcule 15,78949999… en virgule flottante et écrit 15,789'],
  [9418, 'base 0 % : la base remisée vaut exactement 95 176,827 49999998…, soit 95 176,827 ; la correction « 1 + 4 ε » de la v10 la pousse à 95 176,828'],
  [10799, 'TVA 19 % : −0,137 + 0,850 × 19 % = 0,0245 exactement, soit 0,025 ; la v10 calcule 0,02449999… et écrit 0,024'],
]);

describe('le banc v10 → plateforme, au millime', () => {
  const societe = { ...v10.DEFAULT_COMPANY, stampFee: 1, currency: 'DT' };

  it('les pièces de l\'exemple de cinq ans tombent sur le même millime, champ par champ', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28');
    const docs = donnees.documents;
    expect(docs.length).toBeGreaterThan(400);
    const faux = docs.map((d) => ({ id: d.id ?? '', e: ecarts(d, donnees.company) })).filter((x) => x.e.length);
    expect(faux.filter((x) => !ECARTS_EXEMPLE.has(x.id)).slice(0, 10)).toEqual([]);
    // Un écart tranché qui a disparu se retire de la liste : elle dit toujours la vérité.
    expect(faux.map((x) => x.id).sort()).toEqual([...ECARTS_EXEMPLE.keys()].sort());
  });

  it('20 000 pièces tirées au hasard (devises, remises, acomptes, retenues, timbres) tombent sur le même millime', () => {
    const h = hasard(20260928);
    const faux: { n: number; doc: DocV10; e: string[] }[] = [];
    for (let n = 0; n < 20_000; n++) {
      const doc = pieceAuHasard(h);
      const e = ecarts(doc, societe);
      if (e.length) faux.push({ n, doc, e });
    }
    expect(faux.filter((x) => !ECARTS_TIRAGE.has(x.n)).slice(0, 5)).toEqual([]);
    expect(faux.map((x) => x.n)).toEqual([...ECARTS_TIRAGE.keys()]);
    // Chaque écart tranché est d'UNE unité (un millime ou un centime), jamais davantage.
    for (const x of faux) for (const e of x.e) {
      const m = /v10 (-?\d+), nouveau (-?\d+)/.exec(e);
      expect(m && Math.abs(Number(m[1]) - Number(m[2]))).toBe(1);
    }
  });

  // Au comptoir, le prix d'étiquette fait foi (lot caisse 3, 06/10/2026) : le ticket et l'avoir de son retour se calculent
  // TTC d'abord. Les deux moteurs (le core.js de la plateforme, et le serveur) tombent sur le même millime.
  const plateforme = ecranDeLaPlateforme('core.js') as { computeTotals: (d: DocV10, c: Societe) => ResultatV10 };
  // Des tickets de comptoir (jusqu'à 12 lignes, 500 DT l'article, 50 unités) : au-delà de quelques dizaines de millions de
  // dinars, la virgule flottante de la v10 n'est plus exacte (un ticket de 96 millions y perdait un millime), hors du comptoir.
  it('20 000 tickets « prix TTC » tirés au hasard (remises, taux, quantités) tombent sur le même millime dans les deux moteurs', () => {
    const h = hasard(20261006);
    const faux: { n: number; e: string[] }[] = [];
    for (let n = 0; n < 20_000; n++) {
      const doc: DocV10 = {
        type: h.parmi(['facture', 'facture', 'avoir']), currency: 'DT', prixTtc: true, applyStamp: h.parmi([false, false, true]),
        discountRate: h.parmi([0, 0, 0, 5, 10, 12.5, 3.333]),
        lines: Array.from({ length: h.entre(1, 12) }, () => ({
          qty: h.parmi([1, 1, 1, 2, 3, 6, 12, 0.5, 1.25, 2.333, h.entre(1, 50)]),
          unitPrice: h.parmi([h.decimal(500, 3), h.decimal(20, 3), h.decimal(2, 3), h.decimal(50, 6)]),
          vatRate: h.parmi([0, 7, 13, 19, 19]),
          ...(h.suivant() < 0.05 ? { noDiscount: true } : {}),
        })),
      };
      const e = ecarts(doc, societe, plateforme.computeTotals);
      // Sans remise, aucune remise ne se lit nulle part (l'écran du client montrait « Remise − 0,000 DT »).
      if (!doc.discountRate) {
        const p = convertir(doc, societe);
        if (typeof p === 'string') throw new Error(p);
        const r = calculerPiece(p).remise, d = plateforme.computeTotals(doc, societe).discount;
        if (r !== 0n || d !== 0) e.push(`remise sans remise : ${r} au serveur, ${d} à l'écran`);
      }
      if (e.length) faux.push({ n, e });
    }
    expect(faux.slice(0, 5)).toEqual([]);
  });

  it('un ticket « prix TTC » : quantité × prix d\'étiquette, au millime, quel que soit le prix et la quantité ; HT + TVA = TTC', () => {
    let essais = 0;
    for (const taux of [0, 7, 13, 19]) {
      for (let ttcM = 100; ttcM <= 20000; ttcM += 37) {
        // Le HT au millime que la fiche d'un article garde pour ce prix TTC (le plus proche qui y retombe), et le prix
        // d'étiquette qu'il donne : en entiers (350 × 1,13 vaut 395,5 exactement, que la virgule flottante écrit 395,4999…).
        const ttcDe = (hM: number) => Math.floor((2 * hM * (100 + taux) + 100) / 200);
        const proche = Math.round(ttcM * 100 / (100 + taux));
        const hM = [0, 1, -1, 2, -2].map((d) => proche + d).find((x) => ttcDe(x) === ttcM) ?? proche;
        const ht = hM / 1000;
        const etiquette = ttcDe(hM);
        for (const qty of [1, 2, 3, 7, 12]) {
          const doc: DocV10 = { type: 'facture', currency: 'DT', prixTtc: true, applyStamp: false, lines: [{ qty, unitPrice: ht, vatRate: taux }] };
          const a = plateforme.computeTotals(doc, societe);
          const p = convertir(doc, societe);
          if (typeof p === 'string') throw new Error(p);
          const n = calculerPiece(p);
          expect(n.netAPayer).toBe(BigInt(qty * etiquette));
          expect(Math.round(a.netToPay * 1000)).toBe(qty * etiquette);
          expect(n.netHT + n.totalTVA).toBe(n.totalTTC);
          essais++;
        }
      }
    }
    expect(essais).toBe(4 * 538 * 5);
  });
});
