// La première relance d'une facture très en retard (1.359.1). Le modèle « Dernière relance » commençait par « Malgré nos
// précédents rappels » sur une facture jamais relancée : il le tait maintenant (le ton ferme vient du retard, pas d'un
// historique inventé). Et quand le client n'a pas d'adresse sur sa fiche, la fenêtre le dit et montre la case où la taper,
// au lieu d'un « À » vide au-dessus de « + Une autre adresse ».


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

describe('la première relance d\'une facture très en retard, à un client sans adresse (1.359.1)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-relance-premiere-1359-1-'));
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
  const n = (x: string) => ({ '~n': x });

  it('la relance ne parle pas de rappels qui n\'ont pas eu lieu ; sans adresse, la fenêtre le dit et montre la case', async () => {
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const client = { id: 'c1', name: 'Hôtel Mouradi Gammarth', city: 'La Marsa', email: '', paymentTermsDays: 30, withholdingRate: 0 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client },
    ] })).statut).toBe(200);
    const f1 = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-08-01', dueDate: '2026-08-31', clientId: 'c1', createdAt: 10, subject: 'Séminaire',
      lines: [{ label: 'Séminaire, 60 couverts', description: '', qty: n('1'), unit: '', unitPrice: n('3000.000'), vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
    const em = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: f1, client, revision: null, rang: 30, netAPayer: '3571.000' });
    expect(em.statut, JSON.stringify(em.corps)).toBe(200);

    const erreurs: string[] = [];
    const cx = await contexte(nour);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
    const ligne = p.locator('tr').filter({ hasText: 'Hôtel Mouradi Gammarth' }).first();
    await ligne.waitFor({ timeout: 30_000 });
    await plusTard(p);
    expect(net(await ligne.innerText())).toContain('jamais');
    await ligne.getByRole('button', { name: 'Relancer', exact: true }).click();
    const fen = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await fen.innerText().catch(() => '')), { timeout: 10_000 }).toContain('n\'a pas d\'adresse sur sa fiche');
    // 74 jours de retard : le ton de la dernière relance, sans rappels inventés.
    const corpsMail = (await fen.locator('textarea').first().inputValue()).replace(/\s/g, ' ');
    expect(corpsMail).toContain('La facture FAC-2026-001 (3 571,000 DT, échue le 31/08/2026) reste impayée après 74 jours.');
    expect(corpsMail).not.toContain('précédents rappels');
    // La case de l'adresse est là, sans « Une autre adresse » (il n'y en a pas d'une) ; l'envoi sans adresse la montre.
    const autre = fen.locator('#env-autre-v');
    expect(await autre.isVisible()).toBe(true);
    expect(await fen.locator('#env-autre').isVisible()).toBe(false);
    await p.screenshot({ path: path.join(PHOTOS, 'relance-premiere-1359-1.png') });
    await fen.getByRole('button', { name: 'Envoyer la relance', exact: true }).click();
    await expect.poll(async () => net(await p.locator('body').innerText()), { timeout: 10_000 }).toContain('Tape l\'adresse où l\'envoyer : sa fiche n\'en a pas.');
    expect(await autre.evaluate((x) => document.activeElement === x)).toBe(true);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
