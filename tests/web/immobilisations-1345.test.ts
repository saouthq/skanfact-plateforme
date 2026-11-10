// (1.345.0) Les immobilisations d'un dossier au Cabinet, jouées comme un comptable : ce que la revue a trouvé.
//   - un achat déjà au registre (une fiche saisie à la main) se RATTACHE à sa fiche : plus de second amortissement ;
//   - une sortie annonce sa plus ou moins-value AVANT d'enregistrer, et sa dotation se date du jour de la sortie ;
//   - « Voir le plan » amène le plan à l'écran ; la famille propose son compte ; un seul vert sur l'état vide ;
//   - la Saisie dit la période validée avant le geste (le serveur refusait au clic).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les immobilisations du Cabinet (1.345.0), à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-immo-1345-'));
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

  type Bien = { id: string; fiche: { libelle: string; compte: string; origine: { docId: string } }; ecritures: { annee: number; genre: string; ecriture: string }[] };
  const biens = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/immobilisations`, jeton)).corps.immobilisations as Bien[];

  it('(1.345.0) l\'achat se rattache, la sortie s\'annonce et se date, le plan vient à l\'écran, la période validée se dit avant', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const vide = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Librairie du Lac' })).corps.entreprise);
    // Un livre sans bien : une écriture ordinaire, aucune acquisition.
    expect((await api('POST', `/entreprises/${vide}/compta/ecritures`, associe, { date: '2026-02-10', journal: 'AC', piece: 'F-1', libelle: 'Papeterie',
      lignes: [{ compte: '606', libelle: 'Papeterie', debit: '50' }, { compte: '401', credit: '50' }] })).statut).toBe(201);
    const achat = String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date: '2026-03-01', journal: 'AC', piece: 'F-77', libelle: 'Camionnette Isuzu',
      lignes: [{ compte: '224', libelle: 'Camionnette Isuzu', debit: '36000' }, { compte: '404', credit: '36000' }] })).corps.id);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [achat] })).statut).toBe(200);
    // La fiche saisie à la main AVANT que l'achat n'arrive au livre : au compte 22, sans origine.
    expect((await api('POST', `/entreprises/${cafe}/compta/immobilisations`, associe, { fiche: { libelle: 'Camionnette de livraison', compte: '22', compteAmort: '28', compteDotation: '681',
      dateAcquisition: '2026-03-01', dateMiseEnService: '2026-03-01', valeur: '36000', residuelle: '0', tva: '0', methode: 'lineaire', duree: '5', tauxDegressif: null, bascule: false,
      subvention: null, cession: null, origine: { source: 'saisie', docId: '', mois: '' } } })).statut).toBe(201);
    // Janvier validé : la base refuse d'y écrire.
    expect((await api('POST', `/entreprises/${cafe}/compta/valider`, associe, { jusqua: '2026-01-31' })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (ent: string, ecran: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/${ecran}/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();

    // ── Un seul vert sur l'état vide : celui de l'état vide ──────────────────────────────────────────
    await aller(vide, 'immobilisations');
    await expect.poll(() => p.locator('#im-neuf2').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.locator('#im-neuf2').getAttribute('class')).toMatch(/btn-primary/);
    expect(await p.locator('#im-neuf').getAttribute('class')).not.toMatch(/btn-primary/);

    // ── L'achat se rattache à la fiche du registre : le vert le propose, plus « Créer » ──────────────
    await aller(cafe, 'immobilisations');
    await expect.poll(() => p.locator('[data-rattacher]').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.locator('[data-creer]').count()).toBe(0);
    expect(await p.locator('[data-rattacher]').innerText()).toBe('Rattacher à « Camionnette de livraison »…');
    expect(await p.locator('[data-rattacher]').getAttribute('class')).toMatch(/btn-primary/);
    await p.locator('[data-rattacher]').click();
    await expect.poll(() => fenetre.innerText()).toMatch(/Sa fiche prend le compte 224 de l'achat \(elle portait 22\)/);
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Achat rattaché à « Camionnette de livraison ».');
    const [bien] = await biens(cafe, associe);
    expect(bien?.fiche).toMatchObject({ compte: '224', origine: { docId: `${achat}#0` } });
    await expect.poll(() => p.locator('[data-rattacher], [data-creer]').count()).toBe(0);

    // ── « Voir le plan » amène le plan à l'écran (sur un portable bas : à 900 px, il tenait sous le tableau) ──
    await p.setViewportSize({ width: 1440, height: 560 });
    await p.locator(`[data-rowmenu="IM:${bien?.id}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Voir le plan d\'amortissement' }).click();
    // Amené EN HAUT de l'écran : ouvert sous le tableau sans y descendre, il commençait au bas de la fenêtre.
    await expect.poll(() => p.locator('#im-plan').evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(260);
    await p.setViewportSize({ width: 1440, height: 900 });

    // ── La sortie annonce sa moins-value AVANT d'enregistrer (7 200 × 7/12 = 4 200 ; 36 000 − 4 200 − 30 000) ──
    await p.locator(`[data-rowmenu="IM:${bien?.id}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Modifier la fiche' }).click();
    await fenetre.locator('[name=cessionDate]').fill('30/09/2026');
    await fenetre.locator('[name=cessionPrix]').fill('30000');
    await expect.poll(() => fenetre.locator('#im-apercu').innerText()).toMatch(/Dotation 2026 jusqu'au jour de la sortie : 4\s200,000/);
    expect(await fenetre.locator('#im-apercu').innerText()).toMatch(/valeur comptable 31\s800,000\sDT, prix 30\s000,000\sDT,\s+moins-value de 1\s800,000/);
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Fiche enregistrée.');
    // ── La dotation d'un bien sorti se date du jour de sa sortie, comme dans l'app entreprise ──────────
    await p.locator('#im-ecrire').click();
    await expect.poll(toast).toBe('2 écritures passées en brouillard.');
    const lies = (await biens(cafe, associe))[0]?.ecritures ?? [];
    const ecrites = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { id: string; date: string; lignes: { compte: string; debit: string; credit: string }[] }[];
    const de = (genre: string) => ecrites.find((e) => e.id === lies.find((l) => l.genre === genre)?.ecriture);
    expect(de('dotation')).toMatchObject({ date: '2026-09-30', lignes: [{ compte: '681', debit: '4200.000' }, { compte: '28', credit: '4200.000' }] });
    expect(de('cession')?.date).toBe('2026-09-30');
    expect(de('cession')?.lignes.find((l) => l.credit !== '0.000')).toMatchObject({ compte: '224', credit: '36000.000' });

    // ── La famille propose son compte, tant qu'on n'y a pas touché ─────────────────────────────────────
    await p.locator('#im-neuf').click();
    await fenetre.locator('[name=famille]').selectOption('informatique');
    expect(await fenetre.locator('[name=compte]').inputValue()).toBe('2283');
    expect(await fenetre.locator('[name=duree]').inputValue()).toBe('3');
    await fenetre.locator('[name=compte]').fill('2281');
    await fenetre.locator('[name=famille]').selectOption('transport');
    expect(await fenetre.locator('[name=compte]').inputValue()).toBe('2281');
    expect(await p.evaluate(() => { const KC = (window as unknown as { SkanCompta: { compteDeFamille: (k: string) => string; ficheDuClient: (b: unknown) => { famille: string } } }).SkanCompta;
      return [KC.compteDeFamille('inconnue'), KC.ficheDuClient({ libelle: 'Camion', famille: 'transport', date: '2026-01-01', valeur: 1, duree: 5 }).famille]; })).toEqual(['', 'transport']);
    await fenetre.locator('[data-close]').click();
    // Des champs touchés : la fenêtre demande avant de les jeter, comme un humain on répond.
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Abandonner', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);

    // ── La Saisie dit la période validée AVANT le geste ─────────────────────────────────────────────
    await aller(cafe, 'saisie');
    await p.locator('#sa-date').fill('20/01/2026');
    await p.locator('#sa-date').press('Tab');
    await p.locator('#sa-piece').fill('F-12');
    await p.locator('#sa-libelle').fill('Farine');
    const cases = p.locator('#sa-lignes tr');
    await cases.nth(0).locator('[data-k="compte"]').fill('606');
    await cases.nth(0).locator('[data-k="debit"]').fill('100');
    await cases.nth(1).locator('[data-k="compte"]').fill('401');
    await cases.nth(1).locator('[data-k="credit"]').fill('100');
    await expect.poll(() => p.locator('#sa-refus').innerText()).toMatch(/^La période est validée jusqu'au 31\/01\/2026\s:\sune écriture ne s'y écrit plus\. Date-la du 01\/02\/2026 ou après\.$/);
    expect(await p.locator('#sa-ok').isDisabled()).toBe(true);
    expect(await p.locator('#sa-okvalider').isDisabled()).toBe(true);
    await p.locator('#sa-date').fill('01/02/2026');
    await p.locator('#sa-date').press('Tab');
    await expect.poll(() => p.locator('#sa-ok').isDisabled()).toBe(false);
    expect(erreurs).toEqual([]);
  }, 240_000);
});
