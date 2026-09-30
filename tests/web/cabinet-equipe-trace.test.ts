// Ce qui a changé dans l'équipe, à la souris (brique 61 ; docs/cabinet.md, C51). L'écran est le panneau
// « L'équipe » des réglages (Mon cabinet). Ce que le parcours vérifie : l'associé y lit chaque geste, du
// plus récent au plus ancien, en phrases (qui, quoi, à qui) ; un collaborateur n'y voit pas la liste.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('ce qui a changé dans l\'équipe, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-trace-'));
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

  const personneA = async (nom: string) => {
    const email = `${nom.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return { email, jeton };
  };

  it('l\'associé lit ce qui a changé dans l\'équipe, en phrases ; le collaborateur ne voit pas la liste', async () => {
    const leila = await personneA('Leila');
    const cabinet = String((await api('POST', '/cabinets', leila.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const amine = await personneA('Amine');
    const inv = await api('POST', `/cabinets/${cabinet}/invitations`, leila.jeton, { email: amine.email, role: 'saisie' });
    expect((await api('POST', '/invitations/accepter', amine.jeton, { jeton: inv.corps.jeton })).statut).toBe(200);
    const membres = (await api('GET', `/cabinets/${cabinet}/equipe`, leila.jeton)).corps.membres as { membre: string; nom: string }[];
    const membreAmine = String(membres.find((m) => m.nom === 'Amine')?.membre);
    expect((await api('PUT', `/cabinets/${cabinet}/membres/${membreAmine}`, leila.jeton, { role: 'revision' })).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cabinet}/nom`, leila.jeton, { nom: 'Cabinet Ennour et associés' })).statut).toBe(200);

    const erreurs: string[] = [];
    const ouvrirEquipe = async (jeton: string) => {
      const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
      p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
      await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/reglages`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
        await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
      }
      await expect.poll(async () => {
        if (!await p.locator('#eq-add').count()) await p.locator('#set-tabs [data-tab="cabinet"], #set-tabs button:has-text("Mon cabinet")').first().click({ timeout: 2_000 }).catch(() => {});
        return p.locator('#eq-add').count();
      }, { timeout: 30_000 }).toBe(1);
      return p;
    };

    // L'associé : chaque geste, du plus récent au plus ancien.
    const p = await ouvrirEquipe(leila.jeton);
    await expect.poll(() => p.locator('#eq-trace tr').count(), { timeout: 15_000 }).toBe(4);
    const lignes = (await p.locator('#eq-trace tr td:nth-child(2)').allInnerTexts()).map((x) => x.trim());
    expect(lignes).toEqual([
      'Leila a renommé le cabinet : « Cabinet Ennour » → « Cabinet Ennour et associés ».',
      'Leila a changé le rôle de Amine : Saisie → Saisie et validation.',
      'Amine a rejoint le cabinet (Saisie).',
      `Leila a invité ${amine.email} (Saisie).`,
    ]);
    await p.locator('#eq-trace').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-equipe-trace.png') });

    // Le collaborateur : pas de liste.
    const q = await ouvrirEquipe(amine.jeton);
    await q.waitForTimeout(1500);
    expect(await q.locator('#eq-trace').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
