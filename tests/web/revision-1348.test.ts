// La Révision d'un dossier au Cabinet, jouée comme un comptable (1.348.0 ; docs/revue-modules.md). Ce que le parcours
// vérifie, écran ET moteur :
//   - chaque compte tombe dans son cycle : la retenue à la source (4352) au fiscal, la CNSS (4531) et l'impôt sur salaires
//     (4321) au personnel, les associés (442) et les charges financières (651) aux capitaux — rien « hors cycle » ;
//   - une table de cycles enregistrée telle que SkanFact l'avait proposée suit la proposition du jour ;
//   - les cartes et la feuille disent leur solde dans le sens du compte (« créditeur », « D ») ;
//   - « Signer » est un bouton de la ligne, d'un clic ;
//   - arrêter la révision d'un exercice qui court le dit avant ; « Ces points ne bloquent pas » ;
//   - « Ajouter une question » met le curseur dans la question neuve.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la révision d\'un dossier, jouée comme un comptable (1.348.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-revision-1348-'));
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


  it('(1.348.0) chaque compte dans son cycle, la table d\'avant suivie, le sens du compte, « Signer » d\'un clic, l\'exercice qui court dit avant d\'arrêter, le curseur dans la question neuve', async () => {
    const client = await personne('client');
    const associe = await personne('associe');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Jlassi' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    const an = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).slice(0, 4);
    const saisir = async (date: string, journal: string, piece: string, libelle: string, lignes: [string, string, string, string?][]) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal, piece, libelle, lignes: lignes.map(([compte, debit, credit, tiers]) => ({ compte, debit, credit, ...(tiers ? { tiers } : {}) })) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return String(r.corps.id);
    };
    // La table de cycles que SkanFact proposait jusqu'à la 1.347.0, enregistrée avec un questionnaire (ce que fait le
    // bouton « Enregistrer ma méthode ») : elle doit suivre la proposition du jour.
    const ANCIENNE = [
      { id: 'tresorerie', label: 'Trésorerie', prefixes: ['5'] }, { id: 'ventes', label: 'Ventes et clients', prefixes: ['41', '70', '73'] },
      { id: 'achats', label: 'Achats et fournisseurs', prefixes: ['40', '60', '61', '62', '65'] }, { id: 'immobilisations', label: 'Immobilisations', prefixes: ['2', '68', '78'] },
      { id: 'personnel', label: 'Personnel', prefixes: ['42', '43', '64'] }, { id: 'fiscal', label: 'Fiscal', prefixes: ['436', '43', '44', '66', '67', '69'] },
      { id: 'capitaux', label: 'Capitaux et emprunts', prefixes: ['1'] },
    ];
    expect((await api('PUT', `/cabinets/${cabinet}/reglages`, associe, { contenu: { cycles: ANCIENNE, questionnaire: [{ question: 'Des litiges en cours ?' }] }, revision: null })).statut).toBe(200);
    const ids = [
      await saisir(`${an}-01-01`, 'AN', 'AN-1', 'Ouverture', [['532', '10000,500', ''], ['101', '', '10000,500']]),
      await saisir(`${an}-03-01`, 'AC', 'FA-0901', 'Farine de mars', [['606', '406,980', ''], ['401', '', '400', 'Minoterie du Cap Bon'], ['4352', '', '6,980']]),
      await saisir(`${an}-03-31`, 'OD', 'SAL-3', 'Salaires de mars', [['640', '1250', ''], ['425', '', '1050'], ['4321', '', '80'], ['4531', '', '120']]),
      await saisir(`${an}-04-02`, 'BQ', 'CC-1', 'Apport en compte courant', [['532', '3000', ''], ['442', '', '3000', 'Hédi Ben Amor']]),
      await saisir(`${an}-04-30`, 'BQ', 'AGIOS-4', 'Agios d\'avril', [['651', '45', ''], ['532', '', '45']]),
    ];
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);

    const erreurs: string[] = [];
    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ').trim();
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/revision/${an}`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('.cy-carte').first().waitFor({ timeout: 20_000 });

    // ── Chaque compte dans son cycle, rien hors cycle ; les cartes disent leur solde en mots ─────────
    const carte = async (nom: string) => net(await p.locator('.cy-carte').filter({ hasText: nom }).first().innerText());
    const comptesDu = async (nom: string) => {
      await p.locator('.cy-carte').filter({ hasText: nom }).first().click();
      await expect.poll(() => p.locator('.cy-carte.cy-on').filter({ hasText: nom }).count()).toBe(1);
      return (await p.locator('#view table.list tbody tr').filter({ has: p.locator('[data-rowmenu^="RV:"]') }).allInnerTexts()).map((t) => net(t).split(' ')[0]);
    };
    expect(await p.locator('#rv-hors').count()).toBe(0);
    expect((await comptesDu('Fiscal')).sort()).toEqual(['4352']);
    expect((await comptesDu('Personnel')).sort()).toEqual(['425', '4321', '4531', '640']);
    expect((await comptesDu('Capitaux et emprunts')).sort()).toEqual(['101', '442', '651']);
    expect(await carte('Achats et fournisseurs')).toContain('6,980 DT débiteur');
    expect(await carte('Personnel')).toContain('0,000 DT');
    expect(await carte('Trésorerie')).toContain('12 955,500 DT débiteur');
    expect(await carte('Capitaux et emprunts')).toContain('12 955,500 DT créditeur');
    expect(net(await p.locator('#view').innerText())).not.toMatch(/−\d[\d\s]*,\d{3} DT/);

    // ── Une question sur un compte dit son solde en mots (la retenue à la source, créditeur) ─────────
    await comptesDu('Fiscal');
    await p.locator('[data-rowmenu="RV:4352"]').click();
    await p.getByRole('menuitem').filter({ hasText: 'Poser une question au client' }).click();
    const fq = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await fq.innerText().catch(() => ''))).toContain('solde 6,980 DT créditeur');
    await fq.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);

    // ── « Signer » d'un clic, sur la ligne ─────────────────────────────────────────────────────────
    await comptesDu('Trésorerie');
    const ligne = p.locator('#view table.list tbody tr').filter({ has: p.locator('[data-rowmenu="RV:532"]') });
    expect(net(await ligne.innerText())).toContain('12 955,500 D');
    await ligne.getByRole('button', { name: 'Signer', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText().catch(() => '')).toContain('Compte 532 signé.');
    await expect.poll(async () => net(await p.locator('#view table.list tbody tr').filter({ has: p.locator('[data-rowmenu="RV:532"]') }).innerText())).toContain('revu');
    expect(await p.locator('#view table.list tbody tr').filter({ has: p.locator('[data-rowmenu="RV:532"]') }).getByRole('button', { name: 'Signer', exact: true }).count()).toBe(0);
    // Un seul modèle de question : « Poser la question de ton cabinet », jamais « Poser les 1 question ».
    expect(net(await p.locator('#rv-poser').innerText())).toBe('Poser la question de ton cabinet');
    await p.screenshot({ path: path.join(PHOTOS, 'revision-1348-a-feuille.png'), fullPage: true });

    // ── Arrêter la révision d'un exercice qui court : la question le dit avant ─────────────────────
    await p.locator('#rv-arreter').click();
    const f = p.locator('#modal-root .modal').last();
    await f.waitFor({ timeout: 10_000 });
    expect(net(await f.innerText())).toContain(`L'exercice ${an} n'est pas terminé : il court jusqu'au 31/12/${an}`);
    await f.getByRole('button', { name: 'Annuler', exact: true }).click();

    // ── Le questionnaire : la question neuve reçoit le curseur, on y tape sans la viser ─────────────
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/reglages`);
    await p.locator('[role=tab][data-tab="compta"]').click();
    await p.locator('#sr-quest-add').waitFor({ timeout: 20_000 });
    // La table enregistrée telle que SkanFact la proposait se montre comme la proposition du jour.
    await expect.poll(() => p.locator('#sr-cycles .sa-vide').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.locator('#sr-cycles tr[data-cy]').filter({ hasText: '' }).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('input')].map((i) => (i as HTMLInputElement).value).join('|'))))
      .toContain('fiscal|Fiscal|43 66 67 69');
    await p.locator('#sr-quest-add').click();
    await p.keyboard.type('Les stocks ont-ils été comptés ?');
    expect(await p.locator('#sr-quest input[data-q]').last().inputValue()).toBe('Les stocks ont-ils été comptés ?');
    expect(p.url()).toContain('#/reglages');

    expect(erreurs).toEqual([]);
    await ctx.close();
  }, 180_000);
});
