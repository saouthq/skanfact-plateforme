// L'instrument de rendu (12 § 4, 14 § 2.6), ouvert dans un vrai navigateur, à la largeur d'un
// téléphone (390) et d'un ordinateur (1 440). Chaque écran est photographié dans dist/photos, pour
// être regardé par un humain (règle du projet).
//
//   - Les écrans de l'ENTRÉE (se connecter, créer son compte, le code, la porte), écrits pour la
//     plateforme : en français et en langue factice (40 % plus longue). Rien ne déborde, rien n'est
//     coupé, tout se touche du doigt (44 points), et chaque phrase vient du catalogue.
//   - Les pages de l'application v10 (son code repris tel quel) : aucune page ne défile de côté sur
//     un téléphone, rien ne sort de l'écran, et les cibles du téléphone font 44 points. Leurs textes
//     sont ceux de la v10, en français : la langue factice ne les concerne pas.
//
// Un instrument qui n'atteint pas l'écran dirait « tout va bien » : chaque écran prouve d'abord qu'il
// est bien celui qu'on croit (son titre), et le compte des écrans vérifiés est exigé.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { problemes } from '../instrument-rendu.ts';
import { rendre, t, type Langue } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const titre = (cle: string, langue: Langue) => { const s = rendre(t(cle), langue); const i = s.search(/\p{L}/u); return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1); };

// En langue factice, chaque texte visible vient du catalogue (⟦…⟧), sauf les données (data-donnee).
function horsCatalogue(): string[] {
  const pb: string[] = [];
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    const texte = (n.textContent ?? '').trim();
    if (!/\p{L}{2,}/u.test(texte) || n.parentElement?.closest('[data-donnee], script, style')) continue;
    if (!texte.includes('⟦')) pb.push(texte.slice(0, 60));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[aria-label]')) {
    if (!(el.getAttribute('aria-label') ?? '').includes('⟦')) pb.push(`aria-label « ${el.getAttribute('aria-label')} »`);
  }
  return pb;
}

