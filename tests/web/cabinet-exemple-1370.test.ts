// (1.370.0) Le premier jour d'un comptable qui essaie le Cabinet : il n'a aucun client à ouvrir. Un clic charge un
// dossier d'exemple COMPLET dans son propre cabinet, rempli par les gestes mêmes du Cabinet. Le parcours vérifie,
// écran ET livres :
//   - le premier écran d'un cabinet sans dossier l'offre (« Tes premiers pas ») ; les Réglages aussi ;
//   - une fenêtre dit ce qui se prépare pendant le chargement, puis le dossier s'ouvre, marqué « Dossier d'exemple » ;
//   - deux exercices : celui d'avant complet, déclaré douze mois, inventorié, amorti, CLÔTURÉ ; celui en cours tenu
//     jusqu'au mois dernier, déclaré (déposé, payé) jusqu'à l'avant-dernier ;
//   - il reste au comptable ce qu'on fait un vrai matin : la déclaration du mois dernier, le brouillard du mois en
//     cours, un relevé à rapprocher (l'autre l'est entièrement) ;
//   - la paie de trois salariés, par ses bulletins ; chaque écriture s'équilibre ;
//   - le bandeau ne se pose QUE sur les pages de l'exemple, jamais sur le tableau de bord du cabinet ;
//   - il n'entre pas dans l'abonnement, et se retire d'un geste.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le dossier d\'exemple du Cabinet (1.370.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-exemple-'));
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
  it('un clic charge un dossier d\'exemple complet (deux exercices, la paie, la banque, les déclarations), hors abonnement, qui se retire d\'un geste', async () => {
    const associe = await personne('Sami');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Gharbi' })).corps.id);
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ');
    // Le premier écran d'un cabinet sans dossier : « Tes premiers pas » offrent l'exemple, sans passer par les Réglages.
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
    // Une demi-minute qui se dit : une fenêtre, l'étape en cours.
    await p.locator('#ex-charge').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#ex-charge').innerText())).toContain('Je prépare ton dossier d\'exemple');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-exemple-1-charge.png') });
    await p.locator('#ex-charge').waitFor({ state: 'detached', timeout: 150_000 });
    // Le dossier s'ouvre, marqué.
    await p.locator('#demo-banner').waitFor({ timeout: 30_000 });
    expect(net(await p.locator('#demo-banner').innerText())).toContain('Dossier d\'exemple');
    expect(p.url()).toMatch(/#\/dossier\//);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-exemple-2-dossier.png') });

    // Les livres, lus par le pont (ce que l'écran lit).
    const jourLu = await p.evaluate(() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; });
    const A = Number(jourLu[0]), M = Number(jourLu[1]);
    const lu = await p.evaluate(async ([a]) => {
      const pont = (window as unknown as { cabinet: { state(): Promise<{ dossiers: { id: string; demo?: boolean; name: string; manual?: boolean }[] }>; livre(id: string, an: string): Promise<{ livre: Record<string, unknown> }> } }).cabinet;
      const d = (await pont.state()).dossiers.filter((x) => x.demo);
      const de = async (an: number) => {
        const l = (await pont.livre(String(d[0]?.id), String(an))).livre as { exercice: { clos: boolean }; ecritures: { date: string; statut: string; journal: string; lignes: { compte: string; debit: number; credit: number }[] }[];
          declarations: { periode: string; deposee?: unknown; payee?: unknown }[]; releves: { lignes: { rapprochement: { ecritureId?: string } }[] }[]; immobilisations: unknown[]; inventaires: unknown[]; bulletins: unknown[]; salaries: unknown[] };
        return { clos: l.exercice.clos, n: l.ecritures.length, brouillards: l.ecritures.filter((e) => e.statut === 'brouillard').map((e) => e.date.slice(0, 7)),
          desequilibrees: l.ecritures.filter((e) => Math.abs(e.lignes.reduce((t, x) => t + (Number(x.debit) || 0) - (Number(x.credit) || 0), 0)) > 0.0005).length,
          deposees: l.declarations.filter((x) => x.deposee && x.payee).map((x) => x.periode).sort(), declarations: l.declarations.map((x) => x.periode).sort(),
          releves: l.releves.map((r) => [r.lignes.length, r.lignes.filter((x) => x.rapprochement.ecritureId).length]), immobilisations: l.immobilisations.length, inventaires: l.inventaires.length,
          bulletins: l.bulletins.length, salaries: l.salaries.length, dotation: l.ecritures.some((e) => e.lignes.some((x) => String(x.compte).startsWith('681'))), paie: l.ecritures.filter((e) => e.journal === 'PAIE').length };
      };
      return { dossiers: d.map((x) => [x.name, x.manual]), avant: await de(Number(a) - 1), cours: await de(Number(a)) };
    }, [A]);
    expect(lu.dossiers).toEqual([['Exemple · Pâtisserie El Amal', true]]);
    const mois = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}`;
    // L'exercice d'avant : complet, déclaré douze mois, inventorié, amorti, clôturé ; rien au brouillard.
    expect(lu.avant.clos).toBe(true);
    expect(lu.avant.n).toBeGreaterThan(200);
    expect(lu.avant.brouillards).toEqual([]);
    expect(lu.avant.deposees).toEqual(Array.from({ length: 12 }, (_, i) => mois(A - 1, i + 1)));
    expect([lu.avant.immobilisations, lu.avant.inventaires, lu.avant.dotation]).toEqual([1, 1, true]);
    // L'exercice en cours : ouvert, déclaré jusqu'à l'avant-dernier mois ; le brouillard n'est que du mois en cours.
    expect(lu.cours.clos).toBe(false);
    expect(lu.cours.deposees).toEqual(Array.from({ length: Math.max(0, M - 2) }, (_, i) => mois(A, i + 1)));
    expect(lu.cours.declarations).toEqual(lu.cours.deposees);
    expect(new Set(lu.cours.brouillards)).toEqual(new Set(lu.cours.brouillards.length ? [mois(A, M)] : []));
    expect(lu.avant.desequilibrees + lu.cours.desequilibrees).toBe(0);
    // La paie : trois salariés, un bulletin chacun par mois fini, l'écriture de paie du serveur chaque mois.
    expect(lu.cours.salaries).toBe(3);
    expect(lu.cours.bulletins).toBe(3 * (M - 1));
    expect(lu.cours.paie).toBeGreaterThanOrEqual(M - 1);
    // La banque : un relevé entièrement rapproché, un autre à rapprocher (dès mars).
    if (M >= 3) {
      expect(lu.cours.releves.length).toBe(2);
      expect(lu.cours.releves[0]?.[1]).toBe(lu.cours.releves[0]?.[0]);
      expect(lu.cours.releves[1]?.[1]).toBe(0);
      // Ce qui attend : la déclaration du mois dernier.
      expect(net(await p.locator('#view').innerText())).toContain('Préparer la déclaration');
    }
    // Hors abonnement : le cabinet n'a aucun dossier compté.
    const ab = await api('GET', `/cabinets/${cabinet}/abonnement`, associe);
    expect(JSON.stringify(ab.corps)).not.toContain('Pâtisserie El Amal');

    // (1.376.1) Un trimestre de CNSS payé ne crie pas « Date limite dépassée » : sa ligne dit « Payée » (dès mai, le
    // premier trimestre et son versement d'avril sont au livre).
    if (M >= 5) {
      const fiche = p.url().match(/#\/dossier\/([^/]+)/)?.[1] ?? '';
      await p.evaluate(([h]) => { location.hash = String(h); }, [`#/dossier/${fiche}/comptabilite/paie/${A}`]);
      await p.locator('.pa-so [data-pa-vue="cnss"]').click();
      await p.locator('#pa-trim').selectOption('1');
      await expect.poll(() => p.locator('#pa-cnss-livre').innerText().then(net)).toContain('(le trimestre est payé)');
      const ligne = p.locator('.dc-echeance').first();
      expect(net(await ligne.innerText())).toMatch(/^Payée : le versement est au livre — la date limite était le \d\d\/\d\d\/\d{4}\./);
      expect(await ligne.getAttribute('class')).not.toContain('retard');
    }

    // Le bandeau ne se pose que sur les pages de l'exemple.
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    await p.waitForFunction(() => !location.hash.startsWith('#/dossier/'));
    await p.waitForTimeout(800);
    expect(await p.locator('#demo-banner').count()).toBe(0);
    expect(net(await p.locator('#view').innerText())).toContain('Exemple · Pâtisserie El Amal');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-exemple-3-tableau.png') });

    // Il se retire d'un geste, avec ses livres.
    await p.evaluate(() => { location.hash = '#/reglages'; });
    await p.locator('#set-tabs [data-tab="app"]').click();
    await p.locator('#r-demo-off').click();
    await p.getByRole('button', { name: 'Retirer l\'exemple', exact: true }).last().click();
    await p.locator('#r-demo-on').waitFor({ timeout: 30_000 });
    const reste = await api('GET', `/cabinets/${cabinet}/portefeuille`, associe);
    expect(reste.corps.dossiers).toEqual([]);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
