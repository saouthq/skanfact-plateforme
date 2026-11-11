// (1.355.0) Le premier salarié d'une librairie, joué à la souris (docs/revue-modules.md, « Bout en bout : le premier salarié ») :
//   - la Paie vide n'a plus d'onglets « La journée » / « Congés et absences » qui s'allumaient sur rien ;
//   - le net s'annonce sous le brut qu'on tape (il vivait après les Notes, hors de la fenêtre) ;
//   - entré le 1er, le mois est payé en entier : l'écart ne dit plus « au prorata » ;
//   - le pointage validé reste « le mois est validé » une fois le bulletin établi (il devenait « sauté ») ;
//   - le bulletin établi et pas payé : la page s'ouvre sur son mois, pas sur le mois en cours vide.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { poserMouchard, retirerMouchard } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le premier salarié, du vide au bulletin à payer (1.355.0)', () => {
    let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1355-'));
  beforeAll(async () => {
    await admin.connect();
    await poserMouchard(admin);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await retirerMouchard(admin).catch(() => undefined); await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const aujourdhui = new Date().toISOString().slice(0, 10);

  // La boulangerie : Sarra, propriétaire (avec son code), et Karim, commercial.
  const boulangerie = async () => {
        const email = `sarra-paie-1355-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
        const karimEmail = `karim-paie-1355-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: karimEmail, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await api('POST', '/connexion', undefined, { email: karimEmail, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: karimEmail, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim, { jeton: invitation })).statut).toBe(200);
    return { jeton, ent, karim };
  };


  it('la Paie vide sans onglets, le net sous le brut, « mois entier », le mois validé reste validé, la page sur le mois à payer', async () => {
    const { jeton, ent } = await boulangerie();
    const [aa, mm] = aujourdhui.slice(0, 7).split('-').map(Number) as [number, number];
    const y = mm === 1 ? aa - 1 : aa, m = mm === 1 ? 12 : mm - 1, ym = `${y}-${String(m).padStart(2, '0')}`;
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = objets.find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Amel Nouri', address: 'Avenue Habib Bourguiba\n1000 Tunis' } }] })).statut).toBe(200);
    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#new-emp').waitFor({ timeout: 20_000 });
    await plusTard(p);

    // 1. Sans salarié : l'état vide, et aucun onglet dessous.
    expect(await p.locator('#p-sous [data-sous]').count()).toBe(0);

    // 2. Le premier salarié, entré le 1er du mois écoulé : le net se lit sous le brut, pendant la frappe.
    await p.locator('#new-emp').click();
    await p.locator('#ef input[name=name]').fill('Sami Gharbi');
    await p.locator('#ef [name=hireDate]').evaluate((x, v) => { (x as HTMLInputElement).value = v; x.dispatchEvent(new Event('change', { bubbles: true })); }, `${ym}-01`);
    const brut = p.locator('#ef input[name=grossSalary]');
    await brut.click();
    await brut.press('Control+a');
    await p.keyboard.type('1200');
    await expect.poll(() => p.locator('#ef-hint').innerText(), { timeout: 10_000 }).toMatch(/net d'environ/);
    const sous = await p.evaluate(() => {
      const b = document.querySelector('#ef input[name=grossSalary]')?.getBoundingClientRect(), h = document.querySelector('#ef-hint')?.getBoundingClientRect();
      return b && h ? h.top - b.bottom : -1;
    });
    expect(sous).toBeGreaterThanOrEqual(0);
    expect(sous).toBeLessThan(80);
    await p.locator('.modal #ok').click();
    await expect.poll(() => p.locator('.modal').count(), { timeout: 10_000 }).toBe(0);

    // 3. Le mois écoulé : l'entrée le 1er est un mois entier ; validé, puis le bulletin établi, il reste « validé ».
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    await p.locator(`#p-mois [data-p-mois="${m}"]`).click();
    await p.locator('#p-sous .pa-etape[data-sous="pointage"]').click();
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 10_000 }).toMatch(/entrée le 01\//);
    expect(net(await p.locator('#view').innerText())).toMatch(/mois entier/);
    expect(net(await p.locator('#view').innerText())).not.toMatch(/au prorata/);
    await p.locator('#pt-jav').click();
    await p.locator('#jav-ok').click();
    await expect.poll(() => p.locator('#pt-aregler').count(), { timeout: 10_000 }).toBe(0);
    await p.locator('#pt-valider').click();
    const pointer = () => p.locator('#p-sous .pa-etape[data-sous="pointage"] .d').innerText().then(net);
    await expect.poll(pointer, { timeout: 10_000 }).toBe('le mois est validé');
    await p.locator('#p-sous .pa-etape[data-sous="bulletins"]').click();
    await p.locator('#p-gen').click();
    await p.locator('.modal #ok').click();
    await expect.poll(() => p.locator('#p-sous .pa-etape[data-sous="bulletins"] .d').innerText().then(net), { timeout: 10_000 }).toBe('1 établi');
    expect(await pointer()).toBe('le mois est validé');

    // 4. Rouverte, la Paie s'ouvre sur le mois du bulletin à payer, pas sur le mois en cours sans bulletin.
    await p.reload();
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    await expect.poll(() => p.locator('#p-mois [aria-current="true"], #p-mois .on, #p-mois [aria-pressed="true"]').first().getAttribute('data-p-mois'), { timeout: 10_000 }).toBe(String(m));

    // 5. Payer, sans aucun compte créé : la liste ne nomme pas un « Compte principal » qui n'existe pas.
    await p.locator('#p-payer').click();
    const choix = await p.locator('.modal [name=accountId] option').allInnerTexts();
    expect(choix.map(net)).toEqual(['Aucun compte créé : la banque']);
    await p.locator('.modal [data-close]').first().click();

    // 6. (1.355.1) Une absence sans solde : le bouton dit ce qu'il pose, la fenêtre garde sa hauteur quand la nature change,
    // et le brut retenu se lit avant de poser : 1 200 ÷ 26 × 2 = 92,308 (calculé à la main).
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#pj-absence').click();
    const ok = p.locator('.modal #ok');
    const nature = async (k: string) => { await p.locator('.modal [name=kind]').selectOption(k); return (await ok.boundingBox())?.y ?? -1; };
    const yConge = await nature('conges');
    expect(net(await ok.innerText())).toBe('Poser le congé');
    const ySansSolde = await nature('sans-solde');
    expect(net(await ok.innerText())).toBe('Poser l\'absence');
    expect(Math.abs(ySansSolde - yConge)).toBeLessThan(12);
    const date = async (n: string, v: string) => p.locator(`.modal [name=${n}]`).evaluate((x, w) => { (x as HTMLInputElement).value = w; x.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    const lundi = (() => { const d = new Date(`${aujourdhui.slice(0, 7)}-01T00:00:00Z`); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
    const mardi = new Date(Date.parse(`${lundi}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await date('from', lundi);
    await date('to', mardi);
    await expect.poll(() => p.locator('.modal #lf-solde').innerText().then(net), { timeout: 10_000 }).toContain('2 jours non payés − 92,308 DT');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
