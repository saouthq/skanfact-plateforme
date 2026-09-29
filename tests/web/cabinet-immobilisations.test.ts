// Les immobilisations, à la souris (brique 42 ; docs/cabinet.md, C28 et C29). L'écran est celui du
// Cabinet v10 ; le plan d'amortissement se calcule par la v10 ; les fiches et les dotations vont au
// serveur. Ce que le parcours vérifie, écran ET serveur :
//   - l'acquisition du livre se propose (« à créer ») ; la fiche se crée depuis elle, sa durée décidée ;
//   - la dotation de l'année s'écrit au brouillard, au millime du plan (10 mois sur 12, en 360 jours),
//     liée à son bien ; le bouton s'éteint ;
//   - écrite, la durée ne change plus et le bien ne se supprime pas : les deux refus le disent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les immobilisations, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-immo-'));
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

  type Bien = { id: string; fiche: { libelle: string; duree: string; origine: { docId: string } }; ecritures: { annee: number; genre: string; ecriture: string }[] };
  const biens = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/immobilisations`, jeton)).corps.immobilisations as Bien[];

  it('l\'acquisition se propose, la fiche se crée, la dotation s\'écrit au millime et se lie ; écrite, le plan ne change plus', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const achat = String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date: '2025-03-01', journal: 'AC', piece: 'F-77', libelle: 'Camionnette Isuzu',
      lignes: [{ compte: '224', libelle: 'Camionnette Isuzu', debit: '36000,600' }, { compte: '404', credit: '36000,600' }] })).corps.id);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [achat] })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/immobilisations/2025`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();

    // ── L'acquisition du livre se propose ; la fiche se crée depuis elle ───────────────────────────
    await aller();
    await expect.poll(() => p.locator('[data-creer]').count(), { timeout: 15_000 }).toBe(1);
    await p.locator('[data-creer]').click();
    expect(await fenetre.locator('[name=valeur]').inputValue()).toMatch(/^36\s000,600$/);
    await fenetre.locator('[name=duree]').fill('5');
    await expect.poll(() => fenetre.locator('#im-apercu').innerText()).toMatch(/première dotation 6\s000,100/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-immobilisations-1-fiche.png') });
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bien ajouté.');
    const [bien] = await biens(cafe, associe);
    expect(bien?.fiche).toMatchObject({ libelle: 'Camionnette Isuzu', duree: '5', origine: { docId: `${achat}#0` } });
    await expect.poll(() => p.locator('[data-creer]').count()).toBe(0);

    // ── La dotation de 2025, au brouillard, au millime du plan, liée à son bien ──────────────────────
    await p.locator('#im-ecrire').click();
    await expect.poll(toast).toBe('1 écriture passée en brouillard.');
    const [lie] = (await biens(cafe, associe))[0]?.ecritures ?? [];
    expect(lie).toMatchObject({ annee: 2025, genre: 'dotation' });
    const ecrites = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { id: string; statut: string; date: string; lignes: { compte: string; debit: string; credit: string }[] }[];
    expect(ecrites.find((e) => e.id === lie?.ecriture)).toMatchObject({ statut: 'brouillard', date: '2025-12-31', lignes: [
      { compte: '681', debit: '6000.100', credit: '0.000' }, { compte: '28', debit: '0.000', credit: '6000.100' }] });
    await expect.poll(() => p.locator('#im-ecrire').isDisabled()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-immobilisations-2-dotation.png') });

    // ── Écrite : la durée ne change plus, le bien ne se supprime pas ─────────────────────────────────
    await p.locator(`[data-rowmenu="IM:${bien?.id}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Modifier la fiche' }).click();
    await fenetre.locator('[name=duree]').fill('4');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toMatch(/^La dotation de 2025 est déjà passée en écriture : ce changement la rendrait fausse\./);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-immobilisations-3-refus.png') });
    // Le message rouge couvre le bas de la fenêtre : on la ferme au clavier.
    await p.keyboard.press('Escape');
    // Des changements non enregistrés : la fenêtre demande avant de les perdre.
    const garde = p.locator('#modal-root .modal').last();
    if (await garde.getByRole('button', { name: /Abandonner|Quitter|Fermer sans/ }).count()) await garde.getByRole('button', { name: /Abandonner|Quitter|Fermer sans/ }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await p.locator(`[data-rowmenu="IM:${bien?.id}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Supprimer ce bien' }).click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect.poll(toast).toMatch(/^La dotation de 2025 est passée en écriture : supprimer la fiche laisserait une dotation sans bien\./);
    expect((await biens(cafe, associe)).map((b) => b.fiche.duree)).toEqual(['5']);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
