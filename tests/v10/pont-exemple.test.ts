// L'exemple et la vraie entreprise, au point de contact (retour de Skander, 05/10/2026 ; docs/exemple.md ;
// web/public/plateforme/pont.js). Le point de contact tourne ici dans un bac à sable, devant un serveur imité : ce qu'il
// appelle, ce qu'il ouvre, ce qu'il garde pour la page suivante. Ce qu'il garantit :
//   - depuis une vraie entreprise, l'exemple ouvre l'entreprise d'essai : rien ne se verse jamais ici ;
//   - l'entreprise d'essai déjà remplie ne se remplit pas deux fois ;
//   - encore vide, le serveur la remplit (une fenêtre d'attente l'annonce), puis la page se rouvre sur la visite
//     demandée ; un conflit avec l'enregistrement de départ de la page se redemande, une fois ; un refus se lit en
//     entier, et la fenêtre d'attente se ferme ;
//   - quitter l'exemple ouvre la vraie entreprise, la visite avec elle ; sans vraie entreprise, son nom d'abord, et la
//     visite ne part qu'avec l'entreprise créée (une fenêtre fermée sans créer ne laisse rien en attente).
// Le parcours entier, à l'écran : tests/web/exemple.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const PONT = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/plateforme/pont.js'), 'utf8');
const ESSAI = '00000000-0000-4000-8000-0000000000e5';
const VRAIE = '00000000-0000-4000-8000-0000000000a1';
const NEUVE = '00000000-0000-4000-8000-0000000000b2';

type Reponse = { statut: number; corps?: unknown };
type Pont = {
  exemple: (o: { visite?: string; attendre?: () => unknown }) => Promise<Record<string, unknown>>;
  quitterExemple: (o: { visite?: string }) => Promise<Record<string, unknown>>;
  addDossier: (o: { name?: string; visite?: string }) => Promise<Record<string, unknown>>;
};

// Le point de contact chargé dans l'entreprise `ent`, devant un serveur qui répond par `routes` (« GET /v1/moi ») ; ce
// qu'il ne connaît pas reste sans réponse, comme un serveur lent.
function charger(ent: string, routes: Record<string, (corps: unknown) => Reponse>, donnees: Record<string, unknown> = {}) {
  const stockage = new Map<string, string>([['skanfact.jeton', 'jeton']]);
  const appels: { cle: string; corps: unknown }[] = [];
  const ouverts: string[] = [];
  const etat = { recharges: 0 };
  const element = () => ({
    style: {}, classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined, contains: () => false },
    setAttribute: () => undefined, appendChild: () => undefined, addEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [],
  });
  const bac: Record<string, unknown> = {
    sessionStorage: { getItem: (k: string) => stockage.get(k) ?? null, setItem: (k: string, v: string) => { stockage.set(k, String(v)); }, removeItem: (k: string) => { stockage.delete(k); } },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    location: { search: `?e=${ent}`, pathname: '/v10/', hash: '', replace: () => undefined, assign: (u: string) => { ouverts.push(u); }, reload: () => { etat.recharges++; } },
    document: { createElement: element, head: element(), body: element(), documentElement: element(), addEventListener: () => undefined, removeEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [] },
    URLSearchParams, console, navigator: { onLine: true }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    MutationObserver: class { observe() { return undefined; } disconnect() { return undefined; } },
    SkanPoste: new Proxy({}, { get: () => () => undefined }),
    __data: donnees,
    fetch: (url: string, init?: { method?: string; body?: string }) => {
      const cle = `${init?.method ?? 'GET'} ${url}`;
      const route = routes[cle];
      if (!route) return new Promise(() => undefined);
      const corps = init?.body ? JSON.parse(init.body) : undefined;
      appels.push({ cle, corps });
      const r = route(corps);
      return Promise.resolve({ status: r.statut, ok: r.statut >= 200 && r.statut < 300, text: async () => JSON.stringify(r.corps ?? {}) });
    },
  };
  bac.window = bac;
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(PONT, bac, { filename: 'pont.js' });
  return { pont: bac.skanfact as Pont, stockage, appels, ouverts, etat };
}
const moi = (...entreprises: { id: string; essai: boolean }[]) => ({ 'GET /v1/moi': () => ({ statut: 200, corps: { entreprises } }) });
const versements = (appels: { cle: string }[]) => appels.filter((a) => a.cle.endsWith('/exemple')).map((a) => a.cle);

