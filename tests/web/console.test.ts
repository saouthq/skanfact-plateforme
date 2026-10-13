// La console de l'équipe SkanFact, à la souris (Console 1 ; docs/console.md ; serveur/console ; web/console). Ce que le
// parcours vérifie, écran ET serveur :
//   - l'entrée en deux étapes, le mot de passe puis le code du téléphone ; un membre sans code en place est refusé avec
//     la raison, sans qu'aucun champ ne soit montré faux (son mot de passe était bon) ;
//   - l'accueil : « À décider » le plus urgent en haut (le problème grave du service), ses filtres ; chaque chiffre du
//     tableau du matin ouvre la liste qu'il compte, du même nombre — les inscriptions de la semaine comprises, avec un
//     filtre qui se voit et se retire ;
//   - la fiche d'un client : « Prolonger l'essai », l'aperçu calculé au serveur, un motif exigé, puis l'essai prolongé
//     dans la base, son histoire (le motif, l'auteur) et sa ligne au journal ;
//   - le support : de 7 à 30 jours ; hors des bornes, l'aperçu le dit À SA PLACE (le motif ne bouge pas sous la souris),
//     un clic à côté ne ferme pas la fenêtre ; après son geste, la pastille de « À décider » se recompte, et le menu des
//     gestes, vide, n'est plus le bouton principal ;
//   - la technique : l'accueil et le service seulement ; « Clients » lui dit que ce n'est pas son rôle ;
//   - en clair et en sombre, à l'ordinateur (1440) et au téléphone (390) : l'instrument de rendu ne trouve rien ; en
//     langue factice, chaque texte vient du catalogue ;
//   - le service des écrans de l'application ne garde jamais la console.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { problemes } from '../instrument-rendu.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
// Le texte d'un écran, ses espaces (fines, insécables, retours) ramenées à une seule.
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const jourCourt = (iso: string) => iso.split('-').reverse().join('/');

// En langue factice, chaque texte visible vient du catalogue (⟦…⟧), sauf les données (data-donnee) ; chaque nom donné
// aux lecteurs d'écran aussi (tests/web/rendu.test.ts).
function horsCatalogue(): string[] {
  const pb: string[] = [];
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    const texte = (n.textContent ?? '').trim();
    if (!/\p{L}{2,}/u.test(texte) || n.parentElement?.closest('[data-donnee], script, style')) continue;
    if (!texte.includes('⟦')) pb.push(texte.slice(0, 60));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[aria-label]')) {
    if (!(el.getAttribute('aria-label') ?? '').includes('⟦')) pb.push(`aria-label « ${el.getAttribute('aria-label')} »`);
  }
  return pb;
}

type Membre = { email: string; prenom: string; nom: string; secret: string };

