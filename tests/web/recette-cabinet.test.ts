// La recette du 20/10/2026 côté Cabinet (1.76.0 ; docs/recette.md), à la souris : un cabinet neuf, relié à une
// entreprise neuve qui n'a écrit que le mois en cours. Ce que le parcours vérifie :
//   - la page Dossiers se relit quand on y revient : la proposition d'un client s'y annonce sans recharger ;
//   - « Rien en retard » se dit du client (et ce qui attend au brouillard du mois) ; plus aucun reste de la v10 (ni sa reprise, ni « v10 · en ligne ») ;
//   - le dossier montre l'e-mail et le téléphone de la fiche du client, que « Modifier la fiche » reprend ;
//   - un client qui n'a écrit que le mois en cours n'entend pas « aucun mois attendu… à la première écriture » ;
//   - une période sans écriture validée dit ce qui attend au brouillard, et y mène ;
//   - les mots : « Adresse du client », « Écritures qui reviennent ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { versionDuCode } from '../../serveur/ecrans.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
// Le numéro que le serveur déclare (celui du commit, comme serveur/ecrans.ts le lit).
const VERSION_DU_DEPOT = versionDuCode().split(' · ')[0];

describe('la recette du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-recab-'));
  beforeAll(async () => {
    await admin.connect();
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
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  it('Dossiers relu au retour, le client dit « à jour », ses coordonnées et son brouillard visibles, les mots justes', async () => {
    // Le mois en cours, en jour de calendrier : la seule pièce du client y tombe.
    const mois = new Date().toISOString().slice(0, 7), annee = mois.slice(0, 4);
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennakhil' });
    const cabinet = String(cab.corps.id);
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Droguerie Bou Hamed' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    // Sa fiche société porte où le joindre.
    await admin.query(`update socle.dossier_v10 set contenu = contenu || $2::jsonb where entreprise = $1 and collection = '_racine' and cle = 'company'`,
      [ent, JSON.stringify({ email: 'droguerie@exemple.tn', phone: '+216 73 456 789' })]);
    const envoyer = (collection: string, cle: string, contenu: unknown) =>
      api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    const achat = await envoyer('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-7', date: `${mois}-01`, currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Papier', qty: 3, unitPrice: 417350, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
    });
    expect(achat.statut, JSON.stringify(achat.corps)).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#code-cabinet').waitFor({ timeout: 15_000 });
    // La version est celle du dépôt, plus « v10 · en ligne » ; la reprise de la v10 n'existe plus.
    expect(await p.locator('#app-version').innerText()).toBe(`v${VERSION_DU_DEPOT}`);
    for (const absent of ['v10', 'Reprendre mon portefeuille']) expect(await p.locator('#view').innerText()).not.toContain(absent);

    // Le client confie son dossier pendant que la page est ouverte : en revenant sur Dossiers, la proposition est là,
    // sans recharger.
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await p.evaluate(() => { location.hash = '#/messages'; });
    await p.locator('#view h1').filter({ hasText: 'Messages' }).waitFor({ timeout: 15_000 });
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    const bandeau = p.locator('.cd-prop').filter({ hasText: 'Droguerie Bou Hamed' });
    await bandeau.waitFor({ timeout: 15_000 });
    await bandeau.getByRole('button', { name: 'Accepter le dossier', exact: true }).click();
    await expect.poll(() => p.locator('.cd-prop').filter({ hasText: 'Droguerie Bou Hamed' }).count(), { timeout: 15_000 }).toBe(0);
    expect(((await api('GET', `/entreprises/${ent}/mandat`, client)).corps.mandat as { id: string; statut: string }).statut).toBe('actif');
    // Son seul mois est le mois en cours, avec des écritures au brouillard : rien n'est en retard, la phrase parle du
    // client et dit ce qui attend (1.123.0 : « tout est à jour » s'affichait à côté d'une ligne « à valider »).
    // (1.169.0, la liste de la maquette) Sa ligne dit son mois en cours « à réviser », sans retard.
    await expect.poll(() => p.locator('#view tr[data-id]').filter({ hasText: 'Droguerie Bou Hamed' }).locator('.cd-mo-c').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/à réviser$/);
    expect(await p.locator('#view tr[data-id]').filter({ hasText: 'Droguerie Bou Hamed' }).innerText()).not.toMatch(/en retard|sans pièces/);
    await p.screenshot({ path: path.join(PHOTOS, 'recette-cabinet-1-dossiers.png') });
    expect(mandat).toMatch(/^[0-9a-f-]{36}$/);

    // Le dossier : l'e-mail et le téléphone de la fiche du client ; ses écritures commencent ce mois-ci.
    await p.evaluate((e) => { location.hash = `#/dossier/${e}/suivi`; }, ent);
    await p.locator('#view h1').filter({ hasText: 'Droguerie Bou Hamed' }).waitFor({ timeout: 15_000 });
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toContain('droguerie@exemple.tn');
    const fiche = await p.locator('#view').innerText();
    expect(fiche).toContain('+216 73 456 789');
    expect(fiche).not.toContain('email à renseigner');
    expect(fiche).toMatch(/Ses écritures commencent en .+ : un mois n'est attendu qu'une fois fini\./);
    expect(fiche).not.toContain('l\'attente démarre à la première écriture');
    await p.screenshot({ path: path.join(PHOTOS, 'recette-cabinet-2-dossier.png') });
    // « Modifier la fiche » : l'adresse est celle du client, l'e-mail repris de sa fiche.
    await p.getByRole('button', { name: 'Modifier la fiche', exact: true }).click();
    await p.locator('#modal-root #f-adresse').waitFor({ timeout: 15_000 });
    expect(await p.locator('#modal-root').innerText()).toContain('Adresse du client');
    expect(await p.locator('#modal-root').innerText()).not.toContain('Adresse de l\'employeur');
    expect(await p.locator('#modal-root #f-email').inputValue()).toBe('droguerie@exemple.tn');
    await p.keyboard.press('Escape');

    // Le journal de l'année : rien de validé, mais l'écriture du client attend au brouillard ; le bouton y mène.
    await p.evaluate(([e, a]) => { location.hash = `#/dossier/${e}/comptabilite/journal/${a}`; }, [ent, annee]);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toContain('1 écriture de l\'exercice attend au brouillard. Elle se valide dans la saisie.');
    await p.screenshot({ path: path.join(PHOTOS, 'recette-cabinet-3-brouillard.png') });
    await p.getByRole('button', { name: 'Voir le brouillard', exact: true }).click();
    await p.waitForURL(/\/comptabilite\/saisie/, { timeout: 15_000 });
    // La saisie : ce qui revient chaque mois porte son nom, pas celui d'un abonnement.
    await expect.poll(() => p.locator('#c-abos h2').innerText(), { timeout: 15_000 }).toContain('Écritures qui reviennent');
    expect(await p.locator('#c-abos').innerText()).not.toContain('abonnement');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
