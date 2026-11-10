// La pagination dans toutes les listes du Cabinet (1.352.0 ; docs/revue-modules.md). Demande de Skander : « n'oublie pas
// la pagination dans toutes les listes ». Sur un dossier plein, sept listes s'affichaient d'un seul tenant — la banque
// (400 mouvements, vingt écrans), les biens, l'inventaire, les à-nouveaux, ce qui manque au classeur — et la recherche
// coupait à 200 sans montrer la suite. Le parcours remplit un dossier et tourne les pages, à l'écran : chaque liste
// montre une page, dit « n–m sur N », et son pied de totaux reste celui de TOUTE la liste.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la pagination dans toutes les listes du Cabinet (1.352.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-pagination-'));
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

  const dt = (x: number) => `${Math.trunc(x / 1000)},${String(x % 1000).padStart(3, '0')}`;

  it('un dossier plein : la recherche, les pièces d\'une case, les à-nouveaux, les biens, l\'inventaire, la banque et le classeur se feuillettent, totaux entiers', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Grossiste du Sahel' })).corps.entreprise);
    // 205 achats de mars, chacun son fournisseur : au-delà des 200 que la recherche montrait, et de quoi remplir les à-nouveaux.
    const ids: string[] = [];
    for (let k = 0; k < 205; k++) {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `2026-03-${String(1 + (k % 28)).padStart(2, '0')}`, journal: 'AC', piece: `FA-${String(k + 1).padStart(3, '0')}`, libelle: 'Achat de marchandises',
        lignes: [{ compte: '607', debit: '100,000' }, { compte: '4366', debit: '19,000' }, { compte: '401', tiers: `Fournisseur n° ${k + 1}`, credit: '119,000' }] });
      expect(r.statut).toBe(201);
      ids.push(String(r.corps.id));
    }
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);
    // 30 biens : 1 000,000 + 10 × k chacun → 30 000 + 10 × 435 = 34 350,000 en tout.
    for (let k = 0; k < 30; k++) {
      expect((await api('POST', `/entreprises/${ent}/compta/immobilisations`, associe, { fiche: { libelle: `Matériel n° ${k + 1}`, compte: '2234', compteAmort: '28234', compteDotation: '6811',
        dateAcquisition: '2026-01-01', dateMiseEnService: '2026-01-01', valeur: dt(1_000_000 + k * 10_000), residuelle: '0', tva: '0', methode: 'lineaire', duree: '5',
        tauxDegressif: null, bascule: false, subvention: null, cession: null, origine: { source: 'manuel', docId: '', mois: '' } } })).statut).toBe(201);
    }
    // 40 lignes d'inventaire : 2 × (5 + k) chacune → 2 × (200 + 780) = 1 960,000 en tout.
    expect((await api('PUT', `/entreprises/${ent}/compta/inventaires/2026`, associe, { date: '2026-12-31', compte: '37',
      lignes: Array.from({ length: 40 }, (_, k) => ({ ref: `A${String(k + 1).padStart(2, '0')}`, libelle: `Article n° ${k + 1}`, quantite: '2', cout: dt(5_000 + k * 1_000) })) })).statut).toBeLessThan(300);
    // 60 mouvements de banque en septembre : +10 puis −10, le relevé se boucle sur son solde de départ.
    const mouvements = Array.from({ length: 60 }, (_, k) => ({ date: `2026-09-${String(1 + (k % 30)).padStart(2, '0')}`, libelle: `${k % 2 ? 'PRLV' : 'VIR RECU'} TIERS ${1000 + k}`, reference: '', montant: `${k % 2 ? '-' : ''}10,${String(k).padStart(3, '0')}` }));
    const somme = mouvements.reduce((t, m, k) => t + (k % 2 ? -1 : 1) * (10_000 + k), 0);
    expect((await api('POST', `/entreprises/${ent}/compta/releves`, associe, { annee: 2026, compte: '532', banque: 'BIAT', fichier: 'Releve_BIAT_09-2026.pdf', empreinte: 'ab'.repeat(32),
      soldeDebut: '5000,000', soldeFin: dt(5_000_000 + somme), lignes: mouvements })).statut).toBeLessThan(300);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (ancre: string, attendre: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/${ancre}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
      await p.locator(attendre).first().waitFor({ timeout: 15_000 });
    };
    const net = (t: string) => t.replace(/\s+/g, ' ').trim();
    const pied = (ou: string) => p.locator(`${ou} .pager span`).first().innerText().then(net);

    // ── La recherche : tout ce qui correspond, pas « les 200 premières » ─────────────────────────────
    await aller('comptabilite/recherche/2026', '#re-journal');
    await p.locator('#re-journal').selectOption('AC');
    await expect.poll(() => p.locator('#c-livres .muted.small.mb').innerText().then(net)).toBe('205 écritures trouvées sur 205.');
    expect(await p.locator('#c-livres tbody tr').count()).toBe(25);
    expect(await pied('#c-livres')).toBe('1–25 sur 205 écritures');
    await p.locator('#pg-next').click();
    await expect.poll(() => pied('#c-livres')).toBe('26–50 sur 205 écritures');
    // Un autre filtre repart de la première page.
    await p.locator('#re-statut').selectOption('validee');
    await expect.poll(() => pied('#c-livres')).toBe('1–25 sur 205 écritures');
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-1-recherche.png') });

    // ── Les pièces d'une case de la déclaration ──────────────────────────────────────────────────────
    await aller('comptabilite/declaration/2026', '#dc-mois');
    await p.locator('#dc-mois').selectOption('2026-03');
    await p.locator('[data-cases]').filter({ hasText: '205 écritures' }).first().click();
    await expect.poll(() => p.locator('#dc-pieces tbody tr').count()).toBe(25);
    expect(await pied('#dc-pieces')).toBe('1–25 sur 205 pièces');
    await p.locator('#dc-pieces #pg-next').click();
    await expect.poll(() => pied('#dc-pieces')).toBe('26–50 sur 205 pièces');

    // ── Les à-nouveaux de l'exercice suivant : le pied garde le total de TOUTES les lignes ───────────
    await aller('comptabilite/exercice/2026', '[data-cl-sec="an"]');
    await p.locator('[data-cl-sec="an"]').click();
    await expect.poll(() => p.locator('#cl-sec-an tbody tr').count()).toBe(25);
    const lignesAN = Number(/sur (\d+) lignes/.exec(await pied('#cl-sec-an'))?.[1]);
    expect(lignesAN).toBeGreaterThanOrEqual(205);
    expect(net(await p.locator('#cl-sec-an tfoot').innerText()).toLowerCase()).toContain(`${lignesAN} lignes`);
    await p.locator('#cl-sec-an #pg-next').click();
    await expect.poll(() => pied('#cl-sec-an')).toBe(`26–50 sur ${lignesAN} lignes`);
    expect(await p.locator('#cl-sec-an').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);

    // ── Les biens : vingt-cinq à l'écran, le total des trente au pied ────────────────────────────────
    await aller('comptabilite/immobilisations/2026', '#c-livres tfoot');
    await expect.poll(() => p.locator('#c-livres table.list tbody tr').count()).toBe(25);
    expect(await pied('#c-livres')).toBe('1–25 sur 30 biens');
    expect(net(await p.locator('#c-livres tfoot').first().innerText())).toMatch(/30 biens\s+34\s350,000/i);
    await p.locator('#pg-next').click();
    await expect.poll(() => p.locator('#c-livres table.list tbody tr').count()).toBe(5);
    expect(net(await p.locator('#c-livres tfoot').first().innerText())).toMatch(/30 biens\s+34\s350,000/i);
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-2-biens.png') });

    // ── L'inventaire ─────────────────────────────────────────────────────────────────────────────────
    await aller('comptabilite/inventaire/2026', '#c-livres .pager');
    expect(await pied('#c-livres')).toBe('1–25 sur 40 lignes');
    const tableInv = p.locator('#c-livres table.list').last();
    expect(await tableInv.locator('tbody tr').count()).toBe(25);
    expect(net(await tableInv.locator('tfoot').innerText())).toMatch(/40 lignes comptées\s+1\s960,000/i);
    await p.locator('#pg-next').click();
    await expect.poll(() => p.locator('#c-livres table.list').last().locator('tbody tr').count()).toBe(15);

    // ── La banque : cinquante mouvements par page, et les flèches passent d'une page à l'autre ───────
    await aller('comptabilite/banque/2026', '.bq-t [data-bq-ligne]');
    expect(await p.locator('.bq-t [data-bq-ligne]').count()).toBe(50);
    expect(await pied('.bq-liste')).toBe('1–50 sur 60 mouvements');
    await p.locator('.bq-liste #pg-next').click();
    await expect.poll(() => p.locator('.bq-t [data-bq-ligne]').count()).toBe(10);
    expect(await pied('.bq-liste')).toBe('51–60 sur 60 mouvements');
    // La page tournée choisit sa première ligne ; ↑ revient à la dernière de la page d'avant, ↓ repasse à la suivante.
    const choisie = () => p.locator('.bq-t .bq-l.on').innerText().then(net);
    expect(await choisie()).toContain('TIERS 1050');
    await p.keyboard.press('ArrowUp');
    await expect.poll(() => pied('.bq-liste')).toBe('1–50 sur 60 mouvements');
    expect(await choisie()).toContain('TIERS 1049');
    await p.keyboard.press('ArrowDown');
    await expect.poll(() => pied('.bq-liste')).toBe('51–60 sur 60 mouvements');
    // Le « n par page » prend la largeur de son texte, pas celle de la liste.
    expect(await p.locator('.bq-liste .pager select').evaluate((s) => s.getBoundingClientRect().width)).toBeLessThan(200);
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-3-banque.png') });

    // ── Le classeur : ce qui manque se feuillette, vingt-cinq par vingt-cinq ─────────────────────────
    await aller('classeur', '.cl-sec');
    const manques = p.locator('.cl-sec').filter({ hasText: 'Ce qui manque' }).first();
    const combien = Number(net(await manques.locator('h3 span').first().innerText()));
    if (combien > 25) {
      expect(await manques.locator('.cl-ls > li').count()).toBe(25);
      expect(net(await manques.locator('.cl-pager span').innerText())).toBe(`1–25 sur ${combien}`);
      await manques.locator('.cl-pager [data-cl-pg]').last().click();
      await expect.poll(() => p.locator('.cl-sec').filter({ hasText: 'Ce qui manque' }).first().locator('.cl-pager span').innerText().then(net)).toBe(`26–${Math.min(50, combien)} sur ${combien}`);
    }
    expect(combien).toBeGreaterThan(25);
    expect(erreurs).toEqual([]);
  }, 240_000);
});
