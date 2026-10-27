// La recette du 20/10/2026, côté entreprise (1.75.0 ; docs/recette.md) : une personne qui crée sa boîte, au clavier et à
// la souris. Ce que le parcours vérifie, écran ET serveur :
//   - au clavier, Tab va d'une case à la suivante, sans s'arrêter sur un « i » d'aide : à la création du compte (le mot de
//     passe tombait en clair dans la case de l'e-mail) comme dans une fiche de l'application ;
//   - « Ton compte est créé » se lit en haut, et ne recouvre plus « Je suis un cabinet comptable » ;
//   - la ville donnée à « Ton entreprise » ouvre l'adresse de « Où te joindre ? » ;
//   - une pièce neuve prend le seul client ; avec deux, elle attend qu'on choisisse ;
//   - un paiement : le signe moins ne s'écrit pas, la case ne propose pas d'anciennes valeurs, et un montant refusé dit ce
//     qui est attendu ;
//   - les premiers pas du métier faits, ce qui reste se dit dans une carte sans bouton vert, jusqu'à « Ne plus afficher » ;
//   - Paramètres › Envois : l'adresse du comptable dit ce qu'elle fait, et renvoie au cabinet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const net = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
// Un matricule à ce fichier seul (tests/matricule-libre.ts).
const MATRICULE = '2468024K/A/M/000';

