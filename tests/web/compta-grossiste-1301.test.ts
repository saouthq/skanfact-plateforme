// La revue de la Comptabilité de l'entreprise (1.301.0), jouée comme un vrai grossiste : « Hygiène Plus Sahel », à Sousse,
// produits d'entretien pour les hôtels, les cliniques et les cafés, avec sa comptable au Cabinet Ennour.
//   - septembre : un gros achat de stock chez Sahel Chimie (retenue à la source opérée en payant), deux factures ;
//     la TVA du mois est un crédit ;
//   - octobre : trois factures (l'hôtel retient 1,5 % en payant), un avoir, du carburant, des emballages ; le crédit
//     de septembre vient en déduction ;
//   - le loyer du dépôt, sans facture, en opération diverse ;
//   - septembre se clôture, un achat de septembre oublié revient : on rouvre, et la comptable doit le savoir.

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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(RACINE, 'dist/photos/compta-1301.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('la Comptabilité 1.301.0 : le grossiste et sa comptable', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-compta-1301-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    // Le timbre de la facture, comme en production : sans lui, la facture ne s'émet pas.
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'compta-1301.txt'), '');
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
  const n = (x: string) => ({ '~n': x });
  const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };

  it('un grossiste, deux mois, sa comptable : ce qu\'il lit, ce qu\'il fait, ce qu\'elle sait', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mourad = await personne('mourad');
    const ent = String((await api('POST', '/entreprises-essai', mourad)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, mourad);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, mourad, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    const achat = (id: string, number: string, date: string, supplierId: string, kind: string, category: string, lignes: [string, number, number][], extra: Obj = {}, payeLe?: string) => {
      const brut = { id, kind, number, date, dueDate: date, supplierId, currency: 'DT', fees: 0, withholdingRate: Number(extra.withholdingRate ?? 0), category,
        lines: lignes.map(([label, qty, prix]) => ({ label, qty, unitPrice: prix, vatRate: 19, destination: 'charge', ...(extra.nonDeductible ? { deductible: false } : {}) })) };
      const t = C.purchaseTotals(brut, co);
      return { collection: 'purchases', cle: id, rang: 0, revision: null, contenu: { ...brut, withholdingRate: brut.withholdingRate ? n(String(brut.withholdingRate)) : 0, createdAt: 5, attachments: [],
        lines: brut.lines.map((l) => ({ ...l, qty: n(String(l.qty)), unitPrice: n(l.unitPrice.toFixed(3)) })),
        payments: payeLe ? [{ id: `p-${id}`, date: payeLe, amount: n(t.netToPay.toFixed(3)), method: 'virement' }] : [] } };
    };
    await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Sahel Chimie', matricule: '1234567A/M/A/000', paymentTermsDays: 30, withholdingRate: n('1.5') } },
      { collection: 'suppliers', cle: 's2', rang: 0, revision: null, contenu: { id: 's2', name: 'Emballages du Centre', paymentTermsDays: 30 } },
      { collection: 'suppliers', cle: 's3', rang: 0, revision: null, contenu: { id: 's3', name: 'Station-service El Kantaoui', paymentTermsDays: 0 } },
      ...[['c1', 'Hôtel Marhaba Palace'], ['c2', 'Clinique Les Oliviers'], ['c3', 'Café des Arts']].map(([id, name]) => ({ collection: 'clients', cle: id, rang: 0, revision: null, contenu: { id, name, city: 'Sousse' } })),
      achat('a1', 'SC-26-0903', '2026-09-03', 's1', 'facture', 'Marchandises', [['Détergent industriel 20 L', 400, 21.380], ['Désinfectant surfaces 5 L', 900, 6.940], ['Lessive linge hôtelier 25 kg', 220, 31.455]], { withholdingRate: 1.5 }, '2026-09-25'),
      achat('a2', 'EC-4471', '2026-10-06', 's2', 'facture', 'Emballages', [['Cartons et film', 1, 1846.320]], {}, '2026-10-20'),
      achat('a3', 'TK-1029', '2026-10-12', 's3', 'depense', 'Carburant', [['Gasoil, camionnette', 1, 312.605]], { nonDeductible: true }, '2026-10-12'),
    ] });

    // Les factures, dans l'ordre de leurs dates (la numérotation le veut).
    const factures: { id: string; date: string; clientId: string; lignes: [string, number, number][]; rs?: number; paye?: string }[] = [
      { id: 'f1', date: '2026-09-08', clientId: 'c1', lignes: [['Détergent industriel 20 L', 48, 38.450], ['Désinfectant surfaces 5 L', 120, 12.380]], rs: 1.5, paye: '2026-09-30' },
      { id: 'f2', date: '2026-09-19', clientId: 'c2', lignes: [['Gants nitrile, boîte de 100', 85, 14.650], ['Savon antiseptique 1 L', 60, 6.920]], paye: '2026-10-05' },
      { id: 'f3', date: '2026-10-03', clientId: 'c1', lignes: [['Détergent industriel 20 L', 120, 38.450], ['Lessive linge hôtelier 25 kg', 64, 52.780]], rs: 1.5, paye: '2026-10-28' },
      { id: 'f4', date: '2026-10-15', clientId: 'c3', lignes: [['Produits d\'entretien, lot café', 1, 486.350]] },
      { id: 'f5', date: '2026-10-22', clientId: 'c2', lignes: [['Gants nitrile, boîte de 100', 150, 14.650], ['Blouses jetables', 300, 2.140]] },
    ];
    for (const [i, f] of factures.entries()) {
      const doc: Obj = { id: f.id, type: 'facture', number: '', status: 'brouillon', date: f.date, dueDate: f.date, clientId: f.clientId, createdAt: 10 + i,
        subject: 'Produits d\'entretien', lines: f.lignes.map(([label, qty, prix]) => ({ label, description: '', qty: n(String(qty)), unit: '', unitPrice: n(prix.toFixed(3)), vatRate: 19 })),
        discountRate: 0, withholdingRate: f.rs ? n(String(f.rs)) : 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
      const t = C.computeTotals({ ...doc, withholdingRate: f.rs ?? 0, lines: f.lignes.map(([label, qty, prix]) => ({ label, qty, unitPrice: prix, vatRate: 19 })) }, co);
      const e = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, mourad, { document: doc, client: { id: f.clientId, name: f.clientId }, revision: null, rang: 30 + i, netAPayer: t.netToPay.toFixed(3) })).corps;
      expect(String((e.contenu as Obj | undefined)?.number ?? JSON.stringify(e))).toMatch(/^FAC-/);
      if (f.paye) {
        await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [{ collection: 'documents', cle: f.id, rang: 30 + i, revision: Number(e.revision),
          contenu: { ...(e.contenu as Obj), payments: [{ id: `p-${f.id}`, date: f.paye, amount: n(t.netToPay.toFixed(3)), method: 'virement' }] } }] });
      }
    }
    // L'avoir : cent blouses rendues sur la facture de la clinique.
    const av = { id: 'v1', type: 'avoir', number: '', date: '2026-10-24', clientId: 'c2', creditOf: 'f5', creditReason: 'Blouses rendues', status: 'brouillon',
      lines: [{ label: 'Blouses jetables', description: '', qty: n('100'), unit: '', unitPrice: n('2.140'), vatRate: 19 }], discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [] };
    const ea = await api('POST', `/entreprises/${ent}/dossier-v10/emettre-avoir`, mourad, { document: av, client: { id: 'c2', name: 'c2' }, revision: null, rang: 40, netAPayer: C.computeTotals({ ...av, lines: [{ label: 'Blouses jetables', qty: 100, unitPrice: 2.14, vatRate: 19 }] }, co).netToPay.toFixed(3) });
    noter('AVOIR', ea.statut, String(ea.corps.motif ?? ''));

    // La comptable dépose la TVA de septembre et valide septembre dans ses livres.
    noter('PREPARER', (await api('PUT', `/entreprises/${ent}/compta/declarations/2026-09`, leila, { cases: { tvaCollectee: '948,414', tvaDeductible: '4126,439', creditAReporter: '3178,025' } })).statut);
    const pt = await api('POST', `/entreprises/${ent}/compta/declarations/2026-09/pointer`, leila, { quoi: 'deposee', le: '2026-10-27', reference: 'TEJ-2026-0927' });
    noter('POINTER', pt.statut, JSON.stringify(pt.corps).slice(0, 300));
    const va = await api('POST', `/entreprises/${ent}/compta/valider`, leila, { jusqua: '2026-09-30' });
    noter('VALIDER', va.statut, JSON.stringify(va.corps).slice(0, 300));
    const dl = await api('GET', `/entreprises/${ent}/compta/declarations?annee=2026`, mourad);
    noter('DECLARATIONS lues par l\'entreprise', dl.statut, JSON.stringify(dl.corps).slice(0, 600));
    const cl = await api('GET', `/entreprises/${ent}/compta/cloture`, mourad);
    noter('CLOTURE lue par l\'entreprise', cl.statut, JSON.stringify(cl.corps).slice(0, 300));

    // Un achat de septembre oublié, saisi après la validation de septembre par le cabinet.
    const oubli = await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [achat('a4', 'EC-4402', '2026-09-15', 's2', 'facture', 'Emballages', [['Bidons 5 L vides', 600, 0.845]])] });
    noter('OUBLI SEPTEMBRE', oubli.statut, JSON.stringify(oubli.corps).slice(0, 400));

    const cx = await contexte(mourad);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    const photo = (nom: string, plein = true) => p.screenshot({ path: path.join(PHOTOS, `compta-1301-${nom}.png`), fullPage: plein });
    const lire = async (sel: string) => net(await p.locator(sel).innerText());
    const onglet = async (t: string) => { await p.locator(`#c-tabs [data-tab="${t}"]`).click(); await p.waitForTimeout(250); };
    const mois = async (m: string) => { await onglet('ventes'); await p.locator('#c-month').selectOption(m); await p.waitForTimeout(250); };
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#c-tabs').waitFor({ timeout: 20_000 });
    await plusTard(p);
    // ── 1. La DA des listes : le chemin, la phrase qui dit le cabinet, les onglets et la période dans la barre.
    await expect.poll(async () => lire('.page-head .sous'), { timeout: 15_000 }).toBe('Tes ventes, tes achats, ta TVA et tes livres, mois par mois — et ce que ton cabinet en a fait');
    expect(await lire('.page-head .chemin')).toBe('Accueil Comptabilité');
    expect(await p.locator('.lf.mg.cpt .mg-barre #c-tabs.pa-seg').count()).toBe(1);
    expect(await p.locator('.lf.mg.cpt .mg-barre #c-period select').count()).toBe(2);
    expect(await p.locator('.lf.mg.cpt > .cf-carte > .cf-onglet#c-body').count()).toBe(1);
    await mois('09');
    await photo('ventes-09');

    // ── 2. La TVA de septembre : déposée par le cabinet, et l'achat oublié qui en change la déductible depuis.
    await onglet('tva');
    await expect.poll(async () => lire('#vat-cabinet'), { timeout: 15_000 }).toBe('Déposée par ton cabinet le 27/10/2026 (réf. TEJ-2026-0927). i');
    expect(await lire('#vat-ecart p')).toBe('Tes pièces de septembre 2026 disent aujourd\'hui une TVA déductible de 4 222,769 DT ; ton cabinet en a déclaré 4 126,439 DT (+ 96,330 DT). Une pièce arrivée après le dépôt se reprend sur une déclaration suivante : dis-le à ton cabinet. À VÉRIFIER avec ton comptable.');
    expect(await lire('#vat-achats')).toBe('Voir les achats de septembre');
    // Le tableau de l'année le dit à son mois ; le résultat d'un mois à perte porte un vrai signe moins.
    expect(net(await p.locator('tr[data-vm="09"] td').first().innerText())).toBe('septembre déposée');
    expect(net(await p.locator('tr[data-vm="10"] td').first().innerText())).toBe('octobre');
    expect(await lire('#c-body')).toMatch(/−\d+ % du chiffre d'affaires/);
    await photo('tva-09');
    // « Le dire à mon comptable » : la conversation s'ouvre, le message écrit.
    await p.locator('#vat-ecart-dire').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/comptable');
    const zone = p.locator('#msg-racine textarea').first();
    await expect.poll(async () => net(await zone.inputValue()), { timeout: 10_000 }).toBe('Bonjour, ma TVA de septembre 2026 : tu as déclaré une TVA déductible de 4 126,439 DT, mes pièces disent aujourd\'hui 4 222,769 DT (+ 96,330 DT). Une pièce est sans doute arrivée après le dépôt : peux-tu la reprendre sur la prochaine déclaration ?');
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, leila)).corps.messages as Obj[] ?? []).map((x) => net(String(x.texte))).some((x) => x.startsWith('Bonjour, ma TVA de septembre 2026')),
      { timeout: 15_000 }).toBe(true);

    // ── 3. Octobre : pas encore déposée, le cabinet a jusqu'au 28/11 ; l'élision « d'octobre ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#c-tabs').waitFor({ timeout: 20_000 });
    await mois('10');
    await onglet('tva');
    await expect.poll(async () => lire('#vat-cabinet'), { timeout: 15_000 }).toBe('Ton cabinet ne l\'a pas encore déposée : il a jusqu\'au 28/11/2026. Lui écrire');
    expect(await lire('#vat-ventes')).toBe('Voir les ventes d\'octobre');
    expect(await p.locator('#vat-ecart').count()).toBe(0);

    // ── 4. Le calendrier : les déclarations chez le cabinet, la plus récente d'abord ; « Ce qui arrive » sait qu'il dépose.
    await onglet('calendrier');
    await expect.poll(async () => p.locator('#decl-cabinet tbody tr').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.periode)), { timeout: 15_000 }).toEqual(['2026-10', '2026-09']);
    expect(net(await p.locator('#decl-cabinet tr[data-periode="2026-10"]').innerText())).toBe('octobre 2026 28/11/2026 à préparer Lui écrire');
    expect(net(await p.locator('#decl-cabinet tr[data-periode="2026-09"]').innerText())).toBe('septembre 2026 28/10/2026 Déposée le 27/10/2026 réf. TEJ-2026-0927 tes pièces du mois ont changé depuis Voir la TVA');
    const tva = p.locator('#c-body tr', { hasText: 'Déclaration mensuelle d\'employeur et de TVA' }).first();
    expect(net(await tva.locator('td.actions').innerText())).toBe('Ton cabinet la dépose Je l\'ai déposée moi-même');
    await photo('calendrier');
    // « Voir la TVA » mène à la TVA de septembre.
    await p.locator('[data-decl-voir="2026-09"]').click();
    await expect.poll(async () => lire('#vat-cabinet'), { timeout: 10_000 }).toMatch(/^Déposée par ton cabinet le 27\/10\/2026/);

    // ── 5. Les clôtures : le cabinet a validé septembre ; on clôture pareil, on le lui dit ; on rouvre, on le lui dit.
    await onglet('clotures');
    await expect.poll(async () => lire('#clot-cabinet'), { timeout: 15_000 }).toMatch(/^Ton cabinet a validé tes livres jusqu'au 30\/09\/2026 : ses écritures de cette période ne bougent plus chez lui\. i Chez toi, des pièces de cette période peuvent encore changer : chez lui, un changement s'écrirait comme une correction au 01\/10\/2026, le premier jour encore ouvert\. Clôture-les aussi, pour qu'elles restent comme il les a validées\.$/);
    // Septembre est le prochain mois à clôturer : un seul bouton le fait (pas de second « Clôturer jusqu'au 30/09 »).
    expect(await p.locator('#clot-aligner').count()).toBe(0);
    await photo('clotures');
    await p.locator('#do-close').click();
    const fen = p.locator('#modal-root .modal', { hasText: 'Clôturer septembre 2026 ?' });
    await fen.waitFor({ timeout: 10_000 });
    await fen.getByRole('button', { name: 'Clôturer', exact: true }).click();
    await expect.poll(async () => lire('#toast')).toMatch(/^septembre 2026 clôturé Le dire à mon comptable/);
    expect(await p.locator('#clot-cabinet').innerText()).not.toContain('Clôture-les aussi');
    await p.locator('#toast-undo').click();
    await expect.poll(async () => net(await p.locator('#msg-racine textarea').first().inputValue()), { timeout: 10_000 }).toBe('Bonjour, j\'ai clôturé jusqu\'au 30/09/2026 : mes pièces jusqu\'à cette date ne bougeront plus.');
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await p.waitForTimeout(600);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#c-tabs').waitFor({ timeout: 20_000 });
    await onglet('clotures');
    await p.locator('#do-reopen').click();
    const rf = p.locator('#modal-root .modal', { hasText: 'Rouvrir une période' });
    await rf.waitFor({ timeout: 10_000 });
    await rf.locator('input[name=reason]').fill('Facture d\'emballages retrouvée');
    await rf.locator('input[name=all]').check();
    await rf.locator('#ok').click();
    await expect.poll(async () => lire('#toast')).toMatch(/^Période rouverte Le dire à mon comptable/);
    // Le toast passé, le journal garde le geste : la dernière ligne se redit.
    await p.waitForTimeout(6500);
    await p.locator('#clot-dire').click();
    await expect.poll(async () => net(await p.locator('#msg-racine textarea').first().inputValue()), { timeout: 10_000 }).toBe('Bonjour, j\'ai rouvert toutes mes périodes clôturées, motif : Facture d\'emballages retrouvée. Des pièces de ces mois peuvent changer : je te dirai lesquelles.');
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, leila)).corps.messages as Obj[] ?? []).map((x) => net(String(x.texte))).filter((x) => /^Bonjour, j'ai (clôturé|rouvert)/.test(x)).length,
      { timeout: 15_000 }).toBe(2);

    // ── 6. Les écritures : le cabinet les lit en direct, le bouton n'est plus « Envoyer au comptable ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#c-tabs').waitFor({ timeout: 20_000 });
    await onglet('ecritures');
    await expect.poll(async () => lire('#ecr-mail'), { timeout: 10_000 }).toBe('Envoyer par e-mail…');
    expect(await lire('#ecr-cabinet-lit')).toBe('Ton cabinet lit ces écritures en direct : il n\'y a rien à lui envoyer. Ce bouton sert à les envoyer à quelqu\'un d\'autre, par e-mail.');

    // ── 7. Au téléphone : la barre passe à la ligne, rien ne déborde.
    const tel = await contexte(mourad, 390, 844);
    const t = await tel.newPage();
    t.on('pageerror', (x) => erreurs.push(`téléphone : ${x.message}`));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await t.locator('#c-tabs').waitFor({ timeout: 20_000 });
    await plusTard(t);
    for (const o of ['ventes', 'tva', 'calendrier', 'clotures']) {
      await t.locator(`#c-tabs [data-tab="${o}"]`).click();
      await t.waitForTimeout(400);
      expect(await t.evaluate(() => document.documentElement.scrollWidth - innerWidth), o).toBeLessThanOrEqual(0);
    }
    await t.locator('#c-tabs [data-tab="tva"]').click();
    await t.waitForTimeout(600);
    await t.screenshot({ path: path.join(PHOTOS, 'compta-1301-telephone-tva.png'), fullPage: true });

    // ── 8. Au Cabinet : les trois messages arrivés dans la conversation du dossier.
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/messages`);
    await c.getByText('ma TVA de septembre 2026', { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    await c.waitForTimeout(800);
    await c.screenshot({ path: path.join(PHOTOS, 'compta-1301-cabinet-messages.png') });
    noter('CABINET', net(await c.locator('body').innerText()).slice(0, 1500));

    // ── 9. Une entreprise sans cabinet : rien de ce qui précède, « Marquer déposée » reste le sien.
    const seul = await personne('sami');
    const ent2 = String((await api('POST', '/entreprises-essai', seul)).corps.id);
    await api('GET', `/entreprises/${ent2}/dossier-v10`, seul);
    const cx2 = await contexte(seul);
    const s2 = await cx2.newPage();
    s2.on('pageerror', (x) => erreurs.push(`sans cabinet : ${x.message}`));
    await s2.goto(`${serveur.adresse}/v10/?e=${ent2}#/compta`);
    await s2.locator('#c-tabs').waitFor({ timeout: 20_000 });
    await plusTard(s2);
    expect(net(await s2.locator('.page-head .sous').innerText())).toBe('Tes ventes, tes achats, ta TVA et tes livres, mois par mois');
    await s2.locator('#c-tabs [data-tab="calendrier"]').click();
    await s2.waitForTimeout(500);
    expect(await s2.locator('#p-decl-cabinet').count()).toBe(0);
    expect(await s2.getByRole('button', { name: 'Marquer déposée' }).count()).toBeGreaterThan(0);
    await s2.locator('#c-tabs [data-tab="clotures"]').click();
    await s2.waitForTimeout(400);
    expect(await s2.locator('#clot-cabinet').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
