// Les preuves qui suivent le code (docs/cadrage/17-rangement.md § 6 ; lot R0b, 03/11/2026). Sur un petit dépôt à part :
// un déplacement à l'identique écrit ses morceaux, fait suivre chaque preuve (réécrite à la ligne de son appel) et
// inscrit les écarts qu'il révèle ; au moindre refus, rien n'est écrit. Le contrôle éclair apprend les pièges du
// rangement, et le choix des preuves nouvelles suit les fichiers réassemblés.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemblerOctets, lireTable, RACINE_DU_DEPOT } from '../../commun/assemblage.ts';
import { deplacer, enTable, type Plan } from '../../outils/rangement/deplacer.ts';
import { comparer, ecrireConnus, lireConnus, mesurer } from '../../outils/rangement/frontieres.ts';
import { controlerLesPreuves, equivalente, etatDuDepot, lirePreuves, preuvesAChoisir, servisReassembles } from '../../outils/rangement/preuves.ts';

const APP = [
  '(function () {',
  '  \'use strict\';',
  '  const icones = {',
  '    maison: \'m\' };',
  '  function prixVente() { return 2; }',
  '  function salaire() { return prixVente() + 1; }',
  '  function payer() { return salaire(); }',
  '  window.demarrer = function () { return payer() + icones.maison; };',
  '})();',
  '',
].join('\n');
const PREUVES = [
  '#!/bin/bash',
  'M=base/migrations/0001_socle.sql',
  'APP=web/public/v10/app.js',
  'T=\'le test de l\'"\'"\'écran\'',
  'prouver \'le salaire sans la vente\' $APP \\',
  '  \'return prixVente() + 1;\' \'return 1;\' \\',
  '  "$T"',
  'prouver \'la vente à zéro\' web/public/v10/app.js \\',
  '  \'function prixVente() { return 2; }\' \'function prixVente() { return 0; }\' \\',
  '  "$T"',
  'for x in un deux; do',
  '  prouver "le paiement oublié ($x)" "$APP" \\',
  '    \'function payer() { return salaire(); }\' \'function payer() { return 0; }\' \\',
  '    "$T"',
  'done',
  'prouver \'deux fichiers\' \'web/public/v10/app.js|||web/public/v10/core.js\' \\',
  '  \'return payer() + icones.maison;|||var CORE = 1;\' \'return payer();|||var CORE = 2;\' \\',
  '  "$T"',
  'prouver \'le moteur\' web/public/v10/core.js \\',
  '  \'var CORE = 1;\' \'var CORE = 3;\' \\',
  '  "$T"',
];
const BILAN = ['echo; echo "$ok preuves faites, $ko non prouvées${PARTIE:+ (groupe $PARTIE)}."', '[ "$ko" -eq 0 ]', ''];
const DEBUT = 'modules/socle/ecrans/entreprise/debut.js', PAIE = 'modules/personnel/ecrans/entreprise/paie.js', FIN = 'modules/socle/ecrans/entreprise/fin.js';
const PLAN: Plan = { 'v10/app.js': [{ morceau: DEBUT, jusqua: 5 }, { morceau: PAIE, jusqua: 7 }, { morceau: FIN }] };

// Un petit dépôt : ses pages, ses fiches, son listeur de preuves (celui du vrai dépôt), ses preuves, deux tests.
function depot(o: { preuves?: string[]; fichiers?: Record<string, string> } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'preuves-suivent-'));
  const ecrire = (f: string, t: string) => { fs.mkdirSync(path.dirname(path.join(racine, f)), { recursive: true }); fs.writeFileSync(path.join(racine, f), t); };
  ecrire('modules/ordre.json', JSON.stringify({ ordre: ['socle', 'personnel'] }));
  for (const m of ['socle', 'personnel']) ecrire(`modules/${m}/module.json`, JSON.stringify({ code: m, dependances: [], porte: [], serveur: [] }));
  ecrire('modules/assemblage.json', JSON.stringify({ fichiers: {} }));
  ecrire('web/public/v10/index.html', '<script src="core.js"></script>\n<script src="app.js"></script>\n');
  ecrire('web/public/v10/app.js', APP);
  ecrire('web/public/v10/core.js', 'var CORE = 1;\n');
  ecrire('tests/lister-preuves.sh', fs.readFileSync(path.join(RACINE_DU_DEPOT, 'tests/lister-preuves.sh'), 'utf8'));
  ecrire('tests/preuves.sh', [...(o.preuves ?? PREUVES), ...BILAN].join('\n'));
  ecrire('tests/commun/outil.test.ts', 'it(\'le test de l\\\'outil\', () => {});\n');
  ecrire('tests/web/ecran.test.ts', 'it(\'le test de l\\\'écran\', () => {});\n');
  for (const [f, t] of Object.entries(o.fichiers ?? {})) ecrire(f, t);
  expect(ecrireConnus(racine).refus).toEqual([]);
  return racine;
}
const lire = (r: string, f: string) => fs.readFileSync(path.join(r, f), 'utf8');
// Tout le dépôt, pour vérifier qu'un refus n'a rien écrit.
function photo(r: string) {
  const t: Record<string, string> = {};
  const parcourir = (d: string) => {
    for (const e of fs.readdirSync(path.join(r, d), { withFileTypes: true })) {
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) parcourir(rel); else t[rel] = lire(r, rel);
    }
  };
  parcourir('');
  return t;
}

