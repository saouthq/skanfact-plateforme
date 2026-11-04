// La comparaison des écrans d'un lot de rangement (docs/cadrage/17-rangement.md § 6 ; lot R0d ; l'outil :
// outils/rangement/ecrans.ts). Elle ne tourne que quand on la demande, avec la version de référence :
//
//   SKANFACT_COMPARER_AVEC=<commit> PG_ADMIN=… npx vitest run tests/web/ecrans-comparer.test.ts
//
// (un lot B la lance contre le commit qui le précède ; `npm test` la saute, faute de référence). Elle exige : chaque
// page atteinte des deux côtés, toutes les pages comptées, aucune différence ; et le témoin (les écrans d'après, un
// style changé) doit tomber, sinon l'instrument ne voit rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { capturer, construire, contexte, copierLaBase, ecarts, pagesCabinet, pagesEntreprise, servir, type Capture, type Mesure } from '../../outils/rangement/ecrans.ts';

const REF = process.env.SKANFACT_COMPARER_AVEC ?? '';
const LARGEURS = (process.env.SKANFACT_COMPARER_LARGEURS ?? '1440,390').split(',').map(Number);
// Pour relire un écart sans tout refaire : SKANFACT_COMPARER_PAGES=<expression> ne garde que les pages qu'elle trouve.
const FILTRE = process.env.SKANFACT_COMPARER_PAGES ? new RegExp(process.env.SKANFACT_COMPARER_PAGES) : null;
const garder = (p: string) => !FILTRE || FILTRE.test(p);

