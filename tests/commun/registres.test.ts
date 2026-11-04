// Les registres du socle (docs/cadrage/17-rangement.md § 3.2 et § 3.3 ; lot B0, 04/11/2026) : la porte d'un module, les
// points, les emplacements et les événements, par quoi les modules se parlent à l'écran. Chaque règle se prouve ici sur des
// modules d'essai, dans un bac à sable qui charge le fichier servi (`plateforme/registres.js`) ; ce que les vrais écrans y
// mettent (depuis le lot P1b, le Personnel), leurs fiches le disent.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as acorn from 'acorn';
import { describe, expect, it } from 'vitest';
import { lireEcran, lireTable, RACINE_DU_DEPOT } from '../../commun/assemblage.ts';
import { PAGES, scriptsDeLaPage } from '../../outils/rangement/frontieres.ts';
import { scriptSansCommentaires } from '../../web/alleger.ts';

type Fiche = { code: string; porte: unknown[]; points: { declare: string[]; remplit: string[] }; emplacements: string[] };
const lireTexte = (f: string) => fs.readFileSync(path.join(RACINE_DU_DEPOT, f), 'utf8');

type Socle = {
  EMPLACEMENTS: readonly string[];
  declarer: (m: string, p: unknown) => Record<string, unknown>;
  porte: (m: string) => Record<string, unknown>;
  declarerPoint: (m: string, p: string) => void;
  remplir: (p: string, m: string, f: unknown) => void;
  lire: (p: string, ...a: unknown[]) => unknown[];
  poser: (e: string, m: string, x: unknown) => void;
  entrees: (e: string) => Record<string, unknown>[];
  annoncer: (n: string, d?: unknown) => void;
  ecouter: (n: string, f: (d: unknown) => void) => () => void;
  etat: () => { portes: string[]; points: Record<string, unknown>; emplacements: Record<string, number> };
};
const SERVI = 'plateforme/registres.js';

function charger(fenetre: EventTarget & { Socle?: Socle } = new EventTarget()) {
  vm.runInContext(lireEcran(SERVI), vm.createContext({ window: fenetre, CustomEvent }), { filename: SERVI });
  return { fenetre, S: fenetre.Socle as Socle };
}