describe('les preuves qui suivent le code', () => {
  it('un déplacement à l\'identique : les morceaux, la table, le fichier servi inchangé à l\'octet, les écarts révélés inscrits', () => {
    const r = depot();
    const avant = lire(r, 'web/public/v10/app.js');
    const b = deplacer(PLAN, r);
    expect(b.refus).toEqual([]);
    expect(b.morceaux).toEqual([DEBUT, PAIE, FIN]);
    expect(lireTable(r)['v10/app.js']).toEqual([DEBUT, PAIE, FIN]);
    expect(lire(r, 'modules/assemblage.json')).toBe(`{\n  "fichiers": {\n    "v10/app.js": ["${DEBUT}", "${PAIE}", "${FIN}"]\n  }\n}\n`);
    // L'ancien fichier est retiré (il serait une copie morte) ; l'assemblé est celui d'avant.
    expect(fs.existsSync(path.join(r, 'web/public/v10/app.js'))).toBe(false);
    expect(assemblerOctets('v10/app.js', r).toString('utf8')).toBe(avant);
    expect(lire(r, PAIE)).toBe('  function salaire() { return prixVente() + 1; }\n  function payer() { return salaire(); }\n');
    // Le socle nomme maintenant la paie : l'écart est inscrit par le déplacement, et le contrôle est vert.
    expect(lireConnus(r)?.ecarts['F4 v10/app.js socle→personnel payer']).toBe(1);
    expect(b.ecartsInscrits).toBe(1);
    expect(comparer(mesurer(r), lireConnus(r))).toEqual([]);
    // La table s'écrit comme à la main, une ligne par fichier servi : la vraie table se relit à l'identique (une preuve
    // qui vise une autre ligne garde son motif).
    const vraie = fs.readFileSync(path.join(RACINE_DU_DEPOT, 'modules/assemblage.json'), 'utf8');
    const lue = JSON.parse(vraie) as Record<string, unknown> & { fichiers: Record<string, string[]> };
    expect(enTable(lue, lue.fichiers)).toBe(vraie);
  });

  it('chaque preuve suit son motif, réécrite à la ligne de son appel, et pose le même défaut qu\'avant', () => {
    const r = depot();
    const avant = etatDuDepot(r);
    for (const f of ['web/public/v10/app.js', 'web/public/v10/core.js']) avant.lire(f);
    expect(deplacer(PLAN, r).refus).toEqual([]);
    const vise = Object.fromEntries(lirePreuves(r).map((p) => [p.nom, p.fichier]));
    expect(vise).toEqual({
      'le salaire sans la vente': PAIE,
      'la vente à zéro': DEBUT,
      'le paiement oublié (un)': PAIE,
      'le paiement oublié (deux)': PAIE,
      'deux fichiers': `${FIN}|||web/public/v10/core.js`,
      'le moteur': 'web/public/v10/core.js',
    });
    // Réécrites à leur ligne : la variable devient le chemin du morceau ; la boucle aussi ; les autres lignes ne bougent pas.
    const lignes = lire(r, 'tests/preuves.sh').split('\n');
    expect(lignes[4]).toBe(`prouver 'le salaire sans la vente' ${PAIE} \\`);
    expect(lignes[11]).toBe(`  prouver "le paiement oublié ($x)" ${PAIE} \\`);
    expect(lignes[15]).toBe(`prouver 'deux fichiers' '${FIN}|||web/public/v10/core.js' \\`);
    expect(lignes[18]).toBe('prouver \'le moteur\' web/public/v10/core.js \\');
    // L'équivalence : la preuve suivie pose le même défaut ; pointée vers un autre morceau, elle ne le poserait pas.
    const apres = etatDuDepot(r);
    const preuve = lirePreuves(r).find((p) => p.nom === 'le salaire sans la vente');
    if (!preuve) throw new Error('preuve introuvable');
    const avantPreuve = { ...preuve, retouches: preuve.retouches.map((x) => ({ ...x, fichier: 'web/public/v10/app.js' })) };
    expect(equivalente({ preuve: avantPreuve, fichier: PAIE }, avant, apres)).toBe(true);
    expect(equivalente({ preuve: avantPreuve, fichier: DEBUT }, avant, apres)).toBe(false);
    // Un morceau qui ne serait plus tout à fait celui d'avant (un octet de plus ailleurs) : le défaut posé n'est plus le même.
    fs.appendFileSync(path.join(r, FIN), '// un octet de plus\n');
    expect(equivalente({ preuve: avantPreuve, fichier: PAIE }, avant, etatDuDepot(r))).toBe(false);
  });

  it('un motif coupé, une coupe au milieu d\'une instruction, une boucle partagée, un fichier hors de sa ligne : refusés, et rien n\'est écrit', () => {
    const essai = (o: Parameters<typeof depot>[0], plan: Plan = PLAN) => {
      const r = depot(o);
      const avant = photo(r);
      const b = deplacer(plan, r);
      expect(photo(r), 'un refus n\'écrit rien').toEqual(avant);
      return b.refus.join('\n');
    };
    expect(essai({ preuves: [...PREUVES, 'prouver \'à cheval\' $APP \\', '  \'return 2; }\n  function salaire()\' \'return 3; }\n  function salaire()\' \\', '  "$T"'] }))
      .toMatch(/« à cheval ».*ne se trouve plus dans aucun morceau de la famille entreprise : une coupe tombe au milieu/);
    expect(essai({}, { 'v10/app.js': [{ morceau: DEBUT, jusqua: 3 }, { morceau: FIN }] })).toMatch(/n'inscrit jamais « F0 v10\/app\.js coupe au milieu d'une instruction/);
    expect(essai({ preuves: [...PREUVES, 'for m in \'function prixVente() { return 2; }\' \'function payer() { return salaire(); }\'; do', '  prouver "boucle ($m)" $APP "$m" "$m " "$T"', 'done'] }))
      .toMatch(/les preuves d'une même boucle iraient dans .+ : sépare-les à la main/);
    expect(essai({ preuves: [...PREUVES, 'prouver \'sur deux lignes\' \\', '  web/public/v10/app.js \'function salaire()\' \'function salaire2()\' "$T"'] }))
      .toMatch(/le fichier de « sur deux lignes » n'est pas sur la ligne de son appel/);
    // Un contrôle des frontières qui n'est pas vert avant de commencer (ici, un écart listé qui n'existe plus).
    const rouge = depot();
    const connus = lireConnus(rouge);
    if (connus) fs.writeFileSync(path.join(rouge, 'modules/frontieres-connues.json'), JSON.stringify({ ...connus, ecarts: { ...connus.ecarts, 'F2 v10/app.js personnel→socle disparu': 1 } }));
    const avantRouge = photo(rouge);
    expect(deplacer(PLAN, rouge).refus.join('\n')).toMatch(/^Le contrôle des frontières doit être vert avant un déplacement/);
    expect(photo(rouge)).toEqual(avantRouge);
    // Le motif présent une seconde fois dans la famille (le pont) : on allonge le motif avant de déplacer.
    expect(essai({ fichiers: { 'web/public/plateforme/pont.js': 'function payer() { return salaire(); }\n' } })).toMatch(/« le paiement oublié \(un\) ».* se trouve 2 fois/);
  });

  it('le contrôle éclair apprend les pièges du rangement', () => {
    const r = depot({
      preuves: [...PREUVES,
        'prouver \'une copie dans le pont\' web/public/v10/app.js \\', '  \'function salaire() {\' \'function salaire2() {\' \\', '  "$T"',
        'prouver \'un morceau oublié\' modules/personnel/ecrans/oublie.js \\', '  \'oublie();\' \'\' \\', '  "$T"',
        'prouver \'l\'"\'"\'outil vu par un écran\' outils/rangement/outil.ts \\', '  \'vrai\' \'faux\' \\', '  "$T"',
        'prouver \'l\'"\'"\'outil vu par son test\' outils/rangement/outil.ts \\', '  \'vrai\' \'faux\' \\', '  \'le test de l\'"\'"\'outil\''],
      fichiers: { 'web/public/plateforme/pont.js': 'function salaire() { return 0; }\n', 'modules/personnel/ecrans/oublie.js': 'oublie();\n', 'outils/rangement/outil.ts': 'const x = vrai;\n' },
    });
    const fautes = controlerLesPreuves(lirePreuves(r), r).map((f) => `${f.genre} · ${f.nom} · ${f.detail}`);
    expect(fautes).toHaveLength(3);
    expect(fautes[0]).toMatch(/^MOTIF DANS LA FAMILLE · une copie dans le pont · « function salaire\(\) \{ » 2 fois dans la famille entreprise \(web\/public\/v10\/app\.js, web\/public\/plateforme\/pont\.js\)/);
    expect(fautes[1]).toMatch(/^MORCEAU HORS TABLE · un morceau oublié · modules\/personnel\/ecrans\/oublie\.js n'est dans aucun fichier servi/);
    expect(fautes[2]).toMatch(/^OUTIL ET TEST D'ÉCRAN · l'outil vu par un écran · .*tests\/web\/ecran\.test\.ts/);
    // Dans un morceau, la syntaxe se lit dans le fichier assemblé : le défaut qui la casse est dit, l'autre non.
    const d = depot({ preuves: [...PREUVES, 'prouver \'une parenthèse perdue\' $APP \\', '  \'return prixVente() + 1;\' \'return prixVente( + 1;\' \\', '  "$T"'] });
    expect(deplacer(PLAN, d).refus).toEqual([]);
    const casses = controlerLesPreuves(lirePreuves(d), d);
    expect(casses.map((f) => `${f.genre} · ${f.nom}`)).toEqual(['SYNTAXE CASSÉE · une parenthèse perdue']);
    expect(casses[0]?.detail).toMatch(/^v10\/app\.js \(assemblé\) : /);
  });

  it('un fichier servi dont la liste de morceaux change choisit toutes ses preuves ; les scripts des preuves s\'en servent', () => {
    expect(servisReassembles({}, { 'v10/app.js': [DEBUT, FIN] })).toEqual(['v10/app.js']);
    expect(servisReassembles({ 'v10/app.js': [DEBUT, FIN] }, { 'v10/app.js': [FIN, DEBUT] })).toEqual(['v10/app.js']);
    expect(servisReassembles({ 'v10/app.js': [DEBUT, FIN] }, { 'v10/app.js': [DEBUT, FIN] })).toEqual([]);
    const r = depot();
    const preuves = lirePreuves(r);
    // Au déplacement, les preuves de app.js (leur ancien fichier) ; après un changement d'ordre, celles des morceaux.
    expect(preuvesAChoisir(preuves, {}, PLAN_TABLE).sort()).toEqual(['deux fichiers', 'la vente à zéro', 'le paiement oublié (deux)', 'le paiement oublié (un)', 'le salaire sans la vente']);
    expect(deplacer(PLAN, r).refus).toEqual([]);
    expect(preuvesAChoisir(lirePreuves(r), PLAN_TABLE, { 'v10/app.js': [DEBUT, FIN, PAIE] })).toHaveLength(5);
    expect(preuvesAChoisir(lirePreuves(r), PLAN_TABLE, PLAN_TABLE)).toEqual([]);
    // Le contrôle éclair et le choix des preuves nouvelles appellent l'outil (le code, pas un commentaire).
    const code = (f: string) => fs.readFileSync(path.join(RACINE_DU_DEPOT, f), 'utf8').replace(/^\s*#.*$/gm, '');
    expect(code('tests/verif-preuves.sh')).toContain('node outils/rangement/preuves.ts --controler "$liste"');
    expect(code('tests/preuves-nouvelles.sh')).toContain('node outils/rangement/preuves.ts --choisir "$tmp/table-base.json" "$tmp/ici.lst"');
  });

  it('sur le vrai fichier, la ligne de chaque preuve est celle de son appel', () => {
    const lignes = fs.readFileSync(path.join(RACINE_DU_DEPOT, 'tests/preuves.sh'), 'utf8').split('\n');
    const preuves = lirePreuves();
    expect(preuves.length).toBeGreaterThan(6000);
    expect(preuves.filter((p) => !/^\s*prouver\b/.test(lignes[p.ligne - 1] ?? '')).map((p) => `${p.ligne} ${p.nom}`)).toEqual([]);
  });
});

const PLAN_TABLE = { 'v10/app.js': [DEBUT, PAIE, FIN] };
