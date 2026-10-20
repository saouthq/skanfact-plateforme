// La balance auxiliaire du Cabinet nomme les clients d'un dossier sur SkanFact (1.82.0 ; docs/recette.md, « 1.82.0 »), à la
// souris. Les écritures nées d'une facture ne portaient pas le nom de leur tiers : la balance auxiliaire rangeait tous les
// clients sous « (sans tiers) », et le livre-journal laissait sa colonne « Tiers » vide. « Ce qui reste dû, par ancienneté »
// ne garde que les tiers qui doivent quelque chose.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('la balance auxiliaire du Cabinet nomme les clients, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-balance-tiers-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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
  const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const annee = aujourdhui.slice(0, 4);

  it('une facture émise chez le client : le livre-journal et la balance auxiliaire disent son nom', async () => {
    const personne = async (qui: string) => {
      const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
      await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
      const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
      await api('POST', '/moi/code', jeton, { methode: 'application' });
      return jeton;
    };
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Droguerie du Port' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila);
    // Son client « Quincaillerie Ben Salah », et une facture de 2 × 450,500 à 19 %, sans timbre : 1 072,190.
    const fiche = { id: 'c1', name: 'Quincaillerie Ben Salah', matricule: '', address: '', email: '', phone: '', currency: 'DT' };
    const facture = {
      id: 'f1', type: 'facture', number: '', date: aujourdhui, dueDate: aujourdhui, clientId: 'c1', subject: 'Outillage', status: 'brouillon',
      lines: [{ label: 'Perceuse', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
    };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: fiche },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: facture }] })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, client, { document: facture, client: fiche, revision: 1, rang: 0, netAPayer: '1072.190' })).statut).toBe(200);
    // (1.82.0) Un second client, « Kiosque du Marché » : sa facture de 119,000 est annulée par un avoir du même montant.
    // Deux pièces ouvertes, rien de dû.
    const fiche2 = { ...fiche, id: 'c2', name: 'Kiosque du Marché' };
    const lignes2 = [{ label: 'Cadenas', description: '', qty: 1, unit: '', unitPrice: { '~n': '100' }, vatRate: 19 }];
    const facture2 = { ...facture, id: 'f2', clientId: 'c2', lines: lignes2 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: fiche2 },
      { collection: 'documents', cle: 'f2', rang: 1, revision: null, contenu: facture2 }] })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, client, { document: facture2, client: fiche2, revision: 1, rang: 1, netAPayer: '119.000' })).statut).toBe(200);
    const avoir2 = { id: 'a2', type: 'avoir', number: '', date: aujourdhui, clientId: 'c2', creditOf: 'f2', creditReason: 'Commande annulée', status: 'brouillon',
      lines: lignes2, discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [] };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre-avoir`, client, { document: avoir2, client: fiche2, revision: null, rang: 2, netAPayer: '119.000' })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/${annee}`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    // La facture est au brouillard : on la compte, comme le comptable qui relit avant de valider.
    await p.locator('#lv-brouillard').check();
    // Le livre-journal : chaque ligne d'un client (411) porte son nom dans la colonne « Tiers ».
    const tiers411 = () => p.locator('#c-livres tbody tr').filter({ has: p.locator('td', { hasText: /^411$/ }) }).evaluateAll((tr) => tr.map((x) => x.children[5]?.textContent ?? '').sort());
    await expect.poll(tiers411, { timeout: 15_000 }).toEqual(['Kiosque du Marché', 'Kiosque du Marché', 'Quincaillerie Ben Salah']);
    // La balance auxiliaire des clients : une ligne par client, à son nom ; la quincaillerie doit 1 072,190, le kiosque est soldé par son avoir.
    await p.evaluate((h) => { location.hash = h; }, `#/dossier/${ent}/comptabilite/balance/${annee}`);
    await p.locator('button').filter({ hasText: /^Balance auxiliaire$/ }).first().click();
    const lignes = p.locator('#c-livres tbody tr');
    await expect.poll(() => lignes.count(), { timeout: 15_000 }).toBe(2);
    const texte = async (nom: string) => (await lignes.filter({ hasText: nom }).first().innerText()).replace(/\s+/g, ' ').trim();
    expect(await texte('Quincaillerie Ben Salah')).toMatch(/^Quincaillerie Ben Salah 411 1\s?072,190 DT 0,000 DT 1\s?072,190 DT$/);
    expect(await texte('Kiosque du Marché')).toMatch(/^Kiosque du Marché 411 119,000 DT 119,000 DT$/);
    // (1.82.0) « Ce qui reste dû, par ancienneté » : le client soldé par son avoir n'y prend pas de ligne.
    await p.locator('#lv-brouillard').check().catch(() => undefined);
    await p.evaluate((h) => { location.hash = h; }, `#/dossier/${ent}/comptabilite/lettrage/${annee}`);
    const agee = p.locator('h2', { hasText: /^Ce qui reste dû, par ancienneté/ }).locator('xpath=..');
    await agee.waitFor({ timeout: 15_000 });
    expect(await agee.locator('tbody tr').allInnerTexts()).toEqual([expect.stringMatching(/^Quincaillerie Ben Salah\s/)]);
    expect(await agee.locator('tfoot td').first().innerText()).toBe('1 tiers');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
