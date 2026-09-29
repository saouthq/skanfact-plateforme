// Le Cabinet sans paquets, dans tous ses textes (brique 38 bis ; docs/cabinet.md, C4 et C14). Le
// parcours à la souris (tests/web/cabinet-mots.test.ts) lit ce que chaque écran affiche ; celui-ci lit
// ce que le Cabinet peut montrer SANS qu'on l'ait ouvert : chaque bulle « i », chaque article de l'Aide,
// chaque visite que « Me guider » propose en ligne (ses étapes, sa fin), et ce qu'une visite dit d'un
// écran, d'un bouton ou d'un champ. Aucune phrase ne parle encore de paquet — sauf celles d'un élément
// que la version en ligne ne montre jamais, nommées ici une par une, avec leur raison.
//
// Les textes sont lus tels que le navigateur les reçoit : les fichiers repris (adaptations comprises) et
// le point de contact, exécutés dans un bac à sable.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const PUBLIC = path.join(import.meta.dirname, '../../web/public');
// Les mots des paquets (les mêmes que le parcours à la souris, plus le fichier d'appairage).
const INTERDIT = /paquet|skanpack|skanpair|appairage|clé de secours|mois reçus?\b|reçu le|n'a envoyé|a envoyé ses|t'envoie ses|t'envoient|envoie (?:encore )?ses|ne t'a rien envoyé|pas envoyé|rien envoyé|mois clôturés?|provisoire/i;

// Ce que la version en ligne ne montre jamais, et pourquoi.
const JAMAIS_MONTRE = {
  // L'onglet des paquets d'un dossier est caché (plateforme/cabinet.css), et le bandeau de l'exemple
  // n'apparaît qu'avec l'exemple, qui n'est pas en ligne.
  pages: ['dossier-paquets'], onglets: ['dossier:paquets', 'paquets'], menus: ['dossier-paquets'], zones: ['#demo-banner'],
  // Des boutons cachés (plateforme/cabinet.css), rangés dans un panneau absent (pont-cabinet.js,
  // PANNEAUX_ABSENTS), retirés par une adaptation, ou dans un état que la version en ligne n'atteint
  // jamais (un livre « absent », la page d'export).
  boutons: ['#imp', '#rl-imp', '#demo-on', '#lv-relire', '#lv-relire2', // cachés
    '#i-pick', '#s-rec', '#s-rec-in', '#sr-corr-save', '#sr-corr input[data-k="de"]', // panneaux absents
    '#ech-pair', '#c-pair', '#inbox-go', '#inbox-skip', // retirés (adaptations)
    '#rec-banniere', '#rec-go', // la clé de secours (pont-cabinet.js les cache)
    '#lv-ecrire', '#e-go'], // un livre absent ; l'export de toutes les écritures (pas encore en ligne)
  bulles: [
    'cab.fingerprint', // l'empreinte du fichier d'appairage : le panneau devient celui du code du cabinet
    'd.ca', 'p.integrity', 'p.intrus', 'p.actions', 'p.arret', 'lv.relire', // l'onglet des paquets, l'import
    'e.periode', 'e.provisoire', 'e.manquants', // l'export de toutes les écritures : pas encore en ligne
    'b.external', 'b.recovery', 'b.password', 'b.inbox', 'b.where', 'b.pwOuvrir', 'b.pwCabinet', 'b.pwFichier', 'b.reprise', // l'ordinateur
    'lic.cab', 'lic.comptes', 'lic.cle', // la licence
    'cl.produits', // les fichiers de clôture envoyés au client : le client lit les mêmes livres
    'eq.production', 'dc.etat', // la production et la déclaration : pas encore en ligne, leur brique réécrit l'écran avec
  ],
};

function charger() {
  const document = { createElement: () => ({}), head: { appendChild: () => undefined }, addEventListener: () => undefined };
  const bac: Record<string, unknown> = {
    sessionStorage: { getItem: () => 'jeton' }, localStorage: { getItem: () => null, setItem: () => undefined },
    location: { search: '?c=00000000-0000-4000-8000-000000000000', replace: () => undefined, hash: '' },
    URLSearchParams, document, console, fetch: () => Promise.reject(new Error('hors ligne')),
  };
  bac.window = bac;
  bac.self = bac;
  vm.createContext(bac);
  for (const f of ['plateforme/pont-cabinet.js', 'v10/visite.js', 'v10/cabinet/cabguide.js', 'v10/cabinet/cabvisites.js']) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, f), 'utf8'), bac, { filename: f });
  }
  return bac as unknown as {
    cabinet: { visitesAbsentes: string[]; articlesAbsents: string[] };
    CabGuide: { INFO: Record<string, unknown>; ARTICLES: { id: string }[] };
    CabVisites: {
      parcours: (ctx: unknown) => { id: string }[]; THEMES: unknown; PAGES: Record<string, unknown>; ZONES: { sel: string }[];
      ONGLETS: Record<string, unknown>; BOUTONS: { id?: string; sel?: string }[]; CHAMPS: unknown; MENUS: Record<string, unknown>;
    };
    Visite: unknown;
  };
}

