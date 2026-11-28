// « Ton abonnement » sans paiement en ligne (1.389.2 ; issue #29, CONS3-1) : une facture qui doit encore dit comment la
// régler — « les coordonnées de SkanFact sont sur la facture » seulement si le RIB de SkanFact y est. Avant, la phrase
// s'écrivait sans condition, et le client cherchait sur la facture un RIB qu'elle ne portait pas.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { konnectSimule } from '../konnect-simule.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('« Ton abonnement » : où virer', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let konnect: Awaited<ReturnType<typeof konnectSimule>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-abonnement-rib-'));
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

  it('sans paiement en ligne, « Ton abonnement » ne dit « les coordonnées sont sur la facture » que si le RIB de SkanFact y est', async () => {
    const jour = aujourdhuiATunis();
    // ── Amira : sa session de l'application (avec son code), et celle de la console (la direction) ───────────────────────
    const email = `amira-rib-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Ben Salem', motDePasse: MDP });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const c = await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const amira = String((await api('POST', '/connexion/code', undefined, { defi: c.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    await ajouterALEquipe(admin, email, 'direction', 'mise en place des essais');
    const k = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    const console = String((await api('POST', '/console/connexion/code', undefined, { defi: k.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    // ── L'entreprise SkanFact : Amira l'ouvre et la désigne — sans Konnect, et sans RIB à sa fiche ──────────────────────
    const editeur = String((await api('POST', '/entreprises', amira, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
    await objets(editeur, amira);
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    expect((await api('POST', '/console/reglages/factures/editeur', console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    // ── La Librairie : son essai finit dans trois jours ; Amira prépare sa facture du mois et l'émet ────────────────────
    const walidEmail = `walid-rib-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: walidEmail, nom: 'Walid Kitab', motDePasse: MDP });
    const walid = String((await api('POST', '/connexion', undefined, { email: walidEmail, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', walid, { raisonSociale: 'Librairie Al Kitab' })).corps.id);
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 3 where entreprise = $1', [ent, jour]);
    expect((await api('POST', `/console/entreprises/${ent}/factures`, console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Fin d\'essai : abonnement mensuel' })).statut).toBe(201);
    const debut = plusJours(jour, 4);
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

    // Sans RIB à la fiche de SkanFact, la facture n'en porte pas : la phrase ne promet pas des coordonnées absentes.
    const aide = ligne.locator('.abo-fa-aide');
    expect(net(await aide.innerText())).toContain('ne sont pas sur la facture');
    expect(net(await aide.innerText())).not.toContain('sont sur la facture.');
    // Le RIB posé à la fiche, la facture le porte : la phrase le dit.
    await admin.query(`update socle.dossier_v10 set contenu = contenu || '{"rib": "10006012345678901234"}'::jsonb where entreprise = $1 and collection = '_racine' and cle = 'company'`, [editeur]);
    await p.reload();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    await cliquer(p.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => p.locator('#abo-factures .abo-facture .abo-fa-aide').first().innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toBe('Règle-la par virement ou par chèque : les coordonnées de SkanFact sont sur la facture.');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
