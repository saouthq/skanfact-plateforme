// 1.388.47 (audit #30, CAB2-1, CAB2-2) : la fiche d'un dossier tenu donne la date limite des Échéances (le 15 pour une personne
// physique), ne dit jamais « Rien n'attend » sous des mois en retard, et ne réclame pas la TVA à un dossier non assujetti.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('1.388.47 (CAB2-1, CAB2-2) : la fiche d\'un dossier tenu dit les dates des Échéances', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab2-fiche-'));
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
  it('Karima ajoute une kiné (personne physique) et un épicier non assujetti : la fiche suit les Échéances, et le forfait n\'est pas réclamé', async () => {
    const associe = await personne('Karima');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Hamdi Expertise' })).corps.id);
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ');
    const plusTard = async () => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click(); };
    const annee = new Date().toLocaleDateString('fr-CA', { timeZone: 'Africa/Tunis' }).slice(0, 4);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#new-d').waitFor({ timeout: 30_000 });
    await plusTard();
    const ajouter = async (nom: string, tva: string) => {
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
      await p.locator('#new-d').click();
      await p.locator('#f-name').fill(nom);
      await p.locator('#f-forme').fill('Personne physique');
      await p.locator('#f-tva').selectOption(tva);
      await p.locator('#f-from').fill(`01/${annee}`);
      await p.getByRole('button', { name: 'Créer le dossier', exact: true }).click();
      await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toMatch(/^#\/dossier\//);
      await p.locator('.fd-leg-r').waitFor({ timeout: 30_000 });
    };

    // 1. La kiné : personne physique, TVA mensuelle, depuis janvier. Son livre a une écriture de janvier (comme dans l'audit).
    // Les mois passés sont en retard depuis le 15, jamais le 28, et la fiche ne dit pas « Rien n'attend ».
    await ajouter('Essai Cabinet Kiné Lina Mabrouk', 'mensuelle');
    const kineId = decodeURIComponent((await p.evaluate(() => location.hash)).replace(/^#\/dossier\//, '').split('/')[0] ?? '');
    expect((await api('POST', `/entreprises/${kineId}/compta/exercices`, associe, { annee: Number(annee), ouverture: [] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${kineId}/compta/ecritures`, associe, { date: `${annee}-01-20`, journal: 'VT', piece: 'NH-01', libelle: 'Séances de janvier',
      lignes: [{ compte: '411', debit: '1190' }, { compte: '706', credit: '1000' }, { compte: '4367', credit: '190' }] })).statut).toBeLessThan(300);
    await p.reload();
    await p.locator('.fd-leg-r').waitFor({ timeout: 30_000 });
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 20_000 }).toContain('à saisir, en retard');
    const kine = net(await p.locator('#view').innerText());
    expect(net(await p.locator('.fd-leg-r').innerText())).toBe('Date limite : le 15 du mois suivant (À VÉRIFIER pour ton cabinet)');
    expect(kine).toContain('mensuelle · déclarée le 15');
    expect(kine).toMatch(/en retard depuis le 15\//);
    expect(kine).not.toMatch(/depuis le 28\//);
    expect(kine).not.toContain('Rien n\'attend');
    expect(kine).toContain('à saisir, en retard');
    await p.screenshot({ path: path.join(PHOTOS, 'cab2-fiche-kine.png'), fullPage: true });

    // 2. L'épicier non assujetti : aucune TVA réclamée, ni à la fiche, ni au tableau de bord.
    await ajouter('Essai Mohamed Ayari (épicerie)', 'non-assujetti');
    const epicier = net(await p.locator('#view').innerText());
    expect(net(await p.locator('.fd-leg-r').innerText())).toBe('Pas de déclaration de TVA : dossier non assujetti (À VÉRIFIER pour ton cabinet)');
    expect(epicier).not.toMatch(/à déposer|en retard depuis|octobre en retard|prochaine déclaration le|Date limite/);
    await p.screenshot({ path: path.join(PHOTOS, 'cab2-fiche-forfait.png'), fullPage: true });
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/production`);
    await p.locator('#tb-campagne').waitFor({ timeout: 30_000 });
    await expect.poll(async () => (await p.locator('#tb-campagne').innerHTML()).includes('Kiné'), { timeout: 15_000 }).toBe(true);
    expect(await p.locator('#tb-campagne').innerHTML()).not.toContain('Ayari');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
