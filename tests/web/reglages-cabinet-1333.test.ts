// Les Réglages du Cabinet en ligne, à la souris (1.333.0 ; modules/socle/ecrans/cabinet/app-2.js ; plateforme/sauvegardes.js ;
// 0207). Joués par Leïla, associée, et Rim, en Saisie. « Données et sécurité » ne gardait qu'un bouton « Se déconnecter », et
// la grille de saisie acceptait la même touche pour deux gestes. Ce que le parcours vérifie :
//   - « Tes données » dit ce que la veille du serveur a vu des copies (la copie de la nuit échouée se dit échouée), et
//     « Défaire une erreur » ouvre une demande au support préremplie, le curseur là où l'on écrit ;
//   - une touche déjà prise est refusée à la frappe ; une touche en double enregistrée avant se signale, et l'enregistrement
//     la refuse ; corrigée, l'avertissement le dit ;
//   - les jours de dépôt disent leur unité (« le … du mois suivant ») ;
//   - Rim, en Saisie, lit les copies mais ne change pas le nom du cabinet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('les Réglages du Cabinet en ligne, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-reglages-'));
  const erreurs: string[] = [];
  let leila = { jeton: '', email: '' }, rim = { jeton: '', email: '' }, cab = '';

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
    return { jeton, email };
  };

  // Le Cabinet sur ses Réglages, pour une personne, ouvert sur un onglet.
  const reglages = async (qui: { jeton: string }, onglet: string, dedans: string): Promise<Page> => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    const associe = qui.jeton;
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab}#/reglages`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(600);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await expect.poll(async () => {
      if (!await p.locator(dedans).isVisible()) await p.locator(`#set-tabs [data-tab="${onglet}"]`).click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).isVisible();
    }, { timeout: 30_000 }).toBe(true);
    return p;
  };
  const toast = (p: Page) => p.locator('#toast').innerText();

  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    // Ce que la veille a vu : la nuit d'hier réussie, celle de cette nuit échouée, la copie hors de la machine en place ;
    // la veille est passée il y a trois minutes.
    await admin.query('truncate plateforme.service_releve, plateforme.service_nuit');
    await admin.query(`insert into plateforme.service_nuit (jour, sauvegarde, copie_de_base, restauration) values
      (current_date - 1, jsonb_build_object('le', now() - interval '1 day', 'ok', true), null, null),
      (current_date, jsonb_build_object('le', now() - interval '2 hours', 'ok', false), null, null)`);
    await admin.query(`insert into plateforme.service_releve (minute, repond, charge_cent, memoire, processeurs, disques, copies)
      values (date_trunc('minute', now() - interval '3 minutes'), true, 10, 40, 2, '[]', '{"archivage":{"enMarche":true},"horsMachine":{"regle":true}}')`);
    leila = await personne('leila');
    cab = String((await api('POST', '/cabinets', leila.jeton, { nom: 'Cabinet Ennour Réglages' })).corps.id);
    rim = await personne('rim');
    const inv = await api('POST', `/cabinets/${cab}/invitations`, leila.jeton, { email: rim.email, role: 'saisie' });
    expect(inv.statut, JSON.stringify(inv.corps.motif ?? '')).toBe(201);
    const acc = await api('POST', '/invitations/accepter', rim.jeton, { jeton: inv.corps.jeton });
    expect(acc.statut, String(acc.corps.motif ?? '')).toBe(200);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  it('Tes données : la copie de la nuit échouée se dit échouée, et « Défaire une erreur » écrit au support', async () => {
    const p = await reglages(leila, 'donnees', '#pan-donnees');
    await expect.poll(() => p.locator('#sv-etat [data-sv="nuit"]').count(), { timeout: 20_000 }).toBe(1);
    const nuit = net(await p.locator('#sv-etat [data-sv="nuit"]').innerText());
    expect(nuit).toMatch(/^La copie de la nuit du \d\d\/\d\d\/\d{4} a échoué\. La dernière réussie : le /);
    expect(net(await p.locator('#sv-etat [data-sv="hors"]').innerText())).toBe('Copie hors de la machine : à jour.');
    expect(await p.locator('#sv-etat [data-sv="veille"]').count()).toBe(0);
    // Le calendrier vient du serveur, pas d'une phrase écrite à la main.
    expect(net(await p.locator('#pan-donnees').innerText())).toMatch(/Chaque nuit à \d+ h \d\d \(heure de Tunis\), SkanFact copie toutes les données/);
    // Aucun reste du bureau à l'écran : ni clé USB, ni clé de secours, ni bouton « Restaurer » (le pont les cache).
    for (const absent of ['#pan-backup', '#pan-inbox', '#pan-comptes']) expect(await p.locator(absent).isVisible(), absent).toBe(false);
    await p.locator('#sv-support').click();
    const tx = p.locator('.modal textarea').first();
    await tx.waitFor({ timeout: 10_000 });
    expect(await tx.inputValue()).toMatch(/^Le dossier : \nCe qui s'est passé : /);
    // Le curseur attend le nom du dossier, pas la fin du texte.
    expect(await tx.evaluate((t) => (t as HTMLTextAreaElement).selectionStart)).toBe('Le dossier : '.length);
    await p.keyboard.type('Boulangerie du Lac');
    expect(await tx.inputValue()).toMatch(/^Le dossier : Boulangerie du Lac\nCe qui s'est passé : /);
    expect(erreurs).toEqual([]);
    await p.context().close();
  });

  it('une touche ne fait qu\'un geste : refusée à la frappe, signalée si elle était déjà enregistrée, refusée à l\'enregistrement', async () => {
    let p = await reglages(leila, 'compta', '#sr-save');
    await p.locator('[data-touche="solder"]').focus();
    await p.keyboard.press('F2');
    await expect.poll(() => toast(p)).toBe('F2 sert déjà à « Recopier la ligne du dessus » : choisis une autre touche, ou change d\'abord celle-là.');
    expect(await p.locator('[data-touche="solder"]').getAttribute('data-code')).toBe('Tab');
    // Une touche libre s'inscrit.
    await p.keyboard.press('F8');
    expect(await p.locator('[data-touche="solder"]').getAttribute('data-code')).toBe('F8');
    expect(await p.locator('#sr-touche-double').count()).toBe(0);
    await p.context().close();

    // Une grille réglée AVANT, avec F2 sur deux gestes : l'écran le dit, et l'enregistrement ne la garde pas telle quelle.
    const lu = (await api('GET', `/cabinets/${cab}/reglages`, leila.jeton)).corps as { contenu: Record<string, unknown>; revision: number | null };
    const touches = { ligneSuivante: 'Enter', solder: 'F2', recopier: 'F2', dupliquer: 'F4', valider: 'Control+Enter' };
    const ecrit = await api('PUT', `/cabinets/${cab}/reglages`, leila.jeton, { contenu: { ...lu.contenu, saisie: { journalParDefaut: '', dateComplete: true, validerParLot: true, touches } }, revision: lu.revision });
    expect(ecrit.statut, JSON.stringify(ecrit.corps.motif ?? '')).toBe(200);
    p = await reglages(leila, 'compta', '#sr-save');
    expect(net(await p.locator('#sr-touche-double').innerText())).toMatch(/F2/);
    await p.locator('#sr-save').click();
    await expect.poll(() => toast(p)).toBe('F2 sert à la fois à « Solder la pièce » et à « Recopier la ligne du dessus » : une touche ne fait qu\'un geste. Change l\'une des deux.');
    expect(((await api('GET', `/cabinets/${cab}/reglages`, leila.jeton)).corps.contenu as { saisie: { touches: Record<string, string> } }).saisie.touches.solder).toBe('F2');
    // « Solder » reprend Tab : l'enregistrement passe, et l'avertissement dit que c'est corrigé, à sa place.
    await p.locator('[data-touche-reset="solder"]').click();
    await p.locator('#sr-save').click();
    await expect.poll(() => p.locator('#sr-saved').innerText()).toBe('✓ enregistré');
    expect(net(await p.locator('#sr-touche-double').innerText())).toBe('Corrigé : chaque touche ne fait plus qu\'un geste dans la grille.');
    expect(((await api('GET', `/cabinets/${cab}/reglages`, leila.jeton)).corps.contenu as { saisie: { touches: Record<string, string> } }).saisie.touches).toMatchObject({ solder: 'Tab', recopier: 'F2' });
    expect(erreurs).toEqual([]);
    await p.context().close();
  });

  it('les jours de dépôt disent leur unité ; Rim lit les copies mais ne renomme pas le cabinet', async () => {
    let p = await reglages(leila, 'cabinet', '#c-save');
    for (const [champ, apres] of [['#c-day', 'de chaque mois'], ['#c-tvaday', 'du mois suivant'], ['#c-cnssday', 'du mois qui suit le trimestre']] as const) {
      const suffixe = p.locator(`.suffixe:has(${champ})`);
      expect(await suffixe.locator('.suffixe-av').innerText(), champ).toBe('le');
      expect(await suffixe.locator('.suffixe-ap').innerText(), champ).toBe(apres);
    }
    expect(await p.locator('#c-name').isEnabled()).toBe(true);
    await p.context().close();
    p = await reglages(rim, 'cabinet', '#c-name');
    await expect.poll(() => p.locator('#c-name').isDisabled(), { timeout: 15_000 }).toBe(true);
    expect(await p.locator('#c-name').getAttribute('title')).toBe('Seul un associé du cabinet change son nom.');
    await p.locator('#set-tabs [data-tab="donnees"]').click();
    await expect.poll(() => p.locator('#sv-etat [data-sv="nuit"]').count(), { timeout: 20_000 }).toBe(1);
    expect(erreurs).toEqual([]);
    await p.context().close();
  });
});
