// (1.379.4, issue 5 CONSOLE-1) Une règle que le serveur connaît (REGLES_CONNUES) a son nom et sa valeur dans les textes de
// la console : il manquait ceux de la FODEC et du seuil de la retenue, et l'onglet « Règles fiscales » blanchissait
// toute la console (« texte inconnu du catalogue »). Et l'écran ne tombe plus pour un texte qui manque.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGLES_CONNUES } from '../../serveur/console/reglages.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const textes = fs.readFileSync(path.join(RACINE, 'web/console/src/textes.ts'), 'utf8');
const ecran = fs.readFileSync(path.join(RACINE, 'web/console/src/ecrans/Reglages.tsx'), 'utf8');

describe('le registre des règles de la console', () => {
  it('chaque règle connue du serveur a son nom et sa valeur dans les textes de la console', () => {
    const codes = Object.keys(REGLES_CONNUES);
    expect(codes).toEqual(expect.arrayContaining(['timbre.facture', 'retenue.seuil', 'fodec.taux']));
    const manquent = codes.flatMap((c) => ['nom', 'valeur'].map((s) => `console.ecran.reglages.r.${s}.${c.replace('.', '_')}`)).filter((k) => !textes.includes(`'${k}':`));
    expect(manquent).toEqual([]);
  });
  it('un texte qui manque montre le code de la règle au lieu de faire tomber l\'écran ; un taux ne se dit pas en dinars', () => {
    expect(ecran).toMatch(/const nomDeRegle = \(r: Regle\) => \(r\.valeurLue\.connue \? sansTomber\(/);
    expect(ecran).toMatch(/endsWith\('%'\) \? r\.valeurLue\.texte/);
    expect(ecran).not.toMatch(/valeur: montant\(r\.valeurLue\.texte\)/);
  });
});
