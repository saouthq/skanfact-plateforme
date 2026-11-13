// (1.362.3, bout en bout 27) Joué au Cabinet sur la pâtisserie de Nour : Yassine, embauché ce mois-ci, et une écriture
// datée de janvier de l'an prochain au brouillard. La comptabilité s'ouvrait sur l'exercice suivant, douze mois « à venir » ;
// janvier réclamait le bulletin d'un salarié qui n'était pas encore là (« Bulletins : 1 à faire », « CNSS du 1er trimestre à
// déposer ») ; et revenu de l'exercice suivant, la Paie restait sur janvier.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la Paie du Cabinet regarde les mois qui ont commencé, et les salariés qu\'ils attendent (1.362.3)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-paie-1362-3-'));
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


  it('l\'exercice qui a commencé, le mois qui a commencé, et janvier sans personne en poste', async () => {
    const associe = await personne('associe');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps;
    const cabinet = String(cab.id);
    const patron = await personne('client');
    const patisserie = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Pâtisserie Nour' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${patisserie}/mandat`, patron, { codeCabinet: cab.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    // Le mois du jour, lu sur l'horloge du test ; l'exercice d'après est ouvert d'avance et porte une écriture de janvier.
    const maintenant = new Date();
    const annee = maintenant.getUTCFullYear(), mois = maintenant.getUTCMonth() + 1;
    expect((await api('POST', `/entreprises/${patisserie}/compta/exercices`, associe, { annee, ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${patisserie}/compta/exercices`, associe, { annee: annee + 1, ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${patisserie}/compta/ecritures`, associe, { date: `${annee + 1}-01-15`, journal: 'OD', piece: 'OD-1', libelle: 'Loyer de janvier',
      lignes: [{ compte: '6132', debit: '500,000' }, { compte: '401', credit: '500,000' }] })).statut).toBe(201);
    const embauche = `${annee}-${String(mois).padStart(2, '0')}-01`;
    const yassine = { id: 's1', name: 'Yassine Trabelsi', grossSalary: 1200, hireDate: embauche, contract: 'cdi',
      headOfFamily: false, children: 0, active: true, method: 'virement', iban: '', cnss: '', primes: [] };
    expect((await api('POST', `/entreprises/${patisserie}/dossier-v10`, patron,
      { changements: [{ collection: 'employees', cle: 's1', rang: null, revision: null, contenu: encoder(yassine) }] })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await page(associe, erreurs);
    const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    // L'adresse sans exercice : celui qui a commencé, pas celui de l'écriture de janvier prochain.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${patisserie}/comptabilite/paie`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await expect.poll(() => p.locator('#lv-annee').inputValue(), { timeout: 15_000 }).toBe(String(annee));
    await expect.poll(() => p.locator('#pa-mois').inputValue(), { timeout: 15_000 }).toBe(String(mois));

    if (mois > 1) {
      // Janvier : Yassine n'était pas encore là. Rien à faire, et l'écran le dit au lieu de réclamer son bulletin.
      await p.locator('#pa-mois').selectOption('1');
      await expect.poll(async () => espace(await p.locator('#pa-vide').innerText().catch(() => '')), { timeout: 15_000 })
        .toContain(`Personne n'est en poste en janvier : Yassine Trabelsi entre le 01/${String(mois).padStart(2, '0')}/${annee}. Aucun bulletin à faire.`);
      const frise = (await p.locator('#pa-frise li').allInnerTexts()).map(espace);
      expect(frise[0]).toContain('personne en poste ce mois');
      expect(frise[1]).toContain('aucun à faire');
      expect(frise[4]).toContain('pas de CNSS au 1er trimestre : personne en poste');
      expect(await p.locator('#pa-bulletin').count()).toBe(0);
      await p.locator('#pa-mois').selectOption(String(mois));
      await expect.poll(async () => espace(await p.locator('#pa-frise').innerText()), { timeout: 15_000 }).not.toContain('personne en poste ce mois');
    }
    // L'exercice d'après s'ouvre sur son premier mois, jamais sur le mois qu'on regardait (un mois qui n'existe pas encore) ;
    // revenu sur l'exercice du jour, la Paie revient sur le mois du jour.
    await p.locator('#lv-annee').selectOption(String(annee + 1));
    await expect.poll(() => p.locator('#pa-mois').inputValue(), { timeout: 15_000 }).toBe('1');
    await p.locator('#lv-annee').selectOption(String(annee));
    await expect.poll(() => p.locator('#pa-mois').inputValue(), { timeout: 15_000 }).toBe(String(mois));

    // Une réponse en retard ne repeint pas l'exercice qu'on regarde : le livre de l'an prochain, retardé, arrive APRÈS le
    // retour sur l'exercice du jour — son écriture au brouillard ne s'installe pas sous l'étiquette de cette année.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${patisserie}/comptabilite/journal/${annee + 1}`);
    await expect.poll(async () => espace(await p.locator('#c-livres').innerText().catch(() => '')), { timeout: 15_000 }).toContain('1 écriture de l\'exercice attend au brouillard');
    await p.route((u) => u.searchParams.get('du') === `${annee + 1}-01-01`, async (r) => { await new Promise((ok) => setTimeout(ok, 2_500)); await r.continue().catch(() => undefined); });
    await p.locator('#lv-annee').selectOption(String(annee));
    await expect.poll(() => p.locator('#lv-annee').inputValue(), { timeout: 15_000 }).toBe(String(annee));
    await p.locator('#lv-annee').selectOption(String(annee + 1));
    await p.locator('#lv-annee').selectOption(String(annee));
    await p.waitForTimeout(4_000);
    expect(await p.locator('#lv-annee').inputValue()).toBe(String(annee));
    expect(espace(await p.locator('#c-livres').innerText())).not.toContain('1 écriture de l\'exercice attend au brouillard');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
