// Les livres d'un dossier s'ouvrent d'une ligne (1.378.3 ; issue 9, CABDECLARER-6, -9, -10, -16, -31, -33). Un
// comptable qui contrôle part d'un solde et remonte à la pièce : la balance, le grand livre du compte, l'écriture
// entière. Aucun de ces clics ne faisait rien. Ce que le parcours vérifie, à la souris :
//   - une ligne du journal, du grand livre ou de la recherche ouvre l'écriture ENTIÈRE (ses lignes, ses comptes nommés,
//     son total, son état) ;
//   - une ligne de la balance ouvre le grand livre de ce compte ;
//   - le grand livre montre le journal et la lettre, et son export porte le compte choisi, l'ouverture et le solde ;
//   - le FEC porte le tiers d'un collectif nu dans « CompAuxNum » et « CompAuxLib » ;
//   - une recherche sans résultat dans le journal le dit, et se défait d'un geste ;
//   - un export dit le nom de son fichier.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les livres s\'ouvrent d\'une ligne, et leurs exports disent ce que l\'écran montre (1.378.3)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-livres-1378-'));
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


  it('(1.378.3) une ligne ouvre son écriture, un compte de la balance son grand livre ; le grand livre et le FEC exportés portent le compte choisi, le solde et les tiers', async () => {
    const client = await personne('client');
    const associe = await personne('associe');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Jlassi' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    const saisir = async (date: string, journal: string, piece: string, libelle: string, lignes: [string, string, string, string?][]) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal, piece, libelle, lignes: lignes.map(([compte, debit, credit, tiers]) => ({ compte, debit, credit, ...(tiers ? { tiers } : {}) })) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return String(r.corps.id);
    };
    const ids = [
      await saisir('2026-01-01', 'AN', 'AN-1', 'Solde de la banque repris', [['532', '10000,500', ''], ['101', '', '10000,500']]),
      await saisir('2026-03-01', 'AC', 'FA-0901', 'Farine de mars', [['606', '406,980', ''], ['401', '', '406,980', 'Minoterie du Cap Bon']]),
      await saisir('2026-03-02', 'AC', 'LV-77', 'Levures', [['6066', '120', ''], ['401', '', '120', 'Levures du Sahel']]),
      await saisir('2026-03-31', 'OD', 'SAL-3', 'Salaires de mars', [['640', '1250', ''], ['425', '', '1250']]),
      await saisir('2026-03-15', 'BQ', 'AV-3', 'Avance sur salaire', [['421', '200', ''], ['532', '', '200']]),
      await saisir('2026-03-20', 'VT', 'FAC-012', 'Pains pour le café', [['411', '595', '', 'Café Jasmin'], ['706', '', '500'], ['4371', '', '95']]),
    ];
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);

    const erreurs: string[] = [];
    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ').trim();
    const ouvrir = async (onglet: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/${onglet}/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(600);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };

    const fenetre = () => p.locator('#modal-root');
    const fermer = async () => { await fenetre().locator('#ok').click(); await expect.poll(() => fenetre().locator('#ve-lignes').count()).toBe(0); };

    // ── Le journal : une ligne ouvre l'écriture entière ───────────────────────────────────────────
    await ouvrir('journal');
    await p.locator('tr[data-ecr]').filter({ hasText: 'FAC-012' }).first().locator('td').nth(6).click();
    await fenetre().locator('#ve-lignes').waitFor({ timeout: 10_000 });
    expect(net(await fenetre().locator('h2').innerText())).toBe('FAC-012 · 20/03/2026');
    expect(net(await fenetre().locator('#ve-tete').innerText())).toMatch(/^Journal VT \(.+\) — écriture validée, n° \d+\. Pains pour le café$/);
    const lues = (await fenetre().locator('#ve-lignes tbody tr').allInnerTexts()).map(net);
    expect(lues).toHaveLength(3);
    expect(lues[0]).toMatch(/^411 Clients.* Café Jasmin Pains pour le café 595,000$/);
    expect(net(await fenetre().locator('#ve-lignes tfoot').innerText())).toBe('3 lignes 595,000 595,000');
    await p.screenshot({ path: path.join(PHOTOS, 'livres-1378-a-ecriture.png') });
    await fermer();
    // Le bouton « Actions » de la ligne garde son menu : il n'ouvre pas la fenêtre.
    await p.locator('tr[data-ecr]').filter({ hasText: 'FAC-012' }).first().locator('.row-actions button').click();
    await p.waitForTimeout(300);
    expect(await fenetre().locator('#ve-lignes').count()).toBe(0);
    await p.keyboard.press('Escape');

    // Une recherche sans résultat le dit, et se défait d'un geste.
    await p.locator('#lv-q').fill('zzzz');
    await expect.poll(async () => net(await p.locator('#lv-rien').innerText().catch(() => '')), { timeout: 10_000 }).toBe('Rien ne correspond à « zzzz » sur cette période. Tout montrer');
    await p.locator('#lv-q-vider').click();
    await expect.poll(() => p.locator('tr[data-ecr]').count(), { timeout: 10_000 }).toBeGreaterThan(5);
    expect(await p.locator('#lv-q').inputValue()).toBe('');

    // ── La balance : un compte ouvre son grand livre ──────────────────────────────────────────────
    await ouvrir('balance');
    await p.locator('tr[data-gl-compte="401"] td').nth(1).click();
    await expect.poll(() => p.locator('summary.gl-tete').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await p.locator('summary.gl-tete').innerText())).toContain('401 — Fournisseurs d\'exploitation');
    expect(await p.locator('#lv-compte').inputValue()).toBe('401');
    // Le grand livre dit le journal de chaque ligne, et le tiers.
    const gl = (await p.locator('details.gl-compte tbody tr').allInnerTexts()).map(net);
    expect(gl[0]).toMatch(/^01\/03\/2026 AC FA-0901 Minoterie du Cap Bon · Farine de mars 406,980 DT 406,980 C$/);
    // Une ligne du grand livre ouvre la même fenêtre.
    await p.locator('details.gl-compte tbody tr').first().locator('td').nth(3).click();
    await fenetre().locator('#ve-lignes').waitFor({ timeout: 10_000 });
    expect(net(await fenetre().locator('h2').innerText())).toBe('FA-0901 · 01/03/2026');
    await fermer();
    await p.screenshot({ path: path.join(PHOTOS, 'livres-1378-b-grand-livre-401.png'), fullPage: true });

    // L'export du grand livre : le compte choisi seulement, l'ouverture, le solde et son sens ; la bulle dit le fichier.
    const telecharge = async (libelle: string) => {
      // Un seul export sur l'écran : le bouton l'exécute tout de suite. Plusieurs : un menu, et l'entrée se choisit.
      const attente = p.waitForEvent('download', { timeout: 15_000 });
      await p.locator('.filters [data-rowmenu="EXP"]').click();
      await p.getByRole('menuitem', { name: new RegExp(libelle) }).click({ timeout: 2_000 }).catch(() => undefined);
      const d = await attente;
      return { nom: d.suggestedFilename(), texte: fs.readFileSync(await d.path(), 'utf8') };
    };
    const csv = await telecharge('Exporter le grand livre');
    expect(csv.nom).toMatch(/^grand-livre-401-/);
    const rangs = csv.texte.replace(/^\ufeff/, '').trim().split('\r\n');
    expect(rangs[0]).toBe('Compte;Intitulé;Date;Journal;N°;Pièce;Tiers;Libellé;Débit;Crédit;Solde;Sens;Lettrage');
    expect(rangs).toHaveLength(4);
    expect(rangs[1]).toMatch(/^401;Fournisseurs d'exploitation;;;;;;Ouverture;;;0,000;;$/);
    expect(rangs[2]).toMatch(/^401;Fournisseurs d'exploitation;01\/03\/2026;AC;\d+;FA-0901;Minoterie du Cap Bon;Farine de mars;0,000;406,980;406,980;C;$/);
    expect(rangs[3]).toMatch(/;LV-77;Levures du Sahel;Levures;0,000;120,000;526,980;C;$/);
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 5_000 }).toBe(`Fichier enregistré dans tes téléchargements : ${csv.nom}`);
    // ── (CABDECLARER-9) Le même écran en PDF : le compte choisi et ses soldes, rien d'autre ─────────────
    let pdfHtml = '';
    await p.route('**/v1/pdf', async (r) => { pdfHtml = String((r.request().postDataJSON() as { html: string }).html); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pdf: 'JVBERg==', nom: 'grand-livre-401.pdf' }) }); });
    await p.locator('.filters [data-rowmenu="EXP"]').click();
    await p.getByRole('menuitem', { name: 'Exporter en PDF' }).click({ timeout: 5_000 });
    await expect.poll(() => pdfHtml.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(pdfHtml).toContain('FA-0901');
    expect(pdfHtml).toContain('526,980');
    expect(pdfHtml).not.toMatch(/<td[^>]*>606<\/td>/);
    await expect.poll(() => p.locator('#toast').innerText().catch(() => ''), { timeout: 5_000 }).toMatch(/^PDF enregistré : /);
    await p.unroute('**/v1/pdf');

    // ── Le FEC : le tiers d'un collectif nu a ses deux colonnes ───────────────────────────────────
    await ouvrir('journal');
    // (CABDECLARER-9) Le livre-journal exporte ce que l'écran garde : un journal choisi, ses seules pièces.
    await p.locator('#lv-journal').selectOption('AC');
    const lj = await telecharge('Exporter le livre-journal');
    const rangsLj = lj.texte.replace(/^\ufeff/, '').trim().split('\r\n').slice(1).map((x) => x.split(';'));
    expect(rangsLj.length).toBeGreaterThan(0);
    expect([...new Set(rangsLj.map((x) => x[2]))]).toEqual(['AC']);
    await p.locator('#lv-journal').selectOption('');
    const fec = await telecharge('Fichier FEC');
    const lignesFec = fec.texte.trim().split('\r\n').map((x) => x.split('\t'));
    const col = (n: string) => (lignesFec[0] ?? []).indexOf(n);
    const tiersFec = lignesFec.slice(1).filter((x) => /^4[01]1?$/.test(x[col('CompteNum')] ?? '')).map((x) => `${x[col('CompteNum')]}|${x[col('CompAuxNum')]}|${x[col('CompAuxLib')]}`).sort();
    expect(tiersFec).toEqual(['401|401LEVURESDUSAH|Levures du Sahel', '401|401MINOTERIEDUC|Minoterie du Cap Bon', '411|411CAFEJASMIN|Café Jasmin']);

    // ── (CABDECLARER-13) En descendant le livre-journal, son en-tête colle sous la barre des écrans ─────────────
    await ouvrir('journal');
    await p.setViewportSize({ width: 1440, height: 420 });
    await p.locator('#c-livres table.list thead th').first().waitFor({ timeout: 10_000 });
    // Tout en bas de la page (sans animation : le défilement doux serait encore en route à la mesure), l'en-tête du tableau,
    // qui le dépasse encore, doit être juste sous la barre : c'est lui qu'on lit sous la barre, pas une ligne.
    const colle = () => p.evaluate(async () => {
      const v = document.getElementById('view')!, nav = document.querySelector('.c-nav')!, th = document.querySelector('#c-livres table.list thead th') as HTMLElement;
      v.scrollTo({ top: v.scrollHeight, behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      const b = nav.getBoundingClientRect().bottom, r = th.getBoundingClientRect();
      const sous = document.elementFromPoint(r.left + 8, b + 4);
      return { th: !!sous?.closest('thead'), colle: Math.abs(r.top - b) <= 2 };
    });
    await expect.poll(colle, { timeout: 10_000 }).toEqual({ th: true, colle: true });
    await p.setViewportSize({ width: 1440, height: 900 });

    // ── La recherche : un résultat ouvre l'écriture ───────────────────────────────────────────────
    await ouvrir('recherche');
    await p.locator('#re-q').fill('406,980');
    await p.locator('tr[data-ecr]').filter({ hasText: 'FA-0901' }).first().locator('td').nth(4).click({ timeout: 10_000 });
    await fenetre().locator('#ve-lignes').waitFor({ timeout: 10_000 });
    expect((await fenetre().locator('#ve-lignes tbody tr').allInnerTexts()).map(net)).toHaveLength(2);
    await fermer();

    expect(erreurs).toEqual([]);
    await ctx.close();
  }, 180_000);
});
