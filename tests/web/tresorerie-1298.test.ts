// 1.298.0 — la trésorerie jouée comme un vrai commerçant (revue du 06/11/2026, Menuiserie Ben Salah) : à la souris, sur
// une entreprise neuve sans comptable relié.
//   - le loyer du mois passé, jamais noté : « déjà échu » dans la prévision (et dans son export), demandé dans « Où j'en
//     suis », et « Noter comme payé » le note à sa date et le sort des deux ;
//   - le relevé importé : la remise de trois chèques retrouve ses trois encaissements (au lieu d'être « absente ») et se
//     pointe avec eux ; les frais créés depuis le relevé naissent en « Frais bancaires » ;
//   - sans comptable relié, l'état de rapprochement ne propose pas de lui écrire ;
//   - « Sans justificatif » retrouve les mouvements libres sans pièce ;
//   - au téléphone, la liste des mouvements tient dans l'écran (la rangée des titres en pastilles n'élargit plus l'onglet).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
type Obj = Record<string, unknown>;
const nombre = (v: unknown) => (v && typeof v === 'object' ? Number((v as Obj)['~n']) : Number(v));

describe('la trésorerie 1.298.0 : loyer pas noté, remise de chèques, frais, sans justificatif, téléphone', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-treso-1298-'));
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
    return (texte ? JSON.parse(texte) : {}) as Obj;
  };
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  // Le mois suivant, au même quantième (le 31 devient le dernier jour du mois) : la règle de « se répète ».
  const moisApres = (iso: string) => {
    const [a = 0, m = 1, j = 1] = iso.split('-').map(Number);
    const y = a + Math.floor(m / 12), mo = (m % 12) + 1, fin = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(j, fin)).padStart(2, '0')}`;
  };

  it('à la souris, du loyer oublié au relevé pointé, puis au téléphone', async () => {
    const email = `treso98-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Youssef Ben Salah', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const debutLoyer = jour(-40), occ = moisApres(debutLoyer);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'accounts', cle: 'a-biat', rang: 20, revision: null, contenu: { id: 'a-biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', opening: { '~n': '5000.25' }, openingDate: jour(-60), isDefault: true, statementBalance: '' } },
      ...[['c1', 'M. Karray'], ['c2', 'École Les Oliviers'], ['c3', 'Café Zitouna']].map(([id, name], i) => ({ collection: 'clients', cle: id, rang: 21 + i, revision: null, contenu: { id, name } })),
      { collection: 'movements', cle: 'm-loyer', rang: 25, revision: null, contenu: { id: 'm-loyer', date: debutLoyer, kind: 'autre-sortie', amount: { '~n': '1234.567' }, accountId: 'a-biat', label: 'Loyer de l\'atelier', reference: '', method: 'virement', repete: 'mois' } },
    ] });
    // Trois factures payées par chèque, déposés ensemble : 1 011,500 + 1 755,845 + 728,637 = 3 495,982 sur le relevé.
    const cheques: [string, string, number, string, string, number][] = [
      ['f1', 'c1', 850, '1011.5', 'CHQ 4410021', -8], ['f2', 'c2', 1475.5, '1755.845', 'CHQ 0091877', -7], ['f3', 'c3', 612.3, '728.637', 'CHQ 7733150', -6]];
    for (const [i, [id, client, ht, ttc, ref, quand]] of cheques.entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id, type: 'facture', number: '', status: 'brouillon', date: jour(-30), dueDate: jour(0), clientId: client, createdAt: 10 + i,
        subject: 'Menuiserie', lines: [{ label: 'Menuiserie bois', description: '', qty: 1, unit: '', unitPrice: Number.isInteger(ht) ? ht : { '~n': String(ht) }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', regimeTva: 'reel', payments: [] },
      client: { id: client, name: client }, revision: null, rang: 30 + i, netAPayer: Number(ttc).toFixed(3) });
      expect(String((e.contenu as Obj | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
      await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: id, rang: 30 + i, revision: Number(e.revision),
        contenu: { ...(e.contenu as Obj), payments: [{ id: `p-${id}`, date: jour(quand), amount: { '~n': ttc }, method: 'cheque', reference: ref, accountId: 'a-biat' }] } }] });
    }
    const objets = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; contenu: Obj }[]);
    const objet = async (collection: string, cle: string) => (await objets()).find((o) => o.collection === collection && o.cle === cle)?.contenu;

    const contexte = async (largeur: number, hauteur: number): Promise<BrowserContext> => {
      const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', acceptDownloads: true });
      await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
      await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
      return cx;
    };
    const cx = await contexte(1440, 900);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
    await p.locator('#tr-comptes .tr-compte').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);

    // 1. Ce qui arrive : le loyer du mois passé, jamais noté, est compté aujourd'hui, « déjà échue (le …) » ; l'export le dit.
    await p.locator('#t-tabs [data-tab="prevision"]').click();
    await p.locator('#t-prev').waitFor({ timeout: 10_000 });
    const echu = p.locator('#t-prev tbody tr', { hasText: `déjà échue (le ${fr(occ)})` });
    expect(net(await echu.innerText())).toMatch(new RegExp(`^${fr(jour(0)).replace(/\//g, '\\/')} déjà échue \\(le ${fr(occ).replace(/\//g, '\\/')}\\) Dépense qui revient Loyer de l'atelier − 1 234,567 DT `));
    const [telechargement] = await Promise.all([p.waitForEvent('download', { timeout: 10_000 }), p.locator('#exp-prev').click()]);
    expect(telechargement.suggestedFilename()).toMatch(/^prevision-\d{4}-\d\d-\d\d-\d+j\.csv$/);
    const csvPrev = fs.readFileSync(await telechargement.path(), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    expect(csvPrev[0]).toBe('Date;Origine;Pièce;Mouvement;Solde après;Note');
    // 5 000,250 − le loyer d'origine (déjà sorti) + les trois chèques − le loyer pas noté = 6 027,098.
    expect(csvPrev).toContain(`${fr(jour(0))};Dépense qui revient;Loyer de l'atelier;-1234,567;6027,098;déjà échue le ${fr(occ)}`);

    // 2. Où j'en suis : « À surveiller » le demande ; « Noter comme payé » ouvre le mouvement prérempli, à la date du loyer.
    await p.locator('#t-tabs [data-tab="position"]').click();
    const question = p.locator('#t-body li.tr-s-rep', { hasText: 'Loyer de l\'atelier' });
    expect(net(await question.locator('b').innerText())).toBe(`Loyer de l'atelier du ${fr(occ)} : 1 234,567 DT, pas encore noté`);
    await question.locator('[data-noter-rep]').click();
    const forme = p.locator('#modal-root .modal', { hasText: 'Nouveau mouvement' });
    await forme.waitFor({ timeout: 10_000 });
    expect(await forme.locator('[name=kind]').inputValue()).toBe('autre-sortie');
    await forme.locator('#ok').click();
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'movements' && o.contenu.repeteDe === 'm-loyer')
      .map((o) => [o.contenu.occurrence, o.contenu.date, nombre(o.contenu.amount), o.contenu.repete || '']), { timeout: 10_000 }).toEqual([[occ, occ, 1234.567, '']]);
    await expect.poll(() => p.locator('#t-body li.tr-s-rep').count(), { timeout: 5_000 }).toBe(0);
    await p.locator('#t-tabs [data-tab="prevision"]').click();
    await p.locator('#t-prev').waitFor({ timeout: 10_000 });
    expect(await p.locator('#t-prev tbody tr', { hasText: 'déjà échue' }).count()).toBe(0);

    // 3. Le relevé : le loyer d'origine se retrouve un pour un, la remise retrouve ses trois chèques, les frais sont absents.
    await p.locator('#t-tabs [data-tab="rapprochement"]').click();
    await p.locator('#t-import').waitFor({ timeout: 10_000 });
    const csv = path.join(dossier, 'releve.csv');
    fs.writeFileSync(csv, `Date;Libellé;Débit;Crédit\n${fr(debutLoyer)};VIR LOYER ATELIER;1 234,567;\n${fr(jour(-5))};REMISE CHEQUES 3 CHQ;;3 495,982\n`
      + `${fr(jour(-4))};FRAIS TENUE DE COMPTE;18,500;\n;Solde final;;7 243,165\n`);
    const [choix] = await Promise.all([p.waitForEvent('filechooser', { timeout: 8_000 }), p.locator('#t-import').click()]);
    await choix.setFiles(csv);
    const revue = p.locator('#modal-root .modal', { hasText: 'Le relevé de' });
    await revue.waitFor({ timeout: 10_000 });
    expect(net(await revue.locator('.tr-imp-res').first().innerText())).toBe('1 retrouvée dans SkanFact 1 remise en plusieurs mouvements 1 absente de SkanFact 1 mouvement de SkanFact pas sur ce relevé');
    const remise = revue.locator('#imp-remises tbody tr');
    expect(await remise.count()).toBe(1);
    expect(await remise.locator('.tr-imp-m').evaluateAll((l) => l.map((x) => (x as HTMLElement).innerText.replace(/\s+/g, ' ').trim().replace(/^.*?(\+ [\d\s,]+DT)$/, '$1')))).toEqual(['+ 1 011,500 DT', '+ 1 755,845 DT', '+ 728,637 DT']);
    expect(net(await remise.innerText())).toMatch(/REMISE CHEQUES 3 CHQ/);
    // Les frais créés depuis le relevé : la nature est devinée de leur libellé.
    await revue.locator('#imp-absentes [data-absente]').click();
    const frais = p.locator('#modal-root .modal', { hasText: 'Nouveau mouvement' });
    await frais.waitFor({ timeout: 10_000 });
    expect([await frais.locator('[name=kind]').inputValue(), await frais.locator('[name=label]').inputValue()]).toEqual(['banque', 'FRAIS TENUE DE COMPTE']);
    await frais.locator('#ok').click();
    await expect.poll(() => revue.locator('#imp-absentes [data-absente]').innerText(), { timeout: 10_000 }).toBe('Créé, pointé');
    expect(await revue.locator('#ok').innerText()).toBe('Pointer 4 mouvements');
    await revue.locator('#ok').click();
    await expect.poll(async () => Promise.all(['f1', 'f2', 'f3'].map(async (id) => ((await objet('documents', id))?.payments as Obj[] | undefined)?.[0]?.reconciled)), { timeout: 10_000 }).toEqual([true, true, true]);
    expect((await objet('movements', 'm-loyer'))?.reconciled).toBe(true);
    expect((await objets()).filter((o) => o.collection === 'movements' && o.contenu.label === 'FRAIS TENUE DE COMPTE').map((o) => [o.contenu.kind, nombre(o.contenu.amount), o.contenu.reconciled])).toEqual([['banque', 18.5, true]]);
    // L'état tombe juste (le loyer noté reste à débiter) ; sans comptable relié, rien ne propose de lui écrire.
    await expect.poll(async () => net(await p.locator('#t-body').innerText()), { timeout: 10_000 }).toMatch(/Écart 0,000 DT/);
    expect([await p.locator('#t-etat-csv').count(), await p.locator('#t-etat-compta').count()]).toEqual([1, 0]);

    // 4. Mouvements : « Sans justificatif » ne garde que les mouvements libres sans pièce, et le solde après ne se lit plus.
    await p.locator('#t-tabs [data-tab="mouvements"]').click();
    await p.locator('#t-sans-pj').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#t-sans-pj').innerText())).toBe('Sans justificatif 3');
    await p.locator('#t-sans-pj').click();
    await expect.poll(() => p.locator('#t-sans-pj').getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('true');
    const libelles = await p.locator('#t-body tbody tr:not(.tr-mois) td:nth-child(2)').evaluateAll((l) => l.map((x) => ((x as HTMLElement).innerText.split('\n')[0] ?? '').trim()).filter(Boolean));
    expect(libelles.sort()).toEqual(['FRAIS TENUE DE COMPTE', 'Loyer de l\'atelier', 'Loyer de l\'atelier']);
    expect(net(await p.locator('#t-body thead').innerText())).not.toMatch(/Solde après/i);
    await cx.close();

    // 5. Au téléphone : la liste des mouvements tient dans l'écran.
    const tel = await contexte(390, 844);
    const t = await tel.newPage();
    t.on('pageerror', (x) => erreurs.push(x.message));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
    await t.locator('#t-tabs [data-tab="mouvements"]').waitFor({ timeout: 20_000 });
    await t.locator('#t-tabs [data-tab="mouvements"]').click();
    await t.locator('#t-body tbody tr').first().waitFor({ timeout: 10_000 });
    const mesure = await t.evaluate(() => {
      const corps = document.querySelector('#t-body') as HTMLElement;
      const bord = corps.getBoundingClientRect().right + 1;
      return { corps: corps.scrollWidth - corps.clientWidth, cartes: [...corps.querySelectorAll('tbody tr')].filter((x) => x.getBoundingClientRect().right > bord).length };
    });
    expect(mesure).toEqual({ corps: 0, cartes: 0 });
    await tel.close();
    expect(erreurs).toEqual([]);
  }, 240_000);
});
