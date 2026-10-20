// La fenêtre d'une avance de l'entreprise (1.71.0 ; docs/paie.md, « Les avances au Cabinet »). Les règles de la fenêtre du
// Cabinet, vérifiées de l'autre côté (une règle apprise d'un côté se vérifie de l'autre) : ce qui est remboursé se lit sur
// les bulletins du salarié, donc une avance déjà retenue ne change plus de salarié (elle se lirait non remboursée chez
// l'autre) et son montant ne descend pas sous ce qui a été retenu ; après la sortie du salarié, aucun bulletin ne la
// retiendrait. Ce que le parcours vérifie, écran ET serveur : chacun se refuse, sur sa case, et rien ne change au dossier.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
type Reglages = Record<string, unknown>;
const ecran = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: Record<string, unknown>, i: Record<string, unknown>, s: Reglages) => Record<string, unknown>; baremesPaie: (r: Reglages) => Reglages };

describe('la fenêtre d\'une avance de l\'entreprise', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-avance-fenetre-'));
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
  // Un nombre non entier part en texte exact, comme le point de contact l'écrit.
  const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  it('une avance déjà retenue ne change plus de salarié ni ne descend sous ce qui a été retenu ; rien après la sortie', async () => {
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const dossierV10 = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    const un = { id: 's1', name: 'Salarié Numéro Un', grossSalary: 1234.567, hireDate: '2025-01-01', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' };
    expect(await dossierV10('employees', 's1', un)).toBe(200);
    expect(await dossierV10('employees', 's2', { ...un, id: 's2', name: 'Salarié Numéro Deux', grossSalary: 980, hireDate: '2024-02-01', endDate: '2025-11-30' })).toBe(200);
    expect(await dossierV10('advances', 'a1', { id: 'a1', employeeId: 's1', date: '2025-10-05', amount: 1000.75, monthly: 300.125, method: 'virement', note: '' })).toBe(200);
    // Le bulletin d'octobre en a retenu la première échéance.
    const saisie = { gross: 1234.567, workedDays: 26, absentDays: 0, bonuses: [], deductions: [{ label: 'Remboursement d\'avance du 05/10/2025', amount: 300.125, advanceId: 'a1' }] };
    expect(await dossierV10('payslips', 'p10', { id: 'p10', employeeId: 's1', year: 2025, month: 10, ...saisie, computed: ecran.computePayslip(un, saisie, ecran.baremesPaie({})),
      paidDate: '', accountId: '', method: 'virement', reference: '', issuedAt: '2025-10-31' })).toBe(200);
    // L'assistant de démarrage déjà fait : la page s'ouvre sur la paie.
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true } }] })).statut).toBe(200);
    const avances = async () => (await objets()).filter((o) => o.collection === 'advances').map((o) => o.contenu);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, patron);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#p-tabs button', { hasText: 'Avances' }).click();
    await p.locator('[data-av="a1"]').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Modifier l\'avance');
    const toast = () => p.locator('#toast').innerText().catch(() => '');

    // Sous ce qui a été retenu : refusé, sur sa case.
    await fenetre.locator('[name=amount]').fill('200');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toMatch(/^300,125\s\S+ ont déjà été retenus sur des bulletins : le montant avancé ne descend pas en dessous\.$/);
    expect(await p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('amount');
    await fenetre.locator('[name=amount]').fill('1000.75');
    // D'un salarié à l'autre : refusé.
    await fenetre.locator('[data-combo=employeeId] .combo-btn').click();
    await fenetre.locator('[data-combo=employeeId] .combo-q').fill('Deux');
    await fenetre.locator('[data-combo=employeeId] .combo-list [role=option]').first().click();
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toMatch(/^300,125\s\S+ ont déjà été retenus sur les bulletins de Salarié Numéro Un : l'avance ne change plus de salarié\.$/);
    expect(await avances()).toMatchObject([{ id: 'a1', employeeId: 's1' }]);
    await p.keyboard.press('Escape');
    for (let i = 0; i < 2 && await p.getByRole('button', { name: 'Abandonner', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Abandonner', exact: true }).click();
    }
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);

    // Après la sortie du salarié : refusée.
    await p.locator('#new-av').click();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Avance sur salaire');
    await fenetre.locator('[data-combo=employeeId] .combo-btn').click();
    await fenetre.locator('[data-combo=employeeId] .combo-q').fill('Deux');
    await fenetre.locator('[data-combo=employeeId] .combo-list [role=option]').first().click();
    await fenetre.locator('.datefield:has(input[name=date]) input:not([type=hidden])').fill('05/12/2025');
    await fenetre.locator('.datefield:has(input[name=date]) input:not([type=hidden])').press('Tab');
    await fenetre.locator('[name=amount]').fill('100');
    await fenetre.locator('[name=monthly]').fill('50');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('La sortie de Salarié Numéro Deux est le 30/11/2025 : aucun bulletin ne retiendrait une avance versée après.');
    expect((await avances()).map((a) => a.id)).toEqual(['a1']);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
