// « Le mois » de la paie, tel que sa maquette (1.222.0 ; docs/maquettes/paie.html ; docs/paie.md, « La paie appliquée »).
// (1.267.0) La paie refaite (docs/maquettes/paie-v2.html, 16 § 2.2) : trois vues, « Aujourd'hui », « Le mois » en quatre
// étapes, « L'équipe ». Quatre salariés, leurs bulletins du mois écoulé et ceux du mois d'avant. Ce que le parcours vérifie,
// écran ET serveur :
//   - la page s'ouvre sur « Aujourd'hui » : le mois écoulé pas fini se dit dans un bandeau, avec LE bouton vert de la page ;
//     « À ne pas oublier » nomme ce qui manque aux fiches (un RIB, un n° CNSS, un CDD qui finit), son geste ouvre la fiche
//     sur la bonne case ; la pastille de « L'équipe » compte ces choses-là, jamais l'effectif ;
//   - le bouton vert mène au mois et à son étape (« Payer ») ; les quatre étapes se déduisent des faits (établis, payés,
//     remis) ; l'en-tête porte le geste de l'étape ouverte, le corps n'en porte aucun ;
//   - « Bulletins » : trois chiffres (le net à verser et ses espèces, le coût, l'État), ceux qui changent d'abord, un statut
//     que tous partagent dit une fois, en bas ;
//   - « Remettre les bulletins » garde la remise sur chaque bulletin, au serveur ; « Annuler » la défait ;
//   - les avances vivent sous « L'équipe », les congés sous « Aujourd'hui », l'année dans la bande du mois.

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
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown;
};
const RIB = '08100123456789012359';

