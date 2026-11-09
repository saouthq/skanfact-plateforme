// Les Relances, les Échéances et le Tableau de bord du Cabinet (1.334.0), à la souris. Joués par Leïla, associée, et Rim,
// en Saisie : trois écrans posaient la même question (« à qui manque-t-il des pièces ? ») et ne répondaient pas pareil.
// Ce que le parcours vérifie :
//   - un client qui a envoyé des pièces attend qu'on les classe, pas une relance ; un client relancé ce matin attend sa
//     réponse : ni le vert, ni « Relancer tout le monde », ni « À faire maintenant » ne les visent ; la page le dit ;
//   - une relance partie de la conversation se note « dans la conversation », celles d'avant aussi (leur note le dit) ;
//   - un client sur SkanFact ne se voit demander que ses relevés ; une pièce déjà demandée ne se redemande pas ;
//   - la légende d'une déclaration dit « préparée, à déposer » et « à préparer » ; une échéance lointaine n'est pas rouge ;
//   - « Les miens » : Leïla ne lit à relancer que le dossier qu'elle tient, Rim le sien ; la pastille compte pareil.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('(1.334.0) les Relances et les Échéances du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-rel-'));
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

  // Le navigateur vit au 29/10/2026 : septembre est le dernier mois fini, sa déclaration est en retard d'un jour. Le serveur
  // vit au vrai jour : une pièce demandée « pour le » se date d'un jour à venir pour lui.
  const LE_29 = new Date('2026-10-29T10:00:00+01:00');
  const LE_9_NOV = new Date('2026-11-09T10:00:00+01:00');
  const AVENIR = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  // Une vraie photo PNG d'un pixel : le serveur la reconnaît à ses premiers octets.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // Un cabinet de deux personnes (Leïla, associée ; Rim, saisie, à qui la librairie est confiée) et six clients sur SkanFact,
  // tenus depuis août. Septembre manque à quatre : la librairie, le café (qui a envoyé une photo de son relevé, à classer),
  // l'atelier (relancé ce matin dans sa conversation) et la boutique (relancée hier, notée « autre » avant la 1.334.0). La
  // menuiserie a son septembre validé (sa déclaration est à préparer), la pâtisserie l'a préparée (à déposer). L'atelier
  // passe premier des lignes « sans rien » d'une échéance (l'ordre est alphabétique) : le vert l'aurait, sans la règle.
  // Leïla tient le café (« Les miens »).
  async function unCabinet() {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const rim = await personne('Rim Toumi');
    const inv = (await api('POST', `/cabinets/${cab.id}/invitations`, associe, { email: rim.email, role: 'saisie' })).corps as { jeton: string };
    expect((await api('POST', '/invitations/accepter', rim.jeton, { jeton: inv.jeton })).statut).toBe(200);
    const ecriture = async (ent: string, jour: string, piece: string) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: jour, journal: 'OD', piece, libelle: 'Honoraires',
        lignes: [{ compte: '6226', debit: '100,000' }, { compte: '401', credit: '100,000' }] });
      expect(r.statut).toBe(201);
      expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [String(r.corps.id)] })).statut).toBe(200);
    };
    const client = async (nom: string, gerant: string, septembre = false) => {
      const g = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', g.jeton, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, g.jeton, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      await ecriture(ent, '2026-08-14', 'OD-1');
      if (septembre) await ecriture(ent, '2026-09-15', 'OD-2');
      return { j: g.jeton, ent, mandat };
    };
    const librairie = await client('Librairie Ennour', 'Hela Ben Salah');
    const cafe = await client('Café des Nattes', 'Sami Kefi');
    const atelier = await client('Atelier Ennasr', 'Nizar Gharbi');
    const boutique = await client('Boutique Salma', 'Salma Riahi');
    await client('Menuiserie Ben Ali', 'Karim Ben Ali', true);
    const patisserie = await client('Pâtisserie Masmoudi', 'Fatma Masmoudi', true);
    expect((await api('PUT', `/entreprises/${patisserie.ent}/compta/declarations/2026-09`, associe, { cases: { tvaCollectee: '19,000' } })).statut).toBe(200);
    // Le café envoie la photo de son relevé, sans qu'on la lui ait demandée : elle arrive à classer.
    const depot = await api('POST', `/entreprises/${cafe.ent}/messages/fichiers`, cafe.j, { cote: 'entreprise', nom: 'releve-septembre.png', contenu: PNG });
    expect(depot.statut, JSON.stringify(depot.corps)).toBe(201);
    expect((await api('POST', `/entreprises/${cafe.ent}/messages`, cafe.j, { cote: 'entreprise', texte: 'Mon relevé de septembre.', fichier: depot.corps.id })).statut).toBe(201);
    // L'atelier, relancé ce matin dans sa conversation ; la boutique hier (une relance notée « autre » avant la 1.334.0).
    const relance = (at: number, via: string) => ({ contenu: { relances: [{ at, via, months: ['2026-09'], note: 'Relance envoyée dans la conversation SkanFact' }] }, revision: null });
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${atelier.ent}`, associe, relance(LE_29.getTime() - 3_600_000, 'conversation'))).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${boutique.ent}`, associe, relance(LE_29.getTime() - 86_400_000, 'autre'))).statut).toBe(200);
    // La librairie est confiée à Rim.
    const eq = (await api('GET', `/cabinets/${cab.id}/equipe`, associe)).corps as { membres: { membre: string; nom: string }[] };
    const membreRim = eq.membres.find((m) => m.nom === 'Rim Toumi')?.membre;
    expect(membreRim).toBeTruthy();
    expect((await api('PUT', `/cabinets/${cab.id}/mandats/${librairie.mandat}/affectations/${membreRim}`, associe, { role: 'saisie' })).statut).toBeLessThan(300);
    const membreLeila = eq.membres.find((m) => m.nom === 'Leïla Jlassi')?.membre;
    expect(membreLeila).toBeTruthy();
    expect((await api('PUT', `/cabinets/${cab.id}/mandats/${cafe.mandat}/affectations/${membreLeila}`, associe, { role: 'revision' })).statut).toBeLessThan(300);
    return { associe, rim: rim.jeton, cab, librairie, cafe, atelier, boutique };
  }
  async function page(jeton: string, quand = LE_29) {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(quand);
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { cx, p, erreurs };
  }
  async function aller(p: Page, cabinet: string, hash: string, attendre: string, porteeVoulue: 'tous' | 'miens' = 'tous') {
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${hash}`);
    await p.locator(attendre).first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    // Les dossiers que la page regarde (Leïla) : « Tous » d'habitude, « Les miens » quand on le demande.
    const bascule = p.locator(`[data-portee-page="${porteeVoulue}"][aria-pressed="false"]`);
    if (await bascule.count()) await bascule.first().click();
  }

  it('Relances : la phrase de la page, ni le vert ni le groupe vers un client qui a envoyé ses pièces ou relancé ce matin ; la relance repartie ne redemande pas la même pièce', async () => {
    const { associe, cab, librairie, cafe } = await unCabinet();
    const { p, erreurs } = await page(associe);
    await aller(p, cab.id, '#/relances', '#page-rel h1');
    const phrase = p.locator('#rl-phrase');
    // Quatre clients sans septembre ; la page dit lesquels attendent autre chose qu'une relance.
    await expect.poll(() => phrase.innerText().catch(() => ''), { timeout: 20_000 }).toBe('4 clients à qui il manque un mois · 1 relancé aujourd\'hui · 1 a envoyé des pièces, à classer');
    expect(await p.locator('#page-rel .ctx-cab').innerText()).toMatch(/^Mon cabinet · les 6 dossiers du cabinet/);
    expect(await p.locator('#nav-relances').innerText()).toBe('4');
    // Le groupe ne relance que les deux qui attendent une relance ; aucun vert sur les lignes (le groupe est l'étape suivante).
    expect(await p.locator('#group').innerText()).toBe('Relancer 2 clients');
    const corps = p.locator('#page-rel table.list tbody');
    expect(await corps.locator('.btn-primary').count()).toBe(0);
    const ligne = (nom: string) => corps.locator('tr').filter({ hasText: nom });
    // Le café : ses pièces à classer, et le geste qui les ouvre (pas « Écrire »).
    expect(await ligne('Café des Nattes').innerText()).toMatch(/1 pièce reçue, à classer/);
    expect(await ligne('Café des Nattes').getByRole('button', { name: 'Ouvrir les pièces', exact: true }).count()).toBe(1);
    expect(await ligne('Café des Nattes').getByRole('button', { name: 'Écrire', exact: true }).count()).toBe(0);
    // La relance partie de la conversation se dit ainsi, celle d'avant la 1.334.0 aussi (sa note le dit).
    expect(await ligne('Atelier Ennasr').innerText()).toMatch(/dans la conversation\)/);
    expect(await ligne('Boutique Salma').innerText()).toMatch(/dans la conversation\)/);
    // Le groupe commence par un des deux, jamais par le café ni l'atelier.
    await p.locator('#group').click();
    const fen = p.locator('#modal-root');
    await expect.poll(() => fen.locator('h2').first().innerText()).toMatch(/^Relancer (Librairie Ennour|Boutique Salma)$/);
    await p.goto('about:blank');

    // Relancer la librairie, dans sa conversation : une seule pièce demandée, ses relevés (ses ventes et ses achats, elle les
    // enregistre : le message le lui dit).
    await aller(p, cab.id, '#/relances', '#page-rel h1');
    await expect.poll(() => phrase.innerText().catch(() => ''), { timeout: 20_000 }).toMatch(/^4 clients/);
    await ligne('Librairie Ennour').getByRole('button', { name: 'Écrire', exact: true }).click();
    await expect.poll(() => fen.locator('h2').first().innerText()).toBe('Relancer Librairie Ennour');
    expect(await fen.locator('[data-ec-att]').evaluateAll((l) => l.map((x) => (x.closest('label') ?? x.parentElement)?.textContent?.trim()))).toEqual([expect.stringMatching(/^Vos relevés bancaires de septembre/)]);
    await fen.locator('#ec-pour').fill(AVENIR);
    await fen.getByRole('button', { name: 'Envoyer dans sa conversation' }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 15_000 }).toMatch(/^Relance partie à Librairie Ennour : 1 demande pour le \d\d\/\d\d\.$/);
    // Elle est notée « dans la conversation » sur sa fiche, au serveur.
    const relances = async () => ((await api('GET', `/cabinets/${cab.id}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { relances?: { via: string }[] } }[])
      .find((f) => f.entreprise === librairie.ent)?.contenu.relances ?? [];
    await expect.poll(async () => (await relances()).map((r) => r.via), { timeout: 15_000 }).toEqual(['conversation']);
    // Relancée ce matin : la page le compte, la boutique reste seule à relancer et prend le vert.
    await expect.poll(() => phrase.innerText().catch(() => ''), { timeout: 15_000 }).toBe('4 clients à qui il manque un mois · 2 relancés aujourd\'hui · 1 a envoyé des pièces, à classer');
    expect(await p.locator('#group').count()).toBe(0);
    expect(await ligne('Boutique Salma').locator('.btn-primary').innerText()).toBe('Écrire');
    // Relancée encore : ses relevés sont déjà demandés et pas reçus, ils ne se redemandent pas.
    await ligne('Librairie Ennour').getByRole('button', { name: 'Écrire', exact: true }).click();
    await fen.locator('#ec-pour').fill(AVENIR);
    await fen.getByRole('button', { name: 'Envoyer dans sa conversation' }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 15_000 }).toBe('Relance partie à Librairie Ennour : 1 pièce déjà demandée, pas redemandée.');
    const demandes = async () => ((await api('GET', `/entreprises/${librairie.ent}/messages?cote=entreprise`, librairie.j)).corps as { messages: { demande: { texte: string; recueLe: string | null } | null }[] })
      .messages.filter((m) => m.demande && !m.demande.recueLe).map((m) => m.demande?.texte);
    await expect.poll(demandes, { timeout: 15_000 }).toEqual(['Vos relevés bancaires de septembre']);

    // « Ouvrir les pièces » du café mène à ses pièces reçues.
    await ligne('Café des Nattes').getByRole('button', { name: 'Ouvrir les pièces', exact: true }).click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/pieces/${cafe.ent}`);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('Échéances et Tableau de bord : la légende dit préparée et à préparer, le vert ne relance pas deux fois, une échéance lointaine n\'est pas rouge', async () => {
    const { associe, cab } = await unCabinet();
    const { cx, p, erreurs } = await page(associe);
    await aller(p, cab.id, '#/echeances', '#page-ech .ec-i');
    await p.locator('#page-ech .ec-i').filter({ hasText: 'Déclaration de septembre' }).click();
    const det = p.locator('#page-ech .ec-det');
    await expect.poll(() => det.locator('h2').first().innerText()).toBe('Déclaration de septembre 2026');
    // « 2 prêtes à déposer » comptait celle qui reste à préparer : la légende dit chacune.
    await expect.poll(() => det.locator('.ec-som-l').innerText(), { timeout: 15_000 }).toMatch(/1 préparée, à déposer/);
    expect(await det.locator('.ec-som-l').innerText()).toMatch(/1 à préparer/);
    expect(await det.locator('.ec-som-l').innerText()).not.toMatch(/prêtes? à déposer/);
    // L'atelier, relancé ce matin : la ligne le dit, et son « Relancer » n'est pas l'étape suivante.
    const ligne = (nom: string) => det.locator('.ec-r').filter({ hasText: nom });
    await expect.poll(() => ligne('Atelier Ennasr').innerText(), { timeout: 15_000 }).toMatch(/relancé aujourd'hui, dans la conversation/);
    expect(await ligne('Atelier Ennasr').locator('.btn-primary').count()).toBe(0);
    expect(await ligne('Boutique Salma').innerText()).toMatch(/relancé hier, dans la conversation/);
    expect(await det.locator('.ec-r .btn-primary').count()).toBe(1);

    // Le Tableau de bord : le café, ses pièces à classer (urgent, « Classer ») ; l'atelier relancé ce matin attend sa réponse.
    await aller(p, cab.id, '#/production', '#tb-afaire');
    if (await p.locator('#tb-avoir[aria-expanded="false"]').count()) await p.locator('#tb-avoir').click();
    const lp = (nom: string, sous: RegExp) => p.locator('#page-bord .afaire-ligne').filter({ hasText: nom }).filter({ hasText: sous });
    await expect.poll(() => lp('Café des Nattes', /à classer/).count(), { timeout: 20_000 }).toBe(1);
    expect(await lp('Café des Nattes', /à classer/).innerText()).toMatch(/1 mois sans écriture[\s\S]*septembre 2026 · 1 pièce reçue, à classer[\s\S]*urgent/);
    expect(await lp('Café des Nattes', /à classer/).getByRole('button').innerText()).toBe('Classer');
    expect(await lp('Atelier Ennasr', /relancé aujourd'hui, dans la conversation/).innerText()).toMatch(/à voir/);
    expect(await lp('Atelier Ennasr', /relancé aujourd'hui/).getByRole('button').innerText()).toBe('Sa conversation');
    expect(await lp('Librairie Ennour', /sans écriture/).getByRole('button').innerText()).toBe('Demander…');

    // Le 9 novembre : la déclaration d'octobre est due dans dix-neuf jours. Sa carte est grise, sa barre aussi (elle était
    // toute rouge sous un titre gris).
    await cx.clock.setFixedTime(LE_9_NOV);
    await aller(p, cab.id, '#/echeances', '#page-ech .ec-i');
    const octobre = p.locator('#page-ech .ec-i').filter({ hasText: /Déclaration d.octobre/ });
    await expect.poll(() => octobre.getAttribute('class'), { timeout: 15_000 }).toMatch(/\bgris\b/);
    expect(await octobre.locator('.ec-bar b.gris').count()).toBe(1);
    expect(await octobre.locator('.ec-bar b.rouge').count()).toBe(0);
    // Septembre, en retard, reste rouge.
    expect(await p.locator('#page-ech .ec-i').filter({ hasText: 'Déclaration de septembre' }).locator('.ec-bar b.rouge').count()).toBe(1);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('(1.335.0) les pièces reçues arrivées après la page : les Relances et les Échéances se redessinent, le vert et le groupe quittent le client qui en a envoyé', async () => {
    const { associe, cab } = await unCabinet();
    const { p, erreurs } = await page(associe);
    // Un réseau lent : la liste des pièces reçues arrive après le dessin de la page.
    const retenir = async () => {
      let lacher = () => {};
      const retenue = new Promise<void>((ok) => { lacher = ok; });
      await p.route(/\/cabinets\/[^/]+\/pieces$/, async (r) => { await retenue; await r.continue().catch(() => undefined); });
      return () => { lacher(); };
    };
    let lacher = await retenir();
    await aller(p, cab.id, '#/relances', '#page-rel h1');
    const phrase = p.locator('#rl-phrase');
    await expect.poll(() => phrase.innerText().catch(() => ''), { timeout: 20_000 }).toBe('4 clients à qui il manque un mois · 1 relancé aujourd\'hui');
    expect(await p.locator('#group').innerText()).toBe('Relancer 3 clients');
    lacher();
    await expect.poll(() => phrase.innerText().catch(() => ''), { timeout: 20_000 }).toBe('4 clients à qui il manque un mois · 1 relancé aujourd\'hui · 1 a envoyé des pièces, à classer');
    expect(await p.locator('#group').innerText()).toBe('Relancer 2 clients');
    // Les Échéances : la ligne du café dit ses pièces à classer dès qu'elles arrivent.
    await p.unroute(/\/cabinets\/[^/]+\/pieces$/);
    lacher = await retenir();
    await aller(p, cab.id, '#/echeances', '#page-ech .ec-i');
    await p.locator('#page-ech .ec-i').filter({ hasText: 'Déclaration de septembre' }).click();
    const cafe = p.locator('#page-ech .ec-det .ec-r').filter({ hasText: 'Café des Nattes' });
    await expect.poll(() => cafe.innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/Café des Nattes/);
    expect(await cafe.innerText()).not.toMatch(/à classer/);
    lacher();
    await expect.poll(() => cafe.innerText().catch(() => ''), { timeout: 20_000 }).toMatch(/1 pièce reçue, à classer/);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('« Les miens » : les Relances de Leïla ne parlent que du dossier qu\'elle tient ; celles de Rim, que du sien', async () => {
    const { associe, rim, cab, cafe } = await unCabinet();
    // Leïla, en « Les miens » : le café seul, qui a envoyé ses pièces ; la pastille compte la même chose.
    const l = await page(associe);
    await aller(l.p, cab.id, '#/relances', '#page-rel h1', 'miens');
    const lignes = l.p.locator('#page-rel table.list tbody tr');
    await expect.poll(() => lignes.allInnerTexts().catch(() => []), { timeout: 20_000 }).toEqual([expect.stringMatching(/Café des Nattes/)]);
    expect(await l.p.locator('#page-rel .ctx-cab').innerText()).toMatch(/^Mon cabinet · 1 dossier que tu tiens/);
    expect(await l.p.locator('#rl-phrase').innerText()).toBe('1 client à qui il manque un mois · 1 a envoyé des pièces, à classer');
    await expect.poll(() => l.p.locator('#nav-relances').innerText()).toBe('1');
    expect(await l.p.locator('#group').count()).toBe(0);
    expect(await lignes.locator('.btn-primary').innerText()).toBe('Ouvrir les pièces');
    expect(await lignes.locator('[data-rl-pieces]').getAttribute('data-rl-pieces')).toBe(cafe.ent);
    expect(l.erreurs).toEqual([]);

    // Rim, en Saisie : la librairie, confiée.
    const { p, erreurs } = await page(rim);
    await aller(p, cab.id, '#/relances', '#page-rel h1');
    const corps = p.locator('#page-rel table.list tbody');
    await expect.poll(() => corps.locator('tr').allInnerTexts().catch(() => []), { timeout: 20_000 }).toEqual([expect.stringMatching(/Librairie Ennour/)]);
    expect(await p.locator('#page-rel .ctx-cab').innerText()).toMatch(/^Mon cabinet · 1 dossier confié/);
    expect(await p.locator('#rl-phrase').innerText()).toBe('1 client à qui il manque un mois');
    expect(await p.locator('#nav-relances').innerText()).toBe('1');
    // Un seul client : pas de groupe, son « Écrire » est l'étape suivante.
    expect(await p.locator('#group').count()).toBe(0);
    expect(await corps.locator('.btn-primary').innerText()).toBe('Écrire');
    expect(erreurs).toEqual([]);
  }, 180_000);
});
