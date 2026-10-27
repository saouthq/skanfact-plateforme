// La lecture d'une facture d'achat par l'IA de Claude (Anthropic), hors de Tunisie, à la souris (décision du 24/10/2026,
// branchée le 27/10/2026 ; maquette achat, « Lecture intelligente · à vérifier »). L'IA est jouée par un essai : aucun appel
// réel ne part. Ce que le parcours vérifie, écran ET serveur :
//   - la question se pose avant chaque envoi ; rien ne part avant « Lire avec l'IA », et « Non » joint la photo ;
//   - la page dit d'où vient la lecture (l'IA, hors de Tunisie, avec ton accord) et ce qui reste à trancher : le numéro
//     flou, la quantité tachée ; le recomptage dit quelle quantité tombe juste, et refuse la mauvaise ;
//   - tout tranché, la pièce se remplit, et le bandeau ne dit « au millime » que si les totaux tombent juste ;
//   - l'entreprise qui coupe l'IA dans ses réglages lit sur nos serveurs, sans question.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { AppelIA, ReponseIA } from '../../serveur/achats/lecture-ia.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { libererMatricule } from '../matricule-libre.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const PHOTO = path.join(RACINE, 'tests/donnees/lecture/quincaillerie-photo.jpg');
const NOUS = '7654321B/A/M/000';
// Ce que l'IA rend de la facture de Bureau Plus Sfax : 20 ramettes à 12,500, des cartouches à 48,900 dont la quantité est
// tachée (6 ou 8), un numéro dont le dernier chiffre est flou ; 543,400 HT, 103,246 de TVA, 1,000 de timbre.
const BUREAU_PLUS: ReponseIA = {
  estUneFacture: true, fournisseur: 'Bureau Plus Sfax',
  matricules: [{ valeur: '1390022T/A/M/000', de: 'emetteur' }, { valeur: NOUS, de: 'client' }],
  numero: 'BP-8812', date: '2026-10-23', echeance: null, objet: null, devise: 'TND',
  lignes: [
    { designation: 'Ramettes A4', quantite: '20', prixUnitaire: '12.500', remise: null, tauxTva: '19', totalHT: '250.000' },
    { designation: 'Cartouches d\'encre', quantite: '6', prixUnitaire: '48.900', remise: null, tauxTva: '19', totalHT: null },
  ],
  totalHT: '543.400', totalTVA: '103.246', timbre: '1.000', fodec: null, retenue: null, totalTTC: '647.646', netAPayer: '647.646',
  ou: [{ champ: 'numero', texte: 'Facture n° BP-881?' }],
  doutes: [
    { champ: 'numero', ligne: null, valeurs: ['BP-8812', 'BP-8813'], raison: 'le dernier chiffre est flou' },
    { champ: 'quantite', ligne: 2, valeurs: ['6', '8'], raison: 'quantité floue' },
  ],
};

