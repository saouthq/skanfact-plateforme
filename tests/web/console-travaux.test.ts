// « Travaux et envois » du service, à la souris (Console 3e ; docs/console.md C25 ; serveur/console/travaux.ts ;
// web/console/src/ecrans/Travaux.tsx). Les envois se posent dans la base sans leur pièce (seule la console les lit ici) ;
// les tours, par la fonction du serveur. Ce que le parcours vérifie :
//   - l'onglet allumé, les quatre chiffres, et une TTN sans adresse dite « pas branchée », jamais « bonne » ;
//   - « N envois à regarder » d'un partenaire filtre la liste à lui seul, et se retire ; deux envois de la même
//     seconde sont deux lignes (une clé courte prise à la fin de l'identifiant, pas au début, qui est son heure) ;
//   - « attendent l'entreprise » : un compte TTN refusé se dit « retenue », pas « en attente » ;
//   - les tâches : un tour en échec dit sa nature, jamais son message ;
//   - au téléphone : rien ne déborde, et chaque envoi se lit en entier, sans défilement de côté.

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

type Membre = { email: string; secret: string; id: string };

describe('les travaux et les envois du service, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-travaux-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-travaux-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jD = '';
  let entreprise = '';

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
    await p.goto(`${serveur.adresse}/console/#/service/travaux`);
    await expect.poll(() => p.locator('.c-tr-tache').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  // Les lignes de CETTE entreprise : la table est partagée avec d'autres tests.
  const lignes = (p: Page) => p.locator('.c-tr-table tbody tr').filter({ hasText: 'Menuiserie des Essais' });

  beforeAll(async () => {
    await admin.connect();
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `console-travaux-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Essai', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai des travaux à la souris');
    const id = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0]?.id);
    jD = await jetonConsole({ email, secret, id });
    entreprise = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Menuiserie des Essais', matriculeFiscal: `${String(Date.now()).slice(-7)}C/A/M/000` })).corps.id);
    // Les envois, sans leur pièce : deux factures TTN (une qui se réessaie, une retenue par son compte), deux signatures
    // échouées nées la même milliseconde (le début de leur identifiant est le même).
    const maintenant = new Date();
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`insert into ventes.envoi_ttn(piece, entreprise, statut, essais, prochain_essai, motif, cree_le, cree_par) values
      (gen_random_uuid(), $1, 'deposee', 2, $2::timestamptz + interval '10 minutes', null, $2, $3),
      (gen_random_uuid(), $1, 'a_envoyer', 0, $2::timestamptz + interval '1 hour', '{"cle":"ttn.compte_refuse","valeurs":{"message":"identifiant inconnu"}}', $2, $3)`, [entreprise, maintenant, id]);
    await admin.query(`insert into ventes.signature_demande(id, entreprise, pieces, identifiant, session, statut, essais, cree_le, cree_par) values
      ('01a1e000-0000-7000-8000-0000000000a1', $1, array[gen_random_uuid()], 'x', 's', 'echouee', 1, $2, $3),
      ('01a1e000-0000-7000-8000-0000000000b2', $1, array[gen_random_uuid()], 'x', 's', 'echouee', 1, $2, $3)`, [entreprise, maintenant, id]);
    await admin.query('commit');
    // Un tour en échec, par sa nature.
    await admin.query("insert into plateforme.service_tour(nom, dernier_le, duree_ms, ok, compte, echec_le, echec) values ('contrats', now(), 12, false, '{}', now(), 'ECONNREFUSED') on conflict (nom) do update set dernier_le = now(), ok = false, echec = 'ECONNREFUSED'");
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('l\'onglet allumé, les quatre chiffres ; une TTN sans adresse est « pas branchée », jamais « bonne »', async () => {
    const p = await ouvrir(jD);
    expect(net(await p.locator('.c-sv-onglets [aria-current="page"]').innerText())).toBe('Travaux et envois');
    expect(await p.locator('.c-tr-tuiles .c-sv-tuile').count()).toBe(4);
    const facteur = net(await p.locator('.c-tr-tuiles .c-sv-tuile').nth(3).innerText());
    expect(facteur).toContain('Pas branché');
    expect(facteur).not.toMatch(/\bBon\b/);
    const tache = net(await p.locator('.c-tr-tache').filter({ hasText: 'Le facteur de la TTN' }).innerText());
    expect(tache).toMatch(/il ne tourne pas/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('« N envois à regarder » filtre la liste au partenaire, et se retire ; deux envois de la même seconde font deux lignes', async () => {
    const p = await ouvrir(jD);
    await expect.poll(() => lignes(p).count()).toBe(4);
    const signature = p.locator('.c-tr-partenaire').filter({ hasText: 'La signature' });
    await cliquer(signature.getByRole('button', { name: /envois? à regarder/ }));
    await expect.poll(() => lignes(p).count()).toBe(2);
    const cles = await lignes(p).locator('td:first-child .c-mono').allInnerTexts();
    expect(new Set(cles).size).toBe(2);
    expect(cles.sort()).toEqual(['000000A1', '000000B2']);
    expect(await p.locator('.c-tr-table tbody tr').filter({ hasText: 'TTN' }).count()).toBe(0);
    await cliquer(p.getByRole('button', { name: /Voir tous les partenaires/ }));
    await expect.poll(() => lignes(p).count()).toBe(4);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('« attendent l\'entreprise » : un compte refusé se dit « retenue », avec sa suite ; une panne se réessaie seule', async () => {
    const p = await ouvrir(jD);
    await cliquer(p.locator('.c-tr-pilules').getByRole('button', { name: /Attendent l.entreprise/ }));
    await expect.poll(() => lignes(p).count()).toBe(3);
    const ligne = lignes(p).filter({ hasText: 'TTN' });
    // La pastille elle-même : « Retenue » se lit aussi dans la suite, qui ne dit pas l'état.
    expect(net(await ligne.locator('.c-puce').innerText())).toBe('Retenue');
    const retenue = net(await ligne.innerText());
    expect(retenue).toMatch(/compte de l.entreprise/);
    expect(retenue).toMatch(/corrige son compte El Fatoora/);
    await cliquer(p.locator('.c-tr-pilules').getByRole('button', { name: /Se réessaient seuls/ }));
    await expect.poll(() => lignes(p).count()).toBe(1);
    expect(net(await lignes(p).innerText())).toMatch(/Prochain essai/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('une panne se reprend maintenant, avec son motif ; un compte retenu ne se reprend pas : on prévient l\'entreprise', async () => {
    const p = await ouvrir(jD);
    await expect.poll(() => lignes(p).count()).toBe(4);
    const panne = lignes(p).filter({ hasText: 'Prochain essai' });
    const retenue = lignes(p).filter({ hasText: 'Retenue' });
    // Une seule ligne se reprend ; la retenue offre de prévenir l'entreprise, jamais de réessayer.
    expect(await lignes(p).getByRole('button', { name: 'Reprendre maintenant…' }).count()).toBe(1);
    expect(await retenue.getByRole('button', { name: 'Reprendre maintenant…' }).count()).toBe(0);
    await cliquer(retenue.getByRole('button', { name: 'Prévenir l\'entreprise…' }));
    const e = p.locator('[role="dialog"]');
    await expect.poll(() => e.count()).toBe(1);
    expect(net(await e.innerText())).toMatch(/Menuiserie des Essais/i);
    // Le brouillon nomme l'envoi par sa référence (l'objet et le message), jamais un « mot » sans sujet.
    // Les personnes lues, le brouillon complété de son prénom : ce n'est pas une saisie, Échap ferme sans question.
    await expect.poll(() => e.locator('textarea').inputValue()).toMatch(/^Bonjour [^\s,]/);
    const cle = net(await retenue.locator('.c-mono').first().innerText());
    expect(await e.locator('input[type="text"], input:not([type])').first().inputValue()).toContain(cle);
    expect(await e.locator('textarea').inputValue()).toMatch(new RegExp(`une facture vers la TTN \\(référence ${cle}\\)`));
    await p.keyboard.press('Escape');
    await expect.poll(() => e.count()).toBe(0);
    await cliquer(panne.getByRole('button', { name: 'Reprendre maintenant…' }));
    const f = p.locator('[role="dialog"]');
    expect(net(await f.innerText())).toMatch(/demande d.abord à la TTN si elle a déjà la pièce/);
    await cliquer(f.getByRole('button', { name: 'Reprendre l\'envoi', exact: true }));
    await expect.poll(() => f.locator('.c-alerte').count()).toBe(1);
    await f.locator('textarea').fill('la TTN répond de nouveau');
    await cliquer(f.getByRole('button', { name: 'Reprendre l\'envoi', exact: true }));
    await expect.poll(() => f.count(), { timeout: 15_000 }).toBe(0);
    // Elle repart au prochain tour : plus rien à reprendre.
    await expect.poll(() => lignes(p).getByRole('button', { name: 'Reprendre maintenant…' }).count(), { timeout: 15_000 }).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('les tâches : un tour en échec dit sa nature, jamais son message', async () => {
    const p = await ouvrir(jD);
    const contrats = net(await p.locator('.c-tr-tache').filter({ hasText: 'Les contrats récurrents' }).innerText());
    expect(contrats).toContain('ECONNREFUSED');
    expect(contrats).toMatch(/a échoué/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('au téléphone : rien ne déborde, et chaque envoi se lit en entier, sans défilement de côté', async () => {
    const p = await ouvrir(jD, 390);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const table = p.locator('.c-tr-table');
    expect(await table.evaluate((t) => t.scrollWidth - (t.parentElement?.clientWidth ?? 0))).toBeLessThanOrEqual(0);
    expect(await p.locator('.c-tr-table thead').isVisible()).toBe(false);
    const petites = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a')]
      .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height < 44)
      .map((e) => `${e.className} « ${e.innerText.trim().slice(0, 30)} » ${Math.round(e.getBoundingClientRect().height)}`));
    expect(petites).toEqual([]);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
});
