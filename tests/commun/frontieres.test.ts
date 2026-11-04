// Le contrôle des frontières (docs/cadrage/17-rangement.md § 4.2 ; lot R0c, 03/11/2026). Chaque code se prouve sur un
// petit dépôt à part (ses pages, ses morceaux, ses fiches) ; le vrai dépôt tient sa liste des écarts connus (le cliquet),
// et la mesure dit ce qu'elle a atteint (un instrument qui n'atteint pas l'écran annoncerait « tout va bien »).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import { describe, expect, it } from 'vitest';
import { RACINE_DU_DEPOT } from '../../commun/assemblage.ts';
import { comparer, CONNUS, controleDesFrontieres, ecrireConnus, FrontiereRefusee, lireConnus, mesurer, scriptsDeLaPage } from '../../outils/rangement/frontieres.ts';
import { scriptSansCommentaires } from '../../web/alleger.ts';
import config from '../../web/vite.config.ts';

type FicheEssai = { dependances?: string[]; porte?: string[]; serveur?: string[] };
// Un petit dépôt : l'ordre, les fiches, la table d'assemblage, la page de l'entreprise et ses fichiers.
function depot(o: { fichiers: Record<string, string>; table?: Record<string, string[]>; fiches?: Record<string, FicheEssai>; page?: string[] }) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'frontieres-'));
  const ecrire = (f: string, t: string) => { fs.mkdirSync(path.dirname(path.join(racine, f)), { recursive: true }); fs.writeFileSync(path.join(racine, f), t); };
  const ordre = ['socle', 'ventes', 'personnel'];
  ecrire('modules/ordre.json', JSON.stringify({ ordre }));
  for (const m of ordre) ecrire(`modules/${m}/module.json`, JSON.stringify({ code: m, dependances: [], porte: [], serveur: [], ...o.fiches?.[m] }));
  ecrire('modules/assemblage.json', JSON.stringify({ fichiers: o.table ?? {} }));
  ecrire('web/public/v10/index.html', `<!doctype html><body>\n${(o.page ?? ['app.js']).map((s) => `<script src="${s}?v=1"></script>`).join('\n')}\n</body>`);
  for (const [f, t] of Object.entries(o.fichiers)) ecrire(f, t);
  return racine;
}
const ecarts = (r: string, code: string) => Object.fromEntries(Object.entries(mesurer(r).comptes).filter(([k]) => k.startsWith(`${code} `)));

// Une seule fermeture (comme app.js) coupée en quatre morceaux de trois modules : les noms traversent les coupes.
const DEBUT = 'modules/socle/ecrans/debut.js', VENTES = 'modules/ventes/ecrans/ventes.js', PAIE = 'modules/personnel/ecrans/paie.js', FIN = 'modules/socle/ecrans/fin.js';
const FERMETURE = {
  [DEBUT]: '(function () {\n  \'use strict\';\n  const icones = { maison: \'m\' };\n',
  [VENTES]: '  function prixVente() { return 2; }\n  let totalVentes = 0;\n  function lirePaie() { return salaire(); }\n',
  [PAIE]: '  function salaire() { return prixVente() + totalVentes; }\n  function payer() { totalVentes = 5; icones.paie = \'p\'; }\n',
  [FIN]: '  window.demarrer = function () { return salaire() + lirePaie() + payer() + icones.maison; };\n})();\n',
};
const TABLE = { 'v10/app.js': [DEBUT, VENTES, PAIE, FIN] };
const FICHES = { personnel: { dependances: ['ventes'] } };

