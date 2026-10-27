// La lecture d'une facture d'achat par l'IA de Claude (Anthropic), hors de Tunisie, à la souris (décision du 24/10/2026,
// branchée le 27/10/2026 ; maquette achat, « Lecture intelligente · à vérifier »). L'IA est jouée par un essai : aucun appel
// réel ne part. Ce que le parcours vérifie, écran ET serveur :
//   - la question se pose avant chaque envoi ; rien ne part avant « Lire avec l'IA », et « Non » joint la photo ;
//   - la page dit d'où vient la lecture (l'IA, hors de Tunisie, avec ton accord) et ce qui reste à trancher : le numéro
//     flou, la quantité tachée ; le recomptage dit quelle quantité tombe juste, et refuse la mauvaise ;
//   - tout tranché, la pièce se remplit, et le bandeau ne dit « au millime » que si les totaux tombent juste ;
//   - le fournisseur lu qui n'est pas dans la liste se crée d'un clic, sans ouvrir la liste, et « Annuler » le retire ;
//   - seule l'IA lit (27/10/2026, Skander) : l'entreprise qui la coupe ne lit rien ; la carte le dit et mène au réglage.

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
    { champ: 'quantite', ligne: 2, valeurs: ['6', '8'], raison: 'quantité floue', zone: [60, 330, 880, 40] },
  ],
};

// (1.163.0, vu par Skander le 27/10/2026) La facture d'Anthropic, en euros, adressée à un autre matricule que celui de
// l'atelier : la page le dit, la devise passe sur la pièce, et le taux de change reste à saisir (il valait 1 sans rien dire).
const ANTHROPIC: ReponseIA = {
  estUneFacture: true, fournisseur: 'Anthropic Ireland, Limited',
  matricules: [{ valeur: 'IE4276970QH', de: 'emetteur' }, { valeur: 'FR29983374398', de: 'client' }],
  numero: '9BF0758D-8421007', date: '2026-10-11', echeance: '2026-10-11', objet: 'Max plan', devise: 'EUR',
  lignes: [{ designation: 'Max plan - 20x', quantite: '1', prixUnitaire: '180.00', remise: null, tauxTva: '0', totalHT: '180.00' }],
  totalHT: '180.00', totalTVA: '0', timbre: null, fodec: null, retenue: null, totalTTC: '180.00', netAPayer: '180.00',
  ou: [{ champ: 'numero', texte: 'Invoice number 9BF0758D-8421007' }],
  doutes: [],
};

