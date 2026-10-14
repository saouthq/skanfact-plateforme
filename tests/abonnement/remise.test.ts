// La remise d'une période (serveur/abonnement/remise.ts ; 0106) : lue prudemment, et comptée au millime comme la base la
// rejoue (plateforme.montant_remise) et comme la pièce de la v10 la calcule (sa remise globale) — « deux chemins, un
// chiffre », sur des montants qui discriminent l'arrondi (une moitié de millime, un millime seul).

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { versTexte } from '../../moteur/argent.ts';
import { ceQueDiraLaFacture, netHt, pieceDAbonnement } from '../../serveur/abonnement/factures.ts';
import { lireRemise, montantRemise, type Remise } from '../../serveur/abonnement/remise.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
beforeAll(async () => { await admin.connect(); });
afterAll(async () => { await admin.end(); });

describe('la remise lue', () => {
  it('une remise illisible ne s\'applique pas ; l\'autre, qui ne s\'ajoute pas, se lit à côté', () => {
    expect(lireRemise(null)).toBeNull();
    expect(lireRemise({ nature: 'parrainage', taux: 20 })).toBeNull();
    expect(lireRemise({ nature: 'groupe', taux: 0 })).toBeNull();
    expect(lireRemise({ nature: 'groupe', taux: 91 })).toBeNull();
    expect(lireRemise({ nature: 'groupe', taux: 12.5 })).toBeNull();
    expect(lireRemise({ nature: 'groupe', taux: 20, groupe: 'Famille', premiere: 'Épicerie' }))
      .toEqual({ nature: 'groupe', taux: 20, groupe: 'Famille', premiere: 'Épicerie', cabinet: null, jusquAu: null, aussi: null });
    expect(lireRemise({ nature: 'cabinet', taux: 25, cabinet: 'Cabinet', jusquAu: '2027-02-28', aussi: { nature: 'groupe', taux: 20, groupe: 'Famille' } }))
      .toEqual({ nature: 'cabinet', taux: 25, groupe: null, premiere: null, cabinet: 'Cabinet', jusquAu: '2027-02-28',
        aussi: { nature: 'groupe', taux: 20, groupe: 'Famille', premiere: null, cabinet: null, jusquAu: null } });
    expect(lireRemise({ nature: 'cabinet', taux: 20, jusquAu: 'demain' })?.jusquAu).toBeNull();
  });
});

describe('deux chemins, un chiffre : le montant de la remise', () => {
  // Hors taxes en millimes, taux en pourcent : une moitié de millime (33 350 × 17 % = 5 669,5), un reste ordinaire, un
  // millime seul, le prix rond d'une offre.
  const cas: [bigint, number][] = [[33350n, 17], [33335n, 17], [1n, 50], [12345n, 33], [690000n, 20], [999999n, 90], [2085n, 10]];
  it('le serveur, la base et la pièce de la v10 retirent le même millime', async () => {
    for (const [base, taux] of cas) {
      const serveur = montantRemise(base, taux);
      const sql = BigInt((await admin.query('select plateforme.montant_remise($1, $2)::text m', [String(base), taux])).rows[0].m);
      expect(sql, `${base} × ${taux} %`).toBe(serveur);
      const remise: Remise = { nature: 'groupe', taux, groupe: 'Famille', premiere: null, cabinet: null, jusquAu: null, aussi: null };
      const piece = pieceDAbonnement({ cle: 'abonnement-essai', client: { id: 'c', name: 'Client' }, offre: 'complet', periodicite: 'annuel',
        debut: '2026-11-01', fin: '2027-10-31', echeance: '2026-10-31', jour: '2026-10-14', prixHt: base, societe: {}, remise });
      expect(ceQueDiraLaFacture(piece, {}).ht, `${base} × ${taux} %`).toBe(versTexte(netHt(base, remise), 3));
    }
    // L'arrondi est au millime le plus proche, la moitié vers le haut : 5 669,5 → 5 670.
    expect(montantRemise(33350n, 17)).toBe(5670n);
    expect(montantRemise(1n, 50)).toBe(1n);
    expect(montantRemise(1n, 49)).toBe(0n);
  });
});
