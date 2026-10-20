// La liste des clients, à la souris (docs/console.md C32 ; la maquette Clients ; web/console/src/ecrans/Clients.tsx).
// Ce que le parcours vérifie :
//   - les pages : « Page 1 sur 2 », les numéros, la page 2, et la taille d'une page qui se choisit ;
//   - le menu « … » d'une ligne : les gestes que le serveur permet à ce rôle, ce qui détruit séparé d'un trait, et pour
//     le support ce qu'il ne fait pas et qui le fait ;
//   - un geste lancé du menu ouvre sa fenêtre SUR la liste (l'adresse ne bouge pas), et la ligne dit ce qu'il a changé ;
//   - « Exporter la sélection » n'existe que pour la direction.

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
// Un nom que seules les entreprises de ce parcours portent : la recherche les isole des autres essais de la base.
const MARQUE = `Pagination Clients ${Date.now().toString(36)}`;

describe('la liste des clients, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-clients-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-clients-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jD = '', jS = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const membre = async (nom: string, role: 'direction' | 'support') => {
    const email = `console-clients-${role}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai de la liste des clients à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    return String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
  };
  const ouvrir = async (jeton: string, hash: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${hash}`);
    await expect.poll(() => p.locator('.c-table-clients tbody tr').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const recherche = `#/clients?q=${encodeURIComponent(MARQUE)}`;
  const ligne = (p: Page, nom: string) => p.locator('.c-table-clients tbody tr', { has: p.getByText(nom, { exact: true }) });

  beforeAll(async () => {
    await admin.connect();
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    jD = await membre('Amira Clients', 'direction');
    jS = await membre('Karim Clients', 'support');
    // 27 entreprises à l'essai d'une même propriétaire : une page de 25, et deux sur la seconde.
    const email = `proprio-clients-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Proprio Clients', motDePasse: MDP });
    const jC = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    for (let i = 1; i <= 27; i++) expect((await api('POST', '/entreprises', jC, { raisonSociale: `${MARQUE} ${String(i).padStart(2, '0')}` })).statut).toBe(201);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('les pages : la première, les numéros, la seconde, et la taille d\'une page', async () => {
    const p = await ouvrir(jD, recherche);
    await expect.poll(async () => net(await p.locator('.c-liste-resume b').first().innerText()), { timeout: 15_000 }).toBe('1–25 sur 27 organisations');
    expect(await p.locator('.c-table-clients tbody tr').count()).toBe(25);
    expect(net(await p.locator('.c-cl-taille').innerText())).toMatch(/^Page 1 sur 2 par page/);
    expect(await p.locator('.c-cl-num').allInnerTexts()).toEqual(['1', '2']);
    expect(await p.locator('.c-cl-num[aria-current="page"]').innerText()).toBe('1');
    await cliquer(p.getByRole('button', { name: 'Aller à la page 2' }));
    await expect.poll(() => p.locator('.c-table-clients tbody tr').count(), { timeout: 15_000 }).toBe(2);
    expect(net(await p.locator('.c-cl-taille').innerText())).toMatch(/^Page 2 sur 2/);
    expect(await p.getByRole('button', { name: 'Suivante' }).isDisabled()).toBe(true);
    // Cinquante par page : tout tient, plus de numéros.
    await p.locator('.c-cl-taille select').selectOption('50');
    await expect.poll(() => p.locator('.c-table-clients tbody tr').count(), { timeout: 15_000 }).toBe(27);
    expect(await p.locator('.c-cl-num').count()).toBe(0);
    // Le tableau tient dans le cadre : « Ouvrir » et « … » restent à l'écran, sans barre de défilement.
    expect(await p.locator('.c-defile').evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(1);
    await fermer(p);
  }, 90_000);

  it('le menu d\'une ligne : les gestes permis, ce qui détruit après un trait ; un geste s\'ouvre sur la liste et la ligne le dit', async () => {
    // Triée par nom : prolongé, l'essai devient moins urgent et descendrait à la page suivante dans l'ordre de l'urgence.
    const p = await ouvrir(jD, `${recherche}&tri=nom`);
    const nom = `${MARQUE} 03`;
    const adresse = new URL(p.url()).hash;
    await cliquer(ligne(p, nom).locator('.c-menu-btn'));
    const menu = p.locator('.c-menu-liste');
    await expect.poll(() => menu.count(), { timeout: 10_000 }).toBe(1);
    // Les gestes de l'abonnement, nos échanges, ce qui détruit, l'accès : chaque famille après un trait (la maquette Clients).
    expect((await menu.locator('button b').allInnerTexts()).map(net)).toEqual(['Prolonger l\'essai…', 'Noter un appel…', 'Écrire au contact…', 'Passer en lecture seule…',
      'Demander l\'accès au dossier…']);
    expect((await menu.locator('button.c-menu-trait b').allInnerTexts()).map(net)).toEqual(['Noter un appel…', 'Passer en lecture seule…', 'Demander l\'accès au dossier…']);
    // « Passer en lecture seule » détruit : il est dit en rouge ; pas de note pour la direction.
    expect(await menu.locator('button.c-menu-danger b').innerText()).toBe('Passer en lecture seule…');
    expect(await menu.locator('.c-menu-note').count()).toBe(0);
    await cliquer(menu.getByRole('button', { name: /Prolonger l'essai/ }));
    const fenetre = p.locator('.c-dialogue');
    await expect.poll(() => fenetre.count(), { timeout: 10_000 }).toBe(1);
    // La fenêtre est celle de la fiche, posée sur la liste : l'adresse reste celle de la liste.
    expect(new URL(p.url()).hash).toBe(adresse);
    await fenetre.locator('input[type="number"]').fill('7');
    await fenetre.locator('textarea').fill('Il finit la saisie de son stock');
    await cliquer(fenetre.getByRole('button', { name: 'Prolonger l\'essai' }));
    await expect.poll(() => p.locator('.c-dialogue').count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(async () => net(await ligne(p, nom).locator('.c-cl-abo').innerText()), { timeout: 15_000 }).toMatch(/prolongé de 7 jours$/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('noter un appel depuis le menu : la fenêtre s\'ouvre sur la liste, puis la fiche dit le dernier échange et la note', async () => {
    const p = await ouvrir(jS, recherche);
    const nom = `${MARQUE} 07`;
    await cliquer(ligne(p, nom).locator('.c-menu-btn'));
    await cliquer(p.locator('.c-menu-liste').getByRole('button', { name: /Noter un appel/ }));
    const fenetre = p.locator('.c-dialogue');
    await expect.poll(() => fenetre.count(), { timeout: 10_000 }).toBe(1);
    // On s'est parlé, sans rien écrire : la fenêtre le refuse et montre le champ.
    await cliquer(fenetre.getByRole('button', { name: 'Ranger la note' }));
    await expect.poll(async () => net(await fenetre.locator('.c-alerte').innerText()), { timeout: 10_000 }).toMatch(/deux lignes/);
    await fenetre.locator('textarea').fill('Il veut une démonstration de la caisse');
    await cliquer(fenetre.getByRole('button', { name: 'Ranger la note' }));
    await expect.poll(() => p.locator('.c-dialogue').count(), { timeout: 15_000 }).toBe(0);
    // Sa fiche : « Dernier échange » à « À qui parler », la note dans « Support et échanges ».
    await cliquer(ligne(p, nom).getByRole('link', { name: nom, exact: true }));
    await expect.poll(async () => net(await p.locator('.c-fiche-dernier').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^Dernier échange : .*Karim Clients · on s'est parlé\.$/);
    await cliquer(p.getByRole('link', { name: /Support et échanges/ }));
    await expect.poll(async () => net(await p.locator('.c-fiche-notes').innerText().catch(() => '')), { timeout: 15_000 }).toContain('Il veut une démonstration de la caisse');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('« Pièces émises » d\'une entreprise née ce mois-ci dit depuis quand elle compte ; née avant, le mois d\'avant (1.76.0)', async () => {
    const p = await ouvrir(jS, recherche);
    // Née ce mois-ci : le mois d'avant n'existe pas pour elle.
    await cliquer(ligne(p, `${MARQUE} 05`).getByRole('link', { name: `${MARQUE} 05`, exact: true }));
    const tuile = p.locator('.c-fiche-chiffres .c-chiffre').filter({ hasText: 'Pièces émises' });
    await expect.poll(async () => net(await tuile.innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/ce mois-ci, depuis son inscription le \d{2}\/\d{2}\/\d{4}$/);
    expect(net(await tuile.innerText())).not.toMatch(/aucune en/);
    // Née trois mois plus tôt : la tuile compare au mois d'avant.
    await admin.query(`update socle.entreprise set cree_le = cree_le - interval '3 months' where raison_sociale = $1`, [`${MARQUE} 06`]);
    await p.goto(`${serveur.adresse}/console/${recherche}`);
    await expect.poll(() => p.locator('.c-table-clients tbody tr').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await cliquer(ligne(p, `${MARQUE} 06`).getByRole('link', { name: `${MARQUE} 06`, exact: true }));
    await expect.poll(async () => net(await tuile.innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/aucune en [a-zéû]+$/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('la sortie d\'un client (0131) : la direction l\'ouvre sur sa fiche ; la carte dit ce qui reste ; « Il est parti » attend le remboursement ; le support ne la voit pas', async () => {
    const nom = `${MARQUE} 09`;
    const p = await ouvrir(jD, recherche);
    await cliquer(ligne(p, nom).getByRole('link', { name: nom, exact: true }));
    const carte = p.locator('section[aria-labelledby="fiche-sortie"]');
    await expect.poll(() => carte.count(), { timeout: 15_000 }).toBe(1);
    await cliquer(carte.getByRole('button', { name: 'Ouvrir sa sortie…' }));
    const fenetre = p.locator('.c-dialogue');
    // Sans sa cause : refusé, et la fenêtre le dit.
    await cliquer(fenetre.getByRole('button', { name: 'Ouvrir la sortie' }));
    await expect.poll(async () => net(await fenetre.locator('.c-alerte').innerText()), { timeout: 10_000 }).toBe('Choisis pourquoi il s\'en va.');
    await cliquer(fenetre.getByRole('radio', { name: 'Le prix' }));
    await fenetre.locator('textarea').fill('Trop cher pour une seule caisse');
    await cliquer(fenetre.getByRole('button', { name: 'Ouvrir la sortie' }));
    await expect.poll(() => p.locator('.c-dialogue').count(), { timeout: 15_000 }).toBe(0);
    // La carte en cours : ce qu'il dit, ses étapes ; « Il est parti… » éteint, et la carte dit pourquoi.
    await expect.poll(async () => net(await carte.locator('h2').innerText().catch(() => '')), { timeout: 15_000 }).toBe('Sortie en cours');
    expect(net(await carte.locator('.c-so-dit p').innerText())).toBe('Trop cher pour une seule caisse');
    expect((await carte.locator('.c-so-etapes b').allInnerTexts()).map(net)).toEqual(['Le contrat', 'Ses données', 'Le remboursement', 'La conservation']);
    const partir = carte.getByRole('button', { name: 'Il est parti…' });
    expect(await partir.isDisabled()).toBe(true);
    expect(net(await carte.locator('.c-reprise-note').innerText())).toBe('Pour le dire parti, il reste à régler : le remboursement.');
    // Rendu, avec son montant et son jour, mais pas encore noté dans SkanFact (0138, l'audit 1.42.0 A04) : l'étape le dit
    // (le montant une fois avec sa devise), et « Il est parti… » reste éteint.
    await cliquer(carte.getByRole('button', { name: 'Régler…' }));
    await cliquer(fenetre.getByRole('radio', { name: 'Rendu', exact: true }));
    await fenetre.getByLabel('La référence', { exact: true }).fill('VIR-2026-0901');
    await fenetre.getByLabel('Le montant rendu', { exact: true }).fill('12,500');
    await fenetre.locator('textarea').fill('Rendu par virement');
    await cliquer(fenetre.getByRole('button', { name: 'Noter le remboursement' }));
    await expect.poll(() => p.locator('.c-dialogue').count(), { timeout: 15_000 }).toBe(0);
    const etape = carte.locator('.c-so-etapes li', { hasText: 'Le remboursement' });
    await expect.poll(async () => net(await etape.innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^Le remboursement Rendu : 12,500 DT le \d{2}\/\d{2}\/\d{4} \(VIR.2026.0901\), déclaré .+ ; pas encore noté dans SkanFact/);
    expect(await partir.isDisabled()).toBe(true);
    // Puis rien à rendre, avec son motif ; « Il est parti… » s'allume, en principal.
    await cliquer(carte.getByRole('button', { name: 'Changer…' }));
    await cliquer(fenetre.getByRole('radio', { name: 'Rien à rendre', exact: true }));
    await fenetre.locator('textarea').fill('Essai gratuit : rien à rendre');
    await cliquer(fenetre.getByRole('button', { name: 'Noter : rien à rendre' }));
    await expect.poll(() => p.locator('.c-dialogue').count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => partir.isEnabled(), { timeout: 15_000 }).toBe(true);
    expect(await partir.getAttribute('class')).toContain('c-btn-principal');
    // Il part sans avoir pris ses données : la fenêtre l'avertit avant le geste ; close, la carte dit jusqu'à quand on les garde.
    await cliquer(partir);
    await expect.poll(async () => net(await fenetre.locator('.c-alerte-attention').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Il n'a pas téléchargé ses données/);
    await fenetre.locator('textarea').fill('Il part à la fin de son essai');
    await cliquer(fenetre.getByRole('button', { name: 'Clore : il est parti' }));
    await expect.poll(async () => net(await carte.innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/Parti le \d{2}\/\d{2}\/\d{4} ; dernier jour de son contrat : le \d{2}\/\d{2}\/\d{4}\. Ses données sont gardées, en lecture seule, jusqu'au \d{2}\/\d{2}\/\d{4}\./);
    const adresse = p.url();
    await fermer(p);
    // Le support : ni la carte, ni le geste.
    const s = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await s.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jS);
    const ps = await s.newPage();
    await ps.goto(adresse);
    await expect.poll(async () => net(await ps.locator('h1').first().innerText().catch(() => '')), { timeout: 15_000 }).toBe(nom);
    expect(await ps.locator('section[aria-labelledby="fiche-sortie"]').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await s.close();
  }, 90_000);

  it('le support : prolonger et demander l\'accès, la note de ce qui revient à la direction ; jamais l\'export', async () => {
    const p = await ouvrir(jS, recherche);
    expect(await p.locator('.c-entete-actions').count()).toBe(0);
    await cliquer(ligne(p, `${MARQUE} 05`).locator('.c-menu-btn'));
    const menu = p.locator('.c-menu-liste');
    await expect.poll(() => menu.count(), { timeout: 10_000 }).toBe(1);
    expect((await menu.locator('button b').allInnerTexts()).map(net)).toEqual(['Prolonger l\'essai…', 'Noter un appel…', 'Écrire au contact…', 'Demander l\'accès au dossier…']);
    expect(net(await menu.locator('.c-menu-note').innerText())).toBe('Le support prolonge un essai, une fois par entreprise, et offre un mois, un sur douze mois ; changer d\'offre, prolonger une grâce, réactiver, résilier : la direction.');
    await fermer(p);
    // La direction, elle, l'a, en haut à droite.
    const d = await ouvrir(jD, recherche);
    expect(net(await d.locator('.c-entete-actions').innerText())).toBe('Exporter la sélection…');
    await fermer(d);
  }, 90_000);

  it('au clavier, comme sur le Mac : le menu se parcourt aux flèches, la fenêtre nomme son client, les pastilles se cochent aux flèches', async () => {
    const p = await ouvrir(jD, `${recherche}&tri=nom`);
    const nom = `${MARQUE} 09`;
    const bouton = ligne(p, nom).locator('.c-menu-btn');
    // Son nom lu dit le client : une valeur que le catalogue ne remplit pas resterait entre accolades.
    expect(await bouton.getAttribute('aria-label')).toBe(`Les gestes pour ${nom}`);
    const auClavier = () => p.evaluate(() => (document.activeElement?.querySelector('b')?.textContent ?? document.activeElement?.getAttribute('aria-label') ?? '').trim());
    await cliquer(bouton);
    // Ouvert, le menu prend le clavier sur son premier choix ; les flèches, Début et Fin le parcourent ; le dernier
    // mène au premier.
    await expect.poll(auClavier, { timeout: 10_000 }).toBe('Prolonger l\'essai…');
    await p.keyboard.press('ArrowDown');
    expect(await auClavier()).toBe('Noter un appel…');
    await p.keyboard.press('End');
    expect(await auClavier()).toBe('Demander l\'accès au dossier…');
    await p.keyboard.press('ArrowDown');
    expect(await auClavier()).toBe('Prolonger l\'essai…');
    await p.keyboard.press('ArrowUp');
    expect(await auClavier()).toBe('Demander l\'accès au dossier…');
    // Échap le ferme et rend le clavier à son bouton ; Entrée le rouvre.
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('.c-menu-liste').count(), { timeout: 10_000 }).toBe(0);
    expect(await auClavier()).toBe(`Les gestes pour ${nom}`);
    await p.keyboard.press('Enter');
    await expect.poll(auClavier, { timeout: 10_000 }).toBe('Prolonger l\'essai…');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    // La fenêtre nomme le client au-dessus de son titre : ouverte d'une liste, elle ne laisse rien deviner.
    const fenetre = p.locator('.c-dialogue');
    await expect.poll(() => fenetre.count(), { timeout: 10_000 }).toBe(1);
    expect(await fenetre.locator('.c-dialogue-pour').textContent()).toBe(nom);
    // Les pastilles : la touche Tab entre sur la cochée, les flèches cochent la voisine (la première mène à la dernière).
    await p.keyboard.press('Shift+Tab');
    const cochee = () => p.evaluate(() => [document.activeElement?.textContent ?? '', document.activeElement?.getAttribute('aria-checked') ?? '']);
    expect(await cochee()).toEqual(['On s\'est parlé', 'true']);
    await p.keyboard.press('ArrowRight');
    expect(await cochee()).toEqual(['Pas de réponse', 'true']);
    await p.keyboard.press('ArrowLeft');
    await p.keyboard.press('ArrowLeft');
    expect(await cochee()).toEqual(['Message laissé', 'true']);
    expect(await fenetre.locator('[role="radio"][aria-checked="true"]').count()).toBe(1);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('.c-dialogue').count(), { timeout: 10_000 }).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);
});
