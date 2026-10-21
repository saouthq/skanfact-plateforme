// « Tes premiers pas » de la plateforme, à la souris (lot onboarding ; maquette validée par Skander le 09/10/2026 ;
// plateforme/premiers-pas.js, web/v10/premiers-pas.txt). Ce que le parcours vérifie à l'écran :
//   - après la porte et l'assistant, l'accueil montre le panneau de la maquette : « 3 sur 9 faits » et sa barre, la suite
//     (le RIB d'une entreprise de conseil) mise en avant et dite « À faire maintenant », le code « Recommandé » ;
//   - la bulle « Première fois sur cette page ? » ne se pose pas par-dessus ;
//   - chaque bouton mène où il dit : le code et l'adresse à Ton compte, le RIB à sa case, le comptable à l'onglet du
//     cabinet ; un code activé et un cabinet choisi se cochent au retour sur l'accueil, sans recharger la page ;
//   - une adresse que le serveur sait vérifier, et qui ne l'est pas, passe en tête ; une activité laissée de côté se
//     choisit en revoyant l'assistant ;
//   - au téléphone, rien ne déborde, et tout se touche du doigt.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { problemes } from '../instrument-rendu.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('les premiers pas de la plateforme, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  // Le même, sans relais d'e-mails : rien n'y protège un nouvel appareil hors du mot de passe (0081).
  let sansCourriel: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-premiers-pas-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } } });
    sansCourriel = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await sansCourriel?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const codeRecu = (email: string) => /(\d{6})$/.exec(partis.filter((m) => m.a === email).at(-1)?.objet ?? '')?.[1] ?? '';
  // Une personne inscrite ; ce serveur envoie des e-mails : son adresse se vérifie par le code reçu.
  async function personne(nom: string) {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const defi = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.defi);
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeRecu(email) })).corps.jeton);
    return { email, jeton };
  }
  async function page(jeton: string, largeur = 1440, hauteur = 900) {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { p, erreurs };
  }
  const panneau = (p: Page) => p.locator('#view .premiers-pas');
  const ligne = (p: Page, titre: string) => panneau(p).locator('.pp-list li').filter({ has: p.locator('.pp-txt strong', { hasText: titre }) });
  const accueil = async (p: Page) => { await p.evaluate(() => { location.hash = '#/dashboard'; }); await panneau(p).waitFor({ timeout: 15_000 }); };

  // La porte, puis l'assistant d'une entreprise de conseil (le RIB lui est demandé : elle est payée par virement).
  async function conseil(p: Page) {
    await p.goto(serveur.adresse);
    await p.getByRole('button', { name: 'Créer mon entreprise', exact: true }).first().click();
    await p.locator('label.field').filter({ hasText: 'Raison sociale' }).locator('input').fill('Gharbi Conseil');
    // Un matricule à ce fichier seul (tests/matricule-libre.ts).
    await p.locator('label.field').filter({ hasText: 'Matricule fiscal' }).locator('input').fill('1732051L/A/M/000');
    await p.locator('form').getByRole('button', { name: /Créer mon entreprise/ }).click();
    await p.waitForURL(/\/v10\/\?e=[0-9a-f-]{36}/, { timeout: 15_000 });
    const as = p.locator('#setup.as');
    await as.locator('h1').filter({ hasText: 'Où te joindre' }).waitFor({ timeout: 15_000 });
    await as.locator('#as-tel').fill('55 123 456');
    await as.locator('#as-suite').click();
    await as.locator('h1').filter({ hasText: 'Que fais-tu' }).waitFor();
    await as.locator('.as-tuile').filter({ hasText: 'Conseil, formation et services' }).click();
    await as.locator('#as-suite').click();
    await as.locator('h1').filter({ hasText: 'Factures-tu la TVA' }).waitFor();
    await as.locator('#as-suite').click();
    await as.locator('h1').filter({ hasText: 'De quoi as-tu besoin' }).waitFor();
    await as.locator('#as-suite').click();
    await as.waitFor({ state: 'detached' });
    await panneau(p).waitFor({ timeout: 15_000 });
    return new URL(p.url()).searchParams.get('e') ?? '';
  }

  it('après la porte et l\'assistant : le panneau de la maquette, la suite mise en avant, chaque bouton mène où il dit, et ce qui se fait ailleurs se coche au retour', async () => {
    const { jeton } = await personne('amine');
    const { p, erreurs } = await page(jeton);
    const ent = await conseil(p);
    // Le compte, l'entreprise et l'activité : faits par la porte et l'assistant ; et le compte est protégé : ce serveur
    // envoie des e-mails, le code par e-mail (le choix par défaut, 0081) protège déjà un nouvel appareil.
    await expect.poll(() => panneau(p).locator('.pp-compte').innerText(), { timeout: 15_000 }).toBe('4 sur 9 faits');
    const barre = panneau(p).getByRole('progressbar', { name: 'Tes premiers pas' });
    expect([await barre.getAttribute('aria-valuenow'), await barre.getAttribute('aria-valuemax')]).toEqual(['4', '9']);
    expect(await panneau(p).locator('.pp-list li.fait .pp-txt strong').allInnerTexts()).toEqual(['Ton compte et ton adresse vérifiée', 'Ton entreprise et où te joindre', 'Ton activité, ta TVA et ton menu', 'Protège ton compte']);
    // La suite : le RIB, « À faire maintenant », son bouton le seul en avant.
    const rib = ligne(p, 'Ton RIB, pour être payé par virement');
    expect(await rib.getAttribute('class')).toContain('encours');
    expect(await rib.locator('.pp-badge').innerText()).toBe('À faire maintenant');
    expect(await panneau(p).locator('.btn-primary').allInnerTexts()).toEqual(['Ajouter mon RIB']);
    expect(await ligne(p, 'Invite ton comptable').locator('.pp-badge').innerText()).toBe('Facultatif');
    // Les premiers pas sont l'invitation de l'accueil : pas de bulle par-dessus.
    await p.waitForTimeout(800);
    expect(await p.locator('#guide-appel').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'premiers-pas-1-accueil.png') });

    // Chaque bouton mène où il dit.
    await rib.getByRole('button', { name: 'Ajouter mon RIB', exact: true }).click();
    await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name ?? '')).toBe('rib');
    await accueil(p);
    await ligne(p, 'Invite ton comptable').getByRole('button', { name: 'Inviter mon comptable', exact: true }).click();
    await p.locator('#p-cabinet-mandat').waitFor({ timeout: 15_000 });

    // Le dossier proposé à un cabinet (et le code de l'application activé par l'API : rien ne change, l'étape était
    // faite) : au retour sur l'accueil, sans recharger la page, il se coche (le serveur s'y relit, au plus toutes les cinq
    // secondes).
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const { jeton: associe } = await personne('associe');
    await api('POST', '/moi/code', associe, { methode: 'application' });
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    expect((await api('POST', `/entreprises/${ent}/mandat`, jeton, { codeCabinet: String(cab.corps.code) })).statut).toBe(201);
    await p.waitForTimeout(5_500);
    await accueil(p);
    await expect.poll(() => panneau(p).locator('.pp-compte').innerText(), { timeout: 15_000 }).toBe('5 sur 9 faits');
    expect(await ligne(p, 'Protège ton compte').getAttribute('class')).toContain('fait');
    const comptable = ligne(p, 'Invite ton comptable');
    expect(await comptable.getAttribute('class')).toContain('fait');
    expect(net(await comptable.innerText())).toContain('Ta proposition attend que ton cabinet l\'accepte.');
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 180_000);

  it('une adresse que le serveur sait vérifier passe en tête ; une activité laissée de côté se choisit en revoyant l\'assistant', async () => {
    const { email, jeton } = await personne('sami');
    // Le code du téléphone : la connexion ne lui demande plus de code par e-mail ; son adresse n'a jamais été prouvée.
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await admin.query('update socle.utilisateur set adresse_verifiee_le = null where email = $1', [email]);
    // Créée sans la porte : pas d'assistant, son activité n'est pas choisie.
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Librairie Sami' })).corps.id);
    const { p, erreurs } = await page(jeton);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await panneau(p).waitFor({ timeout: 20_000 });
    const premiere = ligne(p, 'Vérifie ton adresse e-mail');
    await expect.poll(() => premiere.getAttribute('class'), { timeout: 15_000 }).toContain('encours');
    expect(net(await premiere.innerText())).toContain('il prouve qu\'elle est à toi');
    await premiere.getByRole('button', { name: 'Vérifier mon adresse', exact: true }).click();
    await p.locator('.cpt-carte').getByRole('button', { name: 'Vérifier mon adresse', exact: true }).waitFor({ timeout: 15_000 });
    // L'activité : l'assistant revu, rien ne s'écrit avant la fin (« Fermer sans rien changer »).
    await accueil(p);
    await ligne(p, 'Ton activité, ta TVA et ton menu').getByRole('button', { name: 'Choisir mon activité', exact: true }).click();
    await p.locator('#setup.as h1').filter({ hasText: 'Où te joindre' }).waitFor({ timeout: 15_000 });
    expect(await p.locator('#as-sortir').innerText()).toBe('Fermer sans rien changer');
    await p.locator('#as-sortir').click();
    await panneau(p).waitFor({ timeout: 15_000 });
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  it('sans relais d\'e-mails, « Protège ton compte » reste à faire, « Choisir mon code » mène au choix du code dans Ton compte, et un code activé la coche', async () => {
    const email = `nour-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nour', motDePasse: 'Un-bon-mot-de-passe' });
    // Ce serveur n'envoie pas d'e-mails : la connexion n'en demande aucun.
    const c = await fetch(`${sansCourriel.adresse}/v1/connexion`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } }) });
    const jeton = String(((await c.json()) as { jeton?: string }).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nour' })).corps.id);
    const { p, erreurs } = await page(jeton);
    await p.goto(`${sansCourriel.adresse}/v10/?e=${ent}`);
    await panneau(p).waitFor({ timeout: 20_000 });
    const code = ligne(p, 'Protège ton compte');
    await expect.poll(() => code.getAttribute('class'), { timeout: 15_000 }).not.toContain('fait');
    expect(net(await code.innerText())).toContain('Un code par SMS ou dans une application');
    await code.getByRole('button', { name: 'Choisir mon code', exact: true }).click();
    await p.locator('#cpt-code').waitFor({ timeout: 15_000 });
    expect(await p.locator('#cpt-etat').innerText()).toBe('Mot de passe seul');
    // Le code de l'application activé : de retour à l'accueil, l'étape est faite (c'est le code qui la coche ici, pas
    // l'e-mail, que ce serveur n'envoie pas).
    expect((await api('POST', '/moi/code', jeton, { methode: 'application' })).statut).toBe(200);
    await p.goto(`${sansCourriel.adresse}/v10/?e=${ent}#/dashboard`);
    await p.reload();
    await panneau(p).waitFor({ timeout: 20_000 });
    await expect.poll(() => ligne(p, 'Protège ton compte').getAttribute('class'), { timeout: 15_000 }).toContain('fait');
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  // Parcours du 21/10/2026 : « Ton entreprise » s'ouvrait sans curseur dans la raison sociale (la frappe faisait défiler la
  // page) ; et un matricule déjà celui d'une autre entreprise se disait en bas de l'écran 2,6 secondes, pendant que
  // l'aide sous le champ affirmait « Matricule complet ».
  it('« Ton entreprise » : le curseur dans la raison sociale ; un matricule déjà pris se dit sous le champ, et le message se lit', async () => {
    const a = await personne('premier');
    expect((await api('POST', '/entreprises', a.jeton, { raisonSociale: 'Premier SARL', matriculeFiscal: '1732052M/A/M/000' })).statut).toBe(201);
    const b = await personne('second');
    const { p, erreurs } = await page(b.jeton);
    await p.goto(serveur.adresse);
    await p.getByRole('button', { name: 'Créer mon entreprise', exact: true }).first().click();
    const raison = p.locator('label.field').filter({ hasText: 'Raison sociale' }).locator('input');
    await expect.poll(() => raison.evaluate((n) => n === document.activeElement)).toBe(true);
    await p.keyboard.type('Second SARL');
    expect(await raison.inputValue()).toBe('Second SARL');
    const mf = p.locator('label.field').filter({ hasText: 'Matricule fiscal' });
    const zone = p.locator('.ent-champ').filter({ has: mf });
    await mf.locator('input').fill('1732052M/A/M/000');
    await expect.poll(() => zone.innerText()).toMatch(/Matricule complet/);
    await p.locator('form').getByRole('button', { name: /Créer mon entreprise/ }).click();
    await expect.poll(() => zone.locator('[role=alert]').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/déjà celui d'une autre entreprise/);
    expect(await zone.innerText()).not.toMatch(/Matricule complet/);
    // Le message du bas reste le temps de se lire (2,6 secondes ne suffisaient pas à ses deux lignes).
    await p.waitForTimeout(3500);
    expect(await p.locator('#toast').innerText()).toMatch(/déjà celui d'une autre entreprise/);
    // Retouché, le champ ne se dit plus refusé.
    await mf.locator('input').press('End');
    await mf.locator('input').press('Backspace');
    await expect.poll(() => zone.locator('[role=alert]').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('au téléphone : le panneau ne déborde pas, et chaque bouton se touche du doigt', async () => {
    const { jeton } = await personne('rania');
    const { p, erreurs } = await page(jeton, 390, 844);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Rania Chebbi' })).corps.id);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await panneau(p).waitFor({ timeout: 20_000 });
    await expect.poll(() => panneau(p).locator('.pp-compte').innerText(), { timeout: 15_000 }).toMatch(/^\d sur \d faits$/);
    expect(await p.evaluate(problemes, [true, 390] as [boolean, number])).toEqual([]);
    // Le bouton d'une étape passe sous son texte, aligné sur lui ; le lien vers l'aide garde la marge du panneau.
    const deTravers = await panneau(p).evaluate((el) => {
      const ecarts: string[] = [];
      for (const li of el.querySelectorAll('.pp-list li')) {
        const texte = li.querySelector('.pp-txt')?.getBoundingClientRect();
        const bouton = li.querySelector('.pp-go > :first-child')?.getBoundingClientRect();
        if (texte && bouton && (bouton.top < texte.bottom - 1 || Math.abs(bouton.left - texte.left) > 1)) ecarts.push(li.querySelector('strong')?.textContent ?? '');
      }
      const lien = el.querySelector(':scope > p .help-link')?.getBoundingClientRect();
      if (!lien || lien.left - el.getBoundingClientRect().left < 16) ecarts.push('le lien vers l\'aide');
      return ecarts;
    });
    expect(deTravers).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'premiers-pas-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);
});
