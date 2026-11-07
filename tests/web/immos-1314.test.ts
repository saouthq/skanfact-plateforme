// Les Immobilisations, 1.314.0, jouées par l'épicerie de Sfax (« Épicerie El Wafa ») : la vitrine réfrigérée achetée en mars
// (une ligne d'achat marquée « immobilisation »), la fiche créée depuis « À immobiliser », l'utilitaire acheté l'an passé,
// la vieille balance revendue. Le tableau des amortissements, la comptabilité et le Cabinet doivent dire les mêmes chiffres.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'immos-1314.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les immobilisations 1.314.0 : le matériel de l\'épicerie, vu de partout', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-immos-1314-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'immos-1314.txt'), '');
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

  it('l\'épicerie de Sfax tient son matériel : la vitrine achetée en mars, l\'utilitaire, la balance revendue, et le comptable lit le même plan', async () => {
    const sonia = await personne('sonia');
    const cab = await api('POST', '/cabinets', sonia, { nom: 'Cabinet Sfax Expertise' });
    const cabinet = String(cab.corps.id);
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[];
    await objets();
    // L'exercice joué est l'an passé (Y) : la vitrine achetée en mars, la balance revendue fin septembre ; la facture de la
    // revente part aujourd'hui. Les dates ne dépendent pas du jour où le test tourne.
    const an = jourDe(0).slice(0, 4);
    const Y = String(Number(an) - 1);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Nour Chaabane', name: 'Épicerie El Wafa', city: 'Sfax' };
    const la = (label: string, qty: number, prix: number, vatRate: number, destination: string) => ({ label, description: '', qty, unit: 'u', unitPrice: prix, vatRate, destination });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'accounts', cle: 'k-banque', rang: 0, revision: null, contenu: { id: 'k-banque', name: 'Banque de l\'Habitat', kind: 'banque', bank: 'BH', rib: '', opening: 0, openingDate: `${Y}-01-01`, isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'clients', cle: 'c-bs', rang: 0, revision: null, contenu: { id: 'c-bs', name: 'Épicerie Ben Salah', matricule: '1456789K/A/M/000', city: 'Sfax', email: '', phone: '' } },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Froid Sfax SARL', matricule: '1239876F/A/M/000', city: 'Sfax' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: enc({ id: 'p1', kind: 'facture', number: 'FS-118', date: `${Y}-03-10`, dueDate: `${Y}-03-10`, supplierId: 's1', category: 'Matériel',
        currency: 'DT', exchangeRate: '', fees: 0, withholdingRate: 0, createdAt: Date.parse(`${Y}-03-10T09:00:00+01:00`), attachments: [],
        payments: [{ id: 'r1', date: `${Y}-03-10`, amount: 5356, method: 'virement', reference: 'Virement 4471', accountId: 'k-banque' }],
        lines: [la('Vitrine réfrigérée 2 m', 1, 4500, 19, 'immobilisation')] }) },
      { collection: 'assets', cle: 'bal', rang: 0, revision: null, contenu: enc({ id: 'bal', label: 'Balance électronique', category: 'outillage', amount: 650, date: `${Number(Y) - 4}-06-01`, years: 5, residual: 0, notes: 'Achetée d\'occasion' }) },
      { collection: 'assets', cle: 'isuzu', rang: 1, revision: null, contenu: enc({ id: 'isuzu', label: 'Utilitaire Isuzu D-Max', category: 'transport', amount: 62000, date: `${Number(Y) - 1}-01-15`, years: 5, residual: 0 }) },
    ] })).statut).toBe(200);

    const cx = await contexte(nour);
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
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `immos-1314-${nom}.png`), fullPage: true });
    const vue = async () => net(await p.locator('#view').innerText());
    const modale = p.locator('.modal').last();

    // A. La vitrine : sa fiche se crée depuis « À immobiliser », mise en service le 15/03 (posée cinq jours après la facture).
    // L'aperçu du plan suit la date tapée (il gardait celui du 10/03 : 727,500 DT au lieu de 715,000).
    await aller('#/immos');
    await p.locator('#im-tabs button[data-tab=attente]').click();
    await p.locator('[data-mk="0"]').click();
    await modale.locator('select[name=category]').selectOption('outillage');
    expect(net(await modale.locator('#amort-hint').innerText())).toContain(`${Y} : 727,500 DT`);
    const dateDuBien = modale.locator('.datefield:has(input[name=date]) .d-txt');
    await dateDuBien.fill(`15/03/${Y}`);
    await dateDuBien.press('Tab');
    await expect.poll(async () => net(await modale.locator('#amort-hint').innerText())).toContain(`Plan sur 6 exercices — ${Y} : 715,000 DT · ${Number(Y) + 1} : 900,000 DT`);
    await modale.locator('#ok').click();
    await modale.waitFor({ state: 'detached' });

    // B. La balance revendue 120 DT le 30/09 à l'épicerie Ben Salah, puis sa facture, émise aujourd'hui.
    await aller('#/immo/bal', '#im-resume');
    await p.locator('#dispose').click();
    const dateDeSortie = modale.locator('.datefield:has(input[name=date]) .d-txt');
    await modale.locator('input[name=amount]').fill('120');
    await dateDeSortie.fill(`30/09/${Y}`);
    await dateDeSortie.press('Tab');
    // La valeur nette suit la date de sortie tapée en dernier (le même défaut que l'aperçu du plan).
    await expect.poll(async () => net(await modale.locator('#dsf-hint').innerText())).toContain(`Valeur nette comptable au 30/09/${Y} : 86,667 DT — plus-value de 33,333 DT.`);
    await modale.locator('input[name=reason]').fill('Revendue à l\'épicerie Ben Salah');
    await modale.locator('#ok').click();
    await modale.waitFor({ state: 'detached' });
    expect(net(await p.locator('#im-sortie').innerText())).toContain('Vendu 120,000 DT alors qu\'il valait encore 86,667 DT dans les comptes : plus-value de 33,333 DT.');
    await photo('b-balance');
    await p.locator('#im-facturer').click();
    await p.getByRole('button', { name: 'Garder le brouillon' }).waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(await p.locator('#view input, #view textarea').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).toContain('Cession : Balance électronique');
    await p.locator('#ed-pq-liste [role=option][data-cl]').filter({ hasText: 'Épicerie Ben Salah' }).first().click();
    await p.getByRole('button', { name: 'Émettre la facture', exact: true }).click({ timeout: 20_000 });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^FAC-\d{4}-\d{3}$/);
    const facture = (await p.locator('#view h1').first().innerText()).trim();

    // C. Le tableau de l'exercice : la balance sortie (sa dotation jusqu'au 30/09), l'utilitaire, la vitrine depuis le 15/03.
    const tableau = async () => {
      await aller('#/immos');
      await p.locator('#im-year').selectOption(Y);
      await p.waitForTimeout(300);
      return vue();
    };
    let t = await tableau();
    expect(t).toContain(`Valeur d'acquisition i 66 500,000 DT 2 biens à l'actif au 31/12/${Y} · 1 sorti en ${Y}`);
    expect(t).toContain(`Dotation ${Y} i 13 212,500 DT`);
    expect(t).toContain(`Vitrine réfrigérée 2 m Outillage et matériel technique 15/03/${Y} 5 ans 4 500,000 DT 0,000 DT 715,000 DT 715,000 DT 3 785,000 DT`);
    expect(t).toContain('Total 66 500,000 DT 12 383,611 DT 13 212,500 DT 25 032,778 DT 41 467,222 DT');
    await photo('c-tableau');
    await p.locator('#im-tabs button[data-tab=sorties]').click();
    expect(net(await p.locator('#im-body').innerText())).toContain(`30/09/${Y} Balance électronique Revendue à l'épicerie Ben Salah 650,000 DT 86,667 DT 120,000 DT 33,333 DT ${facture}`);
    // L'accueil : la revente est facturée, et la carte dit qu'elle n'est pas une vente du métier.
    await aller('#/dashboard');
    expect(net(await p.locator('#view').innerText())).toContain('120,000 DT HT · 143,800 TTC · dont 120,000 de revente d\'un bien');

    // D. Le Cabinet : les biens que le client tient dans son SkanFact, avec le plan qu'il voit. Ce qui sort vers lui est
    // compté : le plan et la sortie de chaque bien, la pièce de l'achat d'où il est né ; ni ses notes ni son fournisseur.
    const lus = (await api('GET', `/entreprises/${ent}/compta/immobilisations`, sonia)).corps.duClient as Obj[];
    expect(lus.map((b) => Object.keys(b).sort().join(','))).toEqual(Array(3).fill('achat,date,duree,famille,id,libelle,residuelle,sortie,valeur'));
    expect(lus.find((b) => b.id === 'bal')).toMatchObject({ valeur: '650', duree: '5', sortie: { date: `${Y}-09-30`, prix: '120', motif: 'Revendue à l\'épicerie Ben Salah' } });
    expect(String(lus.find((b) => b.libelle === 'Vitrine réfrigérée 2 m')?.achat)).toMatch(/^[0-9a-f-]{36}$/);
    const cxC = await contexte(sonia);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    const immos = async () => {
      await c.goto('about:blank');
      await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/immobilisations/${Y}`);
      await c.locator('#im-neuf').waitFor({ timeout: 30_000 });
      await c.locator('#im-client').waitFor({ timeout: 30_000 });
    };
    const ligneDuClient = (nom: string) => c.locator('#im-client tbody tr').filter({ hasText: nom });
    await immos();
    expect(net(await c.locator('#im-client h2').innerText())).toBe('Les biens tenus par Entreprise d\'essai de nour dans son SkanFact');
    expect(net(await ligneDuClient('Balance électronique').innerText())).toBe(`Balance électronique cédé le 30/09/${Y} 01/06/${Number(Y) - 4} 5 ans 650,000 DT 97,500 DT 0,000 DT Reprendre sa fiche…`);
    expect(net(await ligneDuClient('Utilitaire Isuzu D-Max').innerText())).toBe(`Utilitaire Isuzu D-Max 15/01/${Number(Y) - 1} 5 ans 62 000,000 DT 12 400,000 DT 37 682,222 DT Reprendre sa fiche…`);
    expect(net(await ligneDuClient('Vitrine réfrigérée 2 m').innerText())).toBe(`Vitrine réfrigérée 2 m 15/03/${Y} 5 ans 4 500,000 DT 715,000 DT 3 785,000 DT Reprendre sa fiche…`);
    // La ligne de l'achat au compte 22 : le client a déjà la fiche de ce bien, elle se reprend (un seul bouton vert).
    const ligneDuLivre = c.locator('[data-creer]');
    expect(await ligneDuLivre.innerText()).toBe('Reprendre la fiche du client…');
    expect(await c.locator('#c-livres .btn-primary, main .btn-primary').evaluateAll((xs) => xs.map((x) => (x as HTMLElement).innerText))).toEqual(['Reprendre la fiche du client…']);
    await c.screenshot({ path: path.join(PHOTOS, 'immos-1314-d-cabinet.png'), fullPage: true });
    const fen = c.locator('#modal-root .modal').last();
    const champs = async () => Object.fromEntries(await fen.locator('input[name], select[name]').evaluateAll((xs) => xs.map((x) => [(x as HTMLInputElement).name, (x as HTMLInputElement).value.replace(/\s+/g, ' ')])));
    const ajouter = async () => {
      await fen.locator('#ok').click();
      await fen.waitFor({ state: 'detached', timeout: 15_000 });
      await c.locator('#im-client').waitFor();
    };
    await ligneDuLivre.click();
    await fen.locator('#ok').waitFor();
    expect(await champs()).toMatchObject({ libelle: 'Vitrine réfrigérée 2 m', duree: '5', dateMiseEnService: `15/03/${Y}`, valeur: '4 500,000', compte: '22', compteDotation: '681', cessionDate: '' });
    expect(net(await fen.locator('#im-apercu').innerText())).toContain('6 exercices — première dotation 715,000 DT');
    // Le comptable nomme le bien à sa façon : il se reconnaît par l'achat d'où il est né, pas par son nom.
    await fen.locator('input[name=libelle]').fill('Vitrine froide (FS-118)');
    await ajouter();
    await ligneDuClient('Utilitaire Isuzu D-Max').locator('[data-reprendre]').click();
    expect(await champs()).toMatchObject({ duree: '5', dateMiseEnService: `15/01/${Number(Y) - 1}`, valeur: '62 000,000' });
    expect(net(await fen.locator('#im-apercu').innerText())).toContain(`Déjà amorti au 01/01/${Y} : 11 917,778 DT`);
    await ajouter();
    await ligneDuClient('Balance électronique').locator('[data-reprendre]').click();
    expect(await champs()).toMatchObject({ dateMiseEnService: `01/06/${Number(Y) - 4}`, valeur: '650,000', cessionDate: `30/09/${Y}`, cessionPrix: '120,000' });
    await ajouter();
    const registre = (nom: string) => async () => net(await ligneDuClient(nom).locator('td').last().innerText());
    for (const nom of ['Balance électronique', 'Utilitaire Isuzu D-Max', 'Vitrine réfrigérée 2 m']) await expect.poll(registre(nom)).toBe('même plan');
    expect(await c.locator('[data-creer]').count()).toBe(0);
    // Deux chemins, un chiffre : le tableau du comptable est celui du client, au millime.
    const pied = async () => net(await c.locator('.panel').filter({ has: c.locator('h2', { hasText: 'Les biens de l\'exercice' }) }).locator('tfoot').innerText());
    expect(await pied()).toBe('3 BIENS 66 500,000 DT 12 383,611 DT 13 212,500 DT 25 032,778 DT 41 467,222 DT');
    await c.screenshot({ path: path.join(PHOTOS, 'immos-1314-d-repris.png'), fullPage: true });

    // E. Le client change d'avis : la vitrine s'amortit sur 7 ans. Le Cabinet le voit, et reprend son plan d'un geste.
    const vitrine = String((await objets()).find((o) => o.collection === 'assets' && o.contenu.purchaseId === 'p1')?.cle);
    const duree = async (ans: string) => {
      await aller('#/immo/' + vitrine, '#im-resume');
      await p.locator('#edit-imm').click();
      await modale.locator('input[name=years]').fill(ans);
      await modale.locator('#ok').click();
      await modale.waitFor({ state: 'detached' });
    };
    await duree('7');
    await immos();
    expect(net(await ligneDuClient('Vitrine réfrigérée 2 m').innerText())).toBe(`Vitrine réfrigérée 2 m 15/03/${Y} 7 ans 4 500,000 DT 510,714 DT 3 989,286 DT plan différent 5 ans ici, 7 ans chez le client Reprendre son plan…`);
    await ligneDuClient('Vitrine réfrigérée 2 m').locator('[data-aligner]').click();
    expect(await champs()).toMatchObject({ libelle: 'Vitrine froide (FS-118)', duree: '7', dateMiseEnService: `15/03/${Y}` });
    expect(net(await fen.locator('#im-apercu').innerText())).toContain('8 exercices — première dotation 510,714 DT');
    await ajouter();
    await expect.poll(registre('Vitrine réfrigérée 2 m')).toBe('même plan');
    await expect.poll(pied).toBe('3 BIENS 66 500,000 DT 12 383,611 DT 13 008,214 DT 24 828,492 DT 41 671,508 DT');
    t = await tableau();
    expect(t).toContain('Total 66 500,000 DT 12 383,611 DT 13 008,214 DT 24 828,492 DT 41 671,508 DT');

    // F. Les écritures d'inventaire de l'exercice (trois dotations, la sortie de la balance) ; puis le client change encore
    // d'avis (6 ans) : le Cabinet le voit, mais une dotation écrite ne se recalcule pas en silence — le refus le dit.
    await c.locator('#im-ecrire').click();
    await expect.poll(() => toast(c)).toBe('4 écritures passées en brouillard.');
    await duree('6');
    await immos();
    await expect.poll(registre('Vitrine réfrigérée 2 m')).toBe('plan différent 7 ans ici, 6 ans chez le client Une dotation de ce bien est déjà passée : retire-la d\'abord de la Saisie pour reprendre son plan. Reprendre son plan…');
    await ligneDuClient('Vitrine réfrigérée 2 m').locator('[data-aligner]').click();
    await fen.locator('#ok').click();
    await expect.poll(() => toast(c)).toContain(`La dotation de ${Y} est déjà passée en écriture : ce changement la rendrait fausse.`);
    await c.screenshot({ path: path.join(PHOTOS, 'immos-1314-f-refus.png'), fullPage: true });

    // G. Le livre du comptable : la revente de la balance aux produits des cessions (775), pas aux ventes (706).
    const balance = async (annee: string) => {
      await c.goto('about:blank');
      await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/balance/${annee}`);
      await c.locator('#lv-brouillard').waitFor({ timeout: 30_000 });
      await c.locator('#lv-brouillard').check();
      await c.waitForTimeout(1200);
      return c.locator('#c-livres tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    };
    const lignesAn = await balance(an);
    expect(lignesAn.find((l) => l[0] === '775')).toEqual(['775', 'Produits des cessions d\'immobilisations', '0,000 DT', '120,000 DT', '', '120,000 DT']);
    expect(lignesAn.some((l) => String(l[0]).startsWith('70'))).toBe(false);
    const lignesY = await balance(Y);
    expect(lignesY.find((l) => l[0] === '681')?.[2]).toBe('13 008,214 DT');
    expect(lignesY.find((l) => l[0] === '675')?.[2]).toBe('86,667 DT');
    // Et le journal de l'entreprise elle-même : la même facture, au même compte.
    await aller('#/compta');
    await p.locator('#view button, #view a').filter({ hasText: /^Écritures$/ }).first().click();
    await p.waitForTimeout(1200);
    const journal = await vue();
    expect(journal).toContain('775 Produits des cessions d\'immobilisations 0,000 120,000 − 120,000');
    expect(journal).not.toMatch(/\b706 /);
    noter('erreurs', erreurs);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
