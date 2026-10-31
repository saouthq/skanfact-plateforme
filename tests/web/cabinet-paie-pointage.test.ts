// Le pointage au Cabinet, à la souris et au clavier (1.69.0 ; docs/paie.md, « Le pointage au Cabinet »). Ce que le parcours
// vérifie, écran ET serveur :
//   - un client sur SkanFact : la grille d'octobre (ses congés s'y posent, l'entrée en cours de mois ne se pointe pas, un
//     dimanche refuse une absence), les lettres et les flèches, les heures supplémentaires à sa majoration ; le pointage
//     gardé dans son dossier, relu après rechargement ; un bulletin nouveau qui part du mois du salarié (le brut proratisé,
//     l'absence, la prime au jour, les heures supplémentaires), au net du serveur ; puis un bulletin qui ne suit plus le
//     pointage le dit, et le reprend d'un geste ;
//   - un dossier tenu : sans majoration, la grille dit où la régler ; la fenêtre des taux amène à sa case, refuse ce qui
//     ne se lit pas, et garde les heures d'un mois complet et la majoration dans la fiche ; la colonne paraît.
// Les montants discriminent : un brut de 1 234,567, une prime de 45,500 sur 11,5 jours, 173,33 heures par mois.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
type Objet = { collection: string; cle: string; contenu: Record<string, unknown> };

