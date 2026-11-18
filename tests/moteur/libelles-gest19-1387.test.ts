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

describe('le nouveau mouvement de trésorerie quand la paie est tenue ici (issue 16, constat 16)', () => {
  it('« Salaires et charges » ne passe plus en tête, une phrase dit le double compte, l\'invite n\'est plus « Salaires de septembre »', () => {
    const app = sansCommentaires('modules/socle/ecrans/entreprise/app-2.js');
    const tri = app.match(/\.sort\(\(x, y\) => (paieIci \? \(x\[0\] === 'salaire'[^\n]*: 0)\)\n/);
    expect(tri).not.toBeNull();
    const corps = tri ? tri[1] : '';
    const KINDS = ['salaire', 'impot', 'banque', 'retrait', 'avances', 'emprunt', 'autre-sortie', 'apport', 'pret', 'autre-entree', 'virement'].map((k) => [k]);
    const comparer = (paieIci: boolean) => new Function('paieIci', `return (x, y) => ${corps};`)(paieIci);
    const ordre = (paieIci: boolean) => KINDS.slice().sort(comparer(paieIci)).map((k) => k[0]);
    expect(ordre(false)[0]).toBe('salaire');
    expect(ordre(true)[0]).toBe('impot');
    expect(ordre(true).slice(-2)).toEqual(['salaire', 'virement']);
    expect(app).toMatch(/id="mf-sal-paie" \$\{paieIci && m\.kind === 'salaire' \? '' : 'hidden'\}>Les salaires payés depuis la Paie sortent déjà de la banque/);
    expect(app).toContain("$('#mf-sal-paie', root).hidden = !(paieIci && kindSel.value === 'salaire');");
    expect(app).toContain("[kindSel.value] || 'Assurance du local';");
  });
});

describe('le bulletin à l\'écran, « depuis janvier » (issue 16, constat 22)', () => {
  it('le cumul de l\'année compte TOUS les bulletins, payés ou non : il s\'appelle « Net des bulletins », jamais « Net versé »', () => {
    const paie = sansCommentaires('modules/personnel/ecrans/entreprise/paie.js');
    const debut = paie.indexOf('function apercuBulletin(');
    const tranche = paie.slice(debut, paie.indexOf('\n  function ', debut + 30));
    expect(tranche.length).toBeGreaterThan(1000);
    expect(tranche).toContain("l('Net des bulletins', f(ytd.net))");
    expect(tranche).not.toContain("l('Net versé'");
  });
});