describe('la paie : le mois, tel que sa maquette', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paie-mois-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
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
  const encoder = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(encoder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encoder(x)])) : v);
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const espace = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  const montant = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/[\u00a0\u202f]/g, ' ');

  it('Aujourd\'hui et son bouton vert, les quatre étapes, « À ne pas oublier », trois chiffres, les bulletins qui changent d\'abord, remettre puis annuler', async () => {
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie du Port' })).corps.id);
    const poser = async (collection: string, cle: string, contenu: unknown) => (await api('POST', `/entreprises/${ent}/dossier-v10`, patron,
      { changements: [{ collection, cle, rang: null, revision: null, contenu: encoder(contenu) }] })).statut;
    // Le mois de la page : le mois écoulé ; le mois d'avant lui sert de comparaison.
    const auj = new Date();
    const annee = auj.getUTCMonth() === 0 ? auj.getUTCFullYear() - 1 : auj.getUTCFullYear(), mois = auj.getUTCMonth() === 0 ? 12 : auj.getUTCMonth();
    const anneeAvant = mois === 1 ? annee - 1 : annee, moisAvant = mois === 1 ? 12 : mois - 1;
    const finCdd = new Date(Date.UTC(auj.getUTCFullYear(), auj.getUTCMonth(), auj.getUTCDate() + 30)).toISOString().slice(0, 10);
    const salarie = (id: string, name: string, grossSalary: number, x: Record<string, unknown>) => ({ id, name, grossSalary, hireDate: '2024-03-10', contract: 'cdi',
      headOfFamily: false, children: 0, active: true, method: 'virement', iban: RIB, cnss: '12345678-12', position: 'Boulanger', ...x });
    const mourad = salarie('s1', 'Mourad Numéro Un', 1450, {});
    const karim = salarie('s2', 'Karim Sans Rib', 1100, { iban: '', cnss: '12345678-22' });
    const nadia = salarie('s3', 'Nadia Sans Cnss', 880, { cnss: '', method: 'especes', iban: '', position: 'Vendeuse' });
    // Chacun son n° CNSS et son RIB : deux fiches qui partagent l'un ou l'autre se signalent dans « À traiter » (1.248.1).
    const hamza = salarie('s4', 'Hamza En Cdd', 820, { contract: 'cdd', endDate: finCdd, position: 'Aide boulanger', cnss: '12345678-44', iban: '08100123456789012456' });
    const S = [mourad, karim, nadia, hamza];
    const bulletin = (e: (typeof S)[number], y: number, m: number, brut: number) => {
      const saisie = { gross: brut, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
      return { id: `p-${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})),
        paidDate: '', accountId: '', method: e.method, reference: '', issuedAt: `${y}-${String(m).padStart(2, '0')}-28` };
    };
    const ceMois = S.map((e) => bulletin(e, annee, mois, e.grossSalary));
    // Le mois d'avant : Mourad et Karim pareils, Nadia autrement (elle change), Hamza n'y est pas (premier bulletin).
    const avant = [bulletin(mourad, anneeAvant, moisAvant, 1450), bulletin(karim, anneeAvant, moisAvant, 1100), bulletin(nadia, anneeAvant, moisAvant, 820)]
      .map((b) => ({ ...b, paidDate: `${anneeAvant}-${String(moisAvant).padStart(2, '0')}-28`, remisLe: `${anneeAvant}-${String(moisAvant).padStart(2, '0')}-28` }));
    for (const e of S) expect(await poser('employees', e.id, e)).toBe(200);
    for (const b of [...ceMois, ...avant]) expect(await poser('payslips', b.id, b)).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, patron)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: '_racine', cle: 'company', rang: null,
      revision: fiche ? fiche.revision : null, contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Gérant Numéro Un', address: 'Rue du Port\n2000 Le Bardo' } }] })).statut).toBe(200);
    const netDu = (b: (typeof ceMois)[number]) => Number(b.computed.net);
    const totalNet = Math.round(ceMois.reduce((a, b) => a + netDu(b), 0) * 1000) / 1000;

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, patron);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    const texte = async (sel: string) => espace(await p.locator(sel).innerText());
    const nomMois = new Date(Date.UTC(annee, mois - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
    const deMois = /^[aeiouyéè]/i.test(nomMois) ? `d'${nomMois}` : `de ${nomMois}`;

    // ── (1.267.0) La page s'ouvre sur « Aujourd'hui » : le mois écoulé n'est pas fini (ses salaires attendent) ; son bandeau
    // le dit, avec LE bouton vert de la page ; la journée n'est pas verte ce jour-là ──────────────────────────────────────
    expect(await p.locator('#p-tabs [data-tab="pointage"]').getAttribute('aria-selected')).toBe('true');
    expect(await p.locator('#p-tabs [role=tab]').allInnerTexts()).toEqual([expect.stringMatching(/^Aujourd'hui/), expect.stringMatching(/^Le mois/), expect.stringMatching(/^L'équipe/), expect.stringMatching(/Réglages/)]);
    await expect.poll(() => p.locator('#pj-avant').count()).toBe(1);
    expect(await texte('#pj-avant b')).toBe(`${nomMois.charAt(0).toUpperCase()}${nomMois.slice(1)} n'est pas fini`);
    expect(await texte('#pj-avant-go')).toBe(`Payer les salaires ${deMois}`);
    expect(await p.locator('#p-page .btn-primary:visible').count()).toBe(1);
    expect(await p.locator('#p-mois').isHidden()).toBe(true);
    expect(await texte('#p-head .sous')).toContain('4 salariés · ');

    // ── « À ne pas oublier » (c'était « À traiter » sur « Le mois ») : ce qui manque aux fiches ; la pastille de « L'équipe »
    // compte ces choses-là ─────────────────────────────────────────────────────────────────────────────────────────────
    expect(await p.locator('#p-auj .pa-auj-d #p-traiter').count()).toBe(1);
    const traiter = await p.locator('#p-traiter li b').allInnerTexts();
    expect(traiter).toEqual(['Karim Sans Rib : RIB à demander', 'Nadia Sans Cnss : n° CNSS à demander', expect.stringMatching(/^Le CDD de Hamza En Cdd finit le \d{2}\/\d{2}\/\d{4}$/)]);
    expect(await p.locator('#p-tabs [data-af="salaries"]').innerText()).toBe('3');
    expect(await p.locator('#p-tabs [data-af="salaries"]').isHidden()).toBe(false);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-aujourdhui.png'), fullPage: true });
    // « Compléter » sur le RIB de Karim : sa fiche s'ouvre sur la case du RIB.
    await p.locator('#p-traiter li', { hasText: 'Karim Sans Rib' }).getByRole('button', { name: 'Compléter' }).click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('iban');
    await p.keyboard.press('Escape');

    // ── Le bouton vert mène au mois et à son étape : « Le mois » › Payer ; le vert est en haut, le corps n'en porte aucun ──
    await p.locator('#pj-avant-go').click();
    await expect.poll(() => p.locator('#p-payer').count()).toBe(1);
    expect(await p.locator('#p-tabs [data-tab="bulletins"]').getAttribute('aria-selected')).toBe('true');
    // (1.251.0) La bande des douze mois dit l'état de chacun : le mois écoulé a ses bulletins, aucun payé : « à payer ».
    // Le mois d'avant la paie dans SkanFact se tait (« — ») : la paie était tenue ailleurs, rien n'y est « à faire ».
    expect(await texte(`#p-mois [data-p-mois="${mois}"] small`)).toBe('à payer');
    expect(await p.locator(`#p-mois [data-p-mois="${mois}"]`).getAttribute('aria-pressed')).toBe('true');
    if (moisAvant > 1 && anneeAvant === annee) expect(await texte(`#p-mois [data-p-mois="${moisAvant - 1}"] small`)).toBe('—');
    expect(await p.locator('#p-payer').getAttribute('class')).toContain('btn-primary');
    expect(await texte('#p-payer')).toBe(`Payer les salaires · ${montant(totalNet)} DT`);
    expect(await p.locator('#p-body .btn-primary').count()).toBe(0);

    // ── Les quatre étapes : pointé, établis, payer (en cours, ouverte), déclarer ; chacune se lit dans les faits ──────────
    const etapes = async () => p.locator('#p-sous .pa-etape').evaluateAll((l) => l.map((x) => [(x as HTMLElement).dataset.etat, (x.querySelector('b')?.textContent || '')]));
    expect(await etapes()).toEqual([['fait', 'Pointer'], ['fait', 'Bulletins'], ['ici', 'Payer'], ['', 'Déclarer']]);
    expect(await p.locator('#p-sous .pa-etape.ouverte').getAttribute('data-sous')).toBe('payer');
    expect(await texte('#p-sous .pa-etape:nth-child(2)')).toContain('4 établis');
    expect(await texte('#p-sous .pa-etape:nth-child(3)')).toContain('4 à payer');
    // L'étape « Payer » : par virement (le RIB de Karim manque, son bouton), en espèces (Nadia), remettre ensuite.
    expect(await texte('#p-payer-vir')).toContain('Par virement · 3 salariés');
    expect(await texte('#p-payer-vir')).toContain('le RIB de Karim manque');
    expect(await p.locator('#p-payer-vir').getByRole('button', { name: 'Compléter le RIB' }).count()).toBe(1);
    expect(await texte('#p-payer-esp')).toContain('En espèces · 1 salarié');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-mois-payer.png'), fullPage: true });

    // ── L'étape « Bulletins » : les trois chiffres, ceux qui changent d'abord ; tout est établi, le vert est l'étape suivante ──
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await expect.poll(() => p.locator('#p-chiffres .tuile').count()).toBe(3);
    expect(await p.locator('#p-head .btn-primary').count()).toBe(1);
    expect(await texte('#p-head .btn-primary')).toBe(`Payer les salaires · ${montant(totalNet)} DT`);
    expect(await p.locator('#p-body .btn-primary').count()).toBe(0);
    expect(await texte('#p-chiffres .tuile:nth-child(1) .tu-t')).toMatch(/^Net à verser( |$)/);
    expect(await texte('#p-chiffres .tuile:nth-child(1) .tu-m')).toBe(`${montant(totalNet)} DT`);
    expect(await texte('#p-chiffres .tuile:nth-child(1) .tu-s')).toContain(`${montant(netDu(bulletin(nadia, annee, mois, nadia.grossSalary)))} DT en espèces`);
    const cout = Math.round(ceMois.reduce((a, b) => a + Number(b.computed.employerCost), 0) * 1000) / 1000;
    expect(await texte('#p-chiffres .tuile:nth-child(2) .tu-m')).toBe(`${montant(cout)} DT`);

    // ── Les bulletins : ceux qui changent d'abord ; le statut commun dit une fois, en bas ───────────────────────────────
    const groupes = await p.locator('#p-bulletins tr.pa-groupe').allInnerTexts();
    expect(groupes.map(espace)).toEqual(['Ce qui change ce mois 2 salariés', expect.stringMatching(/^Comme \S+ 2 salariés$/)]);
    const lignes = await p.locator('#p-bulletins tr[data-bul] td.cl b').allInnerTexts();
    expect(lignes).toEqual(['Hamza En Cdd', 'Nadia Sans Cnss', 'Karim Sans Rib', 'Mourad Numéro Un']);
    expect(await p.locator('#p-bulletins th', { hasText: 'Statut' }).count()).toBe(0);
    expect(await texte('#p-bulletins tfoot tr.pa-pied')).toContain('à payer');
    expect(await p.locator('#p-bulletins th', { hasText: 'Payé par' }).count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-mois.png'), fullPage: true });
    await p.evaluate(() => document.body.classList.add('dark'));
    await p.waitForTimeout(400); // les couleurs des boutons glissent (transition) : la photo attend qu'elles soient posées
    await p.screenshot({ path: path.join(PHOTOS, 'paie-mois-sombre.png'), fullPage: true });
    // En sombre, le texte de la page suit le thème : un nom de salarié se lit clair sur fond sombre (1.267.0 : il restait
    // de l'encre noire de la feuille A4, et les noms, les montants, les titres des étapes ne se voyaient plus).
    expect(await p.locator('#p-bulletins tr[data-bul] td.cl b').first().evaluate((e) => getComputedStyle(e).color)).toBe('rgb(230, 234, 240)');
    await p.evaluate(() => document.body.classList.remove('dark'));

    // ── Tous payés (au serveur) : le bandeau d'« Aujourd'hui » dit « Remettre les bulletins », et y mène ─────────────────
    const jour = `${annee}-${String(mois).padStart(2, '0')}-28`;
    const lus = await objets();
    for (const b of ceMois) {
      const o = lus.find((x) => x.collection === 'payslips' && x.cle === b.id);
      expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: 'payslips', cle: b.id, rang: null, revision: o?.revision ?? null, contenu: encoder({ ...b, paidDate: jour }) }] })).statut).toBe(200);
    }
    await p.reload();
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    await expect.poll(() => p.locator('#pj-avant-go').count(), { timeout: 15_000 }).toBe(1);
    expect(await texte('#pj-avant-go')).toBe(`Remettre les bulletins ${deMois}`);
    await p.locator('#pj-avant-go').click();
    await expect.poll(() => p.locator('#p-remettre').count(), { timeout: 15_000 }).toBe(1);
    // Tous payés : le mois n'est plus « à payer » dans la bande (il attend sa déclaration).
    expect(['à déclarer', 'en retard']).toContain(await texte(`#p-mois [data-p-mois="${mois}"] small`));
    expect(await texte('#p-remettre')).toBe('Remettre les 4 bulletins');
    expect(await etapes()).toEqual([['fait', 'Pointer'], ['fait', 'Bulletins'], ['ici', 'Payer'], ['', 'Déclarer']]);
    expect(await texte('#p-sous .pa-etape:nth-child(3)')).toContain('4 à remettre');
    await p.locator('#p-remettre').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toMatch(/^Remettre les 4 bulletins d/);
    await fenetre.locator('#rm-ok').click();
    const remis = async () => (await objets()).filter((o) => o.collection === 'payslips' && String(o.cle).endsWith(`-${annee}-${mois}`)).map((o) => o.contenu.remisLe).sort();
    await expect.poll(remis, { timeout: 15_000 }).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.anything(), expect.anything(), expect.anything()]);
    await expect.poll(() => p.locator('#p-remettre').count()).toBe(0);
    expect((await etapes())[2]).toEqual(['fait', 'Payer']);
    await p.locator('#toast-undo').click();
    await expect.poll(remis, { timeout: 15_000 }).toEqual([undefined, undefined, undefined, undefined]);
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    expect(await texte('#p-chiffres .tuile:nth-child(1) .tu-t')).toMatch(/^Net versé( |$)/); // tout est payé : le titre ne promet plus un versement

    // ── (1.256.0) Les avances vivent sous « L'équipe › Avances et prêts » ; (1.267.0) l'année, dans la bande du mois ───────
    await p.locator('#p-tabs [data-tab="salaries"]').click();
    await p.locator('#p-sous [data-sous="avances"]').click();
    await expect.poll(() => p.locator('#cg-avances').count()).toBe(1);
    expect(await p.locator('#p-sous [role=tab]').count()).toBe(2);
    expect(await p.locator('#cg-new-av').count()).toBe(1);
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#p-sous [data-sous="conges"]').click();
    await p.locator('#cg-cal').waitFor();
    // (1.250.0, recette du 02/11) Le calendrier des congés : ‹ › change le mois ; une case libre ouvre la fenêtre du congé
    // à ce jour et pour ce salarié (le jour et la personne déjà remplis).
    // (1.251.0) Le calendrier suit le mois de la bande.
    const titreCal = async () => (await p.locator('#cg-cal .pa-carte-t b').first().innerText()).trim();
    const avantNav = await titreCal(), moisCg = Number(await p.locator('#p-mois .cp-mo.on').getAttribute('data-p-mois'));
    await p.locator(`#p-mois [data-p-mois="${moisCg === 1 ? 2 : moisCg - 1}"]`).click();
    await expect.poll(titreCal).not.toBe(avantNav);
    await p.locator(`#p-mois [data-p-mois="${moisCg}"]`).click();
    await expect.poll(titreCal).toBe(avantNav);
    // (1.253.0) Le tableau des congés suit l'ordre du calendrier juste au-dessus : les noms, dans l'ordre alphabétique.
    const nomsCpt = (await p.locator('#p-compteurs tbody td.pa-cl b').allInnerTexts()).map(espace);
    expect(nomsCpt.length).toBeGreaterThan(2);
    expect(nomsCpt).toEqual([...nomsCpt].sort((a, b) => a.localeCompare(b, 'fr')));
    // Un jour qui n'est pas aujourd'hui : la fenêtre s'ouvre sur aujourd'hui quand on ne lui dit rien.
    const aujLocal = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const cle = (await p.locator('#cg-cal td.cg-libre button[data-cg-j^="s2|"]').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.cgJ || '')))
      .find((x) => !x.endsWith(`|${aujLocal}`)) || '';
    const libre = p.locator(`#cg-cal button[data-cg-j="${cle}"]`);
    const [qui, jourIso] = cle.split('|');
    await libre.click();
    const fenCg = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenCg.locator('h2').innerText()).toBe('Un congé ou une absence');
    expect([qui, await fenCg.locator('input[type=hidden][name=employeeId]').inputValue(),
      await fenCg.locator('input[type=hidden][name=from]').inputValue(), await fenCg.locator('input[type=hidden][name=to]').inputValue()])
      .toEqual(['s2', 's2', jourIso, jourIso]);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#lf').count()).toBe(0);
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    await p.locator('#p-mois [data-p-mois=""]').click();
    await expect.poll(() => p.locator('#p-annee-chiffres .pa-tuile').count()).toBe(4);
    expect(await p.locator('#p-annee .pa-barre').count()).toBe(12);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-annee.png'), fullPage: true });
    // (1.251.0, Skander le 02/11) Un tableau dans une carte n'a pas de second cadre collé au sien, et ses colonnes
    // s'alignent sur le titre de la carte (1.267.0 : lu sur L'année, puis sur les bulletins du mois).
    const cadreDouble = () => p.evaluate(() => [...document.querySelectorAll('.pa-carte table.list, .carte.tab table.list')].filter((t) => (t as HTMLElement).offsetParent)
      .map((t) => { const c = getComputedStyle(t), carte = t.closest('.pa-carte, .carte') as Element, titre = carte.querySelector('.pa-carte-t > b');
        const cel = t.querySelector('tbody tr > :first-child') as HTMLElement | null, r = document.createRange(); if (cel) r.selectNodeContents(cel);
        return { carte: carte.id, cadre: c.borderLeftWidth !== '0px' || c.boxShadow !== 'none', ecart: titre && cel ? Math.round(r.getBoundingClientRect().left - titre.getBoundingClientRect().left) : 0 }; }));
    await expect.poll(async () => (await cadreDouble()).length).toBeGreaterThan(0);
    expect((await cadreDouble()).filter((x) => x.cadre || Math.abs(x.ecart) > 2)).toEqual([]);
    await p.locator(`#p-mois [data-p-mois="${mois}"]`).click();
    await p.locator('#p-sous [data-sous="bulletins"]').click();
    await expect.poll(async () => (await cadreDouble()).filter((x) => x.carte !== 'p-annee').length).toBeGreaterThan(0);
    expect((await cadreDouble()).filter((x) => x.cadre || Math.abs(x.ecart) > 2)).toEqual([]);
    // Au téléphone, la page tient dans sa largeur (rien ne déborde à droite), et rien ne sort de sa carte ni ne se coupe
    // en « … » : la liste « À ne pas oublier » se lit en entier.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('#p-sous .pa-chemin').waitFor();
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#p-bulletins table.list[data-cartes] > tbody > tr').first().evaluate((x) => getComputedStyle(x).borderLeftWidth)).toBe('0px');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-mois-telephone.png'), fullPage: true });
    await p.locator('#p-tabs [data-tab="pointage"]').click();
    await p.locator('#p-traiter').waitFor();
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#p-traiter .apy-n b, #p-traiter .apy-n small').evaluateAll((l) => l.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent))).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-aujourdhui-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
