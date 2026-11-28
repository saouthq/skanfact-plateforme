// La saisie du Cabinet, à la souris (brique 38 ; docs/cabinet.md). Les écrans sont ceux du Cabinet
// v10 ; chaque geste va au serveur. Ce que le parcours vérifie, écran ET serveur :
//   - le tableau du portefeuille compte les mois des livres du serveur (un mois au brouillard est
//     « à valider ») ;
//   - la grille de saisie : une OD en brouillard, une autre « enregistrée et validée » (son numéro) ;
//     le brouillard se valide depuis son menu ;
//   - une écriture née d'une pièce du client ne se reprend, ne se supprime ni ne se contre-passe ;
//   - une écriture saisie se contre-passe depuis le livre-journal ;
//   - le lettrage automatique pose la lettre au serveur ;
//   - la balance de l'écran reste celle du serveur (deux chemins, un chiffre).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la saisie du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-saisie-'));
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
  type Ecriture = { id: string; journal: string; piece: string | null; libelle?: string; statut: string; numero: string | null; chaine: number | null;
    origine: { type: string; id: string }; lignes: { compte: string; debit: string; credit: string; tiers?: string | null; lettre: string | null }[] };
  const livres = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures as Ecriture[];
  // Un menu de ligne s'ouvre par son bouton ; une action se choisit par ce qu'elle dit.
  const menu = async (p: Page, cle: string) => { await p.locator(`[data-rowmenu="${cle}"]`).first().click(); return p.getByRole('menuitem'); };

  it('le portefeuille compte les mois du serveur ; la grille saisit, valide ; le livre-journal contre-passe ; le lettrage automatique lettre ; la balance reste celle du serveur', async () => {
    // Un client, un achat du 3 août (au brouillard) ; son cabinet, qui accepte le mandat.
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const envoyer = (collection: string, cle: string, contenu: unknown) =>
      api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    await envoyer('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
    });
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    // Chaque écran s'ouvre comme on rouvre le Cabinet : la page se recharge, le livre se relit au serveur
    // (sans quoi un changement d'adresse après « # » garde le livre déjà lu).
    const aller = async (hash: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${hash}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };

    // Le portefeuille : août a une écriture au brouillard (l'achat) : le dossier est à valider,
    // son dernier mois est août.
    await aller('#/dossiers');
    // (1.169.0, la liste de la maquette) La ligne nomme août (passé sa date, « en retard » ; sinon « à réviser ») ; sa
    // fiche le dit à réviser ou en retard, jamais déposé.
    const ligne = p.locator('#view tr[data-id]', { hasText: 'Menuiserie Ben Salah' }).first();
    await expect.poll(() => ligne.locator('.cd-mo-c').innerText()).toMatch(/août/i);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-saisie-1-portefeuille.png') });
    // (1.183.0) Un clic ouvre le dossier : son année y nomme août à réviser ou en retard, jamais déposé.
    await ligne.locator('td.cl').click();
    await expect.poll(() => p.locator('[data-fd-mois$="-08"]').getAttribute('aria-label')).toMatch(/^août : (à réviser|.*en retard)/);
    await p.goBack();
    await p.locator('#view tr[data-id]').first().waitFor();
    // L'export des écritures dit août « à valider » : un mois qui a encore une écriture au brouillard n'est pas définitif.
    // (La fiche lit les brouillards à part : c'est ici que se voit un mois compté à tort comme définitif.)
    await aller('#/ecritures');
    await p.locator('#e-from').selectOption('2026-08');
    await p.locator('#e-to').selectOption('2026-08');
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Août 2026\s+Menuiserie Ben Salah\s+\S+\s+à valider/i);
    await aller('#/dossiers');

    // La grille de saisie : une OD en brouillard.
    await aller(`#/dossier/${ent}/comptabilite/saisie/2026`);
    // La saisie s'ouvre le curseur dans « Pièce » : on tape sans cliquer (1.87.7).
    await expect.poll(() => p.evaluate(() => document.activeElement?.id), { timeout: 10_000 }).toBe('sa-piece');
    const remplir = async (piece: string, libelle: string, lignes: [string, string, string][]) => {
      await p.locator('#sa-journal').selectOption('OD');
      await p.locator('#sa-date').fill('20/08/2026');
      await p.locator('#sa-piece').fill(piece);
      await p.locator('#sa-libelle').fill(libelle);
      for (const [i, [compte, debit, credit]] of lignes.entries()) {
        if (!(await p.locator(`#sa-lignes tr[data-i="${i}"]`).count())) await p.locator('#sa-ajouter').click();
        const tr = p.locator(`#sa-lignes tr[data-i="${i}"]`);
        await tr.locator('input[data-k="compte"]').fill(compte);
        if (debit) await tr.locator('input[data-k="debit"]').fill(debit);
        if (credit) await tr.locator('input[data-k="credit"]').fill(credit);
      }
    };
    await remplir('OD-7', 'Loyer d\'août', [['6132', '850,500', ''], ['401', '', '850,500']]);
    await p.locator('#sa-ok').click();
    await expect.poll(async () => (await livres(ent, associe)).filter((e) => e.origine.type === 'saisie').length, { timeout: 10_000 }).toBe(1);
    const od7 = (await livres(ent, associe)).find((e) => e.piece === 'OD-7');
    expect(od7).toMatchObject({ statut: 'brouillard', journal: 'OD' });
    expect(od7?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['6132', '850.500', '0.000'], ['401', '0.000', '850.500']]);

    // Une seconde, « enregistrée et validée » : son numéro vient du serveur.
    await remplir('OD-8', 'Honoraires d\'août', [['6226', '300', ''], ['4286', '', '300']]);
    // (1.386.6, issue 11, CABSAISIE-24) Un écart se dit UNE fois sous la grille : la boîte du solde, pas le refus en plus.
    const credit8 = p.locator('#sa-lignes tr[data-i="1"] input[data-k="credit"]');
    await credit8.fill('250');
    await expect.poll(async () => (await p.locator('#sa-solde').innerText()).replace(/\s+/g, ' ')).toMatch(/^Écart 50,000 — débit 300,000 \/ crédit 250,000\. Il manque 50,000 au crédit\.$/);
    expect(await p.locator('#sa-refus').isVisible()).toBe(false);
    expect(await p.locator('#sa-okvalider').getAttribute('title')).toMatch(/≠/);
    await credit8.fill('300');
    await p.locator('#sa-okvalider').click();
    // Les mêmes mots pour le même geste, d'un écran à l'autre : « Écriture validée sous le n° … »
    await expect.poll(() => p.locator('#toast').innerText().catch(() => ''), { timeout: 10_000 }).toMatch(/^Écriture validée sous le n° .+\.$/);
    await expect.poll(async () => (await livres(ent, associe)).find((e) => e.piece === 'OD-8')?.statut, { timeout: 10_000 }).toBe('validee');
    const od8 = (await livres(ent, associe)).find((e) => e.piece === 'OD-8');
    expect(od8?.numero).toMatch(/^OD-2026-\d{6}$/);
    // (audit #30, ROB-6) Sans numéro de pièce, trois clics rapides sur « Enregistrer et valider » : une seule écriture, validée une fois.
    await expect.poll(async () => p.locator('#sa-libelle').inputValue(), { timeout: 10_000 }).toBe('');
    await remplir('', 'Frais double clic', [['627', '12,500', ''], ['532', '', '12,500']]);
    await p.locator('#sa-okvalider').evaluate((b) => { (b as HTMLButtonElement).click(); (b as HTMLButtonElement).click(); (b as HTMLButtonElement).click(); });
    await expect.poll(async () => (await livres(ent, associe)).filter((e) => e.libelle === 'Frais double clic' && e.statut === 'validee').length, { timeout: 10_000 }).toBe(1);
    await p.waitForTimeout(2000);
    expect((await livres(ent, associe)).filter((e) => e.libelle === 'Frais double clic').length).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-saisie-2-grille.png') });

    // L'achat du client, au brouillard : son menu ne propose ni de le reprendre, ni de le supprimer.
    const achat = (await livres(ent, associe)).find((e) => e.origine.type === 'achat');
    const actionsAchat = await (await menu(p, `B:${achat?.id}`)).allInnerTexts();
    expect(actionsAchat.join(' | ')).toContain('Valider cette écriture');
    expect(actionsAchat.join(' | ')).not.toMatch(/Reprendre dans la grille|Supprimer ce brouillard/);
    await p.keyboard.press('Escape');

    // Le brouillard OD-7 se valide depuis son menu.
    await (await menu(p, `B:${od7?.id}`)).filter({ hasText: 'Valider cette écriture' }).click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await livres(ent, associe)).find((e) => e.id === od7?.id)?.statut, { timeout: 10_000 }).toBe('validee');

    // Le livre-journal : OD-8 se contre-passe ; l'achat (validé avec OD-7 ? non : il reste au
    // brouillard) n'offre pas la contre-passation.
    await aller(`#/dossier/${ent}/comptabilite/journal/2026`);
    await (await menu(p, `E:${od8?.id}`)).filter({ hasText: 'Contre-passer cette écriture' }).click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await livres(ent, associe)).find((e) => e.origine.type === 'contre_passation' && e.origine.id === od8?.id)?.statut, { timeout: 10_000 }).toBe('validee');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-saisie-3-journal.png') });

    // Le lettrage automatique : une facture et son règlement du même montant, validés.
    const saisir = async (corps: unknown) => String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, corps)).corps.id);
    const f = await saisir({ date: '2026-08-05', journal: 'VT', piece: 'F-12', libelle: 'Facture F-12', lignes: [{ compte: '411', debit: '1190' }, { compte: '706', credit: '1190' }] });
    const r = await saisir({ date: '2026-08-25', journal: 'BQ', piece: 'F-12', libelle: 'Règlement F-12', lignes: [{ compte: '532', debit: '1190' }, { compte: '411', credit: '1190' }] });
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [f, r] })).statut).toBe(200);
    await aller(`#/dossier/${ent}/comptabilite/lettrage/2026`);
    await p.locator('#lv-auto').click();
    await expect.poll(async () => (await livres(ent, associe)).filter((e) => [f, r].includes(e.id)).flatMap((e) => e.lignes).filter((l) => l.compte === '411').map((l) => l.lettre), { timeout: 10_000 })
      .toEqual(['A', 'A']);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-saisie-4-lettrage.png') });

    // (1.378.9 ; issue 9, CABDECLARER-7) Lettrer à la main : deux pièces cochées se lettrent quand leur somme fait zéro,
    // la barre dit l'écart sinon ; les lettres posées se voient, et une lettre se retire.
    const f13 = await saisir({ date: '2026-08-07', journal: 'VT', piece: 'F-13', libelle: 'Facture F-13', lignes: [{ compte: '411', debit: '500' }, { compte: '706', credit: '500' }] });
    const f14 = await saisir({ date: '2026-08-08', journal: 'VT', piece: 'F-14', libelle: 'Facture F-14', lignes: [{ compte: '411', debit: '800' }, { compte: '706', credit: '800' }] });
    const v14 = await saisir({ date: '2026-08-28', journal: 'BQ', piece: 'VIR-14', libelle: 'Virement reçu', lignes: [{ compte: '532', debit: '800' }, { compte: '411', credit: '800' }] });
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [f13, f14, v14] })).statut).toBe(200);
    const lettres14 = async () => (await livres(ent, associe)).filter((e) => [f14, v14].includes(e.id)).flatMap((e) => e.lignes).filter((l) => l.compte === '411').map((l) => l.lettre || '');
    await aller(`#/dossier/${ent}/comptabilite/lettrage/2026`);
    const barre = p.locator('.lt-barre').first();
    await p.locator(`.lt-coche[data-lt="${f13}"]`).check();
    await p.locator(`.lt-coche[data-lt="${v14}"]`).check();
    await expect.poll(() => barre.locator('.lt-dit').innerText()).toBe('2 pièces cochées : écart de 300,000 — la somme doit faire zéro pour lettrer.');
    expect(await barre.locator('[data-lt-go]').isDisabled()).toBe(true);
    await p.locator(`.lt-coche[data-lt="${f13}"]`).uncheck();
    await p.locator(`.lt-coche[data-lt="${f14}"]`).check();
    await expect.poll(() => barre.locator('.lt-dit').innerText()).toBe('2 pièces cochées : elles se soldent.');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-saisie-4b-lettrage-main.png') });
    await barre.locator('[data-lt-go]').click();
    await expect.poll(async () => { const ls = await lettres14(); return ls.length === 2 && !!ls[0] && ls[0] === ls[1]; }, { timeout: 10_000 }).toBe(true);
    const lettre = (await lettres14())[0];
    await expect.poll(() => p.locator('#toast').innerText()).toBe(`Lettre ${lettre} posée sur 2 pièces.`);
    // F-13 reste ouverte ; F-14 et son virement ne le sont plus.
    await expect.poll(() => p.locator(`.lt-coche[data-lt="${f14}"]`).count()).toBe(0);
    expect(await p.locator(`.lt-coche[data-lt="${f13}"]`).count()).toBe(1);
    // Les lettres posées : A (l'automatique) et celle-ci, avec leurs pièces et leur montant ; celle-ci se retire.
    await p.locator('#lv-lettres summary').click();
    const ligneLettre = p.locator('#lv-lettres tbody tr').filter({ hasText: 'VIR-14' });
    expect((await ligneLettre.innerText()).replace(/\s+/g, ' ')).toMatch(new RegExp(`^${lettre} .*F-14 · VIR-14 800,000 Délettrer$`));
    expect(await p.locator('#lv-lettres tbody tr').count()).toBe(2);
    await ligneLettre.getByRole('button', { name: 'Délettrer' }).click();
    await expect.poll(lettres14, { timeout: 10_000 }).toEqual(['', '']);
    await expect.poll(() => p.locator('#toast').innerText()).toBe(`Lettre ${lettre} retirée : ses pièces sont de nouveau ouvertes.`);
    await expect.poll(() => p.locator(`.lt-coche[data-lt="${f14}"]`).count()).toBe(1);
    // (1.390.11, CABDECLARER-7) Une pièce d'à-nouveaux porte deux clients : l'Hôtel coché avec son virement se lettre, et
    // la lettre ne va que sur SA ligne de l'à-nouveau — celle du Café reste ouverte.
    const an = await saisir({ date: '2026-01-01', journal: 'AN', piece: 'AN-2026', libelle: 'À-nouveaux', lignes: [
      { compte: '411', debit: '300', tiers: 'Hôtel Essai' }, { compte: '411', debit: '200', tiers: 'Café Essai' }, { compte: '110', credit: '500' }] });
    const vh = await saisir({ date: '2026-08-12', journal: 'BQ', piece: 'VIR-H', libelle: 'Virement Hôtel', lignes: [{ compte: '532', debit: '300' }, { compte: '411', credit: '300', tiers: 'Hôtel Essai' }] });
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [an, vh] })).statut).toBe(200);
    await aller(`#/dossier/${ent}/comptabilite/lettrage/2026`);
    const hotel = p.locator('.lt-tiers').filter({ hasText: 'Hôtel Essai' });
    if (!(await hotel.evaluate((d) => (d as HTMLDetailsElement).open))) await hotel.locator('summary').click();
    await hotel.locator(`.lt-coche[data-lt="${an}"]`).check();
    await hotel.locator(`.lt-coche[data-lt="${vh}"]`).check();
    await expect.poll(() => hotel.locator('.lt-dit').innerText()).toBe('2 pièces cochées : elles se soldent.');
    await hotel.locator('[data-lt-go]').click();
    const lettresAN = async () => ((await livres(ent, associe)).find((e) => e.id === an)?.lignes ?? []).map((l) => `${l.tiers ?? ''}:${l.lettre ? 'L' : ''}`);
    await expect.poll(lettresAN, { timeout: 10_000 }).toEqual(['Hôtel Essai:L', 'Café Essai:', ':']);
    // Le lettrage automatique fait de même pour le Café : sa ligne de l'à-nouveau, et elle seule, prend la lettre de son virement.
    const vc = await saisir({ date: '2026-02-10', journal: 'BQ', piece: 'VIR-C', libelle: 'Virement Café', lignes: [{ compte: '532', debit: '200' }, { compte: '411', credit: '200', tiers: 'Café Essai' }] });
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [vc] })).statut).toBe(200);
    await aller(`#/dossier/${ent}/comptabilite/lettrage/2026`);
    await p.locator('#lv-auto').click();
    await expect.poll(lettresAN, { timeout: 10_000 }).toEqual(['Hôtel Essai:L', 'Café Essai:L', ':']);
    const lettreDe = async (id: string, tiers: string) => ((await livres(ent, associe)).find((e) => e.id === id)?.lignes ?? []).find((l) => l.tiers === tiers && l.compte === '411')?.lettre;
    expect(await lettreDe(an, 'Café Essai')).toBe(await lettreDe(vc, 'Café Essai'));
    expect(await lettreDe(an, 'Café Essai')).not.toBe(await lettreDe(an, 'Hôtel Essai'));

    // Deux chemins, un chiffre : la balance de l'écran (les écritures validées, comme la v10) est celle
    // du serveur, compte par compte, une fois août validé (l'achat du client était au brouillard).
    expect((await api('POST', `/entreprises/${ent}/compta/valider`, associe, { jusqua: '2026-08-31' })).statut).toBe(200);
    // (CABSAISIE-11) Juillet est dans la période validée et n'a aucune écriture (toutes celles du test sont en août) : la
    // carte du mois vide le dit avant le geste, et « Une écriture à la main » ouvre la grille au premier jour ouvert.
    await aller(`#/dossier/${ent}/comptabilite/saisie/2026`);
    await p.locator('[data-cp-mois="2026-07"]').click();
    await expect.poll(() => p.locator('#sx-vide-ferme').innerText().then((t) => t.replace(/\s+/g, ' ')).catch(() => '')).toBe('La période est validée jusqu\'au 31/08/2026 : une écriture de juillet ne s\'y date plus. La grille s\'ouvre au 01/09/2026, premier jour ouvert.');
    expect(await p.locator('#sx-vide-main').isDisabled()).toBe(false);
    await p.locator('#sx-vide-main').click();
    await p.locator('#sa-lignes').waitFor({ state: 'visible' });
    expect(await p.locator('#sa-date').inputValue()).toBe('01/09/2026');
    await aller(`#/dossier/${ent}/comptabilite/balance/2026`);
    await p.waitForTimeout(1000);
    const millimes = (t: string) => BigInt(t.replace(/[^0-9,-]/g, '').replace(',', '') || '0');
    const ecranLignes = await p.locator('#view table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText)));
    const vueEcran = ecranLignes.filter((l) => /^[0-9]/.test(l[0] ?? '')).map((l) => `${l[0]} ${millimes(l[2] ?? '')} ${millimes(l[3] ?? '')}`);
    const bal = (await api('GET', `/entreprises/${ent}/compta/balance?du=2026-01-01&au=2026-12-31`, associe)).corps as { comptes: { compte: string; debit: string; credit: string }[] };
    expect(vueEcran).toEqual(bal.comptes.map((c) => `${c.compte} ${BigInt(c.debit.replace('.', ''))} ${BigInt(c.credit.replace('.', ''))}`));
    expect(vueEcran.length).toBeGreaterThan(6);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
