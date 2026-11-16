// (1.369.0) Le premier jour d'un cabinet qui reprend un client d'un autre logiciel, à la souris : tout doit pouvoir
// s'importer. Ce que le parcours vérifie, écran ET fichier :
//   - une balance Excel de fin d'année, telle qu'un logiciel la sort : un titre, « N° de compte / Intitulé du compte »,
//     les mouvements ET les soldes côte à côte, des comptes à huit chiffres, les charges et les produits, un total.
//     Le rapport se lit AVANT : les soldes sont pris (pas les mouvements), les classes 6 et 7 ne sont pas reprises et
//     leur résultat va au compte 13, la balance s'équilibre ;
//   - le livre garde le nom des sous-comptes (« 41100001 Client CNAM », « 53200000 BIAT ») : deux clients ne
//     s'appellent pas « Clients » ;
//   - l'année d'avant le premier exercice reste offerte (reprendre l'historique de 2025 après avoir ouvert 2026) ;
//   - un journal importé d'un tableur se valide d'un geste (« Tout le brouillard »).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { classeur } from '../classeur.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('tout importer le premier jour au Cabinet (1.369.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-seul-'));
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

  it('une balance de fin d\'année se reprend par ses soldes, le résultat au compte 13, les sous-comptes gardent leur nom, l\'année d\'avant s\'ouvre, et un journal importé se valide d\'un geste', async () => {
    const associe = await personne('Sami');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Gharbi' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Pharmacie Ennasr' })).corps.entreprise);
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ');
    const aller = async (h: string) => { await p.evaluate((x) => { location.hash = x; }, h); };
    const choisir = async (bouton: ReturnType<Page['locator']>, nom: string, contenu: Buffer) => {
      const [fc] = await Promise.all([p.waitForEvent('filechooser'), bouton.click()]);
      await fc.setFiles({ name: nom, mimeType: 'application/octet-stream', buffer: contenu });
    };
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/saisie`);
    await p.locator('#lv-reprendre').waitFor({ timeout: 30_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();

    // La balance : mouvements et soldes côte à côte, comptes à huit chiffres, charges et produits, total. Elle
    // s'équilibre sur ses sept classes ; les MOUVEMENTS des comptes de bilan, eux, ne feraient pas la même balance.
    const comptes: [string, string, number, number][] = [['10100000', 'Capital social', 0, 20000], ['41100001', 'Client CNAM', 56200, 48100],
      ['41100002', 'Client Clinique Les Oliviers', 12400, 9900], ['40100001', 'Fournisseur SIPHAT', 91000, 96250.5], ['53200000', 'BIAT', 318350.5, 300000],
      ['60700000', 'Achats de médicaments', 412000, 3000], ['64000000', 'Salaires', 48000, 0], ['70700000', 'Ventes', 2000, 462700]];
    const rangees: (string | number | null)[][] = [['PHARMACIE ENNASR — Balance générale au 31/12/2025'], [],
      ['N° de compte', 'Intitulé du compte', 'Débit', 'Crédit', 'Solde débiteur', 'Solde créditeur'],
      ...comptes.map(([c, l, d, k]) => [c, l, d, k, Math.max(d - k, 0), Math.max(k - d, 0)] as (string | number)[]),
      ['', 'TOTAL GÉNÉRAL', 939950.5, 939950.5, 485950.5, 485950.5]];
    await p.locator('#lv-reprendre').click();
    const f = p.locator('#modal-root .modal').first();
    await choisir(f.locator('#rf-csv'), 'balance-2025.xlsx', classeur(rangees));
    // Le rapport, lu avant que la balance change.
    const rapport = p.locator('#bal-rapport');
    await rapport.waitFor({ timeout: 15_000 });
    const lu = net(await rapport.innerText());
    expect(lu).toContain('Les comptes lus dans le fichier 8 comptes');
    expect(lu).toContain('Les colonnes prises les soldes (débiteur et créditeur)');
    expect(lu).toContain('Les charges et les produits (classes 6 et 7), pas repris 3 comptes');
    expect(lu).toContain('Leur résultat (un bénéfice), reporté au compte 13 3 700,000');
    expect(lu).toContain('La balance d’ouverture 6 lignes');
    expect(lu).toContain('Son total au débit 28 950,500');
    expect(lu).toContain('Son total au crédit 28 950,500');
    await p.locator('#bal-ok').waitFor();
    await p.getByRole('button', { name: 'Reprendre ces soldes', exact: true }).click();
    await expect.poll(async () => net(await f.locator('#rf-ecart').innerText()), { timeout: 10_000 }).toContain('Équilibrée : 28 950,500 de chaque côté');
    // L'intitulé du fichier suit sa ligne, et un compte ne s'ouvre que d'un côté (son solde).
    expect(await f.locator('[name=l1]').inputValue()).toBe('Client CNAM');
    expect(net(await f.locator('[name=d1]').inputValue())).toMatch(/^8\s100,000$/);
    expect(await f.locator('[name=k1]').inputValue()).toBe('');
    await f.getByRole('button', { name: 'Créer le livre', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 20_000 }).toMatch(/Livre de \d{4} créé/);

    // Le livre garde le nom des sous-comptes ; le résultat est au 13 ; ni charge ni produit n'ouvre l'exercice.
    await aller(`#/dossier/${ent}/comptabilite/balance`);
    const lignes = async () => (await p.locator('#view table.list tbody tr').allInnerTexts()).map(net);
    await expect.poll(async () => (await lignes()).length, { timeout: 20_000 }).toBeGreaterThan(4);
    const bal = await lignes();
    expect(bal.find((l) => l.startsWith('41100001'))).toContain('41100001 Client CNAM');
    expect(bal.find((l) => l.startsWith('41100002'))).toContain('Client Clinique Les Oliviers');
    expect(bal.find((l) => l.startsWith('53200000'))).toContain('53200000 BIAT');
    expect(bal.find((l) => l.startsWith('13 '))).toContain('Résultat de l\'exercice');
    expect(bal.some((l) => /^(6|7)\d/.test(l))).toBe(false);
    // Sur le serveur : la ligne d'un client porte son nom en tiers, pour le lettrage.
    const ecr = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=50`, associe)).corps.ecritures as { piece: string; lignes: { compte: string; tiers?: string; debit: string }[] }[];
    const ouv = ecr.find((e) => e.piece === 'OUVERTURE');
    expect(ouv?.lignes.find((l) => l.compte === '41100001')?.tiers).toBe('Client CNAM');
    expect(ouv?.lignes.find((l) => l.compte === '53200000')?.tiers ?? '').toBe('');

    // L'année d'avant le premier exercice reste offerte.
    const annees = await p.locator('#lv-annee option').allInnerTexts();
    const an = Number(annees[0]);
    expect(annees).toContain(String(an - 1));

    // Un journal sorti d'un tableur (deux journaux, deux mois : quatre lots) se valide d'un geste.
    await aller(`#/dossier/${ent}/comptabilite/journal`);
    const csv = ['Date;Journal;N° pièce;Compte;Libellé;Débit;Crédit',
      ...[1, 2].flatMap((m) => [`15/0${m}/${an};VT;FV-00${m};411;Vente du mois ${m};1190,000;`, `15/0${m}/${an};VT;FV-00${m};706;Vente du mois ${m};;1000,000`, `15/0${m}/${an};VT;FV-00${m};4367;TVA collectée;;190,000`,
        `28/0${m}/${an};AC;FA-00${m};606;Électricité;210,500;`, `28/0${m}/${an};AC;FA-00${m};401;Électricité;;210,500`])].join('\r\n');
    await choisir(p.locator('#lv-reimport'), 'journal.csv', Buffer.from(csv, 'latin1'));
    await p.getByRole('button', { name: 'Importer 4 pièces', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 20_000 }).toContain('4 pièces ajoutées');
    await aller(`#/dossier/${ent}/comptabilite/saisie`);
    await p.locator('#sa-lot-plus summary').click({ timeout: 20_000 });
    await expect.poll(async () => net(await p.locator('#sa-lot-tout').innerText())).toBe('Tout le brouillard (4)');
    await p.locator('#sa-lot-tout').click();
    await p.getByRole('button', { name: 'Valider les 4 écritures', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 20_000 }).toContain('4 écritures validées');
    const apres = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=50`, associe)).corps.ecritures as { statut: string }[];
    expect(apres.filter((e) => e.statut !== 'validee')).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-import-1369.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
