// La clôture de Nour, jusqu'au Cabinet (1.362.5, bout en bout 29). Joué à la souris : Nour clôture d'un coup jusqu'à un
// mois passé. La fenêtre « Clôturer jusqu'à… » nommait « 1 facture en brouillon dans la période » sans aucun moyen de l'ouvrir ;
// partie la voir, Nour revenait sur une fenêtre repartie au premier mois. Et le Cabinet lui réclamait ensuite « rien reçu »
// pour des mois qu'elle venait de déclarer finis — vides — avec « Rien reçu depuis le 15 » au-dessus d'une écriture
// plus récente que les mois réclamés.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const nomMois = (m: string) => MOIS[Number(m.slice(5, 7)) - 1] ?? '';
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const ajouter = (m: string, k: number) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const finDe = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const jjmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

describe('la clôture du client, de la fenêtre au Cabinet (1.362.5)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cloture-1362-5-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('la fenêtre ouvre ses points et retrouve son mois ; le Cabinet ne réclame plus ce que le client a clôturé vide', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    // Les mois, lus sur l'horloge du test : des écritures en A et en D, rien en B ni en C.
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    // A n'est jamais janvier : la grille de son année doit avoir un mois avant lui (étape 3). En mai, A recule d'un mois.
    const M = auj.slice(0, 7), A = ajouter(M, ajouter(M, -4).endsWith('-01') ? -5 : -4), B = ajouter(M, -3), C = ajouter(M, -2), D = ajouter(M, -1);
    const vides = [ajouter(A, 1)];
    while (vides[vides.length - 1] !== C) vides.push(ajouter(vides[vides.length - 1] ?? C, 1));
    const noms = vides.map(nomMois);
    for (const annee of [...new Set([A, D].map((m) => Number(m.slice(0, 4))))]) {
      expect([201, 409]).toContain((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee, ouverture: [] })).statut);
    }
    for (const [m, piece] of [[A, 'OD-1'], [D, 'OD-2']] as const) {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, leila, { date: `${m}-15`, journal: 'OD', piece, libelle: 'Loyer du laboratoire',
        lignes: [{ compte: '6132', debit: '500,000' }, { compte: '401', credit: '500,000' }] });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    }
    // Chez Nour : une facture restée en brouillon, datée de B.
    const ch = await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel Mouradi', city: 'Sousse' } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', type: 'facture', status: 'brouillon', number: '', date: `${B}-10`, clientId: 'c1',
        lines: [{ label: 'Coffret de pâtisseries', qty: 2, unitPrice: 45, vatRate: 19 }], discountRate: 0, withholdingRate: 0, currency: 'DT', payments: [], createdAt: 5 } },
    ] });
    expect(ch.statut, JSON.stringify(ch.corps)).toBe(200);

    // ── 1. Le Cabinet, avant la clôture : B et C manquent ; la dernière écriture (D) est APRÈS eux.
    const cc = await contexte(leila);
    const q = await cc.newPage();
    const erreurs: string[] = [];
    q.on('pageerror', (x) => erreurs.push(x.message));
    // La fiche, une fois ses livres lus (le mot qu'on attend dit qu'ils le sont).
    const fiche = async (attendu: string) => {
      // Une adresse identique ne recharge pas la page (le fragment seul change) : on recharge, comme un comptable qui revient.
      const url = `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}`;
      if (q.url() === url) await q.reload(); else await q.goto(url);
      await expect.poll(async () => net(await q.locator('#view').innerText()), { timeout: 20_000 }).toContain('Ce qui attend');
      await plusTard(q);
      await expect.poll(async () => net(await q.locator('#view').innerText()), { timeout: 15_000 }).toContain(attendu);
      return net(await q.locator('#view').innerText());
    };
    const avant = await fiche(`${cap(`${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`)} · rien reçu`);
    // « Rien reçu depuis le 15/D » au-dessus de B et C : faux, la dernière écriture est après eux.
    expect(avant).not.toContain('Rien reçu depuis');
    expect(avant).toContain(`Aucune écriture sur ces mois, alors que ses livres en ont après (la dernière le ${jjmm(`${D}-15`)}).`);
    await q.screenshot({ path: path.join(PHOTOS, 'cloture-1362-5-cabinet-avant.png'), fullPage: true });

    // ── 2. Chez Nour : « Clôturer jusqu'à… », le point se montre avec son geste, et la fenêtre retrouve son mois.
    const cx = await contexte(nour);
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#c-tabs').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const clotures = async () => { await p.locator('#c-tabs [data-tab="clotures"]').click(); await p.locator('#close-to').waitFor({ timeout: 10_000 }); };
    await clotures();
    await p.locator('#close-to').click();
    const fen = p.locator('#modal-root .modal', { hasText: 'Clôturer jusqu\'à' });
    await fen.waitFor({ timeout: 10_000 });
    await fen.locator('select[name=m]').selectOption(finDe(C));
    await expect.poll(async () => net(await fen.locator('#ct-points').innerText())).toContain('1 facture en brouillon dans la période');
    const geste = fen.locator('[data-ct-check="brouillons"]');
    expect(net(await geste.innerText())).toBe('Voir les brouillons');
    await p.screenshot({ path: path.join(PHOTOS, 'cloture-1362-5-fenetre.png') });
    await geste.click();
    await expect.poll(async () => p.evaluate(() => location.hash)).toBe('#/factures');
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    await p.evaluate(() => { location.hash = '#/compta'; });
    await p.locator('#c-tabs').waitFor({ timeout: 20_000 });
    await clotures();
    await p.locator('#close-to').click();
    await fen.waitFor({ timeout: 10_000 });
    expect(await fen.locator('select[name=m]').inputValue()).toBe(finDe(C));
    await fen.locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText())).toMatch(/^Clôturé jusqu'au /);
    // La clôture part chez le cabinet : le portefeuille la porte.
    await expect.poll(async () => (((await api('GET', `/cabinets/${cabinet}/portefeuille`, leila)).corps.dossiers as Obj[])
      .find((d) => d.entreprise === ent) ?? {}).clotureClient?.jusqua, { timeout: 15_000 }).toBe(finDe(C));

    // ── 3. Le Cabinet, après : B et C sont « sans activité », plus rien n'est réclamé.
    const apres = await fiche(`${cap(noms[0] ?? '')} · sans activité`);
    // Seul le mois en cours dit encore « rien reçu » (rien n'y est écrit) ; janvier à A-1 sont « avant la mission ».
    expect(apres.replace('en cours rien reçu', '')).not.toContain('rien reçu');
    expect(apres).toContain('sans activité');
    expect(apres).toContain('Clôturé par le client sans une écriture');
    await q.screenshot({ path: path.join(PHOTOS, 'cloture-1362-5-cabinet-apres.png'), fullPage: true });
    // La grille de l'année de A : janvier est avant ses livres (« le premier mois de ses livres », dit la fiche), il ne dit
    // pas « rien reçu ». L'horloge de la page est posée en décembre de cette année, pour que la grille la montre quel que
    // soit le jour du test.
    const cv = await contexte(leila);
    const v = await cv.newPage();
    v.on('pageerror', (x) => erreurs.push(x.message));
    await v.clock.setFixedTime(new Date(`${A.slice(0, 4)}-12-15T10:00:00Z`));
    await v.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}`);
    await plusTard(v);
    await expect.poll(async () => net(await v.locator('#view').innerText()), { timeout: 20_000 }).toContain(`L'année ${A.slice(0, 4)}`);
    await expect.poll(async () => net(await v.locator('#view').innerText()), { timeout: 10_000 }).toMatch(/JANV\. avant la mission/);
    await v.screenshot({ path: path.join(PHOTOS, 'cloture-1362-5-annee-de-a.png'), fullPage: true });
    // Le tableau de bord ne réclame plus de mois sans écriture à ce client.
    await q.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/production`);
    await q.getByText('Tableau de bord', { exact: true }).first().waitFor({ timeout: 20_000 });
    await q.waitForTimeout(800);
    expect(net(await q.locator('#view').innerText())).not.toMatch(/mois sans écriture/);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
