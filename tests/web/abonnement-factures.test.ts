// « Tes factures », à la souris (14b, seconde partie ; docs/abonnement.md B5), avec un Konnect simulé
// (tests/konnect-simule.ts). Amira, de la direction de SkanFact, a préparé dans la console la facture du mois de la
// Librairie, et l'a émise dans l'application de SkanFact, dont le Konnect est branché. Walid, propriétaire de la
// librairie, dans SON application :
//   - « Ton abonnement » : la facture qui doit encore passe juste sous l'état, avec son état et « Payer … en ligne » ;
//   - « Voir » la montre telle qu'elle s'imprime ; « Payer 47,410 DT en ligne » l'emmène chez Konnect, pour ce montant,
//     sur le portefeuille de SkanFact ; il paie ;
//   - la page de retour dit « Paiement reçu » et le ramène à « Ton abonnement », qui s'ouvre tout seul : l'abonnement est
//     payé jusqu'à la fin de la période de la facture, la facture « Payée », et l'histoire la nomme.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { jourEnFrancais, plusJours, plusMois } from '../../serveur/abonnement/etat.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { konnectSimule } from '../konnect-simule.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('« Tes factures », à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let konnect: Awaited<ReturnType<typeof konnectSimule>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-abonnement-factures-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    konnect = await konnectSimule();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_KONNECT: konnect.base }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await konnect?.fermer(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  type Objet = { collection: string; cle: string; rang: number | null; revision: number; contenu: Record<string, unknown> };
  const objets = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];

  it('Walid voit la facture de son abonnement, la paie en ligne, et revient sur son abonnement payé', async () => {
    const jour = aujourdhuiATunis();
    // ── Amira : sa session de l'application (avec son code), et celle de la console (la direction) ───────────────────────
    const email = `amira-factures-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Ben Salem', motDePasse: MDP });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const c = await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const amira = String((await api('POST', '/connexion/code', undefined, { defi: c.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    await ajouterALEquipe(admin, email, 'direction', 'mise en place des essais');
    const k = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    const console = String((await api('POST', '/console/connexion/code', undefined, { defi: k.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    // ── L'entreprise SkanFact : Amira l'ouvre, la désigne, y branche Konnect ───────────────────────────────────────────
    const editeur = String((await api('POST', '/entreprises', amira, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
    await objets(editeur, amira);
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    expect((await api('POST', '/console/reglages/factures/editeur', console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    expect((await api('PUT', `/entreprises/${editeur}/paiement-en-ligne`, amira, { portefeuille: 'portefeuille-skanfact', cle: 'sk_test_cle-konnect-de-skanfact-9a1e' })).statut).toBe(200);
    // ── La Librairie : son essai finit dans trois jours ; Amira prépare sa facture du mois et l'émet ────────────────────
    const walidEmail = `walid-factures-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: walidEmail, nom: 'Walid Kitab', motDePasse: MDP });
    const walid = String((await api('POST', '/connexion', undefined, { email: walidEmail, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', walid, { raisonSociale: 'Librairie Al Kitab' })).corps.id);
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 3 where entreprise = $1', [ent, jour]);
    expect((await api('POST', `/console/entreprises/${ent}/factures`, console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Fin d\'essai : abonnement mensuel' })).statut).toBe(201);
    const debut = plusJours(jour, 4);
    const fin = plusJours(plusMois(debut, 1), -1);
    const lu = await objets(editeur, amira);
    const brouillon = lu.find((o) => o.collection === 'documents' && o.cle === `abonnement-${ent}-${debut}`);
    const client = lu.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
    const emise = await api('POST', `/entreprises/${editeur}/dossier-v10/emettre`, amira, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' });
    expect(emise.statut, JSON.stringify(emise.corps)).toBe(200);
    const numero = String(emise.corps.numero);

    // ── Walid, dans son application : « Ton abonnement » ─────────────────────────────────────────────────────────────
    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', x); }, walid);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    await cliquer(p.locator('#set-tabs [data-tab="abonnement"]'));
    const ligne = p.locator('#abo-factures .abo-facture').first();
    await expect.poll(() => ligne.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain(`Facture ${numero}`);
    expect(net(await ligne.innerText())).toContain(`Essentiel au mois · du ${jourEnFrancais(debut)} au ${jourEnFrancais(fin)}`);
    expect(net(await ligne.locator('.abo-fa-etat').innerText())).toBe('À payer');
    // Elle doit encore : elle passe juste sous l'état, avant les offres ; son paiement est le seul vert de l'onglet.
    expect(await p.locator('#abonnement-panel .abo > *').evaluateAll((e) => e.map((x) => x.id || x.className))).toEqual(expect.arrayContaining(['abo-etat', 'abo-factures']));
    expect(await p.locator('#abonnement-panel .abo > *').evaluateAll((e) => e.findIndex((x) => x.id === 'abo-factures'))).toBe(1);
    expect((await p.locator('#abonnement-panel .btn-primary').allInnerTexts()).map(net)).toEqual(['Payer 47,410 DT en ligne']);
    await p.screenshot({ animations: 'disabled', fullPage: true, path: path.join(PHOTOS, 'abonnement-factures-1-a-payer.png') });

    // « Voir » : la facture telle qu'elle s'imprime, le reste, et « Payer en ligne ».
    await cliquer(ligne.getByRole('button', { name: 'Voir', exact: true }));
    const cadre = p.locator('#abonnement-panel iframe.abo-piece');
    await expect.poll(() => cadre.count(), { timeout: 10_000 }).toBe(1);
    const piece = String(await cadre.getAttribute('srcdoc'));
    for (const t of [numero, 'Librairie Al Kitab', 'SkanFact Éditions SARL', '47,410']) expect(piece).toContain(t);
    expect(net(await p.locator('.abo-piece-reste').innerText())).toBe('Reste à payer : 47,410 DT');

    // ── Il paie chez Konnect, sur le portefeuille de SkanFact, ce que la facture doit ─────────────────────────────────────
    await cliquer(p.getByRole('button', { name: 'Payer 47,410 DT en ligne', exact: true }));
    await p.waitForURL(/\/payer\//, { timeout: 15_000 });
    const demande = [...konnect.paiements.values()].find((x) => x.portefeuille === 'portefeuille-skanfact');
    expect(demande).toMatchObject({ montant: 47410, devise: 'TND' });
    await cliquer(p.getByRole('button', { name: 'Payer (simulation)' }));
    await p.waitForURL(/\/espace\/retour\.html/, { timeout: 15_000 });
    await expect.poll(() => p.locator('h1').innerText().catch(() => ''), { timeout: 15_000 }).toBe('Paiement reçu');
    expect(net(await p.locator('#retour').innerText())).toContain(`Merci ! La facture ${numero} est réglée.`);
    expect(net(await p.locator('#retour .r-montant').innerText())).toMatch(/^Montant 47,410 DT$/i);

    // ── Il revient : « Ton abonnement » s'ouvre tout seul, payé jusqu'à la fin de la période ─────────────────────────────
    await cliquer(p.getByRole('link', { name: 'Revenir à ton abonnement' }));
    await expect.poll(() => p.locator('#abonnement-panel .abo-tete h3').innerText().then(net).catch(() => ''), { timeout: 20_000 }).toBe(`Payé jusqu'au ${jourEnFrancais(fin)}`);
    expect(await p.locator('#set-tabs [data-tab="abonnement"]').getAttribute('class')).toMatch(/\bactive\b/);
    expect(net(await p.locator('#abo-factures .abo-fa-etat').first().innerText())).toBe('Payée');
    expect(await p.locator('#abonnement-panel .btn-primary').count()).toBe(0);
    expect(net(await p.locator('.abo-histoire').innerText())).toContain(`Paiement reçu (Essentiel, jusqu'au ${jourEnFrancais(fin)}, facture ${numero})`);
    const ligneAbo = (await admin.query('select paye_jusqu_au::text paye from plateforme.abonnement where entreprise = $1', [ent])).rows[0] as { paye: string };
    expect(ligneAbo.paye).toBe(fin);
    await p.screenshot({ animations: 'disabled', fullPage: true, path: path.join(PHOTOS, 'abonnement-factures-2-payee.png') });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
