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
