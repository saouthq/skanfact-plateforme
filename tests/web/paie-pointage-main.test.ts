// Le pointage à la main (1.224.0 ; docs/maquettes/paie.html ; docs/paie.md, « La paie appliquée », lot 3).
// Sans pointeuse : « Aujourd'hui, qui n'est pas là ? » pose le code du jour (au serveur) et « Annuler » le défait ;
// « Noter une période » pose d'un coup des jours à venir ; « Par salarié » montre son mois jour par jour, d'où vient
// chaque code, et se corrige ; « Les horaires » dit ce qui est réglé et ce qui ne l'est pas (la pointeuse : pas encore).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la paie : le pointage à la main', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-pointage-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); }, 30_000);

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();

  it('aujourd\'hui qui n\'est pas là, une période d\'un coup (jours à venir), le mois par salarié, les horaires', async () => {
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    const sal = (id: string, name: string) => ({ id, name, grossSalary: 1137.25, hireDate: '2024-01-09', contract: 'cdi', headOfFamily: false, children: 0,
      active: true, method: 'virement', iban: '', cnss: '1', position: 'Vendeur' });
    expect(await poser('employees', 's1', sal('s1', 'Karim Numéro Un'))).toBe(200);
    expect(await poser('employees', 's2', sal('s2', 'Nadia Numéro Deux'))).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    // Aucun jour de repos : « aujourd'hui » se pointe quel que soit le jour où le test tourne.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Gérant Numéro Un' } },
      { collection: '_racine', cle: 'payrollSettings', rang: null, revision: null, contenu: { offDays: [] } }] })).statut).toBe(200);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const auj = new Date(), aujIso = iso(auj), y = auj.getUTCFullYear(), m = auj.getUTCMonth() + 1, d = auj.getUTCDate();
    const plus = (n: number) => iso(new Date(Date.UTC(y, m - 1, d + n)));
    const fr = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
    const codesDe = async (id: string) => {
      const L = (await objets()).filter((o) => o.collection === 'timesheets' && o.contenu.employeeId === id);
      const r: Record<string, string> = {};
      for (const t of L) for (const [j, c] of Object.entries((t.contenu.jours ?? {}) as Record<string, string>)) r[`${t.contenu.year}-${String(t.contenu.month).padStart(2, '0')}-${String(j).padStart(2, '0')}`] = c;
      return r;
    };

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, patron);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    await p.locator('#p-tabs [data-tab="pointage"]').click();

    // ── Aujourd'hui : un geste par salarié ; « Absent » se pose au serveur, « Annuler » le défait ──────────────────
    await p.locator('#pt-auj').waitFor();
    expect(espace(await p.locator('#pt-main b').first().innerText())).toBe('Pas de pointeuse ? Tu pointes à la main');
    expect(await p.locator('#pt-auj .pt-auj-l').count()).toBe(2);
    const karim = p.locator('#pt-auj [data-auj-e="s1"]');
    expect(await karim.locator('[aria-pressed="true"]').innerText()).toBe('Présent');
    await karim.getByRole('button', { name: 'Absent' }).click();
    await expect.poll(async () => (await codesDe('s1'))[aujIso], { timeout: 15_000 }).toBe('A');
    expect(await p.locator('#pt-auj [data-auj-e="s1"] [aria-pressed="true"]').innerText()).toBe('Absent');
    expect(espace(await p.locator('#toast').innerText())).toContain('Karim Numéro Un, aujourd\'hui : absent, non payé');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-pointage-main.png') });
    await p.locator('#toast-undo').click();
    await expect.poll(async () => (await codesDe('s1'))[aujIso], { timeout: 15_000 }).toBeUndefined();

    // ── Noter une période : cinq jours à venir, d'un coup ───────────────────────────────────────────────────────────
    await p.locator('#pt-periode').click();
    const fen = p.locator('#modal-root .modal').last();
    await fen.locator('[name=emp]').selectOption('s2');
    await fen.locator('[name=code]').selectOption('C');
    const champ = (n: string) => fen.locator(`.datefield:has(input[name=${n}]) input:not([type=hidden])`);
    await champ('du').fill(fr(plus(1))); await champ('du').press('Tab');
    await champ('au').fill(fr(plus(5))); await champ('au').press('Tab');
    await expect.poll(() => fen.locator('#pp-dit').innerText()).toBe('5 jours à noter.');
    await fen.locator('#pp-ok').click();
    await expect.poll(async () => { const c = await codesDe('s2'); return [1, 2, 3, 4, 5].map((k) => c[plus(k)]); }, { timeout: 15_000 }).toEqual(['C', 'C', 'C', 'C', 'C']);
    expect((await codesDe('s2'))[plus(6)]).toBeUndefined();

    // ── Par salarié : son mois jour par jour, d'où vient chaque code ; un jour se corrige ───────────────────────────
    await p.locator('#p-sous [data-sous="pt-salarie"]').click();
    await p.locator('#pt-sal').waitFor();
    if (await p.locator('#p-year').inputValue() !== String(y)) await p.locator('#p-year').selectOption(String(y));
    await p.locator('#pt-sal-e').selectOption('s2');
    await p.locator('#pt-sal-m').selectOption(String(m));
    // Le lendemain (s'il est dans le mois) est un congé pointé à la main.
    const demain = plus(1);
    if (Number(demain.slice(5, 7)) === m) {
      const tr = p.locator(`#pt-sal-t tr[data-ptj="${Number(demain.slice(8, 10))}"]`);
      expect(await tr.locator('select').inputValue()).toBe('C');
      expect(espace(await tr.locator('td').nth(2).innerText())).toBe('pointé à la main');
    }
    const ligneAuj = p.locator(`#pt-sal-t tr[data-ptj="${d}"]`);
    expect(espace(await ligneAuj.locator('td').nth(2).innerText())).toBe('selon ses jours de travail');
    await ligneAuj.locator('select').selectOption('M');
    await expect.poll(async () => (await codesDe('s2'))[aujIso], { timeout: 15_000 }).toBe('M');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-pointage-salarie.png') });

    // ── Les horaires : ce qui est réglé, ce qui ne l'est pas ────────────────────────────────────────────────────────
    await p.locator('#p-sous [data-sous="pt-horaires"]').click();
    await p.locator('#pt-hor').waitFor();
    expect(espace(await p.locator('#pt-hor').innerText())).toContain('Une pointeuse pas encore');
    expect(espace(await p.locator('#pt-hor-r').innerText())).toContain('Jours de travail lundi, mardi, mercredi, jeudi, vendredi, samedi, dimanche repos : aucun');
    expect(erreurs).toEqual([]);
  }, 240_000);
});
