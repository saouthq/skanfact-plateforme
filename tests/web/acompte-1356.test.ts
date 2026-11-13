// Bout en bout 8 (1.356.5) : le devis des petits-déjeuners d'un séminaire pour l'Hôtel Les Palmiers SA (retenue 1 %), un
// acompte de 30 %, puis le solde. Le seuil de la retenue (1 000 DT TTC) est la règle `retenue.seuil` : ce test la pose comme
// une règle de CETTE entreprise (`socle.regle_entreprise`), sans toucher à la base commune — l'écran et le serveur lisent la
// même (servie au seul navigateur, l'émission tombait : 386,560 à l'écran, 382,704 au serveur). Ce qu'il tient :
//   - « Si le devis devient une facture » respecte le seuil : sous 1 000 DT TTC, pas de retenue (avant : − 8,568 DT sur un
//     devis de 856,800) ; au-dessus, la retenue du client ;
//   - la fenêtre de l'acompte annonce les deux factures telles qu'elles naîtront : chacune sous le seuil, sans retenue
//     (avant : 382,704 DT annoncés pour une facture de 386,560) ; « TTC + timbre » ne compte plus le timbre deux fois ;
//     l'écart avec une seule facture se dit par ce qui le fait (deux timbres, la retenue qu'aucune ne porte — réglées d'un
//     seul paiement, elle peut s'appliquer : À VÉRIFIER ; avant, « elle se fera au paiement » promettait un geste absent) ;
//   - le message et la facture d'acompte disent le même montant ;
//   - l'acompte émis, le devis annonce LA FACTURE DE SOLDE (avant : encore la facture entière, 1 273,348), et sa frise ne
//     dit plus « marqué envoyé » d'un devis ni envoyé ni marqué ; « Facture de solde » dit le TTC que la facture dira.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'acompte-1356.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('bout en bout 1.356.5 : le devis de l\'hôtel, son acompte et son solde', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-acompte-1356-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'acompte-1356.txt'), '');
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

  it('le devis respecte le seuil, l\'acompte s\'annonce comme il naîtra, et le message dit le montant de la facture', async () => {
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as Obj[];
    const auj = jourDe(0);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax',
      address: '12 rue de la Liberté, Sfax', matricule: '1234567A/A/M/000', rib: '08001000000001234538', bank: 'BIAT', activity: 'artisanat' };
    const hotel = { id: 'c-hotel', name: 'Hôtel Les Palmiers SA', matricule: '1472583B/A/M/000', city: 'Hammamet', withholdingRate: 1 };
    // 600 croissants à 1,200 HT : 720 HT, 856,800 TTC — sous le seuil de 1 000 DT.
    const devis = { id: 'd-sem', type: 'devis', number: 'DEV-2026-001', date: auj, dueDate: jourDe(30), clientId: 'c-hotel', subject: 'Petits-déjeuners du séminaire, 3 jours',
      status: 'brouillon', lines: [{ label: 'Croissant', description: '', qty: 600, unit: '', unitPrice: { '~n': '1.2' }, vatRate: 19, itemId: 'k-croissant' }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], regimeTva: 'reel' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-hotel', rang: 0, revision: null, contenu: hotel },
      { collection: 'catalog', cle: 'k-croissant', rang: 0, revision: null, contenu: { id: 'k-croissant', label: 'Croissant', unit: '', unitPrice: { '~n': '1.2' }, vatRate: 19 } },
      { collection: 'documents', cle: 'd-sem', rang: 0, revision: null, contenu: devis },
    ] })).statut).toBe(200);

    // Le seuil de la retenue (1 000 DT, en millimes), règle de cette seule entreprise : l'écran le lit, le serveur l'applique.
    const proprio = String((await admin.query('select utilisateur from socle.membre where entreprise = $1 limit 1', [ent])).rows[0].utilisateur);
    await admin.query(`insert into socle.regle_entreprise (entreprise, code, valeur, debut, motif, cree_par) values ($1, 'retenue.seuil', '1000000', '2000-01-01', 'Seuil de l''essai', $2)`, [ent, proprio]);
    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    // (1.357.0) Le seuil arrive APRÈS le dessin du devis, comme sur une machine lente (rouge GitHub de la 1.356.9, Node 24) :
    // la pièce doit le reprendre quand il arrive, et non garder la retenue annoncée sans lui.
    await p.route((u) => u.pathname.endsWith('/regles/retenue.seuil'), async (r) => { await new Promise((ok) => setTimeout(ok, 2_500)); await r.continue(); });
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/d-sem`);
    await p.locator('.ed-si-facture').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const siFacture = async () => net(await p.locator('.ed-si-facture').innerText().catch(() => ''));
    // 1. Sous le seuil : le timbre, et pas de retenue.
    await expect.poll(siFacture, { timeout: 10_000 }).toBe('SI LE DEVIS DEVIENT UNE FACTURE Timbre fiscal + 1,000 Le client paiera 857,800');
    // 2. 900 croissants : 1 285,200 TTC, au-dessus du seuil — la retenue du client.
    const qte = p.locator('#lines tr[data-i="0"] input[data-k=qty]');
    await qte.fill('900');
    await qte.press('Tab');
    await expect.poll(siFacture, { timeout: 10_000 }).toBe('SI LE DEVIS DEVIENT UNE FACTURE Timbre fiscal + 1,000 Retenue 1 % du client − 12,852 Le client paiera 1 273,348');
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('.ed-tete, .page-head').first().innerText().catch(() => ''))).toContain('enregistré');
    // 3. L'acompte de 30 % : deux factures sous le seuil, sans retenue ; le TTC ne compte le timbre qu'une fois.
    if (!(await p.locator('#deposit').isVisible())) await p.getByRole('button', { name: /^Facturer/ }).first().click();
    await p.locator('#deposit').click();
    const fen = p.locator('#modal-root .modal').last();
    await fen.locator('#dp-acompte').waitFor();
    await expect.poll(async () => net(await fen.locator('#dp-acompte').innerText())).toBe('386,560 DT');
    expect(net(await fen.locator('#dp-solde').innerText())).toBe('900,640 DT');
    const details = await fen.locator('.ac-2 small').allInnerTexts();
    // Le TTC est celui que chaque facture dira (timbre compris) ; le timbre y est « dont », plus ajouté une seconde fois.
    expect(details.map(net)).toEqual(['à payer · 386,560 DT TTC, dont timbre 1,000 DT', 'à payer · 900,640 DT TTC, dont timbre 1,000 DT']);
    // Le mot et son montant ne se séparent pas (avant : « + timbre » en fin de ligne, « 1,000 DT » sur la suivante).
    expect(details.every((d) => d.includes('dont\u00a0timbre\u00a01,000\u00a0DT'))).toBe(true);
    expect(net(await fen.locator('.note-v').innerText())).toBe('Deux factures, deux timbres, et aucune retenue sur elles : chacune est sous le seuil (12,852 DT ; réglées d\'un seul paiement, la retenue peut s\'appliquer : À VÉRIFIER avec ton comptable). Ensemble, elles font 1 287,200 DT à payer, 13,852 DT de plus qu\'une seule facture.');
    await p.screenshot({ path: path.join(PHOTOS, 'acompte-1356-1-fenetre.png') });
    // 4. Le brouillon : le message et la facture disent le même montant.
    await fen.locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => ''))).toContain('Facture d\'acompte de 386,560 DT en brouillon');
    await expect.poll(async () => net(await p.locator('#totals .ed-net').innerText().catch(() => '')), { timeout: 15_000 }).toContain('386,560');
    // « Avant d'émettre » ne promet plus un geste qui n'existe pas (« elle se fera au paiement ») : rien ne calcule une retenue
    // sur un paiement groupé, et l'écran le dit.
    await expect.poll(async () => net(await p.locator('#ed-avant').innerText().catch(() => ''))).toContain('pas de retenue sur la facture. Réglée avec d\'autres d\'un seul paiement de ce montant ou plus, la retenue peut s\'appliquer : À VÉRIFIER avec ton comptable, SkanFact ne la calcule pas sur un paiement groupé');
    await p.screenshot({ path: path.join(PHOTOS, 'acompte-1356-2-facture.png') });
    // 5. L'acompte émis, le devis annonce LA FACTURE DE SOLDE : l'acompte déduit (son TTC hors timbre), le timbre du solde,
    //    et pas de retenue — le solde est sous le seuil. Avant, l'encadré annonçait encore la facture entière (1 273,348).
    // (1.357.8) L'état El Fatoora de la facture d'acompte répondait APRÈS le départ vers le devis, et repeignait la frise du
    // devis (rouge GitHub de 8bd8be8, Node 24) : la réponse est retardée ici, pour jouer ce cas à chaque fois.
    let servie: () => void = () => undefined;
    const reponseServie = new Promise<void>((ok) => { servie = ok; });
    await p.route('**/efacture/etats**', async (r) => { await new Promise((ok) => setTimeout(ok, 2_500)); await r.continue(); servie(); });
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^FAC-/);
    const numAcompte = net(await p.locator('#view h1').first().innerText()).split(' ')[0] ?? '';
    await p.evaluate(() => { location.hash = '#/doc/d-sem'; });
    await expect.poll(siFacture, { timeout: 15_000 }).toBe(`LA FACTURE DE SOLDE Acompte ${numAcompte} déduit − 385,560 Timbre fiscal + 1,000 Le client paiera 900,640`);
    // 6. La frise ne dit plus « marqué envoyé » d'un devis qu'on n'a ni envoyé ni marqué (accepté par l'acompte). Lue APRÈS
    // la réponse retardée de la facture : elle reste celle du devis.
    await reponseServie;
    await new Promise((ok) => setTimeout(ok, 800));
    await p.unroute('**/efacture/etats**');
    const frise = net(await p.locator('#ed-frise').innerText());
    expect(frise).toMatch(/Envoyé\W*aucun envoi noté/i);
    expect(frise).not.toMatch(/marqué envoyé/i);
    // 7. « Facture de solde » : le même montant, et le TTC que la facture dira (timbre compris, « dont »).
    await p.locator('#settle2').click();
    const solde = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await solde.locator('#sd-net').innerText().catch(() => ''))).toBe('900,640 DT à payer');
    expect(net(await solde.locator('.ed-recap').innerText())).toContain('900,640 DT à payer · 900,640 DT TTC, dont timbre 1,000 DT');
    await p.screenshot({ path: path.join(PHOTOS, 'acompte-1356-3-solde.png') });
    // 8. La facture de solde créée, le devis est facturé en entier : plus rien à annoncer sous son total.
    await solde.locator('#sd-ok').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => ''))).toContain('Facture de solde de 900,640 DT en brouillon');
    await p.evaluate(() => { location.hash = '#/doc/d-sem'; });
    await p.locator('#totals .ed-net').waitFor({ timeout: 15_000 });
    await expect.poll(() => p.locator('.ed-si-facture').count()).toBe(0);
    // 9. Le devis facturé en deux fois nomme ses deux factures (avant : « Facturé : FAC-… » du seul solde), et son menu ne
    //    propose plus d'acompte ; « Refacturer la totalité… » reste, la porte assumée.
    await expect.poll(async () => net(await p.locator('#ed-geste').innerText().catch(() => ''))).toContain(`Facturé : acompte ${numAcompte}, solde en brouillon.`);
    expect(net(await p.locator('#ed-frise').innerText())).toMatch(new RegExp(`Factur\\S*\\W*acompte ${numAcompte}, solde en brouillon`, 'i'));
    // Un numéro ne se coupe pas sur son tiret (« solde FAC- » en fin de ligne, « 2026-003 » sur la suivante).
    expect(await p.locator('#ed-geste .nw', { hasText: numAcompte }).count()).toBe(1);
    expect(await p.locator('#bill-list #deposit').count()).toBe(0);
    expect(await p.locator('#bill-list #convert').count()).toBe(1);
    noter('fin', { erreurs });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
