// (1.387.30, issue 16, constat 19) Un bouton dit le GESTE qu'il fait : « Attestation reçue » se lisait comme un état déjà
// acquis, à côté d'une attestation qu'on attend encore. Il s'appelle « Marquer reçue », et la visite le nomme pareil.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const sansCommentaires = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('les attestations de retenue à recevoir (issue 16, constat 19)', () => {
  it('le bouton de la ligne dit le geste, et la visite le nomme du même mot', () => {
    const app = sansCommentaires('modules/socle/ecrans/entreprise/app-2.js');
    const bouton = app.match(/data-cert="\$\{d\.id\}">([^<]*)<\/button>/);
    expect(bouton && bouton[1]).toBe('Marquer reçue');
    expect(sansCommentaires('modules/socle/visites/visites.js')).toContain("b('[data-cert]', \"Note que l'attestation de retenue à la source est reçue.\", { nom: 'Marquer reçue'");
  });
});

describe('le départ d\'un salarié (issue 16, constat 12)', () => {
  it('le bouton qui défait la sortie dit ce qu\'il fait : « Annuler ce départ », plus « Il reste finalement »', () => {
    const paie = sansCommentaires('modules/personnel/ecrans/entreprise/paie.js');
    const bouton = paie.match(/id="fs-reste">\$\{lfIc\('retour', 14\)\} ([^<]*)<\/button>/);
    expect(bouton && bouton[1]).toBe('Annuler ce départ');
  });
});
