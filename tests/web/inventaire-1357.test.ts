// 1.357.5 — l'inventaire de fin de mois d'une boulangerie, joué à la souris puis au Cabinet (bout en bout 14) : la farine
// n'est pas notée à chaque fournée, on compte les sacs qui restent.
//   - la question avant d'enregistrer dit, article par article, ce qui change et combien (« Farine : 22 → 15 sac (−7),
//     − 294,000 DT au coût moyen »), ce que ça fait (ce qui manque compte dans le coût du mois, ce qui est en plus revient
//     au stock), et son bouton n'est pas rouge : le geste se corrige, il ne détruit rien ;
//   - « Prévenir mon comptable » NOMME les écarts, un par ligne ;
//   - au Cabinet, un état daté avant la fin de l'exercice n'est plus proposé en vert comme l'inventaire de l'année : l'écran
//     dit que l'inventaire se prend sur l'état au 31/12, et propose de le demander ; demandé, il le dit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('l\'inventaire de fin de mois d\'une boulangerie, et le pont (1.357.5)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-inventaire-1357-'));
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
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('(1.357.5) la farine comptée en fin de mois : la question dit combien, le message nomme l\'écart, et l\'état de mi-mois n\'est pas l\'inventaire de l\'année', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi Conseil' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const annee = auj.slice(0, 4);
    const fr = (j: string) => j.split('-').reverse().join('/');
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null,
        contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansouri', name: 'Boulangerie Ezzahra', city: 'Ezzahra', activity: 'commerce' } },
      // La farine et la levure, suivies en stock depuis le 2 janvier ; un loyer, pour que son livre existe au Cabinet.
      { collection: 'catalog', cle: 'far', rang: 0, revision: null, contenu: enc({ id: 'far', label: 'Farine', unit: 'sac', unitPrice: 0, vatRate: 7, tracked: true, initialQty: 22, initialCost: 42, initialDate: `${annee}-01-02` }) },
      { collection: 'catalog', cle: 'lev', rang: 1, revision: null, contenu: enc({ id: 'lev', label: 'Levure fraîche', unit: 'kg', unitPrice: 0, vatRate: 19, tracked: true, initialQty: 5, initialCost: 12, initialDate: `${annee}-01-02` }) },
      { collection: 'suppliers', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', name: 'Immobilière Ezzahra' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: enc({ id: 'p1', kind: 'facture', number: 'LOY-1101', date: `${annee}-${auj.slice(5, 7)}-01`, dueDate: auj, supplierId: 'f1', currency: 'DT',
        createdAt: Date.now(), payments: [], lines: [{ label: 'Loyer du local', qty: 1, unitPrice: 900, vatRate: 19, destination: 'charge', deductible: true }] }) },
    ] })).statut).toBe(200);
    const erreurs: string[] = [];
    const lignes = (t: string) => t.split('\n').map(net).filter(Boolean);

    // A. Chez la boulangerie : elle compte 15 sacs de farine (22 attendus) et 6 kg de levure (5 attendus).
    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(`entreprise : ${e.message}`));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p.locator('#st-tabs button[data-tab="inventaire"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#st-tabs button[data-tab="inventaire"]').click();
    await p.locator('#st-body .inv-in[data-iid="far"]').fill('15');
    await p.locator('#st-body .inv-in[data-iid="lev"]').fill('6');
    await p.locator('#inv-apply').click();
    // La question dit CE QUI change et combien, et ce que ça fait ; son bouton n'est pas celui d'une suppression.
    const q = p.locator('#modal-root .modal').last();
    await q.locator('#ok').waitFor({ timeout: 10_000 });
    expect(net(await q.locator('h2').innerText())).toBe(`Enregistrer l'inventaire du ${fr(auj)} ?`);
    const corps = lignes(await q.locator('p').innerText());
    expect(corps.slice(0, 2).sort()).toEqual(['Farine : 22 → 15 sac (−7), − 294,000 DT au coût moyen', 'Levure fraîche : 5 → 6 kg (+1), + 12,000 DT au coût moyen']);
    expect(corps.slice(2)).toEqual(['Le stock de l\'application devient ce que tu as compté ; ce qui manque compte comme utilisé ou perdu : sa valeur entre dans ce que t\'a coûté le mois ; '
      + 'ce qui est en plus revient dans le stock. Un mouvement d\'inventaire se corrige comme n\'importe quel ajustement.']);
    expect(await q.locator('#ok').getAttribute('class')).toContain('btn-primary');
    expect(await q.locator('#ok').getAttribute('class')).not.toContain('btn-danger');
    await q.locator('#ok').click();
    await p.locator('#inv-fait').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#inv-fait p').innerText())).toMatch(/^Inventaire du \d\d\/\d\d\/\d{4} enregistré : 2 articles comptés, 2 écarts pour − 282,000 DT au coût moyen\./);

    // B. « Prévenir mon comptable » : le message nomme les écarts, un par ligne, et l'état du stock part avec lui.
    await p.locator('#inv-prevenir').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/comptable');
    const zone = p.locator('#msg-racine textarea').first();
    await expect.poll(async () => lignes(await zone.inputValue()).length, { timeout: 10_000 }).toBe(4);
    const msg = lignes(await zone.inputValue());
    expect(msg[0]).toBe(`Bonjour, j'ai fait l'inventaire du stock au ${fr(auj)} : 2 articles comptés, 2 écarts, soit 282,000 DT en moins au coût moyen.`);
    expect(msg.slice(1, 3).sort()).toEqual(['- Farine : 22 → 15 sac (−7), − 294,000 DT', '- Levure fraîche : 5 → 6 kg (+1), + 12,000 DT']);
    expect(msg[3]).toBe(`Les mouvements d'inventaire sont enregistrés dans SkanFact, et l'état du stock au ${fr(auj)} est envoyé : 2 articles, 702,000 DT au coût moyen, à reprendre dans l'inventaire.`);
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await cx.close();

    // C. Au Cabinet : l'état arrive (deux chemins, un chiffre : 702,000 = 15 × 42 + 6 × 12). Daté d'avant la fin de
    // l'exercice, il n'est pas l'inventaire de l'année : l'écran le dit, le reprendre n'est plus vert, et la demande de
    // l'état au 31/12 est à côté ; demandée, la ligne le dit.
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/inventaire/${annee}`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#iv-client').waitFor({ timeout: 20_000 });
    expect(net(await c.locator('#iv-client p').first().innerText())).toMatch(new RegExp(`^Au ${fr(auj)} : 2 articles, 702,000 DT au coût moyen de son SkanFact`));
    if (auj < `${annee}-12-31`) {
      expect(net(await c.locator('#iv-client-avant').innerText())).toBe(`C'est l'état du ${fr(auj)}, pas celui de la fin de l'exercice (31/12/${annee}) : le stock bougera d'ici là. `
        + `L'inventaire de ${annee} se prend sur l'état au 31/12/${annee}, qu'il t'enverra une fois l'année finie.`);
      expect(await c.locator('#iv-reprendre-client').getAttribute('class')).not.toContain('btn-primary');
      expect(net(await c.locator('#iv-demander-b').innerText())).toBe(`Lui demander son état au 31/12/${annee}…`);
      expect(await c.locator('#iv-demander-b').getAttribute('class')).not.toContain('btn-primary');
      await c.locator('#iv-demander-b').click();
      const dm = c.locator('#modal-root .modal').last();
      await dm.locator('#dm-texte').waitFor({ timeout: 10_000 });
      expect(net(await dm.locator('#dm-texte').inputValue())).toContain(`peux-tu m'envoyer l'état de ton stock au 31/12/${annee}, une fois l'année finie`);
      await dm.locator('#ok').click();
      await expect.poll(() => toast(c)).toContain('Demande envoyée');
      await expect.poll(async () => net(await c.locator('#iv-client-avant').innerText().catch(() => '')), { timeout: 15_000 })
        .toBe(`C'est l'état du ${fr(auj)}, pas celui de la fin de l'exercice (31/12/${annee}) : le stock bougera d'ici là. L'inventaire de ${annee} se prend sur l'état au 31/12/${annee} — demandé le ${fr(auj)}.`);
      expect(await c.locator('#iv-demander-b').count()).toBe(0);
    } else {
      expect(await c.locator('#iv-client-avant').count()).toBe(0);
      expect(await c.locator('#iv-reprendre-client').getAttribute('class')).toContain('btn-primary');
    }
    await c.screenshot({ path: path.join(PHOTOS, 'inventaire-1357-cabinet.png'), fullPage: true });
    await cxC.close();
    expect(erreurs).toEqual([]);
  }, 300_000);
});
