// L'accès du support au dossier, à la souris, des deux côtés (Support S2 ; docs/support.md ;
// web/console/src/ecrans/AccesDossier.tsx ; web/public/plateforme/acces.js et pont.js ; web/v10/acces-support.txt). Ce
// que le parcours vérifie :
//   - la console demande l'accès avec son motif, depuis la bande « Son dossier » de la conversation ; l'encart dit « en
//     attente » ;
//   - la propriétaire voit la demande en haut de son application, avec le motif, et l'accorde pour deux heures ; le
//     bandeau dit alors jusqu'à quand, et la console « accès en cours » ;
//   - « Ouvrir le dossier (lecture) » ouvre l'application du client, sur l'adresse de la console, avec la session de la
//     console : la bande ambrée le dit ; les pièces se lisent ; rien ne s'écrit (le pont refuse l'enregistrement, avant
//     d'appeler le serveur) ; rien ne se garde sur le poste ; chaque page ouverte est tracée ;
//   - la propriétaire voit les pages lues (« Le support de SkanFact », Paramètres › L'équipe), retire l'accès ; la page
//     suivante du support se ferme sur la raison, et ce qu'elle montrait disparaît ;
//   - au téléphone, rien ne déborde, chaque bouton se touche ; l'instrument ne trouve rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { problemes } from '../instrument-rendu.ts';
import { mesurerLaConsole, type EcranConsole } from './instrument-console.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const MOTIF = 'Voir ta facture du timbre, pour comprendre l\'écart';

