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
describe('MET1-1 (1.388.49) : la douchette lit les codes à la suite', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-douchette-1388-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'douchette-1388.txt'), '');
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
  it('Hichem lit trois codes à la suite : chaque lecture ajoute son article, la même deux fois fait +1, le curseur reste dans la barre', async () => {
    const hichem = await personne('hichem');
    const ent = String((await api('POST', '/entreprises-essai', hichem)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, hichem);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hichem, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Saïda Ben Salah' } },
      { collection: 'catalog', cle: 'farine', rang: 0, revision: null, contenu: { id: 'farine', label: 'Farine 1 kg', unit: 'u', unitPrice: { '~n': '1.2' }, vatRate: 7, code: '6190000000200' } },
      { collection: 'catalog', cle: 'huile', rang: 1, revision: null, contenu: { id: 'huile', label: 'Huile d\'olive 1 L', unit: 'u', unitPrice: { '~n': '13.866' }, vatRate: 19, code: '6190000000201' } },
    ] })).statut).toBe(200);
    const cx = await contexte(hichem);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#ed-pq-q:visible, #ed-client:visible').first().waitFor({ timeout: 20_000 });
    if (await p.locator('#ed-pq-q').isVisible()) {
      await p.locator('#ed-pq-q').fill('Saïda');
      await p.locator('#ed-pq-liste [role=option][data-cl]').first().click();
    }
    // La douchette : elle tape le code puis Entrée, trois fois de suite, sans qu'on clique entre deux.
    await p.locator('#ed-ajout').click();
    for (const code of ['6190000000200', '6190000000200', '6190000000201']) {
      await p.keyboard.type(code, { delay: 5 });
      await p.keyboard.press('Enter');
    }
    await expect.poll(() => p.locator('#lines input[data-k=label]').count(), { timeout: 10_000 }).toBe(2);
    const lignes = await p.locator('#lines tr[data-i]').evaluateAll((l) => l.map((tr) => ({
      label: (tr.querySelector('input[data-k=label]') as HTMLInputElement | null)?.value ?? '',
      qty: (tr.querySelector('input[data-k=qty]') as HTMLInputElement | null)?.value ?? '' })));
    expect(lignes).toEqual([{ label: 'Farine 1 kg', qty: '2' }, { label: 'Huile d\'olive 1 L', qty: '1' }]);
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('ed-ajout');
    expect(await p.locator('#ed-ajout').inputValue()).toBe('');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 90_000);
});
