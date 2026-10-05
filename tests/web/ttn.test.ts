// L'envoi à la TTN, à la souris (brique 82 ; docs/facture-electronique.md), contre une TTN et un DigiGo simulés.
// Nadia a signé FAC-2026-001 ; son entreprise (une vraie, pas celle d'essai) n'a pas encore posé son compte
// El Fatoora. « Fichier pour El Fatoora » dit que la pièce attend, pourquoi, et son bouton mène au réglage ;
// elle y pose son compte ; le facteur du serveur dépose la pièce, puis lit la réponse de la TTN. Ce que le
// parcours vérifie, écran ET serveur :
//   - la pièce attend, et c'est dit avec le bouton qui débloque (le réglage amené à l'écran, le curseur dans
//     la case) ;
//   - le compte se pose sans proposer d'enregistrer les Paramètres, et le mot de passe ne revient jamais ;
//   - acceptée, « Fichier pour El Fatoora » donne EXACTEMENT la facture validée par la TTN, et dit sa référence ;
//   - un seul dépôt ;
//   - la pièce imprimée (l'aperçu, et l'espace client) porte la référence de la TTN et un code QR qui, relu
//     par un lecteur de QR, dit EXACTEMENT ce que la TTN a rendu (brique 83) ; le client y télécharge la facture
//     validée, octet pour octet (brique 141).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import * as jsqr from 'jsqr';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { digigoSimule } from '../digigo-simule.ts';
import { v10, type DocV10 } from '../moteur/v10.ts';
import { ttnSimulee } from '../ttn-simule.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'envoi à la TTN, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let digigo: Awaited<ReturnType<typeof digigoSimule>>;
  let ttn: Awaited<ReturnType<typeof ttnSimulee>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ttn-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    digigo = await digigoSimule();
    ttn = await ttnSimulee();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_DIGIGO: digigo.base, SKANFACT_DIGIGO_CLE: digigo.cleIntegrateur,
      SKANFACT_TTN: ttn.base, SKANFACT_TTN_MS: '250' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await digigo?.fermer(); await ttn?.fermer(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  // Relire le code QR d'une pièce affichée, comme un téléphone le lirait : l'image dessinée, puis un lecteur de QR.
  const lireQr = async (cadre: Frame) => {
    const pixels = await cadre.evaluate(async () => {
      const svg = document.querySelector('svg.ttn-qr');
      if (!svg) return null;
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(new XMLSerializer().serializeToString(svg))}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 400; c.height = 400;
      const g = c.getContext('2d');
      if (!g) return null;
      g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400); g.drawImage(img, 0, 0, 400, 400);
      return Array.from(g.getImageData(0, 0, 400, 400).data);
    });
    return pixels ? jsqr.default.default(Uint8ClampedArray.from(pixels), 400, 400)?.data ?? null : null;
  };
  const cadreDe = async (p: Page, selecteur: string) => {
    const f = await (await p.locator(selecteur).elementHandle())?.contentFrame();
    if (!f) throw new Error(`pas de cadre : ${selecteur}`);
    return f;
  };
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);

  it('la pièce signée attend le compte El Fatoora ; Nadia le pose depuis la fenêtre ; acceptée, la facture validée se télécharge, et la pièce imprimée porte sa référence et son code QR, jusque dans l\'espace client', async () => {
    const email = `nadia-ttn-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const modele = String((await api('POST', '/entreprises-essai', premier)).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    type Objet = { collection: string; cle: string; revision: number; rang: number | null; contenu: Record<string, unknown> };
    const objets = async (e: string) => (await api('GET', `/entreprises/${e}/dossier-v10`, jeton)).corps.objets as Objet[];
    const deModele = await objets(modele);
    const fiche = deModele.find((o) => o.collection === '_racine' && o.cle === 'company');
    const menuiserie = deModele.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!fiche || !menuiserie) throw new Error('entreprise d\'essai incomplète');
    // Son entreprise (une vraie) : sa fiche, soumise à la facture électronique ; la Menuiserie ; FAC-2026-001
    // émise, puis signée par Nadia Ben Salah (le code reçu sur son téléphone).
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
    const ici = await objets(ent);
    const societe = ici.find((o) => o.collection === '_racine' && o.cle === 'company');
    const client = { ...menuiserie.contenu, matricule: '1234567A/A/M/000' };
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...fiche.contenu, ...societe?.contenu, name: 'Atelier Nadia', matricule: '7654321B/A/M/000', efacture: true } },
      { collection: 'clients', cle: menuiserie.cle, rang: 0, revision: null, contenu: client },
    ] });
    const d: Record<string, unknown> = {
      id: 'f1', type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: 450.5, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
    };
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: enc(d) }] });
    const emise = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: enc(d), client, revision: 1, rang: 0,
      netAPayer: v10.computeTotals(d as DocV10, { currency: 'DT', stampFee: 1 }).netToPay.toFixed(3) });
    expect(emise.statut).toBe(200);
    await api('PUT', `/entreprises/${ent}/efacture/signataire`, jeton, { identifiant: '09876543' });
    const demande = await api('POST', `/entreprises/${ent}/efacture/signatures`, jeton, { pieces: ['f1'] });
    expect((await api('POST', `/entreprises/${ent}/efacture/signatures/${String(demande.corps.id)}/code`, jeton, { code: String(digigo.codeDe('09876543')) })).statut).toBe(200);
    const envoi = async () => (await api('GET', `/entreprises/${ent}/dossier-v10/f1/teif`, jeton)).corps.envoi as { statut: string; motifCle: string | null } | null;
    // Le facteur est passé : sans compte, la pièce attend.
    await expect.poll(async () => (await envoi())?.motifCle, { timeout: 10_000 }).toBe('ttn.sans_compte');

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const nadia = await cn.newPage();
    const erreurs: string[] = [];
    nadia.on('pageerror', (e) => erreurs.push(e.message));
    const fichierElFatoora = async () => {
      await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
      await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Facture FAC-2026-001/);
      await plusTard(nadia);
      await nadia.locator('#more-btn').click();
      const telechargement = nadia.waitForEvent('download');
      await nadia.getByRole('button', { name: 'Fichier pour El Fatoora (TEIF)…', exact: true }).click();
      const recu = await telechargement;
      const fenetre = nadia.locator('#modal-root .modal').last();
      await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Le fichier El Fatoora est prêt');
      return { fenetre, nom: recu.suggestedFilename(), contenu: fs.readFileSync(await recu.path(), 'utf8') };
    };

    // La pièce attend : la fenêtre dit pourquoi, et son bouton mène au réglage.
    let f = await fichierElFatoora();
    expect(f.nom).toBe('TEIF_7654321BAM000_FAC-2026-001_signe.xml');
    await expect.poll(async () => net(await f.fenetre.locator('#ttn-piece').innerText())).toBe('Elle part à la TTN : SkanFact la dépose tout seul. Pour l\'instant, le compte El Fatoora de l\'entreprise n\'est pas posé : branche-le dans Paramètres → Documents, et la pièce partira.');
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-1-en-attente.png') });
    await f.fenetre.getByRole('button', { name: 'Brancher le compte El Fatoora', exact: true }).click();
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toBe('Paramètres');
    const panneau = nadia.locator('#ttn-panel');
    const identifiant = panneau.getByLabel('Identifiant de ton compte El Fatoora');
    const aLEcran = () => identifiant.evaluate((i) => { const b = i.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; });
    await expect.poll(aLEcran, { timeout: 5_000 }).toBe(true);
    await nadia.waitForTimeout(1_700);
    expect(await aLEcran()).toBe(true);
    expect(await identifiant.evaluate((i) => i === document.activeElement)).toBe(true);
    expect(net(await panneau.locator('#ttn-etat').innerText())).toBe('Pas branché : les pièces signées attendent de partir à la TTN.');
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-2-reglage.png') });

    // Le compte posé (le champ ne propose pas d'enregistrer les Paramètres ; le mot de passe ne revient jamais).
    await identifiant.fill('nadia-el-fatoora');
    await panneau.getByLabel('Mot de passe El Fatoora').fill('Mot-de-passe-TTN-7');
    expect(await nadia.locator('#save-bar').isHidden()).toBe(true);
    await panneau.getByRole('button', { name: 'Brancher', exact: true }).click();
    await expect.poll(async () => net(await panneau.locator('#ttn-etat').innerText()), { timeout: 10_000 })
      .toMatch(/^Branché le \d\d\/\d\d\/\d{4} à \d+ h \d\d par Nadia : compte nadia-el-fatoora\. Chaque pièce signée part d'elle-même à la TTN\.$/);
    expect(JSON.stringify((await api('GET', `/entreprises/${ent}/efacture/ttn`, jeton)).corps)).not.toContain('Mot-de-passe-TTN-7');
    expect(await panneau.locator('[data-champ=motDePasse]').inputValue()).toBe('');
    // La pièce n'est plus dite retenue par un compte absent (le facteur a pu la déposer entre-temps).
    expect(net(await panneau.locator('#ttn-envois').innerText())).toMatch(/^FAC-2026-001 (En route|Déposée, en attente de la TTN)$/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-3-branche.png') });

    // Le facteur dépose la pièce ; la réponse de la TTN se lit au tour suivant (avancé ici : il attendrait une
    // minute).
    await expect.poll(async () => (await envoi())?.statut, { timeout: 10_000 }).toBe('deposee');
    await admin.query(`update ventes.envoi_ttn set prochain_essai = now() where entreprise = $1`, [ent]);
    await expect.poll(async () => (await envoi())?.statut, { timeout: 10_000 }).toBe('acceptee');

    // Acceptée : le fichier est la facture validée par la TTN, telle que le serveur la garde ; la fenêtre dit
    // sa référence.
    const valide = (await admin.query(`select x.xml_valide, x.reference from ventes.envoi_ttn x where x.entreprise = $1`, [ent])).rows[0] as { xml_valide: string; reference: string };
    f = await fichierElFatoora();
    expect(f.nom).toBe('TEIF_7654321BAM000_FAC-2026-001_ttn.xml');
    expect(f.contenu).toBe(valide.xml_valide);
    expect(f.contenu).toContain(`<ReferenceTTN refID="I-88">${valide.reference}</ReferenceTTN>`);
    await expect.poll(async () => net(await f.fenetre.locator('#ttn-piece').innerText()))
      .toMatch(new RegExp(`^Acceptée par la TTN le \\d\\d/\\d\\d/\\d{4} à \\d+ h \\d\\d, référence ${valide.reference}\\. Le fichier que tu viens de télécharger est la facture validée par la TTN : c'est elle qui fait foi, garde-la\\.$`));
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-4-acceptee.png') });
    expect(ttn.deposesDe('FAC-2026-001')).toBe(1);

    // La pièce imprimée (son aperçu) porte la référence de la TTN et son code QR ; relu, le QR dit exactement ce
    // que la TTN a rendu.
    const qrAttendu = String((await admin.query('select qr from ventes.envoi_ttn where entreprise = $1', [ent])).rows[0].qr);
    // Acceptée pendant que la page était ouverte : la fenêtre dit de recharger pour voir la pièce imprimée à jour.
    expect(net(await f.fenetre.locator('#ttn-recharger').innerText())).toBe('La pièce imprimée porte désormais sa référence et son code QR : recharge la page pour les voir. Recharger');
    await f.fenetre.getByRole('button', { name: 'Recharger', exact: true }).click();
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Facture FAC-2026-001/);
    await plusTard(nadia);
    const apercu = await cadreDe(nadia, '#preview');
    await expect.poll(async () => net(await apercu.locator('.info.ttn .terms').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe(`Validée par la TTN (El Fatoora) Référence ${valide.reference}`);
    expect(await apercu.locator('.info.ttn .k').textContent()).toBe('Facture électronique');
    expect(await lireQr(apercu)).toBe(qrAttendu);
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-5-piece.png') });

    // L'espace client : la même pièce, la même référence, le même code QR.
    const lien = await api('POST', `/entreprises/${ent}/espace/liens`, jeton, { client: menuiserie.cle, piece: 'f1' });
    const espace = await cn.newPage();
    espace.on('pageerror', (e) => erreurs.push(e.message));
    await espace.goto(`${serveur.adresse}${String(lien.corps.adresse)}`);
    const piece = await cadreDe(espace, 'iframe.piece');
    await expect.poll(async () => net(await piece.locator('.info.ttn .terms').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe(`Validée par la TTN (El Fatoora) Référence ${valide.reference}`);
    expect(await piece.locator('.info.ttn .k').textContent()).toBe('Facture électronique');
    expect(await lireQr(piece)).toBe(qrAttendu);
    await espace.screenshot({ path: path.join(PHOTOS, 'ttn-6-espace.png') });
    // Le client télécharge la facture validée par la TTN, celle qui fait foi (brique 141), telle que le serveur la garde.
    // Le réseau tombe d'abord : c'est dit, et le bouton se reclique.
    const bouton = espace.getByRole('button', { name: 'Facture électronique (XML)', exact: true });
    const alerte = espace.locator('.refus-paiement');
    await espace.route('**/v1/espace/efacture', (r) => r.abort('internetdisconnected'), { times: 1 });
    await bouton.click();
    await expect.poll(() => alerte.innerText()).toBe('Le serveur ne répond pas : vérifie ta connexion, puis réessaie.');
    const recue = espace.waitForEvent('download');
    await bouton.click();
    const fichier = await recue;
    expect(fichier.suggestedFilename()).toBe('TEIF_7654321BAM000_FAC-2026-001_ttn.xml');
    expect(fs.readFileSync(await fichier.path(), 'utf8')).toBe(valide.xml_valide);
    expect(await bouton.isEnabled()).toBe(true);
    // Le lien retiré entre-temps : la page le dit, et rien ne se télécharge.
    const id = String((await admin.query(`select id from ventes.lien where entreprise = $1 and piece_v10 = 'f1'`, [ent])).rows[0].id);
    expect((await api('DELETE', `/entreprises/${ent}/espace/liens/${id}`, jeton)).statut).toBe(200);
    let telecharge = false;
    espace.on('download', () => { telecharge = true; });
    await bouton.click();
    await expect.poll(() => alerte.innerText()).toBe('Ce lien n\'est plus valable : demande un nouveau lien à l\'entreprise qui te l\'a envoyé.');
    expect(telecharge).toBe(false);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 180_000);
});
