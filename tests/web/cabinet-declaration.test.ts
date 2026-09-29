// La déclaration du mois, à la souris (brique 41 ; docs/cabinet.md, C22 à C24). L'écran est celui du
// Cabinet v10 ; la déclaration se déduit du livre du serveur par le moteur de la v10, et tout ce qui
// s'enregistre va au serveur. Ce que le parcours vérifie, écran ET serveur :
//   - les cases du mois (deux chemins, un chiffre : la TVA collectée de l'écran est le mouvement du
//     4367 que le serveur tient) ; préparée, elle est au serveur, au millime ;
//   - l'écriture du mois au brouillard, liée à sa déclaration ;
//   - une vente saisie après : les chiffres ont changé, le dépôt s'éteint et le dit ; recalculée, le
//     complément pose ce qui manque, sans seconde écriture entière ;
//   - déposée, payée ; dé-pointer le dépôt dé-pointe le paiement, et le dit ;
//   - la forme d'un montant copié pour le portail, un réglage du cabinet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la déclaration du mois, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-decl-'));
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
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  type Declaration = { periode: string; cases: Record<string, string | null>; deposee: { le: string }; payee: { le: string }; ecriture: string | null };
  const declarations = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/declarations?annee=2026`, jeton)).corps.declarations as Declaration[];
  type Ecriture = { id: string; statut: string; piece: string | null; lignes: { compte: string; debit: string; credit: string }[] };
  const ecritures = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures as Ecriture[];

  it('préparer, écrire, recalculer après une vente oubliée, compléter, déposer, payer, dé-pointer ; la forme copiée se retient', async () => {
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const saisir = async (date: string, journal: string, piece: string, libelle: string, lignes: [string, string, string][]) =>
      String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date, journal, piece, libelle, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) })).corps.id);
    // Mars : une vente (TVA 190,125, timbre 1,000) et un achat (TVA 50,255), validés. À décaisser : 140,870.
    const vente = await saisir('2026-03-05', 'VT', 'F-2026-031', 'Facture F-2026-031', [['411', '1191,785', ''], ['7071', '', '1000,660'], ['4367', '', '190,125'], ['4368', '', '1,000']]);
    const achat = await saisir('2026-03-08', 'AC', 'A-118', 'Achat A-118', [['6061', '264,500', ''], ['4366', '50,255', ''], ['401', '', '314,755']]);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [vente, achat] })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const aller = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/declaration/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
      await p.locator('#dc-preparer').waitFor({ timeout: 15_000 });
    };
    const toast = () => p.locator('#toast').innerText();

    // ── Le mois terminé qui a des écritures : mars. Deux chemins, un chiffre ─────────────────────────
    await aller();
    expect(await p.locator('#dc-mois').inputValue()).toBe('2026-03');
    const vue = () => p.locator('#view').innerText();
    await expect.poll(vue).toMatch(/190,125/);
    const balance = (await api('GET', `/entreprises/${cafe}/compta/balance?du=2026-03-01&au=2026-03-31`, associe)).corps.comptes as { compte: string; credit: string }[];
    expect(balance.find((c) => c.compte === '4367')?.credit).toBe('190.125');
    expect(await p.locator('[data-copier]').allInnerTexts()).toEqual(expect.arrayContaining([expect.stringMatching(/^190,125/), expect.stringMatching(/^50,255/), expect.stringMatching(/^140,870/)]));
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-declaration-1-cases.png') });

    // ── Préparer : au serveur, au millime ────────────────────────────────────────────────────────────
    await p.locator('#dc-preparer').click();
    await expect.poll(toast).toBe('Déclaration préparée.');
    let [d] = await declarations(cafe, associe);
    expect(d).toMatchObject({ periode: '2026-03', ecriture: null, deposee: { le: '' } });
    expect([d?.cases.tvaCollectee, d?.cases.tvaDeductible, d?.cases.timbre, d?.cases.aDecaisser]).toEqual(['190.125', '50.255', '1.000', '140.870']);

    // ── L'écriture du mois, au brouillard, liée ──────────────────────────────────────────────────────
    await expect.poll(() => p.locator('#dc-ecriture').getAttribute('class')).toMatch(/btn-primary/);
    await p.locator('#dc-ecriture').click();
    await expect.poll(toast).toBe('Écriture créée en brouillard : valide-la quand tu es d\'accord.');
    const ecrite = (await ecritures(cafe, associe)).find((e) => e.piece === 'DECL-2026-03');
    expect(ecrite).toMatchObject({ statut: 'brouillard', lignes: expect.arrayContaining([
      { compte: '4367', debit: '190.125', credit: '0.000' }, { compte: '4366', debit: '0.000', credit: '50.255' },
      { compte: '4368', debit: '1.000', credit: '0.000' }, { compte: '4365', debit: '0.000', credit: '140.870' }].map((l) => expect.objectContaining(l))) });
    expect((await declarations(cafe, associe))[0]?.ecriture).toBe(ecrite?.id);
    await expect.poll(() => p.locator('#dc-ecriture').innerText()).toMatch(/Écriture au brouillard — à valider/);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [ecrite?.id] })).statut).toBe(200);

    // ── Une vente oubliée, saisie après : les chiffres ont changé ─────────────────────────────────────
    const oubliee = await saisir('2026-03-20', 'VT', 'F-2026-032', 'Facture F-2026-032', [['411', '119,000', ''], ['7071', '', '100,000'], ['4367', '', '19,000']]);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [oubliee] })).statut).toBe(200);
    await aller();
    await expect.poll(vue).toMatch(/Les chiffres ont changé depuis la préparation \(TVA collectée\s:\s190,125\sDT\s→\s209,125\sDT/);
    expect(await p.locator('#dc-deposee').isDisabled()).toBe(true);
    // Le serveur ne recalcule pas la déclaration : c'est le point de contact qui refuse un dépôt sur
    // des chiffres qui ont changé, par la phrase de la v10 — même appelé sans le bouton.
    const pointe = await p.evaluate(async (o) => {
      try { await (window as unknown as { cabinet: { pointerDeclaration: (x: unknown) => Promise<unknown> } }).cabinet.pointerDeclaration(o); return 'pointé'; } catch (e) { return String((e as Error).message); }
    }, { dossierId: cafe, annee: '2026', periode: '2026-03', quoi: 'deposee', valeur: { le: '2026-04-20' } });
    expect(pointe).toMatch(/^Les chiffres du mois ont changé depuis la préparation \(TVA collectée\s:\s190,125\sDT\s→\s209,125\sDT/);
    expect((await declarations(cafe, associe))[0]?.deposee.le).toBe('');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-declaration-2-perimee.png') });
    await p.locator('#dc-preparer').click();
    await expect.poll(toast).toBe('Déclaration préparée.');
    expect((await declarations(cafe, associe))[0]?.cases.tvaCollectee).toBe('209.125');
    // Le complément : ce qui manque à l'écriture du mois, jamais une seconde écriture entière.
    await expect.poll(() => p.locator('#dc-ecriture').innerText()).toBe('Écrire le complément');
    await p.locator('#dc-ecriture').click();
    await expect.poll(toast).toBe('Complément créé en brouillard : valide-le quand tu es d\'accord.');
    const toutes = await ecritures(cafe, associe);
    expect(toutes.filter((e) => String(e.piece).startsWith('DECL-2026-03')).map((e) => [e.piece, e.statut])).toEqual([['DECL-2026-03', 'validee'], ['DECL-2026-03-C1', 'brouillard']]);
    expect(toutes.find((e) => e.piece === 'DECL-2026-03-C1')?.lignes).toEqual(expect.arrayContaining([
      expect.objectContaining({ compte: '4367', debit: '19.000' }), expect.objectContaining({ compte: '4365', credit: '19.000' })]));
    expect((await declarations(cafe, associe))[0]?.ecriture).toBe(ecrite?.id);

    // ── Déposée, payée ; dé-pointer le dépôt dé-pointe le paiement ─────────────────────────────────────
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await p.locator('#dc-deposee').click();
    await expect.poll(toast).toBe('Notée déposée — c\'est un pense-bête, pas un accusé de réception.');
    await expect.poll(async () => (await declarations(cafe, associe))[0]?.deposee.le).toBe(aujourdhui);
    await p.locator('#dc-payee').click();
    await expect.poll(toast).toBe('Notée payée.');
    await expect.poll(async () => (await declarations(cafe, associe))[0]?.payee.le).toBe(aujourdhui);
    await expect.poll(() => p.locator('.dc-etapes').innerText()).toMatch(/Payée le/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-declaration-3-payee.png') });
    await p.locator('#dc-deposee').click();
    await expect.poll(toast).toBe('Dépôt et paiement annulés : on ne paie pas ce qu\'on n\'a pas déposé.');
    d = (await declarations(cafe, associe))[0];
    expect([d?.deposee.le, d?.payee.le]).toEqual(['', '']);

    // ── La forme d'un montant copié : un réglage du cabinet ──────────────────────────────────────────
    // L'écran se relit après chaque geste : le choix se refait tant qu'il n'est pas enregistré.
    await expect.poll(async () => {
      const f = ((await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { formatCopie?: string }).formatCopie;
      if (f !== 'millimes') await p.locator('#dc-format').selectOption('millimes', { timeout: 2_000 }).catch(() => {});
      return f;
    }, { timeout: 30_000 }).toBe('millimes');
    await aller();
    expect(await p.locator('#dc-format').inputValue()).toBe('millimes');
    expect(await p.locator('[data-copier]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-valeur')))).toContain('209125');
    // Un réglage que le serveur ne garde pas se dit, et rien n'est fait, pas même le reste (brique 47).
    const nomme = await p.evaluate(async () => {
      try { await (window as unknown as { cabinet: { saveCabinet: (x: unknown) => Promise<unknown> } }).cabinet.saveCabinet({ name: 'Cabinet Ennour', settings: { formatCopie: 'point', inconnu: 1 } }); return 'enregistré'; } catch (e) { return String((e as Error).message); }
    });
    expect(nomme).toBe('Pas encore dans la version en ligne de SkanFact Cabinet : rien n\'a été fait.');
    expect(((await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { formatCopie?: string }).formatCopie).toBe('millimes');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
