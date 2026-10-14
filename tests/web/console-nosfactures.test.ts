// « Nos factures », à la souris (docs/console.md C31 ; serveur/console/nosfactures.ts ; web/console/src/ecrans/NosFactures.tsx).
// Ce que le parcours vérifie :
//   - l'entrée « Nos factures » de la barre n'existe que pour la direction ;
//   - une facture refusée par la TTN vient en tête, avec ce que la TTN a répondu ; son bouton, le seul principal de
//     l'écran, ouvre SA pièce dans SkanFact, à côté ;
//   - une pièce sans fichier de facture électronique le dit, avec la raison et le lien vers la fiche de l'entreprise
//     SkanFact ;
//   - chaque filtre montre autant de lignes que sa pastille en compte, et se garde dans l'adresse ;
//   - un mois sans pièce ne dit qu'une chose ; au téléphone, rien ne déborde et les noms des colonnes s'effacent.

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
import { versionTeif } from '../../serveur/v10/teif.ts';
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('nos factures, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-nosfactures-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-nosfactures-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jD = '', jApp = '', jS = '', editeur = '';
  const refusee = { cle: '', numero: '' };

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const membre = async (nom: string, role: 'direction' | 'support') => {
    const email = `console-nosfactures-${role}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai de nos factures à la souris');
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
  // Une abonnée, et la facture d'un mois de son abonnement préparée puis émise dans SkanFact.
  const factureEmise = async (nom: string) => {
    const email = `client-nosfactures-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: `Proprio ${nom}`, motDePasse: MDP });
    const jC = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jC, { raisonSociale: nom })).corps.id);
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 3 where entreprise = $1', [ent, aujourdhuiATunis()]);
    expect((await api('POST', `/console/entreprises/${ent}/factures`, jD, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    const objets = await dossierV10();
    const brouillon = objets.find((o) => o.collection === 'documents' && o.cle.startsWith(`abonnement-${ent}-`));
    const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
    expect((await api('POST', `/entreprises/${editeur}/dossier-v10/emettre`, jApp, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' })).statut).toBe(200);
    const cle = brouillon?.cle ?? '';
    const p = (await admin.query("select id, numero_texte from ventes.piece where entreprise = $1 and ref_v10 = $2 and type = 'facture'", [editeur, cle])).rows[0];
    return { cle, piece: String(p.id), numero: String(p.numero_texte) };
  };

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const d = await membre('Amira Factures', 'direction');
    jD = d.console; jApp = d.appli;
    jS = (await membre('Karim Factures', 'support')).console;
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    editeur = String((await api('POST', '/entreprises', jApp, { raisonSociale: 'SkanFact Factures SARL' })).corps.id);
    expect((await api('POST', '/console/reglages/factures/editeur', jD, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    // Deux factures : l'une sans fichier (la fiche ne le permet pas), l'autre écrite, signée, déposée puis refusée par la
    // TTN — posées par la base comme l'émission, la signature et le dépôt l'écrivent (0049 à 0051).
    await factureEmise('Atelier Sans Fichier');
    const r = await factureEmise('Fromagerie Refusée');
    Object.assign(refusee, { cle: r.cle, numero: r.numero });
    const uid = (await admin.query('select utilisateur from socle.membre where entreprise = $1 limit 1', [editeur])).rows[0].utilisateur;
    await admin.query(`insert into ventes.efacture (piece, entreprise, nom, xml, empreinte, version, ecrit_le, ecrit_par)
      values ($1, $2, 'TEIF_refusee.xml', '<TEIF/>', $3, $4, now(), $5)`, [r.piece, editeur, 'a'.repeat(64), versionTeif(), uid]);
    const demande = (await admin.query(`insert into ventes.signature_demande (entreprise, pieces, identifiant, session, statut, cree_le, cree_par)
      values ($1, $2, 'essai', 'essai', 'signee', now(), $3) returning id`, [editeur, [r.piece], uid])).rows[0].id;
    await admin.query(`insert into ventes.efacture_signee (piece, entreprise, xml, empreinte, demande, signe_le, signe_par)
      values ($1, $2, '<TEIF/>', $3, $4, now(), $5)`, [r.piece, editeur, 'b'.repeat(64), demande, uid]);
    await admin.query(`insert into ventes.envoi_ttn (piece, entreprise, statut, prochain_essai, depose_le, motif, cree_le, cree_par)
      values ($1, $2, 'refusee', now(), now(), $3, now(), $4)`, [r.piece, editeur, JSON.stringify({ cle: 'ttn.refusee', valeurs: { accuses: 'E12 : matricule fiscal de l\'acheteur non reconnu' } }), uid]);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('la direction seule : le support n\'a pas l\'entrée « Nos factures »', async () => {
    const s = await ouvrir(jS, '#/');
    await expect.poll(() => s.locator('.c-nav a').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    expect((await s.locator('.c-nav a').allInnerTexts()).map(net)).not.toContain('Nos factures');
    await fermer(s);
  }, 60_000);

  it('la refusée en tête, avec la réponse de la TTN et le seul bouton principal ; la pièce sans fichier dit pourquoi', async () => {
    const p = await ouvrir(jD, '#/');
    await cliquer(p.locator('.c-nav a', { hasText: 'Nos factures' }));
    await expect.poll(() => p.locator('.c-nf-resume').count(), { timeout: 15_000 }).toBe(1);
    expect(net(await p.locator('.c-nf-resume').innerText())).toMatch(/2 factures MONTANT ÉMIS 94,820 DT reste à encaisser : 94,820 DT LA TTN Une sans fichier de facture électronique · une refusée$/i);
    const refus = p.locator('.c-nf-refus');
    expect(await refus.count()).toBe(1);
    expect(net(await refus.innerText())).toContain(`${refusee.numero} refusée par la TTN`);
    expect(net(await refus.locator('.c-nf-refus-motif').innerText())).toBe('La TTN répond : E12 : matricule fiscal de l\'acheteur non reconnu');
    // Le seul bouton principal de l'écran : ouvrir SA facture dans SkanFact, à côté.
    const principal = p.locator('main .c-btn-principal');
    expect(await principal.count()).toBe(1);
    expect(await principal.getAttribute('href')).toBe(`/v10/?e=${editeur}#/doc/${encodeURIComponent(refusee.cle)}`);
    expect(await principal.getAttribute('target')).toBe('_blank');
    // La pièce sans fichier : la raison, et le lien vers la fiche de l'entreprise SkanFact (pas principal : la refusée passe avant).
    const sansFichier = p.locator('.c-alerte', { hasText: 'sans fichier de facture électronique' });
    expect(net(await sansFichier.innerText())).toMatch(/^Une pièce sans fichier de facture électronique : la TTN ne l'a pas reçue\. La fiche de l'entreprise SkanFact ne la dit pas soumise/);
    expect(await sansFichier.getByRole('link', { name: 'Ouvrir sa fiche dans SkanFact' }).getAttribute('href')).toBe(`/v10/?e=${editeur}#/parametres`);
    // Les noms des colonnes, au-dessus des lignes.
    expect(net(await p.locator('.c-nf-entete').innerText())).toBe('PIÈCE CLIENT ET PÉRIODE MONTANT TTN PAIEMENT');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('chaque filtre montre autant de lignes que sa pastille en compte, et se garde dans l\'adresse', async () => {
    const p = await ouvrir(jD, '#/nos-factures');
    await expect.poll(() => p.locator('.c-nf-lignes > li').count(), { timeout: 15_000 }).toBe(2);
    for (const pastille of await p.locator('.c-pilules .c-pilule').all()) {
      const compte = Number(net(await pastille.locator('.c-pilule-n').innerText()));
      await cliquer(pastille);
      await expect.poll(() => pastille.getAttribute('aria-pressed')).toBe('true');
      await expect.poll(() => p.locator('.c-nf-lignes > li').count(), { timeout: 10_000 }).toBe(compte);
    }
    // Le dernier choisi (pas encore payées) se lit dans l'adresse, et une adresse ouverte le rouvre.
    expect(await p.evaluate(() => location.hash)).toBe('#/nos-factures?filtre=non_payees');
    await p.goto(`${serveur.adresse}/console/#/nos-factures?filtre=refusees`);
    await expect.poll(() => p.locator('.c-nf-lignes > li').allInnerTexts().then((t) => t.map(net)), { timeout: 15_000 })
      .toEqual([expect.stringContaining(refusee.numero)]);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('à une fenêtre basse, seule la liste de la barre défile : la carte de la personne et « Se déconnecter » restent visibles', async () => {
    const p = await ouvrir(jD, '#/nos-factures', 1280, 600);
    await expect.poll(() => p.locator('.c-moi-sortir').count(), { timeout: 15_000 }).toBe(1);
    const sortir = await p.locator('.c-moi-sortir').boundingBox();
    expect(sortir).not.toBeNull();
    expect((sortir?.y ?? 9999) + (sortir?.height ?? 0)).toBeLessThanOrEqual(600);
    // La liste défile, elle : son dernier écran s'atteint.
    const journal = p.locator('.c-nav a', { hasText: 'Journal' });
    await journal.scrollIntoViewIfNeeded();
    const j = await journal.boundingBox();
    expect((j?.y ?? 9999) + (j?.height ?? 0)).toBeLessThanOrEqual((await p.locator('.c-moi').boundingBox())?.y ?? 0);
    await fermer(p);
  }, 60_000);

  it('un mois sans pièce ne dit qu\'une chose ; au téléphone, rien ne déborde et les noms des colonnes s\'effacent', async () => {
    const p = await ouvrir(jD, '#/nos-factures');
    await expect.poll(() => p.locator('.c-mois').count(), { timeout: 15_000 }).toBe(1);
    await cliquer(p.locator('.c-mois button').first());
    await expect.poll(() => p.locator('.c-vide').count(), { timeout: 10_000 }).toBe(1);
    expect(await p.locator('.c-nf-resume, .c-pilules, .c-nf-pied, .c-nf-refus').count()).toBe(0);
    expect(net(await p.locator('.c-vide').innerText())).toMatch(/^Aucune facture émise en \S+ \d{4}\.$/);
    await fermer(p);
    const t = await ouvrir(jD, '#/nos-factures', 390, 800);
    await expect.poll(() => t.locator('.c-nf-lignes > li').count(), { timeout: 15_000 }).toBe(2);
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await t.locator('.c-nf-entete').isVisible()).toBe(false);
    expect(erreurs).toEqual([]);
    await fermer(t);
  }, 60_000);
});
