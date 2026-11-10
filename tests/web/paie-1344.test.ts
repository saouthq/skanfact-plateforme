// La Paie d'un dossier au Cabinet, jouée comme un comptable (1.344.0 ; docs/revue-modules.md). Ce que le parcours
// vérifie, écran ET serveur :
//   - l'écriture de paie se valide depuis la Paie (« Valider l'écriture de paie »), sans partir dans la grille ;
//   - « L'année » compte la paie passée au journal SANS bulletin (le mois d'avant les bulletins) : le 640 du livre et
//     l'écran disent le même chiffre ; un 640 qui bouge dans un mois qui A ses bulletins reste un écart ;
//   - le fichier CNSS : une ligne par salarié (son refus, puis ce que sa fiche porte encore), « la fiche d'Amira » ;
//   - un trimestre terminé propose de ranger son accusé (un trimestre en cours, non : cabinet-paie-parcours).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la paie d\'un dossier au Cabinet, jouée comme un comptable (1.344.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-1344-'));
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

  const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();

  it('(1.344.0) l\'écriture validée depuis la Paie, la paie passée au journal comptée dans l\'année, le fichier CNSS une ligne par salarié', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie Essaada' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);
    const saisir = async (date: string, piece: string, lignes: [string, string, string][]) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal: 'PAIE', piece, libelle: `Salaires ${piece}`, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [String(r.corps.id)] })).statut).toBe(200);
    };
    // Janvier : la paie passée au journal, avant que le cabinet ne fasse les bulletins ici.
    await saisir('2025-01-31', 'PAIE-01', [['640', '1000', ''], ['425', '', '1000']]);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/paie/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const VUE_DU_BOUTON: Record<string, string> = { '#pa-salarie': 'salaries' };
    const vue = (k: string) => p.locator(`.pa-so [data-pa-vue="${k}"]`).click();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) {
        if (!await p.locator(bouton).count() && VUE_DU_BOUTON[bouton]) await vue(VUE_DU_BOUTON[bouton]).catch(() => {});
        await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      }
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('3');

    // ── Amira, sans n° CNSS ni identité CNSS ; son bulletin de mars ───────────────────────────────────
    await ouvrir('#pa-salarie', '#modal-root [name=nom]');
    await fenetre.locator('[name=nom]').fill('Amira Ben Salah');
    await fenetre.locator('[name=brut]').fill('600');
    await fenetre.locator('[name=embauche]').fill('01/01/2025');
    await fenetre.locator('[name=cin]').fill('07654321');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Salarié enregistré.');
    await vue('mois');
    await ouvrir('#pa-bulletin', '#bf');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');

    // ── L'écriture de paie : passée, puis validée DEPUIS la Paie (la grille n'est pas ouverte) ────────────────
    // Le bulletin enregistré, son écriture est au brouillard : on valide le bulletin, puis l'écriture, sans quitter la Paie.
    await p.locator('#pa-valider-bul').click();
    await fenetre.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect.poll(toast).toMatch(/^Bulletin validé : il ne change plus\. L'écriture de paie de mars reste au brouillard\./);
    await p.locator('#pa-valider').click();
    await expect.poll(() => fenetre.innerText().then(espace).catch(() => '')).toMatch(/Valider/);
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#pa-valider').count(), { timeout: 15_000 }).toBe(0);
    expect(p.url()).toMatch(/comptabilite\/paie/);
    const ecr = (await api('GET', `/entreprises/${ent}/compta/ecritures?piece=PAIE-2025-03`, associe)).corps as { ecritures: { statut: string }[] };
    expect(ecr.ecritures.map((e) => e.statut)).toEqual(['validee']);

    // ── L'année : la paie de janvier, passée au journal, compte ; le 640 et l'écran disent le même chiffre ─────
    await vue('annee');
    await expect.poll(() => p.locator('#pa-livre-640').innerText().then(espace).catch(() => '')).toMatch(/paie passée au journal sans bulletin \(janvier\) : 1 000,000 DT · compte 640 du livre \(validé\) : 1 600,000 DT · égaux au millime/);
    expect(espace(await p.locator('#pa-annee-mois tbody tr').first().innerText())).toMatch(/^janvier au journal/);
    expect(espace(await p.locator('#pa-masse-ailleurs').innerText())).toMatch(/les salaires bruts de l'exercice font 1 600,000 DT\.$/);
    // Un 640 qui bouge dans un mois qui A ses bulletins reste un écart, et le dit.
    await saisir('2025-03-31', 'OD-1', [['640', '50', ''], ['425', '', '50']]);
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await vue('annee').catch(() => {});
    await expect.poll(async () => { if (!await p.locator('#pa-livre-640').count()) await vue('annee').catch(() => {}); return p.locator('#pa-livre-640').innerText().then(espace).catch(() => ''); }, { timeout: 20_000 })
      .toMatch(/écart de 50,000 DT dans un mois qui a ses bulletins/);

    // ── Le fichier CNSS : une ligne par salarié, « la fiche d'Amira » ; un trimestre terminé propose son accusé ───
    await vue('cnss');
    await expect.poll(() => p.locator('#pa-fichier-bloc').innerText().then(espace).catch(() => ''), { timeout: 15_000 })
      .toMatch(/Amira Ben Salah — Son numéro d'assuré CNSS manque\. Aussi : son identité CNSS reprend le nom de sa fiche\. Ouvrir la fiche d'Amira Ben Salah…/);
    expect(await p.locator('#pa-fichier-bloc .pa-avert [data-pa-sal]').count()).toBe(0);
    expect(await p.locator('#pa-en-cours').count()).toBe(0);
    await expect.poll(() => p.locator('#pa-cnss-accuse-ranger').count(), { timeout: 15_000 }).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-1344.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
