// La reprise d'un client, à la souris (brique 39 ; docs/cabinet.md, C16 et C17). Les écrans sont ceux
// du Cabinet v10 ; l'exercice s'ouvre sur le serveur. Ce que le parcours vérifie, écran ET serveur :
//   - un client que le cabinet tient (hors SkanFact) : « Commencer le livre de 2026… », sa balance
//     d'ouverture lue dans un CSV (un titre au-dessus, une ligne qui n'est pas un compte, un total
//     dessous), l'écart qui se lit pendant la saisie ; « Créer le livre » ouvre l'exercice et pose
//     UNE écriture AN validée, au millime du fichier ; la balance de l'écran est celle du serveur ;
//   - un client tenu qui démarre : son premier exercice commence le jour de sa création, sans balance ;
//   - un client sur SkanFact qui n'a encore rien enregistré : pas un mot de paquet ;
//   - un client sur SkanFact dont les pièces sont déjà dans ses livres : « Reprendre les soldes
//     d'ouverture… » dans la barre du livre ; un classeur trop gros une fois ouvert se refuse ; sa
//     balance lue dans un classeur Excel ; déséquilibrée,
//     le serveur la refuse et RIEN n'est ouvert ; rééquilibrée, l'exercice s'ouvre et le bouton s'en va ;
//   - les à-nouveaux ne sont l'activité d'aucun mois, et un brouillard écrit son mois (C14).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// Les mois de 2026 déjà finis (le mois en cours n'est jamais réclamé).
const moisFinis2026 = () => {
  const d = new Date();
  const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  return MOIS.map((_, i) => `2026-${String(i + 1).padStart(2, '0')}`).filter((m) => m <= dernier);
};

// Un classeur Excel minimal : une archive ZIP (entrées compressées, comme Excel les écrit) de XML.
function zip(fichiers: Record<string, string | Buffer>) {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const [nom, texte] of Object.entries(fichiers)) {
    const brut = typeof texte === 'string' ? Buffer.from(texte, 'utf8') : texte;
    const comprime = zlib.deflateRawSync(brut);
    const n = Buffer.from(nom, 'utf8');
    const crc = zlib.crc32(brut);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(comprime.length, 18); l.writeUInt32LE(brut.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comprime.length, 20); c.writeUInt32LE(brut.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(decalage, 42);
    locaux.push(l, n, comprime);
    centraux.push(c, n);
    decalage += 30 + n.length + comprime.length;
  }
  const cd = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(centraux.length / 2, 8); fin.writeUInt16LE(centraux.length / 2, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, cd, fin]);
}
// Une feuille : les textes dans la table partagée (comme Excel), les nombres dans leurs cellules.
function classeur(rangees: (string | number | null)[][]) {
  const partages: string[] = [];
  const cellule = (v: string | number | null, ref: string) => {
    if (v === null) return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    partages.push(v);
    return `<c r="${ref}" t="s"><v>${partages.length - 1}</v></c>`;
  };
  const lignes = rangees.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellule(v, `${'ABCD'[j]}${i + 1}`)).join('')}</row>`).join('');
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Balance" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="${ns}">${partages.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="${ns}"><sheetData>${lignes}</sheetData></worksheet>`,
  });
}

