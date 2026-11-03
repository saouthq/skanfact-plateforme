// Les fiches des modules (docs/cadrage/17-rangement.md § 2.2 ; 02 M1 ; lot R0e, 03/11/2026). Une seule liste de modules,
// celle du 02 § 2 (modules/ordre.json) ; chaque module a sa fiche ; les dépendances vont dans un seul sens ; chaque
// collection du dossier, chaque page, chaque nom de geste et chaque schéma de la base a UN propriétaire.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RACINE_DU_DEPOT } from '../../commun/assemblage.ts';
import { GESTES } from '../../serveur/porte/gestes.ts';
import { LISTES, RACINE } from '../../serveur/v10/droits.ts';
import { GESTES_MESSAGERIE } from '../../serveur/messagerie/gestes.ts';
import { GESTES_SUPPORT } from '../../serveur/support/gestes.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Page = { id: string; famille?: string; vueDe?: string };
type Fiche = { code: string; nom: string; phrase: string; codesDesGestes: string[]; dependances: string[]; pages: Page[]; pagesCabinet?: Page[];
  collections: string[]; racine: string[]; schemas: string[]; porte: unknown[]; points: { declare: unknown[]; remplit: unknown[] }; emplacements: unknown[];
  evenements: { annonce: unknown[]; ecoute: unknown[] } };
const lire = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(RACINE_DU_DEPOT, f), 'utf8')) as T;
const ORDRE = lire<{ ordre: string[] }>('modules/ordre.json').ordre;
// Lues dans chaque test (une fiche absente fait tomber le test qui la cherche, sans casser le fichier entier).
const fiches = () => ORDRE.filter((m) => fs.existsSync(path.join(RACINE_DU_DEPOT, `modules/${m}/module.json`))).map((m) => lire<Fiche>(`modules/${m}/module.json`));
// Les six familles du menu (17 § 1).
const FAMILLES = ['Vendre', 'Acheter', 'Articles et stock', 'Personnel', 'Argent', 'Piloter'];
// Un seul propriétaire par entrée : la liste de ceux qui la déclarent.
const proprietaires = (cle: (f: Fiche) => string[]) => {
  const p = new Map<string, string[]>();
  for (const f of fiches()) for (const x of cle(f)) p.set(x, [...(p.get(x) ?? []), f.code]);
  return p;
};
const sansProprietaireUnique = (attendus: string[], p: Map<string, string[]>) => attendus.filter((x) => (p.get(x) ?? []).length !== 1).map((x) => `${x} → ${(p.get(x) ?? []).join(', ') || 'personne'}`);

describe('les fiches des modules', () => {
  it('une fiche par module de l\'ordre du 02 § 2, le socle en tête ; les dépendances ne vont que vers le haut', () => {
    const dossiers = fs.readdirSync(path.join(RACINE_DU_DEPOT, 'modules'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(dossiers).toEqual([...ORDRE].sort());
    expect(ORDRE[0]).toBe('socle');
    expect(ORDRE).toHaveLength(11);
    const FICHES = fiches();
    expect(FICHES.map((f) => f.code), 'chaque module de l\'ordre a sa fiche').toEqual(ORDRE);
    for (const f of FICHES) {
      expect(f.nom && f.phrase, f.code).toBeTruthy();
      for (const d of f.dependances) {
        expect(ORDRE, `${f.code} dépend de « ${d} », qui n'est pas un module`).toContain(d);
        expect(ORDRE.indexOf(d), `${f.code} dépend de ${d}, placé après lui : une dépendance vers le bas (02 § 2)`).toBeLessThan(ORDRE.indexOf(f.code));
      }
    }
  });

  it('chaque partie du dossier, chaque page du menu, chaque nom de geste et chaque schéma de la base a un seul propriétaire', () => {
    const FICHES = fiches();
    expect(sansProprietaireUnique(Object.keys(LISTES), proprietaires((f) => f.collections))).toEqual([]);
    expect(sansProprietaireUnique(Object.keys(RACINE), proprietaires((f) => f.racine))).toEqual([]);
    // Rien de déclaré qui n'existe pas.
    expect(FICHES.flatMap((f) => f.collections).filter((c) => !(c in LISTES))).toEqual([]);
    expect(FICHES.flatMap((f) => f.racine).filter((c) => !(c in RACINE))).toEqual([]);
    // Les pages de l'application de l'entreprise (`PAGES` de core.js) ; leur famille est l'une des six.
    const pages = (ecranDeLaPlateforme('core.js') as { PAGES: { id: string }[] }).PAGES.map((p) => p.id);
    expect(sansProprietaireUnique(pages, proprietaires((f) => f.pages.map((p) => p.id)))).toEqual([]);
    expect(FICHES.flatMap((f) => f.pages.map((p) => p.id)).filter((p) => !pages.includes(p))).toEqual([]);
    for (const f of FICHES) for (const p of f.pages) if (p.famille) expect(FAMILLES, `${f.code}/${p.id}`).toContain(p.famille);
    // Les noms de gestes de la porte (03) : chacun dit son module.
    const noms = [...new Set([...GESTES.values(), ...GESTES_MESSAGERIE, ...GESTES_SUPPORT].map((g) => g.module))];
    expect(sansProprietaireUnique(noms, proprietaires((f) => f.codesDesGestes))).toEqual([]);
    // Les schémas que les migrations créent.
    const schemas = [...new Set(fs.readdirSync(path.join(RACINE_DU_DEPOT, 'base/migrations')).filter((f) => f.endsWith('.sql'))
      .flatMap((f) => [...fs.readFileSync(path.join(RACINE_DU_DEPOT, 'base/migrations', f), 'utf8').matchAll(/create schema (?:if not exists )?([a-z_]+)/g)].map((m) => m[1] ?? '')))];
    expect(schemas.length).toBeGreaterThan(5);
    expect(sansProprietaireUnique(schemas, proprietaires((f) => f.schemas))).toEqual([]);
  });

});
