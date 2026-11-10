// (1.342.0) La Saisie d'un dossier au Cabinet, face à la pièce, jouée au clavier par Anis avant d'être écrite ici :
//   - le droit « revision » d'un dossier (le pont le nomme « validation ») ouvre « Enregistrer et valider » : l'écran ne
//     reconnaissait que « revision », et qui révisait le dossier n'avait que le brouillard ;
//   - la liste des TVA propose toujours 7, 13 et 19 %, le chiffre en tête : « 19 » tapé au clavier choisit 19 %, même sur
//     un dossier qui n'a encore aucun achat taxé ;
//   - « ↵ » enregistre, valide et ouvre la pièce suivante, le curseur dans son premier champ, la pièce à l'écran ;
//   - un ticket payé en espèces écrit son règlement en caisse, le même jour ;
//   - la colonne « Par » du brouillard nomme le collaborateur qui a saisi (le serveur rend `saisiePar`) ;
//   - « 1 écriture · elle n'entre… » (le singulier), et un « … » court du message passager ne se coupe plus.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const LE_28 = new Date('2026-10-28T10:00:00+01:00');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const net = (t: string) => t.replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();

describe('la Saisie d\'un dossier au Cabinet, au clavier (1.342.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-saisie-1342-'));
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
    const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return { jeton, email };
  };

  it('(1.342.0) Anis révise le dossier : il valide ; « 19 » choisit 19 % ; ↵ ouvre la pièce suivante, le curseur dedans ; les espèces vont en caisse ; « Par » le nomme', async () => {
    const { jeton: associe, email: courriel } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const { jeton: sarra } = await personne('Sarra Ben Salah');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Café Dar Zitouna' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact: 'Walid', from: '2026-09' }, revision: null })).statut).toBeLessThan(300);
    const anis = await (async () => {
      const r = await personne('Anis Gharbi');
      const inv = await api('POST', `/cabinets/${cab.id}/invitations`, associe, { email: r.email, role: 'revision' });
      expect((await api('POST', '/invitations/accepter', r.jeton, { jeton: inv.corps.jeton })).statut).toBeLessThan(300);
      const membres = (await api('GET', `/cabinets/${cab.id}/equipe`, associe)).corps.membres as { membre: string; nom: string }[];
      const id = membres.find((m) => m.nom === 'Anis Gharbi')?.membre ?? '';
      expect((await api('PUT', `/cabinets/${cab.id}/mandats/${mandat}/affectations/${id}`, associe, { role: 'revision' })).statut).toBeLessThan(300);
      return r.jeton;
    })();
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    // Le livre de 2026 existe (des honoraires d'août, validés) ; aucun achat taxé n'y est encore passé.
    const od = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: '2026-08-14', journal: 'OD', piece: 'OD-2026-08', libelle: 'Honoraires',
      lignes: [{ compte: '6226', debit: '100,125' }, { compte: '401', credit: '100,125' }] });
    expect(od.statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [od.corps.id] })).statut).toBe(200);
    // Un long brouillard de septembre, comme chez une boulangerie au milieu du mois : la page descend loin sous la fiche.
    const longues: { id: string; revision: number }[] = [];
    for (let k = 1; k <= 14; k++) {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `2026-09-${String(k).padStart(2, '0')}`, journal: 'OD', piece: `OD-L${k}`, libelle: 'Frais divers',
        lignes: [{ compte: '6226', debit: '10,000' }, { compte: '401', credit: '10,000' }] });
      expect(r.statut).toBe(201);
      longues.push({ id: String(r.corps.id), revision: Number(r.corps.revision ?? 1) });
    }
    const envoyer = async (nom: string) => {
      const f = await api('POST', `/entreprises/${ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom, contenu: PNG });
      const m = await api('POST', `/entreprises/${ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: f.corps.id });
      expect(m.statut).toBe(201);
    };
    await envoyer('facture-transport-octobre.png');
    await envoyer('ticket-carburant.png');
    // Les pièces arrivent la veille du jour de l'essai (le 27/10, fixe) : le mois où elles tombent ne dépend pas de l'heure.
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    try { await admin.query(`update messagerie.message set ecrit_le = '2026-10-27T18:12:00+01:00' where entreprise = $1`, [ent]); } finally { await admin.end(); }
    void courriel;

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(LE_28);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, anis);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/comptabilite/saisie/2026`);
    await p.locator('[data-cp-mois="2026-10"]').waitFor({ timeout: 25_000 }).catch(async (e: unknown) => { await p.screenshot({ path: path.join(PHOTOS, 'saisie-1342-echec.png'), fullPage: true }); throw e; });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    // Arrivées en octobre (le mois en cours), elles se rangent dans le dernier mois fini : septembre.
    await p.locator('[data-cp-mois="2026-09"]').click();
    await p.locator('#sx-rang').waitFor({ timeout: 20_000 }).catch(async (e: unknown) => { await p.screenshot({ path: path.join(PHOTOS, 'saisie-1342-echec.png'), fullPage: true }); throw e; });
    await expect.poll(() => p.locator('#sx-rang').innerText().then(net)).toBe('Pièce 1 sur 2');

    // Anis révise ce dossier (« revision » au serveur, « validation » dans l'écran) : il valide, personne d'autre.
    await expect.poll(() => p.locator('#sx-ok-valider').count()).toBe(1);
    expect(await p.locator('#sx-qui-valide').count()).toBe(0);
    expect(net(await p.locator('.sx-touches').innerText())).toContain('enregistre, valide et ouvre la pièce suivante');
    // Aucun achat taxé dans ce livre : les taux que SkanFact propose sont là quand même, le chiffre en tête.
    expect(await p.locator('#sx-tva option').allInnerTexts()).toEqual(['À choisir', 'Sans TVA récupérable', '7 % de TVA', '13 % de TVA', '19 % de TVA', 'Autre taux…']);

    // Au clavier, comme Anis : le fournisseur, la date, le total, le timbre passé, « 19 », le compte.
    await p.locator('#sx-four').click();
    await p.keyboard.type('Transports Ben Salah');
    await p.keyboard.press('Tab');
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('sx-date');
    await p.keyboard.type('18/09/2026');
    // La date proposée (celle de l'arrivée) se remplace d'une frappe, et sa note « date d'arrivée » s'efface.
    await expect.poll(() => p.locator('#sx-date').inputValue()).toBe('18/09/2026');
    expect(await p.evaluate(() => document.querySelector('#sx-date')?.closest('.sx-fi-r')?.querySelector('.sx-src')?.textContent ?? '')).toBe('');
    await p.keyboard.press('Tab');
    await p.keyboard.type('119');
    await p.keyboard.press('Tab');
    await p.keyboard.press('Tab');
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('sx-tva');
    await p.keyboard.type('19');
    await p.keyboard.press('Tab');
    await p.keyboard.type('6241');
    await expect.poll(() => p.locator('#sx-tva').inputValue()).toBe('19');
    await expect.poll(() => p.locator('#sx-ec-l tr').allInnerTexts().then((l) => l.map(net))).toEqual([
      '6241 Transports 100,000', '4366 TVA déductible 19,000', '401 Transports Ben Salah 119,000']);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-1342-a-clavier.png') });

    // Le tout en bas de la page, puis ↵ : la pièce suivante s'ouvre à l'écran, le curseur dans son fournisseur.
    await p.evaluate(() => { const v = document.querySelector('#view'); if (v) v.scrollTop = v.scrollHeight; });
    await p.locator('#sx-compte').focus();
    // La barre « Pièce 1 sur 2 » est bien sortie de l'écran, au-dessus : sinon ce qui suit ne prouverait rien.
    expect(await p.evaluate(() => (document.querySelector('#sx-rang')?.getBoundingClientRect().top ?? 0) < (document.querySelector('.c-nav')?.getBoundingClientRect().bottom ?? 0))).toBe(true);
    await p.keyboard.press('Enter');
    await expect.poll(() => p.locator('#toast').innerText().then(net), { timeout: 15_000 }).toMatch(/^Transports Ben Salah · 119,000 DT : validée/);
    await expect.poll(() => p.locator('#sx-rang').innerText().then(net), { timeout: 15_000 }).toBe('Pièce 1 sur 1');
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('sx-four');
    await expect.poll(() => p.evaluate(() => {
      const tete = document.querySelector('#sx-rang')?.closest('.sx-barre') ?? document.querySelector('#sx-rang');
      const barre = document.querySelector('.c-nav')?.getBoundingClientRect().bottom ?? 0;
      const r = tete?.getBoundingClientRect();
      return !!r && r.top >= barre - 1 && r.top < innerHeight ? true : JSON.stringify({ top: r?.top, barre, h: innerHeight, nav: !!document.querySelector('.c-nav') });
    })).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-1342-b-suivante.png') });

    // Le long brouillard retiré (il ne servait qu'à allonger la page) : le livre se relit au prochain enregistrement.
    for (const e of longues) expect((await api('DELETE', `/entreprises/${ent}/compta/ecritures/${e.id}?revision=${e.revision}`, associe)).statut).toBe(200);

    // Le ticket, payé en espèces : son règlement s'écrit en caisse, le même jour — ici au brouillard.
    await p.locator('#sx-four').fill('Station Total Ennasr');
    await p.locator('#sx-date').fill('24/09/2026');
    await p.locator('#sx-ttc').fill('60');
    await p.locator('#sx-tva').selectOption('sans');
    await p.locator('#sx-compte').fill('6066');
    await p.locator('#sx-especes').check();
    await expect.poll(() => p.locator('#sx-ec-l tr').allInnerTexts().then((l) => l.map(net).filter((x) => x.startsWith('54')))).toEqual(['54 Caisse 60,000']);
    await p.locator('#sx-ok').click();
    await expect.poll(() => p.locator('#toast').innerText().then(net), { timeout: 15_000 }).toContain('son règlement en espèces écrit');
    const lues = (await api('GET', `/entreprises/${ent}/compta/ecritures?du=2026-01-01&au=2026-12-31`, anis)).corps.ecritures as { statut: string; date: string; saisiePar: string | null; lignes: { compte: string; debit: string; credit: string }[] }[];
    const caisse = lues.find((e) => e.lignes.some((l) => l.compte.startsWith('54')));
    expect(lues.find((e) => e.lignes.some((l) => l.compte === '6241'))?.date).toBe('2026-09-18');
    expect(caisse?.date).toBe('2026-09-24');
    expect(caisse?.statut).toBe('brouillard');
    expect(caisse?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['401', '60.000', '0.000'], ['54', '0.000', '60.000']]);
    // Le serveur dit qui a saisi : les honoraires, l'associée ; le transport, le ticket et son règlement, Anis.
    const parAnis = lues.filter((e) => e.date >= '2026-09-01').map((e) => e.saisiePar);
    expect(parAnis.length).toBe(3);
    expect(new Set(parAnis).size).toBe(1);
    expect(parAnis[0]).toBeTruthy();
    expect(lues.find((e) => e.date === '2026-08-14')?.saisiePar).not.toBe(parAnis[0]);

    // Le brouillard : deux écritures, le pluriel ; « Par » nomme Anis, pas « le cabinet ».
    await expect.poll(() => p.locator('#sx-bl-n').innerText().then(net), { timeout: 15_000 }).toMatch(/^2 écritures · elles n'entrent dans aucun chiffre tant qu'elles ne sont pas validées$/);
    await expect.poll(() => p.locator('.sx-par').evaluateAll((l) => l.map((e) => `${(e as HTMLElement).title}:${e.firstChild?.textContent ?? ''}`))).toEqual(['Anis Gharbi:AG', 'Anis Gharbi:AG']);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-1342-c-brouillard.png') });

    // Une écriture supprimée : le singulier.
    await p.locator('.sx-par').first().locator('xpath=ancestor::tr').locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Supprimer/ }).click();
    await p.locator('.modal .btn-primary, .modal .btn-danger').last().click();
    await expect.poll(() => p.locator('#sx-bl-n').innerText().then(net), { timeout: 15_000 }).toBe('1 écriture · elle n\'entre dans aucun chiffre tant qu\'elle n\'est pas validée');

    // La validation du reste : le message garde « Déclarer et clôturer » d'un bloc.
    await p.locator('.sx-bl-z button').filter({ hasText: /^Valider/ }).first().click();
    await p.locator('.modal .btn-primary').last().click();
    await expect.poll(() => p.locator('#toast .nw').allInnerTexts().then((l) => l.map(net)), { timeout: 15_000 }).toContain('« Déclarer et clôturer »');
    expect(net(await p.locator('#toast').innerText())).toContain('Prochaine étape : la déclaration, dans « Déclarer et clôturer ».');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
