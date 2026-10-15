// « Paiements », à la souris (docs/console.md C30 ; serveur/console/paiements.ts ; web/console/src/ecrans/Paiements.tsx).
// Ce que le parcours vérifie :
//   - l'entrée « Paiements » de la barre n'existe que pour la direction ; le support ne voit ni elle ni la tuile ;
//   - la tuile « encaissé ce mois » de l'accueil et le bandeau de l'écran disent le même montant, et la tuile y mène ;
//   - une facture qui doit encore dit son reste et ce qui est déjà reçu ; son bouton ouvre SA pièce dans SkanFact, à côté ;
//   - un coût se saisit d'après la facture reçue : une case refusée se montre ; saisi, ce qui reste du mois se dit ;
//     retiré avec son motif, il reste visible, barré ;
//   - passer d'un mois à l'autre ne déplace pas les boutons sous la souris ; au téléphone, rien ne déborde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('les paiements de nos factures, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-paiements-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-paiements-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jD = '', jApp = '', jS = '', editeur = '', abonne = '', cle = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const membre = async (nom: string, role: 'direction' | 'support') => {
    const email = `console-paiements-${role}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai des paiements à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    return { appli: jeton, console: String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton) };
  };
  const ouvrir = async (jeton: string, hash: string, largeur = 1440, hauteur = 900) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${hash}`);
    await expect.poll(() => p.locator('.c-cote, .c-entete').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const dossierV10 = async () => (await api('GET', `/entreprises/${editeur}/dossier-v10`, jApp)).corps.objets as { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number }[];

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const d = await membre('Amira Paiements', 'direction');
    jD = d.console; jApp = d.appli;
    jS = (await membre('Karim Paiements', 'support')).console;
    // L'entreprise SkanFact de ce parcours, et une abonnée dont la facture d'un mois est émise puis réglée en partie.
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    editeur = String((await api('POST', '/entreprises', jApp, { raisonSociale: 'SkanFact Paiements SARL' })).corps.id);
    expect((await api('POST', '/console/reglages/factures/editeur', jD, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    const email = `client-paiements-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Lina Paiements', motDePasse: MDP });
    const jC = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    abonne = String((await api('POST', '/entreprises', jC, { raisonSociale: 'Atelier Lina Paiements' })).corps.id);
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 3 where entreprise = $1', [abonne, aujourdhuiATunis()]);
    expect((await api('POST', `/console/entreprises/${abonne}/factures`, jD, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    let objets = await dossierV10();
    const brouillon = objets.find((o) => o.collection === 'documents' && o.cle.startsWith(`abonnement-${abonne}-`));
    const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
    cle = brouillon?.cle ?? '';
    expect((await api('POST', `/entreprises/${editeur}/dossier-v10/emettre`, jApp, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' })).statut).toBe(200);
    objets = await dossierV10();
    const e = objets.find((o) => o.collection === 'documents' && o.cle === cle);
    expect((await api('POST', `/entreprises/${editeur}/dossier-v10`, jApp, { changements: [{ collection: 'documents', cle, rang: e?.rang ?? null, revision: e?.revision,
      contenu: { ...e?.contenu, payments: [{ id: 'v1', date: aujourdhuiATunis(), amount: 20, method: 'virement' }] } }] })).statut).toBe(200);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('la direction seule : le support n\'a ni l\'entrée « Paiements » ni la tuile de l\'encaissé', async () => {
    const s = await ouvrir(jS, '#/');
    await expect.poll(() => s.locator('.c-tuile').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    expect((await s.locator('.c-nav a').allInnerTexts()).map(net)).not.toContain('Paiements');
    expect(await s.locator('.c-tuile-titre').evaluateAll((e) => e.map((x) => (x.textContent ?? '').trim().toLowerCase()))).not.toContain('encaissé ce mois');
    await fermer(s);
  }, 60_000);

  it('la tuile de l\'accueil et le bandeau disent le même encaissé ; la facture qui doit encore mène à sa pièce', async () => {
    const p = await ouvrir(jD, '#/');
    const tuile = p.locator('a.c-tuile[href="#/paiements"]');
    await expect.poll(() => tuile.count(), { timeout: 15_000 }).toBe(1);
    const dansLaTuile = net(await tuile.locator('.c-tuile-valeur').innerText());
    expect(dansLaTuile).toMatch(/^\d[\d ]*,\d{3} DT$/);
    await cliquer(tuile);
    await expect.poll(() => p.locator('.c-pa-bande-total').count(), { timeout: 15_000 }).toBe(1);
    expect(net(await p.locator('.c-pa-bande-total').innerText())).toBe(dansLaTuile);
    // L'abonnée doit encore 27,410 : 20 déjà reçus sur 47,410 ; son bouton est l'étape suivante, et ouvre SA pièce à côté.
    const ligne = p.locator('.c-pa-ligne', { hasText: 'Atelier Lina Paiements' });
    expect(net(await ligne.locator('.c-pa-montant b').innerText())).toBe('27,410 DT');
    expect(net(await ligne.locator('.c-pa-etat').innerText())).toContain('20,000 DT déjà reçus, sur 47,410 DT');
    const noter = ligne.getByRole('link', { name: /noter le règlement/i });
    expect(await noter.getAttribute('href')).toBe(`/v10/?e=${editeur}#/doc/${cle}`);
    expect(await noter.getAttribute('target')).toBe('_blank');
    // Le virement du jour est dans les règlements du mois.
    expect(net(await p.locator('.c-pa-recu', { hasText: 'Atelier Lina Paiements' }).innerText())).toMatch(/20,000 DT Virement$/);
    // Ce qui doit rentrer (C55) : trois mois, le mois en cours d'abord ; chaque case dit le chiffre du serveur, et les
    // factures (TTC) et les renouvellements (HT) restent deux colonnes.
    const carte = p.locator('section[aria-labelledby="pa-prev"]');
    expect(net(await carte.locator('h2').innerText())).toBe('Ce qui doit rentrer');
    const prev = (await api('GET', '/console/paiements', jD)).corps.previsions as { mois: { du: { montant: string }; attendu: { montantHt: string } }[] };
    const enDT = (t: string) => { const [e = '0', d = ''] = t.split('.'); return `${e.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d.padEnd(3, '0')} DT`; };
    const lignes = carte.locator('tbody tr');
    expect(await lignes.count()).toBe(3);
    expect(net(await lignes.first().locator('th').innerText())).toMatch(/en cours$/);
    for (const [i, m] of prev.mois.entries()) {
      const cases = lignes.nth(i).locator('td');
      expect(net(await cases.nth(0).locator('b').innerText())).toBe(enDT(m.du.montant));
      expect(net(await cases.nth(1).locator('b').innerText())).toBe(enDT(m.attendu.montantHt));
    }
    expect(net(await carte.locator('thead').innerText())).toMatch(/Factures émises Renouvellements/i);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('un coût : la case refusée se montre ; saisi, ce qui reste du mois se dit ; retiré, il reste barré', async () => {
    const p = await ouvrir(jD, '#/paiements');
    await expect.poll(() => p.locator('.c-pa-couts').count(), { timeout: 15_000 }).toBe(1);
    const couts = p.locator('.c-pa-couts');
    const avant = await couts.locator('.c-pa-couts-liste li').count();
    await cliquer(couts.getByRole('button', { name: 'Ajouter un coût…' }));
    const f = p.locator('[role="dialog"]');
    await f.getByLabel('Le coût').fill('Serveurs en Tunisie');
    await f.getByLabel('Montant payé, en dinars').fill('1 450,500');
    await cliquer(f.getByRole('button', { name: 'Ajouter le coût', exact: true }));
    // Sans la facture reçue : refusé sur sa case, et la phrase le dit.
    await expect.poll(() => f.getByLabel('D\'après quelle facture').getAttribute('aria-invalid')).toBe('true');
    expect(net(await f.locator('.c-alerte').last().innerText())).toBe('Dis d\'après quelle facture reçue (le fournisseur, son numéro) : trois caractères au moins.');
    await f.getByLabel('D\'après quelle facture').fill('Facture Hébergeur TN n° 118');
    await cliquer(f.getByRole('button', { name: 'Ajouter le coût', exact: true }));
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => couts.locator('.c-pa-couts-liste li').count(), { timeout: 10_000 }).toBe(avant + 1);
    const ligne = couts.locator('.c-pa-couts-liste li', { hasText: 'Serveurs en Tunisie' }).last();
    expect(net(await ligne.innerText())).toBe('Serveurs en Tunisie 1 450,500 DT d\'après Facture Hébergeur TN n° 118 Retirer');
    // Ce qui reste : l'encaissé moins les coûts, et la phrase dit les deux ; le mois court encore, le chiffre est provisoire.
    expect(net(await couts.locator('.c-pa-reste').innerText())).toMatch(/^Ce qui reste en \S+ Provisoire −?[\d ]+,\d{3} DT Encaissé [\d ]+,\d{3} DT, moins les coûts [\d ]+,\d{3} DT\./);
    // Retiré : avec son motif ; il quitte le total et reste visible, barré.
    await cliquer(ligne.getByRole('button', { name: /^Retirer le coût \W+Serveurs en Tunisie\W+$/ }));
    const r = p.locator('[role="dialog"]');
    await r.locator('textarea').fill('Mauvais montant');
    await cliquer(r.getByRole('button', { name: 'Retirer le coût', exact: true }));
    await expect.poll(() => r.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => couts.locator('.c-pa-couts-liste li').count(), { timeout: 10_000 }).toBe(avant);
    await cliquer(couts.locator('.c-pa-retires summary'));
    expect(net(await couts.locator('.c-pa-retires').innerText())).toMatch(/Serveurs en Tunisie 1 450,500 DT retiré par Amira Paiements, le \d\d\/\d\d\/\d{4}/);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('une contestation (0129) : le support la note depuis la ligne de sa facture ; la direction la lit dans Paiements et la régularise par un avoir, avec sa référence', async () => {
    const f = await ouvrir(jS, `#/clients/${abonne}?onglet=factures`);
    const ligne = f.locator('.c-fa-table tbody tr').first();
    await expect.poll(() => ligne.locator('.c-mono').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/\S/);
    const numero = net(await ligne.locator('.c-mono').innerText());
    await cliquer(ligne.getByRole('button', { name: `Gestes sur la facture ${numero}`, exact: true }));
    await cliquer(f.locator('.c-menu-liste button', { hasText: 'Noter une contestation' }));
    const noter = f.getByRole('dialog');
    await expect.poll(() => noter.count()).toBe(1);
    await cliquer(noter.getByRole('radio', { name: 'WhatsApp', exact: true }));
    // Sans ce que le client conteste : refusé sur le champ, le curseur y va.
    await cliquer(noter.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => noter.locator('.c-alerte-danger').innerText().then(net).catch(() => '')).toContain('trois caractères au moins');
    expect(await f.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
    await noter.getByLabel('Ce que le client conteste', { exact: true }).fill('Je n\'ai jamais choisi Essentiel');
    await cliquer(noter.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => f.locator('#c-toast').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe(`Contestation de ${numero} notée.`);
    await expect.poll(() => ligne.locator('.c-ct-en-cours').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toMatch(/^Contestée le \d{2}\/\d{2}\/\d{4} par WhatsApp : elle attend sa régularisation$/);
    await fermer(f);

    const p = await ouvrir(jD, '#/paiements');
    const section = p.locator('section[aria-labelledby="pa-contestations"]');
    await expect.poll(() => section.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('« Je n\'ai jamais choisi Essentiel »');
    const l = section.locator('.c-pa-ligne', { hasText: 'Atelier Lina Paiements' });
    await cliquer(l.getByRole('button', { name: 'Régulariser…', exact: true }));
    const reg = p.getByRole('dialog');
    await cliquer(reg.getByRole('radio', { name: 'Par un avoir', exact: true }));
    expect(net(await reg.locator('.c-dialogue-pied .c-btn-principal').innerText())).toBe('Clore par l\'avoir');
    // Un avoir sans son numéro : refusé, le champ montré.
    await cliquer(reg.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => reg.locator('.c-alerte-danger').innerText().then(net).catch(() => '')).toContain('numéro de l\'avoir');
    await reg.getByLabel('Le numéro de l\'avoir', { exact: true }).fill('AV-2026-0042');
    await reg.getByLabel('Motif', { exact: true }).fill('Essentiel jamais choisi : avoir émis');
    await cliquer(reg.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => p.locator('#c-toast').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe(`Contestation de ${numero} régularisée par l'avoir.`);
    await expect.poll(() => l.innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('par l\'avoir AV\u20112026\u20110042'); // des tirets insécables : la référence ne se coupe pas
    expect(await l.getByRole('button', { name: 'Régulariser…', exact: true }).count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('d\'un mois à l\'autre, les boutons ne bougent pas sous la souris ; au téléphone, rien ne déborde', async () => {
    const p = await ouvrir(jD, '#/paiements');
    await expect.poll(() => p.locator('.c-mois').count(), { timeout: 15_000 }).toBe(1);
    const avant = p.locator('.c-mois button').first();
    const ou = await avant.boundingBox();
    await cliquer(avant);
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(/^#\/paiements\?mois=\d{4}-\d{2}$/);
    await expect.poll(() => p.locator('.c-pa-bande h2').innerText().then(net), { timeout: 10_000 }).not.toMatch(/, AU \d+$/i);
    expect(await avant.boundingBox()).toEqual(ou);
    await cliquer(avant);
    expect(await avant.boundingBox()).toEqual(ou);
    await fermer(p);
    const t = await ouvrir(jD, '#/paiements', 390, 800);
    await expect.poll(() => t.locator('.c-pa-couts').count(), { timeout: 15_000 }).toBe(1);
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(erreurs).toEqual([]);
    await fermer(t);
  }, 60_000);
});