describe('le contrôle des frontières', () => {
  it('le dépôt tient ses frontières : la mesure atteint chaque page, et la liste des écarts connus est à jour', () => {
    // Les scripts de chaque page, dans l'ordre où elle les charge.
    const entreprise = scriptsDeLaPage('v10/index.html');
    expect(entreprise.at(-1)).toBe('v10/app.js');
    expect(entreprise.indexOf('v10/compta.js')).toBeLessThan(entreprise.indexOf('v10/core.js'));
    expect(scriptsDeLaPage('v10/cabinet/index.html')).toContain('v10/cabinet/app.js');
    const m = mesurer();
    for (const page of ['entreprise', 'cabinet']) {
      expect(m.atteint[page]?.scripts, page).toBeGreaterThan(20);
      expect(m.atteint[page]?.lectures, page).toBeGreaterThan(100_000);
      expect(m.atteint[page]?.auChargement, page).toBeGreaterThan(100);
    }
    // Les lignes hors de modules/ (F12) : celles des ponts, encore à leur place ; plus aucune d'app.js depuis le lot A1.
    expect(m.lignes['plateforme/pont.js']).toBeGreaterThan(3_000);
    expect(m.lignes['v10/app.js']).toBe(0);
    expect(Object.keys(m.comptes).filter((k) => k.startsWith('F13 ')).length, 'le serveur est mesuré').toBeGreaterThan(20);
    expect(comparer(m, lireConnus())).toEqual([]);
  });

  it('F2, F3, F4, F7 : un nom lu ou écrit d\'un module à l\'autre, dans la même fermeture, est rendu au morceau qui le définit', () => {
    const r = depot({ fichiers: FERMETURE, table: TABLE, fiches: FICHES });
    expect(ecarts(r, 'F2')).toEqual({ 'F2 v10/app.js personnel→ventes prixVente': 1, 'F2 v10/app.js personnel→ventes totalVentes': 1, 'F2 v10/app.js ventes→personnel salaire': 1 });
    // La paie dépend des ventes (déclaré, vers le haut) ; les ventes lisent la paie : vers le bas.
    expect(ecarts(r, 'F3')).toEqual({ 'F3 v10/app.js ventes→personnel salaire': 1 });
    expect(ecarts(r, 'F4')).toEqual({ 'F4 v10/app.js socle→personnel payer': 1, 'F4 v10/app.js socle→personnel salaire': 1, 'F4 v10/app.js socle→ventes lirePaie': 1 });
    // Écrire la variable d'un autre, ou une entrée de la table d'icônes du socle.
    expect(ecarts(r, 'F7')).toEqual({ 'F7 v10/app.js personnel→socle icones': 1, 'F7 v10/app.js personnel→ventes totalVentes': 1 });
    expect(ecarts(r, 'F1')).toEqual({});
    // Un nom de la porte se lit sans écart ; une dépendance non déclarée en fait un.
    const porte = depot({ fichiers: FERMETURE, table: TABLE, fiches: { ...FICHES, ventes: { porte: ['prixVente'] } } });
    expect(Object.keys(ecarts(porte, 'F2'))).toEqual(['F2 v10/app.js personnel→ventes totalVentes', 'F2 v10/app.js ventes→personnel salaire']);
    // Une dépendance vers le bas reste un écart, même déclarée.
    const versLeBas = depot({ fichiers: FERMETURE, table: TABLE, fiches: { ...FICHES, ventes: { dependances: ['personnel'] } } });
    expect(ecarts(versLeBas, 'F3')).toEqual({ 'F3 v10/app.js ventes→personnel salaire': 1 });
    const sansDependance = depot({ fichiers: FERMETURE, table: TABLE });
    expect(ecarts(sansDependance, 'F3')).toEqual({ 'F3 v10/app.js personnel→ventes prixVente': 1, 'F3 v10/app.js personnel→ventes totalVentes': 1, 'F3 v10/app.js ventes→personnel salaire': 1 });
  });

  it('F0, F1, F8 : une coupe au milieu d\'une instruction, un morceau non déclaré, un nom introuvable, un nom défini deux fois', () => {
    const r = depot({
      fichiers: {
        'modules/socle/ecrans/a.js': 'console.log(\n', 'modules/ventes/ecrans/b.js': '  1);\nfunction aide() {}\n',
        'modules/ventes/ecrans/oublie.js': 'oublie();\n',
        'modules/socle/moteur/c1.js': 'var T = {\n  a: 1,\n', 'modules/ventes/moteur/c2.js': '  b: 2,\n};\n',
        'modules/socle/aide/g1.js': 'var GUIDE = {\n  a: 1,\n', 'modules/ventes/aide/g2.js': '  b: 2,\n};\n',
        'modules/socle/styles/a.css': 'a {\n', 'modules/personnel/styles/b.css': '  color: red; }\n',
        'web/public/v10/outil.js': 'function aide() {}\ninconnuDuTout();\nif (typeof peutEtre !== \'undefined\') peutEtre();\n',
      },
      table: {
        'v10/app.js': ['modules/socle/ecrans/a.js', 'modules/ventes/ecrans/b.js'],
        'v10/core.js': ['modules/socle/moteur/c1.js', 'modules/ventes/moteur/c2.js'],
        'v10/guide.js': ['modules/socle/aide/g1.js', 'modules/ventes/aide/g2.js'],
        'plateforme/paie.css': ['modules/socle/styles/a.css', 'modules/personnel/styles/b.css'],
      },
      page: ['outil.js', 'app.js'],
    });
    // L'aide se coupe entre deux entrées ; le code, entre deux instructions seulement.
    expect(ecarts(r, 'F0')).toEqual({
      'F0 morceau non déclaré modules/ventes/ecrans/oublie.js': 1,
      'F0 plateforme/paie.css coupe au milieu d\'une règle avant modules/personnel/styles/b.css': 1,
      'F0 v10/app.js coupe au milieu d\'une instruction avant modules/ventes/ecrans/b.js': 1,
      'F0 v10/core.js coupe au milieu d\'une instruction avant modules/ventes/moteur/c2.js': 1,
    });
    // Un nom gardé derrière `typeof` n'est pas introuvable.
    expect(ecarts(r, 'F1')).toEqual({ 'F1 entreprise v10/outil.js inconnuDuTout': 1 });
    expect(ecarts(r, 'F8')).toEqual({ 'F8 entreprise aide': 2 });
  });

  it('F9 : un nom lu à l\'ouverture de la page avant sa définition, directement ou par une fonction appelée au chargement', () => {
    const r = depot({
      fichiers: {
        'web/public/v10/premier.js': [
          'lireTot();',
          'console.log(PLUS_LOIN);',
          'var vu = typeof depuisLeSecond;',
          'function lireTot() { const local = CONFIG.x; return local; }',
          'const CONFIG = { x: 1 };',
          'const PLUS_LOIN = 2;',
          'document.addEventListener(\'click\', function () { return depuisLeSecond(); });',
          '[1].forEach(function () { return depuisLeSecond(); });',
          'lireApres();',
          'function lireApres() { return CONFIG.x + PLUS_LOIN + vu; }',
          '(function () { enDedans(); function enDedans() { return DEDANS_PLUS_LOIN; } const DEDANS_PLUS_LOIN = 3; enDedans(); })();',
          'function jamaisAppelee() { return PAS_ENCORE; }',
          'const PAS_ENCORE = 4;',
          '',
        ].join('\n'),
        'web/public/v10/second.js': 'function depuisLeSecond() { return 1; }\n',
      },
      page: ['premier.js', 'second.js'],
    });
    // Le clic plus tard, l'appel après la définition, la fonction jamais appelée, le `typeof` : rien.
    // Les variables propres à la fonction appelée naissent avec elle (`local`).
    expect(ecarts(r, 'F9')).toEqual({
      'F9 entreprise v10/premier.js CONFIG (par lireTot)': 1,
      'F9 entreprise v10/premier.js DEDANS_PLUS_LOIN (par enDedans)': 1,
      'F9 entreprise v10/premier.js PLUS_LOIN': 1,
      'F9 entreprise v10/premier.js depuisLeSecond (par une fonction)': 1,
    });
    expect(mesurer(r).atteint.entreprise?.auChargement).toBeGreaterThanOrEqual(5);
  });

  it('F13 : au serveur, un import vers le fichier interne d\'un autre module ; sa porte est permise', () => {
    const r = depot({
      fichiers: {
        'serveur/ventes/pieces.ts': 'import { a } from \'../paie/gestes.ts\';\nimport {\n  b,\n} from \'../paie/porte.ts\';\nimport type { C } from \'../base.ts\';\nimport { d } from \'./reglements.ts\';\nconst e = await import(\'../paie/routes.ts\');\n',
        'serveur/v10/dossier.ts': 'import { f } from \'../ventes/pieces.ts\';\nexport { g } from \'../ventes/porte.ts\';\n',
        'serveur/paie/gestes.ts': 'import { h } from \'./identite.ts\';\nimport { i } from \'../base.ts\';\n',
      },
      fiches: { ventes: { serveur: ['serveur/ventes'] }, personnel: { serveur: ['serveur/paie'] } },
    });
    expect(ecarts(r, 'F13')).toEqual({
      'F13 serveur/v10/dossier.ts → serveur/ventes/pieces.ts': 1,
      'F13 serveur/ventes/pieces.ts → serveur/paie/gestes.ts': 1,
      'F13 serveur/ventes/pieces.ts → serveur/paie/routes.ts': 1,
    });
  });

  it('le cliquet : un écart neuf ou disparu fait tomber le contrôle ; la liste ne fait que baisser, sauf un déplacement à l\'identique', () => {
    const r = depot({ fichiers: FERMETURE, table: TABLE, fiches: FICHES });
    expect(comparer(mesurer(r), lireConnus(r))[0]).toMatch(/introuvable.*npm run frontieres -- --ecrire/);
    expect(ecrireConnus(r).refus).toEqual([]);
    expect(comparer(mesurer(r), lireConnus(r))).toEqual([]);
    const cle = 'F2 v10/app.js personnel→ventes prixVente';
    // Un écart neuf : refusé (ce qui, pourquoi, ce qui débloque) ; la liste ne l'inscrit pas.
    fs.appendFileSync(path.join(r, PAIE), '  function encore() { return prixVente(); }\n');
    const refus = comparer(mesurer(r), lireConnus(r));
    expect(refus).toHaveLength(1);
    expect(refus[0]).toMatch(/^Écart nouveau \(F2, .+\) : « F2 v10\/app\.js personnel→ventes prixVente », 2 au lieu de 1 \(par exemple v10\/app\.js:\d+\)\. Refusé parce que .+\. Ce qui débloque : .+\.$/);
    expect(ecrireConnus(r).refus[0]).toMatch(/ne peut que baisser.*passerait de 1 à 2/);
    expect(lireConnus(r)?.ecarts[cle]).toBe(1);
    // Un écart disparu mais encore listé : refusé, puis la liste baisse.
    fs.writeFileSync(path.join(r, PAIE), FERMETURE[PAIE].replace('prixVente() + totalVentes', 'prixVente()'));
    expect(comparer(mesurer(r), lireConnus(r))).toEqual(['Écart disparu mais encore listé : « F2 v10/app.js personnel→ventes totalVentes », 1 listés, 0 mesurés. Bravo : baisse la liste avec `npm run frontieres -- --ecrire` (elle ne peut que baisser).']);
    expect(ecrireConnus(r).refus).toEqual([]);
    expect(lireConnus(r)?.ecarts).not.toHaveProperty('F2 v10/app.js personnel→ventes totalVentes');
    // Un déplacement à l'identique (une fonction passe d'un morceau à l'autre, le fichier servi ne change pas d'un octet) :
    // il révèle des écarts ; seul `deplacement` les inscrit.
    const lire = (f: string) => fs.readFileSync(path.join(r, f), 'utf8');
    const ligne = '  function lirePaie() { return salaire(); }\n';
    fs.writeFileSync(path.join(r, VENTES), lire(VENTES).replace(ligne, ''));
    fs.writeFileSync(path.join(r, PAIE), ligne + lire(PAIE));
    expect(ecrireConnus(r).refus[0]).toMatch(/« F4 v10\/app\.js socle→personnel lirePaie » passerait de 0 à 1/);
    expect(ecrireConnus(r, { deplacement: true }).refus).toEqual([]);
    expect(lireConnus(r)?.ecarts['F4 v10/app.js socle→personnel lirePaie']).toBe(1);
    expect(comparer(mesurer(r), lireConnus(r))).toEqual([]);
    // Mais si le code servi a changé, un « déplacement » n'inscrit rien.
    fs.appendFileSync(path.join(r, PAIE), '  function encoreUne() { return prixVente(); }\n');
    expect(ecrireConnus(r, { deplacement: true }).refus[0]).toMatch(/n'inscrit ses écarts que si les écrans servis n'ont pas changé d'un octet/);
    // Et un déplacement n'inscrit jamais un nom introuvable (ni une coupe au milieu, un nom en double, un nom lu trop tôt).
    fs.appendFileSync(path.join(r, PAIE), '  function perdu() { return inconnu(); }\n');
    expect(ecrireConnus(r, { deplacement: true }).refus.join('\n')).toMatch(/Un déplacement n'inscrit jamais « F1 entreprise v10\/app\.js inconnu » \(1\)/);
  });

  it('F12 : un gros fichier ne grandit pas hors de modules/ ; son plafond baisse avec lui', () => {
    const r = depot({ fichiers: { 'web/public/v10/app.js': 'un();\ndeux();\ntrois();\n', 'web/public/v10/outil.js': 'function un() {}\nfunction deux() {}\nfunction trois() {}\n' }, page: ['outil.js', 'app.js'] });
    expect(ecrireConnus(r).refus).toEqual([]);
    expect(lireConnus(r)?.lignes['v10/app.js']?.auPlus).toBe(3);
    fs.appendFileSync(path.join(r, 'web/public/v10/app.js'), 'un();\n');
    const refus = comparer(mesurer(r), lireConnus(r));
    expect(refus).toHaveLength(1);
    expect(refus[0]).toMatch(/^Écart nouveau \(F12, .+\) : « v10\/app\.js » a 4 lignes hors de modules\/, au plus 3\. Refusé parce que .+ Ce qui débloque : .+/);
    expect(ecrireConnus(r).refus[0]).toMatch(/4 lignes hors de modules\/, au plus 3/);
    fs.writeFileSync(path.join(r, 'web/public/v10/app.js'), 'un();\ndeux();\n');
    expect(comparer(mesurer(r), lireConnus(r))).toEqual([]);
    expect(ecrireConnus(r).refus).toEqual([]);
    expect(lireConnus(r)?.lignes['v10/app.js']?.auPlus).toBe(2);
    // Un plafond retiré de la liste est un refus.
    const connus = lireConnus(r);
    if (connus) { delete connus.lignes['v10/app.js']; fs.writeFileSync(path.join(r, CONNUS), JSON.stringify(connus)); }
    expect(comparer(mesurer(r), lireConnus(r))[0]).toMatch(/« v10\/app\.js » n'a pas son plafond de lignes/);
  });

  it('la construction contrôle avant de construire, seulement quand SKANFACT_CONTROLE=1 ; le suiveur la pose, les tests jamais', () => {
    const plugins = (config as { plugins: Plugin[] }).plugins.flat() as Plugin[];
    expect(plugins[0]?.name).toBe('skanfact-controle-des-frontieres');
    expect(plugins[0]?.apply).toBe('build');
    // Sur un dépôt sans liste : refusé si (et seulement si) la construction le demande.
    const p = controleDesFrontieres(depot({ fichiers: FERMETURE, table: TABLE, fiches: FICHES }));
    const demarrer = () => (p.buildStart as unknown as () => void).call({});
    const avant = process.env.SKANFACT_CONTROLE;
    try {
      delete process.env.SKANFACT_CONTROLE;
      expect(demarrer).not.toThrow();
      process.env.SKANFACT_CONTROLE = '1';
      expect(demarrer).toThrow(FrontiereRefusee);
    } finally {
      if (avant === undefined) delete process.env.SKANFACT_CONTROLE; else process.env.SKANFACT_CONTROLE = avant;
    }
    // Le suiveur construit la production avec le contrôle.
    const suivre = scriptSansCommentaires('exploitation/suivre.ts', fs.readFileSync(path.join(RACINE_DU_DEPOT, 'exploitation/suivre.ts'), 'utf8'));
    const construction = suivre.split('\n').filter((l) => l.includes('\'vite\', \'build\''));
    expect(construction).toHaveLength(1);
    expect(construction[0]).toContain('SKANFACT_CONTROLE: \'1\'');
    // Aucun test ne la pose (sinon une preuve tomberait pour une autre raison) ; ni la configuration des tests.
    const poses: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(path.join(RACINE_DU_DEPOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) { parcourir(rel); continue; }
        // Ce test, et la liste des preuves (ses défauts sont du texte : ils ne posent rien quand la suite tourne).
        if (rel === 'tests/commun/frontieres.test.ts' || rel === 'tests/preuves.sh' || !/\.(ts|sh|js)$/.test(e.name)) continue;
        // Le code seul (un commentaire qui la nomme ne la pose pas).
        const texte = fs.readFileSync(path.join(RACINE_DU_DEPOT, rel), 'utf8');
        if ((e.name.endsWith('.sh') ? texte : scriptSansCommentaires(rel, texte)).includes('SKANFACT_CONTROLE')) poses.push(rel);
      }
    };
    parcourir('tests');
    expect(poses).toEqual([]);
    expect(fs.readFileSync(path.join(RACINE_DU_DEPOT, 'vitest.config.ts'), 'utf8')).not.toContain('SKANFACT_CONTROLE');
    // Les dossiers du serveur que les fiches déclarent existent, et chacun n'a qu'un module.
    const ordre = (JSON.parse(fs.readFileSync(path.join(RACINE_DU_DEPOT, 'modules/ordre.json'), 'utf8')) as { ordre: string[] }).ordre;
    const dossiers = ordre.flatMap((m) => ((JSON.parse(fs.readFileSync(path.join(RACINE_DU_DEPOT, `modules/${m}/module.json`), 'utf8')) as { serveur?: string[] }).serveur ?? []));
    expect(dossiers.length).toBeGreaterThan(4);
    expect(new Set(dossiers).size).toBe(dossiers.length);
    for (const d of dossiers) expect(fs.statSync(path.join(RACINE_DU_DEPOT, d)).isDirectory(), d).toBe(true);
  });
});