describe.skipIf(!REF)('la comparaison des écrans, avant et après un lot', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'ecrans-comparer-'));
  const photos = path.join(dossier, 'photos');
  const web = { avant: path.join(dossier, 'avant'), apres: path.join(dossier, 'apres'), temoin: path.join(dossier, 'temoin') };
  const serveurs: Record<string, Awaited<ReturnType<typeof servir>>> = {};
  let navigateur: Browser;
  let jeton = '', associe = '', ent = '', cab = '', relie = '';
  const ids: Record<string, string> = {};
  let instant = new Date();

  beforeAll(async () => {
    fs.mkdirSync(photos, { recursive: true });
    await construire(null, web.apres);
    await construire(REF, web.avant);
    // Le témoin : les écrans d'après, un seul style changé (les titres plus espacés). La comparaison doit le voir.
    fs.cpSync(web.apres, web.temoin, { recursive: true });
    fs.appendFileSync(path.join(web.temoin, 'v10/style.css'), '\n#view h1{letter-spacing:2px}\n');
    // Les données, une fois, sur la base des tests : un compte, son entreprise d'essai remplie de l'exemple, un cabinet
    // qui la tient par mandat, et un dossier tenu.
    const s0 = await servir(inject('pgApp'), web.apres);
    const api = async (methode: string, chemin: string, j?: string, corps?: unknown) => {
      const r = await fetch(`${s0.adresse}/v1${chemin}`, { method: methode, headers: { ...(j ? { authorization: `Bearer ${j}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
      const t = await r.text();
      return { statut: r.status, corps: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
    };
    const personne = async (nom: string) => {
      // Une adresse en lettres simples : « Leïla » ne passe pas dans une adresse e-mail.
      const email = `${(nom.split(' ')[0] ?? 'x').normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase()}-comparer-${Date.now()}@exemple.tn`;
      await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
      const j = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
      await api('POST', '/moi/code', j, { methode: 'application' });
      return j;
    };
    try {
      jeton = await personne('Leïla Ben Youssef');
      ent = String((await api('POST', '/entreprises-essai', jeton)).corps.id);
      expect((await api('POST', `/entreprises/${ent}/exemple`, jeton)).statut).toBe(200);
      const lu = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps;
      const objets = (Object.values(lu).find((v) => Array.isArray(v) && (v as unknown[]).some((o) => (o as { collection?: string })?.collection)) ?? []) as { collection: string; cle: string; contenu: Record<string, unknown> }[];
      const premier = (col: string, f: (c: Record<string, unknown>) => boolean = () => true) => objets.find((o) => o.collection === col && f(o.contenu ?? {}))?.cle ?? '';
      Object.assign(ids, {
        facture: premier('documents', (c) => c.type === 'facture'), devis: premier('documents', (c) => c.type === 'devis'),
        client: premier('clients'), fournisseur: premier('suppliers'), achat: premier('purchases'), affaire: premier('projects'),
        immo: premier('assets'), article: premier('catalog'), salarie: premier('employees'), contrat: premier('recurring'),
      });
      associe = await personne('Anis Gharbi');
      const c = (await api('POST', '/cabinets', associe, { nom: 'Gharbi Conseil' })).corps as { id: string; code: string };
      cab = c.id;
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, jeton, { codeCabinet: c.code })).corps.mandat ?? '');
      if (mandat) await api('POST', `/cabinets/${cab}/mandats/${mandat}/accepter`, associe);
      relie = mandat ? ent : String((await api('POST', `/cabinets/${cab}/dossiers`, associe, { raisonSociale: 'Menuiserie du Sahel' })).corps.entreprise);
      await api('POST', `/entreprises/${ent}/messages`, jeton, { cote: 'entreprise', texte: 'Je passe jeudi pour la TVA.' });
    } finally { await s0.arreter(); }
    // Trois copies de la même base, au même instant : avant, après, et le témoin.
    for (const cote of ['avant', 'apres', 'temoin'] as const) {
      const base = await copierLaBase(inject('pgAdmin'), inject('pgApp'), `skanfact_comparer_${cote}`);
      serveurs[cote] = await servir(base, web[cote]);
    }
    navigateur = await chromium.launch();
    instant = new Date();
  }, 600_000);
  afterAll(async () => { await navigateur?.close(); for (const s of Object.values(serveurs)) await s.arreter(); });

  // Ouvre une page dans un contexte, attend qu'elle soit la bonne et remplie ; rend la capture, ou null.
  // Chaque page s'ouvre de zéro, par son adresse (17 § 6, « chaque route ouverte directement par son adresse ») : rien
  // de la page d'avant ne déteint sur elle.
  async function aller(p: Page, adresse: string, page: string): Promise<boolean> {
    await p.goto('about:blank');
    await p.goto(`${adresse}${page}`);
    try {
      await p.locator('#view').filter({ hasText: /\S/ }).first().waitFor({ timeout: 15_000 });
      await p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    } catch { return false; }
    // Une page qui renvoie ailleurs (une route réservée à l'éditeur, par exemple) est comparée là où elle arrive :
    // l'adresse finale fait partie des registres.
    return true;
  }
  const ouvrir = async (p: Page, adresse: string, page: string, nom: string): Promise<Capture | null> => (await aller(p, adresse, page) ? capturer(p, photos, nom) : null);

  // Une paire de prises, la même chose des deux côtés. Une paire qui diffère est reprise de zéro, des deux côtés, jusqu'à
  // REPRISES fois : une vraie différence revient à chaque fois ; celle qui tient au moment (un texte que l'écran pose
  // avant ou après son passage de typographie, par exemple) finit par disparaître. Le bilan garde le nombre d'essais.
  const REPRISES = 4;
  async function paire(page: string, largeur: number, prendre: (k: 'a' | 'b', essai: number) => Promise<Capture | null>): Promise<Mesure> {
    let m: Mesure = { page, largeur, avant: null, apres: null, atteinte: false };
    for (let essai = 0; essai <= REPRISES; essai++) {
      const avant = await prendre('a', essai), apres = await prendre('b', essai);
      m = { page, largeur, avant, apres, atteinte: !!avant && !!apres, essais: essai + 1 };
      if (ecarts(m).length === 0) break;
    }
    return m;
  }

  async function comparer(a: string, b: string, apps: { nom: string; racine: string; accueil: string; pages: string[]; j: string }[]): Promise<Mesure[]> {
    const mesures: Mesure[] = [];
    for (const largeur of LARGEURS) {
      for (const app of apps) {
        const ctx: Record<string, BrowserContext> = { a: await contexte(navigateur, largeur, app.j), b: await contexte(navigateur, largeur, app.j) };
        const pg: Record<string, Page> = {};
        for (const k of ['a', 'b'] as const) { pg[k] = await (ctx[k] as BrowserContext).newPage(); await (pg[k] as Page).clock.setFixedTime(instant); }
        const adresse = (k: 'a' | 'b') => `${serveurs[k === 'a' ? a : b]?.adresse}${app.racine}`;
        const cote = (k: 'a' | 'b') => (k === 'a' ? a : b);
        const essaiDe = (essai: number) => (essai ? `-essai${essai}` : '');
        for (const page of app.pages) {
          const nom = `${app.nom}-${page.replace(/[^a-z0-9]+/gi, '-')}-${largeur}`;
          mesures.push(await paire(`${app.nom} ${page}`, largeur, (k, essai) => ouvrir(pg[k] as Page, adresse(k), page, `${nom}${essaiDe(essai)}-${cote(k)}`)));
          // Chaque onglet de la page, l'un après l'autre, des deux côtés ; repris, il s'ouvre de zéro, puis son onglet.
          const onglets = await (pg.a as Page).locator('#view [role="tab"], #view .tabs > button').count();
          for (let i = 0; i < Math.min(onglets, 12); i++) {
            mesures.push(await paire(`${app.nom} ${page} onglet ${i + 1}`, largeur, async (k, essai) => {
              const p = pg[k] as Page;
              if (essai && !await aller(p, adresse(k), page)) return null;
              const ici = p.url();
              const o = p.locator('#view [role="tab"], #view .tabs > button').nth(i);
              // Le clic passe par la page : au téléphone, un en-tête collant peut couvrir la rangée d'onglets, et un
              // clic de la souris attendrait pour rien. Une prise qui échoue est une page non atteinte, dite à la fin.
              const prise = await o.evaluate((e) => (e as HTMLElement).click(), undefined, { timeout: 5_000 })
                .then(() => p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined))
                .then(() => capturer(p, photos, `${nom}-onglet${i}${essaiDe(essai)}-${cote(k)}`), () => null);
              // Un onglet qui mène ailleurs (une autre adresse) : on revient à la page pour l'onglet suivant.
              if (p.url() !== ici) await aller(p, ici, '');
              return prise;
            }));
          }
        }
        // La palette et « Créer », ouverts depuis l'accueil.
        for (const [geste, faire] of [['palette', (p: Page) => p.keyboard.press('Control+k')], ['créer', (p: Page) => p.locator('#b-creer:visible, .sb-onglets [data-tel="creer"]:visible').first().evaluate((e) => (e as HTMLElement).click(), undefined, { timeout: 5_000 })]] as const) {
          mesures.push(await paire(`${app.nom} ${geste}`, largeur, async (k, essai) => {
            const p = pg[k] as Page;
            if (!await aller(p, adresse(k), app.accueil)) return null;
            const prise = await faire(p).then(() => capturer(p, photos, `${app.nom}-${geste}-${largeur}${essaiDe(essai)}-${cote(k)}`), () => null);
            await p.keyboard.press('Escape');
            return prise;
          }));
        }
        for (const c of Object.values(ctx)) await c.close();
      }
    }
    return mesures;
  }

  it('chaque page de l\'entreprise et du Cabinet, au bureau et au téléphone, onglets, palette et « Créer » compris, est la même avant et après', async () => {
    const pe = pagesEntreprise(ids).filter(garder), pc = pagesCabinet(relie).filter(garder);
    const mesures = await comparer('avant', 'apres', [
      { nom: 'entreprise', racine: `/v10/?e=${ent}`, accueil: '#/dashboard', pages: pe, j: jeton },
      { nom: 'cabinet', racine: `/v10/cabinet/?c=${cab}`, accueil: '#/dossiers', pages: pc, j: associe },
    ]);
    const nonAtteintes = mesures.filter((m) => !m.atteinte).map((m) => `${m.page} (${m.largeur})`);
    const reprises = mesures.filter((m) => (m.essais ?? 1) > 1).map((m) => `${m.page} (${m.largeur}) : ${m.essais} essais`);
    fs.writeFileSync(path.join(dossier, 'bilan.json'), JSON.stringify({ mesures: mesures.length, nonAtteintes, ecarts: mesures.flatMap(ecarts), reprises }, null, 1));
    expect(nonAtteintes, `pages non atteintes (photos : ${photos})`).toEqual([]);
    expect(mesures.filter((m) => !m.page.includes('onglet')).length).toBe((pe.length + pc.length + 4) * LARGEURS.length);
    expect(mesures.flatMap(ecarts), `photos : ${photos}`).toEqual([]);
  }, 3_600_000);

  it('le témoin : un seul style changé fait tomber la comparaison (l\'instrument voit les écrans)', async () => {
    const mesures = await comparer('apres', 'temoin', [{ nom: 'entreprise', racine: `/v10/?e=${ent}`, accueil: '#/dashboard', pages: ['#/dashboard', '#/factures', '#/paie'], j: jeton }]);
    expect(mesures.filter((m) => m.atteinte).length).toBeGreaterThan(0);
    expect(mesures.flatMap(ecarts).filter((e) => /les pixels change/.test(e)).length).toBeGreaterThan(0);
  }, 600_000);
});
