// Le lot facture, à l'écran (05/10/2026 ; docs/facture-details.md ; web/v10/facture-details.txt, serveur/v10/identite.ts).
// Samia tient une pâtisserie à Sfax ; son entreprise est créée sans matricule ni RIB. Elle facture des pièces montées à
// un hôtel de Sousse, avec une retenue à la source de 1 %. Ce que le parcours d'un commerçant avait trouvé, et que ce
// test tient :
//   - l'en-tête de la pièce n'imprime plus « MF » suivi de rien ; le tampon « Brouillon » ne couvre plus l'objet : pâle,
//     au milieu de la page, il s'imprime comme une encre ;
//   - avant d'émettre, ce qui manque à la fiche se nomme, et « Compléter ma fiche… » le règle sans quitter la pièce : un
//     matricule mal formé se dit sur son champ, celui d'une autre entreprise est refusé par le serveur et rien ne change ;
//     complété, la fenêtre se relit (plus d'avertissement, « Émettre ») et le serveur porte le matricule à l'entreprise ;
//   - la pièce émise porte son matricule et son RIB ; la retenue choisie dans la liste part en nombre ;
//   - la page rechargée, un paiement s'enregistre ; sa fenêtre dit « une retenue subie d'août », « de septembre » ;
//   - le menu d'une pièce émise dit ce que font ses gestes en ligne (pas de PDF joint, pas de modification) ;
//   - l'espace du client dit ce qui a déjà été payé à côté du reste ;
//   - un refus du serveur à l'émission se lit dans une fenêtre qui reste.
// Les données discriminent : 2 × 96,500 à 19 %, timbre 1,000, retenue 1 % hors timbre (2,297) → 228,373 ; 100,000 payés.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type FrameLocator, type Locator, type Page } from 'playwright-core';
import pg from 'pg';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le lot facture, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-facture-details-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  // La fenêtre du dessus (elles s'empilent : la fiche s'ouvre sur la fenêtre d'émission).
  const dessus = (p: Page) => p.locator('#modal-root .modal-bg').last();
  const boite = (a: { x: number; y: number; width: number; height: number } | null) => a ?? { x: 0, y: 0, width: 0, height: 0 };
  const croise = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  // Une personne connectée (son code posé), son entreprise créée sans matricule.
  async function personne(nom: string, raisonSociale: string, matriculeFiscal?: string) {
    const email = `${nom.toLowerCase()}-facture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Portable', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale, ...(matriculeFiscal ? { matriculeFiscal } : {}) })).corps.id);
    return { jeton, ent };
  }

  it('Samia, sans matricule ni RIB : la pièce n\'imprime rien de vide, la fiche se complète avant d\'émettre, et le reste suit', async () => {
    // Une autre entreprise porte déjà 2222222B/A/M/000.
    await personne('Karim', 'Boulangerie du Port', '2222222B/A/M/000');
    const { jeton, ent } = await personne('Samia', 'Pâtisserie Les Délices de Sfax');
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel Les Oliviers', matricule: '7654321C/A/M/000', address: 'Route touristique, 4000 Sousse' } },
    ] })).statut).toBe(200);
    const surLeServeur = async () => (((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[]));
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(`${e.message} @ ${p.url()}`));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await p.getByRole('button', { name: '+ Nouvelle facture' }).first().click({ timeout: 20_000 });
    await p.locator('#view h1').filter({ hasText: 'Nouvelle facture' }).waitFor({ timeout: 15_000 });
    await plusTard(p);

    // 1. Le brouillon : le client, l'objet, une ligne, la retenue de 1 % choisie dans la liste.
    await p.locator('[data-combo=clientId] .combo-btn').click();
    await p.locator('[data-combo=clientId] .combo-q').fill('Hôtel');
    await p.locator('[data-combo=clientId] .combo-list [role=option]').first().click();
    await p.locator('input[name="subject"]').fill('Pièces montées, octobre 2026');
    await p.locator('#lines tr:first-child input[data-k="label"]').fill('Pièce montée, 60 choux');
    await p.locator('#lines tr:first-child input[data-k="qty"]').fill('2');
    await p.locator('#lines tr:first-child input[data-k="unitPrice"]').fill('96.5');
    await p.locator('#lines tr:first-child input[data-k="unitPrice"]').press('Tab');
    await p.locator('select[name=withholdingRate]').selectOption('1');

    // 2. L'aperçu : pas de « MF » sans matricule ; le tampon « Brouillon » ne couvre ni l'en-tête ni le client et l'objet,
    // et s'imprime comme une encre (pâle, multiplié : le texte qu'il croise reste noir).
    const apercu: FrameLocator = p.frameLocator('#preview');
    await expect.poll(() => apercu.locator('.parties').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('Pièces montées, octobre 2026');
    expect(net(await apercu.locator('.brand').innerText())).toBe('Pâtisserie Les Délices de Sfax');
    const tampon = apercu.locator('.stamp');
    expect(net(await tampon.innerText())).toMatch(/^brouillon$/i);
    const [bt, bp, bh] = [boite(await tampon.boundingBox()), boite(await apercu.locator('.parties').boundingBox()), boite(await apercu.locator('.hero').boundingBox())];
    expect(bt.width).toBeGreaterThan(0);
    expect(croise(bt, bp) || croise(bt, bh)).toBe(false);
    const encre = await tampon.evaluate((el) => { const s = getComputedStyle(el); return { opacite: Number(s.opacity), melange: s.mixBlendMode }; });
    expect(encre.opacite).toBeLessThanOrEqual(0.2);
    expect(encre.melange).toBe('multiply');

    // 3. Émettre : ce qui manque se nomme, et « Compléter ma fiche… » est là.
    await p.locator('#issue').click();
    const avert = () => p.locator('#modal-root #em-avert').innerText().then(net).catch(() => '');
    await expect.poll(avert).toContain('Ton matricule fiscal manque : il est obligatoire sur une facture en Tunisie, et s\'imprime en haut de la pièce.');
    expect(await avert()).toContain('Aucun RIB n\'est renseigné');
    expect(net(await p.locator('#modal-root #ok').innerText())).toBe('Émettre quand même');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'facture-details-1-avertissements.png') });
    await p.locator('#em-fiche').click();
    await expect.poll(() => dessus(p).locator('h2').innerText().catch(() => '')).toBe('Compléter ta fiche société');
    const fiche = dessus(p);
    // Les seuls champs qui manquent : la raison sociale est là.
    expect(await fiche.locator('#cf [name=name]').count()).toBe(0);
    // Mal formé : dit sur son champ, rien ne part.
    await fiche.locator('#cf [name=matricule]').fill('1234567');
    await fiche.locator('#ok').click();
    await expect.poll(() => fiche.locator('#cf-refus').innerText().then(net).catch(() => '')).toContain('« 1234567 » n\'a pas la forme d\'un matricule fiscal');
    expect(await fiche.locator('#cf [name=matricule]').evaluate((el) => el.closest('.field')?.classList.contains('champ-faute'))).toBe(true);
    // Celui d'une autre entreprise : le serveur refuse, et la fiche reprend ce qu'elle avait.
    await fiche.locator('#cf [name=matricule]').fill('2222222B/A/M/000');
    await fiche.locator('#ok').click();
    await expect.poll(() => fiche.locator('#cf-refus').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe('Ce matricule fiscal est déjà celui d\'une autre entreprise sur SkanFact : relis-le sur ta carte d\'identification fiscale. Rien n\'a été enregistré.');
    expect((await surLeServeur()).find((o) => o.collection === '_racine' && o.cle === 'company')?.contenu.matricule ?? '').toBe('');
    // Et la page non plus ne le garde pas : son prochain enregistrement ne repartirait pas avec lui.
    expect(await p.evaluate(() => (window as unknown as { __data: { company: { matricule?: string } } }).__data.company.matricule ?? '')).toBe('');
    // Le sien (à ce fichier seul : les tests partagent une base, tests/matricule-libre.ts), recopié de sa carte comme on
    // le fait (vu sur le serveur d'essai, E2 : la pièce l'imprimait ainsi), la banque et le RIB : la fenêtre d'émission se
    // relit.
    await fiche.locator('#cf [name=matricule]').fill('1357913 b a m 000');
    await fiche.locator('#cf [name=bank]').fill('Banque de Tunisie');
    await fiche.locator('#cf [name=rib]').fill('08100012345678901269');
    await fiche.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal-bg').count()).toBe(1);
    expect(await avert()).toBe('');
    expect(net(await p.locator('#modal-root #ok').innerText())).toBe('Émettre');
    expect((await admin.query('select matricule_fiscal from socle.entreprise where id = $1', [ent])).rows[0].matricule_fiscal).toBe('1357913B/A/M/000');
    // La fiche le garde sous la même forme lisible que l'entreprise.
    expect((await surLeServeur()).find((o) => o.collection === '_racine' && o.cle === 'company')?.contenu.matricule).toBe('1357913B/A/M/000');

    // 4. Émise : son matricule (sous sa forme lisible, en tête et au pied) et son RIB s'impriment ; la retenue est partie
    // en nombre.
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 15_000 }).toBe('Facture FAC-2026-001');
    await expect.poll(() => apercu.locator('.brand').innerText().then(net).catch(() => '')).toBe('Pâtisserie Les Délices de Sfax MF 1357913B/A/M/000');
    expect(net(await apercu.locator('.footer').innerText())).toContain('Matricule fiscal 1357913B/A/M/000');
    expect(net(await apercu.locator('.after').innerText())).toContain('08100012345678901269');
    const f1 = (await surLeServeur()).find((o) => o.collection === 'documents' && o.contenu.number === 'FAC-2026-001');
    expect(f1?.contenu.withholdingRate).toBe(1);

    // 5. La page rechargée, un paiement de 100,000 s'enregistre ; sa fenêtre dit le mois de la retenue, élidé.
    await p.reload();
    await p.locator('#pay').click({ timeout: 20_000 });
    const date = p.locator('#pf2 .datefield .d-txt').first();
    const rs = () => p.locator('#pf-rs').innerText().then(net).catch(() => '');
    await date.fill('15/08/2026'); await date.press('Tab');
    await expect.poll(rs).toContain('c\'est une retenue subie d\'août 2026');
    await date.fill('15/09/2026'); await date.press('Tab');
    await expect.poll(rs).toContain('c\'est une retenue subie de septembre 2026');
    await date.fill('05/10/2026'); await date.press('Tab');
    await expect.poll(rs).toContain('c\'est une retenue subie d\'octobre 2026');
    await p.locator('#pf2 [name=amount]').fill('100');
    await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(async () => ((await surLeServeur()).find((o) => o.contenu.number === 'FAC-2026-001')?.contenu.payments as unknown[] | undefined)?.length ?? 0, { timeout: 10_000 }).toBe(1);
    expect(await p.getByRole('heading', { name: 'Rien n\'a été enregistré' }).count()).toBe(0);

    // 6. Le menu d'une pièce émise, dans la liste.
    await p.evaluate(() => { location.hash = '#/factures'; });
    await p.locator('#view tr').filter({ hasText: 'FAC-2026-001' }).getByRole('button', { name: /Actions/ }).click();
    const menu = net(await p.locator('.row-menu').last().innerText());
    expect(menu).toContain('Voir la facture émise et ses paiements');
    expect(menu).toContain('Le message porte le lien de la pièce');
    expect(menu).toContain('Le message s\'ouvre dans WhatsApp, avec le lien de la pièce');
    expect(menu).not.toMatch(/PDF est joint|prêt à glisser|la modifier/);
    await p.keyboard.press('Escape');

    // 7. L'espace du client : ce qu'il a payé, à côté du reste.
    const lien = await api('POST', `/entreprises/${ent}/espace/liens`, jeton, { client: 'c1', piece: String(f1?.cle) });
    const client = await cx.newPage();
    await client.goto(`${serveur.adresse}${String(lien.corps.adresse)}`);
    await expect.poll(() => client.locator('.barre .reste').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe('Reste à payer : 128,373 DT · Payé : 100,000 DT');
    await client.close();

    // 8. Un refus du serveur à l'émission : une fenêtre qui reste, avec la raison et ce qui n'a pas été fait.
    await p.getByRole('button', { name: '+ Nouvelle facture' }).first().click();
    await p.locator('#view h1').filter({ hasText: 'Nouvelle facture' }).waitFor({ timeout: 15_000 });
    await p.locator('[data-combo=clientId] .combo-btn').click();
    await p.locator('[data-combo=clientId] .combo-q').fill('Hôtel');
    await p.locator('[data-combo=clientId] .combo-list [role=option]').first().click();
    await p.locator('#lines tr:first-child input[data-k="label"]').fill('Croissants pur beurre');
    await p.locator('#lines tr:first-child input[data-k="qty"]').fill('120');
    await p.locator('#lines tr:first-child input[data-k="unitPrice"]').fill('0.85');
    await p.locator('#lines tr:first-child input[data-k="unitPrice"]').press('Tab');
    const motif = 'Le timbre fiscal n\'est pas renseigné au 05/10/2026 : renseigne-le dans Paramètres → Documents.';
    await p.route('**/dossier-v10/emettre', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ motif }) }));
    await p.locator('#issue').click();
    await p.locator('#modal-root #ok').click();
    const refus: Locator = p.locator('#modal-root .modal-bg').last();
    await expect.poll(() => refus.locator('h2').innerText().catch(() => '')).toBe('La facture n\'est pas émise');
    await p.waitForTimeout(4_000);
    expect(net(await refus.innerText())).toContain(`${motif} Rien n'a été émis : elle reste en brouillon, sans numéro.`);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'facture-details-2-refus.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
