// La saisie au brouillard du Cabinet sans réseau (1.105.0 ; docs/hors-ligne.md, H15 ; cadrage 04 § 2 et § 4). À la souris,
// dans un vrai navigateur, le réseau coupé pour de vrai (le serveur s'arrête, et revient au même port), comme
// tests/web/cabinet-hors-ligne.test.ts. Ce que le parcours vérifie :
//   - sans réseau, le bandeau dit que la saisie au brouillard se garde ; « Enregistrer et valider » le refuse AVANT
//     d'écrire (la pièce reste dans la grille) ; « Enregistrer en brouillard » la garde sur le poste, CHIFFRÉE, et le
//     brouillard la montre « attend le réseau », valider grisé ; elle se reprend dans la grille, se supprime, et tient
//     au rechargement ; « Se déconnecter » dit qu'elle serait perdue ;
//   - le réseau revenu, elle part seule : une fois, avec l'identifiant du poste, telle qu'on l'a laissée ; puis elle se
//     valide ;
//   - refusée au retour (la période validée entre-temps), elle reste au brouillard du poste avec la raison du serveur,
//     et se supprime.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('la saisie du Cabinet sans réseau, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>> | null = null;
  let adresse = '';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-saisie-hl-'));
  const configuration = () => ({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), web: dossier, livreurMs: 60_000 });
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...configuration(), port: 0 });
    adresse = serveur.adresse;
    navigateur = await chromium.launch();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });
  const couper = async (c: BrowserContext) => { await c.setOffline(true); await serveur?.arreter(); serveur = null; };
  const retablir = async () => { if (!serveur) serveur = await demarrer({ ...configuration(), port: Number(new URL(adresse).port) }); };
  afterEach(async () => { await retablir(); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  type Lue = { id: string; piece: string | null; statut: string; lignes: { compte: string; debit: string; credit: string }[] };
  const livres = async (ent: string, jeton: string) => ((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures ?? []) as Lue[];
  // Ce que le poste garde en attente pour ce cabinet : présent, et lisible en clair ou non.
  const lAttente = (p: Page, cab: string) => p.evaluate(async (c) => {
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('skanfact-poste'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    if (!db.objectStoreNames.contains('attentes')) { db.close(); return null; }
    const v = await new Promise<{ chiffre: ArrayBuffer } | undefined>((ok, ko) => { const r = db.transaction('attentes').objectStore('attentes').get(`c:${c}`); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    db.close();
    return v ? { lisible: new TextDecoder('latin1').decode(new Uint8Array(v.chiffre)).includes('OD-HL') } : null;
  }, cab);
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();

  it('sans réseau, la saisie au brouillard se garde, chiffrée, et se dit ; au retour, elle part une fois ; refusée, elle garde sa raison', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Droguerie du Port' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila);
    const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const annee = aujourdhui.slice(0, 4);
    const jour = aujourdhui.split('-').reverse().join('/');
    // Un mouvement de banque du client : son livre de l'année a une écriture, la saisie s'y ouvre.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [
      { collection: 'accounts', cle: 'k-banque', rang: 0, revision: null,
        contenu: { id: 'k-banque', name: 'BIAT', kind: 'banque', bank: '', rib: '', opening: 0, openingDate: aujourdhui, isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'movements', cle: 'm1', rang: 0, revision: null,
        contenu: { id: 'm1', date: aujourdhui, kind: 'banque', amount: { '~n': '7.125' }, accountId: 'k-banque', method: 'virement', label: 'Frais de tenue de compte' } },
    ] })).statut).toBe(200);

    // « Mon ordinateur », l'application installée (le navigateur promet de garder : 04 § 4).
    const c = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await c.addInitScript(() => { if (navigator.storage) Object.assign(navigator.storage, { persist: async () => true, persisted: async () => true }); });
    await c.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, leila);
    const erreurs: string[] = [];
    const p = await c.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/saisie/${annee}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#sa-ok').waitFor({ timeout: 15_000 });
    await expect.poll(() => p.evaluate((x) => localStorage.getItem(`skanfact.emportes.${x}`), cabinet), { timeout: 30_000 }).not.toBe(null);

    const remplir = async (piece: string, lignes: [string, string, string][]) => {
      await p.locator('#sa-journal').selectOption('OD');
      await p.locator('#sa-date').fill(jour);
      await p.locator('#sa-piece').fill(piece);
      await p.locator('#sa-libelle').fill('Régularisation de caisse');
      for (const [i, [compte, debit, credit]] of lignes.entries()) {
        if (!(await p.locator(`#sa-lignes tr[data-i="${i}"]`).count())) await p.locator('#sa-ajouter').click();
        const tr = p.locator(`#sa-lignes tr[data-i="${i}"]`);
        await tr.locator('input[data-k="compte"]').fill(compte);
        await tr.locator('input[data-k="debit"]').fill(debit);
        await tr.locator('input[data-k="credit"]').fill(credit);
      }
    };
    const fenetre = p.locator('#modal-root .modal').last();
    const ligne = (piece: string) => p.locator('tr.br-ligne', { hasText: piece });
    const actions = async (piece: string) => { await ligne(piece).getByRole('button', { name: /Actions/ }).click(); return p.locator('.row-menu').last().getByRole('menuitem'); };
    const bandeau = p.locator('#poste-bandeau');

    // ── Le réseau coupé ───────────────────────────────────────────────────────────────────────
    await couper(c);
    await p.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect.poll(async () => net(await bandeau.innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^Hors ligne depuis \d{1,2} h \d\d\. .+ Ta saisie au brouillard se garde sur ce poste et partira seule au retour du réseau ; le reste demande le réseau\.$/);

    // « Enregistrer et valider » : refusé avant d'écrire, la pièce reste dans la grille.
    await remplir('OD-HL1', [['6132', '120,250', ''], ['401', '', '120,250']]);
    await p.locator('#sa-okvalider').click();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Valider demande le réseau');
    await fenetre.getByRole('button', { name: 'Annuler', exact: true }).click();
    expect(await p.locator('#sa-piece').inputValue()).toBe('OD-HL1');
    expect(await ligne('OD-HL1').count()).toBe(0);

    // La fenêtre offre le geste qui débloque : « Enregistrer en brouillard » la garde sur le poste, chiffrée, et le dit.
    await p.locator('#sa-okvalider').click();
    await fenetre.getByRole('button', { name: 'Enregistrer en brouillard', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Gardée sur ce poste, au brouillard : elle partira seule au serveur au retour du réseau.');
    await expect.poll(() => ligne('OD-HL1').locator('.sa-attente').innerText().catch(() => ''), { timeout: 10_000 }).toBe('attend le réseau');
    // Sa marque se lit : droite, dans une ligne de brouillard en italique.
    expect(await ligne('OD-HL1').locator('.sa-attente').evaluate((e) => getComputedStyle(e).fontStyle)).toBe('normal');
    await expect.poll(async () => net(await bandeau.innerText())).toMatch(/Une écriture attend le réseau : gardée sur ce poste, elle partira seule à son retour\.$/);
    expect(await lAttente(p, cabinet)).toEqual({ lisible: false });
    const idDuPoste = await ligne('OD-HL1').getAttribute('data-br');
    expect(idDuPoste).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Les lots ne la comptent pas : le serveur ne l'a pas encore (seule l'écriture de banque du client s'y valide).
    expect(await p.locator('.sa-lot button').allInnerTexts()).toEqual(['Valider la seule pièce de BQ']);
    // Valider est grisé, et dit pourquoi au clic.
    const valider = (await actions('OD-HL1')).filter({ hasText: 'Valider cette écriture' });
    await expect.poll(() => valider.getAttribute('class')).toMatch(/\boff\b/);
    expect(await valider.innerText()).toContain('Une fois partie au serveur, au retour du réseau');
    // Joindre un justificatif aussi : la pièce n'est pas encore au serveur.
    const joindre = p.locator('.row-menu').last().getByRole('menuitem').filter({ hasText: 'Joindre un justificatif…' });
    expect(await joindre.getAttribute('class')).toMatch(/\boff\b/);
    expect(await joindre.innerText()).toContain('Une fois partie au serveur, au retour du réseau');
    await valider.click();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Elle attend le réseau');
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();

    // Une seconde, puis supprimée : elle ne partira pas.
    await remplir('OD-HL2', [['6226', '40', ''], ['401', '', '40']]);
    await p.locator('#sa-ok').click();
    await expect.poll(() => ligne('OD-HL2').count(), { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => net(await bandeau.innerText())).toMatch(/2 écritures attendent le réseau/);
    await (await actions('OD-HL2')).filter({ hasText: 'Supprimer ce brouillard' }).click();
    await fenetre.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect.poll(() => ligne('OD-HL2').count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => net(await bandeau.innerText())).toMatch(/Une écriture attend le réseau/);

    // La première, reprise dans la grille et corrigée : elle attend toujours, à son nouveau montant.
    await (await actions('OD-HL1')).filter({ hasText: 'Reprendre dans la grille' }).click();
    await expect.poll(() => p.locator('#sa-piece').inputValue()).toBe('OD-HL1');
    await p.locator('#sa-lignes tr[data-i="0"] input[data-k="debit"]').fill('125,500');
    await p.locator('#sa-lignes tr[data-i="1"] input[data-k="credit"]').fill('125,500');
    await p.locator('#sa-ok').click();
    await expect.poll(async () => net(await ligne('OD-HL1').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/125,500 attend le réseau/);

    // Rechargée sans réseau : elle est toujours là.
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await expect.poll(async () => net(await ligne('OD-HL1').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/125,500 attend le réseau/);
    await expect.poll(async () => net(await bandeau.innerText())).toMatch(/Une écriture attend le réseau/);

    // Se déconnecter le dit : elle serait perdue. On reste.
    await p.locator('#se-deconnecter').click();
    await expect.poll(async () => net(await fenetre.locator('#deco-attente').innerText().catch(() => ''))).toBe('Une écriture saisie sans réseau n\'est pas encore partie au serveur : elle serait perdue. Attends le retour du réseau : elle partira seule.');
    expect(await fenetre.getByRole('button', { name: 'Me déconnecter et la perdre', exact: true }).count()).toBe(1);
    await fenetre.getByRole('button', { name: 'Annuler', exact: true }).click();
    expect(await lAttente(p, cabinet)).toEqual({ lisible: false });

    // ── Le réseau revenu : elle part seule, une fois, telle qu'on l'a laissée ──────────────────
    await retablir();
    expect((await livres(ent, leila)).some((e) => e.piece === 'OD-HL1')).toBe(false);
    await c.setOffline(false);
    await expect.poll(async () => net(await bandeau.innerText()), { timeout: 20_000 }).toBe('Le réseau est revenu : ton écriture faite hors ligne est au brouillard. Recharger');
    const parties = (await livres(ent, leila)).filter((e) => e.piece?.startsWith('OD-HL'));
    expect(parties.map((e) => [e.id, e.piece, e.statut, e.lignes.map((l) => [l.compte, l.debit, l.credit])])).toEqual([
      [idDuPoste, 'OD-HL1', 'brouillard', [['6132', '125.500', '0.000'], ['401', '0.000', '125.500']]],
    ]);
    expect(await lAttente(p, cabinet)).toBe(null);
    await bandeau.getByRole('button', { name: 'Recharger', exact: true }).click();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await expect.poll(async () => net(await ligne('OD-HL1').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/125,500 équilibrée/);
    await (await actions('OD-HL1')).filter({ hasText: 'Valider cette écriture' }).click();
    await fenetre.getByRole('button', { name: 'Valider', exact: true }).click();
    await expect.poll(async () => (await livres(ent, leila)).find((e) => e.piece === 'OD-HL1')?.statut, { timeout: 10_000 }).toBe('validee');
    // L'écran a fini (le livre relu, le numéro dit) avant qu'on coupe le serveur : la base dit « validée » dès le premier
    // appel, et couper entre les deux laissait « Validation refusée » sur le bouton (rouge sur GitHub, 23/10/2026).
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 10_000 }).toMatch(/^Validée sous le n° /);

    // ── Refusée au retour : la période validée entre-temps. Cette fois, seul le serveur tombe (le réseau du poste reste) :
    //    le navigateur ne dira pas qu'il revient, le poste réessaie seul toutes les 30 secondes. ─────────────────────
    await serveur?.arreter();
    serveur = null;
    await remplir('OD-HL3', [['6132', '10', ''], ['401', '', '10']]);
    await p.locator('#sa-ok').click();
    await expect.poll(() => ligne('OD-HL3').locator('.sa-attente').count(), { timeout: 10_000 }).toBe(1);
    await retablir();
    expect((await api('POST', `/entreprises/${ent}/compta/valider`, leila, { jusqua: aujourdhui })).statut).toBe(200);
    await expect.poll(async () => net(await bandeau.innerText()), { timeout: 45_000 })
      .toBe('Le réseau est revenu. Une écriture n\'est pas entrée : elle reste au brouillard de ce poste, avec la raison du refus ; reprends-la dans la grille, ou supprime-la. Recharger');
    await bandeau.getByRole('button', { name: 'Recharger', exact: true }).click();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await expect.poll(async () => net(await ligne('OD-HL3').locator('.sa-refusee').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe(`refusée : La période est validée jusqu'au ${jour} : une écriture ne s'y écrit plus.`);
    expect((await livres(ent, leila)).some((e) => e.piece === 'OD-HL3')).toBe(false);
    await (await actions('OD-HL3')).filter({ hasText: 'Supprimer ce brouillard' }).click();
    await fenetre.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect.poll(() => ligne('OD-HL3').count(), { timeout: 10_000 }).toBe(0);
    expect(await lAttente(p, cabinet)).toBe(null);
    expect(erreurs).toEqual([]);
  }, 300_000);

  // Le cabinet d'un client, ouvert sur « mon ordinateur » au livre de l'année ; `persistant` : le navigateur promet de garder.
  const ouvrir = async (persistant: boolean) => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Droguerie du Port' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila);
    const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [
      { collection: 'accounts', cle: 'k-banque', rang: 0, revision: null,
        contenu: { id: 'k-banque', name: 'BIAT', kind: 'banque', bank: '', rib: '', opening: 0, openingDate: aujourdhui, isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'movements', cle: 'm1', rang: 0, revision: null,
        contenu: { id: 'm1', date: aujourdhui, kind: 'banque', amount: { '~n': '7.125' }, accountId: 'k-banque', method: 'virement', label: 'Frais de tenue de compte' } },
    ] })).statut).toBe(200);
    const c = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await c.addInitScript((oui) => { if (navigator.storage) Object.assign(navigator.storage, { persist: async () => oui, persisted: async () => oui }); }, persistant);
    await c.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, leila);
    const lien = `${adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/saisie/${aujourdhui.slice(0, 4)}`;
    const p = await c.newPage();
    await p.goto(lien);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#sa-ok').waitFor({ timeout: 15_000 });
    await expect.poll(() => p.evaluate((x) => localStorage.getItem(`skanfact.emportes.${x}`), cabinet), { timeout: 30_000 }).not.toBe(null);
    const remplir = async (piece: string) => {
      await p.locator('#sa-journal').selectOption('OD');
      await p.locator('#sa-date').fill(aujourdhui.split('-').reverse().join('/'));
      await p.locator('#sa-piece').fill(piece);
      await p.locator('#sa-libelle').fill('Régularisation de caisse');
      for (const [i, [compte, debit, credit]] of ([['6132', '15', ''], ['401', '', '15']] as const).entries()) {
        if (!(await p.locator(`#sa-lignes tr[data-i="${i}"]`).count())) await p.locator('#sa-ajouter').click();
        const tr = p.locator(`#sa-lignes tr[data-i="${i}"]`);
        await tr.locator('input[data-k="compte"]').fill(compte);
        await tr.locator('input[data-k="debit"]').fill(debit);
        await tr.locator('input[data-k="credit"]').fill(credit);
      }
    };
    return { leila, cabinet, ent, c, p, lien, remplir };
  };

  it('fermé sans réseau, rouvert avec : ce qui attendait part à l\'ouverture', async () => {
    const { leila, cabinet, ent, c, p, lien, remplir } = await ouvrir(true);
    await couper(c);
    await p.evaluate(() => window.dispatchEvent(new Event('offline')));
    await remplir('OD-HL4');
    await p.locator('#sa-ok').click();
    await expect.poll(() => p.locator('tr.br-ligne', { hasText: 'OD-HL4' }).locator('.sa-attente').count(), { timeout: 10_000 }).toBe(1);
    await p.close();
    await retablir();
    await c.setOffline(false);
    expect((await livres(ent, leila)).some((e) => e.piece === 'OD-HL4')).toBe(false);
    // L'application rouverte, le réseau là (aucun « retour du réseau » à entendre) : elle part dès l'ouverture.
    const q = await c.newPage();
    await q.goto(lien);
    await q.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await expect.poll(async () => (await livres(ent, leila)).filter((e) => e.piece === 'OD-HL4').length, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => lAttente(q, cabinet), { timeout: 10_000 }).toBe(null);
  }, 180_000);

  it('un navigateur qui ne promet pas de garder : sans réseau, la saisie est refusée, et dit pourquoi', async () => {
    const { c, p, remplir } = await ouvrir(false);
    await couper(c);
    await p.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect.poll(async () => net(await p.locator('#poste-bandeau').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/Ce navigateur peut vider ce que ce poste garde : sans réseau, tu consultes, mais rien ne s'enregistre\./);
    await remplir('OD-HL5');
    await p.locator('#sa-ok').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Enregistrement impossible');
    expect(net(await fenetre.innerText())).toMatch(/Hors ligne : rien n'a été enregistré\. Ce navigateur peut vider ce que ce poste garde/);
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    expect(await p.locator('tr.br-ligne', { hasText: 'OD-HL5' }).count()).toBe(0);
    expect(await p.locator('#sa-piece').inputValue()).toBe('OD-HL5');
  }, 180_000);
});
