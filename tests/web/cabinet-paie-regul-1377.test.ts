// (1.377.0, issue 10, CABPAIE-1) Une absence non payée posée APRÈS la validation du mois : la fenêtre le dit avant
// d'enregistrer, la liste ne la dit pas « retirée du salaire », le mois validé nomme la différence et son montant, et
// « Régulariser sur novembre » la porte sur le bulletin suivant, qui la propose de lui-même. Écran ET serveur ; 2025 est
// passé : rien ne dépend du jour où le parcours tourne. 1 300 DT sur 26 jours : 50,000 DT le jour.

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

describe('la régularisation d\'une absence arrivée après la validation, au Cabinet', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-regul-'));
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
  const ouvrirUnBulletin = async (p: Page) => expect.poll(async () => {
    if (!await p.locator('#bf').count()) await p.locator('#pa-bulletin').first().click({ timeout: 2_000 }).catch(() => {});
    return p.locator('#bf').count();
  }, { timeout: 20_000 }).toBe(1);
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();
  const salarie = (id: string, name: string, grossSalary: number, hireDate: string, endDate = '') =>
    ({ id, name, grossSalary, hireDate, endDate, contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '' });
  it('une absence sans solde posée après la validation : dite avant, à régulariser, retenue sur le bulletin du mois suivant', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Menuiserie Ben Ali' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);
    // 1 300 DT sur 26 jours : 50,000 DT le jour (un chiffre qu'on refait de tête).
    expect((await api('POST', `/entreprises/${ent}/paie/dossier`, associe, { changements: [
      { collection: 'employees', cle: 's1', rang: null, revision: null, contenu: encoder(salarie('s1', 'Amel Trabelsi', 1300, '2025-01-01')) },
    ] })).statut).toBe(200);
    const objets = async () => ((await api('GET', `/entreprises/${ent}/paie/dossier`, associe)).corps.objets as Objet[]);
    const employe = async () => decoder((await objets()).filter((o) => o.collection === 'employees')[0]?.contenu ?? {}) as { regularisations?: { pourMois: string; amount: number; label: string; deBulletin: string }[] };
    const bulletins = async () => (await objets()).filter((o) => o.collection === 'payslips').map((o) => decoder(o.contenu) as Record<string, unknown>);
    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/paie/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('10');
    const fenetre = p.locator('#modal-root .modal').last();
    const toast = async () => net((await p.locator('#toast').textContent()) ?? '');
    // ── Octobre : le bulletin établi (un mois complet) et validé ────────────────────────────────────────────────
    await ouvrirUnBulletin(p);
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    await p.locator('#pa-valider-bul').click();
    await p.getByRole('button', { name: 'Valider', exact: true }).last().click();
    await expect.poll(async () => (await bulletins()).filter((b) => b.valideLe).length).toBe(1);
    expect(await p.locator('#pa-depuis-val').count()).toBe(0);
    // ── Une absence sans solde le 15/10 : la fenêtre le dit AVANT, le toast le redit, la liste ne ment pas ────────
    await p.locator('.pa-so [data-pa-vue="conges"]').click();
    await p.locator('#cg-ajouter').click();
    await fenetre.locator('[name=kind]').selectOption('sans-solde');
    await fenetre.locator('[name=from]').fill('15/10/2025');
    await fenetre.locator('[name=to]').fill('15/10/2025');
    await expect.poll(() => fenetre.locator('#cg-annonce').innerText().then(net)).toBe('1 jour ouvrable, dimanches exclus. Non payée, mais le bulletin d\'octobre est déjà validé : il ne bouge pas. Cette absence sera à régulariser sur le mois suivant, depuis « Le mois » d\'octobre.');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('L\'absence d\'Amel Trabelsi est enregistrée. Octobre est validé : régularise-la depuis « Le mois » d\'octobre.');
    await expect.poll(() => p.locator('#cg-panneau [data-cg-regul]').innerText().then(net).catch(() => '')).toBe('pas retenue : à régulariser');
    // (1.387.82, CABPAIE-1) Le bloc « Les absences à venir » dit la même chose que la liste : vu le 10/10/2025, l'absence
    // du 15 est à venir, et son mois est déjà validé.
    const aVenir = async () => {
      const p2 = await page(associe, erreurs);
      await p2.context().clock.setFixedTime(new Date('2025-10-10T10:00:00+01:00'));
      await p2.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/paie/2025`);
      await p2.locator('.pa-so [data-pa-vue="conges"]').click({ timeout: 20_000 });
      await p2.locator('#pa-absences').waitFor({ timeout: 20_000 });
      const t = net(await p2.locator('#pa-absences').innerText());
      await p2.context().close();
      return t;
    };
    { const t = await aVenir(); expect(t).toContain('pas retenue : à régulariser'); expect(t).not.toContain('retirée du salaire'); }
    // ── Le mois d'octobre : la vraie différence, son montant, et le geste ───────────────────────────────────────
    await p.locator('.pa-so [data-pa-vue="mois"]').click();
    await expect.poll(() => p.locator('#pa-depuis-val').count()).toBe(1);
    expect(net(await p.locator('#pa-depuis-val').innerText())).toMatch(/^Depuis la validation, une absence est arrivée\. /);
    expect(net(await p.locator('#pa-depuis-val').innerText())).toContain('Amel Trabelsi : 0 jour non payé au bulletin, 1 dans « Congés et absences » — à retenir : 50,000 DT de brut Régulariser sur novembre');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-regul-1-a-regulariser.png'), fullPage: true });
    await p.locator('[data-pa-regul]').click();
    expect(net(await fenetre.innerText())).toContain('Le bulletin d\'octobre d\'Amel Trabelsi reste tel quel. Celui de novembre proposera la ligne « Régularisation octobre 2025 : 1 j d\'absence non payée » : − 50,000 DT de brut');
    await fenetre.getByRole('button', { name: 'Régulariser', exact: true }).click();
    await expect.poll(async () => ((await employe()).regularisations ?? []).length).toBe(1);
    const regul = ((await employe()).regularisations ?? [])[0] ?? { pourMois: '', amount: 0, label: '', deBulletin: '' };
    expect([regul.pourMois, regul.amount, regul.label]).toEqual(['2025-11', -50, 'Régularisation octobre 2025 : 1 j d\'absence non payée']);
    expect(regul.deBulletin).toBe(String(((await bulletins())[0] ?? {}).id));
    await expect.poll(() => p.locator('#pa-depuis-val').innerText().then(net)).toBe('Depuis la validation, une absence est arrivée : c\'est régularisé. Amel Trabelsi : régularisé sur novembre (− 50,000 DT de brut) Annuler.');
    expect(await p.locator('[data-pa-regul]').count()).toBe(0);
    // Le bulletin d'octobre n'a pas bougé.
    expect(((await bulletins())[0] ?? {}).absentDays ?? 0).toBe(0);
    // ── « Annuler » la défait, puis on la refait ───────────────────────────────────────────────────────────────
    await p.locator('[data-pa-regul-annuler]').click();
    await expect.poll(async () => ((await employe()).regularisations ?? []).length).toBe(0);
    await expect.poll(() => p.locator('[data-pa-regul]').count()).toBe(1);
    await p.locator('[data-pa-regul]').click();
    await fenetre.getByRole('button', { name: 'Régulariser', exact: true }).click();
    await expect.poll(async () => ((await employe()).regularisations ?? []).length).toBe(1);
    // ── Novembre : le bulletin la propose de lui-même, le brut baisse de 50 ──────────────────────────────────────
    await p.locator('#pa-mois').selectOption('11');
    await ouvrirUnBulletin(p);
    await expect.poll(() => fenetre.locator('#bf-primes [data-l=label]').first().inputValue()).toBe('Régularisation octobre 2025 : 1 j d\'absence non payée');
    expect(await fenetre.locator('#bf-primes [data-l=amount]').first().inputValue()).toBe('-50,000');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-regul-2-novembre.png'), fullPage: true });
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    await expect.poll(async () => (await bulletins()).length).toBe(2);
    const nov = (await bulletins()).find((b) => Number(b.month) === 11) ?? {};
    expect((nov.computed as { gross: number }).gross).toBe(1250);
    // ── Reprise par un bulletin, elle ne s'annule plus ; la liste des absences dit où elle est partie ─────────────
    await p.locator('#pa-mois').selectOption('10');
    await expect.poll(() => p.locator('#pa-depuis-val').innerText().then(net)).toBe('Depuis la validation, une absence est arrivée : c\'est régularisé. Amel Trabelsi : régularisé sur novembre (− 50,000 DT de brut).');
    await p.locator('.pa-so [data-pa-vue="conges"]').click();
    await expect.poll(() => p.locator('#cg-panneau [data-cg-regul]').innerText().then(net).catch(() => '')).toBe('régularisée sur novembre');
    expect(await aVenir()).toContain('régularisée sur novembre');
    expect(erreurs).toEqual([]);
  }, 180_000);
  // (1.377.1, CABPAIE-9) « Noter la sortie… » demande le dernier jour : le salarié reste compté dans le mois où il était là,
  // n'est plus attendu ensuite, et « Annuler la sortie » le remet en poste.
  it('la sortie d\'un salarié se note avec son jour, compte dans son dernier mois, et s\'annule', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Menuiserie Ben Ali' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/paie/dossier`, associe, { changements: [
      { collection: 'employees', cle: 's1', rang: null, revision: null, contenu: encoder(salarie('s1', 'Amel Trabelsi', 1300, '2025-01-01')) },
      { collection: 'employees', cle: 's2', rang: null, revision: null, contenu: encoder(salarie('s2', 'Youssef Mejri', 980, '2025-03-01')) },
    ] })).statut).toBe(200);
    const fiche = async (cle: string) => decoder(((await api('GET', `/entreprises/${ent}/paie/dossier`, associe)).corps.objets as Objet[]).find((o) => o.collection === 'employees' && o.cle === cle)?.contenu ?? {}) as { endDate?: string; active?: boolean };
    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/paie/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('10');
    const fenetre = p.locator('#modal-root .modal').last();
    const toast = async () => net((await p.locator('#toast').textContent()) ?? '');
    const menu = async (libelle: string) => {
      await p.locator('.pa-so [data-pa-vue="salaries"]').click();
      await p.locator('[data-rowmenu="SAL:s1"]').first().click();
      await p.getByRole('menuitem').filter({ hasText: libelle }).click();
    };
    await menu('Noter la sortie…');
    expect(net(await fenetre.locator('h2').innerText())).toBe('La sortie d\'Amel Trabelsi');
    // Avant son entrée : refusée sur sa case.
    await fenetre.locator('#pa-sortie-le').fill('20/12/2024');
    await fenetre.locator('#pa-sortie-ok').click();
    await expect.poll(toast).toBe('Son entrée est le 01/01/2025 : la sortie ne peut pas la précéder.');
    await fenetre.locator('#pa-sortie-le').fill('20/10/2025');
    await fenetre.locator('#pa-sortie-ok').click();
    await expect.poll(toast).toBe('Sortie d\'Amel Trabelsi notée au 20/10/2025.');
    await expect.poll(async () => { const f = await fiche('s1'); return [f.endDate, f.active]; }).toEqual(['2025-10-20', false]);
    // Octobre l'attend encore (deux bulletins à faire), novembre plus (un seul).
    await p.locator('.pa-so [data-pa-vue="mois"]').click();
    await expect.poll(() => p.locator('#pa-bulletin').first().innerText().then(net).catch(() => '')).toBe('Établir les bulletins : 2 à faire…');
    await p.locator('#pa-mois').selectOption('11');
    await expect.poll(() => p.locator('#pa-bulletin').first().innerText().then(net).catch(() => '')).toBe('Établir les bulletins : 1 à faire…');
    // « Annuler la sortie » : de nouveau en poste, sans date.
    await menu('Annuler la sortie');
    await expect.poll(toast).toBe('Amel Trabelsi est de nouveau en poste.');
    await expect.poll(async () => { const f = await fiche('s1'); return [f.endDate ?? '', f.active]; }).toEqual(['', true]);
    // ── (1.377.3, CABPAIE-6) Les bulletins s'enchaînent : la fenêtre s'ouvre sur le premier salarié à servir, « Enregistrer
    // et passer au suivant » la rouvre sur le suivant, et le dernier n'a plus ce bouton.
    await p.locator('.pa-so [data-pa-vue="mois"]').click();
    await p.locator('#pa-mois').selectOption('9');
    await ouvrirUnBulletin(p);
    expect(await fenetre.locator('[name=salarieId]').inputValue()).toBe('s1');
    await fenetre.locator('#ok-suivant').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    await expect.poll(() => fenetre.locator('[name=salarieId]').inputValue().catch(() => '')).toBe('s2');
    expect(await fenetre.locator('#ok-suivant').count()).toBe(0);
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/paie/dossier`, associe)).corps.objets as Objet[]).filter((o) => o.collection === 'payslips').length).toBe(2);
    // Un seul bulletin manque : la fenêtre s'ouvre sur celui-là, pas sur le premier de la liste (déjà servi).
    await p.locator('#pa-mois').selectOption('8');
    await ouvrirUnBulletin(p);
    await fenetre.locator('[name=salarieId]').selectOption('s1');
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await ouvrirUnBulletin(p);
    expect(await fenetre.locator('[name=salarieId]').inputValue()).toBe('s2');
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    // ── (1.377.6, CABPAIE-4) Une retenue tapée sur le bulletin : le net baisse, le brut non. La ligne le dit, et le
    // salarié n'est pas rangé sous « Comme septembre ».
    await p.locator('#pa-mois').selectOption('10');
    await ouvrirUnBulletin(p);
    await fenetre.locator('[name=salarieId]').selectOption('s2');
    await fenetre.locator('#bf-plus-retenue').click();
    await fenetre.locator('#bf-retenues [data-l=label]').last().fill('Opposition');
    await fenetre.locator('#bf-retenues [data-l=amount]').last().fill('100');
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    const ligneY = p.locator('#pa-bulletins tr[data-bul]', { hasText: 'Youssef Mejri' });
    await expect.poll(() => ligneY.locator('small').first().innerText().then(net).catch(() => '')).toBe('retenue : Opposition 100,000 DT');
    expect(net(await p.locator('#pa-bulletins tr.cp-pa-groupe').first().innerText())).toBe('Ce qui change ce mois · 1');
    expect(net(await p.locator('#pa-controles').evaluate((e) => e.textContent ?? ''))).toContain('✓ Écarts de plus de 5 % expliqués · Youssef Mejri − 12,1 % de net');
    expect(erreurs).toEqual([]);
  }, 120_000);
});
