// Les documents du personnel de l'entreprise (1.72.0 ; docs/paie.md, « Les documents du personnel au Cabinet ») : ce que le
// Cabinet a appris, vérifié de l'autre côté (une règle apprise d'un côté se vérifie de l'autre). La civilité se renseigne sur
// la fiche du salarié (les documents la lisaient, aucun écran ne l'écrivait) ; un document qui la réclame le dit avant
// d'exporter, et son bouton ouvre la case, puis rend la main au document. Le solde de tout compte propose l'indemnité de
// congés non pris du moteur commun — celle que le document imprime, et que le Cabinet propose —, qui suit la date du document
// pour un salarié sans sortie ; il dit ce qui reste dû sur les avances, sans le retenir. Une sortie absente se dit avec son
// geste : la fiche s'ouvre dans la date, et le document revient sur le solde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown;
  indemniteConges: (d: unknown, salarie: string, jour: string) => { montant: number };
};

describe('les documents du personnel de l\'entreprise', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-docs-personnel-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

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

  it('la civilité renseignée depuis le document ; le solde propose l\'indemnité du moteur commun, qui suit la date, et dit les avances', async () => {
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const dossierV10 = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    // Un salarié encore en poste, sans civilité ; son bulletin de février 2026 ; une avance que rien n'a remboursée.
    const un = { id: 's1', name: 'Salarié Numéro Un', grossSalary: 1301.25, hireDate: '2025-03-10', contract: 'cdi', headOfFamily: false, children: 0,
      active: true, method: 'virement', iban: '', position: 'Boulanger' };
    expect(await dossierV10('employees', 's1', un)).toBe(200);
    const saisie = { gross: 1301.25, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
    const fevrier = { id: 'p-s1-2026-02', employeeId: 's1', year: 2026, month: 2, ...saisie, computed: compta.computePayslip(un, saisie, compta.baremesPaie({})),
      paidDate: '', accountId: '', method: 'virement', reference: '', issuedAt: '2026-02-28' };
    expect(await dossierV10('payslips', fevrier.id, fevrier)).toBe(200);
    expect(await dossierV10('advances', 'a1', { id: 'a1', employeeId: 's1', date: '2026-02-05', amount: 600.5, monthly: 200, method: 'virement', note: '' })).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Gérant Numéro Un' } }] })).statut).toBe(200);
    // Ce que le moteur commun propose, sans sortie, au 31 mars puis au 30 juin (deux chemins, un chiffre).
    const donnees = { employees: [un], payslips: [fevrier], leaves: [], payrollSettings: {} };
    const auMars = compta.indemniteConges(donnees, 's1', '2026-03-31').montant, auJuin = compta.indemniteConges(donnees, 's1', '2026-06-30').montant;
    expect([auMars, auJuin]).toEqual([225.216, 450.432]);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, patron);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    const fenetre = p.locator('#modal-root .modal').last();
    const titre = () => fenetre.locator('h2').first().innerText({ timeout: 500 }).catch(() => '');
    const lire = (sel: string) => fenetre.locator(sel).innerText().then((x) => x.replace(/[\u00a0\u202f]/g, ' '));
    await p.locator('#p-tabs button', { hasText: 'Registre' }).click();
    await p.locator('[data-hr="s1"]').click();
    await expect.poll(titre).toBe('Document pour Salarié Numéro Un');

    // ── La civilité : dite avant d'exporter ; le bouton ouvre la case ; enregistrée, le document revient ──────
    expect(await lire('#hf-civ')).toContain('Le document parlera de Salarié Numéro Un au masculin, sans « Madame » ni « Monsieur » : sa civilité n\'est pas renseignée.');
    expect(await fenetre.locator('#hf-gerant').count()).toBe(0);
    await fenetre.locator('#hf-civ-go').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('gender');
    await fenetre.locator('[name=gender]').selectOption('m');
    await fenetre.locator('#ok').click();
    await expect.poll(titre).toBe('Document pour Salarié Numéro Un');
    expect(await fenetre.locator('#hf-civ').count()).toBe(0);
    await expect.poll(async () => (await objets()).find((o) => o.collection === 'employees')?.contenu.gender).toBe('m');

    // ── Le solde : l'indemnité du moteur commun, qui suit la date du document tant qu'on n'y touche pas ──────
    await fenetre.locator('[name=kind]').selectOption('solde');
    const date = fenetre.locator('.datefield:has(input[name=date]) input:not([type=hidden])');
    const conges = () => fenetre.locator('#hf-lines tr').nth(1).locator('[data-f=amount]').inputValue();
    await date.fill('31/03/2026');
    await date.press('Tab');
    await expect.poll(conges).toBe(String(auMars));
    expect(await fenetre.locator('#hf-lines tr').nth(1).locator('[data-f=label]').inputValue()).toBe('Indemnité de congés non pris (4,5 jours)');
    await date.fill('30/06/2026');
    await date.press('Tab');
    await expect.poll(conges).toBe(String(auJuin));
    expect(await lire('#hf-avances')).toContain('Il reste 600,500 DT à rembourser sur ses avances. Ce document ne les retient pas');
    // Retouchée à la main, elle ne bouge plus.
    await fenetre.locator('#hf-lines tr').nth(1).locator('[data-f=amount]').fill('400');
    await date.fill('31/03/2026');
    await date.press('Tab');
    await p.waitForTimeout(300);
    expect(Number(await conges())).toBe(400);

    // ── La sortie : dite avec son geste ; la fiche s'ouvre dans la date ; enregistrée, le solde revient, sans l'alerte ──
    expect(await lire('#hf-desc')).toContain('Salarié Numéro Un n\'a pas de date de sortie : le document portera la date du jour.');
    await fenetre.locator('#hf-sortie-go').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.closest('.datefield')?.querySelector('input[type=hidden]')?.getAttribute('name'))).toBe('endDate');
    await p.keyboard.type('30/06/2026');
    await p.keyboard.press('Tab');
    await fenetre.locator('#ok').click();
    await expect.poll(titre).toBe('Document pour Salarié Numéro Un');
    expect(await fenetre.locator('[name=kind]').inputValue()).toBe('solde');
    expect(await fenetre.locator('#hf-sortie-go').count()).toBe(0);
    await expect.poll(async () => (await objets()).find((o) => o.collection === 'employees')?.contenu.endDate).toBe('2026-06-30');
    // La sortie arrête le compte des congés : au 30 juin, quel que soit le jour du document.
    await expect.poll(conges).toBe(String(auJuin));
    expect(erreurs).toEqual([]);
  }, 180_000);
});
