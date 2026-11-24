// Le rapport #22 (rôles ; 1.388.60) : la Trésorerie de la comptabilité interne et le mandat « déclarations » seul, vus de
// l'écran. Lu dans le code des écrans (ils ne s'exécutent qu'avec un navigateur) ; une preuve (tests/preuves.sh) retire chaque
// règle pour voir ce test tomber. Le refus du mandat lui-même se joue dans tests/cabinet/mandats.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const lire = (f: string) => fs.readFileSync(path.join(import.meta.dirname, '../..', f), 'utf8');
const entreprise = lire('modules/socle/ecrans/entreprise/app-1.js');
const cabinet = lire('modules/socle/ecrans/cabinet/app-1.js');

describe('le rapport #22', () => {
  // ROLE-3 : la comptabilité interne enregistre les mouvements ; la page ne lui dit pas « Lecture seule ».
  it('le bandeau de la Trésorerie juge les mouvements, et dit ce qui reste au propriétaire', () => {
    expect(entreprise).toMatch(/const PARTIE_DU_TRAVAIL = \{ tresorerie: 'movements' \};/);
    expect(entreprise).toMatch(/const p = PARTIE_DU_TRAVAIL\[name\] \|\| \(PARTIES_DES_PAGES\[name\] \|\| \[\]\)\[0\];/);
    expect(entreprise).toMatch(/!enLecture\(p\) && \(PARTIES_DES_PAGES\[name\] \|\| \[\]\)\.includes\('accounts'\) && enLecture\('accounts'\)/);
    expect(entreprise).toMatch(/Tu enregistres les mouvements, les virements et le rapprochement\. Créer ou modifier un compte \(la caisse, la banque\) reste à/);
  });

  // ROLE-2 : sans la comptabilité au mandat, « Réessayer » ne réussirait jamais ; la page dit quoi demander au client.
  it('au Cabinet, un dossier sans la comptabilité dit quoi demander, sans « Réessayer »', () => {
    const bloc = /if \(s\.data\.erreur && Array\.isArray\(dossier\.perimetre\) && !dossier\.perimetre\.includes\('comptabilite'\)\) \{[\s\S]{0,700}?return;\n {4}\}/.exec(cabinet)?.[0] ?? '';
    expect(bloc).toMatch(/ne t'a pas confié sa comptabilité/);
    expect(bloc).toMatch(/Demande-lui de cocher « La comptabilité » dans « Mon comptable »/);
    expect(bloc).not.toMatch(/Réessayer|lv-relire/);
  });
});
