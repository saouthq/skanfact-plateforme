// L'équipe du cabinet, à la souris (brique 46 ; docs/cabinet.md, C36). Les écrans sont ceux du Cabinet
// v10 (Réglages → L'équipe, la fiche d'un dossier) et l'entrée de la plateforme (le lien d'invitation).
// Ce que le parcours vérifie, écran ET serveur :
//   - l'associé invite par l'adresse ; le lien, ouvert par la personne connectée avec cette adresse,
//     la fait entrer dans le cabinet ;
//   - un rôle posé dans la fiche d'un dossier le lui confie : il est dans son portefeuille ;
//   - son rôle se change ; retirée, elle n'ouvre plus le cabinet ; sa propre ligne n'a pas de menu.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'équipe du cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-eq-'));
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

  type Equipe = { membres: { membre: string; utilisateur: string; nom: string; roles: string[] }[]; invitations: unknown[]; affectations: { entreprise: string; role: string }[] };

  it('inviter par l\'adresse, rejoindre par le lien, confier un dossier, changer le rôle, retirer', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const equipe = async () => (await api('GET', `/cabinets/${cabinet}/equipe`, associe)).corps as Equipe;

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (h: string) => {
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${h}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 30_000 }).toBe(1);
    const menu = async (cle: string, geste: string) => {
      await expect.poll(async () => {
        if (!await p.getByRole('menuitem').filter({ hasText: geste }).count()) await p.locator(`[data-rowmenu="${cle}"]`).first().click({ timeout: 2_000 }).catch(() => {});
        return p.getByRole('menuitem').filter({ hasText: geste }).count();
      }, { timeout: 30_000 }).toBe(1);
      await p.getByRole('menuitem').filter({ hasText: geste }).click();
    };

    // ── Inviter par l'adresse ─────────────────────────────────────────────────────────────────────
    await aller('#/reglages');
    await ouvrir('#set-tabs [data-tab="cabinet"], #set-tabs button:has-text("Mon cabinet")', '#eq-add');
    await expect.poll(() => p.locator('#eq-moi').innerText()).toMatch(/^Tu es connecté sous le nom de associe\s—\sSupervision\./);
    const moi = (await equipe()).membres[0]?.utilisateur;
    expect(await p.locator(`[data-rowmenu="EQ:${moi}"]`).count()).toBe(0);
    const adresse = `amine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await ouvrir('#eq-add', '#eq-email');
    await fenetre.locator('#eq-email').fill(adresse);
    await fenetre.locator('#eq-role').selectOption('validation');
    await fenetre.locator('#eq-ok').click();
    await p.locator('#eq-lien').waitFor({ timeout: 15_000 });
    const lien = await p.locator('#eq-lien').inputValue();
    expect(lien).toMatch(new RegExp(`^${serveur.adresse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\?invitation=`));
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-equipe-1-lien.png') });
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect.poll(() => p.locator('#eq-invitations').innerText()).toMatch(new RegExp(adresse.replace(/[.]/g, '\\.')));

    // ── La personne ouvre le lien, connectée avec cette adresse : elle entre dans le cabinet ──────
    await api('POST', '/inscription', undefined, { email: adresse, nom: 'Amine', motDePasse: 'Un-bon-mot-de-passe' });
    const amine = String((await api('POST', '/connexion', undefined, { email: adresse, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', amine, { methode: 'application' });
    const a = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    a.on('pageerror', (e) => erreurs.push(e.message));
    await a.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, amine);
    await a.goto(lien);
    await a.waitForURL(new RegExp(`/v10/cabinet/\\?c=${cabinet}`), { timeout: 20_000 });
    await expect.poll(async () => (await equipe()).membres.map((m) => [m.nom, m.roles])).toEqual([['Amine', ['revision']], ['associe', ['supervision']]]);
    const utilAmine = String((await equipe()).membres.find((m) => m.nom === 'Amine')?.utilisateur);

    // ── Un rôle posé dans la fiche du dossier le lui confie (l'état du cabinet se relit à l'ouverture) ─
    await aller(`#/dossier/${cafe}`);
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await expect.poll(async () => {
      if (!await p.locator(`#d-droits .dr-role[data-collab="${utilAmine}"]`).count()) await p.getByRole('tab', { name: 'Suivi' }).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(`#d-droits .dr-role[data-collab="${utilAmine}"]`).count();
    }, { timeout: 30_000 }).toBe(1);
    expect(await p.locator('#d-droits').innerText()).toMatch(/Ce dossier n'est confié à personne\s:\sseuls les associés y travaillent\./);
    await p.locator(`#d-droits .dr-role[data-collab="${utilAmine}"]`).selectOption('validation');
    await p.locator('#dr-save').click();
    await expect.poll(async () => (await equipe()).affectations.map((x) => [x.entreprise, x.role])).toEqual([[cafe, 'revision']]);
    expect(((await api('GET', `/cabinets/${cabinet}/portefeuille`, amine)).corps.dossiers as { entreprise: string }[]).map((d) => d.entreprise)).toEqual([cafe]);

    // ── Son rôle se change ; retirée, elle n'ouvre plus le cabinet ─────────────────────────────────
    await aller('#/reglages');
    await ouvrir('#set-tabs [data-tab="cabinet"], #set-tabs button:has-text("Mon cabinet")', '#eq-add');
    await menu(`EQ:${utilAmine}`, 'Changer son rôle');
    await fenetre.locator('#eq-role').selectOption('saisie');
    await fenetre.locator('#eq-ok').click();
    await expect.poll(toast).toBe('Rôle enregistré.');
    await expect.poll(async () => (await equipe()).membres.find((m) => m.nom === 'Amine')?.roles).toEqual(['saisie']);
    await menu(`EQ:${utilAmine}`, 'Retirer du cabinet');
    await fenetre.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect.poll(toast).toMatch(/Amine a été retiré du cabinet\./);
    expect((await equipe()).membres.map((m) => m.nom)).toEqual(['associe']);
    expect((await api('GET', '/cabinets', amine)).corps.cabinets).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-equipe-2-retire.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