describe('le pointage au Cabinet, à la souris et au clavier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-pointage-'));
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
  const decoder = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) && '~n' in v ? Number((v as Record<string, string>)['~n'])
    : Array.isArray(v) ? v.map(decoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoder(x)])) : v);
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
  const ouvrirLaPaie = async (p: Page, adresse: string | null) => {
    if (adresse) await p.goto(adresse); else await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('10');
    await p.locator('#pt-panneau').waitFor({ timeout: 15_000 });
  };
  const caseDu = (p: Page, nom: string, jour: number) => p.locator('#pt-grille tr', { hasText: nom }).locator(`.pt-c[data-pt="${jour}"]`);
  const ligneDe = (p: Page, nom: string) => p.locator('#pt-grille tr', { hasText: nom });

  it('un client sur SkanFact : sa grille, son pointage gardé, et un bulletin nouveau qui part du mois du salarié', async () => {
    const associe = await personne('associe');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps;
    const cabinet = String(cab.id);
    const patron = await personne('client');
    const boulangerie = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${boulangerie}/mandat`, patron, { codeCabinet: cab.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${boulangerie}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);
    // Dans son SkanFact : une majoration d'heures supplémentaires à 25 %, deux salariés, un congé sans solde.
    const dossierV10 = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${boulangerie}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    expect(await dossierV10('_racine', 'payrollSettings', { hsMaj1: 25, heuresMois: 208 })).toBe(200);
    const salarie = (id: string, name: string, grossSalary: number, hireDate: string, primes: unknown[] = []) =>
      ({ id, name, grossSalary, hireDate, contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '', primes });
    expect((await api('POST', `/entreprises/${boulangerie}/paie/dossier`, patron, { changements: [
      { collection: 'employees', cle: 's1', rang: null, revision: null, contenu: encoder(salarie('s1', 'Salarié Numéro Un', 1234.567, '2026-10-14', [{ label: 'Prime de présence', amount: 45.5, taxable: true, parJour: true }])) },
      { collection: 'employees', cle: 's2', rang: null, revision: null, contenu: encoder(salarie('s2', 'Salarié Numéro Deux', 980, '2025-01-01')) },
    ] })).statut).toBe(200);
    expect(await dossierV10('leaves', 'l1', { id: 'l1', employeeId: 's1', kind: 'sans-solde', from: '2026-10-20', to: '2026-10-21' })).toBe(200);
    const objets = async () => ((await api('GET', `/entreprises/${boulangerie}/paie/dossier`, associe)).corps.objets as Objet[]).map((o) => ({ ...o, contenu: decoder(o.contenu) as Record<string, unknown> }));
    // La base laisse le cabinet lire les congés du client, sans les écrire.
    expect((await objets()).filter((o) => o.collection === 'leaves').map((o) => o.cle)).toEqual(['l1']);
    expect((await api('POST', `/entreprises/${boulangerie}/paie/dossier`, associe, { changements: [{ collection: 'leaves', cle: 'l2', rang: null, revision: null, contenu: {} }] })).statut).toBe(403);

    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await ouvrirLaPaie(p, `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${boulangerie}/comptabilite/paie/2026`);
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();

    // ── La grille d'octobre : par nom ; l'entrée du 14 ; le congé sans solde posé de lui-même ; sa majoration ────────
    expect(await p.locator('#pt-grille tbody tr td:first-child').allInnerTexts()).toEqual(['Salarié Numéro Deux', 'Salarié Numéro Un']);
    expect(await caseDu(p, 'Numéro Un', 13).isDisabled()).toBe(true);
    expect(await caseDu(p, 'Numéro Un', 14).isDisabled()).toBe(false);
    expect(await caseDu(p, 'Numéro Un', 20).innerText()).toBe('A');
    expect(await caseDu(p, 'Numéro Un', 20).getAttribute('title')).toBe('Absent, non payé (Congés et absences)');
    expect(await ligneDe(p, 'Numéro Un').locator('[data-pt-payes]').innerText()).toBe('13');
    expect(await p.locator('#pt-grille thead').innerText()).toContain('HS +25 %');
    expect(await p.locator('#pt-sans-hs').count()).toBe(0);

    // ── Au clavier : une lettre pose son code, la flèche passe au jour suivant ; un dimanche refuse une absence ─────
    await caseDu(p, 'Numéro Un', 22).focus();
    await p.keyboard.press('d');
    await expect.poll(() => caseDu(p, 'Numéro Un', 22).innerText()).toBe('½');
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('data-pt'))).toBe('22');
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('a');
    await expect.poll(() => caseDu(p, 'Numéro Un', 23).innerText()).toBe('A');
    await expect.poll(() => ligneDe(p, 'Numéro Un').locator('[data-pt-payes]').innerText()).toBe('11,5');
    await caseDu(p, 'Numéro Un', 25).focus();
    await p.keyboard.press('a');
    await expect.poll(toast).toContain('Le 25 octobre est un jour de repos');
    expect(await caseDu(p, 'Numéro Un', 25).innerText()).toBe('R');
    // Les heures supplémentaires, puis Tab : le curseur reste dans la grille.
    await ligneDe(p, 'Numéro Un').locator('.pt-hs[data-hs="25"]').fill('6');
    await p.keyboard.press('Tab');
    const pointage = async () => (await objets()).find((o) => o.collection === 'timesheets' && o.contenu.employeeId === 's1')?.contenu;
    await expect.poll(async () => { const t = await pointage(); return t && [t.year, t.month, t.jours, t.hs]; }, { timeout: 15_000 })
      .toEqual([2026, 10, { 22: 'D', 23: 'A' }, { 25: 6 }]);

    // ── Rechargée, la grille est celle du serveur ───────────────────────────────────────────────────────────────
    await ouvrirLaPaie(p, null);
    expect(await caseDu(p, 'Numéro Un', 23).innerText()).toBe('A');
    expect(await caseDu(p, 'Numéro Un', 23).getAttribute('class')).toContain('pt-main');
    expect(await ligneDe(p, 'Numéro Un').locator('.pt-hs').inputValue()).toBe('6');

    // ── Un bulletin nouveau part du mois du salarié : le brut proratisé, l'absence, la prime au jour, les heures ────
    await expect.poll(async () => {
      if (!await p.locator('#bf').count()) await p.locator('#pa-bulletin').first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator('#bf').count();
    }, { timeout: 20_000 }).toBe(1);
    const montants = () => fenetre.locator('#bf-primes [data-l=amount]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const libelles = () => fenetre.locator('#bf-primes [data-l=label]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    // Ce qui est proposé suit le salarié choisi : un mois plein, sans absence ni prime ; puis celui du salarié entré le 14.
    await fenetre.locator('[name=salarieId]').selectOption({ label: 'Salarié Numéro Deux' });
    await expect.poll(() => fenetre.locator('[name=brut]').inputValue()).toBe('980,000');
    expect(await fenetre.locator('[name=joursAbsence]').inputValue()).toBe('0');
    expect(await libelles()).toEqual([]);
    expect(await fenetre.locator('#bf-mois-note').isHidden()).toBe(true);
    await fenetre.locator('[name=salarieId]').selectOption({ label: 'Salarié Numéro Un' });
    await expect.poll(() => fenetre.locator('[name=brut]').inputValue()).toBe('712,250');
    expect(await fenetre.locator('[name=joursAbsence]').inputValue()).toBe('3.5');
    expect(await libelles()).toEqual(['Prime de présence', 'Heures supplémentaires : 6 h à +25 %']);
    expect(await montants()).toEqual(['20,125', '44,516']);
    expect((await fenetre.locator('#bf-mois-note').innerText()).replace(/\s/g, ' ')).toMatch(/Brut proratisé : entrée le 14\/10\/2026, 15 jours sur 26 \(1\s234,567\sDT pour un mois plein\)\. Le mois est pointé/);
    const net = (await fenetre.locator('#bf-apercu b').first().innerText()).replace(/\s/g, '');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    await expect.poll(() => p.locator('#bf').count()).toBe(0);
    const bulletin = async () => (await objets()).find((o) => o.collection === 'payslips' && o.contenu.employeeId === 's1')?.contenu as Record<string, unknown>;
    expect(await bulletin()).toMatchObject({
      year: 2026, month: 10, gross: 712.25, workedDays: 26, absentDays: 3.5,
      bonuses: [
        { label: 'Prime de présence', amount: 20.125, taxable: true, parJour: true, mensuel: 45.5, jours: 11.5, sur: 26 },
        { label: 'Heures supplémentaires : 6 h à +25 %', amount: 44.516, taxable: true, hs: 25, heures: 6 },
      ],
      prorata: { jours: 15, sur: 26, motif: 'entrée le 14/10/2026', brutFiche: 1234.567, brut: 712.25 },
    });
    // L'aperçu disait le net que le serveur a recalculé, au millime (le seul bulletin d'octobre du client).
    const auServeur = ((await api('GET', `/entreprises/${boulangerie}/paie/bulletins?annee=2026&mois=10`, associe)).corps.lignes as { net: string }[])[0];
    expect(net).toBe(`Netàpayer${String(auServeur?.net).replace('.', ',')}DT`);

    // ── Un jour d'absence de plus : le bulletin ne suit plus le pointage, et le reprend d'un geste ────────────────
    await caseDu(p, 'Numéro Un', 26).focus();
    await p.keyboard.press('a');
    await expect.poll(() => p.locator('#pt-ecarts').innerText())
      .toContain('Le bulletin de Salarié Numéro Un ne suit plus le pointage : 3,5 jours non payés au bulletin, 4,5 au pointage.');
    await p.locator('#pt-ecarts [data-pt-reprendre]').click();
    await expect.poll(toast).toBe('Bulletin de Salarié Numéro Un mis à jour sur le pointage.');
    await expect.poll(async () => { const b = await bulletin(); return [b.absentDays, (b.bonuses as { amount: number }[]).map((x) => x.amount)]; })
      .toEqual([4.5, [18.375, 44.516]]);
    await expect.poll(() => p.locator('#pt-ecarts').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-pointage.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);

  it('un dossier tenu : la grille dit où régler les heures supplémentaires, la fenêtre des taux les garde, la colonne paraît', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${cafe}/paie/dossier`, associe, { changements: [
      { collection: 'employees', cle: 's1', rang: null, revision: null, contenu: { id: 's1', name: 'Salarié Numéro Trois', grossSalary: 980, hireDate: '2025-01-01', contract: 'cdi', active: true } },
    ] })).statut).toBe(200);
    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await ouvrirLaPaie(p, `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/paie/2026`);
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();

    // Sans majoration, pas de colonne : la grille dit où la régler, et le bouton amène à la case.
    expect(await p.locator('#pt-grille thead').innerText()).not.toContain('HS +');
    await p.locator('#pt-taux').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('data-hs-k'))).toBe('hsMaj1');
    await p.keyboard.type('cinquante');
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('data-hs-k'))).toBe('hsMaj1');
    await expect.poll(async () => (await p.locator('body').innerText()).includes('n\'est pas une majoration entre 0 et 100 %')).toBe(true);
    await fenetre.locator('[data-hs-k="hsMaj1"]').fill('50');
    await fenetre.locator('[data-hs-k="heuresMois"]').fill('173,33');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Taux de la paie enregistrés.');
    const fiche = async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { paie?: Record<string, unknown> } }[])
      .find((f) => f.entreprise === cafe)?.contenu.paie;
    expect(await fiche()).toMatchObject({ hsMaj1: '50', heuresMois: '173.33' });
    await ouvrirLaPaie(p, null);
    expect(await p.locator('#pt-grille thead').innerText()).toContain('HS +50 %');
    // Les trente et un jours d'octobre et la colonne des heures tiennent dans la page du Cabinet (vu à l'écran : elle
    // débordait de 70 pixels), sans défiler.
    expect(await p.locator('#pt-panneau .scroll-x').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    // Et sur un portable de 1 366 pixels, la largeur où les cases serrées comptent (mesuré le 31/10/2026 : 0 avec elles,
    // 24 pixels de trop sans elles ; à 1 440 pixels la grille tenait même sans).
    await p.setViewportSize({ width: 1366, height: 900 });
    await expect.poll(() => p.locator('#pt-panneau .scroll-x').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    await p.setViewportSize({ width: 1440, height: 900 });
    // 4 heures à +50 % : 980 × 4 × 1,5 / 173,33 = 33,924.
    await ligneDe(p, 'Numéro Trois').locator('.pt-hs[data-hs="50"]').fill('4');
    await p.keyboard.press('Tab');
    await expect.poll(async () => ((await api('GET', `/entreprises/${cafe}/paie/dossier`, associe)).corps.objets as Objet[]).some((o) => o.collection === 'timesheets'), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => {
      if (!await p.locator('#bf').count()) await p.locator('#pa-bulletin').first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator('#bf').count();
    }, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => fenetre.locator('#bf-primes [data-l=amount]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(['33,924']);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
