// (1.390.5, issue 12, CP-1) « Ta facture se prépare » dit le montant de LA facture que le facturier fera : quand ce
// montant compte un rattrapage de la période passée, la phrase le nomme (avant : « 120 DT HT pour 1 dossier payant »).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/plateforme/abonnement-cabinet.js'), 'utf8');
const charger = () => { const w: Record<string, unknown> = {}; vm.runInNewContext(source, { window: w }); return w.SkanAbonnementCabinet as { etatEnClair: (a: unknown) => { titre: string; texte: string } }; };
const abonnement = (prochaine: Record<string, unknown>) => ({
  etat: { etat: 'a_facturer' }, regles: { prixHt: '60.000', gratuits: 3, plafondHt: null }, faveur: {},
  dossiers: [{ id: 'a', nom: 'Un', payant: false }, { id: 'b', nom: 'Deux', payant: false }, { id: 'c', nom: 'Trois', payant: false }, { id: 'd', nom: 'Quatre', payant: true }],
  prochaine: { debut: '2026-11-28', echeance: '2026-12-13', prixHt: '60.000', dossiers: 1, rattrapages: [], plafonne: false, ...prochaine },
});

describe('la facture qui se prépare, au Cabinet', () => {
  it('le montant nomme ce qu\'il compte : les dossiers payants, et le rattrapage de la période passée', () => {
    const A = charger();
    const net = (s: string) => s.replace(/\s+/g, ' ');
    expect(net(A.etatEnClair(abonnement({ totalHt: '60.000' })).texte)).toBe(net('Elle sera de 60 DT HT pour 1 dossier payant, à régler avant le 13/12/2026. Elle arrive ici, dans « Tes factures », et un e-mail te prévient.'));
    expect(net(A.etatEnClair(abonnement({ totalHt: '90.000', rattrapages: [{ du: '2026-05-28', au: '2026-11-27', jours: 183, sur: 365, montantHt: '30.000' }] })).texte))
      .toBe(net('Elle sera de 90 DT HT pour 1 dossier payant et 1 rattrapage de la période passée, à régler avant le 13/12/2026. Elle arrive ici, dans « Tes factures », et un e-mail te prévient.'));
  });
});
