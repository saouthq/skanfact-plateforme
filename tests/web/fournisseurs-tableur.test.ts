// Les fournisseurs repris d'un tableur, à la souris (docs/reprise-fiches.md ; web/v10/reprise-fiches.txt). Nadia arrive d'un
// autre logiciel avec la liste de ses fournisseurs, exportée en CSV (points-virgules, comme Excel en français). Ce que le
// parcours vérifie, écran ET serveur :
//   - la page des fournisseurs, vide, propose « Importer depuis un tableur » ;
//   - l'aperçu reconnaît les colonnes (banque et RIB compris), compte ce qui entre, et dit avant le clic ce qui est à
//     relire (un RIB qui n'a pas vingt chiffres) ;
//   - « Importer 3 fournisseurs » : le serveur a les trois fiches, champ par champ ; « Annuler » les retire toutes, au
//     serveur aussi.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les fournisseurs repris d\'un tableur, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-fournisseurs-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();

  it('Nadia importe ses fournisseurs depuis un CSV, puis annule : le serveur suit chaque geste', async () => {
    const email = `nadia-fournisseurs-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/fournisseurs`);
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 20_000 }).toBe('Fournisseurs');
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    // La page vide propose l'import, à côté de la première fiche.
    await expect.poll(async () => net(await p.locator('#view').innerText())).toMatch(/Ta liste est déjà dans un tableur ou dans ton ancien logiciel \? Colle-la : tous tes fournisseurs entrent d.un coup\./);
    await p.locator('#vide-import-f').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').first().innerText()).toMatch(/^Importer mes fournisseurs/);

    const fichier = path.join(dossier, 'fournisseurs.csv');
    fs.writeFileSync(fichier, Buffer.from([
      'Nom;Matricule fiscal;Téléphone;Courriel;Banque;RIB;Adresse;Ville',
      'Papeterie du Lac;1234567A/A/M/000;71 234 567;compta@papeterie.tn;BIAT;08 006 0123456789012 34;Rue du Lac;Tunis',
      'Transports Ben Ali;7654321B/P/M/000;74 000 111;;STB;12345;Route de Gabès km 2;Sfax',
      'Imprimerie Nour;;73 222 333;nour@imprimerie.tn;Attijari;04 018 0000123456789 01;;Sousse',
    ].join('\r\n'), 'utf8'));
    const selecteur = p.waitForEvent('filechooser');
    await fenetre.locator('#imp-fichier').click();
    await (await selecteur).setFiles(fichier);
    await expect.poll(async () => net(await fenetre.locator('#imp-lu').innerText())).toBe('Lu dans « fournisseurs.csv »');
    const colonnes = await fenetre.locator('#imp-apercu select[data-col]').evaluateAll((s) => s.map((x) => (x as HTMLSelectElement).value));
    expect(colonnes).toEqual(['name', 'matricule', 'phone', 'email', 'bank', 'rib', 'address', 'complement']);
    expect(net(await fenetre.locator('.imp-bilan').innerText())).toBe('3 nouveaux fournisseurs');
    expect(net(await fenetre.locator('.imp-notes').innerText())).toBe('Ligne 3 (Transports Ben Ali) : le RIB « 12345 » n\'a pas les vingt chiffres d\'un RIB tunisien : relis-le avant le premier virement.');
    expect(net(await fenetre.locator('#imp-ok').innerText())).toBe('Importer 3 fournisseurs');
    await p.screenshot({ path: path.join(PHOTOS, 'fournisseurs-tableur-1-apercu.png') });
    await fenetre.locator('#imp-ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/^3 fournisseurs importés/);

    // Le serveur a les trois fiches, champ par champ.
    const fournisseurs = async () => (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'suppliers'`, [ent])).rows
      .map((x: { contenu: Record<string, unknown> }) => [x.contenu.name, x.contenu.matricule, x.contenu.phone, x.contenu.email, x.contenu.bank, x.contenu.rib, x.contenu.address])
      .sort((a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0])));
    await expect.poll(fournisseurs, { timeout: 15_000 }).toEqual([
      ['Imprimerie Nour', '', '73 222 333', 'nour@imprimerie.tn', 'Attijari', '04 018 0000123456789 01', 'Sousse'],
      ['Papeterie du Lac', '1234567A/A/M/000', '71 234 567', 'compta@papeterie.tn', 'BIAT', '08 006 0123456789012 34', 'Rue du Lac\nTunis'],
      ['Transports Ben Ali', '7654321B/P/M/000', '74 000 111', '', 'STB', '12345', 'Route de Gabès km 2\nSfax'],
    ]);
    await expect.poll(async () => net(await p.locator('#view').innerText())).toMatch(/Transports Ben Ali/);
    await p.screenshot({ path: path.join(PHOTOS, 'fournisseurs-tableur-2-liste.png') });

    // « Annuler » les retire toutes, au serveur aussi.
    await p.locator('#toast-undo').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Import annulé : rien n\'a changé.');
    await expect.poll(fournisseurs, { timeout: 15_000 }).toEqual([]);
    await expect.poll(async () => net(await p.locator('#view').innerText())).not.toMatch(/Transports Ben Ali/);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
