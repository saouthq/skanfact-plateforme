// Le banc des clients (1.110.0 ; demandé par Skander le 22/10/2026 : « la charge réelle », point 6 de ce qui n'était pas
// encore éprouvé) : ce que coûte une journée de travail quand beaucoup d'entreprises travaillent EN MÊME TEMPS, chacune
// avec cinq ans d'historique (l'exemple de la v10, versé par la vraie route), par les routes que l'application appelle.
// Le banc de la console (banc/console) mesure l'équipe ; celui-ci mesure les clients.
//
// Les seuils sont écrits d'avance (VISION-ARCHITECTURE.md § 6 ; les trois derniers ajoutés le 22/10/2026 par délégation,
// avant la première mesure) : 95 % des réponses, côté serveur, sous
//   - ouvrir l'application sur un poste qui n'a encore rien (le dossier entier) ............ 2 s
//   - relire ce qui a changé (le poste déjà synchronisé, toutes les 30 s) ................. 300 ms
//   - enregistrer une saisie (un objet du dossier) ......................................... 300 ms
//   - encaisser un ticket à la caisse ...................................................... 200 ms
//   - émettre une facture (numéroter, calculer, sceller, écrire en comptabilité) ............ 500 ms
//   - la balance de l'année, le grand livre d'un compte .................................... 1 s
// Une mesure qui dépasse change le code, pas le seuil.
//
// La charge, écrite d'avance elle aussi : des UTILISATEURS qui travaillent comme en vrai, pas des robots qui enchaînent
// les demandes. Une personne au travail fait, par minute, en moyenne : deux relectures (le poste relit toutes les 30 s),
// deux enregistrements, un ticket de caisse, une demi-facture, un quart de consultation des livres, et rouvre
// l'application toutes les vingt minutes — près de six gestes par minute. Les gestes arrivent au hasard (comme des
// clients qui entrent), à ce rythme multiplié par le nombre d'utilisateurs. L'objectif : 500 utilisateurs actifs en même
// temps sur une machine (de l'ordre de 3 000 entreprises à l'heure de pointe), le programme en deux exemplaires comme en
// service. Ce que la machine du banc dit n'est pas ce que dira le serveur de production (ses processeurs, son disque) : le
// banc se rejoue là-bas avant les pilotes (À VÉRIFIER sur le vrai serveur).
//
// Tout se passe dans une base À PART, créée et détruite par le banc ; tout y est inventé. BANC_GARDER=1 la garde.
//
//   PG_ADMIN=postgres://postgres@127.0.0.1:5433/postgres node banc/clients/mesurer.ts [utilisateurs] [secondes] [entreprises]
//
// La préparation (les entreprises et leurs cinq ans) prend une quinzaine de minutes pour 60 entreprises : BANC_GARDER=1
// garde la base et ses comptes, BANC_REPRENDRE=1 repart de ce qui a été gardé (pour mesurer plusieurs charges).
// Sortie : la préparation, puis par geste le nombre de réponses, la médiane, le 95e centile et la plus lente ; code 0 si
// tous les seuils tiennent, 1 sinon.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrer } from '../../base/migrer.ts';

// Les seuils et le volume, écrits d'avance.
export const SEUILS_MS: Record<string, number> = { ouvrir: 2000, relire: 300, enregistrer: 300, ticket: 200, emettre: 500, livres: 1000 };
export const VOLUME = { utilisateurs: 500, secondes: 60, entreprises: 60, exemplaires: 2 };
// Ce que fait une personne au travail, par minute (écrit d'avance, voir plus haut).
export const PAR_MINUTE: Record<string, number> = { relire: 2, enregistrer: 2, ticket: 1, emettre: 0.5, livres: 0.25, ouvrir: 0.05 };

const BASE = 'skanfact_banc_clients';
const COMPTE = 'skanfact_banc_clients_serveur';
const MDP = 'Un-bon-mot-de-passe';

export type Mesure = { geste: string; n: number; mediane: number; p95: number; max: number; refus: number; seuil: number };
type Objet = { collection: string; cle: string; rang: number | null; revision: number; contenu: unknown };
type Poste = { jeton: string; ent: string; marque: string; profil: string; client: Objet | null; rangDocument: number; rangTicket: number };

const centile = (t: readonly number[], p: number) => {
  const s = [...t].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] ?? 0 : 0;
};

function adresse(modele: string, base: string, compte?: { nom: string; mdp: string }) {
  const u = new URL(modele);
  u.pathname = '/' + base;
  if (compte) { u.username = compte.nom; u.password = compte.mdp; }
  return u.toString();
}

