// 1.388.44 (audit #30, MET2-1, MET2-7) : un second acompte part de ce qui est déjà facturé, et le solde retranche tous les acomptes.
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
describe('1.388.44 (MET2-1) : les acomptes successifs d\'un devis se voient entre eux', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-acomptes-1388-'));
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
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });


  it('Fathi demande un second acompte : la fenêtre dit les 30 % déjà facturés, refuse 80 %, et annonce le solde après les deux', async () => {
    const fathi = await personne('fathi');
    const ent = String((await api('POST', `/entreprises-essai`, fathi)).corps.id);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, fathi)).corps.objets as Obj[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Fathi Gharbi', name: 'Bâtisseurs Essai Ennasr', city: 'Sfax', paymentTermsDays: 30 };
    const ligne = { label: 'Carrelage posé', description: '', qty: 10, unit: 'm²', unitPrice: 100, vatRate: 19 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, fathi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-alpha', rang: 0, revision: null, contenu: { id: 'c-alpha', name: 'Société Alpha', city: 'Sfax' } },
      { collection: 'documents', cle: 'dv1', rang: 0, revision: null, contenu: { id: 'dv1', type: 'devis', number: 'DEV-2026-001', status: 'accepté', date: jourDe(-3), clientId: 'c-alpha',
        subject: 'Salle de bain', createdAt: Date.now(), discountRate: 0, withholdingRate: 0, payments: [], lines: [ligne] } },
      { collection: 'documents', cle: 'fa1', rang: 1, revision: null, contenu: { id: 'fa1', type: 'facture', status: 'brouillon', date: jourDe(-2), clientId: 'c-alpha',
        subject: 'Acompte 30 % — Salle de bain', createdAt: Date.now(), discountRate: 0, withholdingRate: 0, payments: [], fromQuoteId: 'dv1', fromQuoteNumber: 'DEV-2026-001',
        deposit: { percent: 30, quoteId: 'dv1', quoteNumber: 'DEV-2026-001' }, lines: [{ label: 'Acompte 30 % — Carrelage posé', description: '', qty: 1, unit: '', unitPrice: 300, vatRate: 19, noDiscount: true }] } },
    ] })).statut).toBe(200);

    const cx = await contexte(fathi);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const fen = async () => net(await p.locator('#modal-root .modal').last().innerText().catch(() => ''));
    const champ = () => p.locator('#modal-root #df [name=percent]');

    // 0. L'acompte de 30 % est émis à la souris (FAC-2026-001).
    await aller('#/doc/fa1');
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => ((await objets()).find((o) => o.collection === 'documents' && o.cle === 'fa1')?.contenu.number) ?? '', { timeout: 20_000 }).toBe('FAC-2026-001');
    expect(await toast(p)).not.toBe('');

    // 1. Le devis (1 190 TTC) a déjà un acompte de 30 % émis (FAC-2026-001, 357 hors timbre) : la fenêtre le dit, et part de ce qui reste.
    await aller('#/doc/dv1');
    if (await p.locator('#bill-btn').isVisible()) await p.locator('#bill-btn').click();
    await p.locator('#deposit:visible').first().click();
    await p.locator('#modal-root #dp-deja').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#modal-root #dp-deja').innerText())).toBe('Déjà facturé en acompte : 30 % (357,000 DT, FAC-2026-001). Il reste 70 % du devis (833,000 DT) à facturer.');

    // 2. 80 % de plus ferait 110 % du devis : refusé, avec ce qui reste ; rien n'est créé.
    await champ().fill('80');
    await expect.poll(fen, { timeout: 10_000 }).toContain('Il reste 70 % du devis à facturer (833,000 DT)');
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'documents' && o.contenu.type === 'facture').length, { timeout: 3_000 }).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'acomptes-1388-refus.png'), fullPage: true });

    // 3. 40 % : l'acompte 476 + 1 de timbre ; le solde retranche les DEUX acomptes : 1 190 − 357 − 476 = 357, + 1 de timbre.
    await champ().fill('40');
    await expect.poll(async () => net(await p.locator('#modal-root #dp-acompte').innerText().catch(() => '')), { timeout: 10_000 }).toBe('477,000 DT');
    expect(net(await p.locator('#modal-root #dp-solde').innerText())).toBe('358,000 DT');
    expect(await fen()).toContain('Trois factures, donc 3 timbres');
    await p.screenshot({ path: path.join(PHOTOS, 'acomptes-1388-second.png'), fullPage: true });

    expect(erreurs).toEqual([]);
  }, 180_000);
});
