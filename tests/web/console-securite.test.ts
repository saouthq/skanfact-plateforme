// « Sécurité » du service, à la souris (Console 3e ; docs/console.md C26 ; serveur/console/securite.ts ;
// web/console/src/ecrans/Securite.tsx). Les défis et les attentes se posent dans la base comme les règles de connexion
// les écrivent. Ce que le parcours vérifie :
//   - l'onglet allumé, les quatre chiffres ;
//   - un mot de passe connu (des codes faux après lui) passe avant un compte freiné, et se dit « à regarder d'abord » ;
//   - lever l'attente : un motif trop court se refuse, et le bouton ne bouge pas sous le curseur quand on retape ; levée,
//     la ligne s'en va et le geste entre au journal ;
//   - les règles disent leurs chiffres et ce qu'elles ne comptent pas ; les clés de commande, leur nom seul ;
//   - la chaîne d'empreintes (0142, C66) : une facture retouchée par-dessous la base, l'entreprise relue depuis l'écran
//     (son numéro de client), la rupture nommée au maillon près, puis l'incident ouvert d'un clic, sa fenêtre déjà remplie ;
//   - au téléphone : rien ne déborde, l'équipe se lit sans défilement de côté.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerPool } from '../../serveur/base.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { faireLaRelectureDemandee } from '../../serveur/service/contenus.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

type Membre = { email: string; secret: string; id: string };

