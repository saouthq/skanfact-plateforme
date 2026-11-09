// (1.330.0) Joué au Cabinet (Leïla) sur la boulangerie : Sarra avait validé octobre (chacun présent à ses horaires, aucune
// grille), établi, payé et remis les deux bulletins ; le Cabinet disait « 1 sur 2 salariés pointés », « Un mois sans
// pointage », deux paires de boutons « Le demander / Le renseigner » sans dire à qui, et « préparé » sur chaque bulletin.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le pointage validé par le client, lu au Cabinet (1.330.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-pointage-1330-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js).
  const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const page = async (jeton: string, erreurs: string[]) => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return p;
  };


  it('octobre validé, payé et remis par le client : le Cabinet dit « validé par », nomme chaque salarié sans n° CNSS, et « payé, remis »', async () => {
    const associe = await personne('associe');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps;
    const cabinet = String(cab.id);
    const patron = await personne('client');
    const boulangerie = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${boulangerie}/mandat`, patron, { codeCabinet: cab.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${boulangerie}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);
    const ecran = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, unknown>; baremesPaie: (r: unknown) => unknown };
    const salarie = (id: string, name: string, grossSalary: number) =>
      ({ id, name, grossSalary, hireDate: '2023-03-01', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'especes', iban: '', cnss: '', primes: [] });
    const S1 = salarie('s1', 'Hédi Trabelsi', 1250), S2 = salarie('s2', 'Amira Ben Salah', 600);
    const bulletin = (e: typeof S1) => { const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `b-${e.id}`, employeeId: e.id, year: 2026, month: 10, ...saisie, computed: ecran.computePayslip(e, saisie, ecran.baremesPaie({})),
        paidDate: '2026-11-03', remisLe: '2026-11-03', accountId: '', method: 'especes', reference: '', issuedAt: '2026-11-03' }; };
    const client = async (changements: { collection: string; cle: string; contenu: unknown }[]) => (await api('POST', `/entreprises/${boulangerie}/dossier-v10`, patron,
      { changements: changements.map((c) => ({ ...c, rang: null, revision: null, contenu: encoder(c.contenu) })) })).statut;
    expect(await client([{ collection: 'employees', cle: 's1', contenu: S1 }, { collection: 'employees', cle: 's2', contenu: S2 }])).toBe(200);
    // Octobre validé : la version figée nomme les deux, aucune grille (chacun présent à ses horaires).
    expect(await client([{ collection: 'pointageVersions', cle: 'v1', contenu: { id: 'v1', ym: '2026-10', le: '2026-11-02T10:00:00.000Z', note: '',
      instant: { s1: { nom: 'Hédi Trabelsi', jours: {} }, s2: { nom: 'Amira Ben Salah', jours: {} } } } }])).toBe(200);
    expect(await client([{ collection: 'payslips', cle: 'b-s1', contenu: bulletin(S1) }, { collection: 'payslips', cle: 'b-s2', contenu: bulletin(S2) }])).toBe(200);

    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${boulangerie}/comptabilite/paie/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('10');
    const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    // La frise : le pointage validé par le client, avec son jour.
    await expect.poll(async () => espace(await p.locator('#pa-frise li').first().innerText()), { timeout: 15_000 }).toMatch(/^✓ Pointage validé par .+ le 02\/11$/);
    // Les contrôles : le pointage repris sur chaque bulletin, plus de « mois sans pointage ».
    const controles = espace(await p.locator('#pa-controles').innerText());
    expect(controles).toContain('Pointage repris sur chaque bulletin');
    expect(controles).not.toContain('Un mois sans pointage');
    // Deux salariés sans n° CNSS : chaque bouton nomme le sien.
    expect((await p.locator('#pa-controles [data-sal-cnss]').allInnerTexts()).map(espace).sort()).toEqual(['Le renseigner (Amira)…', 'Le renseigner (Hédi)…']);
    // Chaque bulletin payé et remis par le client le dit.
    expect((await p.locator('tr[data-bul] .badge').allInnerTexts()).map(espace)).toEqual(['payé, remis', 'payé, remis']);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
