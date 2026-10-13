// « Le service » de la console, à la souris, sur de vraies mesures (Console 3 ; docs/console.md C12 ; serveur/console/
// service.ts ; web/console/src/ecrans/Service.tsx ; web/console/src/graphes.tsx). Les mesures passent par les VRAIES
// portes : les requêtes par la collecte du serveur (serveur/service/collecte.ts) puis plateforme.noter_requetes, la veille
// par plateforme.noter_veille, relevé après relevé, dans l'ordre du temps. Ce que le parcours vérifie :
//   - sous un graphique, jamais un texte sur un autre : sur chaque période, à l'ordinateur et au téléphone, les repères
//     qui se montrent ne se touchent pas, et restent réguliers (un sur k, jamais trois serrés puis un trou) ;
//   - un pas mesuré seul entre deux pas « trop peu » est un point, pas un trait flottant ;
//   - une mise en ligne suivie d'un retour, dans le même pas : l'étiquette nomme la première « +1 », la bulle les dit
//     dans l'ordre du temps, et le retour comme un retour ;
//   - la pastille de l'état des pannes reste sur la ligne de son titre, quelle que soit la période, et jusqu'à la plus
//     étroite des deux colonnes ;
//   - ce qui vient de se passer : chaque filtre compte ce qu'il montre ; une nuit dont la sauvegarde a échoué ne dit pas
//     sa copie « arrivée hors de la machine » (rien n'est parti).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { Collecte } from '../../serveur/service/collecte.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const MIN = 60_000, PAS = 600_000, JOUR = 86_400_000;

// Les repères d'un axe : ceux qui se montrent ne se touchent pas, et forment une suite régulière (un sur k). Le texte se
// mesure par son étendue, pas par sa case.
function axes(): string[] {
  const pb: string[] = [];
  for (const axe of document.querySelectorAll<HTMLElement>('.c-courbe-axe')) {
    const tous = [...axe.children] as HTMLElement[];
    const vus = tous.map((el, i) => ({ el, i })).filter(({ el }) => getComputedStyle(el).visibility !== 'hidden');
    if (tous.length && !vus.length) pb.push('un axe ne montre aucun repère');
    const boites = vus.map(({ el }) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); });
    for (let k = 1; k < boites.length; k++) {
      const a = boites[k - 1], b = boites[k];
      if (a && b && b.left < a.right + 2) pb.push(`« ${vus[k - 1]?.el.textContent} » touche « ${vus[k]?.el.textContent} »`);
    }
    const ecarts = vus.slice(1).map((v, k) => v.i - (vus[k]?.i ?? 0));
    if (new Set(ecarts).size > 1) pb.push(`repères irréguliers : ${vus.map((v) => v.el.textContent).join(', ')}`);
  }
  return pb;
}

type Membre = { email: string; secret: string };

