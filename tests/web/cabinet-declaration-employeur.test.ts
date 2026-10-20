// La déclaration annuelle d'employeur au Cabinet, à la souris (1.73.0 ; docs/paie.md, « La déclaration annuelle d'employeur au
// Cabinet »). La Liasse d'un dossier tenu : l'état des salaires par salarié, lu sur les bulletins de l'exercice par la fonction
// de l'entreprise, et les masses du livre, chacune avec son écart aux bulletins. Ce que le parcours vérifie, écran ET serveur :
//   - sans bulletin, l'état le dit, et la phrase de la v10 (« que le cabinet ne reçoit pas ») a disparu ;
//   - les bulletins écrits, l'état porte chaque salarié (sa CIN, ou « à renseigner ») et les totaux du moteur commun ;
//   - la paie au brouillard, les salaires et les retenues du livre disent leur écart et sa cause ; validée, plus d'écart ;
//   - un versement au Trésor ne change pas les retenues de l'exercice (la v10 lisait le solde du compte : ce qui reste à verser) ;
//   - l'état s'exporte en CSV, aux colonnes de l'entreprise, avec son total.

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
type Salaires = { gross: number; cnss: number; irpp: number; css: number; net: number; rows: { name: string; gross: number }[] };
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown;
  salairesDeLAnnee: (d: unknown, annee: number) => Salaires;
};
// « 1 234,567 DT » : le montant affiché, en millimes.
const millimes = (t: string) => Math.round(Number(t.replace(/[\s\u00a0\u202f]|DT/g, '').replace(',', '.')) * 1000);

