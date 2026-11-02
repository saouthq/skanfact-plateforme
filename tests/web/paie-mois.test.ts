// « Le mois » de la paie, tel que sa maquette (1.222.0 ; docs/maquettes/paie.html ; docs/paie.md, « La paie appliquée »).
// Quatre salariés, leurs bulletins du mois et ceux du mois d'avant. Ce que le parcours vérifie, écran ET serveur :
//   - l'en-tête porte UN geste principal, calculé : payer (puis remettre) ; le corps n'en porte aucun ;
//   - la frise déduit chaque étape des faits (établis, payés, remis) ; « À traiter » nomme ce qui manque aux fiches
//     (un RIB, un n° CNSS, un CDD qui finit), et son geste ouvre la fiche sur la bonne case ; la pastille de « Salariés »
//     compte ces choses-là, jamais l'effectif ;
//   - trois chiffres : le net à verser (et ses espèces), le coût, ce qui va à l'État ;
//   - les bulletins qui changent d'abord ; un statut que tous partagent se dit une fois, en bas ;
//   - « Remettre les bulletins » garde la remise sur chaque bulletin, au serveur ; « Annuler » la défait ;
//   - les avances vivent sous « Congés et absences » (une carte sous les congés), les chiffres de l'année dans « L'année ».

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

  it('le geste suivant, la frise, « À traiter », trois chiffres, les bulletins qui changent d\'abord, remettre puis annuler', async () => {
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
    for (let i = 0; i < 6 && Number(await p.locator('#p-an').innerText()) !== Number(annee); i++) await p.locator(Number(await p.locator('#p-an').innerText()) > Number(annee) ? '#p-an-prec' : '#p-an-suiv').click();
    await p.locator(`#p-mois [data-p-mois="${mois}"]`).click();
    const texte = async (sel: string) => espace(await p.locator(sel).innerText());
    // (1.251.0) La bande des douze mois dit l'état de chacun : le mois écoulé a ses bulletins, aucun payé : « à payer ».
    // Le mois d'avant la paie dans SkanFact se tait (« — ») : la paie était tenue ailleurs, rien n'y est « à faire ».
    expect(await texte(`#p-mois [data-p-mois="${mois}"] small`)).toBe('à payer');
    expect(await p.locator(`#p-mois [data-p-mois="${mois}"]`).getAttribute('aria-pressed')).toBe('true');
    if (moisAvant > 1 && anneeAvant === annee) expect(await texte(`#p-mois [data-p-mois="${moisAvant - 1}"] small`)).toBe('—');

    // ── L'en-tête : un seul geste principal, « Payer les salaires · total » ; le corps n'en porte aucun ────────────────
    await expect.poll(() => p.locator('#p-payer').count()).toBe(1);
    expect(await p.locator('#p-payer').getAttribute('class')).toContain('btn-primary');
    expect(await texte('#p-payer')).toBe(`Payer les salaires · ${montant(totalNet)} DT`);
    expect(await p.locator('#p-body .btn-primary').count()).toBe(0);
    expect(await texte('#p-head .sous')).toContain('4 salariés · ');

    // ── La frise : établis, puis payer (ici), puis remettre ; chaque étape se lit dans les faits ───────────────────────
    const etapes = async () => p.locator('#p-frise li').evaluateAll((l) => l.map((x) => [x.className, (x.querySelector('b')?.textContent || '')]));
    expect(await etapes()).toEqual([['fait', 'Pointer'], ['fait', 'Bulletins'], ['ici', 'Payer'], ['', 'Remettre'], ['', 'Déclarer']]);
    expect(await texte('#p-frise li:nth-child(2)')).toContain('4 établis');
    expect(await texte('#p-frise li:nth-child(3)')).toContain('4 à payer');

    // ── « À traiter » : ce qui manque aux fiches ; la pastille de « Salariés » compte ces choses-là ──────────────────
    const traiter = await p.locator('#p-traiter li b').allInnerTexts();
    expect(traiter).toEqual(['Karim Sans Rib : RIB à demander', 'Nadia Sans Cnss : n° CNSS à demander', expect.stringMatching(/^Le CDD de Hamza En Cdd finit le \d{2}\/\d{2}\/\d{4}$/)]);
    expect(await p.locator('#p-tabs [data-af="salaries"]').innerText()).toBe('3');
    expect(await p.locator('#p-tabs [data-af="salaries"]').isHidden()).toBe(false);

    // ── Les trois chiffres : le net (et ses espèces), le coût, l'État ─────────────────────────────────────────────────
    expect(await p.locator('#p-chiffres .pa-tuile').count()).toBe(3);
    expect(await texte('#p-chiffres .pa-tuile:nth-child(1) .t')).toMatch(/^Net à verser( |$)/);
    expect(await texte('#p-chiffres .pa-tuile:nth-child(1) .m')).toBe(`${montant(totalNet)} DT`);
    expect(await texte('#p-chiffres .pa-tuile:nth-child(1) .s')).toContain(`${montant(netDu(bulletin(nadia, annee, mois, nadia.grossSalary)))} DT en espèces`);
    const cout = Math.round(ceMois.reduce((a, b) => a + Number(b.computed.employerCost), 0) * 1000) / 1000;
    expect(await texte('#p-chiffres .pa-tuile:nth-child(2) .m')).toBe(`${montant(cout)} DT`);

    // ── Les bulletins : ceux qui changent d'abord ; le statut commun dit une fois, en bas ───────────────────────────────
    const groupes = await p.locator('#p-bulletins tr.pa-groupe').allInnerTexts();
    expect(groupes.map(espace)).toEqual(['Ce qui change ce mois · 2 salariés', expect.stringMatching(/^Comme \S+ · 2 salariés$/)]);
    const lignes = await p.locator('#p-bulletins tr[data-bul] td.pa-cl b').allInnerTexts();
    expect(lignes).toEqual(['Hamza En Cdd', 'Nadia Sans Cnss', 'Karim Sans Rib', 'Mourad Numéro Un']);
    expect(await p.locator('#p-bulletins th', { hasText: 'Statut' }).count()).toBe(0);
    expect(await texte('#p-bulletins tr.total-row')).toContain('à payer');
    expect(await p.locator('#p-bulletins th', { hasText: 'Payé par' }).count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-mois.png'), fullPage: true });
    await p.evaluate(() => document.body.classList.add('dark'));
    await p.waitForTimeout(400); // les couleurs des boutons glissent (transition) : la photo attend qu'elles soient posées
    await p.screenshot({ path: path.join(PHOTOS, 'paie-mois-sombre.png'), fullPage: true });
    await p.evaluate(() => document.body.classList.remove('dark'));

    // ── « Compléter » sur le RIB de Karim : sa fiche s'ouvre sur la case du RIB ──────────────────────────────────────
    await p.locator('#p-traiter li', { hasText: 'Karim Sans Rib' }).getByRole('button', { name: 'Compléter' }).click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('iban');
    await p.keyboard.press('Escape');

    // ── Tous payés (au serveur) : l'étape suivante devient « Remettre les 4 bulletins » ───────────────────────────────
    const jour = `${annee}-${String(mois).padStart(2, '0')}-28`;
    const lus = await objets();
    for (const b of ceMois) {
      const o = lus.find((x) => x.collection === 'payslips' && x.cle === b.id);
      expect((await api('POST', `/entreprises/${ent}/dossier-v10`, patron, { changements: [{ collection: 'payslips', cle: b.id, rang: null, revision: o?.revision ?? null, contenu: encoder({ ...b, paidDate: jour }) }] })).statut).toBe(200);
    }
    await p.reload();
    await p.locator('#p-tabs').waitFor({ timeout: 20_000 });
    for (let i = 0; i < 6 && Number(await p.locator('#p-an').innerText()) !== Number(annee); i++) await p.locator(Number(await p.locator('#p-an').innerText()) > Number(annee) ? '#p-an-prec' : '#p-an-suiv').click();
    await p.locator(`#p-mois [data-p-mois="${mois}"]`).click();
    await expect.poll(() => p.locator('#p-remettre').count(), { timeout: 15_000 }).toBe(1);
    // Tous payés : le mois n'est plus « à payer » dans la bande (il attend sa déclaration).
    expect(['à déclarer', 'en retard']).toContain(await texte(`#p-mois [data-p-mois="${mois}"] small`));
    expect(await texte('#p-chiffres .pa-tuile:nth-child(1) .t')).toMatch(/^Net versé( |$)/); // tout est payé : le titre ne promet plus un versement
    expect(await texte('#p-remettre')).toBe('Remettre les 4 bulletins');
    expect(await etapes()).toEqual([['fait', 'Pointer'], ['fait', 'Bulletins'], ['fait', 'Payer'], ['ici', 'Remettre'], ['', 'Déclarer']]);
    await p.locator('#p-remettre').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toMatch(/^Remettre les 4 bulletins d/);
    await fenetre.locator('#rm-ok').click();
    const remis = async () => (await objets()).filter((o) => o.collection === 'payslips' && String(o.cle).endsWith(`-${annee}-${mois}`)).map((o) => o.contenu.remisLe).sort();
    await expect.poll(remis, { timeout: 15_000 }).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.anything(), expect.anything(), expect.anything()]);
    await expect.poll(() => p.locator('#p-remettre').count()).toBe(0);
    expect((await etapes())[3]).toEqual(['fait', 'Remettre']);
    await p.locator('#toast-undo').click();
    await expect.poll(remis, { timeout: 15_000 }).toEqual([undefined, undefined, undefined, undefined]);

    // ── Les avances vivent sous « Congés et absences » ; les chiffres de l'année dans « L'année » ───────────────────────
    await p.locator('#p-tabs [data-tab="conges"]').click();
    // 1.234.0 : sous les congés, la carte « Les avances et les prêts » (la maquette), sans sous-onglet.
    await expect.poll(() => p.locator('#cg-avances').count()).toBe(1);
    expect(await p.locator('#p-sous [role=tab]').count()).toBe(0);
    expect(await p.locator('#cg-new-av').count()).toBe(1);
    // (1.250.0, recette du 02/11) Le calendrier des congés : ‹ › change le mois ; une case libre ouvre la fenêtre du congé
    // à ce jour et pour ce salarié (le jour et la personne déjà remplis).
    // (1.251.0) Le calendrier suit le mois de la bande.
    const titreCal = async () => (await p.locator('#cg-cal .pa-carte-t b').first().innerText()).trim();
    const avantNav = await titreCal(), moisCg = Number(await p.locator('#p-mois .cp-mo.on').getAttribute('data-p-mois'));
    await p.locator(`#p-mois [data-p-mois="${moisCg === 1 ? 2 : moisCg - 1}"]`).click();
    await expect.poll(titreCal).not.toBe(avantNav);
    await p.locator(`#p-mois [data-p-mois="${moisCg}"]`).click();
    await expect.poll(titreCal).toBe(avantNav);
    // Un jour qui n'est pas aujourd'hui : la fenêtre s'ouvre sur aujourd'hui quand on ne lui dit rien.
    const aujLocal = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const cle = (await p.locator('#cg-cal td.cg-libre button[data-cg-j^="s2|"]').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.cgJ || '')))
      .find((x) => !x.endsWith(`|${aujLocal}`)) || '';
    const libre = p.locator(`#cg-cal button[data-cg-j="${cle}"]`);
    const [qui, jourIso] = cle.split('|');
    await libre.click();
    const fenCg = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenCg.locator('h2').innerText()).toBe('Congé ou absence');
    expect([qui, await fenCg.locator('input[type=hidden][name=employeeId]').inputValue(),
      await fenCg.locator('input[type=hidden][name=from]').inputValue(), await fenCg.locator('input[type=hidden][name=to]').inputValue()])
      .toEqual(['s2', 's2', jourIso, jourIso]);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#lf').count()).toBe(0);
    await p.locator('#p-tabs [data-tab="annee"]').click();
    await expect.poll(() => p.locator('#p-annee-chiffres .pa-tuile').count()).toBe(4);
    expect(await p.locator('#p-annee .pa-barre').count()).toBe(12);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-annee.png'), fullPage: true });
    // (1.251.0, Skander le 02/11) Un tableau dans une carte n'a pas de second cadre collé au sien, et ses colonnes
    // s'alignent sur le titre de la carte.
    await p.locator('#p-tabs [data-tab="bulletins"]').click();
    const cadreDouble = () => p.evaluate(() => [...document.querySelectorAll('.pa-carte table.list')].filter((t) => (t as HTMLElement).offsetParent)
      .map((t) => { const c = getComputedStyle(t), carte = t.closest('.pa-carte') as Element, titre = carte.querySelector('.pa-carte-t > b');
        const cel = t.querySelector('tbody tr > :first-child') as HTMLElement | null, r = document.createRange(); if (cel) r.selectNodeContents(cel);
        return { cadre: c.borderLeftWidth !== '0px' || c.boxShadow !== 'none', ecart: titre && cel ? Math.round(r.getBoundingClientRect().left - titre.getBoundingClientRect().left) : 0 }; }));
    await expect.poll(async () => (await cadreDouble()).length).toBeGreaterThan(0);
    expect((await cadreDouble()).filter((x) => x.cadre || Math.abs(x.ecart) > 2)).toEqual([]);
    // Au téléphone, la page tient dans sa largeur (rien ne déborde à droite), et rien ne sort de sa carte ni ne se coupe
    // en « … » : la liste « À traiter » se lit en entier.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('#p-frise').waitFor();
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#p-traiter .pa-n b, #p-traiter .pa-n small').evaluateAll((l) => l.filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent))).toEqual([]);
    expect(await p.locator('#p-bulletins table.list[data-cartes] > tbody > tr').first().evaluate((x) => getComputedStyle(x).borderLeftWidth)).toBe('0px');
    await p.screenshot({ path: path.join(PHOTOS, 'paie-mois-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
