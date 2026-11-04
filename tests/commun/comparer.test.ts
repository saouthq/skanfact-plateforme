// La comparaison des écrans et du moteur (docs/cadrage/17-rangement.md § 6 ; lot R0d, 04/11/2026) : les outils qui
// prouvent qu'un lot de rangement ne change rien. La photo du moteur (outils/rangement/moteur.ts) se prouve ici sur un
// petit moteur à part ; la comparaison des écrans (outils/rangement/ecrans.ts) par ce qu'elle dit d'une différence et
// par les pages qu'elle ouvre ; la comparaison elle-même tourne quand on la demande (tests/web/ecrans-comparer.test.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';
import { comparerLesMoteurs, photographierLeMoteur, SEUILS } from '../../outils/rangement/moteur.ts';
import { ecarts, pagesCabinet, pagesEntreprise, ROUTES_CABINET_NON_OUVERTES, ROUTES_NON_OUVERTES, type Capture } from '../../outils/rangement/ecrans.ts';
import { ecrirePng, lirePng, pixelsDifferents, SEUIL_PIXELS, type Image } from '../../outils/rangement/pixels.ts';

const COMPTA = 'module.exports = { taux: function (annee) { return annee >= 2026 ? 19 : 18; } };\n';
const CORE = [
  'const C = require(\'./compta\');',
  'module.exports = {',
  '  DEFAULT_COMPANY: { currency: \'DT\' },',
  '  total: function (data) { return data.documents.length * C.taux(2026); },',
  '  aujourdhui: function () { return new Date().toISOString(); },',
  '  hasard: function () { return Math.random(); },',
  '  ajoute: function (data) { data.documents.push({ id: \'n1\' }); return 1; },',
  '  compte: function (data) { return data.documents.map(function (d) { return d.id; }).join(); },',
  '  moisCourant: function () { return new Date().getUTCMonth(); },',
  '  duMois: function (month) { return \'mois \' + month; },',
  '};',
  '',
].join('\n');
const DEMO = 'module.exports = { buildDemoData: function (c, jour) { return { company: c, documents: [{ id: \'f1\', type: \'facture\' }], jour: jour }; } };\n';
const PETIT = { fonctions: 1, rendus: 1 };

function moteur(fichiers: Record<string, string> = {}) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'comparer-'));
  const ecrire = (f: string, t: string) => { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), t); };
  ecrire('modules/assemblage.json', JSON.stringify({ fichiers: {} }));
  for (const [f, t] of Object.entries({ 'web/public/v10/compta.js': COMPTA, 'web/public/v10/core.js': CORE, 'web/public/v10/demo.js': DEMO, ...fichiers })) ecrire(f, t);
  return r;
}
const capture = (x: Partial<Capture> = {}): Capture => ({ texte: 't', structure: 's', pixels: 'p', registres: 'r', ...x });

