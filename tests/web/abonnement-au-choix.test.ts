// L'abonnement après sa revue, lot 2, à la souris (1.119.0 ; docs/revue-abonnement.md ; plateforme/abonnement.js ;
// serveur/abonnement/facturier.ts). Ce que le parcours vérifie :
//   - chaque carte dit son prix TTC ; la confirmation dit que la facture est faite tout de suite ; confirmée, la facture
//     arrive dans « Tes factures » sans recharger la page, à payer, et le choix s'efface ;
//   - pendant une période payée, « Ne pas renouveler… » est discret, dit ce qui se passera avant le geste, se referme
//     sans rien faire ; fait, l'onglet propose « Reprendre mon abonnement », qui le reprend d'un clic ;
//   - « Ouvrir la paie maintenant… » dit ce que la prochaine facture rattrapera, lu au serveur, puis ouvre la paie.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { jourEnFrancais, plusJours } from '../../serveur/abonnement/etat.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('l\'abonnement au choix, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-abonnement-au-choix-'));
  const jour = aujourdhuiATunis();
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (prenom: string) => {
    const email = `${prenom.toLowerCase()}-au-choix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: MDP });
    return { email, jeton: String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
  };
  beforeAll(async () => {
    await admin.connect();
    // Le timbre de la facture, comme en production (sans lui, la facture ne s'émet pas : le choix irait à la console).
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    // La facture au choix branchée ; le tour de la minute éloigné (les choix laissés par d'autres essais ne se facturent
    // pas ici) : seul le tour lancé juste après un choix, pour son entreprise, travaille.
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_FACTURE_AU_CHOIX: '1', SKANFACT_FACTURIER_MS: '3600000' }),
      port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    // Amira, de la direction, désigne l'entreprise SkanFact, et ouvre son application une fois (sa fiche naît).
    const amira = await personne('Amira');
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', amira.jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, amira.email, 'direction', 'mise en place des essais');
    const k = await api('POST', '/console/connexion', undefined, { email: amira.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    const console = String((await api('POST', '/console/connexion/code', undefined, { defi: k.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const editeur = String((await api('POST', '/entreprises', amira.jeton, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
    await admin.query('delete from plateforme.editeur');
    expect((await api('POST', '/console/reglages/factures/editeur', console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    expect((await api('GET', `/entreprises/${editeur}/dossier-v10`, amira.jeton)).statut).toBe(200);
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const erreurs: string[] = [];
  const ouvrir = async (jeton: string, ent: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    await cliquer(p.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => p.locator('#abo-etat').isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    return { p, cx };
  };
  // Un abonnement payé qui court, Essentiel au mois : sa période, du paiement qui l'a payée.
  const payee = async (ent: string, debut: string, fin: string) => {
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 1, paye_jusqu_au = $3::date, offre = 'essentiel', periodicite = 'mensuel'
      where entreprise = $1`, [ent, debut, fin]);
    await admin.query(`insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, apres)
      values ($1, 'paye', 'systeme', 'payée en ligne', jsonb_build_object('debut', $2::text, 'fin', $3::text))`, [ent, debut, fin]);
  };

  it('Nadia choisit Essentiel au mois : le prix TTC se lit avant, et sa facture arrive d\'elle-même dans « Tes factures »', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Pâtisserie du Lac' })).corps.id);
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 6 where entreprise = $1', [ent, jour]);
    const { p, cx } = await ouvrir(nadia.jeton, ent);
    await cliquer(p.getByRole('button', { name: 'Choisir mon offre', exact: true }));
    // Le TTC de chaque carte, par le moteur de la facture : 39 HT au mois, 7,410 de TVA, 1 de timbre.
    const ttc = (await p.locator('#abonnement-panel .abo-ttc').allInnerTexts()).map(net);
    expect(ttc).toHaveLength(2);
    expect(ttc[0]).toMatch(/^TVA et timbre compris : .* par an, ou 47,410 DT par mois\.$/);
    await cliquer(p.locator('[data-choisir="essentiel:mensuel"]'));
    const boite = p.locator('#abo-dialogue');
    expect(net(await boite.innerText())).toContain('Ta facture est faite tout de suite : elle arrive ici, dans « Tes factures »');
    expect(net(await boite.locator('.abo-recap-total').innerText())).toBe('Total à régler TVA et timbre fiscal compris 47,410 DT par mois');
    await cliquer(p.getByRole('button', { name: 'Je choisis Essentiel, au mois', exact: true }));
    // Sans recharger : la facture est là, à payer, et le choix s'est effacé.
    const facture = p.locator('#abo-factures .abo-factures li').first();
    await expect.poll(() => facture.innerText().then(net).catch(() => ''), { timeout: 20_000 }).toContain('47,410');
    expect(await p.locator('#abo-payer.abo-choisi').count()).toBe(0);
    // (1.121.0) L'état dit ce qui vient ensuite, et où est la facture : il répétait « Ce que tu crées pendant l'essai… ».
    expect(net(await p.locator('#abo-etat p').first().innerText())).toContain(`Ensuite : Essentiel, au mois, dès le ${jourEnFrancais(plusJours(jour, 7))}. Ta facture t'attend juste en dessous : réglée d'ici là, rien ne s'arrête.`);
    // (1.122.0) L'offre choisie se reconnaît dans sa carte, le temps que sa facture se règle.
    expect(net(await p.locator('[data-offre="essentiel"] .abo-badge').innerText())).toBe('Ton choix');
    expect(await p.locator('[data-offre="complet"] .abo-badge').count()).toBe(0);
    const piece = (await admin.query('select au_choix from plateforme.facture_abonnement where entreprise = $1', [ent])).rows;
    expect(piece).toEqual([{ au_choix: true }]);
    await p.screenshot({ path: path.join(PHOTOS, 'abonnement-au-choix-facture.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);

  it('Sami ne renouvelle pas, se ravise et reprend ; puis il ouvre la paie, et la confirmation dit le rattrapage', async () => {
    const sami = await personne('Sami');
    const ent = String((await api('POST', '/entreprises', sami.jeton, { raisonSociale: 'Imprimerie Sfax Centre' })).corps.id);
    const fin = plusJours(jour, 20);
    await payee(ent, plusJours(jour, -10), fin);
    const { p, cx } = await ouvrir(sami.jeton, ent);
    const resilie = async () => (await admin.query('select resilie_le::text r from plateforme.abonnement where entreprise = $1', [ent])).rows[0].r as string | null;
    // Discret : ce n'est pas l'étape suivante. (1.122.0) En bas de l'onglet, plus dans l'état, où il était le seul bouton.
    const arreter = p.locator('#abo-arreter');
    expect(await p.locator('#abo-etat #abo-arreter').count()).toBe(0);
    expect(await p.locator('#abo-arret-bas #abo-arreter').count()).toBe(1);
    expect(net(await arreter.innerText())).toBe('Ne pas renouveler…');
    expect(await arreter.getAttribute('class')).not.toMatch(/\bbtn-primary\b/);
    await cliquer(arreter);
    // Ce qui se passera, avant le geste ; « Garder mon abonnement » referme sans rien faire.
    const arret = p.locator('#abo-dialogue');
    expect(net(await arret.locator('h3').innerText())).toBe('Ne pas renouveler ton abonnement ?');
    expect(net(await arret.innerText())).toContain(`Ton abonnement va jusqu'au ${jourEnFrancais(fin)}, puis l'entreprise passe en lecture seule.`);
    await cliquer(arret.getByRole('button', { name: 'Garder mon abonnement', exact: true }));
    expect(await arret.isVisible()).toBe(false);
    // Fermée, la fenêtre rend le curseur au bouton qui l'a ouverte.
    expect(await arreter.evaluate((b) => b === document.activeElement)).toBe(true);
    await p.waitForLoadState('networkidle');
    expect(await resilie()).toBeNull();
    await cliquer(arreter);
    await cliquer(arret.getByRole('button', { name: 'Ne pas renouveler', exact: true }));
    const reprendre = p.getByRole('button', { name: 'Reprendre mon abonnement', exact: true });
    await expect.poll(() => reprendre.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    expect(await resilie()).toBe(jour);
    // (1.122.0) Il s'arrêtera : l'ambre, jamais le vert du calme ; la phrase ne répète plus la pastille.
    expect(net(await p.locator('#abo-etat .abo-pastille').innerText())).toBe('Ne se renouvelle pas');
    expect(net(await p.locator('#abo-etat p').first().innerText())).toBe(`Essentiel, au mois. L'abonnement s'arrête à cette date, puis l'entreprise passe en lecture seule. Tu peux le reprendre d'un clic jusque-là.`);
    expect(await p.locator('#abo-etat').getAttribute('class')).toMatch(/\battire\b/);
    // Plus de choix d'offre ni de module tant qu'il ne se renouvelle pas : la reprise d'abord.
    expect(await p.locator('#abonnement-panel [data-choisir], #abonnement-panel [data-module]').count()).toBe(0);
    await cliquer(reprendre);
    await expect.poll(() => arreter.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    expect(await resilie()).toBeNull();
    // Ouvrir la paie : 15 HT au mois, 21 jours sur 31 restent, 10,161 HT rattrapés sur la prochaine facture.
    await cliquer(p.getByRole('button', { name: 'Ouvrir la paie maintenant…', exact: true }));
    const confirmer = p.locator('#abo-dialogue');
    await expect.poll(() => confirmer.locator('.abo-recap-total').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toBe(`Rattrapé sur ta prochaine facture du ${jourEnFrancais(jour)} au ${jourEnFrancais(fin)}, 21 jours sur 31 10,161 DT HT`);
    await p.screenshot({ path: path.join(PHOTOS, 'abonnement-au-choix-module.png'), fullPage: true });
    await cliquer(confirmer.getByRole('button', { name: 'Ouvrir la paie', exact: true }));
    await expect.poll(async () => (await admin.query('select modules from plateforme.abonnement where entreprise = $1', [ent])).rows[0].modules, { timeout: 15_000 }).toEqual(['paie']);
    await expect.poll(() => p.getByRole('button', { name: 'Ouvrir la paie maintenant…', exact: true }).count(), { timeout: 15_000 }).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);

  // La recette de tous les états, à la souris (23/10/2026) : à neuf jours de l'échéance, l'accueil disait « Ton abonnement
  // se termine » et « Renouveler » menait à un onglet dont le seul bouton était « Ne pas renouveler… ».
  it('Rania, à neuf jours de son échéance : l\'accueil dit l\'échéance, l\'état propose de renouveler, et sa facture arrive', async () => {
    const rania = await personne('Rania');
    const ent = String((await api('POST', '/entreprises', rania.jeton, { raisonSociale: 'Boulangerie Ennasr' })).corps.id);
    const fin = plusJours(jour, 9);
    await payee(ent, plusJours(jour, -21), fin);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, rania.jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    const bandeau = p.locator('#abo-accueil');
    await expect.poll(() => bandeau.innerText().then(net).catch(() => ''), { timeout: 20_000 })
      .toContain(`Ton abonnement arrive à échéance le ${jourEnFrancais(fin)}. Renouvelle-le dès maintenant`);
    await plusTard(p);
    // La pastille du pied du menu tient sur une ligne : le détail est dans le bandeau.
    expect(net(await p.locator('#lic-banner .abo-t').innerText())).toBe(`Échéance le ${jourEnFrancais(fin)}`);
    await cliquer(p.locator('#abo-accueil-go'));
    const renouveler = p.locator('#abo-etat #abo-renouveler');
    await expect.poll(() => renouveler.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    expect(net(await renouveler.innerText())).toBe('Renouveler maintenant');
    expect((await p.locator('#abonnement-panel .btn-primary').allInnerTexts()).map(net)).toEqual(['Renouveler maintenant']);
    expect(net(await p.locator('#abo-prochaine').innerText())).toContain('Prochaine facture : 39,000 DT HT, soit 47,410 DT TVA et timbre compris, pour la période qui commence le');
    // La carte de son offre propose l'autre durée, jamais de « renouveler » ce qui se renouvelle déjà.
    expect((await p.locator('[data-offre="essentiel"] [data-choisir]').allInnerTexts()).map(net)).toEqual(['Passer à l\'année']);
    expect(await p.locator('#abo-etat #abo-arreter').count()).toBe(0);
    await cliquer(renouveler);
    const boite = p.locator('#abo-dialogue');
    expect(net(await boite.locator('h3').innerText())).toBe('Renouveler Essentiel, au mois');
    expect(net(await boite.locator('.abo-recap-total').innerText())).toBe('Total à régler TVA et timbre fiscal compris 47,410 DT par mois');
    await p.screenshot({ path: path.join(PHOTOS, 'abonnement-au-choix-renouveler.png') });
    await cliquer(boite.getByRole('button', { name: 'Renouveler', exact: true }));
    const facture = p.locator('#abo-factures .abo-factures li').first();
    await expect.poll(() => facture.innerText().then(net).catch(() => ''), { timeout: 20_000 }).toContain('47,410');
    expect(net(await p.locator('#abo-etat p').first().innerText())).toBe(`Encore 9 jours. Ta facture du renouvellement t'attend juste en dessous : réglée d'ici le ${jourEnFrancais(fin)}, rien ne s'arrête.`);
    expect(await p.locator('#abo-renouveler').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);

  it('Lina, cinq jours avant la fin de l\'essai : « Choisir mon offre » de l\'accueil mène aux offres, d\'un clic', async () => {
    const lina = await personne('Lina');
    const ent = String((await api('POST', '/entreprises', lina.jeton, { raisonSociale: 'Épicerie Fine Menzah' })).corps.id);
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 5 where entreprise = $1', [ent, jour]);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, lina.jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await expect.poll(() => p.locator('#abo-accueil-go').innerText().then(net).catch(() => ''), { timeout: 20_000 }).toBe('Choisir mon offre');
    await plusTard(p);
    expect(net(await p.locator('#lic-banner .abo-t').innerText())).toBe('Essai : encore 5 jours');
    await cliquer(p.locator('#abo-accueil-go'));
    // Les offres en haut de l'écran : le même bouton n'attend pas un second clic en haut de l'onglet.
    const haut = () => p.locator('#abo-offres').evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => 9999);
    await expect.poll(haut, { timeout: 15_000 }).toBeLessThan(80);
    expect(await haut()).toBeGreaterThanOrEqual(-2);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);

  it('au téléphone, la carte d\'Essentiel avec la paie ne déborde pas, et la prochaine facture dit ce qu\'elle compte', async () => {
    const yosr = await personne('Yosr');
    const ent = String((await api('POST', '/entreprises', yosr.jeton, { raisonSociale: 'Atelier Couture Bardo' })).corps.id);
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 200, paye_jusqu_au = $2::date + 150, offre = 'essentiel', periodicite = 'annuel',
      modules = '{paie}' where entreprise = $1`, [ent, jour]);
    const cx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, yosr.jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    await cliquer(p.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => p.locator('#abo-prochaine').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('(Essentiel à l\'année, avec la paie)');
    // Le long libellé « Ouvrir la comptabilité complète maintenant… » passe à la ligne : la carte garde sa largeur. On
    // mesure chaque bouton contre le contenu de sa carte : un bouton qui ne passe pas à la ligne mord sur la marge
    // intérieure et vient toucher le bord, sans que la carte elle-même déborde.
    const debord = await p.locator('[data-offre]').evaluateAll((l) => l.map((c) => {
      const s = getComputedStyle(c);
      const px = (v: string) => Number(v.replace('px', ''));
      const fin = c.getBoundingClientRect().right - px(s.paddingRight) - px(s.borderRightWidth);
      return [c.scrollWidth - c.clientWidth, ...[...c.querySelectorAll('.btn')].map((b) => Math.max(0, Math.round(b.getBoundingClientRect().right - fin)))];
    }));
    expect(debord.flat().length).toBeGreaterThan(2);
    expect(debord.flat().every((x) => x === 0)).toBe(true);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'abonnement-au-choix-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
