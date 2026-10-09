// Le contrat émis seul, à l'écran (brique 129 ; docs/api-situation.md, S7). Nadia, propriétaire, coche « Émise seule »
// sur le contrat de la Menuiserie : la fiche du contrat le dit et ne propose plus de brouillon. Un contrat dont
// l'émission a été refusée par le serveur dit pourquoi. Sami, commercial, voit la case grisée.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import pg from 'pg';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const config = () => ({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, livreurMs: 60_000 });
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le contrat émis seul, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-contrats-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    // Le tour des contrats chaque demi-seconde : c'est le serveur qui émet, comme en service.
    serveur = await demarrer({ ...config(), web: dossier, contratsMs: 500 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  // Le tour des contrats parcourt toute la base : ceux de ce test n'y sont plus émis seuls après lui.
  const entreprises: string[] = [];
  afterAll(async () => {
    await admin.query(`update socle.dossier_v10 set contenu = contenu - 'emettreSeul' where collection = 'recurring' and entreprise = any($1)`, [entreprises]);
    await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true });
  });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (prenom: string) => {
    const email = `contrats-web-${prenom}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
    return { email, jeton: String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
  };
  const net = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
  const ouvrir = async (jeton: string, adresse: string, erreurs: string[]) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    // L'entreprise d'essai sert ici d'entreprise de travail (ses tiers d'essai, sans l'exemple de cinq ans) : elle s'ouvre
    // telle quelle, comme après « Ouvrir telle quelle » ; vide de pièces, elle partirait vers « On prépare l'exemple ».
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(adresse);
    return p;
  };

  it('la propriétaire coche « Émise seule » ; la fiche le dit, ne propose plus de brouillon, et dit un refus ; la case est grisée pour le commercial', async () => {
    const nadia = await personne('nadia');
    const ent = String((await api('POST', '/entreprises-essai', nadia.jeton)).corps.id);
    entreprises.push(ent);
    await api('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[];
    const client = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!client) throw new Error('client d\'exemple absent');
    const contrat = (id: string, clientId: string, plus: Record<string, unknown> = {}) => ({
      id, clientId, every: 'month', day: 5, nextDate: '2026-08-05', active: true, subject: 'Abonnement de la boutique — {mois}',
      lines: [{ label: 'Hébergement', description: '', qty: 1, unit: 'mois', unitPrice: 89, vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, notes: '', currency: 'DT', exchangeRate: '', createdAt: 1, ...plus,
    });
    const erreurs: string[] = [];
    // Sans contrat, la page ne promet plus que rien n'est jamais émis à ta place.
    const vide = await ouvrir(nadia.jeton, `${serveur.adresse}/v10/?e=${ent}#/contrats`, erreurs);
    await expect.poll(async () => net(await vide.locator('#view').innerText().catch(() => '')), { timeout: 20_000 })
      .toContain('Rien n\'est émis à ta place : un brouillon t\'attend. Sauf si tu le demandes : un contrat « Émise seule » voit SkanFact émettre ses factures à leur date.');
    await vide.context().close();
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: 'recurring', cle: 'r1', rang: 0, revision: null, contenu: contrat('r1', client.cle) },
      { collection: 'recurring', cle: 'r2', rang: 1, revision: null, contenu: contrat('r2', 'client-supprime', { emettreSeul: true, nextDate: '2026-09-01', day: 1 }) },
    ] })).statut).toBe(200);

    // Nadia : le contrat est à générer ; elle coche « Émise seule » dans « Modifier ».
    const p = await ouvrir(nadia.jeton, `${serveur.adresse}/v10/?e=${ent}#/contrat/r1`, erreurs);
    await p.locator('#c-edit').waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(await p.locator('#c-gen2').count()).toBe(1);
    // Le menu compte les contrats à générer : r1, pas r2 (émis seul, le serveur s'en charge).
    expect((await p.locator('#nav-contrats').innerText()).trim()).toBe('1');
    await p.locator('#c-edit').click();
    const caseSeule = p.locator('#modal-root input[name=emettreSeul]');
    expect(await caseSeule.isDisabled()).toBe(false);
    await caseSeule.check();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => net(await p.locator('#c-seul').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Émise seule : SkanFact émet chaque facture à sa date, avec son numéro. La prochaine : le 05/08/2026.');
    expect(await p.locator('#c-gen2').count()).toBe(0);
    await expect.poll(() => p.locator('#nav-contrats').isHidden(), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await admin.query(`select contenu->>'emettreSeul' v from socle.dossier_v10 where entreprise = $1 and collection = 'recurring' and cle = 'r1'`, [ent])).rows[0]?.v, { timeout: 10_000 }).toBe('true');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'contrat-seul.png') });

    // Le tour du serveur : r1 émet ses factures ; r2 (un client supprimé) est refusé, et sa fiche dit pourquoi.
    const contenu = async (cle: string) => (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'recurring' and cle = $2`, [ent, cle])).rows[0]?.contenu as Record<string, unknown>;
    await expect.poll(async () => (await contenu('r1')).lastIssued, { timeout: 15_000 }).toBeTruthy();
    await expect.poll(async () => (await contenu('r2')).refusServeur, { timeout: 15_000 }).toBeTruthy();
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/contrat/r2`);
    await p.reload();
    await expect.poll(async () => net(await p.locator('#c-refus').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^La facture du 01\/09\/2026 n'a pas pu être émise : .*client.* Corrige le contrat \(Modifier\) : SkanFact la retente dans l'heure\.$/i);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'contrat-refus.png') });
    // La liste : « émise seule », jamais « à générer » ; le filtre « À générer » les laisse au serveur.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/contrats`);
    const lignes = p.locator('#view tbody tr');
    await expect.poll(() => lignes.count(), { timeout: 15_000 }).toBe(2);
    for (const l of await lignes.all()) {
      expect(net(await l.innerText())).toContain('émise seule');
      expect(net(await l.innerText())).not.toContain('à générer');
    }
    await p.locator('select', { has: p.locator('option', { hasText: 'À générer' }) }).selectOption({ label: 'À générer' });
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 10_000 }).toContain('Aucun contrat ne correspond à ces filtres.');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/contrat/r2`);
    await p.reload();
    await p.locator('#c-edit').waitFor({ timeout: 15_000 });
    // Corrigé (son client), le refus s'efface : le serveur retente au tour suivant.
    await p.locator('#c-edit').click();
    await p.locator('#modal-root [data-combo=clientId] .combo-btn').click();
    await p.locator('#modal-root [data-combo=clientId] .combo-q').fill('Menuiserie');
    await p.locator('#modal-root [data-combo=clientId] .combo-list [role=option]').first().click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#c-refus').count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => (await admin.query(`select contenu ? 'refusServeur' v from socle.dossier_v10 where entreprise = $1 and collection = 'recurring' and cle = 'r2'`, [ent])).rows[0]?.v, { timeout: 10_000 }).toBe(false);
    await p.context().close();

    // Sami, commercial : la case est là, grisée, et dit à qui revient le choix.
    const sami = await personne('sami');
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: sami.email, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', sami.jeton, { jeton: inv })).statut).toBe(200);
    const q = await ouvrir(sami.jeton, `${serveur.adresse}/v10/?e=${ent}#/contrat/r1`, erreurs);
    await q.locator('#c-edit').waitFor({ timeout: 20_000 });
    await plusTard(q);
    await q.locator('#c-edit').click();
    expect(await q.locator('#modal-root input[name=emettreSeul]').isDisabled()).toBe(true);
    expect(net(await q.locator('#modal-root label.check', { has: q.locator('input[name=emettreSeul]') }).innerText())).toContain('(choix du propriétaire ou d\'un administrateur)');
    await q.context().close();

    // Un serveur qui redémarre fait son tour tout de suite (pas une heure plus tard) : le serveur arrêté, un contrat dû
    // de plus ; le serveur relancé, avec un tour par heure, l'émet dès son démarrage.
    await serveur.arreter();
    await admin.query(`insert into socle.dossier_v10 (entreprise, collection, cle, rang, contenu) values ($1, 'recurring', 'r3', 2, $2)`,
      [ent, JSON.stringify(contrat('r3', client.cle, { emettreSeul: true, nextDate: '2026-09-15', day: 15 }))]);
    serveur = await demarrer({ ...config(), web: dossier, contratsMs: 3_600_000 });
    await expect.poll(async () => (await admin.query(`select count(*)::int n from ventes.piece where entreprise = $1 and ref_v10 = 'contrat-r3-2026-09-15' and statut = 'emise'`, [ent])).rows[0].n, { timeout: 15_000 }).toBe(1);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