describe('l\'accès du support au dossier, à la souris, des deux côtés', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-acces-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-acces-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jS = '', jClient = '', ent = '', demande = '', acces = '';
  let console1: Page | null = null;

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const consoleSur = async (hash: string, largeur = 1440, hauteur = 900, theme?: 'clair' | 'sombre', factice = false) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      // La session de la console vit dans l'onglet ; l'onglet de la lecture la reçoit de lui (window.open).
      if (location.pathname.startsWith('/console/')) sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jS, theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${factice ? '?langue=factice' : ''}${hash}`);
    await expect.poll(() => p.locator('.c-sp-acces').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => p.locator('.c-sp-acces[aria-busy]').count(), { timeout: 20_000 }).toBe(0);
    return p;
  };
  const client = async (hash: string, largeur = 1440, hauteur = 900) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jClient);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
    await expect.poll(() => p.locator('#view .page-head h1').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const bande = (p: Page) => p.locator('.c-sp-acces-bande');

  beforeAll(async () => {
    await admin.connect();
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = `acces-web-karim-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Karim Acces', motDePasse: MDP });
    const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', j, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'support', 'essai de l\'accès au dossier à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    jS = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const emailC = `acces-web-lina-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: emailC, nom: 'Lina Acces', motDePasse: MDP });
    jClient = String((await api('POST', '/connexion', undefined, { email: emailC, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    ent = String((await api('POST', '/entreprises', jClient, { raisonSociale: 'Studio Lina Acces' })).corps.id);
    // Un client dans son dossier : c'est lui que le support lira.
    await admin.query('insert into socle.dossier_v10 (entreprise, collection, cle, rang, contenu) values ($1, $2, $3, $4, $5)',
      [ent, 'clients', 'cl-acces', 0, JSON.stringify({ id: 'cl-acces', name: 'Hôtel Dar El Marsa' })]);
    demande = String((await api('POST', `/entreprises/${ent}/support`, jClient, { sujet: 'Le timbre fiscal sur ma facture', texte: 'Le timbre ne s\'ajoute pas sur ma facture de ce matin.' })).corps.id);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('la console demande l\'accès depuis la conversation, avec son motif ; l\'encart dit qu\'il attend', async () => {
    const p = await consoleSur(`#/support?demande=${demande}`);
    expect(net(await bande(p).innerText())).toContain('Le support ne voit pas le dossier du client sans son accord');
    await cliquer(bande(p).getByRole('button', { name: /Demander l'accès au dossier/ }));
    const fenetre = p.getByRole('dialog');
    await fenetre.waitFor();
    // Un motif vide est refusé, en le disant.
    await cliquer(fenetre.getByRole('button', { name: 'Envoyer la demande' }));
    await expect.poll(async () => net(await fenetre.innerText())).toContain('trois caractères au moins');
    // Le refus se dit sur le champ, sans aller-retour au serveur : il est marqué, et rien n'est parti. Le champ se marque un
    // rendu après la phrase (ui.tsx, useFaute) : on l'attend, sinon une machine lente le lit entre les deux.
    await expect.poll(() => fenetre.locator('textarea').getAttribute('aria-invalid')).toBe('true');
    expect((await admin.query('select count(*)::int n from plateforme.acces_support where entreprise = $1', [ent])).rows[0]?.n).toBe(0);
    await fenetre.locator('textarea').fill(MOTIF);
    await cliquer(fenetre.getByRole('button', { name: 'Envoyer la demande' }));
    await expect.poll(() => fenetre.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => net(await bande(p).innerText()), { timeout: 10_000 }).toMatch(/En attente.*Accès au dossier demandé aujourd'hui/);
    acces = String((await admin.query('select id from plateforme.acces_support where entreprise = $1', [ent])).rows[0]?.id ?? '');
    expect(acces).toMatch(/^[0-9a-f-]{36}$/);
    console1 = p;
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('la propriétaire voit la demande en haut de son application, et l\'accorde pour deux heures ; la console le voit', async () => {
    const c = await client('#/dashboard');
    const b = c.locator('.acc-bandeau.acc-demande');
    await expect.poll(() => b.count(), { timeout: 15_000 }).toBe(1);
    expect(net(await b.innerText())).toContain(`L'équipe SkanFact demande à lire ton dossier Karim, du support : « ${MOTIF} » (ta demande S-`);
    expect(await b.locator('[data-acces-accorder]').allInnerTexts()).toEqual(['Accorder pour 2 heures', 'Accorder 24 heures', 'Accorder 48 heures']);
    await cliquer(b.getByRole('button', { name: 'Accorder pour 2 heures' }));
    await expect.poll(() => c.locator('.acc-bandeau.acc-actif').count(), { timeout: 10_000 }).toBe(1);
    // Accordé après 22 h, l'accès finit le lendemain, et chaque côté le dit (rouge de GitHub du 14/10/2026, lancé à 22 h 40) :
    // les deux formes sont justes.
    expect(net(await c.locator('.acc-bandeau.acc-actif').innerText())).toMatch(/Karim, du support SkanFact, peut lire ton dossier jusqu'à (demain, )?\d\d:\d\d Aucune page lue/);
    // La console, au retour sur l'onglet : l'accès court.
    const p = console1 ?? await consoleSur(`#/support?demande=${demande}`);
    await p.reload();
    await expect.poll(async () => net(await bande(p).innerText()), { timeout: 15_000 }).toMatch(/Accès au dossier Jusqu'(à|au .{1,20} à) \d\d:\d\d Encore 1 h 5\d · aucune page lue · accordé par Lina Acces/);
    // Sur un portable (1280×800), la bande d'un accès qui court tient sur une rangée : « Envoyer » reste à l'écran, la
    // page ne défile pas (vu le 14/10/2026 : sur deux rangées, elle poussait la réponse sous le bord).
    const petit = await consoleSur(`#/support?demande=${demande}`, 1280, 800);
    await expect.poll(async () => net(await bande(petit).innerText()), { timeout: 15_000 }).toContain('Accès au dossier');
    // Une rangée : la bande centre ses morceaux en hauteur, leurs milieux se confondent (leurs hauts, non : ils suivent la
    // hauteur des polices, 12 px ici, 12,56 sur GitHub). Sur deux rangées, les gestes passent sous le texte.
    const g = await petit.evaluate(() => {
      const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
      const milieu = (s: string) => { const x = r(s); return x ? x.top + x.height / 2 : null; };
      return { haut: innerHeight, defile: document.documentElement.scrollHeight - innerHeight, envoyer: r('.c-sp-repondre button[type="submit"]')?.bottom ?? null,
        bande: r('.c-sp-acces-bande')?.height ?? null, gestes: milieu('.c-sp-acces-bande .c-sp-acces-gestes'), quoi: milieu('.c-sp-acces-bande .c-sp-acces-quoi') };
    });
    expect(g.defile).toBeLessThanOrEqual(1);
    expect(g.envoyer ?? Infinity).toBeLessThanOrEqual(g.haut);
    expect(Math.abs((g.gestes ?? 0) - (g.quoi ?? 999))).toBeLessThanOrEqual(2);
    await fermer(petit);
    await fermer(c);
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('« Ouvrir le dossier (lecture) » : la bande le dit, les pièces se lisent, rien ne s\'écrit ni ne se garde, chaque page est tracée', async () => {
    const p = console1 ?? await consoleSur(`#/support?demande=${demande}`);
    // Le navigateur du support porte aussi, un jour, une session d'un compte client (le sien, sur la même adresse) : la
    // lecture ne garde pourtant rien sur le poste, quel que soit ce que ce navigateur connaît.
    await p.evaluate(() => localStorage.setItem('skanfact.jeton', 'une-session-cliente-de-ce-navigateur'));
    const [lecture] = await Promise.all([
      p.context().waitForEvent('page'),
      cliquer(bande(p).getByRole('button', { name: /Ouvrir en lecture/ })),
    ]);
    lecture.on('pageerror', (e) => erreurs.push(e.message));
    await expect.poll(() => lecture.locator('.lec-bandeau').count(), { timeout: 20_000 }).toBe(1);
    expect(lecture.url()).toContain(`support=${acces}`);
    // Le nom que la console montre (lu avec le dossier) : la fiche société de ce dossier est vide.
    expect(net(await lecture.locator('.lec-bandeau').innerText())).toMatch(/Lecture pour le support : le dossier de Studio Lina Acces Accordé jusqu'à (demain, )?\d\d:\d\d \(il reste 1 h 5\d\)\. Rien de ce que tu fais ici ne s'enregistre/);
    // Les clients du dossier se lisent.
    await lecture.evaluate(() => { location.hash = '#/clients'; });
    await expect.poll(async () => net(await lecture.locator('#view').innerText()), { timeout: 15_000 }).toContain('Hôtel Dar El Marsa');
    // La page n'est pas celle de qui la lit : elle n'invite pas à sa visite (vu par-dessus la fenêtre qui ferme la lecture).
    await lecture.waitForTimeout(800);
    expect(await lecture.locator('#guide-appel').count()).toBe(0);
    // Rien ne s'écrit : le pont refuse avant d'appeler le serveur ; ni le support, ni la messagerie ne s'y branchent.
    const essai = await lecture.evaluate(async () => {
      const w = window as unknown as { skanfact: { saveData: (d: unknown) => Promise<unknown>; support: unknown; messagerie: unknown; accesSupport: unknown }; SkanPoste: { garde: () => boolean } };
      let refus = '';
      try { await w.skanfact.saveData({ clients: [] }); } catch (e) { refus = (e as Error).message; }
      const bases = (await indexedDB.databases()).map((d) => d.name);
      return { refus, support: w.skanfact.support, messagerie: w.skanfact.messagerie, acces: w.skanfact.accesSupport, garde: w.SkanPoste.garde(), bases };
    });
    expect(essai).toEqual({ refus: 'Lecture pour le support : rien ne s\'enregistre ici, et rien ne part chez le client.', support: null, messagerie: null, acces: null, garde: false, bases: [] });
    const toujours = (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'clients'`, [ent])).rows;
    expect(toujours).toEqual([{ contenu: { id: 'cl-acces', name: 'Hôtel Dar El Marsa' } }]);
    // Chaque page ouverte est tracée, par son nom.
    await expect.poll(async () => (await admin.query('select page from plateforme.lecture_support where acces = $1 order by lu_le, id', [acces])).rows.map((r) => r.page), { timeout: 10_000 })
      .toEqual(['dashboard', 'clients']);
    await lecture.close();
    expect(erreurs).toEqual([]);
  }, 90_000);

  it('la propriétaire voit les pages lues et retire l\'accès ; la page suivante du support se ferme, et ce qu\'elle montrait disparaît', async () => {
    const p = console1 ?? await consoleSur(`#/support?demande=${demande}`);
    const [lecture] = await Promise.all([p.context().waitForEvent('page'), cliquer(bande(p).getByRole('button', { name: /Ouvrir en lecture/ }))]);
    lecture.on('pageerror', (e) => erreurs.push(e.message));
    await expect.poll(() => lecture.locator('.lec-bandeau').count(), { timeout: 20_000 }).toBe(1);
    const c = await client('#/dashboard');
    await expect.poll(() => c.locator('.acc-bandeau.acc-actif').count(), { timeout: 15_000 }).toBe(1);
    await cliquer(c.locator('.acc-bandeau').getByRole('button', { name: 'Voir ce qu\'il a lu' }));
    const panneau = c.locator('#p-acces-support');
    await expect.poll(async () => net(await panneau.innerText()), { timeout: 15_000 }).toMatch(/Karim Accès en cours, jusqu'à (demain, )?\d\d:\d\d.*accordé pour 2 heures par Lina Acces/);
    // Les pages notées, dans l'ordre, par leur nom dans l'application : celles de la base, ni plus ni moins (une page
    // relue dans la minute ne se note qu'une fois : l'accueil rouvert ici ne s'ajoute que si la minute est passée).
    const notees = (await admin.query('select page from plateforme.lecture_support where acces = $1 order by lu_le, id', [acces])).rows.map((r) => r.page as string);
    expect(notees.slice(0, 2)).toEqual(['dashboard', 'clients']);
    await expect.poll(() => panneau.locator('.acc-lu li > span:first-child').allInnerTexts()).toEqual(notees.map((n) => ({ dashboard: 'Accueil', clients: 'Clients' } as Record<string, string>)[n]));
    await cliquer(panneau.getByRole('button', { name: 'Retirer l\'accès' }));
    await expect.poll(async () => net(await panneau.innerText()), { timeout: 10_000 }).toMatch(/Retiré à \d\d:\d\d par Lina Acces/);
    await expect.poll(() => c.locator('.acc-bandeau').count()).toBe(0);
    // Le support change de page : la lecture se ferme sur la raison, et la page qu'il lisait disparaît.
    // Mesuré À L'INSTANT où la fenêtre se pose, avant tout autre dessin du routeur : sur une machine lente, la page
    // suivante se dessine après la fermeture et l'observateur l'efface aussi — il masquait alors un effacement
    // immédiat absent (la preuve restait verte sur GitHub, 20/10/2026).
    await lecture.evaluate(() => {
      const w = window as unknown as { vueALaFermeture?: number };
      new MutationObserver((_m, o) => {
        if (!document.querySelector('.lec-ferme')) return;
        w.vueALaFermeture = document.getElementById('view')?.childNodes.length ?? -1;
        o.disconnect();
      }).observe(document.body, { childList: true });
      location.hash = '#/devis';
    });
    const ferme = lecture.getByRole('alertdialog');
    await expect.poll(() => ferme.count(), { timeout: 15_000 }).toBe(1);
    expect(net(await ferme.innerText())).toContain('La lecture de ce dossier est fermée L\'entreprise a retiré cet accès. Rien n\'a été écrit chez le client.');
    expect(await lecture.evaluate(() => (window as unknown as { vueALaFermeture?: number }).vueALaFermeture)).toBe(0);
    await expect.poll(() => lecture.evaluate(() => document.getElementById('view')?.innerHTML ?? null)).toBe('');
    // Et ce que le routeur redessine ensuite (une autre page demandée derrière la fenêtre) ne revient pas.
    await lecture.evaluate(() => { location.hash = '#/clients'; });
    await lecture.waitForTimeout(500);
    expect(await lecture.evaluate(() => document.getElementById('view')?.innerHTML ?? null)).toBe('');
    // La console le dit, et propose de redemander.
    await p.reload();
    await expect.poll(async () => net(await bande(p).innerText()), { timeout: 15_000 }).toMatch(/Dernier accès au dossier retiré aujourd'hui, \d\d:\d\d par Lina Acces/);
    expect(await bande(p).getByRole('button', { name: /Redemander l'accès/ }).count()).toBe(1);
    await lecture.close();
    await fermer(c);
    expect(erreurs).toEqual([]);
  }, 90_000);

  it('au téléphone, rien ne déborde et chaque bouton se touche ; l\'instrument ne trouve rien, des deux côtés', async () => {
    // Une nouvelle demande, qui attend : le bandeau du client et la bande de la console dans cet état.
    expect((await api('POST', '/console/support/acces', jS, { entreprise: ent, demande, motif: 'Revoir la facture avec toi' })).statut).toBe(201);
    const ECRANS: EcranConsole[] = [
      { nom: 'acces-attente', hash: `#/support?demande=${demande}` },
      { nom: 'acces-fiche', hash: `#/clients/${ent}?onglet=support` },
      { nom: 'acces-demander', hash: `#/clients/${ent}?onglet=support`, geste: async (q) => { await cliquer(q.locator('.c-sp-acces .c-sp-acces-gestes button')); await q.getByRole('dialog').waitFor(); } },
    ];
    // La fenêtre « demander » ne s'ouvre que sans demande en cours : celle-ci se retire avant de mesurer l'écran qui l'ouvre.
    // Son bouton est le seul geste de l'encart d'un dossier fermé (la fiche le montre en bande depuis 1.19.0 ; en langue
    // factice, son nom change).
    const { faux, vus } = await mesurerLaConsole({
      ecrans: ECRANS.slice(0, 2),
      ouvrir: (e, o) => consoleSur(e.hash, o.largeur, o.largeur < 600 ? 844 : 900, o.theme, o.factice),
      photos: path.join(RACINE, 'dist/photos'),
    });
    expect(faux).toEqual([]);
    expect(vus).toBe(2 * 4);
    const pb: string[] = [];
    for (const largeur of [1440, 390]) {
      for (const sombre of [false, true]) {
        const c = await client('#/dashboard', largeur, largeur < 600 ? 844 : 900);
        await expect.poll(() => c.locator('.acc-bandeau.acc-demande').count(), { timeout: 15_000 }).toBe(1);
        if (sombre) await c.evaluate(() => document.body.classList.add('dark'));
        await c.waitForTimeout(300);
        pb.push(...(await c.evaluate(problemes, [largeur < 600, largeur] as [boolean, number])).map((x) => `client-acces-${largeur}-${sombre ? 'sombre' : 'clair'} : ${x}`));
        // Au doigt, chaque bouton du bandeau fait 44 points (sans la règle, 29 : on visait à côté).
        if (largeur < 600) {
          const petits = await c.evaluate(() => [...document.querySelectorAll('.acc-bandeau button, .acc-bandeau a.btn')]
            .map((b) => [b.textContent?.trim() ?? '', Math.round(b.getBoundingClientRect().height)] as const).filter(([, h]) => h < 44));
          pb.push(...petits.map(([t, h]) => `client-acces-390 : « ${t} » fait ${h} points`));
        }
        await fermer(c);
      }
    }
    expect(pb).toEqual([]);
    // Retirer cette demande, puis la fenêtre « Demander l'accès » à son tour.
    const id = String((await admin.query(`select id from plateforme.acces_support where entreprise = $1 and refuse_le is null and accorde_le is null and clos_le is null`, [ent])).rows[0]?.id);
    expect((await api('POST', `/console/support/acces/${id}/clore`, jS)).statut).toBe(200);
    const fenetre = await mesurerLaConsole({
      ecrans: ECRANS.slice(2),
      ouvrir: (e, o) => consoleSur(e.hash, o.largeur, o.largeur < 600 ? 844 : 900, o.theme, o.factice),
      photos: path.join(RACINE, 'dist/photos'),
    });
    expect(fenetre.faux).toEqual([]);
    expect(fenetre.vus).toBe(4);
    expect(erreurs).toEqual([]);
  }, 400_000);
});
