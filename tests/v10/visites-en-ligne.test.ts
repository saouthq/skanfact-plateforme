// Les visites guidées de l'entreprise, lues telles que le navigateur les reçoit : les fichiers repris (adaptations
// comprises) et le point de contact, exécutés dans un bac à sable. Une étape qui ne vise qu'un élément que la version
// en ligne ne montre pas doit être facultative : sinon la visite attend un bouton qui ne viendra jamais, et finit sur
// « Je suis perdu ».
//
// Lot achats (05/10/2026 ; docs/achats.md) : en ligne, le bouton « Joindre un justificatif… » n'existe pas (le serveur
// ne garde pas encore les fichiers), et la visite « Saisir une facture d'achat » l'attendait. Le parcours à la souris
// (tests/web/achats-lot.test.ts) ne le voyait que selon le moment du clic : le moteur saute de lui-même une étape
// absente quand on vient de cliquer (visite.js, `decider` : « avance »). Ce test lit la visite elle-même, sans horloge.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const PUBLIC = path.join(import.meta.dirname, '../../web/public');

type Etape = { cible?: unknown; titre?: string; facultatif?: boolean };
type Visite = { id: string; titre?: string; etapes?: Etape[] };

function charger() {
  const element = () => ({
    style: {}, classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined, contains: () => false },
    setAttribute: () => undefined, appendChild: () => undefined, addEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [],
  });
  const document = {
    createElement: element, head: element(), body: element(), documentElement: element(),
    addEventListener: () => undefined, removeEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [],
  };
  const bac: Record<string, unknown> = {
    sessionStorage: { getItem: () => 'jeton', setItem: () => undefined, removeItem: () => undefined },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    location: { search: '?e=00000000-0000-4000-8000-000000000000', pathname: '/v10/', hash: '', replace: () => undefined },
    URLSearchParams, document, console, navigator: { onLine: true },
    // Rien ne part ni ne s'attend : seules les définitions comptent.
    fetch: () => new Promise(() => undefined), setTimeout: () => 0, clearTimeout: () => undefined, setInterval: () => 0, clearInterval: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    MutationObserver: class { observe() { return undefined; } disconnect() { return undefined; } },
    // La copie du poste (brique 72) : sans objet ici.
    SkanPoste: new Proxy({}, { get: () => () => undefined }),
  };
  bac.window = bac;
  bac.self = bac;
  vm.createContext(bac);
  for (const f of ['plateforme/pont.js', 'v10/visite.js', 'v10/visites.js']) vm.runInContext(fs.readFileSync(path.join(PUBLIC, f), 'utf8'), bac, { filename: f });
  const pont = bac.skanfact as { panneauxAbsents: string[]; piecesJointes?: boolean };
  const visites = (bac.SkanVisites as { parcours: (ctx: unknown) => Visite[] }).parcours({
    data: () => ({}), premier: () => null, estDemo: () => false, editeur: () => false, Visite: bac.Visite, G: { INFO: {} }, chiffre: () => false,
  });
  return { pont, visites };
}

// Les sélecteurs d'une étape (un seul, ou plusieurs essayés dans l'ordre), chacun coupé à ses virgules du premier niveau.
function alternatives(cible: unknown): string[] {
  const liste = typeof cible === 'string' ? [cible] : Array.isArray(cible) ? cible.filter((x): x is string => typeof x === 'string') : [];
  return liste.flatMap((s) => {
    const parts: string[] = [];
    let profondeur = 0;
    let courant = '';
    for (const c of s) {
      if (c === '(' || c === '[') profondeur++;
      if (c === ')' || c === ']') profondeur--;
      if (c === ',' && profondeur === 0) { parts.push(courant); courant = ''; } else courant += c;
    }
    return [...parts, courant].map((x) => x.trim()).filter(Boolean);
  });
}

describe('les visites de l\'entreprise, en ligne', () => {
  const { pont, visites } = charger();
  // Ce que la version en ligne ne montre pas : les panneaux des Paramètres sans objet (pont.js, `panneauxAbsents`), et
  // le bouton du justificatif tant que le serveur ne garde pas les fichiers (`piecesJointes`, web/v10/achats-lot.txt).
  const absents = [...pont.panneauxAbsents.map((id) => `#${id}`), ...(pont.piecesJointes === false ? ['#attach-top'] : [])];
  const absente = (alt: string) => absents.some((a) => new RegExp(`${a}(?![\\w-])`).test(alt));
  const surUnAbsent = (e: Etape) => { const a = alternatives(e.cible); return a.length > 0 && a.every(absente); };

  it('dans « Saisir une facture d\'achat », l\'étape du justificatif, absent en ligne, est facultative', () => {
    const achat = visites.find((v) => v.id === 'achat');
    const visees = (achat?.etapes ?? []).filter(surUnAbsent);
    // Le test mesure : l'étape du justificatif est lue, et elle vise bien un élément absent.
    expect(visees.map((e) => e.titre)).toContain('Le justificatif d\'abord');
    expect(visees.filter((e) => !e.facultatif).map((e) => e.titre)).toEqual([]);
  });
});
