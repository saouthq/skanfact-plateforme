// Payer les salaires du mois, à la souris (1.74.0 ; docs/paie.md, « Payer les salaires du mois »). Dans l'entreprise, les
// bulletins non payés du mois : « Payer les salaires… » ouvre leur fenêtre. Ce que le parcours vérifie, écran ET serveur :
//   - ce qui manque à un virement se dit avant le geste : un salarié sans RIB (son bouton ouvre sa fiche sur la case ; le
//     RIB s'y contrôle à la saisie ; enregistrée, la fenêtre revient comme on l'a laissée), un salarié payé en espèces, le
//     compte sans RIB ;
//   - l'ordre de virement porte les lignes cochées payées par virement, leur total en chiffres et en lettres ;
//   - « Marquer payés » pose le jour et le compte sur les bulletins cochés, au serveur ; « Annuler » le défait.

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
const core = ecranDeLaPlateforme('core.js') as { amountToWords: (n: number, devise: string) => string };
const RIB_UN = '08100123456789012359';
const RIB_DEUX = '10045000001234567883';

describe('payer les salaires du mois, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-virement-'));
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

  it('les manques dits avant le geste, le RIB renseigné depuis la fenêtre, l\'ordre de virement, marquer payés puis annuler', async () => {
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const dossierV10 = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    // Le mois de paie d'une entreprise neuve : le mois écoulé (la page s'ouvre sur lui).
    const auj = new Date();
    const annee = auj.getUTCMonth() === 0 ? auj.getUTCFullYear() - 1 : auj.getUTCFullYear(), mois = auj.getUTCMonth() === 0 ? 12 : auj.getUTCMonth();
    const salarie = (id: string, name: string, grossSalary: number, method: string, iban: string) => ({ id, name, grossSalary, hireDate: '2025-03-10', contract: 'cdi',
      headOfFamily: false, children: 0, active: true, method, iban, position: 'Boulanger' });
    const une = salarie('s1', 'Salariée Numéro Une', 1301.25, 'virement', RIB_UN);
    const deux = salarie('s2', 'Salarié Numéro Deux', 1187.5, 'virement', '');
    const trois = salarie('s3', 'Salarié Numéro Trois', 950.75, 'especes', '');
    const bulletins = [une, deux, trois].map((e) => {
      const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${e.id}`, employeeId: e.id, year: annee, month: mois, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})),
        paidDate: '', accountId: '', method: e.method, reference: '', issuedAt: `${annee}-${String(mois).padStart(2, '0')}-28` };
    });
    for (const e of [une, deux, trois]) expect(await dossierV10('employees', e.id, e)).toBe(200);
    for (const b of bulletins) expect(await dossierV10('payslips', b.id, b)).toBe(200);
    // Un compte en banque, sans RIB pour commencer.
    expect(await dossierV10('accounts', 'c1', { id: 'c1', name: 'Banque du Port — compte courant', kind: 'banque', bank: 'Banque Numéro Une', rib: '', opening: 0,
      openingDate: '2025-01-01', isDefault: true, statementBalance: '', notes: '' })).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Gérant Numéro Un', address: 'Rue du Port\n2000 Le Bardo' } }] })).statut).toBe(200);
    const net = (b: (typeof bulletins)[number] | undefined) => Number(b?.computed.net);

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
    const lire = (sel: string) => fenetre.locator(sel).innerText().then((x) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim());
    const periode = new Date(Date.UTC(annee, mois - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    // ── Sans le nom de la société, l'ordre ne dirait pas qui l'envoie : la fenêtre le dit, l'ordre est éteint, et le bouton
    //    ouvre la fiche société sur la case ──────────────────────────────────────────────────────────────────
    if (await p.locator('#p-year').inputValue() !== String(annee)) await p.locator('#p-year').selectOption(String(annee));
    await p.locator('#p-month').selectOption(String(mois));
    await p.locator('#p-payer').click();
    await expect.poll(async () => (await titre()).startsWith(`Payer les salaires de ${periode}`)).toBe(true);
    expect(await lire('#ps-societe')).toBe('Le nom de ta société n\'est pas sur ta fiche : l\'ordre de virement ne dirait pas qui l\'envoie. Renseigner ta fiche…');
    expect(await fenetre.locator('#ps-ordre').isDisabled()).toBe(true);
    await fenetre.locator('#ps-societe-go').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/parametres');
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('name');
    await p.keyboard.type('Boulangerie du Port');
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(async () => (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company')?.contenu.name).toBe('Boulangerie du Port');
    await p.evaluate(() => { location.hash = '#/paie'; });
    await p.locator('#p-tabs').waitFor();

    // ── L'étape suivante : tous les bulletins établis, « Payer les salaires… » est le bouton principal ──────
    // La page s'ouvre sur le mois dont les bulletins restent à établir ; ceux de l'essai sont du mois d'avant.
    // (En janvier, le mois d'avant est de l'année d'avant.)
    if (await p.locator('#p-year').inputValue() !== String(annee)) await p.locator('#p-year').selectOption(String(annee));
    await p.locator('#p-month').selectOption(String(mois));
    const payer = p.locator('#p-payer');
    await payer.waitFor();
    expect(await payer.getAttribute('class')).toContain('btn-primary');
    expect(await p.locator('#p-body .btn-primary').count()).toBe(1);
    await payer.click();
    await expect.poll(async () => (await titre()).startsWith(`Payer les salaires de ${periode}`)).toBe(true);
    expect(await fenetre.locator('tr[data-ps]').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.ps))).toEqual(['p-s2', 'p-s3', 'p-s1']);
    expect(await lire('#ps-hors')).toBe('L\'ordre de virement ne portera pas Salarié Numéro Deux (RIB à renseigner), Salarié Numéro Trois (espèces).');
    expect(await lire('#ps-compte-rib')).toBe('Le compte « Banque du Port — compte courant » n\'a pas de RIB : l\'ordre ne dira pas quel compte débiter. Renseigner son RIB…');
    expect(await lire('#ps-compte')).toBe('3 salaires sur 3');

    // ── Le RIB du salarié : sa fiche s'ouvre sur la case ; une clé fausse se dit ; enregistrée, la fenêtre revient ─────
    // Décocher une ligne ne pousse rien sous le curseur : les boutons de la fenêtre restent où ils sont.
    const yAvant = (await fenetre.locator('#ps-payer').boundingBox())?.y;
    await fenetre.locator('[data-ps-c="p-s3"]').uncheck();
    expect(await lire('#ps-compte')).toBe('2 salaires sur 3');
    expect((await fenetre.locator('#ps-payer').boundingBox())?.y).toBe(yAvant);
    await fenetre.locator('[data-ps-rib="s2"]').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('iban');
    await fenetre.locator('[name=iban]').fill('10045000001234567882');
    await expect.poll(() => fenetre.locator('.rib-note').first().innerText()).toBe('clé incorrecte');
    await fenetre.locator('[name=iban]').fill(RIB_DEUX);
    await expect.poll(() => fenetre.locator('.rib-note').first().innerText()).toBe('');
    await fenetre.locator('#ok').click();
    await expect.poll(async () => (await titre()).startsWith(`Payer les salaires de ${periode}`)).toBe(true);
    // La fenêtre revient comme on l'a laissée : la ligne décochée l'est restée ; le RIB est là.
    expect(await fenetre.locator('[data-ps-c="p-s3"]').isChecked()).toBe(false);
    expect(await lire('tr[data-ps="p-s2"] td:nth-child(4)')).toBe(RIB_DEUX);
    expect(await lire('#ps-hors')).toBe('L\'ordre de virement ne portera pas Salarié Numéro Trois (espèces).');

    // ── Le RIB du compte, depuis la fenêtre ; puis l'ordre de virement ──────────────────────────────────
    await fenetre.locator('#ps-compte-go').click();
    await expect.poll(titre).toBe('Modifier le compte');
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('rib');
    await fenetre.locator('[name=rib]').fill(RIB_UN);
    await fenetre.locator('#ok').click();
    await expect.poll(async () => (await titre()).startsWith(`Payer les salaires de ${periode}`)).toBe(true);
    expect(await fenetre.locator('#ps-compte-rib').count()).toBe(0);
    const total = Math.round((net(bulletins[0]) + net(bulletins[1])) * 1000) / 1000;
    const [ordre] = await Promise.all([p.waitForEvent('popup'), fenetre.locator('#ps-ordre').click()]);
    await expect.poll(() => ordre.content()).toContain('<h1>Ordre de virement</h1>');
    const texte = (await ordre.content()).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ');
    expect(texte).toMatch(/^ ?Ordre de virement — salaires de .+ Boulangerie du Port Rue du Port 2000 Le Bardo À l'attention de Banque Numéro Une /);
    expect(texte).toContain(`par le débit de notre compte n° ${RIB_UN}`);
    expect(texte).toContain(`Salarié Numéro Deux ${RIB_DEUX}`);
    expect(texte).toContain(`Salariée Numéro Une ${RIB_UN}`);
    expect(texte).not.toContain('Salarié Numéro Trois');
    expect(texte).toContain('Total (2 virements)');
    expect(texte).toContain(core.amountToWords(total, 'DT').replace(/[\u00a0\u202f]/g, ' '));
    expect(texte).toContain('Le Bardo, le');
    await ordre.close();
    await p.screenshot({ path: path.join(PHOTOS, 'paie-virement-fenetre.png') });

    // ── Marquer payés : le jour et le compte sur les deux bulletins cochés, au serveur ; « Annuler » le défait ──────
    await fenetre.locator('#ps-payer').click();
    const payes = async () => (await objets()).filter((o) => o.collection === 'payslips').map((o) => [o.cle, o.contenu.paidDate, o.contenu.accountId]).sort();
    await expect.poll(payes, { timeout: 15_000 }).toEqual([['p-s1', expect.any(String), 'c1'], ['p-s2', expect.any(String), 'c1'], ['p-s3', '', '']]);
    const dates = (await payes()).slice(0, 2).map((x) => x[1]);
    expect(dates[0]).toBe(dates[1]);
    expect(String(dates[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await p.locator('#toast').innerText()).toMatch(/^2 salaires de .+ marqués payés le \d{2}\/\d{2}\/\d{4}/);
    // La ligne restante garde son bouton ; l'étape suivante reste de la payer.
    expect(await p.locator('#p-payer').count()).toBe(1);
    await p.locator('#toast-undo').click();
    await expect.poll(payes, { timeout: 15_000 }).toEqual([['p-s1', '', ''], ['p-s2', '', ''], ['p-s3', '', '']]);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
