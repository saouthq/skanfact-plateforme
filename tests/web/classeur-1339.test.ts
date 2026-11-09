// 1.339.0, à la souris, le 9/11/2026 (le vrai jour : le serveur date les pièces qu'il reçoit) :
//   - la fiche du dossier : « Septembre déposé » se date du jour du DÉPÔT (le 25/10), et non de la date limite (le 28/10) ;
//   - le classeur : une attestation envoyée par « Mon comptable » se dit « à ranger » dans la ligne ET dans le panneau de
//     droite (« À ranger : ce n'est pas un achat »), dont le geste principal est « La ranger… » ; la saisir reste possible.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const LE_28 = new Date('2026-10-28T10:00:00+01:00');

describe('la fiche et le classeur du dossier (1.339.0), à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-classeur-1339-'));
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
    return { jeton, email };
  };
  const gerants = new Map<string, string>();
  const mandats = new Map<string, string>();
  async function unCabinet() {
    const { jeton: associe, email: courrielAssocie } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const client = async (nom: string, gerant: string, fiche: Record<string, unknown>) => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: fiche, revision: null })).statut).toBeLessThan(300);
      gerants.set(ent, j);
      mandats.set(ent, mandat);
      return ent;
    };
    const ecrire = async (ent: string, e: Record<string, unknown>) => expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, e)).statut).toBe(201);
    // La boulangerie : sa mission commence en septembre ; un achat de farine au brouillard, à vérifier.
    const boulangerie = await client('Boulangerie El Amal', 'Sarra Ben Salah', { contact: 'Sarra', from: '2026-09' });
    await ecrire(boulangerie, { date: '2026-09-03', journal: 'AC', piece: 'FA-0914', libelle: 'Minoterie du Cap Bon, farine T55',
      lignes: [{ compte: '601', debit: '1551,428' }, { compte: '4366', debit: '294,772' }, { compte: '401', credit: '1846,200' }] });
    // La menuiserie : sa mission commence en août, sa dernière écriture est du 15/07 ; rien depuis.
    const menuiserie = await client('Menuiserie Ben Ali', 'Hédi Ben Ali', { contact: 'Hédi', from: '2026-08' });
    await ecrire(menuiserie, { date: '2026-07-15', journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
      lignes: [{ compte: '6226', debit: '100,000' }, { compte: '401', credit: '100,000' }] });
    return { associe, courrielAssocie, cab, boulangerie, menuiserie };
  }
  // jour : l'horloge du navigateur (le 28/10 par défaut) ; null, le vrai jour, celui où le serveur date les pièces qu'il reçoit.
  async function contexte(jeton: string, tel = false, jour: Date | null = LE_28) {
    const cx = await navigateur.newContext({ viewport: tel ? { width: 390, height: 844 } : { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', ...(tel ? { isMobile: true, hasTouch: true } : {}) });
    if (jour) await cx.clock.setFixedTime(jour);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    // (rouge GitHub de 1.276.1) La proposition d'une visite arrivait après le « Plus tard » d'ouvrir() sur une machine
    // lente, et restait ouverte : le classeur attendait qu'elle se ferme. Ici, on ne la propose pas (ce test ne la regarde pas).
    await p.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('cab.visites', JSON.stringify({ proposer: false })); });
    return { p, erreurs };
  }
  // (rouge GitHub de 1.277.0) Ce que voit la page quand une attente échoue : la fenêtre posée et les lignes du classeur.
  const vuDe = async (p: Page) => JSON.stringify({ fenetre: (await p.locator('#modal-root').innerHTML().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500),
    lignes: (await p.locator('li[data-cl-k]').allInnerTexts().catch(() => [] as string[])).map((t) => t.replace(/\s+/g, ' ').slice(0, 100)) });
  async function ouvrir(p: Page, cabinet: string, ent: string) {
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/classeur`);
    await p.locator('#page-cl .cl-res').first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  }


  it('la fiche date un dépôt du jour du dépôt ; le classeur range une attestation au lieu de la proposer comme un achat', async () => {
    const { associe, cab, boulangerie } = await unCabinet();
    // Septembre déposé le 25/10 (la date limite est le 28/10).
    expect((await api('PUT', `/entreprises/${boulangerie}/compta/declarations/2026-09`, associe, { cases: { tvaCollectee: '19,024' } })).statut).toBeLessThan(300);
    expect((await api('POST', `/entreprises/${boulangerie}/compta/declarations/2026-09/pointer`, associe, { quoi: 'deposee', le: '2026-10-25' })).statut).toBeLessThan(300);
    // Sarra envoie son attestation CNSS par « Mon comptable ».
    const sarra = gerants.get(boulangerie) as string;
    const f = await api('POST', `/entreprises/${boulangerie}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'attestation-cnss-T3.pdf', contenu: Buffer.from('%PDF-1.4\nattestation').toString('base64') });
    expect((await api('POST', `/entreprises/${boulangerie}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: f.corps.id })).statut).toBe(201);
    const { p, erreurs } = await contexte(associe, false, null);
    // La fiche : l'historique dit le jour du dépôt.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${boulangerie}`);
    const ligne = p.locator('.cd-hi li', { hasText: 'Septembre déposé' });
    await ligne.first().waitFor({ timeout: 25_000 });
    expect(await ligne.first().locator('time').innerText()).toMatch(/^25\/10/);
    // Le classeur : l'attestation est « à ranger », et le panneau le dit aussi.
    await ouvrir(p, cab.id, boulangerie);
    const att = p.locator('li[data-cl-k]', { hasText: 'attestation-cnss-T3.pdf' });
    await att.first().waitFor({ timeout: 25_000 }).catch(async (e) => { throw new Error(`${e}\n${await vuDe(p)}`); });
    expect((await att.first().innerText()).replace(/\s+/g, ' ')).toMatch(/à ranger/);
    await att.first().click();
    const bloc = p.locator('.cl-ap-b');
    await expect.poll(async () => (await bloc.first().innerText().catch(() => '')).replace(/\s+/g, ' '), { timeout: 10_000 }).toMatch(/À ranger : ce n'est pas un achat/);
    expect(await p.locator('[data-cl-ap="ranger"].btn-primary').count()).toBe(1);
    expect(await p.locator('[data-cl-ap="saisir"]').innerText()).toBe('La saisir quand même');
    expect(await p.getByText('La saisir dans Écritures').count()).toBe(0);
    await p.locator('[data-cl-ap="ranger"]').click();
    await expect.poll(() => p.url(), { timeout: 10_000 }).toMatch(new RegExp(`#/pieces/${boulangerie}$`));
    expect(erreurs).toEqual([]);
  }, 120_000);
});
