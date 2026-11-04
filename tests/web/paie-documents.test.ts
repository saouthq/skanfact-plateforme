// Les documents de la paie en aperçu fidèle (1.223.0 ; docs/maquettes/paie.html ; docs/paie.md, « La paie appliquée », lot 2).
// Ce que le parcours vérifie : le bulletin s'ouvre en aperçu (la feuille elle-même, puis « Exporter en PDF ») ; la fenêtre
// des documents du personnel montre la feuille à droite, et elle suit chaque choix ; les cinq documents nouveaux
// (contrat et avenant en PROJET, attestation de salaire des trois derniers mois, attestation annuelle, fin d'essai)
// reprennent les montants des bulletins, jamais tapés.

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
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown;
};

describe('la paie : les documents en aperçu fidèle', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-docs-'));
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
  const montant = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/[\u00a0\u202f]/g, ' ');

  it('le bulletin en aperçu, puis les documents du personnel : la feuille à droite suit chaque choix, les montants viennent des bulletins', async () => {
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    const auj = new Date();
    // Quatre mois de bulletins, au brut différent chaque mois (des montants qui discriminent) : l'attestation de
    // salaire ne doit en prendre que les TROIS derniers.
    const moisDe = (k: number) => { const d = new Date(Date.UTC(auj.getUTCFullYear(), auj.getUTCMonth() - k, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };
    const nadia = { id: 's1', name: 'Nadia Ben Salem', grossSalary: 1137.25, hireDate: '2023-01-09', contract: 'cdd', endDate: `${auj.getUTCFullYear() + 1}-06-30`,
      headOfFamily: false, children: 0, active: true, method: 'virement', iban: '08100123456789012359', cnss: '12345678-12', position: 'Vendeuse', gender: 'f', cin: '08412977' };
    expect(await poser('employees', nadia.id, nadia)).toBe(200);
    const bruts = [1013.5, 1078.25, 1137.25, 1201.75];
    const bulletins = [4, 3, 2, 1].map((k, i) => {
      const { y, m } = moisDe(k);
      const saisie = { gross: bruts[i], workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${y}-${m}`, employeeId: nadia.id, year: y, month: m, ...saisie, computed: compta.computePayslip(nadia, saisie, compta.baremesPaie({})),
        paidDate: `${y}-${String(m).padStart(2, '0')}-28`, accountId: '', method: 'virement', reference: '', issuedAt: `${y}-${String(m).padStart(2, '0')}-28` };
    });
    for (const b of bulletins) expect(await poser('payslips', b.id, b)).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Gérant Numéro Un', address: 'Rue du Port\n2000 Le Bardo' } }] })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, patron);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    const dernier = bulletins[3] as (typeof bulletins)[number];
    await p.locator('#p-tabs [data-tab="bulletins"]').click(); // (1.267.0) la bande des mois est sur « Le mois »
    for (let i = 0; i < 6 && Number(await p.locator('#p-an').innerText()) !== Number(dernier.year); i++) await p.locator(Number(await p.locator('#p-an').innerText()) > Number(dernier.year) ? '#p-an-prec' : '#p-an-suiv').click();
    await p.locator(`#p-mois [data-p-mois="${dernier.month}"]`).click();
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    const feuille = (cadre: string) => p.frameLocator(`${cadre} iframe`).locator('body');
    const lireFeuille = async (cadre: string) => espace(await feuille(cadre).innerText().catch(() => ''));

    // ── Le bulletin : « Bulletin » sur sa ligne ouvre la feuille elle-même (1.248.1 : le menu ne le répète plus) ────────
    await p.locator('#p-bulletins tr[data-bul] [data-voir-b]').first().click();
    // (1.256.0) « Bulletin » ouvre le bulletin en grand (la maquette) ; « Le document » ouvre la feuille A4.
    await p.locator('#modal-root #bg-doc').click();
    await expect.poll(() => lireFeuille('#ad-apercu')).toContain('Nadia Ben Salem');
    expect(await lireFeuille('#ad-apercu')).toContain(montant(Number(dernier.computed.net)));
    expect(espace(await p.locator('.modal.pa-doc h2').innerText())).toMatch(/^Nadia Ben Salem · bulletin de \S+ \d{4}$/);
    expect(await p.locator('.modal.pa-doc #ad-pdf').count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-apercu-bulletin.png') });
    await p.locator('.modal.pa-doc [data-close]').click();
    await p.locator('#modal-root .modal').last().locator('[data-close]').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);

    // ── Les documents du personnel : la fenêtre montre la feuille à droite ──────────────────────────────────────
    await p.locator('#p-tabs [data-tab="salaries"]').click();
    await p.locator('#p-plus').click(); await p.getByText('Registre du personnel', { exact: true }).click();
    await p.locator('[data-hr="s1"]').click();
    const fen = p.locator('.modal.pa-doc');
    await expect.poll(() => fen.locator('h2').first().innerText()).toBe('Document pour Nadia Ben Salem');
    // (1.249.0) Le choix se fait en cartes (recette du 02/11 : une liste déroulante cachait les huit documents).
    const options = await fen.locator('[data-hf-kind]').allInnerTexts();
    expect(options).toEqual(['Contrat de travail', 'Avenant au contrat', 'Attestation de travail', 'Certificat de travail', 'Attestation de salaire',
      'Attestation de salaires et de retenues', 'Fin de période d\'essai', 'Solde de tout compte']);

    // L'attestation de salaire : les trois DERNIERS mois, brut et net des bulletins.
    await fen.locator('[data-hf-kind="salaire"]').click();
    await expect.poll(() => lireFeuille('#hf-apercu')).toContain('ATTESTATION DE SALAIRE');
    const att = await lireFeuille('#hf-apercu');
    for (const b of bulletins.slice(1)) expect(att).toContain(`${montant(Number(b.computed.gross))} ${montant(Number(b.computed.net))}`);
    expect(att).not.toContain(montant(Number((bulletins[0] as (typeof bulletins)[number]).computed.gross)));
    expect(att).toContain('Madame Nadia Ben Salem');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-apercu-attestation-salaire.png') });

    // L'attestation annuelle : la somme des bulletins de l'année en cours.
    await fen.locator('[data-hf-kind="annuelle"]').click();
    await expect.poll(() => lireFeuille('#hf-apercu')).toContain('ATTESTATION DE SALAIRES ET DE RETENUES');
    const annee = Number(String(new Date().toISOString()).slice(0, 4));
    const deLAnnee = bulletins.filter((b) => b.year === annee);
    const som = (f: string) => Math.round(deLAnnee.reduce((a, b) => a + Number(b.computed[f]), 0) * 1000) / 1000;
    const ann = await lireFeuille('#hf-apercu');
    expect(ann).toContain(`Salaire brut ${montant(som('gross'))}`);
    expect(ann).toContain(`Retenue CNSS (part du salarié) ${montant(som('cnssEmployee'))}`);
    expect(ann).toContain(`Net versé ${montant(som('net'))} DT`);

    // Le contrat : un PROJET, depuis la fiche (le CDD et sa date de fin, le salaire).
    await fen.locator('[data-hf-kind="contrat"]').click();
    await expect.poll(() => lireFeuille('#hf-apercu')).toContain('PROJET');
    const ctr = await lireFeuille('#hf-apercu');
    expect(ctr).toContain('Contrat à durée déterminée, du 09/01/2023 au 30/06/');
    expect(ctr).toContain(`Un salaire brut mensuel de ${montant(1137.25)} DT`);
    expect(ctr).toContain('Le salarié — lu et approuvé');
    // L'avenant et la fin d'essai existent, et se dessinent.
    await fen.locator('[data-hf-kind="avenant"]').click();
    await expect.poll(() => lireFeuille('#hf-apercu')).toContain('AVENANT AU CONTRAT');
    await fen.locator('[data-hf-kind="essai"]').click();
    await expect.poll(() => lireFeuille('#hf-apercu')).toContain('Votre période d\'essai');
    expect(erreurs).toEqual([]);
  }, 240_000);
});
