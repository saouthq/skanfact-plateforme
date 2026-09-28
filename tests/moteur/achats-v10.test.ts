// Le banc des achats (cadrage 08 § 1.2) : la v10 (`purchaseTotals`) et le nouveau moteur
// (`calculerAchat`) calculent les mêmes achats. Tout doit tomber au même millime, dans la devise de
// la pièce comme dans celle de la comptabilité ; un écart se tranche et s'écrit.

import { describe, expect, it } from 'vitest';
import { TND } from '../../moteur/argent.ts';
import { calculerAchat, DESTINATIONS } from '../../moteur/achats.ts';
import { achatAuHasard, convertirAchat, coreAchats, type AchatV10 } from './v10-achats.ts';
import { demo, entier, hasard, v10, type Societe } from './v10.ts';

// Les différences entre les deux calculs (vide : les mêmes).
function comparer(p: AchatV10, societe: Societe): string[] | string {
  const a = convertirAchat(p, societe);
  if (typeof a === 'string') return a;
  const t = calculerAchat(a, TND);
  const v = coreAchats.purchaseTotals(p, societe);
  const faux: string[] = [];
  const dec = a.devise.decimales;
  const egal = (nom: string, ancien: number, nouveau: bigint, d: number) => { if (entier(ancien, d) !== nouveau) faux.push(`${nom} : v10 ${ancien}, nouveau ${nouveau}`); };
  egal('HT', v.totalHT, t.totalHT, dec); egal('TVA', v.totalVAT, t.totalTVA, dec); egal('TVA déductible', v.deductibleVAT, t.tvaDeductible, dec);
  egal('frais', v.fees, t.frais, dec); egal('TTC', v.totalTTC, t.totalTTC, dec); egal('retenue', v.withholding, t.retenue, dec); egal('net', v.netToPay, t.netAPayer, dec);
  for (const k of DESTINATIONS) {
    egal(`HT ${k}`, v.byDestination[k] ?? 0, t.parDestination[k], dec);
    egal(`non déductible ${k}`, v.nonDeductibleParDestination[k] ?? 0, t.nonDeductibleParDestination[k], dec);
    egal(`base ${k}`, v.base.byDestination[k] ?? 0, t.base.parDestination[k], 3);
    egal(`base non déductible ${k}`, v.base.nonDeductibleParDestination[k] ?? 0, t.base.nonDeductibleParDestination[k], 3);
    egal(`coût ${k}`, v.base.cout[k] ?? 0, t.base.cout[k], 3);
  }
  const taux = (m: Map<bigint, unknown>, r: Record<string, unknown>) => { if (m.size !== Object.keys(r).length) faux.push(`taux : v10 ${Object.keys(r)}, nouveau ${[...m.keys()]}`); };
  taux(t.tvaParTaux, v.vatByRate);
  for (const [r, x] of Object.entries(v.vatByRate)) {
    const n = t.tvaParTaux.get(entier(r, 4) ?? -1n), b = t.base.tvaParTaux.get(entier(r, 4) ?? -1n);
    if (!n || !b) { faux.push(`taux ${r} absent`); continue; }
    egal(`base ${r} %`, x.base, n.base, dec); egal(`TVA ${r} %`, x.vat, n.tva, dec); egal(`déductible ${r} %`, x.deductible, n.deductible, dec);
    const vb = v.base.vatByRate[r];
    if (vb) { egal(`base ${r} % (dinars)`, vb.base, b.base, 3); egal(`TVA ${r} % (dinars)`, vb.vat, b.tva, 3); egal(`déductible ${r} % (dinars)`, vb.deductible, b.deductible, 3); }
  }
  const B = v.base, N = t.base;
  egal('HT (dinars)', B.totalHT, N.totalHT, 3); egal('TVA (dinars)', B.totalVAT, N.totalTVA, 3); egal('TVA déductible (dinars)', B.deductibleVAT, N.tvaDeductible, 3);
  egal('frais (dinars)', B.fees, N.frais, 3); egal('TTC (dinars)', B.totalTTC, N.totalTTC, 3); egal('retenue (dinars)', B.withholding, N.retenue, 3);
  egal('net (dinars)', B.netToPay, N.netAPayer, 3); egal('avance', B.avance, N.avance, 3);
  return faux;
}

describe('le banc des achats, contre la v10', () => {
  it('chaque achat de l\'exemple de cinq ans se calcule au même millime, dans sa devise et en dinars', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY }, '2026-09-28') as unknown as { company: Societe; purchases: (AchatV10 & { id: string })[] };
    expect(donnees.purchases.length).toBeGreaterThan(100);
    const faux: string[] = [];
    for (const p of donnees.purchases) {
      const e = comparer(p, donnees.company);
      if (typeof e === 'string') faux.push(`${p.id} : ${e}`);
      else faux.push(...e.map((x) => `${p.id} : ${x}`));
    }
    expect(faux).toEqual([]);
  });

  it('20 000 achats tirés au hasard (factures, dépenses, avoirs, acomptes, devises, TVA non déductible) : les mêmes', () => {
    const societe = { ...v10.DEFAULT_COMPANY };
    const h = hasard(20261001);
    const faux: string[] = [];
    let calcules = 0;
    for (let i = 0; i < 20_000 && faux.length < 5; i++) {
      const p = achatAuHasard(h);
      const e = comparer(p, societe);
      if (typeof e === 'string') continue;
      calcules++;
      faux.push(...e.map((x) => `${i} : ${x}`));
    }
    expect(faux).toEqual([]);
    expect(calcules).toBeGreaterThan(18_000);
  });
});
