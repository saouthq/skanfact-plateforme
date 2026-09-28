// L'instrument de rendu (12 § 4, 14 § 2.6) : chaque écran, ouvert dans un vrai navigateur, à la
// largeur d'un téléphone (390) et d'un ordinateur (1 440), en français et en langue factice (40 %
// plus longue). La construction tombe si une page déborde, si une cible fait moins de 44 points,
// si un texte est coupé, ou si une phrase a échappé au catalogue (elle resterait en français
// ordinaire dans la langue factice). Chaque écran est photographié dans dist/photos, pour être
// regardé par un humain (règle du projet).
//
// Un instrument qui n'atteint pas l'écran dirait « tout va bien » : chaque écran prouve d'abord
// qu'il est bien celui qu'on croit (son titre), et le compte des écrans vérifiés est exigé.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { rendre, t, type Langue } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const titre = (cle: string, langue: Langue) => { const s = rendre(t(cle), langue); const i = s.search(/\p{L}/u); return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1); };

// Ce que l'instrument cherche dans la page ouverte.
function problemes(): string[] {
  const pb: string[] = [];
  const W = window.innerWidth;
  if (document.documentElement.scrollWidth > W) pb.push(`la page déborde : ${document.documentElement.scrollWidth} points pour ${W}`);
  for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=checkbox]), [role=button]')) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.height < 44 || r.width < 44)) pb.push(`cible de ${Math.round(r.width)}×${Math.round(r.height)} : ${el.outerHTML.slice(0, 90)}`);
  }
  for (const el of document.querySelectorAll<HTMLElement>('input[type=checkbox]')) {
    const r = (el.closest('label') ?? el).getBoundingClientRect();
    if (r.height < 44) pb.push(`case de ${Math.round(r.height)} points de haut`);
  }
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const cs = getComputedStyle(el);
    const coupe = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis';
    if (coupe && el.scrollWidth > el.clientWidth + 1) pb.push(`texte coupé : ${(el.textContent ?? '').slice(0, 60)}`);
    const r = el.getBoundingClientRect();
    if (r.width && r.right > W + 1 && cs.position !== 'fixed') pb.push(`sort de l'écran : <${el.tagName.toLowerCase()}> ${(el.textContent ?? '').slice(0, 40)}`);
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
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  // Une personne, connectée par l'API ; `etape` la mène où l'écran doit la trouver.
  async function personne(etape: 'vide' | 'code_requis' | 'liste'): Promise<string> {
    const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => (await (await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    })).json()) as Record<string, unknown>;
    const email = `rendu-${++n}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Leïla Ben Youssef-Trabelsi', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Essai', type: 'navigateur' } })).jeton);
    if (etape !== 'vide') await api('POST', '/entreprises-essai', jeton);
    if (etape === 'liste') await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  }

  const ECRANS: { nom: string; titre: string; ouvrir: (p: Page, langue: Langue) => Promise<void> }[] = [
    { nom: 'connexion', titre: 'ecran.connexion.titre', ouvrir: async () => {} },
    { nom: 'inscription', titre: 'ecran.inscription.titre', ouvrir: async (p, l) => { await p.getByRole('button', { name: rendre(t('ecran.connexion.creer_compte'), l) }).click(); } },
    { nom: 'entreprises-vide', titre: 'ecran.entreprises.titre', ouvrir: async () => {} },
    { nom: 'code-requis', titre: 'ecran.code_requis.titre', ouvrir: async () => {} },
    { nom: 'code-pose', titre: 'ecran.code_pose.titre', ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.code_requis.bouton', l) }).click(); } },
    { nom: 'entreprises-liste', titre: 'ecran.entreprises.titre', ouvrir: async () => {} },
  ];
  const JETONS: Record<string, 'vide' | 'code_requis' | 'liste' | null> = {
    connexion: null, inscription: null, 'entreprises-vide': 'vide', 'code-requis': 'code_requis', 'code-pose': 'code_requis', 'entreprises-liste': 'liste',
  };

  it('chaque écran, sur un téléphone et un ordinateur, en français et en langue factice : rien ne déborde, rien n\'est coupé, tout se touche du doigt, tout vient du catalogue', async () => {
    const faux: string[] = [];
    let vus = 0;
    for (const e of ECRANS) {
      for (const largeur of [390, 1440]) {
        for (const langue of ['fr', 'factice'] as Langue[]) {
          const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 844 }, deviceScaleFactor: 1 });
          const page = await contexte.newPage();
          const etape = JETONS[e.nom];
          if (etape) { const jeton = await personne(etape); await page.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), jeton); }
          await page.goto(`${serveur.adresse}/${langue === 'factice' ? '?langue=factice' : ''}`);
          await e.ouvrir(page, langue);
          // L'écran est bien celui qu'on croit : son titre est là.
          const nom = `${e.nom}-${largeur}-${langue}`;
          try {
            await page.getByRole('heading', { level: 1, name: titre(e.titre, langue) }).waitFor({ timeout: 10_000 });
          } catch {
            faux.push(`${nom} : l'écran attendu n'est pas là ; on lit « ${(await page.locator('body').innerText()).slice(0, 160).replace(/\s+/g, ' ')} »`);
            await contexte.close();
            continue;
          }
          faux.push(...(await page.evaluate(problemes)).map((x) => `${nom} : ${x}`));
          if (langue === 'factice') faux.push(...(await page.evaluate(horsCatalogue)).map((x) => `${nom} : hors catalogue : ${x}`));
          await page.screenshot({ path: path.join(PHOTOS, `${nom}.png`), fullPage: true });
          vus++;
          await contexte.close();
        }
      }
    }
    expect(faux).toEqual([]);
    expect(vus).toBe(ECRANS.length * 4);
  }, 180_000);
});
