// (1.372.0) Le guide du Cabinet, écran par écran. Un comptable qui ouvre SkanFact pour la première fois clique « Guide-moi » :
// la visite de la page LIT l'écran bloc par bloc. Elle n'expliquait que les blocs de l'ancien Cabinet — sur les écrans
// en ligne, la moitié restait muette, et la comptabilité d'un dossier (un seul panneau) se lisait d'un bloc, ses onglets
// récités sous le titre « Le brouillard ». Le parcours vérifie, sur le dossier d'exemple :
//   - chaque écran explique ses blocs, chacun avec SA phrase (le tableau de bord, les dossiers, la fiche, la saisie, la
//     banque, la paie, le grand livre, la déclaration, la liasse, le classeur, les échéances, les pièces) ;
//   - les vingt-sept comptes d'un grand livre font UNE étape, et un compte replié n'est pas « invisible » ;
//   - une ligne-lien à plusieurs morceaux se nomme par son premier morceau : « Déclaration d'octobre 2026samedi 28/11 ·
//     dans 12 jours7 dossiers » se lisait collé, et passait pour le nom d'une page ;
//   - la visite du tableau de bord se déroule jusqu'au bout, à la souris ;
//   - le dossier d'exemple n'entre ni dans « n clients » ni dans les honoraires du cabinet (il gonflait les deux).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les visites guidées du Cabinet expliquent chaque écran (1.372.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-visites-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
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
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  it('chaque écran du Cabinet explique ses blocs, et la visite du tableau de bord se déroule jusqu\'au bout', async () => {
    const associe = await personne('Sami');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Gharbi' })).corps.id);
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}`);
    const pas = p.locator('[data-pas="decouverte"]');
    await pas.waitFor({ timeout: 30_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    expect(net(await pas.innerText())).toBe('Charger le dossier d\'exemple');
    expect(net(await p.locator('#view').innerText())).toContain('Essaie d\'abord sur un dossier d\'exemple');
    // Un seul bouton vert sur ce premier écran : l'exemple.
    expect(await p.locator('.cab-neuf .btn-primary').count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-exemple-0-premier-ecran.png') });
    // Les Réglages le disent aussi (« L'application », « Exemple ») : ce qu'il contient, et qu'il ne coûte rien.
    await p.evaluate(() => { location.hash = '#/reglages'; });
    await p.locator('#set-tabs [data-tab="app"]').click();
    expect(net(await p.locator('#pan-exemple').innerText())).toContain('Il n\'entre pas dans ton abonnement');
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    await pas.waitFor({ timeout: 30_000 });
    await pas.click();
    await p.locator('#ex-charge').waitFor({ timeout: 10_000 });
    await p.locator('#ex-charge').waitFor({ state: 'detached', timeout: 150_000 });
    await p.locator('#demo-banner').waitFor({ timeout: 30_000 });
    const id = (/#\/dossier\/([0-9a-f-]+)/.exec(p.url()) ?? [])[1] ?? '';
    expect(id).not.toBe('');

    // Ce que la visite d'un écran lira : le titre de chaque étape, et si elle porte une phrase.
    const etapes = async (hash: string, attendre: string) => {
      await p.evaluate((h) => { location.hash = h; }, hash);
      await p.locator(attendre).first().waitFor({ timeout: 40_000 });
      await p.waitForTimeout(600);
      return p.evaluate(() => (window as unknown as { Visite: { etapesDeLaVue: (o: object) => { titre: string; texte: string }[] } }).Visite
        .etapesDeLaVue({ onglets: 'actif' }).map((x) => ({ titre: x.titre, phrase: !!x.texte })));
    };
    const D = `#/dossier/${id}`;
    const ECRANS: [string, string, string[]][] = [
      ['#/production', '#tb-dossiers', ['À faire maintenant', 'La campagne du mois', 'La grille des dossiers', 'Les prochaines dates']],
      ['#/dossiers', '.lf-tab', ['Les chiffres du portefeuille', 'Les vues', 'Trier et retrouver', 'La liste des clients']],
      [D, '.fd-cote', ['Quatre chiffres', 'Ce qui attend', 'Les relances', 'La fiche du client']],
      [`${D}/comptabilite/saisie`, '.sx-km', ['Les écrans de la comptabilité', 'L\'année, mois par mois', 'La grille de saisie', 'Le brouillard']],
      [`${D}/comptabilite/banque`, '.bq2', ['Le relevé', 'Où en est le relevé', 'Les lignes de la banque', 'La preuve']],
      [`${D}/comptabilite/paie`, '.cp-pa-grille', ['Le mois de paie', 'Les étapes du mois', 'Les bulletins']],
      [`${D}/comptabilite/grand-livre`, '.gl-compte', ['La période', 'Une ligne qui se déplie']],
      [`${D}/comptabilite/declaration`, '#dc-formulaire', ['Les étapes du mois', 'Le formulaire du mois']],
      [`${D}/comptabilite/liasse`, '#li-employeur', ['Bilan — Actif', 'État de résultat', 'Résultat fiscal et impôt']],
      [`${D}/classeur`, '.cl-liste', ['Chercher une pièce', 'Le classeur, mois par mois', 'Les pièces du mois']],
      ['#/echeances', '.ec-col', ['Les dates limites']],
      ['#/pieces', '.pc-barre', ['À classer, classées']],
    ];
    for (const [hash, attendre, titres] of ECRANS) {
      const lues = await etapes(hash, attendre);
      for (const t of titres) {
        const e = lues.find((x) => x.titre === t);
        expect(e, `${hash} : l'étape « ${t} » (lues : ${lues.map((x) => x.titre).join(' · ')})`).toBeTruthy();
        expect(e?.phrase, `${hash} : « ${t} » porte sa phrase`).toBe(true);
      }
      // La comptabilité ne se lit plus d'un bloc, et ne promet plus d'ouvrir des onglets qu'elle n'ouvre pas.
      expect(lues.map((x) => x.titre), hash).not.toContain('Les onglets');
      if (hash.endsWith('/grand-livre')) {
        expect(lues.filter((x) => x.titre === 'Une ligne qui se déplie').length).toBe(1);
        expect(await p.locator('.gl-compte').count()).toBeGreaterThan(5);
      }
    }

    // Le dossier d'exemple n'est pas un client : ni dans le compte, ni dans les honoraires du cabinet.
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    await p.locator('.cd-tuiles').waitFor({ timeout: 30_000 });
    expect(net(await p.locator('.a-phrase').innerText())).toBe('0 client · 0 sur SkanFact, 0 tenu au cabinet · et le dossier d\'exemple, qui ne compte pas.');
    expect(net(await p.locator('.cd-t1').innerText())).toContain('aucun honoraire écrit');
    expect(net(await p.locator('.cd-tuiles').innerText())).toContain('0 / 0');
    expect(net(await p.locator('.lf-tab tbody tr').first().innerText())).toContain('250,000');
    expect(net(await p.locator('.lf-tab tfoot').innerText())).not.toContain('250,000');

    // Le menu d'un dossier tenu au cabinet ne parle ni de « mois reçus » ni de « paquets reçus » : ce client n'envoie rien.
    await p.evaluate((h) => { location.hash = h; }, `${D}/comptabilite/saisie`);
    await p.locator('.sx-km').waitFor({ timeout: 40_000 });
    await p.locator('.cp-tete .row-menu-btn').click();
    const menu = net(await p.locator('.row-menu').last().innerText());
    expect(menu).toContain('Ses mois, la révision, l\'équipe');
    expect(menu).not.toMatch(/paquet|reçus/i);
    await p.keyboard.press('Escape');

    // La visite du tableau de bord, à la souris, jusqu'au bout.
    await p.evaluate(() => { location.hash = '#/production'; });
    await p.locator('#tb-dates a.der-l').first().waitFor({ timeout: 40_000 });
    await p.locator('#guide-moi').click();
    await p.locator('.guide-menu button').filter({ hasText: /visite de la page/i }).first().click();
    const bulle = p.locator('#visite-bulle');
    await bulle.waitFor({ timeout: 10_000 });
    const vues: string[] = [];
    for (let i = 0; i < 14; i++) {
      const texte = net(await bulle.innerText());
      vues.push(texte);
      if (/Les prochaines dates/.test(texte)) await p.screenshot({ path: path.join(PHOTOS, 'cabinet-visites-1-dates.png') });
      const suite = bulle.locator('.vb-suiv');
      if (!await suite.count() || /Terminer/.test(net(await suite.innerText()))) break;
      await suite.click();
      await p.waitForTimeout(350);
    }
    const tout = vues.join(' ‖ ');
    for (const t of ['À faire maintenant', 'La campagne du mois', 'La grille des dossiers', 'Les prochaines dates']) expect(tout).toContain(t);
    const dates = vues.find((v) => /Les prochaines dates/.test(v)) ?? '';
    expect(dates).toContain('Emmène à la page « Échéances ».');
    // Le nom de la ligne est son premier morceau : ni la date ni le compte ne s'y collent.
    expect(dates).not.toMatch(/\d{4}(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/);
    expect(dates).not.toMatch(/Emmène à la page « [^»]*\d+ dossiers?/);
    // (1.379.1, issue 14, ENTSOCLE-8) La carte de fin ne suit pas de page en page : changer de page la ferme.
    if (!/Visite terminée/i.test(net(await bulle.innerText()))) await bulle.locator('.vb-suiv').click();
    await expect.poll(async () => net(await bulle.innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/Visite terminée/i);
    await p.waitForTimeout(1_700);
    await p.evaluate(() => { location.hash = '#/echeances'; });
    await expect.poll(() => p.locator('#visite-bulle').count(), { timeout: 5_000 }).toBe(0);
    // (1.374.0) « Tenir la fiche d'un client » suit la fiche d'aujourd'hui : elle ouvrait l'ancien écran « …/suivi » (issue 12).
    await p.keyboard.press('Escape');
    await p.evaluate(() => { location.hash = '#/guide'; });
    const fiche = p.locator('[data-visite="fiche-client"]').first();
    await fiche.waitFor({ timeout: 10_000 });
    await fiche.click();
    await expect.poll(async () => net(await bulle.innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/Ce qui attend/);
    expect(await p.evaluate(() => location.hash)).toMatch(/^#\/dossier\/[^/]+$/);
    const titresFiche: string[] = [];
    for (let i = 0; i < 6; i++) {
      titresFiche.push(net(await bulle.innerText()));
      const suite = bulle.locator('.vb-suiv');
      if (!await suite.count() || !/Suivant/.test(net(await suite.innerText()))) break;
      await suite.click();
      await p.waitForTimeout(350);
    }
    const toutFiche = titresFiche.join(' ‖ ');
    for (const t of ['Ce qui attend', 'Son année, mois par mois', 'La mission, l\'équipe, le client', 'Le menu de ses gestes']) expect(toutFiche).toContain(t);
    expect(toutFiche).not.toMatch(/ne se changent pas ici|Les mois de ce client/);
    expect(erreurs).toEqual([]);
  }, 420_000);
});