describe('l\'exemple et la vraie entreprise, au point de contact', () => {
  it('depuis une vraie entreprise, l\'exemple ouvre l\'entreprise d\'essai : rien ne se verse ici', async () => {
    const t = charger(VRAIE, moi({ id: ESSAI, essai: true }, { id: VRAIE, essai: false }));
    expect(await t.pont.exemple({ visite: '' })).toEqual({});
    expect(t.ouverts).toEqual([`/v10/?e=${ESSAI}`]);
    expect(t.stockage.get('skanfact.visite')).toBe('exemple');
    expect(versements(t.appels)).toEqual([]);
  });

  it('sans entreprise d\'essai encore, elle se crée puis s\'ouvre ; une création refusée ne laisse aucune visite en attente', async () => {
    const t = charger(VRAIE, { ...moi({ id: VRAIE, essai: false }), 'POST /v1/entreprises-essai': () => ({ statut: 201, corps: { id: ESSAI } }) });
    expect(await t.pont.exemple({ visite: '' })).toEqual({});
    expect(t.ouverts).toEqual([`/v10/?e=${ESSAI}`]);
    expect(t.stockage.get('skanfact.visite')).toBe('exemple');
    const refus = charger(VRAIE, { ...moi({ id: VRAIE, essai: false }), 'POST /v1/entreprises-essai': () => ({ statut: 500 }) });
    await expect(refus.pont.exemple({ visite: '' })).rejects.toThrow();
    expect(refus.stockage.has('skanfact.visite')).toBe(false);
    expect(refus.ouverts).toEqual([]);
  });

  it('l\'entreprise d\'essai déjà remplie ne se remplit pas deux fois', async () => {
    const t = charger(ESSAI, moi({ id: ESSAI, essai: true }), { demo: true });
    expect(await t.pont.exemple({ visite: 'decouvrir' })).toEqual({ pret: true });
    expect(versements(t.appels)).toEqual([]);
    expect(t.etat.recharges).toBe(0);
  });

  it('encore vide, le serveur la remplit derrière une fenêtre d\'attente, puis la page se rouvre sur la visite demandée ; un conflit se redemande une fois', async () => {
    let n = 0;
    const t = charger(ESSAI, { ...moi({ id: ESSAI, essai: true }), [`POST /v1/entreprises/${ESSAI}/exemple`]: () => (++n === 1
      ? { statut: 409, corps: { motif: 'Quelqu\'un d\'autre vient de modifier ce dossier : rien n\'a été enregistré.' } }
      : { statut: 200, corps: { deja: false, pieces: 640 } }) });
    let fenetres = 0;
    expect(await t.pont.exemple({ visite: 'decouvrir', attendre: () => { fenetres++; return () => undefined; } })).toEqual({});
    expect(versements(t.appels)).toEqual([`POST /v1/entreprises/${ESSAI}/exemple`, `POST /v1/entreprises/${ESSAI}/exemple`]);
    expect(fenetres).toBe(1);
    expect(t.etat.recharges).toBe(1);
    expect(t.stockage.get('skanfact.visite')).toBe('decouvrir');
  });

  it('un refus se lit en entier, la fenêtre d\'attente se ferme, et rien ne se rouvre', async () => {
    const motif = 'Ton entreprise d\'essai a déjà tes propres pièces : l\'exemple ne s\'y ajoute pas. Rien n\'a été fait.';
    const t = charger(ESSAI, { ...moi({ id: ESSAI, essai: true }), [`POST /v1/entreprises/${ESSAI}/exemple`]: () => ({ statut: 403, corps: { motif } }) });
    let fermee = 0;
    expect(await t.pont.exemple({ visite: 'decouvrir', attendre: () => () => { fermee++; } })).toEqual({ motif });
    expect(fermee).toBe(1);
    expect(t.etat.recharges).toBe(0);
    expect(t.stockage.has('skanfact.visite')).toBe(false);
  });

  it('quitter l\'exemple sans vraie entreprise : son nom d\'abord ; la visite part avec l\'entreprise créée, jamais avant', async () => {
    const t = charger(ESSAI, { ...moi({ id: ESSAI, essai: true }), 'POST /v1/entreprises': () => ({ statut: 201, corps: { id: NEUVE } }) });
    expect(await t.pont.quitterExemple({ visite: 'premiers-pas' })).toEqual({ aCreer: true });
    // La fenêtre du nom peut se fermer sans créer : rien n'attend la page suivante.
    expect(t.stockage.has('skanfact.visite')).toBe(false);
    expect(t.ouverts).toEqual([]);
    expect(await t.pont.addDossier({ name: 'Quincaillerie El Amen', visite: 'premiers-pas' })).toEqual({ ok: true });
    expect(t.appels.find((a) => a.cle === 'POST /v1/entreprises')?.corps).toEqual({ raisonSociale: 'Quincaillerie El Amen' });
    expect(t.stockage.get('skanfact.visite')).toBe('premiers-pas');
    expect(t.ouverts).toEqual([`/v10/?e=${NEUVE}`]);
  });

  it('quitter l\'exemple ouvre la vraie entreprise, la visite avec elle', async () => {
    const t = charger(ESSAI, moi({ id: ESSAI, essai: true }, { id: VRAIE, essai: false }));
    expect(await t.pont.quitterExemple({ visite: 'premiers-pas' })).toEqual({});
    expect(t.ouverts).toEqual([`/v10/?e=${VRAIE}`]);
    expect(t.stockage.get('skanfact.visite')).toBe('premiers-pas');
  });
});
