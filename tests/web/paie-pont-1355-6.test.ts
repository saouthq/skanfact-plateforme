// (1.355.6) Joué sur la boulangerie dont la paie est confiée au cabinet (docs/revue-modules.md, « 1.355.6 ») : la Paie de
// Sarra disait « Tu déclares toi-même » sous une mission qui confie la paie ; la déclaration du mois que le cabinet venait de
// déposer se proposait « Marquer déposée et payée », avec « Tu la déposes » ; et le Cabinet proposait de pointer payée, en
// vert, une déclaration dont le paiement de Sarra l'attendait déjà au brouillard.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la paie confiée au cabinet, et sa déclaration du mois, des deux côtés (1.355.6)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-pont-13556-'));
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
  // Ce que le point de contact envoie : un nombre non entier en texte exact (web/public/plateforme/pont.js).
  const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const page = async (jeton: string, erreurs: string[]) => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return p;
  };

  const plusTard = async (p: import('playwright-core').Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();

  it('l\'entreprise suit la mission, la déclaration déposée par le cabinet se paie sans se redéposer, et le Cabinet voit le paiement', async () => {
    const [aa, mm] = aujourdhui.slice(0, 7).split('-').map(Number) as [number, number];
    const y = mm === 1 ? aa - 1 : aa, m = mm === 1 ? 12 : mm - 1, ym = `${y}-${String(m).padStart(2, '0')}`;
    const fr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
    // Déposée par le cabinet un jour, payée par Sarra un autre, et aucun des deux aujourd'hui : chaque date dit d'où elle vient.
    const tot = Number(aujourdhui.slice(8, 10)) >= 3;
    const deposeLe = tot ? `${aujourdhui.slice(0, 8)}01` : `${ym}-27`, payeLe = tot ? `${aujourdhui.slice(0, 8)}02` : `${ym}-28`;
    const associe = await personne('associe');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps;
    const cabinet = String(cab.id);
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, patron, { codeCabinet: cab.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, associe, { annee: y, ouverture: [] })).statut).toBe(201);
    // La fiche posée (sans assistant), et AUCUN choix écrit de « qui fait la paie » : c'est la mission qui le dit.
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = objets.find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansouri', address: 'Rue de Marseille\n1000 Tunis' } }] })).statut).toBe(200);
    expect(((fiche ? fiche.contenu : {}) as Record<string, unknown>).paieMode).toBeUndefined();
    // Hédi, embauché le 1er du mois écoulé, son bulletin établi et payé : la déclaration de ce mois a quelque chose à verser.
    const ecran = ecranDeLaPlateforme('compta.js') as { computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, unknown>; baremesPaie: (r: unknown) => unknown };
    const hedi = { id: 's1', name: 'Hédi Mansouri', grossSalary: 1000, hireDate: `${ym}-01`, contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'especes', iban: '', cnss: '', primes: [] };
    const saisie = { gross: 1000, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
    const bul = { id: 'b-s1', employeeId: 's1', year: y, month: m, ...saisie, computed: ecran.computePayslip(hedi, saisie, ecran.baremesPaie({})), paidDate: aujourdhui, accountId: '', method: 'especes', reference: '', issuedAt: aujourdhui };
    const client = async (changements: { collection: string; cle: string; contenu: unknown }[]) => (await api('POST', `/entreprises/${ent}/dossier-v10`, patron,
      { changements: changements.map((c) => ({ ...c, rang: null, revision: null, contenu: encoder(c.contenu) })) })).statut;
    expect(await client([{ collection: 'employees', cle: 's1', contenu: hedi }])).toBe(200);
    expect(await client([{ collection: 'payslips', cle: 'b-s1', contenu: bul }])).toBe(200);
    // Le cabinet dépose la déclaration du mois (le chemin de « Déclaré hors livre » : son montant, puis « déposée »).
    expect((await api('PUT', `/entreprises/${ent}/compta/declarations/${ym}`, associe, { cases: { aDecaisser: '93,496' } })).statut).toBeLessThan(300);
    expect((await api('POST', `/entreprises/${ent}/compta/declarations/${ym}/pointer`, associe, { quoi: 'deposee', le: deposeLe })).statut).toBeLessThan(300);

    // 1. La Paie de Sarra : « tenue par ton cabinet », jamais « Tu déclares toi-même ».
    const erreurs: string[] = [];
    const p = await page(patron, erreurs);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(espace(await p.locator('#view').innerText())).toContain('tenue par ton cabinet');
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    await p.locator(`#p-mois [data-p-mois="${m}"]`).click();
    await p.locator('#p-sous .pa-etape[data-sous="declarations"]').click();
    await p.locator('#dc-verses').waitFor({ timeout: 15_000 });
    const corps = espace(await p.locator('#p-body').innerText());
    expect(corps).toContain('Tes déclarations de paie sont faites par ton cabinet');
    expect(corps).not.toContain('Tu déclares toi-même');
    // Un trimestre où Hédi n'était pas encore là n'a rien à verser : pas de « la paie était tenue ailleurs ? ».
    expect(corps).not.toContain('la paie était tenue ailleurs');
    // La part paie d'un seul bulletin parle au singulier, et le mois s'élide comme ailleurs.
    expect(espace(await p.locator('#dm-panneau .pa-carte-t').innerText())).toContain('ce que le bulletin y ajoute');
    expect(espace(await p.locator('#dm-panneau .pa-note-c').innerText())).toMatch(new RegExp(`^Le bulletin (d'|de )${MOIS[m - 1]} ${y}, à reporter`));
    // 2. La déclaration que le cabinet a déposée : « il te reste à la verser », et le geste est « Marquer payée… ».
    const ligne = p.locator('#dc-verses li').first();
    await expect.poll(async () => espace(await ligne.innerText()), { timeout: 15_000 }).toContain(`déposée le ${fr(deposeLe)} par ton cabinet · il te reste à la verser`);
    expect(espace(await ligne.locator('button').innerText())).toBe('Marquer payée…');
    await ligne.locator('button').click();
    await p.locator('#pd-ok').waitFor({ timeout: 10_000 });
    expect(espace(await p.locator('.modal').last().innerText())).toMatch(new RegExp(`Ton cabinet l.a déposée le ${fr(deposeLe).replace(/\//g, '\\/')} : il te reste à la payer`));
    expect(espace(await p.locator('#pd-ok').innerText())).toBe('Noter payée');
    await p.locator('#pd .datefield .d-txt').first().fill(fr(payeLe));
    await p.locator('#pd .datefield .d-txt').first().press('Tab');
    await p.locator('#pd-ok').click();
    await expect.poll(async () => espace(await ligne.innerText()), { timeout: 15_000 }).toContain(`déposée le ${fr(deposeLe)} par ton cabinet`);
    expect(espace(await ligne.innerText())).toContain(`payée le ${fr(payeLe)}`);
    expect(espace(await ligne.locator('button').innerText())).toBe('Retirer le paiement…');
    // La frise dit ce qui est fait ; la mention garde le dépôt du cabinet.
    expect(espace(await p.locator('#p-sous .pa-etape[data-sous="declarations"]').innerText())).toContain(`la retenue payée le ${fr(payeLe)}`);
    const lus = (await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[];
    const mention = lus.find((o) => o.collection === 'socialFilings' && o.cle === `dm-${ym}`);
    expect(mention && mention.contenu.parCabinet).toBe(true);
    expect(mention && mention.contenu.filedAt).toBe(deposeLe);

    // 3. Le Cabinet : le paiement de Sarra est dit sur l'étape, et « Marquer payée » prend sa date.
    const q = await page(associe, erreurs);
    await q.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/declaration`);
    await q.locator('#dc-mois').waitFor({ timeout: 20_000 });
    await plusTard(q);
    await q.locator('#dc-mois').selectOption(ym);
    await expect.poll(async () => espace(await q.locator('#dc-client-paye').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(new RegExp(`a payé la part paie le ${fr(payeLe).replace(/\//g, '\\/')} : .+ — son paiement attend au brouillard de la banque`));
    await q.locator('#dc-payee').click();
    await expect.poll(async () => espace(await q.locator('#dc-payee').innerText()), { timeout: 15_000 }).toContain(`Payée le ${fr(payeLe)}`);
    // L'en-tête suit le geste : annuler le dépôt (et avec lui le paiement) le fait redire « à déposer », sans recharger.
    // (Le reposer depuis l'écran attend ici l'écriture de paie encore au brouillard : « un mois déposé ne bouge plus ».)
    const nom = MOIS[m - 1] as string;
    expect(espace(await q.locator('#d-etat').innerText())).not.toContain(nom);
    await q.locator('#dc-deposee').click();
    await expect.poll(async () => espace(await q.locator('#d-etat').innerText()), { timeout: 15_000 }).toContain(nom);
    expect(erreurs).toEqual([]);
  }, 240_000);
});