describe('la recette d\'une entreprise neuve, au clavier et à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-recette-entreprise-'));
  beforeAll(async () => {
    // Le timbre d'une facture : une règle fiscale datée, que la base d'essai n'a pas d'elle-même.
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await admin.end();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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
  const adresse = (nom: string) => `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  const nouvellePage = async (jeton?: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    if (jeton) await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { p, erreurs };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };

  it('au clavier, le compte se crée case après case ; le message se lit en haut ; la ville ouvre l\'adresse', async () => {
    const { p, erreurs } = await nouvellePage();
    await p.goto(serveur.adresse);
    await p.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
    const caseDe = (libelle: RegExp) => p.locator('label.field').filter({ hasText: libelle }).locator('input');
    await expect.poll(() => caseDe(/ton nom/i).evaluate((e) => e === document.activeElement)).toBe(true);
    // Aucun « i » d'aide dans l'ordre de la touche Tab : tapé d'une traite, chaque morceau tombe dans sa case.
    expect(await p.locator('button.i').count()).toBeGreaterThan(0);
    expect(await p.locator('button.i:not([tabindex="-1"])').count()).toBe(0);
    const email = adresse('clavier');
    await p.keyboard.type('Hela Gharbi');
    await p.keyboard.press('Tab');
    await p.keyboard.type(email);
    await p.keyboard.press('Tab');
    await p.keyboard.type('Un-bon-mot-de-passe');
    expect(await caseDe(/ton nom/i).inputValue()).toBe('Hela Gharbi');
    expect(await caseDe(/adresse e-mail/i).inputValue()).toBe(email);
    const motDePasse = caseDe(/mot de passe/i);
    expect(await motDePasse.inputValue()).toBe('Un-bon-mot-de-passe');
    expect(await motDePasse.getAttribute('type')).toBe('password');

    // Créé, le compte ouvre la porte : le message se lit en haut, au-dessus de tout ce qui se clique.
    await p.keyboard.press('Enter');
    const cabinet = p.getByRole('button', { name: /je suis un cabinet comptable/i });
    await cabinet.waitFor({ timeout: 15_000 });
    const message = p.locator('#toast.show');
    await expect.poll(() => message.innerText().then(net).catch(() => '')).toMatch(/ton compte est créé/i);
    const m = await message.boundingBox(), c = await cabinet.boundingBox();
    expect(m && c && m.y + m.height < c.y).toBe(true);
    expect(m && m.y < 100).toBe(true);

    // « Ton entreprise » avec sa ville : « Où te joindre ? » s'ouvre sur elle, dans l'adresse.
    await p.getByRole('button', { name: 'Créer mon entreprise', exact: true }).first().click();
    await caseDe(/raison sociale/i).fill('Gharbi Électricité SARL');
    await caseDe(/^ville/i).fill('Nabeul');
    await p.locator('form').getByRole('button', { name: /Créer mon entreprise/ }).click();
    await p.waitForURL(/\/v10\/\?e=[0-9a-f-]{36}/, { timeout: 15_000 });
    const as = p.locator('#setup.as');
    await as.locator('h1').filter({ hasText: 'Où te joindre' }).waitFor({ timeout: 15_000 });
    expect(await as.locator('textarea[name=address]').inputValue()).toBe('Nabeul');
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('le seul client pris par la pièce neuve, le paiement qui dit ce qu\'il attend, ce qui reste des premiers pas, les envois', async () => {
    const email = adresse('patron');
    await api('POST', '/inscription', undefined, { email, nom: 'Patron', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie de Nabeul', matriculeFiscal: MATRICULE, ville: 'Nabeul' })).corps.id);
    type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const ecrire = async (collection: string, cle: string, contenu: unknown, revision: number | null = null) => (await api('POST', `/entreprises/${ent}/dossier-v10`, jeton,
      { changements: [{ collection, cle, rang: collection === '_racine' ? null : 0, revision, contenu }] })).statut;
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    // Un commerce (il encaisse sur place : son RIB n'est pas attendu), sa fiche complète, l'assistant fait.
    expect(await ecrire('_racine', 'company', { ...fiche?.contenu, setupDone: true, activity: 'commerce', phone: '+216 72 123 456', address: 'Rue de la Gare\n8000 Nabeul' },
      fiche?.revision ?? null)).toBe(200);
    expect(await ecrire('clients', 'c1', { id: 'c1', name: 'Café des Orangers', matricule: '', address: 'Nabeul', email: '', phone: '' })).toBe(200);

    const premier = await nouvellePage(jeton);
    let p = premier.p;
    const erreurs = premier.erreurs;
    // ── Un seul client : la pièce neuve le prend ─────────────────────────────────────────────────────────
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/devis`);
    await p.locator('#view [name=clientId]').waitFor({ state: 'attached', timeout: 20_000 });
    await plusTard(p);
    expect(await p.locator('#view [name=clientId]').inputValue()).toBe('c1');
    expect(net(await p.locator('#view .combo').first().innerText())).toContain('Café des Orangers');

    // ── Deux clients : elle attend qu'on choisisse ──────────────────────────────────────────────────────
    expect(await ecrire('clients', 'c2', { id: 'c2', name: 'Boulangerie du Cap', matricule: '', address: 'Nabeul', email: '', phone: '' })).toBe(200);
    // (Un second poste : il lit le dossier tel que le serveur le tient, les deux clients.)
    const second = (await nouvellePage(jeton)).p;
    await second.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    await second.locator('#view [name=clientId]').waitFor({ state: 'attached', timeout: 20_000 });
    expect(await second.evaluate(() => (window as unknown as { __data: { clients: unknown[] } }).__data.clients.length)).toBe(2);
    expect(await second.locator('#view [name=clientId]').inputValue()).toBe('');
    await second.context().close();

    // ── Dans une fiche de l'application aussi, Tab va d'une case à la suivante ───────────────────────────
    await p.evaluate(() => { location.hash = '#/clients'; });
    await p.getByRole('button', { name: /Nouveau client/ }).first().click();
    const cf = p.locator('#cf');
    await cf.waitFor();
    expect(await cf.locator('button.i').count()).toBeGreaterThan(0);
    expect(await cf.locator('button.i:not([tabindex="-1"])').count()).toBe(0);
    await cf.locator('[name=name]').focus();
    await p.keyboard.press('Tab');
    // (1.132.0) Le champ qui suit le nom d'un client neuf est son matricule (le reste derrière « Plus de détails »).
    expect(await p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('matricule');
    // Point 15 de la revue du mois d'un client : un client neuf s'écrit en quatre cases, le reste plié.
    const visibles = () => cf.locator('input, textarea, select').filter({ visible: true }).evaluateAll((els) => els.map((e) => e.getAttribute('name')));
    expect(await visibles()).toEqual(['name', 'matricule', 'phone', 'address']);
    await cf.locator('#cf-plus > summary').click();
    expect(await visibles()).toContain('contact');
    await p.keyboard.press('Escape');
    // La question « Abandonner cette saisie ? » vient un instant après Échap : on l'attend, puis plus aucune fenêtre.
    await p.getByRole('button', { name: 'Abandonner la saisie' }).click({ timeout: 3_000 }).catch(() => undefined);
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 5_000 }).toBe(0);

    // ── Un paiement : ni signe moins, ni anciennes valeurs proposées ; le refus dit ce qui est attendu ──────
    const facture = { id: 'f1', type: 'facture', number: '', date: '2026-10-20', dueDate: '2026-11-19', clientId: 'c1', subject: 'Visserie', status: 'brouillon',
      lines: [{ label: 'Boîte de vis inox', description: '', qty: 3, unit: '', unitPrice: 40, vatRate: 19 }], discountRate: 0, applyStamp: true,
      withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1 };
    expect(await ecrire('documents', 'f1', facture)).toBe(200);
    // (Un poste neuf encore : il lit la facture que le serveur tient.)
    const suite = await nouvellePage(jeton);
    p = suite.p;
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await p.getByRole('button', { name: 'Émettre la facture', exact: true }).click({ timeout: 20_000 });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toBe('FAC-2026-001');
    await p.locator('#pay').click();
    const montant = p.locator('#pf2 [name=amount]');
    await montant.click();
    expect(await montant.getAttribute('autocomplete')).toBe('off');
    await p.keyboard.press('Control+A');
    await p.keyboard.type('-50');
    expect(await montant.inputValue()).toBe('50');
    await montant.fill('');
    await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText().then(net).catch(() => '')).toBe('Écris le montant en chiffres, plus grand que zéro : par exemple 250,500.');
    expect(await montant.evaluate((el) => el.closest('.field')?.classList.contains('champ-faute'))).toBe(true);
    expect(((await objets()).find((o) => o.cle === 'f1')?.contenu.payments as unknown[]).length).toBe(0);
    await p.keyboard.press('Escape');
    // La question « Abandonner cette saisie ? » vient un instant après Échap : on l'attend, puis plus aucune fenêtre.
    await p.getByRole('button', { name: 'Abandonner la saisie' }).click({ timeout: 3_000 }).catch(() => undefined);
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 5_000 }).toBe(0);

    // ── Les premiers pas du métier faits (la fiche, le client, une facture) : ce qui reste se dit encore ─────
    await p.evaluate(() => { location.hash = '#/dashboard'; });
    const restes = p.locator('#pp-restes');
    await restes.waitFor({ timeout: 15_000 });
    expect(net(await restes.locator('h2').innerText())).toBe('Tes premiers pas sont faits');
    expect(await restes.locator('.pp-txt strong').evaluateAll((l) => l.map((x) => (x.firstChild?.textContent ?? '').trim())))
      .toEqual(['Ta facture à ton image', 'Invite ton comptable']);
    // Sans bouton vert : l'en-tête reprend le sien.
    expect(await restes.locator('.btn-primary').count()).toBe(0);
    // (1.156.0, maquette « Accueil ») L'en-tête n'a plus « Nouvelle facture » : un seul bouton principal sur la page.
    expect(await p.locator('#view .btn-primary').count()).toBeLessThanOrEqual(1);
    // Chaque geste mène où il dit : le comptable, à l'onglet du cabinet.
    await restes.locator('[data-pas="mandat"]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/compta');
    await p.evaluate(() => { location.hash = '#/dashboard'; });
    await restes.waitFor();
    await restes.locator('#pp-restes-masquer').click();
    await expect.poll(() => restes.count()).toBe(0);
    await p.reload();
    await p.locator('#view h1').filter({ hasText: /^(Bonjour|Bienvenue)/ }).waitFor({ timeout: 20_000 });
    expect(await p.locator('#pp-restes').count()).toBe(0);

    // ── Paramètres › Envois : l'adresse du comptable dit ce qu'elle fait, et renvoie au cabinet ───────────
    await p.evaluate(() => { location.hash = '#/parametres'; });
    await p.locator('#set-tabs [data-tab="envois"]').click();
    const adresseComptable = p.locator('#p-comptable');
    await adresseComptable.waitFor();
    expect(net(await adresseComptable.locator('h2').first().innerText())).toBe('Envoyer tes écritures par e-mail');
    expect(net(await adresseComptable.innerText())).toContain('Ton comptable a SkanFact Cabinet ? Relie-le plutôt dans « Ton cabinet comptable », plus bas');
    expect(await p.locator('#p-cabinet').isVisible()).toBe(true);
    expect([...erreurs, ...suite.erreurs]).toEqual([]);
  }, 120_000);
});