describe('la déclaration annuelle d\'employeur au Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-employeur-'));
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

  it('un dossier tenu : l\'état des salaires par salarié, les écarts du livre au brouillard puis validé, les retenues après un versement, le CSV', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie du Port' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const panneau = p.locator('#li-employeur');
    const aller = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/liasse/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
      await panneau.waitFor({ timeout: 15_000 });
    };
    const lire = (loc: ReturnType<typeof p.locator>) => loc.innerText().then((x) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim());
    const montantDeLaCase = async (id: string) => millimes(await panneau.locator(`#li-cases tr[data-case=${id}] td`).last().innerText());

    // ── Sans bulletin : l'état le dit, sans la phrase de la v10 ─────────────────────────────────────
    await aller();
    expect(await lire(panneau.locator('#li-sal-vide'))).toBe('Aucun bulletin sur l\'exercice 2026 dans la paie de ce dossier : l\'état par salarié se lit sur ses bulletins (onglet Paie). Une paie établie ailleurs se confronte aux masses du livre, ci-dessous.');
    expect(await panneau.innerText()).not.toContain('ne reçoit pas');

    // ── Deux salariés, leurs bulletins de janvier et février : le serveur en écrit la paie au brouillard ──────
    const une = { id: 's1', name: 'Salariée Numéro Une', cin: '07123456', cnss: '12345678-90', position: 'Comptable', grossSalary: 1301.25,
      hireDate: '2025-03-10', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' };
    const deux = { id: 's2', name: 'Salarié Numéro Deux', cin: '', cnss: '', position: 'Livreur', grossSalary: 2345.678,
      hireDate: '2025-06-01', contract: 'cdi', headOfFamily: true, children: 2, active: true, method: 'virement', iban: '' };
    const bulletin = (e: typeof une, mois: number) => {
      const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${e.id}-2026-0${mois}`, employeeId: e.id, year: 2026, month: mois, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})),
        issuedAt: `2026-0${mois}-28`, paidDate: '', accountId: '', method: 'virement', reference: '' };
    };
    const bulletins = [bulletin(une, 1), bulletin(une, 2), bulletin(deux, 2)];
    const ecrire = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/paie/dossier`, associe,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    expect(await ecrire('employees', 's1', une)).toBe(200);
    expect(await ecrire('employees', 's2', deux)).toBe(200);
    for (const b of bulletins) expect(await ecrire('payslips', b.id, b)).toBe(200);
    // Ce que l'entreprise déclarerait, sur les mêmes bulletins (deux chemins, un chiffre).
    const attendu = compta.salairesDeLAnnee({ employees: [une, deux], payslips: bulletins }, 2026);
    expect(attendu.rows.map((r) => r.name)).toEqual(['Salarié Numéro Deux', 'Salariée Numéro Une']);

    // ── L'état par salarié ; la paie au brouillard : le livre ne porte rien, chaque masse dit son écart ──────
    await aller();
    const salaires = panneau.locator('#li-salaires');
    await salaires.waitFor();
    const lignes = await salaires.locator('tbody tr').evaluateAll((l) => l.map((x) => [...x.querySelectorAll('td')].map((c) => (c as HTMLElement).innerText.replace(/[\u00a0\u202f]/g, ' ').trim())));
    expect(lignes.map((l) => [(l[0] ?? '').split('\n')[0], l[1], l[2]])).toEqual([['Salarié Numéro Deux', 'à renseigner', '1'], ['Salariée Numéro Une', '07123456', '2']]);
    // Le texte du pied, pas son rendu (le style le met en capitales).
    const totaux = await salaires.locator('tfoot th').allTextContents();
    expect(totaux[0]).toBe('2 salariés');
    expect(totaux.slice(1).map(millimes)).toEqual([attendu.gross, attendu.cnss, attendu.irpp, attendu.css, attendu.net].map((x) => Math.round(x * 1000)));
    const retenu = Math.round((attendu.irpp + attendu.css) * 1000);
    const enDT = (m: number) => `${Math.floor(m / 1000).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')},${String(m % 1000).padStart(3, '0')} DT`;
    expect(await lire(panneau.locator('[data-ecart=salaires]'))).toBe(`Les bulletins de l'exercice disent ${enDT(Math.round(attendu.gross * 1000))} : un écart de ${enDT(Math.round(attendu.gross * 1000))}. Le livre porte moins : une écriture de paie au brouillard ou pas encore passée.`);
    expect(await lire(panneau.locator('[data-ecart=irpp]'))).toBe(`Les bulletins de l'exercice disent ${enDT(retenu)} : un écart de ${enDT(retenu)}. Le livre porte moins : une écriture de paie au brouillard ou pas encore passée.`);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-employeur-1-brouillard.png'), fullPage: true });

    // ── Ce qui manque s'ouvre d'un geste : la CIN (la fiche du salarié, sur la case), la paie au brouillard (la saisie) ──
    await panneau.locator('[data-sal-cin=s2]').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('cin');
    const fiche = p.locator('#modal-root .modal').last();
    await fiche.locator('[name=cin]').fill('08765432');
    await fiche.locator('#ok').click();
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toBe('Salarié enregistré.');
    await expect.poll(() => salaires.locator('tr[data-sal-an=s2] td').nth(1).innerText()).toBe('08765432');
    expect(((await api('GET', `/entreprises/${ent}/paie/dossier`, associe)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === 'employees' && o.cle === 's2')?.contenu.cin).toBe('08765432');
    expect(await panneau.locator('[data-ecart-saisie]').count()).toBe(2);
    await panneau.locator('[data-ecart-saisie=salaires]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${ent}/comptabilite/saisie/2026`);

    // ── La paie validée : plus d'écart ; un versement au Trésor ne change pas les retenues de l'exercice ──────
    const ecritures = async () => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, associe)).corps.ecritures as { id: string; journal: string; statut: string }[];
    const paie = (await ecritures()).filter((e) => e.journal === 'PAIE');
    expect(paie.length).toBe(2);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: paie.map((e) => e.id) })).statut).toBe(200);
    const janvier = Math.round(((bulletins[0]?.computed.irpp ?? 0) + (bulletins[0]?.computed.css ?? 0)) * 1000);
    const enTexte = (m: number) => (m / 1000).toFixed(3).replace('.', ',');
    const versement = String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: '2026-02-15', journal: 'BQ', piece: 'TRESOR-01', libelle: 'Retenues de janvier',
      lignes: [{ compte: '4321', debit: enTexte(janvier), credit: '' }, { compte: '532', debit: '', credit: enTexte(janvier) }] })).corps.id);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [versement] })).statut).toBe(200);
    await aller();
    await panneau.locator('#li-salaires').waitFor();
    expect(await panneau.locator('[data-ecart]').count()).toBe(0);
    expect(await montantDeLaCase('salaires')).toBe(Math.round(attendu.gross * 1000));
    // Le solde du 4321 dirait le total moins janvier versé.
    expect(await montantDeLaCase('irpp')).toBe(retenu);
    expect(janvier).toBeGreaterThan(0);

    // ── L'état en CSV : les colonnes de l'entreprise, une ligne par salarié, le total ───────────────────
    const [fichier] = await Promise.all([p.waitForEvent('download'), panneau.locator('#li-sal-csv').click()]);
    expect(fichier.suggestedFilename()).toBe('declaration-employeur-2026-Boulangerie-du-Port.csv');
    const csv = fs.readFileSync(await fichier.path(), 'utf8').replace(/^\ufeff/, '').split('\r\n').filter(Boolean);
    const mil = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3).replace('.', ',');
    expect(csv).toEqual([
      'Salarié;CIN;N° CNSS;Mois payés;Brut annuel;CNSS retenue;IRPP retenu;Solidarité;Net des bulletins',
      // La CIN renseignée plus haut, depuis l'état.
      ...compta.salairesDeLAnnee({ employees: [une, { ...deux, cin: '08765432' }], payslips: bulletins }, 2026).rows.map((r) => {
        const x = r as unknown as Record<string, string | number>;
        return [x.name, x.cin, x.cnss, x.months, mil(Number(x.gross)), mil(Number(x.cnss_)), mil(Number(x.irpp)), mil(Number(x.css)), mil(Number(x.net))].join(';');
      }),
      ['Total', '', '', '', mil(attendu.gross), mil(attendu.cnss), mil(attendu.irpp), mil(attendu.css), mil(attendu.net)].join(';'),
    ]);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-employeur-2-valide.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
