// Les guides d'écritures et le journal retenu, à la souris (brique 50 ; docs/cabinet.md, C40). Les
// écrans sont ceux du Cabinet v10 (Réglages → Comptabilité → Guides d'écritures ; la grille de saisie).
// Ce que le parcours vérifie, écran ET serveur :
//   - un guide se crée dans son formulaire et se garde au serveur (un taux en texte décimal) ; il se
//     relit après rechargement ;
//   - dans la grille, il préremplit la pièce depuis un montant, et l'écriture enregistrée au serveur
//     porte exactement les lignes de l'écran (deux chemins, un chiffre) ;
//   - le journal choisi dans la grille est retenu pour ce dossier ;
//   - le guide se modifie, puis se supprime après confirmation.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les guides d\'écritures, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-guides-'));
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

  type Guide = { id: string; nom: string; journal: string; lignes: { compte: string; sens: string; montant: string; taux: string; base: boolean; solde: boolean }[] };
  type Ligne = { compte: string; debit: string; credit: string };

  it('créer un guide, s\'en servir dans la saisie, retenir le journal, modifier puis supprimer le guide', async () => {
    const associe = await personne('Karim');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${garage}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);
    const guides = async () => ((await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { guides?: Guide[] }).guides ?? [];

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (h: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${h}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).isVisible()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).isVisible();
    }, { timeout: 30_000 }).toBe(true);

    // ── Un guide : le loyer (la base), sa TVA à 19 %, le fournisseur au solde ─────────────────────
    await aller('#/reglages');
    await ouvrir('#set-tabs [data-tab="compta"]', '#sr-guide-new');
    await ouvrir('#sr-guide-new', '#g-nom');
    await fenetre.locator('#g-nom').fill('Loyer du garage');
    await fenetre.locator('#g-journal').fill('od');
    await fenetre.locator('#g-add').click();
    const ligneG = (i: number) => fenetre.locator(`#g-lignes tr[data-i="${i}"]`);
    await ligneG(0).locator('[data-k="compte"]').fill('6132');
    await ligneG(0).locator('[data-k="libelle"]').fill('Loyer');
    await ligneG(1).locator('[data-k="compte"]').fill('401');
    await ligneG(2).locator('[data-k="compte"]').fill('4366');
    await ligneG(2).locator('[data-k="taux"]').fill('19');
    await ligneG(2).locator('[data-k="taux"]').dispatchEvent('change');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Guide créé.');
    await expect.poll(async () => (await guides()).map((g) => [g.nom, g.journal, g.lignes.map((l) => [l.compte, l.sens, l.montant, l.taux, l.base, l.solde])])).toEqual([
      ['Loyer du garage', 'OD', [['6132', 'debit', '', '', true, false], ['401', 'credit', '', '', false, true], ['4366', 'debit', '', '19', false, false]]]]);
    // Rouvert, il est là.
    await aller('#/reglages');
    await ouvrir('#set-tabs [data-tab="compta"]', '#sr-guides');
    await expect.poll(() => p.locator('#sr-guides').innerText()).toMatch(/Loyer du garage\s+OD\s+3\s+6132 · 401 · 4366/);

    // ── Dans la grille : le guide préremplit la pièce ; le serveur tient les mêmes lignes ───────────
    await aller(`#/dossier/${garage}/comptabilite/saisie/2026`);
    await p.locator('#sa-guide-montant').fill('1000,250');
    await p.locator('#sa-guide').selectOption({ label: 'Loyer du garage' });
    await expect.poll(() => p.locator('#sa-lignes tr[data-i="0"] input[data-k="compte"]').inputValue()).toBe('6132');
    const lignesEcran = await p.locator('#sa-lignes tr[data-i]').evaluateAll((trs) => trs.map((tr) => ({
      compte: (tr.querySelector('input[data-k="compte"]') as HTMLInputElement).value,
      debit: (tr.querySelector('input[data-k="debit"]') as HTMLInputElement).value,
      credit: (tr.querySelector('input[data-k="credit"]') as HTMLInputElement).value,
    })).filter((l) => l.compte));
    expect(lignesEcran.map((l) => l.compte)).toEqual(['6132', '401', '4366']);
    expect(lignesEcran[0]?.debit.replace(/\s/g, '')).toBe('1000,250');
    await p.locator('#sa-date').fill('31/03/2026');
    await p.locator('#sa-piece').fill('LOY-3');
    await p.locator('#sa-libelle').fill('Loyer de mars');
    await p.locator('#sa-ok').click();
    const ecrituresDu = async () => ((await api('GET', `/entreprises/${garage}/compta/ecritures?limite=50`, associe)).corps.ecritures as { piece: string; journal: string; lignes: Ligne[] }[]);
    await expect.poll(async () => (await ecrituresDu()).length, { timeout: 10_000 }).toBe(1);
    const [e] = await ecrituresDu();
    expect([e?.piece, e?.journal]).toEqual(['LOY-3', 'OD']);
    const millimes = (s: string) => s ? s.replace(/\s/g, '').replace(',', '.') : '0.000';
    expect(e?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual(lignesEcran.map((l) => [l.compte, millimes(l.debit), millimes(l.credit)]));
    expect(e?.lignes.find((l) => l.compte === '4366')?.debit).toMatch(/^190\.04[78]$/);

    // ── Le journal choisi dans la grille est retenu pour ce dossier ─────────────────────────────
    await p.locator('#sa-journal').selectOption('AC');
    const fiche = async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { dernierJournal?: string } }[]).find((f) => f.entreprise === garage)?.contenu;
    await expect.poll(async () => (await fiche())?.dernierJournal).toBe('AC');
    // Un second choix, sans recharger : il s'écrit sur la fiche que le premier a laissée.
    await p.locator('#sa-journal').selectOption('BQ');
    await expect.poll(async () => (await fiche())?.dernierJournal).toBe('BQ');
    await aller(`#/dossier/${garage}/comptabilite/saisie/2026`);
    expect(await p.locator('#sa-journal').inputValue()).toBe('BQ');

    // ── Le guide se modifie, puis se supprime après confirmation ─────────────────────────────────
    await aller('#/reglages');
    await ouvrir('#set-tabs [data-tab="compta"]', '#sr-guides');
    await expect.poll(async () => {
      if (!await p.getByRole('menuitem').filter({ hasText: 'Modifier ce guide' }).count()) await p.locator('[data-rowmenu^="G:"]').first().click({ timeout: 2_000 }).catch(() => {});
      return p.getByRole('menuitem').filter({ hasText: 'Modifier ce guide' }).count();
    }, { timeout: 30_000 }).toBe(1);
    await p.getByRole('menuitem').filter({ hasText: 'Modifier ce guide' }).click();
    await fenetre.locator('#g-nom').fill('Loyer du garage (mensuel)');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Guide modifié.');
    await expect.poll(async () => (await guides()).map((g) => g.nom)).toEqual(['Loyer du garage (mensuel)']);
    await expect.poll(async () => {
      if (!await p.locator('#g-sup').count()) {
        if (!await p.getByRole('menuitem').filter({ hasText: 'Modifier ce guide' }).count()) await p.locator('[data-rowmenu^="G:"]').first().click({ timeout: 2_000 }).catch(() => {});
        await p.getByRole('menuitem').filter({ hasText: 'Modifier ce guide' }).click({ timeout: 2_000 }).catch(() => {});
      }
      return p.locator('#g-sup').count();
    }, { timeout: 30_000 }).toBe(1);
    await p.locator('#g-sup').click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect.poll(toast).toBe('Guide supprimé.');
    expect(await guides()).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-guides.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
