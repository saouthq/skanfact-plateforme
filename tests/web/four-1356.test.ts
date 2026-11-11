// Bout en bout 6 (1.356.2) : le four de la boulangerie (« Boulangerie El Amal »), joué à la souris puis tenu ici. Un achat de
// 21 420 DT en immobilisation, payé à moitié par chèque, sa fiche de bien, et le Cabinet qui le reçoit.
//   - la frise de l'achat garde « Au cabinet » quand le cabinet s'apprend APRÈS la page (un rechargement) ;
//   - un règlement partiel se dit dans l'en-tête et dans la frise, comme la liste le dit ;
//   - le prix unitaire d'un four (18 000) se lit en entier ; la fenêtre de la fiche du bien ne bouge pas sous le curseur et dit
//     « proposée pour la famille » d'une durée qu'on n'a pas changée ;
//   - au Cabinet, la ligne suivante au kilomètre ne s'invente pas le numéro « EBA-2612 » d'après la facture du fournisseur ;
//     une liste d'une fenêtre ne passe pas sous sa flèche ; la fiche rouverte retrouve la famille du bien du client.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'four-1356.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('bout en bout 1.356.2 : le four de la boulangerie, payé à moitié, jusqu\'au Cabinet', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-four-1356-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'four-1356.txt'), '');
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
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('la frise garde « Au cabinet », le règlement partiel se dit, la fiche du bien ne bouge pas, et le Cabinet ne s\'invente rien', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as Obj[];
    const auj = jourDe(0), Y = auj.slice(0, 4);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'accounts', cle: 'k-biat', rang: 0, revision: null, contenu: { id: 'k-biat', name: 'BIAT compte courant', kind: 'banque', bank: 'BIAT', rib: '', opening: 0, openingDate: `${Y}-01-01`, isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'suppliers', cle: 's-eba', rang: 0, revision: null, contenu: { id: 's-eba', name: 'Equipements Ben Ali', matricule: '1456789B/A/M/000', city: 'Sfax' } },
      // Le four, payé à moitié par chèque ; sa fiche de bien existe déjà (créée avec l'achat).
      { collection: 'purchases', cle: 'p-four', rang: 0, revision: null, contenu: enc({ id: 'p-four', kind: 'facture', number: 'EBA-2611', date: auj, dueDate: jourDe(30), supplierId: 's-eba', category: '',
        currency: 'DT', exchangeRate: '', fees: 0, withholdingRate: 0, createdAt: Date.now(), attachments: [],
        payments: [{ id: 'r1', date: auj, amount: 10710, method: 'cheque', reference: 'Chèque 0045821', accountId: 'k-biat' }],
        lines: [{ label: 'Four à sole 4 étages', description: '', qty: 1, unit: 'u', unitPrice: 18000, vatRate: 19, destination: 'immobilisation' }] }) },
      { collection: 'assets', cle: 'a-four', rang: 0, revision: null, contenu: enc({ id: 'a-four', label: 'Four à sole 4 étages', category: 'outillage', amount: 18000, date: auj, years: 5, residual: 0, purchaseId: 'p-four' }) },
    ] })).statut).toBe(200);

    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    // Le cabinet s'apprend APRÈS la page : la réponse « ce qui attend dans le fil » est retenue deux secondes, comme sur une
    // connexion lente — c'est l'ordre d'un rechargement.
    let retenir = true;
    await p.route('**/messages/attente*', async (r) => { if (retenir) await new Promise((ok) => setTimeout(ok, 2500)); await r.continue().catch(() => undefined); });
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/p-four`);
    await p.locator('#ed-frise').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const etapes = async () => p.locator('#ed-frise li').evaluateAll((xs) => xs.map((x) => (x.querySelector('b')?.textContent || '').trim()));
    // 1. « Au cabinet » paraît quand le cabinet s'apprend, sans recharger (avant : jamais, jusqu'au dessin suivant).
    await expect.poll(etapes, { timeout: 15_000 }).toEqual(['Reçue', 'Saisie', 'Justificatif', 'Réglée en partie', 'Au cabinet']);
    retenir = false;
    // 2. Payée à moitié : l'en-tête dit « Réglée en partie », la frise dit combien sur combien.
    expect(net(await p.locator('.ed-tete .ed-pill').innerText())).toBe(`Réglée en partie · échéance ${jourDe(30).slice(8, 10)}/${jourDe(30).slice(5, 7)}`);
    const regle = p.locator('#ed-frise li').nth(3);
    expect(await regle.getAttribute('class')).toBe('partiel');
    expect(net(await regle.locator('.ed-fr-txt > span').innerText())).toBe('10 710,000 sur 21 420,000 DT');
    // 3. Le prix d'un four se lit en entier dans sa case.
    const pu = p.locator('#b-lines input[data-k=unitPrice]').first();
    expect(await pu.inputValue()).toMatch(/^18000/);
    expect(await pu.evaluate((x) => x.scrollWidth - x.clientWidth)).toBeLessThanOrEqual(0);
    await p.screenshot({ path: path.join(PHOTOS, 'four-1356-1-achat.png') });
    // 3 bis. La fenêtre de la seconde moitié : un montant ne se sépare pas de son mot (« · reste » finissait une ligne).
    await p.locator('#ed-frise [data-frise="pay"]').click();
    const reglement = p.locator('#modal-root .modal').last();
    await reglement.locator('input[name=amount]').waitFor();
    const sous = await reglement.locator('p.small.muted').first().innerText();
    expect(sous).toContain('déjà réglé\u00a010\u00a0710,000');
    expect(sous).toContain('reste\u00a010\u00a0710,000');
    await reglement.locator('[data-close]').first().click();
    await reglement.waitFor({ state: 'detached' });

    // 4. Un second four, saisi neuf : la fenêtre de sa fiche ne bouge pas sous le curseur quand on choisit la famille, et une
    //    durée qu'on n'a pas changée se dit « proposée pour la famille » (pas « choisie par toi »).
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await p.locator('#ac-main').click({ timeout: 20_000 });
    if (!(await p.locator('#b-lines input[data-k=label]').count())) await p.locator('#add-line').click();
    // (1.356.3) « Pétrin » propose désormais sa famille : la désignation sans mot connu est un bac à levain.
    await p.locator('#b-lines input[data-k=label]').first().fill('Bac à levain inox 200 L');
    await p.locator('#b-lines input[data-k=unitPrice]').first().fill('9500');
    await p.locator('#b-lines select[data-k=destination]').first().selectOption('immobilisation');
    await p.locator('[data-fiche-mod="0"]').click({ timeout: 15_000 });
    const fen = p.locator('#modal-root .modal').last();
    await fen.locator('select[name=category]').waitFor();
    // Aucun mot ne dit la famille d'un bac à levain : pas de durée, et rien n'annonce une durée « proposée pour la famille ».
    expect(await fen.locator('select[name=category]').inputValue()).toBe('');
    expect(await fen.locator('input[name=years]').inputValue()).toBe('');
    expect(await fen.locator('#fb-prop').innerText()).toBe('');
    const hautOk = async () => fen.locator('#ok').evaluate((b) => Math.round(b.getBoundingClientRect().top));
    const avant = await hautOk();
    await fen.locator('select[name=category]').selectOption('outillage');
    await expect.poll(() => fen.locator('#fb-prop').innerText()).toBe('· proposée pour la famille');
    expect(await fen.locator('input[name=years]').inputValue()).toBe('5');
    expect(await hautOk()).toBe(avant);
    await fen.locator('#ok').click();
    await fen.waitFor({ state: 'detached' });
    const resume = net(await p.locator('.ac-fi-grille').first().innerText());
    expect(resume).toContain('5 ans · proposée pour la famille');
    expect(resume).not.toContain('choisie par toi');
    // (1.356.3) Le matériel du métier propose sa famille, par le mot qui vient le PREMIER (« Réfrigérateur de comptoir » est
    // un réfrigérateur, pas un comptoir), et la raison cite le mot entier de la désignation, pas la racine de la table.
    await p.locator('#add-line').click();
    await p.locator('#b-lines input[data-k=label]').nth(1).fill('Réfrigérateur de comptoir');
    await p.locator('#b-lines input[data-k=unitPrice]').nth(1).fill('4500');
    await p.locator('#b-lines select[data-k=destination]').nth(1).selectOption('immobilisation');
    await expect.poll(async () => net(await p.locator('.ac-fi-grille').nth(1).innerText().catch(() => '')), { timeout: 10_000 })
      .toContain('Outillage et matériel technique · proposée : le mot « réfrigérateur »');
    // On ne garde pas ce second achat.
    await p.evaluate(() => { location.hash = '#/achats'; });
    await p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click({ timeout: 10_000 }).catch(() => undefined);

    // 5. Le Cabinet. L'achat arrive au livre avec le numéro du fournisseur ; la ligne suivante, au kilomètre, ne propose pas
    //    « EBA-2612 » (le numéro d'une facture que ce fournisseur n'a jamais faite).
    await expect.poll(async () => (await admin.query(`select piece from compta.ecriture where entreprise = $1 and origine_type = 'achat'`, [ent])).rows.map((r) => r.piece).join(','), { timeout: 30_000 }).toBe('EBA-2611');
    const cxC = await contexte(leila);
    await cxC.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    // Une pièce de Sarra (la facture du gaz) attend dans la bande : sa fiche, face à la pièce, puis la ligne au kilomètre.
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const fichier = await api('POST', `/entreprises/${ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'facture-gaz.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: fichier.corps.id })).statut).toBe(201);
    // (1.356.3) Une seconde pièce, illisible (le cabinet l'a redemandée) : elle se traite face à la pièce, pas au kilomètre.
    const floue = await api('POST', `/entreprises/${ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'photo-floue.png', contenu: PNG });
    const msgFloue = await api('POST', `/entreprises/${ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: floue.corps.id });
    expect(msgFloue.statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/messages/${msgFloue.corps.id}/classee`, leila, { classee: true, raison: 'illisible' })).statut).toBeLessThan(300);
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/saisie/${Y}`);
    await c.locator('#sx-piece').waitFor({ timeout: 30_000 });
    expect(await c.locator('#sx-piece').inputValue()).toBe('');
    // On s'arrête d'abord, face à la pièce, sur la photo illisible : le kilomètre s'ouvre quand même sur celle qu'il saisit.
    await c.locator('[data-sx-k]').filter({ hasText: 'photo-floue' }).click({ timeout: 15_000 });
    await c.locator('[data-sx-mode="km"]').click();
    await c.locator('#sx-jm-piece').waitFor({ timeout: 20_000 });
    // Le compte dit lesquelles se saisissent ici (avant : « 2 pièces à traiter » au-dessus d'une grille qui n'en prend qu'une),
    // et le résumé des lots compte des CHOIX, pas des écritures.
    await expect.poll(async () => net(await c.locator('#sx-km-compte').innerText())).toBe('journal AC · 2 pièces à traiter · 1 se saisit ici, 1 face à la pièce');
    expect(net(await c.locator('#sx-km-d').innerText())).toContain('facture-gaz');
    expect(net(await c.locator('#sa-lot-plus summary').innerText({ timeout: 10_000 }))).toMatch(/^Valider un autre lot · \d+ choix, par journal ou par mois$/);
    expect(await c.locator('#sx-jm-piece').inputValue()).toBe('');
    expect(await c.locator('#sx-jm-piece').getAttribute('placeholder')).toBe('n° pièce');
    await c.screenshot({ path: path.join(PHOTOS, 'four-1356-2-kilometre.png') });

    // 6. La fiche du bien se reprend du client ; sa liste « Famille » laisse sa flèche hors du texte ; rouverte, elle retrouve
    //    la famille du bien du client (avant : « — », comme si elle s'était perdue).
    await c.goto('about:blank');
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/immobilisations/${Y}`);
    await c.locator('[data-creer]').click({ timeout: 30_000 });
    const f = c.locator('#modal-root .modal').last();
    await f.locator('select[name=famille]').waitFor();
    expect(await f.locator('select[name=famille]').inputValue()).toBe('outillage');
    expect(await f.locator('select[name=famille]').evaluate((x) => getComputedStyle(x).paddingInlineEnd)).toBe('30px');
    await f.locator('#ok').click();
    await f.waitFor({ state: 'detached', timeout: 15_000 });
    await c.locator('[data-rowmenu^="IM:"]').first().click({ timeout: 15_000 });
    await c.getByRole('menuitem').filter({ hasText: 'Modifier la fiche' }).click();
    await f.locator('select[name=famille]').waitFor();
    expect(await f.locator('select[name=famille]').inputValue()).toBe('outillage');
    await c.screenshot({ path: path.join(PHOTOS, 'four-1356-3-fiche.png') });
    noter('fin', { erreurs });
    expect(erreurs).toEqual([]);
    await cx.close(); await cxC.close();
  }, 240_000);
});
