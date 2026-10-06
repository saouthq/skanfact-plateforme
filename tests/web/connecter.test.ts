// « Connecter ma boutique », à l'écran (brique 133 ; docs/boutique.md, B0). Une personne envoyée par SkanEcom sur
// /connecter, sans être connectée : la connexion (mot de passe, code) la ramène à la page « Relier SkanEcom à SkanFact »,
// qui dit ce que SkanEcom pourra faire ; elle choisit son entreprise (jamais l'entreprise d'essai), clique « Autoriser »,
// et revient chez SkanEcom avec un code que SkanEcom échange contre la clé. « Refuser » revient sans rien. Une demande
// vers une adresse non déclarée se dit, et SkanFact s'ouvre. Sans entreprise, la page la fait créer d'abord.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import pg from 'pg';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { motif, rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const titre = (cle: string, v: Record<string, string> = {}) => { const s = rendre(t(cle, v), 'fr'); return s.charAt(0).toUpperCase() + s.slice(1); };
const sha256 = (x: string) => createHash('sha256').update(x, 'utf8').digest('hex');
const SECRET = 'le-secret-de-skanecom-pour-les-tests';
const RETOUR = 'https://boutique.exemple.tn/skanfact/retour';

describe('connecter une boutique, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-connecter-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_PARTENAIRES: JSON.stringify([
      { code: 'skanecom', nom: 'SkanEcom', retours: [RETOUR], empreinteSecret: sha256(SECRET), gestes: ['ventes.boutique.facturer', 'ventes.pieces.voir'] }]) }),
    port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const champ = (p: Page, cle: string) => p.locator('label.field').filter({ hasText: titre(cle) }).locator('input');
  const bouton = (p: Page, cle: string) => p.getByRole('button', { name: titre(cle), exact: true });
  const personne = async (prenom: string) => {
    const email = `connecter-${prenom}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Préparation', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    return { email, jeton, secret };
  };
  const seConnecter = async (p: Page, qui: { email: string; secret: string }) => {
    await p.getByRole('heading', { level: 1, name: titre('ecran.connexion.titre') }).waitFor({ timeout: 15_000 });
    await champ(p, 'ecran.connexion.email').fill(qui.email);
    await champ(p, 'ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await bouton(p, 'ecran.connexion.bouton').click();
    await p.getByRole('heading', { level: 1, name: titre('ecran.code.titre') }).waitFor({ timeout: 15_000 });
    await champ(p, 'ecran.code.champ').fill(codeTotp(depuisBase32(qui.secret), Date.now()));
    await bouton(p, 'ecran.code.bouton').click();
  };
  // Une page neuve, où la boutique (l'adresse de retour) répond « reçu » au lieu d'exister vraiment.
  const page = async (erreurs: string[]) => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.route('https://boutique.exemple.tn/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>reçu</p>' }));
    return p;
  };
  const demande = (retour: string, etat: string) => `${serveur.adresse}/connecter?${new URLSearchParams({ partenaire: 'skanecom', retour, etat })}`;
  const echanger = (code: string) => fetch(`${serveur.adresse}/v1/partenaires/skanecom/echanger`, { method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).then(async (r) => ({ statut: r.status, corps: await r.json() as Record<string, unknown> }));
  const cles = async (ent: string) => (await admin.query('select count(*)::int n from socle.cle_api where entreprise = $1', [ent])).rows[0].n as number;

  it('se connecter, choisir son entreprise, autoriser : SkanEcom reçoit le code et l\'échange ; refuser ne donne rien', async () => {
    const erreurs: string[] = [];
    const nadia = await personne('nadia');
    const boulangerie = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    const bijoux = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Yasmine Bijoux' })).corps.id);
    await api('POST', '/entreprises-essai', nadia.jeton);
    // Commerciale chez une voisine : cette entreprise-là ne se relie pas par elle.
    const voisin = await personne('voisin');
    const voisine = String((await api('POST', '/entreprises', voisin.jeton, { raisonSociale: 'La voisine' })).corps.id);
    const inv = String((await api('POST', `/entreprises/${voisine}/invitations`, voisin.jeton, { email: nadia.email, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', nadia.jeton, { jeton: inv })).statut).toBe(200);

    // Envoyée par SkanEcom, sans être connectée : la connexion, puis la page « Relier ».
    const p = await page(erreurs);
    await p.goto(demande(`${RETOUR}?boutique=12`, 'etat-1'));
    expect(new URL(p.url()).pathname).toBe('/');
    // La connexion dit qui attend, et pourquoi.
    await expect.poll(async () => p.locator('.ent-entete p').innerText(), { timeout: 15_000 }).toBe(rendre(motif('ecran.connecter.connexion_sous', { partenaire: 'SkanEcom' }), 'fr'));
    await seConnecter(p, nadia);
    await p.getByRole('heading', { level: 1, name: titre('ecran.connecter.titre', { partenaire: 'SkanEcom' }) }).waitFor({ timeout: 15_000 });
    await expect.poll(async () => p.locator('.connecter-gestes li').allInnerTexts()).toEqual([rendre(t('geste.ventes.boutique.facturer'), 'fr'), rendre(t('geste.ventes.pieces.voir'), 'fr')]);
    // Les deux entreprises de Nadia, jamais l'entreprise d'essai.
    const choix = p.locator('label.field').filter({ hasText: titre('ecran.connecter.entreprise') }).locator('select');
    expect(await choix.locator('option').allInnerTexts()).toEqual(['Boulangerie Ben Youssef', 'Yasmine Bijoux']);
    await choix.selectOption({ label: 'Yasmine Bijoux' });
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'connecter.png') });
    await bouton(p, 'ecran.connecter.autoriser').click();
    await p.waitForURL(/^https:\/\/boutique\.exemple\.tn\//, { timeout: 15_000 });
    const arrivee = new URL(p.url());
    expect(`${arrivee.origin}${arrivee.pathname}`).toBe(RETOUR);
    expect(arrivee.searchParams.get('boutique')).toBe('12');
    expect(arrivee.searchParams.get('etat')).toBe('etat-1');
    const e = await echanger(arrivee.searchParams.get('code') ?? '');
    expect(e).toMatchObject({ statut: 200, corps: { entreprise: bijoux, nom: 'Yasmine Bijoux' } });
    expect(await cles(boulangerie)).toBe(0);
    // Revenue dans SkanFact, la demande est oubliée : l'entreprise s'ouvre, pas une seconde autorisation.
    await p.goto(serveur.adresse);
    await expect.poll(() => p.url(), { timeout: 15_000 }).toMatch(/\/v10\/\?e=/);
    await p.context().close();

    // Refuser : retour chez SkanEcom, sans code, et aucune clé.
    const q = await page(erreurs);
    await q.goto(demande(RETOUR, 'etat-2'));
    await seConnecter(q, nadia);
    await bouton(q, 'ecran.connecter.refuser').click();
    await q.waitForURL(/^https:\/\/boutique\.exemple\.tn\//, { timeout: 15_000 });
    expect(Object.fromEntries(new URL(q.url()).searchParams)).toEqual({ erreur: 'refusee', etat: 'etat-2' });
    expect(await cles(boulangerie) + await cles(bijoux)).toBe(1);
    await q.context().close();

    // Une adresse de retour qui n'est pas déclarée : la demande n'est pas valable, et SkanFact s'ouvre.
    const r = await page(erreurs);
    await r.goto(demande('https://pirate.exemple.tn/vol', 'etat-3'));
    await seConnecter(r, nadia);
    await r.getByRole('heading', { level: 1, name: titre('ecran.connecter.invalide_titre') }).waitFor({ timeout: 15_000 });
    expect(await r.getByRole('alert').innerText()).toBe('L\'adresse de retour n\'est pas celle que SkanEcom a déclarée : par prudence, rien n\'est autorisé.');
    await bouton(r, 'ecran.connecter.ouvrir_skanfact').click();
    await expect.poll(() => r.url(), { timeout: 15_000 }).toMatch(/\/v10\/\?e=/);
    await r.context().close();
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('sans entreprise : la page la fait créer, puis autoriser', async () => {
    const erreurs: string[] = [];
    const sami = await personne('sami');
    const p = await page(erreurs);
    await p.goto(demande(RETOUR, 'etat-4'));
    await seConnecter(p, sami);
    await p.getByRole('heading', { level: 1, name: titre('ecran.connecter.titre', { partenaire: 'SkanEcom' }) }).waitFor({ timeout: 15_000 });
    await champ(p, 'ecran.porte.raison').fill('Sami Déco');
    await bouton(p, 'ecran.connecter.creer').click();
    await bouton(p, 'ecran.connecter.autoriser').waitFor({ timeout: 15_000 });
    expect(await p.locator('.ent-carte').innerText()).toContain('Sami Déco');
    await bouton(p, 'ecran.connecter.autoriser').click();
    await p.waitForURL(/^https:\/\/boutique\.exemple\.tn\//, { timeout: 15_000 });
    expect(await echanger(new URL(p.url()).searchParams.get('code') ?? '')).toMatchObject({ statut: 200, corps: { nom: 'Sami Déco' } });
    await p.context().close();
    expect(erreurs).toEqual([]);
  }, 120_000);
});
