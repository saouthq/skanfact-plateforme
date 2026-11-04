// La paie d'un dossier dont l'entreprise n'est PAS sur SkanFact (Skander, 04/11/2026 : « pareil pour cabinet aussi, les
// entreprises hors SkanFact, il y en aura beaucoup »). Le cabinet fait tout : rien n'attend un accord, rien ne s'envoie à un
// client qui n'a pas SkanFact. Le mois entier, à la souris : établir les deux bulletins, les valider, les remettre ;
// la CNSS du trimestre ; aucun bouton qui demande au client un geste dans SkanFact.
// L'exercice 2025 est passé : rien ne dépend du jour où le parcours tourne. Les salaires discriminent (1 234,567 et 980).

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

describe('la paie d\'un client hors SkanFact, au Cabinet, de bout en bout', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-hors-'));
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
  it('le mois d\'un dossier tenu : établir, valider, remettre, sans accord ni envoi au client', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Menuiserie Ben Ali' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/paie/dossier`, associe, { changements: [
      { collection: 'employees', cle: 's1', rang: null, revision: null, contenu: encoder(salarie('s1', 'Salarié Numéro Un', 1234.567, '2025-01-01')) },
      { collection: 'employees', cle: 's2', rang: null, revision: null, contenu: encoder(salarie('s2', 'Salarié Numéro Deux', 980, '2025-03-01')) },
    ] })).statut).toBe(200);
    const bulletins = async () => ((await api('GET', `/entreprises/${ent}/paie/dossier`, associe)).corps.objets as Objet[])
      .filter((o) => o.collection === 'payslips').map((o) => decoder(o.contenu) as Record<string, unknown>);
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
    const principal = () => p.locator('#view .btn-primary').evaluateAll((els) => els.filter((e) => e.id.startsWith('pa-')).map((e) => `${e.id} ${(e.textContent ?? '').replace(/\s+/g, ' ').trim()}`));
    const jour = new Date().toISOString().slice(0, 10);
    // ── Le mois : « tenue au cabinet », sans client à qui demander quoi que ce soit ──────────────────────────────
    expect(net(await p.locator('#pa-qui').innerText())).toBe('2 salariés · tenue au cabinet');
    expect(await principal()).toEqual(['pa-bulletin Établir les bulletins : 2 à faire…']);
    expect(net(await p.locator('#pa-frise').innerText())).toContain('à saisir au cabinet, ou des mois complets');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-hors-1-mois.png'), fullPage: true });
    // ── Établir les deux bulletins, puis les valider : aucun accord n'est attendu ───────────────────────────────
    const fenetre = p.locator('#modal-root .modal').last();
    for (const nom of ['Salarié Numéro Un', 'Salarié Numéro Deux']) {
      await ouvrirUnBulletin(p);
      await fenetre.locator('[name=salarieId]').selectOption({ label: nom });
      await fenetre.locator('#ok').click();
      await expect.poll(async () => (await p.locator('#toast').textContent()) ?? '').toBe('Bulletin enregistré.');
      await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    }
    await expect.poll(async () => (await bulletins()).length).toBe(2);
    await expect.poll(principal).toEqual(['pa-valider-bul Valider les 2 bulletins']);
    expect(await p.locator('#pa-envoyer, #pa-attente').count()).toBe(0);
    // Avant la validation, aucun salaire ne se note payé : le bouton n'est pas là, et le pont le refuse en le disant.
    expect(await p.locator('#pa-noter-payes').count()).toBe(0);
    const cles = ((await api('GET', `/entreprises/${ent}/paie/dossier`, associe)).corps.objets as Objet[]).filter((o) => o.collection === 'payslips').map((o) => o.cle);
    type Pont = { cabinet: { marquerBulletins: (x: unknown) => Promise<unknown> } };
    expect(await p.evaluate(async (o) => { try { await (window as unknown as Pont).cabinet.marquerBulletins(o); return 'passé'; } catch (e) { return (e as Error).message; } },
      { dossierId: ent, annee: 2025, ids: cles, champs: { paidDate: jour } })).toBe('Un salaire se note payé une fois son bulletin validé.');
    expect((await bulletins()).filter((b) => b.paidDate).length).toBe(0);
    await p.locator('#pa-valider-bul').click();
    await p.getByRole('button', { name: 'Valider', exact: true }).last().click();
    await expect.poll(async () => (await bulletins()).filter((b) => b.valideLe === jour).length).toBe(2);
    // ── Faits : rien ne s'envoie à un client qui n'a pas SkanFact ; le cabinet note les salaires payés ─────────────
    await expect.poll(() => p.locator('#pa-faits').count()).toBe(1);
    expect(await p.locator('#pa-rappel, #pa-envoyer-pdf').count()).toBe(0);
    const salaires = () => p.locator('#pa-faits li').nth(1).innerText().then(net);
    expect(await salaires()).toContain('0 sur 2 payés · à noter quand ton client te le dit');
    expect(net(await p.locator('#pa-noter-payes').innerText())).toBe('Noter les 2 salaires payés');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-hors-2-valides.png'), fullPage: true });
    await p.locator('#pa-noter-payes').click();
    await expect.poll(async () => (await bulletins()).filter((b) => b.paidDate === jour).length).toBe(2);
    await expect.poll(salaires).toContain('payés, notés au cabinet');
    expect(await p.locator('#pa-noter-payes').count()).toBe(0);
    // Payés, les bulletins ne se dévalident plus, même le jour de leur validation (« Annuler » du toast).
    expect(await p.evaluate(async (o) => { try { await (window as unknown as Pont).cabinet.marquerBulletins(o); return 'passé'; } catch (e) { return (e as Error).message; } },
      { dossierId: ent, annee: 2025, ids: cles, champs: { valideLe: null }, annulerValidation: true, valideLe: jour })).toBe('Ce bulletin est validé : il ne change plus.');
    expect(await p.locator('#pa-faits li').nth(1).getAttribute('class')).toContain('fait');
    expect(net(await p.locator('#pa-frise li').nth(3).innerText())).toContain('payés');
    expect(await p.locator('#pa-frise li').nth(3).getAttribute('class')).toContain('fait');
    // Les montants n'ont pas bougé : seule la marque « payé le » s'est écrite.
    expect((await bulletins()).map((b) => [b.employeeId ?? b.salarieId, b.paidDate]).sort()).toEqual([['s1', jour], ['s2', jour]]);
    // Remettre reste possible après : le dernier geste du mois.
    await p.locator('#pa-remettre').click();
    await expect.poll(async () => (await bulletins()).filter((b) => b.remisLe === jour).length).toBe(2);
    await expect.poll(principal).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-hors-3-payes.png'), fullPage: true });
    // ── La CNSS du trimestre : les deux salariés, leurs assiettes exactes ─────────────────────────────────────────
    await p.locator('.pa-so [data-pa-vue="cnss"]').click();
    await expect.poll(() => p.locator('#view').innerText().then(net), { timeout: 10_000 }).toContain('Salarié Numéro Un — 1 234,567 DT');
    expect(net(await p.locator('#view').innerText())).toContain('Salarié Numéro Deux — 980,000 DT');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
