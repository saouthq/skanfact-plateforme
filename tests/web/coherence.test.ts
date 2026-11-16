// La COHÉRENCE des écrans (1.365.0 — demandé par Skander : « pas que chaque page soit différente : on garde une identité
// et on facilite la création d'habitudes »). L'instrument de rendu juge une page seule ; celui-ci les juge ENTRE ELLES.
// Il ouvre les pages du quotidien de l'entreprise et du Cabinet, relève la forme de chaque famille d'objets (titre de
// page, titre de section, bouton, champ, pastille, en-tête de tableau, carte) et chaque couleur, puis exige :
//   1. qu'une famille n'ait que ses formes CONNUES — la règle, et les écarts tolérés, chacun nommé avec sa raison ;
//   2. que les couleurs viennent de la charte (un jeton), les autres comptées : leur nombre ne peut que baisser.
// Une forme nouvelle fait tomber le test en nommant la page et l'objet : soit elle rejoint la règle, soit c'est une
// décision, écrite ici. Le relevé complet est rangé dans dist/coherence.json, pour être lu par un humain.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { releve, type Releve } from '../instrument-coherence.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');

describe('la cohérence des écrans : une identité, les mêmes formes d\'une page à l\'autre', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-coherence-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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


  // ── Ce que l'identité permet. `regle` : la forme de la maison. `toleres` : un écart connu, avec sa raison — une
  // dette à résorber ou une exception voulue. Rien d'autre ne passe.
  type Famille = { regle: string[]; toleres: Record<string, string> };
  const FORMES: Record<'entreprise' | 'cabinet', Record<string, Famille>> = JSON.parse(fs.readFileSync(path.join(RACINE, 'tests/web/coherence-formes.json'), 'utf8'));
  // Les couleurs hors charte, par application : un plafond qui ne peut que baisser.
  const HORS_CHARTE = { entreprise: Number(FORMES.entreprise['couleurs hors charte']?.regle[0] ?? 0), cabinet: Number(FORMES.cabinet['couleurs hors charte']?.regle[0] ?? 0) };

  it('les pages de l\'entreprise et du Cabinet ne montrent que les formes de la maison, et leurs couleurs viennent de la charte', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.corps.id)}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const client = { id: 'c-rendu', name: 'Société Méditerranéenne de Matériaux de Construction', address: 'Zone industrielle, Sfax', matricule: '1234567A/M/A/000' };
    const ligne = { label: 'Ciment gris 50 kg — livraison sur chantier', description: '', qty: 12, unit: 'sac', unitPrice: 25, vatRate: 19, itemId: 'ciment' };
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'clients', cle: client.id, rang: 9, revision: null, contenu: client },
      // Son prix de vente au catalogue fait un stock de « 12 500,000 DT » : huit chiffres, qui dépassaient de leur carte
      // au téléphone (13/10/2026). À 25, le montant tenait avec les polices de GitHub, et le défaut ne se voyait pas.
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 125, vatRate: 19, tracked: true, initialQty: 100 } },
      { collection: 'documents', cle: 'dv1', rang: 0, revision: null, contenu: { id: 'dv1', type: 'devis', number: 'DEV-2026-001', status: 'envoyé', date: aujourdhui, clientId: client.id, createdAt: 1, lines: [ligne], discountRate: 0, withholdingRate: 0, payments: [] } },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Les Ciments de Bizerte' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1', kind: 'facture', number: 'CB-2026-0457', supplierId: 's1', date: aujourdhui, createdAt: 1, lines: [{ ...ligne, unitPrice: 18, destination: 'stock' }], payments: [] } },
      // (1.297.0) Un gros achat à payer : « Tu dois » à l'accueil porte un montant de dix chiffres. Avec de petits montants,
      // aucun chiffre de carte ne débordait au téléphone, et le resserrement des cartes (telephone.js) n'avait jamais à agir :
      // le retirer restait vert.
      { collection: 'purchases', cle: 'p2', rang: 1, revision: null, contenu: { id: 'p2', kind: 'facture', number: 'CB-2026-0458', supplierId: 's1', date: aujourdhui, createdAt: 2, lines: [{ label: 'Rond à béton 12 mm — chantier du port', description: '', qty: 1, unit: '', unitPrice: 1234567, vatRate: 19 }], payments: [] } },
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Sami Trabelsi', firstName: 'Sami', lastName: 'Trabelsi', grossSalary: 1450, hireDate: '2025-01-15' } },
    ] });
    expect(ecrit.statut).toBeLessThan(300);
    const emise = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: { id: 'f-rendu', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: client.id, createdAt: 2,
      lines: [ligne], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] }, client, revision: null, rang: 1, netAPayer: '357.000' });
    expect(String((emise.corps.contenu as Obj | undefined)?.number ?? emise.corps.motif)).toMatch(/^FAC-/);
    // La caisse ouverte sur cet appareil : l'instrument mesure l'écran de vente (ses tuiles, son ticket), pas la carte
    // « La caisse est fermée ».
    expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, nour, { fond: '0' })).corps.fond).toBe('0.000');
    const D = `#/dossier/${ent}`;
    const TOURNEES: { app: 'entreprise' | 'cabinet'; jeton: string; adresse: string; pages: string[] }[] = [
      { app: 'entreprise', jeton: nour, adresse: `/v10/?e=${ent}`, pages: ['#/dashboard', '#/factures', '#/doc/new/facture', '#/clients', '#/client/c-rendu', '#/devis', '#/relances', '#/catalogue',
        '#/achats', '#/achat/new', '#/achat/p1', '#/fournisseurs', '#/fournisseur/s1', '#/stock', '#/stats', '#/tresorerie', '#/paie', '#/compta', '#/accords', '#/parametres'] },
      { app: 'cabinet', jeton: leila, adresse: `/v10/cabinet/?c=${String(cab.corps.id)}`, pages: ['#/', '#/dossiers', '#/production', '#/pieces', '#/echeances', '#/relances', '#/messages', '#/reglages',
        D, `${D}/comptabilite/saisie`, `${D}/comptabilite/journal`, `${D}/comptabilite/balance`, `${D}/comptabilite/immobilisations`, `${D}/comptabilite/paie`, `${D}/comptabilite/banque`,
        `${D}/comptabilite/declaration`, `${D}/comptabilite/exercice`] },
    ];
    const faux: string[] = [];
    type Vu = { familles: Record<string, Record<string, string[]>>; horsCharte: Record<string, string[]>; pages: number };
    const rapport: Record<string, Vu> = {};
    for (const tour of TOURNEES) {
      const cx = await contexte(tour.jeton);
      const page = await cx.newPage();
      const erreurs: string[] = [];
      page.on('pageerror', (x) => erreurs.push(x.message));
      await page.goto(`${serveur.adresse}${tour.adresse}`);
      await page.locator('#view h1').first().waitFor({ timeout: 20_000 });
      const vu: Vu = { familles: {}, horsCharte: {}, pages: 0 };
      rapport[tour.app] = vu;
      for (const hash of tour.pages) {
        await page.evaluate((h) => { location.hash = h; }, hash);
        await page.waitForTimeout(250);
        await page.locator('#view h1').first().waitFor({ timeout: 15_000 });
        await plusTard(page);
        // La page a fini de se dessiner quand deux relevés de suite comptent les mêmes objets.
        let r: Releve = await page.evaluate(releve);
        for (let i = 0; i < 12; i++) { await page.waitForTimeout(350); const s = await page.evaluate(releve); const pareil = s.lus === r.lus; r = s; if (pareil) break; }
        const nom = hash.replace(ent, '…');
        if (r.lus < 2) faux.push(`${tour.app} ${nom} : l'instrument n'y lit presque rien (${r.lus} objet) — la page est-elle là ?`);
        for (const [famille, formes] of Object.entries(r.familles)) for (const [forme, exemple] of Object.entries(formes)) ((vu.familles[famille] ??= {})[forme] ??= []).push(`${nom} ${exemple}`);
        for (const [couleur, exemple] of Object.entries(r.couleurs)) if (!r.palette.includes(couleur)) (vu.horsCharte[couleur] ??= []).push(`${nom} ${exemple}`);
        vu.pages++;
      }
      faux.push(...erreurs.map((x) => `${tour.app} : erreur de la page : ${x}`));
      await cx.close();
      // Le jugement : une forme vue est la règle, un écart nommé, ou une faute.
      const connues = FORMES[tour.app];
      for (const [famille, formes] of Object.entries(vu.familles)) {
        const f = connues[famille];
        for (const [forme, ou] of Object.entries(formes)) {
          if (f && (f.regle.includes(forme) || forme in f.toleres)) continue;
          faux.push(`${tour.app} — ${famille} : une forme inconnue, « ${forme} », sur ${ou[0]}${ou.length > 1 ? ` (et ${ou.length - 1} autre${ou.length > 2 ? 's' : ''})` : ''}. La maison : ${f ? f.regle.join(' ; ') : '(famille inconnue)'}.`);
        }
      }
      const hors = Object.keys(vu.horsCharte).length;
      if (hors > HORS_CHARTE[tour.app]) faux.push(`${tour.app} : ${hors} couleurs hors charte pour ${HORS_CHARTE[tour.app]} tolérées. Les plus rares : ${Object.entries(vu.horsCharte).sort((a, b) => a[1].length - b[1].length).slice(0, 8).map(([c, ou]) => `${c} (${ou[0]})`).join(' ; ')}`);
    }
    fs.mkdirSync(path.join(RACINE, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(RACINE, 'dist/coherence.json'), JSON.stringify(rapport, null, 1));
    expect(faux).toEqual([]);
    // Un instrument qui n'atteint pas ses écrans dirait « tout va bien ».
    expect(rapport.entreprise?.pages).toBe(TOURNEES[0]?.pages.length);
    expect(rapport.cabinet?.pages).toBe(TOURNEES[1]?.pages.length);
    for (const app of ['entreprise', 'cabinet'] as const) for (const famille of ['titre de page', 'bouton', 'carte', 'en-tête de tableau', 'champ']) expect(Object.keys(rapport[app]?.familles[famille] ?? {}).length, `${app} : aucun objet « ${famille} » lu`).toBeGreaterThan(0);
  }, 600_000);
});
