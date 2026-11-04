// Les registres du socle dans le navigateur (docs/cadrage/17-rangement.md § 3.3 ; lot B0, 04/11/2026 ; lot P1b, le même
// jour). Un fichier absent, refusé par la politique de sécurité de la page ou chargé trop tard ne se verrait pas à
// l'écran tant que rien ne s'en sert ; depuis le lot P1b, le Personnel s'en sert côté entreprise (sa boîte) : ses pages,
// ses gestes de la palette, ses lignes de « À faire » et de « Créer », les points de la Trésorerie et des Déclarations.
// Ce test ouvre les deux pages construites et regarde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const espace = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ');
const VIDES = { 'a-faire': 0, palette: 0, creer: 0, pages: 0, 'parties-des-pages': 0, metiers: 0, imports: 0, 'onglets-compta': 0, 'parametres-cabinet': 0 };

describe('les registres du socle, dans le navigateur', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-registres-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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
  const vue = (p: Page) => p.locator('#view').filter({ hasText: /\S/ }).first();

  it('servis et chargés avant tout autre script sur les deux pages ; l\'entreprise y trouve le Personnel (ses pages, la palette, ses points), le Cabinet rien encore', async () => {
    // Comme un vrai compte : connecté, son code posé (il est exigé de qui tient un cabinet). Un compte pour l'entreprise,
    // un autre pour le cabinet.
    const personne = async (prenom: string) => {
      const email = `${prenom}-registres-${Date.now()}@exemple.tn`;
      await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
      const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
      await api('POST', '/moi/code', j, { methode: 'application' });
      return j;
    };
    const jeton = await personne('nadia'), associe = await personne('karim');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Librairie Nadia' })).corps.id);
    const cab = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Karim' })).corps.id);
    expect(ent).toMatch(/\S{8}/);
    expect(cab).toMatch(/\S{8}/);
    const attendus = {
      entreprise: {
        portes: [],
        points: { 'sorties-prevues': { module: 'tresorerie', remplis: ['personnel'] }, 'declarations-sociales': { module: 'declarations', remplis: ['personnel'] } },
        emplacements: { ...VIDES, 'a-faire': 6, palette: 8, creer: 1, pages: 2 },
      },
      cabinet: { portes: [], points: {}, emplacements: VIDES },
    };
    for (const [qui, page, j] of [['entreprise', `/v10/?e=${ent}#/dashboard`, jeton], ['cabinet', `/v10/cabinet/?c=${cab}#/dossiers`, associe]] as const) {
      const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      await cn.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, j);
      const p = await cn.newPage();
      const erreurs: string[] = [];
      const servis: number[] = [];
      p.on('pageerror', (e) => erreurs.push(e.message));
      p.on('response', (r) => { if (/\/plateforme\/registres\.js/.test(r.url())) servis.push(r.status()); });
      await p.goto(`${serveur.adresse}${page}`);
      await vue(p).waitFor({ timeout: 20_000 }).catch(async (e: unknown) => { await p.screenshot({ path: `${dossier}-echec.png` }); throw new Error(`${page} : ${String(e)} ; ${p.url()}`); });
      expect(servis, page).toEqual([200]);
      const lu = await p.evaluate(() => {
        const w = window as unknown as { Socle?: { etat: () => unknown; EMPLACEMENTS: string[] } };
        return { premier: [...document.scripts].findIndex((s) => /\/plateforme\/registres\.js/.test(s.src)), etat: w.Socle?.etat(), emplacements: w.Socle?.EMPLACEMENTS.length };
      });
      expect(lu.premier, page).toBe(0);
      expect(lu.emplacements, page).toBe(9);
      expect(lu.etat, page).toEqual(attendus[qui]);
      if (qui === 'entreprise') {
        // Les pages du Personnel s'ouvrent par leur adresse, sans que le socle les nomme : la Paie, et la fiche d'un
        // salarié (inconnu ici : elle renvoie à la Paie, au lieu de l'accueil que le routeur donne à une adresse inconnue).
        await p.evaluate(() => { location.hash = '#/paie'; });
        await expect.poll(async () => espace(await p.locator('#view').innerText()), { timeout: 15_000 }).toMatch(/salari/i);
        await p.evaluate(() => { location.hash = '#/salarie/inconnu'; });
        await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/paie');
        // La palette trouve ses gestes (à leur rang) et les onglets de la Paie ; sans salarié, les gestes du mois n'y sont pas.
        // L'adresse change avant que la Paie soit redessinée (un dessin attend la prochaine image, 80 ms au plus) et ce
        // dessin ferme la palette : sur une machine chargée, une palette ouverte entre les deux se refermait sous le test.
        // On la rouvre donc tant qu'elle n'est pas là, et on cherche à chaque tour.
        const chercher = async (q: string) => {
          try {
            if (!(await p.locator('#pal-q').isVisible())) await p.keyboard.press('Control+k');
            await p.locator('#pal-q').fill(q, { timeout: 1_000 });
            return espace(await p.locator('#pal-res').innerText({ timeout: 1_000 }));
          } catch { return ''; }
        };
        await expect.poll(() => chercher('salari'), { timeout: 15_000 }).toContain('Importer mes salariés depuis un tableur');
        await expect.poll(() => chercher('embauche'), { timeout: 15_000 }).toContain('Combien coûte une embauche ?');
        await expect.poll(() => chercher('Paie → Congés'), { timeout: 15_000 }).toContain('Paie → Congés et absences');
        // Une liste lue (la palette dit toujours quelque chose, ne serait-ce que « Rien ne s'appelle… »), puis jugée.
        let sansSalarie = '';
        await expect.poll(async () => (sansSalarie = await chercher('Payer les salaires')), { timeout: 15_000 }).toMatch(/\S/);
        expect(sansSalarie).not.toContain('Payer les salaires du mois');
        await p.keyboard.press('Escape');
        // Les points qu'il remplit : les sorties prévues de la Trésorerie, les déclarations sociales du calendrier.
        const points = await p.evaluate(() => {
          const S = (window as unknown as { Socle: { lire: (x: string) => { sorte?: string; id?: string }[] } }).Socle;
          return { sorties: S.lire('sorties-prevues').map((s) => s.sorte), sociales: S.lire('declarations-sociales').map((d) => d.id) };
        });
        expect(points).toEqual({ sorties: ['salaire', 'salaire-prevu', 'avance'], sociales: ['cnss', 'employeur'] });
      }
      expect(erreurs, page).toEqual([]);
      await cn.close();
    }
  }, 180_000);
});