describe('le service de la console, à la souris, sur de vraies mesures', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-service-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-service-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let direction: Membre;

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const jetonConsole = async (m: Membre) => {
    const r = await api('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    const c = await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(m.secret), Date.now()) });
    return String(c.corps.jeton);
  };
  const ouvrir = async (jeton: string, hash: string, largeur = 1440) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${hash}`);
    await expect.poll(() => p.locator('.c-courbe-axe').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const periode = async (p: Page, nom: string) => {
    const pilule = p.locator('.c-sv-periodes .c-pilule', { hasText: new RegExp(`^${nom.replace(' ', '\\s')}$`) });
    if (await pilule.getAttribute('aria-pressed') === 'true') return;
    const lue = p.waitForResponse((r) => r.url().includes('/console/service'));
    await cliquer(pilule);
    await lue;
    await expect.poll(() => pilule.getAttribute('aria-pressed')).toBe('true');
    await p.waitForTimeout(250);
  };

  // L'instant de début du pas `k` de la période de 24 heures (des pas de dix minutes), tel que le serveur le pose.
  const maintenant = Math.floor(Date.now() / MIN) * MIN;
  const depuis24h = Math.floor(maintenant / PAS) * PAS + PAS - JOUR;
  const pas = (k: number) => depuis24h + k * PAS;
  // La mise en ligne et le retour, dans un même pas : il y a plus de six heures.
  const S = pas(100);

  beforeAll(async () => {
    await admin.connect();
    // Les tests passent l'un après l'autre et partagent la base : celui-ci part de tables du service vides.
    await admin.query('truncate plateforme.service_minute, plateforme.service_heure, plateforme.service_route, plateforme.service_releve, plateforme.service_alerte, plateforme.service_nuit');
    // Les requêtes, par la collecte du serveur : un tracé dense (pas 60 à 100), un pas dense SEUL entre deux pas de cinq
    // lectures (pas 110), et la dernière heure — chaque lecture à 40 ms.
    const collecte = new Collecte();
    const lire = (debut: number, n: number) => { for (let i = 0; i < n; i++) collecte.noter('GET', '/moi', 200, 40, new Date(debut + MIN + i * 1000)); };
    for (let k = 60; k <= 100; k++) lire(pas(k), 30);
    lire(pas(109), 5); lire(pas(110), 30); lire(pas(111), 5);
    for (let m = 50; m >= 10; m--) lire(maintenant - m * MIN, 25);
    await admin.query('select plateforme.noter_requetes($1, $2::jsonb)', ['essai:1', JSON.stringify(collecte.prendre())]);
    // La veille, relevé après relevé : aaaaaaa tourne, bbbbbbb arrive et ouvre une alerte, on revient à aaaaaaa qui la
    // règle. La nuit d'hier a vu sa sauvegarde échouer (la veille, sans rien en attente, dirait sa copie « arrivée ») ;
    // celle d'avant-hier a tout fait.
    const releve = (t: number, version: string) => ({ minute: new Date(t).toISOString(), repond: true, charge: 0.4, memoire: 40, processeurs: 2, disques: [{ point: '/', pourcent: 41 }], version, certificat: null, archiveLe: null });
    const jour = (j: number) => new Date(maintenant + 3_600_000 - j * JOUR).toISOString().slice(0, 10);
    const aUneHeure = (j: number, h: string) => `${jour(j)}T${h}:00Z`;
    const disque = { 'disque:/': { titre: 'le disque / est plein à 80 %', grave: false, faire: 'Libère de la place.', depuis: new Date(S + 3 * MIN).toISOString() } };
    const nuits = [
      { jour: jour(1), copieDeBase: { le: aUneHeure(2, '23:31'), ok: true }, sauvegarde: { le: aUneHeure(1, '01:19'), ok: false, horsMachine: { le: aUneHeure(1, '01:40'), ok: true } } },
      { jour: jour(2), copieDeBase: { le: aUneHeure(3, '23:31'), ok: true }, sauvegarde: { le: aUneHeure(2, '01:19'), ok: true, horsMachine: { le: aUneHeure(2, '01:40'), ok: true } } },
    ];
    const noter = (r: unknown, problemes: unknown, n: unknown = []) =>
      admin.query('select plateforme.noter_veille($1::jsonb, $2::jsonb, $3::jsonb)', [JSON.stringify(r), JSON.stringify(problemes), JSON.stringify(n)]);
    await noter(releve(S + MIN, 'aaaaaaa'), {});
    await noter(releve(S + 3 * MIN, 'bbbbbbb'), disque);
    await noter(releve(S + 6 * MIN, 'aaaaaaa'), {}, nuits);
    await noter(releve(maintenant - 2 * MIN, 'aaaaaaa'), {});
    await noter(releve(maintenant - MIN, 'aaaaaaa'), {});
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    // Un membre de la direction, son code d'application en place.
    const email = `console-service-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amira Essai', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai du service à la souris');
    direction = { email, secret };
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });
  beforeEach(() => { fs.utimesSync(veille, new Date(), new Date()); });

  it('sous chaque graphique, sur chaque période, à l\'ordinateur et au téléphone : jamais un texte sur un autre, et des repères réguliers', async () => {
    const jeton = await jetonConsole(direction);
    const faux: string[] = [];
    for (const largeur of [1440, 390]) {
      const p = await ouvrir(jeton, '#/service', largeur);
      for (const nom of ['1 h', '24 h', '7 j', '30 j']) {
        await periode(p, nom);
        faux.push(...(await p.evaluate(axes)).map((x) => `${largeur}, ${nom} : ${x}`));
      }
      await fermer(p);
    }
    expect(faux).toEqual([]);
    expect(erreurs).toEqual([]);
  }, 90_000);

  it('un pas mesuré seul est un point ; une mise en ligne et son retour dans un même pas se lisent dans l\'ordre du temps', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/service');
    await periode(p, '24 h');
    // Le pas dense seul, entre deux pas de cinq lectures : un point du 95e centile, et un de la médiane.
    expect(await p.locator('.c-courbe-seul-p95').count()).toBe(1);
    expect(await p.locator('.c-courbe-seul-p50').count()).toBe(1);
    // L'étiquette nomme la première mise en ligne du pas, et dit qu'il y en a une autre.
    const marque = p.locator('.c-courbe-marque', { hasText: 'bbbbbbb' });
    expect(net(await marque.innerText())).toBe('bbbbbbb +1');
    // La bulle de ce pas : la mise en ligne, PUIS le retour.
    const trace = p.locator('.c-courbe-trace').first();
    await trace.scrollIntoViewIfNeeded();
    const t = await trace.boundingBox();
    const m = await marque.boundingBox();
    if (!t || !m) throw new Error('le tracé ou la marque ne se voit pas');
    await p.mouse.move(m.x + m.width / 2, t.y + t.height / 2);
    const bulle = p.locator('.c-courbe-trace .c-bulle');
    await expect.poll(() => bulle.count()).toBe(1);
    const texte = net(await bulle.innerText());
    expect(texte).toMatch(/mise en ligne bbbbbbb.*retour à aaaaaaa/);
    await fermer(p);
  }, 60_000);

  // La carte se tient en deux colonnes jusqu'à 1101 points (console.css, `.c-sv-graphes`) : c'est là que sa tête est la
  // plus étroite, et que le titre se replie plutôt que la pastille (à 1440, la place suffit même sans la règle).
  it('la pastille des pannes reste sur la ligne de son titre, quelle que soit la période, jusqu\'à la colonne la plus étroite', async () => {
    for (const largeur of [1440, 1101]) {
      const p = await ouvrir(await jetonConsole(direction), '#/service', largeur);
      const tete = p.locator('.c-sv-graphe-tete', { has: p.locator('h3', { hasText: 'Pannes du serveur' }) });
      for (const nom of ['1 h', '24 h', '7 j', '30 j']) {
        await periode(p, nom);
        const titre = await tete.locator('h3').boundingBox();
        const puce = await tete.locator('.c-puce').boundingBox();
        if (!titre || !puce) throw new Error(`${largeur}, ${nom} : le titre ou sa pastille ne se voit pas`);
        // Sa pastille commence à la hauteur du titre, à sa droite : jamais dessous.
        expect(Math.abs(puce.y - titre.y), `${largeur}, ${nom}`).toBeLessThan(8);
        expect(puce.x, `${largeur}, ${nom}`).toBeGreaterThan(titre.x + titre.width);
      }
      await fermer(p);
    }
  }, 90_000);

  it('ce qui vient de se passer : chaque filtre compte ce qu\'il montre ; une sauvegarde en échec n\'a rien envoyé', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/service');
    const carte = p.locator('section[aria-labelledby="sv-journal"]');
    const lignes = carte.locator('ol.c-sv-evenements > li');
    await expect.poll(() => lignes.count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const filtres = carte.locator('.c-sv-filtres .c-pilule');
    expect((await filtres.allInnerTexts()).map((x) => net(x).replace(/\s\d+$/, ''))).toEqual(['Tout', 'Alertes', 'Versions', 'Sauvegardes']);
    for (let i = 0; i < 4; i++) {
      const filtre = filtres.nth(i);
      const n = Number(net(await filtre.locator('.c-pilule-n').innerText()).replace(/\s/g, ''));
      await cliquer(filtre);
      await expect.poll(() => filtre.getAttribute('aria-pressed')).toBe('true');
      const plus = carte.getByRole('button', { name: /^Voir les \d+ autres$/ });
      if (await plus.count()) await cliquer(plus);
      await expect.poll(() => lignes.count()).toBe(n);
    }
    // Deux alertes (ouverte, puis réglée), deux mises en ligne (dont un retour), deux nuits.
    expect((await filtres.locator('.c-pilule-n').allInnerTexts()).map(Number)).toEqual([6, 2, 2, 2]);
    // Les sauvegardes : la nuit d'hier a échoué — sa copie hors de la machine n'est pas dite arrivée.
    await cliquer(filtres.nth(3));
    const quoi = carte.locator('ol.c-sv-evenements > li .c-sv-evt-quoi');
    const nuits = (await quoi.allInnerTexts()).map(net);
    expect(nuits[0]).toContain('sauvegarde en échec');
    expect(nuits[0]).not.toContain('arrivée hors de la machine');
    expect(nuits[1]).toContain('arrivée hors de la machine');
    // Les versions, de la plus récente : le retour, puis la mise en ligne.
    await cliquer(filtres.nth(2));
    expect((await quoi.allInnerTexts()).map(net)).toEqual(['Retour à aaaaaaa', 'Mise en ligne : bbbbbbb']);
    await fermer(p);
  }, 60_000);

  it('les performances : le budget des listes tenu, la route de la collecte comptée, triée, cherchée ; pas de comparaison sur trente jours', async () => {
    const p = await ouvrir(await jetonConsole(direction), '#/service/performances');
    const budgets = p.locator('section[aria-labelledby="pf-budgets"] tbody tr');
    await expect.poll(() => budgets.count(), { timeout: 15_000 }).toBe(7);
    // Les lectures de la collecte prennent 40 ms : le budget des listes (300 ms) est tenu ; ce qui se mesure sur le poste ne l'est pas.
    expect(net(await budgets.first().innerText())).toMatch(/Afficher une liste.*côté serveur.*300 ms.*40 ms.*Tenu/);
    expect(net(await budgets.last().innerText())).toMatch(/Non mesuré/);
    // La route de la collecte, avec toutes ses lectures (30 × 41 + 5 + 30 + 5 + 25 × 41).
    const routes = p.locator('section[aria-labelledby="pf-routes"]');
    const ligne = routes.locator('tbody tr', { hasText: '/moi' });
    expect(net(await ligne.innerText())).toContain('2 295');
    // Trier par appels : la colonne le dit, une seconde fois renverse.
    const appels = routes.getByRole('button', { name: 'Trier par « Appels »' });
    await cliquer(appels);
    await expect.poll(() => routes.locator('th[aria-sort]').innerText().then(net)).toMatch(/^appels/i);
    expect(await routes.locator('th[aria-sort]').getAttribute('aria-sort')).toBe('descending');
    await cliquer(appels);
    expect(await routes.locator('th[aria-sort]').getAttribute('aria-sort')).toBe('ascending');
    // Une recherche qui ne trouve rien le dit, et rend la liste d'un clic.
    await routes.getByRole('searchbox').fill('aucune-route-ainsi');
    await expect.poll(() => routes.innerText().then(net)).toContain('Aucune route ne correspond');
    await cliquer(routes.getByRole('button', { name: 'Effacer la recherche' }));
    await expect.poll(() => routes.locator('tbody tr', { hasText: '/moi' }).count()).toBe(1);
    // Sur une heure, la période d'avant se compare ; sur trente jours, elle n'est plus gardée et l'écran le dit.
    const trafic = p.locator('article[aria-labelledby="pf-trafic"]');
    await periode(p, '1 h');
    await expect.poll(() => trafic.getByRole('button', { name: 'Comparer à la période d\'avant' }).count()).toBe(1);
    await periode(p, '30 j');
    await expect.poll(() => trafic.innerText().then(net)).toContain('Pas de comparaison sur trente jours');
    expect(await trafic.getByRole('button', { name: 'Comparer à la période d\'avant' }).count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);
});
