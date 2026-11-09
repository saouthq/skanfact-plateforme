// 1.327.0 — les Paramètres de l'entreprise, joués comme Sarra Mansour (Boulangerie El Amal) les joue : sa fiche remplie
// à la main (un matricule incomplet, une adresse sans « @ »), enregistrée en bas de page, puis un changement de régime
// fiscal alors que son cabinet fait ses déclarations — le pont : il le lui dit. Et la recherche des réglages au téléphone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { problemes } from '../instrument-rendu.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('Paramètres 1.327.0 : la fiche de l\'entreprise, et ce qui se dit à son cabinet', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-param-1327-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'parametres-1327.txt'), '');
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  const sansVisite = () => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); };
  // Un matricule tiré au sort (l'unicité des matricules actifs vaut pour toute la base de test).
  const matricule = () => `${1000000 + Math.floor(Math.random() * 8999999)}${'ABCDEFGHJKLMNPQRSTVWXYZ'[Math.floor(Math.random() * 23)]}/A/M/000`;


  it('Sarra règle sa fiche : le matricule et l\'e-mail se disent pendant la frappe, rien ne saute, et son régime se dit à son cabinet', async () => {
    const leila = await personne('leila'), sarra = await personne('sarra');
    const cab = (await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const r = await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal', matriculeFiscal: matricule() });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const ent = String(r.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);

    const erreurs: string[] = [];
    const cx = await contexte(sarra);
    await cx.addInitScript(sansVisite);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await p.locator('#pf input[name=matricule]').waitFor({ timeout: 25_000 });
    await plusTard(p);
    const note = (nom: string) => p.locator(`#pf .field:has(input[name=${nom}]) .rib-note`);

    // Le matricule incomplet se dit pendant la frappe, et la remarque RESTE (le refus de « Enregistrer » durait trois secondes).
    const mf = p.locator('#pf input[name=matricule]');
    await mf.click(); await p.keyboard.press('Control+a'); await p.keyboard.type('1472411D');
    expect(net(await note('matricule').innerText())).toBe('forme : 1234567A/A/M/000');
    expect(await mf.evaluate((e) => e.classList.contains('champ-doute'))).toBe(true);
    await p.keyboard.type('/A/M/000');
    expect(net(await note('matricule').innerText())).toBe('');
    // Une adresse sans « @ » s'imprimait sur chaque facture sans un mot.
    const em = p.locator('#pf input[name=email]');
    await em.click(); await p.keyboard.press('Control+a'); await p.keyboard.type('boulangerie.elamal');
    expect(net(await note('email').innerText())).toBe('pas une adresse e-mail');
    await p.keyboard.press('Control+a'); await p.keyboard.type('contact@elamal.tn');
    expect(net(await note('email').innerText())).toBe('');

    // En bas de page, « Enregistrer » ne fait rien descendre sous la souris : la barre se tait sans rendre sa place.
    await p.locator('#pf input[name=bank]').fill('BIAT');
    await p.locator('#view').evaluate((v) => { v.scrollTop = v.scrollHeight; });
    const titre = p.locator('section[data-pane="societe"] #p-banque h2').first();
    const y = async () => (await titre.boundingBox())?.y ?? Number.NaN;
    const avant = await y();
    await p.locator('#save-bar #save').click();
    await expect.poll(() => p.locator('#save-bar').isHidden(), { timeout: 10_000 }).toBe(true);
    expect(Math.abs(await y() - avant)).toBeLessThanOrEqual(1);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'parametres-1327-a-fiche.png') });

    // Envois : le cabinet tient le dossier — la phrase ne propose plus de le relier.
    await p.locator('#set-tabs [data-tab="envois"]').click();
    await expect.poll(async () => net(await p.locator('#email-comptable-note').innerText()), { timeout: 15_000 })
      .toBe('Ton cabinet tient déjà ton dossier sur SkanFact Cabinet (« Ton cabinet comptable », plus bas) : il voit tes pièces au fil de l\'eau, sans e-mail. Ce champ ne sert qu\'à « Envoyer au comptable » tes journaux à quelqu\'un d\'autre.');

    // Le régime : la remarque AVANT d'enregistrer, la proposition APRÈS, et le message prêt dans la conversation.
    await p.locator('#set-tabs [data-tab="societe"]').click();
    await p.locator('#pf select[name=taxRegime]').selectOption('forfaitaire');
    await expect.poll(async () => net(await p.locator('#regime-note').innerText())).toContain('Ton cabinet fait tes déclarations : ce régime change ce qu\'il dépose pour toi.');
    await p.locator('#save-bar #save').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Régime enregistré : Forfaitaire — non assujetti à la TVA. Ton cabinet fait tes déclarations. Le dire à mon comptable');
    expect(net(await p.locator('#regime-note').innerText())).not.toContain('Ton cabinet fait tes déclarations');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'parametres-1327-b-regime.png') });
    await p.locator('#toast-undo').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/comptable');
    const jour = new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' });
    await expect.poll(() => p.locator('[data-msg-texte]').first().inputValue(), { timeout: 15_000 })
      .toBe(`Bonjour, j'ai changé mon régime fiscal dans SkanFact le ${jour} : « Forfaitaire — non assujetti à la TVA » (avant : « Réel — assujetti à la TVA »). Mes prochaines factures suivent ce régime. Est-ce juste pour mes déclarations ?`);
    expect(erreurs).toEqual([]);
    await cx.close();

    // Au téléphone, la recherche des réglages prend sa rangée (elle s'arrêtait aux trois quarts, sa phrase coupée).
    const tel = await contexte(sarra, 390, 844);
    await tel.addInitScript(sansVisite);
    const t = await tel.newPage();
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await t.locator('#set-q').waitFor({ timeout: 25_000 });
    await plusTard(t);
    const [champ, rangee] = await t.locator('#set-q').evaluate((e) => [e.getBoundingClientRect().width, (e.parentElement ?? e).getBoundingClientRect().width]);
    expect(Math.round(champ)).toBe(Math.round(rangee));
    expect(await t.evaluate(problemes, [true, 390] as [boolean, number])).toEqual([]);
    await t.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'parametres-1327-c-telephone.png') });
    await tel.close();
  }, 180_000);
});
