// « Les incidents » du service, à la souris (Console 3d ; docs/console.md C24 ; serveur/console/incidents.ts ;
// web/console/src/ecrans/Incidents.tsx). Les incidents passent par les vraies routes de la console ; la page d'état est
// ce que la veille a écrit à côté de son fichier (page-etat.json). Ce que le parcours vérifie :
//   - un incident ouvert porte le seul bouton principal de l'écran (« Ajouter un point… ») ; la page d'état montrée est
//     celle que la veille a écrite, avec le message publié ;
//   - un point vide se refuse dans la fenêtre ; écrit, il entre dans l'histoire de l'incident ;
//   - clore demande le compte rendu, une suite a une personne et une date ; clos, l'écran dit « Aucun incident ouvert »
//     avec son seul bouton principal, et l'incident passe dans les passés avec ses suites ;
//   - une suite marquée faite quitte la liste et se compte ;
//   - une fiche réflexe se lit en quatre temps ;
//   - l'écran et ses fenêtres, un incident ouvert, mesurés par l'instrument de la console (en clair et en sombre, à
//     l'ordinateur et au téléphone, et en langue factice) ;
//   - au téléphone : rien ne déborde, et chaque cible se touche du doigt.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { FICHES } from '../../serveur/console/incidents.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { mesurerLaConsole, type EcranConsole } from './instrument-console.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

type Membre = { email: string; secret: string; id: string };