describe('la lecture d\'une facture d\'achat par l\'IA, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-lecture-ia-'));
  const envois: Buffer[] = [];
  let reponse: ReponseIA = BUREAU_PLUS;
  const ia: AppelIA = async ({ fichier }) => { envois.push(fichier); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reponse) }] }; };
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

  // Nadia, son atelier et Bureau Plus Sfax, déjà dans ses fournisseurs avec son matricule (sauf `sansFournisseur`).
  async function nadia(reglage: Record<string, unknown> = {}, sansFournisseur = false) {
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
      ...(sansFournisseur ? [] : [{ collection: 'suppliers', cle: 'bureau', rang: 0, revision: null, contenu: { id: 'bureau', name: 'Bureau Plus Sfax', matricule: '1390022T/A/M/000' } }]),
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
    // (1.160.0, maquette « Lecture intelligente · en cours ») La réponse reçue, les étapes se cochent avec ce qui a VRAIMENT
    // été lu, avant que « Ce que SkanFact a compris » s'ouvre.
    const etape = (i: number, texte: string) => p.waitForFunction(([k, t]) => document.querySelector(`#ac-lecture [data-etape="${k}"].fait small`)?.textContent === t, [i, texte] as const, { timeout: 30_000, polling: 30 });
    await etape(2, 'Bureau Plus Sfax, par son matricule');
    await etape(3, '2 lignes, comparées à ton catalogue');

    await p.locator('#ac-lecture').getByText('Ce que SkanFact a compris').waitFor({ timeout: 30_000 });
    // « Justificatif », en haut de la page : la photo en grand, pour comparer.
    await p.locator('#lec-grand').click();
    // (1.163.0) Dans la fenêtre en grand de SkanFact, celle de tout justificatif.
    await expect.poll(() => p.locator('#pv-full.pj-grand .pj-grand-corps > img').count()).toBe(1);
    await p.locator('#pv-full').getByRole('button', { name: /^Fermer/ }).click();
    expect(await p.locator('#pv-full').count()).toBe(0);
    expect(envois.length).toBe(avant + 1);
    expect(envois.at(-1)?.equals(fs.readFileSync(PHOTO))).toBe(true);
    const page = () => p.locator('#ac-lecture').innerText().then(net);
    expect(await page()).toMatch(/Lue par l'IA de Claude \(Anthropic\), hors de Tunisie, avec ton accord/);
    expect(await page()).toMatch(/Rien d'autre n'est parti : ni tes clients, ni tes chiffres/);
    expect(await page()).toMatch(/Bureau Plus Sfax reconnu par son matricule 1390022T\/A\/M\/000/);
    // (1.160.0, maquette) Le total que la personne compare avec la facture : le TTC, avec la bonne quantité.
    expect(await page()).toMatch(/avec 6 × « Cartouches d'encre », le total tombe juste : 647,646 TVA ligne par ligne, timbre 1,000 à part/);
    // La quantité floue est située sur la photo : la zone 1, numérotée sur l'image et dans la ligne.
    expect(net(await ligneLue(p, 'Cartouches').innerText())).toMatch(/lue sur la photo · zone 1/);
    expect(await p.locator('#ac-lecture .ac-lec-photo .ac-lec-repere').allInnerTexts()).toEqual(['1']);
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

  // L'API refuse une image de plus de 5 Mo : la photo d'un téléphone (4 000 × 3 000 points) part réduite, en JPEG.
  it('une facture en euros, adressée à un autre matricule : la page le dit, la devise passe sur la pièce, le taux reste à saisir', async () => {
    const { jeton, ent } = await nadia({}, true);
    reponse = ANTHROPIC;
    try {
      const lire = async () => {
        const o = await ouvrir(jeton, ent);
        await choisirPhoto(o.p);
        await question(o.p).getByRole('button', { name: 'Lire avec l\'IA' }).click();
        await o.p.locator('#ac-lecture').getByText('Ce que SkanFact a compris').waitFor({ timeout: 30_000 });
        return o;
      };
      const { p, erreurs, fermer } = await lire();
      const page = () => p.locator('#ac-lecture').innerText().then(net);
      // La devise et le destinataire, chacun à sa ligne, en ambre : deux cases à revoir.
      expect(net(await ligneLue(p, 'Devise').innerText())).toMatch(/Devise la facture est en euros \(€\) le taux de change se saisit sur la pièce, avant de l'enregistrer$/);
      expect(await ligneLue(p, 'Devise').evaluate((x) => x.classList.contains('douteux'))).toBe(true);
      expect(net(await ligneLue(p, 'Adressée à').innerText())).toMatch(/au matricule FR29983374398, pas à celui de ton entreprise \(7654321B\/A\/M\/000\) vérifie qu'elle est bien à toi : sinon, ne la saisis pas ici$/);
      expect(await ligneLue(p, 'Adressée à').evaluate((x) => x.classList.contains('douteux'))).toBe(true);
      // Les montants d'une pièce en euros se comptent au centime, pas au millime.
      expect(await page()).toMatch(/au centime/);
      expect(await page()).not.toMatch(/au millime/);
      await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-10-euros.png') });
      // Le fournisseur se crée d'un clic depuis la lecture.
      await p.locator('#lec-creer').click();
      await expect.poll(() => p.locator('#lec-creer').count()).toBe(0);
      // « Vérifier case par case » : la pièce à gauche, les cases à droite ; le taux, vide, se saisit ici.
      await p.locator('#lec-detail').click();
      const fen = p.locator('#modal-root .modal.modal-vc');
      await fen.waitFor({ timeout: 10_000 });
      expect(net(await fen.locator('h2').innerText())).toBe('Vérifier case par case');
      const taux = fen.locator('input[name=exchangeRate]');
      expect(await taux.inputValue()).toBe('');
      expect(net(await fen.locator('#ocr-warn').innerText())).toContain('en EUR : le taux de change, ci-dessus, avant d\'enregistrer');
      await taux.fill('3.412');
      await expect.poll(() => fen.locator('#ocr-warn').innerText().then(net)).toContain('1 € = 3.412 DT');
      await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-11-euros-case-par-case.png') });
      await fen.locator('#ok').click();
      await p.locator('#ac-lu-ia').waitFor({ timeout: 15_000 }).catch(async (e) => { await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-euros-echec.png') }); throw e; });
      // Ce que la fenêtre laissait « en ambre sur la pièce » s'y lit : le destinataire, seul resté à revoir.
      expect(net(await p.locator('#ac-lu-ia').innerText())).toMatch(/^Lue par l'IA : 1 case à vérifier La lecture n'est pas sûre du destinataire de la facture\./);
      // La pièce remplie est en euros, au taux saisi : rien ne se convertit à 1 € = 1 DT.
      await expect.poll(() => p.evaluate(() => [(document.querySelector('[name=currency]') as HTMLSelectElement | null)?.value, (document.querySelector('[name=exchangeRate]') as HTMLInputElement | null)?.value])).toEqual(['EUR', '3.412']);
      expect(net(await p.locator('#b-totals').innerText())).not.toContain('le taux de change manque');
      await fermer();
      // « Remplir la pièce » sans passer par le détail : la devise passe, le taux reste vide, et la pièce le dit.
      const deux = await lire();
      await deux.p.locator('#lec-remplir').click();
      await deux.p.locator('#ac-lu-ia').waitFor({ timeout: 15_000 });
      await expect.poll(() => deux.p.evaluate(() => [(document.querySelector('[name=currency]') as HTMLSelectElement | null)?.value, (document.querySelector('[name=exchangeRate]') as HTMLInputElement | null)?.value])).toEqual(['EUR', '']);
      expect(net(await deux.p.locator('#b-totals').innerText())).toContain('le taux de change manque');
      expect([...erreurs, ...deux.erreurs]).toEqual([]);
      await deux.fermer();
    } finally { reponse = BUREAU_PLUS; }
  }, 180_000);

  it('la photo lourde d\'un téléphone part à l\'IA réduite à 2 400 points, en JPEG', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent);
    const lourde = Buffer.from(await p.evaluate(async () => {
      const t = document.createElement('canvas'); t.width = 4000; t.height = 3000;
      const c = t.getContext('2d');
      const img = c?.createImageData(4000, 3000);
      if (!c || !img) return '';
      for (let i = 0; i < img.data.length; i += 4) { const v = (i * 2654435761) >>> 24; img.data[i] = v; img.data[i + 1] = v ^ 0x5a; img.data[i + 2] = 255 - v; img.data[i + 3] = 255; }
      c.putImageData(img, 0, 0);
      const b = await new Promise<Blob | null>((ok) => t.toBlob(ok, 'image/png'));
      const o = new Uint8Array(await (b ?? new Blob()).arrayBuffer());
      let s = ''; for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000));
      return btoa(s);
    }), 'base64');
    expect(lourde.length).toBeGreaterThan(5 * 1_048_576);
    expect(lourde.length).toBeLessThan(10 * 1_048_576);
    const avant = envois.length;
    const selecteur = p.waitForEvent('filechooser');
    await p.locator('#photo').click();
    await (await selecteur).setFiles({ name: 'IMG_2026.png', mimeType: 'image/png', buffer: lourde });
    await question(p).getByRole('button', { name: 'Lire avec l\'IA' }).click();
    await p.locator('#ac-lecture').getByText('Ce que SkanFact a compris').waitFor({ timeout: 30_000 });
    expect(envois.length).toBe(avant + 1);
    const parti = envois.at(-1) ?? Buffer.alloc(0);
    expect([...parti.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect(parti.length).toBeLessThan(5 * 1_048_576);
    // La taille de l'image lue dans son en-tête JPEG (le segment SOF).
    let i = 2, cotes: number[] = [];
    while (i < parti.length - 9) {
      const m = parti[i + 1] ?? 0, l = parti.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc2) { cotes = [parti.readUInt16BE(i + 7), parti.readUInt16BE(i + 5)]; break; }
      i += 2 + l;
    }
    expect(cotes).toEqual([2400, 1800]);
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  // (1.160.0, demande de Skander) Un PDF se montre comme une photo : sa première page, dessinée dans le navigateur (pdf.js),
  // pendant la lecture, sur « Ce que SkanFact a compris », en grand, et dans le justificatif de la pièce remplie ; les
  // phrases disent « le PDF », pas « la photo ».
  it('un PDF lu par l\'IA se montre : sa première page, à chaque étape, et les phrases disent « le PDF »', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent);
    const selecteur = p.waitForEvent('filechooser');
    await p.locator('#photo').click();
    await (await selecteur).setFiles(path.join(RACINE, 'tests/donnees/lecture/quincaillerie.pdf'));
    const fen = p.locator('#modal-root .modal').filter({ hasText: 'Lire ce PDF avec l\'IA ?' });
    await fen.waitFor({ timeout: 10_000 });
    expect(net(await fen.innerText())).toMatch(/Le PDF part chez l'IA de Claude/);
    await p.locator('#modal-root .modal').getByRole('button', { name: /Lire avec l'IA/ }).click();
    await p.locator('#ac-lecture').getByText('Ce que SkanFact a compris').waitFor({ timeout: 30_000 });
    expect(net(await p.locator('.ed-tete h1').innerText())).toBe('Lecture du PDF');
    // La première page, en image (pas une icône).
    await expect.poll(() => p.locator('#ac-lecture .ac-lec-photo img.ac-lec-img').count(), { timeout: 20_000 }).toBe(1);
    expect(await p.locator('#ac-lecture .ac-lec-photo img.ac-lec-img').evaluate((x) => (x as HTMLImageElement).naturalWidth)).toBeGreaterThan(400);
    expect(net(await p.locator('#ac-lecture .ac-lec-photo .q').innerText())).toMatch(/^Le PDF · lu par l'IA/);
    // (1.163.0, vu par Skander le 27/10/2026 : « on n'arrive pas à scroller jusqu'en bas dans la colonne de droite ») Sur un
    // écran bas, le bas de la colonne reste à l'écran, et ses derniers boutons s'atteignent en la faisant défiler.
    await p.setViewportSize({ width: 1440, height: 520 });
    // En haut de la page, là où la colonne n'est pas encore collée, sous un bandeau comme celui de l'entreprise d'exemple
    // (c'est là que son bas sortait de l'écran).
    await p.evaluate(() => {
      const b = document.createElement('div'); b.style.height = '70px'; b.className = 'bandeau-essai-test';
      document.querySelector('#view')?.prepend(b);
      scrollTo(0, 0);
    });
    // La colonne déborde (sinon ce test ne mesurerait rien), et son bas reste à l'écran.
    await expect.poll(() => p.evaluate(() => {
      const c = document.querySelector('#view .editor.charte > .ed-droite');
      return c ? [c.scrollHeight > c.clientHeight, Math.round(c.getBoundingClientRect().bottom) <= innerHeight] : [];
    }), { timeout: 10_000 }).toEqual([true, true]);
    await p.locator('#lec-detail').scrollIntoViewIfNeeded();
    expect(await p.evaluate(() => { const b = document.querySelector('#lec-detail')?.getBoundingClientRect(); return !!b && b.bottom <= innerHeight && b.top >= 0; })).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-colonne-ecran-bas.png') });
    await p.evaluate(() => document.querySelector('.bandeau-essai-test')?.remove());
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.locator('#lec-grand').click();
    // (1.163.0) Le PDF entier, ses pages dessinées l'une sous l'autre dans la fenêtre en grand.
    await expect.poll(() => p.locator('#pv-full.pj-grand .pj-pages img').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(net(await p.locator('#pv-full .pv-pages').innerText())).toMatch(/^\d+ pages?/);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#pv-full').count()).toBe(0);
    await p.locator('#lec-remplir').click();
    await p.locator('#ac-lu-ia').waitFor({ timeout: 15_000 });
    expect(net(await p.locator('#toast .toast-txt').innerText())).toMatch(/^Pièce remplie depuis le PDF, joint à l'achat/);
    await expect.poll(() => p.locator('#attachments .ac-pj-vue img').count(), { timeout: 20_000 }).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-7-pdf.png') });
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
    // (1.160.0, maquette « Lue par l'IA · pièce remplie ») Le bandeau nomme chaque doute avec ses valeurs ; les deux cases
    // restent en ambre sur la pièce ; la pastille, « Avant d'enregistrer » et le toast disent le même nombre.
    expect(net(await q.locator('#ac-lu-ia').innerText())).toBe('Lue par l\'IA : 2 cases à vérifier La lecture n\'est pas sûre du numéro de facture (BP-8812 ou BP-8813 ?) et de la quantité de « Cartouches d\'encre » (6 ou 8 ?). Elles sont marquées en ambre ; compare avec la photo avant d\'enregistrer.');
    expect(await q.locator('#ac-lu-ia').evaluate((x) => x.classList.contains('ambre'))).toBe(true);
    expect(net(await q.locator('.ed-tete .ed-pill').innerText())).toBe('Lue par l\'IA · à vérifier');
    expect(net(await q.locator('#toast .toast-txt').innerText())).toBe('Pièce remplie depuis la photo, jointe à l\'achat : 2 cases à revoir, puis « Enregistrer l\'achat ».');
    expect(await q.locator('#b-head input[name=number]').evaluate((x) => x.classList.contains('lu-douteux'))).toBe(true);
    expect(await q.locator('#b-lines input[data-k=qty]').evaluateAll((xs) => xs.map((x) => x.classList.contains('lu-douteux')))).toEqual([false, true]);
    await expect.poll(() => q.locator('#ac-avant').innerText().then(net)).toMatch(/2 cases lues sur la photo à vérifier/);
    // Le justificatif se montre à droite : la photo, et la zone de la quantité floue posée dessus.
    await expect.poll(() => q.locator('#attachments .ac-pj-vue img').count(), { timeout: 10_000 }).toBe(1);
    expect(await q.locator('#attachments .ac-pj .ac-lec-repere').allInnerTexts()).toEqual(['1']);
    // La quantité corrigée sur la pièce perd son ambre, et « Avant d'enregistrer » le compte.
    await q.locator('#b-lines tr[data-i="1"] input[data-k=qty]').fill('6');
    expect(await q.locator('#b-lines tr[data-i="1"] input[data-k=qty]').evaluate((x) => x.classList.contains('lu-douteux'))).toBe(false);
    await expect.poll(() => q.locator('#ac-avant').innerText().then(net)).toMatch(/1 case lue sur la photo à vérifier/);
    await q.screenshot({ path: path.join(PHOTOS, 'lecture-ia-6-reste-a-verifier.png') });
    expect([...erreurs, ...deux.erreurs]).toEqual([]);
    await deux.fermer();
  }, 120_000);

  it('le fournisseur lu qui n\'est pas dans la liste se crée d\'un clic, sans ouvrir la liste ; « Annuler » le retire', async () => {
    const { jeton, ent } = await nadia({}, true);
    const { p, erreurs, fermer } = await ouvrir(jeton, ent);
    await choisirPhoto(p);
    await question(p).getByRole('button', { name: 'Lire avec l\'IA' }).click();
    await p.locator('#ac-lecture').getByText('Ce que SkanFact a compris').waitFor({ timeout: 30_000 });
    const four = ligneLue(p, 'Fournisseur');
    expect(net(await four.innerText())).toMatch(/« Bureau Plus Sfax » n'est pas dans tes fournisseurs : Créer « Bureau Plus Sfax » ou choisir/);
    // « Créer » se voit tout de suite, la liste reste fermée à côté.
    const creer = p.locator('#lec-creer');
    expect(await creer.isVisible()).toBe(true);
    expect(await p.locator('[data-combo=lecSup] .combo-pop').isHidden()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-8-fournisseur-nouveau.png') });
    await creer.click();
    await expect.poll(() => p.locator('#toast .toast-txt').innerText().then(net)).toBe('Fiche « Bureau Plus Sfax » créée depuis la pièce : nom et matricule repris');
    await expect.poll(() => four.innerText().then(net)).toMatch(/Fournisseur Bureau Plus Sfax nouveau fiche créée depuis la pièce : son nom et son matricule 1390022T\/A\/M\/000/);
    expect(await p.locator('#lec-creer').count()).toBe(0);
    const fiches = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'suppliers').map((o) => [o.contenu.name, o.contenu.matricule]);
    await expect.poll(fiches, { timeout: 15_000 }).toEqual([['Bureau Plus Sfax', '1390022T/A/M/000']]);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-9-fournisseur-cree.png') });
    // « Annuler » : la fiche s'en va (aucun achat ne la porte), « Créer » revient.
    await p.locator('#toast #toast-undo').click();
    await expect.poll(() => p.locator('#lec-creer').isVisible()).toBe(true);
    await expect.poll(fiches, { timeout: 15_000 }).toEqual([]);
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('seule l\'IA lit : coupée par l\'entreprise, rien ne part, la carte le dit et mène au réglage, qui la rallume', async () => {
    const { jeton, ent } = await nadia({ lectureIA: false });
    const { p, erreurs, fermer } = await ouvrir(jeton, ent);
    const avant = envois.length;
    const carte = p.locator('#photo');
    await expect.poll(() => carte.isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await carte.innerText())).toBe('Lire avec l\'IA coupée Coupée dans tes paramètres : un clic pour la rallumer');
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-7-carte-coupee.png') });
    await carte.click();
    const panneau = p.locator('#ocr-panel');
    await expect.poll(() => panneau.innerText().then(net), { timeout: 20_000 }).toMatch(/Lire avec l'IA de Claude ?coupée/);
    expect(envois.length).toBe(avant);
    expect(net(await panneau.innerText())).toMatch(/Coupée pour toute l'entreprise : les pièces se joignent et se saisissent à la main\./);
    expect(net(await panneau.innerText())).not.toMatch(/serveurs de SkanFact/);
    expect(await panneau.locator('.ocr-voie.on').innerText().then(net)).toMatch(/^Saisir à la main ?toujours là/);
    await p.screenshot({ path: path.join(PHOTOS, 'lecture-ia-7-reglage-coupe.png') });
    await panneau.getByRole('button', { name: 'Proposer l\'IA de nouveau' }).click();
    // Un réglage qui se défait d'un clic : le toast le dit, « Annuler » sous la main.
    await expect.poll(() => p.locator('#toast .toast-txt').innerText().then(net)).toBe('L\'IA se proposera à chaque pièce : elle ne lit que si tu dis oui.');
    expect(await p.locator('#toast #toast-undo').isVisible()).toBe(true);
    await expect.poll(() => panneau.innerText().then(net)).toMatch(/Lire avec l'IA de Claude ?hors de Tunisie/);
    expect(await panneau.locator('.ocr-voie.on').innerText().then(net)).toMatch(/^Lire avec l'IA de Claude/);
    expect(net(await panneau.innerText())).toMatch(/Ce qui part chez Anthropic, quand tu dis oui ?L'image de la pièce, et la consigne de lecture de SkanFact ?Ni tes clients, ni tes chiffres, ni le nom de ton entreprise/);
    await expect.poll(async () => {
      const o = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[]).find((x) => x.collection === '_racine' && x.cle === 'company');
      return o?.contenu.lectureIA;
    }, { timeout: 15_000 }).toBe(true);
    // Rallumée, la carte d'un achat neuf le dit tout de suite, sans recharger la page (elle disait encore « coupée »).
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await expect.poll(() => p.locator('#photo').innerText().then(net), { timeout: 15_000 }).toBe('Lire avec l\'IA facultatif La photo ou le PDF : SkanFact remplit, tu vérifies chaque case');
    expect(erreurs).toEqual([]);
    await fermer();
  }, 180_000);
});