describe('la lecture d\'une facture d\'achat par l\'IA, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-lecture-ia-'));
  const envois: Buffer[] = [];
  const ia: AppelIA = async ({ fichier }) => { envois.push(fichier); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(BUREAU_PLUS) }] }; };
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 }, { ia });
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
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();

  // Nadia, son atelier et Bureau Plus Sfax, déjà dans ses fournisseurs avec son matricule.
  async function nadia(reglage: Record<string, unknown> = {}) {
    const email = `nadia-ia-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
    type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
    const fiche = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
    await libererMatricule(inject('pgAdmin'), NOUS);
    const ok = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, name: 'Atelier Nadia', matricule: NOUS, ...reglage } },
      { collection: 'suppliers', cle: 'bureau', rang: 0, revision: null, contenu: { id: 'bureau', name: 'Bureau Plus Sfax', matricule: '1390022T/A/M/000' } },
    ] });
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(200);
    return { jeton, ent };
  }
  async function ouvrir(jeton: string, ent: string, viewport = { width: 1440, height: 900 }) {
    const cn = await navigateur.newContext({ viewport, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/new`);
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/achat/i);
    await plusTard(p);
    return { p, erreurs, fermer: () => cn.close() };
  }
  async function choisirPhoto(p: Page) {
    const bouton = p.locator('#photo');
    await expect.poll(() => bouton.isVisible(), { timeout: 10_000 }).toBe(true);
    const selecteur = p.waitForEvent('filechooser');
    await bouton.click();
    await (await selecteur).setFiles(PHOTO);
  }
  const question = (p: Page) => p.locator('#modal-root .modal').filter({ hasText: 'Lire cette photo avec l\'IA ?' });
  const ligneLue = (p: Page, nom: string) => p.locator('#ac-lecture .ac-lec-l').filter({ has: p.locator('.n', { hasText: nom }) });

  it('Nadia dit oui à l\'IA, tranche le numéro flou et la quantité tachée ; le recomptage refuse la mauvaise quantité, et la pièce se remplit au millime', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent);
    const avant = envois.length;
    await choisirPhoto(p);
    // La question, avant tout envoi : ce qui part, où, et « Non ».
    await question(p).waitFor({ timeout: 10_000 });
    expect(net(await question(p).innerText())).toMatch(/L'image part chez l'IA de Claude \(Anthropic\), hors de Tunisie\. Rien d'autre n'est envoyé : ni tes clients, ni tes chiffres\./);
    expect(await question(p).getByRole('button', { name: 'Non : la joindre et saisir à la main' }).count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-1-question.png') });
    expect(envois.length).toBe(avant);
    await question(p).getByRole('button', { name: 'Lire avec l\'IA' }).click();

    await p.locator('#ac-lecture').getByText('Ce que SkanFact a compris').waitFor({ timeout: 30_000 });
    expect(envois.length).toBe(avant + 1);
    expect(envois.at(-1)?.equals(fs.readFileSync(PHOTO))).toBe(true);
    const page = () => p.locator('#ac-lecture').innerText().then(net);
    expect(await page()).toMatch(/Lue par l'IA de Claude \(Anthropic\), hors de Tunisie, avec ton accord/);
    expect(await page()).toMatch(/Rien d'autre n'est parti : ni tes clients, ni tes chiffres/);
    expect(await page()).toMatch(/Bureau Plus Sfax reconnu par son matricule 1390022T\/A\/M\/000/);
    expect(await page()).toMatch(/avec 6, les lignes tombent juste : 543,400 HT/);
    expect(net(await ligneLue(p, 'Numéro').innerText())).toMatch(/le dernier chiffre est flou : BP-8812 BP-8813 lu sur la photo : « Facture n° BP-881\? »/);
    expect(await ligneLue(p, 'Numéro').evaluate((x) => x.classList.contains('douteux'))).toBe(true);
    expect(net(await ligneLue(p, 'Cartouches').innerText())).toMatch(/quantité floue : 6 8/);
    expect(net(await p.locator('.ed-tete .ed-pill').innerText())).toBe('2 cases à vérifier');
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-2-a-trancher.png') });

    // 8 cartouches : les lignes ne tombent plus sur le hors-taxes lu, la page le dit et nomme la bonne.
    await ligneLue(p, 'Cartouches').getByRole('button', { name: '8', exact: true }).click();
    await expect.poll(page).toMatch(/avec 8, les lignes font 641,200 HT, la pièce dit 543,400 ce n'est donc pas 8 : choisis 6/);
    expect(await ligneLue(p, 'Cartouches').getByRole('button', { name: '8', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-3-mauvaise-quantite.png') });
    await ligneLue(p, 'Cartouches').getByRole('button', { name: '6', exact: true }).click();
    await expect.poll(page).toMatch(/recalculé 543,400 = total lu 543,400 HT, au millime/);
    expect(await ligneLue(p, 'Cartouches').evaluate((x) => x.classList.contains('sur'))).toBe(true);
    await ligneLue(p, 'Numéro').getByRole('button', { name: 'BP-8812', exact: true }).click();
    await expect.poll(() => p.locator('.ed-tete .ed-pill').innerText().then(net)).toBe('Vérifiée');
    expect(net(await ligneLue(p, 'Numéro').innerText())).toMatch(/^✓? ?Numéro BP-8812/);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-4-tout-tranche.png') });

    await p.locator('#lec-remplir').click();
    await p.locator('#ac-lu-ia').waitFor({ timeout: 15_000 });
    expect(net(await p.locator('#ac-lu-ia').innerText())).toBe('Lue par l\'IA, et tout a été vérifié Les cases douteuses ont été tranchées à la lecture ; les totaux tombent juste au millime.');
    expect(await p.locator('input[data-k=label]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).toEqual(['Ramettes A4', 'Cartouches d\'encre']);
    expect(await p.locator('input[data-k=qty]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).toEqual(['20', '6']);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-5-rempli.png') });
    // Rien n'est enregistré avant « Enregistrer l'achat ».
    expect((await admin.query('select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = \'purchases\'', [ent])).rows[0].n).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('« Non » joint la photo sans rien envoyer ; une pièce remplie avec un doute ouvert le dit en ambre', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent);
    const avant = envois.length;
    await choisirPhoto(p);
    await question(p).getByRole('button', { name: 'Non : la joindre et saisir à la main' }).click();
    // La pièce se saisit à la main, la photo jointe : « Avant d'enregistrer » le dit aussitôt.
    await expect.poll(() => p.locator('#ac-avant').innerText().then(net), { timeout: 10_000 }).toMatch(/Justificatif joint : quincaillerie-photo\.jpg/);
    expect(await p.locator('#ac-arrivee').count()).toBe(0);
    expect(envois.length).toBe(avant);

    await fermer();
    const deux = await ouvrir(jeton, ent);
    const q = deux.p;
    await choisirPhoto(q);
    await question(q).getByRole('button', { name: 'Lire avec l\'IA' }).click();
    await q.locator('#ac-lecture').getByText('Ce que SkanFact a compris').waitFor({ timeout: 30_000 });
    await q.locator('#lec-remplir').click();
    await q.locator('#ac-lu-ia').waitFor({ timeout: 15_000 });
    expect(net(await q.locator('#ac-lu-ia').innerText())).toBe('Lue par l\'IA : 2 cases à vérifier Compare avec la photo jointe avant d\'enregistrer : le numéro de facture, la quantité de « Cartouches d\'encre ».');
    expect(await q.locator('#ac-lu-ia').evaluate((x) => x.classList.contains('ambre'))).toBe(true);
    await q.screenshot({ path: path.join(PHOTOS, 'lecture-ia-6-reste-a-verifier.png') });
    expect([...erreurs, ...deux.erreurs]).toEqual([]);
    await deux.fermer();
  }, 120_000);

  it('l\'entreprise qui a coupé l\'IA lit sur nos serveurs, sans question ; le réglage le dit et la rallume', async () => {
    const { jeton, ent } = await nadia({ lectureIA: false });
    const { p, erreurs, fermer } = await ouvrir(jeton, ent);
    const avant = envois.length;
    await choisirPhoto(p);
    await p.locator('#ac-lecture').getByText('Ce que SkanFact a compris').waitFor({ timeout: 60_000 });
    expect(await question(p).count()).toBe(0);
    expect(envois.length).toBe(avant);
    expect(net(await p.locator('#ac-lecture').innerText())).toMatch(/Lue sur les serveurs de SkanFact, en Tunisie/);

    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    await p.locator('#set-tabs [data-tab="donnees"]').click();
    const panneau = p.locator('#ocr-panel');
    await expect.poll(() => panneau.innerText().then(net), { timeout: 20_000 }).toMatch(/Lire avec l'IA ?Coupée/);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-7-reglage-coupe.png') });
    await panneau.getByRole('button', { name: 'Proposer l\'IA de nouveau' }).click();
    await expect.poll(() => panneau.innerText().then(net)).toMatch(/Lire avec l'IA ?Proposée à chaque photo/);
    await expect.poll(async () => {
      const o = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[]).find((x) => x.collection === '_racine' && x.cle === 'company');
      return o?.contenu.lectureIA;
    }, { timeout: 15_000 }).toBe(true);
    expect(erreurs).toEqual([]);
    await fermer();
  }, 180_000);
});
