// La réponse du client à un devis, telle que la maquette du devis (lot 5 de docs/maquettes-appliquees.md, 1.155.8) :
// « Le client a accepté ? » dit le devis, le total, quand et comment ; « … a refusé ? » garde son pourquoi. La frise et
// les envois redisent la réponse, et elle reste sur le devis après un rechargement. Tant qu'il n'a pas répondu, « Ce que
// le client a reçu » ; une fois accepté, « Transformer ▾ » propose les pièces qui suivent.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('la réponse du client à un devis, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-devis-reponse-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const jm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  it('accepter dit quand et comment, refuser garde son pourquoi ; la frise et les envois le redisent', async () => {
    const email = `ines-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Ines Gharbi', motDePasse: 'Un-bon-mot-de-passe' });
    const cle = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', cle, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', cle, { raisonSociale: 'Atelier Ennour' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, cle);
    const jour = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const plusTard = new Date(Date.now() + 20 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const devis = (id: string, numero: string) => ({ collection: 'documents', cle: id, rang: 0, revision: null, contenu: {
      id, type: 'devis', number: numero, date: jour, dueDate: plusTard, clientId: 'c1', subject: 'Échafaudage', status: 'envoyé',
      emails: [{ date: jour, to: 'compta@lac.exemple.tn', kind: 'devis' }],
      lines: [{ label: 'Location', description: '', qty: 3, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }], discountRate: 0, applyStamp: true,
      withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1 } });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, cle, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel du Lac', email: 'compta@lac.exemple.tn' } },
      devis('q1', 'DEV-2026-007'), devis('q2', 'DEV-2026-008'),
    ] })).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, cle);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async (pg: Page, id: string) => {
      await pg.goto('about:blank');
      await pg.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/${id}`);
      await pg.locator('#ed-frise').waitFor({ timeout: 20_000 });
      for (let i = 0; i < 3 && await pg.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await pg.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const etape = (pg: Page, n: number) => pg.locator('#ed-frise li').nth(n).innerText().then(net);

    // Tant qu'il n'a pas répondu : ce que le client a reçu (le timbre viendra sur la facture).
    await ouvrir(p, 'q1');
    expect(await p.locator('.ed-recu li').allInnerTexts()).toEqual([`Le PDF et le lien pour le lire, le ${jm(jour)}`, `Valable jusqu'au ${plusTard.split('-').reverse().join('/')}`, 'Sans timbre : il viendra sur la facture']);

    // Accepter : la fenêtre dit le devis et son total ; « Par e-mail » se choisit ; « Accepter seulement ».
    await p.locator('#accepter').click();
    const fen = p.locator('.modal').filter({ hasText: 'Le client a accepté ?' });
    await fen.waitFor();
    expect(net(await fen.locator('.ed-recap').innerText())).toContain('DEV-2026-007 · Hôtel du Lac');
    expect(net(await fen.locator('.ed-recap').innerText())).toContain('1 012,156 DT TTC · la facture fera 1 013,156 DT à payer');
    expect(await fen.locator('[data-comment="telephone"]').getAttribute('aria-pressed')).toBe('true');
    await fen.locator('[data-comment="email"]').click();
    expect(await fen.locator('[data-comment="email"]').getAttribute('aria-pressed')).toBe('true');
    await fen.getByRole('button', { name: 'Accepter seulement' }).click();
    await expect.poll(() => etape(p, 2), { timeout: 10_000 }).toMatch(new RegExp(`^Accepté ${jm(jour)} · par e-mail`));
    expect(net(await p.locator('.ed-envois').innerText())).toContain(`Réponse : accepté par e-mail le ${jm(jour)}, noté par Ines`);
    expect(await p.locator('.ed-recu').count()).toBe(0);

    // Elle reste sur le devis : un rechargement la redit.
    await p.waitForTimeout(1500);
    await ouvrir(p, 'q1');
    expect(await etape(p, 2)).toMatch(new RegExp(`^Accepté ${jm(jour)} · par e-mail`));

    // Accepté : « Transformer ▾ » ouvre les pièces qui suivent, chacune en brouillon.
    await p.locator('#ed-transformer').click();
    const menu = p.locator('.row-menu');
    await menu.waitFor();
    expect(await menu.locator('.rm-tete').innerText()).toBe('Transformer en… · chaque pièce arrive en brouillon');
    expect(await menu.getByRole('menuitem').count()).toBeGreaterThan(0);
    await p.keyboard.press('Escape');

    // Refuser : un pourquoi d'un clic ; la frise le dit, et « Facturé » n'attend plus rien.
    await ouvrir(p, 'q2');
    await p.locator('#refuser').click();
    const refus = p.locator('.modal').filter({ hasText: 'Le client a refusé ce devis ?' });
    await refus.waitFor();
    await refus.getByRole('button', { name: 'Reporté', exact: true }).click();
    expect(await refus.locator('#rep-motif').inputValue()).toBe('Reporté');
    await refus.locator('#rep-refus').click();
    await expect.poll(() => etape(p, 2), { timeout: 10_000 }).toMatch(new RegExp(`Refusé ${jm(jour)} · Reporté`));
    expect(await etape(p, 3)).toMatch(/rien à facturer/);
    expect(net(await p.locator('.ed-envois').innerText())).toContain(`Réponse : refusé le ${jm(jour)}, noté par Ines · « Reporté »`);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
