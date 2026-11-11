// Les listes de prix, 1.317.0, jouées par une droguerie de l'Ariana (« Droguerie El Amen ») : la liste des artisans (une
// catégorie de clients), celle d'un hôtel nommé pour la saison, une liste passée et une hausse à venir ; les paliers de
// quantité des vis ; la facture d'un artisan, un client changé sur un brouillon déjà rempli, un devis d'avant la liste
// facturé à son prix, et le comptoir de la caisse ; puis le comptable qui lit les ventes.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'prix-1317.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les listes de prix 1.317.0 : la droguerie, ses artisans, son hôtel et son comptoir', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-prix-1317-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'prix-1317.txt'), '');
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

  it('la droguerie vend à ses artisans, à son hôtel et au comptoir, chacun à son prix, et le comptable lit les ventes', async () => {
    const ines = await personne('ines');
    const cab = await api('POST', '/cabinets', ines, { nom: 'Cabinet Ariana Audit' });
    const cabinet = String(cab.corps.id);
    const hedi = await personne('hedi');
    const ent = String((await api('POST', `/entreprises-essai`, hedi)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, hedi, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, ines)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hedi)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hédi Trabelsi', name: 'Droguerie El Amen', city: 'Ariana', paymentTermsDays: 30 };
    const article = (id: string, label: string, unit: string, prix: number, qte: number, cout: number, plus: Obj = {}) => ({ collection: 'catalog', cle: id, rang: 0, revision: null,
      contenu: enc({ id, label, unit, unitPrice: prix, vatRate: 19, tracked: true, initialQty: qte, initialCost: cout, initialDate: '2026-01-01', ...plus }) });
    const liste = (id: string, nom: string, cible: Obj, depuis: string, jusquau: string, lignes: [string, number][]) => ({ collection: 'priceLists', cle: id, rang: 0, revision: null,
      contenu: enc({ id, nom, categorie: '', clientIds: [], ...cible, depuis, jusquau, lignes: lignes.map(([itemId, prix]) => ({ itemId, prix })) }) });
    const ligne = (itemId: string, label: string, qty: number, unit: string, prix: number) => ({ itemId, label, description: '', qty, unit, unitPrice: prix, vatRate: 19 });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'accounts', cle: 'k-banque', rang: 1, revision: null, contenu: { id: 'k-banque', name: 'Attijari Bank', kind: 'banque', bank: 'Attijari', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'clients', cle: 'c-chedly', rang: 0, revision: null, contenu: { id: 'c-chedly', name: 'Chedly Plomberie', city: 'La Soukra', categorieTarif: 'artisans' } },
      { collection: 'clients', cle: 'c-jasmins', rang: 0, revision: null, contenu: { id: 'c-jasmins', name: 'Hôtel Les Jasmins', matricule: '1456789K/A/M/000', city: 'Gammarth' } },
      { collection: 'clients', cle: 'c-benali', rang: 0, revision: null, contenu: { id: 'c-benali', name: 'Samia Ben Ali', city: 'Ariana' } },
      article('a-peint', 'Peinture murale blanche 10 L', 'pot', 89, 40, 61),
      article('a-vis', 'Vis à bois 4×40 (boîte de 200)', 'boîte', 4.9, 300, 2.6, { paliers: [{ min: 10, prix: 4.2 }, { min: 50, prix: 3.9 }] }),
      article('a-silic', 'Silicone sanitaire blanc', 'tube', 12.5, 60, 7.8),
      article('a-pinceau', 'Pinceau plat 50 mm', 'u', 6.75, 80, 3.1),
      liste('pl-art', 'Artisans 2026', { categorie: 'Artisans' }, jourDe(-200), '', [['a-peint', 78], ['a-silic', 10.9]]),
      liste('pl-art2', 'Artisans (hausse)', { categorie: 'Artisans' }, jourDe(55), '', [['a-peint', 81], ['a-silic', 11.4]]),
      liste('pl-jas', 'Hôtel Les Jasmins — saison', { clientIds: ['c-jasmins'] }, jourDe(-6), jourDe(54), [['a-peint', 74], ['a-silic', 11]]),
      liste('pl-jas0', 'Hôtel Les Jasmins — printemps', { clientIds: ['c-jasmins'] }, jourDe(-220), jourDe(-120), [['a-peint', 70]]),
      { collection: 'documents', cle: 'dv1', rang: 0, revision: null, contenu: enc({ id: 'dv1', type: 'devis', number: 'DEV-2026-001', status: 'accepté', date: jourDe(-10), clientId: 'c-jasmins',
        subject: 'Rafraîchissement des chambres du 2e étage', createdAt: Date.now(), discountRate: 0, withholdingRate: 0, payments: [],
        lines: [ligne('a-peint', 'Peinture murale blanche 10 L', 12, 'pot', 89), ligne('a-silic', 'Silicone sanitaire blanc', 10, 'tube', 12.5)] }) },
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
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `prix-1317-${nom}.png`), fullPage: true });
    // Ce que les lignes du brouillon disent : la désignation, la quantité, le prix unitaire.
    const lignes = () => p.locator('#lines tr[data-i]').evaluateAll((trs) => trs.map((tr) => [
      (tr.querySelector('[data-k=label]') as HTMLInputElement | null)?.value ?? '', (tr.querySelector('[data-k=qty]') as HTMLInputElement | null)?.value ?? '',
      (tr.querySelector('[data-k=unitPrice], [data-k=puTtc]') as HTMLInputElement | null)?.value ?? '']));
    const ajouter = async (q: string) => {
      await p.locator('#ed-ajout').fill(q);
      await p.locator('[data-aj]').first().waitFor({ timeout: 5_000 });
      const choix = net(await p.locator('[data-aj]').first().innerText());
      await p.locator('[data-aj]').first().click();
      await p.waitForTimeout(300);
      return choix;
    };
    const pourQui = async (q: string) => {
      await p.locator('#ed-pq-q:visible, #ed-client:visible').first().waitFor({ timeout: 20_000 });
      if (!(await p.locator('#ed-pq-q').isVisible())) await p.locator('#cl-changer').click();
      await p.locator('#ed-pq-q').fill(q);
      await p.locator('#ed-pq-liste [role=option][data-cl]').first().click();
      await p.waitForTimeout(400);
    };
    const quantite = async (rang: number, q: string) => {
      const champ = p.locator('#lines tr[data-i]').nth(rang).locator('[data-k=qty]');
      await champ.fill(q);
      await champ.dispatchEvent('change');
      await p.waitForTimeout(300);
    };

    // A. Les listes de prix : deux en vigueur, une à venir, une terminée.
    await aller('#/listesprix');
    expect(net(await p.locator('#lp-resume').first().innerText())).toMatch(/^Listes en vigueur 2 1 à venir · 1 terminée Clients concernés 2 sur \d+ clients, aujourd'hui Articles à prix négocié 2 sur 4 au catalogue Prochaine fin \d\d\/\d\d\/\d{4} Hôtel Les Jasmins — saison — dans 54 jours/);
    await photo('a-listes');
    // B. Les fiches : Chedly (catégorie « artisans » écrite en minuscules) et l'hôtel (une liste à son nom).
    await aller('#/client/c-chedly');
    // B. Sa catégorie s'écrit « artisans », celle de la liste « Artisans » : la liste fait ses prix, la fiche le dit.
    expect(net(await p.locator('#cf-prix').innerText())).toBe('catégorie « artisans » la liste « Artisans 2026 » remplace les prix du catalogue');
    await aller('#/client/c-jasmins');
    const fin = jourDe(54).split('-').reverse().join('/');
    expect(net(await p.locator('#cf-prix').innerText())).toBe(`une liste à son nom la liste « Hôtel Les Jasmins — saison » jusqu'au ${fin} remplace les prix du catalogue`);
    await aller('#/client/c-benali');
    expect(net(await p.locator('#cf-prix').innerText())).toBe('ceux du catalogue');
    // C. La facture de Chedly : la peinture au prix des artisans, 12 boîtes de vis au palier, le silicone de la liste.
    await aller('#/doc/new/facture');
    await pourQui('Chedly');
    // C. Le choix dit le prix que la ligne prendra (78, celui de sa liste), et le palier des vis avant la quantité.
    expect(await ajouter('Peinture')).toMatch(/prix du client \(Artisans 2026\) .*78,000 DT HT$/);
    expect(await ajouter('Vis')).toMatch(/boîte · 4,200 DT dès 10 .*4,900 DT HT$/);
    await quantite(1, '12');
    await ajouter('Silicone');
    expect(await lignes()).toEqual([['Peinture murale blanche 10 L', '1', '78.000'], ['Vis à bois 4×40 (boîte de 200)', '12', '4.200'], ['Silicone sanitaire blanc', '1', '10.900']]);
    await photo('c-facture-chedly');
    await p.locator('#save').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe('Brouillon enregistré');
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#modal-root').innerText())).toContain('Net à payer 166,767 DT');
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await p.waitForTimeout(3000);
    // D. Un brouillon commencé pour Mme Ben Ali (peinture au prix du catalogue, un pinceau dont on tape le prix), puis on
    // s'aperçoit que c'est pour l'hôtel : « Changer ».
    await aller('#/doc/new/facture');
    await pourQui('Ben Ali');
    await ajouter('Peinture');
    await quantite(0, '3');
    await ajouter('Pinceau');
    const pu = p.locator('#lines tr[data-i]').nth(1).locator('[data-k=unitPrice], [data-k=puTtc]');
    await pu.fill('6');
    await pu.dispatchEvent('change');
    expect(await lignes()).toEqual([['Peinture murale blanche 10 L', '3', '89.000'], ['Pinceau plat 50 mm', '1', '6']]);
    await pourQui('Jasmins');
    // D. Les pots prennent le prix de la liste de l'hôtel ; le pinceau dont on a tapé le prix le garde.
    await expect.poll(() => toast(p)).toBe('1 ligne prend le prix convenu avec Hôtel Les Jasmins ; un prix que tu as tapé ne change pas.');
    expect(await lignes()).toEqual([['Peinture murale blanche 10 L', '3', '74.000'], ['Pinceau plat 50 mm', '1', '6.000']]);
    await photo('d-change');
    // E. Le devis d'avant la liste de l'hôtel, facturé : la facture reprend les prix du devis.
    await aller('#/doc/dv1');
    await p.getByRole('button', { name: 'Facturer ce devis', exact: true }).click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toBe('Nouvelle facture');
    await p.waitForTimeout(800);
    // E. La facture du devis accepté avant la liste garde ses prix (le prix convenu) ; « Avant d'émettre » dit que sa liste
    // est plus basse, et « Reprendre ses prix » les pose si on le veut.
    expect(await lignes()).toEqual([['Peinture murale blanche 10 L', '12', '89.000'], ['Silicone sanitaire blanc', '10', '12.500']]);
    expect(net(await p.locator('#ed-avant').innerText())).toContain('2 lignes plus chères que sa liste « Hôtel Les Jasmins — saison » : « Peinture murale blanche 10 L » 89,000 DT au lieu de 74,000 DT Reprendre ses prix');
    await photo('e-facture-devis');
    await p.locator('#ed-avant [data-avant=prix]').click();
    await expect.poll(() => toast(p)).toBe('2 lignes au prix convenu avec Hôtel Les Jasmins.');
    expect(await lignes()).toEqual([['Peinture murale blanche 10 L', '12', '74.000'], ['Silicone sanitaire blanc', '10', '11.000']]);
    expect(net(await p.locator('#ed-avant').innerText())).not.toContain('plus chère');
    // F. Le comptoir : Chedly passe prendre deux pots et 12 boîtes de vis ; puis un passant prend un pot.
    await aller('#/caisse', '#cs-menu-bouton');
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-code-responsable').click();
    await p.locator('#modal-root #cs-nouveau').fill('2580');
    await p.locator('#modal-root #cs-nouveau-bis').fill('2580');
    await p.locator('#modal-root #cs-code-ok').click();
    await expect.poll(() => p.locator('#cs-fond').count(), { timeout: 15_000 }).toBe(1);
    await p.locator('#cs-fond').fill('0');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ouverte par/);
    const art = (nom: string) => p.locator('#cs-articles .cs-art', { hasText: nom });
    expect(net(await art('Peinture').innerText())).toContain('105,910 DT');
    await p.locator('#cs-client-bouton').click();
    await p.locator('#cs-cl-q').fill('Chedly');
    await p.locator('#modal-root [data-client]', { hasText: 'Chedly' }).first().click();
    await p.waitForTimeout(300);
    // F. Le client choisi, la tuile dit son prix : 78 HT, 92,820 TTC.
    expect(net(await art('Peinture').innerText())).toContain('92,820 DT');
    await art('Peinture').click(); await art('Peinture').click();
    for (let i = 0; i < 12; i++) await art('Vis').click();
    const lignesTicket = () => p.locator('#cs-ticket .ct-ligne').evaluateAll((ls) => ls.map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim()));
    expect(await lignesTicket()).toEqual([
      '2 × Peinture murale blanche 10 L92,820 DT l\'unité · prix « Artisans 2026 » −2+ 185,640 DT',
      '12 × Vis à bois 4×40 (boîte de 200)4,998 DT l\'unité · prix par quantité −12+ 59,976 DT']);
    expect(net(await p.locator('#cs-total').innerText())).toBe('245,616 DT');
    await photo('f-caisse-chedly');
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-paiement [data-mode=carte]').click();
    await p.locator('#cs-valider').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toMatch(/^Ticket TIC-/);
    await p.locator('#cs-nouvelle').click();
    await art('Peinture').click();
    expect(net(await p.locator('#cs-total').innerText())).toBe('105,910 DT');
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-paiement [data-mode=carte]').click();
    await p.locator('#cs-valider').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toMatch(/^Ticket TIC-/);
    const docs = (await objets()).filter((o) => o.collection === 'documents').map((o) => o.contenu as Obj);
    const num = (v: unknown) => Number(typeof v === 'object' && v ? (v as Obj)['~n'] : v);
    expect(docs.filter((d) => d.ticket && d.clientId === 'c-chedly').map((d) => (d.lines as Obj[]).map((l) => [l.qty, num(l.unitPrice)]))).toEqual([[[2, 78], [12, 4.2]]]);
    // G. Au Cabinet : les ventes du jour.
    const cxC = await contexte(ines);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/${auj.slice(0, 4)}`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check().catch(() => undefined);
    await c.waitForTimeout(3000);
    const livre = await c.evaluate(() => [...document.querySelectorAll('#c-livres tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()));
    // G. Le comptable lit les mêmes prix : 139,300 HT à la facture du plombier, 206,400 à son ticket, 89 au passant.
    const an = auj.slice(0, 4);
    // (1.318.0) La droguerie revend ses articles tels qu'achetés (suivis en stock) : ventes de marchandises, 707.
    expect(livre).toContain(`707 Chedly Plomberie Facture FAC-${an}-001 — Chedly Plomberie (HT 19 %) 139,300 DT`);
    expect(livre).toContain(`707 Chedly Plomberie Facture TIC-${an}-001 — Chedly Plomberie (HT 19 %) 206,400 DT`);
    expect(livre).toContain(`707 Vente au comptoir Facture TIC-${an}-002 — Vente au comptoir (HT 19 %) 89,000 DT`);
    await c.screenshot({ path: path.join(PHOTOS, 'prix-1317-g-cabinet.png'), fullPage: true });
    await cxC.close();
    expect(erreurs).toEqual([]);
    void noter;
  }, 300_000);
});
