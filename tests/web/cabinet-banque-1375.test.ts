// (1.375.0) La revue « saisie et banque » (issue 11), à la souris : ce qui faisait de faux montants ou des doubles.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('(1.375.0) la revue « saisie et banque »', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-bq1375-'));
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

  type Ecr = { id: string; piece: string; statut: string; lignes: { compte: string; debit: string; credit: string }[] };
  const ecritures = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures as Ecr[];
  const reglages = async (cabinet: string, jeton: string) => (await api('GET', `/cabinets/${cabinet}/reglages`, jeton)).corps as { contenu: { banques?: Record<string, unknown> }; revision: unknown };

  it('un modèle de banque ne lit pas un fichier aux titres clairs, il se dit et s\'oublie ; la TVA d\'une règle part avec l\'écriture ; une validation refusée garde UN brouillard', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const an = String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date: '2026-01-01', journal: 'BQ', piece: 'AN-1', libelle: 'Solde repris',
      lignes: [{ compte: '532', debit: '10000', credit: '' }, { compte: '101', debit: '', credit: '10000' }] })).corps.id);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [an] })).statut).toBe(200);
    // Un modèle retenu AVANT cette version (sans ses titres) : la date, le libellé, le débit puis le crédit. Et une
    // règle de libellé qui porte une TVA.
    const avant = await reglages(cabinet, associe);
    expect((await api('PUT', `/cabinets/${cabinet}/reglages`, associe, { contenu: { ...avant.contenu, banques: { BIAT: { date: 0, libelle: 1, debit: 2, credit: 3 } },
      libelles: [{ motif: 'ORANGE', compte: '626', tva: { taux: '19', compte: '4366' } }] }, revision: avant.revision ?? null })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (hash: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${hash}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const choisir = async (nom: string, texte: string) => {
      const [f] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.bqi-page #rv-fichier').click()]);
      await f.setFiles({ name: nom, mimeType: 'text/csv', buffer: Buffer.from(texte, 'utf8') });
    };

    // ── Le modèle d'une banque ne s'applique pas à un fichier que ses titres suffisent à lire ───────
    await aller(`#/dossier/${cafe}/comptabilite/banque/2026`);
    // (1.375.2) La barre des onglets reste collée en haut d'un long journal : elle a un fond, on ne lit pas à travers.
    expect(await p.locator('.c-nav').evaluate((n) => [getComputedStyle(n).position, getComputedStyle(n).backgroundColor])).toEqual(['sticky', 'rgb(245, 247, 250)']);
    await p.locator('#bq-import').first().click();
    const imp = p.locator('.bqi-page');
    await imp.locator('[name=banque]').fill('BIAT');
    // Le crédit AVANT le débit : lu d'après le modèle, le virement reçu devenait une sortie (− 440,500).
    const clair = ['Date;Libellé;Crédit;Débit', '03/03/2026;VIR CLIENT DUPONT;500,000;', '05/03/2026;ORANGE FACTURE 0326;;59,500', '06/03/2026;ORANGE MOBILE 0326;;119,000'].join('\r\n');
    await choisir('releve-clair.csv', clair);
    await expect.poll(() => imp.locator('#rv-apercu').innerText()).toMatch(/3 lignes lues · mouvements 321,500/);
    expect(await imp.locator('#rv-par-modele').count()).toBe(0);
    // Un fichier que ses titres ne disent pas : le modèle le lit, l'écran le DIT, et le modèle s'oublie d'un geste.
    await choisir('releve-muet.csv', ['J;Texte;S;E', '03/03/2026;VIR CLIENT DUPONT;;500,000', '05/03/2026;ORANGE FACTURE 0326;59,500;', '06/03/2026;ORANGE MOBILE 0326;119,000;'].join('\r\n'));
    await expect.poll(() => imp.locator('#rv-par-modele').innerText().catch(() => '').then((t) => t.replace(/\s+/g, ' ').trim())).toBe('Colonnes lues d\'après le modèle retenu pour BIAT. Revoir les colonnes Oublier ce modèle');
    expect(await imp.locator('#rv-apercu').innerText()).toMatch(/3 lignes lues · mouvements 321,500/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-1375-modele.png') });
    await imp.locator('#rv-oublier').click();
    await expect.poll(async () => (await reglages(cabinet, associe)).contenu.banques?.BIAT ?? null).toBeNull();
    await imp.locator('#rv-colonnes').waitFor();
    expect(await imp.locator('#ok').isDisabled()).toBe(true);
    // Les colonnes dites à la main : le modèle se range avec les titres de CE fichier.
    for (const [i, v] of [[0, 'date'], [1, 'libelle'], [2, 'debit'], [3, 'credit']] as const) await imp.locator(`[data-col-i="${i}"]`).selectOption(v);
    await imp.locator('#rv-relire').click();
    await expect.poll(async () => (await reglages(cabinet, associe)).contenu.banques?.BIAT).toEqual({ date: 0, libelle: 1, debit: 2, credit: 3, titres: ['j', 'texte', 's', 'e'] });
    // Le fichier clair, rechoisi : toujours lu à ses titres ; il s'importe.
    await choisir('releve-clair.csv', clair);
    await expect.poll(() => imp.locator('#rv-apercu').innerText()).toMatch(/3 lignes lues · mouvements 321,500/);
    expect(await imp.locator('#rv-par-modele').count()).toBe(0);
    await imp.locator('[name=compte]').fill('532');
    await imp.locator('[name=debut]').fill('10000');
    await imp.locator('[name=fin]').fill('10321,5');
    await imp.getByRole('button', { name: 'Importer', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 10_000 }).toMatch(/^Relevé importé : 3 lignes/);

    // ── La règle « ORANGE » porte une TVA : l'écriture proposée part avec ses trois lignes ─────────
    const R = ((await api('GET', `/entreprises/${cafe}/compta/releves?annee=2026`, associe)).corps.releves as { lignes: { id: string; libelle: string }[] }[])[0];
    const orange = R?.lignes.find((l) => l.libelle.startsWith('ORANGE FACTURE'))?.id;
    const mobile = R?.lignes.find((l) => l.libelle.startsWith('ORANGE MOBILE'))?.id;
    await p.locator(`table.bq-t [data-bq-ligne="${orange}"]`).click();
    await expect.poll(() => p.locator('.bq-livre').innerText()).toMatch(/626[\s\S]*4366/);
    await p.locator('#bq-principal').click();
    await expect.poll(async () => (await ecritures(cafe, associe)).filter((e) => e.piece !== 'AN-1').length, { timeout: 10_000 }).toBe(1);
    const ecrite = (await ecritures(cafe, associe)).find((e) => e.piece !== 'AN-1');
    expect(ecrite?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['532', '0.000', '59.500'], ['626', '50.000', '0.000'], ['4366', '9.500', '0.000']]);

    // « Écrire autre chose… » garde le compte proposé : la TVA reste ; un autre compte reprend le montant entier.
    await p.locator(`[data-rowmenu="LIG:${mobile}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Écrire autre chose…' }).click();
    const fenE = p.locator('#modal-root .modal').first();
    await expect.poll(() => fenE.locator('[name=compte]').inputValue()).toBe('626');
    await fenE.getByRole('button', { name: 'Créer le brouillard' }).click();
    await expect.poll(async () => (await ecritures(cafe, associe)).filter((e) => e.piece !== 'AN-1').length, { timeout: 10_000 }).toBe(2);
    const autre = (await ecritures(cafe, associe)).find((e) => e.piece !== 'AN-1' && e.id !== ecrite?.id);
    expect(autre?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['532', '0.000', '119.000'], ['626', '100.000', '0.000'], ['4366', '19.000', '0.000']]);

    // ── Une validation refusée : la pièce est au brouillard UNE fois, la grille se vide ─────────────
    // Deux jours : entre 23 h et minuit UTC, « demain » d'ici est déjà « aujourd'hui » à Tunis, et rien n'est refusé.
    const demain = new Date(Date.now() + 2 * 86_400_000);
    const jj = (n: number) => String(n).padStart(2, '0');
    const fr = `${jj(demain.getDate())}/${jj(demain.getMonth() + 1)}/${demain.getFullYear()}`;
    await aller(`#/dossier/${cafe}/comptabilite/saisie/${demain.getFullYear()}`);
    await expect.poll(() => p.evaluate(() => document.activeElement?.id), { timeout: 10_000 }).toBe('sa-piece');
    await p.locator('#sa-journal').selectOption('OD');
    await p.locator('#sa-date').fill(fr);
    await p.locator('#sa-piece').fill('OD-DEMAIN');
    await p.locator('#sa-libelle').fill('Loyer de demain');
    for (const [i, [compte, debit, credit]] of ([['6132', '100', ''], ['401', '', '100']] as const).entries()) {
      if (!(await p.locator(`#sa-lignes tr[data-i="${i}"]`).count())) await p.locator('#sa-ajouter').click();
      const tr = p.locator(`#sa-lignes tr[data-i="${i}"]`);
      await tr.locator('input[data-k="compte"]').fill(compte);
      if (debit) await tr.locator('input[data-k="debit"]').fill(debit);
      if (credit) await tr.locator('input[data-k="credit"]').fill(credit);
    }
    // ── (CABSAISIE-10) Une date à venir se dit AVANT : « Enregistrer et valider » s'éteint en disant pourquoi, le brouillard reste ──
    await expect.poll(() => p.locator('#sa-okvalider').isDisabled()).toBe(true);
    expect(await p.locator('#sa-okvalider').getAttribute('title')).toMatch(/^Elle est datée du \d\d\/\d\d\/\d{4}\s:\sune écriture ne se valide pas avant sa date/);
    await expect.poll(() => p.locator('#sa-refus').innerText()).toMatch(/^Pour valider\s:\sElle est datée du/);
    expect(await p.locator('#sa-ok').isDisabled()).toBe(false);
    await p.locator('#sa-ok').click();
    await expect.poll(() => p.locator('#sa-piece').inputValue()).toBe('');
    expect((await ecritures(cafe, associe)).filter((e) => e.piece === 'OD-DEMAIN').map((e) => e.statut)).toEqual(['brouillard']);
    // ── (CABSAISIE-8) F4 juste après « Enregistrer » rouvre la pièce qu'on vient de ranger, sans numéro ni pièce ──────
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('sa-piece');
    await p.keyboard.press('F4');
    await expect.poll(() => p.locator('#sa-lignes input[data-k="compte"]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).toEqual(['6132', '401', '']);
    expect(await p.locator('#sa-lignes tr[data-i="0"] input[data-k="debit"]').inputValue()).toBe('100,000');
    expect(await p.locator('#sa-piece').inputValue()).toBe('');
    expect(await p.locator('#sa-libelle').inputValue()).toBe('Loyer de demain');
    expect((await ecritures(cafe, associe)).filter((e) => e.piece === 'OD-DEMAIN').length).toBe(1);
    await p.locator('#sa-vider').click();
    await expect.poll(() => p.locator('#sa-lignes input[data-k="compte"]').first().inputValue()).toBe('');

    // ── (1.382.1, issue 11 constat 10) une date illisible se dit, avec ce qui est tapé ──────────────────────
    await p.locator('#sa-date').fill('32/13');
    await p.locator('#sa-piece').focus();
    await expect.poll(() => p.locator('#sa-refus').innerText()).toMatch(/^«\s32\/13\s» n'est pas une date de \d{4}/);
    expect(await p.locator('#sa-date').getAttribute('aria-invalid')).toBe('true');
    // ── (CABSAISIE-10) Une date hors de l'exercice se dit avant le geste, sur la case Date ─────────────────────────
    await p.locator('#sa-date').fill(`02/01/${demain.getFullYear() + 1}`);
    await p.locator('#sa-piece').focus();
    await expect.poll(() => p.locator('#sa-refus').innerText()).toMatch(new RegExp(`hors de l.exercice ${demain.getFullYear()}`));
    expect(await p.locator('#sa-ok').getAttribute('title')).toMatch(/hors de l.exercice/);
    expect(await p.locator('#sa-date').getAttribute('aria-invalid')).toBe('true');

    // ── (1.385.1, issue 11 constat 23) une case de la grille se voit : un bord, et le fond du panneau (clair et sombre) ──
    for (const sombre of [false, true]) {
      await p.evaluate((s) => document.body.classList.toggle('dark', s), sombre);
      await p.waitForTimeout(600);
      const c = await p.locator('#sa-lignes input[data-k="compte"]').first().evaluate((el) => {
        const cs = getComputedStyle(el), pan = getComputedStyle(el.closest('.panel, .sx-km, #c-livres') ?? document.body);
        const al = Number((cs.borderTopColor.match(/[\d.]+(?=\)$)/) ?? ['1'])[0]);
        return { bord: cs.borderTopWidth, alpha: cs.borderTopColor.startsWith('rgba') ? al : 1, fond: cs.backgroundColor, panneau: pan.backgroundColor };
      });
      expect(Number(c.bord.replace('px', ''))).toBeGreaterThanOrEqual(1);
      expect(c.alpha).toBeGreaterThan(0.15);
      await p.screenshot({ path: path.join(PHOTOS, `cabinet-saisie-grille-${sombre ? 'sombre' : 'clair'}.png`) });
    }
    await p.evaluate(() => document.body.classList.remove('dark'));
    // (1.385.2) Au téléphone : la légende des touches se cache, et chaque case dit ce qu'elle attend.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    expect(await p.locator('#sa-touches').isVisible()).toBe(false);
    expect(await p.locator('#sa-lignes tr').first().locator('td').first().evaluate((td) => getComputedStyle(td, '::before').content)).toBe('"Compte"');
    await p.locator('#sa-lignes').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-saisie-grille-telephone.png') });
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.waitForTimeout(300);

    // ── (1.384.8, issue 11 constat 28) l'exemple d'une case vide penche : il ne se prend pas pour une valeur ──
    expect(await p.evaluate(() => [...document.styleSheets].some((f) => { try { return [...f.cssRules].some((r) => r instanceof CSSStyleRule && /(^|,\s*)input::placeholder/.test(r.selectorText) && r.style.fontStyle === 'italic'); } catch { return false; } }))).toBe(true);
    expect(await p.locator('#sa-piece').evaluate((c) => getComputedStyle(c).fontStyle)).toBe('normal');

    // ── (1.384.3, issue 11 constat 18) un relevé aux dates impossibles : ses lignes sont illisibles, et il se dit ──
    const lu = await p.evaluate(() => {
      const KC = (window as unknown as { SkanCompta: { releveDepuisCsv: (r: string[][]) => { lignes: { date: string }[]; ignorees: { motif: string }[]; motif: string } } }).SkanCompta;
      const tete = ['Date', 'Libellé', 'Montant'];
      const faux = KC.releveDepuisCsv([tete, ['32/13/2026', 'Virement', '100,000'], ['30/02/2026', 'Chèque', '-40,000']]);
      const mele = KC.releveDepuisCsv([tete, ['32/13/2026', 'Virement', '100,000'], ['28/02/2026', 'Chèque', '-40,000']]);
      return { faux: [faux.lignes.length, faux.ignorees.map((i) => i.motif), faux.motif], mele: [mele.lignes.map((l) => l.date), mele.ignorees.length, mele.motif] };
    });
    expect(lu.faux).toEqual([0, ['date illisible (« 32/13/2026 »)', 'date illisible (« 30/02/2026 »)'], 'Ce fichier n\'est pas un relevé : aucune de ses lignes ne porte une date et un montant lisibles.']);
    expect(lu.mele).toEqual([['2026-02-28'], 1, '']);

    // ── (1.382.0, issue 11 constat 5) un compte que ni le dossier ni le plan de référence ne connaît se demande ──
    await p.locator('#sa-date').fill(`01/01/${demain.getFullYear()}`);
    await p.locator('#sa-piece').fill('OD-FAUTE');
    await p.locator('#sa-libelle').fill('Compte mal tapé');
    for (const [i, [compte, debit, credit]] of ([['471471', '10', ''], ['401', '', '10']] as const).entries()) {
      if (!(await p.locator(`#sa-lignes tr[data-i="${i}"]`).count())) await p.locator('#sa-ajouter').click();
      const tr = p.locator(`#sa-lignes tr[data-i="${i}"]`);
      await tr.locator('input[data-k="compte"]').fill(compte);
      if (debit) await tr.locator('input[data-k="debit"]').fill(debit);
      if (credit) await tr.locator('input[data-k="credit"]').fill(credit);
    }
    await p.locator('#sa-ok').click();
    const q = p.locator('#modal-root .modal').last();
    await expect.poll(() => q.innerText().catch(() => ''), { timeout: 10_000 }).toMatch(/Créer le compte 471471 \?[\s\S]*aucun compte voisin ne lui ressemble/);
    expect((await q.innerText()).replace(/\s+/g, ' ')).toMatch(/il entre au plan du dossier sous le nom 471471 « .+ »/);
    expect(await q.innerText()).not.toMatch(/renommer dans le plan de comptes/);
    await q.getByRole('button', { name: 'Corriger' }).click();
    await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value)).toBe('471471');
    expect((await ecritures(cafe, associe)).filter((e) => e.piece === 'OD-FAUTE')).toEqual([]);

    // ── (CABSAISIE-9) Sur une grille vide, « Joindre » refuse en UNE fenêtre, avant toute question, sans rien enregistrer ─
    await p.locator('#sa-vider').click();
    await expect.poll(() => p.locator('#sa-lignes input[data-k="compte"]').first().inputValue()).toBe('');
    let selecteurOuvert = false;
    const surFichier = () => { selecteurOuvert = true; };
    p.on('filechooser', surFichier);
    const avantJoindre = (await ecritures(cafe, associe)).length;
    await p.locator('#sa-joindre').click();
    const rien = p.locator('#modal-root .modal').last();
    await expect.poll(() => rien.locator('h2').innerText().catch(() => '')).toBe('Rien à joindre pour l\'instant');
    expect(await p.locator('#modal-root .modal').count()).toBe(1);
    expect(await rien.innerText()).toMatch(/au moins deux lignes/);
    await rien.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    p.off('filechooser', surFichier);
    expect(selecteurOuvert).toBe(false);
    expect((await ecritures(cafe, associe)).length).toBe(avantJoindre);

    // ── (CABSAISIE-5) Un tiers se cherche par son nom dans la case Compte, et la ligne enregistrée le garde ─────────
    const Y = demain.getFullYear();
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date: `${Y}-01-05`, journal: 'AC', piece: 'MIN-1', libelle: 'Farine de janvier',
      lignes: [{ compte: '606', debit: '200' }, { compte: '401', tiers: 'Minoterie du Cap Bon', credit: '200' }] })).statut).toBe(201);
    await aller(`#/dossier/${cafe}/comptabilite/saisie/${Y}`);
    await p.locator('#sa-date').fill(`01/02/${Y}`);
    await p.locator('#sa-piece').fill('OD-TIERS');
    await p.locator('#sa-libelle').fill('Farine de février');
    const c0 = p.locator('#sa-lignes tr[data-i="0"] input[data-k="compte"]');
    await c0.fill('minot');
    await p.locator('.sugg-pop .sugg-it', { hasText: 'Minoterie du Cap Bon' }).click();
    await expect.poll(() => c0.inputValue()).toBe('401');
    expect(await p.locator('#sa-lignes [data-nom="0"]').innerText()).toMatch(/Minoterie du Cap Bon/);
    await p.locator('#sa-lignes tr[data-i="0"] input[data-k="credit"]').fill('50');
    if (!(await p.locator('#sa-lignes tr[data-i="1"]').count())) await p.locator('#sa-ajouter').click();
    await p.locator('#sa-lignes tr[data-i="1"] input[data-k="compte"]').fill('606');
    await p.locator('#sa-lignes tr[data-i="1"] input[data-k="debit"]').fill('50');
    await p.locator('#sa-ok').click();
    await expect.poll(async () => (((await ecritures(cafe, associe)).find((e) => e.piece === 'OD-TIERS')?.lignes ?? []) as { compte: string; tiers?: string }[]).find((l) => l.compte === '401')?.tiers, { timeout: 10_000 }).toBe('Minoterie du Cap Bon');
    // La grille repart vide (la saisie au kilomètre enchaîne) avant le pas suivant : on n'écrit pas dans une grille qui se redessine.
    await expect.poll(() => p.locator('#sa-piece').inputValue()).toBe('');

    // ── (1.375.1) « Joindre un justificatif… » : le fichier va au classeur du dossier, joint à l'écriture ─────
    await p.locator('#sa-date').fill(`01/01/${demain.getFullYear()}`);
    await p.locator('#sa-piece').fill('OD-JUST');
    await p.locator('#sa-libelle').fill('Loyer de janvier');
    for (const [i, [compte, debit, credit]] of ([['6132', '80', ''], ['401', '', '80']] as const).entries()) {
      if (!(await p.locator(`#sa-lignes tr[data-i="${i}"]`).count())) await p.locator('#sa-ajouter').click();
      const tr = p.locator(`#sa-lignes tr[data-i="${i}"]`);
      await tr.locator('input[data-k="compte"]').fill(compte);
      if (debit) await tr.locator('input[data-k="debit"]').fill(debit);
      if (credit) await tr.locator('input[data-k="credit"]').fill(credit);
    }
    await p.locator('#sa-joindre').click();
    const [fj] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#modal-root .modal').last().getByRole('button', { name: 'Enregistrer et joindre' }).click()]);
    await fj.setFiles({ name: 'quittance-loyer.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8') });
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 15_000 }).toMatch(/^« quittance-loyer\.pdf » est joint à l'écriture : il est au classeur du dossier, en janvier \d{4}\.$/);
    const just = (await ecritures(cafe, associe)).find((e) => e.piece === 'OD-JUST');
    expect(just?.statut).toBe('brouillard');
    const docs = (await api('GET', `/cabinets/${cabinet}/classeur/${cafe}/documents`, associe)).corps.documents as { titre: string; periode: string; rubrique: string; raison: string; jointe?: string }[];
    expect(docs.filter((d) => d.titre === 'quittance-loyer.pdf').map((d) => [d.periode, d.rubrique, d.raison, d.jointe ?? null]))
      .toEqual([[`${demain.getFullYear()}-01`, 'piece', 'jointe', just?.id ?? '?']]);
    await expect.poll(() => p.locator('#sa-joindre').innerText()).toBe('Justificatif joint ✓');

    // ── (1.385.4, issue 11 constat 26) de « Saisir » à « Consulter », les onglets ne bougent pas : la bande « Période »
    //    se range sous eux ─────────────────────────────────────────────────────────────────────────────────────────
    await p.evaluate(() => document.getElementById('view')?.scrollTo(0, 0));
    const hautDesOnglets = () => p.locator('#c-groupes').evaluate((g) => Math.round(g.getBoundingClientRect().top + (document.getElementById('view')?.scrollTop ?? 0)));
    const enSaisir = await hautDesOnglets();
    await p.locator('#c-groupes [data-groupe="consulter"]').click();
    await expect.poll(() => p.locator('.c-barre').isVisible(), { timeout: 10_000 }).toBe(true);
    await p.evaluate(() => document.getElementById('view')?.scrollTo(0, 0));
    expect(Math.abs(await hautDesOnglets() - enSaisir)).toBeLessThanOrEqual(2);
    expect(await p.evaluate(() => { const n = document.querySelector('.c-nav')?.getBoundingClientRect(), b = document.querySelector('.c-barre')?.getBoundingClientRect(); return !!n && !!b && b.top >= n.bottom; })).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-consulter-periode.png') });

    // ── (1.386.1, issue 11 constat 21) un dossier tenu hors SkanFact n'a pas de conversation : une ligne sans rien en
    //    face n'invite plus à « demander » sans geste — elle offre le compte d'attente ─────────────────────────────
    await p.evaluate((e) => { location.hash = `#/dossier/${e}/comptabilite/banque/2026`; }, cafe);
    await p.locator('table.bq-t').first().waitFor({ timeout: 20_000 });
    let sansFace = '', idSansFace = '';
    for (const id of await p.locator('table.bq-t tr[data-groupe="dec"]').evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.bqLigne ?? ''))) {
      await p.locator(`table.bq-t tr[data-bq-ligne="${id}"] td.bq-d`).click();
      const t = (await p.locator('.bq-livre').innerText()).replace(/\s+/g, ' ');
      if (/Rien dans le livre au même montant/.test(t)) { sansFace = t; idSansFace = id; break; }
    }
    expect(sansFace).toMatch(/ou la mettre au compte d'attente \(471\) le temps de demander au client ce que c'est/);
    expect(await p.locator('.bq-livre #bq-attente').innerText()).toBe('Mettre en attente (471)');
    expect(await p.locator('.bq-livre #bq-demander').count()).toBe(0);
    // (CABSAISIE-15) La ligne mise en attente trouve son compte : « Dire ce que c'est… » la reprend dans la grille, le
    // curseur sur le 471 ; enregistrée sur 627, elle perd « · en attente » et la banque reste rapprochée.
    await p.locator('.bq-livre #bq-attente').click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Mettre au 471' }).click();
    type EcrL = Ecr & { date: string; libelle: string };
    let att: EcrL | undefined;
    await expect.poll(async () => { att = (await ecritures(cafe, associe)).find((e) => e.statut === 'brouillard' && e.lignes.some((l) => l.compte.startsWith('471'))) as EcrL | undefined; return att?.libelle ?? ''; }, { timeout: 15_000 }).toMatch(/ · en attente$/);
    if (!att) throw new Error('l\'écriture mise en attente est introuvable');
    const enAtt: EcrL = att;
    await p.evaluate(({ e, d }) => { location.hash = `#/dossier/${e}/comptabilite/saisie/${d.slice(0, 4)}`; }, { e: cafe, d: enAtt.date });
    await p.locator(`[data-cp-mois="${enAtt.date.slice(0, 7)}"]`).click();
    await p.locator(`[data-rowmenu="B:${enAtt.id}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Dire ce que c\'est…' }).click();
    const cpt = p.locator('#sa-lignes input[data-k="compte"]:focus');
    await expect.poll(() => cpt.inputValue().catch(() => ''), { timeout: 10_000 }).toMatch(/^471/);
    await cpt.fill('627');
    await p.locator('#sa-ok').click();
    await expect.poll(async () => ((await ecritures(cafe, associe)).find((e) => e.id === enAtt.id)?.lignes ?? []).some((l) => l.compte === '627'), { timeout: 15_000 }).toBe(true);
    const leve = (await ecritures(cafe, associe)).find((e) => e.id === enAtt.id) as EcrL | undefined;
    expect(leve?.libelle).not.toMatch(/en attente/);
    expect(leve?.lignes.some((l) => l.compte.startsWith('471'))).toBe(false);
    const rel = (await api('GET', `/entreprises/${cafe}/compta/releves?annee=2026`, associe)).corps.releves as { lignes: { id: string; rapprochement?: { ecriture?: string } | null }[] }[];
    expect(rel.flatMap((r) => r.lignes).find((l) => l.id === idSansFace)?.rapprochement?.ecriture).toBe(enAtt.id);

    // ── (1.375.0) Le serveur garde le dernier mot : un poste dont l'horloge avance laisse partir une validation que le serveur
    //    refuse — la pièce est au brouillard UNE fois, la grille se vide ────────────────────────────────────────────
    await p.context().clock.setFixedTime(demain);
    await aller(`#/dossier/${cafe}/comptabilite/saisie/${demain.getFullYear()}`);
    await p.locator('#sa-journal').selectOption('OD');
    await p.locator('#sa-date').fill(fr);
    await p.locator('#sa-piece').fill('OD-DEMAIN-2');
    await p.locator('#sa-libelle').fill('Loyer de demain');
    for (const [i, [compte, debit, credit]] of ([['6132', '100', ''], ['401', '', '100']] as const).entries()) {
      if (!(await p.locator(`#sa-lignes tr[data-i="${i}"]`).count())) await p.locator('#sa-ajouter').click();
      const tr = p.locator(`#sa-lignes tr[data-i="${i}"]`);
      await tr.locator('input[data-k="compte"]').fill(compte);
      if (debit) await tr.locator('input[data-k="debit"]').fill(debit);
      if (credit) await tr.locator('input[data-k="credit"]').fill(credit);
    }
    await expect.poll(() => p.locator('#sa-okvalider').isDisabled()).toBe(false);
    await p.locator('#sa-okvalider').click();
    const fen = p.locator('#modal-root .modal').last();
    await expect.poll(() => fen.innerText().catch(() => ''), { timeout: 10_000 }).toMatch(/Gardée au brouillard, pas validée[\s\S]*enregistrée au brouillard[\s\S]*Elle n'a pas pu être validée/);
    await fen.getByRole('button').last().click();
    await expect.poll(() => p.locator('#sa-piece').inputValue()).toBe('');
    expect((await ecritures(cafe, associe)).filter((e) => e.piece === 'OD-DEMAIN-2').map((e) => e.statut)).toEqual(['brouillard']);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