describe('la console de l\'équipe, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-veille-')), 'veille.json');
  const aujourdhui = aujourdhuiATunis();
  const erreurs: string[] = [];
  let n = 0;

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Un compte SkanFact, avec ou sans son code d'application ; dans l'équipe si on lui donne un rôle (par l'outil de
  // l'exploitation, comme le premier membre se pose).
  const membre = async (prenom: string, role: 'direction' | 'support' | 'technique', avecCode = true): Promise<Membre> => {
    const email = `console-web-${prenom.toLowerCase()}-${Date.now()}-${++n}@exemple.tn`;
    const nom = `${prenom} Essai`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = avecCode ? /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '' : '';
    await ajouterALEquipe(admin, email, role, 'essai de la console à la souris');
    return { email, prenom, nom, secret };
  };
  const code = (m: Membre) => codeTotp(depuisBase32(m.secret), Date.now());
  // Le jeton de la console d'un membre, par l'API (l'entrée à la souris se vérifie une fois, plus bas).
  const jetonConsole = async (m: Membre) => {
    const r = await api('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    const c = await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: code(m) });
    return String(c.corps.jeton);
  };
  // Une entreprise inventée, et l'état de son abonnement posé comme le temps l'aurait fait.
  const entreprise = async (nom: string, essaiDans: number, autre: { payeDans?: number; offre?: 'essentiel' | 'complet' } = {}) => {
    const email = `console-web-proprio-${Date.now()}-${++n}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: `Proprio ${n}`, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const id = String((await api('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = current_date + $2::int,
        paye_jusqu_au = case when $3::int is null then null else current_date + $3::int end, offre = $4, periodicite = $5 where entreprise = $1`,
    [id, essaiDans, autre.payeDans ?? null, autre.offre ?? null, autre.offre ? 'annuel' : null]);
    return id;
  };
  // Une page de la console, à une largeur, un thème et une langue, avec la session d'un membre.
  const ouvrir = async (jeton: string | null, hash: string, o: { largeur?: number; theme?: 'clair' | 'sombre'; factice?: boolean } = {}) => {
    const largeur = o.largeur ?? 1440;
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      if (j) sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jeton, o.theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${hash}`);
    await expect.poll(() => p.locator('h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const ecrire = (problemes: Record<string, unknown>) => fs.writeFileSync(veille, JSON.stringify({ problemes }));

  let direction: Membre, support: Membre, technique: Membre, sansCode: Membre;
  let essaiCalme = '', essaiSupport = '', enLecture = '';

  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    ecrire({
      disque: { titre: 'Le disque est plein à 82 %', grave: false, faire: 'Libère de la place avant 90 %.', depuis: new Date(Date.now() - 3 * 3600_000).toISOString() },
      sauvegarde: { titre: 'La copie hors machine de cette nuit n\'est pas arrivée', grave: true, faire: 'Relance la sauvegarde, puis vérifie la copie.', depuis: new Date(Date.now() - 40 * 60_000).toISOString() },
    });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    direction = await membre('Amira', 'direction');
    support = await membre('Karim', 'support');
    technique = await membre('Youssef', 'technique');
    sansCode = await membre('Salma', 'technique', false);
    essaiCalme = await entreprise('Quincaillerie de la Console', 2);
    essaiSupport = await entreprise('Boulangerie du Support', 2);
    enLecture = await entreprise('Pharmacie en Lecture Seule', -9);
    // Inscrite il y a plus d'une semaine : hors de la tuile « Inscriptions », pour que retirer son filtre se voie.
    const ancienne = await entreprise('Clinique Abonnée', -200, { payeDans: 160, offre: 'complet' });
    await admin.query('update socle.entreprise set cree_le = cree_le - interval \'200 days\' where id = $1', [ancienne]);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  // La veille écrit chaque minute : sans elle, au bout de cinq minutes, la console la dirait silencieuse.
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('l\'entrée : le mot de passe puis le code du téléphone ; sans code en place, la raison, et aucun champ montré faux', async () => {
    const p = await ouvrir(null, '#/');
    expect(net(await p.locator('h1').first().innerText())).toBe('Se connecter à la console');
    // Sans code du téléphone : refusé avec sa raison, « Ton compte » entre guillemets, et le mot de passe n'est pas faux.
    await p.getByLabel('Ton adresse e-mail', { exact: true }).fill(sansCode.email);
    await p.getByLabel('Ton mot de passe', { exact: true }).fill(MDP);
    await cliquer(p.getByRole('button', { name: 'Continuer', exact: true }));
    const refus = p.locator('.c-alerte-danger');
    await expect.poll(() => refus.innerText().catch(() => ''), { timeout: 10_000 }).toMatch(/code du téléphone/);
    expect(await refus.innerText()).toContain('«\u202fTon compte\u202f»');
    expect(await p.locator('.c-champ-faute').count()).toBe(0);
    // La direction : le mot de passe, puis le code de son application, et la console s'ouvre à son nom.
    await p.getByLabel('Ton adresse e-mail', { exact: true }).fill(direction.email);
    await cliquer(p.getByRole('button', { name: 'Continuer', exact: true }));
    await p.getByLabel('Le code', { exact: true }).fill(code(direction));
    await cliquer(p.getByRole('button', { name: 'Ouvrir la console', exact: true }));
    await expect.poll(() => p.locator('h1').first().innerText(), { timeout: 15_000 }).toBe(`Bonjour ${direction.prenom}`);
    expect(net(await p.locator('.c-trace').innerText())).toBe('Chaque geste est tracé, à ton nom.');
    await fermer(p);
  }, 60_000);

  it('l\'accueil : le plus urgent en haut, ses filtres, et chaque chiffre ouvre la liste qu\'il compte', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/');
    const decider = p.locator('.c-decider .c-ligne-decision');
    await expect.poll(() => decider.count(), { timeout: 15_000 }).toBeGreaterThan(1);
    // Le problème grave du service passe en tête, marqué urgent.
    expect(net(await decider.first().innerText())).toContain('La copie hors machine de cette nuit n\'est pas arrivée');
    expect(net(await decider.first().locator('.c-puce').first().innerText())).toBe('Urgent');
    // Le filtre « Clients » ne garde que les clients.
    await cliquer(p.locator('.c-decider .c-pilule', { hasText: 'Clients' }));
    await expect.poll(async () => (await decider.allInnerTexts()).some((t) => t.includes('La copie hors machine'))).toBe(false);
    // Un chiffre du tableau, et la liste qu'il ouvre : le même nombre.
    const totalDe = async (q: Page) => Number(/sur (\d+)/.exec(net(await q.locator('.c-liste-pied').innerText()))?.[1]);
    for (const [tuile, adresse] of [['En lecture seule', 'etat=lecture_seule'], ['Inscriptions', 'nouvelles=1']] as const) {
      await p.goto(`${serveur.adresse}/console/#/`);
      const t = p.locator('a.c-tuile', { hasText: tuile });
      await expect.poll(() => t.count(), { timeout: 15_000 }).toBe(1);
      const valeur = Number(await t.locator('.c-tuile-valeur').innerText());
      await cliquer(t);
      await expect.poll(() => p.evaluate(() => location.hash)).toContain(adresse);
      await expect.poll(() => totalDe(p).catch(() => NaN), { timeout: 15_000 }).toBe(valeur);
    }
    // Le filtre des inscriptions se voit, et se retire : la liste revient à toutes les entreprises.
    const nouvelles = await totalDe(p);
    await cliquer(p.getByRole('button', { name: 'Retirer ce filtre', exact: true }));
    await expect.poll(() => p.evaluate(() => location.hash)).not.toContain('nouvelles');
    await expect.poll(() => totalDe(p).catch(() => NaN), { timeout: 15_000 }).toBeGreaterThan(nouvelles);
    await fermer(p);
    void enLecture;
  }, 90_000);

  it('la fiche : prolonger un essai, avec l\'aperçu du serveur et un motif ; la base, l\'histoire et le journal le disent', async () => {
    const p = await ouvrir(await jetonConsole(direction), `#/clients/${essaiCalme}`);
    const finAvant = plusJours(aujourdhui, 2);
    await cliquer(p.locator('.c-menu > button'));
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Prolonger l\'essai' }));
    const fenetre = p.getByRole('dialog');
    await expect.poll(() => fenetre.count()).toBe(1);
    // L'aperçu : la fin d'après, calculée par le serveur (30 jours par défaut pour la direction).
    const apres = jourCourt(plusJours(finAvant, 30));
    await expect.poll(() => fenetre.locator('.c-apercu').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain(apres);
    // Sans motif : refusé, et le curseur va au motif.
    await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => fenetre.locator('.c-alerte-danger').innerText().catch(() => '')).toMatch(/motif/i);
    expect(await p.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
    await fenetre.getByLabel('Motif', { exact: true }).fill('Le client attend son comptable');
    await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => p.locator('#c-toast').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe('C\'est fait : essai prolongé.');
    await expect.poll(() => fenetre.count()).toBe(0);
    // La base, puis l'histoire de la fiche : le geste, le motif, l'auteur.
    const lu = (await admin.query('select essai_jusqu_au::text j from plateforme.abonnement where entreprise = $1', [essaiCalme])).rows[0] as { j: string };
    expect(lu.j).toBe(plusJours(finAvant, 30));
    const premier = p.locator('.c-histoire li').first();
    await expect.poll(() => premier.innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('Essai prolongé');
    expect(net(await premier.innerText())).toContain('Le client attend son comptable');
    expect(net(await premier.innerText())).toContain(direction.nom);
    // Le journal de la console : la même ligne, avec son motif.
    await p.goto(`${serveur.adresse}/console/#/journal?entreprise=${essaiCalme}`);
    const ligne = p.locator('.c-table tbody tr:not(.c-table-jour)').first();
    await expect.poll(() => ligne.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('Le client attend son comptable');
    expect(net(await ligne.innerText())).toContain('Essai prolongé');
    await p.screenshot({ path: path.join(PHOTOS, 'console-journal.png'), fullPage: true });
    await fermer(p);
  }, 90_000);

  it('le support : de 7 à 30 jours, dit à sa place ; un clic à côté ne ferme pas la fenêtre ; la pastille se recompte', async () => {
    const p = await ouvrir(await jetonConsole(support), `#/clients/${essaiSupport}`);
    // Le support ne voit que ses écrans : « À décider » et « Clients ».
    expect((await p.locator('.c-nav a').allInnerTexts()).map(net)).toEqual(expect.arrayContaining(['Clients']));
    expect((await p.locator('.c-nav a').allInnerTexts()).map(net).some((t) => /Équipe|Journal|Service/.test(t))).toBe(false);
    const pastille = p.locator('.c-nav-compte');
    await expect.poll(() => pastille.innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^\d+$/);
    const avant = Number(await pastille.innerText());
    await cliquer(p.locator('.c-menu > button'));
    expect(await p.locator('.c-menu-liste button').allInnerTexts()).toEqual(['Prolonger l\'essai']);
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Prolonger l\'essai' }));
    const fenetre = p.getByRole('dialog');
    const motif = fenetre.getByLabel('Motif', { exact: true });
    await expect.poll(() => fenetre.locator('.c-apercu').count(), { timeout: 10_000 }).toBe(1);
    const yAvant = (await motif.boundingBox())?.y ?? -1;
    // 45 jours : hors des bornes du support. L'aperçu le dit à sa place, le motif ne bouge pas, le geste est éteint.
    await fenetre.getByLabel('Nombre de jours', { exact: true }).fill('45');
    await expect.poll(() => fenetre.locator('.c-apercu-refus').innerText().then(net).catch(() => '')).toBe('De 7 à 30 jours pour le support : au-delà, c\'est la direction qui prolonge.');
    expect(Math.abs(((await motif.boundingBox())?.y ?? 0) - yAvant)).toBeLessThan(2);
    expect(await fenetre.locator('.c-dialogue-pied .c-btn-principal').isDisabled()).toBe(true);
    // Un clic à côté de la fenêtre : elle reste, avec ce qu'on a tapé.
    await p.mouse.click(8, 450);
    expect(await fenetre.count()).toBe(1);
    expect(await fenetre.getByLabel('Nombre de jours', { exact: true }).inputValue()).toBe('45');
    // 14 jours, un motif : le geste se fait.
    await fenetre.getByLabel('Nombre de jours', { exact: true }).fill('14');
    await expect.poll(() => fenetre.locator('.c-apercu').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain(jourCourt(plusJours(aujourdhui, 16)));
    await motif.fill('Le client attend son comptable');
    await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => fenetre.count(), { timeout: 10_000 }).toBe(0);
    // L'essai sans usage de la semaine n'est plus à décider : la pastille se recompte, sans changer de page.
    await expect.poll(() => pastille.innerText().then(Number).catch(() => 0), { timeout: 15_000 }).toBe(avant - 1);
    // Un second « prolonger » n'est plus permis au support : le menu le dit, et n'est plus le bouton principal.
    await expect.poll(() => p.locator('.c-menu > button').getAttribute('class'), { timeout: 10_000 }).not.toContain('c-btn-principal');
    await cliquer(p.locator('.c-menu > button'));
    expect(await p.locator('.c-menu-liste button').count()).toBe(0);
    expect(net(await p.locator('.c-menu-note').innerText())).toMatch(/une fois par entreprise/);
    await fermer(p);
  }, 90_000);

  it('la technique : l\'accueil et le service seulement ; les clients ne sont pas dans son rôle', async () => {
    const jeton = await jetonConsole(technique);
    const p = await ouvrir(jeton, '#/clients');
    expect(net(await p.locator('h1').first().innerText())).toBe('Cet écran n\'est pas dans ton rôle');
    expect((await p.locator('.c-nav a').allInnerTexts()).map(net).some((t) => /Clients|Équipe|Journal/.test(t))).toBe(false);
    await p.goto(`${serveur.adresse}/console/#/service`);
    const graves = p.locator('.c-ligne-decision');
    await expect.poll(() => graves.count(), { timeout: 15_000 }).toBe(2);
    expect(net(await graves.first().innerText())).toContain('La copie hors machine');
    expect(net(await graves.first().innerText())).toContain('Grave');
    // Le serveur aussi : aucun client pour la technique.
    expect((await api('GET', '/console/entreprises', jeton)).statut).toBe(403);
    await fermer(p);
  }, 60_000);

  it('en clair et en sombre, à l\'ordinateur et au téléphone : l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    const jeton = await jetonConsole(direction);
    const ECRANS: { nom: string; hash: string; geste?: (p: Page) => Promise<void> }[] = [
      { nom: 'accueil', hash: '#/' },
      { nom: 'clients', hash: '#/clients' },
      { nom: 'fiche', hash: `#/clients/${enLecture}` },
      { nom: 'geste', hash: `#/clients/${enLecture}`, geste: async (p) => { await cliquer(p.locator('.c-menu > button')); await cliquer(p.locator('.c-menu-liste button').first()); await p.getByRole('dialog').waitFor(); } },
      { nom: 'journal', hash: '#/journal' },
      { nom: 'equipe', hash: '#/equipe' },
      { nom: 'service', hash: '#/service' },
    ];
    const faux: string[] = [];
    let vus = 0;
    for (const largeur of [1440, 390]) {
      for (const theme of ['clair', 'sombre'] as const) {
        for (const e of [...ECRANS, ...(largeur < 600 ? [{ nom: 'menu', hash: '#/', geste: async (p: Page) => { await cliquer(p.locator('.c-menu-tel')); } }] : [])]) {
          const p = await ouvrir(jeton, e.hash, { largeur, theme });
          await expect.poll(() => p.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
          if (e.geste) await e.geste(p);
          await p.waitForTimeout(300);
          const nom = `console-${e.nom}-${largeur}-${theme}`;
          faux.push(...(await p.evaluate(problemes, [largeur < 600, largeur] as [boolean, number])).map((x) => `${nom} : ${x}`));
          await p.screenshot({ path: path.join(PHOTOS, `${nom}.png`), fullPage: true });
          vus++;
          await fermer(p);
        }
      }
    }
    // L'entrée, sans session, et chaque écran en langue factice.
    for (const e of [{ nom: 'entree', hash: '#/' }, ...ECRANS]) {
      const p = await ouvrir(e.nom === 'entree' ? null : jeton, e.hash, { factice: true });
      if (e.geste) await e.geste(p);
      await p.waitForTimeout(300);
      faux.push(...(await p.evaluate(horsCatalogue)).map((x) => `console-${e.nom}-factice : hors catalogue : ${x}`));
      faux.push(...(await p.evaluate(problemes, [false, 1440] as [boolean, number])).map((x) => `console-${e.nom}-factice : ${x}`));
      await fermer(p);
    }
    expect(faux).toEqual([]);
    expect(vus).toBe(ECRANS.length * 4 + 2);
    expect(erreurs).toEqual([]);
  }, 400_000);

  it('le service des écrans de l\'application ne garde jamais la console', async () => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await cx.newPage();
    await p.goto(`${serveur.adresse}/`);
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
    // La console visitée sous le service des écrans : ni sa page, ni ses fichiers ne se gardent.
    await p.goto(`${serveur.adresse}/console/`);
    await expect.poll(() => p.locator('h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await p.goto(`${serveur.adresse}/`);
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
    const gardes = await p.evaluate(async () => {
      const cles: string[] = [];
      for (const nom of await caches.keys()) for (const r of await (await caches.open(nom)).keys()) cles.push(new URL(r.url).pathname);
      return cles;
    });
    expect(gardes.length).toBeGreaterThan(0);
    expect(gardes.filter((c) => c === '/console' || c.startsWith('/console/'))).toEqual([]);
    await cx.close();
  }, 60_000);
});
