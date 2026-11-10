// Bout en bout, 1.353.0 : la première facture d'une épicerie neuve (« Épicerie fine du Lac »), jouée à la souris puis tenue ici.
// La fenêtre d'émission ne propose pas une signature DigiGo qui sera refusée ; ce qui est coché s'ouvre l'un après l'autre ;
// un virement noté sans compte ne tombe pas dans la caisse créée ensuite, et la Trésorerie le compte et le nomme.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'bout-en-bout-1353.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('bout en bout 1.353.0 : la première facture d\'une épicerie neuve, son virement et sa caisse', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-bout-en-bout-1353-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'bout-en-bout-1353.txt'), '');
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
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('l\'émission ne propose pas une signature qui sera refusée, ouvre l\'un après l\'autre ce qui est coché, et un virement sans compte ne tombe pas dans la caisse', async () => {
    const sonia = await personne('sonia');
    const ent = String((await api('POST', '/entreprises-essai', sonia)).corps.id);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, sonia)).corps.objets as Obj[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sonia Ben Youssef', name: 'Épicerie fine du Lac', city: 'Tunis' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sonia, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe }] })).statut).toBe(200);
    const clients = [
      { id: 'c1', name: 'Restaurant Dar Zitouna', matricule: '0987654C/A/M/000', city: 'Tunis' },
      { id: 'c2', name: 'Café des Nattes', email: 'cafe.nattes@exemple.tn', city: 'Sidi Bou Saïd' },
    ];
    const facture = (id: string, clientId: string) => ({ id, type: 'facture', number: '', date: jourDe(0), dueDate: jourDe(30), clientId, subject: 'Huile d\'olive', status: 'brouillon',
      lines: [{ label: 'Huile d\'olive extra vierge 75 cl', description: '', qty: 12, unit: '', unitPrice: 25, vatRate: 19, discount: 0 }],
      discountRate: 0, applyStamp: true, stampFee: 1, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], notes: '' });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sonia, { changements: [
      ...clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: i, revision: null, contenu: enc(c) })),
      ...['f1', 'f2'].map((f, i) => ({ collection: 'documents', cle: f, rang: i, revision: null, contenu: enc(facture(f, i ? 'c2' : 'c1')) })),
    ] })).statut).toBe(200);

    const cx = await contexte(sonia);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(String(e)));
    const titreFenetre = async () => net(await p.locator('#modal-root .modal h2').last().innerText().catch(() => ''));

    // 1. La première facture. Sur ce serveur la signature DigiGo n'est pas prête (pas branchée, personne de désigné) :
    //    la fenêtre d'émission ne la propose pas ; elle propose le paiement.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await p.locator('#issue').waitFor();
    await plusTard(p);
    expect((await api('GET', `/entreprises/${ent}/efacture/signataire`, sonia)).corps.signataire).toBeNull();
    await p.locator('#issue').click();
    await p.locator('#modal-root [data-apres="payer"]').waitFor();
    expect(await p.locator('#modal-root [data-apres="signer"]').count()).toBe(0);
    expect(await p.locator('#modal-root [data-apres="envoyer"]').count()).toBe(0);
    await p.locator('#modal-root [data-apres="payer"]').check();
    await p.locator('#modal-root #ok').click();
    // Le paiement coché s'ouvre, et dit qu'aucun compte n'existe encore.
    await p.locator('#modal-root #pf2').waitFor({ timeout: 15_000 });
    expect(await titreFenetre()).toContain('Enregistrer un paiement');
    expect(net(await p.locator('#pf-sans-compte').innerText())).toContain('Aucun compte de trésorerie');
    await p.locator('#pf2 [name=amount]').fill('200');
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => ((await objets()).find((o) => o.collection === 'documents' && o.cle === 'f1')?.contenu.payments ?? []).length, { timeout: 15_000 }).toBe(1);
    const paiement = ((await objets()).find((o) => o.collection === 'documents' && o.cle === 'f1')?.contenu.payments ?? [])[0] as Obj;
    noter('paiement', paiement);
    expect(String(paiement.method)).toBe('virement');
    expect(paiement.accountId || '').toBe('');

    // 2. Elle crée sa caisse (50 DT de fond) : son seul compte, donc le compte par défaut.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sonia, { changements: [{ collection: 'accounts', cle: 'cs', rang: 0, revision: null,
      contenu: enc({ id: 'cs', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 50, openingDate: jourDe(0), isDefault: true, statementBalance: '', notes: '' }) }] })).statut).toBe(200);
    // Le serveur : le virement reste au journal de banque, jamais à la caisse.
    await expect.poll(async () => (await admin.query(`select journal from compta.ecriture where entreprise = $1 and origine_type = 'encaissement'`, [ent])).rows.map((r) => r.journal).join(','), { timeout: 15_000 }).toBe('BQ');
    // L'écran : la caisse porte son fond, les 200 DT sont comptés et nommés « sans compte ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
    await p.reload();
    await p.locator('#tr-comptes [data-acc="cs"]').waitFor();
    await plusTard(p);
    expect(net(await p.locator('#tr-comptes [data-acc="cs"] .tr-c-solde').innerText())).toContain('50,000');
    const sans = net(await p.locator('#tr-sans-compte').innerText());
    noter('sans compte', sans);
    expect(sans).toContain('200,000');
    expect(sans).toContain('1 règlement');
    expect(net(await p.locator('.tr-dispo').innerText())).toContain('250,000');
    await p.screenshot({ path: path.join(PHOTOS, 'bout-en-bout-1353-1-sans-compte.png') });
    // Le geste : créer le compte bancaire ; le virement s'y range, et le bandeau disparaît.
    await p.locator('#tr-creer-banque').click();
    await p.locator('#modal-root [name=name]').waitFor();
    if (!(await p.locator('#modal-root [name=name]').inputValue()).trim()) await p.locator('#modal-root [name=name]').fill('Compte courant');
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => p.locator('#tr-sans-compte').count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(async () => p.locator('#tr-comptes [data-acc]').count()).toBe(2);
    expect(net(await p.locator('.tr-dispo').innerText())).toContain('250,000');
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'accounts').map((o) => String(o.contenu.kind)).sort().join(','), { timeout: 15_000 }).toBe('banque,caisse');

    // 3. La seconde facture, pour un client qui a une adresse : « L'envoyer » et « paiement » cochés ensemble s'ouvrent
    //    l'un APRÈS l'autre (avant, seul le premier s'ouvrait).
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f2`);
    await p.locator('#issue').waitFor();
    await plusTard(p);
    await p.locator('#issue').click();
    await p.locator('#modal-root [data-apres="payer"]').waitFor();
    expect(await p.locator('#modal-root [data-apres="envoyer"]').isChecked()).toBe(true);
    await p.locator('#modal-root [data-apres="payer"]').check();
    await p.locator('#modal-root #ok').click();
    await expect.poll(titreFenetre, { timeout: 15_000 }).not.toContain('Émettre');
    await expect.poll(async () => p.locator('#modal-root').evaluate((r) => r.children.length), { timeout: 15_000 }).toBeGreaterThan(0);
    const premier = await titreFenetre();
    noter('premier geste', premier);
    expect(premier).not.toContain('Enregistrer un paiement');
    // On referme l'envoi sans envoyer : le paiement s'ouvre à son tour.
    for (let i = 0; i < 4 && !(await titreFenetre()).includes('Enregistrer un paiement'); i++) {
      await p.keyboard.press('Escape');
      const quitter = p.locator('#modal-root .modal').last().getByRole('button', { name: /Abandonner|Fermer sans|Quitter/ });
      if (await quitter.count()) await quitter.first().click().catch(() => undefined);
      await p.waitForTimeout(700);
    }
    expect(await titreFenetre()).toContain('Enregistrer un paiement');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
