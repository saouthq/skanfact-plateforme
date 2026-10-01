// L'instrument de rendu (12 § 4, 14 § 2.6), ouvert dans un vrai navigateur, à la largeur d'un
// téléphone (390) et d'un ordinateur (1 440). Chaque écran est photographié dans dist/photos, pour
// être regardé par un humain (règle du projet).
//
//   - Les écrans de l'ENTRÉE (se connecter, créer son compte, le code, la porte), écrits pour la
//     plateforme : en français et en langue factice (40 % plus longue). Rien ne déborde, rien n'est
//     coupé, tout se touche du doigt (44 points), et chaque phrase vient du catalogue.
//   - Les pages de l'application v10 (son code repris tel quel) : aucune page ne défile de côté sur
//     un téléphone, rien ne sort de l'écran, et les cibles du téléphone font 44 points. Leurs textes
//     sont ceux de la v10, en français : la langue factice ne les concerne pas.
//
// Un instrument qui n'atteint pas l'écran dirait « tout va bien » : chaque écran prouve d'abord qu'il
// est bien celui qu'on croit (son titre), et le compte des écrans vérifiés est exigé.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { rendre, t, type Langue } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const titre = (cle: string, langue: Langue) => { const s = rendre(t(cle), langue); const i = s.search(/\p{L}/u); return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1); };

// Ce que l'instrument cherche dans la page ouverte. `cibles` : les cibles de 44 points ne s'exigent
// qu'au doigt (le téléphone) sur les pages de la v10, dessinées pour la souris sur un ordinateur.
function problemes(cibles: boolean): string[] {
  const pb: string[] = [];
  const W = window.innerWidth;
  if (document.documentElement.scrollWidth > W) pb.push(`la page déborde : ${document.documentElement.scrollWidth} points pour ${W}`);
  // Un élément dans un cadre qui défile de côté, ce cadre étant lui-même dans l'écran (la fonction tourne
  // dans la page : ce qu'elle emploie vit en elle).
  const dansUnCadre = (el: Element) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= W + 1) return true;
    }
    return false;
  };
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  if (cibles) {
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, [role=button]')) {
      if (!visible(el) || el.closest('[hidden], .combo-pop, #info-pop')) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) pb.push(`cible de ${Math.round(r.width)}×${Math.round(r.height)} : ${el.outerHTML.slice(0, 90)}`);
    }
  }
  // Au téléphone, une phrase écrasée dans une colonne trop étroite (un mot par ligne, brique 105 : « Tes premiers
  // pas » à côté de leurs boutons) : un bloc de texte de plus de 60 lettres qui tient dans moins de 140 points.
  if (cibles) {
    for (const el of document.querySelectorAll<HTMLElement>('#view p, #view li, #view .small, #view span')) {
      if (!visible(el) || el.closest('[hidden], .combo-pop, #info-pop, table, .preview, svg')) continue;
      const texte = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const r = el.getBoundingClientRect();
      if (texte.length > 60 && r.width < 140 && getComputedStyle(el).display !== 'inline') pb.push(`texte écrasé en ${Math.round(r.width)} points : « ${texte.slice(0, 50)}… »`);
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const coupe = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis';
    // Un champ de saisie défile sous le doigt : son texte n'est pas coupé.
    if (coupe && cs.textOverflow !== 'ellipsis' && !el.matches('input, textarea, select') && el.scrollWidth > el.clientWidth + 1 && !el.closest('table, .preview, .doc-page')) pb.push(`texte coupé : <${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}> ${(el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '').slice(0, 60)}`);
    const r = el.getBoundingClientRect();
    // Un tableau large défile dans son cadre (telephone.css : les listes, les lignes d'un achat) : ce qui
    // dépasse DANS un cadre qui défile, lui-même dans l'écran, ne sort pas de l'écran.
    if (r.right > W + 1 && cs.position !== 'fixed' && !el.closest('.preview, .doc-page, .combo-pop') && !dansUnCadre(el)) pb.push(`sort de l'écran : <${el.tagName.toLowerCase()}> ${(el.textContent ?? '').slice(0, 40)}`);
  }
  return pb;
}
// En langue factice, chaque texte visible vient du catalogue (⟦…⟧), sauf les données (data-donnee).
function horsCatalogue(): string[] {
  const pb: string[] = [];
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    const texte = (n.textContent ?? '').trim();
    if (!/\p{L}{2,}/u.test(texte) || n.parentElement?.closest('[data-donnee], script, style')) continue;
    if (!texte.includes('⟦')) pb.push(texte.slice(0, 60));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[aria-label]')) {
    if (!(el.getAttribute('aria-label') ?? '').includes('⟦')) pb.push(`aria-label « ${el.getAttribute('aria-label')} »`);
  }
  return pb;
}

