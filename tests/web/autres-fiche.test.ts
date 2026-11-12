// Les autres pièces (proforma, bon de livraison, commande client, contrat de prestation) au squelette des pièces (1.291.0) :
// la frise selon ce qu'elles sont, UN bouton vert qui suit l'étape, la puce « Prix » du bon, un contrat signé qui se
// facture à date fixe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('les autres pièces au squelette des pièces', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-autres-fiche-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
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
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('proforma, bon, commande, contrat : la frise et le bouton vert de chaque étape', async () => {
    const email = `autres-fiche-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Ben Salah', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Ascenseurs Ben Salah' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = (k: number) => new Date(Date.parse(auj) + k * 86_400_000).toISOString().slice(0, 10);
    const L = (label: string, qty: number, prix: string) => ({ label, qty, unit: 'pièce', unitPrice: { '~n': prix }, vatRate: 19 });
    const piece = (id: string, type: string, number: string, status: string, extra: Record<string, unknown> = {}) => ({ collection: 'documents', cle: id, rang: 0, revision: null,
      contenu: { id, type, number, status, date: jour(-6), clientId: 'c1', subject: '', payments: [], emails: [], currency: 'DT', createdAt: Date.now(), withholdingRate: 0, lines: [L('Cabine inox', 2, '4875.250')], ...extra } });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Résidence Les Jasmins', city: 'Sousse' } },
      piece('pf', 'proforma', 'PRO-2026-001', 'envoyée'),
      piece('pf2', 'proforma', 'PRO-2026-002', 'envoyée'),
      piece('pf2f', 'facture', '', 'brouillon', { fromDocId: 'pf2', fromDocType: 'proforma', fromDocNumber: 'PRO-2026-002', applyStamp: true }),
      piece('bl', 'livraison', 'BL-2026-001', 'brouillon', { hidePrices: true }),
      piece('bc', 'commande', 'BC-2026-001', 'reçue', { lines: [L('Cabine inox', 4, '4875.250'), L('Porte palière', 6, '1210.000')] }),
      piece('bcl', 'livraison', 'BL-2026-002', 'émis', { fromDocId: 'bc', fromDocType: 'commande', fromDocNumber: 'BC-2026-001', lines: [L('Cabine inox', 2, '4875.250')] }),
      piece('ct', 'contrat', 'CTR-2026-001', 'envoyé', { lines: [L('Maintenance annuelle', 1, '5250.000')] }),
      piece('an', 'proforma', 'PRO-2026-003', 'annulée')] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    const ouvrir = async (hash: string) => {
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator('#ed-geste').waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const vert = () => p.locator('#ed-geste .btn-primary');
    const frise = async () => p.locator('#ed-frise li').evaluateAll((lis) => lis.map((li) => `${li.querySelector('b')?.textContent}:${li.className.trim().replace(/\s+/g, '+') || '-'}`));

    // Une proforma neuve : seul « Enregistrer la proforma » est vert, et la phrase dit le numéro qu'elle prendra.
    await ouvrir('#/doc/new/proforma');
    expect(await vert().count()).toBe(1);
    expect(net(await vert().innerText())).toBe('Enregistrer la proforma');
    expect(net(await p.locator('#ed-geste .ed-phrase').innerText())).toMatch(/^Elle prend son numéro \(PRO-\d{4}-\d{3}\) en s'enregistrant/);
    expect(await p.locator('#ed-frise').count()).toBe(0);

    // Une proforma envoyée sans suite : facturer est l'étape suivante ; la frise s'arrête à « Envoyée ».
    await ouvrir('#/doc/pf');
    expect(await vert().getAttribute('data-conv')).toBe('facture');
    expect(await frise()).toEqual(['Créée:fait', 'Envoyée:fait', 'Facturée:-']);
    // Sa facture attend en brouillon : le vert mène à elle, la frise dit « en brouillon » à moitié faite.
    await ouvrir('#/doc/pf2');
    expect(net(await vert().innerText())).toBe('Émettre la facture');
    expect(await vert().getAttribute('data-va')).toBe('#/doc/pf2f');
    expect(await frise()).toEqual(['Créée:fait', 'Envoyée:fait', 'Facturée:partiel']);
    await vert().click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/doc/pf2f');
    // Annulée : pas de vert, l'état le dit.
    await ouvrir('#/doc/an');
    expect(await vert().count()).toBe(0);
    expect(net(await p.locator('#ed-geste .ed-etat').innerText())).toBe('Annulée : elle ne compte plus.');

    // Un bon en brouillon : l'imprimer pour le faire signer ; ses prix sont masqués, la puce les imprime.
    await ouvrir('#/doc/bl');
    expect(await vert().getAttribute('data-clic')).toBe('pdf');
    expect(await frise()).toEqual(['Préparé:fait', 'Signé:-', 'Facturé:-']);
    expect(net(await p.locator('#f-head [data-etq=prix]').innerText())).toBe('Prix masqués sur le bon');
    await p.locator('#f-head [data-etq=prix]').click();
    await p.locator('.ed-pop [data-px="0"]').click();
    expect(net(await p.locator('#f-head [data-etq=prix]').innerText())).toBe('Prix imprimés');
    await expect.poll(() => p.locator('#save').isVisible(), { timeout: 5_000 }).toBe(true);
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('#view .page-head, #view header').first().innerText().catch(() => '')), { timeout: 10_000 }).toContain('enregistré');
    await ouvrir('#/doc/bl');
    expect(net(await p.locator('#f-head [data-etq=prix]').innerText())).toBe('Prix imprimés');
    await p.screenshot({ path: path.join(PHOTOS, 'autres-fiche-1-bon.png') });

    // Une commande livrée en partie : « Livrer le reste » est le vert, la frise « Livrée » à moitié.
    await ouvrir('#/doc/bc');
    expect(net(await vert().innerText())).toBe('Livrer le reste');
    expect(await frise()).toEqual(['Reçue:fait', 'Livrée:partiel', 'Facturé:-']);
    // Le bon remis (émis) de cette commande : il se facture ; sa signature se note d'un geste, à côté.
    await ouvrir('#/doc/bcl');
    expect(await vert().getAttribute('data-conv')).toBe('facture');
    expect(await frise()).toEqual(['Préparé:fait', 'Signé:partiel', 'Facturé:-']);
    await p.locator('#ed-geste .ed-deux [data-statut="signé"]').click();
    await expect.poll(async () => frise(), { timeout: 10_000 }).toEqual(['Préparé:fait', 'Signé:fait', 'Facturé:-']);
    expect(await vert().getAttribute('data-conv')).toBe('facture');
    expect(await p.locator('#ed-geste [data-statut]').count()).toBe(0);

    // Un contrat envoyé : « Le client a signé » ; signé, il propose sa facturation à date fixe, préremplie.
    await ouvrir('#/doc/ct');
    expect(net(await vert().innerText())).toBe('Le client a signé');
    await vert().click();
    await expect.poll(async () => net(await p.locator('#ed-geste .ed-etat').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Signé par le client : il court jusqu\'à ce que tu le passes « terminé ».');
    expect(await frise()).toEqual(['Rédigé:fait', 'Envoyé:fait', 'Signé:fait']);
    expect(await vert().count()).toBe(0);
    await p.locator('#ct-recurrent').click();
    const fenetre = p.locator('#modal-root');
    await expect.poll(async () => fenetre.locator('input').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value)), { timeout: 10_000 }).toContain('Contrat CTR-2026-001 — {mois}');
    expect(net(await fenetre.innerText())).toContain('Résidence Les Jasmins');
    expect(net(await fenetre.innerText())).toContain('5 250,000 DT HT');
    await p.screenshot({ path: path.join(PHOTOS, 'autres-fiche-2-contrat-signe.png') });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  // (1.357.3, bout en bout joué à la souris) La tournée d'une boulangerie : le bon s'imprime, le client signe d'un geste à
  // côté ; quand le client a d'autres bons à facturer, le vert les facture ensemble (« Facturer ce bon seul » à côté) ; la
  // fenêtre dit ce que le client paiera, sans colonne vide ; et un bon dont la facture est émise se dit « facturé » partout.
  it('(1.357.3) les bons d\'une tournée : signés d\'un geste, facturés ensemble, et chacun se dit « facturé »', async () => {
    const email = `autres-fiche-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Ben Salah', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Ascenseurs Ben Salah' })).id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = (k: number) => new Date(Date.parse(auj) + k * 86_400_000).toISOString().slice(0, 10);
    const L = (label: string, qty: number, prix: string) => ({ label, qty, unit: 'pièce', unitPrice: { '~n': prix }, vatRate: 19 });
    const piece = (id: string, type: string, number: string, status: string, extra: Record<string, unknown> = {}) => ({ collection: 'documents', cle: id, rang: 0, revision: null,
      contenu: { id, type, number, status, date: jour(-6), clientId: 'c1', subject: '', payments: [], emails: [], currency: 'DT', createdAt: Date.now(), withholdingRate: 0, lines: [L('Cabine inox', 2, '4875.250')], ...extra } });
    const P = (label: string, qty: number, prix: string, tva: number) => ({ label, qty, unit: '', unitPrice: { '~n': prix }, vatRate: tva });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel Les Palmiers SA', city: 'Hammamet' } },
      { collection: 'clients', cle: 'c2', rang: 0, revision: null, contenu: { id: 'c2', name: 'Café du Port', city: 'Sousse' } },
      piece('b0', 'livraison', 'BL-2026-001', 'brouillon', { lines: [] }),
      piece('b1', 'livraison', 'BL-2026-002', 'brouillon', { lines: [P('Baguette', 120, '0.200', 0), P('Croissant', 40, '1.200', 19)] }),
      piece('b2', 'livraison', 'BL-2026-003', 'signé', { lines: [P('Baguette', 100, '0.200', 0), P('Croissant', 30, '1.200', 19)] }),
      piece('b3', 'livraison', 'BL-2026-004', 'signé', { clientId: 'c2', lines: [P('Baguette', 50, '0.200', 0)] }),
      piece('b4', 'livraison', 'BL-2026-005', 'signé', { lines: [P('Baguette', 10, '0.200', 0)] }),
      piece('f4', 'facture', '', 'brouillon', { fromDocId: 'b4', fromDocType: 'livraison', fromDocNumber: 'BL-2026-005', applyStamp: true, lines: [P('Baguette', 10, '0.200', 0)] })] });
    expect(ecrit.motif ?? 'écrit').toBe('écrit');
    // La facture du bon BL-2026-005 s'émet par le serveur (c'est lui qui numérote) : 10 baguettes à 0,200 (0 %) + 1 de timbre.
    // Le timbre fiscal est une règle datée du serveur : posée pour CETTE entreprise d'essai, jamais pour toute la base.
    const proprio = String((await admin.query('select utilisateur from socle.membre where entreprise = $1 limit 1', [ent])).rows[0].utilisateur);
    await admin.query(`insert into socle.regle_entreprise (entreprise, code, valeur, debut, motif, cree_par) values ($1, 'timbre.facture', '1000', '2000-01-01', 'Timbre de l''essai', $2)`, [ent, proprio]);
    const f4 = piece('f4', 'facture', '', 'brouillon', { fromDocId: 'b4', fromDocType: 'livraison', fromDocNumber: 'BL-2026-005', applyStamp: true, lines: [P('Baguette', 10, '0.200', 0)] }).contenu;
    const emise = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: f4, client: { id: 'c1', name: 'Hôtel Les Palmiers SA', city: 'Hammamet' }, revision: 1, rang: 0, netAPayer: '3.000' });
    expect(emise.motif ?? 'émise', JSON.stringify(emise)).toBe('émise');

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    const ouvrir = async (hash: string) => {
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator('#ed-geste').waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const vert = () => p.locator('#ed-geste .btn-primary');
    const frise = async () => p.locator('#ed-frise li').evaluateAll((lis) => lis.map((li) => `${li.querySelector('b')?.textContent}:${li.className.trim().replace(/\s+/g, '+') || '-'}`));

    // Un bon vide : la carte dit « Total TTC » et que rien n'est dû sur le bon, comme dès sa première ligne.
    await ouvrir('#/doc/b0');
    expect(net(await p.locator('#totals .ed-net .k').innerText())).toBe('Total TTC');
    expect(net(await p.locator('#totals .ed-net .s').innerText())).toBe('rien n\'est dû sur le bon de livraison : seule la facture se paie');

    // Le bon en brouillon s'imprime pour être signé ; « Le client a signé » est à côté, et le note.
    await ouvrir('#/doc/b1');
    expect(await vert().getAttribute('data-clic')).toBe('pdf');
    expect(net(await p.locator('#ed-geste .ed-deux [data-statut="signé"]').innerText())).toBe('Le client a signé');
    await p.locator('#ed-geste .ed-deux [data-statut="signé"]').click();
    await expect.poll(async () => frise(), { timeout: 10_000 }).toEqual(['Préparé:fait', 'Signé:fait', 'Facturé:-']);
    // Le client a un autre bon signé sans facture : le vert les facture ensemble ; ce bon seul reste à côté. Le bon d'un autre
    // client et celui déjà facturé n'en sont pas.
    expect(net(await vert().innerText())).toBe('Facturer les 2 bons de ce client');
    expect(await vert().getAttribute('data-grouper')).not.toBeNull();
    const phrase = net(await p.locator('#ed-geste .ed-phrase').innerText());
    expect(phrase).toBe('Ce client a aussi BL-2026-003 à facturer : une seule facture pour tous, en brouillon ; tu décoches ceux qui attendent.');
    expect(net(await p.locator('#ed-geste .ed-deux [data-conv="facture"]').innerText())).toBe('Facturer ce bon seul');
    await vert().click();
    const fenetre = p.locator('#modal-root');
    await fenetre.locator('#fb-ok').waitFor({ timeout: 10_000 });
    expect(await fenetre.locator('[data-fb]').count()).toBe(2);
    expect(await fenetre.locator('#fb-bons th').evaluateAll((ths) => ths.map((t) => (t.textContent || '').trim()))).toEqual(['', 'Bon', 'Date', 'Montant HT']);
    // 220 baguettes à 0,200 (0 %) et 70 croissants à 1,200 (19 %) : 44 + 84 = 128 HT, 15,960 de TVA, 1 de timbre.
    expect(net(await fenetre.locator('#fb-total').innerText())).toBe('La facture : 128,000 DT HT, 144,960 DT à payer, timbre compris.');
    expect(net(await fenetre.locator('#fb-ok').innerText())).toBe('Facturer 2 bons');
    await p.screenshot({ path: path.join(PHOTOS, 'autres-fiche-3-tournee.png') });
    await fenetre.locator('#fb-ok').click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText().catch(() => '')), { timeout: 10_000 }).toBe('Facture de 2 bons');

    // La liste des bons : celui dont la facture est émise dit « facturé » ; ceux dont la facture attend en brouillon, et celui
    // de l'autre client, restent « signé ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/autres/livraison`);
    await p.locator('table.list tbody tr').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    const badges = await p.locator('table.list tbody tr').evaluateAll((trs) => Object.fromEntries(trs.map((tr) => [(tr.querySelector('td')?.textContent || '').trim(), (tr.querySelector('.badge')?.textContent || '').trim()])));
    expect(badges).toEqual({ 'BL-2026-001': 'brouillon', 'BL-2026-002': 'signé', 'BL-2026-003': 'signé', 'BL-2026-004': 'signé', 'BL-2026-005': 'facturé' });
    // Le bon facturé : la pastille dit « Facturé », la puce Statut « Signé · facturé » ; la VALEUR reste « signé ».
    await ouvrir('#/doc/b4');
    expect(net(await p.locator('.ed-pill').first().innerText())).toBe('Facturé');
    expect(net(await p.locator('#f-head [data-etq=statut]').innerText())).toBe('Statut Signé · facturé');
    expect(await p.locator('select[name=status]').first().evaluate((s) => [(s as HTMLSelectElement).value, (s as HTMLSelectElement).selectedOptions[0]?.textContent])).toEqual(['signé', 'Signé · facturé']);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
