// Deux postes sur le même dossier (brique 112 ; docs/pont-v10.md). Le point de contact garde ce que le serveur a
// (`vu`) ; après un conflit, il le relit. Un enregistrement de la page parti AVANT qu'elle ait fusionné (ses données
// d'avant le conflit) ne doit rien défaire de ce que l'autre poste a fait :
//   - un objet que l'autre a créé, et que la page n'a jamais eu, ne se supprime pas ;
//   - un objet que l'autre a changé ne s'écrase pas : le serveur le dit (conflit), la page fusionne.
// En CI, le minutage d'un poste lent faisait disparaître l'article posé par un autre (accords) et le compte Konnect
// créé par le serveur (jalon J2) ; ici, le même enchaînement est joué pas à pas, sans dépendre du minutage.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('deux postes sur le même dossier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-concurrent-'));
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

  it('un enregistrement parti avant la fusion ne supprime pas ce que l\'autre poste a créé, ni n\'écrase ce qu\'il a changé ; ce qu\'elle a, la page le supprime et le modifie', async () => {
    const email = `nadia-concurrent-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const defi = (await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.defi;
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr' } },
    ] })).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];

    // Le poste de Nadia ouvre le dossier.
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    // Ce que la page a (le dossier tel qu'elle l'a lu), gardé pour rejouer « ses données d'avant ».
    await p.evaluate(async () => { const w = window as unknown as { skanfact: { loadData: () => Promise<{ data: unknown }> }; __avant: unknown }; w.__avant = JSON.parse(JSON.stringify((await w.skanfact.loadData()).data)); });

    // Un autre poste : un article neuf, et le client renommé.
    const c1 = (await objets()).find((o) => o.cle === 'c1');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unitPrice: 25, vatRate: 19 } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: c1?.revision, contenu: { id: 'c1', name: 'Chantier Ennasr — lot B' } },
    ] })).statut).toBe(200);

    // La page enregistre le client renommé de son côté : le serveur dit « conflit » (le point de contact relit).
    // Puis, avant d'avoir fusionné, elle enregistre encore ses données d'avant (un client de plus).
    type Donnees = { catalog: { id: string }[]; clients: { id: string; name: string }[] };
    type Fenetre = { skanfact: { saveData: (d: unknown) => Promise<unknown>; loadData: () => Promise<{ data: Donnees }> }; __avant: Donnees; __disque: Donnees };
    const [r1, r2, r1b] = await p.evaluate(async () => {
      const w = window as unknown as Fenetre;
      const court = (x: unknown) => (x && typeof x === 'object' && 'conflict' in x ? 'conflit' : String(x));
      const d1 = JSON.parse(JSON.stringify(w.__avant)) as Donnees;
      for (const c of d1.clients) if (c.id === 'c1') c.name = 'Chantier Ennasr (page)';
      const r = await w.skanfact.saveData(d1);
      if (r && typeof r === 'object' && 'disk' in r) w.__disque = JSON.parse(JSON.stringify((r as { disk: Donnees }).disk));
      // Ses données d'avant telles quelles (le client sous son ancien nom) : elles n'écrasent pas le nom que l'autre
      // poste lui a donné, le serveur dit « conflit ».
      const d1b = JSON.parse(JSON.stringify(w.__avant)) as Donnees;
      d1b.clients.push({ id: 'c4', name: 'Atelier Ben Salah' });
      const r1b = court(await w.skanfact.saveData(d1b));
      // Ses données d'avant, où le client porte déjà le nom de l'autre poste (rien n'y fait conflit) : seul l'article
      // lui manque, qu'elle n'a jamais eu.
      const d2 = JSON.parse(JSON.stringify(w.__avant)) as Donnees;
      for (const c of d2.clients) if (c.id === 'c1') c.name = 'Chantier Ennasr — lot B';
      d2.clients.push({ id: 'c2', name: 'Quincaillerie du Port' });
      return [court(r), court(await w.skanfact.saveData(d2)), r1b];
    });
    expect(r1).toBe('conflit');
    expect(r1b).toBe('conflit');
    // Ce que l'autre poste a fait est intact : l'article, et le nom qu'il a donné au client.
    let srv = await objets();
    expect(srv.filter((o) => o.collection === 'catalog').map((o) => o.cle), `le second enregistrement a répondu « ${r2} »`).toEqual(['ciment']);
    expect(srv.find((o) => o.cle === 'c1')?.contenu.name).toBe('Chantier Ennasr — lot B');
    expect(r2).toBe('true');
    expect(srv.some((o) => o.cle === 'c2')).toBe(true);

    // La page fusionne (la version du serveur gagne, comme mergeData) et ajoute un client ; puis, sur ce qu'elle a
    // désormais, elle retire l'article, renomme le client, le renomme encore : des gestes ordinaires, qui passent.
    const etapes = await p.evaluate(async () => {
      const w = window as unknown as Fenetre;
      const court = (x: unknown) => (x && typeof x === 'object' && 'conflict' in x ? 'conflit' : String(x));
      const d = JSON.parse(JSON.stringify(w.__disque)) as Donnees;
      d.clients.push({ id: 'c3', name: 'Menuiserie El Amel' });
      const a = court(await w.skanfact.saveData(d));
      d.catalog = d.catalog.filter((x) => x.id !== 'ciment');
      for (const c of d.clients) if (c.id === 'c1') c.name = 'Chantier Ennasr — lot C';
      const b = court(await w.skanfact.saveData(d));
      for (const c of d.clients) if (c.id === 'c1') c.name = 'Chantier Ennasr — lot D';
      const c = court(await w.skanfact.saveData(d));
      return [a, b, c];
    });
    expect(etapes).toEqual(['true', 'true', 'true']);
    srv = await objets();
    expect(srv.filter((o) => o.collection === 'catalog')).toEqual([]);
    expect(srv.find((o) => o.cle === 'c1')?.contenu.name).toBe('Chantier Ennasr — lot D');

    // Rouverte, la page a tout : elle retire le client qu'elle avait ajouté (la fusion, partie du disque d'avant le
    // second enregistrement, avait déjà retiré l'autre).
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    const r3 = await p.evaluate(async () => {
      const w = window as unknown as Fenetre;
      const d = JSON.parse(JSON.stringify((await w.skanfact.loadData()).data)) as Donnees;
      d.clients = d.clients.filter((c) => c.id !== 'c3');
      const r = await w.skanfact.saveData(d);
      return r && typeof r === 'object' && 'conflict' in r ? 'conflit' : String(r);
    });
    expect(r3).toBe('true');
    expect((await objets()).filter((o) => o.collection === 'clients').map((o) => o.cle).sort()).toEqual(['c1']);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
