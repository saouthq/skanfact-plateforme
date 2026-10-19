// La balance d'ouverture lue dans un FEC, à la souris (docs/cabinet.md, C61). Leïla reprend un client qui tenait
// sa comptabilité dans un autre logiciel ; elle a son FEC de 2025, tel qu'Odoo l'exporte. Ce que le parcours
// vérifie, écran ET serveur :
//   - un FEC qui couvre deux exercices se refuse, avec ce qu'il faut exporter à la place, et rien ne change ;
//   - le bon FEC : son rapport se lit AVANT que la balance change (« Annuler » n'y touche pas) ; « Reprendre ces
//     soldes » remplit la fenêtre des à-nouveaux de la clôture, un par tiers non soldé, et l'écart dit
//     « Équilibrée » ;
//   - une rangée ajoutée puis retirée ne fait pas perdre leur tiers aux autres ;
//   - « Créer le livre » ouvre l'exercice avec UNE écriture AN, au millime du fichier, chaque ligne de client ou
//     de fournisseur avec son tiers ; rien d'autre du fichier n'est parti au serveur.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

const TETE = 'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise';
const ligne = (j: string, jl: string, n: string, d: string, c: string, cl: string, aux: string, auxl: string, piece: string, lib: string, deb: string, cre: string, lettre = '') =>
  [j, jl, n, d, c, cl, aux, auxl, piece, d, lib, deb, cre, lettre, lettre ? d : '', d, '', ''].join('|');
const EXERCICE_2025 = [
  ligne('OUV', 'Ouverture', 'OUVERTURE/2025', '20250101', '532', 'Banque BIAT', '', '', 'OUV-2025', 'Ouverture 2025', '12500,125', '0,000'),
  ligne('OUV', 'Ouverture', 'OUVERTURE/2025', '20250101', '101', 'Capital social', '', '', 'OUV-2025', 'Ouverture 2025', '0,000', '12500,125'),
  ligne('VT', 'Ventes', 'INV/2025/0001', '20250314', '411', 'Clients', 'C001', 'Hôtel du Lac', 'FAC-2025-014', 'Facture Hôtel du Lac', '1191,001', '0,000', 'A'),
  ligne('VT', 'Ventes', 'INV/2025/0001', '20250314', '707', 'Ventes de marchandises', '', '', 'FAC-2025-014', 'Facture Hôtel du Lac', '0,000', '1000,001'),
  ligne('VT', 'Ventes', 'INV/2025/0001', '20250314', '4367', 'TVA collectée', '', '', 'FAC-2025-014', 'Facture Hôtel du Lac', '0,000', '191,000'),
  ligne('BQ', 'Banque', 'BNK/2025/0007', '20250402', '532', 'Banque BIAT', '', '', 'VIR-88', 'Encaissement Hôtel du Lac', '1191,001', '0,000'),
  ligne('BQ', 'Banque', 'BNK/2025/0007', '20250402', '411', 'Clients', 'C001', 'Hôtel du Lac', 'VIR-88', 'Encaissement Hôtel du Lac', '0,000', '1191,001', 'A'),
  ligne('AC', 'Achats', 'BILL/2025/0003', '20251105', '6064', 'Fournitures de bureau', '', '', 'FF-77', 'Papeterie', '84,034', '0,000'),
  ligne('AC', 'Achats', 'BILL/2025/0003', '20251105', '4366', 'TVA déductible', '', '', 'FF-77', 'Papeterie', '15,966', '0,000'),
  ligne('AC', 'Achats', 'BILL/2025/0003', '20251105', '401', 'Fournisseurs', 'F001', 'Papeterie du Lac', 'FF-77', 'Papeterie', '0,000', '100,000'),
  ligne('BQ', 'Banque', 'BNK/2025/0031', '20251130', '6278', 'Frais bancaires', '', '', 'REL-11', 'Frais de tenue de compte', '12,500', '0,000'),
  ligne('BQ', 'Banque', 'BNK/2025/0031', '20251130', '532', 'Banque BIAT', '', '', 'REL-11', 'Frais de tenue de compte', '0,000', '12,500'),
  ligne('VT', 'Ventes', 'INV/2025/0002', '20251220', '411', 'Clients', 'C002', 'Société Alpha', 'FAC-2025-102', 'Facture Société Alpha', '2380,250', '0,000'),
  ligne('VT', 'Ventes', 'INV/2025/0002', '20251220', '707', 'Ventes de marchandises', '', '', 'FAC-2025-102', 'Facture Société Alpha', '0,000', '2000,210'),
  ligne('VT', 'Ventes', 'INV/2025/0002', '20251220', '4367', 'TVA collectée', '', '', 'FAC-2025-102', 'Facture Société Alpha', '0,000', '380,040'),
];
const fec = (lignes: string[]) => Buffer.from([TETE, ...lignes].join('\r\n') + '\r\n', 'utf8');

