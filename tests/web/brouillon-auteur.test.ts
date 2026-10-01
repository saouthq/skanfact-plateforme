// Supprimer un brouillon : les siens, à la souris (brique 117 ; docs/droits-dossier.md). Lina, commerciale, ouvre le
// devis que Karim a préparé : « Supprimer » se refuse avant même la question, en nommant Karim, et rien ne part ;
// son propre devis, elle le supprime.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('supprimer un brouillon : les siens, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-auteur-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
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
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const devis = (id: string) => ({ id, type: 'devis', number: '', status: 'brouillon', date: '2026-10-01', clientId: 'c1', createdAt: 1, subject: '',
    lines: [{ label: 'Table en chêne', qty: 2, unit: 'u', unitPrice: { '~n': '450.5' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, payments: [] });

  it('Lina ne supprime pas le devis de Karim, et le sien oui', async () => {
    const email = `nadia-auteur-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Meubles Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Café El Walima' } }] })).statut).toBe(200);
    const commercial = async (prenom: string) => {
      const mail = `${prenom.toLowerCase()}-auteur-${Date.now()}@exemple.tn`;
      await api('POST', '/inscription', undefined, { email: mail, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
      const j = String((await api('POST', '/connexion', undefined, { email: mail, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
      const inv = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: mail, roles: ['commercial'] })).corps.jeton);
      expect((await api('POST', '/invitations/accepter', j, { jeton: inv })).statut).toBe(200);
      return j;
    };
    const karim = await commercial('Karim');
    const lina = await commercial('Lina');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, karim, { changements: [{ collection: 'documents', cle: 'dk', rang: 0, revision: null, contenu: devis('dk') }] })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, lina, { changements: [{ collection: 'documents', cle: 'dl', rang: 1, revision: null, contenu: devis('dl') }] })).statut).toBe(200);
    const surLeServeur = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string }[])
      .filter((o) => o.collection === 'documents').map((o) => o.cle).sort();

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, lina);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async (pg: Page, id: string) => {
      await pg.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/${id}`);
      await expect.poll(() => pg.locator('#view h1').first().innerText().then(net), { timeout: 20_000 }).toMatch(/^Devis/);
      for (let i = 0; i < 3 && await pg.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await pg.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    };
    const supprimer = async () => {
      if (await p.locator('#more-btn').count()) await p.locator('#more-btn').click();
      await p.locator('#del').click();
    };

    // Le devis de Karim : refusé avant la question, en nommant Karim ; rien ne part.
    await ouvrir(p, 'dk');
    await supprimer();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Ce brouillon a été fait par Karim : seul son auteur, le propriétaire ou un administrateur le supprime. Rien n\'a été supprimé.');
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'auteur-1-refus.png') });
    expect(await surLeServeur()).toEqual(['dk', 'dl']);

    // Le sien : la question, puis il disparaît du serveur.
    await ouvrir(p, 'dl');
    await supprimer();
    await p.locator('#modal-root #ok').click();
    await expect.poll(surLeServeur, { timeout: 10_000 }).toEqual(['dk']);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
