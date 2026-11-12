// 1.356.8 (bout en bout 10, la peinture de la boutique) : la boulangerie a payé la facture du peintre (2 814,160 DT, 42,840 DT
// retenus, attestation remise), puis il envoie un avoir de 476 DT. L'attestation disait encore un brut de 2 856,000 DT pour une
// retenue de 35,700 ; rien ne disait qu'elle était à refaire ; la page de l'avoir disait « Réglée : plus rien n'est dû » et « plus
// rien à récupérer » alors que le fournisseur doit 468,860 DT ; les fenêtres de règlement écrivaient « 2814.16 ».
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
describe('1.356.8 : la retenue opérée après un avoir fournisseur, l\'avoir d\'une facture déjà payée, les montants des règlements en français', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-avoir-fournisseur-1356-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
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
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('l\'attestation corrigée, l\'avoir sur une facture déjà payée, le remboursement, les montants en français', async () => {
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const auj = jourDe(0);
    const fiche = (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets.find((o: Obj) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax',
      address: '12 rue de la Liberté, Sfax', matricule: '1234567A/A/M/000', rib: '08001000000001234538', bank: 'BIAT', activity: 'artisanat' };
    const n = (x: string) => ({ '~n': x });
    const ligne = (ht: string) => [{ label: 'Peinture de la boutique et du laboratoire', qty: 1, unitPrice: n(ht), vatRate: 19, destination: 'charge' }];
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'suppliers', cle: 's-peintre', rang: 0, revision: null, contenu: { id: 's-peintre', name: 'Peinture Ksibi', matricule: '0912345B/A/M/000', paymentTermsDays: 30, withholdingRate: n('1.5') } },
      // La facture : 2 400 HT, TVA 456, timbre 1 → 2 857 ; retenue 1,5 % de 2 856 = 42,840 ; net 2 814,160, payé en entier,
      // l'attestation remise pour 42,840.
      { collection: 'purchases', cle: 'a-1', rang: 0, revision: null, contenu: { id: 'a-1', kind: 'facture', number: 'PK-2611-07', date: auj, dueDate: jourDe(30), supplierId: 's-peintre',
        currency: 'DT', fees: 1, withholdingRate: n('1.5'), createdAt: Date.now(), lines: ligne('2400'), withholdingCertificate: true, withholdingCertificateAmount: n('42.84'),
        payments: [{ id: 'r-1', date: auj, amount: n('2814.16'), method: 'virement', reference: '' }] } },
      // L'avoir : 400 HT, TVA 76 → 476 ; retenue 7,140 ; net 468,860, déduit de la facture déjà payée. L'assiette de la facture
      // devient 2 856 − 476 = 2 380, la retenue 35,700 ; le fournisseur doit 468,860.
      { collection: 'purchases', cle: 'a-2', rang: 1, revision: null, contenu: { id: 'a-2', kind: 'avoir', number: 'PK-AV-2611-02', date: auj, supplierId: 's-peintre', achatLie: 'a-1',
        currency: 'DT', fees: 0, withholdingRate: n('1.5'), createdAt: Date.now(), lines: ligne('400') } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const surLeServeur = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets.filter((o: Obj) => o.collection === 'purchases') as Obj[];

    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    const texte = async (sel: string) => net(await p.locator(sel).first().innerText());

    // 1. « À faire » : l'attestation remise ne dit plus ce qui a été reversé — elle redevient à remettre, et la ligne le dit.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#todo-list').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const ligneAtt = p.locator('#todo-list li', { hasText: 'attestation de retenue' });
    expect(net(await ligneAtt.innerText())).toContain('1 attestation de retenue à remettre (dont 1 corrigée) 35,700 DT retenus à tes fournisseurs.');
    expect(net(await ligneAtt.innerText())).toContain('celle que ton fournisseur a en main ne dit plus ce que tu as reversé');
    // Sur ordinateur, aucun chevron seul sous la liste quand toutes les lignes y tiennent (le bouton n'existe que pour le
    // téléphone, qui en montre trois) ; au téléphone il paraît. La règle qui le cache perdait contre celle des boutons d'un
    // panneau : on la juge dans la page, à sa place sous la liste — la pose si ce dossier n'a pas assez de lignes pour l'avoir.
    const chevron = async () => p.evaluate(() => {
      let b = document.querySelector('#todo-more') as HTMLElement | null, pose = false;
      if (!b) { b = document.createElement('button'); b.id = 'todo-more'; b.className = 'btn btn-ghost todo-more tm-tel-seul'; b.innerHTML = '<span class="tm-t">Voir l\'autre</span>'; document.querySelector('#todo-list')?.after(b); pose = true; }
      const r = { classe: b.className, display: getComputedStyle(b).display, texte: b.innerText };
      if (pose) b.remove();
      return r;
    });
    const ordi = await chevron();
    if (ordi.classe.includes('tm-tel-seul')) expect(ordi.display).toBe('none');
    expect(ordi.texte).not.toMatch(/les 1 autres/);
    await p.setViewportSize({ width: 400, height: 860 });
    expect((await chevron()).display).toBe('inline-flex');
    await p.setViewportSize({ width: 1440, height: 900 });
    // « Voir la liste » mène à l'onglet « Retenues » du fournisseur : la base est celle d'après l'avoir, l'avoir n'y a pas sa ligne.
    await ligneAtt.locator('button').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toBe('#/fournisseur/s-peintre');
    await expect.poll(() => p.locator('[role=tab][data-onglet=retenues]').getAttribute('aria-selected')).toBe('true');
    const lignesRs = async () => (await p.locator('.cf-mini tbody tr').allInnerTexts()).map(net);
    await expect.poll(lignesRs).toEqual([expect.stringMatching(/^PK-2611-07 Peinture de la boutique et du laboratoire \S+ 2 380,000 DT avoir PK-AV-2611-02 déduit 35,700 DT Imprimer la corrigée$/)]);
    expect(await texte('#ff-attest')).toContain('PK-2611-07 · 35,700 DT retenus (corrigée : celle remise portait 42,840 DT)');

    // 2. La page de l'avoir : le fournisseur doit 468,860 DT, et le remboursement s'enregistre sur la facture.
    await p.evaluate(() => { location.hash = '#/achat/a-2'; });
    await p.locator('#recu-lie').waitFor({ timeout: 20_000 });
    expect(await texte('#recu-lie')).toBe('Enregistrer le remboursement');
    expect(await texte('#ac-phrase-lie')).toBe('Le fournisseur te doit 468,860 DT sur PK-2611-07, déjà réglée. Le remboursement s\'enregistre sur la facture.');
    expect(await texte('#ac-lie-bandeau')).toContain('La facture était déjà réglée : le fournisseur te doit 468,860 DT.');
    expect(await texte('#ed-frise')).toContain('Remboursé 468,860 DT attendus sur PK-2611-07');
    expect(await texte('#b-pay')).toContain('Il est déduit de PK-2611-07, que tu avais déjà réglée : sur cette facture, Peinture Ksibi te doit 468,860 DT.');
    expect(await texte('#b-pay')).not.toContain('plus rien à récupérer');
    expect(await texte('#ed-geste')).not.toContain('Réglée');
    expect(await texte('#ac-sup-faveur')).toBe('468,860 DT en ta faveur');

    // 3. La facture : la retenue que tu reverses est celle d'après l'avoir ; l'attestation est à refaire, et se refait.
    await p.evaluate(() => { location.hash = '#/achat/a-1'; });
    await p.locator('#rs-corrigee').waitFor({ timeout: 20_000 });
    expect(await texte('#ac-phrase-recu')).toBe('Le fournisseur te doit 468,860 DT : PK-AV-2611-02 s\'est déduit d\'une facture déjà payée. Le remboursement solde la facture.');
    expect(await texte('#b-totals')).toContain('tu reverses 35,700 DT de retenue au fisc · 7,140 DT de moins avec PK-AV-2611-02');
    // La tuile garde la retenue de la facture (elle s'additionne avec le net) et dit dessous ce qu'elle est devenue.
    expect(net(await p.locator('#b-pay .pay-grid > div').nth(1).locator('.v, .small').allInnerTexts().then((l) => l.join(' ')))).toBe('42,840 35,700 DT après PK-AV-2611-02');
    expect(await texte('#rs-corrigee')).toContain('L\'attestation remise portait 42,840 DT ; la retenue est maintenant de 35,700 DT. Remets à Peinture Ksibi l\'attestation corrigée');
    await p.locator('#rs-imprimer-c').click();
    const att = p.locator('#modal-root .modal');
    await att.waitFor();
    expect(net(await att.innerText())).toContain('Montant brut 2 380,000 DT TTC hors timbre (2 856,000 DT moins l\'avoir PK-AV-2611-02) Retenue 35,700 DT · 1,5 %');
    await att.locator('[data-close]').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await p.locator('#rs-remise-c').click();
    await expect.poll(() => p.locator('#rs-corrigee').count()).toBe(0);
    await expect.poll(async () => JSON.stringify((await surLeServeur()).find((o) => o.cle === 'a-1')?.contenu.withholdingCertificateAmount)).toBe(JSON.stringify(n('35.7')));

    // 4. Le remboursement : la fenêtre écrit « 468,860 », lit « 400,5 » en français, et dit ce qu'elle solde.
    await p.locator('#recu').click();
    const rb = p.locator('#modal-root .modal');
    await rb.waitFor();
    const montant = rb.locator('[name=amount]');
    expect(await montant.inputValue()).toBe('468,860');
    expect(net(await rb.locator('#ok').innerText())).toBe('Enregistrer · plus rien à récupérer');
    await rb.getByRole('button', { name: 'Une partie…' }).click();
    await montant.pressSequentially('400,5');
    await expect.poll(async () => net(await rb.locator('#ok').innerText())).toBe('Enregistrer · reste 68,360 DT');
    await rb.getByRole('button', { name: 'Tout le reste' }).click();
    expect(await montant.inputValue()).toBe('468,860');
    await rb.locator('[name=reference]').fill('VIR 991204');
    await rb.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(async () => JSON.stringify((await surLeServeur()).find((o) => o.cle === 'a-1')?.contenu.payments.map((x: Obj) => [x.amount, x.reference])))
      .toBe(JSON.stringify([[n('2814.16'), ''], [n('-468.86'), 'VIR 991204']]));
    // L'argent qui revient s'écrit « Remboursement », comme le moteur du serveur que lit le Cabinet.
    expect(await p.evaluate(() => { const w = window as unknown as { SkanCore: Obj; __data: Obj }; return w.SkanCore.journalEntries(w.__data, w.__data.company, null)
      .filter((e: Obj) => e.account === '532' && e.debit > 0).map((e: Obj) => e.label); })).toEqual(['Remboursement PK-2611-07 — Peinture Ksibi']);

    // 5. Remboursé, l'avoir le dit : plus rien à récupérer, et « ne lui dois rien » redevient vrai.
    await p.evaluate(() => { location.hash = '#/achat/a-2'; });
    await expect.poll(() => texte('#ed-geste'), { timeout: 20_000 }).toContain('Déduit de PK-2611-07 : plus rien à récupérer.');
    expect(await texte('#ac-lie-bandeau')).toContain('La facture était déjà réglée : le fournisseur t\'a remboursé le trop-payé.');
    expect(await p.locator('#ac-sup-faveur').count()).toBe(0);

    // 6. Les règlements fournisseur s'écrivent en français : seul, puis « Régler ensemble ».
    const fiche2 = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      // Deux factures à payer : 100 HT → 119 − 1,785 = 117,215 ; 200 HT → 238 − 3,570 = 234,430.
      { collection: 'purchases', cle: 'a-3', rang: 2, revision: null, contenu: { id: 'a-3', kind: 'facture', number: 'PK-2611-09', date: auj, dueDate: jourDe(30), supplierId: 's-peintre',
        currency: 'DT', fees: 0, withholdingRate: n('1.5'), createdAt: Date.now(), lines: ligne('100') } },
      { collection: 'purchases', cle: 'a-4', rang: 3, revision: null, contenu: { id: 'a-4', kind: 'facture', number: 'PK-2611-10', date: auj, dueDate: jourDe(30), supplierId: 's-peintre',
        currency: 'DT', fees: 0, withholdingRate: n('1.5'), createdAt: Date.now(), lines: ligne('200') } },
    ] });
    expect(fiche2.statut, JSON.stringify(fiche2.corps)).toBe(200);
    await p.evaluate(() => { location.hash = '#/achats'; });
    await p.reload();
    await plusTard(p);
    const choisir = (id: string) => p.locator(`#list-wrap tr[data-id="${id}"] input[data-x]`).click();
    await p.locator('#list-wrap tr[data-id="a-3"]').waitFor({ timeout: 20_000 });
    await choisir('a-3');
    await choisir('a-4');
    await p.locator('#bc-regler').click();
    const ens = p.locator('#modal-root .modal');
    await ens.waitFor();
    expect(await ens.locator('[name=amount]').inputValue()).toBe('351,645');
    await ens.locator('[data-close]').first().click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await p.evaluate(() => { location.hash = '#/achat/a-3'; });
    await p.locator('#pay').click({ timeout: 20_000 });
    const rg = p.locator('#modal-root .modal');
    await rg.waitFor();
    expect(await rg.locator('[name=amount]').inputValue()).toBe('117,215');
    await rg.getByRole('button', { name: 'Une partie…' }).click();
    await rg.locator('[name=amount]').pressSequentially('50,5');
    await expect.poll(async () => net(await rg.locator('#ok').innerText())).toBe('Enregistrer · reste 66,715 DT');
    await rg.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(async () => JSON.stringify((await surLeServeur()).find((o) => o.cle === 'a-3')?.contenu.payments.map((x: Obj) => x.amount))).toBe(JSON.stringify([n('50.5')]));
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