describe('la balance d\'ouverture lue dans un FEC, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-reprise-fec-'));
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
  type Ecriture = { journal: string; date: string; piece: string | null; statut: string; numero: string | null;
    lignes: { compte: string; libelle: string; tiers: string | null; debit: string; credit: string }[] };
  const choisir = async (p: Page, nom: string, octets: Buffer) => {
    const [fenetre] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#rf-csv').click()]);
    await fenetre.setFiles({ name: nom, mimeType: 'text/plain', buffer: octets });
  };

  it('Leïla reprend les soldes d\'un client depuis son FEC de 2025 : le rapport d\'abord, puis les à-nouveaux, un par tiers', async () => {
    const leila = await personne('leila');
    const cabinet = String((await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, leila, { raisonSociale: 'Café des Arts' })).corps.entreprise);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/journal/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.getByRole('button', { name: 'Commencer le livre de 2026…' }).click();
    const fenetre = p.locator('#modal-root .modal').first();
    const dessus = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Commencer le livre de Café des Arts');
    expect(await fenetre.locator('#rf-csv').innerText()).toBe('Importer une balance ou un FEC…');

    // Un FEC qui couvre aussi 2024 : refusé, avec ce qu'il faut exporter à la place ; la balance ne bouge pas.
    await choisir(p, 'FEC-2024-2025.txt', fec([
      ligne('OD', 'Opérations diverses', 'OD/2024/0001', '20240315', '532', 'Banque BIAT', '', '', 'OD-1', 'Apport', '500,000', '0,000'),
      ligne('OD', 'Opérations diverses', 'OD/2024/0001', '20240315', '101', 'Capital social', '', '', 'OD-1', 'Apport', '0,000', '500,000'),
      ...EXERCICE_2025]));
    await expect.poll(() => dessus.innerText()).toMatch(/Import impossible[\s\S]*Ce FEC commence le 15\/03\/2024 : avant le 01\/01\/2026, il couvre plus d.un exercice\. Exporte celui qui finit le 20\/12\/2025 seul\./);
    await dessus.getByRole('button', { name: 'Fermer' }).click();
    await expect.poll(() => fenetre.locator('#rf-lignes tr').count()).toBe(1);

    // Le bon FEC : son rapport se lit avant que la balance change ; « Annuler » n'y touche pas.
    await choisir(p, 'FEC-2025.txt', fec(EXERCICE_2025));
    await expect.poll(() => dessus.locator('h2').innerText()).toBe('Reprendre les soldes de ce FEC ?');
    const rapport = (await dessus.locator('#fec-rapport').innerText()).replace(/\s+/g, ' ');
    expect(rapport).toMatch(/Le fichier du 01\/01\/2025 au 20\/12\/2025 Ses écritures 6 écritures, 15 lignes, 4 journaux Son total \(débit = crédit\) 17\s374,877/);
    expect(rapport).toMatch(/La balance d.ouverture au 01\/01\/2026 7 lignes, 7 comptes dont clients et fournisseurs, une ligne par tiers 2 Le résultat de 2025 \(un bénéfice\), au compte 13 2\s903,677 Le total de la balance \(débit = crédit\) 16\s074,842/);
    expect(await dessus.locator('#fec-deux-calculs').innerText()).toMatch(/Deux calculs, un chiffre/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-fec-1-rapport.png') });
    await dessus.getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(1);
    expect(await fenetre.locator('#rf-lignes tr').count()).toBe(1);
    expect(await fenetre.locator('input[name=c0]').inputValue()).toBe('');

    await choisir(p, 'FEC-2025.txt', fec(EXERCICE_2025));
    await dessus.getByRole('button', { name: 'Reprendre ces soldes' }).click();
    await expect.poll(() => fenetre.locator('#rf-lignes tr').count()).toBe(7);
    const rangees = async () => fenetre.locator('#rf-lignes tr').evaluateAll((trs) => trs.map((tr) => ['c', 'l', 't', 'd', 'k'].map((n) => (tr.querySelector(`input[name^=${n}]`) as HTMLInputElement).value)));
    const attendues = [
      ['101', 'Capital social', '', '', '12 500,125'], ['4366', 'TVA déductible', '', '15,966', ''], ['4367', 'TVA collectée', '', '', '571,040'],
      ['532', 'Banque BIAT', '', '13 678,626', ''], ['401', 'Papeterie du Lac — non lettré', 'Papeterie du Lac', '', '100,000'],
      ['411', 'Société Alpha — non lettré', 'Société Alpha', '2 380,250', ''], ['13', 'Résultat de l\'exercice 2025', '', '', '2 903,677'],
    ];
    const net = (x: string[][]) => x.map((r) => r.map((v) => v.replace(/\s/g, ' ')));
    expect(net(await rangees())).toEqual(attendues);
    await expect.poll(() => p.locator('#rf-ecart').innerText()).toMatch(/^Équilibrée : 16\s074,842 de chaque côté\.$/);
    // Une rangée ajoutée puis retirée : les autres gardent leur tiers.
    await fenetre.getByRole('button', { name: 'Ajouter une ligne' }).click();
    await expect.poll(() => fenetre.locator('#rf-lignes tr').count()).toBe(8);
    await fenetre.locator('#rf-lignes tr').last().getByRole('button', { name: 'Retirer' }).click();
    await expect.poll(() => fenetre.locator('#rf-lignes tr').count()).toBe(7);
    expect(net(await rangees())).toEqual(attendues);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-fec-2-balance.png') });

    await fenetre.getByRole('button', { name: 'Créer le livre' }).click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${cafe}/compta/exercices`, leila)).corps.exercices as { annee: number; du: string }[]).map((x) => [x.annee, x.du]), { timeout: 10_000 })
      .toEqual([[2026, '2026-01-01']]);
    const ecritures = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, leila)).corps.ecritures as Ecriture[];
    expect(ecritures).toHaveLength(1);
    expect(ecritures[0]).toMatchObject({ journal: 'AN', date: '2026-01-01', piece: 'OUVERTURE', statut: 'validee', numero: 'AN-2026-000001' });
    expect(ecritures[0]?.lignes.map((l) => [l.compte, l.libelle, l.tiers, l.debit, l.credit])).toEqual([
      ['101', 'Capital social', null, '0.000', '12500.125'], ['4366', 'TVA déductible', null, '15.966', '0.000'], ['4367', 'TVA collectée', null, '0.000', '571.040'],
      ['532', 'Banque BIAT', null, '13678.626', '0.000'], ['401', 'Papeterie du Lac — non lettré', 'Papeterie du Lac', '0.000', '100.000'],
      ['411', 'Société Alpha — non lettré', 'Société Alpha', '2380.250', '0.000'], ['13', 'Résultat de l\'exercice 2025', null, '0.000', '2903.677'],
    ]);
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Livre de 2026 créé');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
