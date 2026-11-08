// Les Factures, 1.308.0, jouées par le menuisier de Sfax (« Menuiserie El Amen ») : l'Hôtel Thyna paie ses portes en deux fois et
// garde sa retenue ; Ines, en retard, se relance ; le Café El Medina rend une chaise, l'avoir la retire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'factures-1308.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les factures 1.308.0 : encaisser, relancer, corriger', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-factures-1308-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'factures-1308.txt'), '');
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
  const C = ecranDeLaPlateforme('core.js') as Obj;
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const jm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  it('le menuisier de Sfax encaisse ses factures : l\'hôtel paie en deux fois avec sa retenue, Ines relancée, le café rend une chaise', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const hatem = await personne('hatem');
    const ent = String((await api('POST', '/entreprises-essai', hatem)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, hatem, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hatem)).corps.objets as Obj[];
    const piece = async (id: string) => ((await objets()).find((o) => o.collection === 'documents' && o.cle === id) ?? {}).contenu as Obj;
    await objets();
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hatem Kallel', name: 'Menuiserie El Amen', city: 'Sfax' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hatem, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe }] })).statut).toBe(200);
    const ligne = (label: string, qty: number, prix: number, unit = '') => ({ label, description: '', qty, unit, unitPrice: prix, vatRate: 19, discount: 0 });
    const clients = [
      { id: 'c1', name: 'Ines Ben Ammar', email: 'ines.benammar@exemple.tn', phone: '+216 98 123 457', city: 'Sfax' },
      { id: 'c2', name: 'Hôtel Thyna', matricule: '1234567B/A/M/000', email: 'achats@thyna.exemple.tn', phone: '+216 74 400 218', city: 'Sfax', withholdingRate: 1.5 },
      { id: 'c3', name: 'Café El Medina', email: 'cafe.elmedina@exemple.tn', phone: '+216 74 220 914', city: 'Sfax' },
    ];
    const facture = (id: string, clientId: string, subject: string, date: string, dueDate: string, lines: Obj[], extra: Obj = {}) => ({ id, type: 'facture', number: '', date, dueDate, clientId, subject,
      status: 'brouillon', lines, discountRate: 0, applyStamp: true, stampFee: 1, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], notes: '', ...extra });
    const factures = [
      facture('f1', 'c2', 'Portes des chambres 101 à 104', jourDe(-20), jourDe(10), [ligne('Porte en chêne, chambre', 4, 1250.375)], { withholdingRate: 1.5 }),
      facture('f2', 'c1', 'Dressing de la chambre', jourDe(-45), jourDe(-15), [ligne('Panneaux de chêne massif', 6, 185.5, 'm²'), ligne('Quincaillerie et coulisses', 1, 96.75), ligne('Pose sur place', 1, 420)]),
      facture('f3', 'c3', 'Mobilier de terrasse', jourDe(-3), jourDe(27), [ligne('Chaise de terrasse en frêne', 6, 145.25), ligne('Table ronde', 1, 380)]),
    ];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hatem, { changements: [
      ...clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: i, revision: null, contenu: enc(c) })),
      ...factures.map((f, i) => ({ collection: 'documents', cle: f.id, rang: i, revision: null, contenu: enc(f) })),
    ] })).statut).toBe(200);
    for (const [i, f] of factures.entries()) {
      const nap = C.computeTotals(f, societe).netToPay as number;
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, hatem, { document: enc(f), client: enc(clients.find((c) => c.id === f.clientId)), revision: 1, rang: i, netAPayer: nap.toFixed(3) });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
      noter('émise', f.id, JSON.stringify(e.corps).slice(0, 200), nap);
    }

    const cx = await contexte(hatem);
    await cx.addInitScript(() => {
      const clic = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.href.startsWith('mailto:')) { (window as unknown as { __mailto: string }).__mailto = this.href; return; }
        clic.call(this);
      };
    });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async (id: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/${id}`);
      await p.locator('#ed-geste').waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `factures-1308-${nom}.png`) });
    const fen = () => p.locator('#modal-root .modal').last();
    const pastille = () => p.locator('.ed-pill').first().innerText().then(net);
    const geste = async () => net(await p.locator('#ed-geste').innerText());
    const frise = async () => (await p.locator('#ed-frise li').allInnerTexts()).map(net);
    const gestes = async () => { await p.locator('#more-btn').click(); await p.waitForTimeout(400); const t = (await p.locator('[role=menu]').last().innerText().catch(() => '')); await p.keyboard.press('Escape'); return net(t); };

    // A. L'Hôtel Thyna paie ses portes en deux fois : un chèque de 2 000 DT, puis le reste par virement, sa retenue gardée.
    await ouvrir('f1');
    expect(await pastille()).toBe('Émise');
    expect(await geste()).toMatch(/^Enregistrer un paiement Rien de reçu · échéance le \d\d\/\d\d\. Un paiement partiel se note aussi\./);
    await photo('a-emise');
    await p.locator('#ed-geste #pay').click();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    expect(net(await fen().locator('#pf-rs').innerText())).toBe('Retenue de 89,277 DT gardée par le client Elle se compte avec ce paiement, en retenue subie de novembre 2026. L\'attestation se coche quand elle arrive.');
    await photo('a-fenetre');
    await fen().locator('[data-vite="partie"]').click();
    await fen().locator('[name=amount]').fill('2000');
    await fen().locator('[data-mode="cheque"]').click();
    await fen().locator('[name=reference]').fill('Chèque BNA n° 4471203');
    await p.waitForTimeout(300);
    expect(net(await fen().locator('#pf-rs').innerText())).toMatch(/^Retenue de 30,452 DT gardée par le client/);
    expect(net(await fen().locator('#ok').innerText())).toBe('Enregistrer · reste 3 863,508 DT');
    await photo('a-partie');
    await fen().locator('#ok').click();
    await p.waitForTimeout(800);
    if (await p.locator('#modal-root .modal').count()) { noter('A après ok', net(await fen().innerText())); await photo('a-apres-ok'); }
    await p.waitForTimeout(800);
    await expect.poll(pastille, { timeout: 10_000 }).toBe('Payée en partie');
    expect(await geste()).toMatch(/^Enregistrer un paiement 2 000,000 DT reçus, reste 3 863,508 DT · échéance le \d\d\/\d\d\./);
    expect((await frise())[4]).toBe('5 Payée en partie 2 000,000 sur 5 863,508 DT : pas encore');
    await photo('a-partielle');
    await p.locator('#ed-geste #pay').click();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    expect(net(await fen().locator('#pf-rs').innerText())).toMatch(/^Retenue de 58,825 DT gardée par le client/);
    await fen().locator('[data-mode="virement"]').click();
    await fen().locator('[name=reference]').fill('Virement BIAT du 07/11');
    await photo('a-fenetre-2');
    await fen().locator('#ok').click();
    await p.waitForTimeout(1500);
    if (await p.locator('#modal-root .modal').count()) noter('A après ok 2', net(await fen().innerText()));
    await expect.poll(pastille, { timeout: 10_000 }).toBe('Payée');
    expect(await toast(p)).toBe('FAC-2026-001 payée intégralement');
    expect(net(await p.locator('label:has(#rs-cert)').innerText())).toMatch(/^Attestation de retenue à la source reçue \(89,277 DT\)/);
    await photo('a-payee');
    await expect.poll(async () => ((await piece('f1')).payments as Obj[]).map((x) => [x.method, String(x.amount && typeof x.amount === 'object' ? x.amount['~n'] : x.amount)]), { timeout: 10_000 })
      .toEqual([['cheque', '2000'], ['virement', '3863.508']]);

    // B. Ines n'a rien payé de son dressing, échu depuis 15 jours.
    await ouvrir('f2');
    expect(await pastille()).toBe('En retard');
    expect(net(await p.locator('#ed-geste .btn-primary').innerText())).toBe('Relancer Ines Ben Ammar…');
    expect(await geste()).toBe('Relancer Ines Ben Ammar… Rien de reçu · en retard de 15 jours. Le rappel est prêt à partir ; un paiement arrivé se note à côté. Enregistrer un paiement Tous les gestes de la facture : ⋯ en haut à droite.');
    expect(net(await p.locator('#view .note-v').filter({ hasText: 'Rien de reçu' }).first().innerText())).toBe('Rien de reçu pour l\'instant. En retard de 15 jours : « Relancer » prépare le rappel.');
    expect(await gestes()).toContain('Relancer le rappel courtois, prêt à partir');
    await photo('b-retard');
    await p.locator('#ed-relancer').click();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    expect(net(await fen().locator('h2').innerText())).toBe('Relancer Ines Ben Ammar');
    // L'échéance est celle de la pièce (il y a 15 jours, à Tunis), jamais une date écrite le jour où le test l'a été.
    expect(await fen().locator('textarea[name=body]').inputValue()).toMatch(new RegExp(`^Bonjour,\\n\\nSauf erreur de notre part, la facture FAC-2026-002 \\(1\\s940,403\\sDT\\) arrivée à échéance le ${jourDe(-15).split('-').reverse().join('/')} reste en attente de règlement\\.`));
    await photo('b-relance');
    await fen().locator('#ok').click();
    await p.locator('#mf-envoye').click().catch(() => undefined);
    await p.waitForTimeout(1500);
    await expect.poll(async () => ((await piece('f2')).reminders as Obj[] ?? []).map((x) => [x.date, x.level, x.channel]), { timeout: 10_000 }).toEqual([[jourDe(0), 1, 'email']]);
    await expect.poll(geste, { timeout: 10_000 }).toBe(`Enregistrer un paiement Rien de reçu · en retard de 15 jours. Relancée le ${jm(jourDe(0))} : on attend sa réponse jusqu'au ${jm(jourDe(7))}. Un paiement partiel se note aussi. Tous les gestes de la facture : ⋯ en haut à droite.`);
    await photo('b-relancee');
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
    await p.waitForTimeout(3000);
    await plusTard(p);
    expect(net(await p.locator('#view').innerText())).toContain('Aucune facture à relancer aujourd\'hui : 1 relancée attend leur réponse.');
    await photo('b-relances');

    // C. Le Café El Medina rend une chaise abîmée : un avoir d'une chaise.
    await ouvrir('f3');
    expect(await pastille()).toBe('Émise');
    await p.locator('#lock-credit').click();
    await p.waitForTimeout(1500);
    if (await p.locator('#modal-root .modal').count()) { noter('C fenêtre', net(await fen().innerText())); await photo('c-fenetre'); }
    noter('C après avoir', await p.evaluate(() => location.hash), net(await p.locator('#view').innerText()).slice(0, 3000));
    await photo('c-avoir');
    await p.locator('[data-motif="Retour de marchandise"]').click();
    const qte = (i: number) => p.locator(`#lines tr[data-i="${i}"] input[data-k="qty"]`);
    await qte(0).fill('1');
    await qte(0).press('Tab');
    await p.locator('#lines tr[data-i="1"] .row-menu-btn').click();
    await p.locator('.row-menu').getByRole('menuitem').filter({ hasText: 'Supprimer la ligne' }).click();
    await p.waitForTimeout(600);
    noter('C avoir rempli', net(await p.locator('#view').innerText()).slice(0, 2500), 'geste', await geste());
    await photo('c-avoir-rempli');
    await p.locator('#ed-geste #issue').click();
    await p.waitForTimeout(1200);
    noter('C émission avoir', net(await fen().innerText().catch(() => '')));
    await photo('c-emission-avoir');
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await fen().locator('#ok').click();
    await p.waitForTimeout(2500);
    await expect.poll(pastille, { timeout: 15_000 }).toBe('Avoir émis');
    expect(await geste()).toBe('Avoir émis sur FAC-2026-003 : il diminue ce que le client doit.');
    await photo('c-avoir-emis');
    await ouvrir('f3');
    // Le café n'a rien payé : l'avoir diminue ce qu'il doit, il ne « paie » rien.
    expect(await pastille()).toBe('Émise');
    expect(await geste()).toMatch(/^Enregistrer un paiement Rien de reçu, 172,848 DT retirés par avoir, reste 1 317,437 DT · échéance le \d\d\/\d\d\./);
    expect((await frise())[4]).toBe('5 Payée rien de reçu · reste 1 317,437 DT : pas encore');
    await photo('c-facture-apres');
    await p.locator('#ed-geste #pay').click();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    expect(net(await fen().locator('#ok').innerText())).toBe('Enregistrer · la facture sera payée');
    await fen().locator('[data-mode="especes"]').click();
    await fen().locator('#ok').click();
    await p.waitForTimeout(1500);
    await expect.poll(pastille, { timeout: 10_000 }).toBe('Payée');
    // D. Au Cabinet : la comptable lit le journal du client.
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/2026`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check().catch(() => undefined);
    await c.waitForTimeout(3000);
    const lignes = await c.evaluate(() => [...document.querySelectorAll('#c-livres tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()));
    noter('D journal', lignes);
    // La retenue naît à chaque paiement (4358), l'avoir recrédite le client, les espèces vont en caisse.
    expect(lignes).toContain('4358 Hôtel Thyna Retenue à la source subie FAC-2026-001 30,452 DT');
    expect(lignes).toContain('4358 Hôtel Thyna Retenue à la source subie FAC-2026-001 58,825 DT');
    expect(lignes.some((x) => x.startsWith(`brouillard ${jourDe(0).split('-').reverse().join('/')} VT AVO-2026-001 411 Café El Medina Avoir AVO-2026-001`) && x.includes('172,848 DT'))).toBe(true);
    expect(lignes).toContain('411 Café El Medina Règlement FAC-2026-003 — Café El Medina 1 317,437 DT');
    await c.screenshot({ path: path.join(PHOTOS, 'factures-1308-d-cabinet.png'), fullPage: true });
    noter('erreurs', erreurs);
    await cxC.close();
    await cx.close();
  }, 240_000);
});
