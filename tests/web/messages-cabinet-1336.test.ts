// Les Messages du Cabinet, joués comme Leïla (1.336.0) :
//   - « Saisir cette pièce », sous une photo du fil, passe par la même porte que « Pièces reçues » : la saisie s'ouvre
//     préparée, la pièce À CÔTÉ de la grille est celle qu'on saisit, et enregistrée, l'écriture la prend pour justificatif
//     (elle sort des pièces à classer). Avant, une grille vide : la pièce restait à classer, et se saisissait deux fois ;
//   - une pièce classée ne se propose plus à la saisie : le fil dit ce qui en a été fait ;
//   - le dossier à côté nomme TOUS les mois en retard ; le résumé dit « pièces à classer » (photos et PDF) ;
//   - « de Yasmine », pas « d'Yasmine ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('les Messages du Cabinet, et le pont (1.336.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-messages-1336-'));
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
  const personne = async (nom: string) => {
    const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };


  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const moisAvant = (n: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };

  it('(1.336.0) « Saisir cette pièce » joint la pièce à son écriture, le fil dit ce qui est classé, les mois en retard nommés, « de Yasmine »', async () => {
    const leila = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const yasmine = await personne('Yasmine Dridi');
    const ent = String((await api('POST', '/entreprises', yasmine, { raisonSociale: 'Institut Yasmine' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, yasmine, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    // La mission depuis quatre mois : au moins deux mois sont en retard (leur date limite est passée, rien n'est déclaré).
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, leila, { contenu: { contact: 'Yasmine Dridi', from: moisAvant(4) }, revision: null })).statut).toBe(200);
    // Son livre de l'année est ouvert : la Saisie s'y ouvre.
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: new Date().getUTCFullYear(), ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/messages`, leila, { cote: 'cabinet', texte: 'Il me manque :', demande: 'Le relevé ATB de septembre' })).statut).toBe(201);
    // Deux pièces : le ticket d'abord. La pièce montrée à côté de la grille doit être celle qu'on saisit, pas la première venue.
    const ticket = await api('POST', `/entreprises/${ent}/messages/fichiers`, yasmine, { cote: 'entreprise', nom: 'ticket-carburant.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${ent}/messages`, yasmine, { cote: 'entreprise', texte: '', fichier: ticket.corps.id })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/messages`, yasmine, { cote: 'entreprise', texte: 'Je vous envoie le relevé lundi, promis.' })).statut).toBe(201);
    const depot = await api('POST', `/entreprises/${ent}/messages/fichiers`, yasmine, { cote: 'entreprise', nom: 'facture-pneus.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${ent}/messages`, yasmine, { cote: 'entreprise', texte: '', fichier: depot.corps.id })).statut).toBe(201);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await p.locator('.msg-tete-integre h2').waitFor({ timeout: 25_000 });

    // Le résumé : des pièces à classer (le mot de « Pièces reçues »), pas « des photos à saisir ».
    await expect.poll(async () => net(await p.locator('[data-resume]').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/2 pièces à classer/);
    expect(net(await p.locator('[data-resume]').innerText())).not.toMatch(/photo/);
    // Le dossier à côté : le titre nomme chaque mois que la ligne dessous dit échu.
    const mois = p.locator('.msg-cote-mois');
    await mois.waitFor({ timeout: 15_000 });
    const echus = [...net(await mois.locator('small').innerText()).matchAll(/([a-zéû]+) : échu/g)].map((m) => m[1]);
    expect(echus.length).toBeGreaterThanOrEqual(2);
    const attendu = echus.length > 3 ? `${echus.length} mois en retard`
      : `${echus.slice(0, -1).join(', ')} et ${echus.at(-1)} en retard`.replace(/^./, (c) => c.toUpperCase());
    expect(net(await mois.locator('b').innerText())).toBe(attendu);
    // « de Yasmine » : un Y devant une voyelle se prononce comme une consonne.
    await expect.poll(async () => net(await p.locator('#msg-pp-t').innerText().catch(() => '')), { timeout: 15_000 }).toBe('Noter la promesse de Yasmine');
    expect(net(await p.locator('[data-msg-attente] h3').textContent() ?? '')).toBe('On attend de Yasmine1');

    // « Saisir cette pièce » : la photo s'ouvre à côté, et la saisie s'ouvre PRÉPARÉE, la pièce de l'écriture à côté.
    const carte = p.locator('[data-msg-fil] .msg-fichier').filter({ hasText: 'facture-pneus.png' });
    const saisir = carte.getByRole('button', { name: 'Saisir cette pièce', exact: true });
    const [photo] = await Promise.all([p.waitForEvent('popup'), saisir.click()]);
    await photo.close();
    await expect.poll(() => p.url(), { timeout: 15_000 }).toMatch(new RegExp(`#/dossier/${ent}/comptabilite/saisie$`));
    const depuis = p.locator('.sa-depuis');
    await expect.poll(async () => net(await depuis.innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^Saisie de « facture-pneus\.png » · la conversation : enregistrée, l'écriture la prend pour justificatif, et elle sort des pièces à classer\./);
    expect(net(await depuis.getByRole('link').innerText())).toBe('Retour à la conversation');
    await expect.poll(async () => net(await p.locator('#sx-km-d').innerText().catch(() => '')), { timeout: 20_000 }).toMatch(/^La pièce de l'écriture en cours facture-pneus\.png/);

    // L'achat, tapé : enregistré, la pièce s'y joint, et l'écran revient à la conversation.
    const ligne = (i: number) => p.locator('#sa-lignes tr').nth(i);
    await ligne(0).locator('[data-k="compte"]').fill('6061');
    await ligne(0).locator('[data-k="debit"]').fill('100');
    await ligne(1).locator('[data-k="compte"]').fill('401');
    await ligne(1).locator('[data-k="credit"]').fill('100');
    await p.locator('#sa-ok').click();
    await expect.poll(() => p.url(), { timeout: 20_000 }).toMatch(new RegExp(`#/messages/${ent}$`));
    // Le ticket attend encore ; la facture des pneus, jointe, n'est plus à classer.
    const pieces = await api('GET', `/cabinets/${cab.id}/pieces`, leila);
    expect((pieces.corps.pieces as { fichier: { nom: string } }[]).map((x) => x.fichier.nom)).toEqual(['ticket-carburant.png']);
    // Le fil dit ce qui en a été fait, et ne propose plus de la saisir une seconde fois.
    const carte2 = p.locator('[data-msg-fil] .msg-fichier').filter({ hasText: 'facture-pneus.png' });
    await expect.poll(async () => net(await carte2.locator('[data-msg-classee]').innerText().catch(() => '')), { timeout: 20_000 }).toBe('Jointe à son écriture');
    expect(await carte2.getByRole('button', { name: 'Saisir cette pièce', exact: true }).count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
