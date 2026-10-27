// Les écarts de la maquette de l'achat (docs/maquettes/achat.html), revus le 27/10/2026, à la souris :
//   - la carte du fournisseur dit ce qu'on sait de lui : « paie à réception », l'attestation d'exonération (et la retenue
//     « aucune · exonéré »), « factures électroniques : oui (El Fatoora) » quand une de ses pièces est arrivée ainsi ;
//   - le bloc « Règlements » : le compte de chaque règlement, ce qu'il a retenu, l'attestation qui s'imprime ; un avoir à se
//     faire rembourser a son bloc « Remboursement » (quatre tuiles), sans le conseil d'un avoir neuf ;
//   - la frise dit qui a saisi la pièce (« par Sarra ») ;
//   - le cabinet a demandé la pièce dans le fil : le bandeau « Aucun justificatif » le dit, avec qui et quand ;
//   - ↶ (Ctrl Z) défait la dernière modification, « Rétablir » la refait ;
//   - un achat neuf se garde sur « mon ordinateur » : l'onglet fermé, il se reprend.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les écarts de la maquette de l\'achat, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-achat-ecarts-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  type Corps = Record<string, unknown> & { id?: string; code?: string; mandat?: string };
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Corps };
  };
  const personne = async (prefixe: string, nom: string) => {
    const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  // `garde` : la session gardée sur l'appareil (« mon ordinateur », le jeton dans localStorage) ; sinon, le temps de l'onglet.
  const contexte = async (jeton: string, garde = false) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript(([j, g]) => { if (location.protocol.startsWith('http')) (g ? localStorage : sessionStorage).setItem('skanfact.jeton', j as string); }, [jeton, garde] as const);
    return cx;
  };
  const plusTard = async (p: Page) => {
    await p.locator('#view h1, .as-ecran, [class*="assistant"]').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const passer = p.getByRole('button', { name: 'Je le ferai plus tard', exact: true });
    if (await passer.count()) await passer.first().click({ timeout: 3_000 }).catch(() => undefined);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
  const jm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const n = (x: string) => ({ '~n': x });

  it('la carte du fournisseur, les règlements, le remboursement, la frise et la demande du cabinet', async () => {
    const hatem = await personne('hatem', 'Hatem Jlassi');
    const cab = (await api('POST', '/cabinets', hatem, { nom: 'Cabinet Jlassi Conseil' })).corps;
    const sarra = await personne('sarra', 'Sarra Mansour');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, hatem)).statut).toBe(200);
    const cx = await contexte(sarra);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await plusTard(p);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    const auj = jour(0), fin = `${auj.slice(0, 4)}-12-31`;
    // Un fournisseur qui se paie à réception et a son attestation d'exonération (n° 2026-0318) ; une de ses factures est
    // arrivée par El Fatoora (son XML joint). Une facture à 1,5 % de retenue, réglée par virement ; un avoir libre.
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Sfax Informatique', matricule: '0844120F/A/M/000', paymentTermsDays: 0, withholdingRate: n('1.5'),
        exonerationsRS: [{ du: `${auj.slice(0, 4)}-01-01`, au: fin, numero: '2026-0318' }] } },
      { collection: 'suppliers', cle: 's2', rang: 1, revision: null, contenu: { id: 's2', name: 'Bureau Plus Sfax', matricule: '1390022T/A/M/000', paymentTermsDays: 30, withholdingRate: n('1.5') } },
      { collection: 'purchases', cle: 'a0', rang: 0, revision: null, contenu: { id: 'a0', kind: 'facture', number: 'SI-2026-0090', date: auj, dueDate: auj, supplierId: 's1', currency: 'DT', fees: 0, withholdingRate: 0, createdAt: Date.now(),
        attachments: [{ name: 'SI-2026-0090.xml', file: 'f-xml', size: 3000, date: auj }], payments: [{ id: 'r0', date: auj, amount: n('119'), method: 'virement' }],
        lines: [{ label: 'Souris sans fil', qty: 1, unitPrice: n('100'), vatRate: 19, destination: 'charge' }] } },
      { collection: 'purchases', cle: 'a1', rang: 1, revision: null, contenu: { id: 'a1', kind: 'facture', number: 'BP-2026-0412', date: auj, dueDate: jour(30), supplierId: 's2', currency: 'DT', fees: 1, withholdingRate: n('1.5'), createdAt: Date.now(),
        payments: [{ id: 'r1', date: auj, amount: n('1313.808'), method: 'virement', reference: 'VIR 2026-10-20' }],
        lines: [{ label: 'Imprimante laser', qty: 1, unitPrice: n('1120'), vatRate: 19, destination: 'charge' }] } },
      { collection: 'purchases', cle: 'e1', rang: 3, revision: null, contenu: { id: 'e1', kind: 'facture', number: 'INV-2026-77', date: auj, dueDate: jour(30), supplierId: 's2', currency: 'EUR', exchangeRate: n('3.398'), fees: 0, withholdingRate: 0, createdAt: Date.now(),
        lines: [{ label: 'Licence logiciel', qty: 1, unitPrice: n('100'), vatRate: 19, destination: 'charge' }] } },
      { collection: 'purchases', cle: 'v1', rang: 2, revision: null, contenu: { id: 'v1', kind: 'avoir', number: 'AV-BP-0031', date: auj, supplierId: 's2', currency: 'DT', fees: 0, withholdingRate: 0, createdAt: Date.now(),
        lines: [{ label: 'Cartouche retournée', qty: 1, unitPrice: n('300'), vatRate: 19, destination: 'charge' }] } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);

    // 1. La carte du fournisseur exonéré, et la retenue qui le dit.
    await p.reload(); await plusTard(p);
    await p.evaluate(() => { location.hash = '#/achat/a0'; });
    await p.locator('#ac-sup .ed-cl-puces').waitFor({ timeout: 20_000 });
    await expect.poll(async () => net(await p.locator('#ac-sup .ed-cl-puces').innerText())).toBe(`ne lui dois rien paie à réception exonéré de retenue jusqu'au 31/12/${auj.slice(0, 4)} (attestation n° 2026-0318) factures électroniques : oui (El Fatoora)`);
    expect(net(await p.locator('#ac-puce-rs').innerText())).toMatch(/Retenue opérée .*· exonéré$/);
    expect(net(await p.locator('#b-totals').innerText())).toContain('Retenue · fournisseur exonéré aucune');
    expect(net(await p.locator('#ac-ech-note').innerText())).toBe('à réception');
    // La frise : qui l'a saisie.
    expect(net(await p.locator('#ed-frise').innerText())).toContain(`Saisie ${jm(auj)} · par Sarra`);

    // 2. Les règlements : le compte, ce qui a été retenu, l'attestation qui s'imprime.
    await p.evaluate(() => { location.hash = '#/achat/a1'; });
    const regl = p.locator('#b-pay-panel');
    await regl.waitFor({ timeout: 20_000 });
    // Un fournisseur dont aucune pièce n'est arrivée par El Fatoora : la carte ne le suppose pas.
    await expect.poll(async () => net(await p.locator('#ac-sup .ed-cl-puces').innerText()), { timeout: 10_000 }).toBe('1 autre facture à payer · rien en retard paie à 30 jours');
    expect(net(await regl.locator('.ac-bloc-t').innerText())).toBe('Règlements i');
    expect((await regl.locator('thead th').allInnerTexts()).map(net)).toEqual(['DATE', 'MODE', 'COMPTE', 'RÉFÉRENCE', 'MONTANT', '']);
    expect(net(await regl.locator('tbody tr').first().innerText())).toMatch(/^\d\d\/\d\d\/\d{4} Virement .+ VIR 2026-10-20 1 313,808 \+ 19,992 retenus$/);
    expect(net(await regl.locator('.ac-attest').innerText())).toBe('Attestation de retenue remise au fournisseur (19,992 DT retenus) · l\'imprimer i');
    await regl.getByRole('button', { name: 'l\'imprimer', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root h2').innerText().catch(() => '')).toBe('Attestation de retenue à la source');
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    // La fenêtre d'un règlement dit la retenue en titre, puis ce que le fournisseur reçoit.
    await p.screenshot({ path: path.join(PHOTOS, 'achat-ecarts-1-reglements.png'), fullPage: true });

    // La devise et son taux dans une seule puce (« Devise Euro · 1 € = 3,398 DT »).
    await p.evaluate(() => { location.hash = '#/achat/e1'; });
    await expect.poll(() => p.locator('#ac-puce-dev select[name=currency]').inputValue().catch(() => ''), { timeout: 20_000 }).toBe('EUR');
    expect(net(await p.locator('#ac-puce-dev .ac-taux').innerText())).toBe('· 1 € = DT i');
    expect(await p.locator('#ac-puce-dev input[name=exchangeRate]').inputValue()).toBe('3.398');
    expect(await p.locator('#ac-puce-dev').getAttribute('class')).toContain(' on');

    // 3. L'avoir à se faire rembourser : « Remboursement », quatre tuiles, et plus le conseil d'un avoir neuf.
    await p.evaluate(() => { location.hash = '#/achat/v1'; });
    await expect.poll(async () => net(await p.locator('#b-pay-panel .ac-bloc-t').innerText().catch(() => '')), { timeout: 20_000 }).toBe('Remboursement i Enregistrer le remboursement reçu');
    expect((await p.locator('#b-pay-panel .pay-grid .k-label').allInnerTexts()).map(net)).toEqual(['MONTANT DE L\'AVOIR', 'DÉDUIT D\'UNE FACTURE', 'REMBOURSÉ', 'À RÉCUPÉRER']);
    expect(net(await p.locator('#b-pay-panel .note-v').innerText())).toBe('Tant qu\'il n\'est ni déduit d\'une facture, ni remboursé, Bureau Plus Sfax te le doit.');
    expect(await p.locator('#ac-lie-bandeau').isHidden()).toBe(true);
    expect(net(await p.locator('#ac-band-rembourse').innerText())).toMatch(/^Bureau Plus Sfax te doit 357,000 DT/);

    // 4. Le cabinet a demandé la facture dans le fil : son bandeau le dit, avec qui et quand.
    expect((await api('POST', `/entreprises/${ent}/messages`, hatem, { cote: 'cabinet', texte: '', demande: 'La facture BP-2026-0412 de Bureau Plus', pour: jour(2) })).statut).toBe(201);
    await p.reload();
    await plusTard(p);
    await p.evaluate(() => { location.hash = '#/achat/a1'; });
    await expect.poll(async () => net(await p.locator('#ac-band-justif').innerText().catch(() => '')), { timeout: 20_000 })
      .toBe(`Aucun justificatif : ni la charge ni la TVA ne sont récupérables sans lui Hatem, de ton cabinet, te l'a demandé le ${jm(auj)} dans votre fil. Joins la photo, le PDF ou le fichier El Fatoora de la pièce : il se range ici, et ton cabinet le verra. Joindre la pièce`);
    await p.screenshot({ path: path.join(PHOTOS, 'achat-ecarts-2-demande-du-cabinet.png') });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  it('↶ défait la dernière modification ; un achat neuf se garde sur « mon ordinateur » et se reprend', async () => {
    const sarra = await personne('sarra', 'Sarra Mansour');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const cx = await contexte(sarra, true);
    let p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await plusTard(p);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    const auj = jour(0);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Grands Moulins de Sfax', paymentTermsDays: 30 } },
      { collection: 'purchases', cle: 'a1', rang: 0, revision: null, contenu: { id: 'a1', kind: 'facture', number: 'GMS-26-4471', date: auj, dueDate: jour(30), supplierId: 's1', currency: 'DT', fees: 0, withholdingRate: 0, createdAt: Date.now(),
        lines: [{ label: 'Farine T55, sacs de 50 kg', qty: 10, unitPrice: n('48.5'), vatRate: 19, destination: 'charge' }] } },
    ] })).statut).toBe(200);

    // 1. ↶ : le numéro changé revient ; « Rétablir » le refait ; la pièce reste à enregistrer.
    await p.reload(); await plusTard(p);
    await p.evaluate(() => { location.hash = '#/achat/a1'; });
    const numero = p.locator('#b-head input[name=number]');
    await numero.waitFor({ timeout: 20_000 });
    expect(await p.locator('#ac-annuler').isDisabled()).toBe(true);
    await numero.fill('GMS-26-4472');
    await p.locator('#view h1').click();
    await expect.poll(() => p.locator('#ac-annuler').isDisabled()).toBe(false);
    await p.locator('#ac-annuler').click();
    await expect.poll(() => p.locator('#b-head input[name=number]').inputValue()).toBe('GMS-26-4471');
    expect(net(await p.locator('#toast .toast-txt').innerText())).toBe('Annulé : la pièce revient comme avant la dernière modification');
    await p.locator('#toast').getByRole('button', { name: 'Rétablir', exact: true }).click();
    await expect.poll(() => p.locator('#b-head input[name=number]').inputValue()).toBe('GMS-26-4472');
    // Ctrl Z, hors d'une case : même geste.
    await p.locator('#view h1').click();
    await p.keyboard.press('Control+z');
    await expect.poll(() => p.locator('#b-head input[name=number]').inputValue()).toBe('GMS-26-4471');
    expect(await p.locator('#dirty-dot').isVisible()).toBe(true);

    // 2. Un achat neuf, commencé puis l'onglet fermé : gardé sur cet appareil, il se reprend.
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click({ timeout: 10_000 });
    await p.locator('#ac-main').click({ timeout: 20_000 });
    if (!(await p.locator('[data-k=label]').count())) await p.locator('#add-line').click();
    await p.locator('#b-lines input[data-k=label]').first().fill('Levure fraîche, 10 kg');
    await p.locator('#b-lines input[data-k=unitPrice]').first().fill('85.5');
    await expect.poll(() => p.locator('#ac-garde').isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await p.locator('#ac-garde').innerText())).toBe('brouillon gardé à chaque frappe');
    p.removeAllListeners('dialog');
    await p.close({ runBeforeUnload: false });
    p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/new`);
    await plusTard(p);
    const bandeau = p.locator('#ac-reprendre');
    await bandeau.waitFor({ timeout: 20_000 });
    expect(net(await bandeau.innerText())).toMatch(/^Facture d'achat commencée le \d\d\/\d\d à \d\d h \d\d, pas encore enregistrée 1 ligne · 101,745 DT\. Gardée sur cet ordinateur seulement : rien ne compte dans tes achats avant « Enregistrer »\. Reprendre Le jeter$/);
    await p.screenshot({ path: path.join(PHOTOS, 'achat-ecarts-3-reprendre.png') });
    await bandeau.getByRole('button', { name: 'Reprendre', exact: true }).click();
    await expect.poll(() => p.locator('#b-lines input[data-k=label]').first().inputValue().catch(() => '')).toBe('Levure fraîche, 10 kg');
    // Enregistré, il n'attend plus : la pièce neuve suivante n'a rien à reprendre.
    await p.locator('[data-combo=supplierId] .combo-btn').click();
    await p.locator('.combo-pop').getByText('Grands Moulins de Sfax', { exact: true }).click();
    await p.locator('#save').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/achat\/(?!new)/);
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await p.locator('#ac-main').waitFor({ timeout: 20_000 });
    await p.waitForTimeout(1500);
    expect(await p.locator('#ac-reprendre').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  // (1.163.0, vu par Skander le 27/10/2026, maquette « Ticket joint · 2 fichiers ») « j'ai déposé un fichier et je voulais en
  // déposer un deuxième, sauf que c'est flou : je ne sais pas lequel a été pris, et le deuxième je ne le vois même pas » ; et
  // « l'étape est restée Joindre un justificatif ».
  it('un ticket joint à une dépense rangée : statut, bandeau, frise et bouton changent aussitôt ; deux fichiers se lisent ; retirer le dernier revient', async () => {
    const sarra = await personne('sarra-pj', 'Sarra Mansour');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const cx = await contexte(sarra);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await plusTard(p);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    const auj = jour(0);
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'purchases', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', kind: 'depense', date: auj, currency: 'DT', fees: 0, withholdingRate: 0, createdAt: Date.now(), subject: 'Péage A1',
        payments: [{ id: 'r1', date: auj, amount: n('9'), method: 'especes' }], lines: [{ label: 'Péage autoroute A1', qty: 1, unitPrice: n('7.563'), vatRate: 19, destination: 'charge' }] } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    await p.reload(); await plusTard(p);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.evaluate(() => { location.hash = '#/achat/d1'; });
    await p.locator('#ac-geste-joindre').waitFor({ timeout: 20_000 }).catch(async (e) => { await p.screenshot({ path: path.join(PHOTOS, 'achat-ecarts-justificatifs-echec.png') }); throw e; });
    const pill = () => p.locator('.ed-tete .ed-pill').innerText().then(net);
    const etapeJustif = () => p.locator('#ed-frise li', { hasText: 'Justificatif' }).innerText().then(net);
    expect(await pill()).toBe('Sans justificatif');
    expect(await p.locator('#ac-band-justif').count()).toBe(1);
    expect(await etapeJustif()).toBe('! Justificatif manque Joindre : pas encore');
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const choisir = async (bouton: string, fichier: { name: string; mimeType: string; buffer: Buffer }) => {
      const [c] = await Promise.all([p.waitForEvent('filechooser'), p.locator(bouton).click()]);
      await c.setFiles(fichier);
    };
    // Le bouton principal « Joindre le ticket » : tout ce qui disait « manque » change d'un coup, sans recharger.
    await choisir('#ac-geste-joindre', { name: 'ticket-peage-A1.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(pill, { timeout: 15_000 }).toBe('Réglée');
    expect(await p.locator('#ac-band-justif').count()).toBe(0);
    expect(await etapeJustif()).toBe('Justificatif la photo : fait');
    expect(await p.locator('#ac-geste-joindre').count()).toBe(0);
    expect(net(await p.locator('#ed-geste').innerText())).toContain('Réglée : plus rien n\'est dû.');
    expect(net(await p.locator('#toast .toast-txt').innerText())).toBe('Justificatif joint : ticket-peage-A1.png');
    // Un second fichier : il se nomme dans la liste, en tête du panneau, et devient celui qu'on regarde.
    await choisir('#add-att', { name: 'recu-parking.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(() => p.locator('#attachments .pjp-r .pjp-n b').allInnerTexts(), { timeout: 15_000 }).toEqual(['ticket-peage-A1.png', 'recu-parking.png']);
    expect(await p.locator('#attachments .pjp-r').evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-selected')))).toEqual(['false', 'true']);
    expect(net(await p.locator('#p-pj h2').innerText())).toBe('Justificatifs i 2 fichiers · gardés 10 ans');
    expect(net(await p.locator('#toast .toast-txt').innerText())).toBe('Justificatif joint : recu-parking.png · 2 fichiers sur la pièce');
    expect(await etapeJustif()).toBe('Justificatif 2 fichiers joints : fait');
    // Le panneau tient dans la colonne : la liste, puis l'aperçu, puis « Joindre un autre fichier » (rien ne se cache dessous).
    const haut = async (sel: string) => (await p.locator(sel).boundingBox())?.y ?? -1;
    expect(await haut('#attachments .pjp-liste')).toBeLessThan(await haut('#attachments .ac-pj'));
    expect(await haut('#attachments .ac-pj')).toBeLessThan(await haut('#attachments #add-att'));
    await p.locator('#p-pj').screenshot({ path: path.join(PHOTOS, 'achat-ecarts-justificatifs.png') });
    // Le serveur porte les deux.
    await expect.poll(async () => {
      const o = ((await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as { cle: string; contenu: { attachments?: { name: string }[] } }[]).find((x) => x.cle === 'd1');
      return (o?.contenu.attachments ?? []).map((a) => a.name);
    }, { timeout: 15_000 }).toEqual(['ticket-peage-A1.png', 'recu-parking.png']);
    // Retirer les deux : la pièce redit « Sans justificatif », partout.
    for (const nom of ['recu-parking.png', 'ticket-peage-A1.png']) {
      await p.locator('#attachments .pjp-r', { hasText: nom }).getByRole('button', { name: `Gestes de « ${nom} »` }).click();
      await p.getByRole('menuitem', { name: /^Retirer ce justificatif/ }).click();
      await p.locator('.modal').last().getByRole('button', { name: 'Retirer', exact: true }).click();
      await expect.poll(() => p.locator('#attachments').innerText(), { timeout: 15_000 }).not.toContain(nom);
    }
    await expect.poll(pill).toBe('Sans justificatif');
    expect(await p.locator('#ac-band-justif').count()).toBe(1);
    expect(await etapeJustif()).toBe('! Justificatif manque Joindre : pas encore');
    expect(await p.locator('#ac-geste-joindre').isVisible()).toBe(true);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
