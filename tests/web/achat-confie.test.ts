// (1.157.1, maquette achat « Confiée au cabinet ») Amine confie sa facture à son cabinet : « Confier au cabinet » de la
// pièce neuve prend la photo et l'envoie dans le fil ; la page « Photo envoyée au cabinet » le dit (la frise en cinq
// étapes, ce qui est parti) et suit la photo, lue dans le fil : vue par le cabinet, puis rangée dans les achats.
// « Envoyer une autre photo » en envoie une seconde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
// Une vraie photo PNG d'un pixel : le serveur la reconnaît à ses premiers octets.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('une facture confiée au cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-confie-'));
  const photo = path.join(dossier, 'facture-garage-pneus.png');
  const autre = path.join(dossier, 'ticket-peage.png');
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    fs.writeFileSync(photo, PNG);
    fs.writeFileSync(autre, PNG);
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  type Corps = Record<string, unknown> & { id?: string; code?: string; mandat?: string; messages?: { id: string; texte: string; fichier: { nom: string } | null }[] };
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Corps };
  };
  const personne = async (prefixe: string, nom: string) => {
    const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();

  it('la photo part dans le fil, la page la suit : envoyée, vue par le cabinet, rangée ; une autre photo', async () => {
    const sonia = await personne('sonia', 'Sonia Ben Youssef');
    const cab = (await api('POST', '/cabinets', sonia, { nom: 'Fiduciaire Ennour' })).corps;
    const amine = await personne('amine', 'Amine Gharbi');
    const ent = String((await api('POST', '/entreprises', amine, { raisonSociale: 'Gharbi Informatique SARL' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, amine, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, amine);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    // La messagerie lue (« Mon comptable » paraît au pied du menu), la pièce neuve propose de confier la photo.
    await p.locator('#foot-comptable').waitFor({ state: 'visible', timeout: 20_000 });
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    const confier = p.locator('button#ac-cabinet');
    await confier.waitFor({ timeout: 15_000 });
    expect(net(await confier.innerText())).toBe('Confier au cabinet Tu envoies la photo à ton comptable, il la saisit');
    const [choix] = await Promise.all([p.waitForEvent('filechooser'), confier.click()]);
    await choix.setFiles(photo);

    // La page dit ce qui est parti, et où en est la photo.
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toBe('#/achat/envoyee');
    const titre = () => p.locator('#view .ed-h1').first().innerText().then(net);
    await expect.poll(titre, { timeout: 10_000 }).toBe('Photo envoyée au cabinet Ton cabinet la saisit');
    const frise = () => p.locator('#ac-env-frise').innerText().then(net);
    await expect.poll(frise, { timeout: 10_000 }).toMatch(/^1?\s?Photo prise .+ : fait .*Envoyée .+ · dans votre fil : fait 3 Vue par le cabinet quand il ouvre votre fil : pas encore 4 Saisie par le cabinet : pas encore 5 Rangée dans tes achats, avec la photo : pas encore$/);
    expect(net(await p.locator('#view .bandeau.info').innerText())).toMatch(/^Envoyée à ton cabinet le \d\d\/\d\d à \d\d h \d\d : il saisit la facture Tu n'as rien d'autre à taper\./);
    expect(net(await p.locator('#view .ac-env-f').innerText())).toBe('facture-garage-pneus.png photo · 1 Ko · « Une facture d\'achat à saisir » Voir dans le fil');
    expect(await p.locator('#view .btn-primary').evaluateAll((l) => l.map((b) => b.id))).toEqual(['env-autre']);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'achat-confie-1-envoyee.png') });
    // Le serveur : le message est dans le fil, avec sa photo.
    const fil = (await api('GET', `/entreprises/${ent}/messages?cote=entreprise`, amine)).corps;
    const message = fil.messages?.find((m) => m.fichier?.nom === 'facture-garage-pneus.png');
    expect(message?.texte).toBe('Une facture d\'achat à saisir : facture-garage-pneus.png');

    // Le cabinet ouvre le fil : la page le dit (relue en y revenant).
    expect((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, sonia)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/messages/lu`, sonia, { cote: 'cabinet' })).statut).toBeLessThan(300);
    const revenir = async () => { await p.evaluate(() => { location.hash = '#/achats'; }); await p.locator('#view h1', { hasText: 'Achats' }).waitFor(); await p.evaluate(() => { location.hash = '#/achat/envoyee'; }); };
    await revenir();
    await expect.poll(frise, { timeout: 10_000 }).toMatch(/Vue par le cabinet \d\d\/\d\d · \d\d h \d\d · par Fiduciaire Ennour : fait 4 Saisie par le cabinet : pas encore/);

    // Il la range dans les achats : la pièce le dit, avec le chemin vers l'achat.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, amine, { changements: [
      { collection: 'purchases', cle: 'pa1', rang: 0, revision: null, contenu: { id: 'pa1', kind: 'facture', number: 'GP-2026-114', date: '2026-10-24', supplierId: '', currency: 'DT', lines: [], payments: [] } },
    ] })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/messages/${message?.id}/achat`, amine, { achat: 'pa1', libelle: 'GP-2026-114' })).statut).toBe(200);
    await revenir();
    await expect.poll(titre, { timeout: 10_000 }).toBe('Photo envoyée au cabinet Rangée');
    expect(await frise()).toMatch(/Saisie GP-2026-114 : fait 5? ?Rangée dans tes achats, avec la photo : fait$/);
    expect(await p.locator('#view a[href="#/achat/pa1"]').count()).toBe(1);

    // Une autre photo : elle part aussi, et la page la suit.
    const [choix2] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#env-autre').click()]);
    await choix2.setFiles(autre);
    await expect.poll(() => p.locator('#view .ac-env-f').innerText().then(net), { timeout: 15_000 }).toMatch(/^ticket-peage\.png photo/);
    expect(await titre()).toBe('Photo envoyée au cabinet Ton cabinet la saisit');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
