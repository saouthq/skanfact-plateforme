// 1.357.6 — la boulangerie verse les espèces du comptoir à la BIAT (bout en bout 15), joué à la souris puis au Cabinet :
//   - une CAISSE se compte au lieu de se rapprocher : « Rapprochement » la propose comme un tiroir, montre ce que SkanFact
//     garde pour elle, dit pendant la frappe s'il manque quelque chose, et note l'écart (658 / 758, À VÉRIFIER) ; la carte
//     du compte dit quand elle a été comptée pour la dernière fois ;
//   - un règlement en espèces part de la caisse, une carte ou un virement de la banque : le compte suit le mode tant que
//     personne ne l'a choisi à la main (`compteSuitLeMode`) ;
//   - le total d'une dépense ne dit « Payé » que si elle l'est : son règlement supprimé, il dit « À payer », et la question
//     nomme la dépense (« La dépense redeviendra due ») ;
//   - au Cabinet, l'écart du comptage arrive au brouillard, 658 contre 54 (deux chemins, un chiffre).
// Les dates sont celles du jour : le tiroir se compte aujourd'hui.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('le tiroir de la boulangerie 1.357.6 : il se compte, les espèces y vont, et la dépense dit si elle est payée', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tiroir-1357-'));
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
  const plusTard = async (p: import('playwright-core').Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  it('la caisse se compte, l\'écart se note et part au Cabinet ; les espèces vont à la caisse ; la dépense dit « À payer »', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const auj = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const fr = auj.split('-').reverse().join('/');

    // La BIAT (par défaut) et la caisse du comptoir (un fond de 50) ; la farine à payer ; un sachet de levure payé à la caisse.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'accounts', cle: 'a-biat', rang: 20, revision: null, contenu: { id: 'a-biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', opening: 1000, openingDate: auj, isDefault: true } },
      { collection: 'accounts', cle: 'a-caisse', rang: 21, revision: null, contenu: { id: 'a-caisse', name: 'Caisse du comptoir', kind: 'caisse', opening: 50, openingDate: auj } },
      { collection: 'suppliers', cle: 's1', rang: 1, revision: null, contenu: { id: 's1', name: 'Minoterie du Cap Bon' } },
      { collection: 'purchases', cle: 'a1', rang: 1, revision: null, contenu: { id: 'a1', kind: 'facture', supplierId: 's1', number: 'FA-0201', date: auj, currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
        tvaRecuperable: true, lines: [{ label: 'Farine T55', qty: 1, unitPrice: 100, vatRate: 19, destination: 'charge', deductible: true }], payments: [] } },
      { collection: 'purchases', cle: 'd1', rang: 2, revision: null, contenu: { id: 'd1', kind: 'depense', supplierId: '', number: '', date: auj, currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
        tvaRecuperable: true, lines: [{ label: 'Sachets de levure', qty: 1, unitPrice: { '~n': '2.101' }, vatRate: 19, destination: 'charge', deductible: true }],
        payments: [{ id: 'pd1', date: auj, amount: { '~n': '2.5' }, method: 'especes', accountId: 'a-caisse', reference: '', note: 'payée le jour même' }] } },
    ] })).statut).toBe(200);

    const cx = await contexte(sarra);
    const erreurs: string[] = [];
    const page = async (ancre: string, attendre: string) => {
      const p = await cx.newPage();
      p.on('pageerror', (x) => erreurs.push(x.message));
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${ancre}`);
      await p.locator(attendre).first().waitFor({ timeout: 20_000 });
      await plusTard(p);
      return p;
    };

    // ── 1. Le tiroir : la carte de la caisse propose de la compter, et le rapprochement la compte au lieu de la rapprocher.
    const t = await page('#/tresorerie', '#tr-comptes .tr-compte');
    expect(net(await t.locator('#tr-comptes').innerText())).toMatch(/Caisse du comptoir[\s\S]*Pas encore comptée Compter le tiroir/);
    await t.locator('#tr-comptes [data-compter="a-caisse"]').click();
    await t.locator('#t-compte').waitFor({ timeout: 10_000 });
    expect(await t.locator('#t-tabs [data-tab="rapprochement"]').getAttribute('aria-selected')).toBe('true');
    expect(net(await t.locator('#t-acc2 option[value="a-caisse"]').innerText())).toBe('Caisse du comptoir · tiroir à compter');
    // 50 au départ, 2,500 de levure : 47,500 devraient être dans le tiroir. Rien de « relevé » ni de tickets à cocher.
    expect(net(await t.locator('#t-reco').innerText())).toMatch(/Au départ 50,000 DT[\s\S]*Devrait être dans le tiroir 47,500 DT/);
    expect(await t.locator('#t-body input[type=checkbox][data-rec]').count()).toBe(0);
    expect(await t.locator('#tiroir-ecart').isHidden()).toBe(true);
    // Pendant la frappe, le verdict : 47 comptés, il manque 0,500.
    await t.locator('#t-compte').click();
    await t.keyboard.type('47');
    await expect.poll(async () => net(await t.locator('#t-compte-verdict').innerText())).toBe('Il manque 0,500 DT dans le tiroir. Un paiement noté ailleurs ? Sinon, note l\'écart.');
    expect(await t.locator('#tiroir-ecart').isVisible()).toBe(true);
    // Quitter la case ne redessine pas : le clic sur « Noter l'écart » atterrit (vu à la souris).
    await t.locator('#t-noter-ecart').click();
    await expect.poll(async () => net(await t.locator('#t-compte-verdict').innerText()), { timeout: 10_000 }).toBe('Ça tombe juste. Le tiroir et SkanFact disent la même chose.');
    expect(net(await t.locator('#t-reco').innerText())).toMatch(/Devrait être dans le tiroir 47,000 DT/);
    // La BIAT, elle, garde son rapprochement.
    await t.locator('#t-acc2').selectOption('a-biat');
    await t.locator('#t-depart').waitFor({ timeout: 10_000 });
    expect(await t.locator('#t-compte').count()).toBe(0);
    // La carte de la caisse dit quand elle a été comptée, et combien.
    await t.locator('#t-tabs [data-tab="position"]').click();
    await expect.poll(async () => net(await t.locator('#tr-comptes').innerText()), { timeout: 10_000 }).toContain(`Comptée le ${fr} : 47,000 DT`);
    await t.close();

    // ── 2. Régler la farine : en espèces, de la caisse ; par carte, de la banque ; un compte choisi à la main ne bouge plus.
    const a = await page('#/achat/a1', '#view .ed-net');
    await a.getByRole('button', { name: 'Enregistrer un règlement' }).first().click();
    const f = a.locator('#modal-root .modal', { has: a.locator('#spf') });
    await f.waitFor({ timeout: 10_000 });
    const compte = () => f.locator('[name=accountId]').inputValue();
    await f.locator('[data-mode="especes"]').click();
    expect(await compte()).toBe('a-caisse');
    await f.locator('[data-mode="carte"]').click();
    expect(await compte()).toBe('a-biat');
    await f.locator('[name=accountId]').selectOption('a-caisse');
    await f.locator('[data-mode="virement"]').click();
    expect(await compte()).toBe('a-caisse');
    await f.getByRole('button', { name: 'Annuler' }).click();
    const q = a.locator('#modal-root .modal').filter({ hasText: 'Abandonner' });
    if (await q.count()) await q.getByRole('button', { name: /Abandonner/ }).click();
    await a.close();

    // ── 3. La dépense payée à la caisse : « Payé » ; son règlement supprimé, « À payer », et la question la nomme.
    const d = await page('#/achat/d1', '#view .ed-net');
    expect(net(await d.locator('#view .ed-net .k').innerText())).toBe('Payé');
    await d.locator('.ac-paie-t tr', { hasText: 'Espèces' }).locator('.row-menu-btn').first().click({ timeout: 15_000 });
    await d.getByRole('menuitem', { name: /Supprimer ce règlement/ }).click();
    const qd = d.locator('#modal-root .modal').last();
    expect(net(await qd.innerText())).toMatch(/La dépense redeviendra due de 2,500 DT\./);
    await qd.getByRole('button', { name: 'Supprimer le règlement' }).click();
    await expect.poll(async () => net(await d.locator('#view .ed-net .k').innerText()), { timeout: 10_000 }).toBe('À payer');
    await d.close();
    // Une dépense neuve suit le choix « Payée » : « pas encore » dit « À payer ».
    const n = await page('#/achat/new/-/depense', '#ac-dep-paye');
    expect(net(await n.locator('#view .ed-net .k').innerText())).toBe('Payé');
    await n.locator('#ac-dep-paye').selectOption('');
    expect(net(await n.locator('#view .ed-net .k').innerText())).toBe('À payer');
    await n.locator('#ac-dep-paye').selectOption('especes');
    expect(net(await n.locator('#view .ed-net .k').innerText())).toBe('Payé');
    await n.close();

    // ── 4. Au Cabinet : l'écart du comptage est au brouillard, 658 contre 54, au même montant.
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { date: string; statut: string; lignes: Ligne[] };
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/compta/ecritures?piece=Comptage&limite=50`, leila)).corps.ecritures as Ecriture[] ?? [])
      .map((x) => [x.date, x.statut, ...x.lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`).sort()].join(' | ')), { timeout: 20_000 })
      .toEqual([`${auj} | brouillard | 54 0.000 0.500 | 658 0.500 0.000`]);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 240_000);
});
