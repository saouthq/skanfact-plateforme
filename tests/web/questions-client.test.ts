// Les questions du cabinet, chez le client, à la souris (brique 44 bis ; docs/cabinet.md, C34). L'écran
// est celui de SkanFact v10 ; les questions viennent des livres de l'entreprise, au serveur. Ce que le
// parcours vérifie, écran ET serveur :
//   - le client voit les questions que son cabinet lui a ENVOYÉES et n'a pas fermées — jamais une
//     question encore au brouillon chez le cabinet, ni une question fermée ;
//   - il y répond depuis l'onglet Cabinet de sa Comptabilité, ou en face de la pièce qu'elle vise :
//     la réponse est au serveur dès qu'elle est enregistrée ; les questions n'entrent jamais dans son dossier.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les questions du cabinet chez le client, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-qcl-'));
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

  type Question = { id: string; statut: string; reponse: string | null };

  it('le client voit les questions envoyées, y répond depuis l\'onglet Cabinet et en face de la pièce ; la réponse est au serveur', async () => {
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const poser = (collection: string, cle: string, contenu: unknown) =>
      api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await poser('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    await poser('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-12', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
    });
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    // Quatre questions : deux envoyées, une fermée après l'envoi, une posée après l'envoi (jamais partie).
    const url = `/entreprises/${ent}/compta/questions`;
    const poserQuestion = async (q: Record<string, string>) => String((await api('POST', url, associe, { periode: '2026-08', ...q })).corps.id);
    const surPiece = await poserQuestion({ piece: 'FF-12', compte: '401', objet: 'Facture illisible', texte: 'Peux-tu confirmer le montant de la facture FF-12 ?', attendu: 'confirmation' });
    const generale = await poserQuestion({ objet: 'Caisse', texte: 'Le fond de caisse de 200 DT est-il toujours en place ?' });
    const fermee = await poserQuestion({ objet: 'Déjà réglée', texte: 'Question réglée au téléphone' });
    expect((await api('POST', `${url}/envoyer`, associe, { annee: 2026 })).corps.envoyees).toBe(3);
    expect((await api('POST', `${url}/${fermee}/fermer`, associe, {})).statut).toBe(200);
    await poserQuestion({ objet: 'Brouillon', texte: 'Une question pas encore partie' });
    const lues = async () => (await api('GET', url, associe)).corps.questions as Question[];

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, client);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(async () => {
      if (!await p.locator('#p-questions').count()) await p.locator('#c-tabs [data-tab="cabinet"]').click({ timeout: 2_000 }).catch(() => {});
      return p.locator('#p-questions').count();
    }, { timeout: 20_000 }).toBe(1);

    // ── L'onglet Cabinet : les deux questions envoyées et ouvertes, et le cabinet qui tient les livres ─
    const panneau = p.locator('#p-questions');
    await expect.poll(() => panneau.innerText(), { timeout: 20_000 }).toMatch(/Le fond de caisse de 200 DT est-il toujours en place/);
    expect(await panneau.locator('[data-rep]').count()).toBe(2);
    expect(await panneau.innerText()).not.toMatch(/Question réglée au téléphone|pas encore partie/);
    await expect.poll(() => p.locator('#cab-pair').innerText()).toMatch(/Cabinet Ennour tient tes livres/);
    expect(await p.locator('#view').innerText()).not.toMatch(/paquet/i);
    await p.screenshot({ path: path.join(PHOTOS, 'questions-client-1-onglet.png') });

    await panneau.locator(`[data-rep="${generale}"]`).click();
    await fenetre.locator('textarea[name=texte]').fill('Oui, 200 DT, compté ce matin.');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Réponse enregistrée : ton comptable la lit dans SkanFact Cabinet');
    await expect.poll(async () => (await lues()).find((q) => q.id === generale)).toMatchObject({ statut: 'repondue', reponse: 'Oui, 200 DT, compté ce matin.' });

    // ── En face de la pièce qu'elle vise : l'achat FF-12 ─────────────────────────────────────────
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/a1`);
    await expect.poll(() => p.locator('#q-piece').innerText(), { timeout: 20_000 }).toMatch(/Peux-tu confirmer le montant de la facture FF-12/);
    await p.screenshot({ path: path.join(PHOTOS, 'questions-client-2-piece.png') });
    await p.locator(`#q-piece [data-qrep="${surPiece}"]`).click();
    await fenetre.locator('textarea[name=texte]').fill('Oui : 1 190,000 DT TTC.');
    await fenetre.locator('#ok').click();
    await expect.poll(async () => (await lues()).find((q) => q.id === surPiece)).toMatchObject({ statut: 'repondue', reponse: 'Oui : 1 190,000 DT TTC.' });
    await expect.poll(() => p.locator('#q-piece').count()).toBe(0);

    // Les questions n'entrent jamais dans le dossier de l'entreprise.
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, client)).corps.objets as { collection: string; cle: string; contenu: unknown }[];
    expect(objets.filter((o) => o.collection === 'questionsCabinet')).toEqual([]);
    expect(objets.filter((o) => o.cle === 'questionsCabinet').map((o) => o.contenu)).toEqual([[]]);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
