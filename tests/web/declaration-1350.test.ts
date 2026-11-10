// La Déclaration d'un dossier au Cabinet, jouée comme un comptable (1.350.0 ; docs/revue-modules.md). Le dossier : janvier
// déposé (sans son écriture de déclaration), février et mars saisis. Ce que le parcours vérifie :
//   - l'écran s'ouvre sur FÉVRIER, le plus ancien mois à déposer après le dernier dépôt — pas sur mars, le dernier saisi ;
//   - la frise cercle le mois déclaré à l'écran ; un mois de la frise ouvre SA déclaration, et le mois choisi dans la
//     liste déplace la frise et la période ;
//   - le crédit du mois précédent ne se lit pas sur un 4366 que personne n'a soldé : il se refait d'un mois à l'autre,
//     et la case le dit ;
//   - une écriture du mois au brouillard : le vert est sur « Valider l'écriture du mois », pas sur « Marquer déposée » ;
//   - marquer déposé ne fait pas sauter l'écran au mois suivant : il reste à marquer payé.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la déclaration d\'un dossier, jouée comme un comptable (1.350.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-declaration-1350-'));
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


  it('(1.350.0) le mois à déposer d\'abord, la frise et la liste d\'accord, le crédit refait mois par mois, le vert sur la validation, l\'écran qui reste sur son mois', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const saisir = async (date: string, journal: string, piece: string, lignes: [string, string, string][]) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal, piece, libelle: piece, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return String(r.corps.id);
    };
    // Janvier : à payer 90 (190 − 100). Février : un crédit de 70 (50 − 120). Mars : 300 collectés.
    const ids = [
      await saisir('2026-01-10', 'VT', 'V-01', [['411', '1190,000', ''], ['706', '', '1000,000'], ['4367', '', '190,000']]),
      await saisir('2026-01-15', 'AC', 'A-01', [['601', '526,316', ''], ['4366', '100,000', ''], ['401', '', '626,316']]),
      await saisir('2026-02-10', 'VT', 'V-02', [['411', '313,158', ''], ['706', '', '263,158'], ['4367', '', '50,000']]),
      await saisir('2026-02-15', 'AC', 'A-02', [['601', '631,579', ''], ['4366', '120,000', ''], ['401', '', '751,579']]),
      await saisir('2026-03-10', 'VT', 'V-03', [['411', '1878,947', ''], ['706', '', '1578,947'], ['4367', '', '300,000']]),
    ];
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);
    // Janvier, préparé et déposé — sans son écriture de déclaration (ce que faisait le jeu d'exemple).
    expect((await api('PUT', `/entreprises/${ent}/compta/declarations/2026-01`, associe, { cases: { tvaCollectee: '190,000', aDecaisser: '90,000' } })).statut).toBeLessThan(300);
    expect((await api('POST', `/entreprises/${ent}/compta/declarations/2026-01/pointer`, associe, { quoi: 'deposee', le: '2026-02-20' })).statut).toBeLessThan(300);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/declaration/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
      await p.locator('#dc-preparer').waitFor({ timeout: 15_000 });
    };
    const toast = () => p.locator('#toast').innerText();
    const mois = () => p.locator('#dc-mois').inputValue();
    const cercle = () => p.locator('.cp-mo.on').evaluateAll((l) => l.map((b) => (b as HTMLElement).dataset.cpMois));
    const ligne = async (cle: string) => (await p.locator('#view tr').filter({ hasText: cle }).first().innerText()).replace(/\s+/g, ' ');

    // ── Le plus ancien mois à déposer après le dernier dépôt : février, pas mars ; la frise le cercle ─────
    await aller();
    expect(await mois()).toBe('2026-02');
    expect(await cercle()).toEqual(['2026-02']);
    expect(await p.locator('.cp-ex.on').count()).toBe(0);
    // Janvier était à payer : aucun crédit n'arrive en février — et la case dit pourquoi elle ne lit pas le compte.
    expect(await ligne('Crédit du mois précédent')).toMatch(/Crédit du mois précédent Les mois précédents n'ont pas tous leur écriture de déclaration : le compte 4367 n'est pas soldé au 01\/02\/2026.* 0,000 DT/);

    // ── Un mois de la frise ouvre SA déclaration ; le mois de la liste déplace la frise et la période ────
    await p.locator('[data-cp-mois="2026-03"]').click();
    await expect.poll(mois).toBe('2026-03');
    // Mars : le 4366 porte 220 (100 + 120) ; le vrai crédit est celui que février laisse, 70. À payer : 230.
    await expect.poll(() => ligne('Crédit du mois précédent')).toMatch(/ 70,000 DT/);
    expect(await ligne('Solde : TVA à payer')).toMatch(/ 230,000 DT/);
    await p.locator('#dc-mois').selectOption('2026-02');
    await expect.poll(cercle).toEqual(['2026-02']);
    expect(await p.locator('#lv-mois').inputValue()).toBe('2026-02');

    // ── Février : préparer, écrire — le vert passe sur la validation, pas sur le dépôt ─────────────────
    await p.locator('#dc-preparer').click();
    await expect.poll(toast).toBe('Déclaration préparée.');
    await p.locator('#dc-ecriture').click();
    await expect.poll(() => p.locator('#dc-ecriture').innerText()).toBe('Valider l\'écriture du mois');
    expect(await p.locator('#dc-ecriture').getAttribute('class')).toMatch(/btn-primary/);
    expect(await p.locator('#dc-deposee').getAttribute('class')).not.toMatch(/btn-primary/);
    await p.locator('#dc-ecriture').click();
    await expect.poll(() => p.locator('#dc-ecriture').innerText()).toMatch(/Écriture du mois passée/);
    await expect.poll(() => p.locator('#dc-deposee').getAttribute('class')).toMatch(/btn-primary/);
    await p.screenshot({ path: path.join(PHOTOS, 'declaration-1350-fevrier.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);

  it('(1.350.0) marquer déposé le mois proposé ne fait pas sauter l\'écran au suivant : il reste à le marquer payé', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Librairie du Lac' })).corps.entreprise);
    const ids: string[] = [];
    for (const [date, piece, tva] of [['2026-01-10', 'V-01', '190,000'], ['2026-02-10', 'V-02', '95,000'], ['2026-03-10', 'V-03', '38,000']] as const) {
      const ht = (Number(tva.replace(',', '.')) * 100 / 19).toFixed(3).replace('.', ','), ttc = (Number(tva.replace(',', '.')) * 119 / 19).toFixed(3).replace('.', ',');
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal: 'VT', piece, libelle: piece, lignes: [{ compte: '411', debit: ttc }, { compte: '706', credit: ht }, { compte: '4367', credit: tva }] });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      ids.push(String(r.corps.id));
    }
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);
    expect((await api('PUT', `/entreprises/${ent}/compta/declarations/2026-01`, associe, { cases: { tvaCollectee: '190,000', aDecaisser: '190,000' } })).statut).toBeLessThan(300);
    expect((await api('POST', `/entreprises/${ent}/compta/declarations/2026-01/pointer`, associe, { quoi: 'deposee', le: '2026-02-20' })).statut).toBeLessThan(300);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/declaration/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('#dc-preparer').waitFor({ timeout: 15_000 });
    const toast = () => p.locator('#toast').innerText();
    // L'écran s'est ouvert sur février PAR PROPOSITION : personne n'a choisi ce mois.
    expect(await p.locator('#dc-mois').inputValue()).toBe('2026-02');
    await p.locator('#dc-preparer').click();
    await expect.poll(toast).toBe('Déclaration préparée.');
    await p.locator('#dc-deposee').click();
    await expect.poll(toast).toMatch(/^Notée déposée/);
    // Le mois proposé est devenu mars ; l'écran, lui, reste sur février, où « Marquer payée » attend.
    await expect.poll(() => p.locator('#dc-deposee').innerText()).toMatch(/^✓?\s*Déposée le /);
    expect(await p.locator('#dc-mois').inputValue()).toBe('2026-02');
    expect(await p.locator('#dc-payee').isEnabled()).toBe(true);
    expect(erreurs).toEqual([]);
  }, 240_000);
});
