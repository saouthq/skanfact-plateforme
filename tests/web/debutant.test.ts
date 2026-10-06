// Le lot débutant (1), à la souris (06/10/2026 ; docs/debutant.md). Un commerçant qui débute a fait le tour de
// SkanFact sur le serveur d'essai ; ce parcours tient ce qu'il a trouvé faux :
//   - Paramètres : la recherche ne compte que ce qu'elle montre (« 4 réglages sur 28 » sur une page vide) ; le
//     bandeau « Il manque… » se redessine après « Enregistrer » ; « Ta fiche est à jour » exige un matricule complet ;
//   - Stock : à date égale, les mouvements se lisent dans l'ordre où ils ont eu lieu (« Stock après » ne saute plus) ;
//   - Comptabilité : « Préparer » une déclaration de TVA ouvre le mois qu'elle déclare, pas celui de l'échéance ;
//   - Dépense : elle se saisit par ce qu'on a payé (TTC), le hors taxes s'en déduit au millime ;
//   - Avoir : émis sur une facture payée, il porte « Rembourser … au client ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { libererMatricule } from '../matricule-libre.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
// Un jour de calendrier d'aujourd'hui : la page Stock montre l'année en cours.
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

describe('le lot débutant (1), à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-debutant-'));
  beforeAll(async () => {
    await admin.connect();
    // Le timbre d'une facture est une règle fiscale du serveur (la base des tests n'en a pas d'elle-même).
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };

  // Une personne, son code en place, et son jeton ; `essai` lui ouvre l'entreprise d'essai (ses clients).
  async function personne(essai: boolean) {
    const email = `debutant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amine', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const essaiId = essai ? String((await api('POST', '/entreprises-essai', premier)).corps.id) : '';
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = essaiId || String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Amine Informatique' })).corps.id);
    return { jeton, ent };
  }
  async function poser(jeton: string, ent: string, changements: unknown[]) {
    const r = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  }
  async function fiche(jeton: string, ent: string) {
    return ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
  }
  async function ouvrir(jeton: string, ent: string, route: string) {
    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${route}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 }).catch(async (x) => { await p.screenshot({ path: path.join(PHOTOS, 'debutant-echec.png') }); throw new Error(`${String(x)} — ${erreurs.join(' | ')} — ${(await p.locator('body').innerText()).slice(0, 600)}`); });
    await p.waitForTimeout(600);
    await plusTard(p);
    return { p, erreurs, fermer: () => cn.close() };
  }

  it('Paramètres : la recherche ne compte que ce qu\'elle montre ; le bandeau se redessine ; « Ta fiche est à jour » exige un matricule complet', async () => {
    const { jeton, ent } = await personne(false);
    const f = await fiche(jeton, ent);
    // Le matricule tapé à moitié, comme le débutant (quatre chiffres) ; la raison sociale et l'adresse sont là.
    await poser(jeton, ent, [{ collection: '_racine', cle: 'company', rang: null, revision: f?.revision ?? null,
      contenu: { ...f?.contenu, name: 'Amine Informatique', address: 'Avenue Habib Bourguiba\n4000 Sousse', matricule: '1234' } }]);
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/parametres');
    // La preuve de la visite « Compléter ma fiche » : sa fin (« Ta fiche est à jour ») est fausse sur ce matricule.
    const ficheAJour = () => p.evaluate(() => {
      const w = window as unknown as { SkanVisites: { parcours: (c: unknown) => { id: string; preuve: () => boolean }[] }; __data: unknown };
      return w.SkanVisites.parcours({ data: () => w.__data }).find((v) => v.id === 'societe')?.preuve();
    });
    expect(await ficheAJour()).toBe(false);
    expect(net(await p.locator('#set-manque-zone').innerText())).toContain('un matricule fiscal valide');

    // Le matricule complet, « Enregistrer » : le bandeau ne parle plus du matricule, sans recharger la page.
    await libererMatricule(inject('pgAdmin'), '2345678C/A/M/000');
    await p.locator('#pf input[name=matricule]').fill('2345678C/A/M/000');
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('#set-manque-zone').innerText())).not.toContain('matricule');
    expect(await ficheAJour()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-1-fiche.png') });

    // La recherche : ce qu'elle annonce est ce qu'elle montre (un réglage absent en ligne ne se compte pas).
    const annonceEtVus = async (mot: string) => {
      await p.locator('#set-q').fill(mot);
      await expect.poll(() => p.locator('#set-res').isVisible()).toBe(true);
      const texte = net(await p.locator('#set-res').innerText());
      const annonce = /^(\d+) réglages? sur \d+/.exec(texte);
      const vus = await p.locator('#set-res .set-hit').evaluateAll((xs) => xs.filter((x) => (x as HTMLElement).offsetParent !== null).length);
      return [annonce ? Number(annonce[1]) : 0, vus];
    };
    const [annonceSauvegarde, vusSauvegarde] = await annonceEtVus('sauvegarde');
    expect(annonceSauvegarde).toBe(vusSauvegarde);
    const [annonceTimbre, vusTimbre] = await annonceEtVus('timbre');
    expect(vusTimbre).toBeGreaterThan(0);
    expect(annonceTimbre).toBe(vusTimbre);
    expect(await p.locator('#set-q').getAttribute('placeholder')).toBe('Chercher un réglage : timbre, logo…');
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('Stock : à date égale, les mouvements se lisent dans l\'ordre où ils ont eu lieu ; Comptabilité : « Préparer » ouvre le mois déclaré', async () => {
    const { jeton, ent } = await personne(false);
    const f = await fiche(jeton, ent);
    // Un stock de départ de 10 claviers, puis un clavier cassé, le même jour : « Stock après » lit 10, puis 9.
    await poser(jeton, ent, [
      { collection: '_racine', cle: 'company', rang: null, revision: f?.revision ?? null, contenu: { ...f?.contenu, name: 'Amine Informatique', address: 'Avenue Habib Bourguiba\n4000 Sousse' } },
      { collection: 'catalog', cle: 'clavier', rang: 0, revision: null, contenu: { id: 'clavier', label: 'Clavier USB', unit: 'u', unitPrice: { '~n': '29.412' }, vatRate: 19, tracked: true,
        initialQty: 10, initialCost: { '~n': '20' }, initialDate: AUJOURDHUI } },
      { collection: 'stockAdjustments', cle: 'adj-casse', rang: 0, revision: null, contenu: { id: 'adj-casse', date: AUJOURDHUI, itemId: 'clavier', qty: -1, note: 'tombé du rayon' } },
    ]);
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/stock');
    await p.locator('#st-tabs button[data-tab=mouvements]').click();
    const lignes = p.locator('#st-body table.list tbody tr');
    await expect.poll(() => lignes.count()).toBe(2);
    const apres = await lignes.evaluateAll((trs) => trs.map((tr) => (tr.lastElementChild?.textContent ?? '').trim()));
    expect(apres).toEqual(['9', '10']);
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-2-mouvements.png') });

    // « Préparer » la déclaration de TVA : le mois d'avant son échéance.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#c-tabs button[data-tab=calendrier]').click();
    const preparer = p.locator('[data-fvers=tva]').first();
    const echeance = String(await preparer.getAttribute('data-fdate'));
    const [y, m] = [Number(echeance.slice(0, 4)), Number(echeance.slice(5, 7))];
    const mois = new Date(Date.UTC(y, m - 2, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    await preparer.click();
    await expect.poll(async () => net(await p.locator('#c-body h2').first().innerText())).toMatch(new RegExp(`^Déclaration de TVA — ${mois}( i)?$`));
    expect(await p.locator('#c-month').inputValue()).toBe(String(m === 1 ? 12 : m - 1).padStart(2, '0'));
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-3-tva.png') });
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('Dépense : elle se saisit par ce qu\'on a payé ; le hors taxes s\'en déduit au millime, et suit le taux', async () => {
    const { jeton, ent } = await personne(false);
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/achat/new/-/depense');
    expect(net(await p.locator('#b-lignes-hint').innerText())).toBe('Tape ce que tu as payé dans « Montant payé (TTC) » et choisis son taux de TVA : SkanFact en déduit le hors taxes.');
    await p.locator('input[data-k=label]').first().fill('Facture STEG électricité septembre');
    await p.locator('#b-ttc').fill('85.4');
    // 85,400 payés à 19 % : 71,765 hors taxes, 13,635 de TVA — le total retombe sur ce qui a été payé.
    await expect.poll(() => p.locator('input[data-k=unitPrice]').first().inputValue()).toBe('71.765');
    expect(net(await p.locator('#b-totals').innerText())).toContain('Net à payer 85,400 DT');
    expect(net(await p.locator('#b-ttc-note').innerText())).toBe('Hors taxes : 71,765 DT ; TVA à 19 % : 13,635 DT.');
    // Le taux change : le hors taxes se recalcule, le total reste ce qui a été payé.
    await p.locator('select[data-k=vatRate]').first().selectOption('7');
    await expect.poll(() => p.locator('input[data-k=unitPrice]').first().inputValue()).toBe('79.813');
    expect(net(await p.locator('#b-totals').innerText())).toContain('Net à payer 85,400 DT');
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-4-depense.png') });
    // Un hors taxes tapé à la main reprend la main : le montant payé s'efface.
    await p.locator('input[data-k=unitPrice]').first().fill('50');
    expect(await p.locator('#b-ttc').inputValue()).toBe('');
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('Avoir : émis sur une facture payée, il porte « Rembourser … au client », qui enregistre le remboursement sur la facture', async () => {
    const { jeton, ent } = await personne(true);
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const menuiserie = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!menuiserie) throw new Error('client d\'exemple absent');
    const doc = {
      id: 'f1', type: 'facture', number: '', date: AUJOURDHUI, dueDate: AUJOURDHUI, clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, unitCost: 300, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
    };
    await poser(jeton, ent, [{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: doc }]);
    const emise = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: menuiserie.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
    expect(emise.statut, JSON.stringify(emise.corps)).toBe(200);
    // Payée entière, puis une table rendue (536,095) : 536,095 à rendre au client.
    await poser(jeton, ent, [{ collection: 'documents', cle: 'f1', rang: 0, revision: Number(emise.corps.revision),
      contenu: { ...(emise.corps.contenu as Record<string, unknown>), payments: [{ id: 'p1', date: AUJOURDHUI, amount: { '~n': '1073.19' }, method: 'virement', reference: 'VIR-77', accountId: 'banque' }] } }]);
    const avoir = {
      id: 'a1', type: 'avoir', number: '', date: AUJOURDHUI, clientId: menuiserie.cle, creditOf: 'f1', creditReason: 'Une table rendue', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 1, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
    };
    await poser(jeton, ent, [{ collection: 'documents', cle: 'a1', rang: 1, revision: null, contenu: avoir }]);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre-avoir`, jeton, { document: avoir, client: menuiserie.contenu, revision: 1, rang: 1, netAPayer: '536.095' })).statut).toBe(200);

    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/doc/a1');
    const rembourser = p.locator('#rembourser-avoir');
    await expect.poll(async () => net(await rembourser.innerText()), { timeout: 10_000 }).toBe('Rembourser 536,095 DT au client…');
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-5-avoir.png') });
    await rembourser.click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Rembourser le client');
    await fenetre.getByRole('button', { name: 'Enregistrer le remboursement', exact: true }).click();
    await expect.poll(async () => net(await p.locator('#toast').innerText())).toBe('Remboursement enregistré : 536,095 DT rendus au client');
    // Rendu : la facture redevient simplement réglée, l'avoir n'a plus rien à rendre.
    await expect.poll(() => rembourser.count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);
});
