// Bout en bout 7 (1.356.4) : un client professionnel, l'Hôtel Les Palmiers SA, joué à la souris puis tenu ici. La facture
// de la boulangerie à l'hôtel, avec sa retenue à la source à 1 %, et ce qu'elle a appris en chemin :
//   - la pastille « Retenue » suit les lignes : « 1 % · sous le seuil » sur une pièce vide, « 1 % · du client » une fois
//     la ligne posée (avant : elle gardait « sous le seuil » jusqu'au redessin suivant) ;
//   - la recherche d'article dit « Aucune prestation de ce nom » (pas « 0 article ») et « prix pour l'Hôtel… » ; le nom d'un
//     tiers s'élide (« Actions d'Hôtel… »), et un client qui règle le jour même ne « paie pas en 0 jour » ;
//   - l'adresse de la société manque à « Ta fiche » (avant : « matricule, RIB, adresse » en vert, sans adresse) ;
//   - « Compléter » mène aux Paramètres, et un bouton retour ramène à la facture, qu'il nomme avec son client ;
//   - un libellé de champ coule comme une phrase : la bulle part avec son dernier mot (`fl-lbl`) ;
//   - la liste des clients dit la devise du total « Te doit ».
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'hotel-1356.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('bout en bout 1.356.4 : la facture de l\'hôtel, ses mots et ses retours', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-hotel-1356-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'hotel-1356.txt'), '');
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('la pastille suit les lignes, les noms s\'élident, l\'adresse manque, et le retour ramène à la facture', async () => {
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as Obj[];
    const auj = jourDe(0);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    // La fiche de la société : tout, sauf l'adresse. Un seuil de retenue de 1 000 DT TTC (réglé sur la société).
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax', address: '',
      matricule: '1234567A/A/M/000', rib: '08001000000001234538', bank: 'BIAT', seuilRetenue: 1000 };
    const hotel = { id: 'c-hotel', name: 'Hôtel Les Palmiers SA', matricule: '1472583B/A/M/000', city: 'Hammamet', withholdingRate: 1 };
    const ancienne = { id: 'f-old', type: 'facture', number: '', date: auj, dueDate: jourDe(30), clientId: 'c-hotel', subject: 'Pain du petit-déjeuner',
      status: 'brouillon', lines: [{ label: 'Pain du petit-déjeuner', description: '', qty: 1, unit: '', unitPrice: 500, vatRate: 19 }], discountRate: 0,
      applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0, regimeTva: 'reel' };
    const neuve = { id: 'f-neuve', type: 'facture', number: '', date: auj, dueDate: jourDe(30), clientId: 'c-hotel', subject: '',
      status: 'brouillon', lines: [], discountRate: 0, applyStamp: true, withholdingRate: 1, currency: 'DT', exchangeRate: '', payments: [], regimeTva: 'reel' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-hotel', rang: 0, revision: null, contenu: hotel },
      { collection: 'catalog', cle: 'k-pain', rang: 0, revision: null, contenu: { id: 'k-pain', label: 'Panier de viennoiseries', unit: 'panier', unitPrice: 210, vatRate: 19 } },
      { collection: 'documents', cle: 'f-old', rang: 0, revision: null, contenu: ancienne },
      { collection: 'documents', cle: 'f-neuve', rang: 1, revision: null, contenu: neuve },
    ] })).statut).toBe(200);
    // Une première facture, émise et réglée le jour même : l'hôtel paie à l'émission.
    const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, sarra, { document: ancienne, client: hotel, revision: 1, rang: 0, netAPayer: '595.000' });
    expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    const f1 = (await objets()).find((o) => o.collection === 'documents' && o.cle === 'f-old') as Obj;
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [{ collection: 'documents', cle: 'f-old', rang: 0, revision: f1.revision,
      contenu: { ...(f1.contenu as Obj), payments: [{ id: 'r1', date: auj, amount: 595, method: 'virement' }] } }] })).statut).toBe(200);

    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f-neuve`);
    await p.locator('#ed-puces [data-etq="rs"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const pastille = async () => net(await p.locator('#ed-puces [data-etq="rs"]').innerText());
    // 1. Une pièce vide est sous le seuil ; le client paie le jour même (pas « en 0 jour »).
    expect(await pastille()).toBe('Retenue 1 % · sous le seuil');
    expect(net(await p.locator('.ed-chip').filter({ hasText: 'moyenne' }).innerText())).toBe('paie le jour même, en moyenne');
    // 2. Rien ne correspond : la liste le dit, et elle dit pour qui sont les prix, sans élision à deviner.
    await p.locator('#ed-ajout').click();
    await p.keyboard.type('zzz');
    const tete = p.locator('.aj-pop .aj-tete');
    // (1.356.5) Le mot suit le métier, comme la fenêtre qui crée : une société sans activité vend des prestations.
    await expect.poll(async () => net(await tete.innerText().catch(() => ''))).toBe('Aucune prestation de ce nom prix pour Hôtel Les Palmiers SA');
    expect(net(await p.locator('.aj-pop [data-aj-cr]').innerText())).toBe('Créer la prestation « zzz »…');
    // (1.357.1) Rien ne correspond : le choix surligné est celui qu'Entrée fera, la ligne libre (avant : « Créer … » surligné, et
    // Entrée ajoutait la ligne libre). La flèche monte sur « Créer … », et Entrée ouvre la fiche de la prestation, son nom repris.
    expect(await p.locator('.aj-pop .aj-libre.sel').count()).toBe(1);
    expect(await p.locator('.aj-pop [data-aj-cr].sel').count()).toBe(0);
    await p.keyboard.press('ArrowUp');
    await expect.poll(() => p.locator('.aj-pop [data-aj-cr].sel').count()).toBe(1);
    await p.keyboard.press('Enter');
    const ficheArticle = p.locator('#modal-root .modal').last();
    await ficheArticle.locator('input[name=label]').waitFor({ timeout: 10_000 });
    expect(await ficheArticle.locator('input[name=label]').inputValue()).toBe('zzz');
    expect(await p.locator('#lines tr[data-i]').count()).toBe(0);
    await ficheArticle.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    // (1.357.1) Un nom déjà au catalogue ne se propose pas à la création : ce serait un double.
    await p.locator('#ed-ajout').click();
    await p.keyboard.type('Panier de viennoiseries');
    await expect.poll(async () => net(await tete.innerText().catch(() => ''))).toBe('1 prestation prix pour Hôtel Les Palmiers SA');
    expect(await p.locator('.aj-pop [data-aj-cr]').count()).toBe(0);
    // 3. L'article choisi, six paniers : 1 260 HT, 1 499,400 TTC hors timbre — au-dessus du seuil. La pastille le suit tout de suite.
    await p.locator('#ed-ajout').fill('');
    await p.keyboard.type('Panier');
    await p.locator('.aj-pop [data-aj="0"]').click({ timeout: 10_000 });
    const qte = p.locator('#lines tr[data-i="0"] input[data-k=qty]');
    await qte.fill('6');
    await qte.press('Tab');
    await expect.poll(pastille, { timeout: 10_000 }).toBe('Retenue 1 % · du client');
    // 4. « Ta fiche » : l'adresse manque, et se dit (avant : « matricule, RIB, adresse » en vert).
    const avant = p.locator('li').filter({ hasText: 'Ta fiche' }).first();
    await expect.poll(async () => net(await avant.innerText())).toBe('Ta fiche : il manque l\'adresse Compléter');
    await p.screenshot({ path: path.join(PHOTOS, 'hotel-1356-1-facture.png') });
    // 5. « Compléter » mène aux Paramètres ; le bandeau compte l'adresse ; le retour nomme la facture ET son client, et y ramène.
    await p.locator('[data-avant="fiche"]').click();
    await p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click({ timeout: 3000 }).catch(() => undefined);
    await p.getByRole('button', { name: 'Enregistrer et continuer', exact: true }).click({ timeout: 2000 }).catch(() => undefined);
    await p.locator('#set-manque-zone').waitFor({ timeout: 20_000 });
    await expect.poll(async () => net(await p.locator('#set-manque-zone').innerText())).toContain('l\'adresse');
    const retour = p.locator('#view #back');
    await retour.waitFor({ timeout: 10_000 });
    expect(await retour.getAttribute('title')).toBe('Revenir à Facture (brouillon) — Hôtel Les Palmiers SA');
    await p.screenshot({ path: path.join(PHOTOS, 'hotel-1356-2-parametres.png') });
    await retour.click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/doc/f-neuve');
    // 5 bis. Une livraison offerte (une ligne à 0) avertit à l'émission ; « Compléter ma fiche… » s'ouvre sur la case de
    //    l'adresse (avant : une fenêtre sans aucune case, l'adresse comptant dans ce qui manque sans s'y saisir).
    await p.locator('#ed-ajout').waitFor({ timeout: 20_000 });
    await p.locator('#ed-ajout').click();
    await p.keyboard.type('Livraison offerte');
    await p.locator('.aj-pop [data-aj-libre]').click({ timeout: 10_000 });
    await p.locator('#issue').click();
    const emission = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await emission.locator('#em-avert').innerText().catch(() => ''))).toContain('La ligne « Livraison offerte » est à 0');
    await emission.locator('#em-fiche').click();
    const completer = p.locator('#modal-root .modal').last();
    await expect.poll(() => completer.locator('h2').innerText().catch(() => '')).toBe('Compléter ta fiche société');
    expect(await completer.locator('#cf textarea[name=address]').count()).toBe(1);
    await completer.locator('#cf textarea[name=address]').fill('12 rue de la Liberté\n8000 Nabeul');
    await completer.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root h2').filter({ hasText: 'Compléter ta fiche société' }).count()).toBe(0);
    await p.locator('#modal-root .modal').last().locator('[data-close]').first().click();
    await expect.poll(async () => net(await avant.innerText())).toBe('Ta fiche : matricule, RIB, adresse');
    // 6. La fiche du client : chaque libellé à bulle coule comme une phrase, et sa bulle part avec son dernier mot.
    await p.locator('#ed-puces').waitFor({ timeout: 20_000 });
    await p.getByRole('button', { name: 'Fiche', exact: true }).first().click({ timeout: 10_000 });
    const fen = p.locator('#modal-root .modal').last();
    await fen.locator('input[name=name]').waitFor();
    const libelles = await fen.locator('.fl-lbl').evaluateAll((xs) => xs.map((x) => ({
      t: (x.textContent || '').replace(/\s+/g, ' ').trim(), d: getComputedStyle(x).display,
      colle: [...x.querySelectorAll('button.i')].every((b) => !!b.parentElement && b.parentElement.classList.contains('colle-bulle')),
    })));
    expect(libelles.length).toBeGreaterThan(5);
    expect(libelles.filter((x) => x.d !== 'block' || !x.colle)).toEqual([]);
    expect(libelles.map((x) => x.t)).toContain('Sa retenue à la source i');
    await fen.locator('[data-close]').first().click();
    await p.getByRole('button', { name: /Abandonner|Quitter/ }).first().click({ timeout: 2000 }).catch(() => undefined);
    // 7. La liste des clients : le total « Te doit » dit sa devise, et le menu d'une ligne nomme le client avec l'élision.
    await p.evaluate(() => { location.hash = '#/clients'; });
    await p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click({ timeout: 3000 }).catch(() => undefined);
    await p.locator('.lc-table tfoot').waitFor({ timeout: 20_000 });
    const pied = await p.locator('.lc-table tfoot td').evaluateAll((xs) => xs.map((x) => (x.textContent || '').replace(/\s+/g, ' ').trim()));
    expect(pied[4]).toBe('0,000 DT');
    expect(await p.locator('.lc-table [data-rowmenu="c-hotel"]').getAttribute('aria-label')).toBe('Actions d\'Hôtel Les Palmiers SA');
    await p.screenshot({ path: path.join(PHOTOS, 'hotel-1356-3-clients.png') });
    noter('fin', { erreurs });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
