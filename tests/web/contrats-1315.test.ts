// La Facturation récurrente, 1.315.0, jouée par une société de maintenance informatique de Tunis (« Tunis Réseaux ») : la
// maintenance mensuelle de la clinique en retard de trois mois, l'hébergement trimestriel, le support d'un atelier de Lyon en
// euros, un contrat fini, un café suspendu puis repris. Les brouillons, les factures émises, la liste et le Cabinet.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'contrats-1315.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('la facturation récurrente 1.315.0 : les contrats de la société de maintenance, vus de partout', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-contrats-1315-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'contrats-1315.txt'), '');
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

  it('la société de maintenance facture ses contrats : trois mois de retard rattrapés, un trimestre, des euros, une fin, une reprise, et le comptable lit les mêmes ventes', async () => {
    const sonia = await personne('sonia');
    const cab = await api('POST', '/cabinets', sonia, { nom: 'Cabinet Lac Expertise' });
    const cabinet = String(cab.corps.id);
    const hedi = await personne('hedi');
    const ent = String((await api('POST', '/entreprises-essai', hedi)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, hedi, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hedi)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const moisDecale = (n: number, jour = '01') => { const [a, m] = auj.split('-').map(Number) as [number, number]; const t = a * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-${jour}`; };
    // Les mois tels que l'application les écrit (« août 2026 », « d'août 2026 ») ; les dates comme l'écran les montre.
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const nomMois = (iso: string) => MOIS[Number(iso.slice(5, 7)) - 1] as string;
    const de = (t: string) => (/^[aeiouéèê]/i.test(t) ? `d'${t}` : `de ${t}`);
    const leMois = (iso: string) => `${nomMois(iso)} ${iso.slice(0, 4)}`;
    const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    const plus30 = new Date(Date.parse(`${auj}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    const FAC = `FAC-${auj.slice(0, 4)}-001`;
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hédi Trabelsi', name: 'Tunis Réseaux SARL', city: 'Tunis', paymentTermsDays: 30 };
    const ligne = (label: string, qty: number, prix: number, unit = 'mois') => ({ id: `l-${label.length}`, label, description: '', qty, unit, unitPrice: prix, vatRate: 19, discount: 0 });
    const client = (id: string, name: string, extra: Obj = {}) => ({ collection: 'clients', cle: id, rang: 0, revision: null, contenu: enc({ id, name, city: 'Tunis', email: '', phone: '', ...extra }) });
    const contrat = (id: string, c: Obj) => ({ collection: 'recurring', cle: id, rang: 0, revision: null, contenu: enc({ id, active: true, day: 1, discountRate: 0, withholdingRate: 0, notes: '', lang: 'fr', currency: 'DT', exchangeRate: '', ...c }) });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      client('c-oli', 'Clinique Les Oliviers', { matricule: '1234567A/A/M/000', withholding: 1.5 }),
      client('c-atl', 'Société Atlas Logistique', { matricule: '7654321B/A/M/000' }),
      client('c-lum', 'Atelier Lumière', { city: 'Lyon', country: 'FR', currency: 'EUR' }),
      client('c-pins', 'École Les Pins', { matricule: '1112223C/A/M/000' }),
      client('c-port', 'Café du Port', {}),
      contrat('k-oli', { clientId: 'c-oli', every: 'month', subject: 'Maintenance du parc informatique — {mois}', nextDate: moisDecale(-3), withholdingRate: 1.5, lines: [ligne('Maintenance mensuelle (12 postes, 2 serveurs)', 1, 450)] }),
      contrat('k-atl', { clientId: 'c-atl', every: 'quarter', subject: 'Hébergement des serveurs — trimestre de {mois}', nextDate: moisDecale(1, '05'), day: 5, lines: [ligne('Hébergement et sauvegarde', 3, 200)] }),
      contrat('k-lum', { clientId: 'c-lum', every: 'month', subject: 'Support à distance — {mois}', nextDate: moisDecale(0), currency: 'EUR', exchangeRate: 3.35, lines: [ligne('Support à distance', 1, 120)] }),
      contrat('k-pins', { clientId: 'c-pins', every: 'month', subject: 'Entretien de la salle informatique — {mois}', nextDate: moisDecale(-1), endDate: moisDecale(-2, '28'), lines: [ligne('Entretien', 1, 300)] }),
      contrat('k-port', { clientId: 'c-port', every: 'month', subject: 'Caisse et wifi — {mois}', nextDate: moisDecale(-2), active: false, lines: [ligne('Caisse et wifi', 1, 80)] }),
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
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `contrats-1315-${nom}.png`), fullPage: true });
    const vue = async () => net(await p.locator('#view').innerText());
    // Le titre d'une page, sans la bulle « i » qui le suit.
    const titre = async () => net(await p.locator('#view h1').first().innerText()).replace(/\s+i$/, '');

    await aller('#/contrats');
    noter('==== A liste', (await vue()).slice(0, 2500));
    // A. Le chiffre « À générer » est ce que « Générer » prépare : un brouillon par mois échu (quatre pour la clinique, en retard
    // depuis trois mois, un pour l'atelier), pas le nombre de contrats ; le contrat fini et le suspendu n'en préparent aucun.
    const chiffres = async () => (await p.locator('#c-resume .mg-chiffre').allInnerTexts()).map(net);
    expect((await chiffres())[2]).toBe('À générer 5 brouillons à préparer — voir les 2 contrats');
    expect(net(await p.locator('#c-a-generer').innerText())).toBe('5 factures récurrentes à générer (2 contrats) Générer les brouillons');
    // Chaque contrat se nomme par son objet, sans le gabarit ni le mot qui annonce le mois.
    const objets2 = async () => p.locator('#c-wrap tbody tr').evaluateAll((trs) => trs.map((tr) => (tr.querySelectorAll('td')[1]?.textContent || '').replace(/\s+/g, ' ').trim()));
    expect((await objets2()).sort()).toEqual(['Caisse et wifi', 'Entretien de la salle informatique', 'Hébergement des serveurs — trimestre', 'Maintenance du parc informatique', 'Support à distance']);
    await photo('a-liste');
    // (1.361.0) Tant qu'une facture attend, l'étape suivante est la générer : le vert est sur la bande, pas sur « Nouveau contrat ».
    expect(await p.locator('#gen-due').evaluate((b) => b.classList.contains('btn-primary'))).toBe(true);
    expect(await p.locator('#new').evaluate((b) => b.classList.contains('btn-primary'))).toBe(false);
    await p.locator('#gen-due').click();
    noter('==== B confirmation', net(await p.locator('#modal-root').innerText()).slice(0, 600));
    expect(net(await p.locator('#modal-root').innerText())).toContain('Générer 5 brouillons de facture ?');
    expect(await p.locator('#modal-root #ok').evaluate((b) => b.classList.contains('btn-primary') && !b.classList.contains('btn-danger'))).toBe(true);
    await p.locator('#modal-root #ok').click();
    await p.waitForTimeout(800);
    noter('==== B après', await toast(p), (await vue()).slice(0, 1500));
    // Le message mène aux brouillons, et la question qui le précède n'était pas un geste qui détruit.
    expect(await toast(p)).toContain('5 brouillons créés — à relire puis émettre');
    expect(net(await p.locator('#toast-undo').innerText())).toBe('Voir les factures');
    expect((await chiffres())[2]).toBe('À générer 0 rien en attente');
    await aller('#/factures');
    noter('==== C factures', (await vue()).slice(0, 2500));
    const brouillons = (await objets()).filter((o) => o.collection === 'documents' && o.contenu.recurringId).map((o) => ({ id: o.cle, date: o.contenu.date, sujet: o.contenu.subject, periode: o.contenu.periode, rec: o.contenu.recurringId, devise: o.contenu.currency, taux: o.contenu.exchangeRate, ret: o.contenu.withholdingRate }));
    noter('==== C brouillons', brouillons);
    // C. Les trois mois en retard partent datés d'aujourd'hui, jamais dans un mois passé ; chacun dit le mois qu'il couvre.
    expect(brouillons.map((b) => [b.rec, b.date, b.periode, b.sujet]).sort()).toEqual([
      ['k-lum', auj, moisDecale(0), `Support à distance — ${leMois(moisDecale(0))}`],
      ...[-3, -2, -1, 0].map((n) => ['k-oli', auj, moisDecale(n), `Maintenance du parc informatique — ${leMois(moisDecale(n))}`]),
    ].sort());
    const plusVieux = brouillons.filter((b) => b.rec === 'k-oli').sort((x, y) => String(x.date).localeCompare(String(y.date)))[0];
    await aller(`#/doc/${plusVieux?.id}`);
    noter('==== D brouillon Oliviers', (await vue()).slice(0, 2500));
    expect(await titre()).toBe(`Facture ${de(nomMois(moisDecale(-3)))} · contrat`);
    await photo('d-oliviers');
    const lum = brouillons.find((b) => b.rec === 'k-lum');
    await aller(`#/doc/${lum?.id}`);
    noter('==== D brouillon Lumière', (await vue()).slice(0, 2500));
    await aller('#/contrat/k-port', '#view h1');
    noter('==== E fiche Port', (await vue()).slice(0, 2000));
    // E. La fiche d'un contrat porte son nom, pas celui d'une facture qu'il ne fera peut-être jamais.
    expect(await titre()).toBe('Caisse et wifi');
    // Suspendu : pas de « prochaine facture » à nommer (à la reprise, il repart au mois qui vient).
    expect(net(await p.locator('#c-sous').innerText())).toBe('Café du Port · Chaque mois');
    await aller('#/contrat/k-pins', '#view h1');
    noter('==== E fiche Pins', (await vue()).slice(0, 1500));
    expect(await titre()).toBe('Entretien de la salle informatique');
    expect(net(await p.locator('#c-sous').innerText())).toBe(`École Les Pins · Chaque mois · jusqu'au ${fr(moisDecale(-2, '28'))}`);
    await aller('#/contrat/k-oli', '#view h1');
    noter('==== E fiche Oliviers', (await vue()).slice(0, 2500));
    expect(await titre()).toBe('Maintenance du parc informatique');
    expect(net(await p.locator('#c-emettre').innerText())).toBe(`Émettre la facture ${de(leMois(moisDecale(-3)))}`);
    // F. Le bouton vert de la fiche mène au plus ancien brouillon (août) ; il s'émet comme toute facture.
    await p.locator('#c-emettre').click();
    await p.locator('#ed-geste #issue').waitFor({ timeout: 20_000 });
    noter('==== F brouillon ouvert depuis la fiche', net(await p.locator('#view h1').first().innerText()), net(await p.locator('#ed-avant').innerText().catch(() => '')));
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    noter('==== F fenêtre d\'émission', net(await p.locator('#modal-root').innerText()).slice(0, 1200));
    expect(net(await p.locator('#modal-root').innerText())).toContain(`Date ${fr(auj)} Échéance ${fr(plus30)} Net à payer 528,467 DT`);
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await p.waitForTimeout(3000);
    noter('==== F émise', (await vue()).slice(0, 2000));
    await photo('f-emise');
    noter('==== F pièce au serveur', (await admin.query(`select numero_texte, date_piece::text, echeance::text, objet, net_a_payer::text, timbre::text, ref_v10 from ventes.piece where entreprise = $1`, [ent])).rows);
    expect((await admin.query(`select numero_texte, date_piece::text, echeance::text, objet, net_a_payer::text from ventes.piece where entreprise = $1`, [ent])).rows).toEqual([
      { numero_texte: FAC, date_piece: auj, echeance: plus30, objet: `Maintenance du parc informatique — ${leMois(moisDecale(-3))}`, net_a_payer: '528467' }]);
    await aller('#/contrat/k-oli', '#view h1');
    noter('==== G fiche Oliviers après', (await vue()).slice(0, 2200));
    // G. Le bouton vert passe au brouillon suivant ; les trois autres attendent, la facture émise est comptée.
    expect(net(await p.locator('#c-emettre').innerText())).toBe(`Émettre la facture ${de(leMois(moisDecale(-2)))}`);
    expect(await vue()).toContain(`Le brouillon ${de(leMois(moisDecale(-2)))} attend ta relecture (et 2 autres).`);
    expect(await vue()).toContain('Facturé depuis le début (HT) i 450,000 DT 1 facture émise · 3 brouillons');
    await photo('g-oliviers');
    // H. Le café reprend son contrat, deux mois après l'avoir suspendu.
    await aller('#/contrat/k-port', '#view h1');
    await p.locator('#c-toggle').first().click();
    await p.waitForTimeout(800);
    noter('==== H reprise', await toast(p), (await vue()).slice(0, 1500));
    // H. Reprendre ne facture pas les mois de pause ; la prochaine est celle du mois prochain (« Générer maintenant » reste là).
    expect(await toast(p)).toContain(`Contrat repris — prochaine facture le ${fr(moisDecale(1))} (les échéances passées ne sont pas facturées)`);
    expect(net(await p.locator('#c-sous').innerText())).toBe(`Café du Port · Chaque mois · prochaine facture « Caisse et wifi — ${leMois(moisDecale(1))} »`);
    expect(await p.getByRole('button', { name: 'Générer maintenant' }).count()).toBe(1);
    // I. Le brouillon en euros, avant d'émettre.
    await aller(`#/doc/${lum?.id}`);
    noter('==== I avant d\'émettre Lumière', net(await p.locator('#ed-avant').innerText().catch(() => '')));
    // I. Le taux de l'euro vient du contrat : l'écran le dit avant d'émettre.
    expect(net(await p.locator('#ed-avant').innerText())).toContain('Le taux est celui du contrat (1 EUR = 3,350 DT) : vérifie celui du jour');
    await aller('#/contrats');
    noter('==== J liste après', (await vue()).slice(0, 2500));
    await photo('j-liste');
    // K. Au Cabinet : la comptable lit le journal de la société.
    const cxC = await contexte(sonia);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/${auj.slice(0, 4)}`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check().catch(() => undefined);
    await c.waitForTimeout(3000);
    noter('==== K journal du Cabinet', await c.evaluate(() => [...document.querySelectorAll('#c-livres tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim())));
    // K. Le comptable lit la vente au jour où elle est partie, et le mois qu'elle couvre : ce qu'il lui faut pour la rattacher.
    const livre = await c.evaluate(() => [...document.querySelectorAll('#c-livres tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const entree = `Facture ${FAC} — Clinique Les Oliviers · période ${de(leMois(moisDecale(-3)))}`;
    expect(livre.some((x) => x.startsWith(`brouillard ${fr(auj)} VT ${FAC} 411 Clinique Les Oliviers ${entree} 536,500 DT`))).toBe(true);
    expect(livre).toContain(`706 Clinique Les Oliviers ${entree} (HT 19 %) 450,000 DT`);
    await c.screenshot({ path: path.join(PHOTOS, 'contrats-1315-k-cabinet.png'), fullPage: true });
    await cxC.close();
    // L. Le livre de l'entreprise elle-même.
    await aller('#/compta');
    await p.locator('#view button, #view a').filter({ hasText: /^Écritures$/ }).first().click();
    await p.waitForTimeout(1200);
    noter('==== L écritures de l\'entreprise', (await vue()).slice(0, 3000));
    expect(await vue()).toContain(`VT ${FAC} 411 Facture ${FAC} — Clinique Les Oliviers · période ${de(leMois(moisDecale(-3)))} 536,500`);
    noter('erreurs', erreurs);
  }, 300_000);
});
