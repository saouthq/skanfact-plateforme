// La liste des clients de la maquette (1.199.0 ; docs/maquettes/clients.html, validée le 28/10/2026), à la souris, au
// clavier et au téléphone, sur quatre clients : l'un doit une facture à échoir et une en retard, l'autre une facture en
// retard et n'a pas d'e-mail, le troisième n'a ni document ni matricule, le dernier doit une facture pas encore échue.
//   - chaque colonne dit ce que la maquette dit : le matricule ou « à renseigner », « pas d'e-mail », le net dû et « dont …
//     en retard », le dernier document ;
//   - les filtres comptent comme la liste (Te doivent, En retard, À compléter, Sans document) et se lisent en puces ;
//   - la recherche lit la ville ; le pied additionne toute la sélection ;
//   - la cloche relance la facture en retard la plus ancienne ; le menu ⋯ range ses gestes (Lui vendre, Son compte, Sa fiche) ;
//   - ↓ puis Entrée ouvre la fiche ; au téléphone, rien ne déborde et « Nouveau client » reste à portée.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('la liste des clients, à la souris, au clavier et au téléphone', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-liste-clients-'));
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
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('les colonnes, les filtres et leurs nombres, la ville, le pied, la relance, le menu, le clavier, le téléphone', async () => {
    const email = `clients-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    // L'entreprise d'essai arrive avec des clients d'exemple sans pièce : ils s'en vont, la liste est celle du test.
    const depart = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; revision: number }[];
    const exemples = depart.filter((o) => o.collection === 'clients');
    if (exemples.length) await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: exemples.map((o) => ({ collection: 'clients', cle: o.cle, rang: null, revision: o.revision, contenu: null })) });
    const clients = [
      { id: 'c-lac', name: 'Hôtel du Lac', contact: 'Karim Jlassi', city: 'Sfax', matricule: '0934561H/A/M/000', phone: '74 225 700', email: 'technique@hotel-lac.tn', withholdingRate: 0 },
      { id: 'c-pins', name: 'École Les Pins', contact: 'Amel Chaabane', city: 'Tunis', matricule: '1532907P/A/M/000', phone: '74 610 288' },
      { id: 'c-olivier', name: 'Huilerie Les Oliviers', contact: 'Nizar Triki', phone: '74 298 650', email: 'technique@huilerie.tn' },
      { id: 'c-mahdia', name: 'Pâtisserie Mahdia', contact: 'Rim Gharbi', city: 'Mahdia', matricule: '1187340M/A/M/000', phone: '73 680 114', email: 'rim@patisserie-mahdia.tn', withholdingRate: 0 },
    ];
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: 20 + i, revision: null, contenu: c })) });
    // Quatre factures émises : 337,385 à l'hôtel (à échoir dans 20 j), 674,770 à l'école (45 j de retard), 1 012,156 à l'hôtel
    // (10 j de retard), 337,385 à la pâtisserie (à échoir dans 30 j : elle doit, sans retard).
    const emises: [string, number, number, string][] = [['f1', 1, 20, 'c-lac'], ['f2', 2, -45, 'c-pins'], ['f3', 3, -10, 'c-lac'], ['f4', 1, 30, 'c-mahdia']];
    const nets = ['337.385', '674.770', '1012.156', '337.385'];
    for (const [i, [id, qty, ech, cl]] of emises.entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id, type: 'facture', number: '', status: 'brouillon', date: jour(0), dueDate: jour(ech), clientId: cl, createdAt: 10 + i,
        subject: `Maintenance ${i + 1}`, lines: [{ label: 'Maintenance', description: '', qty, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT' },
        client: clients.find((c) => c.id === cl), revision: null, rang: i, netAPayer: nets[i] });
      expect(String((e.contenu as Record<string, unknown> | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
    }
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; contenu: Record<string, unknown> }[];
    const numero = (id: string) => String(objets.find((o) => o.collection === 'documents' && o.cle === id)?.contenu.number);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await p.locator('#list-wrap tr[data-cid="c-olivier"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const ligne = (id: string) => p.locator(`#list-wrap tr[data-cid="${id}"]`);
    const cellules = async (id: string) => (await ligne(id).locator('td').evaluateAll((tds) => tds.map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).slice(0, 7);

    // 1. L'en-tête, puis chaque colonne, rangée par nom (sans tri choisi).
    expect(net(await p.locator('#view .lc-tete').innerText())).toBe('Accueil Clients Clients Qui ils sont, ce qu\'ils te doivent, ce que tu leur as vendu Guide-moi Importer… Nouveau client');
    expect(await p.locator('#view .lc-tete .btn-primary').innerText()).toBe('Nouveau client');
    expect(await p.locator('#list-wrap tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.cid))).toEqual(['c-pins', 'c-lac', 'c-olivier', 'c-mahdia']);
    const lac = await cellules('c-lac');
    expect(lac[0]).toBe('HL Hôtel du Lac Karim Jlassi · Sfax');
    expect(lac[1]).toBe('0934561H/A/M/000 sans retenue');
    expect(lac[2]).toBe('74 225 700 technique@hotel-lac.tn');
    expect(lac[3]).toMatch(/^2 2 factures en \d{4}$/);
    expect(lac[4]).toBe('1 134,068');
    expect(lac[5]).toBe('1 349,541 dont 1 012,156 en retard');
    expect(lac[6]).toMatch(new RegExp(`^${numero('f3')} \\d\\d/\\d\\d/\\d{4}$`));
    expect((await cellules('c-pins'))[2]).toBe('74 610 288 pas d\'e-mail');
    expect((await cellules('c-pins'))[5]).toBe('674,770 dont 674,770 en retard');
    expect(await cellules('c-olivier')).toEqual(['HO Huilerie Les Oliviers Nizar Triki', 'à renseigner El Fatoora le demandera', '74 298 650 technique@huilerie.tn', 'aucun', '—', '—', '—']);
    // Le pied additionne toute la sélection.
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toBe('Total de la sélection 4 clients 4 1 984,619 DT 2 361,696 dont 1 686,926 en retard');
    await p.screenshot({ path: path.join(PHOTOS, 'liste-clients-1.png') });

    // 2. Les filtres comptent comme la liste, se lisent en puces, et « Tout effacer » revient.
    expect(await p.locator('#lf-barre .segment button').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual(['Tous', 'Te doivent 3', 'En retard 2', 'À compléter 2', 'Sans document 1']);
    // « En retard » n'est pas « Te doivent » : la pâtisserie doit, sans retard.
    expect((await cellules('c-mahdia'))[5]).toBe('337,385 rien en retard');
    await p.locator('#lf-barre .segment [data-f="retard"]').click();
    expect(await p.locator('#list-wrap tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.cid))).toEqual(['c-pins', 'c-lac']);
    await p.locator('#lf-barre .segment [data-f="doivent"]').click();
    expect(await p.locator('#list-wrap tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.cid))).toEqual(['c-pins', 'c-lac', 'c-mahdia']);
    await p.locator('#lf-barre .segment [data-f="completer"]').click();
    expect(await p.locator('#list-wrap tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.cid))).toEqual(['c-pins', 'c-olivier']);
    expect(net(await p.locator('#lf-barre .f-note').innerText())).toBe('2 sur 4 clients');
    expect(net(await p.locator('#lf-barre .puces-f').innerText())).toBe('À compléter Tout effacer');
    await p.locator('#reset-f').click();
    // La recherche lit la ville ; rien ne correspond : « Créer » le client cherché.
    await p.locator('#q').fill('sfax');
    await expect.poll(() => p.locator('#list-wrap tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.cid))).toEqual(['c-lac']);
    await p.locator('#q').fill('kerkennah');
    await expect.poll(async () => net(await p.locator('#list-wrap .vide-f').innerText().catch(() => ''))).toBe('Aucun client ne correspond à « kerkennah » La recherche lit le nom, le contact, le matricule, l\'e-mail, le téléphone et la ville. Créer « Kerkennah » Tout revoir');
    await p.locator('#lf-tout-revoir').click();
    await expect.poll(() => p.locator('#list-wrap tbody tr').count()).toBe(4);

    // 3. La cloche relance la facture en retard la plus ancienne ; un client sans retard n'en a pas.
    expect(await ligne('c-pins').locator('[data-rel]').getAttribute('title')).toBe(`Relancer ${numero('f2')} · Relance`);
    expect(await ligne('c-lac').locator('[data-rel]').getAttribute('title')).toBe(`Relancer ${numero('f3')} · Rappel`);
    expect(await ligne('c-olivier').locator('[data-rel]').count()).toBe(0);
    expect(await ligne('c-mahdia').locator('[data-rel]').count()).toBe(0);
    // Elle ouvre la relance de cette facture, au niveau dit, sans quitter la liste.
    await ligne('c-pins').locator('[data-rel]').click();
    const relance = p.locator('#modal-root .modal');
    await relance.waitFor({ timeout: 10_000 });
    expect(net(await relance.innerText())).toMatch(/^Relancer École Les Pins E-mail/);
    expect(await relance.locator('textarea').first().inputValue()).toContain(numero('f2'));
    expect(await p.evaluate(() => location.hash)).toBe('#/clients');
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);

    // 4. Le menu ⋯ nomme le client et range ses gestes.
    await ligne('c-pins').locator('[data-rowmenu]').click();
    const menu = p.locator('.row-menu');
    await menu.waitFor();
    expect(net(await menu.innerText())).toBe(`École Les Pins Ouvrir la fiche Documents, paiements, relances, affaires, matériel LUI VENDRE Nouveau devis Pour École Les Pins Nouvelle facture Elle reprend sa fiche SON COMPTE Relancer ${numero('f2')} 45 jours de retard · Relance Relevé de compte… 674,770 DT encore dus SA FICHE Modifier le client Coordonnées, contact, matricule`);
    await p.keyboard.press('Escape');

    // 5. Au clavier : ↓ choisit le premier client, Entrée ouvre sa fiche.
    await p.locator('body').click({ position: { x: 700, y: 860 } });
    await p.keyboard.press('ArrowDown');
    expect(await ligne('c-pins').getAttribute('class')).toContain('kb');
    await p.keyboard.press('Enter');
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/client/c-pins');

    // 6. Au téléphone : rien ne déborde, les puces comptent, « Nouveau client » reste.
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await tel.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await tel.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const t = await tel.newPage();
    t.on('pageerror', (e) => erreurs.push(e.message));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await t.locator('#list-wrap .lc-carte[data-cid="c-olivier"]').waitFor({ timeout: 20_000 });
    await plusTard(t);
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await t.locator('#lc-puces .t-puce').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual(['Te doivent 3', 'En retard 2', 'À compléter 2']);
    expect(await t.locator('#view .lc-tete #new').isVisible()).toBe(true);
    // Chaque client est une carte : ce qui presse, puis ce qu'il doit ; le tableau reste à l'ordinateur.
    expect(await t.locator('#list-wrap table.lc-table').isVisible()).toBe(false);
    expect(net(await t.locator('.lc-carte[data-cid="c-pins"]').innerText())).toBe('ÉP École Les Pins Amel Chaabane · Tunis 674,770 en retard · 45 jours · à compléter doit 674,770 DT');
    expect(net(await t.locator('.lc-carte[data-cid="c-olivier"]').innerText())).toBe('HO Huilerie Les Oliviers Nizar Triki aucun document · à compléter');
    await t.locator('.lc-carte[data-cid="c-lac"]').click();
    await expect.poll(() => t.evaluate(() => location.hash)).toBe('#/client/c-lac');
    await t.goBack();
    await t.locator('#list-wrap .lc-carte[data-cid="c-olivier"]').waitFor({ timeout: 20_000 });
    await t.screenshot({ path: path.join(PHOTOS, 'liste-clients-2-telephone.png') });

    expect(erreurs).toEqual([]);
    await tel.close();
    await cx.close();
  }, 180_000);
});