// Chaque texte d'un objet, avec son chemin. Une chaîne sans espace est un identifiant (une visite, un
// sélecteur, une couleur), pas une phrase.
function phrases(o: unknown, chemin: string, out: string[], vus = new Set<unknown>()) {
  if (typeof o === 'string') {
    if (/\s/.test(o) && INTERDIT.test(o)) out.push(`${chemin} : ${o.replace(/<[^>]+>/g, '').slice(0, 160)}`);
    return;
  }
  if (!o || typeof o !== 'object' || vus.has(o)) return;
  vus.add(o);
  for (const k of Object.keys(o)) {
    let v: unknown;
    try { v = (o as Record<string, unknown>)[k]; } catch { continue; }
    phrases(v, `${chemin}.${k}`, out, vus);
  }
}
const sauf = <T>(o: Record<string, T>, cles: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !cles.includes(k)));

describe('le Cabinet sans paquets, dans tous ses textes', () => {
  const { cabinet, CabGuide: G, CabVisites: CV, Visite } = charger();
  const visites = CV.parcours({
    state: () => ({ cabinet: { name: 'Cabinet Ennour' }, dossiers: [], settings: {} }), dossier: () => null, exercices: () => [],
    estExemple: () => false, cleSecours: () => null, copieExterne: () => false, ecritures: () => 0, brouillards: () => 0,
    releves: () => null, avecLivre: () => new Set(), livres: () => 0, Visite,
  });

  it('chaque visite proposée en ligne, chaque écran, bouton et champ qu\'une visite explique, se lit sans un mot de paquet', () => {
    const trouve: string[] = [];
    const proposees = visites.filter((v) => !cabinet.visitesAbsentes.includes(v.id));
    for (const v of proposees) phrases(v, `visite ${v.id}`, trouve);
    phrases(CV.THEMES, 'famille', trouve);
    phrases(sauf(CV.PAGES, JAMAIS_MONTRE.pages), 'écran', trouve);
    phrases(sauf(CV.ONGLETS, JAMAIS_MONTRE.onglets), 'onglet', trouve);
    phrases(sauf(CV.MENUS, JAMAIS_MONTRE.menus), 'menu', trouve);
    phrases(CV.ZONES.filter((z) => !JAMAIS_MONTRE.zones.includes(z.sel)), 'bloc', trouve);
    phrases(CV.BOUTONS.filter((b) => !JAMAIS_MONTRE.boutons.includes(b.id ? `#${b.id}` : String(b.sel))), 'bouton', trouve);
    phrases(CV.CHAMPS, 'champ', trouve);
    expect(trouve).toEqual([]);
    // Le test lit vraiment quelque chose : des dizaines de visites, et celles qui sont absentes le sont.
    expect(proposees.length).toBeGreaterThan(40);
    expect(proposees.map((v) => v.id)).not.toContain('recevoir-paquet');
  });

  it('chaque bulle « i » et chaque article de l\'Aide se lit sans un mot de paquet', () => {
    const trouve: string[] = [];
    phrases(sauf(G.INFO, JAMAIS_MONTRE.bulles), 'bulle', trouve);
    phrases(G.ARTICLES, 'article', trouve);
    expect(trouve).toEqual([]);
    // Les articles sans objet en ligne ne sont plus proposés ; les autres le sont tous.
    expect(G.ARTICLES.map((a) => a.id)).not.toContain('filets');
    expect(G.ARTICLES.length).toBeGreaterThan(10);
    expect(Object.keys(G.INFO).length).toBeGreaterThan(100);
  });

  it('ce qui est déclaré « jamais montré » existe encore : une liste qui nomme un disparu ne protège rien', () => {
    const pages = Object.keys(CV.PAGES), onglets = Object.keys(CV.ONGLETS), menus = Object.keys(CV.MENUS), bulles = Object.keys(G.INFO);
    const boutons = CV.BOUTONS.map((b) => (b.id ? `#${b.id}` : String(b.sel)));
    expect(JAMAIS_MONTRE.pages.filter((x) => !pages.includes(x))).toEqual([]);
    expect(JAMAIS_MONTRE.onglets.filter((x) => !onglets.includes(x))).toEqual([]);
    expect(JAMAIS_MONTRE.menus.filter((x) => !menus.includes(x))).toEqual([]);
    expect(JAMAIS_MONTRE.zones.filter((x) => !CV.ZONES.some((z) => z.sel === x))).toEqual([]);
    expect(JAMAIS_MONTRE.boutons.filter((x) => !boutons.includes(x))).toEqual([]);
    expect(JAMAIS_MONTRE.bulles.filter((x) => !bulles.includes(x))).toEqual([]);
    // Et chaque visite ou article déclaré absent par le point de contact existe dans le Cabinet v10.
    expect(cabinet.visitesAbsentes.filter((x) => !visites.some((v) => v.id === x))).toEqual([]);
  });
});
