// 1.388.66 (#28) — la robustesse : la garde d'« Enregistrer et valider » survit au redessin, une date absurde se dit avant
// d'émettre, une remise reste entre 0 et 100 % (écran et serveur), un jour qui n'existe pas se nomme, et la recherche
// d'une grosse liste attend que la frappe se pose.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const racine = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(racine, f), 'utf8');
// Le CODE seul : un commentaire qui cite la règle ne doit pas la satisfaire.
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n');
const CAB2 = code(lire('modules/socle/ecrans/cabinet/app-2.js'));
const APP1 = code(lire('modules/socle/ecrans/entreprise/app-1.js'));
const DOSSIER = code(lire('serveur/v10/dossier.ts'));

describe('ROB-6 : la garde d\'enregistrement vit hors de la grille', () => {
  it('aucune garde locale que le redessin remettrait à zéro', () => {
    expect(CAB2).not.toMatch(/let enregistrement = false;/);
    expect(CAB2).toMatch(/if \(saisieState\.enregistrement === dossier\.id\) return;/);
  });
  it('une grille redessinée pendant l\'attente naît avec ses boutons éteints', () => {
    expect(CAB2).toMatch(/if \(saisieState\.enregistrement === dossier\.id\) \[ok, okv\]\.filter\(Boolean\)\.forEach\(b => \{ b\.disabled = true;/);
  });
});

describe('ROB-7 : une date absurde se dit avant d\'émettre', () => {
  const i = APP1.indexOf('function issueWarnings() {');
  const zone = APP1.slice(i, i + 1600);
  it('plus d\'un an dans l\'avenir, ou plus de dix ans en arrière', () => {
    expect(zone).toMatch(/ecartJ > 366/);
    expect(zone).toMatch(/- 10\) w\.push\(/);
  });
});

describe('ROB-8 : une remise entre 0 et 100 %', () => {
  it('l\'écran borne ce qu\'il range', () => {
    expect(APP1).toMatch(/const borne = Math\.min\(100, Math\.max\(0, lu\)\);/);
    expect(APP1).toMatch(/champ\.value = String\(borne\);/);
  });
  it('le serveur refuse au-delà, avant le numéro', () => {
    const i = DOSSIER.indexOf("throw new Refus('v10.remise_hors_bornes')");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(DOSSIER.indexOf("throw new Refus('ventes.deja_emise')"));
    expect(lire('serveur/v10/textes.ts')).toContain("'v10.remise_hors_bornes':");
    expect(DOSSIER).toMatch(/if \(!\(tauxR >= 0 && tauxR <= 100\)\) throw new Refus\('v10\.remise_hors_bornes'\)/);
  });
});

describe('ROB-11 : un jour qui n\'existe pas se nomme', () => {
  const i = APP1.indexOf('function jourInexistant(v) {');
  const fin = APP1.indexOf('\n  }\n', i) + 4;
  const corps = APP1.slice(i, fin);
  const jouer = (v: string) => vm.runInNewContext(`${corps}; jourInexistant(${JSON.stringify(v)})`,
    { C: { MONTHS_FR: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'] } }) as string;
  it('le 30 février se dit, avec le dernier jour du mois', () => {
    expect(jouer('30/02/2026')).toBe('Le 30 n\'existe pas en février 2026 : le mois s\'arrête au 28.');
    expect(jouer('29/02/2028')).toBe('');
    expect(jouer('31/04/2026')).toContain('s\'arrête au 30');
  });
  it('un mois 13 se dit, une date juste ne dit rien, une forme inconnue laisse la phrase générale', () => {
    expect(jouer('12/13/2026')).toContain('Le mois 13 n\'existe pas');
    expect(jouer('12/03/2026')).toBe('');
    expect(jouer('demain')).toBe('');
  });
  it('le refus de la case l\'utilise', () => {
    expect(APP1).toMatch(/toast\(jourInexistant\(txt\.value\) \|\| 'Date incomprise/);
  });
});

describe('ROB-10 : la recherche d\'une grosse liste attend la frappe', () => {
  it('aucune liste ne redessine à chaque lettre sans passer par apresFrappe', () => {
    expect(APP1).not.toMatch(/\$\('#q'\)\.oninput = e => \{ s\.q = e\.target\.value;[^}]*\bdraw\(\); \};/);
    expect((APP1.match(/apresFrappe\(draw\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it('en dessous de 500 pièces, rien ne change', () => {
    expect(APP1).toMatch(/<= 500\) return f\(\);/);
  });
});

describe('ROB-1, 4, 5, 9, 12', () => {
  const PONT = code(lire('web/public/plateforme/pont.js'));
  it('ROB-1 : la ligne « Au kilomètre » et la fiche « Face à la pièce » allument la garde de fermeture', () => {
    expect(CAB2).toMatch(/const saisiesGardees = \(\) => !!brouillonE && !saisieSxEnCours\(\)/);
    expect(CAB2).toMatch(/if \(saisieSxEnCours\(\)\) ids\.push\(sxState\.dossier\);/);
    expect(CAB2).toMatch(/f\.touchee = true; signalerSaisies\(\);/);
    expect(CAB2).toMatch(/majJm\(\); signalerSaisies\(\);/);
  });
  it('ROB-4 : le client du serveur se crée ou se met à jour en une seule écriture', () => {
    expect(DOSSIER).toMatch(/\.onConflict\(\(oc\) => oc\.columns\(\['entreprise', 'ref_v10'\]\)\.where\('ref_v10', 'is not', null\)/);
    expect(DOSSIER).not.toMatch(/const deja = await db\.selectFrom\('socle\.tiers'\)/);
  });
  it('ROB-5 : sans réseau, « Émettre » refuse avant le récapitulatif', () => {
    const i = APP1.indexOf("navigator.onLine === false) { refus('#issue'");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(APP1.indexOf('await confirmerEmission(doc, n, warn'));
  });
  it('ROB-9 : une fenêtre où l\'on a tapé allume la question du navigateur', () => {
    expect(APP1).toMatch(/\|\| \[\.\.\.fenetresGardees\.values\(\)\]\.some\(g => g\(\)\)/);
    expect(APP1).toMatch(/if \(fenetresGardees\.delete\(layer\)\) reportDirty\(\);/);
  });
  it('ROB-12 : un fichier vide, une image ou un PDF se disent à l\'import', () => {
    expect(PONT).toMatch(/if \(!f\.size \|\| \(o0 === 0x89 && o1 === 0x50\)/);
  });
});
