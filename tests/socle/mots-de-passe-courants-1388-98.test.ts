// (1.388.98) Le serveur refuse par défaut les mots de passe les plus répandus : la liste du dépôt (serveur/donnees, tirée de
// la liste du NCSC publiée par SecLists) en porte des milliers, et une production sans SKANFACT_LISTE_VOLEE s'en sert.
// Avant, le défaut était la liste des tests, quatre empreintes : « 1234567890 » passait.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireConfiguration } from '../../serveur/principal.ts';
import { listeDepuisFichier, verifierPolitique } from '../../serveur/mot-de-passe.ts';

const ici = path.dirname(new URL(import.meta.url).pathname);

describe('(1.388.98) les mots de passe les plus répandus sont refusés par défaut', () => {
  it('la configuration lit la liste du dépôt, qui refuse « 1234567890 » et laisse passer une phrase', () => {
    const coffre = Buffer.alloc(32, 7).toString('base64');
    const c = lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'production', SKANFACT_COFFRE: coffre, SKANFACT_PROXY: '1',
      SKANFACT_SMTP: 'smtps://u:p@relais.exemple.tn:465', SKANFACT_COURRIEL_DE: 'ne-pas-repondre@exemple.tn' });
    expect(path.resolve(c.listeVolee)).toBe(path.resolve(ici, '../../serveur/donnees/mots-de-passe-courants.txt'));
    const liste = listeDepuisFichier(c.listeVolee);
    for (const commun of ['1234567890', 'qwertyuiop', 'password123', '123456789a']) {
      expect(verifierPolitique(commun, liste), commun).toMatchObject({ ok: false });
    }
    expect(verifierPolitique('le figuier de la cour fleurit en mars', liste)).toEqual({ ok: true });
    // Une autre liste se désigne encore.
    expect(lireConfiguration({ SKANFACT_BASE: 'postgres://x', SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_LISTE_VOLEE: '/ailleurs/liste.txt' }).listeVolee).toBe('/ailleurs/liste.txt');
  });
});
