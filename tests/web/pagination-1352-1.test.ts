// La pagination dans toutes les listes, suite (1.352.1 ; docs/revue-modules.md). Trois listes du Cabinet que la première
// mesure n'avait pas remplies : les onglets « Révision » et « Bilans » du tableau de bord (un cabinet de 163 dossiers les
// lisait d'un seul tenant, dix écrans), « Choisir une autre pièce en face » à la Banque (coupée à soixante écritures sans
// le dire, sous un titre qui en annonçait davantage) et les règles de la banque, qui s'accumulent pour tout le cabinet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la pagination, suite : le tableau de bord, la fenêtre de rapprochement, les règles de la banque (1.352.1)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-pagination2-'));
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

  const dt = (x: number) => `${Math.trunc(x / 1000)},${String(x % 1000).padStart(3, '0')}`;

  it('trente dossiers, trente écritures de banque, trente règles : le tableau de bord, « Choisir une autre pièce en face » et les règles se feuillettent', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ents: string[] = [];
    for (let k = 0; k < 30; k++) ents.push(String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: `Épicerie n° ${String(k + 1).padStart(2, '0')}` })).corps.entreprise));
    const ent = String(ents[0]);
    // « Bilans » suit l'exercice de l'an dernier : un seul dossier qui en a le livre suffit pour que les trente s'y lisent.
    const hier = new Date().getUTCFullYear() - 1;
    expect((await api('POST', `/entreprises/${ents[1]}/compta/exercices`, associe, { annee: hier, ouverture: [] })).statut).toBe(201);
    // Trente écritures au 532, chacune son montant (100 + k) : aucune ne porte les 77,000 de la ligne du relevé.
    const ids: string[] = [];
    for (let k = 0; k < 30; k++) {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `2026-09-${String(1 + (k % 28)).padStart(2, '0')}`, journal: 'BQ', piece: `BQ-${String(k + 1).padStart(3, '0')}`, libelle: `Encaissement n° ${k + 1}`,
        lignes: [{ compte: '532', debit: dt(100_000 + k * 1_000) }, { compte: '411', tiers: `Client n° ${k + 1}`, credit: dt(100_000 + k * 1_000) }] });
      expect(r.statut).toBe(201);
      ids.push(String(r.corps.id));
    }
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/releves`, associe, { annee: 2026, compte: '532', banque: 'BIAT', fichier: 'Releve_BIAT_09-2026.pdf', empreinte: 'cd'.repeat(32),
      soldeDebut: '5000,000', soldeFin: '5077,000', lignes: [{ date: '2026-09-15', libelle: 'VIR RECU DIVERS 0077', reference: '', montant: '77,000' }] })).statut).toBeLessThan(300);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const ouvrir = async (ancre: string, attendre: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/${ancre}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
      await p.locator(attendre).first().waitFor({ timeout: 15_000 });
    };
    const net = (t: string) => t.replace(/\s+/g, ' ').trim();
    const pied = (ou: string) => p.locator(`${ou} .pager span`).first().innerText().then(net);

    // ── Le tableau de bord : « Révision » et « Bilans » montrent une page, le pied « Le cabinet » reste entier ───
    await ouvrir('production', '[data-tb-vue="revision"]');
    await p.locator('[data-tb-vue="revision"]').click();
    await p.locator('#tb-revision tbody tr').first().waitFor();
    expect(await p.locator('#tb-revision tbody tr').count()).toBe(25);
    expect(await pied('#view')).toBe('1–25 sur 30 dossiers');
    expect(net(await p.locator('#tb-revision tfoot').innerText())).toContain('30 dossiers');
    await p.locator('#view #pg-next').click();
    await expect.poll(() => p.locator('#tb-revision tbody tr').count()).toBe(5);
    expect(await pied('#view')).toBe('26–30 sur 30 dossiers');
    expect(net(await p.locator('#tb-revision tfoot').innerText())).toContain('30 dossiers');
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-1-revision.png') });
    // Changer d'onglet repart de la première page : la page 2 de l'un n'est pas la page 2 de l'autre.
    await p.locator('[data-tb-vue="bilans"]').click();
    await p.locator('#tb-bilans tbody tr').first().waitFor();
    expect(await p.locator('#tb-bilans tbody tr').count()).toBe(25);
    expect(await pied('#view')).toBe('1–25 sur 30 dossiers');
    await p.locator('#view #pg-next').click();
    await expect.poll(() => p.locator('#tb-bilans tbody tr').count()).toBe(5);
    // Une recherche revient à la première page (sinon la page 2 d'une liste d'un dossier serait vide).
    await p.locator('#tb-q').fill('n° 07');
    await expect.poll(() => p.locator('#tb-bilans tbody tr').count()).toBe(1);

    // ── La banque : « Choisir une autre pièce en face » ne s'arrête plus à soixante sans le dire ─────
    await ouvrir(`dossier/${ent}/comptabilite/banque/2026`, '.bq-t [data-bq-ligne]');
    await p.locator('.bq-t [data-rowmenu^="LIG:"]').first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Choisir une autre pièce en face' }).click();
    const fen = p.locator('.modal').last();
    await fen.locator('#ce-autres tbody tr').first().waitFor();
    expect(net((await fen.locator('h3').last().textContent()) ?? '')).toBe('Les autres écritures du compte · 30 écritures');
    expect(await fen.locator('#ce-autres tbody tr').count()).toBe(25);
    expect(net(await fen.locator('#ce-autres .pager span').innerText())).toBe('1–25 sur 30');
    await fen.locator('#ce-autres [data-ce-pg]').last().click();
    await expect.poll(() => fen.locator('#ce-autres tbody tr').count()).toBe(5);
    expect(net(await fen.locator('#ce-autres .pager span').innerText())).toBe('26–30 sur 30');
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-1-en-face.png') });
    // Une écriture de la DEUXIÈME page se choisit : avant, elle n'aurait jamais paru au-delà de la soixantième.
    await fen.locator('#ce-autres [data-pick]').last().click();
    await expect.poll(() => p.locator('.modal').count()).toBe(0);
    // Un seul mouvement : la phrase s'accorde (« 1 mouvements sur 1 ont leur écriture » se lisait avant).
    await expect.poll(() => p.locator('#view').innerText().then(net)).toContain('1 mouvement sur 1 a son écriture.');

    // ── Les règles de la banque : trente règles, vingt-cinq par page, le rang d'une règle reste le sien ─
    const posees = await p.evaluate(async () => {
      const regles = Array.from({ length: 30 }, (_, k) => ({ motif: `PRLV ABONNEMENT ${String(k + 1).padStart(2, '0')}`, compte: '626', sens: 'debit' }));
      const e = await (window as unknown as { cabinet: { saveBanque: (o: unknown) => Promise<{ libelles?: unknown[] }> } }).cabinet.saveBanque({ libelles: regles });
      return (e.libelles ?? []).length;
    });
    expect(posees).toBe(30);
    await ouvrir(`dossier/${ent}/comptabilite/banque/2026`, `[data-rowmenu="F:${ent}"]`);
    await p.locator(`[data-rowmenu="F:${ent}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Les règles de la banque' }).click();
    await p.locator('.bqr-t tbody tr').first().waitFor();
    expect(await p.locator('.bqr-t tbody tr').count()).toBe(25);
    expect(await pied('.bqr-page')).toBe('1–25 sur 30 règles');
    await p.locator('.bqr-page #pg-next').click();
    await expect.poll(() => p.locator('.bqr-t tbody tr').count()).toBe(5);
    expect(await pied('.bqr-page')).toBe('26–30 sur 30 règles');
    // « Modifier » sur la première ligne de la page 2 ouvre la 26e règle, pas la première.
    const mot = net(await p.locator('.bqr-t tbody tr').first().locator('b.mono').innerText());
    await p.locator('.bqr-t tbody tr').first().locator('[data-bqr-modifier]').click();
    await expect.poll(() => p.locator('#bqr-motif').inputValue()).toBe(mot);
    await p.screenshot({ path: path.join(PHOTOS, 'pagination-1352-1-regles.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
