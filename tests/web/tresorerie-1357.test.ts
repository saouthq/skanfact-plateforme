// 1.357.4 — le relevé BIAT de novembre d'une boulangerie, joué à la souris puis au Cabinet (bout en bout 13) :
//   - le solde de départ tapé de travers (48 000 au lieu de 48 250) se lit dans « Ton relevé face à SkanFact » ; il se
//     corrige LÀ, par « corriger » sous le chiffre : la fiche du compte s'ouvre le curseur dans la case, la valeur
//     sélectionnée (la première frappe la remplace), et la page ENTIÈRE se redessine — la carte du compte et le
//     disponible suivent, pas seulement le rapprochement ;
//   - l'état envoyé au comptable PORTE son contenu : les mouvements pas encore passés à la banque, un par ligne, puis le
//     solde de SkanFact et son calcul ; il ne renvoie plus à un écran que le comptable n'a pas ;
//   - au Cabinet, le message arrive tel quel (ses lignes comprises), et le solde de départ est au brouillard,
//     532 contre le compte d'attente 471, au montant corrigé (deux chemins, un chiffre).
// Les dates sont fixes (novembre 2026) : un exercice, quel que soit le jour où le test tourne.
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

describe('le relevé BIAT de novembre 1.357.4 : le solde de départ se corrige là où il se lit, et l\'état part avec son contenu', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-releve-1357-'));
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
  it('la boulangerie corrige son solde de départ sous le chiffre, envoie l\'état, et le Cabinet a le même solde', async () => {
    // ── Le cabinet, et la boulangerie qui lui confie son dossier.
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    // ── La BIAT : un solde de départ tapé de travers (48 000 au lieu de 48 250), le relevé de fin novembre à 48 800,
    // deux mouvements déjà pointés, deux qui ne sont pas encore passés à la banque.
    const mvt = (id: string, date: string, kind: string, montant: string, label: string, reference: string, reconciled: boolean) => ({ collection: 'movements', cle: id, rang: 0, revision: null,
      contenu: { id, date, kind, amount: { '~n': montant }, accountId: 'a-biat', method: 'virement', label, reference, reconciled } });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'accounts', cle: 'a-biat', rang: 20, revision: null, contenu: { id: 'a-biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', opening: 48000, openingDate: '2026-11-01', isDefault: true, statementBalance: '48800' } },
      mvt('m1', '2026-11-05', 'autre-entree', '1500', 'Versement espèces', '', true),
      mvt('m2', '2026-11-06', 'autre-sortie', '950', 'Loyer du local', '', true),
      mvt('m3', '2026-11-10', 'autre-sortie', '850', 'Chèque Moulin de Tunis', 'CHQ 1123', false),
      mvt('m4', '2026-11-11', 'autre-entree', '300', 'Versement espèces', '', false),
    ] })).statut).toBe(200);
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { date: string; statut: string; lignes: Ligne[] };
    const ouverture = async () => ((await api('GET', `/entreprises/${ent}/compta/ecritures?piece=OUVERTURE&limite=50`, leila)).corps.ecritures as Ecriture[] ?? [])
      .map((x) => [x.date, x.statut, ...x.lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`)].join(' | '));
    // Le pont a déjà écrit le solde tel qu'il est tapé : au brouillard, contre le compte d'attente.
    await expect.poll(ouverture, { timeout: 20_000 }).toEqual(['2026-11-01 | brouillard | 532 48000.000 0.000 | 471 0.000 48000.000']);

    const cx = await contexte(sarra);
    const erreurs: string[] = [];
    const ouvrir = async () => {
      const p = await cx.newPage();
      p.on('pageerror', (x) => erreurs.push(x.message));
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
      await p.locator('#tr-comptes .tr-compte').first().waitFor({ timeout: 20_000 });
      await plusTard(p);
      await p.locator('#t-tabs [data-tab="rapprochement"]').click();
      await p.locator('#t-depart').waitFor({ timeout: 10_000 });
      return p;
    };
    const lignes = (texte: string) => texte.split('\n').map(net);

    // ── 1. Avec l'écart : le message dit ce qui n'est pas passé, le solde de SkanFact et son calcul, écart compris.
    const avant = await ouvrir();
    await expect.poll(async () => net(await avant.locator('#t-reco').innerText()), { timeout: 10_000 }).toMatch(/Solde de départ 48 000,000 DT au 01\/11\/2026 · corriger/);
    await avant.locator('#t-etat-compta').click();
    await expect.poll(() => avant.evaluate(() => location.hash)).toBe('#/comptable');
    const brouillon = avant.locator('#msg-racine textarea').first();
    await expect.poll(async () => lignes(await brouillon.inputValue()).slice(1), { timeout: 10_000 }).toEqual([
      'Pas encore passés à la banque :',
      '- 10/11/2026 · Chèque Moulin de Tunis · Autre sortie · CHQ 1123 : − 850,000 DT',
      '- 11/11/2026 · Versement espèces · Autre entrée : + 300,000 DT',
      'Solde dans SkanFact : 48 000,000 DT (= 48 800,000 DT + 300,000 DT − 850,000 DT + écart − 250,000 DT).',
      'Peux-tu m\'aider à le trouver ?']);
    expect(lignes(await brouillon.inputValue())[0]).toMatch(/^Bonjour, je rapproche le compte « BIAT » de son relevé au \d\d\/\d\d\/\d{4} et il reste un écart de 250,000 DT \(la banque compte plus que SkanFact\)\.$/);
    expect(await brouillon.inputValue()).not.toMatch(/est dans SkanFact/);
    await avant.close();

    // ── 2. « corriger » sous le solde de départ : la fiche du compte, le curseur dans la case, la valeur sélectionnée.
    const e = await ouvrir();
    expect(net(await e.locator('#tr-resume .mg-chiffre b').first().innerText())).toBe('48 000,000 DT');
    // Au CLAVIER (Tab jusqu'à « corriger », Entrée) : au clic, la règle générale des montants sélectionne déjà la case
    // (le clic est une entrée de la personne) ; au clavier, c'est le code qui y met le curseur, et la fiche doit
    // sélectionner elle-même — sinon « 48250 » tapé s'ajoute derrière « 48000,000 ».
    await e.locator('#t-depart').focus();
    await e.keyboard.press('Enter');
    const fiche = e.locator('#modal-root .modal', { has: e.locator('[name=opening]') });
    await fiche.waitFor({ timeout: 10_000 });
    expect(await e.evaluate(() => { const c = document.activeElement as HTMLInputElement | null; return c ? [c.name, c.selectionStart === 0 && c.selectionEnd === c.value.length && c.value.length > 0] : null; })).toEqual(['opening', true]);
    // La première frappe remplace la valeur : rien à effacer.
    await e.keyboard.type('48250');
    await fiche.locator('#ok').click();
    await fiche.waitFor({ state: 'detached', timeout: 10_000 });
    // La page ENTIÈRE suit : le rapprochement tombe juste, ET le disponible du haut de la page dit le nouveau solde.
    await expect.poll(async () => net(await e.locator('#t-reco').innerText()), { timeout: 10_000 }).toMatch(/Solde de départ 48 250,000 DT au 01\/11\/2026/);
    await expect.poll(async () => net(await e.locator('#t-body').innerText()), { timeout: 10_000 }).toMatch(/Écart 0,000 DT/);
    expect(net(await e.locator('#tr-resume .mg-chiffre b').first().innerText())).toBe('48 250,000 DT');
    expect(await e.locator('#t-tabs [data-tab="rapprochement"]').getAttribute('aria-selected')).toBe('true');

    // ── 3. Sans écart : le message part avec les deux mouvements en attente et le calcul du solde.
    await e.locator('#t-etat-compta').click();
    await expect.poll(() => e.evaluate(() => location.hash)).toBe('#/comptable');
    const zone = e.locator('#msg-racine textarea').first();
    await expect.poll(async () => lignes(await zone.inputValue()).slice(1), { timeout: 10_000 }).toEqual([
      'Pas encore passés à la banque :',
      '- 10/11/2026 · Chèque Moulin de Tunis · Autre sortie · CHQ 1123 : − 850,000 DT',
      '- 11/11/2026 · Versement espèces · Autre entrée : + 300,000 DT',
      'Solde dans SkanFact : 48 250,000 DT (= 48 800,000 DT + 300,000 DT − 850,000 DT).']);
    expect(lignes(await zone.inputValue())[0]).toMatch(/^Bonjour, j'ai rapproché le compte « BIAT » de son relevé au \d\d\/\d\d\/\d{4} : solde du relevé 48 800,000 DT, aucun écart\.$/);
    await e.getByRole('button', { name: 'Envoyer', exact: true }).click();

    // ── 4. Au Cabinet : le message arrive avec ses lignes, et le solde de départ au brouillard est le même chiffre.
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, leila)).corps.messages as Obj[] ?? [])
      .map((m) => String(m.texte)).filter((t) => t.includes('rapproché le compte')).map((t) => lignes(t).slice(1)), { timeout: 15_000 }).toEqual([[
      'Pas encore passés à la banque :',
      '- 10/11/2026 · Chèque Moulin de Tunis · Autre sortie · CHQ 1123 : − 850,000 DT',
      '- 11/11/2026 · Versement espèces · Autre entrée : + 300,000 DT',
      'Solde dans SkanFact : 48 250,000 DT (= 48 800,000 DT + 300,000 DT − 850,000 DT).']]);
    await expect.poll(ouverture, { timeout: 20_000 }).toEqual(['2026-11-01 | brouillard | 532 48250.000 0.000 | 471 0.000 48250.000']);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 240_000);
});
