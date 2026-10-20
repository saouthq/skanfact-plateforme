// Les avances au Cabinet, à la souris et au clavier (1.71.0 ; docs/paie.md, « Les avances au Cabinet »). Ce que le parcours
// vérifie, écran ET serveur :
//   - un dossier tenu : une avance saisie dans la fenêtre de l'entreprise, la durée du remboursement et la part du net lues
//     AVANT d'enregistrer, gardée dans le dossier, son versement écrit ; refusé ce qui ne se lit pas, hors de l'année
//     regardée, après la sortie du salarié ; un bulletin nouveau qui en retient l'échéance, qui suit le salarié choisi ;
//     ce qui a été retenu et ce qui reste ; corriger au clavier (ni sous ce qui a été retenu, ni d'un salarié à l'autre),
//     supprimer ; rien ne déborde ;
//   - un client sur SkanFact : ses avances se lisent, sans geste pour les changer, et le bulletin que le Cabinet établit
//     en retient l'échéance — le SkanFact du client, par le moteur de l'entreprise, lit le même reste.
// L'exercice 2025 est passé : rien ne dépend du jour où le parcours tourne. Les montants discriminent : 1 000,750 avancés à
// 300,125 par mois.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
type Objet = { collection: string; cle: string; contenu: Record<string, unknown> };
type Ligne = { compte: string; debit: string; credit: string };

