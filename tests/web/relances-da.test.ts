// Les Relances dans la nouvelle DA (1.283.0), comme le Catalogue : l'en-tête (chemin, titre, phrase), quatre chiffres sur
// toutes les factures — pas la recherche — (à relancer et ce qu'il reste à récupérer, plus de 45 jours, échéances sous
// 7 jours, devis sans réponse), la liste dans une carte. Un chiffre qui nomme une section y mène. Au téléphone, rien ne
// déborde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('les Relances dans la nouvelle DA', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-relances-'));
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
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('l\'en-tête, les quatre chiffres sur toutes les factures ; la recherche ne les change pas ; au téléphone rien ne déborde', async () => {
    const email = `relances-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amel Ferchichi', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Échafaudages Ferchichi' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    // L'application s'ouvre une première fois sur l'entreprise neuve (elle y pose ses réglages de départ), comme quand on
    // crée ses factures à l'écran : la page vide le dit, et ses chiffres ne se montrent pas.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
    await expect.poll(async () => net(await p.locator('#view').innerText().catch(() => '')), { timeout: 20_000 }).toContain('Relancer tes impayés');
    expect(await p.locator('#rel-resume').isHidden()).toBe(true);
    await p.waitForTimeout(1500);
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = (n: number) => new Date(Date.parse(auj) + n * 86_400_000).toISOString().slice(0, 10);
    // Trois factures émises : une échue depuis 50 jours (le ton « dernière relance »), une depuis 20 jours, une qui arrive
    // à échéance dans 3 jours. À relancer : 1 012,095 + 142,800 = 1 154,895 DT ; sous 7 jours : 238,000 DT.
    const client = { id: 'c1', name: 'Hôtel du Lac', email: 'compta@lac.exemple.tn' };
    const facture = (id: string, date: string, dueDate: string, prix: string) => ({ id, type: 'facture', number: '', date, dueDate, clientId: 'c1', subject: 'Location',
      status: 'brouillon', lines: [{ label: 'Location d\'échafaudage', description: '', qty: 1, unit: '', unitPrice: { '~n': prix }, vatRate: 19 }], discountRate: 0,
      applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0 });
    const factures = [facture('f1', jour(-80), jour(-50), '850.5'), facture('f2', jour(-40), jour(-20), '120'), facture('f3', jour(-10), jour(3), '200')];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client },
      ...factures.map((f, i) => ({ collection: 'documents', cle: f.id, rang: i, revision: null, contenu: f }))] })).statut).toBe(200);
    for (const [i, [f, net]] of ([[factures[0], '1012.095'], [factures[1], '142.800'], [factures[2], '238.000']] as const).entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: f, client, revision: 1, rang: i, netAPayer: net });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    }

    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
    await p.locator('#rel-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    expect(net(await p.locator('#view .page-head.lf-tete .chemin').innerText())).toBe('Accueil Relances');
    expect(net(await p.locator('#view .page-head .sous').innerText())).toBe('Les factures en retard, celles qui arrivent à échéance et les devis sans réponse : chacun avec son message prêt à partir');
    const attendus = [
      'À relancer 2 1 154,895 DT à récupérer',
      'Plus de 45 jours 1 au ton « Dernière relance »',
      'Échéances sous 7 jours 1 238,000 DT attendus — voir lesquelles',
      'Devis sans réponse 0 aucun devis en attente',
    ];
    expect((await p.locator('#rel-resume .mg-chiffre').allInnerTexts()).map(net)).toEqual(attendus);
    expect(await p.locator('#rel-resume b.rouge').count()).toBe(2);
    // La liste est dans sa carte.
    expect(await p.locator('.lf.mg.rl .cf-carte #r-wrap table.list.sortable tbody tr').count()).toBe(2);
    await p.screenshot({ path: path.join(PHOTOS, 'relances-da-1.png') });

    // La recherche réduit la liste, pas les chiffres (ils disent l'état de l'entreprise).
    await p.locator('#rel-q').fill('zzz-aucune');
    await expect.poll(() => p.locator('#r-wrap table.list.sortable tbody tr').count()).toBe(0);
    expect((await p.locator('#rel-resume .mg-chiffre').allInnerTexts()).map(net)).toEqual(attendus);
    await p.locator('#rel-q').fill('');
    await expect.poll(() => p.locator('#r-wrap table.list.sortable tbody tr').count()).toBe(2);
    // « Échéances sous 7 jours » mène à sa section.
    await p.setViewportSize({ width: 1440, height: 500 });
    await p.locator('#rel-resume [data-aller=r-bientot]').click();
    await expect.poll(() => p.evaluate(() => { const r = document.getElementById('r-bientot')?.getBoundingClientRect(); return !!r && r.top >= -1 && r.top < innerHeight; })).toBe(true);

    // Au téléphone : rien ne déborde de la page ni d'un chiffre.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(400);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#rel-resume .mg-chiffre, #rel-resume .mg-chiffre b')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5 || x.scrollWidth > x.clientWidth + 1).length;
      return { page: document.documentElement.scrollWidth - largeur, hors };
    });
    expect(debord).toEqual({ page: 0, hors: 0 });
    await p.screenshot({ path: path.join(PHOTOS, 'relances-da-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
