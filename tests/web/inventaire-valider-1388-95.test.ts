import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('(1.388.95) l\'inventaire du magasinier attend sa validation, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-inventaire-1388-95-'));
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
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('le magasinier compte : rien ne bouge, l\'écran le dit ; la comptabilité interne valide, le stock bouge', async () => {
    const nadia = await personne('nadia');
    const ent = String((await api('POST', '/entreprises', nadia, { raisonSociale: 'Quincaillerie El Amal' })).corps.id);
    const membre = async (qui: string, role: string) => {
      const j = await personne(qui);
      const email = (await api('GET', '/moi', j)).corps.email as string;
      const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia, { email, roles: [role] })).corps.jeton);
      expect((await api('POST', '/invitations/accepter', j, { jeton: inv })).statut).toBe(200);
      return j;
    };
    const hela = await membre('hela', 'magasinier');
    const amine = await membre('amine', 'comptabilite_interne');
    const objets = async (j = nadia) => (await api('GET', `/entreprises/${ent}/dossier-v10`, j)).corps.objets as Obj[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const annee = jourDe(0).slice(0, 4);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null,
        contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Nadia Ferchichi', name: 'Quincaillerie El Amal', city: 'Sousse', activity: 'commerce' } },
      { collection: 'catalog', cle: 'vis', rang: 0, revision: null, contenu: enc({ id: 'vis', label: 'Boîte de vis', unit: 'boîte', unitPrice: 0, vatRate: 19, tracked: true, initialQty: 40, initialCost: 6, initialDate: `${annee}-01-02` }) },
    ] })).statut).toBe(200);
    const erreurs: string[] = [];
    const stock = async (j: string) => (await objets(j)).filter((o) => o.collection === 'stockAdjustments');

    // A. Hela, magasinière, compte 34 boîtes (40 attendues) : la question dit que rien ne bouge avant la validation.
    const cx = await contexte(hela);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(`magasinier : ${e.message}`));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p.locator('#st-tabs button[data-tab="inventaire"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#st-tabs button[data-tab="inventaire"]').click();
    await p.locator('#st-body .inv-in[data-iid="vis"]').fill('34');
    await p.locator('#inv-apply').click();
    const q = p.locator('#modal-root .modal').last();
    await q.locator('#ok').waitFor({ timeout: 10_000 });
    expect(net(await q.locator('p').innerText())).toContain('Tes écarts attendront la validation du propriétaire, d\'un administrateur ou de la comptabilité interne');
    await q.locator('#ok').click();
    await p.locator('#inv-fait').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#inv-fait p').innerText())).toContain('Il attend la validation');
    await expect.poll(async () => (await stock(nadia)).map((o) => o.contenu.aValider), { timeout: 15_000 }).toEqual([true]);
    const ligne = p.locator('#inv-passes tbody tr').first();
    expect(net(await ligne.innerText())).toContain('À valider');
    expect(await ligne.locator('[data-inv-decider]').count()).toBe(0);
    expect(await ligne.locator('[data-inv-annuler]').count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'inventaire-1388-95-1-magasinier.png') });

    // B. Amine, comptabilité interne (le stock en lecture seule), valide : l'écart entre dans le stock.
    const cx2 = await contexte(amine);
    await cx2.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p2 = await cx2.newPage();
    p2.on('pageerror', (e) => erreurs.push(`comptabilité interne : ${e.message}`));
    await p2.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p2.locator('#st-tabs button[data-tab="inventaire"]').waitFor({ timeout: 20_000 });
    await plusTard(p2);
    // Le stock se lit, l'inventaire d'un autre se valide : le bandeau le dit, pas « Lecture seule ».
    await expect.poll(async () => net(await p2.locator('#bandeau-lecture').innerText().catch(() => '')), { timeout: 10_000 }).toContain('tu valides ou refuses les inventaires');
    expect(net(await p2.locator('#bandeau-lecture').innerText())).not.toMatch(/^Lecture seule/);
    await p2.locator('#st-tabs button[data-tab="inventaire"]').click();
    const decider = p2.locator('#inv-passes [data-inv-decider]').first();
    await decider.waitFor({ timeout: 10_000 });
    await decider.click();
    const q2 = p2.locator('#modal-root .modal').last();
    await q2.locator('#a').waitFor({ timeout: 10_000 });
    expect(net(await q2.locator('p').innerText())).toContain('Boîte de vis : −6');
    await p2.screenshot({ path: path.join(PHOTOS, 'inventaire-1388-95-2-valider.png') });
    await q2.locator('#a').click();
    await expect.poll(() => toast(p2), { timeout: 10_000 }).toMatch(/validé : 1 écart dans le stock/);
    await expect.poll(async () => (await stock(nadia)).map((o) => [o.contenu.aValider ?? null, !!o.contenu.validePar]), { timeout: 15_000 }).toEqual([[null, true]]);
    await expect.poll(async () => net(await p2.locator('#inv-passes tbody tr').first().innerText())).toContain('Dans le stock');
    expect(erreurs).toEqual([]);
    await cx.close(); await cx2.close();
  }, 180_000);
});
