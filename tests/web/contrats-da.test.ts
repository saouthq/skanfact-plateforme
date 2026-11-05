// La Facturation récurrente dans la nouvelle DA (1.280.0), comme le Catalogue : l'en-tête (chemin, titre, phrase), quatre
// chiffres au-dessus de la liste (contrats actifs, ce qu'ils rapportent par mois, à générer, prochaine facture), la liste
// dans une carte. Les chiffres portent sur tous les contrats ; un contrat suspendu ne rapporte rien. « À générer » filtre
// la liste. Au téléphone, rien ne déborde.

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

describe('la Facturation récurrente dans la nouvelle DA', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-contrats-'));
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
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('l\'en-tête, les quatre chiffres sur tous les contrats ; « À générer » filtre la liste ; au téléphone rien ne déborde', async () => {
    const email = `contrats-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Ines Gharbi', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Gharbi Hébergement' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Trois contrats : un mensuel à 89,000 HT déjà échu (à générer), un trimestriel à 450,500 HT plus tard, un mensuel à
    // 120,000 HT suspendu. Par an : 89 × 12 + 450,5 × 4 = 1 068 + 1 802 = 2 870,000 ; par mois 239,166… → 239,167.
    // Le suspendu ne compte pas (sinon 359,167 par mois).
    const contrat = (id: string, clientId: string, every: string, prix: number, nextDate: string, active = true) => ({ collection: 'recurring', cle: id, rang: 0, revision: null,
      contenu: { id, clientId, every, day: 5, nextDate, active, subject: `Contrat ${id} — {mois}`,
        lines: [{ label: 'Service', description: '', qty: 1, unit: 'mois', unitPrice: { '~n': String(prix) }, vatRate: 19 }],
        discountRate: 0, withholdingRate: 0, notes: '', currency: 'DT', exchangeRate: '', createdAt: 1 } });
    const client = (id: string, name: string) => ({ collection: 'clients', cle: id, rang: 0, revision: null, contenu: { id, name } });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      client('c1', 'Pharmacie Ben Youssef'), client('c2', 'Clinique Les Oliviers'), client('c3', 'Café du Port'),
      contrat('mens', 'c1', 'month', 89, '2026-01-05'), contrat('trim', 'c2', 'quarter', 450.5, '2030-03-05'),
      contrat('susp', 'c3', 'month', 120, '2026-02-05', false)] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');
    expect((ecrit.revisions as unknown[] | undefined)?.length).toBe(6);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/contrats`);
    await p.locator('#c-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    // L'en-tête du modèle : le chemin, le titre, la phrase ; le bouton reste dans l'en-tête.
    expect(net(await p.locator('#view .page-head.lf-tete .chemin').innerText())).toBe('Accueil Facturation récurrente');
    expect(net(await p.locator('#view .page-head .sous').innerText())).toBe('Les factures qui reviennent toutes seules : abonnements, maintenances, forfaits');
    expect(net(await p.locator('#view .page-head #new').innerText())).toBe('+ Nouveau contrat');
    const chiffres = (await p.locator('#c-resume .mg-chiffre').allInnerTexts()).map(net);
    expect(chiffres).toEqual([
      'Contrats actifs 2 1 suspendu',
      'Rapportent par mois 239,167 DT 2 870,000 DT HT par an',
      'À générer 1 brouillons à préparer — voir lesquels',
      'Prochaine facture 05/01/2026 Pharmacie Ben Youssef',
    ]);
    expect(await p.locator('#c-resume b.ambre').count()).toBe(1);
    // La liste est dans sa carte, et compte les trois contrats.
    expect(await p.locator('.lf.mg.rc .cf-carte #c-wrap table.list tbody tr').count()).toBe(3);
    await p.screenshot({ path: path.join(PHOTOS, 'contrats-da-1.png') });

    // « À générer » filtre la liste ; le filtre le dit ; les chiffres, eux, ne bougent pas.
    await p.locator('#c-resume [data-aller=due]').click();
    await expect.poll(() => p.locator('#c-wrap table.list tbody tr').count()).toBe(1);
    expect(await p.locator('#c-wrap select#st').inputValue()).toBe('due');
    expect(net(await p.locator('#c-wrap tbody tr').innerText())).toContain('Pharmacie Ben Youssef');
    expect((await p.locator('#c-resume .mg-chiffre').allInnerTexts()).map(net)[0]).toBe('Contrats actifs 2 1 suspendu');

    // Au téléphone : rien ne déborde de la page ni d'un chiffre.
    await p.locator('#c-wrap select#st').selectOption('');
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#c-resume .mg-chiffre, #c-resume .mg-chiffre b')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5 || x.scrollWidth > x.clientWidth + 1).length;
      const carte = document.querySelector('.lf.mg.rc #c-wrap')?.closest('.cf-carte')?.getBoundingClientRect().right ?? 0;
      const coupes = [...document.querySelectorAll('#c-wrap table.list tbody tr')].filter((x) => x.getBoundingClientRect().right > carte + 0.5).length;
      return { page: document.documentElement.scrollWidth - largeur, hors, coupes };
    });
    expect(debord).toEqual({ page: 0, hors: 0, coupes: 0 });
    await p.evaluate(() => scrollTo(0, 0));
    await p.screenshot({ path: path.join(PHOTOS, 'contrats-da-2-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
