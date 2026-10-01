// Le lien d'écran qu'une console partenaire montre (brique 127 ; docs/api-situation.md, S5), ouvert par une personne
// qui n'est pas encore connectée : la connexion (mot de passe, puis code du téléphone) la ramène à la facture du lien,
// dans l'entreprise du lien (pas dans celle qu'elle ouvre d'habitude), et c'est celle-là qui s'ouvrira la fois suivante.
// Le lien d'une entreprise qui n'est pas la sienne ne mène nulle part : l'accueil habituel.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import pg from 'pg';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const titre = (cle: string) => { const s = rendre(t(cle, {}), 'fr'); return s.charAt(0).toUpperCase() + s.slice(1); };

describe('le lien d\'écran d\'une console partenaire', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-lien-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
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
  // Une personne avec le code du téléphone par application.
  const personne = async (prenom: string) => {
    const email = `lien-${prenom}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Préparation', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    return { email, jeton, secret };
  };
  // Se connecter comme une personne : la page de connexion, le mot de passe, puis le code.
  const seConnecter = async (p: Page, qui: { email: string; secret: string }) => {
    await p.getByRole('heading', { level: 1, name: titre('ecran.connexion.titre') }).waitFor({ timeout: 15_000 });
    await champ(p, 'ecran.connexion.email').fill(qui.email);
    await champ(p, 'ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await bouton(p, 'ecran.connexion.bouton').click();
    await p.getByRole('heading', { level: 1, name: titre('ecran.code.titre') }).waitFor({ timeout: 15_000 });
    await champ(p, 'ecran.code.champ').fill(codeTotp(depuisBase32(qui.secret), Date.now()));
    await bouton(p, 'ecran.code.bouton').click();
  };

  it('la connexion ramène à la facture du lien, dans son entreprise ; le lien d\'une autre entreprise mène à l\'accueil habituel', async () => {
    const nadia = await personne('nadia');
    const erreurs: string[] = [];
    // Deux entreprises : la boulangerie, puis la menuiserie (d'essai, avec ses clients), où la facture est émise.
    const boulangerie = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    const menuiserie = String((await api('POST', '/entreprises-essai', nadia.jeton)).corps.id);
    const objets = (await api('GET', `/entreprises/${menuiserie}/dossier-v10`, nadia.jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[];
    const client = objets.find((o) => o.collection === 'clients');
    if (!client) throw new Error('client d\'exemple absent');
    const doc = { id: 'f-lien', type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: client.cle, subject: 'Abonnement de la boutique', status: 'brouillon',
      lines: [{ label: 'Abonnement', description: '', qty: 1, unit: '', unitPrice: { '~n': '100' }, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1 };
    await api('POST', `/entreprises/${menuiserie}/dossier-v10`, nadia.jeton, { changements: [{ collection: 'documents', cle: 'f-lien', rang: 0, revision: null, contenu: doc }] });
    expect((await api('POST', `/entreprises/${menuiserie}/dossier-v10/emettre`, nadia.jeton, { document: doc, client: client.contenu, revision: 1, rang: 0, netAPayer: '120.000' })).statut).toBe(200);

    // D'habitude, l'accueil ouvre la boulangerie (la première).
    const habitude = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    habitude.on('pageerror', (e) => erreurs.push(e.message));
    await habitude.goto(serveur.adresse);
    await seConnecter(habitude, nadia);
    await habitude.waitForURL(new RegExp(`/v10/\\?e=${boulangerie}`), { timeout: 15_000 });
    await habitude.context().close();

    // Le lien de la console, ouvert sans être connecté : la connexion, puis la facture, dans la menuiserie.
    const lien = (await api('GET', `/entreprises/${menuiserie}/ventes?type=facture&aPayer=1`, nadia.jeton)).corps.lignes as { ecran: string }[];
    expect(lien[0]?.ecran).toBe(`/v10/?e=${menuiserie}#/doc/f-lien`);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}${lien[0]?.ecran}`);
    await seConnecter(p, nadia);
    await p.waitForURL(`${serveur.adresse}/v10/?e=${menuiserie}#/doc/f-lien`, { timeout: 15_000 });
    await expect.poll(async () => (await p.locator('#view h1').first().innerText().catch(() => '')).trim(), { timeout: 15_000 }).toBe('Facture FAC-2026-001');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'lien-ecran-facture.png') });
    // La fois suivante, l'accueil ouvre la menuiserie, sur son accueil : le lien ne sert qu'une fois.
    await p.goto(serveur.adresse);
    await p.waitForURL(new RegExp(`/v10/\\?e=${menuiserie}#/dashboard`), { timeout: 15_000 });
    await cx.close();

    // Le lien d'une entreprise qui n'est pas la sienne : après la connexion, l'accueil habituel, rien d'autre.
    const voisine = String((await api('POST', '/entreprises', (await personne('sami')).jeton, { raisonSociale: 'La voisine' })).corps.id);
    const q = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    q.on('pageerror', (e) => erreurs.push(e.message));
    await q.goto(`${serveur.adresse}/v10/?e=${voisine}#/doc/f-lien`);
    await seConnecter(q, nadia);
    await q.waitForURL(new RegExp(`/v10/\\?e=${boulangerie}`), { timeout: 15_000 });
    expect(q.url()).not.toContain(voisine);
    await q.context().close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