describe('la sécurité du service, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-securite-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-securite-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jD = '';
  const pool = creerPool(inject('pgApp'));

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
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/#/service/securite`);
    await expect.poll(() => p.locator('.c-se-regles-liste > li').count(), { timeout: 20_000 }).toBe(6);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  // Les lignes de CE parcours : les tables sont partagées avec d'autres tests.
  const regards = (p: Page) => p.locator('.c-se-regard').filter({ hasText: 'Sécurité Essai' });

  beforeAll(async () => {
    await admin.connect();
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `console-securite-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Essai', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai de la sécurité à la souris');
    const id = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0]?.id);
    jD = await jetonConsole({ email, secret, id });
    // Un client : quatre codes faux après un mot de passe bon (pas abouti) ; un autre, freiné par sept mots de passe faux.
    const connu = `securite-connu-${Date.now()}@exemple.tn`, freine = `securite-freine-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: connu, nom: 'Sécurité Essai Connu', motDePasse: MDP });
    await api('POST', '/inscription', undefined, { email: freine, nom: 'Sécurité Essai Freiné', motDePasse: MDP });
    const idConnu = String((await admin.query('select id from socle.utilisateur where email = $1', [connu])).rows[0]?.id);
    await admin.query(`insert into socle.defi_connexion (utilisateur, methode, cree_le, expire_le, erreurs) values ($1, 'sms', now(), now() + interval '10 minutes', 4)`, [idConnu]);
    await admin.query(`insert into socle.tentative (cle, erreurs, attente_jusqu_au, derniere) values ($1, 7, now() + interval '15 minutes', now())`, [freine]);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end(); await pool.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('l\'onglet allumé, les quatre chiffres ; un mot de passe connu passe avant un compte freiné', async () => {
    const p = await ouvrir(jD);
    expect(net(await p.locator('.c-sv-onglets [aria-current="page"]').innerText())).toBe('Sécurité');
    expect(await p.locator('.c-tr-tuiles .c-sv-tuile').count()).toBe(4);
    await expect.poll(() => regards(p).count()).toBe(2);
    const premier = net(await regards(p).first().innerText());
    expect(premier).toContain('Sécurité Essai Connu');
    expect(premier).toMatch(/À regarder d.abord/);
    expect(premier).toMatch(/4 codes faux/);
    expect(net(await regards(p).last().innerText())).toMatch(/7 mots de passe faux/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('lever l\'attente : un motif court se refuse, le bouton ne bouge pas quand on retape ; levée, la ligne s\'en va', async () => {
    const p = await ouvrir(jD);
    await cliquer(regards(p).last().getByRole('button', { name: /Lever l.attente/ }));
    const f = p.locator('[role="dialog"]');
    await f.locator('textarea').fill('ok');
    const bouton = f.getByRole('button', { name: 'Lever l\'attente', exact: true });
    await cliquer(bouton);
    await expect.poll(() => f.locator('.c-alerte-danger').count()).toBe(1);
    const avant = await bouton.boundingBox();
    await f.locator('textarea').pressSequentially(' : elle a appelé');
    const apres = await bouton.boundingBox();
    expect(apres?.y).toBe(avant?.y);
    await cliquer(bouton);
    await expect.poll(() => regards(p).count()).toBe(1);
    expect(net(await regards(p).innerText())).toContain('Connu');
    const g = (await admin.query("select motif from plateforme.geste_console where geste = 'service.lever_attente' order by le desc limit 1")).rows[0];
    expect(g?.motif).toBe('ok : elle a appelé');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('les règles disent leurs chiffres et ce qu\'elles ne comptent pas ; les clés de commande, leur nom seul', async () => {
    const p = await ouvrir(jD);
    const regles = net(await p.locator('.c-se-regles').innerText());
    expect(regles).toMatch(/Après 5 erreurs sur un compte : attendre 1 minute, puis 5, puis 15, puis 60/);
    expect(regles).toContain('pas compté');
    expect(await p.locator('.c-se-cles-liste > li').count()).toBeGreaterThan(0);
    expect(net(await p.locator('.c-se-cles').innerText())).not.toMatch(/PUBLIC KEY/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('les secrets (0130) : vide, le registre dit quoi y noter ; une valeur est refusée, le nom et les dates se notent ; renouvelé, l\'échéance repart', async () => {
    await admin.query('delete from plateforme.secret_suivi');
    const p = await ouvrir(jD);
    const carte = p.locator('section[aria-labelledby="se-secrets"]');
    await expect.poll(() => carte.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('Aucun secret au registre');
    await cliquer(carte.getByRole('button', { name: 'Noter un secret…', exact: true }));
    const f = p.getByRole('dialog');
    expect(net(await f.locator('.c-alerte-attention').innerText())).toContain('N\'écris jamais la valeur d\'un secret');
    await f.getByLabel('Son nom', { exact: true }).fill('Clé du relais d\'e-mails');
    await f.getByLabel('À quoi il sert', { exact: true }).fill('les e-mails de connexion et des alertes');
    // Collée par erreur, une valeur : la base la refuse, et la fenêtre le dit.
    await f.getByLabel('Où il vit', { exact: true }).fill('re_8Kf2xQmZ9pLwT4vN7bY1cR6sH3jD0aE5');
    await f.getByLabel('À renouveler tous les (jours)', { exact: true }).fill('365');
    await f.getByLabel('Motif', { exact: true }).fill('mise en route du registre');
    await cliquer(f.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => f.locator('.c-alerte-danger').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('ressemble à la valeur d\'un secret');
    expect((await admin.query('select count(*)::int n from plateforme.secret_suivi')).rows[0].n).toBe(0);
    await f.getByLabel('Où il vit', { exact: true }).fill('le serveur, la variable SKANFACT_RESEND');
    await cliquer(f.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => p.locator('#c-toast').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe('« Clé du relais d\'e-mails » est au registre.');
    const ligne = carte.locator('tbody tr', { hasText: 'Clé du relais d\'e-mails' });
    await expect.poll(() => ligne.innerText().then(net).catch(() => ''), { timeout: 10_000 }).toMatch(/À jour Dans 365 jours, le \d{2}\/\d{2}\/\d{4} À renouveler tous les 365 jours/);
    // Vieilli de trois cent cinquante jours : bientôt ; renouvelé aujourd'hui, à jour.
    await admin.query("update plateforme.secret_suivi set renouvele_le = renouvele_le - 350");
    await p.reload();
    await expect.poll(() => ligne.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('Bientôt Dans 15 jours');
    await cliquer(ligne.getByRole('button', { name: 'Gestes sur Clé du relais d\'e-mails', exact: true }));
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Noter son renouvellement' }));
    const r = p.getByRole('dialog');
    await r.getByLabel('Motif', { exact: true }).fill('nouvelle clé chez le prestataire');
    await cliquer(r.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => ligne.innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('À jour Dans 365 jours');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('la chaîne d\'empreintes : relue par le serveur au démarrage, trente jours en cases, le contenu des pièces aussi', async () => {
    const p = await ouvrir(jD);
    const carte = p.locator('.c-se-chaine');
    // Le serveur relit les chaînes à son démarrage : l'écran le dit (au besoin, après une relecture de la page).
    await expect.poll(async () => { await p.reload(); await carte.waitFor(); return net(await carte.innerText()); }, { timeout: 30_000 }).not.toMatch(/Pas encore relue/);
    const texte = net(await carte.innerText());
    expect(texte).toMatch(/Dernière relecture/i);
    expect(texte).toMatch(/le serveur relit 200 chaînes chaque heure/i);
    // Le contenu de chaque pièce (0142) : relu au même tour, jamais « pas encore mesuré » une fois relu.
    expect(texte).not.toContain('Pas encore mesuré');
    expect(texte).toMatch(/Le serveur relit le contenu de 50 chaînes chaque heure ; la dernière fois/);
    expect(await carte.locator('.c-se-jour').count()).toBe(30);
    expect(await carte.locator('.c-se-jour.c-ton-nonmesure').count()).toBeLessThan(30);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('une facture retouchée par-dessous la base : relue depuis l\'écran, la rupture nommée, l\'incident ouvert d\'un clic', async () => {
    // Une entreprise qui a émis une facture (le premier maillon de sa série).
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    const email = `securite-chaine-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Chaîne Essai', motDePasse: MDP });
    const jP = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jP, { raisonSociale: 'Atelier Chaîne Essai', matriculeFiscal: `${String(Date.now()).slice(-7)}A/A/M/000` })).corps.id);
    await api('POST', '/moi/code', jP, { methode: 'application' });
    await api('POST', `/entreprises/${ent}/series`, jP, { type: 'facture', prefixe: 'FAC', legale: true });
    const client = String((await api('POST', `/entreprises/${ent}/clients`, jP, { raisonSociale: 'Garage Nord', identifiant: '7654321B/A/M/000', typeIdentifiant: 'matricule' })).corps.id);
    const piece = String((await api('POST', `/entreprises/${ent}/ventes`, jP, { type: 'facture', tiers: client, datePiece: '2026-09-15',
      lignes: [{ designation: 'Étagère', quantite: '2', prixUnitaire: '345.678', tauxTva: '19' }] })).corps.id);
    expect((await api('POST', `/entreprises/${ent}/ventes/${piece}/emettre`, jP)).statut).toBeLessThan(300);
    const numero = String((await admin.query('select plateforme.numero_texte($1) v', [ent])).rows[0]?.v);
    // Un millime de moins, par-dessous la base (déclencheurs suspendus) : son maillon, lui, n'a pas bougé.
    const parDessous = async (sens: '-' | '+') => {
      await admin.query('begin');
      await admin.query('set local session_replication_role = replica');
      await admin.query(`update ventes.piece set net_a_payer = net_a_payer ${sens} 1 where id = $1`, [piece]);
      await admin.query('commit');
    };
    await parDessous('-');

    const p = await ouvrir(jD);
    const carte = p.locator('.c-se-chaine');
    await carte.waitFor();
    // Relire une entreprise : « une entreprise », son numéro, le motif. Le choix ne pousse pas le motif sous le curseur.
    await cliquer(carte.getByRole('button', { name: 'Relire maintenant…', exact: true }));
    const f = p.getByRole('dialog');
    const motif = f.getByLabel('Motif', { exact: true });
    const avant = await motif.boundingBox();
    await cliquer(f.getByRole('button', { name: 'Une entreprise', exact: true }));
    expect((await motif.boundingBox())?.y).toBe(avant?.y);
    // Sans numéro : refusé, le champ le montre.
    await motif.fill('le client doute d\'une facture');
    await cliquer(f.getByRole('button', { name: 'Relire maintenant', exact: true }));
    await expect.poll(() => f.locator('.c-alerte-danger').innerText().then(net).catch(() => '')).toContain('Écris le numéro de client');
    await f.getByLabel('Son numéro de client', { exact: true }).fill(numero);
    await cliquer(f.getByRole('button', { name: 'Relire maintenant', exact: true }));
    await expect.poll(() => p.locator('#c-toast').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe('Relecture demandée : elle commence dans la minute.');
    // Pendant qu'elle attend : le geste reste en place, désactivé, avec sa raison.
    await expect.poll(() => carte.locator('[data-relecture="en-cours"]').count(), { timeout: 10_000 }).toBe(1);
    expect(await carte.getByRole('button', { name: 'Relire maintenant…', exact: true }).isDisabled()).toBe(true);
    fs.mkdirSync(PHOTOS, { recursive: true });
    await carte.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'console-securite-1-relecture-demandee.png') });
    expect(net(await carte.innerText())).toContain('Une relecture est en cours : la suivante se demande quand elle est finie.');
    // Le serveur la fait (sa minute, ou tout de suite ici) : l'écran, qui se relit de près, la dit finie.
    await faireLaRelectureDemandee(pool);
    await expect.poll(() => carte.locator('[data-relecture="finie"]').innerText().then(net).catch(() => ''), { timeout: 20_000 }).toMatch(/Finie .* : une chaîne et une pièce relues ; une chaîne cassée\.$/);
    const ligne = carte.locator('tbody tr', { hasText: 'Atelier Chaîne Essai' });
    expect(net(await ligne.innerText())).toMatch(new RegExp(`Les factures d.une série ${numero} · Atelier Chaîne Essai Le contenu d.une pièce Au maillon 1 : pièce modifiée`));
    await carte.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'console-securite-2-chaine-cassee.png') });
    // Une chaîne cassée : l'étape suivante est l'incident, déjà rempli sur sa fiche réflexe.
    const alerte = carte.locator('.c-alerte-danger');
    expect(net(await alerte.innerText())).toContain('Une chaîne cassée est un incident : ne rien réparer, ne rien effacer.');
    await cliquer(alerte.getByRole('link', { name: 'Ouvrir l\'incident', exact: true }));
    const o = p.getByRole('dialog');
    await expect.poll(() => o.getByLabel('Ce qui se passe', { exact: true }).inputValue().catch(() => ''), { timeout: 15_000 }).toBe('Une chaîne d\'empreintes cassée');
    expect(await o.locator('select').inputValue()).toBe('empreinte');
    expect(await o.getByRole('button', { name: 'Critique', exact: true }).getAttribute('aria-pressed')).toBe('true');
    // Tout est rempli sauf le motif : le curseur l'attend.
    expect(await o.getByLabel('Motif', { exact: true }).evaluate((e) => e === document.activeElement)).toBe(true);
    expect(p.url()).toMatch(/#\/service\/incidents$/);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'console-securite-3-incident-prerempli.png') });
    await o.getByLabel('Motif', { exact: true }).fill('relecture du contenu : une facture modifiée');
    await cliquer(o.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => p.locator('#c-toast').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toMatch(/ouvert/i);
    const inc = (await admin.query("select id, annee, numero from plateforme.service_incident where fiche = 'empreinte' and clos_le is null order by ouvert_le desc limit 1")).rows[0] as { id: string; annee: number; numero: number };
    const ref = `INC-${inc.annee}-${String(inc.numero).padStart(3, '0')}`;
    // Revenu sur Sécurité : l'incident est relié, et se suit d'un clic.
    await p.goto(`${serveur.adresse}/console/#/service/securite`);
    await expect.poll(() => p.locator('.c-se-chaine .c-alerte-danger').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain(`L'incident ${ref} est ouvert sur cette rupture`);
    expect(await p.locator('.c-se-chaine .c-alerte-danger').getByRole('link', { name: `Suivre ${ref}`, exact: true }).count()).toBe(1);
    expect(erreurs).toEqual([]);
    await fermer(p);
    // Remise, relue, l'incident clos : les essais suivants ne voient pas une chaîne cassée.
    await parDessous('+');
    expect((await api('POST', `/console/service/incidents/${inc.id}/clore`, jD, {
      fin: new Date().toISOString(), effet: 'aucun effet chez un client', cause: 'une retouche d\'essai', change: 'rien à changer, un essai', motif: 'essai fini', suites: [],
    })).statut).toBe(200);
    await api('POST', '/console/service/securite/relire', jD, { client: numero, motif: 'remise après l\'essai' });
    await faireLaRelectureDemandee(pool);
  }, 120_000);

  it('au téléphone : rien ne déborde, l\'équipe se lit sans défilement de côté', async () => {
    const p = await ouvrir(jD, 390);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await p.locator('.c-se-table').evaluate((t) => t.scrollWidth - (t.parentElement?.clientWidth ?? 0))).toBeLessThanOrEqual(0);
    expect(await p.locator('.c-se-table thead').isVisible()).toBe(false);
    const petites = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a')]
      .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.className} « ${e.innerText.trim().slice(0, 30)} » ${Math.round(e.getBoundingClientRect().height)}`));
    expect(petites).toEqual([]);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
});
