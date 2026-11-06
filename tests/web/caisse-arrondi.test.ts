// 1.294.0 — La caisse jouée comme une épicière (docs/revue-modules.md, « La caisse ») : Nadia ouvre avec 10 DT, vend un
// paquet de café à 4,629 DT payé en espèces, puis compte le tiroir AU CLAVIER dès l'ouverture du comptage (le premier
// chiffre tapé se perdait : rien n'avait le focus). 4,629 DT ne se rendent pas en pièces : elle compte 14,620 DT. Le Z ne
// crie pas « Il manque de l'argent » pour 9 millimes, moins que la plus petite pièce ; un vrai manque, lui, reste en
// alerte. « Tickets du jour » est dans la DA des listes : quatre chiffres dans une carte, la liste et les Z dans la leur.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la caisse : compter au clavier, l\'arrondi de la monnaie, les tickets du jour', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-arrondi-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/[\s\u00a0\u202f]+/g, ' ').trim();

  it('compter le tiroir au clavier tout de suite ; 9 millimes d\'écart ne sont pas un manque ; les tickets dans la DA', async () => {
    const email = `nadia-arrondi-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ben Salah' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 10, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      // 3,890 HT × 1,19 = 4,6291 : 4,629 DT TTC, un prix que les pièces ne rendent pas.
      { collection: 'catalog', cle: 'cafe', rang: 0, revision: null, contenu: { id: 'cafe', label: 'Café moulu 250 g', unit: 'u', unitPrice: { '~n': '3.89' }, vatRate: 19 } },
    ] })).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    await expect.poll(() => p.locator('#cs-fond').count(), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => p.locator('#cs-fond').inputValue()).toBe('10,000');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(() => p.locator('#cs-articles .cs-art').count(), { timeout: 10_000 }).toBe(1);
    await p.locator('#cs-articles .cs-art', { hasText: 'Café moulu' }).click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-valider').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ticket TIC-\d{4}-001 encaissé/);
    await p.locator('#cs-nouvelle').click();

    // Le soir, le comptage s'ouvre depuis le menu ; elle tape tout de suite, sans toucher l'écran : Entrée passe à la
    // coupure suivante. 1 billet de 10, 2 pièces de 2 DT, 1 de 500, 1 de 100 et 1 de 20 millimes : 14,620 DT.
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-fermer').click();
    await expect.poll(() => p.locator('#cs-fermeture [data-coupure]').count(), { timeout: 10_000 }).toBe(12);
    for (const k of ['Enter', 'Enter', '1', 'Enter', 'Enter', '2', 'Enter', 'Enter', '1', 'Enter', 'Enter', '1', 'Enter', 'Enter', '1']) await p.keyboard.press(k);
    await expect.poll(async () => net(await p.locator('#cs-compte-total').innerText())).toBe('14,620 DT');
    await p.locator('#cs-z').click();

    // Le Z : 10 + 4,629 attendus, 14,620 comptés. L'écart est écrit, en clair, sans alarme.
    await expect.poll(async () => net(await p.locator('#modal-root #cs-z-ecart').innerText().catch(() => '')), { timeout: 10_000 })
      .toMatch(/^Écart de 0,009 DT, moins que la plus petite pièce \(10 millimes\) : l'arrondi de la monnaie rendue suffit à l'expliquer\./);
    expect(await p.locator('#modal-root #cs-z-ecart').getAttribute('class')).not.toContain('warn-text');
    expect(await p.locator('#modal-root #cs-z-table tr.warn-text').count()).toBe(0);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-arrondi-1-z.png') });
    await p.locator('#modal-root #cs-z-ok').click();

    // Une autre caisse du jour, où il manque vraiment un dinar : celle-là reste en alerte.
    expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, jeton, { fond: '5' })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/caisse/fermer`, jeton, { compte: '4' })).statut).toBe(200);

    // « Tickets du jour » : quatre chiffres dans une carte, la liste et les Z dans la leur.
    await p.reload();
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(() => p.locator('.cs-tk #cs-resume.cf-carte.mg-resume > .mg-chiffre').count(), { timeout: 10_000 }).toBe(4);
    expect(net(await p.locator('#cs-ventes .val').innerText())).toBe('4,629 DT');
    expect(await p.locator('.cs-tk .cf-carte #cs-liste [data-tk]').count()).toBe(1);
    await expect.poll(() => p.locator('#cs-z-liste tbody tr').count(), { timeout: 10_000 }).toBe(2);
    const ecarts = await p.locator('#cs-z-liste tbody tr td:last-child').evaluateAll((tds) => tds.map((td) => [(td.textContent ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim(), td.classList.contains('warn-text')]));
    expect(ecarts.sort()).toEqual([['− 0,009 DT', false], ['− 1,000 DT', true]]);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-arrondi-2-tickets.png') });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
