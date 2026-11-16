// 1.363.0 — bout en bout 30 (Nour, 16/11/2026) : les ventes par carte. La banque verse en UNE ligne les ventes par carte du
// jour, moins sa commission. À l'import du relevé, la ligne passait pour « pas dans SkanFact », et « Créer le mouvement »
// proposait une « Autre entrée » : les ventes comptées deux fois. Ici, à la souris : la ligne retrouve ses deux ventes, la
// commission (2,380 DT) s'enregistre en frais bancaires déjà pointée, l'écart tombe à zéro ; « Annuler » défait tout ; et le
// Cabinet reçoit l'écriture (627 / banque). Les ventes sont datées du jour du test : la règle ne dépend pas de la date.
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

describe('la remise de cartes 1.363.0 : la banque verse le net, la commission se note, le Cabinet la reçoit', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-carte-1363-'));
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


  it('la ligne nette du relevé retrouve les ventes par carte, note la commission, se défait, et arrive au Cabinet', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const youssef = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', youssef)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, youssef);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, youssef, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.corps.id)}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const fr = `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;
    await api('POST', `/entreprises/${ent}/dossier-v10`, youssef, { changements: [
      { collection: 'accounts', cle: 'a-biat', rang: 20, revision: null, contenu: { id: 'a-biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', opening: 0, openingDate: `${jour.slice(0, 4)}-01-01`, isDefault: true, statementBalance: '' } },
      { collection: 'clients', cle: 'c1', rang: 21, revision: null, contenu: { id: 'c1', name: 'Mme Gharbi' } },
      { collection: 'clients', cle: 'c2', rang: 22, revision: null, contenu: { id: 'c2', name: 'M. Ayari' } },
    ] });
    // Deux ventes payées par carte : 90 HT et 45 HT à 19 % = 107,100 et 53,550 ; ensemble 160,650.
    for (const [i, [id, client, ht, ttc]] of ([['f1', 'c1', 90, '107.1'], ['f2', 'c2', 45, '53.55']] as [string, string, number, string][]).entries()) {
      const e = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, youssef, { document: { id, type: 'facture', number: '', status: 'brouillon', date: jour, dueDate: jour, clientId: client, createdAt: 10 + i,
        subject: 'Coffrets', lines: [{ label: 'Coffret de chocolats', description: '', qty: 1, unit: '', unitPrice: ht, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', regimeTva: 'reel', payments: [] },
      client: { id: client, name: client }, revision: null, rang: 30 + i, netAPayer: Number(ttc).toFixed(3) })).corps;
      expect(String((e.contenu as Obj | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
      expect((await api('POST', `/entreprises/${ent}/dossier-v10`, youssef, { changements: [{ collection: 'documents', cle: id, rang: 30 + i, revision: Number(e.revision),
        contenu: { ...(e.contenu as Obj), payments: [{ id: `p-${id}`, date: jour, amount: { '~n': ttc }, method: 'carte', reference: '', accountId: 'a-biat' }] } }] })).statut).toBe(200);
    }
    const objets = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, youssef)).corps.objets as { collection: string; cle: string; contenu: Obj }[]);
    const commissions = async () => (await objets()).filter((o) => o.collection === 'movements').map((o) => o.contenu);
    const pointes = async () => (await objets()).filter((o) => o.collection === 'documents').map((o) => !!(o.contenu.payments as Obj[])[0]?.reconciled);

    const cx = await contexte(youssef);
    const e = await cx.newPage();
    const erreurs: string[] = [];
    e.on('pageerror', (x) => erreurs.push(x.message));
    await e.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
    await e.locator('#tr-comptes .tr-compte').first().waitFor({ timeout: 20_000 });
    await plusTard(e);
    await e.locator('#t-tabs [data-tab="rapprochement"]').click();
    await e.locator('#t-import').waitFor({ timeout: 10_000 });
    const csv = path.join(dossier, 'releve-tpe.csv');
    fs.writeFileSync(csv, `Date;Libellé;Débit;Crédit\n${fr};REMISE TPE 0042;;158,270\n;Solde final;;158,270\n`);
    const importer = async () => {
      const [choix] = await Promise.all([e.waitForEvent('filechooser', { timeout: 8_000 }), e.locator('#t-import').click()]);
      await choix.setFiles(csv);
      const revue = e.locator('#modal-root .modal', { hasText: 'Le relevé de' });
      await revue.waitFor({ timeout: 10_000 });
      return revue;
    };
    let revue = await importer();
    // La ligne n'est pas « absente » (la créer compterait les ventes deux fois) : elle porte ses deux ventes et sa commission.
    expect(await revue.locator('#imp-absentes').count()).toBe(0);
    expect(await revue.locator('#imp-cartes tbody tr').count()).toBe(1);
    const ligne = net(await revue.locator('#imp-cartes tbody tr').innerText());
    expect(ligne).toContain('REMISE TPE 0042');
    expect(ligne).toContain('2 ventes par carte : 160,650 DT');
    expect(ligne).toMatch(/− 2,380 DT \+ 158,270 DT$/);
    expect(net(await revue.locator('.tr-imp-res').innerText())).toMatch(/^1 retrouvée dans SkanFact 1 remise de cartes 0 absente de SkanFact/);
    expect(net(await revue.locator('#imp-cartes-dit').innerText())).toBe('La commission de la banque s\'enregistre en frais bancaires, déjà pointée : la ligne tombe juste, et l\'argent des ventes n\'est compté qu\'une fois.');
    expect(await revue.locator('#ok').innerText()).toBe('Pointer 2 mouvements et noter la commission');
    // Décochée, la remise ne pointe rien et ne note rien : il ne reste que le solde à recopier.
    await revue.locator('[data-carte]').uncheck();
    expect(await revue.locator('#ok').innerText()).toBe('Recopier le solde');
    await revue.locator('[data-carte]').check();
    await e.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'carte-1363-1-remise.png') });
    await revue.locator('#ok').click();
    await expect.poll(async () => net(await e.locator('#t-body').innerText()), { timeout: 10_000 }).toMatch(/Écart 0,000 DT/);
    expect(net(await e.locator('#toast').innerText())).toMatch(/^2 mouvements pointés depuis le relevé, 1 commission enregistrée en frais bancaires/);
    await expect.poll(commissions, { timeout: 15_000 }).toHaveLength(1);
    const [com] = await commissions();
    expect([com?.kind, Number((com?.amount as Obj)?.['~n'] ?? com?.amount), com?.date, com?.accountId, com?.reconciled, com?.label]).toEqual(['banque', 2.38, jour, 'a-biat', true, 'Commission carte — REMISE TPE 0042']);
    await expect.poll(pointes, { timeout: 15_000 }).toEqual([true, true]);

    // « Annuler » défait TOUT : les deux pointages et la commission.
    await e.locator('#toast button', { hasText: 'Annuler' }).click();
    await expect.poll(commissions, { timeout: 15_000 }).toEqual([]);
    await expect.poll(pointes, { timeout: 15_000 }).toEqual([false, false]);

    // Refait : c'est l'état que le Cabinet reçoit.
    revue = await importer();
    await revue.locator('#ok').click();
    await expect.poll(async () => net(await e.locator('#t-body').innerText()), { timeout: 10_000 }).toMatch(/Écart 0,000 DT/);
    await expect.poll(commissions, { timeout: 15_000 }).toHaveLength(1);

    // ── Le pont : au livre du cabinet, deux encaissements et la commission ; la banque fait la ligne du relevé.
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { journal: string; libelle: string; lignes: Ligne[] };
    const bq = async () => ((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, leila)).corps.ecritures as Ecriture[]).filter((x) => x.journal === 'BQ');
    await expect.poll(async () => (await bq()).map((x) => x.lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`).join(' | ')).sort(), { timeout: 20_000 }).toEqual([
      '532 107.100 0.000 | 411 0.000 107.100', '532 53.550 0.000 | 411 0.000 53.550', '627 2.380 0.000 | 532 0.000 2.380']);
    const banque = (await bq()).flatMap((x) => x.lignes).filter((l) => l.compte === '532').reduce((t, l) => t + Math.round(Number(l.debit) * 1000) - Math.round(Number(l.credit) * 1000), 0);
    expect(banque).toBe(158270);
    expect((await bq()).map((x) => x.libelle)).toContain('Commission carte — REMISE TPE 0042');

    expect(erreurs).toEqual([]);
    await cx.close();
  }, 150_000);
});
