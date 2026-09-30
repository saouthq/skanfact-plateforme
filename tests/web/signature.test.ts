// La signature DigiGo, à la souris (brique 81 ; docs/facture-electronique.md ; vision § 5), contre un DigiGo
// simulé (tests/digigo-simule.ts). Nadia a émis FAC-2026-001 (son fichier El Fatoora écrit par le serveur).
// « Signer (DigiGo)… » dit d'abord que personne n'est désigné, avec le bouton qui mène au réglage ; elle y
// pose l'identifiant DigiGo du signataire. Elle recommence : un code part sur le téléphone du titulaire ; un
// code faux se retape, le bon signe. Ce que le parcours vérifie, écran ET serveur :
//   - le refus dit quoi, pourquoi, et son bouton mène au panneau du réglage, dans les Paramètres ;
//   - le signataire s'enregistre au serveur, sans proposer d'enregistrer les Paramètres (le champ n'a pas de nom) ;
//   - le code faux laisse la demande ouverte (il reste deux essais), le bon signe la pièce ;
//   - le fichier téléchargé ensuite est EXACTEMENT le fichier signé du serveur, et la fenêtre ne demande
//     plus de le signer : il reste un geste, le déposer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { digigoSimule } from '../digigo-simule.ts';
import { v10, type DocV10 } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la signature DigiGo, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let digigo: Awaited<ReturnType<typeof digigoSimule>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-signature-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    digigo = await digigoSimule();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_DIGIGO: digigo.base, SKANFACT_DIGIGO_CLE: digigo.cleIntegrateur }),
      port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await digigo?.fermer(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);

  it('Nadia désigne le signataire depuis le refus, puis signe la facture avec le code reçu ; le fichier signé se télécharge', async () => {
    const email = `nadia-signature-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', premier)).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    type Objet = { collection: string; cle: string; revision: number; rang: number | null; contenu: Record<string, unknown> };
    const tout = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const societe = tout.find((o) => o.collection === '_racine' && o.cle === 'company');
    const menuiserie = tout.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!menuiserie) throw new Error('client d\'exemple absent');
    // Soumise, les matricules complets ; FAC-2026-001 émise à la Menuiserie (son fichier écrit par le serveur).
    const client = { ...menuiserie.contenu, matricule: '1234567A/A/M/000' };
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, matricule: '7654321B/A/M/000', efacture: true } },
      { collection: 'clients', cle: menuiserie.cle, rang: menuiserie.rang, revision: menuiserie.revision, contenu: client },
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

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const nadia = await cn.newPage();
    const erreurs: string[] = [];
    nadia.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrirFacture = async () => {
      await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
      await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Facture FAC-2026-001/);
      await plusTard(nadia);
      await nadia.locator('#more-btn').click();
      await nadia.getByRole('button', { name: 'Signer (DigiGo)…', exact: true }).click();
      const f = nadia.locator('#modal-root .modal').last();
      await expect.poll(() => f.locator('h2').innerText()).toBe('Signer FAC-2026-001 avec DigiGo');
      return f;
    };

    // Personne n'est désigné : le refus le dit, et son bouton mène au réglage.
    let fenetre = await ouvrirFacture();
    await fenetre.getByRole('button', { name: 'Envoyer le code au signataire', exact: true }).click();
    await expect.poll(async () => net(await fenetre.locator('[role=alert]').innerText())).toBe('Personne n\'est désigné pour signer : pose l\'identifiant DigiGo du signataire dans Paramètres → Documents.');
    await nadia.screenshot({ path: path.join(PHOTOS, 'signature-1-sans-signataire.png') });
    expect((await admin.query('select count(*)::int n from ventes.signature_demande where entreprise = $1', [ent])).rows[0].n).toBe(0);
    await fenetre.getByRole('button', { name: 'Désigner le signataire', exact: true }).click();
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toBe('Paramètres');
    const panneau = nadia.locator('#signataire-panel');
    await expect.poll(async () => net(await panneau.locator('#sg-etat').innerText()), { timeout: 10_000 }).toBe('Personne n\'est désigné : les pièces ne peuvent pas encore être signées.');
    // Le bouton AMÈNE le réglage à l'écran : le champ du signataire est dans la fenêtre, sans défiler.
    const aLEcran = () => panneau.getByLabel('Identifiant DigiGo du signataire').evaluate((i) => { const r = i.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    await expect.poll(aLEcran, { timeout: 5_000 }).toBe(true);
    await nadia.waitForTimeout(1_700);
    expect(await aLEcran()).toBe(true);
    // … et le curseur y attend.
    expect(await panneau.getByLabel('Identifiant DigiGo du signataire').evaluate((i) => i === document.activeElement)).toBe(true);
    await nadia.screenshot({ path: path.join(PHOTOS, 'signature-2-reglage.png') });
    await panneau.getByLabel('Identifiant DigiGo du signataire').fill('09876543');
    // Le champ n'a pas de nom : il ne part pas dans la fiche, et ne propose pas d'enregistrer les Paramètres.
    expect(await nadia.locator('#save-bar').isHidden()).toBe(true);
    await panneau.getByRole('button', { name: 'Enregistrer le signataire', exact: true }).click();
    await expect.poll(async () => net(await panneau.locator('#sg-etat').innerText()), { timeout: 10_000 }).toMatch(/^Le signataire est 09876543, désigné le \d\d\/\d\d\/\d{4} à \d+ h \d\d par Nadia\.$/);
    expect((await api('GET', `/entreprises/${ent}/efacture/signataire`, jeton)).corps.signataire).toMatchObject({ identifiant: '09876543', posePar: 'Nadia' });
    const societeApres = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect(JSON.stringify(societeApres?.contenu)).not.toContain('09876543');
    await nadia.screenshot({ path: path.join(PHOTOS, 'signature-3-signataire.png') });

    // Le code part sur le téléphone de Nadia Ben Salah ; un code faux se retape.
    fenetre = await ouvrirFacture();
    await fenetre.getByRole('button', { name: 'Envoyer le code au signataire', exact: true }).click();
    await expect.poll(async () => net(await fenetre.locator('#sg-etape p:not([role=alert])').innerText())).toBe('Un code est parti sur le téléphone de Nadia Ben Salah. Tape-le ici :');
    const vrai = String(digigo.codeDe('09876543'));
    const champ = fenetre.getByLabel('Code reçu par le signataire');
    await champ.fill(vrai === '000000' ? '111111' : '000000');
    await fenetre.getByRole('button', { name: 'Signer', exact: true }).click();
    await expect.poll(async () => net(await fenetre.locator('[role=alert]').innerText())).toBe('Ce n\'est pas le code envoyé par DigiGo : il te reste 2 essais.');
    expect(await champ.evaluate((i) => i === document.activeElement)).toBe(true);
    await nadia.screenshot({ path: path.join(PHOTOS, 'signature-4-code-faux.png') });
    expect((await api('GET', `/entreprises/${ent}/dossier-v10/f1/teif`, jeton)).corps.signe).toBe(false);
    await champ.fill(vrai);
    await fenetre.getByRole('button', { name: 'Signer', exact: true }).click();
    await expect.poll(async () => net(await fenetre.locator('#sg-fait').innerText()), { timeout: 10_000 })
      .toMatch(/^La pièce FAC-2026-001 est signée par Nadia Ben Salah, le \d\d\/\d\d\/\d{4} à \d+ h \d\d\. Le fichier signé est celui qui se dépose à la TTN\.$/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'signature-5-signee.png') });

    // « Télécharger le fichier signé » : le fichier signé du serveur, tel quel ; il reste un geste.
    const signe = (await api('GET', `/entreprises/${ent}/dossier-v10/f1/teif`, jeton)).corps as { nom: string; xml: string; signe: boolean };
    expect(signe).toMatchObject({ nom: 'TEIF_7654321BAM000_FAC-2026-001_signe.xml', signe: true });
    const telechargement = nadia.waitForEvent('download');
    await fenetre.getByRole('button', { name: 'Télécharger le fichier signé', exact: true }).click();
    const recu = await telechargement;
    expect(recu.suggestedFilename()).toBe(signe.nom);
    expect(fs.readFileSync(await recu.path(), 'utf8')).toBe(signe.xml);
    expect(signe.xml).toContain('<ds:Signature');
    const pret = nadia.locator('#modal-root .modal').last();
    await expect.poll(() => pret.locator('h2').innerText()).toBe('Le fichier El Fatoora est prêt');
    expect(net(await pret.locator('p').first().innerText())).toBe(`${signe.nom} est dans tes Téléchargements. Il est signé par Nadia Ben Salah (DigiGo). Il reste un geste :`);
    expect(net(await pret.locator('.teif-suite').innerText())).toMatch(/^Le déposer sur la plateforme El Fatoora/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'signature-6-fichier.png') });

    // Signée, la pièce le dit dès qu'on rouvre « Signer (DigiGo)… » : aucun code ne part pour rien.
    await pret.getByRole('button', { name: 'Fermer', exact: true }).click();
    const demandes = Number((await admin.query('select count(*)::int n from ventes.signature_demande where entreprise = $1', [ent])).rows[0].n);
    fenetre = await ouvrirFacture();
    await expect.poll(async () => net(await fenetre.locator('#sg-fait').innerText()), { timeout: 10_000 })
      .toMatch(/^La pièce FAC-2026-001 est déjà signée par Nadia Ben Salah, le \d\d\/\d\d\/\d{4} à \d+ h \d\d\./);
    expect(await fenetre.getByRole('button', { name: 'Envoyer le code au signataire' }).count()).toBe(0);
    expect((await admin.query('select count(*)::int n from ventes.signature_demande where entreprise = $1', [ent])).rows[0].n).toBe(demandes);
    await nadia.screenshot({ path: path.join(PHOTOS, 'signature-7-deja-signee.png') });
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 180_000);
});
