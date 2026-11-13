// 1.357.0, demandé par Skander : « pourquoi la facture d'achat reste comme ça quand elle est enregistrée, et pas comme la facture,
// avec le nouvel écran et le résumé ? ». Une facture de vente émise se lit (1.133.0) : un résumé, ses lignes éteintes, le geste
// suivant. La facture d'achat enregistrée, elle, restait le formulaire de saisie, douze cases à relire. Elle se lit désormais
// comme la vente ; « Modifier la pièce » rouvre le formulaire (`#/achat/<id>/modifier`), et l'enregistrement y ramène au résumé.
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
describe('1.357.0 : la facture d\'achat enregistrée se lit en résumé, et « Modifier la pièce » rouvre son formulaire', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-achat-resume-1357-'));
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

  it('Sarra relit une facture d\'achat enregistrée, la modifie, et revient au résumé ; au téléphone aussi', async () => {
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const auj = jourDe(0);
    const fiche = (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets.find((o: Obj) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax',
      address: '12 rue de la Liberté, Sfax', matricule: '1234567A/A/M/000', rib: '08001000000001234538', bank: 'BIAT', activity: 'artisanat' };
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'suppliers', cle: 's-peintre', rang: 0, revision: null, contenu: { id: 's-peintre', name: 'Peinture Ksibi', matricule: '0912345B/A/M/000', paymentTermsDays: 30 } },
      { collection: 'purchases', cle: 'a-1', rang: 0, revision: null, contenu: { id: 'a-1', kind: 'facture', number: 'PK-2611-07', date: auj, dueDate: jourDe(30), supplierId: 's-peintre',
        currency: 'DT', fees: 1, withholdingRate: 0, category: 'Entretien et réparations', subject: 'Peinture de la boutique', createdAt: Date.now(),
        lines: [{ label: 'Peinture de la boutique', qty: 1, unitPrice: 2400, vatRate: 19, destination: 'charge' }] } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const surLeServeur = async (col: string, cle: string) => ((await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as Obj[]).find((o) => o.collection === col && o.cle === cle)?.contenu;

    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    const resume = p.locator('#lecture-piece');
    const visible = (sel: string) => p.locator(sel).first().isVisible();

    // 1. La pièce enregistrée s'ouvre en résumé : la carte du fournisseur, ce que dit la pièce en lignes à lire, ses lignes
    // éteintes, et le geste suivant (régler). Aucune case de saisie à l'écran.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/a-1`);
    await resume.waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(await p.locator('#view .buy-editor').getAttribute('class')).toMatch(/\blecture\b/);
    const lu = net(await resume.innerText());
    // 2 400 HT + 19 % + 1 DT de timbre = 2 857,000 à payer.
    // (1.357.8) Comme la facture émise, le résumé finit par l'affaire, toujours là avec son geste ; la ligne « Comptabilité »
    // vient s'y glisser quand l'écriture d'achat est lue (asynchrone : elle peut ne pas être encore là).
    expect(lu).toMatch(/^Date \d{2}\/\d{2}\/\d{4} · échéance le \d{2}\/\d{2}\/\d{4} Objet Peinture de la boutique Catégorie Entretien et réparations Net à payer 2 857,000 DT · TTC 2 857,000 · timbre et frais 1,000( Comptabilité Au journal des achats, au brouillard : pas encore validée\. · voir l'écriture)? Affaire Aucune · Ranger dans une affaire$/);
    expect(net(await p.locator('#ac-sup').innerText())).toContain('Peinture Ksibi');
    expect(await visible('#b-head [name=number]')).toBe(false);
    expect(await visible('#b-subject')).toBe(false);
    expect(await p.locator('#b-lines input[data-k=unitPrice]').first().isDisabled()).toBe(true);
    expect(net(await p.locator('#b-lines .ligne-lue').first().innerText())).toBe('Peinture de la boutique');
    expect(await p.locator('#b-lines [data-rowmenu]').count()).toBe(0);
    expect(await p.locator('#ac-annuler').count()).toBe(0);
    expect(await visible('#pay')).toBe(true);
    expect(await p.locator('#view .btn-primary').evaluateAll((bs) => bs.filter((b) => (b as HTMLElement).offsetParent).map((b) => (b as HTMLElement).innerText.trim()))).toEqual(['Enregistrer un règlement']);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'achat-resume-1357-1-resume.png') });

    // 2. « Modifier la pièce » rouvre le formulaire, à son adresse ; le chemin le dit, et « Voir le résumé » y ramène.
    await p.locator('#ac-modifier').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/achat/a-1/modifier');
    await p.locator('#b-subject').waitFor({ timeout: 10_000 });
    expect(await p.locator('#lecture-piece').count()).toBe(0);
    expect(net(await p.locator('#view .ed-chemin').innerText())).toBe('Accueil › Achats et dépenses › PK-2611-07 › Modifier');
    expect(await visible('#ac-resume')).toBe(true);
    expect(await p.locator('#b-lines input[data-k=unitPrice]').first().isDisabled()).toBe(false);
    await p.locator('#b-subject').fill('Peinture de la boutique et de la vitrine');
    await p.keyboard.press('Control+s');
    // Enregistrée, la pièce revient à son résumé, qui dit le nouvel objet.
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/achat/a-1');
    await resume.waitFor({ timeout: 10_000 });
    expect(net(await resume.innerText())).toContain('Objet Peinture de la boutique et de la vitrine');
    await expect.poll(async () => (await surLeServeur('purchases', 'a-1'))?.subject, { timeout: 15_000 }).toBe('Peinture de la boutique et de la vitrine');

    // 3. Une modification qu'on abandonne : « Voir le résumé » demande avant de la jeter, et la pièce n'a pas bougé.
    await p.locator('#ac-modifier').click();
    await p.locator('#b-subject').waitFor({ timeout: 10_000 });
    await p.locator('#b-subject').fill('Une faute de frappe');
    await p.locator('#ac-resume').click();
    const quitter = p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true });
    await quitter.waitFor({ timeout: 10_000 });
    await quitter.click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/achat/a-1');
    await resume.waitFor({ timeout: 10_000 });
    expect(net(await resume.innerText())).toContain('Objet Peinture de la boutique et de la vitrine');
    expect((await surLeServeur('purchases', 'a-1'))?.subject).toBe('Peinture de la boutique et de la vitrine');
    // Le retour mène à la liste des achats, jamais d'un état à l'autre de la même pièce.
    expect(await p.locator('#view .ed-retour-btn').getAttribute('aria-label')).toBe('Revenir aux achats');

    // 4. Au téléphone : le résumé, puis le geste suivant ; « Modifier la pièce » se voit et rien ne déborde.
    const tel = await contexte(sarra, 390, 844);
    await tel.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const t = await tel.newPage();
    t.on('pageerror', (x) => erreurs.push(x.message));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/a-1`);
    await t.locator('#lecture-piece').waitFor({ timeout: 20_000 });
    await plusTard(t);
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const boite = await t.locator('#ac-modifier').boundingBox();
    expect(boite && boite.x >= 0 && boite.x + boite.width <= 390).toBe(true);
    await t.screenshot({ animations: 'disabled', fullPage: true, path: path.join(PHOTOS, 'achat-resume-1357-2-telephone.png') });
    await tel.close();

    // 5. Une pièce NEUVE enregistrée arrive sur son résumé.
    await p.evaluate(() => { location.hash = '#/achat/new/s-peintre'; });
    const num = p.locator('#b-head [name=number]');
    await num.waitFor({ timeout: 15_000 });
    await num.fill('PK-2611-08');
    await p.locator('#b-lines input[data-k=label]').first().fill('Rouleaux et pinceaux');
    await p.locator('#b-lines input[data-k=unitPrice]').first().fill('85');
    await p.locator('#save').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/achat\/[^/]+$/);
    await p.locator('#lecture-piece').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#view .ed-h1').innerText())).toContain('PK-2611-08');

    expect(erreurs).toEqual([]);
  }, 180_000);
});