describe('les avances au Cabinet, à la souris et au clavier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-avances-'));
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
  // Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js), et retour.
  const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
  const decoder = (v: unknown): unknown => (Array.isArray(v) ? v.map(decoder)
    : v && typeof v === 'object' ? ('~n' in v ? Number((v as { '~n': string })['~n']) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoder(x)]))) : v);
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
  const ouvrirLaPaie = async (p: Page, adresse: string) => {
    await p.goto(adresse);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('10');
    await p.locator('#av-panneau').waitFor({ timeout: 15_000 });
  };
  const ouvrirUnBulletin = async (p: Page) => expect.poll(async () => {
    if (!await p.locator('#bf').count()) await p.locator('#pa-bulletin').first().click({ timeout: 2_000 }).catch(() => {});
    return p.locator('#bf').count();
  }, { timeout: 20_000 }).toBe(1);
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();
  // Une ligne du panneau : salarié, versée le, mode, avancé, par mois, retenu, reste, note.
  const ligne = async (p: Page, nom: string) => net(await p.locator('#av-liste tbody tr', { hasText: nom }).innerText());
  const salarie = (id: string, name: string, grossSalary: number, hireDate: string, endDate = '') =>
    ({ id, name, grossSalary, hireDate, endDate, contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' });
  const ecrituresHorsPaie = async (ent: string, jeton: string) => ((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures as { journal: string; date: string; lignes: Ligne[] }[])
    .filter((e) => e.journal !== 'PAIE').map((e) => `${e.journal} ${e.date} ${e.lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`).join(' | ')}`);

  it('un dossier tenu : une avance saisie, son versement écrit, retenue par un bulletin nouveau, corrigée au clavier, supprimée', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${garage}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${garage}/paie/dossier`, associe, { changements: [
      { collection: 'employees', cle: 's1', rang: null, revision: null, contenu: encoder(salarie('s1', 'Salarié Numéro Un', 1234.567, '2025-01-01')) },
      { collection: 'employees', cle: 's2', rang: null, revision: null, contenu: encoder(salarie('s2', 'Salarié Numéro Deux', 980, '2025-10-08', '2025-11-30')) },
    ] })).statut).toBe(200);
    const objets = async () => ((await api('GET', `/entreprises/${garage}/paie/dossier`, associe)).corps.objets as Objet[]);
    const avances = async () => (await objets()).filter((o) => o.collection === 'advances').map((o) => decoder(o.contenu) as Record<string, unknown>);

    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await ouvrirLaPaie(p, `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${garage}/comptabilite/paie/2025`);
    const toast = () => p.locator('#toast').innerText().then(net);
    const fenetre = p.locator('#modal-root .modal').last();
    const annonce = () => fenetre.locator('#av-annonce').innerText().then(net);
    // Ce que le brouillard compte (l'onglet « Saisie ») : le versement d'une avance y entre, et en sort, sans recharger.
    const auBrouillard = async () => Number((/(\d+)\s*$/.exec(net(await p.locator('button[data-tab="saisie"]').innerText())) ?? [])[1] ?? 0);
    expect(await auBrouillard()).toBe(0);

    // ── Le panneau, vide ─────────────────────────────────────────────────────────────────────────────────────────
    expect(net(await p.locator('#av-panneau h2').innerText())).toBe('Les avances sur salaire de 2025 i');
    expect(net(await p.locator('#av-panneau .empty').innerText())).toBe('Aucune avance en 2025.');
    expect(net(await p.locator('#av-qui').innerText())).toBe('Un bulletin nouveau en retient l\'échéance du mois, jusqu\'à la dernière ; le versement s\'écrit le jour même, à la banque ou à la caisse.');

    // ── Une avance : la durée du remboursement et la part du net se lisent avant d'enregistrer ─────────────────────
    await p.locator('#av-ajouter').click();
    expect(net(await fenetre.locator('h2').innerText())).toBe('Avance sur salaire');
    // Le salarié proposé (le premier par son nom) est entré le 8 octobre : la fenêtre propose son entrée, pas le 1er.
    expect(await fenetre.locator('[name=employeeId] option:checked').innerText()).toBe('Salarié Numéro Deux');
    expect(await fenetre.locator('[name=date]').inputValue()).toBe('08/10/2025');
    // Après la sortie du salarié : refusée, sur sa case.
    await fenetre.locator('[name=date]').fill('05/12/2025');
    await fenetre.locator('[name=amount]').fill('100');
    await fenetre.locator('[name=monthly]').fill('50');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('La sortie de Salarié Numéro Deux est le 30/11/2025 : aucun bulletin ne retiendrait une avance versée après.');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('date');
    // Hors de l'année regardée : refusée, avec le geste qui débloque.
    await fenetre.locator('[name=employeeId]').selectOption({ label: 'Salarié Numéro Un' });
    await fenetre.locator('[name=date]').fill('05/12/2024');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Une avance se saisit dans l\'année regardée (2025) : pour une avance de 2024, change d\'année en haut de la page.');
    await fenetre.locator('[name=date]').fill('05/10/2025');
    // Un montant qui ne se lit pas, une retenue vide : refusés, sur leur case.
    await fenetre.locator('[name=amount]').fill('mille');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('« mille » ne se lit pas comme un montant. Écris-le en chiffres, par exemple 1 250,500.');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('amount');
    await fenetre.locator('[name=amount]').fill('1 000,750');
    await fenetre.locator('[name=monthly]').fill('');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Indique la retenue mensuelle : c\'est elle qui rembourse l\'avance, bulletin après bulletin.');
    await fenetre.locator('[name=monthly]').fill('300,125');
    // Quatre mois (trois de 300,125, puis 100,375) ; la part du net, celle que dit le net lui-même ; trois lignes au plus.
    await expect.poll(annonce).toMatch(/^Remboursée en 4 mois à 300,125 DT par bulletin — [\d,]+ % du net habituel de Salarié Numéro Un \([\d ]+,\d{3} DT\)\.$/);
    const dit = await annonce();
    const [, partDite, netDit] = /— ([\d,]+) % du net habituel de .* \(([\d ]+,\d{3}) DT\)/.exec(dit) ?? [];
    const netLu = Number(String(netDit).replace(/ /g, '').replace(',', '.'));
    expect(String(Math.round(300.125 / netLu * 1000) / 10).replace('.', ',')).toBe(partDite);
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('L\'avance de Salarié Numéro Un est enregistrée.');
    expect(await avances()).toEqual([{ id: expect.stringMatching(/^av/), employeeId: 's1', date: '2025-10-05', amount: 1000.75, monthly: 300.125, method: 'virement', note: '' }]);
    await expect.poll(() => ligne(p, 'Numéro Un')).toBe('Salarié Numéro Un 05/10/2025 Virement 1 000,750 DT 300,125 DT 0,000 DT 1 000,750 DT');
    expect(net(await p.locator('#av-qui').innerText())).toMatch(/^1 en cours · 1 000,750 DT encore à retenir\. /);
    // Son versement s'écrit le jour même : le compte du personnel au débit, la banque au crédit ; le brouillard le compte.
    expect(await ecrituresHorsPaie(garage, associe)).toEqual(['BQ 2025-10-05 425 1000.750 0.000 | 532 0.000 1000.750']);
    await expect.poll(auBrouillard).toBe(1);

    // ── Un bulletin nouveau en retient l'échéance ; elle suit le salarié choisi ───────────────────────────────────
    await ouvrirUnBulletin(p);
    const retenues = async () => Promise.all((await fenetre.locator('#bf-retenues tr').all()).map(async (tr) =>
      [await tr.locator('[data-l=label]').inputValue(), await tr.locator('[data-l=amount]').inputValue()]));
    // Dès l'ouverture, sur le salarié proposé d'office, avant tout choix dans la liste.
    expect(await fenetre.locator('[name=salarieId] option:checked').innerText()).toBe('Salarié Numéro Un');
    expect(await retenues()).toEqual([['Remboursement d\'avance du 05/10/2025', '300,125']]);
    await fenetre.locator('[name=salarieId]').selectOption({ label: 'Salarié Numéro Deux' });
    await expect.poll(() => fenetre.locator('#bf-retenues').innerText().then(net)).toBe('Aucune retenue ce mois-ci.');
    await fenetre.locator('[name=salarieId]').selectOption({ label: 'Salarié Numéro Un' });
    await expect.poll(retenues).toEqual([['Remboursement d\'avance du 05/10/2025', '300,125']]);
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    await expect.poll(auBrouillard).toBe(2);
    const bulletin = (await objets()).find((o) => o.collection === 'payslips');
    expect(decoder(bulletin?.contenu.deductions)).toEqual([{ label: 'Remboursement d\'avance du 05/10/2025', amount: 300.125, advanceId: (await avances())[0]?.id }]);
    await expect.poll(() => ligne(p, 'Numéro Un')).toBe('Salarié Numéro Un 05/10/2025 Virement 1 000,750 DT 300,125 DT 300,125 DT 700,625 DT');

    // ── Corriger au clavier : ni sous ce qui a été retenu, ni d'un salarié à l'autre ; Entrée enregistre ───────────
    await p.locator('#av-liste tr', { hasText: 'Numéro Un' }).focus();
    await p.keyboard.press('Enter');
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Modifier l\'avance');
    expect(await fenetre.locator('[name=employeeId]').isDisabled()).toBe(true);
    expect(await annonce()).toMatch(/^Déjà retenu : 300,125 DT ; reste 700,625 DT\. Remboursée en 3 mois à 300,125 DT par bulletin — /);
    await fenetre.locator('[name=amount]').fill('200');
    // L'annonce le dit avant le clic (elle disait l'avance « soldée »).
    await expect.poll(annonce).toBe('Déjà retenu : 300,125 DT. Le montant avancé ne descend pas en dessous.');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('300,125 DT ont déjà été retenus sur des bulletins : le montant avancé ne descend pas en dessous.');
    await fenetre.locator('[name=amount]').fill('1 000,750');
    await fenetre.locator('[name=method]').selectOption('especes');
    await fenetre.locator('[name=note]').fill('Rentrée scolaire');
    await fenetre.locator('[name=note]').press('Enter');
    await expect.poll(async () => (await avances())[0]).toMatchObject({ method: 'especes', note: 'Rentrée scolaire', amount: 1000.75 });
    expect(await p.getByText('Supprimer cette avance ?').count()).toBe(0);
    // Versée en espèces : elle sort de la caisse.
    expect(await ecrituresHorsPaie(garage, associe)).toEqual(['CA 2025-10-05 425 1000.750 0.000 | 54 0.000 1000.750']);
    expect(await auBrouillard()).toBe(2);
    await expect.poll(() => ligne(p, 'Numéro Un')).toBe('Salarié Numéro Un 05/10/2025 Espèces 1 000,750 DT 300,125 DT 300,125 DT 700,625 DT Rentrée scolaire');

    // ── Supprimer : la fenêtre demande, et dit ce qui reste sur les bulletins ─────────────────────────────────────
    await p.locator('#av-liste tr', { hasText: 'Numéro Un' }).click();
    await fenetre.locator('#av-supprimer').click();
    expect(net(await p.locator('#modal-root .modal').last().innerText())).toContain('300,125 DT ont déjà été retenus sur des bulletins : ces retenues y restent, et son versement se retire des écritures.');
    await p.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
    await expect.poll(toast).toBe('Avance supprimée.');
    expect(await avances()).toEqual([]);
    expect(await ecrituresHorsPaie(garage, associe)).toEqual([]);
    // Au brouillard, la paie d'octobre seule.
    await expect.poll(auBrouillard).toBe(1);
    expect(net(await p.locator('#av-panneau .empty').innerText())).toBe('Aucune avance en 2025.');
    // Rien ne déborde du panneau (une avance remise pour la photo).
    expect((await api('POST', `/entreprises/${garage}/paie/dossier`, associe, { changements: [{ collection: 'advances', cle: 'av-photo', rang: null, revision: null,
      contenu: encoder({ id: 'av-photo', employeeId: 's1', date: '2025-10-05', amount: 1000.75, monthly: 300.125, method: 'virement', note: 'Rentrée scolaire, convenue par écrit' }) }] })).statut).toBe(200);
    await ouvrirLaPaie(p, `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${garage}/comptabilite/paie/2025`);
    expect(await p.locator('#av-panneau').evaluate((e) => [...e.querySelectorAll('.scroll-x')].map((x) => x.scrollWidth - x.clientWidth).filter((d) => d > 0))).toEqual([]);
    await p.locator('#av-panneau').screenshot({ path: path.join(PHOTOS, 'cabinet-paie-avances.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);

  it('un client sur SkanFact : ses avances se lisent, et le bulletin du Cabinet en retient l\'échéance — le client lit le même reste', async () => {
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
    expect(await dossierV10('employees', 's1', salarie('s1', 'Salarié Numéro Un', 1234.567, '2024-01-01'))).toBe(200);
    expect(await dossierV10('advances', 'a1', { id: 'a1', employeeId: 's1', date: '2025-09-15', amount: 600.75, monthly: 200.25, method: 'virement', note: '' })).toBe(200);

    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await ouvrirLaPaie(p, `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${boulangerie}/comptabilite/paie/2025`);
    expect(net(await p.locator('#av-qui').innerText())).toBe('1 en cours · 600,750 DT encore à retenir. Ce client les saisit dans son SkanFact (Paie › Avances) : le Cabinet les lit, et un bulletin nouveau en retient l\'échéance.');
    expect(await p.locator('#av-ajouter').count()).toBe(0);
    // La ligne se lit ; elle ne s'ouvre ni au clic ni au clavier.
    const tr = p.locator('#av-liste tbody tr');
    expect(net(await tr.innerText())).toBe('Salarié Numéro Un 15/09/2025 Virement 600,750 DT 200,250 DT 0,000 DT 600,750 DT');
    expect([await tr.getAttribute('class'), await tr.getAttribute('tabindex')]).toEqual([null, null]);
    await tr.click();
    await p.waitForTimeout(300);
    expect(await p.locator('#av-form').count()).toBe(0);
    // Le bulletin d'octobre que le Cabinet établit en retient l'échéance.
    await ouvrirUnBulletin(p);
    const fenetre = p.locator('#modal-root .modal').last();
    await fenetre.locator('[name=salarieId]').selectOption({ label: 'Salarié Numéro Un' });
    await expect.poll(async () => fenetre.locator('#bf-retenues [data-l=label]').inputValue().catch(() => '')).toBe('Remboursement d\'avance du 15/09/2025');
    expect(await fenetre.locator('#bf-retenues [data-l=amount]').inputValue()).toBe('200,250');
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Bulletin enregistré.');
    await expect.poll(async () => net(await p.locator('#av-liste tbody tr').innerText())).toBe('Salarié Numéro Un 15/09/2025 Virement 600,750 DT 200,250 DT 200,250 DT 400,500 DT');
    // Deux chemins, un chiffre : le SkanFact du client, par le moteur de l'entreprise, lit le même reste dans ses données.
    const siennes = ((await api('GET', `/entreprises/${boulangerie}/dossier-v10`, patron)).corps.objets as Objet[]).map((o) => ({ ...o, contenu: decoder(o.contenu) as Record<string, unknown> }));
    const core = ecranDeLaPlateforme('core.js') as { advancesOf: (d: unknown, s: string) => { id: string; repaid: number; remaining: number }[] };
    expect(core.advancesOf({ advances: siennes.filter((o) => o.collection === 'advances').map((o) => o.contenu),
      payslips: siennes.filter((o) => o.collection === 'payslips').map((o) => o.contenu) }, 's1').map((a) => [a.id, a.repaid, a.remaining])).toEqual([['a1', 200.25, 400.5]]);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
