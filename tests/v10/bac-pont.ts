// Le point de contact de la v10 (web/public/plateforme/pont.js) dans un bac à sable, devant un serveur imité : ce qu'il
// demande, ce qu'il ouvre, ce qu'il garde pour la page suivante. Partagé par tests/v10/pont-exemple.test.ts et
// tests/v10/pont-ouverture.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const PONT = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/plateforme/pont.js'), 'utf8');

// `texte` : une réponse qui ne vient pas du serveur (un relais, le frontal), telle quelle.
export type Reponse = { statut: number; corps?: unknown; texte?: string };
export type Routes = Record<string, (corps: unknown) => Reponse>;

// Le point de contact chargé dans l'entreprise `ent`, devant un serveur qui répond par `routes` (« GET /v1/moi ») ; ce
// qu'il ne connaît pas reste sans réponse, comme un serveur lent. `appels` : les demandes auxquelles le serveur imité a
// répondu ; `demandes` : toutes celles posées, dans l'ordre, qu'il ait répondu ou non. `globaux` : ce que la page aurait
// chargé avant lui (une horloge, `SkanAbonnement`…).
export function chargerPont<P>(ent: string, routes: Routes, donnees: Record<string, unknown> = {}, globaux: Record<string, unknown> = {}) {
  const stockage = new Map<string, string>([['skanfact.jeton', 'jeton']]);
  const appels: { cle: string; corps: unknown }[] = [];
  const demandes: string[] = [];
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
      demandes.push(cle);
      const route = routes[cle];
      if (!route) return new Promise(() => undefined);
      const corps = init?.body ? JSON.parse(init.body) : undefined;
      appels.push({ cle, corps });
      const r = route(corps);
      return Promise.resolve({ status: r.statut, ok: r.statut >= 200 && r.statut < 300, text: async () => r.texte ?? JSON.stringify(r.corps ?? {}) });
    },
    ...globaux,
  };
  bac.window = bac;
  bac.self = bac;
  vm.createContext(bac);
  vm.runInContext(PONT, bac, { filename: 'pont.js' });
  return { pont: bac.skanfact as P, stockage, appels, demandes, ouverts };
}
