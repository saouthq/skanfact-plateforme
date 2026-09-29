// Les écrans du Cabinet v10 sur la plateforme (brique 37 ; docs/cabinet.md), à la souris. Le code des
// écrans est celui du Cabinet v10, copié tel quel ; le point de contact (pont-cabinet.js) le branche
// sur le serveur. Ce que le parcours vérifie :
//   - l'entrée ouvre le cabinet, sans son ancien mot de passe, à qui n'a pas d'entreprise à lui :
//     jamais l'entreprise d'un client, qu'il voit par son mandat ; et « je suis un cabinet
//     comptable » sur la porte crée le cabinet et l'ouvre ;
//   - les dossiers sont le portefeuille du serveur (un mandat accepté, un dossier tenu) ;
//   - le livre d'un dossier est celui que le serveur tient pour l'entreprise : la balance que
//     l'écran du Cabinet calcule (compta.js) est celle du serveur (deux chemins, un chiffre) ;
//   - un geste pas encore en ligne le dit, et ne fait rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  // Le Cabinet dans le navigateur, avec la session de la personne (posée comme l'entrée la pose).
  // Sans cabinet : l'entrée (/), qui choisit ce qu'elle ouvre.
  const ouvrir = async (jeton: string, cabinet: string | null, erreurs: string[]): Promise<Page> => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await p.goto(cabinet ? `${serveur.adresse}/v10/cabinet/?c=${cabinet}` : serveur.adresse);
    return p;
  };

  it('la session ouvre le cabinet ; ses dossiers sont le portefeuille du serveur ; le livre d\'un client est celui du serveur', async () => {
    // Un client, un achat du 3 août dans ses livres ; son cabinet, qui accepte le mandat ; un dossier tenu.
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const envoyer = (collection: string, cle: string, contenu: unknown) =>
      api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    expect((await envoyer('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
    })).statut).toBe(200);
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie Ennour' })).statut).toBe(201);

    const erreurs: string[] = [];
    // L'entrée : l'associé n'a pas d'entreprise à lui ; il voit celle de son client par le mandat, mais
    // c'est son cabinet qui s'ouvre.
    const p = await ouvrir(associe, null, erreurs);
    await p.waitForURL(new RegExp(`/v10/cabinet/\\?c=${cabinet}`), { timeout: 15_000 });
    // Pas d'écran de verrouillage : la liste des dossiers, avec les deux clients.
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-1-dossiers.png') });
    expect(await p.locator('#lock-screen').count()).toBe(0);
    await expect.poll(() => p.locator('#view').innerText()).toContain('Menuiserie Ben Salah');
    expect(await p.locator('#view').innerText()).toContain('Boulangerie Ennour');
    expect(await p.locator('#brand-cab').innerText()).toContain('Cabinet Ennour');
    // Le cabinet valide août (il a le mandat de comptabilité) : l'écriture prend son numéro.
    expect((await api('POST', `/entreprises/${ent}/compta/valider`, associe, { jusqua: '2026-08-31' })).corps.validees).toBe(1);
    // Le livre du client, dans l'écran du Cabinet : la balance de 2026.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/balance/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-2-balance.png') });
    // Deux chemins, un chiffre : la balance que l'écran du Cabinet calcule (compta.js, sur le livre
    // que le pont lui donne) est celle du serveur, compte par compte.
    const millimes = (t: string) => BigInt(t.replace(/[^0-9,-]/g, '').replace(',', '') || '0');
    const ecranLignes = await p.locator('#view table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText)));
    const vueEcran = ecranLignes.filter((l) => /^[0-9]/.test(l[0] ?? '')).map((l) => `${l[0]} ${millimes(l[2] ?? '')} ${millimes(l[3] ?? '')}`);
    const bal = (await api('GET', `/entreprises/${ent}/compta/balance?du=2026-01-01&au=2026-12-31`, associe)).corps as { comptes: { compte: string; debit: string; credit: string }[] };
    expect(vueEcran).toEqual(bal.comptes.map((c) => `${c.compte} ${BigInt(c.debit.replace('.', ''))} ${BigInt(c.credit.replace('.', ''))}`));
    expect(vueEcran.length).toBe(3);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/2026`);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-3-journal.png') });

    // « Nouveau client… » : un dossier tenu au serveur, et ses notes dans la fiche du cabinet.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.getByRole('button', { name: 'Plus tard' }).first().click().catch(() => {});
    await p.getByRole('button', { name: 'Nouveau client…' }).first().click();
    await p.locator('#modal-root #f-name').fill('Pâtisserie Mokhtar');
    await p.locator('#modal-root #f-mat').fill('1234567B/A/M/000');
    await p.locator('#modal-root #f-email').fill('mokhtar@exemple.tn');
    await p.locator('#modal-root #f-fees').fill('150,500');
    await p.locator('#modal-root #ok').click();
    await p.locator('#view h1').filter({ hasText: 'Pâtisserie Mokhtar' }).waitFor({ timeout: 15_000 });
    await p.waitForTimeout(1500);
    await p.locator('#view h1').filter({ hasText: 'Pâtisserie Mokhtar' }).waitFor({ timeout: 15_000 });
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-4-nouveau-client.png') });
    const porte = (await api('GET', `/cabinets/${cabinet}/portefeuille`, associe)).corps.dossiers as { entreprise: string; raisonSociale: string; matriculeFiscal: string; tenu: boolean }[];
    const cree = porte.find((d) => d.raisonSociale === 'Pâtisserie Mokhtar');
    expect(cree).toMatchObject({ tenu: true, matriculeFiscal: '1234567B/A/M/000' });
    const fiches = (await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: Record<string, unknown> }[];
    expect(fiches.find((f) => f.entreprise === cree?.entreprise)?.contenu).toMatchObject({ email: 'mokhtar@exemple.tn', fees: 150500 });
    // Les boutons d'import de paquets n'ont plus d'objet : ils ne se voient pas.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    expect(await p.getByRole('button', { name: 'Importer un paquet…' }).filter({ visible: true }).count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('« je suis un cabinet comptable » sur la porte : le cabinet se crée, le code du téléphone se pose, le Cabinet s\'ouvre ; « Verrouiller » ferme la session', async () => {
    const email = `cabinet-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia Ferchichi', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const erreurs: string[] = [];
    const p = await ouvrir(jeton, null, erreurs);
    await p.getByRole('heading', { level: 1, name: 'Bienvenue dans SkanFact' }).waitFor({ timeout: 15_000 });
    await p.getByRole('button', { name: 'Je suis un cabinet comptable', exact: true }).click();
    await p.getByRole('heading', { level: 1, name: 'Ton cabinet' }).waitFor({ timeout: 10_000 });
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-5-porte.png') });
    await p.locator('label.field').filter({ hasText: 'Nom du cabinet' }).locator('input').fill('Cabinet Ferchichi & Associés');
    await p.getByRole('button', { name: 'Créer mon cabinet', exact: true }).click();
    // L'associé supervise des livres : le code du téléphone d'abord.
    await p.getByRole('button', { name: 'Mettre en place le code', exact: true }).click();
    await p.getByRole('button', { name: 'J\'ai noté mes codes', exact: true }).click();
    await p.waitForURL(/\/v10\/cabinet\/\?c=[0-9a-f-]{36}/, { timeout: 15_000 });
    const cabinet = new URL(p.url()).searchParams.get('c');
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    expect(await p.locator('#brand-cab').innerText()).toContain('Cabinet Ferchichi & Associés');
    expect(((await api('GET', '/cabinets', jeton)).corps.cabinets as { id: string }[]).map((c) => c.id)).toEqual([cabinet]);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-6-neuf.png') });
    // Sans paquets (C4) : « Tes premiers pas » ne réclame ni fichier d'appairage, ni clé de secours, ni
    // copie sur un disque.
    const vue = await p.locator('#view').innerText();
    for (const absent of ['appairage', 'clé de secours', 'Mettre ton cabinet à l\'abri', 'paquet']) expect(vue).not.toContain(absent);
    expect(vue).toContain('Ajouter tes clients');
    // « Verrouiller » : la session se ferme ; on revient à la connexion, et le jeton ne vaut plus rien.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/reglages`);
    // Le bouton vit dans l'onglet des réglages qui le porte.
    await p.locator('#set-tabs').waitFor({ timeout: 15_000 });
    const onglet = await p.locator('section[data-pane]:has(#s-lock)').getAttribute('data-pane');
    await p.locator(`#set-tabs button[data-tab="${onglet}"]`).click();
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-7-securite.png') });
    // Ni boîte de réception, ni sauvegardes sur l'ordinateur, ni mot de passe du cabinet : seul
    // « Verrouiller » reste du panneau Sécurité.
    const reglages = await p.locator('#set-corps').innerText();
    for (const absent of ['Boîte de réception', 'Sauvegardes', 'AES-256', 'clé de secours', 'Changer le mot de passe']) expect(reglages).not.toContain(absent);
    await p.locator('#s-lock').click();
    await p.locator('#modal-root #ok').click();
    await p.getByRole('heading', { level: 1, name: 'Se connecter à SkanFact' }).waitFor({ timeout: 15_000 });
    expect((await api('GET', '/moi', jeton)).statut).toBe(401);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('le client confie son dossier par le code que le Cabinet affiche ; l\'associé accepte sur sa page Dossiers ; le client arrête le mandat après confirmation', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Hannibal' })).corps.id);
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Quincaillerie Zitouna' })).corps.id);
    const erreurs: string[] = [];
    // Le cabinet, sans client : la page Dossiers explique comment un client arrive, avec le code.
    const c = await ouvrir(associe, cabinet, erreurs);
    await c.locator('#code-cabinet').waitFor({ timeout: 15_000 });
    const code = (await c.locator('#code-cabinet').innerText()).trim();
    expect(code).toBe(String(((await api('GET', '/cabinets', associe)).corps.cabinets as { id: string; code: string }[]).find((x) => x.id === cabinet)?.code));
    await c.waitForTimeout(1500);
    await c.screenshot({ path: path.join(PHOTOS, 'cabinet-8-code.png') });

    // Le client : Paramètres → Envois → Ton cabinet comptable ; il tape le code et confie son dossier.
    const e = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    e.on('pageerror', (x) => erreurs.push(x.message));
    await e.addInitScript((j) => { sessionStorage.setItem('skanfact.jeton', j); }, client);
    await e.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await e.locator('#view h1').first().waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await e.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await e.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await e.getByRole('tab', { name: 'Envois', exact: true }).click();
    await e.locator('#mandat-code').fill(code);
    await e.getByRole('button', { name: 'Confier mon dossier', exact: true }).click();
    await expect.poll(() => e.locator('#cab-pair').innerText()).toContain('il ne le voit qu\'une fois qu\'il a accepté');
    await e.screenshot({ path: path.join(PHOTOS, 'cabinet-9-confie.png') });

    // L'associé : le dossier confié s'annonce sur sa page Dossiers ; il accepte.
    await c.reload();
    const bandeau = c.locator('.banner').filter({ hasText: 'Quincaillerie Zitouna' });
    await bandeau.waitFor({ timeout: 15_000 });
    expect(await bandeau.innerText()).toContain('la comptabilité, les déclarations et la saisie des achats');
    await bandeau.getByRole('button', { name: 'Accepter', exact: true }).click();
    await expect.poll(() => c.locator('#view').innerText(), { timeout: 15_000 }).toContain('Quincaillerie Zitouna');
    await expect.poll(() => c.locator('.banner').filter({ hasText: 'Quincaillerie Zitouna' }).count()).toBe(0);
    await c.waitForTimeout(1500);
    await c.screenshot({ path: path.join(PHOTOS, 'cabinet-10-accepte.png') });
    expect(((await api('GET', `/entreprises/${ent}/mandat`, client)).corps.mandat as { statut: string }).statut).toBe('actif');

    // Le client voit qui tient ses livres ; arrêter se demande d'abord.
    await e.reload();
    await e.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await e.getByRole('tab', { name: 'Envois', exact: true }).click();
    await expect.poll(() => e.locator('#cab-pair').innerText()).toContain('Cabinet Hannibal tient tes livres depuis le');
    await e.getByRole('button', { name: 'Arrêter le mandat…', exact: true }).click();
    expect(((await api('GET', `/entreprises/${ent}/mandat`, client)).corps.mandat as { statut: string }).statut).toBe('actif');
    await e.getByRole('button', { name: 'Oui, arrêter : il ne verra plus mes livres', exact: true }).click();
    await e.getByRole('button', { name: 'Confier mon dossier', exact: true }).waitFor({ timeout: 15_000 });
    expect((await api('GET', `/entreprises/${ent}/mandat`, client)).corps.mandat).toBeNull();
    expect(erreurs).toEqual([]);
  }, 120_000);
});
