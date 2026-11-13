// La facture émise deux fois, 1.362.2 (bout en bout 26), jouée par une pâtisserie de Tunis : la facture du mois de l'Hôtel
// Mouradi (1 200 HT + 228 de TVA + 1 de timbre) refaite par « la refaire », émise une seconde fois par erreur, puis annulée
// par un avoir total. Le doublon dit avant d'émettre, « la refaire » qui ne laisse pas de page vierge derrière lui,
// l'avoir total qui reprend le timbre, le second avoir qui ne se crée pas en silence, le brouillon resté en double qui ne
// promet plus d'argent à rendre et se retire d'un geste, et le Cabinet qui lit deux pièces qui s'annulent.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'annulation-avoir-1362-2.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('la facture émise deux fois, annulée par un avoir, jusqu\'au Cabinet (1.362.2)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-annulation-avoir-1362-2-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'annulation-avoir-1362-2.txt'), '');
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

  it('le doublon, l\'avoir total qui reprend le timbre, le second avoir proposé plutôt que créé, et le Cabinet', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const ligne = { id: 'l1', label: 'Forfait viennoiseries, livraison quotidienne', description: '', qty: 1, unit: 'mois', unitPrice: 1200, vatRate: 19, discount: 0 };
    const facture = (id: string) => ({ id, type: 'facture', number: '', status: 'brouillon', date: auj, dueDate: '', clientId: 'c-hot', createdAt: 1, subject: 'Viennoiseries du petit-déjeuner',
      lines: [ligne], discountRate: 0, withholdingRate: 0, applyStamp: true, currency: 'DT', payments: [] });
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Nour Jaziri', name: 'Pâtisserie Les Délices', city: 'Tunis', paymentTermsDays: 30 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-hot', rang: 0, revision: null, contenu: enc({ id: 'c-hot', name: 'Hôtel Mouradi Gammarth', city: 'Gammarth', email: '', phone: '' }) },
    ] })).statut).toBe(200);
    const hot = (await objets()).find((o) => o.collection === 'clients' && o.cle === 'c-hot')?.contenu;
    // FAC1 porte la période d'une facture de contrat : la copie ne doit pas la reprendre.
    const e1 = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: { ...facture('f1'), periode: auj.slice(0, 7) }, client: hot, revision: null, rang: 0, netAPayer: '1429.000' });
    expect(e1.statut, JSON.stringify(e1.corps)).toBe(200);
    const FAC1 = String(e1.corps.numero);
    const brouillons = async () => (await objets()).filter((o) => o.collection === 'documents' && !o.contenu.number);

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
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `annulation-avoir-1362-2-${nom}.png`), fullPage: true });
    const vue = async () => net(await p.locator('#view').innerText());
    const fenetre = async () => net(await p.locator('#modal-root .modal').last().innerText());
    const emettre = async () => {
      await p.locator('#ed-geste #issue').click();
      await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
      await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
      const texte = await fenetre();
      await p.locator('#modal-root #ok').click();
      await p.locator('#lecture-piece').waitFor({ timeout: 20_000 });
      return texte;
    };

    // A. Une facture neuve, le client choisi à la main (la pièce se marque modifiée) : « la refaire » ouvre la copie de
    // FAC1 sans demander « Quitter sans enregistrer ? » — rien n'est tapé, la copie porte le même client —, un seul
    // brouillon, et « ← » ne mène pas à une facture vide.
    await aller('#/doc/new/facture', '#ed-pq-q');
    await p.locator('#ed-pq-q').fill('Mouradi');
    await p.locator('#ed-pq-liste [role=option][data-cl]').first().click();
    await p.locator('[data-refaire]').waitFor({ timeout: 15_000 });
    await p.locator('[data-refaire]').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/doc\/(?!new)/);
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    const f2 = (await p.evaluate(() => location.hash)).replace('#/doc/', '');
    await expect.poll(async () => (await brouillons()).map((o) => o.cle), { timeout: 15_000 }).toEqual([f2]);
    expect((await objets()).find((o) => o.cle === 'f1')?.contenu.periode).toBe(auj.slice(0, 7));
    expect((await brouillons())[0]?.contenu.periode).toBeUndefined();
    // La pile de « ← » : son sommet (là où « ← » mène) n'est pas la page vierge que « la refaire » a remplacée.
    expect((await p.evaluate(() => (window as unknown as { __navStack: string[] }).__navStack)).some((h) => h.startsWith('#/doc/new/'))).toBe(false);
    // B. Avant d'émettre, le doublon se voit, et il mène à la facture déjà émise.
    await expect.poll(async () => net(await p.locator('[data-avant=jumelle]').locator('xpath=ancestor::li[1]').innerText().catch(() => ''))).toContain(`Un doublon ? ${FAC1}`);
    expect(net(await p.locator('[data-avant=jumelle]').locator('xpath=ancestor::li[1]').innerText())).toContain('même client, même montant, même objet');
    await photo('b-doublon');
    // C. Émise quand même (la faute) : la fenêtre d'émission le dit aussi.
    const recap = await emettre();
    expect(recap).toContain(FAC1);
    const FAC2 = (await objets()).find((o) => o.cle === f2)?.contenu.number as string;
    expect(FAC2).toMatch(/^FAC-/);

    // D. « Avoir total » depuis le menu de FAC2 : le motif est posé ET le timbre repris, l'avoir vaut 1 429.
    await aller(`#/doc/${f2}`, '#more-btn');
    await p.locator('#more-btn').click();
    await p.getByRole('menuitem', { name: /Avoir total/ }).click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toBe(`#/doc/new/avoir/${f2}/total`);
    await p.locator('#ed-apres').waitFor({ timeout: 15_000 });
    await expect.poll(async () => net(await p.locator('.ed-net .v').first().innerText())).toContain('1 429,000');
    expect(await vue()).toContain('Timbre 1,000 DT');
    expect(net(await p.locator('#ed-apres').innerText())).toContain(`Après cet avoir, ${FAC2} ne laisse plus rien à payer`);
    // Un autre motif rend le timbre ; « Annulation totale » le reprend.
    await p.locator('[data-motif="Remise accordée"]').click();
    await expect.poll(async () => net(await p.locator('.ed-net .v').first().innerText())).toContain('1 428,000');
    await p.locator('[data-motif="Annulation totale"]').click();
    await expect.poll(async () => net(await p.locator('.ed-net .v').first().innerText())).toContain('1 429,000');
    await expect.poll(async () => (await brouillons()).filter((o) => o.contenu.creditOf === f2).length, { timeout: 15_000 }).toBe(1);
    const brouillonAvoir = (await brouillons()).find((o) => o.contenu.creditOf === f2)?.cle as string;
    await photo('d-avoir-total');

    // E. Revenir sur FAC2 et redemander un avoir : le brouillon qui attend est proposé, pas un second créé en silence.
    await aller(`#/doc/${f2}`, '#more-btn');
    await p.locator('#more-btn').click();
    await p.getByRole('menuitem', { name: /Créer un avoir/ }).click();
    await expect.poll(fenetre).toContain(`Un avoir sur ${FAC2} attend déjà`);
    expect(await fenetre()).toContain('1 429,000 DT');
    await photo('e-attend-deja');
    await p.locator('#modal-root #a').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toBe(`#/doc/${brouillonAvoir}`);
    await p.locator('#ed-apres').waitFor({ timeout: 15_000 });
    expect((await brouillons()).filter((o) => o.contenu.creditOf === f2).length).toBe(1);

    // F. L'avoir émis : FAC2 est annulée, plus rien n'est dû, et le timbre aussi.
    await p.locator('#ed-geste #issue').waitFor({ timeout: 15_000 });
    await emettre();
    const AVO = (await objets()).find((o) => o.cle === brouillonAvoir)?.contenu.number as string;
    expect(AVO).toMatch(/^AVO-/);
    await aller(`#/doc/${f2}`, '#lecture-piece');
    expect(await vue()).toContain(`Annulée par ${AVO} : plus rien n'est dû`);

    // G. Un brouillon d'avoir resté en double sur FAC2 (avant la 1.362.2, chaque passage en laissait un) : il ne promet plus
    // d'argent à rendre d'une facture jamais payée, la fenêtre d'émission dit le doublon, et il se retire d'un geste.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [{ collection: 'documents', cle: 'a-trop', rang: 9, revision: null, contenu: enc({ ...facture('a-trop'), type: 'avoir', creditOf: f2, creditOfNumber: FAC2, creditReason: 'Annulation totale' }) }] })).statut).toBe(200);
    await aller('#/doc/a-trop', '#ed-apres');
    const bandeau = net(await p.locator('#ed-apres').innerText());
    expect(bandeau).toContain(`Il dépasse de 1 429,000 DT ce que la facture porte encore : ${AVO} l'a déjà corrigée`);
    expect(bandeau).not.toContain('à rendre au client, ou à déduire');
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    expect(await fenetre()).toContain(`${FAC2} est déjà corrigée par ${AVO} : cet avoir la dépasse de 1 429,000 DT`);
    await photo('g-emission-trop');
    await p.locator('#modal-root [data-close]').last().click();
    await p.locator('#ed-suppr-double').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await brouillons()).some((o) => o.cle === 'a-trop'), { timeout: 15_000 }).toBe(false);

    // H. Au Cabinet : la facture et l'avoir s'annulent ligne pour ligne, timbre compris.
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/${auj.slice(0, 4)}`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check().catch(() => undefined);
    await c.waitForTimeout(3000);
    const livre = await c.evaluate(() => [...document.querySelectorAll('#c-livres tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()));
    noter('==== H journal du Cabinet', livre);
    for (const n of [FAC2, AVO]) {
      const l = livre.filter((x) => x.includes(n));
      expect(l.some((x) => /(^| )411 /.test(x) && x.includes('1 429,000')), n).toBe(true);
      expect(l.some((x) => /(^| )4368 /.test(x) && x.includes('1,000')), n).toBe(true);
    }
    await c.screenshot({ path: path.join(PHOTOS, 'annulation-avoir-1362-2-h-cabinet.png'), fullPage: true });
    await cxC.close();
    noter('erreurs', erreurs);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
