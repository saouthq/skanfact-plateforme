// Les congés au Cabinet, à la souris et au clavier (1.70.0 ; docs/paie.md, « Les congés au Cabinet »). Ce que le parcours
// vérifie, écran ET serveur :
//   - un dossier tenu : le solde de chaque salarié (acquis au prorata des mois travaillés) ; un congé saisi dans la
//     fenêtre de l'entreprise, ses jours et le solde d'après lus AVANT d'enregistrer, gardé dans le dossier, posé sur la
//     grille du pointage ; une absence sans solde qu'un bulletin nouveau retire ; corriger (au clavier), refuser ce qui ne
//     se lit pas, supprimer ; le droit annuel réglé depuis le panneau ; rien ne déborde ;
//   - un client sur SkanFact : ses congés et son droit se lisent, sans geste pour les changer.
// L'exercice 2025 est passé : ses soldes ne dépendent pas du jour où le parcours tourne. Les montants discriminent : une
// entrée le 16 mars (dix mois), un droit de 21,5 jours chez le client.

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

describe('les congés au Cabinet, à la souris et au clavier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-conges-'));
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
  const ouvrirLaPaie = async (p: Page, adresse: string | null) => {
    if (adresse) await p.goto(adresse); else await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('10');
    await p.locator('#cg-panneau').waitFor({ timeout: 15_000 });
  };
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();
  // Le solde d'un salarié, tel que le panneau le dit : acquis, pris, solde.
  const solde = async (p: Page, nom: string) => (await p.locator('#cg-soldes tr', { hasText: nom }).locator('td').allInnerTexts()).slice(1, 4);
  const salarie = (id: string, name: string, grossSalary: number, hireDate: string) =>
    ({ id, name, grossSalary, hireDate, contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' });

  it('un dossier tenu : le solde de chacun, un congé saisi qui se pose sur le pointage, corrigé, supprimé ; le droit annuel', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${garage}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${garage}/paie/dossier`, associe, { changements: [
      { collection: 'employees', cle: 's1', rang: null, revision: null, contenu: encoder(salarie('s1', 'Salarié Numéro Un', 1234.567, '2025-03-16')) },
      { collection: 'employees', cle: 's2', rang: null, revision: null, contenu: encoder(salarie('s2', 'Salarié Numéro Deux', 980, '2024-02-01')) },
    ] })).statut).toBe(200);
    const objets = async () => ((await api('GET', `/entreprises/${garage}/paie/dossier`, associe)).corps.objets as Objet[]);
    const conges = async () => (await objets()).filter((o) => o.collection === 'leaves').map((o) => o.contenu);

    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await ouvrirLaPaie(p, `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${garage}/comptabilite/paie/2025`);
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const annonce = () => fenetre.locator('#cg-annonce').innerText().then(net);

    // ── Le panneau : le droit du barème, le solde de chacun (dix mois pour l'entrée du 16 mars, douze sinon) ───────
    // (Le « i » de l'aide suit le titre.)
    expect(net(await p.locator('#cg-panneau h2').innerText())).toBe('Les congés et absences de 2025 i');
    expect(net(await p.locator('#cg-droit').innerText())).toContain('Le droit annuel : 18 jours ouvrables, acquis au prorata des mois travaillés.');
    expect(await solde(p, 'Numéro Un')).toEqual(['15', '0', '15']);
    expect(await solde(p, 'Numéro Deux')).toEqual(['18', '0', '18']);
    expect(net(await p.locator('#cg-panneau .empty').innerText())).toBe('Aucun congé ni absence en 2025.');

    // ── Un congé payé : ses jours et le solde d'après se lisent avant d'enregistrer ─────────────────────────────
    await p.locator('#cg-ajouter').click();
    expect(net(await fenetre.locator('h2').innerText())).toBe('Congé ou absence');
    await fenetre.locator('[name=employeeId]').selectOption({ label: 'Salarié Numéro Un' });
    await fenetre.locator('[name=kind]').selectOption('conges');
    // Avant son entrée : l'annonce le dit, et la fenêtre le refuse.
    await fenetre.locator('[name=from]').fill('10/03/2025');
    await fenetre.locator('[name=to]').fill('12/03/2025');
    await expect.poll(annonce).toBe('L\'entrée de Salarié Numéro Un est le 16/03/2025 : une absence ne commence pas avant.');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('L\'entrée de Salarié Numéro Un est le 16/03/2025 : une absence ne commence pas avant.');
    await fenetre.locator('[name=from]').fill('13/10/2025');
    await fenetre.locator('[name=to]').fill('17/10/2025');
    await expect.poll(annonce).toBe('5 jours ouvrables, dimanches exclus. Payée : le salaire du mois n\'est pas réduit. Solde de congés : 15 jours avant, 10 jours après.');
    // Une fin avant le début, une date qui n'existe pas : refusées sur leur case.
    await fenetre.locator('[name=to]').fill('10/10/2025');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('La fin ne peut pas précéder le début (13/10/2025).');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('to');
    await fenetre.locator('[name=to]').fill('32/10/2025');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('« 32/10/2025 » n\'est pas une date lisible. Écris-la JJ/MM/AAAA.');
    await fenetre.locator('[name=to]').fill('17/10/2025');
    await fenetre.locator('[name=note]').fill('Congé annuel');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('L\'absence de Salarié Numéro Un est enregistrée.');
    expect(await conges()).toEqual([{ id: expect.stringMatching(/^cg/), employeeId: 's1', kind: 'conges', from: '2025-10-13', to: '2025-10-17', paid: null, note: 'Congé annuel' }]);
    await expect.poll(() => solde(p, 'Numéro Un')).toEqual(['15', '5', '10']);
    expect(net(await p.locator('#cg-liste tbody tr').innerText())).toBe('Salarié Numéro Un Congé payé 13/10/2025 17/10/2025 5 payée Congé annuel');
    // Il se pose sur la grille du pointage du mois.
    const caseDu = (nom: string, jour: number) => p.locator('#pt-grille tr', { hasText: nom }).locator(`.pt-c[data-pt="${jour}"]`);
    expect(await caseDu('Numéro Un', 13).innerText()).toBe('C');
    expect(await caseDu('Numéro Un', 13).getAttribute('title')).toBe('Congé payé (Congés et absences)');
    expect(await caseDu('Numéro Un', 18).innerText()).toBe('P');

    // ── Une absence sans solde : la grille la retire des jours payés, et un bulletin nouveau aussi ───────────────
    await p.locator('#cg-ajouter').click();
    await fenetre.locator('[name=employeeId]').selectOption({ label: 'Salarié Numéro Deux' });
    await fenetre.locator('[name=kind]').selectOption('sans-solde');
    await fenetre.locator('[name=from]').fill('20/10/2025');
    await fenetre.locator('[name=to]').fill('21/10/2025');
    await expect.poll(annonce).toBe('2 jours ouvrables, dimanches exclus. Non payée : le brut d\'un bulletin établi ensuite est réduit au prorata.');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('L\'absence de Salarié Numéro Deux est enregistrée.');
    await expect.poll(() => p.locator('#pt-grille tr', { hasText: 'Numéro Deux' }).locator('[data-pt-payes]').innerText()).toBe('24');
    expect(await solde(p, 'Numéro Deux')).toEqual(['18', '0', '18']);
    await expect.poll(async () => {
      if (!await p.locator('#bf').count()) await p.locator('#pa-bulletin').first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator('#bf').count();
    }, { timeout: 20_000 }).toBe(1);
    await fenetre.locator('[name=salarieId]').selectOption({ label: 'Salarié Numéro Deux' });
    await expect.poll(() => fenetre.locator('[name=joursAbsence]').inputValue()).toBe('2');
    // Fermée sans rien enregistrer : la fenêtre demande d'abord (un salarié choisi est une saisie).
    await fenetre.locator('[data-close]').first().click();
    await p.getByRole('button', { name: 'Abandonner', exact: true }).click();
    await expect.poll(() => p.locator('#bf').count()).toBe(0);

    // ── Corriger au clavier : la ligne s'ouvre d'Entrée ; le solde d'avant lui rend ses jours ────────────────────
    await p.locator('#cg-liste tr', { hasText: 'Numéro Un' }).focus();
    await p.keyboard.press('Enter');
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Modifier l\'absence');
    await fenetre.locator('[name=to]').fill('16/10/2025');
    await expect.poll(annonce).toBe('4 jours ouvrables, dimanches exclus. Payée : le salaire du mois n\'est pas réduit. Solde de congés : 15 jours avant, 11 jours après.');
    // Entrée dans le champ enregistre : jamais « Supprimer », posé à sa gauche (vu au test humain).
    await fenetre.locator('[name=to]').press('Enter');
    await expect.poll(() => solde(p, 'Numéro Un')).toEqual(['15', '4', '11']);
    expect(await p.getByText('Supprimer cette absence ?').count()).toBe(0);
    expect(await caseDu('Numéro Un', 17).innerText()).toBe('P');

    // ── Supprimer : la fenêtre demande ; le congé quitte le dossier et la grille ─────────────────────────────────
    await p.locator('#cg-liste tr', { hasText: 'Numéro Un' }).click();
    await fenetre.locator('#cg-supprimer').click();
    await p.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
    await expect.poll(toast).toBe('Absence supprimée.');
    expect((await conges()).map((c) => c.employeeId)).toEqual(['s2']);
    await expect.poll(() => solde(p, 'Numéro Un')).toEqual(['15', '0', '15']);
    expect(await caseDu('Numéro Un', 13).innerText()).toBe('P');

    // ── Le droit annuel, depuis le panneau : la fenêtre des taux amène à sa case, refuse ce qui ne se lit pas ─────
    await p.locator('#cg-droit-regler').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('data-cg-k'))).toBe('leaveDaysPerYear');
    await p.keyboard.type('0');
    await fenetre.locator('#ok').click();
    await expect.poll(async () => (await p.locator('body').innerText()).includes('n\'est pas un nombre de jours entre 1 et 60')).toBe(true);
    await fenetre.locator('[data-cg-k="leaveDaysPerYear"]').fill('24');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Taux de la paie enregistrés.');
    const fiche = async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { paie?: Record<string, unknown> } }[])
      .find((f) => f.entreprise === garage)?.contenu.paie;
    expect(await fiche()).toMatchObject({ leaveDaysPerYear: '24' });
    await ouvrirLaPaie(p, null);
    expect(net(await p.locator('#cg-droit').innerText())).toContain('Le droit annuel : 24 jours ouvrables');
    expect(await solde(p, 'Numéro Un')).toEqual(['20', '0', '20']);
    expect(await solde(p, 'Numéro Deux')).toEqual(['24', '0', '24']);
    // Rien ne déborde du panneau.
    expect(await p.locator('#cg-panneau').evaluate((e) => [...e.querySelectorAll('.scroll-x')].map((x) => x.scrollWidth - x.clientWidth).filter((d) => d > 0))).toEqual([]);
    await p.locator('#cg-panneau').screenshot({ path: path.join(PHOTOS, 'cabinet-paie-conges.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);

  it('un client sur SkanFact : ses congés et son droit se lisent, sans geste pour les changer', async () => {
    const associe = await personne('associe');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps;
    const cabinet = String(cab.id);
    const patron = await personne('client');
    const boulangerie = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${boulangerie}/mandat`, patron, { codeCabinet: cab.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${boulangerie}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);
    const dossierV10 = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${boulangerie}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    expect(await dossierV10('_racine', 'payrollSettings', { leaveDaysPerYear: 21.5 })).toBe(200);
    expect(await dossierV10('employees', 's1', salarie('s1', 'Salarié Numéro Un', 1234.567, '2024-01-01'))).toBe(200);
    expect(await dossierV10('leaves', 'l1', { id: 'l1', employeeId: 's1', kind: 'conges', from: '2025-10-13', to: '2025-10-17', paid: null, note: '' })).toBe(200);

    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await ouvrirLaPaie(p, `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${boulangerie}/comptabilite/paie/2025`);
    expect(net(await p.locator('#cg-droit').innerText())).toBe('Le droit annuel : 21,5 jours ouvrables, acquis au prorata des mois travaillés ; ce client le règle dans son SkanFact (Paie › Barèmes).');
    expect(await solde(p, 'Numéro Un')).toEqual(['21,5', '5', '16,5']);
    expect(net(await p.locator('#cg-qui').innerText())).toBe('Ce client les saisit dans son SkanFact (Paie › Congés et absences) : le Cabinet les lit.');
    expect(await p.locator('#cg-ajouter, #cg-droit-regler').count()).toBe(0);
    // La ligne se lit ; elle ne s'ouvre ni au clic ni au clavier.
    const ligne = p.locator('#cg-liste tbody tr');
    expect(net(await ligne.innerText())).toBe('Salarié Numéro Un Congé payé 13/10/2025 17/10/2025 5 payée');
    expect([await ligne.getAttribute('class'), await ligne.getAttribute('tabindex')]).toEqual([null, null]);
    await ligne.click();
    await p.waitForTimeout(300);
    expect(await p.locator('#cg-form').count()).toBe(0);
    // La fenêtre des taux du client dit son droit, le sien.
    await p.locator('#pa-regimes').click();
    expect(net(await p.locator('#rc-lu-conges').innerText())).toBe('Son droit annuel aux congés payés : 21,5 jours ouvrables (le sien).');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
