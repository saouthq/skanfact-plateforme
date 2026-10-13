// « Les alertes » du service, à la souris, sur de vraies alertes (Console 3c ; docs/console.md C13 ; serveur/console/
// alertes.ts ; web/console/src/ecrans/Alertes.tsx). Les alertes passent par la VRAIE porte de la veille
// (plateforme.noter_veille), relevé après relevé, dans l'ordre du temps. Ce que le parcours vérifie, chacun trouvé à la
// souris avant d'être écrit ici :
//   - un seul bouton principal à l'écran : « Prendre en charge » de l'alerte la plus urgente que personne n'a prise ; une
//     fois prise, il passe à la suivante ;
//   - un motif vide se refuse dans la fenêtre, et le refus s'efface dès qu'on écrit ;
//   - la fin d'une sourdine se dit la même dans le message et sur la ligne de sa règle (celle que le serveur a posée) ;
//   - le menu d'une règle reste dans l'écran, même sur la dernière ligne du tableau ; le tableau des règles tient sans
//     défiler de côté ;
//   - « Voir ses alertes passées » filtre l'histoire sur la règle, sans redire son nom sous chaque alerte ; un filtre qui
//     raccourcit la liste au bas de la page ne fait pas glisser ses pilules sous la souris ;
//   - l'essai demandé attend la veille, et son bouton s'éteint ;
//   - au téléphone : rien ne déborde, et une commande défile dans sa carte au lieu de se casser au milieu d'un chemin.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const MIN = 60_000;

type Membre = { email: string; secret: string };

