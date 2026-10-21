// « Tes sauvegardes », à la souris (0161, docs/sauvegardes-ecran.md), dans l'onglet « Données et sécurité » des
// Paramètres, pour le propriétaire et un administrateur. Ce que le parcours vérifie :
//   - le panneau dit ce que la veille a vu : la copie de la nuit qui a échoué ET la dernière réussie, la copie hors de
//     la machine pas encore en place, l'essai de restauration réussi ;
//   - « Demander de revenir en arrière… » : la fenêtre dit ce qui disparaîtrait avant le geste, refuse une demande sans
//     motif en montrant la case, puis envoie la demande au support (rien ne change) ;
//   - un commercial ne voit pas le panneau.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les sauvegardes, vues de l\'entreprise, à la souris', () => {
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-sauvegardes-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } } });
    await admin.connect();
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await admin.end(); await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const personne = async (nom: string) => {
    const email = `${nom.toLowerCase()}-${unique()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    let c = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
    if (c.corps.etat === 'code') {
      const code = /(\d{6})$/.exec(partis.filter((m) => m.a === email).at(-1)?.objet ?? '')?.[1] ?? '';
      c = await api('POST', '/connexion/code', undefined, { defi: c.corps.defi, code });
    }
    return { email, jeton: String(c.corps.jeton) };
  };
  const erreurs: string[] = [];
  const page = async (jeton: string) => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return p;
  };
  const donnees = async (p: Page, ent: string) => {
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await p.locator('#view h1').first().waitFor({ timeout: 30_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('#set-tabs [data-tab="donnees"]').click();
  };

  it('le propriétaire voit les copies telles qu\'elles sont, et demande de revenir en arrière ; un commercial ne voit pas le panneau', async () => {
    // La nuit d'hier réussie, celle d'aujourd'hui échouée ; un essai de restauration réussi il y a deux nuits ; la veille
    // passée à l'instant, sans copie hors de la machine réglée.
    const jour = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await admin.query('truncate plateforme.service_releve, plateforme.service_nuit');
    await admin.query(`insert into plateforme.service_nuit (jour, sauvegarde, copie_de_base, restauration) values
      ($1::date, jsonb_build_object('le', $1::text || 'T02:31:00Z', 'ok', true), null, jsonb_build_object('le', $1::text || 'T04:02:00Z', 'ok', true)),
      ($2::date, jsonb_build_object('le', $2::text || 'T02:30:40Z', 'ok', true), null, null),
      ($3::date, jsonb_build_object('le', $3::text || 'T02:32:05Z', 'ok', false), null, null)`, [jour(2), jour(1), jour(0)]);
    await admin.query(`insert into plateforme.service_releve (minute, repond, charge_cent, memoire, processeurs, disques, copies)
      values (date_trunc('minute', now()), true, 10, 40, 2, '[]', '{"archivage":{"enMarche":true},"horsMachine":{"regle":false,"attenteDepuis":null}}')`);
    const nadia = await personne('Nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie de l\'essai' })).corps.id);
    const p = await page(nadia.jeton);
    await donnees(p, ent);
    const panneau = p.locator('#mes-sauvegardes-panel');
    await panneau.locator('#sv-etat').waitFor({ timeout: 15_000 });
    const etat = (await panneau.locator('#sv-etat').innerText()).replace(/\s+/g, ' ');
    const fr = (j: string) => j.split('-').reverse().join('/');
    expect(etat).toContain(`La copie de la nuit du ${fr(jour(0))} a échoué. La dernière réussie : le ${fr(jour(1))} à 3 h 30.`);
    expect(etat).toContain('Copie hors de la machine : pas encore en place sur ce serveur.');
    expect(etat).toContain(`Dernier essai de restauration : le ${fr(jour(2))}, réussi.`);
    expect(etat).not.toContain('ne s\'est pas manifestée');
    expect((await panneau.innerText()).replace(/\s+/g, ' ')).toContain('Chaque nuit à 3 h 30 (heure de Tunis), SkanFact copie toutes les données ; il garde les 14 dernières nuits, et de quoi revenir à n\'importe quelle minute des 35 derniers jours. Le 1er de chaque mois, une copie est remise en place à côté, pour vérifier qu\'elle se relit.');

    // Revenir en arrière : ce qui disparaîtrait se lit avant ; sans motif, la case se montre ; puis la demande part.
    await panneau.locator('#sv-revenir').click();
    const fenetre = p.locator('.modal').last();
    expect((await fenetre.innerText()).replace(/\s+/g, ' ')).toContain('Tout ce qui a été fait dans l\'entreprise après cette minute disparaîtrait');
    // Tapés comme une personne : le jour en JJ/MM/AAAA, l'heure « 9h15 ».
    await fenetre.locator('#sv-jour').fill(fr(jour(1)));
    await fenetre.locator('#sv-heure').fill('9h15');
    await fenetre.locator('#sv-envoyer').click();
    await expect.poll(() => fenetre.locator('[role=alert]').innerText()).toContain('Dis pourquoi revenir en arrière');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('sv-motif');
    await fenetre.locator('#sv-motif').fill('Une importation de tableur a écrasé mes prix');
    await fenetre.locator('#sv-envoyer').click();
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toContain('Demande envoyée au support');
    const demandes = (await admin.query(`select d.sujet, m.texte from plateforme.demande_support d join plateforme.message_support m on m.demande = d.id
       where d.entreprise = $1 and d.page = 'sauvegardes'`, [ent])).rows;
    expect(demandes.map((d) => d.sujet)).toEqual([`Revenir au ${fr(jour(1))} à 09:15`]);
    expect(demandes[0]?.texte).toContain('Pourquoi : Une importation de tableur a écrasé mes prix');
    await p.screenshot({ path: path.join(PHOTOS, 'sauvegardes-ecran.png') });

    // Un commercial : pas de panneau.
    const sami = await personne('Sami');
    await admin.query('insert into socle.membre (utilisateur, entreprise, roles) select u.id, $2, $3 from socle.utilisateur u where u.email = $1', [sami.email, ent, ['commercial']]);
    const q = await page(sami.jeton);
    await donnees(q, ent);
    await q.locator('[data-pane="donnees"]').waitFor({ timeout: 15_000 });
    expect(await q.locator('#mes-sauvegardes-panel').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
