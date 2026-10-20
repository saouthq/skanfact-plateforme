// Les documents du personnel au Cabinet, à la souris (1.72.0 ; docs/paie.md, « Les documents du personnel au Cabinet »).
// L'attestation, le certificat de travail et le solde de tout compte de l'entreprise (5.1.0), sur le menu d'un salarié, au
// nom du client : son nom, son adresse et son gérant (la fiche du dossier). Ce que le parcours vérifie, écran ET serveur :
//   - ce qui manque au document (le gérant, la civilité) se dit avant d'imprimer, et son bouton ouvre la case qui le
//     renseigne ; la fiche du salarié enregistrée, le document se rouvre ;
//   - la civilité s'écrit dans le dossier du client sous le nom de l'entreprise (`gender`), et l'identité CNSS d'un salarié
//     garde le sien (`cnssName`), que le Cabinet lisait sous un autre nom ;
//   - le solde propose l'indemnité de congés non pris que le document imprime, dit ce qui reste dû sur les avances sans le
//     retenir, refuse un montant illisible sur sa case ; le document imprimé porte la civilité et son accord, le gérant,
//     l'adresse et la ville du client.

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

describe('les documents du personnel au Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-docs-personnel-'));
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

  it('un dossier tenu : le gérant et la civilité renseignés depuis le document, le solde proposé, les documents imprimés au nom du client', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie du Port' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);
    // Une salariée sortie le 14 août, sa civilité pas encore dite ; son identité CNSS sous le nom de l'entreprise. Son
    // bulletin de juillet ; une avance que rien n'a encore remboursée.
    const une = { id: 's1', name: 'Salariée Numéro Une', cnssName: 'Une Numéro Salariée', cin: '07123456', position: 'Comptable', grossSalary: 1301.25,
      hireDate: '2025-03-10', endDate: '2026-08-14', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' };
    const saisie = { gross: 1301.25, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
    const juillet = { id: 'p-s1-2026-07', employeeId: 's1', year: 2026, month: 7, ...saisie, computed: compta.computePayslip(une, saisie, compta.baremesPaie({})),
      issuedAt: '2026-07-31', paidDate: '', accountId: '', method: 'virement', reference: '' };
    const avance = { id: 'a1', employeeId: 's1', date: '2026-07-05', amount: 1000.75, monthly: 300.125, method: 'virement', note: '' };
    const ecrire = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/paie/dossier`, associe,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    expect(await ecrire('employees', 's1', une)).toBe(200);
    expect(await ecrire('payslips', juillet.id, juillet)).toBe(200);
    expect(await ecrire('advances', 'a1', avance)).toBe(200);
    // L'indemnité que l'entreprise proposerait, sur les mêmes données (deux chemins, un chiffre).
    const indemnite = compta.indemniteConges({ employees: [une], payslips: [juillet], leaves: [], payrollSettings: {} }, 's1', '2026-10-20').montant;
    expect(indemnite).toBe(525.504);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/paie/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText().catch(() => '');
    const fenetre = p.locator('#modal-root .modal').last();
    const titre = () => fenetre.locator('h2').first().innerText({ timeout: 500 }).catch(() => '');
    const ouvrirDocument = () => expect.poll(async () => {
      if (await titre() !== 'Document pour Salariée Numéro Une') {
        if (!await p.getByRole('menuitem').filter({ hasText: 'Attestation, certificat, solde' }).count()) await p.locator('[data-rowmenu="SAL:s1"]').first().click({ timeout: 2_000 }).catch(() => {});
        await p.getByRole('menuitem').filter({ hasText: 'Attestation, certificat, solde' }).first().click({ timeout: 2_000 }).catch(() => {});
      }
      return titre();
    }, { timeout: 20_000 }).toBe('Document pour Salariée Numéro Une');
    await ouvrirDocument();

    // ── Ce qui manque se dit avant d'imprimer : le gérant, la civilité ─────────────────────────────────
    // Les guillemets français portent leur espace fine insécable : lue comme une espace.
    const lire = (sel: string) => fenetre.locator(sel).innerText().then((x) => x.replace(/[\u00a0\u202f]/g, ' '));
    expect(await lire('#dp-gerant')).toContain('Le document dira « Je soussigné » sans nom : le gérant de Boulangerie du Port n\'est pas sur la fiche du dossier.');
    expect(await lire('#dp-civ')).toContain('Le document parlera de Salariée Numéro Une au masculin, sans « Madame » ni « Monsieur » : sa civilité n\'est pas renseignée.');
    await fenetre.locator('#dp-civ-go').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('genre');
    await fenetre.locator('[name=genre]').selectOption('f');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Salarié enregistré.');
    // Enregistrée, la fiche rend la main au document, qui ne réclame plus la civilité.
    await expect.poll(titre).toBe('Document pour Salariée Numéro Une');
    expect(await fenetre.locator('#dp-civ').count()).toBe(0);
    const salarie = async () => ((await api('GET', `/entreprises/${ent}/paie/dossier`, associe)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === 'employees')?.contenu ?? {};
    const lu = await salarie();
    expect([lu.gender, lu.cnssName, 'identiteCnss' in lu]).toEqual(['f', 'Une Numéro Salariée', false]);

    // Le document choisi se garde à travers la fiche du dossier.
    await fenetre.locator('[name=kind]').selectOption('certificat');
    await fenetre.locator('#dp-gerant-go').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('f-gerant');
    await fenetre.locator('#f-gerant').fill('Gérant Numéro Un');
    await fenetre.locator('#f-adresse').fill('Rue du Port\n2000 Le Bardo');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Fiche enregistrée.');
    await expect.poll(async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: Record<string, unknown> }[])
      .find((f) => f.entreprise === ent)?.contenu).toMatchObject({ gerant: 'Gérant Numéro Un', adresse: 'Rue du Port\n2000 Le Bardo' });
    // Enregistrée, la fiche du dossier rend la main au document, comme celle du salarié, qui ne réclame plus le gérant.
    await expect.poll(titre).toBe('Document pour Salariée Numéro Une');
    expect(await fenetre.locator('#dp-gerant').count()).toBe(0);
    expect(await fenetre.locator('[name=kind]').inputValue()).toBe('certificat');

    // ── Le solde de tout compte : l'indemnité de congés que le document imprimera, les avances dites, pas retenues ──
    await ouvrirDocument();
    expect(await fenetre.locator('#dp-gerant, #dp-civ').count()).toBe(0);
    await fenetre.locator('[name=kind]').selectOption('solde');
    const valeurs = (sel: string) => fenetre.locator(sel).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(await valeurs('#dp-lignes [data-dl=label]')).toEqual(['Salaire du mois en cours', 'Indemnité de congés non pris (10,5 jours)', 'Indemnité de préavis', 'Indemnité de fin de contrat']);
    expect(await valeurs('#dp-lignes [data-dl=amount]')).toEqual(['', '525,504', '', '']);
    expect((await fenetre.locator('#dp-avances').innerText()).replace(/[\u00a0\u202f]/g, ' ')).toContain('Il reste 1 000,750 DT à rembourser sur ses avances. Ce document ne les retient pas');
    await fenetre.locator('#dp-plus').click();
    await fenetre.locator('#dp-lignes [data-dl=label]').last().fill('Prime de fin d\'année');
    await fenetre.locator('#dp-lignes [data-dl=amount]').last().fill('deux cents');
    // Un montant illisible se refuse sur sa case, sans fenêtre d'impression.
    let fenetresOuvertes = 0;
    p.on('popup', () => { fenetresOuvertes++; });
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('« deux cents » ne se lit pas comme un montant. Écris-le en chiffres, par exemple 1\u202f250,500.');
    expect(await p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value)).toBe('deux cents');
    expect(fenetresOuvertes).toBe(0);
    await fenetre.locator('#dp-lignes [data-dl=amount]').last().fill('200');
    await expect.poll(() => fenetre.locator('#dp-total').innerText().then((t) => t.replace(/[\u00a0\u202f]/g, ' '))).toBe('725,504 DT');

    const imprimer = async (geste: () => Promise<unknown>) => {
      const [imprimee] = await Promise.all([p.waitForEvent('popup'), geste()]);
      await expect.poll(() => imprimee.content(), { timeout: 15_000 }).toMatch(/<h1>/);
      const html = (await imprimee.content()).replace(/&nbsp;|[\u00a0\u202f]/g, ' ');
      await imprimee.close();
      return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;|&apos;/g, '\'').replace(/\s+/g, ' ');
    };
    const solde = await imprimer(() => fenetre.locator('#ok').click());
    expect(solde).toContain('Solde de tout compte');
    expect(solde).toContain('et Madame Salariée Numéro Une , CIN n° 07123456, employée du 10/03/2025 au 14/08/2026');
    expect(solde).toContain('Indemnité de congés non pris (10,5 jours) 525,504');
    expect(solde).toContain('Prime de fin d\'année 200,000');
    expect(solde).toContain('Net à percevoir 725,504 DT');
    expect(solde).toContain('Solde de congés non pris au départ : 10,5 jours , soit 525,504 DT');
    expect(solde).toContain('Rue du Port 2000 Le Bardo');
    expect(solde).toContain('Pour la société Gérant Numéro Un');

    // ── Le certificat de travail, daté du jour de la sortie ─────────────────────────────────────────────
    await ouvrirDocument();
    await fenetre.locator('[name=kind]').selectOption('certificat');
    await fenetre.locator('[name=date]').fill('14/08/2026');
    const certificat = await imprimer(() => fenetre.locator('#ok').click());
    expect(certificat).toContain('Je soussigné, Gérant Numéro Un , agissant en qualité de représentant légal de la société Boulangerie du Port');
    expect(certificat).toContain('Madame Salariée Numéro Une');
    expect(certificat).toContain('a été employée au sein de notre société du 10/03/2025 au 14/08/2026 , en qualité de Comptable');
    expect(certificat).toContain('L\'intéressée est libre de tout engagement');
    expect(certificat).toContain('Le Bardo, le 14/08/2026');
    // Le document n'a rien écrit : l'avance reste à rembourser.
    expect(((await api('GET', `/entreprises/${ent}/paie/dossier`, associe)).corps.objets as { collection: string }[]).filter((o) => o.collection === 'payslips').length).toBe(1);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
