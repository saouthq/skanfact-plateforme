// La revue des Marges (1.300.0), jouée comme un vrai électricien : « Électricité Ben Ammar », à Tunis, avec un salarié
// (Hichem), deux fournisseurs, trois chantiers et un contrat d'entretien :
//   - la villa Karoui à Gammarth : devis, acompte de 30 %, solde, achats, heures — terminée, rentable ;
//   - l'immeuble Ennasr : terminé et facturé, mais les câbles ont coûté plus que prévu — à perte ;
//   - les bureaux du Lac 2 : en cours, l'acompte facturé, les câbles achetés, la moitié du travail faite ;
//   - l'entretien mensuel de la résidence Les Orangers, facturé chaque mois depuis mai.
// Puis la comptable, au Cabinet, reçoit l'état des chantiers.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, unknown>;
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(RACINE, 'dist/photos/marges-1300.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);

describe('les Marges 1.300.0 : l\'électricien et ses trois chantiers', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-marges-1300-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const plusTard = async (p: import('playwright-core').Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const n = (x: string) => ({ '~n': x });
  const ttc = (ht: number) => (Math.round(ht * 1190) / 1000).toFixed(3);

  it('trois chantiers, un contrat : ce que l\'électricien lit, et ce que sa comptable reçoit', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const karim = await personne('karim');
    const ent = String((await api('POST', '/entreprises-essai', karim)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, karim);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, karim, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    const devis = (id: string, number: string, date: string, clientId: string, projectId: string, subject: string, lignes: [string, number, number][]) => ({
      collection: 'documents', cle: id, rang: 0, revision: null, contenu: { id, type: 'devis', number, date, validUntil: '2026-12-31', clientId, projectId, subject, status: 'accepté',
        lines: lignes.map(([label, prix, cout]) => ({ label, description: '', qty: 1, unit: '', unitPrice: n(prix.toFixed(3)), unitCost: n(cout.toFixed(3)), vatRate: 19 })),
        discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0, createdAt: 1 } });
    const achat = (id: string, number: string, date: string, supplierId: string, projectId: string, lignes: [string, number][], paye: boolean) => {
      const ht = lignes.reduce((s, [, x]) => s + x, 0);
      return { collection: 'purchases', cle: id, rang: 0, revision: null, contenu: { id, kind: 'facture', number, date, dueDate: date, supplierId, projectId, currency: 'DT', fees: 0, withholdingRate: 0,
        createdAt: 5, attachments: [], category: 'Achats', lines: lignes.map(([label, x]) => ({ label, qty: 1, unitPrice: n(x.toFixed(3)), vatRate: 19, destination: 'charge' })),
        payments: paye ? [{ id: `p-${id}`, date, amount: n(ttc(ht)), method: 'virement' }] : [] } };
    };
    const heures = (id: string, projectId: string, date: string, h: string) => ({ collection: 'projectTime', cle: id, rang: 0, revision: null, contenu: { id, projectId, employeeId: 'e1', date, hours: n(h), note: '' } });
    await api('POST', `/entreprises/${ent}/dossier-v10`, karim, { changements: [
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Hichem Jlassi', grossSalary: n('1280.450'), contract: 'cdi', hireDate: '2021-03-01', active: true } },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Comptoir Électrique du Sahel', paymentTermsDays: 30 } },
      { collection: 'suppliers', cle: 's2', rang: 0, revision: null, contenu: { id: 's2', name: 'Quincaillerie El Amen', paymentTermsDays: 30 } },
      ...[['c1', 'Leïla Karoui'], ['c2', 'Promotion Ennasr'], ['c3', 'Lac Services'], ['c4', 'Résidence Les Orangers']].map(([id, name]) => ({ collection: 'clients', cle: id, rang: 0, revision: null, contenu: { id, name } })),
      { collection: 'catalog', cle: 'it1', rang: 0, revision: null, contenu: { id: 'it1', label: 'Visite d\'entretien', unitPrice: n('385'), unitCost: n('142.600'), vatRate: 19, unit: 'visite' } },
      { collection: 'projects', cle: 'pA', rang: 0, revision: null, contenu: { id: 'pA', name: 'Villa Karoui — Gammarth', clientId: 'c1', status: 'terminée', startDate: '2026-07-20', endDate: '2026-09-30', notes: '' } },
      { collection: 'projects', cle: 'pB', rang: 0, revision: null, contenu: { id: 'pB', name: 'Immeuble Ennasr — colonnes montantes', clientId: 'c2', status: 'terminée', startDate: '2026-09-01', endDate: '2026-10-25', notes: '' } },
      { collection: 'projects', cle: 'pC', rang: 0, revision: null, contenu: { id: 'pC', name: 'Bureaux Lac 2', clientId: 'c3', status: 'en cours', startDate: '2026-10-12', endDate: '', notes: '' } },
      devis('qA', 'DEV-2026-004', '2026-07-15', 'c1', 'pA', 'Électricité de la villa', [['Installation électrique de la villa', 9850, 4612.5], ['Tableau et protections', 2600, 1438.25]]),
      devis('qB', 'DEV-2026-006', '2026-08-20', 'c2', 'pB', 'Colonnes montantes', [['Colonnes montantes, 12 logements', 16900, 13200]]),
      devis('qC', 'DEV-2026-008', '2026-10-05', 'c3', 'pC', 'Courants forts et faibles, 3 plateaux', [['Installation courants forts et faibles', 26300, 17850.4]]),
      achat('aA1', 'CES-26-0715', '2026-07-28', 's1', 'pA', [['Câbles et gaines', 3180.45], ['Tableau, disjoncteurs', 1422.8]], true),
      achat('aB1', 'CES-26-0902', '2026-09-05', 's1', 'pB', [['Câbles cuivre 25 mm²', 11846.3]], true),
      achat('aB2', 'QEA-1187', '2026-10-02', 's2', 'pB', [['Coffrets et compteurs', 5912.65]], false),
      achat('aC1', 'CES-26-1019', '2026-10-20', 's1', 'pC', [['Chemins de câbles et câbles', 9874.415]], false),
      heures('h1', 'pA', '2026-08-10', '40'), heures('h2', 'pA', '2026-09-14', '32'),
      heures('h3', 'pB', '2026-09-08', '64'), heures('h4', 'pB', '2026-10-13', '56'),
      heures('h5', 'pC', '2026-10-21', '26'), heures('h6', 'pC', '2026-11-03', '20'),
      { collection: 'recurring', cle: 'r1', rang: 0, revision: null, contenu: { id: 'r1', clientId: 'c4', every: 'month', day: 1, nextDate: '2026-12-01', active: true, subject: 'Entretien électrique — {mois}',
        lines: [{ label: 'Visite d\'entretien', description: '', qty: 1, unit: 'visite', unitPrice: n('385'), vatRate: 19 }], discountRate: 0, withholdingRate: 0, notes: '', currency: 'DT', exchangeRate: '', createdAt: 1 } },
    ] });

    // Les factures, dans l'ordre de leurs dates (la numérotation le veut).
    const acompte = (pct: number, num: string) => `Acompte de ${pct} % sur le devis ${num}`;
    const factures: { id: string; date: string; clientId: string; lignes: [string, number, boolean?][]; extra?: Obj; paye?: [string, string] }[] = [
      ...['05', '06', '07'].map((m) => ({ id: `r-${m}`, date: `2026-${m}-01`, clientId: 'c4', lignes: [['Visite d\'entretien', 385]] as [string, number][], extra: { recurringId: 'r1' }, paye: [`2026-${m}-10`, ttc(385)] as [string, string] })),
      { id: 'fA1', date: '2026-07-22', clientId: 'c1', lignes: [[acompte(30, 'DEV-2026-004'), 3735, true]], extra: { projectId: 'pA', fromQuoteId: 'qA', deposit: { percent: 30, quoteId: 'qA', quoteNumber: 'DEV-2026-004' } }, paye: ['2026-07-25', ttc(3735)] },
      ...['08', '09'].map((m) => ({ id: `r-${m}`, date: `2026-${m}-01`, clientId: 'c4', lignes: [['Visite d\'entretien', 385]] as [string, number][], extra: { recurringId: 'r1' }, paye: [`2026-${m}-10`, ttc(385)] as [string, string] })),
      { id: 'fA2', date: '2026-09-30', clientId: 'c1', lignes: [['Installation électrique de la villa', 9850], ['Tableau et protections', 2600], ['Acompte déjà facturé (FAC-A1)', -3735, true]], extra: { projectId: 'pA', fromQuoteId: 'qA' }, paye: ['2026-10-10', ttc(8715)] },
      { id: 'r-10', date: '2026-10-01', clientId: 'c4', lignes: [['Visite d\'entretien', 385]], extra: { recurringId: 'r1' }, paye: ['2026-10-10', ttc(385)] },
      { id: 'fC1', date: '2026-10-14', clientId: 'c3', lignes: [[acompte(30, 'DEV-2026-008'), 7890, true]], extra: { projectId: 'pC', fromQuoteId: 'qC', deposit: { percent: 30, quoteId: 'qC', quoteNumber: 'DEV-2026-008' } }, paye: ['2026-10-20', ttc(7890)] },
      { id: 'fB1', date: '2026-10-26', clientId: 'c2', lignes: [['Colonnes montantes, 12 logements', 16900], ['Travaux supplémentaires', 640]], extra: { projectId: 'pB', fromQuoteId: 'qB' }, paye: ['2026-11-02', '10000.000'] },
    ];
    const numeros: Record<string, string> = {};
    for (const [i, f] of factures.entries()) {
      const ht = f.lignes.reduce((s, [, x]) => s + x, 0);
      const lignes = f.lignes.map(([label, x, sansRemise]) => ({ label: label.replace('FAC-A1', numeros.fA1 ?? ''), description: '', qty: 1, unit: '', unitPrice: n(x.toFixed(3)), vatRate: 19, ...(sansRemise ? { noDiscount: true } : {}) }));
      const e = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, karim, { document: { id: f.id, type: 'facture', number: '', status: 'brouillon', date: f.date, dueDate: f.date, clientId: f.clientId, createdAt: 10 + i,
        subject: 'Électricité', lines: lignes, discountRate: 0, withholdingRate: 0, applyStamp: false, stampFee: 0, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [], ...(f.extra ?? {}) },
      client: { id: f.clientId, name: f.clientId }, revision: null, rang: 30 + i, netAPayer: ttc(ht) })).corps;
      expect(String((e.contenu as Obj | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
      numeros[f.id] = String((e.contenu as Obj).number);
      if (f.paye) await api('POST', `/entreprises/${ent}/dossier-v10`, karim, { changements: [{ collection: 'documents', cle: f.id, rang: 30 + i, revision: Number(e.revision),
        contenu: { ...(e.contenu as Obj), payments: [{ id: `p-${f.id}`, date: f.paye[0], amount: n(f.paye[1]), method: 'virement' }] } }] });
    }

    // ── 1. La liste : le chantier en cours n'est plus rouge ; il dit sa marge attendue. Celui qui a perdu, si.
    const cx = await contexte(karim);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/marges`);
    await p.locator('#mg-body tr[data-pid="pB"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const lire = async (sel: string) => net(await p.locator(sel).innerText());
    // Rien n'a été refusé au chargement (les prix écrits « 385.000 » par l'API, relus « 385 » par la page).
    expect(await p.locator('#modal-root .modal', { hasText: 'Rien n\'a été enregistré' }).count()).toBe(0);
    const margeC = p.locator('#mg-body tr[data-pid="pC"] td.m');
    expect(net(await margeC.innerText())).toBe('− 2 325,558 en cours · attendue 8 449,600');
    expect(await margeC.getAttribute('class')).not.toContain('rouge');
    expect(await p.locator('#mg-body tr[data-pid="pB"] td.m').getAttribute('class')).toContain('rouge');
    expect(net(await p.locator('#mg-body tr[data-pid="pA"] td.m').innerText())).toBe('7 312,787 58,7 %');
    noter('AFFAIRES', await p.locator('#mg-body tr[data-pid]').allInnerTexts().then((l) => l.map(net)));
    await p.screenshot({ path: path.join(PHOTOS, 'marges-1300-affaires.png'), fullPage: true });

    // ── 2. La fiche du chantier en cours : à l'avancement, sans « perd de l'argent ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/affaire/pC`);
    await p.locator('#p-avancement').waitFor({ timeout: 10_000 });
    expect(await p.locator('.mg-perte').count()).toBe(0);
    expect(await lire('.mg-resume')).toContain('Marge à ce jour i − 2 325,558 DT attendue à la fin : 8 449,600 DT (32,1 %)');
    expect(await lire('#p-avancement')).toBe('Chantier en cours : 57,2 % du coût prévu est engagé. Les travaux faits valent environ 15 051,157 DT ; 7 890,000 DT sont facturés : 7 161,157 DT restent à facturer. Marge attendue à la fin : 8 449,600 DT (32,1 %). i');
    // L'écart au prévu n'est pas une perte : le vendu « − 18 410 » n'est plus rouge.
    expect(await p.locator('.mg-prevu .mg-pr-e.rouge').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'marges-1300-fiche-pC.png'), fullPage: true });
    // Le chantier terminé à perte le dit toujours.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/affaire/pB`);
    await p.locator('.mg-resume').waitFor({ timeout: 10_000 });
    expect(await lire('.mg-perte')).toMatch(/^Cette affaire perd de l'argent Elle a coûté 18 648,888 DT et 17 540,000 DT sont facturés\./);
    expect(await p.locator('#p-avancement').count()).toBe(0);

    // ── 3. Où est la marge : le client qui n'a reçu qu'un acompte n'a pas de taux (ce n'était pas 100 %).
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/marges`);
    await p.locator('#mg-body tr[data-pid]').first().waitFor({ timeout: 10_000 });
    await p.locator('#mg-tabs [data-tab="analyse"]').click();
    await p.locator('#mg-body tr[data-cl="c3"]').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#mg-body tr[data-cl="c3"]').innerText())).toBe('LS Lac Services 7 890,000 0,000 7 890,000 —');
    // ── 4. Le seuil : sans charge fixe notée, il ne prétend pas être dépassé.
    await p.locator('#mg-tabs [data-tab="seuil"]').click();
    await p.locator('#mg-sans-fixe').waitFor({ timeout: 10_000 });
    expect(await lire('#mg-sans-fixe')).toMatch(/^Le chiffre d'affaires minimum — Aucune charge fixe n'est notée en 2026 : ni loyer, ni assurance, ni abonnement, ni bulletin de paie\./);
    expect(await lire('#mg-body')).not.toContain('Tu l\'as dépassé');
    await p.screenshot({ path: path.join(PHOTOS, 'marges-1300-seuil.png'), fullPage: true });

    // ── 5. L'état des chantiers : aujourd'hui, puis au 20 octobre (l'immeuble Ennasr n'était pas fini : perte attendue).
    await p.locator('#mg-tabs [data-tab="affaires"]').click();
    await p.locator('#mg-etat').click();
    const etat = p.locator('#modal-root .modal.mg-etat-f');
    await etat.waitFor({ timeout: 10_000 });
    await etat.locator('[data-au]').last().click();
    await expect.poll(async () => net(await etat.locator('#mg-etat-phrase').innerText())).toMatch(/^1 chantier en cours au \d\d\/\d\d\/\d{4} : 7 161,157 DT de travaux faits pas encore facturés\.$/);
    expect(await etat.locator('tbody tr').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.pid))).toEqual(['pC']);
    expect(net(await etat.locator('#mg-etat-finis').innerText())).toBe('Terminés à cette date, rien à reporter : Immeuble Ennasr — colonnes montantes, Villa Karoui — Gammarth.');
    const txt = etat.locator('.datefield .d-txt');
    await txt.fill('20/10/2026');
    await txt.press('Enter');
    // Entrée pose la date : elle n'envoie rien (la fenêtre reste ouverte, la conversation ne s'ouvre pas).
    await p.waitForTimeout(300);
    expect(await p.evaluate(() => location.hash)).toBe('#/marges');
    await expect.poll(async () => net(await etat.locator('#mg-etat-phrase').innerText())).toBe('2 chantiers en cours au 20/10/2026 : 23 558,532 DT de travaux faits pas encore facturés, une perte attendue de 1 748,888 DT.');
    expect(net(await etat.locator('tr[data-pid="pB"]').innerText())).toBe('Immeuble Ennasr — colonnes montantes Promotion Ennasr perte attendue 1 748,888 0,000 18 648,888 sur 13 200,000 prévus 100 % 16 900,000 16 900,000');
    expect(net(await etat.locator('tr[data-pid="pC"]').innerText())).toBe('Bureaux Lac 2 Lac Services 7 890,000 9 874,415 sur 17 850,400 prévus 55,3 % 14 548,532 6 658,532');
    expect(net(await etat.locator('#mg-etat-finis').innerText())).toBe('Terminés à cette date, rien à reporter : Villa Karoui — Gammarth.');
    await p.screenshot({ path: path.join(PHOTOS, 'marges-1300-etat.png') });
    // L'export : le même état, une ligne par chantier.
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8_000 }), etat.locator('#mg-etat-csv').click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    expect(dl.suggestedFilename()).toBe('etat-des-chantiers-2026-10-20.csv');
    expect(csv).toContain('Immeuble Ennasr — colonnes montantes');
    expect(csv.split('\n').filter((l) => l.trim()).length).toBe(4);
    // Envoyer à la comptable : la conversation s'ouvre, le résumé prêt.
    await etat.locator('#mg-etat-envoi').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/comptable');
    const zone = p.locator('#msg-racine textarea').first();
    await expect.poll(async () => net(await zone.inputValue()), { timeout: 10_000 }).toMatch(/^Bonjour, voici l'état de mes chantiers au 20\/10\/2026\. - Bureaux Lac 2 \(Lac Services\), en cours : facturé 7 890,000 DT HT, coût engagé 9 874,415 DT sur 17 850,400 DT prévus \(55,3 %\) ; travaux faits environ 14 548,532 DT : 6 658,532 DT restent à facturer\. Marge attendue à la fin : 8 449,600 DT\. - Immeuble Ennasr — colonnes montantes \(Promotion Ennasr\), en cours : .* Perte attendue à la fin : 1 748,888 DT\. Terminés à cette date : Villa Karoui — Gammarth\. L'état est dans SkanFact \(Marges, État des chantiers\)\.$/);
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    // ── 6. Au Cabinet : l'état arrive dans la conversation du dossier, chiffres compris.
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, leila)).corps.messages as Obj[] ?? []).map((x) => net(String(x.texte))).find((x) => x.includes('état de mes chantiers')),
      { timeout: 15_000 }).toMatch(/Perte attendue à la fin : 1 748,888 DT\. Terminés à cette date : Villa Karoui — Gammarth\./);
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/messages`);
    await c.getByText('état de mes chantiers', { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    await c.waitForTimeout(800);
    await c.screenshot({ path: path.join(PHOTOS, 'marges-1300-cabinet-message.png') });
    noter('CABINET', net(await c.locator('body').innerText()).slice(0, 1500));

    // ── 7. Au téléphone : chaque montant dit ce qu'il est.
    const tel = await contexte(karim, 390, 844);
    const t = await tel.newPage();
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/marges`);
    await t.locator('#mg-body tr[data-pid="pC"]').waitFor({ timeout: 20_000 });
    await plusTard(t);
    expect(await t.locator('#mg-body tr[data-pid="pC"] td[data-l]').evaluateAll((l) => l.map((x) => getComputedStyle(x, '::before').content))).toEqual(['"Vendu HT"', '"Coût"', '"Marge"', '"En caisse"']);
    await t.screenshot({ path: path.join(PHOTOS, 'marges-1300-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
