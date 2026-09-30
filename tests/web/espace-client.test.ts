// L'espace client, à la souris (brique 77 ; docs/espace-client.md ; 14 § 2.1). Nadia a émis une facture à
// la Menuiserie du Lac, qui en a payé une partie, puis un avoir d'une table rendue. Ce que le parcours
// vérifie, écran ET serveur :
//   - sur la facture, « Plus » → « Lien pour le client… » donne un lien à copier ;
//   - le client l'ouvre dans son navigateur, sans compte : la facture EXACTEMENT comme Nadia l'imprime
//     (le même texte que le gabarit de la v10 avec toute sa fiche), et ce qu'il en doit encore ;
//   - Nadia voit que le lien a été ouvert (« Vu le … ») ;
//   - le lien de son compte : ce qu'il doit, et chacune de ses pièces ; lisible sur un téléphone ;
//   - « Retirer » : le lien ne s'ouvre plus, et la page le dit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'espace client, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-espace-'));
  beforeAll(async () => {
    await admin.connect();
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
  // Le texte d'une pièce rendue, sans les espaces de mise en page.
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();

  it('le lien d\'une facture, puis celui du compte : la pièce comme imprimée, ce qu\'il doit, vu, puis retiré', async () => {
    const email = `nadia-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', premier)).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    // La facture de la Menuiserie, émise par le serveur, et un paiement de 200 DT.
    type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const menuiserie = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!menuiserie) throw new Error('client d\'exemple absent');
    const doc = {
      id: 'f1', type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
      reference: 'BC-4471', notes: 'Livraison comprise\nGarantie deux ans',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, unitCost: 300, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
    };
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: doc }] });
    const emise = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: menuiserie.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
    expect(emise.statut).toBe(200);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: Number(emise.corps.revision),
      contenu: { ...(emise.corps.contenu as Record<string, unknown>), payments: [{ id: 'p1', date: '2026-10-05', amount: 200, method: 'virement', reference: 'VIR-77', accountId: 'banque', note: 'interne' }] } }] });
    // Et un avoir d'une table rendue (536,095) : il reste 1 073,190 − 200 − 536,095 = 337,095.
    const avoir = {
      id: 'a1', type: 'avoir', number: '', date: '2026-10-10', clientId: menuiserie.cle, creditOf: 'f1', creditReason: 'Une table rendue', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 1, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
    };
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'a1', rang: 1, revision: null, contenu: avoir }] });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre-avoir`, jeton, { document: avoir, client: menuiserie.contenu, revision: 1, rang: 1, netAPayer: '536.095' })).statut).toBe(200);

    // Nadia, sur sa facture : « Plus » → « Lien pour le client… ».
    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const nadia = await cn.newPage();
    const erreurs: string[] = [];
    nadia.on('pageerror', (e) => erreurs.push(e.message));
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await nadia.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await nadia.waitForTimeout(600);
    await plusTard(nadia);
    await nadia.locator('#more-btn').click();
    await nadia.getByRole('button', { name: 'Lien pour le client…', exact: true }).click();
    const fenetre = nadia.locator('#modal-root .modal').last();
    // Ouvrir la fenêtre ne crée rien : il faut le demander.
    await expect.poll(() => fenetre.locator('#lc-liste').innerText()).toBe('Aucun.');
    await fenetre.getByRole('button', { name: 'Créer le lien de cette pièce', exact: true }).click();
    const adresse = fenetre.locator('#lc-adresse');
    await adresse.waitFor({ timeout: 15_000 });
    const lienPiece = await adresse.inputValue();
    expect(lienPiece).toMatch(new RegExp(`^${serveur.adresse.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/espace/#[A-Za-z0-9_-]{32}$`));
    await expect.poll(() => fenetre.locator('#lc-liste').innerText()).toMatch(/Cette pièce, donné le \d\d\/\d\d\/\d{4} à \d+ h \d\d par Nadia\s*Pas encore ouvert/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'espace-1-lien.png') });
    // Ce que la v10 de Nadia imprime, avec TOUTE sa fiche (le même gabarit) : le texte de référence.
    const imprime = await nadia.evaluate(() => {
      const w = window as unknown as { SkanCore: { documentHtml: (d: unknown, c: unknown, co: unknown, o: unknown) => string }; __data: { documents: { id: string; clientId: string }[]; clients: { id: string }[]; company: unknown } };
      const d = w.__data.documents.find((x) => x.id === 'f1');
      const c = w.__data.clients.find((x) => x.id === d?.clientId);
      return new DOMParser().parseFromString(w.SkanCore.documentHtml(d, c, w.__data.company, { preview: true }), 'text/html').body.textContent ?? '';
    });

    // Le client ouvre le lien, sans compte : la facture comme imprimée, et ce qu'il en doit encore.
    const cc = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
    const client = await cc.newPage();
    const erreursClient: string[] = [];
    client.on('pageerror', (e) => erreursClient.push(e.message));
    client.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') erreursClient.push(`${m.text()} ${m.location().url}`); });
    await client.goto(lienPiece);
    await expect.poll(() => client.locator('.barre .reste').innerText(), { timeout: 15_000 }).toMatch(/^Reste à payer : 337,095\sDT$/);
    const cadre = client.frameLocator('iframe.piece');
    await expect.poll(() => cadre.locator('body').innerText(), { timeout: 15_000 }).toContain('FAC-2026-001');
    expect(net(await client.evaluate(() => (document.querySelector('iframe.piece') as HTMLIFrameElement).contentDocument?.body.textContent ?? ''))).toBe(net(imprime));
    expect(await client.locator('header.societe h1').innerText()).toMatch(/^Entreprise d'essai de Nadia/);
    await client.screenshot({ path: path.join(PHOTOS, 'espace-2-piece.png') });
    // « Imprimer ou enregistrer en PDF » : la pièce mise en page comme la v10 la met pour son PDF, et
    // l'impression demandée (le navigateur ne la refuse pas).
    await client.getByRole('button', { name: 'Imprimer ou enregistrer en PDF', exact: true }).click();
    await expect.poll(() => client.evaluate(() => (document.querySelector('iframe.impression') as HTMLIFrameElement | null)?.contentDocument?.querySelectorAll('.page').length ?? 0), { timeout: 10_000 }).toBe(1);
    await client.waitForTimeout(500);

    // Nadia rouvre la fenêtre : le lien a été vu.
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    await nadia.locator('#more-btn').click();
    await nadia.getByRole('button', { name: 'Lien pour le client…', exact: true }).click();
    await expect.poll(() => nadia.locator('#modal-root .modal').last().locator('#lc-liste').innerText(), { timeout: 15_000 })
      .toMatch(/^Cette pièce, donné le .* par Nadia\s*Vu le \d\d\/\d\d\/\d{4} à \d+ h \d\d\s*Retirer$/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'espace-3-vu.png') });

    // Le lien de son compte : ce qu'il doit, et ses pièces.
    const f2 = nadia.locator('#modal-root .modal').last();
    await f2.getByRole('button', { name: 'Plutôt le lien de son compte (toutes ses pièces, et ce qu\'il doit)', exact: true }).click();
    await expect.poll(() => f2.locator('#lc-lien').innerText()).toContain('Le lien de son compte');
    const lienCompte = await f2.locator('#lc-adresse').inputValue();
    expect(lienCompte).not.toBe(lienPiece);
    await client.goto(lienCompte);
    await client.reload();
    await expect.poll(() => client.locator('.carte.du').innerText(), { timeout: 15_000 }).toMatch(/^Tu dois\s+337,095\sDT$/);
    // Chaque pièce, la plus récente d'abord ; ce que la facture a déjà reçu se lit sous elle.
    expect(net(await client.locator('table.pieces tbody').innerText())).toBe(net(`Avoir AVO-2026-001 10/10/2026 — 536,095 DT — Voir
      Facture FAC-2026-001 Payée en partie Payé : 200,000 DT · Avoirs : 536,095 DT 01/10/2026 31/10/2026 1 073,190 DT 337,095 DT Voir`));
    await client.screenshot({ path: path.join(PHOTOS, 'espace-4-releve.png') });
    await client.locator('table.pieces tr').filter({ hasText: 'FAC-2026-001' }).getByRole('button', { name: 'Voir', exact: true }).click();
    await client.getByRole('button', { name: '← Toutes tes pièces', exact: true }).waitFor({ timeout: 10_000 });
    // Sur un téléphone : rien ne déborde, et chaque chiffre dit ce qu'il est (plus de titres de colonnes).
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', isMobile: true, hasTouch: true });
    const t = await tel.newPage();
    await t.goto(lienCompte);
    await t.locator('table.pieces').waitFor({ timeout: 15_000 });
    expect(await t.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(net(await t.locator('table.pieces tbody').innerText()))
      .toBe(net(`Avoir AVO-2026-001 Date : 10/10/2026 Échéance : — Montant : 536,095 DT Reste à payer : — Voir
        Facture FAC-2026-001 Payée en partie Payé : 200,000 DT · Avoirs : 536,095 DT Date : 01/10/2026 Échéance : 31/10/2026 Montant : 1 073,190 DT Reste à payer : 337,095 DT Voir`));
    await t.screenshot({ path: path.join(PHOTOS, 'espace-5-telephone.png') });

    // « Retirer » le lien de la facture : il ne s'ouvre plus, et la page le dit.
    const ligne = f2.locator('#lc-liste tr').filter({ hasText: 'Cette pièce' });
    await ligne.getByRole('button', { name: 'Retirer', exact: true }).click();
    await expect.poll(() => ligne.innerText()).toMatch(/Retiré le/);
    await client.goto(lienPiece);
    await client.reload();
    await expect.poll(async () => net(await client.locator('.refus').innerText()), { timeout: 15_000 })
      .toBe('Ce lien ne s\'ouvre pas. Ce lien n\'est plus valable : demande un nouveau lien à l\'entreprise qui te l\'a envoyé.');
    await client.screenshot({ path: path.join(PHOTOS, 'espace-6-retire.png') });
    expect(erreurs).toEqual([]);
    // Le seul message attendu : le refus du lien retiré (404), que la page dit.
    expect(erreursClient.filter((m) => !/status of 404 .*\/v1\/espace$/.test(m))).toEqual([]);
  }, 180_000);
});
