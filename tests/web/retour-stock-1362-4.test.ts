// L'avoir et le stock, 1.362.4 (bout en bout 28), joué par une pâtisserie de Tunis : 30 coffrets de chocolats en stock à
// 25 DT, 20 vendus à l'Hôtel Mouradi (900 HT + 171 de TVA + 1 de timbre). Un avoir « Remise accordée » (5 DT par coffret)
// ne remet rien en rayon ; un avoir « Retour de marchandise » de 5 coffrets les remet ; chaque ligne se change ; la fenêtre
// d'émission et l'avoir émis le disent ; un avoir qui rendrait plus que la facture n'a vendu le dit avant. La ligne d'un
// avoir ne parle plus de marge ni de « vendue à perte ». Stock attendu, compté à la main : 30 − 20 + 5 = 15 coffrets, 375 DT.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('l\'avoir qui rend la marchandise, ou pas (1.362.4)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-retour-stock-1362-4-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });


  it('le motif dit si la marchandise revient, chaque ligne se change, et la fenêtre d\'émission le dit', async () => {
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Nour Jaziri', name: 'Pâtisserie Les Délices', city: 'Tunis', paymentTermsDays: 30 };
    const coffret = { id: 'k-cof', label: 'Coffret de chocolats (24 pièces)', unit: '', unitPrice: 45, unitCost: 25, vatRate: 19, tracked: true, initialQty: 30, initialCost: 25, initialDate: auj };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-hot', rang: 0, revision: null, contenu: enc({ id: 'c-hot', name: 'Hôtel Mouradi Gammarth', city: 'Gammarth', email: '', phone: '' }) },
      { collection: 'catalog', cle: 'k-cof', rang: 0, revision: null, contenu: enc(coffret) },
    ] })).statut).toBe(200);
    const hot = (await objets()).find((o) => o.collection === 'clients' && o.cle === 'c-hot')?.contenu;
    const facture = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: auj, dueDate: '', clientId: 'c-hot', createdAt: 1, subject: 'Coffrets du séminaire',
      lines: [{ id: 'l1', itemId: 'k-cof', label: 'Coffret de chocolats (24 pièces)', description: '', qty: 20, unit: '', unitPrice: 45, vatRate: 19, discount: 0 }],
      discountRate: 0, withholdingRate: 0, applyStamp: true, currency: 'DT', payments: [] };
    const e1 = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: facture, client: hot, revision: null, rang: 0, netAPayer: '1072.000' });
    expect(e1.statut, JSON.stringify(e1.corps)).toBe(200);
    const FAC = String(e1.corps.numero);

    const cx = await contexte(nour);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string, attendre = '#view h1') => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator(attendre).first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `retour-stock-1362-4-${nom}.png`), fullPage: true });
    const lignes = async () => net(await p.locator('#lines').innerText().catch(() => ''));
    const fenetre = async () => net(await p.locator('#modal-root .modal').last().innerText());
    const champ = (k: string) => p.locator(`#lines tr[data-i="0"] input[data-k=${k}]`);
    const taper = async (k: string, v: string) => { await champ(k).fill(v); await champ(k).press('Tab'); };
    const emettre = async () => {
      await p.locator('#ed-geste #issue').click();
      await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
      await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
      const texte = await fenetre();
      await p.locator('#modal-root #ok').click();
      await p.locator('#lecture-piece').waitFor({ timeout: 20_000 });
      return texte;
    };
    const avoirs = async () => (await objets()).filter((o) => o.collection === 'documents' && o.contenu.type === 'avoir' && o.contenu.number).map((o) => o.contenu);

    // A. Un avoir tiré de la facture : la ligne dit ce qu'il fera au stock (10 restent après la vente, 20 reviendraient).
    await aller('#/doc/new/avoir/f1', '#lines');
    await expect.poll(lignes, { timeout: 15_000 }).toContain('revient en stock à l\'émission : 10 → 30');
    expect(await lignes()).not.toContain('en a vendu');
    // B. « Remise accordée » : le prix baisse, rien ne revient. La ligne se change à la main, dans les deux sens.
    await p.locator('#ed-pourquoi [data-motif="Remise accordée"]').click();
    await expect.poll(lignes, { timeout: 5_000 }).toContain('ne revient pas en stock');
    expect(await lignes()).toContain('La remettre en stock');
    await p.locator('#lines [data-retour="0"]').click();
    await expect.poll(lignes, { timeout: 5_000 }).toContain('revient en stock à l\'émission : 10 → 30');
    await p.locator('#lines [data-retour="0"]').click();
    await expect.poll(lignes, { timeout: 5_000 }).toContain('ne revient pas en stock');
    // Une remise de 5 DT sur un coffret qui en coûte 25 n'est pas une vente à perte : la ligne d'un avoir ne vend rien. (Le
    // coût du coffret est au catalogue : sans lui, aucune marge ne s'affichait et ce contrôle ne voyait rien.)
    await taper('unitPrice', '5');
    await expect.poll(async () => net(await p.locator('#totals').innerText().catch(() => '')), { timeout: 10_000 }).toContain('119,000');
    expect(await lignes()).not.toMatch(/marge|à perte/);
    expect(net(await p.locator('#view').innerText())).not.toContain('vendue à perte');
    await photo('1-remise');
    const recap1 = await emettre();
    expect(recap1).toContain('Coffret de chocolats (24 pièces) » : ne revient pas en stock');
    await expect.poll(async () => net(await p.locator('#lecture-piece').innerText()), { timeout: 10_000 }).toContain('ne revient pas en stock');
    const remise = (await avoirs())[0];
    expect(((remise?.lines ?? []) as Obj[])[0]?.sansRetour).toBe(true);

    // C. Le retour de 5 coffrets. Le stock n'a pas bougé (10) ; 25 rendus, ce serait plus que la facture n'a vendu.
    await aller('#/doc/new/avoir/f1', '#lines');
    await expect.poll(lignes, { timeout: 15_000 }).toContain('revient en stock à l\'émission : 10 → 30');
    await taper('qty', '25');
    await expect.poll(lignes, { timeout: 5_000 }).toContain(`${FAC} en a vendu 20`);
    await taper('qty', '5');
    await expect.poll(lignes, { timeout: 5_000 }).toContain('revient en stock à l\'émission : 10 → 15');
    expect(await lignes()).not.toContain('en a vendu');
    await p.locator('#ed-pourquoi [data-motif="Retour de marchandise"]').click();
    expect(await lignes()).toContain('revient en stock à l\'émission : 10 → 15');
    const recap2 = await emettre();
    expect(recap2).toContain('5 remis en stock à l\'émission (10 → 15)');
    await expect.poll(async () => net(await p.locator('#lecture-piece').innerText()), { timeout: 10_000 }).toContain('5 remis en stock');
    await photo('2-retour');
    // (1.388.26, DIR-11) Le retour du navigateur ne rouvre pas l'avoir neuf : la page de création est remplacée par l'avoir émis.
    const surAvoir = p.url();
    await p.goBack();
    await expect.poll(() => p.url(), { timeout: 10_000 }).not.toBe(surAvoir);
    expect(p.url()).not.toContain('/doc/new/');

    // D. (1.388.26, DIR-11) Un troisième avoir ne propose que ce qui reste : 20 vendus, 5 déjà repris ; la remise (autre prix)
    // ne retire rien.
    await aller('#/doc/new/avoir/f1', '#lines');
    await expect.poll(() => champ('qty').inputValue(), { timeout: 15_000 }).toBe('15');
    expect(await lignes()).not.toContain('en a vendu');

    // E. Le stock : 30 − 20 + 5 = 15 coffrets, au coût moyen de 25, soit 375 DT.
    await aller('#/stock');
    const rangee = p.locator('#view tr', { hasText: 'Coffret de chocolats (24 pièces)' }).first();
    await expect.poll(async () => net(await rangee.innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/\b15\b.*375,000/);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
