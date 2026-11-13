// Le contrat mensuel, 1.362.0 (bout en bout 25), joué par une pâtisserie de Tunis : l'Hôtel Mouradi, réglé à soixante jours
// sur sa fiche, reçoit chaque mois sa facture de viennoiseries ; la Maison Olivier, à Lyon, son pain en euros, à l'export.
// La bande « Générer », le message qui mène au brouillon, la ligne qui le dit, le menu qui l'ouvre, l'échéance de la fiche
// du client, la vente à l'exportation reprise du contrat, l'origine sur la facture émise, la fiche du contrat, la fenêtre qui
// défile avec une liste ouverte, et le Cabinet.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'contrat-mensuel-1362.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('le contrat mensuel 1.362.0 : la pâtisserie facture ses abonnements, jusqu\'au Cabinet', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-contrat-mensuel-1362-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'contrat-mensuel-1362.txt'), '');
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
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });


  it('l\'hôtel et la maison de Lyon : deux contrats, deux brouillons, la bonne échéance, l\'export, et le comptable lit les mêmes ventes', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const moisDecale = (n: number, jour = '01') => { const [a, m] = auj.split('-').map(Number) as [number, number]; const t = a * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-${jour}`; };
    // Les mois tels que l'application les écrit (« août 2026 », « d'août 2026 ») ; les dates comme l'écran les montre.
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const nomMois = (iso: string) => MOIS[Number(iso.slice(5, 7)) - 1] as string;
    const leMois = (iso: string) => `${nomMois(iso)} ${iso.slice(0, 4)}`;
    const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    const ligne = (label: string, qty: number, prix: number, unit = 'mois') => ({ id: `l-${label.length}`, label, description: '', qty, unit, unitPrice: prix, vatRate: 19, discount: 0 });
    const client = (id: string, name: string, extra: Obj = {}) => ({ collection: 'clients', cle: id, rang: 0, revision: null, contenu: enc({ id, name, city: 'Tunis', email: '', phone: '', ...extra }) });
    const contrat = (id: string, c: Obj) => ({ collection: 'recurring', cle: id, rang: 0, revision: null, contenu: enc({ id, active: true, day: 1, discountRate: 0, withholdingRate: 0, notes: '', lang: 'fr', currency: 'DT', exchangeRate: '', ...c }) });
    const plus = (n: number) => new Date(Date.parse(`${auj}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const FAC1 = `FAC-${auj.slice(0, 4)}-001`, FAC2 = `FAC-${auj.slice(0, 4)}-002`;
    const Mois = (iso: string) => { const m = leMois(iso); return m.charAt(0).toUpperCase() + m.slice(1); };
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Nour Jaziri', name: 'Pâtisserie Les Délices', city: 'Tunis', paymentTermsDays: 30 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      // L'hôtel est réglé à soixante jours sur sa fiche ; les réglages de la société disent trente.
      client('c-hot', 'Hôtel Mouradi Gammarth', { matricule: '1234567A/A/M/000', paymentTermsDays: 60 }),
      client('c-oli', 'Maison Olivier SARL', { city: 'Lyon', country: 'FR', currency: 'EUR' }),
      contrat('k-hot', { clientId: 'c-hot', every: 'month', subject: 'Viennoiseries du petit-déjeuner — {mois}', nextDate: moisDecale(0), lines: [ligne('Forfait viennoiseries, livraison quotidienne', 1, 1200)] }),
    ] })).statut).toBe(200);

    const cx = await contexte(nour, 1440, 760);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string, attendre = '#view h1') => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator(attendre).first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `contrat-mensuel-1362-${nom}.png`), fullPage: true });
    const vue = async () => net(await p.locator('#view').innerText());

    await aller('#/contrats');
    noter('==== A liste', (await vue()).slice(0, 1500));
    expect(net(await p.locator('#c-a-generer').innerText())).toContain('Générer le brouillon');

    // B. Le second contrat, à la souris : la Maison Olivier, à Lyon, en euros. La fenêtre défile (lignes, notes) ; ouvrir la
    // liste des clients la laisse défiler, et son pied reste dedans.
    await p.locator('#new').click();
    const fen = p.locator('#modal-root .modal').last();
    await fen.locator('[data-combo=clientId] .combo-btn').waitFor({ timeout: 10_000 });
    expect(await fen.evaluate((m) => m.scrollHeight > m.clientHeight + 1)).toBe(true);
    await fen.locator('[data-combo=clientId] .combo-btn').click();
    const mesure = await fen.evaluate((m) => ({ defile: m.classList.contains('defile'), overflow: getComputedStyle(m).overflowY,
      okBas: (m.querySelector('#ok') as HTMLElement).getBoundingClientRect().bottom, bas: m.getBoundingClientRect().bottom }));
    noter('==== B fenêtre et liste ouverte', mesure);
    expect([mesure.defile, mesure.overflow]).toEqual([true, 'auto']);
    expect(mesure.okBas).toBeLessThanOrEqual(mesure.bas + 1);
    await fen.locator('.combo-it').filter({ hasText: 'Maison Olivier SARL' }).first().click();
    // C. Un client à l'étranger : la case de l'export paraît, pas cochée (il n'a encore aucune facture).
    await expect.poll(() => fen.locator('#rf-export').isVisible()).toBe(true);
    expect(await fen.locator('input[name=export]').isChecked()).toBe(false);
    // L'invite de l'objet ne parle d'aucun métier (c'était « Entretien des portes » pour une pâtisserie).
    expect(await fen.locator('input[name=subject]').getAttribute('placeholder')).toBe('Ce que couvre le contrat — {mois}');
    await fen.locator('input[name=subject]').fill('Pain livré chaque matin — {mois}');
    // Première facture au 1er de ce mois : elle est due (le formulaire propose le mois prochain).
    await fen.locator('.datefield:has(input[name=nextDate]) .d-txt').fill(fr(moisDecale(0)));
    await fen.locator('.datefield:has(input[name=nextDate]) .d-txt').press('Tab');
    await fen.locator('input[name=exchangeRate]').fill('3,4');
    await fen.locator('#rl [data-k=label]').first().fill('Pain de mie, livraison quotidienne');
    await fen.locator('#rl [data-k=unitPrice]').first().fill('300');
    await fen.locator('#rl [data-k=unitPrice]').first().press('Tab');
    // Le total lit le taux comme il s'écrit (« 3,4 ») : il n'attend plus un taux déjà tapé.
    await expect.poll(async () => net(await fen.locator('#rl-total').innerText())).toContain('TTC par facture');
    expect(net(await fen.locator('#rl-total').innerText())).not.toContain('s\'affichera');
    // Cochée, la ligne passe à 0 % et sa TVA se grise ; le total dit qu'il n'y a ni TVA ni timbre.
    await fen.locator('input[name=export]').check();
    expect(await fen.locator('#rl select[data-k=vatRate]').first().isDisabled()).toBe(true);
    expect(await fen.locator('#rl select[data-k=vatRate]').first().inputValue()).toBe('0');
    expect(net(await fen.locator('#rl-total').innerText())).toBe('300,00 EUR HT · 300,00 EUR TTC par facture · sans TVA ni timbre (export)');
    await photo('b-contrat-export');
    await fen.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => (await objets()).find((o) => o.collection === 'recurring' && o.contenu.clientId === 'c-oli')?.contenu.export, { timeout: 15_000 }).toBe(true);
    const kOli = (await objets()).find((o) => o.collection === 'recurring' && o.contenu.clientId === 'c-oli') as Obj;
    expect([kOli.contenu.currency, kOli.contenu.lines.map((l: Obj) => Number(l.vatRate))]).toEqual(['EUR', [0]]);

    // D. Deux factures attendent : le vert est sur la bande, la question n'est pas rouge, et le message mène aux brouillons.
    await expect.poll(async () => net(await p.locator('#c-a-generer').innerText())).toContain('Générer les brouillons');
    expect(await p.locator('#gen-due').evaluate((b) => b.classList.contains('btn-primary'))).toBe(true);
    expect(await p.locator('#new').evaluate((b) => b.classList.contains('btn-primary'))).toBe(false);
    await p.locator('#gen-due').click();
    expect(await p.locator('#modal-root #ok').evaluate((b) => !b.classList.contains('btn-danger'))).toBe(true);
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => toast(p)).toContain('2 brouillons créés — à relire puis émettre');
    // E. Sans changer de page, chaque ligne dit son brouillon à émettre.
    await expect.poll(() => p.locator('#c-wrap [data-attente]').count()).toBe(2);
    await photo('e-liste');
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'documents' && o.contenu.recurringId).length, { timeout: 15_000 }).toBe(2);
    const brouillons = (await objets()).filter((o) => o.collection === 'documents' && o.contenu.recurringId);
    const bHot = brouillons.find((o) => o.contenu.recurringId === 'k-hot') as Obj, bOli = brouillons.find((o) => o.contenu.recurringId !== 'k-hot') as Obj;
    noter('==== E brouillons', brouillons.map((o) => ({ id: o.cle, ...o.contenu, lines: undefined })));
    // F. L'échéance de la facture du contrat est celle de la fiche du client (soixante jours), pas celle des réglages.
    expect([bHot.contenu.date, bHot.contenu.dueDate]).toEqual([auj, plus(60)]);
    expect(bOli.contenu.dueDate).toBe(plus(30));
    // G. La vente à l'exportation du contrat passe à sa facture : lignes à 0 %.
    expect([bOli.contenu.export, bOli.contenu.lines.map((l: Obj) => Number(l.vatRate))]).toEqual([true, [0]]);

    // H. Le menu de la ligne mène au brouillon à émettre.
    await p.locator('#c-wrap tbody tr').filter({ hasText: 'Hôtel Mouradi Gammarth' }).locator('[data-rowmenu]').click();
    const item = p.getByRole('menuitem', { name: /Ouvrir le brouillon à émettre/ });
    await item.waitFor({ timeout: 5_000 });
    expect(net(await item.innerText())).toContain(`${Mois(auj)}, à relire puis émettre`);
    await item.click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/doc/${bHot.cle}`);
    await p.locator('#ed-geste #issue').waitFor({ timeout: 20_000 });
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#modal-root').innerText())).toContain(`Échéance ${fr(plus(60))}`);
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await p.locator('#lecture-piece').waitFor({ timeout: 20_000 });
    noter('==== I facture de l\'hôtel émise', net(await p.locator('#lecture-piece').innerText()));
    // I. La facture émise dit le contrat d'où elle vient, et y mène.
    expect(net(await p.locator('#lecture-piece').innerText())).toContain(`Origine Le contrat Viennoiseries du petit-déjeuner · chaque mois · ${leMois(moisDecale(0))}`);
    expect(await p.locator('#lecture-piece a[href="#/contrat/k-hot"]').count()).toBe(1);
    await photo('i-facture-hotel');

    // J. La fiche du contrat lit ses factures par mois : ni « Type » ni l'objet entier.
    await aller('#/contrat/k-hot', '#view h1');
    const tetes = net(await p.locator('#c-docs thead').evaluate((t) => t.textContent || ''));
    noter('==== J fiche du contrat', tetes, net(await p.locator('#c-docs tbody').innerText()));
    expect(tetes).toMatch(/Numéro.*Période.*Date.*Statut.*Net à payer.*Reste/);
    expect(tetes).not.toMatch(/Type|Objet/);
    expect(net(await p.locator('#c-docs tbody tr').first().innerText())).toContain(`${FAC1} ${Mois(moisDecale(0))} ${fr(auj)}`);
    await photo('j-fiche');

    // K. La facture de Lyon, à l'export : sans timbre, et le taux s'écrit à trois décimales comme partout.
    await aller(`#/doc/${bOli.cle}`, '#ed-geste #issue');
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await p.locator('#lecture-piece').waitFor({ timeout: 20_000 });
    noter('==== K facture de Lyon émise', net(await p.locator('#lecture-piece').innerText()));
    expect(net(await p.locator('#lecture-piece').innerText())).toContain('300,00 € · sans timbre (export) · 1 € = 3,400 DT');

    // L. Dupliquer la facture de l'hôtel garde le délai de sa fiche.
    await aller('#/factures');
    await p.locator('#view tr').filter({ hasText: FAC1 }).first().locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Dupliquer/ }).click();
    await expect.poll(async () => (await objets()).find((o) => o.collection === 'documents' && o.contenu.clientId === 'c-hot' && !o.contenu.recurringId)?.contenu.dueDate, { timeout: 15_000 }).toBe(plus(60));

    // M. Un nouveau contrat pour Lyon : la case de l'export est proposée cochée, comme sa dernière facture.
    await aller('#/contrats');
    await p.locator('#new').click();
    const fen2 = p.locator('#modal-root .modal').last();
    await fen2.locator('[data-combo=clientId] .combo-btn').click();
    await fen2.locator('.combo-it').filter({ hasText: 'Maison Olivier SARL' }).first().click();
    await expect.poll(() => fen2.locator('input[name=export]').isChecked()).toBe(true);
    expect(await fen2.locator('#rl select[data-k=vatRate]').first().inputValue()).toBe('0');

    // N. Au Cabinet : la vente à l'export au 411 et au 706, sans TVA ni timbre ; celle de l'hôtel avec les siens.
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/${auj.slice(0, 4)}`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check().catch(() => undefined);
    await c.waitForTimeout(3000);
    const livre = await c.evaluate(() => [...document.querySelectorAll('#c-livres tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()));
    noter('==== N journal du Cabinet', livre);
    const export2 = livre.filter((x) => x.includes(FAC2));
    expect(export2.some((x) => /(^| )411 /.test(x) && x.includes('1 020,000 DT'))).toBe(true);
    expect(export2.some((x) => /(^| )706 /.test(x) && x.includes('1 020,000 DT'))).toBe(true);
    expect(export2.some((x) => /(^| )436[78] /.test(x))).toBe(false);
    expect(livre.filter((x) => x.includes(FAC1)).some((x) => /(^| )411 /.test(x) && x.includes('1 429,000 DT'))).toBe(true);
    await c.screenshot({ path: path.join(PHOTOS, 'contrat-mensuel-1362-n-cabinet.png'), fullPage: true });
    await cxC.close();
    noter('erreurs', erreurs);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
