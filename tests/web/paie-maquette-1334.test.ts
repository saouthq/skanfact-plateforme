// (1.334.1, L10 ; docs/leger.md) La maquette de la paie (`plateforme/paie-maquette.css`, 148 Ko, toute sous `.pm`) ne part
// plus avec la première ouverture : GitHub mesurait S1 à 1 302 Ko pour un seuil de 1 300. Les deux pages du Personnel
// l'attendent (« Un instant… », puis la page) ; sans réseau et jamais chargée, la Paie le dit et se dessine seule au
// retour du réseau ; posée, elle reprend sa place dans la cascade (juste après paie.css), et ses fenêtres ont leur croix.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { poserMouchard, retirerMouchard } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la maquette de la paie à la demande (1.334.1, L10)', () => {
    let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1334-'));
  beforeAll(async () => {
    await admin.connect();
    await poserMouchard(admin);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await retirerMouchard(admin).catch(() => undefined); await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };

  // La boulangerie : Sarra, propriétaire (avec son code), et Karim, commercial.
  const boulangerie = async () => {
        const email = `sarra-paie-1334-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
        const karimEmail = `karim-paie-1334-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: karimEmail, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await api('POST', '/connexion', undefined, { email: karimEmail, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: karimEmail, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim, { jeton: invitation })).statut).toBe(200);
    return { jeton, ent, karim };
  };

  it('la première ouverture n\'emporte pas la maquette ; la Paie et la fiche d\'un salarié l\'attendent, le disent sans réseau, et se dessinent au retour ; l\'onglet porte le nom, pas la pastille', async () => {
    const { jeton, ent } = await boulangerie();
    // La boulangerie a deux salariés, sans leur n° CNSS ni leur RIB, et un fournisseur neuf.
    const salarie = (id: string, name: string, grossSalary: number, iban: string) => ({ id, name, cin: '', cnss: '', position: 'Boulanger', contract: 'cdi',
      hireDate: '2023-03-01', endDate: '', grossSalary, headOfFamily: false, children: 0, method: 'virement', iban, notes: '', active: true });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: salarie('e1', 'Hédi Trabelsi', 1250, '') },
      { collection: 'employees', cle: 'e2', rang: 1, revision: null, contenu: salarie('e2', 'Amira Ben Salah', 600, '') },
      { collection: 'suppliers', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', name: 'Bois du Sahel' } },
    ] })).statut).toBe(200);
    // La fiche de la boulangerie est faite : l'assistant ne s'ouvre pas par-dessus la paie.
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = objets.find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Gharbi', address: 'Rue de Marseille\n1000 Tunis' } }] })).statut).toBe(200);
    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    const demandes: string[] = [];
    p.on('request', (r) => demandes.push(new URL(r.url()).pathname));
    // 1. La première ouverture : pas un octet de la maquette, et pas de lien vers elle dans la page.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(demandes.filter((d) => d.endsWith('paie-maquette.css'))).toEqual([]);
    expect(await p.locator('link[href*="paie-maquette"]').count()).toBe(0);
    // 2. La Paie, sans réseau pour sa maquette : elle le dit sous son titre, sans dessiner une page sans style.
    await p.route('**/paie-maquette.css*', (r) => r.abort());
    await p.evaluate(() => { location.hash = '#/paie'; });
    await expect.poll(() => p.locator('[data-attente-page]').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe('La paie n\'est pas encore sur ce poste, et le réseau manque : elle s\'ouvre dès qu\'il revient.');
    expect(net(await p.locator('#view h1').first().innerText())).toBe('Paie');
    expect(await p.locator('#p-page').count()).toBe(0);
    expect(await p.locator('link[href*="paie-maquette"]').count()).toBe(0);
    // 3. Le réseau revient : la page se dessine seule, la maquette posée juste après paie.css (sa place dans la cascade).
    await p.unroute('**/paie-maquette.css*');
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    expect(await p.evaluate(() => { const l = document.querySelector('link[href*="paie-maquette"]')?.previousElementSibling; return l instanceof HTMLLinkElement ? new URL(l.href).pathname : null; })).toBe('/plateforme/paie.css');
    expect(await p.locator('link[href*="paie-maquette"]').count()).toBe(1);
    // La maquette s'applique : la page de la Paie à 15 px, et la fenêtre de la maquette a sa croix en haut à droite.
    expect(await p.locator('#p-page').evaluate((x) => getComputedStyle(x).fontSize)).toBe('15px');
    await p.locator('#p-tabs [data-tab="salaries"]').click();
    await p.locator('#new-emp, #p-embaucher').first().click();
    await p.locator('.modal-bg.pm #ef').waitFor({ timeout: 10_000 });
    expect(await p.locator('.modal-bg.pm .fen-x').evaluate((x) => getComputedStyle(x).position)).toBe('absolute');
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#ef').count(), { timeout: 10_000 }).toBe(0);
    // Repasser sur la Paie ne la recharge pas : une seule demande, un seul lien.
    await p.evaluate(() => { location.hash = '#/clients'; });
    await p.evaluate(() => { location.hash = '#/paie'; });
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    expect(await p.locator('link[href*="paie-maquette"]').count()).toBe(1);
    // 4. La fiche d'un salarié, ouverte d'emblée par son adresse : elle attend la maquette elle aussi (ses fenêtres en sont).
    const q = await cx.newPage();
    q.on('pageerror', (e) => erreurs.push(e.message));
    await q.goto(`${serveur.adresse}/v10/?e=${ent}#/salarie/e1`);
    await expect.poll(() => q.locator('#view h1').first().innerText().then(net).catch(() => ''), { timeout: 20_000 }).toContain('Hédi Trabelsi');
    expect(await q.locator('link[href*="paie-maquette"]').count()).toBe(1);
    // L'onglet porte le nom, pas la pastille d'état posée à côté (« Hédi Trabelsi Son n° CNSS et son RIB manquent »), ni celle d'un
    // fournisseur neuf (« Bois du Sahel Nouveau »).
    await expect.poll(() => q.title(), { timeout: 10_000 }).toBe('Hédi Trabelsi — SkanFact');
    expect(net(await q.locator('#view h1 .statut').first().innerText())).toBe('Son n° CNSS et son RIB manquent');
    await q.evaluate(() => { location.hash = '#/fournisseur/f1'; });
    await expect.poll(() => q.locator('#view h1').first().innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('Bois du Sahel');
    expect(net(await q.locator('#view h1 .badge').first().innerText())).toBe('Nouveau');
    await expect.poll(() => q.title(), { timeout: 10_000 }).toBe('Bois du Sahel — SkanFact');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-maquette-1334.png') });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