describe('la reprise d\'un client, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-reprise-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  type Ecriture = { id: string; journal: string; date: string; piece: string | null; statut: string; numero: string | null;
    origine: { type: string }; lignes: { compte: string; libelle: string; debit: string; credit: string }[] };
  const livres = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures as Ecriture[];
  const exercices = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/exercices`, jeton)).corps.exercices as { annee: number; du: string; au: string; ouverture: string | null }[];
  // Le fichier que le comptable choisit sur son ordinateur.
  const choisir = async (p: Page, nom: string, octets: Buffer) => {
    const [fenetre] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#rf-csv').click()]);
    await fenetre.setFiles({ name: nom, mimeType: nom.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: octets });
  };

  it('un client tenu commence son livre avec la balance d\'un CSV ; un client sur SkanFact reprend ses soldes depuis Excel, refusés tant qu\'ils ne tombent pas juste', async () => {
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    // Un client que le cabinet tient lui-même.
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    // Un client sur SkanFact, dont un achat d'août est déjà dans ses livres.
    const client = await personne('client');
    const menuiserie = String((await api('POST', '/entreprises', client, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    await api('GET', `/entreprises/${menuiserie}/dossier-v10`, client);
    const envoyer = (collection: string, cle: string, contenu: unknown) =>
      api('POST', `/entreprises/${menuiserie}/dossier-v10`, client, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    await envoyer('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
    });
    const mandat = String((await api('POST', `/entreprises/${menuiserie}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (hash: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${hash}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    // La fenêtre de la reprise ; une fenêtre d'information s'ouvre par-dessus, et se ferme.
    const fenetre = p.locator('#modal-root .modal').first();
    const fermerLaFenetreDuDessus = () => p.locator('#modal-root .modal').last().getByRole('button', { name: 'Fermer' }).click();
    const ecart = p.locator('#rf-ecart');

    // ── Le client tenu : son livre n'existe pas encore ────────────────────────────────────────
    await aller(`#/dossier/${cafe}/comptabilite/journal/2026`);
    await expect.poll(() => p.locator('#c-livres').innerText()).toMatch(/Ce client n.utilise pas SkanFact : sa comptabilité se tient ici, à la main\./);
    await p.getByRole('button', { name: 'Commencer le livre de 2026…' }).click();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Commencer le livre de Café des Arts');
    // Sa balance d'ouverture, telle que son ancien logiciel l'exporte : un titre, une ligne qui n'est pas
    // un compte (ignorée, et dite), un total général dessous (laissé de côté).
    await choisir(p, 'balance-2025.csv', Buffer.from([
      'Balance générale au 31/12/2025',
      'Compte;Intitulé;Solde débiteur;Solde créditeur',
      '101;Capital social;;20 000,000',
      '1061;Réserve légale;;1 250,250',
      '2234;Matériel de bureau;8 400,500;',
      '411;Clients;6 125,125;',
      '401;Fournisseurs;;3 275,375',
      '532;Banque BIAT;10 000,000;',
      'ABC;Ligne sans numéro;1,000;',
      'Total général;;24 525,625;24 525,625',
    ].join('\r\n'), 'utf8'));
    // La ligne ignorée se dit, avec son numéro dans le fichier.
    await expect.poll(() => p.locator('#modal-root').innerText()).toMatch(/Lignes ignorées[\s\S]*Ligne 9 : « ABC » n.est pas un numéro de compte/);
    await fermerLaFenetreDuDessus();
    await expect.poll(() => fenetre.locator('#rf-lignes tr').count()).toBe(6);
    await expect.poll(() => ecart.innerText()).toMatch(/^Équilibrée : 24\s525,625 de chaque côté\.$/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-1-csv.png') });
    await fenetre.getByRole('button', { name: 'Créer le livre' }).click();
    // L'exercice 2026 est ouvert au serveur, avec UNE écriture AN validée, au millime du fichier.
    await expect.poll(async () => (await exercices(cafe, associe)).map((x) => [x.annee, x.du]), { timeout: 10_000 }).toEqual([[2026, '2026-01-01']]);
    const [an] = await livres(cafe, associe);
    expect(an).toMatchObject({ id: (await exercices(cafe, associe))[0]?.ouverture, journal: 'AN', date: '2026-01-01', piece: 'OUVERTURE', statut: 'validee', numero: 'AN-2026-000001' });
    expect(an?.lignes.map((l) => [l.compte, l.libelle, l.debit, l.credit])).toEqual([
      ['101', 'Capital social', '0.000', '20000.000'], ['1061', 'Réserve légale', '0.000', '1250.250'], ['2234', 'Matériel de bureau', '8400.500', '0.000'],
      ['411', 'Clients', '6125.125', '0.000'], ['401', 'Fournisseurs', '0.000', '3275.375'], ['532', 'Banque BIAT', '10000.000', '0.000'],
    ]);
    // Le livre s'ouvre sur la saisie ; son exercice est ouvert : rien à reprendre.
    await expect.poll(() => p.locator('#sa-journal').count()).toBe(1);
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Livre de 2026 créé');
    expect(await p.locator('#lv-ouvrir').count()).toBe(0);
    // Deux chemins, un chiffre : la balance de l'écran est celle du serveur.
    await aller(`#/dossier/${cafe}/comptabilite/balance/2026`);
    expect(await p.locator('#lv-ouvrir').count()).toBe(0);
    const millimes = (t: string) => BigInt(t.replace(/[^0-9,-]/g, '').replace(',', '') || '0');
    const ecranLignes = await p.locator('#view table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText)));
    const vueEcran = ecranLignes.filter((l) => /^[0-9]/.test(l[0] ?? '')).map((l) => `${l[0]} ${millimes(l[2] ?? '')} ${millimes(l[3] ?? '')}`);
    const bal = (await api('GET', `/entreprises/${cafe}/compta/balance?du=2026-01-01&au=2026-12-31`, associe)).corps as { comptes: { compte: string; debit: string; credit: string }[] };
    expect(vueEcran).toEqual(bal.comptes.map((c) => `${c.compte} ${BigInt(c.debit.replace('.', ''))} ${BigInt(c.credit.replace('.', ''))}`));
    expect(vueEcran).toHaveLength(6);

    // Les à-nouveaux ne sont l'activité d'aucun mois, et un brouillard écrit son mois (C14) : une pièce
    // validée en mars, une autre au brouillard en avril. Janvier reste à saisir — la balance
    // d'ouverture ne l'écrit pas —, avril ne l'est pas.
    const saisir = async (corps: unknown) => String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, corps)).corps.id);
    const mars = await saisir({ date: '2026-03-10', journal: 'OD', piece: 'OD-1', libelle: 'Loyer de mars', lignes: [{ compte: '6132', debit: '700' }, { compte: '532', credit: '700' }] });
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [mars] })).statut).toBe(200);
    await saisir({ date: '2026-04-10', journal: 'OD', piece: 'OD-2', libelle: 'Loyer d\'avril', lignes: [{ compte: '6132', debit: '700' }, { compte: '532', credit: '700' }] });
    await aller(`#/dossier/${cafe}/comptabilite/journal/2026`);
    const aSaisir = moisFinis2026().filter((m) => !['2026-03', '2026-04'].includes(m));
    const dernierASaisir = MOIS[Number(aSaisir.at(-1)?.slice(5, 7)) - 1];
    await expect.poll(() => p.locator('#c-livres').innerText())
      .toContain(`Aucune écriture sur ${aSaisir.length} mois, de janvier 2026 à ${dernierASaisir} 2026 : ces mois restent à saisir.`);

    // ── Un client tenu qui démarre : sa société est née le 1er juin 2025 ; son livre commence ce
    // jour-là, sans balance d'ouverture ──────────────────────────────────────────────────────────
    const boulangerie = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie du Port' })).corps.entreprise);
    await aller(`#/dossier/${boulangerie}/comptabilite/journal/2026`);
    await p.getByRole('button', { name: 'Commencer le livre de 2026…' }).click();
    await fenetre.locator('input[name=annee]').fill('2025');
    await fenetre.locator('input[name=du]').fill('2025-06-01');
    await expect.poll(() => p.locator('#rf-exo').innerText())
      .toBe('Le livre ouvrira le 01/06/2025 et finira le 31/12/2025. La balance d\'ouverture ci-dessous est celle du 01/06/2025.');
    await fenetre.getByRole('button', { name: 'Créer le livre' }).click();
    await expect.poll(() => exercices(boulangerie, associe), { timeout: 10_000 }).toEqual([{ annee: 2025, du: '2025-06-01', au: '2025-12-31', ouverture: null }]);
    expect(await livres(boulangerie, associe)).toEqual([]);
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Livre de 2025 créé');
    await expect.poll(() => p.locator('#sa-journal').count()).toBe(1);
    // Rouvert, son livre de 2025 est là, sans écriture : ni « Commencer le livre », ni soldes à
    // reprendre ; et 2025 se choisit depuis l'exercice d'à côté.
    await aller(`#/dossier/${boulangerie}/comptabilite/journal/2025`);
    await expect.poll(() => p.locator('#c-livre-etat').innerText()).toMatch(/Le livre de 2025/);
    const bornes = await p.evaluate(async (ent) => {
      const w = window as unknown as { cabinet: { livre: (id: string, annee: string) => Promise<{ livre: { exercice: { du: string; au: string } } | null }> } };
      return (await w.cabinet.livre(ent, '2025')).livre?.exercice;
    }, boulangerie);
    expect(bornes).toMatchObject({ du: '2025-06-01', au: '2025-12-31' });
    expect(await p.getByRole('button', { name: /Commencer le livre/ }).count()).toBe(0);
    expect(await p.locator('#lv-ouvrir').count()).toBe(0);
    await aller(`#/dossier/${boulangerie}/comptabilite/journal/2026`);
    expect(await p.locator('#lv-annee option').allInnerTexts()).toEqual(['2026', '2025']);

    // ── Le client sur SkanFact, une année où il n'a rien enregistré : pas un mot de paquet ─────
    await aller(`#/dossier/${menuiserie}/comptabilite/journal/2025`);
    await expect.poll(() => p.locator('#c-livres').innerText()).toMatch(/Aucune écriture pour l.instant\.[\s\S]*Les pièces qu.il enregistre dans SkanFact s.y ajouteront d.elles-mêmes\./);
    expect(await p.locator('#c-livres').innerText()).not.toMatch(/paquet/i);
    expect(await p.getByRole('button', { name: 'Écrire au client' }).count()).toBe(1);

    // ── Le client sur SkanFact dont l'achat d'août est dans ses livres ──────────────────────────
    await aller(`#/dossier/${menuiserie}/comptabilite/journal/2026`);
    const reprendre = p.locator('#lv-ouvrir');
    await expect.poll(() => reprendre.innerText()).toBe('Reprendre les soldes d\'ouverture…');
    await reprendre.click();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Reprendre les soldes d\'ouverture de Menuiserie Ben Salah');
    // Un classeur qui, une fois ouvert, pèse des dizaines de mégaoctets (une entrée de 21 Mo, ou quatre
    // de 16 Mo) : refusé avec sa raison, sans rien lire.
    for (const bombe of [zip({ 'xl/worksheets/sheet1.xml': Buffer.alloc(21 * 1024 * 1024) }),
      zip(Object.fromEntries([1, 2, 3, 4].map((i) => [`xl/worksheets/sheet${i}.xml`, Buffer.alloc(16 * 1024 * 1024)])))]) {
      await choisir(p, 'balance-bombe.xlsx', bombe);
      await expect.poll(() => p.locator('#modal-root').innerText()).toMatch(/Import impossible[\s\S]*Ce classeur est anormalement gros : refusé\./);
      await fermerLaFenetreDuDessus();
    }
    await expect.poll(() => fenetre.locator('#rf-lignes tr').count()).toBe(1);
    // Sa balance dans un classeur Excel : elle ne tombe pas juste (99,250 de débit manquent).
    await choisir(p, 'balance-2025.xlsx', classeur([
      ['Compte', 'Libellé', 'Débit', 'Crédit'],
      [101, 'Capital', null, 15000],
      [532, 'Banque', 12500.25, null],
      [2182, 'Matériel de transport', 2400.5, null],
    ]));
    await expect.poll(() => fenetre.locator('#rf-lignes tr').count()).toBe(3);
    await expect.poll(() => ecart.innerText()).toMatch(/^Écart : .99,250 \(débit 14\s900,750 \/ crédit 15\s000,000\)\.$/);
    await fenetre.getByRole('button', { name: 'Ouvrir l\'exercice' }).click();
    // Le serveur la refuse, dit pourquoi, et RIEN n'est ouvert : ni l'exercice, ni l'écriture.
    await expect.poll(() => p.locator('#modal-root').innerText()).toMatch(/Reprise impossible[\s\S]*Débit 14\s900,750 ≠ crédit 15\s000,000 : l.écriture ne tombe pas juste\./);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-2-refus.png') });
    await fermerLaFenetreDuDessus();
    expect(await exercices(menuiserie, associe)).toEqual([]);
    expect((await livres(menuiserie, associe)).map((e) => e.journal)).toEqual(['AC']);
    // Une ligne de plus, tapée : la caisse. L'écart se lit pendant la frappe.
    await fenetre.getByRole('button', { name: 'Ajouter une ligne' }).click();
    await fenetre.locator('input[name=c3]').fill('5411');
    await fenetre.locator('input[name=l3]').fill('Caisse');
    await fenetre.locator('input[name=d3]').fill('99,250');
    await expect.poll(() => ecart.innerText()).toMatch(/^Équilibrée : 15\s000,000 de chaque côté\.$/);
    await fenetre.getByRole('button', { name: 'Ouvrir l\'exercice' }).click();
    await expect.poll(async () => (await exercices(menuiserie, associe)).map((x) => x.annee), { timeout: 10_000 }).toEqual([2026]);
    const ouverture = (await livres(menuiserie, associe)).find((e) => e.journal === 'AN');
    expect(ouverture).toMatchObject({ date: '2026-01-01', statut: 'validee', numero: 'AN-2026-000001' });
    expect(ouverture?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['101', '0.000', '15000.000'], ['532', '12500.250', '0.000'], ['2182', '2400.500', '0.000'], ['5411', '99.250', '0.000']]);
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Exercice 2026 ouvert');
    await expect.poll(() => p.locator('#lv-ouvrir').count()).toBe(0);
    await aller(`#/dossier/${menuiserie}/comptabilite/journal/2026`);
    expect(await p.locator('#lv-ouvrir').count()).toBe(0);
    // Sa balance d'ouverture n'écrit pas janvier : le tableau du portefeuille ne compte que le mois de
    // son achat, au brouillard (à valider) ; et le livre ne réclame pas août.
    const moisDuTableau = await p.evaluate(async (ent) => {
      const w = window as unknown as { cabinet: { state: () => Promise<{ dossiers: { id: string; packs: { month: string; definitive: boolean }[] }[] }> } };
      return (await w.cabinet.state()).dossiers.find((d) => d.id === ent)?.packs.map((x) => `${x.month} ${x.definitive ? 'validé' : 'à valider'}`);
    }, menuiserie);
    expect(moisDuTableau).toEqual(['2026-08 à valider']);
    expect(await p.locator('#c-livres').innerText()).not.toMatch(/Il manque[^.]*(janvier|août) 2026/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-3-ouvert.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
