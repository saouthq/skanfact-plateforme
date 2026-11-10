// Les Clients, 1.309.0, joués par la quincaillerie de Sousse (« Quincaillerie du Sahel ») : un client du bâtiment au-delà de son
// plafond et en retard, un particulier sans matricule, un café qui paie trop, un atelier de Marseille en euros, un hôtel qu'on archive.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'clients-1309.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les clients 1.309.0 : leurs fiches et leurs comptes', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clients-1309-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'clients-1309.txt'), '');
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

  it('la quincaillerie de Sousse tient ses clients : Bâtir Plus en retard au-delà de son plafond, Karim sans matricule, le café qui paie trop, l\'atelier de Marseille, l\'hôtel archivé', async () => {
    const sonia = await personne('sonia');
    const cab = await api('POST', '/cabinets', sonia, { nom: 'Cabinet Sahel Conseil' });
    const cabinet = String(cab.corps.id);
    const mourad = await personne('mourad');
    const ent = String((await api('POST', '/entreprises-essai', mourad)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, mourad, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, mourad)).corps.objets as Obj[];
    await objets();
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Mourad Gharbi', name: 'Quincaillerie du Sahel', city: 'Sousse' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe }] })).statut).toBe(200);
    const ligne = (label: string, qty: number, prix: number, unit = '') => ({ label, description: '', qty, unit, unitPrice: prix, vatRate: 19, discount: 0 });
    const clients = [
      { id: 'c1', name: 'Bâtir Plus SARL', matricule: '1456789K/A/M/000', contact: 'M. Slim Jaziri, gérant', email: 'achats@batirplus.exemple.tn', phone: '+216 73 225 410', city: 'Sousse', withholdingRate: 1.5, creditLimit: 6000 },
      { id: 'c2', name: 'Karim Trabelsi', phone: '+216 98 765 432', city: 'Msaken' },
      { id: 'c3', name: 'Café Boujaafar', matricule: '0987654L/A/M/000', email: 'cafe.boujaafar@exemple.tn', phone: '+216 73 226 118', city: 'Sousse' },
      { id: 'c4', name: 'Atelier Provence SARL', email: 'commandes@atelier-provence.exemple.fr', phone: '+33 4 91 55 21 07', city: 'Marseille', address: '12 rue de la République\n13001 Marseille, France', currency: 'EUR' },
      { id: 'c5', name: 'Hôtel Marhaba', matricule: '1122334M/A/M/000', email: 'economat@marhaba.exemple.tn', phone: '+216 73 241 900', city: 'Sousse' },
    ];
    const facture = (id: string, clientId: string, subject: string, date: string, dueDate: string, lines: Obj[], extra: Obj = {}) => ({ id, type: 'facture', number: '', date, dueDate, clientId, subject,
      status: 'brouillon', lines, discountRate: 0, applyStamp: true, stampFee: 1, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], notes: '', ...extra });
    const factures = [
      facture('f1', 'c1', 'Ciment et fer, chantier Khezama', jourDe(-50), jourDe(-20), [ligne('Ciment CPA 45, sac de 50 kg', 40, 18.75, 'sac'), ligne('Fer à béton HA 12, barre de 12 m', 12, 96.4, 'barre')], { withholdingRate: 1.5 }),
      facture('f2', 'c1', 'Carrelage, chantier Khezama', jourDe(-40), jourDe(-10), [ligne('Carrelage grès cérame 60 × 60', 85, 32.5, 'm²')], { withholdingRate: 1.5 }),
      facture('f3', 'c1', 'Peinture, chantier Sahloul', jourDe(-5), jourDe(25), [ligne('Peinture acrylique blanche, seau de 25 kg', 30, 64.9, 'seau')], { withholdingRate: 1.5 }),
      facture('f4', 'c3', 'Robinetterie', jourDe(-12), jourDe(18), [ligne('Mitigeur évier inox', 3, 140)]),
      facture('f5', 'c4', 'Luminaires en fer forgé', jourDe(-8), jourDe(22), [{ ...ligne('Applique en fer forgé', 10, 85), vatRate: 0 }], { currency: 'EUR', exchangeRate: 3.35 }),
      facture('f6', 'c5', 'Serrures des chambres', jourDe(-200), jourDe(-170), [ligne('Serrure à carte', 12, 74.5)]),
    ];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [
      ...clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: i, revision: null, contenu: enc(c) })),
      ...factures.map((f, i) => ({ collection: 'documents', cle: f.id, rang: i, revision: null, contenu: enc(f) })),
    ] })).statut).toBe(200);
    for (const [i, f] of factures.entries()) {
      const nap = C.computeTotals(f, societe).netToPay as number;
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, mourad, { document: enc(f), client: enc(clients.find((c) => c.id === f.clientId)), revision: 1, rang: i, netAPayer: nap.toFixed(C.decimalsFor(f.currency) as number) });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
      noter('émise', f.id, nap);
    }

    const cx = await contexte(mourad);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string, attendre = '#view h1') => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator(attendre).first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `clients-1309-${nom}.png`) });
    const fen = () => p.locator('#modal-root .modal').last();
    const vue = async () => net(await p.locator('#view').innerText());

    const noms = async () => (await p.locator('#list-wrap tbody tr .cl b').allInnerTexts()).map(net);
    const ligneDe = async (nom: string) => net(await p.locator('#list-wrap tbody tr').filter({ hasText: nom }).first().innerText());
    const tete = async () => net(await p.locator('.page-head .sous').first().innerText());
    const rs = async () => net(await p.locator('#cf-rs').innerText().catch(() => ''));

    // A. La liste : Bâtir Plus doit le plus, l'hôtel est en retard depuis le printemps ; Mourad cherche Karim par le numéro
    // qu'il a sur sa carte (« 98 765 »), le café n'en sort plus (son matricule 0987654L porte « 98 » et « 765 »).
    await aller('#/clients');
    await p.locator('#list-wrap tbody tr').first().waitFor();
    expect(await ligneDe('Bâtir Plus SARL')).toContain('7 758,296 dont 5 475,120 en retard');
    await photo('a-liste');
    await p.locator('#lf-filtres [data-f="retard"]').click();
    await expect.poll(noms).toEqual(['Bâtir Plus SARL', 'Hôtel Marhaba']);
    await p.locator('#lf-filtres [data-f=""]').click();
    await p.locator('#q').fill('98 765');
    await expect.poll(noms).toEqual(['Karim Trabelsi']);
    await p.locator('#q').fill('1456789');
    await expect.poll(noms).toEqual(['Bâtir Plus SARL']);
    await p.locator('#q').fill('');

    // B. Bâtir Plus : deux factures en retard, une à venir, au-delà de son plafond. Ce qu'il versera, et ce que porte son
    // compte chez la comptable (la retenue qu'il gardera en plus) : le chiffre que Sonia lira dans sa balance.
    await aller('#/client/c1');
    expect(await tete()).toContain('te doit 7 758,296 DT dont 5 475,120 DT en retard');
    expect(await rs()).toBe('En payant, il gardera aussi 118,101 DT de retenue à la source pour l\'État : son compte chez ton comptable porte 7 876,397 DT.');
    expect(net(await p.locator('.page-head .actions .btn-primary').innerText())).toBe('Lui envoyer son relevé · 2 en retard');
    expect(net(await p.locator('#cf-depasse').innerText())).toContain('7 758,296 DT pour 6 000,000 DT autorisés');
    await photo('b-fiche');

    // B2. Il rend 5 m² de carrelage cassé : l'avoir diminue son encours ; avant l'émission, rien ne dit qu'il le dépasse.
    await aller('#/doc/f2', '#ed-geste');
    await p.locator('#lock-credit').click();
    await p.locator('[data-motif="Retour de marchandise"]').click();
    await p.locator('#lines tr[data-i="0"] input[data-k="qty"]').fill('5');
    await p.locator('#lines tr[data-i="0"] input[data-k="qty"]').press('Tab');
    await p.waitForTimeout(600);
    expect(await vue()).toContain('Après cet avoir, FAC-');
    expect(await vue()).not.toContain('au-delà de ce qui est permis');
    await photo('b-avoir');
    await p.locator('#ed-geste #issue').click();
    await fen().locator('#ok').waitFor();
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await fen().locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#ed-geste').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^Avoir émis sur FAC-\d{4}-002 : il diminue ce que le client doit\.$/);
    await aller('#/client/c1');
    expect(await tete()).toContain('te doit 7 567,822 DT dont 5 284,646 DT en retard');
    expect(await rs()).toBe('En payant, il gardera aussi 115,200 DT de retenue à la source pour l\'État : son compte chez ton comptable porte 7 683,022 DT.');

    // C. Un nouveau client : Mourad tape le matricule de Bâtir Plus sans sa fin, en entier, puis celui d'un autre de ses
    // établissements ; enfin Nadia Gharbi, une particulière, avec son CIN.
    await aller('#/clients');
    await p.locator('#view .page-head #new').click();
    await fen().locator('input[name=name]').fill('Bâtir Plus');
    const aide = async (mf: string) => { await fen().locator('input[name=matricule]').fill(mf); return net(await fen().locator('#cf-mf-aide').innerText()); };
    expect(await aide('1456789K')).toBe('Même société que « Bâtir Plus SARL » (1456789K/A/M/000), et il manque la fin du matricule : un autre de ses établissements ? Sinon, ouvrir sa fiche.');
    expect(await aide('1456789 K/A/M/000')).toBe('Déjà la fiche de « Bâtir Plus SARL » · ouvrir sa fiche');
    expect(await aide('1456789K/B/M/001')).toBe('Même société que « Bâtir Plus SARL » (1456789K/A/M/000) : un autre de ses établissements ? Sinon, ouvrir sa fiche.');
    await photo('c-meme-societe');
    await fen().locator('input[name=name]').fill('Nadia Gharbi');
    expect(await aide('08123456')).toBe('');
    await fen().locator('input[name=phone]').fill('22 334 455');
    await fen().locator('#ok').click();
    await expect.poll(noms).toContain('Nadia Gharbi');
    expect(await ligneDe('Nadia Gharbi')).toContain('08123456');

    // D. Karim Trabelsi, un particulier sans matricule ni e-mail : la fiche le dit, et s'y complète.
    await aller('#/client/c2');
    expect(net(await p.locator('#cf-mf').innerText())).toMatch(/^Son matricule fiscal manque — /);
    expect(await rs()).toBe('');

    // E. Le Café Boujaafar paie 520 DT par chèque sa facture de 500,800 DT : prévenu avant, enregistré quand même.
    await aller('#/doc/f4', '#ed-geste');
    await p.locator('#ed-geste #pay').click();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    await fen().locator('[data-vite="partie"]').click().catch(() => undefined);
    await fen().locator('[name=amount]').fill('520');
    await fen().locator('[data-mode="cheque"]').click();
    expect(net(await fen().locator('#ok').innerText())).toBe('Enregistrer · un trop-perçu');
    await fen().locator('#ok').click();
    await expect.poll(async () => net(await fen().innerText().catch(() => ''))).toContain('Le montant (520,000 DT) dépasse le reste à payer (500,800 DT).');
    await fen().getByRole('button', { name: 'Enregistrer quand même' }).click();
    await expect.poll(() => toast(p)).toMatch(/^FAC-\d{4}-004 payée intégralement/);
    await aller('#/clients');
    await p.locator('#list-wrap tbody tr').first().waitFor();
    await expect.poll(() => ligneDe('Café Boujaafar')).toContain('19,200 en sa faveur');
    await aller('#/client/c3');
    expect(await tete()).toContain('19,200 DT en sa faveur');
    expect(net(await p.locator('#cf-trop').innerText())).toMatch(/^19,200 DT payés en trop sur FAC-\d{4}-004 — /);
    await photo('e-fiche');

    // F. Atelier Provence, à Marseille : ce qu'il doit dans sa devise d'abord.
    await aller('#/client/c4');
    expect(await tete()).toContain('te doit 850,30 EUR, soit 2 848,505 DT');
    await photo('f-fiche');

    // G. L'Hôtel Marhaba ne commande plus : Mourad l'archive ; il doit encore ses serrures, et le toast le dit.
    await aller('#/client/c5');
    await p.locator('.page-head .actions [data-rowmenu]').click();
    await p.locator('.row-menu').last().getByRole('menuitem').filter({ hasText: 'Archiver' }).click();
    await expect.poll(() => toast(p)).toBe('Hôtel Marhaba est archivé : il sort de la liste et des choix d\'une pièce ; ses documents restent. Il te doit encore 1 064,860 DT : ses factures restent dans les relances. Annuler');
    await photo('g-archive');
    await aller('#/clients');
    await p.locator('#list-wrap tbody tr').first().waitFor();
    expect(await noms()).not.toContain('Hôtel Marhaba');
    await aller('#/relances');
    expect(await vue()).toMatch(/FAC-\d{4}-006 Serrures des chambres Hôtel Marhaba/);

    // H. Au Cabinet, Sonia ouvre la balance auxiliaire des clients : le compte de Bâtir Plus est celui que la fiche annonce ;
    // la balance âgée range chaque facture selon son échéance (celle à 25 jours n'est pas échue, l'hôtel passe 90 jours).
    const cxC = await contexte(sonia);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    const an = jourDe(0).slice(0, 4);
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/balance/${an}`);
    await c.locator('#lv-brouillard').waitFor({ timeout: 30_000 });
    await c.locator('#lv-brouillard').check();
    await c.locator('button').filter({ hasText: /^Balance auxiliaire$/ }).first().click();
    const cellules = (sel: string) => c.locator(sel).evaluateAll((l) => l.map((tr) => [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    await expect.poll(() => c.locator('#c-livres tbody tr').count(), { timeout: 15_000 }).toBe(4);
    const aux = await cellules('#c-livres tbody tr');
    expect(aux.find((r) => r[0] === 'Bâtir Plus SARL')).toEqual(['Bâtir Plus SARL', '411', '7 876,397 DT', '193,375 DT', '7 683,022 DT', '']);
    expect(aux.find((r) => r[0] === 'Café Boujaafar')).toEqual(['Café Boujaafar', '411', '500,800 DT', '520,000 DT', '', '19,200 DT']);
    await c.screenshot({ path: path.join(PHOTOS, 'clients-1309-h-auxiliaire.png') });
    await c.evaluate((h) => { location.hash = h; }, `#/dossier/${ent}/comptabilite/lettrage/${an}`);
    const agee = c.locator('h2', { hasText: /^Ce qui reste dû, par ancienneté/ }).locator('xpath=..');
    await agee.waitFor({ timeout: 15_000 });
    const rangee = async (tiers: string) => (await agee.locator('tbody tr').filter({ hasText: tiers }).first().evaluate((tr) => [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    // Pas encore échu · 1 à 30 · 31 à 60 · 61 à 90 · plus de 90 · total. L'avoir d'aujourd'hui se déduit du « pas encore échu ».
    expect(await rangee('Bâtir Plus SARL')).toEqual(['Bâtir Plus SARL', '2 124,555 DT', '5 558,467 DT', '', '', '', '7 683,022 DT']);
    expect(await rangee('Atelier Provence SARL')).toEqual(['Atelier Provence SARL', '2 848,505 DT', '', '', '', '', '2 848,505 DT']);
    expect(await rangee('Hôtel Marhaba')).toEqual(['Hôtel Marhaba', '', '', '', '', '1 064,860 DT', '1 064,860 DT']);
    await c.screenshot({ path: path.join(PHOTOS, 'clients-1309-h-agee.png') });
    expect(erreurs).toEqual([]);
  }, 300_000);
});