describe('l\'instrument de rendu des écrans', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
  let n = 0;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await admin.end();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => (await (await fetch(`${serveur.adresse}/v1${chemin}`, {
    method: methode, headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  })).json()) as Record<string, unknown>;
  // Une personne, connectée par l'API ; `etape` la mène où l'écran doit la trouver.
  type Etape = 'vide' | 'code_requis' | 'prete';
  async function personne(etape: Etape) {
    const email = `rendu-${++n}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Leïla Ben Youssef-Trabelsi', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Essai', type: 'navigateur' } })).jeton);
    if (etape === 'vide') return { jeton, ent: '' };
    // Le code du téléphone n'est exigé que d'un comptable de cabinet (0076, décision du 09/10/2026).
    if (etape === 'code_requis') { await api('POST', '/cabinets', jeton, { nom: 'Cabinet Ben Youssef-Trabelsi' }); return { jeton, ent: '' }; }
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    return { jeton, ent };
  }
  // Un défi par e-mail en cours, comme l'onglet le garde (App.tsx) : l'écran du code s'ouvre sans rien demander au
  // serveur (le défi n'est lu qu'au geste).
  const defi = (raison: 'inscription' | 'appareil') => ({ defi: '00000000-0000-4000-8000-000000000000', methode: 'courriel', posteDUnAutre: false, adresse: 'leila.benyoussef-trabelsi@exemple.tn', raison });

  type Ecran = { nom: string; titre: string; etape: Etape | null; adresse?: string; ouvrir?: (p: Page, langue: Langue) => Promise<void>; defi?: ReturnType<typeof defi> };
  const ENTREE: Ecran[] = [
    { nom: 'connexion', titre: 'ecran.connexion.titre', etape: null },
    { nom: 'inscription', titre: 'ecran.inscription.titre', etape: null, ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.connexion.creer_compte', l) }).click(); } },
    { nom: 'porte', titre: 'ecran.porte.titre', etape: 'vide' },
    { nom: 'porte-entreprise', titre: 'ecran.porte.entreprise_titre', etape: 'vide', ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.porte.demarrer_bouton', l), exact: true }).click(); } },
    { nom: 'porte-cabinet', titre: 'ecran.porte.cabinet_titre', etape: 'vide', ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.porte.cabinet_lien', l), exact: true }).click(); } },
    { nom: 'code-requis', titre: 'ecran.code_requis.titre', etape: 'code_requis' },
    { nom: 'code-pose', titre: 'ecran.code_pose.titre', etape: 'code_requis', ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.code_requis.bouton', l) }).click(); } },
    // Le lot onboarding (09/10/2026) : l'adresse à vérifier (et à corriger), un appareil inconnu.
    { nom: 'verifie-email', titre: 'ecran.courriel.titre_inscription', etape: null, defi: defi('inscription') },
    { nom: 'corriger-adresse', titre: 'ecran.courriel.titre_inscription', etape: null, defi: defi('inscription'), ouvrir: async (p, l) => { await p.getByRole('button', { name: titre('ecran.courriel.corriger', l) }).click(); } },
    { nom: 'bien-toi', titre: 'ecran.courriel.titre_appareil', etape: null, defi: defi('appareil') },
    // Le lot entrée (06/10/2026) : le lien du mot de passe oublié, une fois servi (ou faux), dit qu'il ne vaut plus rien.
    { nom: 'lien-perime', titre: 'ecran.nouveau.perime_titre', etape: null, adresse: '?reinitialiser=un-lien-qui-ne-vaut-rien' },
  ];

  it('les écrans de l\'entrée, sur un téléphone et un ordinateur, en français et en langue factice : rien ne déborde, rien n\'est coupé, tout se touche du doigt, tout vient du catalogue', async () => {
    const faux: string[] = [];
    let vus = 0;
    for (const e of ENTREE) {
      for (const largeur of [390, 1440]) {
        for (const langue of ['fr', 'factice'] as Langue[]) {
          const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 844 }, deviceScaleFactor: 1, locale: 'fr-FR', isMobile: largeur < 760, hasTouch: largeur < 760 });
          const page = await contexte.newPage();
          const d = e.etape ? await personne(e.etape) : null;
          if (d) await page.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), d.jeton);
          if (e.defi) await page.addInitScript((x) => sessionStorage.setItem('skanfact.defi', JSON.stringify({ defi: x, le: Date.now() })), e.defi);
          const q = [e.adresse?.slice(1), langue === 'factice' ? 'langue=factice' : ''].filter(Boolean).join('&');
          await page.goto(`${serveur.adresse}/${q ? `?${q}` : ''}`);
          if (e.ouvrir) await e.ouvrir(page, langue);
          const nom = `${e.nom}-${largeur}-${langue}`;
          try {
            await page.getByRole('heading', { level: 1, name: titre(e.titre, langue) }).waitFor({ timeout: 10_000 });
          } catch {
            faux.push(`${nom} : l'écran attendu n'est pas là ; on lit « ${(await page.locator('body').innerText()).slice(0, 160).replace(/\s+/g, ' ')} »`);
            await contexte.close();
            continue;
          }
          faux.push(...(await page.evaluate(problemes, [largeur < 760, largeur] as [boolean, number])).map((x) => `${nom} : ${x}`));
          if (langue === 'factice') faux.push(...(await page.evaluate(horsCatalogue)).map((x) => `${nom} : hors catalogue : ${x}`));
          await page.screenshot({ path: path.join(PHOTOS, `${nom}.png`), fullPage: true });
          vus++;
          await contexte.close();
        }
      }
    }
    expect(faux).toEqual([]);
    expect(vus).toBe(ENTREE.length * 4);
  }, 400_000);

  // Les pages du quotidien de la v10 (14 § 2.6), sur l'entreprise d'essai, avec une facture émise.
  // `ordinateur` : une page pensée pour un grand écran (14 § 2.6), qui le dit au téléphone (brique 109). `tablette` :
  // une page faite pour la tablette (la caisse sur le comptoir, 14 § 2.6), mesurée aussi à sa largeur.
  const PAGES: { nom: string; hash: string; titre: RegExp; ordinateur?: true; tablette?: true }[] = [
    { nom: 'accueil', hash: '#/dashboard', titre: /./ },
    { nom: 'factures', hash: '#/factures', titre: /^Factures/ },
    { nom: 'facture-nouvelle', hash: '#/doc/new/facture', titre: /^Nouvelle facture/ },
    { nom: 'clients', hash: '#/clients', titre: /^Clients/ },
    // Photographier une facture d'achat se fait au téléphone (14 § 2.6 ; brique 84).
    { nom: 'achat-nouveau', hash: '#/achat/new', titre: /^Nouvelle facture d'achat/ },
    { nom: 'parametres', hash: '#/parametres', titre: /^Paramètres/ },
    // Le responsable décide d'un accord depuis son téléphone (brique 100).
    { nom: 'accords', hash: '#/accords', titre: /^Demandes d'accord/ },
    // Les autres pages du quotidien (brique 106 ; 14 § 2.6) : vendre, encaisser, acheter, suivre.
    { nom: 'devis', hash: '#/devis', titre: /^Devis/ },
    { nom: 'relances', hash: '#/relances', titre: /^Relances/ },
    { nom: 'catalogue', hash: '#/catalogue', titre: /^(Catalogue|Prestations|Articles)/ },
    { nom: 'achats', hash: '#/achats', titre: /^Achats/ },
    { nom: 'fournisseurs', hash: '#/fournisseurs', titre: /^Fournisseurs/ },
    // Une fiche remplie, pas seulement la liste (lot achats, 05/10/2026) : la fiche d'un fournisseur défilait de côté à
    // 1366 et 1440 px, sa liste d'achats imposant sa largeur à la colonne de gauche, et l'instrument ne l'ouvrait pas.
    { nom: 'fournisseur', hash: '#/fournisseur/s1', titre: /^Les Ciments de Bizerte/ },
    { nom: 'client', hash: '#/client/c-rendu', titre: /^Société Méditerranéenne/ },
    { nom: 'stock', hash: '#/stock', titre: /^Stock/ },
    { nom: 'tresorerie', hash: '#/tresorerie', titre: /^Trésorerie/ },
    { nom: 'paie', hash: '#/paie', titre: /^Paie/, ordinateur: true },
    { nom: 'compta', hash: '#/compta', titre: /^Comptabilit/, ordinateur: true },
    { nom: 'caisse', hash: '#/caisse', titre: /^Caisse/, tablette: true },
  ];
  const TABLETTE = 820;

  it('les pages du quotidien de la v10, sur un téléphone et un ordinateur : aucune ne défile de côté, rien ne sort de l\'écran, et au doigt tout se touche', async () => {
    const d = await personne('prete');
    // Des données qui dessinent les tableaux (brique 106) : sur une entreprise vide, chaque page montre son état
    // vide, et l'instrument ne mesure aucun tableau. Une facture émise, un devis, un achat, un salarié, un article.
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await api('GET', `/entreprises/${d.ent}/dossier-v10`, d.jeton);
    const client = { id: 'c-rendu', name: 'Société Méditerranéenne de Matériaux de Construction', address: 'Zone industrielle, Sfax', matricule: '1234567A/M/A/000' };
    const ligne = { label: 'Ciment gris 50 kg — livraison sur chantier', description: '', qty: 12, unit: 'sac', unitPrice: 25, vatRate: 19, itemId: 'ciment' };
    const ecrit = await api('POST', `/entreprises/${d.ent}/dossier-v10`, d.jeton, { changements: [
      { collection: 'clients', cle: client.id, rang: 9, revision: null, contenu: client },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 25, vatRate: 19, tracked: true, initialQty: 100 } },
      { collection: 'documents', cle: 'dv1', rang: 0, revision: null, contenu: { id: 'dv1', type: 'devis', number: 'DEV-2026-001', status: 'envoyé', date: aujourdhui, clientId: client.id, createdAt: 1, lines: [ligne], discountRate: 0, withholdingRate: 0, payments: [] } },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Les Ciments de Bizerte' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1', kind: 'facture', number: 'CB-2026-0457', supplierId: 's1', date: aujourdhui, createdAt: 1, lines: [{ ...ligne, unitPrice: 18, destination: 'stock' }], payments: [] } },
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Sami Trabelsi', firstName: 'Sami', lastName: 'Trabelsi', grossSalary: 1450, hireDate: '2025-01-15' } },
    ] });
    expect(ecrit.objets ?? ecrit.revisions ?? ecrit).toBeTruthy();
    const emise = await api('POST', `/entreprises/${d.ent}/dossier-v10/emettre`, d.jeton, { document: { id: 'f-rendu', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: client.id, createdAt: 2,
      lines: [ligne], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] }, client, revision: null, rang: 1, netAPayer: '357.000' });
    expect(String((emise.contenu as Record<string, unknown> | undefined)?.number ?? emise.motif)).toMatch(/^FAC-/);
    // La caisse ouverte sur cet appareil : l'instrument mesure l'écran de vente (ses tuiles, son ticket), pas la carte
    // « La caisse est fermée ».
    expect((await api('POST', `/entreprises/${d.ent}/caisse/ouvrir`, d.jeton, { fond: '0' })).fond).toBe('0.000');
    const faux: string[] = [];
    let vus = 0;
    for (const largeur of [390, TABLETTE, 1440]) {
      // Le téléphone et la tablette se touchent du doigt ; l'ordinateur se mène à la souris.
      const doigt = largeur <= TABLETTE;
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: largeur === TABLETTE ? 1180 : 844 }, deviceScaleFactor: 1, locale: 'fr-FR', isMobile: doigt, hasTouch: doigt });
      await contexte.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), d.jeton);
      const page = await contexte.newPage();
      const erreurs: string[] = [];
      page.on('pageerror', (x) => erreurs.push(x.message));
      await page.goto(`${serveur.adresse}/v10/?e=${d.ent}`);
      await page.locator('#view h1').first().waitFor({ timeout: 15_000 });
      for (const pg2 of PAGES.filter((x) => largeur !== TABLETTE || x.tablette)) {
        await page.evaluate((h) => { location.hash = h; }, pg2.hash);
        const nom = `v10-${pg2.nom}-${largeur}`;
        try {
          await page.locator('#view h1').filter({ hasText: pg2.titre }).first().waitFor({ timeout: 10_000 });
        } catch {
          faux.push(`${nom} : la page attendue n'est pas là ; on lit « ${(await page.locator('#view').innerText()).slice(0, 160).replace(/\s+/g, ' ')} »`);
          continue;
        }
        // Les fenêtres de bienvenue se ferment comme une personne le ferait.
        for (let i = 0; i < 3 && await page.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await page.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
        await page.waitForTimeout(300);
        faux.push(...(await page.evaluate(problemes, [doigt, largeur] as [boolean, number])).map((x) => `${nom} : ${x}`));
        // Une page pensée pour un ordinateur le dit au téléphone, et seulement là (brique 109).
        const avis = await page.locator('#bandeau-ordinateur').count();
        if (avis !== (pg2.ordinateur && largeur < 760 ? 1 : 0)) faux.push(`${nom} : ${avis ? 'dit « pensée pour un ordinateur » sans l\'être' : 'ne dit pas qu\'elle est pensée pour un ordinateur'}`);
        await page.screenshot({ path: path.join(PHOTOS, `${nom}.png`), fullPage: true });
        vus++;
      }
      faux.push(...erreurs.map((x) => `${largeur} : erreur de la page : ${x}`));
      await contexte.close();
    }
    expect(faux).toEqual([]);
    expect(vus).toBe(PAGES.length * 2 + PAGES.filter((x) => x.tablette).length);
  }, 400_000);
});