describe('les alertes du service, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-alertes-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-alertes-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let direction: Membre;

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
    await p.goto(`${serveur.adresse}/console/#/service/alertes`);
    await expect.poll(() => p.locator('.c-al-alerte').count(), { timeout: 20_000 }).toBe(2);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const fenetre = (p: Page) => p.locator('[role="dialog"]');
  const toast = async (p: Page) => { await expect.poll(() => p.locator('#c-toast.c-montre').count()).toBe(1); return net(await p.locator('#c-toast').innerText()); };
  // Le menu d'une règle, par la ligne qui porte son nom.
  const menuDe = (p: Page, nom: string) => p.locator('.c-al-regles tbody tr', { has: p.locator('b', { hasText: new RegExp(`^${nom}$`) }) }).locator('.c-menu-btn');

  const maintenant = Math.floor(Date.now() / MIN) * MIN;
  const t = (min: number) => new Date(maintenant - min * MIN).toISOString();

  beforeAll(async () => {
    await admin.connect();
    // Les tests passent l'un après l'autre et partagent la base : celui-ci part de tables du service vides.
    await admin.query('truncate plateforme.service_releve, plateforme.service_alerte, plateforme.service_envoi, plateforme.service_sourdine, plateforme.service_demande, plateforme.service_minute');
    const releve = (min: number) => ({ minute: t(min), repond: true, charge: 0.4, memoire: 40, processeurs: 2, disques: [{ point: '/var', pourcent: 80 }], version: 'aaaaaaa', certificat: null, archiveLe: null,
      destinataires: { courriel: { a: 'e•••@•••.tn', pret: true }, sms: { a: '+216 •• ••• 456', pret: true } },
      regles: { pannes: { etat: 'calme', part: 0, n: 252 }, temps: { etat: 'calme', p95: 120, lectures: 400 } } });
    const hors = (depuis: number, grave: boolean, minutes: number) => ({ 'hors-machine': { titre: `la copie hors de la machine est en retard de ${minutes} minutes`, grave, regle: 'hors-machine',
      faire: 'f', depuis: t(depuis), etapes: [{ texte: 'Sur le serveur, l\'état de la copie :', code: 'sudo systemctl status skanfact-hors-machine' },
        { texte: 'Le détail de chaque envoi :', code: '/var/lib/skanfact/hors-machine/hors-machine.json' }] } });
    const disque = { 'disque:/var': { titre: 'le disque /var est plein à 80 %', grave: false, regle: 'disques', faire: 'f', depuis: t(180),
      etapes: [{ texte: 'Libère de la place, ou agrandis le disque chez l\'hébergeur. Ce qui le remplit :', code: 'sudo du -xhd1 /var | sort -h | tail -n 8' }] } };
    const envoi = (min: number, cle: string, sorte: string, grave: boolean, depuis: number) => ({ le: t(min), sorte, cle, titre: cle, depuis: t(depuis), grave, courriel: true, sms: true });
    const noter = (min: number, problemes: unknown, envois: unknown[] = []) =>
      admin.query('select plateforme.noter_veille($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)', [JSON.stringify(releve(min)), JSON.stringify(problemes), '[]', JSON.stringify(envois)]);
    // Il y a trois jours, la copie hors de la machine a pris une heure de retard, puis s'est rattrapée toute seule.
    await noter(3 * 1440, hors(3 * 1440, true, 75), [envoi(3 * 1440, 'hors-machine', 'nouveau', true, 3 * 1440)]);
    await noter(3 * 1440 - 60, {}, [envoi(3 * 1440 - 60, 'hors-machine', 'regle', true, 3 * 1440)]);
    // Aujourd'hui : le disque depuis trois heures, puis la copie depuis une heure et demie, devenue grave.
    await noter(180, disque, [envoi(180, 'disque:/var', 'nouveau', false, 180)]);
    await noter(90, { ...disque, ...hors(90, false, 15) }, [envoi(90, 'hors-machine', 'nouveau', false, 90)]);
    await noter(1, { ...disque, ...hors(90, true, 90) }, [envoi(30, 'hors-machine', 'rappel', true, 90)]);
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `console-alertes-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Essai', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai des alertes à la souris');
    direction = { email, secret };
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('un seul bouton principal, qui passe à la suivante ; un motif vide se refuse, et le refus s\'efface quand on écrit', async () => {
    const p = await ouvrir(await jetonConsole(direction));
    const cartes = p.locator('.c-al-alerte');
    // La plus grave d'abord : la copie, puis le disque.
    expect(net(await cartes.nth(0).locator('h2').innerText())).toBe('La copie hors de la machine est en retard de 90 minutes');
    const principaux = p.locator('main .c-btn-principal');
    expect(await principaux.count()).toBe(1);
    expect(await cartes.nth(0).locator('.c-btn-principal').count()).toBe(1);
    // Le tableau des règles tient sans défiler de côté.
    expect(await p.locator('.c-al-regles .c-defile').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);

    await cliquer(cartes.nth(0).getByRole('button', { name: 'Prendre en charge…' }));
    const f = fenetre(p);
    await cliquer(f.getByRole('button', { name: 'Prendre en charge', exact: true }));
    await expect.poll(() => f.locator('.c-alerte-danger').count()).toBe(1);
    await f.locator('textarea').fill('je relance l\'envoi');
    expect(await f.locator('.c-alerte-danger').count()).toBe(0);
    await cliquer(f.getByRole('button', { name: 'Prendre en charge', exact: true }));
    expect(await toast(p)).toMatch(/^Alerte prise en charge/);
    await expect.poll(() => cartes.nth(0).locator('.c-al-faits').innerText().then(net)).toContain('Par toi');
    // Le bouton principal passe à la carte suivante, que personne n'a prise.
    await expect.poll(() => cartes.nth(1).locator('.c-btn-principal').count()).toBe(1);
    expect(await principaux.count()).toBe(1);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('la sourdine d\'une règle, depuis son menu : la même fin dans le message et sur la ligne ; le menu reste dans l\'écran', async () => {
    const p = await ouvrir(await jetonConsole(direction));
    // La dernière ligne du tableau, amenée au bas de l'écran : son menu s'ouvre vers le haut plutôt que de sortir.
    // (Les règles prévues n'ont pas de menu : la dernière qui en a un.)
    const derniere = p.locator('.c-al-regles tbody tr .c-menu-btn').last();
    await derniere.evaluate((e) => { const r = e.getBoundingClientRect(); window.scrollBy(0, r.bottom - window.innerHeight + 8); });
    const avant = await p.evaluate(() => window.scrollY);
    await cliquer(derniere);
    const liste = p.locator('.c-menu-liste');
    await expect.poll(() => liste.count()).toBe(1);
    await p.waitForTimeout(150);
    // La page ne saute pas sous la souris (le premier choix prenait le clavier en la faisant défiler de 440 points), et
    // le menu s'ouvre dans l'écran.
    expect(await p.evaluate(() => window.scrollY)).toBe(avant);
    const b = await liste.boundingBox();
    expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(900);
    expect(b?.y ?? -1).toBeGreaterThanOrEqual(0);
    await p.keyboard.press('Escape');
    await expect.poll(() => liste.count()).toBe(0);
    await cliquer(menuDe(p, 'Les disques'));
    await cliquer(p.locator('.c-menu-liste').getByRole('button', { name: /la mettre en sourdine/i }));
    const f = fenetre(p);
    await cliquer(f.getByRole('button', { name: '2 heures', exact: true }));
    await f.locator('textarea').fill('nettoyage de /var en cours');
    await cliquer(f.getByRole('button', { name: 'Mettre en sourdine', exact: true }));
    const message = await toast(p);
    const heure = /jusqu'à (\d{2}:\d{2})/.exec(message)?.[1];
    expect(heure, message).toBeDefined();
    const ligne = p.locator('.c-al-regles tbody tr', { has: p.locator('b', { hasText: /^Les disques$/ }) });
    await expect.poll(() => ligne.innerText().then(net)).toContain(`en sourdine jusqu'à ${heure}`);
    // Sur la carte du disque, les rappels se taisent jusqu'à la même heure, et le bouton lève la sourdine.
    const carte = p.locator('.c-al-alerte', { has: p.locator('h2', { hasText: /disque/ }) });
    expect(net(await carte.locator('.c-al-faits').innerText())).toContain(`En sourdine, ${heure}`);
    expect(await carte.getByRole('button', { name: 'Lever la sourdine…' }).count()).toBe(1);
    // Au journal, le geste porte un nom, sa règle et la fin prévue — la même heure.
    await p.evaluate(() => { location.hash = '#/journal'; });
    const auJournal = p.locator('main tbody tr', { hasText: /nettoyage de \/var en cours/ }).first();
    await expect.poll(() => auJournal.innerText().then(net)).toContain('Règle mise en sourdine');
    const texteJournal = net(await auJournal.innerText());
    expect(texteJournal).toContain('La règle « les disques »');
    expect(texteJournal).toMatch(new RegExp(`jusqu'au \\d{2}/\\d{2} à ${heure}`));
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('« Voir ses alertes passées » : l\'histoire de la règle, sans redire son nom ; un filtre ne fait pas glisser ses pilules', async () => {
    const p = await ouvrir(await jetonConsole(direction));
    await cliquer(menuDe(p, 'La copie hors de la machine'));
    await cliquer(p.locator('.c-menu-liste').getByRole('button', { name: /voir ses alertes passées/i }));
    const histoire = p.locator('#al-histoire');
    const puce = histoire.locator('.c-al-filtre-regle');
    await expect.poll(() => puce.count()).toBe(1);
    expect(net(await puce.innerText())).toBe('Règle « la copie hors de la machine »');
    const lignes = histoire.locator('tbody tr');
    expect(await lignes.count()).toBe(2);
    expect(await histoire.locator('tbody .c-sous', { hasText: /^La copie hors de la machine$/ }).count()).toBe(0);
    // Au bas de la page, un filtre qui garde une seule ligne : la page ne remonte pas sous la souris.
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const seules = histoire.locator('.c-pilule', { hasText: /^Réglées seules/ });
    const avant = await seules.boundingBox();
    await cliquer(seules);
    await expect.poll(() => lignes.count()).toBe(1);
    const apres = await seules.boundingBox();
    expect(Math.abs((apres?.y ?? 0) - (avant?.y ?? 0))).toBeLessThan(1);
    // Retirer la règle rend toutes les règles.
    await cliquer(puce);
    await expect.poll(() => puce.count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('l\'essai demandé attend la veille, et son bouton s\'éteint', async () => {
    const p = await ouvrir(await jetonConsole(direction));
    const bouton = p.getByRole('button', { name: 'Envoyer une alerte d\'essai…' });
    await cliquer(bouton);
    const f = fenetre(p);
    await f.locator('textarea').fill('nouveau téléphone de garde');
    await cliquer(f.getByRole('button', { name: 'Demander l\'essai', exact: true }));
    expect(await toast(p)).toMatch(/^Essai demandé/);
    await expect.poll(() => p.locator('.c-al-essai').innerText().then(net)).toMatch(/Un essai attend la veille, demandé .* par Amira Essai/);
    expect(await bouton.isDisabled()).toBe(true);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('au téléphone : rien ne déborde, les faits tiennent en une boîte, une commande défile dans sa carte', async () => {
    const p = await ouvrir(await jetonConsole(direction), 390);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const faits = await p.locator('.c-al-faits').first().boundingBox();
    expect(faits?.height ?? 999).toBeLessThan(160);
    const debords = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('.c-al-commande')].filter((c) => {
      const carte = c.closest('.c-al-alerte')?.getBoundingClientRect();
      return carte && c.getBoundingClientRect().right > carte.right - 1;
    }).length);
    expect(debords).toBe(0);
    // Le chemin entier se lit sur une ligne, et se copie d'un geste.
    expect(await p.locator('.c-al-commande code', { hasText: '/var/lib/skanfact/hors-machine/hors-machine.json' }).evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('pre');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
});
