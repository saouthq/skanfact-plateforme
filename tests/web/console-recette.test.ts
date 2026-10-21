// Ce que la recette du 19/10/2026 a trouvé à la souris et au clavier (1.58.0 ; docs/console.md, « La recette complète »),
// tenu par l'écran lui-même :
//   - une fenêtre : le curseur entre dans le premier champ qui reste à remplir ; Entrée dans un champ d'une ligne, c'est
//     le bouton principal ; un refus reste à sa place mais passe en retrait dès qu'on retape ; ⌘/Ctrl + Entrée depuis un
//     motif valide aussi ;
//   - Sécurité : la tuile des codes faux ne demande un regard que quand la liste dessous en a un ;
//   - Support : une vue sans demande prend toute la largeur, sans cadre vide à côté ;
//   - Abonnements : six cartes qui remplissent leur rangée, le libellé avant son point ;
//   - au téléphone, Échap referme le menu ouvert.
//   - l'entrée : l'adresse se tape d'un trait (le curseur ne saute plus au mot de passe à la première lettre).

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

describe('la recette de la console, tenue par l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-recette-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-recette-veille-')), 'veille.json');
  const erreurs: string[] = [];
  const ADRESSE = `203.0.113.${20 + Math.floor(Math.random() * 200)}`;
  let jD = '', ent = '', moi = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const ouvrir = async (hash: string, largeur = 1440) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jD);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${hash}`);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const actif = (p: Page) => p.evaluate(() => {
    const e = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    return { tag: e?.tagName ?? '', valeur: e?.value ?? '' };
  });

  beforeAll(async () => {
    await admin.connect();
    // Les codes faux en rafale laissés par d'autres essais rempliraient la liste « à regarder » : ce n'est pas eux qu'on lit.
    await admin.query('delete from socle.defi_connexion where erreurs >= 3');
    await admin.query('delete from plateforme.defi_console where erreurs >= 3');
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }),
      port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `console-recette-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Rim Recette', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai de la recette');
    moi = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0]?.id);
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    jD = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier de la Recette', matriculeFiscal: `${String(Date.now()).slice(-7)}R/A/M/000` })).corps.id);
  }, 180_000);
  afterAll(async () => {
    await admin.query('delete from plateforme.adresse_bloquee where adresse = $1', [ADRESSE]).catch(() => undefined);
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('une fenêtre au clavier : le premier champ vide, Entrée, le refus en retrait, ⌘/Ctrl + Entrée', async () => {
    // Le nombre de jours est déjà posé : le curseur attend au motif.
    const f0 = await ouvrir(`#/clients/${ent}`);
    await cliquer(f0.getByRole('button', { name: 'Gestes', exact: true }));
    await cliquer(f0.locator('.c-menu-liste button', { hasText: /^Prolonger l.essai/ }));
    const g = f0.getByRole('dialog');
    await expect.poll(() => actif(f0)).toEqual({ tag: 'TEXTAREA', valeur: '' });
    expect(await g.locator('input[inputmode="numeric"], input[type="number"]').first().inputValue()).not.toBe('');
    await fermer(f0);

    const p = await ouvrir('#/service/securite');
    await cliquer(p.getByRole('button', { name: 'Bloquer une adresse…', exact: true }));
    const f = p.getByRole('dialog');
    await expect.poll(() => actif(p)).toEqual({ tag: 'INPUT', valeur: '' });
    await p.keyboard.type(ADRESSE);
    // Entrée dans l'adresse, c'est « Bloquer l'adresse » : le motif manque, la fenêtre le dit et reste ouverte.
    await p.keyboard.press('Enter');
    const refus = f.locator('.c-alerte-danger');
    await expect.poll(() => refus.innerText().then(net).catch(() => '')).toMatch(/motif/i);
    expect(await f.getAttribute('data-refus-ancien')).toBeNull();
    // On retape : le refus reste à sa place, en retrait.
    await f.getByLabel('Motif', { exact: true }).fill('Des mots de passe faux en rafale');
    await expect.poll(() => f.getAttribute('data-refus-ancien')).toBe('');
    expect(await refus.count()).toBe(1);
    // Entrée seule dans un motif va à la ligne ; ⌘/Ctrl + Entrée bloque l'adresse.
    await f.getByLabel('Motif', { exact: true }).press('Enter');
    // La ligne nouvelle se lit dans le motif : l'envoi, lui, attend la réponse du serveur, et la fenêtre encore ouverte
    // juste après la touche ne prouverait rien.
    expect(await f.getByLabel('Motif', { exact: true }).inputValue()).toBe('Des mots de passe faux en rafale\n');
    expect(await f.count()).toBe(1);
    await f.getByLabel('Motif', { exact: true }).press('Control+Enter');
    await expect.poll(() => p.getByRole('dialog').count()).toBe(0);
    await expect.poll(() => p.locator('#c-toast').innerText().then(net).catch(() => '')).toBe(`${ADRESSE} est bloquée.`);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('Sécurité : un code faux isolé se compte sans demander de regard ; trois de suite, la tuile et la liste le disent', async () => {
    await admin.query(`insert into socle.defi_connexion (utilisateur, methode, cree_le, expire_le, erreurs) values ($1, 'application', now(), now() + interval '5 minutes', 1)`, [moi]);
    const tuile = (p: Page) => p.locator('.c-sv-tuile').filter({ hasText: /^Codes faux/i });
    const p = await ouvrir('#/service/securite');
    await expect.poll(() => tuile(p).innerText().then(net).catch(() => '')).toMatch(/jamais trois de suite : rien à regarder/);
    expect(net(await tuile(p).innerText())).not.toMatch(/À regarder/);
    expect(net(await p.locator('.c-sv-claires + *, section').filter({ hasText: /Ce qui demande un regard/ }).first().innerText())).toMatch(/Rien ne demande un regard/);
    await fermer(p);
    await admin.query(`insert into socle.defi_connexion (utilisateur, methode, cree_le, expire_le, erreurs) values ($1, 'application', now(), now() + interval '5 minutes', 3)`, [moi]);
    const q = await ouvrir('#/service/securite');
    await expect.poll(() => tuile(q).innerText().then(net).catch(() => '')).toMatch(/À regarder.*trois de suite se regardent ci-dessous/);
    await fermer(q);
  }, 60_000);

  it('Support : une vue sans demande prend la largeur, sans cadre vide à côté ; changer de vue ferme la demande qui n\'y est pas', async () => {
    // Une demande ouverte, que personne ne suit : à l'ordinateur, elle s'ouvre d'elle-même dans « Ouvertes ».
    const sujet = `Une facture qui ne part pas ${Date.now()}`;
    const demande = String((await admin.query(`insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, ouverte_le) values ($1, $2, 'application', $3, now()) returning id`,
      [ent, moi, sujet])).rows[0]?.id);
    try {
      const p = await ouvrir(`#/support?demande=${demande}`);
      await expect.poll(() => p.locator('.c-sp-grille').innerText().catch(() => ''), { timeout: 20_000 }).toContain(sujet);
      // « À moi » n'a rien : la demande des ouvertes ne reste pas affichée à côté d'une liste vide (vu à la recette, la
      // conversation d'avant restait ouverte) ; la liste et ce qu'elle dit prennent la largeur.
      await cliquer(p.locator('.c-sp-liste-tete .c-pilule', { hasText: /^À moi/ }));
      await expect.poll(() => p.locator('.c-sp-grille-seule').count(), { timeout: 20_000 }).toBe(1);
      expect(await p.locator('.c-sp-grille').innerText()).not.toContain(sujet);
      expect(await p.locator('.c-sp-fil-vide').count()).toBe(0);
      const [grille, liste] = await Promise.all([p.locator('.c-sp-grille').boundingBox(), p.locator('.c-sp-liste').boundingBox()]);
      expect(Math.abs((grille?.width ?? 0) - (liste?.width ?? -100))).toBeLessThan(2);
      // Revenir aux ouvertes rouvre la plus urgente.
      await cliquer(p.locator('.c-sp-liste-tete .c-pilule', { hasText: /^Ouvertes/ }));
      await expect.poll(() => p.locator('.c-sp-grille-seule').count(), { timeout: 20_000 }).toBe(0);
      await fermer(p);
    } finally {
      await admin.query('delete from plateforme.demande_support where id = $1', [demande]);
    }
  }, 60_000);

  it('Abonnements : les six cartes remplissent leur rangée, chaque libellé avant son point', async () => {
    const p = await ouvrir('#/abonnements');
    const cartes = p.locator('.c-vues .c-vue');
    await expect.poll(() => cartes.count(), { timeout: 20_000 }).toBe(6);
    const boites = await cartes.evaluateAll((l) => l.map((e) => e.getBoundingClientRect()).map((b) => ({ haut: Math.round(b.top), droite: Math.round(b.right) })));
    const rangee = await p.locator('.c-vues').evaluate((e) => Math.round(e.getBoundingClientRect().right));
    expect(new Set(boites.map((b) => b.haut)).size).toBe(1);
    expect(Math.abs((boites.at(-1)?.droite ?? 0) - rangee)).toBeLessThan(2);
    expect(await p.locator('.c-vue-titre').evaluateAll((l) => l.every((t) => t.lastElementChild?.classList.contains('c-pilule-point')))).toBe(true);
    await fermer(p);
  }, 60_000);

  it('au téléphone, Échap referme le menu ouvert et rend le curseur à son bouton', async () => {
    const p = await ouvrir('#/', 390);
    const bouton = p.locator('.c-menu-tel');
    await cliquer(bouton);
    await expect.poll(() => bouton.getAttribute('aria-expanded')).toBe('true');
    // Au clavier, on entre dans le menu : le curseur quitte le bouton. Échap doit l'y ramener.
    await p.keyboard.press('Tab');
    expect(await bouton.evaluate((e) => e === document.activeElement)).toBe(false);
    await p.keyboard.press('Escape');
    await expect.poll(() => bouton.getAttribute('aria-expanded')).toBe('false');
    expect(await bouton.evaluate((e) => e === document.activeElement)).toBe(true);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
  it('au téléphone, Clients : un client par carte, chaque case nommée, rien caché derrière le bord ; ni « Ctrl K » sans clavier', async () => {
    const p = await ouvrir('#/clients', 390);
    const lignes = p.locator('.c-table-clients tbody tr');
    await expect.poll(() => lignes.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(await p.locator('.c-table-clients thead').isVisible()).toBe(false);
    // L'état de chaque client tient dans l'écran (avant 1.87.0, la colonne passait derrière le bord droit).
    const etats = await p.locator('.c-table-clients td.c-cl-etat').evaluateAll((l) => l.map((e) => e.getBoundingClientRect()).map((b) => ({ g: b.left, d: b.right })));
    expect(etats.every((b) => b.g >= 0 && b.d <= 390)).toBe(true);
    // Chaque case dit ce qu'elle est : « État », « Échéance »… devant sa valeur.
    const libelles = await p.locator('.c-table-clients tbody tr').first().locator('td[data-libelle]').evaluateAll((l) => l.map((e) => getComputedStyle(e, '::before').content));
    expect(libelles.slice(0, 4)).toEqual(['"Abonnement"', '"État"', '"Échéance"', '"Par an, HT"']);
    // Le journal aussi, un geste par carte : le geste tient dans l'écran, nommé.
    await p.goto(`${serveur.adresse}/console/#/journal`);
    const gestes = p.locator('.c-table-journal td.c-jr-geste');
    await expect.poll(() => gestes.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    expect((await gestes.evaluateAll((l) => l.map((e) => e.getBoundingClientRect().right))).every((d) => d <= 390)).toBe(true);
    expect(await gestes.first().evaluate((e) => getComputedStyle(e, '::before').content)).toBe('"Geste"');
    await p.goto(`${serveur.adresse}/console/#/`);
    await expect.poll(() => p.locator('.c-touche').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(await p.locator('.c-touche').first().isVisible()).toBe(false);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
  // Les tableaux de six ou sept colonnes défilaient de côté sur 600 à 1 000 points (1.87.3) : la grille des prix, les membres
  // de l'équipe, les règles de la veille. Seuls restent des tableaux la matrice des droits et les routes du serveur.
  it('au téléphone, Réglages, Équipe et Alertes : une ligne par carte, chaque case nommée, aucun tableau qui défile de côté', async () => {
    const p = await ouvrir('#/reglages', 390);
    const qui = (sel: string) => p.locator(sel).first().locator('td[data-libelle]').evaluateAll((l) => l.map((e) => getComputedStyle(e, '::before').content));
    // Ce qui défile de côté, hors des deux tableaux qu'on garde.
    const deCote = () => p.locator('.c-defile').evaluateAll((l) => l.filter((d) => d.scrollWidth > d.clientWidth + 2 && !d.querySelector('.c-eq-droits, .c-pf-table-routes'))
      .map((d) => d.querySelector('table')?.className ?? '?'));
    await expect.poll(() => p.locator('.c-rg-grille tbody tr').count(), { timeout: 20_000 }).toBeGreaterThan(1);
    expect((await qui('.c-rg-grille tbody tr:nth-child(2)')).slice(0, 2)).toEqual(['"À l\'année, HT"', '"Au mois, HT"']);
    expect(await deCote()).toEqual([]);
    await p.goto(`${serveur.adresse}/console/#/equipe`);
    await expect.poll(() => p.locator('.c-eq-membres tbody tr').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    expect((await qui('.c-eq-membres tbody tr')).slice(0, 2)).toEqual(['"Son rôle"', '"Son code"']);
    expect(await deCote()).toEqual([]);
    // « À régler dans l'équipe » : le bouton passe sous son texte (à côté, il le réduisait à un mot par ligne et se coupait).
    const regler = await p.locator('.c-eq-regler-liste li:has(> .c-btn)').evaluateAll((l) => l.map((li) => {
      const t = li.querySelector('.c-eq-regler-texte')?.getBoundingClientRect();
      const b = li.querySelector(':scope > .c-btn')?.getBoundingClientRect();
      return { dessous: !!t && !!b && b.top >= t.bottom - 1, dedans: !!b && b.right <= 390 };
    }));
    expect(regler.length).toBeGreaterThan(0);
    expect(regler.every((r) => r.dessous && r.dedans)).toBe(true);
    await p.goto(`${serveur.adresse}/console/#/service/alertes`);
    await expect.poll(() => p.locator('.c-al-t-regles tbody tr').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    expect((await qui('.c-al-t-regles tbody tr'))[0]).toBe('"Elle parle quand"');
    expect(await deCote()).toEqual([]);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
  // Au clavier, la fiche d'un client était à quinze tabulations de sa recherche (1.87.10) : une seule organisation
  // trouvée, « Entrée » l'ouvre ; deux, la liste reste.
  it('Clients au clavier : Ctrl K, le nom, « Entrée » ouvre la seule fiche trouvée, depuis Clients comme depuis l\'accueil', async () => {
    const email = `clavier-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Clavier', motDePasse: MDP });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', j, { methode: 'application' });
    const nom = `Fromagerie Clavier ${Date.now()}`;
    const id = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
    // La liste se lit sur les chiffres que l'équipe partage : « Actualiser » les refait (C65).
    expect((await api('GET', '/console/entreprises?frais=1', jD)).statut).toBe(200);
    const p = await ouvrir('#/clients');
    await p.locator('.c-table-clients tbody tr').first().waitFor({ timeout: 20_000 });
    await p.keyboard.press('Control+k');
    await expect.poll(() => actif(p).then((a) => a.tag)).toBe('INPUT');
    await p.keyboard.type(nom, { delay: 10 });
    await p.keyboard.press('Enter');
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toBe(`#/clients/${id}`);
    // Depuis l'accueil aussi : sa recherche ouvrait la liste, même pour un seul nom.
    await p.goto(`${serveur.adresse}/console/#/`);
    await p.locator('form.c-recherche input').waitFor({ timeout: 20_000 });
    await p.locator('form.c-recherche input').fill(nom);
    await p.locator('form.c-recherche input').press('Enter');
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toBe(`#/clients/${id}`);
    // Deux trouvées (« Fromagerie Clavier » en a au moins deux d'un essai à l'autre, et l'autre ici) : la liste reste.
    await api('POST', '/entreprises', j, { raisonSociale: `${nom} bis` });
    expect((await api('GET', '/console/entreprises?frais=1', jD)).statut).toBe(200);
    await p.goto(`${serveur.adresse}/console/#/clients`);
    await p.locator('.c-table-clients tbody tr').first().waitFor({ timeout: 20_000 });
    await p.locator('.c-recherche input').fill(nom);
    await p.locator('.c-recherche input').press('Enter');
    await expect.poll(() => p.locator('.c-table-clients tbody tr').count(), { timeout: 20_000 }).toBe(2);
    expect(await p.evaluate(() => location.hash)).toMatch(/^#\/clients\?/);
    // Deux, depuis l'accueil : la liste.
    await p.goto(`${serveur.adresse}/console/#/`);
    await p.locator('form.c-recherche input').waitFor({ timeout: 20_000 });
    await p.locator('form.c-recherche input').fill(nom);
    await p.locator('form.c-recherche input').press('Enter');
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toBe(`#/clients?${new URLSearchParams({ q: nom }).toString()}`);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
  it('l\'entrée de la console : l\'adresse se tape d\'un trait, sans que le curseur saute au mot de passe ; venue remplie, le curseur va au mot de passe', async () => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/`);
    const adresse = p.locator('input[type=email]');
    await adresse.waitFor();
    await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type)).toBe('email');
    await p.keyboard.type('nadia.essai@exemple.tn', { delay: 15 });
    expect(await adresse.inputValue()).toBe('nadia.essai@exemple.tn');
    expect(await p.locator('input[autocomplete=current-password]').inputValue()).toBe('');
    // Venue d'une invitation acceptée, l'adresse arrive remplie : le curseur est au mot de passe.
    await p.goto(`${serveur.adresse}/console/#/?adresse=${encodeURIComponent('nadia.essai@exemple.tn')}`);
    await p.reload();
    await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.autocomplete)).toBe('current-password');
    expect(await adresse.inputValue()).toBe('nadia.essai@exemple.tn');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 60_000);
});