describe('les incidents du service, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-incidents-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-incidents-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let direction: Membre;
  let jD = '', garage = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const jetonConsole = async (m: Membre) => {
    const r = await api('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    const c = await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(m.secret), Date.now()) });
    return String(c.corps.jeton);
  };
  const ouvrir = async (jeton: string, largeur = 1440) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/#/service/incidents`);
    await expect.poll(() => p.locator('.c-in-fiche').count(), { timeout: 20_000 }).toBe(FICHES.length);
    return p;
  };
  // Un écran de l'instrument : à une largeur, un thème et une langue ; lu quand toutes ses fiches réflexes sont là.
  const ouvrirEcran = async (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => {
    const cx = await navigateur.newContext({ viewport: { width: o.largeur, height: o.largeur < 600 ? 844 : 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript(([j, t]) => {
      sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jD, o.theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${e.hash}`);
    await expect.poll(() => p.locator('.c-in-fiche').count(), { timeout: 20_000 }).toBe(FICHES.length);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const fenetre = (p: Page) => p.locator('[role="dialog"]');
  const toast = async (p: Page) => { await expect.poll(() => p.locator('#c-toast.c-montre').count()).toBe(1); return net(await p.locator('#c-toast').innerText()); };
  const jour = (j: number) => new Date(Date.now() + j * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await admin.connect();
    // Les demandes du support peuvent désigner un incident (0126) : on les en délie d'abord ; un « truncate … cascade »
    // viderait aussi les demandes des autres essais.
    await admin.query('update plateforme.demande_support set incident = null where incident is not null');
    await admin.query('delete from plateforme.service_suite; delete from plateforme.service_incident_point; delete from plateforme.service_incident');
    await admin.query('truncate plateforme.service_fermeture, plateforme.service_maintenance');
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `console-incidents-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Essai', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    // Une entreprise, pour une demande au support liée à l'incident (0126).
    garage = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Garage des Incidents' })).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai des incidents à la souris');
    const id = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0]?.id);
    direction = { email, secret, id };
    jD = await jetonConsole(direction);
    // Un incident passé, clos il y a deux jours avec une suite à tenir.
    const ancien = await api('POST', '/console/service/incidents', jD, { titre: 'La TTN ne répondait plus', gravite: 'mineur', fiche: 'partenaire', public: null, motif: 'la file grossit' });
    await api('POST', `/console/service/incidents/${String(ancien.corps.id)}/clore`, jD, {
      fin: new Date().toISOString(), effet: '214 factures électroniques ont attendu en file.', cause: 'La TTN était en maintenance.', change: 'La file se voit sur la console.',
      suites: [{ titre: 'Un second relais d\'e-mails', responsable: id, due: jour(10) }], motif: 'compte rendu écrit',
    });
    // L'incident en cours, annoncé sur la page d'état.
    await api('POST', '/console/service/incidents', jD, { titre: 'Les e-mails de connexion arrivent en retard', gravite: 'mineur', fiche: 'partenaire',
      public: 'Les e-mails de connexion arrivent avec du retard ; nous y travaillons.', motif: 'trois appels ce matin' });
    fs.writeFileSync(path.join(path.dirname(veille), 'page-etat.json'), JSON.stringify({
      le: new Date().toISOString(), tout: { couleur: 'orange', dit: 'Un incident en cours' },
      lignes: [{ nom: 'Le service', couleur: 'vert', dit: 'Fonctionne' }, { nom: 'La sauvegarde', couleur: 'vert', dit: 'Réussie' }, { nom: 'L\'entretien', couleur: 'vert', dit: 'Rien à signaler' }],
      annonce: { incident: { gravite: 'mineur', texte: 'Les e-mails de connexion arrivent avec du retard ; nous y travaillons.', le: new Date().toISOString() }, maintenance: null },
    }));
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('l\'incident ouvert porte le seul bouton principal ; la page d\'état montrée est celle de la veille, avec son message', async () => {
    const p = await ouvrir(jD);
    expect(await p.locator('.c-in-ouvert').count()).toBe(1);
    expect(net(await p.locator('.c-in-ouvert h2').innerText())).toBe('Les e-mails de connexion arrivent en retard');
    expect(await p.locator('main .c-btn-principal').count()).toBe(1);
    expect(net(await p.locator('main .c-btn-principal').innerText())).toBe('Ajouter un point…');
    const apercu = net(await p.locator('.c-in-apercu').innerText());
    expect(apercu).toContain('Un incident en cours');
    expect(apercu).toContain('Les e-mails de connexion arrivent avec du retard ; nous y travaillons.');
    expect(apercu).toContain('Rien à signaler');
    // L'onglet est allumé, et la fiche suivie se lit.
    expect(net(await p.locator('.c-sv-onglets [aria-current="page"]').innerText())).toBe('Incidents');
    expect(net(await p.locator('.c-in-fiche-suivie b').innerText())).toBe('Un partenaire ne répond plus');
    // Les demandes de clients liées par le support (0126) : comptées, jamais nommées.
    expect(net(await p.locator('.c-in-ouvert .c-in-demandes').innerText())).toBe('Aucune demande de client liée par le support pour l\'instant.');
    const incident = String((await admin.query('select id from plateforme.service_incident where clos_le is null')).rows[0]?.id);
    await admin.query(`insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, ouverte_le, incident) values ($1, $2, 'application', 'Mon code de connexion n''arrive pas', now(), $3),
      ($1, $2, 'application', 'Toujours pas de code', now(), $3)`, [garage, direction.id, incident]);
    try {
      await p.reload();
      await expect.poll(() => p.locator('.c-in-ouvert .c-in-demandes').innerText().then(net).catch(() => ''), { timeout: 20_000 })
        .toBe('2 demandes de clients liées par le support · 2 encore ouvertes.');
      expect(net(await p.locator('.c-in-ouvert').innerText())).not.toContain('Garage des Incidents');
      // Les prévenir d'un coup (0128) : le geste nomme combien attendent ; sans mot, refusé sur le champ ; écrit, chaque
      // demande ouverte reçoit la même réponse.
      await cliquer(p.getByRole('button', { name: 'Répondre aux 2 demandes ouvertes…', exact: true }));
      const fenetre = p.getByRole('dialog');
      await expect.poll(() => fenetre.locator('.c-dialogue-pied .c-btn-principal').innerText().then(net).catch(() => '')).toBe('Envoyer aux 2 demandes');
      await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
      await expect.poll(() => fenetre.locator('.c-alerte-danger').innerText().then(net).catch(() => '')).toContain('trois caractères au moins');
      expect(await p.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
      await fenetre.getByLabel('Le mot aux clients', { exact: true }).fill('Les codes arrivent de nouveau : redemandez-en un.');
      await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
      await expect.poll(() => p.locator('#c-toast').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe('C\'est fait : 2 demandes ont reçu ce mot.');
      const recus = await admin.query("select m.texte from plateforme.message_support m join plateforme.demande_support d on d.id = m.demande where d.entreprise = $1 and m.cote = 'equipe'", [garage]);
      expect(recus.rows.map((r) => r.texte)).toEqual(['Les codes arrivent de nouveau : redemandez-en un.', 'Les codes arrivent de nouveau : redemandez-en un.']);
    } finally { await admin.query('update plateforme.demande_support set incident = null where entreprise = $1', [garage]); }
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('un incident ouvert, en clair et en sombre, à l\'ordinateur et au téléphone : l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    // Chaque geste trouve son bouton par la structure de l'écran : en langue factice, son texte change.
    const fen = async (p: Page) => { await p.getByRole('dialog').waitFor(); };
    const H = '#/service/incidents';
    const ECRANS: EcranConsole[] = [
      { nom: 'incidents-ouvert', hash: H },
      { nom: 'incident-point', hash: H, geste: async (p) => { await cliquer(p.locator('.c-in-ouvert .c-in-ouvert-gestes button').first()); await fen(p); } },
      // Le compte rendu, une suite ajoutée : sa ligne de saisie se mesure aussi.
      { nom: 'incident-clore', hash: H, geste: async (p) => {
        await cliquer(p.locator('.c-in-ouvert .c-in-ouvert-gestes button').nth(1)); await fen(p);
        await cliquer(p.locator('[role="dialog"] .c-btn-petit:has(svg)').first());
        await p.locator('[role="dialog"] fieldset').first().waitFor();
      } },
      { nom: 'incident-autre', hash: H, geste: async (p) => { await cliquer(p.locator('.c-in-ouverts-tete button')); await fen(p); } },
      { nom: 'incident-fiche', hash: H, geste: async (p) => { await cliquer(p.locator('.c-in-fiche').first().locator('button').last()); await fen(p); } },
      { nom: 'incident-repousser', hash: H, geste: async (p) => { await cliquer(p.locator('.c-in-suites-liste > li').first().locator('.c-in-suite-gestes button').first()); await fen(p); } },
      { nom: 'incident-lire', hash: H, geste: async (p) => { await cliquer(p.locator('.c-in-table tbody tr').last().locator('button')); await fen(p); } },
      { nom: 'incident-annoncer', hash: H, geste: async (p) => { await cliquer(p.locator('.c-in-maint-gestes button:not(.c-btn-danger)')); await fen(p); } },
      { nom: 'incident-fermer-maintenant', hash: H, geste: async (p) => { await cliquer(p.locator('.c-in-maint-gestes .c-btn-danger')); await fen(p); } },
      // 1.113.0 : l'exercice de crise, de sa fenêtre à son compte rendu, son chrono en tête de l'écran.
      { nom: 'exercice-commencer', hash: H, geste: async (p) => { await cliquer(p.locator('.c-in-exercices .c-al-section-tete button')); await fen(p); } },
      { nom: 'exercice-en-cours', hash: H, geste: async (p) => {
        await cliquer(p.locator('.c-in-exercices .c-al-section-tete button')); await fen(p);
        await p.locator('[role="dialog"] input').first().fill('Amira et Karim');
        await cliquer(p.locator('[role="dialog"] .c-btn-principal'));
        await cliquer(p.locator('.c-in-ex-en .c-in-ex-suivant button'));
        await p.locator('.c-in-ex-en .c-in-ex-fait').waitFor();
      } },
      { nom: 'exercice-compte-rendu', hash: H, geste: async (p) => {
        await cliquer(p.locator('.c-in-exercices .c-al-section-tete button')); await fen(p);
        await p.locator('[role="dialog"] input').first().fill('Amira et Karim');
        await cliquer(p.locator('[role="dialog"] .c-btn-principal'));
        await cliquer(p.locator('.c-in-ex-en-pied .c-btn').last()); await fen(p);
      } },
    ];
    const { faux, vus } = await mesurerLaConsole({ ecrans: ECRANS, ouvrir: ouvrirEcran, photos: path.join(RACINE, 'dist/photos') });
    expect(faux).toEqual([]);
    expect(vus).toBe(ECRANS.length * 4);
    expect(erreurs).toEqual([]);
  }, 300_000);

  it('un point vide se refuse ; écrit, il entre dans l\'histoire de l\'incident', async () => {
    const p = await ouvrir(jD);
    await cliquer(p.locator('.c-in-ouvert').getByRole('button', { name: 'Ajouter un point…' }));
    const f = fenetre(p);
    await cliquer(f.getByRole('button', { name: 'Ajouter le point', exact: true }));
    await expect.poll(() => f.locator('.c-alerte-danger').count()).toBe(1);
    // Le refus reste jusqu'au clic suivant : effacé à la frappe, il ferait remonter le bouton sous le curseur.
    const bouton = f.getByRole('button', { name: 'Ajouter le point', exact: true });
    const avant = await bouton.boundingBox();
    await f.locator('textarea').pressSequentially('Le relais d\'e-mails répond de nouveau');
    expect(await f.locator('.c-alerte-danger').count()).toBe(1);
    expect((await bouton.boundingBox())?.y).toBe(avant?.y);
    await cliquer(bouton);
    expect(await toast(p)).toMatch(/^Point ajouté/);
    await expect.poll(() => p.locator('.c-in-points').innerText().then(net)).toContain('Le relais d\'e-mails répond de nouveau');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('clore demande le compte rendu ; clos, « Aucun incident ouvert » et l\'incident dans les passés, sa suite à tenir', async () => {
    const p = await ouvrir(jD);
    await cliquer(p.locator('.c-in-ouvert').getByRole('button', { name: 'Clore avec son compte rendu…' }));
    const f = fenetre(p);
    await cliquer(f.getByRole('button', { name: 'Clore l\'incident', exact: true }));
    await expect.poll(() => f.locator('.c-alerte-danger').innerText().then(net)).toMatch(/l'effet sur les clients/);
    const zones = f.locator('textarea');
    await zones.nth(0).fill('Les e-mails de connexion arrivaient avec vingt minutes de retard.');
    await zones.nth(1).fill('Le relais d\'e-mails limitait les envois.');
    await zones.nth(2).fill('Un second relais prend le relais seul.');
    await cliquer(f.getByRole('button', { name: 'Ajouter une suite' }));
    // La suite ajoutée reçoit le curseur : on la nomme sans aller la chercher.
    expect(await f.locator('fieldset input[type="text"]').evaluate((e) => e === document.activeElement)).toBe(true);
    await f.locator('fieldset input[type="text"]').fill('Brancher le second relais');
    await f.locator('fieldset input[type="date"]').fill(jour(7));
    await zones.nth(3).fill('compte rendu écrit');
    await cliquer(f.getByRole('button', { name: 'Clore l\'incident', exact: true }));
    expect(await toast(p)).toMatch(/est clos/);
    await expect.poll(() => p.locator('.c-in-aucun').count()).toBe(1);
    expect(net(await p.locator('main .c-btn-principal').innerText())).toBe('Ouvrir un incident…');
    expect(await p.locator('main .c-btn-principal').count()).toBe(1);
    await expect.poll(() => p.locator('.c-in-table tbody tr').count()).toBe(2);
    expect(await p.locator('.c-in-suites-liste > li').count()).toBe(2);
    // « Publier… » s'éteint sans incident ouvert, et le dit.
    expect(await p.locator('.c-in-page').getByRole('button', { name: 'Publier…' }).isDisabled()).toBe(true);
    expect(net(await p.locator('.c-in-pourquoi').innerText())).toMatch(/depuis un incident ouvert/);
    // La page publique garde le message jusqu'au passage de la veille : l'écran le dit.
    expect(net(await p.locator('.c-in-page .c-in-attend').innerText())).toMatch(/plus lieu d.être/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('une suite faite quitte la liste et se compte ; un compte rendu passé se relit', async () => {
    const p = await ouvrir(jD);
    const premiere = p.locator('.c-in-suites-liste > li').first();
    const titre = net(await premiere.locator('b').innerText());
    await cliquer(premiere.getByRole('button', { name: 'Marquer faite…' }));
    const f = fenetre(p);
    await f.locator('textarea').fill('le second relais est branché');
    await cliquer(f.getByRole('button', { name: 'Marquer faite', exact: true }));
    expect(await toast(p)).toMatch(/^Suite faite/);
    await expect.poll(() => p.locator('.c-in-suites-liste > li').count()).toBe(1);
    expect(net(await p.locator('.c-in-suites-liste').innerText())).not.toContain(titre);
    expect(net(await p.locator('.c-in-comptes').innerText())).toContain('1 faite');
    await cliquer(p.locator('.c-in-table tbody tr').last().getByRole('button', { name: /compte rendu de INC-/i }));
    const lu = net(await fenetre(p).innerText());
    expect(lu).toContain('214 factures électroniques ont attendu en file.');
    // Un compte de suites ne s'accorde pas à la main (« 1 suites faites ») : il se lit « faites : 1 sur 1 ».
    expect(lu).toMatch(/Suites faites\s?:\s?\d+ sur \d+/);
    await p.keyboard.press('Escape');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('une fiche réflexe se lit en quatre temps', async () => {
    const p = await ouvrir(jD);
    await cliquer(p.locator('.c-in-fiche').first().getByRole('button', { name: 'Lire la fiche · 4 temps' }));
    const f = fenetre(p);
    expect(await f.locator('.c-in-temps > li').count()).toBe(4);
    expect(net(await f.locator('h2').innerText())).toBe('Le service ne répond plus');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  // 1.109.0 : les messages prêts d'une fiche, et le carnet de crise.
  it('une fiche porte ses messages prêts, copiés d\'un geste ; « ouvrir » pose celui de la page d\'état, et le refuse tant que ses crochets ne sont pas remplis', async () => {
    const p = await ouvrir(jD);
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: serveur.adresse });
    const carte = (nom: string) => p.locator('.c-in-fiche').filter({ has: p.getByRole('heading', { name: nom, exact: true }) });
    await cliquer(carte('Un partenaire ne répond plus').getByRole('button', { name: 'Lire la fiche · 4 temps' }));
    const f = fenetre(p);
    expect(net(await f.locator('[data-pret="public"]').innerText())).toMatch(/^\[Le partenaire\] ne répond plus depuis \[heure\]/);
    await cliquer(f.getByRole('button', { name: 'Copier l\'e-mail, objet compris' }));
    await expect.poll(() => p.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/^Objet\u202f: \[Le partenaire\] ne répond plus\u202f: tes envois attendent\n\nBonjour,\n\nDepuis \[heure\]/);
    await p.keyboard.press('Escape');
    // La sauvegarde ne touche pas les clients : rien à copier.
    await cliquer(carte('Une sauvegarde manque ou est en retard').getByRole('button', { name: 'Lire la fiche · 4 temps' }));
    expect(await f.getByRole('button', { name: /^Copier/ }).count()).toBe(0);
    expect(net(await f.locator('.c-in-prets').innerText())).toContain('Rien sur la page d\'état');
    await p.keyboard.press('Escape');

    // Ouvrir sur la fiche (le lien des autres écrans) : la case cochée pose son message ; changer de fiche le change, tant
    // qu'on n'y a pas touché ; envoyé avec ses crochets, il se refuse en citant ce qui reste à remplir.
    await p.goto(`${serveur.adresse}/console/#/service/incidents?ouvrir=partenaire`);
    await p.reload();
    await f.getByRole('heading', { name: 'Ouvrir un incident' }).waitFor();
    await cliquer(f.getByRole('checkbox', { name: /Le dire tout de suite/ }));
    const pub = f.getByLabel('Ce que la page d\'état dira', { exact: true });
    expect(await pub.inputValue()).toMatch(/^\[Le partenaire\] ne répond plus depuis \[heure\]/);
    await f.getByLabel('La fiche réflexe', { exact: true }).selectOption('service');
    expect(net(await pub.inputValue())).toBe('SkanFact ne répond plus pour l\'instant ; nous y travaillons. Rien de ce qui est enregistré n\'est perdu. Prochain point dans trente minutes.');
    await pub.fill('Konnect ne répond plus depuis [heure].');
    await f.getByLabel('La fiche réflexe', { exact: true }).selectOption('partenaire');
    expect(await pub.inputValue()).toBe('Konnect ne répond plus depuis [heure].');
    await f.getByLabel('Motif', { exact: true }).fill('trois appels');
    await cliquer(f.getByRole('button', { name: 'Ouvrir l\'incident' }));
    await expect.poll(async () => net(await f.locator('.c-alerte-danger').innerText())).toContain('« [heure] »');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('le carnet de crise se télécharge : les fiches du serveur, rien à charger', async () => {
    const p = await ouvrir(jD);
    const [t] = await Promise.all([p.waitForEvent('download'), cliquer(p.getByRole('button', { name: 'Télécharger le carnet de crise' }))]);
    const jour = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Tunis' }).format(new Date());
    expect(t.suggestedFilename()).toBe(`carnet-de-crise-${jour}.html`);
    const html = fs.readFileSync(await t.path(), 'utf8');
    expect([...html.matchAll(/<article class="fiche" id="fiche-([a-z]+)">/g)].map((m) => m[1])).toEqual([...FICHES]);
    expect(html).not.toMatch(/<script|src=|url\(|https?:/i);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  // 1.107.0 (C24 bis). Les réponses du serveur sont jouées ici : les autres fichiers d'essais partagent la base, à l'heure
  // du jour, et une vraie fermeture leur répondrait « Maintenance en cours ». Le serveur est essayé à part
  // (tests/console/console.test.ts), à une heure où personne d'autre ne vit.
  it('fermer l\'application maintenant : la fenêtre dit ce qui va se passer ; fermée, un bandeau dont « Rouvrir » est le seul bouton principal', async () => {
    const p = await ouvrir(jD);
    let ferme: { texte: string; fin: string } | null = null;
    const envoye: { chemin: string; corps: Record<string, unknown> }[] = [];
    await p.route('**/v1/console/service/incidents', async (r) => {
      const rep = await r.fetch();
      const j = await rep.json() as { maintenances: unknown[]; maintenant: string };
      if (ferme) j.maintenances.unshift({ sorte: 'annoncee', le: j.maintenant, id: '01900000-0000-7000-8000-000000000164', titre: 'Maintenance urgente', texte: ferme.texte, debut: j.maintenant, fin: ferme.fin, par: 'Amira Essai', etat: 'en_cours', fermee: true });
      await r.fulfill({ response: rep, json: j });
    });
    await p.route(/\/v1\/console\/service\/(fermer-maintenant|maintenances\/[^/]+\/rouvrir)$/, async (r) => {
      const corps = r.request().postDataJSON() as Record<string, unknown>;
      envoye.push({ chemin: new URL(r.request().url()).pathname, corps });
      if (envoye.at(-1)?.chemin.endsWith('/fermer-maintenant')) { ferme = { texte: String(corps.texte), fin: String(corps.fin) }; await r.fulfill({ status: 201, json: { id: '01900000-0000-7000-8000-000000000164' } }); }
      else { ferme = null; await r.fulfill({ json: { ok: true } }); }
    });
    await cliquer(p.locator('.c-in-maintenances').getByRole('button', { name: 'Fermer l\'application maintenant…' }));
    const f = fenetre(p);
    expect(net(await f.locator('.c-al-ce-qui-va').innerText())).toMatch(/Maintenance en cours.*la console reste ouverte.*se rouvre seule/s);
    // Rien d'écrit : refusé sur ce que les clients liront, et rien ne part.
    await cliquer(f.getByRole('button', { name: 'Fermer l\'application', exact: true }));
    await expect.poll(() => f.locator('.c-alerte-danger').innerText().then(net)).toMatch(/de trois à cinq cents caractères/);
    expect(envoye).toEqual([]);
    const zones = f.locator('textarea');
    await zones.nth(0).fill('La base change de disque.');
    await zones.nth(1).fill('le disque se remplit');
    await cliquer(f.getByRole('button', { name: 'Fermer l\'application', exact: true }));
    expect(await toast(p)).toMatch(/^Application fermée aux clients/);
    expect(envoye.map((x) => x.chemin)).toEqual(['/v1/console/service/fermer-maintenant']);
    const fin = Date.parse(String(envoye[0]?.corps.fin));
    expect(fin - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(fin - Date.now()).toBeLessThanOrEqual(12 * 3_600_000);
    // Fermée : le bandeau en tête, ce que lisent les clients, et un seul bouton principal, « Rouvrir ».
    await expect.poll(() => p.locator('.c-in-fermee').count()).toBe(1);
    expect(net(await p.locator('.c-in-fermee').innerText())).toMatch(/L'application est fermée aux clients.*La base change de disque\./s);
    expect(await p.locator('main .c-btn-principal').count()).toBe(1);
    expect(net(await p.locator('main .c-btn-principal').innerText())).toBe('Rouvrir l\'application…');
    expect(await p.locator('.c-in-maintenances').getByRole('button', { name: 'Fermer l\'application maintenant…' }).count()).toBe(0);
    expect(net(await p.locator('.c-in-maint-liste').innerText())).toContain('l\'application est fermée · Rouvrir l\'application…');
    await cliquer(p.locator('main .c-btn-principal'));
    await f.locator('textarea').fill('le disque est changé');
    await cliquer(f.getByRole('button', { name: 'Rouvrir l\'application', exact: true }));
    await expect.poll(() => toast(p)).toMatch(/^Application rouverte/);
    expect(envoye.at(-1)).toEqual({ chemin: '/v1/console/service/maintenances/01900000-0000-7000-8000-000000000164/rouvrir', corps: { motif: 'le disque est changé' } });
    await expect.poll(() => p.locator('.c-in-fermee').count()).toBe(0);
    expect(net(await p.locator('main .c-btn-principal').innerText())).not.toBe('Rouvrir l\'application…');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('annoncer une maintenance qui fermera l\'application : la case part avec l\'annonce', async () => {
    const p = await ouvrir(jD);
    let corps: Record<string, unknown> | null = null;
    await p.route('**/v1/console/service/maintenances', async (r) => { corps = r.request().postDataJSON() as Record<string, unknown>; await r.fulfill({ status: 201, json: { id: '01900000-0000-7000-8000-000000000165' } }); });
    await cliquer(p.locator('.c-in-maintenances').getByRole('button', { name: 'Annoncer…' }));
    const f = fenetre(p);
    await f.locator('input[type="text"]').first().fill('Le disque agrandi');
    const zones = f.locator('textarea');
    await zones.nth(0).fill('Rien ne s\'écrit pendant une heure.');
    await cliquer(f.getByText('fermer l\'application aux clients pendant le créneau', { exact: false }));
    await zones.nth(1).fill('prévu avec l\'hébergeur');
    await cliquer(f.getByRole('button', { name: 'Annoncer', exact: true }));
    expect(await toast(p)).toMatch(/l'application sera fermée pendant/);
    expect(corps).toMatchObject({ titre: 'Le disque agrandi', fermee: true });
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  // 1.113.0 (0166 ; C24 quater) : les exercices de crise.
  it('un exercice se joue temps par temps, survit à la page rechargée ; « réussi » attend les quatre temps ; noté, il se relit et compte', async () => {
    const p = await ouvrir(jD);
    await cliquer(p.getByRole('button', { name: 'Faire un exercice…' }));
    let f = fenetre(p);
    await f.getByLabel('La fiche jouée').selectOption('site');
    // Personne pour jouer : refusé, le champ montré.
    await cliquer(f.getByRole('button', { name: 'Commencer l\'exercice' }));
    await expect.poll(() => f.getByRole('alert').innerText()).toMatch(/Dis qui joue/);
    expect(await p.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    await f.getByLabel('Qui joue').fill('Amira et Karim, chrono : Amira');
    await cliquer(f.getByRole('button', { name: 'Commencer l\'exercice' }));
    // Le chrono part en tête de l'écran, à la vue : l'exercice commence d'un bouton du bas (recette du 22/10/2026).
    const en = p.locator('.c-in-ex-en');
    await expect.poll(() => en.count()).toBe(1);
    expect(net(await en.locator('h2').innerText())).toBe('Exercice en cours : le site principal est perdu');
    // Le chrono se lit à l'écran (le cadre peut dépasser vers le bas ; jamais le chrono hors de la vue).
    await expect.poll(() => en.locator('.c-in-ex-chrono').evaluate((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= innerHeight + 1 ? 'à la vue' : `hors de la vue : haut ${Math.round(r.top)}, bas ${Math.round(r.bottom)}, écran ${innerHeight}, défilé ${Math.round(scrollY)}`;
    })).toBe('à la vue');
    // Un seul « Fait » à la fois : celui du temps suivant ; pendant l'exercice, on n'en commence pas un second.
    expect(await en.getByRole('button', { name: 'Fait', exact: true }).count()).toBe(1);
    expect(await p.getByRole('button', { name: 'Faire un exercice…' }).count()).toBe(0);
    await cliquer(en.getByRole('button', { name: 'Fait', exact: true }));
    await expect.poll(() => en.locator('.c-in-ex-fait').count()).toBe(1);
    // Rechargée, la page retrouve l'exercice et le temps coché.
    await p.reload();
    await expect.poll(() => p.locator('.c-in-ex-en .c-in-ex-fait').count(), { timeout: 20_000 }).toBe(1);
    await cliquer(p.locator('.c-in-ex-en').getByRole('button', { name: 'Fait', exact: true }));
    await cliquer(p.locator('.c-in-ex-en').getByRole('button', { name: 'Terminer et écrire le compte rendu…' }));
    f = fenetre(p);
    await f.getByLabel('Ce qui a marché').fill('La fiche se lit vite.');
    await f.getByLabel('Ce qui a coincé').fill('Personne ne savait où était la copie du site.');
    await f.getByLabel('Ce qu\'on change').fill('Noter l\'adresse de la copie au carnet.');
    // Deux temps sur quatre : le verdict proposé est « à refaire » ; « réussi » se refuse et dit ce qui manque.
    expect(await f.getByRole('button', { name: 'À refaire' }).getAttribute('aria-pressed')).toBe('true');
    await cliquer(f.getByRole('button', { name: 'Réussi' }));
    await cliquer(f.getByRole('button', { name: 'Noter l\'exercice' }));
    await expect.poll(() => f.getByRole('alert').innerText()).toMatch(/il en manque 2/);
    await cliquer(f.getByRole('button', { name: 'À refaire' }));
    await cliquer(f.getByRole('button', { name: 'Noter l\'exercice' }));
    expect(await toast(p)).toBe('Exercice noté, à refaire.');
    // Noté : le bandeau s'en va, l'onglet l'oublie, la fiche le dit, la liste le porte.
    await expect.poll(() => p.locator('.c-in-ex-en').count()).toBe(0);
    expect(await p.evaluate(() => sessionStorage.getItem('skanfact.console.exercice'))).toBeNull();
    const carte = p.locator('.c-in-fiche').filter({ hasText: 'Le site principal est perdu' });
    await expect.poll(async () => net(await carte.locator('.c-in-fiche-pied .c-sous').innerText())).toMatch(/^À refaire depuis le /);
    const ligne = p.locator('.c-in-table-ex tbody tr').filter({ hasText: 'Le site principal est perdu' }).first();
    expect(net(await ligne.innerText())).toContain('À refaire');
    await cliquer(ligne.getByRole('button', { name: 'Lire' }));
    f = fenetre(p);
    expect(net(await f.innerText())).toMatch(/Joué aujourd'hui, \d\d:\d\d · \d+ min · Amira et Karim, chrono : Amira\./);
    expect((await f.locator('.c-in-temps > li p').allInnerTexts()).map(net)).toEqual([expect.stringMatching(/^Fait à \d+ min$/), expect.stringMatching(/^Fait à \d+ min$/), 'Pas fait', 'Pas fait']);
    expect(net(await f.locator('.c-in-ex-cr').innerText())).toContain('Personne ne savait où était la copie du site.');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('quatre temps faits : « réussi » est proposé, et la fiche compte pour le lancement ; un exercice de plus de douze heures n\'est pas rouvert', async () => {
    const p = await ouvrir(jD);
    await cliquer(p.getByRole('button', { name: 'Faire un exercice…' }));
    let f = fenetre(p);
    await f.getByLabel('La fiche jouée').selectOption('acces');
    await f.getByLabel('Qui joue').fill('Walid, seul au poste');
    await cliquer(f.getByRole('button', { name: 'Commencer l\'exercice' }));
    const en = p.locator('.c-in-ex-en');
    for (let k = 1; k <= 4; k++) {
      await cliquer(en.getByRole('button', { name: 'Fait', exact: true }));
      await expect.poll(() => en.locator('.c-in-ex-fait').count()).toBe(k);
    }
    await cliquer(en.getByRole('button', { name: 'Terminer et écrire le compte rendu…' }));
    f = fenetre(p);
    expect(await f.getByRole('button', { name: 'Réussi' }).getAttribute('aria-pressed')).toBe('true');
    await f.getByLabel('Ce qui a marché').fill('Les sessions se coupent d\'un geste.');
    await f.getByLabel('Ce qui a coincé').fill('Rien de bloquant.');
    await f.getByLabel('Ce qu\'on change').fill('Rien pour cette fiche.');
    await cliquer(f.getByRole('button', { name: 'Noter l\'exercice' }));
    expect(await toast(p)).toBe('Exercice noté : il compte pour le lancement.');
    // Les données se relisent après le toast : on attend la fiche, puis le compteur (la même lecture).
    await expect.poll(async () => net(await p.locator('.c-in-fiche').filter({ hasText: 'Un accès suspect, un compte volé' }).locator('.c-in-fiche-pied .c-sous').innerText())).toMatch(/^Exercée le /);
    expect(net(await p.locator('.c-in-ex-compte').innerText())).not.toMatch(/Un accès suspect/);
    await fermer(p);
    // Un exercice laissé ouvert dans l'onglet depuis treize heures ne se noterait plus : la page ne le rouvre pas.
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript(([j, e]) => { sessionStorage.setItem('skanfact.console.jeton', j); sessionStorage.setItem('skanfact.console.exercice', e); },
      [jD, JSON.stringify({ fiche: 'base', debut: new Date(Date.now() - 13 * 3_600_000).toISOString(), participants: 'Hier soir', temps: [3, null, null, null] })] as const);
    const q = await cx.newPage();
    await q.goto(`${serveur.adresse}/console/#/service/incidents`);
    await expect.poll(() => q.locator('.c-in-fiche').count(), { timeout: 20_000 }).toBe(FICHES.length);
    expect(await q.locator('.c-in-ex-en').count()).toBe(0);
    expect(await q.getByRole('button', { name: 'Faire un exercice…' }).count()).toBe(1);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 90_000);

  it('au téléphone : rien ne déborde, et chaque cible se touche du doigt', async () => {
    const p = await ouvrir(jD, 390);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const petites = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a')]
      .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 44 && !e.closest('.c-defile'))
      .map((e) => `${e.className} « ${e.innerText.trim().slice(0, 30)} » ${Math.round(e.getBoundingClientRect().height)}`));
    expect(petites).toEqual([]);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
});
