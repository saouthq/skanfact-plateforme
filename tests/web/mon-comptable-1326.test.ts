// 1.326.0 — « Mon comptable », joué comme Sarra Mansour (Boulangerie El Amal) le joue : le mois en cours encore vide (le
// cabinet travaille le mois d'avant), une pièce demandée, des pièces envoyées, ce que le cabinet a rangé. Puis le même fil
// au doigt, des deux côtés (la messagerie n'avait jamais été mesurée au téléphone).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { problemes } from '../instrument-rendu.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('Mon comptable 1.326.0 : la page du client et le fil du cabinet, à l\'ordinateur et au doigt', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mc-1326-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'mon-comptable-1326.txt'), '');
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

  const sansVisite = () => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); };
  // Un matricule tiré au sort (l'unicité des matricules actifs vaut pour toute la base de test).
  const matricule = () => `${1000000 + Math.floor(Math.random() * 8999999)}${'ABCDEFGHJKLMNPQRSTVWXYZ'[Math.floor(Math.random() * 23)]}/A/M/000`;

  // Une vraie photo PNG d'un pixel, et un PDF minimal.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'utf8').toString('base64');

  it('Sarra lit le dernier mois rempli, envoie la pièce demandée, et le fil se travaille au doigt des deux côtés', async () => {
    const leila = await personne('leila'), sarra = await personne('sarra');
    const cab = (await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const r = await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal', matriculeFiscal: matricule() });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const ent = String(r.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    // Le mois en cours est vide ; le mois d'avant porte un achat de farine, sans justificatif.
    const auj = jourDe(0);
    const [ay, am] = [Number(auj.slice(0, 4)), Number(auj.slice(5, 7))];
    const prec = am === 1 ? `${ay - 1}-12` : `${ay}-${String(am - 1).padStart(2, '0')}`;
    const nomPrec = new Date(`${prec}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const ok = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Minoterie du Cap Bon' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: enc({ id: 'p1', kind: 'facture', number: 'FA-0905', date: `${prec}-05`, supplierId: 's1',
        currency: 'DT', exchangeRate: '', fees: 0, withholdingRate: 0, attachments: [], payments: [],
        lines: [{ label: 'Farine T55 (sac de 50 kg)', qty: 10, unit: '', unitPrice: 42, vatRate: 7, destination: 'charge', deductible: true }] }) },
    ] });
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(200);
    // Le cabinet demande une pièce, range sa lettre de mission ; Sarra envoie une photo et un PDF.
    expect((await api('POST', `/entreprises/${ent}/messages`, leila, { cote: 'cabinet', texte: 'Bonjour Sarra, il me manque :',
      demandes: ['L\'attestation CNSS du 3e trimestre'], pour: jourDe(20) })).statut).toBeLessThan(300);
    expect((await api('POST', `/cabinets/${cab.id}/classeur/${ent}/documents`, leila, { rubrique: 'permanent', categorie: 'cabinet', titre: 'Lettre de mission 2026',
      nom: 'lettre-mission-2026.pdf', contenu: PDF })).statut).toBeLessThan(300);
    for (const [nom, contenu] of [['IMG_8790.png', PNG], ['facture-farine.pdf', PDF]] as const) {
      const f = await api('POST', `/entreprises/${ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom, contenu });
      expect(f.statut, JSON.stringify(f.corps)).toBeLessThan(300);
      expect((await api('POST', `/entreprises/${ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: f.corps.id })).statut).toBeLessThan(300);
    }

    const erreurs: string[] = [];
    const cx = await contexte(sarra);
    await cx.addInitScript(sansVisite);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/comptable`);
    const carte = p.locator('[data-msg-mois]');
    await expect.poll(async () => net(await carte.innerText().catch(() => '')), { timeout: 25_000 }).toMatch(/^Ton dernier mois rempli/);
    await plusTard(p);
    // Le mois en cours encore vide : la carte dit le dernier mois rempli, et ce que le cabinet en a fait.
    await expect.poll(async () => net(await carte.innerText()), { timeout: 15_000 })
      .toBe(`Ton dernier mois rempli · ${nomPrec} Aucune vente · 1 achat, dont 1 sans justificatif. Ton cabinet n'a encore rien validé : 1 écriture attend au brouillard. Voir l'achat sans justificatif`);
    // Une carte comme les autres : à gauche, sans le point de couleur des pastilles de mois.
    expect(await carte.evaluate((e) => [getComputedStyle(e).display, getComputedStyle(e).alignItems, getComputedStyle(e, '::before').content])).toEqual(['flex', 'flex-start', 'none']);
    // Un cabinet tient le dossier : le menu dit « Mon comptable », jamais « Inviter mon comptable » à côté.
    await expect.poll(() => p.locator('#foot-comptable:visible').count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => p.locator('#b-inviter-comptable:visible').count(), { timeout: 15_000 }).toBe(0);
    // Ce que le cabinet a rangé : sans puce, la nature et la date sous le titre.
    const range = p.locator('[data-msg-range]:not([hidden])');
    await range.waitFor({ timeout: 15_000 });
    expect(await range.locator('ul').evaluate((u) => getComputedStyle(u).listStyleType)).toBe('none');
    const [titre, sous] = await range.locator('li').first().evaluate((li) => [li.querySelector('button')?.getBoundingClientRect().bottom ?? 0, li.querySelector('small')?.getBoundingClientRect().top ?? 0]);
    expect(sous).toBeGreaterThanOrEqual(titre - 1);
    // La pièce demandée envoyée sans fichier : le refus montre le bouton qui choisit le fichier.
    await p.getByRole('button', { name: 'Envoyer la pièce…', exact: true }).first().click();
    const fen = p.locator('.msg-fenetre');
    await fen.getByRole('button', { name: 'Envoyer à mon cabinet', exact: true }).click();
    await expect.poll(() => fen.locator('[data-ep-refus]').innerText()).toBe('Choisis d\'abord la photo, le PDF ou la facture électronique de la pièce.');
    expect(await fen.locator('[data-ep-choisir]').evaluate((b) => [b.classList.contains('msg-manque'), document.activeElement === b])).toEqual([true, true]);
    await fen.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect.poll(() => fen.count()).toBe(0);
    expect(await p.evaluate(problemes, [false, 1440] as [boolean, number])).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'mon-comptable-1326-a-client.png'), fullPage: true });

    // Au doigt, des deux côtés : chaque cible du fil fait 44 points, rien ne déborde.
    const tel = await contexte(sarra, 390, 844);
    await tel.addInitScript(sansVisite);
    const t = await tel.newPage();
    t.on('pageerror', (e) => erreurs.push(e.message));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/comptable`);
    await t.locator('[data-msg-mois]').waitFor({ timeout: 25_000 });
    await t.getByText('IMG_8790.png').first().waitFor({ timeout: 15_000 });
    await plusTard(t);
    await t.screenshot({ path: path.join(PHOTOS, 'mon-comptable-1326-b-client-tel.png'), fullPage: true });
    expect(await t.evaluate(problemes, [true, 390] as [boolean, number])).toEqual([]);
    const telCab = await contexte(leila, 390, 844);
    await telCab.addInitScript(sansVisite);
    const c = await telCab.newPage();
    c.on('pageerror', (e) => erreurs.push(`cabinet : ${e.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages/${ent}`);
    await c.getByText('IMG_8790.png').first().waitFor({ timeout: 25_000 });
    await plusTard(c);
    await c.screenshot({ path: path.join(PHOTOS, 'mon-comptable-1326-c-cabinet-tel.png'), fullPage: true });
    expect(await c.evaluate(problemes, [true, 390] as [boolean, number])).toEqual([]);
    expect(erreurs).toEqual([]);
    await cx.close(); await tel.close(); await telCab.close();
  }, 240_000);
});
