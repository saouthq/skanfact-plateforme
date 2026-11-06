// 1.299.0 — le pont de la trésorerie, joué des deux côtés (Menuiserie Ben Salah, Sousse, relevé BIAT d'octobre 2026) :
//   - l'entreprise encaisse trois chèques un par un, importe son relevé (la remise retrouve ses trois chèques, les frais se
//     créent en « Frais bancaires »), pointe, et envoie l'état de rapprochement à son comptable : le message arrive dans
//     la conversation du cabinet ;
//   - le comptable importe le même relevé au Cabinet : la ligne de la remise se propose avec les TROIS écritures que le pont
//     a écrites (elle restait « Rien dans le livre en face », et l'écrire comptait l'encaissement deux fois) ; les frais
//     ont leur écriture au 627 ; « Valider les 2 » rapproche tout d'un appel ; la remise se défait et se repose (Annuler),
//     se choisit aussi à la main ; le serveur refuse une remise qui ne fait pas la ligne, ou un chèque déjà pris.
// Les dates sont fixes (octobre 2026) : un exercice, quel que soit le jour où le test tourne.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('le pont de la trésorerie 1.299.0 : la remise de chèques, de l\'entreprise au Cabinet', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-pont-1299-'));
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

  it('l\'entreprise encaisse, pointe et écrit ; le comptable rapproche la remise avec ses trois écritures', async () => {
    // ── Le cabinet, et le client qui lui confie son dossier.
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const youssef = await personne('youssef');
    const ent = String((await api('POST', '/entreprises-essai', youssef)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, youssef);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, youssef, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    // ── L'entreprise : le compte BIAT, trois factures payées par chèque les 24, 25 et 27 octobre.
    await api('POST', `/entreprises/${ent}/dossier-v10`, youssef, { changements: [
      { collection: 'accounts', cle: 'a-biat', rang: 20, revision: null, contenu: { id: 'a-biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '' } },
      ...[['c1', 'M. Karray'], ['c2', 'École Les Oliviers'], ['c3', 'Café Zitouna']].map(([id, name], i) => ({ collection: 'clients', cle: id, rang: 21 + i, revision: null, contenu: { id, name } })),
    ] });
    const cheques: [string, string, number, string, string, string][] = [
      ['f1', 'c1', 850, '1011.5', 'CHQ 4410021', '2026-10-24'], ['f2', 'c2', 1475.5, '1755.845', 'CHQ 0091877', '2026-10-25'], ['f3', 'c3', 612.3, '728.637', 'CHQ 7733150', '2026-10-27']];
    for (const [i, [id, client, ht, ttc, ref, quand]] of cheques.entries()) {
      const e = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, youssef, { document: { id, type: 'facture', number: '', status: 'brouillon', date: '2026-10-02', dueDate: '2026-11-01', clientId: client, createdAt: 10 + i,
        subject: 'Menuiserie', lines: [{ label: 'Menuiserie bois', description: '', qty: 1, unit: '', unitPrice: Number.isInteger(ht) ? ht : { '~n': String(ht) }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', regimeTva: 'reel', payments: [] },
      client: { id: client, name: client }, revision: null, rang: 30 + i, netAPayer: Number(ttc).toFixed(3) })).corps;
      expect(String((e.contenu as Obj | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
      await api('POST', `/entreprises/${ent}/dossier-v10`, youssef, { changements: [{ collection: 'documents', cle: id, rang: 30 + i, revision: Number(e.revision),
        contenu: { ...(e.contenu as Obj), payments: [{ id: `p-${id}`, date: quand, amount: { '~n': ttc }, method: 'cheque', reference: ref, accountId: 'a-biat' }] } }] });
    }
    const objets = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, youssef)).corps.objets as { collection: string; cle: string; contenu: Obj }[]);

    // ── 1. L'entreprise importe son relevé : la remise retrouve ses trois chèques ; les frais se créent en « Frais
    // bancaires » ; tout se pointe ; l'état tombe juste et s'envoie au comptable.
    const cxE = await contexte(youssef);
    const e = await cxE.newPage();
    const erreurs: string[] = [];
    e.on('pageerror', (x) => erreurs.push(`entreprise : ${x.message}`));
    await e.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
    await e.locator('#tr-comptes .tr-compte').first().waitFor({ timeout: 20_000 });
    await plusTard(e);
    await e.locator('#t-tabs [data-tab="rapprochement"]').click();
    await e.locator('#t-import').waitFor({ timeout: 10_000 });
    const csv = path.join(dossier, 'releve-octobre.csv');
    fs.writeFileSync(csv, 'Date;Libellé;Débit;Crédit\n28/10/2026;REMISE CHEQUES 3 CHQ BORD 0457;;3 495,982\n31/10/2026;FRAIS TENUE DE COMPTE;18,500;\n;Solde final;;3 477,482\n');
    const [choix] = await Promise.all([e.waitForEvent('filechooser', { timeout: 8_000 }), e.locator('#t-import').click()]);
    await choix.setFiles(csv);
    const revue = e.locator('#modal-root .modal', { hasText: 'Le relevé de' });
    await revue.waitFor({ timeout: 10_000 });
    expect(await revue.locator('#imp-remises tbody tr').count()).toBe(1);
    await revue.locator('#imp-absentes [data-absente]').click();
    const frais = e.locator('#modal-root .modal', { hasText: 'Nouveau mouvement' });
    await frais.waitFor({ timeout: 10_000 });
    expect(await frais.locator('[name=kind]').inputValue()).toBe('banque');
    await frais.locator('#ok').click();
    await expect.poll(() => revue.locator('#imp-absentes [data-absente]').innerText(), { timeout: 10_000 }).toBe('Créé, pointé');
    // Les trois chèques de la remise ; les frais, créés depuis le relevé, le sont déjà.
    expect(await revue.locator('#ok').innerText()).toBe('Pointer 3 mouvements');
    await revue.locator('#ok').click();
    await expect.poll(async () => net(await e.locator('#t-body').innerText()), { timeout: 10_000 }).toMatch(/Écart 0,000 DT/);
    await e.locator('#t-etat-compta').click();
    await expect.poll(() => e.evaluate(() => location.hash)).toBe('#/comptable');
    const zone = e.locator('#msg-racine textarea').first();
    await expect.poll(async () => net(await zone.inputValue()), { timeout: 10_000 }).toMatch(/^Bonjour, j'ai rapproché le compte « BIAT » de son relevé au \d\d\/\d\d\/\d{4} : solde du relevé 3 477,482 DT, aucun écart\./);
    await e.getByRole('button', { name: 'Envoyer', exact: true }).click();
    // Le message arrive dans la conversation du cabinet.
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, leila)).corps.messages as Obj[] ?? []).map((m) => net(String(m.texte))).find((t) => t.includes('rapproché le compte')),
      { timeout: 15_000 }).toMatch(/solde du relevé 3 477,482 DT, aucun écart\. L'état de rapprochement est dans SkanFact/);

    // ── Ce que le pont a écrit au livre du cabinet : trois encaissements au 532, et les frais au 627.
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { id: string; journal: string; date: string; lignes: Ligne[] };
    const auLivre = async () => ((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, leila)).corps.ecritures as Ecriture[])
      .filter((x) => x.journal === 'BQ').map((x) => [x.date, ...x.lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`)].join(' | ')).sort();
    await expect.poll(auLivre, { timeout: 20_000 }).toEqual([
      '2026-10-24 | 532 1011.500 0.000 | 411 0.000 1011.500', '2026-10-25 | 532 1755.845 0.000 | 411 0.000 1755.845',
      '2026-10-27 | 532 728.637 0.000 | 411 0.000 728.637', '2026-10-31 | 627 18.500 0.000 | 532 0.000 18.500']);

    // ── 2. Le comptable importe le même relevé au Cabinet.
    expect((await api('POST', `/entreprises/${ent}/compta/releves`, leila, { annee: 2026, compte: '532', banque: 'BIAT', fichier: 'octobre.csv', empreinte: 'c'.repeat(64),
      soldeDebut: '0', soldeFin: '3477,482', lignes: [
        { date: '2026-10-28', libelle: 'REMISE CHEQUES 3 CHQ BORD 0457', reference: '0457', montant: '3495,982' },
        { date: '2026-10-31', libelle: 'FRAIS TENUE DE COMPTE', reference: '', montant: '-18,500' }] })).statut).toBe(201);
    const releves = async () => ((await api('GET', `/entreprises/${ent}/compta/releves?annee=2026`, leila)).corps.releves as Obj[]);
    const [rel] = await releves();
    const [lRemise, lFrais] = rel?.lignes as Obj[];

    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    const aller = async () => {
      await c.goto('about:blank');
      await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/banque/2026`);
      await c.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await c.waitForTimeout(800);
      await plusTard(c);
    };
    const ligne = (texte: string) => c.locator('table.bq-t [data-bq-ligne]').filter({ hasText: texte });
    const groupe = (texte: string) => ligne(texte).getAttribute('data-groupe');
    const livre = () => c.locator('.bq-livre').innerText().then(net);
    const principal = () => c.locator('#bq-principal').innerText().catch(() => '');
    const annonce = () => c.locator('#bq-annonce').innerText().then(net).catch(() => '');
    const choisir = async (texte: string) => { await ligne(texte).locator('td').nth(1).click(); await expect.poll(() => c.locator('.bq-lh').innerText()).toContain(texte); };
    const faces = async () => { const l = ((await releves())[0]?.lignes as Obj[]).find((x) => x.id === lRemise?.id); return l?.rapprochement ? [l.rapprochement.ecriture, ...((l.rapprochement.autres ?? []) as Obj[]).map((a) => a.ecriture)].length : 0; };

    await aller();
    // La remise se propose avec ses trois écritures (avant : « Rien dans le livre en face ») ; les frais, avec la leur.
    await expect.poll(() => groupe('REMISE CHEQUES')).toBe('prop');
    expect(net(await ligne('REMISE CHEQUES').innerText())).toMatch(/Remise de 3 écritures · leur somme fait la ligne au millime/);
    expect(await groupe('FRAIS TENUE')).toBe('prop');
    await choisir('REMISE CHEQUES');
    expect(await c.locator('.bq-livre table.bq-rem tbody tr.on').count()).toBe(3);
    expect(await livre()).toMatch(/Une remise : plusieurs écritures font la ligne 3 cochées .*La ligne \+?3 495,982 DT 3 cochées 3 495,982 DT .*écart 0/i);
    expect(await principal()).toMatch(/^Rapprocher les 3/);
    await c.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-remise-ecritures.png') });

    // Au téléphone : la carte de la remise et le livre en face, ses trois écritures, ne sortent pas de l'écran.
    const cxT = await contexte(leila, 390, 844);
    const t = await cxT.newPage();
    t.on('pageerror', (x) => erreurs.push(`téléphone : ${x.message}`));
    await t.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/banque/2026`);
    await t.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await plusTard(t);
    await t.locator('.bq-k1', { hasText: 'REMISE CHEQUES' }).click();
    await t.locator('.bq-livre table.bq-rem').waitFor({ timeout: 10_000 });
    expect(await t.locator('.bq-livre table.bq-rem tbody tr.on').count()).toBe(3);
    expect(await t.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(await t.locator('.bq-livre').evaluate((x) => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);

    // « Valider les 2 » : la remise et les frais d'un appel ; le relevé est rapproché, l'écart expliqué au millime.
    await c.locator('[data-bq-valider]').first().click();
    await expect.poll(faces, { timeout: 15_000 }).toBe(3);
    // Le message dit ce que chaque ligne a reçu (et non « chacune avec l'écriture proposée »).
    await expect.poll(() => c.locator('#toast').innerText().then(net), { timeout: 10_000 }).toMatch(/^2 lignes rapprochées : 1 avec l'écriture proposée, une remise avec ses 3 écritures\./);
    expect(((await releves())[0]?.lignes as Obj[]).find((x) => x.id === lFrais?.id)?.rapprochement?.autres).toBeUndefined();
    await expect.poll(async () => net(await c.locator('.bq-ecran').innerText()), { timeout: 10_000 }).toMatch(/Octobre 2026 est rapproché à la BIAT 2 mouvements sur 2 ont leur écriture\./);
    expect(net(await c.locator('.bqp').innerText())).toMatch(/Écart expliqué au millime/);

    // ── 3. Revoir octobre : la remise se lit avec ses trois écritures, se défait, et « Annuler » la repose entière.
    await c.locator('#bq-revoir').click();
    await c.locator('#bq-voir-faites').click();
    // La ligne nomme ce que la remise encaisse : les trois chèques, pas le premier seul.
    expect(net(await ligne('REMISE CHEQUES').innerText())).toMatch(/avec FAC-2026-001 et 2 autres écritures \(une remise\)\s*encaissement de c1, c2, c3\s*depuis SkanFact/);
    await choisir('REMISE CHEQUES');
    expect(await livre()).toMatch(/Rapprochée avec 3 écritures : une remise.*La ligne \+?3 495,982 DT 3 écritures 3 495,982 DT .*écart 0/);
    expect(await c.locator('.bq-livre [data-bq-voir-ecriture]').count()).toBe(3);
    await c.locator('#bq-defaire').click();
    await expect.poll(annonce, { timeout: 10_000 }).toMatch(/Rapprochement défait : la ligne revient à traiter, les écritures de la remise restent au livre/);
    expect(await faces()).toBe(0);
    await c.locator('#bq-annuler').click();
    await expect.poll(faces, { timeout: 10_000 }).toBe(3);

    // ── 4. À la main : « Une seule écriture » sort du mode remise ; « Plusieurs écritures font cette ligne ? » y revient,
    // rien de coché ; cochées une à une, la somme se lit avant le geste.
    await c.locator('#bq-defaire').click();
    await expect.poll(faces, { timeout: 10_000 }).toBe(0);
    await aller();
    await choisir('REMISE CHEQUES');
    await c.locator('#bq-remise-non').click();
    expect(await livre()).toMatch(/Rien dans le livre au même montant/);
    await c.locator('#bq-remise-oui').click();
    expect(await c.locator('.bq-livre table.bq-rem tbody tr').count()).toBe(3);
    expect(await c.locator('.bq-livre table.bq-rem tbody tr.on').count()).toBe(0);
    expect(await principal()).toBe('');
    await c.locator('.bq-livre table.bq-rem tbody tr').nth(0).click();
    await c.locator('.bq-livre table.bq-rem tbody tr').nth(1).click();
    expect(await livre()).toMatch(/2 cochées 2 767,345 DT écart 728,637 DT .*Les 2 écritures cochées font 2 767,345 DT, la ligne 3 495,982 DT/);
    await c.locator('.bq-livre table.bq-rem tbody tr').nth(2).click();
    expect(await principal()).toMatch(/^Rapprocher les 3/);
    await c.keyboard.press('Enter');
    // C'était la dernière ligne à traiter : l'écran le dit (le mois est rapproché), et la remise tient ses trois écritures.
    await expect.poll(faces, { timeout: 10_000 }).toBe(3);
    await expect.poll(async () => net(await c.locator('.bq-ecran').innerText()), { timeout: 10_000 }).toMatch(/Octobre 2026 est rapproché à la BIAT 2 mouvements sur 2 ont leur écriture\./);

    // ── 5. Le serveur tient la règle, quel que soit l'écran : une remise qui ne fait pas la ligne, un chèque déjà pris.
    const livreSrv = (await api('GET', `/entreprises/${ent}/compta/releves?annee=2026`, leila)).corps.releves as Obj[];
    const r0 = (livreSrv[0]?.lignes as Obj[]).find((x) => x.id === lRemise?.id)?.rapprochement as Obj;
    const poser = (corps: Obj) => api('POST', `/entreprises/${ent}/compta/releves/${rel?.id}/rapprochements`, leila, { poses: [corps] });
    const sansLe3 = await poser({ ligne: lRemise?.id, ecritureLigne: r0.ligne, autres: [(r0.autres as Obj[])[0]?.ligne], niveau: 'certain' });
    expect(net(String(sansLe3.corps.motif ?? JSON.stringify(sansLe3.corps)))).toMatch(/les 2 écritures font 2 767,345, la ligne du relevé 3 495,982 : une remise se rapproche quand ses écritures font la ligne au millime/i);
    const pris = await poser({ ligne: lFrais?.id, ecritureLigne: (r0.autres as Obj[])[1]?.ligne, niveau: 'certain' });
    expect(String(pris.corps.motif)).toMatch(/répond déjà d'une autre ligne de relevé/);
    expect(await faces()).toBe(3);
    // « Tout défaire » compte les LIGNES du relevé : la remise en est une, pas trois.
    expect((await api('POST', `/entreprises/${ent}/compta/releves/${rel?.id}/derapprocher`, leila, {})).corps.defaits).toBe(2);
    expect(await faces()).toBe(0);

    expect(erreurs).toEqual([]);
    await Promise.all([cxE.close(), cxC.close(), cxT.close()]);
    void (await objets());
  }, 240_000);
});
