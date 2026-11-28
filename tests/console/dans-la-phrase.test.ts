// Un motif repris après deux-points perd sa majuscule (1.389.6, CONS3-6 ; web/console/src/motif.ts). La fiche d'un
// cabinet disait « … ne s'est pas faite seule : La facture … », deux textes collés ; un sigle garde ses capitales.
import { describe, expect, it } from 'vitest';
import { dansLaPhrase } from '../../web/console/src/motif.ts';

describe('un motif dans la phrase', () => {
  it('perd sa majuscule de début de phrase, garde un sigle et un nom propre en capitales', () => {
    expect(dansLaPhrase('La fiche de l\'entreprise SkanFact n\'a pas de RIB.')).toBe('la fiche de l\'entreprise SkanFact n\'a pas de RIB.');
    expect(dansLaPhrase('Échéance passée.')).toBe('échéance passée.');
    expect(dansLaPhrase('RIB manquant.')).toBe('RIB manquant.');
    expect(dansLaPhrase('déjà en minuscule.')).toBe('déjà en minuscule.');
  });
});
