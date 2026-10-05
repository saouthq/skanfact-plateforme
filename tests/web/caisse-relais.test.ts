// Changer de caissier, à l'écran (brique 123 ; 03 § 6 ; docs/caisse.md, R1 à R5). Leila, caissière, pose son code de
// caisse depuis son téléphone. Au comptoir, Sami a ouvert la caisse et vendu une huile ; à la relève, « Changer de
// caissier… », Leila, un code faux (la caisse reste à Sami), puis le bon : la page se relit au nom de Leila, la caisse
// reste ouverte, son lait porte son nom, et elle ne voit pas l'huile de Sami.

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

describe('changer de caissier, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-relais-'));
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
  const net = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const annee = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).slice(0, 4);
  // Une personne connectée sur un appareil, et la page Caisse ouverte dans son navigateur.
  const ouvrir = async (jeton: string, ent: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    // Le jeton du départ, une seule fois, gardé comme la connexion le garde sur SON appareil : dans la session ET dans la
    // mémoire du navigateur (web/src/api.ts). Au changement de caissier, la page garde celui qu'elle a reçu — aux deux
    // endroits (vu à la main le 01/10/2026 : seul le second était remplacé, et la caisse retombait sur la connexion).
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || sessionStorage.getItem('skanfact.jeton') || localStorage.getItem('skanfact.jeton')) return;
      sessionStorage.setItem('skanfact.jeton', j); localStorage.setItem('skanfact.jeton', j);
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await allerALaCaisse(p, ent);
    return { cx, p, erreurs };
  };
  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
  const allerALaCaisse = async (p: Page, ent: string) => {
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#nav a[data-route="caisse"]').count(), { timeout: 10_000 }).toBe(1);
    await p.locator('#nav a[data-route="caisse"]').click();
    // L'état de la caisse, lu au serveur, se dit dans la barre du haut.
    await expect.poll(() => p.locator('#cs-puce, #cs-ouverte').count(), { timeout: 20_000 }).toBe(1);
  };

  it('Leila pose son code, puis prend la caisse de Sami ; ses tickets portent son nom', async () => {
    const email = `nadia-relais-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau de Nadia', type: 'navigateur' } });
    const nadia = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', nadia, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nadia);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'lait', rang: 0, revision: null, contenu: { id: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', unitPrice: { '~n': '2.35' }, vatRate: 19 } },
      { collection: 'catalog', cle: 'huile', rang: 1, revision: null, contenu: { id: 'huile', label: 'Huile d\'olive 1 L', unit: 'u', unitPrice: { '~n': '12.5' }, vatRate: 19 } },
    ] })).statut).toBe(200);
    const caissier = async (prenom: string, appareil: string) => {
      const e = `${prenom.toLowerCase()}-relais-${Date.now()}@exemple.tn`;
      await api('POST', '/inscription', undefined, { email: e, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
      const j = String((await api('POST', '/connexion', undefined, { email: e, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } })).corps.jeton);
      const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia, { email: e, roles: ['caissier'] })).corps.jeton);
      expect((await api('POST', '/invitations/accepter', j, { jeton: inv })).statut).toBe(200);
      return j;
    };
    const sami = await caissier('Sami', 'Caisse du comptoir');
    const leila = await caissier('Leila', 'Téléphone de Leila');

    // Leila, sur son téléphone : « Mon code de caisse… », dans le menu de la caisse. Deux codes différents, puis un code
    // trop simple, puis le sien.
    const telephone = await ouvrir(leila, ent);
    const t = telephone.p;
    await t.locator('#cs-menu-bouton').click();
    await t.locator('#cs-mon-code').click();
    const refusCode = async () => net(await t.locator('#modal-root #cs-code-refus').innerText());
    await t.locator('#modal-root #cs-nouveau').fill('4827');
    await t.locator('#modal-root #cs-nouveau-bis').fill('4828');
    await t.locator('#modal-root #cs-code-ok').click();
    await expect.poll(refusCode).toBe('Les deux codes ne sont pas les mêmes : retape-le.');
    await t.locator('#modal-root #cs-nouveau').fill('1234');
    await t.locator('#modal-root #cs-nouveau-bis').fill('1234');
    await t.locator('#modal-root #cs-code-ok').click();
    await expect.poll(refusCode, { timeout: 10_000 }).toBe('Le code 1234 se devine trop vite (chiffres répétés ou qui se suivent) : choisis-en un autre. Rien n\'a été changé.');
    await t.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'relais-1-code-trop-simple.png') });
    await t.locator('#modal-root #cs-nouveau').fill('4827');
    await t.locator('#modal-root #cs-nouveau-bis').fill('4827');
    await t.locator('#modal-root #cs-code-ok').click();
    await expect.poll(async () => net(await t.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toBe('Ton code de caisse est enregistré.');
    // Son téléphone ne tient pas la caisse : il ne change pas de caissier.
    expect(await t.locator('#cs-relais, #cs-relais-menu').count()).toBe(0);
    await telephone.cx.close();
    expect(telephone.erreurs).toEqual([]);

    // Au comptoir, Sami ouvre la caisse et vend une huile.
    const comptoir = await ouvrir(sami, ent);
    const p = comptoir.p;
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^La caisse est fermée\./);
    await p.locator('#cs-fond').fill('30');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ouverte par Sami /);
    const auPoste = async (page: Page) => net(await page.locator('#cs-moi').innerText().catch(() => ''));
    expect(await auPoste(p)).toBe('Sami');
    await p.locator('#cs-articles .cs-art', { hasText: 'Huile d\'olive' }).click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-valider').click();
    const toast = async () => net(await p.locator('#toast').innerText().catch(() => ''));
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-001 encaissé`);
    await p.locator('#cs-nouvelle').click();

    // La relève : son nom, en haut (« Changer de caissier »). Leila est la seule autre à avoir posé son code ; un code
    // faux la laisse à Sami.
    await p.locator('#cs-relais').click();
    await expect.poll(async () => net(await p.locator('#modal-root #cs-caissiers').innerText().catch(() => '')), { timeout: 10_000 }).toBe('Leila');
    expect(await p.locator('#modal-root input[name="cs-caissier"]:checked').count()).toBe(1);
    await p.locator('#modal-root #cs-code').fill('4828');
    await p.locator('#modal-root #cs-prendre').click();
    await expect.poll(async () => net(await p.locator('#modal-root #cs-relais-refus').innerText()), { timeout: 10_000 }).toBe('Ce code ne correspond pas : la caisse reste à Sami.');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'relais-2-code-faux.png') });
    // Le bon code : la page se relit au nom de Leila ; la caisse reste ouverte, ouverte par Sami.
    await p.locator('#modal-root #cs-code').fill('4827');
    await p.locator('#modal-root #cs-code').press('Enter');
    await expect.poll(() => auPoste(p), { timeout: 20_000 }).toBe('Leila');
    expect(net(await p.locator('#cs-ouverte').innerText())).toMatch(/^Ouverte par Sami /);
    await plusTard(p);
    // Le jeton de Sami ne sert plus.
    expect((await api('GET', `/entreprises/${ent}/caisse`, sami)).statut).toBe(401);
    // La caisse rouverte dans un nouvel onglet (comme le lendemain matin) : toujours Leila, jamais la page de connexion.
    const rouverte = await comptoir.cx.newPage();
    await allerALaCaisse(rouverte, ent);
    await expect.poll(() => auPoste(rouverte), { timeout: 20_000 }).toBe('Leila');
    await rouverte.close();

    // Leila vend un lait : le ticket suivant de la même caisse, à son nom ; elle ne voit pas l'huile de Sami.
    await p.locator('#cs-articles .cs-art', { hasText: 'Lait demi-écrémé' }).click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-002 encaissé`);
    await plusTard(p);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(async () => net(await p.locator('#cs-body').innerText()), { timeout: 10_000 }).toContain(`TIC-${annee}-002`);
    expect(net(await p.locator('#cs-body').innerText())).not.toContain(`TIC-${annee}-001`);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'relais-3-leila-a-la-caisse.png') });
    // Nadia, au bureau, voit les deux tickets dans la même session.
    const z = await api('POST', `/entreprises/${ent}/caisse/fermer`, nadia, { compte: '47.672' });
    expect(z.corps.z).toMatchObject({ nombre: 2, premier: `TIC-${annee}-001`, dernier: `TIC-${annee}-002`, ecart: '0.000' });
    await comptoir.cx.close();
    expect(comptoir.erreurs).toEqual([]);
  }, 180_000);
});
