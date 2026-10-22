// Une écriture datée après aujourd'hui le dit avant le geste (1.102.0 ; docs/recette.md, « 1.102.0 »), à la souris. Le
// client établit le bulletin d'octobre le 21 ; son écriture de paie est datée du 31, et la base refuse de la valider avant
// ce jour-là (son numéro suit l'ordre des jours). Leïla, au Cabinet, le 21/10/2026 :
//   - la Paie nomme le jour où l'écriture se validera, sans « La valider dans la saisie » ;
//   - au brouillard, les lots ne comptent que ce qui se valide aujourd'hui, et nomment la pièce qui attend son jour ;
//   - au menu de la ligne, « Valider cette écriture » est grisé avec sa date, et le dit au clic ;
//   - le lot du mois ne valide que les pièces du jour ;
//   - le 02/11/2026, « La valider dans la saisie » revient, et mène AU brouillard (il ouvrait le haut de la grille).
// L'horloge du navigateur est fixée : le test ne dépend pas du jour où il tourne.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('une écriture datée après aujourd\'hui le dit avant le geste, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-pas-avant-'));
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

  it('la Paie, le brouillard et le menu disent le jour ; le lot ne valide que la pièce du jour', async () => {
    const personne = async (qui: string) => {
      const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
      await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
      const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
      await api('POST', '/moi/code', jeton, { methode: 'application' });
      return jeton;
    };
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Quincaillerie du Port' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila);

    // Le 21/10/2026, des frais de banque (BQ, du jour) ; et le bulletin d'octobre, payé le 21 : son écriture de paie tombe
    // au 31/10.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [
      { collection: 'accounts', cle: 'k-banque', rang: 0, revision: null,
        contenu: { id: 'k-banque', name: 'BIAT', kind: 'banque', bank: '', rib: '', opening: 0, openingDate: '2026-10-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'movements', cle: 'm1', rang: 0, revision: null,
        contenu: { id: 'm1', date: '2026-10-21', kind: 'banque', amount: { '~n': '7.125' }, accountId: 'k-banque', method: 'virement', label: 'Frais de tenue de compte' } },
    ] })).statut).toBe(200);
    const compta = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => unknown; baremesPaie: (r: unknown) => unknown };
    const salarie = { id: 's1', name: 'Salarié Numéro Un', grossSalary: 1250, hireDate: '2026-01-02', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' };
    const bulletin = { id: 'b-s1-2026-10', employeeId: 's1', year: 2026, month: 10, gross: 1250, workedDays: 26, absentDays: 0, bonuses: [], deductions: [],
      computed: compta.computePayslip(salarie, { gross: 1250, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] }, compta.baremesPaie({})),
      issuedAt: '2026-10-21', paidDate: '', accountId: '', method: 'virement', reference: '' };
    for (const [collection, cle, contenu] of [['employees', 's1', salarie], ['payslips', bulletin.id, bulletin]] as const) {
      expect((await api('POST', `/entreprises/${ent}/paie/dossier`, client, { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut).toBe(200);
    }
    // Et une pièce d'OD du jour, saisie au Cabinet : le lot du mois d'octobre réunit l'OD, la BQ… et la paie qui attend.
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, leila, { date: '2026-10-21', journal: 'OD', piece: 'OD-1', libelle: 'Honoraires à payer',
      lignes: [{ compte: '6226', debit: '150,000', credit: '' }, { compte: '401', debit: '', credit: '150,000' }] })).statut).toBe(201);

    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(new Date('2026-10-21T10:00:00+01:00'));
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/paie/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();

    // 1. La Paie : au brouillard, datée du 31/10/2026, elle se valide à partir de ce jour-là ; aucun bouton n'y mène avant.
    const auBrouillard = p.locator('#pa-brouillard');
    await expect.poll(() => auBrouillard.innerText().then((t) => t.replace(/\s+/g, ' ')).catch(() => ''), { timeout: 15_000 }).toMatch(/au brouillard, datée du 31\/10\/2026 : elle se valide à partir de ce jour-là/);
    expect(await p.locator('#pa-valider').count()).toBe(0);
    expect(await p.locator('#c-livres .btn-primary').count()).toBe(0);

    // 2. Le brouillard : les lots ne comptent que les pièces du jour (BQ, OD, et octobre pour les deux) ; la pièce de paie
    //    est nommée, avec son jour.
    await p.evaluate((h) => { location.hash = h; }, `#/dossier/${ent}/comptabilite/saisie/2026`);
    const lots = p.locator('.sa-lot button');
    await expect.poll(() => lots.allInnerTexts(), { timeout: 15_000 }).toEqual(['Valider la seule pièce de BQ', 'Valider la seule pièce d\'OD', 'Valider les 2 pièces d\'octobre 2026']);
    expect((await p.locator('#sa-attend').innerText()).replace(/\s+/g, ' ')).toMatch(/^L'écriture \S+ du journal PAIE est datée du 31\/10\/2026 : elle se valide à partir de ce jour-là\.$/);

    // 3. Au menu de la ligne de paie, « Valider cette écriture » est grisé avec sa date, et le dit au clic.
    const lignePaie = p.locator('tr.br-ligne', { hasText: 'PAIE' });
    await lignePaie.getByRole('button', { name: /Actions/ }).click();
    const valider = p.locator('.row-menu').last().getByRole('menuitem').filter({ hasText: 'Valider cette écriture' });
    await expect.poll(() => valider.getAttribute('class')).toMatch(/\boff\b/);
    expect(await valider.innerText()).toContain('À partir du 31/10/2026, sa date');
    await valider.click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Pas avant le 31/10/2026');
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();

    // 4. Le lot d'octobre ne demande et ne valide que les pièces du jour : rien n'« est pas entré ».
    await lots.last().click();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Valider 2 écritures d\'octobre 2026 ?');
    await fenetre.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').last().innerText()).toMatch(/2 écritures validées sous les n° \d+ à \d+\./);
    expect(await p.locator('#modal-root .modal').last().innerText()).not.toMatch(/pas entrée/);
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Fermer', exact: true }).click();
    // Il ne reste que la pièce de paie : pas de lot, pas de phrase de lot sans bouton, mais son jour.
    await expect.poll(() => p.locator('tr.br-ligne').count()).toBe(1);
    expect(await p.locator('.sa-lot').count()).toBe(0);
    expect(await p.locator('#sa-attend').count()).toBe(1);

    // 5. Le 02/11/2026 : « La valider dans la saisie » revient à la Paie, et mène AU brouillard.
    await cx.clock.setFixedTime(new Date('2026-11-02T10:00:00+01:00'));
    await p.evaluate((h) => { location.hash = h; }, `#/dossier/${ent}/comptabilite/paie/2026`);
    await p.reload();
    await p.locator('#pa-valider').waitFor({ timeout: 15_000 });
    expect(await p.locator('#pa-valider').getAttribute('class')).toMatch(/\bbtn-primary\b/);
    await p.locator('#pa-valider').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/comptabilite\/saisie\//);
    // Amené à l'écran (le haut du brouillard visible), pas forcément en haut : sur une page courte, la fin du défilement
    // l'arrête plus bas (sur GitHub, d'autres polices : « moins d'une demi-fenêtre » tombait sans défaut).
    await expect.poll(() => p.evaluate(() => { const r = document.querySelector('#sa-brouillard')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.top < innerHeight - 80; }), { timeout: 10_000 }).toBe(true);
    expect(await lots.allInnerTexts()).toEqual(['Valider la seule pièce de PAIE']);
    expect(await p.locator('#sa-attend').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