// La base du banc : neuve, migrée, avec le compte du serveur (comme banc/console).
async function preparerBase(admin: string) {
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`drop database if exists ${BASE} with (force)`);
  await c.query(`create database ${BASE} template template0 locale_provider icu icu_locale 'en-US-u-ka-shifted'`);
  const mdp = randomBytes(18).toString('base64url');
  await c.query(`do $$ begin
      if exists (select from pg_roles where rolname = '${COMPTE}') then execute 'drop owned by ${COMPTE}'; execute 'drop role ${COMPTE}'; end if;
    end $$`);
  await c.query(`create role ${COMPTE} login nobypassrls password '${mdp}'`);
  await c.query('select pg_advisory_lock(20260929)');
  try { await migrer(adresse(admin, BASE)); } finally { await c.query('select pg_advisory_unlock(20260929)'); await c.end(); }
  const m = new pg.Client({ connectionString: adresse(admin, BASE) });
  await m.connect();
  await m.query(`grant skanfact_app to ${COMPTE}`);
  await m.end();
  return { pgAdmin: adresse(admin, BASE), pgApp: adresse(admin, BASE, { nom: COMPTE, mdp }) };
}

export async function mesurer(admin: string, volume = VOLUME, dire: (s: string) => void = () => {}) {
  const debut = performance.now();
  const garde = path.join(os.tmpdir(), 'banc-clients-garde.json');
  const reprendre = process.env.BANC_REPRENDRE === '1' && fs.existsSync(garde);
  const repris = reprendre ? JSON.parse(fs.readFileSync(garde, 'utf8')) as { pgApp: string; postes: Poste[] } : null;
  const { pgApp } = repris ?? await preparerBase(admin);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'banc-clients-'));
  const veille = path.join(dossier, 'veille.json');
  fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
  // Le programme dans SES processus, comme en service (deux exemplaires, chacun sa part des demandes, comme le frontal les
  // répartit) : le banc qui lit les réponses (le dossier entier, à l'ouverture) ne prend pas son temps au serveur.
  const base = 18500 + Math.floor(Math.random() * 400);
  const enfants = Array.from({ length: volume.exemplaires }, (_, i) => spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '../../serveur/principal.ts')], {
    env: { ...process.env, SKANFACT_BASE: pgApp, SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille, SKANFACT_PORT: String(base + i) },
    stdio: ['ignore', 'ignore', 'inherit'],
  }));
  const adresses = enfants.map((_, i) => `http://127.0.0.1:${base + i}`);
  const arreter = async () => { for (const e of enfants) { e.kill('SIGTERM'); await new Promise((r) => e.once('exit', r)); } };
  for (const a of adresses) {
    for (let i = 0; i < 300; i += 1) {
      if (await fetch(`${a}/v1/documentation`).then((r) => r.ok, () => false)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  let tourne = 0;
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const t0 = performance.now();
    const r = await fetch(`${adresses[tourne++ % adresses.length]}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown>, ms: performance.now() - t0 };
  };
  const exiger = (r: { statut: number; corps: Record<string, unknown> }, quoi: string) => {
    if (r.statut >= 300) throw new Error(`${quoi} : ${r.statut} ${JSON.stringify(r.corps).slice(0, 300)}`);
    return r.corps;
  };
  const aujourdhui = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Tunis' }).format(new Date());
  try {
    // Les entreprises : chacune sa propriétaire (son compte, son appareil), son essai, ses cinq ans d'exemple, sa caisse
    // ouverte sur cet appareil. Quatre à la fois (comme des inscriptions qui arrivent ensemble).
    const postes: Poste[] = repris?.postes ?? [];
    const preparer = async (i: number) => {
      const email = `banc-client-${i}@exemple.tn`;
      exiger(await api('POST', '/inscription', undefined, { email, nom: `Commerçant ${i}`, motDePasse: MDP }), 'inscription');
      const jeton = String(exiger(await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: `Poste ${i}`, type: 'navigateur' } }), 'connexion').jeton);
      const ent = String(exiger(await api('POST', '/entreprises-essai', jeton), 'essai').id);
      exiger(await api('POST', `/entreprises/${ent}/exemple`, jeton), 'exemple');
      exiger(await api('POST', `/entreprises/${ent}/caisse/ouvrir`, jeton, { fond: '0' }), 'caisse');
      postes.push({ jeton, ent, marque: '', profil: '', client: null, rangDocument: 0, rangTicket: 0 });
    };
    // Ce que le poste sait de son dossier (relu à chaque mesure : un banc repris ne part pas de révisions périmées).
    const relireLePoste = async (p: Poste) => {
      const d = exiger(await api('GET', `/entreprises/${p.ent}/dossier-v10`, p.jeton), 'dossier');
      const objets = d.objets as Objet[];
      const rang = Math.max(-1, ...objets.filter((o) => o.collection === 'documents').map((o) => o.rang ?? -1)) + 1;
      Object.assign(p, { marque: String(d.marque), profil: String(d.profil), client: objets.find((o) => o.collection === 'clients') ?? null,
        rangDocument: rang, rangTicket: rang + 100_000 });
    };
    for (let i = postes.length; i < volume.entreprises; i += 4) {
      await Promise.all(Array.from({ length: Math.min(4, volume.entreprises - i) }, (_, k) => preparer(i + k + 1)));
      dire(`  ${Math.min(i + 4, volume.entreprises)} entreprises prêtes`);
    }
    if (process.env.BANC_GARDER === '1') fs.writeFileSync(garde, JSON.stringify({ pgApp, postes }));
    for (const p of postes) await relireLePoste(p);
    const preparation = performance.now() - debut;
    const garni = (await api('GET', `/entreprises/${postes[0]?.ent}/dossier-v10`, postes[0]?.jeton)).corps.objets as Objet[];
    const taille = { objets: garni.length, documents: garni.filter((o) => o.collection === 'documents').length };

    const temps = new Map<string, number[]>();
    const refus = new Map<string, number>();
    const dits = new Set<string>();
    const noter = (geste: string, r: { statut: number; corps: Record<string, unknown>; ms: number }) => {
      if (r.statut >= 300) {
        refus.set(geste, (refus.get(geste) ?? 0) + 1);
        // Le premier refus de chaque geste se dit : un banc qui ne mesure que des erreurs doit dire lesquelles.
        if (!dits.has(geste)) { dits.add(geste); dire(`${geste} refusé : ${r.statut} ${JSON.stringify(r.corps).slice(0, 300)}`); }
        return;
      }
      temps.set(geste, [...(temps.get(geste) ?? []), r.ms]);
    };
    // Les gestes d'un poste, chacun tel que l'application l'envoie.
    // Un passage repris ne réutilise pas les pièces du précédent : chaque passage a sa marque.
    const passage = Date.now().toString(36);
    let n = 0;
    const gestes: Record<string, (p: Poste) => Promise<void>> = {
      ouvrir: async (p) => { noter('ouvrir', await api('GET', `/entreprises/${p.ent}/dossier-v10`, p.jeton)); },
      relire: async (p) => {
        const relu = await api('GET', `/entreprises/${p.ent}/dossier-v10?depuis=${encodeURIComponent(p.marque)}&profil=${encodeURIComponent(p.profil)}`, p.jeton);
        noter('relire', relu);
        if (relu.statut < 300) p.marque = String(relu.corps.marque);
      },
      enregistrer: async (p) => {
        if (!p.client) return;
        const c = p.client;
        const contenu = { ...(c.contenu as Record<string, unknown>), notes: `Passé le ${aujourdhui}, geste ${n++}` };
        const r = await api('POST', `/entreprises/${p.ent}/dossier-v10`, p.jeton, { changements: [{ collection: c.collection, cle: c.cle, rang: c.rang, revision: c.revision, contenu }] });
        noter('enregistrer', r);
        const rev = (r.corps.revisions as { collection: string; cle: string; revision: number }[] | undefined)?.find((x) => x.cle === c.cle);
        if (rev) p.client = { ...c, revision: rev.revision, contenu };
      },
      emettre: async (p) => {
        const client = p.client ? { id: p.client.cle, ...(p.client.contenu as Record<string, unknown>) } : null;
        noter('emettre', await api('POST', `/entreprises/${p.ent}/dossier-v10/emettre`, p.jeton, {
          document: { id: `banc-f-${passage}-${n++}`, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: client ? String(client.id) : '', createdAt: 1,
            lines: [{ label: 'Table en chêne', qty: 2, unit: 'u', unitPrice: { '~n': '50.000' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
          client, revision: null, rang: p.rangDocument++, netAPayer: '119.000' }));
      },
      ticket: async (p) => {
        const t = `banc-t-${passage}-${n++}`;
        noter('ticket', await api('POST', `/entreprises/${p.ent}/dossier-v10/ticket`, p.jeton, {
          document: { id: t, type: 'facture', ticket: true, number: '', date: aujourdhui, clientId: '',
            lines: [{ itemId: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', qty: 1, unitPrice: { '~n': '2.35' }, vatRate: 19 }], discountRate: 0, applyStamp: false, stampFee: 0,
            status: 'envoyée', withholdingRate: 0, currency: 'DT', caisse: { mode: 'especes', recu: null, rendu: null },
            payments: [{ id: `p-${t}`, date: aujourdhui, amount: { '~n': '2.797' }, method: 'especes', accountId: 'k-caisse', reference: '', note: '' }] },
          rang: p.rangTicket++, netAPayer: '2.797' }));
      },
      livres: async (p) => {
        const du = `${aujourdhui.slice(0, 4)}-01-01`;
        noter('livres', await api('GET', `/entreprises/${p.ent}/compta/balance?du=${du}&au=${aujourdhui}`, p.jeton));
        noter('livres', await api('GET', `/entreprises/${p.ent}/compta/grand-livre?compte=411&du=${du}&au=${aujourdhui}`, p.jeton));
      },
    };
    // Chaque poste fait un geste à la fois (une personne n'envoie pas deux enregistrements du même objet en même temps) ;
    // les gestes d'un même poste attendent leur tour.
    const files = new Map<string, Promise<void>>();
    const lancer = (p: Poste, geste: string) => {
      const avant = files.get(p.ent) ?? Promise.resolve();
      const apres = avant.then(() => gestes[geste]?.(p)).catch((e: unknown) => { noter(geste, { statut: 599, corps: { erreur: String(e) }, ms: 0 }); });
      files.set(p.ent, apres);
      return apres;
    };
    // Chauffer : chaque geste une fois sur chaque poste (le premier plan d'une requête ne dit rien du service).
    for (const p of postes) for (const g of Object.keys(gestes)) await lancer(p, g);
    temps.clear(); refus.clear();
    // La mesure : les gestes arrivent au hasard (un processus de Poisson), au rythme de `utilisateurs` personnes au
    // travail, chacun sur une entreprise tirée au hasard, pendant `secondes`.
    const poids = Object.entries(PAR_MINUTE);
    const parSeconde = (volume.utilisateurs * poids.reduce((t, [, x]) => t + x, 0)) / 60;
    const tirer = () => { let x = Math.random() * poids.reduce((t, [, w]) => t + w, 0); for (const [g, w] of poids) { x -= w; if (x <= 0) return g; } return 'relire'; };
    const enCours: Promise<void>[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < volume.secondes * 1000) {
      const p = postes[Math.floor(Math.random() * postes.length)];
      if (p) enCours.push(lancer(p, tirer()));
      await new Promise((r) => setTimeout(r, -Math.log(1 - Math.random()) * 1000 / parSeconde));
    }
    await Promise.all(enCours);
    const duree = performance.now() - t0;
    const reponses = [...temps.values()].reduce((n, t) => n + t.length, 0) + [...refus.values()].reduce((n, x) => n + x, 0);
    const mesures: Mesure[] = Object.entries(SEUILS_MS).map(([geste, seuil]) => {
      const t = temps.get(geste) ?? [];
      return { geste, n: t.length, mediane: centile(t, 0.5), p95: centile(t, 0.95), max: Math.max(0, ...t), refus: refus.get(geste) ?? 0, seuil };
    });
    // Un geste qui n'a rien mesuré, ou qui a refusé, ne « tient » pas : il n'a rien prouvé.
    return { mesures, preparation, duree, taille, reponses, parSeconde, tient: mesures.every((m) => m.n > 0 && m.refus === 0 && m.p95 < m.seuil) };
  } finally {
    await arreter();
    fs.rmSync(dossier, { recursive: true, force: true });
    if (process.env.BANC_GARDER !== '1') {
      fs.rmSync(garde, { force: true });
      const c = new pg.Client({ connectionString: admin });
      await c.connect();
      await c.query(`drop database if exists ${BASE} with (force)`);
      await c.end();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const admin = process.env.PG_ADMIN;
  if (!admin) { console.error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration PostgreSQL'); process.exit(2); }
  const volume = { ...VOLUME, utilisateurs: Number(process.argv[2] ?? VOLUME.utilisateurs), secondes: Number(process.argv[3] ?? VOLUME.secondes),
    entreprises: Number(process.argv[4] ?? VOLUME.entreprises) };
  const r = await mesurer(admin, volume, (s) => console.error(s));
  const ms = (x: number) => `${Math.round(x)} ms`;
  console.log(`préparé en ${Math.round(r.preparation / 1000)} s : ${volume.entreprises} entreprises, chacune ${r.taille.objets} objets dont ${r.taille.documents} pièces ; `
    + `${volume.utilisateurs} utilisateurs au travail (${r.parSeconde.toFixed(1)} gestes par seconde attendus), ${volume.exemplaires} exemplaires du programme : `
    + `${r.reponses} réponses en ${Math.round(r.duree / 1000)} s`);
  for (const m of r.mesures) {
    console.log(`${m.geste.padEnd(12)} ${String(m.n).padStart(5)} réponses  médiane ${ms(m.mediane).padStart(8)}  95 % ${ms(m.p95).padStart(8)} (seuil ${ms(m.seuil)})  max ${ms(m.max).padStart(8)}`
      + `${m.refus ? `  ${m.refus} refusées` : ''}${m.n > 0 && !m.refus && m.p95 < m.seuil ? '' : '  ← AU-DELÀ'}`);
  }
  console.log(r.tient ? 'Tous les seuils tiennent.' : 'Un seuil au moins ne tient pas.');
  process.exit(r.tient ? 0 : 1);
}
