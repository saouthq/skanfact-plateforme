// Les abonnements d'un dossier, à la souris (brique 51 ; docs/cabinet.md, C41). L'écran est celui du
// Cabinet v10 (la saisie d'un dossier, panneau Abonnements). Ce que le parcours vérifie, écran ET serveur :
//   - un abonnement (un guide qui revient chaque mois) se crée et se garde dans la fiche du dossier ;
//   - « Générer ce qui manque » écrit une pièce AU BROUILLARD par mois dû, au serveur, aux montants du
//     guide, et note les mois faits : rejouer ne double rien, un double-clic non plus ;
//   - suspendu, il ne propose plus rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les abonnements d\'un dossier, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-abo-'));
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

  type Abo = { id: string; nom: string; actif: boolean; montant: string; faites: string[] };
  type Ecriture = { piece: string; journal: string; statut: string; date: string; lignes: { compte: string; debit: string; credit: string }[] };

  it('un abonnement créé, ses mois dus générés au brouillard une seule fois, puis suspendu', async () => {
    const associe = await personne('Karim');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${garage}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);
    expect((await api('PUT', `/cabinets/${cabinet}/reglages`, associe, { contenu: { guides: [{ id: 'g1', nom: 'Loyer', journal: 'OD', lignes: [
      { compte: '6132', libelle: 'Loyer', sens: 'debit', montant: '', taux: '', base: true, solde: false },
      { compte: '401', libelle: '', sens: 'credit', montant: '', taux: '', base: false, solde: true }] }] }, revision: null })).statut).toBe(200);
    const abos = async () => (((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { abonnements?: Abo[] } }[])
      .find((f) => f.entreprise === garage)?.contenu.abonnements) ?? [];
    const ecritures = async () => (await api('GET', `/entreprises/${garage}/compta/ecritures?limite=100`, associe)).corps.ecritures as Ecriture[];
    // Les mois dus de 2026, le 5 de chaque mois jusqu'à aujourd'hui.
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const dus = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`).filter((m) => `${m}-05` <= aujourdhui);

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

    // ── Un abonnement : le loyer du local, 850,500 DT le 5 de chaque mois ─────────────────────────
    await aller(`#/dossier/${garage}/comptabilite/saisie/2026`);
    await ouvrir('#ab-new', '#ab-nom');
    await fenetre.locator('#ab-nom').fill('Loyer du local');
    // Une date du Cabinet s'écrit JJ/MM/AAAA, quelle que soit la langue du navigateur (05/10/2026 : le champ du
    // navigateur la montrait à l'américaine) ; tapée « 05012026 », elle se lit le 5 janvier.
    expect(await fenetre.locator('#ab-depuis').getAttribute('placeholder')).toBe('JJ/MM/AAAA');
    await fenetre.locator('#ab-depuis').fill('05012026');
    await fenetre.locator('#ab-montant').fill('850,500');
    await fenetre.locator('#ab-piece').fill('LOYER');
    await fenetre.locator('#ab-libelle').fill('Loyer du local');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Abonnement enregistré.');
    await expect.poll(async () => (await abos()).map((a) => [a.nom, a.actif, a.montant, a.faites])).toEqual([['Loyer du local', true, '850.500', []]]);

    // ── Générer ce qui manque : une pièce au brouillard par mois dû, aux montants du guide ──────────
    // Un double-clic pressé : la seconde génération attend la première, relit les mois faits, n'écrit rien.
    await p.locator('#ab-gen').dblclick();
    await expect.poll(() => p.locator('#modal-root .modal').first().innerText(), { timeout: 30_000 }).toMatch(new RegExp(`${dus.length}\\s+écritures? créées? en brouillard`));
    // Les deux comptes rendus peuvent s'empiler : on ferme celui qui est au-dessus, quel qu'il soit.
    for (let i = 0; i < 8 && await p.locator('#modal-root .modal').count(); i++) {
      for (const m of [p.locator('#modal-root .modal').last(), p.locator('#modal-root .modal').first()]) {
        if (await m.getByRole('button').last().click({ timeout: 1_500 }).then(() => true, () => false)) break;
      }
      await p.waitForTimeout(300);
    }
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    const lues = (await ecritures()).sort((a, b) => a.date.localeCompare(b.date));
    expect(lues.map((e) => [e.piece, e.journal, e.statut, e.date])).toEqual(dus.map((m) => [`LOYER-${m}`, 'OD', 'brouillard', `${m}-05`]));
    expect(lues.every((e) => JSON.stringify(e.lignes.map((l) => [l.compte, l.debit, l.credit])) === JSON.stringify([['6132', '850.500', '0.000'], ['401', '0.000', '850.500']]))).toBe(true);
    expect((await abos())[0]?.faites).toEqual(dus);
    // Rien de plus à générer : le bouton s'en va, rejouer ne double rien.
    await aller(`#/dossier/${garage}/comptabilite/saisie/2026`);
    await expect.poll(() => p.locator('#ab-new').count()).toBe(1);
    expect(await p.locator('#ab-gen').count()).toBe(0);
    expect(await p.locator('tr[data-ab]').innerText()).toMatch(/à jour/);

    // ── Suspendu, il ne propose plus rien ────────────────────────────────────────────────────────
    await expect.poll(async () => {
      if (!await p.getByRole('menuitem').filter({ hasText: 'Suspendre cet abonnement' }).count()) await p.locator('[data-rowmenu^="A:"]').first().click({ timeout: 2_000 }).catch(() => {});
      return p.getByRole('menuitem').filter({ hasText: 'Suspendre cet abonnement' }).count();
    }, { timeout: 30_000 }).toBe(1);
    await p.getByRole('menuitem').filter({ hasText: 'Suspendre cet abonnement' }).click();
    await expect.poll(toast).toBe('Abonnement suspendu.');
    expect((await abos()).map((a) => a.actif)).toEqual([false]);
    expect((await ecritures()).length).toBe(dus.length);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-abonnements.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
