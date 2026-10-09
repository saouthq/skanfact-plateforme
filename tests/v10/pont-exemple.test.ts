// L'exemple et la vraie entreprise, au point de contact (retour de Skander, 05/10/2026 ; lot onboarding, 09/10/2026 ;
// docs/exemple.md, docs/entree.md ; web/public/plateforme/pont.js). Le point de contact tourne ici dans un bac à sable,
// devant un serveur imité : ce qu'il appelle, ce qu'il ouvre, ce qu'il garde pour la page suivante. Ce qu'il garantit :
//   - l'exemple déjà là s'ouvre tel quel ; ailleurs, la page part vers « On prépare l'exemple » (ExemplePrepare.tsx), la
//     visite dans son adresse : rien ne se crée ni ne se verse d'ici ;
//   - l'entreprise d'essai encore vide ne s'ouvre pas sur un accueil vide : elle repart vers sa préparation, la visite
//     demandée avec elle ; celle qui a ses propres pièces s'ouvre telle quelle ; une vraie entreprise au travail ne fait
//     pas lire le compte ;
//   - quitter l'exemple ouvre la vraie entreprise, la visite avec elle ; sans vraie entreprise, la page qui la crée (le
//     chemin du retour et la visite dans son adresse), et rien n'attend la page suivante avant qu'elle soit créée ;
//   - « Nouvelle entreprise… » mène à la même page, avec le chemin du retour ;
//   - le bandeau de l'exemple sait s'il y a une vraie entreprise ; le menu, laquelle est l'entreprise d'essai ; les premiers
//     pas, si l'entreprise ouverte en est une ; le compte se lit une fois pour les gestes d'un même instant.
// Le parcours entier, à l'écran : tests/web/exemple.test.ts et tests/web/exemple-puis-vraie.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const PONT = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/plateforme/pont.js'), 'utf8');
const ESSAI = '00000000-0000-4000-8000-0000000000e5';
const VRAIE = '00000000-0000-4000-8000-0000000000a1';

// `texte` : une réponse qui ne vient pas du serveur (un relais, le frontal), telle quelle.
type Reponse = { statut: number; corps?: unknown; texte?: string };
type Pont = {
  exemple: (o: { visite?: string }) => Promise<Record<string, unknown>>;
  quitterExemple: (o: { visite?: string }) => Promise<Record<string, unknown>>;
  nouvelleEntreprise: () => void;
  aUneVraieEntreprise: () => boolean | null;
  listDossiers: () => Promise<{ dossiers: { id: string; essai: boolean }[] }>;
  etatDuDemarrage: () => Promise<{ essai: boolean }>;
  courrielDuCompte: () => Promise<string>;
  loadData: () => Promise<{ data: Record<string, unknown> }>;
  accords: () => Promise<unknown>;
  assistantDemande: () => boolean;
};