describe('les registres du socle', () => {
  it('servis les premiers sur les deux pages, ils naissent vides ; ce que les écrans y mettent, la fiche de chaque module le dit', () => {
    expect(lireTable()[SERVI]).toEqual(['modules/socle/registres.js']);
    for (const page of Object.values(PAGES)) expect(scriptsDeLaPage(page)[0], page).toBe(SERVI);
    const { S } = charger();
    expect(S.etat()).toEqual({ portes: [], points: {}, emplacements: Object.fromEntries(S.EMPLACEMENTS.map((e) => [e, 0])) });
    // Les listes que les écrans écrivaient en dur (17 § 3.3), chacune son emplacement.
    expect(S.EMPLACEMENTS).toEqual(['a-faire', 'palette', 'creer', 'pages', 'parties-des-pages', 'metiers', 'imports', 'onglets-compta', 'parametres-cabinet']);
    // Ce que les écrans servis y mettent (leur code, sans les commentaires), module par module, est ce que disent les
    // fiches : les emplacements où il pose, les points qu'il déclare et ceux qu'il remplit, sa porte (lot P1b : le
    // Personnel ; les points de la Trésorerie et des Déclarations, déclarés par leurs écrans, encore au socle). Un appel
    // dont le module ou l'emplacement n'est pas écrit en toutes lettres ne se lirait pas : il est refusé.
    const code = [...new Set(Object.values(PAGES).flatMap((p) => scriptsDeLaPage(p)))].filter((s) => s !== SERVI).map((s) => scriptSansCommentaires(s, lireEcran(s))).join('\n');
    const lettres = (args: string, n: number) => { const m = args.match(new RegExp(`^${Array(n).fill('\'([a-z][a-z0-9-]*)\'').join(', ')}`)); return m ? m.slice(1, n + 1) : null; };
    const vus = { emplacements: new Set<string>(), declare: new Set<string>(), remplit: new Set<string>(), porte: new Set<string>() };
    for (const [geste, n, ou] of [['poser', 2, 'emplacements'], ['declarerPoint', 2, 'declare'], ['remplir', 2, 'remplit'], ['declarer', 1, 'porte']] as const) {
      for (const m of code.matchAll(new RegExp(`\\bSocle\\.${geste}\\(([^)]{0,80})`, 'g'))) {
        const l = lettres(m[1] ?? '', n);
        expect(l, `Socle.${geste}(${m[1] ?? ''}`).not.toBeNull();
        // poser(emplacement, module) ; remplir(point, module) ; declarerPoint(module, point) ; declarer(module).
        if (l) vus[ou].add(geste === 'declarerPoint' ? `${l[0]} ${l[1]}` : geste === 'declarer' ? `${l[0]}` : `${l[1]} ${l[0]}`);
      }
    }
    const fiches = (JSON.parse(lireTexte('modules/ordre.json')) as { ordre: string[] }).ordre.map((m) => JSON.parse(lireTexte(`modules/${m}/module.json`)) as Fiche);
    const dits = {
      emplacements: new Set(fiches.flatMap((f) => f.emplacements.map((e) => `${f.code} ${e}`))),
      declare: new Set(fiches.flatMap((f) => f.points.declare.map((p) => `${f.code} ${p}`))),
      remplit: new Set(fiches.flatMap((f) => f.points.remplit.map((p) => `${f.code} ${p}`))),
      porte: new Set(fiches.filter((f) => f.porte.length).map((f) => f.code)),
    };
    for (const k of ['emplacements', 'declare', 'remplit', 'porte'] as const) expect([...vus[k]].sort(), k).toEqual([...dits[k]].sort());
    expect([...vus.remplit].sort(), 'le Personnel s\'en sert').toEqual(['personnel declarations-sociales', 'personnel sorties-prevues']);
    // Un point qu'on remplit est déclaré par quelqu'un ; un emplacement où l'on pose existe.
    const declares = [...vus.declare].map((x) => x.split(' ')[1]);
    for (const x of vus.remplit) expect(declares, x).toContain(x.split(' ')[1]);
    for (const x of vus.emplacements) expect(S.EMPLACEMENTS, x).toContain(x.split(' ')[1]);
    // Chargé deux fois, il garde ce qu'il tient.
    const fenetre = new EventTarget() as EventTarget & { Socle?: Socle };
    charger(fenetre).S.declarer('personnel', {});
    expect(charger(fenetre).S.etat().portes).toEqual(['personnel']);
  });

  it('la boîte du Personnel (lot P1b) : son morceau des écrans de l\'entreprise ne pose aucun nom chez le socle ; il pose ses entrées une fois ses noms définis', () => {
    const t = lireTexte('modules/personnel/ecrans/entreprise/paie.js');
    // Le morceau se lit seul : une seule instruction, la fonction appelée sur-le-champ qui le contient (sa boîte).
    const ast = acorn.parse(t, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as { body: { type: string; expression?: { type: string; callee?: { type: string } } }[] };
    expect(ast.body.map((s) => s.type)).toEqual(['ExpressionStatement']);
    expect(ast.body[0]?.expression?.callee?.type).toBe('FunctionExpression');
    // Ce qu'il met dans les registres se pose en bas de la boîte : ses pages, ses onglets et ses gestes y sont définis.
    expect(t.indexOf('Socle.poser(')).toBeGreaterThan(t.lastIndexOf('const PAIE_TABS'));
    expect(t.indexOf('Socle.poser(')).toBeGreaterThan(t.lastIndexOf('const ficheDuSalarie'));
  });

  it('la porte d\'un module : déclarée une fois, figée, lue par les autres ; une porte absente ou un nom mal formé sont refusés et dits', () => {
    const { S } = charger();
    const fonctions = { masse: (mois: string) => (mois === '2026-06' ? 3_250_000n : 0n) };
    const p = S.declarer('personnel', fonctions);
    expect((S.porte('personnel').masse as (m: string) => bigint)('2026-06')).toBe(3_250_000n);
    expect(Object.isFrozen(p)).toBe(true);
    // Ce que le module change ensuite dans son objet ne passe pas par la porte : elle est une copie figée.
    (fonctions as Record<string, unknown>).cachee = () => 1;
    expect(Object.keys(S.porte('personnel'))).toEqual(['masse']);
    expect(() => S.declarer('personnel', {})).toThrow(/la porte de « personnel » est déjà déclarée/);
    expect(() => S.porte('stock')).toThrow(/« stock » n'a pas déclaré sa porte \(Socle\.declarer\)/);
    expect(() => S.declarer('Personnel', {})).toThrow(/« Personnel » n'est pas un nom/);
    expect(() => S.declarer('caisse', [1])).toThrow(/est un objet/);
    expect(S.etat().portes).toEqual(['personnel']);
  });

  it('un point : déclaré par le module qui en a besoin, rempli par les autres, lu comme la suite de leurs listes ; vide, il rend une liste vide', () => {
    const { S } = charger();
    S.declarerPoint('tresorerie', 'sorties-prevues');
    expect(S.lire('sorties-prevues', '2026-06')).toEqual([]);
    S.remplir('sorties-prevues', 'personnel', (mois: string) => [{ quoi: 'salaires', mois, montant: 3_250_000n }]);
    S.remplir('sorties-prevues', 'achats', () => [{ quoi: 'fournisseurs' }, { quoi: 'loyer' }]);
    expect(S.lire('sorties-prevues', '2026-06')).toEqual([{ quoi: 'salaires', mois: '2026-06', montant: 3_250_000n }, { quoi: 'fournisseurs' }, { quoi: 'loyer' }]);
    expect(S.etat().points).toEqual({ 'sorties-prevues': { module: 'tresorerie', remplis: ['personnel', 'achats'] } });
    expect(() => S.declarerPoint('pilotage', 'sorties-prevues')).toThrow(/déjà déclaré par « tresorerie »/);
    expect(() => S.remplir('charges-du-mois', 'personnel', () => [])).toThrow(/le point « charges-du-mois » n'est pas déclaré : le module qui en a besoin le déclare/);
    expect(() => S.remplir('sorties-prevues', 'tresorerie', () => [])).toThrow(/« tresorerie » ne remplit pas son propre point/);
    expect(() => S.remplir('sorties-prevues', 'personnel', () => [])).toThrow(/« personnel » remplit déjà le point/);
    expect(() => S.remplir('sorties-prevues', 'stock', 'rien')).toThrow(/attend une fonction/);
    expect(() => S.lire('charges-du-mois')).toThrow(/le point « charges-du-mois » n'est pas déclaré/);
    S.remplir('sorties-prevues', 'caisse', () => ({ quoi: 'pas une liste' }));
    expect(() => S.lire('sorties-prevues', '2026-06')).toThrow(/« caisse » a rempli le point « sorties-prevues » avec autre chose qu'une liste/);
  });

  it('un emplacement garde le rang de chaque entrée : l\'ordre affiché ne dépend pas de l\'ordre de chargement des modules', () => {
    const { S } = charger();
    S.poser('palette', 'stock', { rang: 30, titre: 'Stock' });
    S.poser('palette', 'personnel', { rang: 10, titre: 'Paie' });
    S.poser('palette', 'caisse', { rang: 20, titre: 'Caisse' });
    const e = S.entrees('palette');
    expect(e.map((x) => [x.titre, x.module])).toEqual([['Paie', 'personnel'], ['Caisse', 'caisse'], ['Stock', 'stock']]);
    expect(e.every((x) => Object.isFrozen(x))).toBe(true);
    expect(S.entrees('creer')).toEqual([]);
    expect(S.etat().emplacements.palette).toBe(3);
    expect(() => S.poser('palette', 'achats', { rang: 30, titre: 'Achats' })).toThrow(/le rang 30 de « palette » est déjà pris par « stock »/);
    expect(() => S.poser('palette', 'achats', { titre: 'Achats' })).toThrow(/porte son rang d'aujourd'hui/);
    expect(() => S.poser('barre-laterale', 'achats', { rang: 1 })).toThrow(/l'emplacement « barre-laterale » n'existe pas : a-faire, palette/);
    expect(() => S.entrees('barre-laterale')).toThrow(/l'emplacement « barre-laterale » n'existe pas/);
  });

  it('un événement passe par la page : les écoutes d\'aujourd\'hui l\'entendent, il garde son nom, et une écoute se retire', () => {
    const { fenetre, S } = charger();
    const vu: unknown[] = [];
    const cesser = S.ecouter('skanfact-questions', (d) => vu.push(['socle', d]));
    fenetre.addEventListener('skanfact-questions', (e) => vu.push(['page', (e as CustomEvent).detail]));
    S.annoncer('skanfact-questions', { ouvertes: 2 });
    expect(vu).toEqual([['socle', { ouvertes: 2 }], ['page', { ouvertes: 2 }]]);
    // Ce que la page annonce aujourd'hui (le pont, le poste) s'entend par le socle.
    const poste: unknown[] = [];
    S.ecouter('skanposte', (d) => poste.push(d));
    fenetre.dispatchEvent(new CustomEvent('skanposte', { detail: { enLigne: false } }));
    expect(poste).toEqual([{ enLigne: false }]);
    cesser();
    S.annoncer('skanfact-questions', { ouvertes: 0 });
    expect(vu).toEqual([['socle', { ouvertes: 2 }], ['page', { ouvertes: 2 }], ['page', { ouvertes: 0 }]]);
    expect(() => S.annoncer('Questions ouvertes')).toThrow(/n'est pas un nom/);
    expect(() => S.ecouter('skanposte', 'rien' as never)).toThrow(/attend une fonction/);
  });
});
