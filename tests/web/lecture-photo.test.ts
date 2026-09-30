// La lecture d'une facture d'achat en photo, à la souris (brique 84 ; 14 § 2.3 ; docs/achats.md), avec le VRAI
// moteur du serveur. Nadia a reçu la facture de la Quincaillerie Ben Salem ; elle la photographie (la photo
// d'essai : penchée, floue, mal éclairée). Ce que le parcours vérifie, écran ET serveur :
//   - « Lire une photo… » paraît sur un achat neuf (le serveur sait lire), et pas sur un achat enregistré ;
//   - la fenêtre de vérification montre ce qui a été lu, SOUS chaque champ la ligne de la pièce où il a été
//     lu, et le total recompté ; rien n'est enregistré avant « Utiliser ces informations » puis
//     « Enregistrer » ;
//   - enregistré, l'achat que le serveur calcule tombe au millime sur le total lu sur la pièce (deux chemins) ;
//   - un fichier qui n'est pas une facture se refuse avec la phrase du serveur, sans proposer de joindre ;
//   - sur un téléphone, la fenêtre tient dans l'écran.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const PHOTO = path.join(RACINE, 'tests/donnees/lecture/quincaillerie-photo.jpg');

describe('la lecture d\'une facture d\'achat en photo, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-lecture-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();

  // Nadia, son atelier (son matricule, celui que la facture porte comme client) et son fournisseur, déjà
  // dans ses fiches avec son matricule.
  async function nadia() {
    const email = `nadia-lecture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
    type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
    const fiche = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
    const ok = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, name: 'Atelier Nadia', matricule: '7654321B/A/M/000' } },
      { collection: 'suppliers', cle: 'quincaillerie', rang: 0, revision: null, contenu: { id: 'quincaillerie', name: 'Quincaillerie Ben Salem', matricule: '1234567A/B/M/000' } },
    ] });
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(200);
    return { jeton, ent };
  }
  async function ouvrir(jeton: string, ent: string, viewport: { width: number; height: number }) {
    const cn = await navigateur.newContext({ viewport, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/new`);
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/achat/i);
    await plusTard(p);
    return { p, erreurs, fermer: () => cn.close() };
  }
  // Choisir un fichier au sélecteur que le bouton ouvre.
  async function lire(p: Page, fichier: string) {
    const bouton = p.locator('#photo');
    await expect.poll(() => bouton.isVisible(), { timeout: 10_000 }).toBe(true);
    const selecteur = p.waitForEvent('filechooser');
    await bouton.click();
    await (await selecteur).setFiles(fichier);
  }

  it('Nadia photographie la facture : la fenêtre montre ce qui a été lu, où, et le total recompté ; enregistré, l\'achat tombe au millime sur la pièce', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, { width: 1440, height: 900 });
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-1-achat-neuf.png') });
    await lire(p, PHOTO);

    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').first().innerText(), { timeout: 30_000 }).toBe('Ce que SkanFact a lu');
    // Le recomptage, dit en tête ; aucun avertissement de la fenêtre (le fournisseur est reconnu, le numéro lu).
    expect(net(await fenetre.locator('.teif-manques').innerText())).toBe('Recompté depuis les montants lus, le total fait 332,222 DT : c\'est celui de la pièce.');
    expect(net(await fenetre.locator('#ocr-warn').innerText())).toBe('');
    // Les champs proposés, et sous chacun, la ligne de la pièce où il a été lu.
    expect(await fenetre.locator('input[name=supplierId]').inputValue()).toBe('quincaillerie');
    expect(await fenetre.locator('input[name=number]').inputValue()).toBe('FV-2026-0412');
    expect(await fenetre.locator('input[name=date]').inputValue()).toBe('2026-10-03');
    expect(await fenetre.locator('input[name=dueDate]').inputValue()).toBe('2026-11-02');
    expect(await fenetre.locator('input[name=fees]').inputValue()).toBe('1.000');
    const lu = async (champ: string) => net(await fenetre.locator(`[name=${champ}]`).locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " field ")][1]').locator('.lu-ici').innerText());
    expect(await lu('number')).toBe('Lu : « 4567A/B/M/000 Facture FV-2026-0412 »');
    expect(await lu('date')).toBe('Lu : « ÉMISE LE À RÉGLER AVANT LE · 03/10/2026 02/11/2026 »');
    expect(await lu('fees')).toBe('Lu : « Timbre fiscal 1,000 »');
    expect(await lu('supplierId')).toBe('Lu : « Quincaillerie Ben Salem · MF 1234567A/B/M/000 FV-2026-0412 »');
    // Les lignes, et le total des lignes face au hors-taxes lu (et où il l'a été).
    const lignes = await fenetre.locator('#orf-lines tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('input, select')].map((x) => (x as HTMLInputElement).value)));
    expect(lignes).toEqual([['Vis inox 6x40 (boîte de 200)', '3', '42.350', '19'], ['Colle à bois 5 kg', '2', '68.900', '19'], ['Livraison', '1', '15.000', '7']]);
    expect(net(await fenetre.locator('#orf-sum').innerText())).toBe('Total des lignes : 279,850 DT HT · total lu sur la pièce : 279,850 DT Lu : « Banque BIAT Total HT 279,850 »');
    // Rien n'est encore enregistré.
    expect((await admin.query('select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = \'purchases\'', [ent])).rows[0].n).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-2-verification.png') });

    // Les pièces jointes ne sont pas encore en ligne : la lecture n'essaie pas d'y ranger la photo (ce serait
    // un message d'erreur rouge juste après une lecture réussie). Chaque message rouge affiché se note.
    await p.evaluate(() => {
      const w = window as unknown as { rouges: string[] };
      w.rouges = [];
      const t = document.getElementById('toast');
      if (t) new MutationObserver(() => { if (t.classList.contains('error')) w.rouges.push(t.textContent ?? ''); }).observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    await fenetre.getByRole('button', { name: 'Utiliser ces informations', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await p.waitForTimeout(300);
    expect(await p.evaluate(() => (window as unknown as { rouges: string[] }).rouges)).toEqual([]);
    await expect.poll(async () => (await p.locator('input[data-k=label]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).join(' | '))
      .toBe('Vis inox 6x40 (boîte de 200) | Colle à bois 5 kg | Livraison');
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-3-achat-prerempli.png') });
    await p.locator('#save').click();

    // Enregistré : l'achat calculé par le serveur tombe au millime sur le total lu sur la pièce.
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/achats`, jeton)).corps.lignes as { numero: string; netAPayer: string }[] | undefined)?.map((l) => [l.numero, l.netAPayer]),
      { timeout: 15_000 }).toEqual([['FV-2026-0412', '332.222']]);
    // Un achat enregistré ne se relit pas par-dessus : le bouton n'y paraît pas.
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 10_000 }).toMatch(/FV-2026-0412/);
    await p.waitForTimeout(500);
    expect(await p.locator('#photo').isVisible()).toBe(false);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-4-enregistre.png') });
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('un fichier qui n\'est pas une facture se refuse avec la phrase du serveur ; sur un téléphone, la fenêtre tient dans l\'écran', async () => {
    const { jeton, ent } = await nadia();
    const faux = path.join(dossier, 'facture.pdf');
    fs.writeFileSync(faux, 'Ceci est une note, pas une facture.');
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, { width: 390, height: 844 });
    await lire(p, faux);
    const refus = p.locator('#modal-root .modal').last();
    await expect.poll(() => refus.locator('h2').first().innerText(), { timeout: 20_000 }).toBe('La lecture de la facture a échoué');
    expect(net(await refus.innerText())).toContain('Le fichier « facture.pdf » n\'est ni une photo (JPEG, PNG, WEBP) ni un PDF : rien n\'a été lu.');
    expect(await refus.getByRole('button', { name: 'Joindre la photo' }).count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-5-refus-telephone.png') });
    await refus.getByRole('button').last().click();

    await lire(p, PHOTO);
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').first().innerText(), { timeout: 30_000 }).toBe('Ce que SkanFact a lu');
    // Rien ne dépasse de l'écran du téléphone.
    // (Ce qui dépasse DANS un cadre qui défile, un tableau de lignes, reste dans l'écran : le cadre défile.)
    const depasse = await p.evaluate(() => {
      const dansUnCadre = (x: Element) => { for (let a = x.parentElement; a; a = a.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= window.innerWidth + 1) return true; return false; };
      return [...document.querySelectorAll('body *')].filter((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.right > window.innerWidth + 1 && getComputedStyle(x).position !== 'fixed' && !dansUnCadre(x); })
        .slice(0, 12).map((x) => `${x.tagName.toLowerCase()}#${x.id}.${String(x.className).slice(0, 40)} ${Math.round(x.getBoundingClientRect().right)}`);
    });
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-6-verification-telephone.png') });
    expect(depasse).toEqual([]);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const cadre = await fenetre.boundingBox();
    expect(cadre && cadre.x >= 0 && cadre.x + cadre.width <= 390).toBe(true);
    // La ligne lue se lit en entier, même sur un téléphone (elle passe à la ligne, jamais coupée).
    const indication = fenetre.locator('.lu-ici').first();
    expect(await indication.evaluate((x) => x.scrollWidth <= x.clientWidth + 1)).toBe(true);
    expect(net(await indication.innerText())).toBe('Lu : « Quincaillerie Ben Salem · MF 1234567A/B/M/000 FV-2026-0412 »');
    // Au doigt, la fenêtre se parcourt jusqu'à son bouton, et l'achat se pré-remplit.
    await fenetre.getByRole('button', { name: 'Utiliser ces informations', exact: true }).click();
    await expect.poll(async () => (await p.locator('input[data-k=label]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).join(' | '))
      .toBe('Vis inox 6x40 (boîte de 200) | Colle à bois 5 kg | Livraison');
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-7-achat-telephone.png') });
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);
});