// Le point de contact chargé dans l'entreprise `ent`, devant un serveur qui répond par `routes` (« GET /v1/moi ») ; ce
// qu'il ne connaît pas reste sans réponse, comme un serveur lent.
function charger(ent: string, routes: Record<string, (corps: unknown) => Reponse>, donnees: Record<string, unknown> = {}) {
  const stockage = new Map<string, string>([['skanfact.jeton', 'jeton']]);
  const appels: { cle: string; corps: unknown }[] = [];
  const ouverts: string[] = [];
  const element = () => ({
    style: {}, classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined, contains: () => false },
    setAttribute: () => undefined, appendChild: () => undefined, addEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [],
  });
  // Le poste : rien de gardé (l'ordinateur d'un autre), rien qui attende.
  const poste: Record<string, unknown> = { garde: () => false, limite: () => null, lireCopie: async () => null, lireAttente: async () => null };
  const bac: Record<string, unknown> = {
    sessionStorage: { getItem: (k: string) => stockage.get(k) ?? null, setItem: (k: string, v: string) => { stockage.set(k, String(v)); }, removeItem: (k: string) => { stockage.delete(k); } },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    location: { search: `?e=${ent}`, pathname: '/v10/', hash: '', replace: (u: string) => { ouverts.push(`remplace ${u}`); }, assign: (u: string) => { ouverts.push(u); }, reload: () => undefined },
    document: { createElement: element, head: element(), body: element(), documentElement: element(), addEventListener: () => undefined, removeEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [] },
    URLSearchParams, console, navigator: { onLine: true }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    MutationObserver: class { observe() { return undefined; } disconnect() { return undefined; } },
    SkanPoste: new Proxy(poste, { get: (p, k) => (typeof k === 'string' && k in p ? p[k] : () => undefined) }),
    __data: donnees,
    fetch: (url: string, init?: { method?: string; body?: string }) => {
      const cle = `${init?.method ?? 'GET'} ${url}`;
      const route = routes[cle];
      if (!route) return new Promise(() => undefined);
      const corps = init?.body ? JSON.parse(init.body) : undefined;
      appels.push({ cle, corps });
      const r = route(corps);
      return Promise.resolve({ status: r.statut, ok: r.statut >= 200 && r.statut < 300, text: async () => r.texte ?? JSON.stringify(r.corps ?? {}) });
    },
  };
  bac.window = bac;
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(PONT, bac, { filename: 'pont.js' });
  return { pont: bac.skanfact as Pont, stockage, appels, ouverts };
}
const moi = (...entreprises: { id: string; essai: boolean }[]) => ({ 'GET /v1/moi': () => ({ statut: 200, corps: { email: 'nadia@exemple.tn', entreprises } }) });
const lusDuCompte = (appels: { cle: string }[]) => appels.filter((a) => a.cle === 'GET /v1/moi').length;
// Le dossier d'une entreprise, tel que le serveur le rend : `objets` (la racine, puis les listes).
const dossier = (ent: string, objets: { collection: string; cle: string; contenu: unknown }[]) => ({
  [`GET /v1/entreprises/${ent}/dossier-v10`]: () => ({ statut: 200, corps: { objets: objets.map((o, i) => ({ ...o, rang: o.collection === '_racine' ? null : i, revision: 1 })), droits: { tout: true } } }),
  [`GET /v1/entreprises/${ent}/compta/questions`]: () => ({ statut: 200, corps: { questions: [] } }),
  [`GET /v1/entreprises/${ent}/quarantaine`]: () => ({ statut: 200, corps: { remises: [] } }),
});
const fiche = { collection: '_racine', cle: 'company', contenu: { name: 'Atelier Nadia' } };
const exemple = { collection: '_racine', cle: 'demo', contenu: true };
const unDevis = { collection: 'documents', cle: 'd1', contenu: { id: 'd1', type: 'devis', status: 'brouillon' } };
// Un tour de la boucle des promesses : ce qui devait partir est parti.
const unInstant = () => new Promise((r) => setTimeout(r, 30));

