// Le catalogue, 1.318.0, joué par une droguerie de l'Ariana (« Droguerie El Amen ») : la peinture qu'elle revend (suivie en
// stock), les brosses qu'elle revend sans les compter (proposées « prestation », elle corrige), la pose qu'elle facture à
// l'heure, le mastic qu'elle fait elle-même (suivi en stock : SkanFact propose « marchandise », elle dit « je le fabrique ») ;
// la facture de l'hôtel avec une remise de 5 % sur deux taux ; la peinture qu'elle ne veut plus vendre, qu'elle archive ; et
// sa comptable qui lit chaque vente à son compte (707, 706, 701), au millime de l'entreprise.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'catalogue-1318.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('le catalogue 1.318.0 : la droguerie, ce qu\'elle revend, ce qu\'elle fait, ce qu\'elle ne vend plus', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-catalogue-1318-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'catalogue-1318.txt'), '');
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

  it('la droguerie range ce qu\'elle vend, facture l\'hôtel, archive sa peinture, et sa comptable lit chaque vente à son compte', async () => {
    const ines = await personne('ines');
    const cab = await api('POST', '/cabinets', ines, { nom: 'Cabinet Ariana Audit' });
    const cabinet = String(cab.corps.id);
    const hedi = await personne('hedi');
    const ent = String((await api('POST', `/entreprises-essai`, hedi)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, hedi, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, ines)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hedi)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0), an = auj.slice(0, 4);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hédi Trabelsi', name: 'Droguerie El Amen', city: 'Ariana', activity: 'commerce', paymentTermsDays: 30 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'hotel', rang: 0, revision: null, contenu: { id: 'hotel', name: 'Hôtel Les Jasmins', matricule: '1456789K/A/M/000', city: 'Gammarth' } },
      { collection: 'catalog', cle: 'peint', rang: 0, revision: null, contenu: enc({ id: 'peint', label: 'Peinture murale blanche 10 L', unit: 'pot', unitPrice: 89, unitCost: 61, vatRate: 19, tracked: true, initialQty: 40, initialCost: 61, initialDate: '2026-01-01' }) },
      { collection: 'catalog', cle: 'brosse', rang: 1, revision: null, contenu: enc({ id: 'brosse', label: 'Brosse plate 50 mm', unit: 'u', unitPrice: 2.35, vatRate: 7 }) },
      { collection: 'catalog', cle: 'pose', rang: 2, revision: null, contenu: enc({ id: 'pose', label: 'Pose (main d\'œuvre)', unit: 'heure', unitPrice: 25, vatRate: 19 }) },
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'accounts', cle: 'k-banque', rang: 1, revision: null, contenu: { id: 'k-banque', name: 'Attijari Bank', kind: 'banque', bank: 'Attijari', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
    ] })).statut).toBe(200);

    const cx = await contexte(hedi);
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
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `catalogue-1318-${nom}.png`), fullPage: true });
    const modale = p.locator('.modal').last();
    const nature = () => modale.locator('#cat-nature');
    const texteChoisi = () => nature().evaluate((s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');

    // A. Les brosses, revendues sans être comptées : SkanFact les croit une prestation (706) ; Hédi dit « marchandise ».
    await aller('#/catalogue', '#list-wrap');
    await p.locator('#list-wrap tr[data-ouvrir="brosse"]').click();
    await expect.poll(texteChoisi).toBe('Une prestation (un service, un travail) · compte 706');
    await nature().selectOption('marchandises');
    await modale.locator('#ok').click();
    await modale.waitFor({ state: 'detached' });
    // La peinture, suivie en stock : marchandise d'office.
    await p.locator('#list-wrap tr[data-ouvrir="peint"]').click();
    await expect.poll(texteChoisi).toBe('Une marchandise que je revends telle quelle · compte 707');
    await modale.locator('[data-close]').first().click();
    await modale.waitFor({ state: 'detached' });
    // B. Le mastic qu'elle fabrique : une droguerie (un commerce) revend ce qu'elle vend, la fiche neuve propose la marchandise
    // (1.356.0 : le métier d'abord) ; « Suivi en stock » coché la garde ; elle choisit « je le fabrique », et la case qu'elle
    // décoche ensuite ne touche plus son choix.
    await p.locator('#new').click();
    await modale.locator('input[name=label]').fill('Mastic de la maison');
    await modale.locator('input[name=unitPrice]').fill('3.45');
    await expect.poll(() => nature().inputValue()).toBe('marchandises');
    await modale.locator('input[name=tracked]').check();
    await expect.poll(() => nature().inputValue()).toBe('marchandises');
    await nature().selectOption('produits');
    await modale.locator('input[name=initialQty]').fill('20');
    await modale.locator('input[name=tracked]').uncheck();
    await modale.locator('input[name=tracked]').check();
    expect(await nature().inputValue()).toBe('produits');
    await photo('a-mastic');
    await modale.locator('#ok').click();
    await modale.waitFor({ state: 'detached' });
    // L'enregistrement part au serveur après la fermeture de la fenêtre : on attend qu'il y soit (rouge GitHub de 1.319.0,
    // Node 22 : lu une seule fois, trop tôt, le mastic n'y était pas encore).
    const leCatalogue = async () => (await objets()).filter((o) => o.collection === 'catalog').map((o) => o.contenu as Obj);
    await expect.poll(async () => (await leCatalogue()).some((c) => c.label === 'Mastic de la maison'), { timeout: 15_000 }).toBe(true);
    const catalogue = await leCatalogue();
    const mastic = catalogue.find((c) => c.label === 'Mastic de la maison') as Obj;
    expect([catalogue.find((c) => c.id === 'brosse')?.nature, mastic.nature, mastic.tracked]).toEqual(['marchandises', 'produits', true]);

    // C. La facture de l'hôtel, remise de 5 % : trois pots, deux heures et demie de pose, sept tubes, quatre brosses.
    const ligne = (itemId: string, label: string, qty: number, unitPrice: number, vatRate: number) => ({ itemId, label, description: '', qty, unitPrice, vatRate });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      { collection: 'documents', cle: 'f-hotel', rang: 0, revision: null, contenu: enc({ id: 'f-hotel', type: 'facture', status: 'brouillon', date: auj, dueDate: jourDe(30), clientId: 'hotel',
        subject: 'Rafraîchissement du hall', createdAt: Date.now(), currency: 'DT', discountRate: 5, withholdingRate: 0, calcul: 2, payments: [],
        lines: [ligne('peint', 'Peinture murale blanche 10 L', 3, 89, 19), ligne('pose', 'Pose (main d\'œuvre)', 2.5, 25, 19), ligne(String(mastic.id), 'Mastic de la maison', 7, 3.45, 19),
          ligne('brosse', 'Brosse plate 50 mm', 4, 2.35, 7)] }) },
    ] })).statut).toBe(200);
    await aller('#/doc/f-hotel');
    await p.getByRole('button', { name: 'Émettre la facture', exact: true }).click({ timeout: 20_000 });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^FAC-\d{4}-\d{3}$/);
    const numero = (await p.locator('#view h1').first().innerText()).trim();
    // Chaque ligne émise garde ce qu'elle vend, chez l'entreprise comme au serveur (la pose n'en porte pas : une prestation).
    expect(await p.evaluate(() => ((window as unknown as { __data: { documents: { id: string; lines: { nature?: string }[] }[] } }).__data.documents
      .find((d) => d.id === 'f-hotel')?.lines ?? []).map((l) => l.nature ?? ''))).toEqual(['marchandises', '', 'produits', 'marchandises']);
    // Le journal de l'entreprise : chaque vente à son compte.
    await aller('#/compta');
    await p.locator('#view button, #view a').filter({ hasText: /^Écritures$/ }).first().click();
    await p.waitForTimeout(1200);
    const journal = net(await p.locator('#view').innerText());
    for (const attendu of ['Ventes de marchandises', 'Ventes de produits fabriqués', 'Ventes (prestations de services)']) expect(journal).toContain(attendu);
    await photo('c-journal');

    // D. La peinture ne se vendra plus : « Supprimer » la propose à l'archive (elle a une facture et du stock), « Annuler » la
    // remet ; archivée, elle quitte les tuiles de la caisse et les propositions d'une pièce, son stock reste dans l'inventaire.
    await aller('#/catalogue', '#list-wrap');
    await p.locator('#list-wrap tr[data-ouvrir="peint"]').click();
    await modale.locator('#del-cat').click();
    const question = p.locator('.modal').last();
    await expect.poll(async () => net(await question.innerText())).toContain('« Peinture murale blanche 10 L » a déjà une histoire : 1 document le porte, il en reste 37 en stock. Il ne s\'efface pas : archive-le.');
    await question.getByRole('button', { name: 'Archiver', exact: true }).click();
    await expect.poll(() => toast(p)).toContain('« Peinture murale blanche 10 L » est archivé : il ne se propose plus sur une pièce ni à la caisse, et ses 37 en stock restent dans l\'inventaire.');
    expect(await p.locator('#list-wrap tr[data-ouvrir="peint"]').count()).toBe(0);
    const tete = async () => { const t = p.locator('#cat-resume .mg-chiffre').first();
      return [net(await t.locator('.mu').innerText()).replace(/ ?i$/, ''), await t.locator('b').innerText(), net(await t.locator('small').innerText())]; };
    expect(await tete()).toEqual(['Articles', '3', 'dont 1 suivi en stock']);
    await p.locator('#cat-archives').click();
    await expect.poll(() => p.locator('#list-wrap tr[data-ouvrir="peint"]').innerText().then(net)).toContain('Peinture murale blanche 10 L archivé');
    // Les chiffres de tête comptent ce que la liste montre : ici l'archivé seul.
    expect(await tete()).toEqual(['Archivés', '1', 'dont 1 suivi en stock']);
    await photo('d-archives');
    await aller('#/caisse', '#cs-menu-bouton');
    // Le premier soir de caisse : le code du responsable se pose, puis le fond (rien dans le tiroir).
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-code-responsable').click();
    await p.locator('#modal-root #cs-nouveau').fill('2580');
    await p.locator('#modal-root #cs-nouveau-bis').fill('2580');
    await p.locator('#modal-root #cs-code-ok').click();
    await expect.poll(() => p.locator('#cs-fond').count(), { timeout: 15_000 }).toBe(1);
    await p.locator('#cs-fond').fill('0');
    await p.locator('#cs-ouvrir').click();
    await p.locator('#cs-articles').waitFor({ timeout: 15_000 });
    await expect.poll(async () => net(await p.locator('#cs-articles').innerText())).toContain('Mastic de la maison');
    expect(net(await p.locator('#cs-articles').innerText())).not.toContain('Peinture murale');
    // Remise dans le catalogue depuis sa fiche.
    await aller('#/catalogue', '#list-wrap');
    await p.locator('#cat-archives').click();
    await p.locator('#list-wrap tr[data-ouvrir="peint"]').click();
    await modale.locator('#desarch-cat').click();
    await expect.poll(() => toast(p)).toBe('« Peinture murale blanche 10 L » est de retour dans le catalogue.');
    await expect.poll(async () => (await objets()).find((o) => o.collection === 'catalog' && o.cle === 'peint')?.contenu.archived, { timeout: 15_000 }).toBe('');
    await cx.close();

    // E. Au Cabinet, la comptable lit chaque vente à son compte, au millime de l'entreprise : 253,650 de peinture et 8,930 de
    // brosses au 707, 59,375 de pose au 706, 22,942 de mastic au 701 (les parts de la remise répartie au calcul).
    const cxC = await contexte(ines);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/${an}`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check().catch(() => undefined);
    await c.waitForTimeout(3000);
    const livre = await c.evaluate(() => [...document.querySelectorAll('#c-livres tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const entree = `Facture ${numero} — Hôtel Les Jasmins`;
    expect(livre).toContain(`707 Hôtel Les Jasmins ${entree} (HT 19 %) 253,650 DT`);
    expect(livre).toContain(`706 Hôtel Les Jasmins ${entree} (HT 19 %) 59,375 DT`);
    expect(livre).toContain(`701 Hôtel Les Jasmins ${entree} (HT 19 %) 22,942 DT`);
    expect(livre).toContain(`707 Hôtel Les Jasmins ${entree} (HT 7 %) 8,930 DT`);
    await c.screenshot({ path: path.join(PHOTOS, 'catalogue-1318-e-cabinet.png'), fullPage: true });
    await cxC.close();
    expect(erreurs).toEqual([]);
    void noter;
  }, 300_000);
});
