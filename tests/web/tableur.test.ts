// Un classeur Excel s'importe dans l'entreprise, à la souris (brique 85 ; 14 § 2.3 : « un tableur : les colonnes
// sont reconnues par leur titre et leur contenu »). La fenêtre d'import de la v10 dit « Ouvrir un fichier Excel
// ou CSV… » : en ligne, un classeur Excel se refusait (« enregistre-le en CSV »), une phrase que rien ne tenait.
// Il se lit maintenant dans le navigateur, par le lecteur que l'entreprise partage avec le Cabinet
// (plateforme/tableur.js). Ce que le parcours vérifie, écran ET serveur :
//   - Nadia ouvre clients.xlsx : l'aperçu reconnaît les colonnes, « Importer » crée les trois fiches, et le
//     serveur les a, champ par champ ;
//   - un classeur qui gonfle (une « bombe »), un classeur LibreOffice, un faux classeur : chacun se refuse avec
//     sa phrase et le geste qui marche, sans rien importer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { classeur, zip } from '../classeur.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('un classeur Excel s\'importe dans l\'entreprise, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tableur-'));
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

  it('Nadia importe ses clients depuis un classeur Excel ; une bombe, un classeur LibreOffice ou un faux classeur se refusent avec leur phrase', async () => {
    const email = `nadia-tableur-${Date.now()}@exemple.tn`;
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
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 20_000 }).toBe('Clients');
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.locator('#imp-clients').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').first().innerText()).toMatch(/^Importer mes clients/);
    const ouvrir = async (nom: string, contenu: Buffer) => {
      const fichier = path.join(dossier, nom);
      fs.writeFileSync(fichier, contenu);
      const selecteur = p.waitForEvent('filechooser');
      await fenetre.locator('#imp-fichier').click();
      await (await selecteur).setFiles(fichier);
    };

    // Les refus d'abord : chacun dit ce qui ne va pas, et le geste qui marche ; rien n'est importé.
    await ouvrir('clients-bombe.xlsx', zip({ 'xl/worksheets/sheet1.xml': Buffer.alloc(21 * 1024 * 1024) }));
    await expect.poll(async () => net(await fenetre.locator('#imp-apercu').innerText())).toBe('Ce classeur est anormalement gros : refusé.');
    await ouvrir('clients.ods', zip({ 'content.xml': '<?xml version="1.0"?><office:document-content/>', 'mimetype': 'application/vnd.oasis.opendocument.spreadsheet' }));
    await expect.poll(async () => net(await fenetre.locator('#imp-apercu').innerText())).toMatch(/^« clients\.ods » est un classeur LibreOffice \(\.ods\)\. Dans LibreOffice : Fichier → Enregistrer sous…/);
    await ouvrir('faux.xlsx', Buffer.concat([Buffer.from('PK'), Buffer.alloc(200, 7)]));
    await expect.poll(async () => net(await fenetre.locator('#imp-apercu').innerText())).toMatch(/^« faux\.xlsx » est un classeur \(Excel \.xlsx ou LibreOffice \.ods\)\. Dans Excel : Fichier → Enregistrer sous…/);
    expect(await fenetre.locator('#imp-ok').isDisabled()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'tableur-1-refus.png') });

    // Le vrai classeur : les colonnes reconnues à leur titre, trois fiches nouvelles.
    await ouvrir('clients.xlsx', classeur([
      ['Nom', 'Matricule fiscal', 'Téléphone', 'E-mail', 'Adresse'],
      ['Menuiserie Ben Salah', '1234567A/A/M/000', '71 000 111', 'contact@menuiserie.tn', '3 rue de Marseille, Tunis'],
      ['Hôtel Dar El Marsa', '2345678B/A/M/000', '71 234 567', 'reception@darelmarsa.tn', 'Rue du Lac, La Marsa'],
      ['Garage Sfax Auto', null, '74 555 000', null, 'Route de Gabès km 2, Sfax'],
    ]));
    await expect.poll(async () => net(await fenetre.locator('#imp-lu').innerText())).toBe('Lu dans « clients.xlsx »');
    await expect.poll(async () => net(await fenetre.locator('#imp-ok').innerText())).toMatch(/3/);
    expect(await fenetre.locator('#imp-ok').isDisabled()).toBe(false);
    await p.screenshot({ path: path.join(PHOTOS, 'tableur-2-apercu.png') });
    await fenetre.locator('#imp-ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);

    // Le serveur a les trois fiches, champ par champ.
    const clients = async () => (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'clients'`, [ent])).rows
      .map((x: { contenu: Record<string, unknown> }) => [x.contenu.name, x.contenu.matricule ?? '', x.contenu.phone ?? '', x.contenu.email ?? '', x.contenu.address ?? ''])
      .sort((a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0])));
    await expect.poll(clients, { timeout: 15_000 }).toEqual([
      ['Garage Sfax Auto', '', '74 555 000', '', 'Route de Gabès km 2, Sfax'],
      ['Hôtel Dar El Marsa', '2345678B/A/M/000', '71 234 567', 'reception@darelmarsa.tn', 'Rue du Lac, La Marsa'],
      ['Menuiserie Ben Salah', '1234567A/A/M/000', '71 000 111', 'contact@menuiserie.tn', '3 rue de Marseille, Tunis'],
    ]);
    await expect.poll(async () => net(await p.locator('#view').innerText())).toMatch(/Hôtel Dar El Marsa/);
    await p.screenshot({ path: path.join(PHOTOS, 'tableur-3-clients.png') });
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