describe('la comparaison des écrans et du moteur', () => {
  it('la photo du moteur est la même d\'une fois sur l\'autre (la date figée, le hasard tiré d\'une graine), et voit ce qu\'une fonction rend ou écrit de différent', () => {
    const r = moteur();
    const a = photographierLeMoteur(r), b = photographierLeMoteur(r);
    expect(a.mesure).toEqual({ fonctions: 8, appels: 24, rendus: 24, erreurs: 0 });
    expect(comparerLesMoteurs(a, b, PETIT)).toEqual([]);
    // Un taux qui change : la fonction qui le rend, et celle qui s'en sert.
    const taux = photographierLeMoteur(moteur({ 'web/public/v10/compta.js': COMPTA.replace('? 19', '? 20') }));
    expect(comparerLesMoteurs(a, taux, PETIT)).toEqual(expect.arrayContaining(['compta.taux : l\'appel 1 ne rend plus la même chose', 'core.total : l\'appel 1 ne rend plus la même chose']));
    // Ce qu'une fonction écrit dans ce qu'on lui passe, même quand elle rend la même chose.
    const ecrit = photographierLeMoteur(moteur({ 'web/public/v10/core.js': CORE.replace('{ id: \'n1\' }', '{ id: \'n2\' }') }));
    expect(comparerLesMoteurs(a, ecrit, PETIT)).toEqual(['core.ajoute : l\'appel 1 ne rend plus la même chose', 'core.ajoute : l\'appel 2 ne rend plus la même chose', 'core.ajoute : l\'appel 3 ne rend plus la même chose']);
    // La date est figée au jour de la photo (le 15 juin : le mois 5), quel que soit le jour où elle est prise.
    const juin = photographierLeMoteur(moteur({ 'web/public/v10/core.js': CORE.replace('return new Date().getUTCMonth();', 'return 5;') }));
    expect(comparerLesMoteurs(a, juin, PETIT)).toEqual([]);
    // Chaque appel reçoit sa copie de ce qu'on lui passe : ce qu'une fonction écrit ne se voit pas chez la suivante.
    expect(a.fonctions['core.compte']).toEqual(photographierLeMoteur(moteur({ 'web/public/v10/core.js': CORE.replace('data.documents.push({ id: \'n1\' });', '') })).fonctions['core.compte']);
    // Un paramètre reçoit sa valeur par son nom : un mois pour `month`.
    expect(a.fonctions['core.duMois']).toHaveLength(3);
    expect(new Set(a.fonctions['core.duMois']).size).toBe(3);
  });

  it('une photo qui n\'atteint pas le moteur fait refuser la comparaison ; une fonction nouvelle ou disparue est dite', () => {
    const a = photographierLeMoteur(moteur());
    expect(comparerLesMoteurs(a, a).join('\n')).toMatch(new RegExp(`n'a pas atteint le moteur : 8 fonctions, 24 appels rendus \\(au moins ${SEUILS.fonctions} et ${SEUILS.rendus}\\)`));
    const moins = photographierLeMoteur(moteur({ 'web/public/v10/core.js': CORE.replace('  hasard: function () { return Math.random(); },\n', '') }));
    expect(comparerLesMoteurs(a, moins, PETIT)).toEqual(['core.hasard : disparue']);
    expect(comparerLesMoteurs(moins, a, PETIT)).toEqual(['core.hasard : nouvelle (le moteur rendu public a changé)']);
    expect(comparerLesMoteurs(a, { ...a, jour: '2026-06-16' }, PETIT)).toEqual(['Les deux photos ne sont pas prises au même jour (2026-06-15, 2026-06-16).']);
  });

  it('deux captures d\'une page qui diffèrent par le texte, la structure, les pixels ou les registres sont dites ; une page non atteinte, ou qui ne se pose pas, aussi', () => {
    const m = (apres: Capture | null) => ({ page: 'entreprise #/paie', largeur: 390, avant: capture(), apres, atteinte: !!apres });
    expect(ecarts(m(capture()))).toEqual([]);
    expect(ecarts(m(capture({ texte: 'x' })))).toEqual(['entreprise #/paie (390) : le texte change']);
    expect(ecarts(m(capture({ structure: 'x' })))).toEqual(['entreprise #/paie (390) : la structure change']);
    expect(ecarts(m(capture({ pixels: 'x' })))).toEqual(['entreprise #/paie (390) : les pixels change']);
    expect(ecarts(m(capture({ registres: 'x' })))).toEqual(['entreprise #/paie (390) : l\'ordre des registres change']);
    expect(ecarts(m(null))).toEqual(['entreprise #/paie (390) : la page n\'a pas été atteinte des deux côtés']);
    // Une page qui bouge encore (un aperçu qui se charge) : ses deux photos ne disent rien du lot, elle est dite.
    expect(ecarts(m(capture({ stable: false })))).toEqual(['entreprise #/paie (390) : la page ne se pose pas (elle change encore au bout de 9 s)']);
  });

  it('chaque route de l\'entreprise et du Cabinet est comparée, ou dite non ouverte avec sa raison', () => {
    const labels = /const PAGE_LABELS = \{([\s\S]*?)\n {2}\};/.exec(lireEcran('v10/app.js'))?.[1] ?? '';
    const routes = [...labels.matchAll(/(?:^|[\s,{])([a-z]+):\s*'/g)].map((x) => x[1] as string);
    expect(routes.length).toBeGreaterThan(35);
    const ids = Object.fromEntries(['facture', 'devis', 'client', 'fournisseur', 'achat', 'affaire', 'immo', 'article', 'salarie', 'contrat'].map((k) => [k, `${k}-1`]));
    const pe = pagesEntreprise(ids);
    const doc = { doc: 'facture', client: 'client', fournisseur: 'fournisseur', achat: 'achat', affaire: 'affaire', immo: 'immo', article: 'article', salarie: 'salarie', contrat: 'contrat' } as Record<string, string>;
    const manque = routes.filter((r) => !pe.some((p) => p === `#/${r}` || p.startsWith(`#/${r}/`)) && !ROUTES_NON_OUVERTES[r]);
    expect(manque, 'routes de PAGE_LABELS ni comparées ni dites non ouvertes').toEqual([]);
    for (const [route, cle] of Object.entries(doc)) expect(pe, route).toContain(`#/${route}/${cle}-1`);
    const cabinet = [...lireEcran('v10/cabinet/app.js').matchAll(/(?:if|else if) \(route === '([a-z]+)'\) (?:draw|location)/g)].map((x) => x[1] as string);
    expect(cabinet.length).toBeGreaterThan(9);
    const pc = pagesCabinet('d1');
    expect(cabinet.filter((r) => !pc.some((p) => p === `#/${r}` || p.startsWith(`#/${r}/`)) && !ROUTES_CABINET_NON_OUVERTES[r]), 'routes du Cabinet ni comparées ni dites non ouvertes').toEqual([]);
    // La page par défaut du Cabinet (la liste des dossiers) est comparée, et un dossier dans chacune de ses parties.
    expect(pc).toEqual(expect.arrayContaining(['#/dossiers', '#/dossier/d1', '#/dossier/d1/classeur', '#/dossier/d1/comptabilite/paie']));
  });
  it('deux photos qui ne diffèrent que par le lissage de quelques pixels sont les mêmes ; au-delà du seuil, ou d\'une autre taille, elles diffèrent', () => {
    // Une image d'essai sans motif (chaque octet tiré d'une graine), lue comme le navigateur l'écrit : chaque ligne a son filtre.
    let g = 7;
    const hasard = () => { g = (g * 16807) % 2147483647; return g % 256; };
    const im: Image = { largeur: 60, hauteur: 25, canaux: 3, donnees: Uint8Array.from({ length: 60 * 25 * 3 }, hasard) };
    expect(lirePng(ecrirePng(im))).toEqual(im);
    expect(lirePng(ecrirePng({ ...im, canaux: 4, donnees: Uint8Array.from({ length: 60 * 25 * 4 }, hasard) })).canaux).toBe(4);
    const touche = (n: number) => { const d = im.donnees.slice(); for (let i = 0; i < n; i++) { const k = (i * 37 % (60 * 25)) * 3 + 1; d[k] = (d[k] ?? 0) ^ 1; } return { ...im, donnees: d }; };
    expect(pixelsDifferents(im, touche(SEUIL_PIXELS))).toBe(SEUIL_PIXELS);
    // Écrites dans des fichiers, comme la comparaison les lit.
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'pixels-'));
    const ecrire = (nom: string, x: Image) => { const f = path.join(r, `${nom}.png`); fs.writeFileSync(f, ecrirePng(x)); return f; };
    const a = capture({ pixels: 'a', png: ecrire('a', im) });
    const m = (b: Capture) => ({ page: 'entreprise #/paie', largeur: 1440, avant: a, apres: b, atteinte: true });
    expect(ecarts(m(capture({ pixels: 'b', png: ecrire('lisse', touche(SEUIL_PIXELS)) })))).toEqual([]);
    expect(ecarts(m(capture({ pixels: 'c', png: ecrire('change', touche(SEUIL_PIXELS + 1)) })))).toEqual(['entreprise #/paie (1440) : les pixels change']);
    expect(ecarts(m(capture({ pixels: 'd', png: ecrire('plus-haute', { ...im, hauteur: 26, donnees: Uint8Array.from([...im.donnees, ...new Array<number>(60 * 3).fill(0)]) }) })))).toEqual(['entreprise #/paie (1440) : les pixels change']);
  });
});
