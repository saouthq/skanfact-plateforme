// Le mois d'un client vu des deux côtés, lot 1 (1.123.0 ; docs/revue-mois-client.md, recette du 23/10/2026). Sarra
// (Boulangerie El Amal) et son comptable Hatem (Cabinet Jlassi Conseil). Ce que le parcours vérifie, écran ET serveur :
//   - un seul vert : chez un cabinet neuf, « Accepter » la demande d'une entreprise, pas « Ajouter mes clients… » ; chez
//     l'entreprise, l'invitation partie, « Copier le lien », pas « Confier mon dossier » ;
//   - l'« À faire » de l'Accueil, ouvert par « #/ », dit la pièce que le cabinet attend ET sa date « pour le » ;
//   - la photo qui répond à une demande citant le numéro d'un achat déjà saisi se JOINT à cet achat (« Joindre à l'achat
//     GMS-26-4471… ») au lieu d'ouvrir un achat neuf ; chez le cabinet, « Voir l'écriture » remplace « Saisir cette
//     pièce » et mène au livre-journal sur ce numéro ;
//   - la liste des dossiers du cabinet dit d'une ligne aux écritures du mois au brouillard « à réviser », le point à
//     l'orange (1.169.0 : la liste de la maquette).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('le mois d\'un client vu des deux côtés, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-mois-client-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  type Corps = Record<string, unknown> & { id?: string; code?: string; mandat?: string };
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Corps };
  };
  const personne = async (prefixe: string, nom: string) => {
    const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const page = async (jeton: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { p, erreurs };
  };
  // L'assistant de démarrage d'une entreprise neuve (« Où te joindre ? », puis « Que fais-tu ? ») et les visites proposées.
  const plusTard = async (p: Page) => {
    await p.locator('#view h1, .as-ecran, [class*="assistant"]').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const passer = p.getByRole('button', { name: 'Je le ferai plus tard', exact: true });
    if (await passer.count()) await passer.first().click({ timeout: 3_000 }).catch(() => undefined);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
  const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  it('Sarra et Hatem : un seul vert, la date dans l\'« À faire », la photo jointe à l\'achat déjà saisi, le bandeau honnête', async () => {
    const hatem = await personne('hatem', 'Hatem Jlassi');
    const cab = (await api('POST', '/cabinets', hatem, { nom: 'Cabinet Jlassi Conseil' })).corps;
    const sarra = await personne('sarra', 'Sarra Mansour');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const autre = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Pâtisserie El Amal' })).corps.id);

    // Un seul vert, chez l'entreprise : l'invitation partie (ce serveur n'envoie pas d'e-mails), « Copier le lien » le prend.
    const s = await page(sarra);
    await s.p.bringToFront(); await s.p.goto(`${serveur.adresse}/v10/?e=${autre}#/compta`);
    await s.p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(s.p);
    await s.p.getByText('Cabinet', { exact: true }).first().click();
    await s.p.locator('#mandat-email').fill('nadia@cabinet-exemple.tn');
    await s.p.locator('#mandat-inviter-envoyer').click();
    await s.p.locator('#mandat-lien-copier').waitFor({ timeout: 15_000 });
    expect(await s.p.locator('#mandat-lien-copier').evaluate((b) => b.classList.contains('btn-primary'))).toBe(true);
    expect(await s.p.locator('#mandat-confier').evaluate((b) => b.classList.contains('btn-primary'))).toBe(false);

    // Un seul vert, chez un cabinet neuf : Sarra lui confie la boulangerie par son code ; « Accepter » est le vert.
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    const h = await page(hatem);
    // (1.124.0) Le mandat par le code ne confie pas la paie : le Cabinet ne la demande pas (point 12, un refus à chaque
    // ouverture du dossier).
    const paieRefusee: string[] = [];
    h.p.on('response', (r) => { if (r.status() === 403 && r.url().includes('/paie/')) paieRefusee.push(r.url()); });
    await h.p.bringToFront(); await h.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    await h.p.getByRole('button', { name: 'Accepter le dossier', exact: true }).waitFor({ timeout: 20_000 });
    expect(await h.p.getByRole('button', { name: 'Accepter le dossier', exact: true }).evaluate((b) => b.classList.contains('btn-primary'))).toBe(true);
    expect(await h.p.locator('#new-d').evaluate((b) => b.classList.contains('btn-primary'))).toBe(false);
    expect(await h.p.locator('#view .btn-primary:visible').count()).toBe(1);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, hatem)).statut).toBe(200);

    // Sarra ouvre sa boulangerie (comme tout le monde, avant d'y saisir quoi que ce soit) ; l'achat de la farine est saisi
    // ce mois-ci ; Hatem en demande la facture, pour après-demain.
    await s.p.bringToFront(); await s.p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await plusTard(s.p);
    await s.p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    const aujourdhui = jour(0);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Grands Moulins de Sfax' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1', kind: 'facture', number: 'GMS-26-4471', date: aujourdhui, supplierId: 's1', currency: 'DT', category: 'Matières premières', fees: 0, withholdingRate: 0, createdAt: 1,
        lines: [{ id: 'pl1', label: 'Farine T55, sacs de 50 kg', qty: 10, unitPrice: { '~n': '48.5' }, vatRate: 19, destination: 'charge' }] } },
    ] })).statut).toBe(200);
    const demande = await api('POST', `/entreprises/${ent}/messages`, hatem, { cote: 'cabinet', texte: '', demande: 'La facture GMS-26-4471 des Grands Moulins (farine)', pour: jour(2) });
    expect(demande.statut).toBe(201);

    // L'« À faire », l'Accueil ouvert par « #/ » : la pièce attendue ET sa date.
    // L'adresse ne change que de « # » : la page se recharge sur « #/ », comme un lien ou un favori.
    await s.p.bringToFront(); await s.p.goto(`${serveur.adresse}/v10/?e=${ent}#/`);
    await s.p.reload();
    await plusTard(s.p);
    expect(new URL(s.p.url()).hash).toBe('#/');
    await expect.poll(async () => net(await s.p.locator('#todo-list').innerText().catch(() => '')), { timeout: 20_000 })
      .toContain(`Ton cabinet attend 1 pièce Elle est attendue pour le ${fr(jour(2))}.`);

    // La photo répond à la demande : elle se joint à l'achat que la demande cite, sans ouvrir d'achat neuf.
    const fichier = await api('POST', `/entreprises/${ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'facture-farine.png', contenu: PNG });
    expect(fichier.statut, JSON.stringify(fichier.corps)).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: fichier.corps.id, repondA: demande.corps.id })).statut).toBe(201);
    await s.p.bringToFront(); await s.p.goto(`${serveur.adresse}/v10/?e=${ent}#/comptable`);
    const joindre = s.p.locator('[data-msg-joindre-achat]');
    await joindre.waitFor({ timeout: 20_000 });
    // (1.124.0) « Ce mois-ci » : l'achat du mois, encore sans justificatif ; rien de validé par le cabinet ; le bouton mène
    // à cet achat-là, et revenir le retrouve.
    const nomDuMois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Africa/Tunis' });
    const carte = s.p.locator('[data-msg-mois]');
    await expect.poll(async () => net(await carte.innerText().catch(() => '')), { timeout: 15_000 })
      .toBe(`Ce mois-ci · ${nomDuMois} Aucune vente · 1 achat, dont 1 sans justificatif. Ton cabinet n'a encore rien validé : 1 écriture attend au brouillard. Voir l'achat sans justificatif`);
    await carte.getByRole('button', { name: 'Voir l\'achat sans justificatif', exact: true }).click();
    await expect.poll(() => s.p.url(), { timeout: 15_000 }).toContain('#/achats');
    await expect.poll(async () => net(await s.p.locator('#view').innerText()), { timeout: 15_000 }).toContain('GMS-26-4471');
    await s.p.goBack();
    await joindre.waitFor({ timeout: 20_000 });
    expect(net(await joindre.innerText())).toMatch(/^Joindre à l'achat GMS-26-4471 · Grands Moulins de Sfax · 577,150\s?DT$/);
    await expect.poll(() => s.p.getByRole('button', { name: 'C\'est un autre achat…', exact: true }).count(), { timeout: 10_000 }).toBe(1);
    expect(await s.p.getByRole('button', { name: 'Ranger dans mes achats…', exact: true }).count()).toBe(0);
    await joindre.click();
    await expect.poll(async () => net(await s.p.locator('[data-msg-fil]').innerText()), { timeout: 15_000 }).toMatch(/rangée dans tes achats \(GMS-26-4471 · Grands Moulins de Sfax/);
    expect(s.p.url()).toContain('#/comptable');
    // Jointe, la photo sort l'achat des « sans justificatif », et le bouton s'en va.
    await expect.poll(async () => net(await carte.innerText().catch(() => '')), { timeout: 15_000 })
      .toBe(`Ce mois-ci · ${nomDuMois} Aucune vente · 1 achat. Ton cabinet n'a encore rien validé : 1 écriture attend au brouillard.`);
    await s.p.screenshot({ path: path.join(PHOTOS, 'mois-client-joindre.png') });
    // L'achat porte la photo ; il n'y a toujours qu'un achat.
    await s.p.bringToFront(); await s.p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/p1`);
    await expect.poll(async () => net(await s.p.locator('#attachments, #p-pj, [id*="pj"]').first().innerText().catch(() => '')), { timeout: 15_000 }).toContain('facture-farine.png');
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as { collection: string }[];
    expect(objets.filter((o) => o.collection === 'purchases').length).toBe(1);
    expect(s.erreurs).toEqual([]);

    // Chez Hatem : la photo rangée ne se saisit pas une seconde fois ; « Voir l'écriture » mène au livre-journal.
    // La page du cabinet a été ouverte avant l'acceptation : un changement d'adresse sans rechargement garderait sa liste.
    await h.p.bringToFront(); await h.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages/${ent}`); await h.p.reload();
    await h.p.locator('[data-msg-fil]').waitFor({ timeout: 20_000 });
    await expect.poll(() => h.p.getByRole('button', { name: 'Voir l\'écriture', exact: true }).count(), { timeout: 15_000 }).toBe(1);
    expect(await h.p.getByRole('button', { name: 'Saisir cette pièce', exact: true }).count()).toBe(0);
    await h.p.getByRole('button', { name: 'Voir l\'écriture', exact: true }).click();
    await expect.poll(() => h.p.url(), { timeout: 15_000 }).toContain(`#/dossier/${ent}/comptabilite/journal`);
    await expect.poll(() => h.p.locator('#lv-q').inputValue(), { timeout: 15_000 }).toBe('GMS-26-4471');

    // La liste des dossiers : le mois en cours a des écritures au brouillard ; la phrase et le point le disent.
    await h.p.bringToFront(); await h.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    await h.p.locator(`tr[data-id="${ent}"]`).waitFor({ timeout: 20_000 });
    // (1.169.0, la liste de la maquette) Le mois de la ligne dit « à réviser », son point à l'orange (pas « sans pièces »).
    await expect.poll(async () => net(await h.p.locator(`tr[data-id="${ent}"] .cd-mo-c`).innerText()), { timeout: 15_000 }).toMatch(/à réviser$/);
    expect(await h.p.locator(`tr[data-id="${ent}"] .ms-mo`).evaluate((d) => d.classList.contains('cours'))).toBe(true);
    await plusTard(h.p);
    await h.p.screenshot({ path: path.join(PHOTOS, 'mois-client-dossiers.png') });
    expect(h.erreurs).toEqual([]);
    expect(paieRefusee).toEqual([]);

    // Hatem valide le mois jusqu'à aujourd'hui : Sarra le lit dans « Ce mois-ci », à la date du jour.
    const valide = await api('POST', `/entreprises/${ent}/compta/valider`, hatem, { jusqua: aujourdhui });
    expect(valide.statut, JSON.stringify(valide.corps)).toBe(200);
    await s.p.bringToFront(); await s.p.goto(`${serveur.adresse}/v10/?e=${ent}#/comptable`);
    await expect.poll(async () => net(await s.p.locator('[data-msg-mois]').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe(`Ce mois-ci · ${nomDuMois} Aucune vente · 1 achat. Ton cabinet a validé tout le mois : 1 écriture (dernière validation le ${fr(aujourdhui)}).`);
    await s.p.screenshot({ path: path.join(PHOTOS, 'mois-client-ce-mois.png') });
    expect(s.erreurs).toEqual([]);
  }, 240_000);

  // (1.125.0) Points 7 et 8 : le cabinet sait seulement si l'achat du client a un justificatif (oui ou non, jamais le
  // fichier) ; il le réclame d'un geste depuis la ligne, la pièce écrite d'avance ; valider le dit avant.
  it('Hatem et les justificatifs : le 📎 du client, « sans justificatif », la demande écrite d\'avance, la validation qui prévient', async () => {
    const hatem = await personne('hatem', 'Hatem Jlassi');
    const cab = (await api('POST', '/cabinets', hatem, { nom: 'Cabinet Jlassi Conseil' })).corps;
    const sarra = await personne('sarra', 'Sarra Mansour');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, hatem)).statut).toBe(200);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    const aujourdhui = jour(0);
    const photo = await api('POST', `/entreprises/${ent}/pieces-jointes`, sarra, { nom: 'facture-farine.png', contenu: PNG });
    expect(photo.statut, JSON.stringify(photo.corps)).toBe(201);
    const fiche = { name: photo.corps.name, file: photo.corps.file, size: photo.corps.size, date: photo.corps.date };
    const achat = (id: string, numero: string, prix: string, pj: unknown[]) => ({ id, kind: 'facture', number: numero, date: aujourdhui, supplierId: 's1', currency: 'DT', category: 'Matières premières', fees: 0, withholdingRate: 0, createdAt: 1, attachments: pj,
      lines: [{ id: `${id}-l`, label: 'Farine', qty: 1, unitPrice: { '~n': prix }, vatRate: 19, destination: 'charge' }] });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Grands Moulins de Sfax' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: achat('p1', 'GMS-26-4471', '485', [fiche]) },
      { collection: 'purchases', cle: 'p2', rang: 1, revision: null, contenu: achat('p2', 'GMS-26-4502', '253.8', []) },
    ] })).statut).toBe(200);

    // Le serveur : oui pour l'achat qui porte sa photo, non pour l'autre ; rien de plus (ni le nom du fichier).
    const lues = (await api('GET', `/entreprises/${ent}/compta/ecritures`, hatem)).corps.ecritures as { piece: string; justificatif: boolean | null }[];
    expect(lues.map((e) => `${e.piece} ${e.justificatif}`).sort()).toEqual(['GMS-26-4471 true', 'GMS-26-4502 false']);
    expect(JSON.stringify(lues)).not.toContain('facture-farine');
    // (1.135.0) Le fichier lui-même, par l'écriture de son achat ; l'autre achat n'en a pas (0174).
    const ecr = (await api('GET', `/entreprises/${ent}/compta/ecritures`, hatem)).corps.ecritures as { id: string; piece: string }[];
    const justifs = async (piece: string) => (await api('GET', `/entreprises/${ent}/compta/ecritures/${ecr.find((e) => e.piece === piece)?.id}/justificatifs`, hatem)).corps.justificatifs as { nom: string }[];
    expect((await justifs('GMS-26-4471')).map((x) => x.nom)).toEqual(['facture-farine.png']);
    expect(await justifs('GMS-26-4502')).toEqual([]);

    // À l'écran du cabinet : le 📎 dit que le client l'a joint ; l'autre ligne dit « sans justificatif ».
    const h = await page(hatem);
    // (1.127.0) Point 9 : le Suivi du dossier ouvre sur « Ce mois-ci », les mêmes chiffres que chez le client, et son
    // seul vert mène au brouillard du mois.
    const nomDuMois = new Date(`${aujourdhui}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    await h.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/suivi`);
    const carte = h.p.locator('#d-ce-mois');
    await expect.poll(async () => net(await carte.innerText().catch(() => '')), { timeout: 20_000 }).toContain('rien n\'est encore validé');
    await plusTard(h.p);
    expect(net(await carte.innerText())).toMatch(new RegExp(`^Ce mois-ci · ${nomDuMois} Aucune vente · 2 achats, dont 1 sans justificatif, dans ses livres\\. 2 écritures attendent au brouillard : rien n'est encore validé\\. Valider les écritures d(e |')${nomDuMois} Voir le livre-journal d(e |')${nomDuMois} Demander le justificatif$`));
    expect(await h.p.locator('#view .btn-primary').filter({ visible: true }).allInnerTexts()).toEqual([expect.stringMatching(/^Valider les écritures d/)]);
    // (1.139.0) Hatem est seul au cabinet : personne à qui confier le dossier, le bloc n'est pas là.
    expect(await h.p.locator('#d-droits').count()).toBe(0);
    await h.p.screenshot({ path: path.join(PHOTOS, 'mois-client-suivi-ce-mois.png') });
    // (1.139.0, 1.188.0) « dont 1 sans justificatif » se réclame depuis la carte, sur place : la demande écrite d'avance ;
    // « Écrire plutôt dans la conversation » l'ouvre dans le fil, la pièce nommée.
    await carte.getByRole('button', { name: 'Demander le justificatif', exact: true }).click();
    const fen = h.p.locator('#modal-root .modal').last();
    await expect.poll(() => fen.locator('#dm-texte').inputValue().catch(() => ''), { timeout: 15_000 })
      .toBe(`Bonjour, un de tes achats d${/^[aeiou]/i.test(nomDuMois) ? '\'' : 'e '}${nomDuMois} est enregistré sans pièce dans SkanFact. Peux-tu m'en envoyer une photo ici ? Merci.`);
    await fen.getByRole('button', { name: 'Écrire plutôt dans la conversation' }).click();
    await expect.poll(() => h.p.url(), { timeout: 15_000 }).toContain(`#/messages/${ent}/demande`);
    await expect.poll(() => h.p.locator('#view textarea, #view input[type="text"]').evaluateAll((x) => x.map((e) => (e as HTMLInputElement).value).join(' | ')), { timeout: 15_000 })
      .toContain(`Le justificatif de ton achat d${/^[aeiou]/i.test(nomDuMois) ? '\'' : 'e '}${nomDuMois} enregistré sans pièce dans SkanFact`);
    await h.p.keyboard.press('Escape');
    await h.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/suivi`);
    await expect.poll(async () => net(await carte.innerText().catch(() => '')), { timeout: 20_000 }).toContain('rien n\'est encore validé');
    await carte.getByRole('button', { name: /^Valider les écritures/ }).click();
    await expect.poll(() => h.p.url(), { timeout: 15_000 }).toContain(`#/dossier/${ent}/comptabilite/saisie/`);
    await h.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/comptabilite/journal`);
    // Rien n'est encore validé : le livre propose de compter les deux écritures du brouillard.
    const brouillard = h.p.locator('label').filter({ hasText: /Compter 2 écritures en brouillard/ }).locator('input');
    await brouillard.waitFor({ timeout: 20_000 });
    await plusTard(h.p);
    if (!(await brouillard.isChecked())) await brouillard.click();
    const ligne = (piece: string) => h.p.locator('tr').filter({ hasText: piece }).first();
    await expect.poll(async () => net(await ligne('GMS-26-4502').innerText().catch(() => '')), { timeout: 15_000 }).toContain('GMS-26-4502 sans justificatif');
    expect(await ligne('GMS-26-4471').locator('.att-mark').getAttribute('title')).toBe('1 justificatif : joint par le client à son achat, dans SkanFact (il s\'ouvre depuis le menu de la ligne)');
    expect(await ligne('GMS-26-4471').getByText('sans justificatif').count()).toBe(0);
    // (1.135.0) Point 13 : le justificatif du client s'ouvre depuis la ligne, dans un onglet à son nom (il n'était que dans
    // le fil) ; l'achat sans justificatif n'offre rien à ouvrir.
    await ligne('GMS-26-4471').getByRole('button', { name: /^Actions/ }).click();
    const [onglet] = await Promise.all([h.p.context().waitForEvent('page', { timeout: 15_000 }), h.p.getByText('Ouvrir le justificatif du client', { exact: true }).click()]);
    await expect.poll(() => onglet.title(), { timeout: 15_000 }).toBe('facture-farine.png');
    expect(await onglet.locator('img').count()).toBe(1);
    await onglet.close();
    await h.p.keyboard.press('Escape');
    await ligne('GMS-26-4502').getByRole('button', { name: /^Actions/ }).click();
    expect(await h.p.getByText('Ouvrir le justificatif du client', { exact: true }).count()).toBe(0);
    await h.p.keyboard.press('Escape');

    // La validation de cette ligne le dit avant ; on annule.
    await ligne('GMS-26-4502').getByRole('button', { name: /^Actions/ }).click();
    await h.p.getByRole('menuitem', { name: /Valider cette écriture/ }).or(h.p.getByRole('button', { name: /Valider cette écriture/ })).first().click();
    await expect.poll(async () => net(await h.p.locator('#ecr-sans-justif').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Cet achat du client n\'a pas de justificatif. Tu peux valider quand même, ou le lui demander d\'abord (le menu de la ligne, « Demander le justificatif »).');
    await h.p.getByRole('button', { name: 'Annuler', exact: true }).click();

    // Le geste depuis la ligne (1.188.0) : la demande s'ouvre sur place, la pièce écrite d'avance ; envoyée, Sarra la voit.
    await ligne('GMS-26-4502').getByRole('button', { name: /^Actions/ }).click();
    await h.p.getByText('Demander le justificatif à Boulangerie El Amal', { exact: true }).click();
    await expect.poll(() => fen.locator('#dm-texte').inputValue().catch(() => ''), { timeout: 15_000 })
      .toBe(`Bonjour, l'achat GMS-26-4502 du ${fr(aujourdhui)} (Grands Moulins de Sfax) est enregistré sans sa facture. Peux-tu m'en envoyer une photo ici ? Merci.`);
    expect(await fen.locator('small').first().innerText()).toBe(`Le justificatif de l'achat GMS-26-4502 du ${fr(aujourdhui)} (Grands Moulins de Sfax)`);
    await h.p.screenshot({ path: path.join(PHOTOS, 'mois-client-demander-justificatif.png') });
    await fen.getByRole('button', { name: 'Envoyer la demande', exact: true }).click();
    await expect.poll(() => h.p.locator('#toast').innerText(), { timeout: 15_000 }).toMatch(/^Demande envoyée à Boulangerie El Amal dans votre conversation, pour le \d\d\/\d\d\.$/);
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages/attente`, sarra)).corps as { demandes?: number }).demandes, { timeout: 15_000 }).toBe(1);

    // La validation du lot (le journal des achats) le dit aussi, avec la pièce.
    await h.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/comptabilite/saisie`);
    await h.p.locator('[data-lot-journal="AC"]').click({ timeout: 20_000 });
    await expect.poll(async () => net(await h.p.locator('#lot-sans-justif').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Un achat du client n\'a pas de justificatif : GMS-26-4502. Tu peux valider quand même, ou le lui demander d\'abord (le menu de la ligne, « Demander le justificatif »).');
    // (1.131.0) Point 18 : validé quand même, le mois n'a plus rien au brouillard ; un message bref dit l'étape suivante,
    // sans fenêtre à fermer.
    await h.p.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect.poll(async () => net(await h.p.locator('#toast').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^2 écritures validées sous les n° \d+ à \d+\. Prochaine étape : la déclaration, dans « Déclarer et clôturer »\.$/);
    expect(await h.p.locator('#modal-root .modal').count()).toBe(0);
    expect(h.erreurs).toEqual([]);
  }, 240_000);

  // (1.126.0) Point 6 : le mandat confie la saisie des achats au cabinet ; la page Achats le dit, et son bouton principal
  // envoie la photo dans le fil du cabinet. Sans ce périmètre, la page redevient celle de qui saisit lui-même.
  it('Sarra a confié ses achats : la page le dit, la photo part chez Hatem, et plus rien quand le mandat ne les confie plus', async () => {
    const hatem = await personne('hatem', 'Hatem Jlassi');
    const cab = (await api('POST', '/cabinets', hatem, { nom: 'Cabinet Jlassi Conseil' })).corps;
    const sarra = await personne('sarra', 'Sarra Mansour');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, hatem)).statut).toBe(200);
    expect((await api('GET', `/entreprises/${ent}/messages/attente`, sarra)).corps).toMatchObject({ cabinet: cab.id, achatsConfies: true });

    const s = await page(sarra);
    await s.p.goto(`${serveur.adresse}/v10/?e=${ent}#/achats`);
    await plusTard(s.p);
    const vide = s.p.locator('.vide-utile');
    await expect.poll(async () => net(await vide.locator('h2').innerText().catch(() => '')), { timeout: 20_000 }).toBe('Ton cabinet saisit tes achats');
    // Un seul geste en vert : la photo (en haut et dans l'état vide) ; saisir soi-même reste là, sans couleur.
    const verts = s.p.locator('#view .btn-primary').filter({ visible: true });
    expect(await verts.allInnerTexts()).toEqual(['Envoyer une photo à mon comptable', 'Envoyer une photo à mon comptable']);
    expect(await vide.getByRole('button', { name: 'Saisir moi-même', exact: true }).count()).toBe(1);
    await s.p.screenshot({ path: path.join(PHOTOS, 'mois-client-achats-confies.png') });

    // La photo, choisie depuis l'état vide : elle part dans le fil du cabinet, avec son mot.
    const fichier = path.join(dossier, 'facture-huile.png');
    fs.writeFileSync(fichier, Buffer.from(PNG, 'base64'));
    const [choix] = await Promise.all([s.p.waitForEvent('filechooser'), vide.getByRole('button', { name: 'Envoyer une photo à mon comptable', exact: true }).click()]);
    await choix.setFiles(fichier);
    // (1.157.1, maquette achat « Confiée au cabinet ») La page qui suit la photo : envoyée, et ce qui vient ensuite.
    await expect.poll(async () => net(await s.p.locator('#view .ed-h1').innerText().catch(() => '')), { timeout: 15_000 }).toBe('Photo envoyée au cabinet Ton cabinet la saisit');
    expect(net(await s.p.locator('#view .ac-env-f').innerText())).toMatch(/^facture-huile\.png photo/);
    await s.p.evaluate(() => { location.hash = '#/achats'; });
    const messages = (await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, hatem)).corps.messages as { texte: string; fichier: { nom: string } | null }[];
    expect(messages.map((m) => `${m.texte} · ${m.fichier?.nom ?? '—'}`)).toContain('Une facture d\'achat à saisir : facture-huile.png · facture-huile.png');

    // Un achat déjà là (saisi par Sarra elle-même) : la liste, et en haut un seul vert, la photo ; la page le dit.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Huilerie du Sahel' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1', kind: 'facture', number: 'HS-118', date: jour(0), supplierId: 's1', currency: 'DT', fees: 0, withholdingRate: 0, createdAt: 1, attachments: [],
        lines: [{ id: 'p1-l', label: 'Huile d\'olive', qty: 3, unitPrice: { '~n': '41.275' }, vatRate: 19, destination: 'charge' }] } },
    ] })).statut).toBe(200);
    await s.p.reload();
    await s.p.locator('#list-wrap tr', { hasText: 'HS-118' }).waitFor({ timeout: 20_000 });
    expect(await verts.allInnerTexts()).toEqual(['Envoyer une photo à mon comptable']);
    expect(net(await s.p.locator('#achats-confies').innerText())).toBe('Tu as confié la saisie de tes achats à ton cabinet — envoie-lui la photo de chaque facture : il la saisit, elle arrive ici avec son justificatif. Tu peux aussi en saisir une toi-même.');

    // Le mandat ne confie plus les achats : la page redevient celle de qui saisit lui-même.
    // Sarra y revient par le menu, une fois le fil lu (« Mon comptable » au pied de la barre), comme chaque jour.
    expect((await api('PUT', `/entreprises/${ent}/mandat/perimetre`, sarra, { perimetre: ['comptabilite', 'declarations'] })).statut).toBe(200);
    await s.p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await s.p.reload();
    await s.p.locator('#foot-comptable').filter({ visible: true }).waitFor({ timeout: 20_000 });
    await plusTard(s.p);
    // Le lien du menu change l'adresse sans recharger la page : la même chose, sans dépendre d'une famille dépliée.
    await s.p.evaluate(() => { location.hash = '#/achats'; });
    await s.p.locator('#list-wrap tr', { hasText: 'HS-118' }).waitFor({ timeout: 20_000 });
    await expect.poll(() => verts.allInnerTexts(), { timeout: 15_000 }).toEqual(['Facture d\'achat']);
    expect(await s.p.locator('#photo-cab, #achats-confies').count()).toBe(0);
    expect(s.erreurs).toEqual([]);
  }, 240_000);
});
