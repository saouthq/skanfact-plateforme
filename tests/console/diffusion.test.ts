// La communication ciblée, pure (serveur/console/diffusion.ts ; base 0139 ; docs/console.md C63) : les publics d'une
// entreprise lus dans l'état de son abonnement (un abonné Complet en retard est des deux), si un message les vise, ce que
// chaque public atteint, et ce que la base dit de la diffusion, lu prudemment.

import { describe, expect, it } from 'vitest';
import type { Etat } from '../../serveur/abonnement/etat.ts';
import { lireCible, lireDiffusions, portee, publicsDe, vise } from '../../serveur/console/diffusion.ts';

const essai: Etat = { etat: 'essai', jusquAu: '2026-11-01', jours: 16 };
const actif: Etat = { etat: 'actif', offre: 'complet', periodicite: 'annuel', jusquAu: '2027-01-01', jours: 77, resilie: false };
const retard: Etat = { etat: 'en_retard', echeance: '2026-10-10', lectureSeuleLe: '2026-10-24', jours: 6, apresEssai: false };
const ferme: Etat = { etat: 'lecture_seule', depuis: '2026-09-01', raison: 'essai_termine' };
const exemple: Etat = { etat: 'hors', raison: 'bac_a_sable' };
const tenu: Etat = { etat: 'hors', raison: 'tenu_par_cabinet' };

describe('les publics d\'un message (0139, C63)', () => {
  it('chaque public qui décrit l\'entreprise : en essai, son offre quand elle est abonnée, en retard (avec son offre), en lecture seule ; hors abonnement, aucun', () => {
    expect(publicsDe(essai, null)).toEqual(['essai']);
    expect(publicsDe(actif, 'complet')).toEqual(['complet']);
    expect(publicsDe(retard, 'essentiel')).toEqual(['essentiel', 'en_retard']);
    expect(publicsDe(ferme, 'essentiel')).toEqual(['lecture_seule']);
    expect(publicsDe(tenu, null)).toEqual([]);
    expect(publicsDe(null, 'complet')).toEqual([]);
  });

  it('sans public, il vise tout le monde ; avec, ceux qui en sont, et eux seuls', () => {
    expect(vise([], [])).toBe(true);
    expect(vise(['en_retard'], ['essentiel', 'en_retard'])).toBe(true);
    expect(vise(['complet'], ['essentiel', 'en_retard'])).toBe(false);
    expect(vise(['essai'], [])).toBe(false);
  });

  it('ce que chaque public atteint : la même fonction ; « tous » compte chaque entreprise sauf celles d\'exemple', () => {
    const e = (etat: Etat, offre: string | null = null) => ({ etat, faits: { offre } });
    expect(portee([e(essai), e(actif, 'complet'), e(retard, 'complet'), e(ferme, 'essentiel'), e(exemple), e(tenu)]))
      .toEqual({ tous: 5, essai: 1, essentiel: 0, complet: 2, en_retard: 1, lecture_seule: 1 });
  });

  it('ce que la base rend se lit prudemment : un public inconnu ne se devine pas, une ligne illisible n\'existe pas', () => {
    expect(lireCible(['essai', 'vip', 'complet'])).toEqual(['essai', 'complet']);
    expect(lireCible('essai')).toEqual([]);
    expect(lireDiffusions([
      { id: 'a', cible: ['essai'], vus: 3, caches: 1 },
      { id: 'b', cible: [], vus: 1, caches: 2 },
      { id: 'c', cible: [], vus: -1, caches: 0 },
      { id: 'd', cible: 'tous', vus: 1, caches: 0 },
      null,
    ])).toEqual([{ id: 'a', cible: ['essai'], vus: 3, caches: 1 }]);
    expect(lireDiffusions('rien')).toEqual([]);
  });
});
