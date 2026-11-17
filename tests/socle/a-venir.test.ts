// (1.379.3) Ce qui est « à venir » se lit dans un réglage du serveur : absent, la caisse et la facture électronique.
import { describe, expect, it } from 'vitest';
import { aVenir, enBeta } from '../../serveur/a-venir.ts';

describe('ce qui est « à venir » (serveur/a-venir.ts)', () => {
  it('absent : la caisse et la facture électronique ; vide : rien ; une liste : ce qu\'elle nomme, sans mot inconnu', () => {
    expect(aVenir({})).toEqual(['caisse', 'efacture']);
    expect(aVenir({ SKANFACT_A_VENIR: '' })).toEqual([]);
    expect(aVenir({ SKANFACT_A_VENIR: ' efacture , paie ,' })).toEqual(['efacture']);
  });
  it('en bêta (1.381.0) : absent, la paie ; vide : rien ; un mot inconnu ne passe pas', () => {
    expect(enBeta({})).toEqual(['paie']);
    expect(enBeta({ SKANFACT_BETA: '' })).toEqual([]);
    expect(enBeta({ SKANFACT_BETA: 'caisse, paie' })).toEqual(['paie']);
  });
});