describe('l\'instrument de rendu des écrans', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
  let n = 0;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await admin.end();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => (await (await fetch(`${serveur.adresse}/v1${chemin}`, {
    method: methode, headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  })).json()) as Record<string, unknown>;
  // Une personne, connectée par l'API ; `etape` la mène où l'écran doit la trouver.
  type Etape = 'vide' | 'code_requis' | 'prete';
  async function personne(etape: Etape) {
    const email = `rendu-${++n}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Leïla Ben Youssef-Trabelsi', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Essai', type: 'navigateur' } })).jeton);
    if (etape === 'vide') return { jeton, ent: '' };
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    if (etape === 'prete') await api('POST', '/moi/code', jeton, { methode: 'application' });
    return { jeton, ent };
  }

  type Ecran = { nom: string; titre: string; etape: Etape | null; ouvrir?: (p: Page, langue: Langue) => Promise<void> };
  const ENTREE: Ecran[] = [
    { nom: 'connexion', titre: 'ecran.connexion.titre', etape: null },
    { nom: 'inscription', titre: 'ecran.inscription.titre', etape: null, ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.connexion.creer_compte', l) }).click(); } },
    { nom: 'porte', titre: 'ecran.porte.titre', etape: 'vide' },
    { nom: 'porte-entreprise', titre: 'ecran.porte.entreprise_titre', etape: 'vide', ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.porte.demarrer_titre', l), exact: true }).click(); } },
    { nom: 'porte-cabinet', titre: 'ecran.porte.cabinet_titre', etape: 'vide', ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.porte.cabinet_lien', l), exact: true }).click(); } },
    { nom: 'code-requis', titre: 'ecran.code_requis.titre', etape: 'code_requis' },
    { nom: 'code-pose', titre: 'ecran.code_pose.titre', etape: 'code_requis', ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.code_requis.bouton', l) }).click(); } },
  ];

  it('les écrans de l\'entrée, sur un téléphone et un ordinateur, en français et en langue factice : rien ne déborde, rien n\'est coupé, tout se touche du doigt, tout vient du catalogue', async () => {
    const faux: string[] = [];
    let vus = 0;
    for (const e of ENTREE) {
      for (const largeur of [390, 1440]) {
        for (const langue of ['fr', 'factice'] as Langue[]) {
          const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 844 }, deviceScaleFactor: 1, locale: 'fr-FR', isMobile: largeur < 760, hasTouch: largeur < 760 });
          const page = await contexte.newPage();
          const d = e.etape ? await personne(e.etape) : null;
          if (d) await page.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), d.jeton);
          await page.goto(`${serveur.adresse}/${langue === 'factice' ? '?langue=factice' : ''}`);
          if (e.ouvrir) await e.ouvrir(page, langue);
          const nom = `${e.nom}-${largeur}-${langue}`;
          try {
            await page.getByRole('heading', { level: 1, name: titre(e.titre, langue) }).waitFor({ timeout: 10_000 });
          } catch {
            faux.push(`${nom} : l'écran attendu n'est pas là ; on lit « ${(await page.locator('body').innerText()).slice(0, 160).replace(/\s+/g, ' ')} »`);
            await contexte.close();
            continue;
          }
          faux.push(...(await page.evaluate(problemes, largeur < 760)).map((x) => `${nom} : ${x}`));
          if (langue === 'factice') faux.push(...(await page.evaluate(horsCatalogue)).map((x) => `${nom} : hors catalogue : ${x}`));
          await page.screenshot({ path: path.join(PHOTOS, `${nom}.png`), fullPage: true });
          vus++;
          await contexte.close();
        }
      }
    }
    expect(faux).toEqual([]);
    expect(vus).toBe(ENTREE.length * 4);
  }, 400_000);

  // Les pages du quotidien de la v10 (14 § 2.6), sur l'entreprise d'essai, avec une facture émise.
  const PAGES: { nom: string; hash: string; titre: RegExp }[] = [
    { nom: 'accueil', hash: '#/dashboard', titre: /./ },
    { nom: 'factures', hash: '#/factures', titre: /^Factures/ },
    { nom: 'facture-nouvelle', hash: '#/doc/new/facture', titre: /^Nouvelle facture/ },
    { nom: 'clients', hash: '#/clients', titre: /^Clients/ },
    // Photographier une facture d'achat se fait au téléphone (14 § 2.6 ; brique 84).
    { nom: 'achat-nouveau', hash: '#/achat/new', titre: /^Nouvelle facture d'achat/ },
    { nom: 'parametres', hash: '#/parametres', titre: /^Paramètres/ },
    // Le responsable décide d'un accord depuis son téléphone (brique 100).
    { nom: 'accords', hash: '#/accords', titre: /^Demandes d'accord/ },
  ];

  it('les pages du quotidien de la v10, sur un téléphone et un ordinateur : aucune ne défile de côté, rien ne sort de l\'écran, et au doigt tout se touche', async () => {
    const d = await personne('prete');
    const faux: string[] = [];
    let vus = 0;
    for (const largeur of [390, 1440]) {
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 844 }, deviceScaleFactor: 1, locale: 'fr-FR', isMobile: largeur < 760, hasTouch: largeur < 760 });
      await contexte.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), d.jeton);
      const page = await contexte.newPage();
      const erreurs: string[] = [];
      page.on('pageerror', (x) => erreurs.push(x.message));
      await page.goto(`${serveur.adresse}/v10/?e=${d.ent}`);
      await page.locator('#view h1').first().waitFor({ timeout: 15_000 });
      for (const pg2 of PAGES) {
        await page.evaluate((h) => { location.hash = h; }, pg2.hash);
        const nom = `v10-${pg2.nom}-${largeur}`;
        try {
          await page.locator('#view h1').filter({ hasText: pg2.titre }).first().waitFor({ timeout: 10_000 });
        } catch {
          faux.push(`${nom} : la page attendue n'est pas là ; on lit « ${(await page.locator('#view').innerText()).slice(0, 160).replace(/\s+/g, ' ')} »`);
          continue;
        }
        // Les fenêtres de bienvenue se ferment comme une personne le ferait.
        for (let i = 0; i < 3 && await page.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await page.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
        await page.waitForTimeout(300);
        faux.push(...(await page.evaluate(problemes, largeur < 760)).map((x) => `${nom} : ${x}`));
        await page.screenshot({ path: path.join(PHOTOS, `${nom}.png`), fullPage: true });
        vus++;
      }
      faux.push(...erreurs.map((x) => `${largeur} : erreur de la page : ${x}`));
      await contexte.close();
    }
    expect(faux).toEqual([]);
    expect(vus).toBe(PAGES.length * 2);
  }, 400_000);
});
