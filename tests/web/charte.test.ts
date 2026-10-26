// La charte des maquettes (1.153.0 ; docs/maquettes/charte.html, lot 2 de docs/maquettes-appliquees.md), posée dans les
// vraies pages : le menu ⋯ nomme la pièce qu'il touche ; le toast est sombre, a sa barre de temps et dure 6 secondes,
// « Annuler » y défait le geste ; un bandeau porte son icône et son texte part juste après elle ; un bouton ordinaire est
// blanc à bordure fine et le principal seul est plein ; un brouillon et une pièce annulée se disent calmes. Le Cabinet
// charge la même feuille.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('la charte des maquettes, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-charte-'));
  beforeAll(async () => {
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
  // La couleur que donne un jeton de la charte, lue dans la page (clair ou sombre selon le thème posé).
  const jeton = (p: Page, nom: string, propriete: 'color' | 'backgroundColor' = 'backgroundColor') => p.evaluate(([n, pr]) => {
    const d = document.createElement('div');
    d.style.setProperty(pr === 'color' ? 'color' : 'background-color', `var(${n})`);
    document.body.appendChild(d);
    const v = getComputedStyle(d)[pr as 'color'];
    d.remove();
    return v;
  }, [nom, propriete]);

  it('le menu ⋯ nomme sa pièce, le toast a sa barre et défait, le bandeau porte son icône, les boutons et les statuts', async () => {
    const email = `ines-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Ines Gharbi', motDePasse: 'Un-bon-mot-de-passe' });
    const cle = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', cle, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', cle, { raisonSociale: 'Atelier Ennour' })).corps.id);
    const cab = String((await api('POST', '/cabinets', cle, { nom: 'Cabinet Gharbi' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, cle);
    const jour = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const plusTard = new Date(Date.now() + 20 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, cle, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel du Lac', email: 'compta@lac.exemple.tn' } },
      { collection: 'documents', cle: 'q1', rang: 0, revision: null, contenu: { id: 'q1', type: 'devis', number: 'DEV-2026-007', date: jour, validUntil: plusTard, clientId: 'c1', subject: 'Échafaudage',
        status: 'envoyé', lines: [{ label: 'Location', description: '', qty: 3, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }], discountRate: 0, applyStamp: false,
        withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0 } },
    ] })).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, cle);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/devis`);
    const ligne = p.locator('#view tbody tr').filter({ hasText: 'DEV-2026-007' });
    await ligne.waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();

    // Le menu ⋯ : son titre dit la pièce et son client, et c'est aussi son nom pour un lecteur d'écran.
    await ligne.locator('.row-menu-btn[aria-haspopup]').click();
    const menu = p.locator('.row-menu');
    await expect.poll(() => menu.locator('.rm-tete').innerText().catch(() => '')).toBe('DEV-2026-007 · Hôtel du Lac');
    expect(await menu.getAttribute('aria-label')).toBe('DEV-2026-007 · Hôtel du Lac');

    // Le toast d'un geste qui se défait : sombre (l'encre de la charte), une barre de 6 s, « Annuler ».
    await menu.getByRole('menuitem', { name: /Le client a refusé/ }).click();
    await p.locator('#modal-root #ok').click();
    const toast = p.locator('#toast.show.avec-bouton');
    await toast.waitFor({ timeout: 10_000 });
    expect(await toast.locator('.toast-txt').innerText()).toBe('DEV-2026-007 marqué refusé');
    expect(await toast.evaluate((t) => getComputedStyle(t).backgroundColor)).toBe(await jeton(p, '--sb-encre'));
    expect(await toast.locator('.temps').evaluate((t) => getComputedStyle(t).animationDuration)).toBe('6s');
    await expect.poll(() => ligne.locator('.badge').innerText()).toMatch(/^refusé$/i);
    await toast.getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => ligne.locator('.badge').innerText()).toMatch(/^envoyé$/i);

    // Un bandeau : l'icône de son ton à gauche (18 px), et un texte seul part juste après elle, pas au bout de la ligne.
    const bandeau = await p.evaluate(() => {
      const d = document.createElement('div');
      d.className = 'banner';
      d.textContent = '3 factures à relancer';
      (document.querySelector('#view') as HTMLElement).prepend(d);
      const av = getComputedStyle(d, '::before');
      const icone = av.content === 'none' ? 'aucune' : av.width;
      const r = document.createRange(); r.selectNodeContents(d);
      const ecart = r.getBoundingClientRect().left - d.getBoundingClientRect().left;
      d.remove();
      return { icone, ecart };
    });
    expect(bandeau.icone).toBe('18px');
    expect(bandeau.ecart).toBeLessThan(60);

    // Les boutons : l'ordinaire blanc à bordure fine, le principal plein.
    const boutons = await p.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = '<button class="btn" id="b1">Aperçu</button><button class="btn btn-primary" id="b2">Envoyer</button>';
      (document.querySelector('#view') as HTMLElement).appendChild(d);
      const s1 = getComputedStyle((d.querySelector('#b1') as HTMLElement)), s2 = getComputedStyle((d.querySelector('#b2') as HTMLElement));
      const r = { fond: s1.backgroundColor, bord: s1.borderTopWidth, principal: s2.backgroundColor, haut: (d.querySelector('#b1') as HTMLElement).getBoundingClientRect().height };
      d.remove();
      return r;
    });
    expect(boutons.fond).toBe(await jeton(p, '--sb-papier'));
    expect(boutons.bord).toBe('1px');
    expect(boutons.principal).toBe(await jeton(p, '--sb-sarcelle'));
    expect(boutons.haut).toBeGreaterThanOrEqual(36);
    expect(erreurs).toEqual([]);

    // Le Cabinet charge la même charte : le même toast, le même bandeau.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab}#/priorites`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    const auCabinet = await p.evaluate(() => {
      const d = document.createElement('div');
      d.className = 'banner info';
      d.textContent = 'À savoir';
      (document.querySelector('#view') as HTMLElement).prepend(d);
      const av = getComputedStyle(d, '::before');
      const r = { icone: av.content === 'none' ? 'aucune' : av.width, toast: getComputedStyle((document.querySelector('#toast') as HTMLElement)).backgroundColor };
      d.remove();
      return r;
    });
    expect(auCabinet.icone).toBe('18px');
    expect(auCabinet.toast).toBe(await jeton(p, '--sb-encre'));
    await cx.close();
  }, 120_000);
});
