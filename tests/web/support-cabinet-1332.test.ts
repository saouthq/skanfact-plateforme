// Le support du Cabinet, à la souris (1.332.0 ; plateforme/support.js ; modules/socle/pont/cabinet.js ; serveur/support ;
// 0206). Joué par Leïla, associée d'un cabinet : « Signaler un problème… » montrait un rapport de l'application de bureau
// et n'envoyait rien, et la recherche de l'Aide exigeait chaque mot tapé. Ce que le parcours vérifie :
//   - l'Aide du Cabinet a l'en-tête des autres pages (Tableau de bord › Aide) et les gestes du support ;
//   - une question tapée telle qu'on la pose trouve son article (la recherche de l'entreprise) ;
//   - rien trouvé : la question part au support telle qu'elle a été tapée, le curseur au bout ; elle arrive sur sa page ;
//   - l'équipe répond depuis la console, qui dit « cabinet » ; le bandeau et la pastille de l'Aide l'annoncent ; lue, tout
//     s'éteint ;
//   - les Réglages disent le support en ligne, et « Proposer une amélioration » part avec ses deux questions.

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

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('le support du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-support-cab-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-support-cab-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jS = '', jClient = '', cab = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // La console de Karim, du support, sur une adresse ; lue quand sa grille est là.
  const consoleSur = async (hash: string, largeur = 1440, hauteur = 900, theme?: 'clair' | 'sombre', factice = false, jeton = jS) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jeton, theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${factice ? '?langue=factice' : ''}${hash}`);
    await expect.poll(() => p.locator(hash.includes('vue=doc') ? '.c-sd' : hash.includes('vue=evolutions') ? '.c-ev' : '.c-sp-grille').count(), { timeout: 20_000 }).toBe(1);
    if (hash.includes('demande=') && !/vue=(doc|evolutions)/.test(hash)) await expect.poll(() => p.locator('.c-sp-messages').count(), { timeout: 20_000 }).toBe(1);
    return p;
  };
  // Une personne qui a posé son code (le Cabinet l'exige), comme l'équipe du Cabinet la crée (cabinet-equipe.test.ts).
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  // Le Cabinet de Leïla, sur une page.
  const cabinet = async (hash: string, largeur = 1440, hauteur = 900) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jClient);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab}${hash}`);
    await expect.poll(() => p.locator('#view h1').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await p.waitForTimeout(600);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    return p;
  };
  const fermer = (p: Page) => p.context().close();

  beforeAll(async () => {
    await admin.connect();
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    // Karim, du support (un nom à ce fichier : d'autres écrivent dans la même base).
    const email = `support-web-karim-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Karim Support', motDePasse: MDP });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', j, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'support', 'essai du support à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    jS = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    // Leïla, associée du cabinet Ennour.
    jClient = await personne('leila');
    cab = String((await api('POST', '/cabinets', jClient, { nom: 'Cabinet Ennour Support' })).corps.id);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('l\'Aide a son en-tête, et une question tapée telle qu\'on la pose trouve son article', async () => {
    const p = await cabinet('#/aide');
    await p.locator('.aide-tete').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('.aide-tete .chemin').innerText())).toBe('Tableau de bord Aide');
    expect(await p.locator('#aide-demandes').innerText()).toBe('Tes demandes au support');
    expect(await p.locator('#aide-support').innerText()).toBe('Écrire au support');
    // Le pied de l'accueil : écrire au support, plus le rapport de bureau rangé dans les Réglages.
    expect(net(await p.locator('#aide-vue').innerText())).not.toContain('Aide et dépannage');
    await p.locator('#aide-q').click();
    await p.keyboard.type('comment lettrer un acompte');
    await expect.poll(() => p.locator('#aide-res .help-art').count(), { timeout: 5_000 }).toBeGreaterThan(0);
    // « lettrer » trouve « lettrage » par sa racine : le mot entier se surligne.
    expect(await p.locator('#aide-res mark').first().innerText()).toMatch(/^lettr/i);
    expect(net(await p.locator('#aide-n').innerText())).toMatch(/article/);
    expect(await p.locator('#aide-q-support').count()).toBe(1);
    // Un article ouvert : son chemin, et le pied qui dit où écrire.
    await p.locator('#aide-res .help-art').first().click();
    await p.locator('.help-body').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('.aide-tete .chemin').innerText())).toMatch(/^Tableau de bord Aide \S/);
    expect(await p.locator('.help-fil').count()).toBe(0);
    expect(net(await p.locator('.help-foot').innerText())).toContain('Écris au support');
    await p.locator('.aide-tete .chemin [data-home]').click();
    await p.locator('#aide-vue .help-arts').waitFor({ timeout: 10_000 });
    expect(p.url()).toMatch(/#\/aide$/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 120_000);

  it('rien trouvé : la question part au support telle quelle ; l\'équipe répond, le Cabinet l\'annonce, lue tout s\'éteint', async () => {
    const p = await cabinet('#/aide');
    await p.locator('#aide-q').click();
    await p.keyboard.type('xylophone tablette');
    await p.locator('#aide-res .empty').waitFor({ timeout: 5_000 });
    expect(net(await p.locator('#aide-res .empty').innerText())).toContain('Pose ta question au support');
    await p.locator('#aide-q-support').click();
    const m = p.locator('#modal-root .modal').last();
    await m.locator('#sup-sujet').waitFor({ timeout: 5_000 });
    expect(await m.locator('#sup-sujet').inputValue()).toBe('xylophone tablette');
    await expect.poll(() => p.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 3_000 }).toBe('sup-texte-demande');
    // Ce qui part est dit : la version, et la page où l'on travaillait — pas l'Aide par où l'on passe.
    expect(net(await m.innerText())).toContain('Rien d\'autre : ni client, ni dossier, ni montant de ton cabinet.');
    // Refermer sans rien changer ne demande rien.
    await m.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 3_000 }).toBe(0);
    await p.locator('#aide-q-support').click();
    await p.locator('#modal-root #sup-texte-demande').waitFor({ timeout: 5_000 });
    // Le curseur se pose au bout de la question à l'image suivante : on tape quand il y est (rouge GitHub de la 1.332.0 : la
    // frappe partie avant lui s'écrivait au début, « je xylophone tablettecherche… »).
    await expect.poll(() => p.locator('#modal-root #sup-texte-demande').evaluate((x) => { const t = x as HTMLTextAreaElement; return document.activeElement === t && t.selectionStart === t.value.length && t.value.length > 0; }), { timeout: 5_000 }).toBe(true);
    await p.keyboard.type(' : je cherche où se règle la grille de saisie.');
    await p.locator('#modal-root').getByRole('button', { name: 'Envoyer au support', exact: true }).click();
    await expect.poll(() => p.url(), { timeout: 10_000 }).toMatch(/#\/support\/[0-9a-f-]{36}$/);
    const id = decodeURIComponent(p.url().split('#/support/')[1] ?? '');
    await p.locator('.sup-page').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('.sup-page .chemin').innerText())).toBe('Tableau de bord Aide Tes demandes au support');
    await expect.poll(async () => net(await p.locator('.sup-page').innerText()), { timeout: 10_000 }).toContain('xylophone tablette : je cherche où se règle la grille de saisie.');
    const lue = (await api('GET', `/cabinets/${cab}/support`, jClient)).corps.demandes as { id: string; sujet: string; messages: { texte: string }[] }[];
    expect(lue.map((d) => [d.id, d.sujet])).toEqual([[id, 'xylophone tablette']]);
    // La page d'où elle part : celle où l'on travaillait (le Cabinet s'est ouvert sur l'Aide : aucune).
    const v = (await api('GET', `/console/support?demande=${id}`, jS)).corps as { demande: { page: string | null; version: string | null } };
    expect(v.demande.page).toBeNull();
    await fermer(p);

    // La console : la demande dit « cabinet », et Karim y répond.
    const c = await consoleSur(`#/support?demande=${id}`);
    // La ligne de la demande choisie : le nom du cabinet, et la puce « cabinet ».
    const ticket = c.locator('.c-sp-ticket[aria-pressed="true"]');
    expect(net(await ticket.locator('.c-sp-ticket-haut b').innerText())).toBe('Cabinet Ennour Support');
    expect(net(await ticket.locator('.c-sp-ticket-puces').innerText())).toMatch(/^cabinet /i);
    // La conversation dit d'où elle a été écrite, avec les mots du Cabinet, et le lien mène à sa fiche de cabinet.
    expect(await c.locator(`a[href="#/cabinets/${cab}"]`).count()).toBeGreaterThan(0);
    expect((await api('POST', `/console/support/demandes/${id}/repondre`, jS, { texte: 'Réglages, onglet Comptabilité : la grille de saisie.', article: null })).statut).toBe(201);
    await fermer(c);

    // Au Cabinet : le bandeau sur la page de travail, la pastille de l'Aide ; « Lire la réponse » ouvre la demande, lue.
    const q = await cabinet('#/production');
    await expect.poll(() => q.locator('#view .sup-bandeau').count(), { timeout: 15_000 }).toBe(1);
    expect(net(await q.locator('#view .sup-bandeau').innerText())).toContain('L\'équipe SkanFact a répondu à ta demande');
    expect(await q.locator('#nav-support').isHidden()).toBe(false);
    await q.locator('#view .sup-bandeau a').click();
    await expect.poll(async () => net(await q.locator('.sup-page').innerText()), { timeout: 10_000 }).toContain('Réglages, onglet Comptabilité : la grille de saisie.');
    await expect.poll(async () => ((await api('GET', `/cabinets/${cab}/support/attente`, jClient)).corps.aLire as unknown[]).length, { timeout: 10_000 }).toBe(0);
    await q.goto(`${serveur.adresse}/v10/cabinet/?c=${cab}#/production`);
    await q.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await q.waitForTimeout(1500);
    expect(await q.locator('#view .sup-bandeau').count()).toBe(0);
    expect(await q.locator('#nav-support').isHidden()).toBe(true);
    expect(erreurs).toEqual([]);
    await fermer(q);
  }, 180_000);

  it('les Réglages disent le support en ligne ; une idée part avec ses deux questions et la page où l\'on travaillait', async () => {
    const p = await cabinet('#/echeances');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab}#/reglages`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await expect.poll(async () => {
      if (!await p.locator('#s-idee').isVisible()) await p.locator('#set-tabs button[data-tab="app"]').click({ timeout: 2_000 }).catch(() => {});
      return p.locator('#s-idee').isVisible();
    }, { timeout: 15_000 }).toBe(true);
    expect(await p.locator('#s-support').innerText()).toBe('Écrire au support…');
    expect(net(await p.locator('#pan-support').innerText())).not.toMatch(/journal de l'application|Electron|dites-le/);
    await p.locator('#s-idee').click();
    const m = p.locator('#modal-root .modal').last();
    await m.locator('#sup-quoi').waitFor({ timeout: 5_000 });
    expect(net(await m.innerText())).not.toMatch(/\?\s·\s\?|vous/);
    await m.locator('#sup-quoi').fill('Relancer d\'un geste les clients qui n\'ont pas envoyé leur mois.');
    await m.locator('#sup-auj').fill('J\'ouvre chaque dossier et j\'écris un mail.');
    await m.getByRole('button', { name: 'Envoyer au support', exact: true }).click();
    await expect.poll(() => p.url(), { timeout: 10_000 }).toMatch(/#\/support\/[0-9a-f-]{36}$/);
    const id = decodeURIComponent(p.url().split('#/support/')[1] ?? '');
    const v = (await api('GET', `/console/support?demande=${id}`, jS)).corps as { demande: { page: string | null; messages: { texte: string }[] } };
    // La page où elle travaillait avant d'ouvrir les Réglages : les échéances.
    expect(v.demande.page).toBe('echeances');
    expect(v.demande.messages[0]?.texte).toBe('Ce que j\'aimerais faire :\nRelancer d\'un geste les clients qui n\'ont pas envoyé leur mois.\n\nComment je fais aujourd\'hui :\nJ\'ouvre chaque dossier et j\'écris un mail.');
    await fermer(p);
    // La console dit la page avec les mots du Cabinet : « les échéances », pas le nom de la route.
    const c = await consoleSur(`#/support?demande=${id}`);
    await expect.poll(async () => net(await c.locator('.c-sp-grille').innerText()), { timeout: 10_000 }).toMatch(/[ée]crite depuis les échéances/i);
    expect(erreurs).toEqual([]);
    await fermer(c);
  }, 120_000);
});
