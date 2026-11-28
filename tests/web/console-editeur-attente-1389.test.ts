// La fenêtre « Désigner l'entreprise SkanFact » dit ce qui partira dans la minute (1.389.4 ; l'issue #29, CONS3-4 ;
// base/migrations/0241_editeur_en_attente.sql ; web/console/src/ecrans/Reglages.tsx). Ce que le parcours vérifie :
//   - un choix d'offre qui attend une entreprise SkanFact s'annonce, avec son client, son offre et sa période ;
//   - désignée sans RIB à sa fiche, la facture « attendra le RIB » (CONS3-1) ; avec son RIB, elle « partira dans la minute » ;
//   - l'entreprise choisie ne se facture pas à elle-même : choisir le client lui-même, rien ne part.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('ce que la désignation de l\'entreprise SkanFact fera partir, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-editeur-attente-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-editeur-attente-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jD = '', jApp = '', editeur = '', client = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const membre = async (nom: string, role: 'direction' | 'support') => {
    const email = `console-editeur-attente-${role}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai de la désignation à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    return { appli: jeton, console: String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton) };
  };
  const ouvrir = async (jeton: string, hash: string, largeur = 1440, hauteur = 900) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${hash}`);
    await expect.poll(() => p.locator('.c-cote, .c-entete').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  beforeAll(async () => {
    await admin.connect();
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const d = await membre('Amira Désignation', 'direction');
    jD = d.console; jApp = d.appli;
    // Aucune entreprise SkanFact : les choix des clients attendent. Celle de SkanFact, puis un client qui a choisi son offre.
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    editeur = String((await api('POST', '/entreprises', jApp, { raisonSociale: 'SkanFact Désignée SARL' })).corps.id);
    expect((await api('GET', `/entreprises/${editeur}/dossier-v10`, jApp)).statut).toBe(200);
    client = String((await api('POST', '/entreprises', jApp, { raisonSociale: 'Librairie Al Kitab' })).corps.id);
    await admin.query(`insert into plateforme.offre_choisie (entreprise, offre, periodicite, par)
      select $1, 'essentiel', 'mensuel', utilisateur from socle.membre where entreprise = $1 limit 1`, [client]);
  });
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('la fenêtre dit, avant le geste, quelle facture partira, en son nom, et ce qui l\'attend sans RIB', async () => {
    const rib = (v: string | null) => admin.query(`update socle.dossier_v10 set contenu = case when $2::text is null then contenu - 'rib' else contenu || jsonb_build_object('rib', $2::text) end
      where entreprise = $1 and collection = '_racine' and cle = 'company'`, [editeur, v]);
    const ceQuiVa = async (p: Page, laquelle: string) => {
      await p.locator('.c-dialogue select').first().selectOption(laquelle);
      return net(await p.locator('.c-dialogue .c-al-ce-qui-va li').last().innerText());
    };
    const ouvrirLaFenetre = async () => {
      const p = await ouvrir(jD, '#/reglages?onglet=factures');
      const bouton = p.getByRole('button', { name: /désigner l.entreprise SkanFact/i });
      await expect.poll(() => bouton.count(), { timeout: 15_000 }).toBe(1);
      await cliquer(bouton);
      await expect.poll(() => p.locator('.c-dialogue .c-al-ce-qui-va li').count(), { timeout: 10_000 }).toBe(4);
      return p;
    };
    // La base des tests est PARTAGÉE : d'autres fichiers y posent leurs clients au même moment (en CI, « 8 factures
    // attendront… »). La fenêtre compte TOUT ce qui attend ; le test lit donc le même compte dans la base et vérifie la
    // phrase par la règle — le nombre, et notre client parmi les noms ou dans « et N autres » —, jamais une base vide.
    const enAttente = async (designee: string) => ((await admin.query(`select plateforme.factures_en_attente_d_editeur((now() at time zone 'Africa/Tunis')::date) as a`)).rows[0].a as { sorte: string; id: unknown; nom: string }[])
      .filter((x) => !(x.sorte === 'client' && String(x.id) === designee));
    const verifier = (phrase: string, liste: { sorte: string; id: unknown }[], sansRib: boolean) => {
      const n = liste.length;
      expect(liste.some((x) => x.sorte === 'client' && String(x.id) === client), 'notre client attend sa facture').toBe(true);
      const tete = sansRib
        ? (n === 1 ? 'Une facture attendra le RIB de sa fiche pour partir, en son nom : ' : `${n} factures attendront le RIB de sa fiche pour partir, en son nom : `)
        : (n === 1 ? 'Une facture partira dans la minute, en son nom : ' : `${n} factures partiront dans la minute, en son nom : `);
      expect(phrase.startsWith(tete), phrase).toBe(true);
      const rang = liste.findIndex((x) => x.sorte === 'client' && String(x.id) === client);
      if (rang < 3) expect(phrase).toContain('Librairie Al Kitab (Essentiel, au mois)');
      else expect(phrase).toMatch(n === 4 ? / et un autre\.$/ : new RegExp(` et ${n - 3} autres\\.$`));
    };
    await rib(null);
    let p = await ouvrirLaFenetre();
    verifier(await ceQuiVa(p, editeur), await enAttente(editeur), true);
    // Le client lui-même désigné : il ne se facture pas à lui-même — son nom ne figure plus dans ce qui part.
    const pourLeClient = await ceQuiVa(p, client);
    expect(pourLeClient).not.toContain('Librairie Al Kitab');
    if (!(await enAttente(client)).length) expect(pourLeClient).toMatch(/^Aucune facture n.attend de partir/);
    await fermer(p);
    await rib('10006012345678901234');
    p = await ouvrirLaFenetre();
    verifier(await ceQuiVa(p, editeur), await enAttente(editeur), false);
    await fermer(p);
    // (CONS3-7) Désignée, la carte la nomme, et son matricule vient seul sous le nom — sans « · » en tête de ligne.
    await admin.query('update socle.entreprise set matricule_fiscal = $2 where id = $1', [editeur, '1234567A/A/M/000']);
    expect((await api('POST', '/console/reglages/factures/editeur', jD, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    p = await ouvrir(jD, '#/reglages?onglet=factures');
    const sous = p.locator('section:has(#rg-factures) .c-rg-actuel-tete .c-sous', { hasText: '1234567A' }).first();
    await expect.poll(() => sous.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe('1234567A/A/M/000');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 120_000);
});
