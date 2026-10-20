// Les primes de chaque mois au Cabinet, à la souris (1.68.0 ; docs/paie.md, « Les primes de chaque mois au Cabinet »).
// La fiche d'un salarié porte ses primes de chaque mois (celles de l'entreprise, 1.59.0), et un bulletin nouveau les
// reprend. Ce que le parcours vérifie, écran ET serveur :
//   - un montant de prime négatif se refuse sur sa case ; les primes de la fiche se gardent dans le dossier, dans la forme
//     de l'entreprise ;
//   - un bulletin nouveau les reprend ; une prime au jour suit les jours payés (l'absence) ; une prime fixe passe entière ;
//   - les primes proposées suivent le salarié choisi, tant qu'on n'y a pas touché ;
//   - le bulletin enregistré garde ses primes, et leurs marques (au jour : le montant de la fiche et les jours).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les primes de chaque mois au Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-primes-'));
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

  it('la fiche garde les primes de chaque mois, et un bulletin nouveau les reprend, la prime au jour suivant les jours payés', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2026, ouverture: [] })).statut).toBe(201);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/paie/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('10');
    const objets = async () => (await api('GET', `/entreprises/${cafe}/paie/dossier`, associe)).corps.objets as { collection: string; contenu: Record<string, unknown> }[];

    // ── Un salarié et ses primes de chaque mois ; une prime négative se refuse sur sa case ──────────────────────
    const declarer = async (nom: string, brut: string, primes: { label: string; montant: string; imposable: boolean; auJour: boolean }[]) => {
      await ouvrir('#pa-salarie', '#sf');
      await fenetre.locator('[name=nom]').fill(nom);
      await fenetre.locator('[name=brut]').fill(brut);
      await fenetre.locator('[name=embauche]').fill('01/01/2026');
      for (const [i, x] of primes.entries()) {
        // La fenêtre est large dès l'ouverture : la première prime ne l'élargit pas sous le curseur.
        const largeur = (await fenetre.boundingBox())?.width;
        await fenetre.locator('#sf-plus-prime').click();
        if (i === 0) expect((await fenetre.boundingBox())?.width).toBe(largeur);
        const ligne = fenetre.locator('#sf-primes tr').nth(i);
        await ligne.locator('[data-fp=label]').fill(x.label);
        await ligne.locator('[data-fp=amount]').fill(x.montant);
        if (!x.imposable) await ligne.locator('[data-fp=taxable]').uncheck();
        if (!x.auJour) await ligne.locator('[data-fp=parJour]').uncheck();
      }
    };
    await declarer('Salarié Numéro Deux', '1200,500', [
      { label: 'Prime de transport', montant: '-52', imposable: true, auJour: true },
      { label: 'Prime de panier', montant: '30', imposable: false, auJour: false },
    ]);
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('data-fp'))).toBe('amount');
    await expect.poll(async () => (await p.locator('body').innerText()).includes('Une prime ne peut pas être négative')).toBe(true);
    expect((await objets()).filter((o) => o.collection === 'employees')).toEqual([]);
    await fenetre.locator('#sf-primes tr').first().locator('[data-fp=amount]').fill('52');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Salarié enregistré.');
    const deux = (await objets()).find((o) => o.collection === 'employees' && o.contenu.name === 'Salarié Numéro Deux')?.contenu;
    expect(deux?.primes).toEqual([
      { label: 'Prime de transport', amount: 52, taxable: true, parJour: true },
      { label: 'Prime de panier', amount: 30, taxable: false, parJour: false },
    ]);
    // La liste des salariés le dit sous le brut, pour un mois entier.
    await expect.poll(() => p.locator(`[data-sal="${String(deux?.id)}"]`).innerText()).toMatch(/\+ 82,000\sDT de primes/);

    // ── Un bulletin nouveau reprend d'office les primes du salarié proposé (le seul, ici) ──────────────────────
    const lignes = async () => fenetre.locator('#bf-primes [data-l=label]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const montants = async () => fenetre.locator('#bf-primes [data-l=amount]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    await ouvrir('#pa-bulletin', '#bf');
    await expect.poll(lignes).toEqual(['Prime de transport', 'Prime de panier']);
    expect(await montants()).toEqual(['52,000', '30,000']);
    await fenetre.locator('[data-close]').first().click();
    await expect.poll(() => p.locator('#bf').count()).toBe(0);

    // Un second salarié, sans prime.
    await declarer('Salarié Numéro Trois', '980', []);
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#sf').count()).toBe(0);

    // ── Les primes proposées suivent le salarié choisi ──────────────────────────────────────────────────────────
    await ouvrir('#pa-bulletin', '#bf');
    const choisir = (nom: string) => fenetre.locator('[name=salarieId]').selectOption({ label: nom });
    await choisir('Salarié Numéro Trois');
    await expect.poll(lignes).toEqual([]);
    await choisir('Salarié Numéro Deux');
    await expect.poll(lignes).toEqual(['Prime de transport', 'Prime de panier']);
    expect(await montants()).toEqual(['52,000', '30,000']);
    // Deux jours d'absence : la prime au jour suit les jours payés (52 × 24 / 26 = 48) ; la prime fixe passe entière.
    await fenetre.locator('[name=joursAbsence]').fill('2');
    await expect.poll(montants).toEqual(['48,000', '30,000']);
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    await expect.poll(() => p.locator('#bf').count()).toBe(0);
    const bulletin = (await objets()).find((o) => o.collection === 'payslips')?.contenu;
    expect(bulletin?.bonuses).toEqual([
      { label: 'Prime de transport', amount: 48, taxable: true, parJour: true, mensuel: 52, jours: 24, sur: 26 },
      { label: 'Prime de panier', amount: 30, taxable: false },
    ]);

    // ── Rouverte, la fiche montre ses primes, telles qu'enregistrées ─────────────────────────────────────────────
    await expect.poll(async () => {
      if (!await p.locator('#sf').count()) {
        if (!await p.getByRole('menuitem').filter({ hasText: 'Modifier la fiche' }).count()) await p.locator(`[data-rowmenu="SAL:${String(deux?.id)}"]`).first().click({ timeout: 2_000 }).catch(() => {});
        await p.getByRole('menuitem').filter({ hasText: 'Modifier la fiche' }).first().click({ timeout: 2_000 }).catch(() => {});
      }
      return p.locator('#sf').count();
    }, { timeout: 20_000 }).toBe(1);
    const fiche = (champ: string) => fenetre.locator(`#sf-primes [data-fp=${champ}]`).evaluateAll((els) => els.map((e) => {
      const i = e as HTMLInputElement;
      return i.type === 'checkbox' ? i.checked : i.value;
    }));
    expect(await fiche('label')).toEqual(['Prime de transport', 'Prime de panier']);
    expect(await fiche('amount')).toEqual(['52,000', '30,000']);
    expect(await fiche('taxable')).toEqual([true, false]);
    expect(await fiche('parJour')).toEqual([true, false]);
    await fenetre.locator('[data-close]').first().click();
    await expect.poll(() => p.locator('#sf').count()).toBe(0);

    // ── Une prime retouchée à la main reste quand on change de salarié ──────────────────────────────────────────
    await ouvrir('#pa-bulletin', '#bf');
    await choisir('Salarié Numéro Deux');
    await expect.poll(lignes).toEqual(['Prime de transport', 'Prime de panier']);
    await fenetre.locator('#bf-primes [data-l=label]').first().fill('Prime de transport (octobre)');
    await choisir('Salarié Numéro Trois');
    await expect.poll(lignes).toEqual(['Prime de transport (octobre)', 'Prime de panier']);
    await fenetre.locator('[data-close]').first().click();
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-primes.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
