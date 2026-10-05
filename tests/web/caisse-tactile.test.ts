// La caisse tactile, à l'écran (05/10/2026 ; maquette validée par Skander ; docs/caisse.md, « La caisse tactile »).
// Nadia tient son épicerie. Au comptoir : les familles du Catalogue, la douchette, un article libre au prix qu'aucun HT
// n'atteint, une vente mise en attente et reprise, un ticket annulé puis rendu ; l'écran du client suit le ticket, le
// paiement et la monnaie ; la douchette, sur l'écran de la monnaie, commence la vente suivante. Le soir, elle compte le
// tiroir billet par billet : le Z garde le détail et dit l'écart au millime. Au téléphone : le ticket replié sous les
// tuiles, et le comptage par un pavé dans une fenêtre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la caisse tactile, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tactile-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const annee = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).slice(0, 4);
  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
  const texte = async (p: Page, sel: string) => net(await p.locator(sel).innerText().catch(() => ''));

  // L'épicerie de Nadia : sa caisse, sa banque (pour la carte), trois articles rangés en familles, le lait avec son
  // code-barres. Connectée sur l'appareil du comptoir.
  async function epicerie() {
    const email = `nadia-tactile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'accounts', cle: 'k-banque', rang: 1, revision: null, contenu: { id: 'k-banque', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'lait', rang: 0, revision: null, contenu: { id: 'lait', label: 'Lait demi-écrémé 1 L', code: '6191234567890', famille: 'Crèmerie', unit: 'u', unitPrice: { '~n': '2.35' }, vatRate: 19 } },
      { collection: 'catalog', cle: 'pain', rang: 1, revision: null, contenu: { id: 'pain', label: 'Pain de mie', famille: 'Boulangerie', unit: 'u', unitPrice: { '~n': '1.2' }, vatRate: 7 } },
      { collection: 'catalog', cle: 'huile', rang: 2, revision: null, contenu: { id: 'huile', label: 'Huile d\'olive 1 L', famille: 'Épicerie', unit: 'u', unitPrice: { '~n': '12.5' }, vatRate: 19 } },
    ] })).statut).toBe(200);
    return { jeton, ent };
  }
  async function ouvrirPage(jeton: string, ent: string, o: { largeur: number; hauteur: number; doigt?: boolean }) {
    // Le navigateur d'un commerçant est à l'heure de Tunis, comme le serveur (CI rouge du 01/10/2026 sur 6bf2b1b).
    const cx = await navigateur.newContext({ viewport: { width: o.largeur, height: o.hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', isMobile: !!o.doigt, hasTouch: !!o.doigt });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    await expect.poll(() => p.locator('#cs-ouverte').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(p);
    return { cx, p, erreurs };
  }

  it('au comptoir : familles, douchette, article libre, attente, annulation, écran du client, monnaie ; le soir, le comptage billet par billet', async () => {
    const { jeton, ent } = await epicerie();
    expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, jeton, { fond: '50' })).statut).toBe(200);
    const { cx, p, erreurs } = await ouvrirPage(jeton, ent, { largeur: 1440, hauteur: 900 });
    const toast = () => texte(p, '#toast');
    const lignes = async () => (await p.locator('#cs-zone .ct-ligne').allInnerTexts()).map(net);
    const tuiles = async () => (await p.locator('#cs-articles .cs-art .cs-art-nom').allInnerTexts()).map(net);

    // 1. Les familles du Catalogue, en onglets ; aucune vente encore : pas de « Favoris », « Tout » d'abord.
    expect((await p.locator('#cs-familles [data-famille]').allInnerTexts()).map(net)).toEqual(['Tout', 'Boulangerie', 'Crèmerie', 'Épicerie']);
    expect(await tuiles()).toEqual(['Huile d\'olive 1 L', 'Lait demi-écrémé 1 L', 'Pain de mie']);
    await p.locator('#cs-familles [data-famille="f:Crèmerie"]').click();
    expect(await tuiles()).toEqual(['Lait demi-écrémé 1 L']);
    await p.locator('#cs-familles [data-famille=tout]').click();

    // 2. La douchette : le code du lait, puis Entrée, l'ajoute au ticket.
    await p.locator('#cs-scan').fill('6191234567890');
    await p.locator('#cs-scan').press('Enter');
    await expect.poll(lignes).toEqual(['Lait demi-écrémé 1 L 2,797 DT l\'unité − 1 + 2,797 DT']);

    // 3. Un article libre, 4,500 TTC à 19 % : aucun HT n'y tombe ; la caisse le dit, et prend le plus proche.
    await p.locator('#cs-libre').click();
    await p.locator('#modal-root [name=label]').fill('Réparation de sac');
    await p.locator('#modal-root [name=ttc]').fill('4,5');
    await p.locator('#modal-root #al-ok').click();
    await expect.poll(toast).toBe('Aucun prix HT ne donne exactement 4,500 DT TTC à 19 % : le plus proche donne 4,501 DT.');
    expect((await lignes())[1]).toBe('Réparation de sac 4,501 DT l\'unité − 1 + 4,501 DT');
    expect(await texte(p, '#cs-total')).toBe('7,298 DT');

    // 4. Le client va chercher un article : la vente attend ; un pain se vend en attendant ; puis la vente reprend (le
    // pain attend à sa place). L'horloge dit combien attendent, et la liste dit ce qu'il y a dedans.
    expect(await p.locator('#cs-reprendre').isVisible()).toBe(false);
    await p.locator('#cs-attente').click();
    await expect.poll(toast).toBe('Vente mise en attente : le bouton de l\'horloge la reprend.');
    expect(await lignes()).toEqual([]);
    expect(await texte(p, '#cs-reprendre .ct-nb')).toBe('1');
    await p.locator('#cs-articles .cs-art', { hasText: 'Pain de mie' }).click();
    await p.locator('#cs-reprendre').click();
    expect(await texte(p, '#modal-root .ct-attente b')).toBe('Lait demi-écrémé 1 L, Réparation de sac');
    await p.locator('#modal-root [data-reprendre="0"]').click();
    await expect.poll(async () => (await lignes()).map((l) => l.split(' ')[0])).toEqual(['Lait', 'Réparation']);
    expect(await texte(p, '#cs-reprendre .ct-nb')).toBe('1');

    // 5. « Annuler le ticket » se répare : « Annuler » sur le bandeau le remet.
    await p.locator('#cs-vider').click();
    expect(await lignes()).toEqual([]);
    await p.locator('#toast-undo').click();
    await expect.poll(async () => (await lignes()).length).toBe(2);

    // 6. L'écran du client, ouvert sur le même poste : il demande ce que la caisse montre, et suit.
    const client = await cx.newPage();
    await client.goto(`${serveur.adresse}/plateforme/ecran-client.html?e=${ent}`);
    const vu = () => texte(client, 'body');
    await expect.poll(vu, { timeout: 10_000 }).toBe('Épicerie Ben Youssef Votre ticket 1 × Lait demi-écrémé 1 L 2,797 DT 1 × Réparation de sac 4,501 DT Total 7,298 DT 2 lignes Prix toutes taxes comprises Merci de votre visite.');
    // Le paiement : les billets proposés, puis le pavé ; un montant tapé après un billet le remplace.
    await p.locator('#cs-encaisser').click();
    expect((await p.locator('#cs-billets [data-billet]').allInnerTexts()).map(net)).toEqual(['Montant exact', '10 DT', '20 DT', '50 DT', '100 DT']);
    await p.locator('#cs-billets [data-billet="20"]').click();
    for (const k of ['5']) await p.locator(`#cs-pave [data-touche="${k}"]`).click();
    expect(await p.locator('#cs-recu').inputValue()).toBe('5');
    await expect.poll(() => texte(p, '#cs-valider')).toBe('Il manque 2,298 DT');
    expect(await p.locator('#cs-valider').isDisabled()).toBe(true);
    expect(await texte(p, '#cs-rendre-boite')).toBe('Il manque 2,298 DT');
    await p.locator('#cs-billets [data-billet="10"]').click();
    await expect.poll(() => texte(p, '#cs-valider')).toBe('Valider · rendre 2,702 DT');
    await expect.poll(vu).toContain('Paiement 1 × Lait demi-écrémé 1 L 2,797 DT 1 × Réparation de sac 4,501 DT À payer 7,298 DT Reçu 10,000 DT Votre monnaie 2,702 DT');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'tactile-1-paiement.png') });
    await p.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-001 encaissé — à rendre 2,702 DT`);
    // La monnaie, en grand ; le client la lit aussi.
    expect(await texte(p, '#cs-rendu-ecran .ct-rendu-titre')).toBe('Rendre au client');
    expect(await texte(p, '#cs-a-rendre')).toBe('2,702 DT');
    await expect.poll(vu).toBe(`Épicerie Ben Youssef Merci, à bientôt ! Votre monnaie 2,702 DT Reçu 10,000 DT · payé 7,298 DT · ticket TIC-${annee}-001 Prix toutes taxes comprises Merci de votre visite.`);
    await client.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'tactile-2-ecran-client.png') });

    // 7. La douchette, sur l'écran de la monnaie : la vente suivante commence, avec l'article scanné ; un panier qui
    // revient de l'attente ne s'y mêle pas.
    await p.keyboard.type('6191234567890');
    await p.keyboard.press('Enter');
    await expect.poll(lignes).toEqual(['Lait demi-écrémé 1 L 2,797 DT l\'unité − 1 + 2,797 DT']);
    // Vendu depuis peu : le lait est maintenant un favori, en tête des onglets.
    expect((await p.locator('#cs-familles [data-famille]').allInnerTexts()).map(net)[0]).toBe('Favoris');
    // Payé par carte, le ticket ne rend rien.
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-paiement [data-mode=carte]').click();
    await p.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-002 encaissé`);
    expect(await texte(p, '#cs-rendu-ecran .ct-rendu-titre')).toBe('Payé par carte : rien à rendre');
    await p.locator('#cs-nouvelle').click();

    // 8. Le soir : le tiroir, billet par billet (50 de fond + 7,298 d'espèces = 57,298 attendus) ; il manque 8 millimes.
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-fermer').click();
    const compter = async (i: number, n: string) => {
      await p.locator(`[data-coupure="${i}"]`).click();
      for (const k of n) await p.locator(`#cs-pave-compte [data-touche="${k}"]`).click();
    };
    await compter(1, '2'); // 2 billets de 20
    await compter(2, '1'); // 1 billet de 10
    await compter(3, '1'); // 1 pièce de 5
    await compter(4, '1'); // 1 pièce de 2
    await compter(7, '1'); // 1 pièce de 200 millimes
    await compter(9, '1'); // 1 pièce de 50 millimes
    await compter(10, '2'); // 2 pièces de 20 millimes
    expect(await texte(p, '#cs-compte-total')).toBe('57,290 DT');
    expect(await texte(p, '#cs-compte-detail')).toBe('Billets 50,000 DT · pièces 7,290 DT');
    expect(await p.locator('[data-coupure="10"]').getAttribute('aria-label')).toBe('Pièces de 20 millimes : 2');
    // Ce que le tiroir devait contenir ne se voit pas avant le Z.
    expect(net(await p.locator('#cs-fermeture').innerText())).not.toContain('57,298');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'tactile-3-comptage.png') });
    await p.locator('#cs-z').click();
    const z = () => texte(p, '#modal-root #cs-z-table');
    await expect.poll(z, { timeout: 10_000 }).toContain('Le tiroir devait contenir 57,298 DT Espèces comptées 57,290 DT 2 × 20 DT 40,000 DT 1 × 10 DT 10,000 DT 1 × 5 DT 5,000 DT 1 × 2 DT 2,000 DT 1 × 200 millimes 0,200 DT 1 × 50 millimes 0,050 DT 2 × 20 millimes 0,040 DT Écart − 0,008 DT');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'tactile-4-z.png') });
    // Au serveur, le Z garde le détail.
    const zs = (await api('GET', `/entreprises/${ent}/caisse/z`, jeton)).corps.z as { comptage?: { valeur: string; nombre: number }[]; ecart: string }[];
    expect(zs[0]).toMatchObject({ ecart: '-0.008', comptage: [{ valeur: '20.000', nombre: 2 }, { valeur: '10.000', nombre: 1 }, { valeur: '5.000', nombre: 1 },
      { valeur: '2.000', nombre: 1 }, { valeur: '0.200', nombre: 1 }, { valeur: '0.050', nombre: 1 }, { valeur: '0.020', nombre: 2 }] });
    // La bande imprimée du Z le dit aussi. (Elle s'imprime par une fenêtre du navigateur : on la lit.)
    await p.evaluate(() => { const w = window as unknown as { __imprime?: string; open: unknown };
      w.open = () => ({ document: { write: (html: string) => { w.__imprime = html; }, close: () => undefined }, print: () => undefined }); });
    await p.locator('#modal-root #cs-z-imprimer').click();
    await expect.poll(() => p.evaluate(() => (window as unknown as { __imprime?: string }).__imprime ?? ''), { timeout: 5_000 }).toContain('Z de caisse');
    const bande = net((await p.evaluate(() => (window as unknown as { __imprime?: string }).__imprime ?? '')).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
    expect(bande).toContain('2 × 20 DT 40,000 DT');
    expect(bande).toContain('2 × 20 millimes 0,040 DT');
    await p.locator('#modal-root #cs-z-ok').click();
    await expect.poll(() => texte(p, '#cs-fermee h2'), { timeout: 10_000 }).toBe('La caisse est fermée.');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('au téléphone : le ticket se replie sous les tuiles, et le tiroir se compte par un pavé dans une fenêtre', async () => {
    const { jeton, ent } = await epicerie();
    expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, jeton, { fond: '0' })).statut).toBe(200);
    const { cx, p, erreurs } = await ouvrirPage(jeton, ent, { largeur: 390, hauteur: 844, doigt: true });
    await p.locator('#cs-articles .cs-art', { hasText: 'Lait demi-écrémé' }).click();
    await p.locator('#cs-articles .cs-art', { hasText: 'Lait demi-écrémé' }).click();
    // Replié : son titre, ses lignes en bref (la quantité devant le nom), son total, « Encaisser » ; pas les boutons.
    expect(await texte(p, '#cs-ticket-tirer')).toBe('Ticket · 2 articles Tout voir');
    expect(await texte(p, '#cs-zone .ct-ligne .ct-ligne-nom b')).toBe('2 × Lait demi-écrémé 1 L');
    expect(await p.locator('#cs-zone [data-plus]').isVisible()).toBe(false);
    expect(await p.locator('#cs-encaisser').isVisible()).toBe(true);
    // Le ticket, collé en bas de l'écran.
    const ticket = await p.locator('#cs-ticket').boundingBox();
    expect(Math.round((ticket?.y ?? 0) + (ticket?.height ?? 0))).toBe(844);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'tactile-5-telephone.png') });
    await p.locator('#cs-ticket-tirer').click();
    expect(await p.locator('#cs-zone [data-plus]').isVisible()).toBe(true);
    expect(await texte(p, '#cs-ticket-tirer')).toBe('Ticket · 2 articles Replier');

    // Le paiement, au doigt : chaque bouton et chaque champ fait au moins 44 × 44, et rien ne dépasse de l'écran.
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-paiement').waitFor();
    const petits = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>('#cs-body button, #cs-body input')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.width < 44 || r.height < 44);
    }).map((e) => `${e.id || e.dataset.mode || e.dataset.touche || e.dataset.billet || e.textContent?.trim()} ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`));
    expect(petits).toEqual([]);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await p.locator('#cs-revenir').click();

    // Le soir : une coupure touchée demande son nombre dans une fenêtre (le pavé de la colonne serait loin sous la liste).
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-fermer').click();
    expect(await p.locator('#cs-pave-compte').isVisible()).toBe(false);
    await p.locator('[data-coupure="1"]').click();
    expect(await texte(p, '#modal-root h2')).toBe('Billets de 20 dinars');
    // Un nombre de billets n'a pas de virgule.
    expect(await p.locator('#modal-root [data-touche=","]').count()).toBe(0);
    for (const k of ['3']) await p.locator(`#modal-root [data-touche="${k}"]`).click();
    await p.locator('#modal-root #pv-ok').click();
    await expect.poll(() => texte(p, '#cs-compte-total')).toBe('60,000 DT');
    expect(await p.locator('[data-coupure="1"]').getAttribute('aria-label')).toBe('Billets de 20 dinars : 3');
    // La barre du haut tient sur une ligne : « ‹ Vente » à la place du titre.
    expect(await texte(p, '#cs-revenir-vente')).toBe('‹ Vente');
    const barre = await p.locator('.ct-tete').boundingBox(), onglets = await p.locator('#cs-tabs').boundingBox(), menu = await p.locator('#cs-menu-bouton').boundingBox();
    expect((menu?.y ?? 0) + (menu?.height ?? 0)).toBeLessThanOrEqual(onglets?.y ?? 0);
    expect(barre?.height).toBeLessThan(130);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'tactile-6-telephone-comptage.png') });
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 120_000);
});
