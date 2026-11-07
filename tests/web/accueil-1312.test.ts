// L'Accueil, 1.312.0, joué par la quincaillerie de Sousse (« Quincaillerie du Sahel ») un lundi matin : ce qu'on lui doit (une
// facture en retard payée en partie, l'atelier de Marseille en euros, l'hôtel qui ne paie plus), ce qu'elle doit (un avoir de
// fournisseur pas encore déduit, un transporteur en retard), ce qu'elle a facturé ce mois (un avoir de retour), ses devis.
// Chaque carte doit dire le chiffre de la page qu'elle ouvre, et le Cabinet le même chiffre d'affaires.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'accueil-1312.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('l\'accueil 1.312.0 : les chiffres du jour, ceux de chaque page', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-accueil-1312-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'accueil-1312.txt'), '');
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
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const C = ecranDeLaPlateforme('core.js') as Obj;
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const decaler = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  it('la quincaillerie de Sousse ouvre son accueil un lundi matin : chaque carte dit le chiffre de sa page, et le Cabinet le même chiffre d\'affaires', async () => {
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
    const auj = jourDe(0);
    const moisAvant = decaler(`${auj.slice(0, 8)}01`, -6);
    const ligne = (label: string, qty: number, prix: number, unit = '') => ({ label, description: '', qty, unit, unitPrice: prix, vatRate: 19, discount: 0 });
    const clients = [
      { id: 'c1', name: 'Bâtir Plus SARL', matricule: '1456789K/A/M/000', email: 'achats@batirplus.exemple.tn', phone: '+216 73 225 410', city: 'Sousse', withholdingRate: 1.5 },
      { id: 'c3', name: 'Café Boujaafar', matricule: '0987654L/A/M/000', email: 'cafe.boujaafar@exemple.tn', phone: '+216 73 226 118', city: 'Sousse' },
      { id: 'c4', name: 'Atelier Provence SARL', email: 'commandes@atelier-provence.exemple.fr', city: 'Marseille', currency: 'EUR' },
      { id: 'c5', name: 'Hôtel Marhaba', matricule: '1122334M/A/M/000', email: 'economat@marhaba.exemple.tn', city: 'Sousse' },
    ];
    const facture = (id: string, clientId: string, subject: string, date: string, dueDate: string, lines: Obj[], extra: Obj = {}) => ({ id, type: 'facture', number: '', date, dueDate, clientId, subject,
      status: 'brouillon', lines, discountRate: 0, applyStamp: true, stampFee: 1, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], notes: '', ...extra });
    const factures = [
      facture('f1', 'c1', 'Ciment et fer, chantier Khezama', decaler(auj, -50), decaler(auj, -20), [ligne('Ciment CPA 45, sac de 50 kg', 40, 18.75, 'sac'), ligne('Fer à béton HA 12, barre de 12 m', 12, 96.4, 'barre')], { withholdingRate: 1.5 }),
      facture('f2', 'c3', 'Robinetterie', auj, decaler(auj, 30), [ligne('Mitigeur évier inox', 3, 140)]),
      facture('f3', 'c4', 'Luminaires en fer forgé', moisAvant, decaler(moisAvant, 30), [{ ...ligne('Applique en fer forgé', 10, 85), vatRate: 0 }], { currency: 'EUR', exchangeRate: 3.35 }),
      facture('f4', 'c5', 'Serrures des chambres', decaler(auj, -200), decaler(auj, -170), [ligne('Serrure à carte', 12, 74.5)]),
      facture('f5', 'c1', 'Peinture, chantier Sahloul', auj, decaler(auj, 30), [ligne('Peinture acrylique blanche, seau de 25 kg', 30, 64.9, 'seau')], { withholdingRate: 1.5 }),
    ];
    const brouillon = facture('f6', 'c3', 'Colliers de serrage (à finir)', auj, decaler(auj, 30), [ligne('Collier inox 20-32 mm', 100, 1.85)]);
    const devis = (id: string, clientId: string, subject: string, date: string, dueDate: string, status: string, lines: Obj[]) => ({ id, type: 'devis', number: `DEV-${auj.slice(0, 4)}-0${id.slice(1)}`, date, dueDate, clientId, subject,
      status, emails: [{ date, kind: 'devis', to: 'x@exemple.tn' }], lines, discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1, notes: '' });
    const lesDevis = [
      devis('q1', 'c3', 'Sanitaires du café', decaler(auj, -3), decaler(auj, 27), 'envoyé', [ligne('Lavabo sur colonne', 2, 189), ligne('Urinoir céramique', 2, 145.5)]),
      devis('q2', 'c1', 'Carrelage, villa Hammam Sousse', decaler(auj, -45), decaler(auj, -15), 'envoyé', [ligne('Carrelage grès cérame 60 × 60', 120, 32.5, 'm²')]),
      devis('q3', 'c5', 'Douches des chambres', decaler(auj, -20), decaler(auj, 10), 'accepté', [ligne('Colonne de douche thermostatique', 6, 412)]),
    ];
    const fournisseurs = [
      { id: 's1', name: 'Céramique du Sahel SARL', matricule: '1234321B/A/M/000', city: 'Sousse', paymentTermsDays: 60, withholdingRate: 1.5 },
      { id: 's2', name: 'Ferramenta Milano S.r.l.', city: 'Milan', currency: 'EUR', paymentTermsDays: 30 },
      { id: 's3', name: 'Transport Ben Salah', matricule: '0765432P/A/C/000', city: 'Msaken', paymentTermsDays: 30 },
    ];
    const la = (label: string, qty: number, prix: number, vatRate = 19, unit = '') => ({ label, description: '', qty, unit, unitPrice: prix, vatRate, destination: 'charge' });
    const achat = (id: string, supplierId: string, number: string, date: string, dueDate: string, category: string, lines: Obj[], extra: Obj = {}) => ({
      id, kind: 'facture', number, date, dueDate, supplierId, category, currency: 'DT', exchangeRate: '', fees: 0, withholdingRate: 0, createdAt: Date.parse(`${date}T09:00:00+01:00`), attachments: [], payments: [], lines, ...extra });
    const achats = [
      achat('a1', 's1', 'CS-26-1187', decaler(auj, -20), decaler(auj, 40), 'Marchandises', [la('Faïence murale 25 × 40', 180, 11.65, 19, 'm²')], { withholdingRate: 1.5 }),
      achat('a2', 's2', 'FM-2026/0457', decaler(auj, -12), decaler(auj, 18), 'Marchandises', [la('Robinet laiton 1/2"', 250, 3.4, 0), la('Raccord rapide 3/4"', 400, 1.0, 0)], { currency: 'EUR', exchangeRate: 3.38 }),
      achat('a3', 's3', 'BS-702', decaler(auj, -60), decaler(auj, -30), 'Transport', [la('Livraison Sfax → Sousse, 3 rotations', 1, 675, 7)],
        { payments: [{ id: 'r3', date: decaler(auj, -28), amount: 300, method: 'virement', reference: 'Virement 3311' }] }),
      achat('a4', 's1', 'AV-CS-26-031', decaler(auj, -4), '', 'Marchandises', [la('Faïence cassée à la livraison, reprise', 20, 11.65, 19, 'm²')], { kind: 'avoir', withholdingRate: 1.5 }),
    ];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [
      ...clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: i, revision: null, contenu: enc(c) })),
      ...factures.map((f, i) => ({ collection: 'documents', cle: f.id, rang: i, revision: null, contenu: enc(f) })),
      { collection: 'documents', cle: brouillon.id, rang: 5, revision: null, contenu: enc(brouillon) },
      ...lesDevis.map((q, i) => ({ collection: 'documents', cle: q.id, rang: 6 + i, revision: null, contenu: enc(q) })),
      ...fournisseurs.map((s, i) => ({ collection: 'suppliers', cle: s.id, rang: i, revision: null, contenu: enc(s) })),
      ...achats.map((a, i) => ({ collection: 'purchases', cle: a.id, rang: i, revision: null, contenu: enc(a) })),
    ] })).statut).toBe(200);
    for (const [i, f] of factures.entries()) {
      const nap = C.computeTotals(f, societe).netToPay as number;
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, mourad, { document: enc(f), client: enc(clients.find((c) => c.id === f.clientId)), revision: 1, rang: i, netAPayer: nap.toFixed(C.decimalsFor(f.currency) as number) });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
      noter('émise', f.id, nap, C.computeTotals(f, societe).netHT);
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
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `accueil-1312-${nom}.png`), fullPage: true });
    const fen = () => p.locator('#modal-root .modal').last();
    const vue = async () => net(await p.locator('#view').innerText());

    // Bâtir Plus a versé 1 500 DT sur sa facture de ciment ; il rend 4 seaux de peinture (un avoir de ce mois).
    await aller('#/doc/f1', '#ed-geste');
    await p.locator('#ed-geste #pay').click();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    await fen().locator('[data-vite="partie"]').click().catch(() => undefined);
    await fen().locator('[name=amount]').fill('1500');
    await fen().locator('[data-mode="virement"]').click().catch(() => undefined);
    noter('paiement', net(await fen().innerText()));
    await fen().locator('#ok').click();
    await p.waitForTimeout(1500);
    if (await fen().count()) { noter('fenêtre après paiement', net(await fen().innerText())); await fen().getByRole('button', { name: /Enregistrer/ }).last().click().catch(() => undefined); }
    await aller('#/doc/f5', '#ed-geste');
    await p.locator('#lock-credit').click();
    await p.locator('[data-motif="Retour de marchandise"]').click();
    await p.locator('#lines tr[data-i="0"] input[data-k="qty"]').fill('4');
    await p.locator('#lines tr[data-i="0"] input[data-k="qty"]').press('Tab');
    await p.waitForTimeout(600);
    await p.locator('#ed-geste #issue').click();
    await fen().locator('#ok').waitFor();
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await fen().locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#ed-geste').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^Avoir émis/);

    // A. L'accueil, le matin : quatre chiffres, et ce qui presse.
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const mois = MOIS[Number(auj.slice(5, 7)) - 1] ?? '', avant = MOIS[Number(moisAvant.slice(5, 7)) - 1] ?? '', an = auj.slice(0, 4);
    const carte = async (k: string) => net(await p.locator(`[data-stat="${k}"]`).innerText());
    await aller('#/dashboard', '[data-stat]');
    expect(await carte('encaisser')).toBe('On te doit 7 129,107 DT · 5 factures dont 1 800,916 en retard');
    expect(await carte('dois')).toBe('Tu dois 6 832,138 DT · 3 achats, avoir déduit dont 422,250 en retard');
    expect(await carte('ca-mois')).toBe(`Facturé en ${mois} 2 107,400 DT HT · 2 509,806 TTC ${avant} : 2 847,500`);
    expect(await carte('devis')).toBe('Devis en attente 796,110 DT TTC · 1 devis + 1 expiré sans réponse');
    expect(net(await p.locator('.a-phrase').innerText())).toBe('2 choses coûtent maintenant, 6 gestes t\'attendent.');
    const afaire = (await p.locator('#todo-list > li').allInnerTexts()).map(net);
    expect(afaire).toContain('2 factures en retard 1 800,916 DT à récupérer · plus ancienne : 170 jours de retard Voir les relances');
    expect(afaire).toContain('1 facture fournisseur en retard 422,250 DT à régler · la plus ancienne : 30 jours de retard Voir les achats');
    const annee = /(\d{4}) : ([\d  ,]+) DT HT/.exec(net(await p.locator('.a-graph .a-bloc-t').innerText()));
    expect(annee?.[1]).toBe(an);
    noter('à faire', afaire, 'année', annee?.[2]);
    await photo('a-accueil');

    // B. « On te doit » : la liste des factures dit les deux factures en retard (l'hôtel, et le ciment payé en partie).
    await p.locator('[data-stat="encaisser"]').click();
    await p.locator('#lf-tuiles').waitFor();
    await plusTard(p);
    expect(net(await p.locator('#lf-tuiles [data-tuile="à encaisser"]').innerText())).toContain('À encaisser · 5 factures, toutes années 7 129,107 DT 5 328,191 à échoir 1 800,916 en retard');
    expect(net(await p.locator('#lf-tuiles [data-tuile="retard"]').innerText())).toBe('En retard · 2 factures 1 800,916 DT 1 à 30 j 736,056 31 à 60 j — plus de 60 j 1 064,860');
    await p.locator('#lf-tuiles [data-tuile="retard"]').click();
    await expect.poll(async () => (await p.locator('#list-wrap tbody tr.clickable .num').allInnerTexts()).map(net)).toEqual([expect.stringMatching(/^FAC-\d{4}-001$/), expect.stringMatching(/^FAC-\d{4}-004$/)]);
    expect(await p.locator('#st option:checked').innerText()).toBe('En retard · 2');
    await p.locator('#list-wrap tr[data-id="f1"] [data-rowmenu]').click();
    expect(net(await p.locator('.row-menu').last().innerText())).toContain('Relancer');
    await photo('b-factures');
    await p.keyboard.press('Escape');
    await aller('#/relances');
    expect(await vue()).toContain('2 factures à relancer — 1 800,916 DT à récupérer');
    await aller('#/clients');
    await p.locator('#list-wrap tbody tr').first().waitFor();
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toContain('7 129,107 dont 1 800,916 en retard');

    // C. « Tu dois » : les trois achats qui restent à payer, et l'avoir de Céramique qui n'est encore déduit de rien.
    await aller('#/dashboard', '[data-stat]');
    await p.locator('[data-stat="dois"]').click();
    await p.locator('#f-note').waitFor();
    await plusTard(p);
    expect(net(await p.locator('#f-note').innerText())).toBe('3 sur 4 pièces');
    expect(net(await p.locator('.puces-f').innerText())).toContain('Tout ce qui reste à payer');
    expect(await p.locator('#lf-barre #st option:checked').innerText()).toBe('Tout ce qui reste à payer');
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toContain('7 105,249 dont 422,250 en retard');
    expect(net(await p.locator('#la-avoir').innerText())).toBe('Céramique du Sahel SARL te doit déjà 273,111 DT (un avoir déduit d\'aucune facture) : tu dois en fait 6 832,138 DT. Rattacher l\'avoir');
    await photo('c-achats');
    await p.locator('#la-rattacher').click();
    await expect.poll(() => p.url()).toMatch(/#\/achat\/a4$/);
    await aller('#/fournisseurs');
    await p.locator('#list-wrap tfoot').waitFor();
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toContain('6 832,138 dont 422,250 en retard');
    await aller('#/fournisseur/s1', '#ff-rs-compte');
    expect(net(await p.locator('.page-head .sous').first().innerText())).toContain('tu lui dois 2 184,888 DT');
    expect(net(await p.locator('#ff-rs-compte').innerText())).toBe('En le payant, tu garderas aussi 33,272 DT de retenue à la source pour l\'État : son compte chez ton comptable porte 2 218,160 DT.');

    // D. Le transporteur qu'on ne prend plus : archivé, il sort de la liste ; ce qu'on lui doit reste dans « Tu dois ».
    await aller('#/fournisseurs');
    await p.locator('#list-wrap tr[data-sid="s3"] [data-rowmenu]').click();
    await p.locator('.row-menu').last().getByRole('menuitem').filter({ hasText: 'Il sort de la liste ; ses pièces restent' }).click();
    await expect.poll(() => toast(p)).toContain('Tu lui dois encore 422,250 DT');
    await expect.poll(async () => net(await p.locator('#list-wrap tfoot').innerText())).toContain('6 409,888');
    expect(net(await p.locator('#lfo-arch').innerText())).toBe('Et 422,250 DT que tu dois encore à « Transport Ben Salah », archivé : ses pièces restent dans « À payer ».');
    await photo('d-fournisseurs');
    await aller('#/dashboard', '[data-stat]');
    expect(await carte('dois')).toBe('Tu dois 6 832,138 DT · 3 achats, avoir déduit dont 422,250 en retard');

    // E. « Facturé en … » ouvre le journal des ventes du mois : le même chiffre, avoir déduit.
    await p.locator('[data-stat="ca-mois"]').click();
    await expect.poll(vue).toContain(`CA HT — ${mois} ${an}`);
    expect(await vue()).toContain('2 107,400 DT 3 documents, avoirs déduits');

    // F. « Devis en attente » : le devis du café ; l'expiré, à côté.
    await aller('#/dashboard', '[data-stat]');
    await p.locator('[data-stat="devis"]').click();
    await expect.poll(async () => (await p.locator('#list-wrap tbody tr.clickable').allInnerTexts()).map(net)).toEqual([expect.stringContaining('Sanitaires du café')]);
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toContain('796,110');
    await aller('#/dashboard', '[data-stat]');
    await p.locator('#go-expired').click();
    await expect.poll(async () => (await p.locator('#list-wrap tbody tr.clickable').allInnerTexts()).map(net)).toEqual([expect.stringContaining('Carrelage, villa Hammam Sousse')]);

    // G. Au téléphone, les quatre chiffres se lisent sans se couper.
    const cxT = await contexte(mourad, 390, 844);
    const t = await cxT.newPage();
    t.on('pageerror', (e) => erreurs.push(`téléphone : ${e.message}`));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await t.locator('[data-stat]').first().waitFor({ timeout: 20_000 });
    await plusTard(t);
    await t.waitForTimeout(600);
    await plusTard(t);
    const debord = await t.locator('[data-stat]').evaluateAll((l) => l.filter((x) => x.scrollWidth > x.clientWidth + 1).length);
    expect(debord).toBe(0);
    await t.screenshot({ path: path.join(PHOTOS, 'accueil-1312-g-telephone.png'), fullPage: true });

    // H. Au Cabinet, Sonia ouvre la fiche du dossier : le chiffre d'affaires de l'année et du mois est celui de l'accueil ;
    // le compte de Céramique, dans la balance auxiliaire, est celui de sa fiche (l'avoir déduit, la retenue à opérer en plus).
    const cxC = await contexte(sonia);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}`);
    await c.locator('.fd-ch[role="group"]').waitFor({ timeout: 30_000 });
    expect(net(await c.locator('.fd-ch').innerText())).toContain(`CHIFFRE D'AFFAIRES ${an} ${annee?.[2]} DT`);
    expect(await c.locator('.fd-m-ca').evaluateAll((l) => l.map((x) => (x.getAttribute('title') || '').replace(/\s+/g, ' ')))).toContain(`Chiffre d'affaires HT ${/^[aeiouéèêh]/.test(mois) ? 'd\'' : 'de '}${mois} : 2 107,400 DT`);
    await c.screenshot({ path: path.join(PHOTOS, 'accueil-1312-h-cabinet.png'), fullPage: true });
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/balance/${an}`);
    await c.locator('#lv-brouillard').waitFor({ timeout: 30_000 });
    await c.locator('#lv-brouillard').check();
    await c.locator('button').filter({ hasText: /^Balance auxiliaire$/ }).first().click();
    await c.waitForTimeout(1500);
    await c.locator('select').filter({ has: c.locator('option[value="fournisseurs"]') }).first().selectOption('fournisseurs');
    const cellules = (sel: string) => c.locator(sel).evaluateAll((l) => l.map((tr) => [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    await expect.poll(async () => (await cellules('#c-livres tbody tr')).some((r) => r[0] === 'Céramique du Sahel SARL'), { timeout: 15_000 }).toBe(true);
    const aux = await cellules('#c-livres tbody tr');
    expect(aux.find((r) => r[0] === 'Céramique du Sahel SARL')).toEqual(['Céramique du Sahel SARL', '401', '277,270 DT', '2 495,430 DT', '', '2 218,160 DT']);
    expect(aux.find((r) => r[0] === 'Transport Ben Salah')?.[5]).toBe('422,250 DT');
    await c.screenshot({ path: path.join(PHOTOS, 'accueil-1312-h-auxiliaire.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 300_000);
});