describe('l\'exemple et la vraie entreprise, au point de contact', () => {
  it('l\'exemple déjà là s\'ouvre tel quel : rien ne part vers sa préparation', async () => {
    const t = charger(ESSAI, moi({ id: ESSAI, essai: true }), { demo: true });
    expect(await t.pont.exemple({ visite: 'decouvrir' })).toEqual({ pret: true });
    expect(t.ouverts).toEqual([]);
    expect(t.appels).toEqual([]);
  });

  it('ailleurs, l\'exemple part vers l\'écran qui le prépare, la visite dans son adresse : rien ne se crée ni ne se verse d\'ici', async () => {
    const t = charger(VRAIE, { ...moi({ id: VRAIE, essai: false }), 'POST /v1/entreprises-essai': () => ({ statut: 201, corps: { id: ESSAI } }) });
    expect(await t.pont.exemple({ visite: 'decouvrir' })).toEqual({});
    expect(await t.pont.exemple({ visite: '' })).toEqual({});
    expect(t.ouverts).toEqual(['/?exemple=decouvrir', '/?exemple=exemple']);
    expect(t.appels).toEqual([]);
    // La visite voyage dans l'adresse : rien n'attend la page suivante si la préparation n'aboutit pas.
    expect(t.stockage.has('skanfact.visite')).toBe(false);
  });

  it('l\'entreprise d\'essai encore vide repart vers sa préparation, la visite demandée avec elle ; jamais un accueil vide', async () => {
    const t = charger(ESSAI, { ...moi({ id: ESSAI, essai: true }), ...dossier(ESSAI, [fiche]) });
    t.stockage.set('skanfact.visite', 'decouvrir');
    const ouverte = t.pont.loadData().then(() => 'ouverte');
    expect(await Promise.race([ouverte, unInstant().then(() => 'en attente')])).toBe('en attente');
    expect(t.ouverts).toEqual(['remplace /?exemple=decouvrir']);
    expect(t.stockage.has('skanfact.visite')).toBe(false);
    // Sans visite demandée : l'exemple seul.
    const seule = charger(ESSAI, { ...moi({ id: ESSAI, essai: true }), ...dossier(ESSAI, [fiche]) });
    void seule.pont.loadData();
    await unInstant();
    expect(seule.ouverts).toEqual(['remplace /?exemple=exemple']);
  });

  it('l\'entreprise d\'essai qui a ses propres pièces s\'ouvre telle quelle ; une vraie entreprise au travail ne fait pas lire le compte', async () => {
    const essayee = charger(ESSAI, { ...moi({ id: ESSAI, essai: true }), ...dossier(ESSAI, [fiche, unDevis]) });
    expect((await essayee.pont.loadData()).data.documents).toHaveLength(1);
    expect(essayee.ouverts).toEqual([]);
    const vraie = charger(VRAIE, { ...moi({ id: VRAIE, essai: false }), ...dossier(VRAIE, [fiche, unDevis]) });
    await vraie.pont.loadData();
    expect(vraie.ouverts).toEqual([]);
    expect(lusDuCompte(vraie.appels)).toBe(0);
    // Une vraie entreprise neuve (sans pièce) se lit au compte, et s'ouvre.
    const neuve = charger(VRAIE, { ...moi({ id: VRAIE, essai: false }), ...dossier(VRAIE, [fiche]) });
    await neuve.pont.loadData();
    expect(neuve.ouverts).toEqual([]);
    expect(lusDuCompte(neuve.appels)).toBe(1);
  });

  it('le bandeau de l\'exemple sait s\'il y a une vraie entreprise', async () => {
    const seul = charger(ESSAI, { ...moi({ id: ESSAI, essai: true }), ...dossier(ESSAI, [fiche, exemple, unDevis]) });
    expect(seul.pont.aUneVraieEntreprise()).toBe(null);
    await seul.pont.loadData();
    expect(seul.pont.aUneVraieEntreprise()).toBe(false);
    expect(seul.ouverts).toEqual([]);
    const avec = charger(ESSAI, { ...moi({ id: ESSAI, essai: true }, { id: VRAIE, essai: false }), ...dossier(ESSAI, [fiche, exemple, unDevis]) });
    await avec.pont.loadData();
    expect(avec.pont.aUneVraieEntreprise()).toBe(true);
  });

  it('quitter l\'exemple sans vraie entreprise : la page qui la crée, le chemin du retour et la visite dans son adresse ; rien n\'attend avant qu\'elle soit créée', async () => {
    const t = charger(ESSAI, moi({ id: ESSAI, essai: true }));
    expect(await t.pont.quitterExemple({ visite: 'premiers-pas' })).toEqual({});
    expect(t.ouverts).toEqual([`/?entreprise=exemple&retour=${ESSAI}&visite=premiers-pas`]);
    expect(t.stockage.has('skanfact.visite')).toBe(false);
    expect(t.stockage.has('skanfact.assistant')).toBe(false);
    const sans = charger(ESSAI, moi({ id: ESSAI, essai: true }));
    await sans.pont.quitterExemple({});
    expect(sans.ouverts).toEqual([`/?entreprise=exemple&retour=${ESSAI}`]);
  });

  it('quitter l\'exemple ouvre la vraie entreprise, la visite avec elle', async () => {
    const t = charger(ESSAI, moi({ id: ESSAI, essai: true }, { id: VRAIE, essai: false }));
    expect(await t.pont.quitterExemple({ visite: 'premiers-pas' })).toEqual({});
    expect(t.ouverts).toEqual([`/v10/?e=${VRAIE}`]);
    expect(t.stockage.get('skanfact.visite')).toBe('premiers-pas');
  });

  it('« Nouvelle entreprise… » mène à la page qui la crée, avec le chemin du retour', () => {
    const t = charger(VRAIE, {});
    t.pont.nouvelleEntreprise();
    expect(t.ouverts).toEqual([`/?entreprise=menu&retour=${VRAIE}`]);
  });

  it('le menu dit laquelle est l\'entreprise d\'essai ; les premiers pas, si l\'entreprise ouverte en est une ; le compte se lit une fois pour un même instant', async () => {
    const routes = { ...moi({ id: ESSAI, essai: true }, { id: VRAIE, essai: false }),
      [`GET /v1/entreprises/${ESSAI}/mandat`]: () => ({ statut: 200, corps: { mandat: null } }),
      [`GET /v1/entreprises/${VRAIE}/mandat`]: () => ({ statut: 200, corps: { mandat: null } }) };
    const t = charger(ESSAI, routes);
    const [liste, etat, courriel] = await Promise.all([t.pont.listDossiers(), t.pont.etatDuDemarrage(), t.pont.courrielDuCompte()]);
    expect(liste.dossiers.map((d) => [d.id, d.essai])).toEqual([[ESSAI, true], [VRAIE, false]]);
    expect(etat.essai).toBe(true);
    expect(courriel).toBe('nadia@exemple.tn');
    expect(lusDuCompte(t.appels)).toBe(1);
    expect((await charger(VRAIE, routes).pont.etatDuDemarrage()).essai).toBe(false);
  });

  it('une lecture du compte qui a échoué ne se garde pas : le geste suivant redemande', async () => {
    let n = 0;
    const t = charger(VRAIE, { 'GET /v1/moi': () => (++n === 1 ? { statut: 504, texte: 'upstream request timeout' } : { statut: 200, corps: { email: 'nadia@exemple.tn', entreprises: [] } }) });
    await expect(t.pont.courrielDuCompte()).rejects.toThrow('Le serveur n\'a pas répondu à temps');
    expect(await t.pont.courrielDuCompte()).toBe('nadia@exemple.tn');
    expect(lusDuCompte(t.appels)).toBe(2);
  });

  it('une réponse qui ne vient pas du serveur ne s\'affiche jamais telle quelle, par l\'entreprise comme par le compte', async () => {
    const coupe = 'Le serveur n\'a pas répondu à temps : réessaie dans un instant.';
    for (const reponse of [{ statut: 504, texte: 'upstream request timeout' }, { statut: 200, texte: '<html>Portail du réseau</html>' }, { statut: 502, texte: '' }]) {
      const t = charger(ESSAI, { 'GET /v1/moi': () => reponse, [`GET /v1/entreprises/${ESSAI}/accords`]: () => reponse });
      await expect(t.pont.accords()).rejects.toThrow(coupe);
      await expect(t.pont.quitterExemple({ visite: '' })).rejects.toThrow(coupe);
    }
    // Un refus du serveur, lui, garde sa phrase.
    const refus = charger(ESSAI, { [`GET /v1/entreprises/${ESSAI}/accords`]: () => ({ statut: 403, corps: { motif: 'Ton rôle ne permet pas de voir les demandes d\'accord.' } }) });
    await expect(refus.pont.accords()).rejects.toThrow('Ton rôle ne permet pas de voir les demandes d\'accord.');
  });

  it('l\'assistant de démarrage s\'ouvre dans l\'entreprise qui l\'a demandé, une seule fois, et jamais dans une autre', () => {
    const neuve = charger(VRAIE, {});
    neuve.stockage.set('skanfact.assistant', VRAIE);
    expect(neuve.pont.assistantDemande()).toBe(true);
    expect(neuve.pont.assistantDemande()).toBe(false);
    const autre = charger(ESSAI, {});
    autre.stockage.set('skanfact.assistant', VRAIE);
    expect(autre.pont.assistantDemande()).toBe(false);
    expect(autre.stockage.has('skanfact.assistant')).toBe(false);
  });
});
