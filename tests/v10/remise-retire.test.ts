// Un appareil retiré remet ce qu'il avait fait sans réseau (briques 74 et 74 bis ; docs/hors-ligne.md, H9 et H10), au
// point de contact (web/public/plateforme/pont.js), dans un bac à sable, devant un serveur imité.
//
// Vu sur GitHub le 09/10/2026 (tests/web/quarantaine.test.ts, une fois sur trois sur un poste chargé) : la session se
// disait finie par un premier appel (celui du compte) AVANT que la page ait relu la copie du poste. La remise se
// comparait alors à rien : un client renommé hors ligne partait comme « ajouté », et chaque réglage du dossier comme
// changé (« 42 réglages du dossier »). Ce que le point de contact garantit : la remise part de la copie du poste,
// quel que soit l'appel qui apprend que l'appareil est retiré.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const PONT = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/plateforme/pont.js'), 'utf8');
const ENT = '00000000-0000-4000-8000-0000000000b7';

type Changement = { collection: string; cle: string; revision: number | null; contenu: unknown };

describe('un appareil retiré remet ce qu\'il avait fait sans réseau', () => {
  it('la remise part de la copie du poste, même quand l\'appel du compte apprend le premier que l\'appareil est retiré', async () => {
    // Ce que le poste avait vu du serveur (sa copie), et ce qu'il a fait ensuite sans réseau (son attente) : c1 renommé,
    // c2 créé ; la fiche de l'entreprise n'a pas bougé.
    const societe = { name: 'Épicerie Nadia', currency: 'DT' };
    const copie = { le: '2026-10-09T20:00:00.000Z', contenu: {
      objets: [
        { collection: '_racine', cle: 'company', rang: null, revision: 3, contenu: societe },
        { collection: 'clients', cle: 'c1', rang: 0, revision: 2, contenu: { id: 'c1', name: 'Boulangerie du Lac' } },
      ],
      questions: [], marque: '', profil: '', droits: { cachees: [], lectureSeule: [], ecrivables: [], tout: true, responsable: null, caisse: false },
    } };
    const attente = { contenu: { data: { company: societe, clients: [{ id: 'c1', name: 'Boulangerie du Lac (portable)' }, { id: 'c2', name: 'Café des Arts' }] } } };
    const remises: { entreprise: string; changements: Changement[] }[] = [];
    const routes: Record<string, (corps: unknown) => { statut: number; corps: unknown }> = {
      // Le compte répond le premier : la session est finie, l'appareil est retiré.
      'GET /v1/moi': () => ({ statut: 401, corps: { effacer: true } }),
      'POST /v1/quarantaine': (corps) => { remises.push(corps as { entreprise: string; changements: Changement[] }); return { statut: 200, corps: { recus: 2 } }; },
    };
    const poste: Record<string, unknown> = {
      garde: () => true, limite: () => null,
      lireCopie: async (e: string) => (e === ENT ? copie : null),
      lireAttente: async (e: string) => (e === ENT ? attente : null),
      effacer: async () => undefined,
    };
    const element = () => ({
      style: {}, classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined, contains: () => false },
      setAttribute: () => undefined, appendChild: () => undefined, addEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [],
    });
    const stockage = new Map<string, string>([['skanfact.jeton', 'jeton']]);
    const bac: Record<string, unknown> = {
      sessionStorage: { getItem: (k: string) => stockage.get(k) ?? null, setItem: (k: string, v: string) => { stockage.set(k, String(v)); }, removeItem: (k: string) => { stockage.delete(k); } },
      localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      location: { search: `?e=${ENT}`, pathname: '/v10/', hash: '', replace: () => undefined, assign: () => undefined, reload: () => undefined },
      document: { createElement: element, head: element(), body: element(), documentElement: element(), addEventListener: () => undefined, removeEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [] },
      URLSearchParams, console, navigator: { onLine: true }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
      MutationObserver: class { observe() { return undefined; } disconnect() { return undefined; } },
      SkanPoste: new Proxy(poste, { get: (p, k) => (typeof k === 'string' && k in p ? p[k] : () => undefined) }),
      __data: {},
      fetch: (url: string, init?: { method?: string; body?: string }) => {
        const route = routes[`${init?.method ?? 'GET'} ${url}`];
        if (!route) return new Promise(() => undefined);
        const r = route(init?.body ? JSON.parse(init.body) : undefined);
        return Promise.resolve({ status: r.statut, ok: r.statut >= 200 && r.statut < 300, json: async () => r.corps, text: async () => JSON.stringify(r.corps) });
      },
    };
    bac.window = bac;
    bac.self = bac;
    vm.createContext(bac);
    vm.runInContext(PONT, bac, { filename: 'pont.js' });
    const pont = bac.skanfact as { listDossiers: () => Promise<unknown> };

    // Le menu des entreprises lit le compte avant que la page ait rien relu.
    await pont.listDossiers().catch(() => undefined);
    await expect.poll(() => remises.length).toBe(1);
    const parCle = Object.fromEntries((remises[0]?.changements ?? []).map((c) => [`${c.collection}/${c.cle}`, c]));
    // c1 était au serveur (révision 2) : il est MODIFIÉ ; c2 est ajouté ; la fiche, inchangée, ne part pas.
    expect(Object.keys(parCle).sort()).toEqual(['clients/c1', 'clients/c2']);
    expect(parCle['clients/c1']?.revision).toBe(2);
    expect(parCle['clients/c2']?.revision).toBe(null);
  });
});
