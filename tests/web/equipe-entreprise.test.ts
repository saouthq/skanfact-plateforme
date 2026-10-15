// L'équipe de l'entreprise, à la souris (lot équipe, 12/10/2026 ; migration 0079, docs/equipe.md). L'écran est l'onglet
// « L'équipe » des Paramètres (plateforme/equipe.js), et l'entrée de la plateforme pour la personne invitée.
// Ce que le parcours vérifie, écran ET serveur :
//   - la propriétaire invite par l'adresse ; aucun rôle n'est coché d'avance, et sans rôle l'invitation se refuse ;
//   - le lien se montre une fois, avec son message prêt pour WhatsApp et la messagerie ;
//   - la personne ouvre le lien sans compte : l'écran dit qui l'invite et où, son adresse est remplie ; elle crée son
//     compte, vérifie son adresse par le code reçu, et arrive dans l'entreprise avec le rôle donné ;
//   - ses rôles se changent ; retirée, elle n'ouvre plus l'entreprise ; sa propre ligne et celle de la propriétaire
//     n'ont pas de menu ; une invitation qui attend s'annule ;
//   - un membre qui ne gère pas l'équipe ne voit pas l'onglet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { motif, rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const titre = (cle: string, v: Record<string, string | number> = {}) => { const s = rendre(t(cle, v), 'fr'); return s.charAt(0).toUpperCase() + s.slice(1); };
const phrase = (cle: string, v: Record<string, string | number> = {}) => rendre(motif(cle, v), 'fr');
const aplatir = (s: string) => s.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('l\'équipe de l\'entreprise, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-equipe-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } } });
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
  const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // Une personne connectée par l'API, dont l'adresse est déjà vérifiée (comme après son premier code).
  const personne = async (nom: string) => {
    const email = `${nom.toLowerCase()}-${unique()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    let c = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
    if (c.corps.etat === 'code') {
      const code = /(\d{6})$/.exec(partis.filter((m) => m.a === email).at(-1)?.objet ?? '')?.[1] ?? '';
      c = await api('POST', '/connexion/code', undefined, { defi: c.corps.defi, code });
    }
    return { email, jeton: String(c.corps.jeton) };
  };
  const page = async (jeton?: string) => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    if (jeton) await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return p;
  };
  const erreurs: string[] = [];
  const parametres = async (p: Page, ent: string) => {
    // Une même adresse ne recharge rien : la page se recharge alors, pour relire l'équipe.
    const adresse = `${serveur.adresse}/v10/?e=${ent}#/parametres`;
    if (p.url() === adresse) await p.reload(); else await p.goto(adresse);
    await p.locator('#view h1').first().waitFor({ timeout: 30_000 }).catch(async (x: unknown) => {
      await p.screenshot({ path: path.join(PHOTOS, 'equipe-entreprise-echec.png') });
      throw x;
    });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  };

  it('inviter, rejoindre par le lien sans compte, changer les rôles, retirer, annuler une invitation', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie de l\'essai' })).corps.id);
    const equipe = async () => (await api('GET', `/entreprises/${ent}/equipe`, nadia.jeton)).corps as { membres: { id: string; nom: string; roles: string[] }[]; invitations: { email: string }[] };

    const p = await page(nadia.jeton);
    await parametres(p, ent);
    await p.locator('#set-tabs [data-tab="equipe"]').click();
    await p.locator('#eqp-inviter').waitFor({ timeout: 15_000 });
    // Sa propre ligne n'a pas de menu : personne ne change ses propres rôles.
    expect(await p.locator('#eqp-membres [data-rowmenu]').count()).toBe(0);
    expect(aplatir(await p.locator('#eqp-membres').innerText())).toMatch(/Nadia toi .*Propriétaire/);

    // ── Inviter : aucun rôle coché d'avance, et sans rôle l'invitation se refuse ─────────────────────────────────────
    await p.locator('#eqp-inviter').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await fenetre.locator('#eqp-email').waitFor();
    expect(await fenetre.locator('input[name="eqp-role"]:checked').count()).toBe(0);
    expect(await fenetre.locator('input[name="eqp-role"][value="serveur"]').count()).toBe(0);
    const adresse = `yassine-${unique()}@exemple.tn`;
    await fenetre.locator('#eqp-email').fill(`  ${adresse.toUpperCase()} `);
    await fenetre.locator('#eqp-ok').click();
    await expect.poll(() => fenetre.locator('[role=alert]').innerText()).toMatch(/Coche au moins un rôle/);
    await fenetre.locator('input[name="eqp-role"][value="commercial"]').check();
    await fenetre.locator('#eqp-ok').click();
    await p.locator('#eqp-lien').waitFor({ timeout: 15_000 });
    const lien = await p.locator('#eqp-lien').inputValue();
    expect(lien).toMatch(new RegExp(`^${serveur.adresse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\?invitation=`));
    // Ce serveur a un relais : l'invitation est partie par e-mail, avec ce même lien, et la fenêtre le dit (0119, C42).
    expect(await p.locator('#modal-root .modal').last().locator('h2').innerText()).toBe('L\'invitation est partie');
    await expect.poll(() => partis.filter((m) => m.a === adresse).length).toBe(1);
    expect(partis.find((m) => m.a === adresse)?.texte).toContain(`?invitation=${lien.split('?invitation=')[1] ?? '-'}`);
    // Le message est prêt pour WhatsApp et la messagerie : le lien, l'adresse avec laquelle entrer, l'entreprise.
    const whatsapp = decodeURIComponent(String(await p.locator('#eqp-whatsapp').getAttribute('href')));
    expect(whatsapp).toContain(lien);
    expect(whatsapp).toContain(adresse);
    expect(whatsapp).toContain('Boulangerie de l\'essai');
    expect(decodeURIComponent(String(await p.locator('#eqp-mail').getAttribute('href')))).toMatch(new RegExp(`^mailto:${adresse.replace(/[.]/g, '\\.')}\\?subject=`));
    await p.screenshot({ path: path.join(PHOTOS, 'equipe-entreprise-1-lien.png') });
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect.poll(() => p.locator('#eqp-invitations').innerText()).toContain(adresse);
    expect((await equipe()).invitations.map((i) => i.email)).toEqual([adresse]);

    // ── La personne ouvre le lien sans compte : qui l'invite, où, son adresse remplie ; elle entre ────────────────────
    const y = await page();
    await y.goto(lien);
    await y.getByRole('heading', { level: 1, name: titre('ecran.inscription.titre') }).waitFor({ timeout: 15_000 });
    await expect.poll(async () => aplatir(await y.locator('.ent-entete p').innerText()))
      .toBe(aplatir(phrase('ecran.invitation.sous_inscription', { qui: 'Nadia', ou: 'Boulangerie de l\'essai', email: adresse })));
    const champ = (cle: string) => y.locator('label.field').filter({ hasText: titre(cle) }).locator('input');
    expect(await champ('ecran.connexion.email').inputValue()).toBe(adresse);
    await champ('ecran.inscription.nom').fill('Yassine');
    await champ('ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await y.screenshot({ path: path.join(PHOTOS, 'equipe-entreprise-2-arrivee.png') });
    await y.getByRole('button', { name: titre('ecran.inscription.bouton'), exact: true }).click();
    await y.getByRole('heading', { level: 1, name: titre('ecran.courriel.titre_inscription') }).waitFor({ timeout: 15_000 });
    const code = /(\d{6})$/.exec(partis.filter((m) => m.a === adresse).at(-1)?.objet ?? '')?.[1] ?? '';
    await y.locator('label.field').filter({ hasText: titre('ecran.courriel.champ_inscription') }).locator('input').fill(code);
    await y.getByRole('button', { name: titre('ecran.courriel.bouton_inscription'), exact: true }).click();
    await y.waitForURL(new RegExp(`/v10/\\?e=${ent}`), { timeout: 20_000 });
    await expect.poll(async () => (await equipe()).membres.map((m) => [m.nom, m.roles])).toEqual([['Nadia', ['proprietaire']], ['Yassine', ['commercial']]]);
    expect((await equipe()).invitations).toEqual([]);
    // Son accueil, « Ton accès à … », tient dans l'écran : ses onze pages vont à la ligne (vu à sa première connexion,
    // l'accueil défilait de côté).
    await y.locator('#accueil-role .btn').first().waitFor({ timeout: 20_000 });
    expect(await y.evaluate(() => { const v = document.querySelector('#view') as HTMLElement; return v.scrollWidth - v.clientWidth; })).toBeLessThanOrEqual(0);
    await y.screenshot({ path: path.join(PHOTOS, 'equipe-entreprise-3-accueil-vendeur.png') });
    // Un commercial ne gère pas l'équipe : l'onglet ne lui est pas montré.
    await parametres(y, ent);
    expect(await y.locator('#set-tabs [data-tab="equipe"]').count()).toBe(0);
    expect(await y.locator('#set-tabs [data-tab="societe"]').count()).toBe(1);

    // ── Ses rôles se changent (les siens sont cochés), puis il est retiré ────────────────────────────────────────────
    const yassine = String((await equipe()).membres.find((m) => m.nom === 'Yassine')?.id);
    await parametres(p, ent);
    await p.locator('#set-tabs [data-tab="equipe"]').click();
    const menu = async (cle: string, geste: string) => {
      await expect.poll(async () => {
        if (!await p.getByRole('menuitem').filter({ hasText: geste }).count()) await p.locator(`[data-rowmenu="${cle}"]`).first().click({ timeout: 2_000 }).catch(() => {});
        return p.getByRole('menuitem').filter({ hasText: geste }).count();
      }, { timeout: 30_000 }).toBe(1);
      await p.getByRole('menuitem').filter({ hasText: geste }).click();
    };
    await menu(`M:${yassine}`, 'Changer ses rôles');
    expect(await fenetre.locator('input[name="eqp-role"]:checked').evaluateAll((l) => l.map((x) => (x as HTMLInputElement).value))).toEqual(['commercial']);
    await fenetre.locator('input[name="eqp-role"][value="caissier"]').check();
    await fenetre.locator('#eqp-ok').click();
    await expect.poll(async () => (await equipe()).membres.find((m) => m.nom === 'Yassine')?.roles).toEqual(['commercial', 'caissier']);
    await expect.poll(async () => aplatir(await p.locator('#eqp-membres').innerText())).toMatch(/Yassine .*Commercial Caissier/);
    await menu(`M:${yassine}`, 'Retirer de l\'équipe');
    await fenetre.getByRole('button', { name: 'Retirer de l\'équipe', exact: true }).click();
    await expect.poll(async () => (await equipe()).membres.map((m) => m.nom)).toEqual(['Nadia']);
    // Sa session, ouverte en arrivant, n'ouvre plus l'entreprise.
    const jetonYassine = String(await y.evaluate(() => sessionStorage.getItem('skanfact.jeton')));
    expect((await api('GET', `/entreprises/${ent}/equipe`, jetonYassine)).statut).toBe(404);

    // ── Une invitation qui attend s'annule : son lien ne vaut plus ───────────────────────────────────────────────────
    await p.locator('#eqp-inviter').click();
    await fenetre.locator('#eqp-email').fill(`dora-${unique()}@exemple.tn`);
    await fenetre.locator('input[name="eqp-role"][value="lecture"]').check();
    await fenetre.locator('#eqp-ok').click();
    await p.locator('#eqp-lien').waitFor({ timeout: 15_000 });
    const lienDora = await p.locator('#eqp-lien').inputValue();
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    const invitation = String(((await equipe()).invitations as unknown as { id: string }[])[0]?.id);
    await menu(`I:${invitation}`, 'Annuler l\'invitation');
    await expect.poll(async () => (await equipe()).invitations).toEqual([]);
    expect((await api('POST', '/invitations/apercu', undefined, { jeton: new URL(lienDora).searchParams.get('invitation') })).corps).toEqual({ valable: false });
    await p.screenshot({ path: path.join(PHOTOS, 'equipe-entreprise-4-apres.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);

});
