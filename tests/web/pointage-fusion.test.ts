// 16 § 10.1, urgence 2 (nuit du 03/11/2026) : le pointage se fusionne case par case, par le vrai chemin (la page, le point
// de contact, le serveur). Avant, il n'était pas dans la fusion : dès qu'un enregistrement était refusé pour un conflit —
// même sur un client changé par un collègue —, la page reprenait le pointage du serveur et perdait le sien sans un mot.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
// Ce que le test lit de la page de la v10 (les données en mémoire, le moteur, l'enregistrement, la dernière fusion).
type Page10 = { __data: { employees: { id: string }[]; clients: { id: string; name: string }[] }; SkanCore: { poserPointage: (d: unknown, e: unknown, y: number, m: number, j: number, code: string) => boolean }; __enregistrerMaintenant: () => Promise<unknown>; __lastMerge?: { conflicts: { kind: string }[] } };

describe('le pointage de deux postes sur le même dossier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-pointage-fusion-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
  // Une entreprise, Ali (pointé en octobre : malade le 02, absent le 03), un client ; la page ouverte et au repos.
  const monter = async () => {
    const email = `nadia-pointage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const defi = (await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.defi;
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr' } },
      { collection: 'employees', cle: 'ali', rang: 0, revision: null, contenu: { id: 'ali', name: 'Ali Ben Salah', hireDate: '2020-01-01', grossSalary: { '~n': '1450.375' }, contract: 'cdi', active: true } },
      { collection: 'timesheets', cle: 'pt-ali-2026-10', rang: 0, revision: null, contenu: { id: 'pt-ali-2026-10', employeeId: 'ali', year: 2026, month: 10, jours: { 2: 'M', 3: 'A' }, hs: {} } },
    ] })).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.evaluate(async () => { await (window as unknown as { __enregistrerMaintenant: () => Promise<unknown> }).__enregistrerMaintenant(); });
    // L'autre poste écrit dans la révision qu'il a lue.
    const ailleurs = async (collection: string, cle: string, changer: (c: Record<string, unknown>) => void) => {
      const o = (await objets()).find((x) => x.collection === collection && x.cle === cle) as Objet;
      const contenu = JSON.parse(JSON.stringify(o.contenu)) as Record<string, unknown>;
      changer(contenu);
      expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection, cle, rang: 0, revision: o.revision, contenu }] })).statut).toBe(200);
    };
    // La page note le 05 (absent) et efface le 03 (revenu à « présent »), puis enregistre comme l'écran le fait.
    const noter = (renommer: boolean) => p.evaluate(async (renommer) => {
      const w = window as unknown as Page10;
      const d = w.__data, e = d.employees.find((x) => x.id === 'ali'), c1 = d.clients.find((c) => c.id === 'c1');
      w.SkanCore.poserPointage(d, e, 2026, 10, 5, 'A');
      w.SkanCore.poserPointage(d, e, 2026, 10, 3, 'P');
      if (renommer && c1) c1.name = 'Chantier Ennasr (page)';
      await w.__enregistrerMaintenant();
      return w.__lastMerge ? w.__lastMerge.conflicts.map((c) => c.kind) : null;
    }, renommer);
    return { objets, ailleurs, noter, erreurs, fermer: () => cx.close() };
  };

  it('un poste note pendant qu\'un autre change un client : la journée notée et la case effacée tiennent, seul le client est en conflit', async () => {
    const x = await monter();
    await x.ailleurs('clients', 'c1', (c) => { c.name = 'Chantier Ennasr — lot B'; });
    expect(await x.noter(true)).toEqual(['clients']);
    const srv = await x.objets();
    expect(srv.filter((o) => o.collection === 'timesheets').map((o) => o.contenu.jours)).toEqual([{ 2: 'M', 5: 'A' }]);
    expect(srv.find((o) => o.cle === 'c1')?.contenu.name).toBe('Chantier Ennasr — lot B');
    expect(x.erreurs).toEqual([]);
    await x.fermer();
  }, 120_000);

  it('deux postes notent le même mois : chaque journée reste, la case effacée ne revient pas, aucun conflit', async () => {
    const x = await monter();
    await x.ailleurs('timesheets', 'pt-ali-2026-10', (t) => { (t.jours as Record<string, string>)['9'] = 'D'; });
    expect(await x.noter(false)).toEqual([]);
    const srv = await x.objets();
    expect(srv.filter((o) => o.collection === 'timesheets').map((o) => o.contenu.jours)).toEqual([{ 2: 'M', 5: 'A', 9: 'D' }]);
    expect(x.erreurs).toEqual([]);
    await x.fermer();
  }, 120_000);
});
