// Un mois de mesures inventées, pour regarder « Le service » de la console à la main (scripts/humain/lancer.sh ;
// docs/console.md C12). Rien ne s'écrit à la main dans une table : les requêtes passent par la VRAIE collecte
// (serveur/service/collecte.ts) et partent par plateforme.noter_requetes ; la veille passe par ses VRAIES règles
// (exploitation/veille.ts : problemes, decider, retenir, pourLaConsole) et part par plateforme.noter_veille, minute par
// minute, dans l'ordre du temps. Le hasard est tiré d'une graine fixe : deux lancements donnent le même mois (à l'heure
// près où on le lance : l'histoire se cale sur maintenant).
//
// L'histoire, en heures de Tunis :
//   - le programme sert depuis plus d'un mois ; la veille n'est posée que depuis 27 jours (les premiers jours ne sont pas
//     mesurés), et elle s'est tue une journée entière il y a 16 jours (une mise à niveau du système l'avait arrêtée) ;
//   - il y a 11 jours, à 21 h 03, la version 564718c ralentit tout, puis le service tombe de 21 h 14 à 21 h 51 ; on revient
//     à c7b2e91 à 21 h 49 ; la version 9a41c02 arrive il y a deux jours, à 10 h 30 ;
//   - il y a 9 jours (une nuit de dimanche), la sauvegarde échoue ; personne ne la relance, la nuit suivante la refait ;
//   - il y a 6 jours, la copie hors de la machine de la nuit traîne près de trois heures, puis part ;
//   - il y a 4 jours, de 10 h 05 à 10 h 43, les listes sont lentes et quelques requêtes tombent en panne ; hier vers
//     16 h 20, un ralentissement plus court ;
//   - le disque /var se remplit : nettoyé il y a 3 jours à 76 %, il repasse les 75 % depuis trois heures ;
//   - en ce moment, la copie hors de la machine est en retard (grave). `--calme` : ces deux-là viennent de se régler.
// Les alertes partent comme la veille les envoie (exploitation/veille.ts : alerte, envoisDe) à des destinataires inventés,
// que la console ne voit que masqués ; le SMS de la coupure est refusé (le crédit WinSMS était épuisé), l'e-mail part.
//
// `--suivre` : ensuite, la veille continue minute par minute, comme son minuteur, tant qu'on ne l'arrête pas (Ctrl+C). Elle
// lit la base comme la vraie (plateforme.veille_lire : les mesures, les sourdines et les essais demandés depuis la
// console) et y écrit ce qu'elle voit et ce qui part ; le trafic de l'histoire continue avec elle. Les gestes de la
// console sur les alertes s'essaient ainsi à la main, jusqu'à leur effet.
//
//   PG_ADMIN=… SKANFACT_VEILLE_FICHIER=/tmp/skanfact-humain-plateforme/veille.json node scripts/humain/exemple-service.ts [--calme] [--suivre]
import fs from 'node:fs';
import pg from 'pg';
import {
  alerte, decider, envoisDe, masquerCourriel, masquerTelephone, pourLaConsole, problemes, requetes, retenir,
  type Envoi as EnvoiVeille, type Machine, type MinuteMesuree, type Releve, type Sourdine, type Veille,
} from '../../exploitation/veille.ts';
import { Collecte, type Envoi } from '../../serveur/service/collecte.ts';
import { fusionner, histogrammeVide, type Sorte } from '../../serveur/service/mesures.ts';

const admin = process.env.PG_ADMIN;
if (!admin) throw new Error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration PostgreSQL');
const base = new URL(admin);
base.pathname = '/skanfact_humain';
const calme = process.argv.includes('--calme');
const suivre = process.argv.includes('--suivre');
const fichierVeille = process.env.SKANFACT_VEILLE_FICHIER ?? '/tmp/skanfact-humain-plateforme/veille.json';

// ── Le hasard, d'une graine fixe (mulberry32) ────────────────────────────────────────────────────────────────────────
let graine = 20261013;
const hasard = () => {
  graine = (graine + 0x6d2b79f5) | 0;
  let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normale = () => Math.sqrt(-2 * Math.log(1 - hasard())) * Math.cos(2 * Math.PI * hasard());
const poisson = (l: number) => {
  if (l <= 0) return 0;
  if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * normale()));
  const seuil = Math.exp(-l);
  let k = 0, p = 1;
  do { k++; p *= hasard(); } while (p > seuil);
  return k - 1;
};
const choisir = <T>(liste: readonly (readonly [T, number])[]): T => {
  const total = liste.reduce((s, [, p]) => s + p, 0);
  let x = hasard() * total;
  for (const [v, p] of liste) { x -= p; if (x <= 0) return v; }
  return (liste.at(-1) as readonly [T, number])[0];
};

// ── Le temps : Tunis est à UTC+1, toute l'année ──────────────────────────────────────────────────────────────────────
const MIN = 60_000, HEURE = 3_600_000, JOUR = 86_400_000, TUNIS = HEURE;
const MAINTENANT = Math.floor(Date.now() / MIN) * MIN;
const aujourdhui = new Date(MAINTENANT + TUNIS).toISOString().slice(0, 10);
// L'instant d'une heure de Tunis, il y a `j` jours.
const a = (j: number, h: number, m = 0) => Date.parse(`${aujourdhui}T00:00:00Z`) - j * JOUR + (h * 60 + m) * MIN - TUNIS;
const dedans = (t: number, [de, jusqua]: readonly [number, number]) => t >= de && t < jusqua;
const iso = (t: number) => new Date(t).toISOString();

const VEILLE_POSEE = a(27, 10, 42);
const VEILLE_TUE: [number, number] = [a(17, 23, 12), a(15, 7, 48)];
const COUPURE: [number, number] = [a(11, 21, 14), a(11, 21, 52)];
const VERSIONS: [number, string][] = [[a(11, 21, 3), '564718c'], [a(11, 21, 49), 'c7b2e91'], [a(2, 10, 30), '9a41c02']];
const versionA = (t: number) => VERSIONS.filter(([de]) => t >= de).at(-1)?.[1] ?? 'c7b2e91';
// Les lenteurs : [début, fin, combien plus lent (au début, à la fin), part de pannes].
const LENTEURS: [number, number, number, number, number][] = [
  [a(11, 21, 3), a(11, 21, 14), 1.6, 7, 0.04],
  [a(4, 10, 5), a(4, 10, 43), 5, 5, 0.0],
  [a(4, 10, 12), a(4, 10, 31), 1, 1, 0.06],
  [a(1, 16, 20), a(1, 16, 36), 2.3, 2.3, 0.006],
];
function lenteur(t: number): { facteur: number; pannes: number } {
  let facteur = 1, pannes = 0.0002;
  for (const [de, jusqua, f0, f1, p] of LENTEURS) {
    if (!dedans(t, [de, jusqua])) continue;
    facteur *= f0 + (f1 - f0) * ((t - de) / (jusqua - de));
    pannes = Math.max(pannes, p);
  }
  return { facteur, pannes };
}
// La copie hors de la machine : ce qui attend depuis quand ([début, fin)).
const RETARDS: [number, number][] = [[a(6, 2, 19), a(6, 5, 11)], [MAINTENANT - 96 * MIN, calme ? MAINTENANT - 25 * MIN : Infinity]];
// La sauvegarde de la nuit (02 h 16, finie à 02 h 19) ; celle du dimanche il y a 9 jours échoue.
const SAUVEGARDE_RATEE = a(9, 2, 19);
const derniereNuitA = (t: number, h: number, m: number) => {
  for (let j = 0; j < 40; j++) { const le = a(j, h, m); if (le <= t) return le; }
  return null;
};

// ── Le trafic ────────────────────────────────────────────────────────────────────────────────────────────────────────
// L'activité d'une heure de Tunis, de 0 h à 23 h (la plus chargée vaut 1), et ce que la semaine en fait : un samedi qui
// travaille le matin, un dimanche calme, la prière du vendredi.
const PROFIL = [0.06, 0.04, 0.03, 0.03, 0.03, 0.05, 0.1, 0.28, 0.62, 0.88, 1, 0.97, 0.78, 0.55, 0.74, 0.92, 0.9, 0.76, 0.55, 0.38, 0.27, 0.2, 0.14, 0.09];
function activite(t: number): number {
  const d = new Date(t + TUNIS);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const i = Math.floor(h), x = h - i;
  const v = (PROFIL[i] ?? 0) * (1 - x) + (PROFIL[(i + 1) % 24] ?? 0) * x;
  const jour = d.getUTCDay();
  const semaine = jour === 0 ? 0.2 : jour === 6 ? (h < 13 ? 0.8 : 0.3) : jour === 5 && h >= 12 && h < 14.5 ? 0.55 : 1;
  return v * semaine;
}
const DEBUT_REQUETES = Math.floor((MAINTENANT - 31 * JOUR) / HEURE) * HEURE;
// Des requêtes par minute, au plus fort d'un jour ordinaire ; le mois en gagne un cinquième (des clients arrivent) :
// assez de listes et de fiches, aux heures de bureau, pour que la veille juge leur temps de réponse (vingt par minute).
const debit = (t: number) => 48 * activite(t) * (1 + 0.2 * Math.min(1, (t - DEBUT_REQUETES) / (MAINTENANT - DEBUT_REQUETES)));
const PARTS: [Sorte, number][] = [['lecture', 64], ['ecriture', 15], ['caisse', 9], ['dossier', 6], ['comptes', 4], ['console', 2]];
const ROUTES: Record<Sorte, readonly (readonly [string, number])[]> = {
  lecture: [['GET /entreprises/:entreprise/ventes', 30], ['GET /entreprises/:entreprise/clients', 16], ['GET /moi', 12],
    ['GET /entreprises/:entreprise/ventes/:piece', 12], ['GET /entreprises/:entreprise/achats', 9], ['GET /entreprises/:entreprise/abonnement/etat', 8],
    ['GET /entreprises/:entreprise/messages/attente', 8], ['GET /entreprises/:entreprise/caisse', 5]],
  ecriture: [['POST /entreprises/:entreprise/dossier-v10', 60], ['POST /connexion', 25], ['POST /connexion/code', 15]],
  caisse: [['POST /entreprises/:entreprise/dossier-v10/ticket', 1]],
  dossier: [['GET /entreprises/:entreprise/dossier-v10', 1]],
  comptes: [['GET /entreprises/:entreprise/compta/balance', 40], ['GET /entreprises/:entreprise/compta/grand-livre', 30],
    ['GET /entreprises/:entreprise/compta/declarations', 25], ['GET /entreprises/:entreprise/compta/annuel/:annee', 5]],
  console: [['GET /console/accueil', 40], ['GET /console/entreprises', 30], ['GET /console/service', 20], ['GET /console/entreprises/:id', 10]],
};
// Le temps de réponse de chaque sorte : un mélange de deux lois log-normales (la plupart, et une traîne plus lente) —
// [médiane ms, écart, part de la traîne, médiane de la traîne, écart de la traîne].
const LATENCE: Record<Sorte, [number, number, number, number, number]> = {
  lecture: [38, 0.5, 0.05, 150, 0.55], caisse: [22, 0.4, 0.03, 90, 0.5], comptes: [230, 0.45, 0.06, 650, 0.5],
  dossier: [380, 0.5, 0.05, 1100, 0.5], ecriture: [70, 0.45, 0.05, 260, 0.5], console: [55, 0.45, 0.04, 180, 0.5],
};
function duree(sorte: Sorte, t: number, facteur: number): number {
  const [m, s, part, mt, st] = LATENCE[sorte];
  const queue = hasard() < part;
  return Math.exp(Math.log((queue ? mt : m) * facteur * (1 + 0.25 * activite(t))) + (queue ? st : s) * normale());
}

// ── La machine ───────────────────────────────────────────────────────────────────────────────────────────────────────
function machine(t: number): Machine {
  if (dedans(t, COUPURE)) return { charge: 0.04, memoire: 33, processeurs: 4 };
  const { facteur } = lenteur(t);
  const charge = 0.18 + 1.1 * activite(t) * (facteur > 1.2 ? 2.6 : 1) + 0.1 * Math.abs(normale());
  const memoire = Math.round(54 + 9 * activite(t) + (t >= a(2, 10, 30) ? 3 : 0) + 1.5 * normale());
  return { charge: Math.round(charge * 100) / 100, memoire: Math.max(0, Math.min(100, memoire)), processeurs: 4 };
}
// Le disque /var : il se remplit lentement, on le nettoie il y a trois jours, puis la 9a41c02 écrit trop de journaux ;
// il repasse les 75 % il y a trois heures (`--calme` : nettoyé il y a quarante minutes).
function disqueVar(t: number): number {
  const d0 = a(29, 0), alerte = a(3, 14, 0), menage = a(3, 16, 30), version = a(2, 10, 30), repasse = MAINTENANT - 3 * HEURE;
  const lente = (75 - 52) / (alerte - d0);
  if (t < menage) return 52 + lente * (t - d0);
  const aLaVersion = 60 + lente * (version - menage);
  if (t < version) return 60 + lente * (t - menage);
  const vite = (75 - aLaVersion) / (repasse - version);
  if (calme && t >= MAINTENANT - 40 * MIN) return 61;
  return aLaVersion + vite * (t - version);
}
const disqueRacine = (t: number) => 38 + 4 * (t - a(29, 0)) / (MAINTENANT - a(29, 0));

// ── Le relevé d'une minute, tel que exploitation/veiller.ts le ferait ────────────────────────────────────────────────
function releve(t: number): Releve {
  const sauvegarde = derniereNuitA(t, 2, 19);
  const copieDeBase = derniereNuitA(t, 0, 31);
  const retard = RETARDS.find((r) => dedans(t, r));
  return {
    maintenant: new Date(t),
    serviceRepond: !dedans(t, COUPURE),
    etat: {
      regardeLe: iso(Math.floor(t / (5 * MIN)) * 5 * MIN), version: versionA(t), echec: null, taches: [],
      sauvegarde: sauvegarde === null ? null : { le: iso(sauvegarde), ok: sauvegarde !== SAUVEGARDE_RATEE },
    },
    disques: [{ point: '/', pourcent: Math.floor(disqueRacine(t)) }, { point: '/var', pourcent: Math.floor(disqueVar(t)) }],
    // Le certificat a été renouvelé avant la pose de la veille : il expire dans deux mois.
    certificat: { expireLe: iso(MAINTENANT + 61 * JOUR) },
    production: true,
    copies: {
      archivage: { enMarche: true, dernierReussi: iso(t - 40_000), dernierEchec: null },
      copieDeBase: copieDeBase === null ? null : { le: iso(copieDeBase), ok: true },
      // L'exercice du mois : il y a 38 jours, puis il y a 8 jours.
      restauration: { le: iso(t >= a(8, 3, 30) ? a(8, 3, 30) : a(38, 3, 30)), ok: true },
      horsMachine: { regle: true, plusVieuxEnAttente: retard ? iso(retard[0]) : null, dernierEchec: retard ? iso(t - MIN) : null },
    },
  };
}

// ── Le trafic d'une minute, noté comme le serveur le note ─────────────────────────────────────────────────────────────
function trafic(collecte: Collecte, t: number): number {
  if (dedans(t, COUPURE)) return 0;
  const { facteur, pannes } = lenteur(t);
  const bruit = Math.exp(0.15 * normale());
  let n = 0;
  for (const [sorte, part] of PARTS) {
    const k = poisson((debit(t) * part / 100) * bruit);
    for (let i = 0; i < k; i++) {
      const [methode = 'GET', chemin = '/moi'] = choisir(ROUTES[sorte]).split(' ');
      const statut = hasard() < pannes ? 500 : hasard() < 0.012 ? 409 : methode === 'GET' ? 200 : 201;
      collecte.noter(methode, chemin, statut, duree(sorte, t, facteur), new Date(t + Math.floor(hasard() * MIN)));
      n++;
    }
  }
  return n;
}

// Ce que la base rend à la veille, minute par minute, toutes sortes additionnées (plateforme.veille_lire) : ses deux
// règles des requêtes s'y jugent. Gardé ici pour tout le mois rejoué (la base, elle, ne garde que trois jours).
type Mesuree = { minute: string; n: number; pannes: number; lecture: number[] | null };
const mesurees = new Map<number, Mesuree>();
function garderLesMinutes(envoi: Envoi) {
  for (const l of envoi.minutes) {
    const t = Date.parse(l.minute);
    const m = mesurees.get(t) ?? { minute: l.minute, n: 0, pannes: 0, lecture: null };
    m.n += l.n;
    m.pannes += l.pannes;
    if (l.sorte === 'lecture') m.lecture = fusionner(m.lecture ?? histogrammeVide(), l.h);
    mesurees.set(t, m);
  }
}
// Les quinze dernières minutes finies avant `t`, comme plateforme.veille_lire($1, 15).
function quinzeMinutes(t: number): MinuteMesuree[] {
  const fin = Math.floor(t / MIN) * MIN;
  const r: MinuteMesuree[] = [];
  for (let x = fin - 15 * MIN; x < fin; x += MIN) { const m = mesurees.get(x); if (m) r.push(m); }
  return r;
}

// ── La veille, un tour, comme exploitation/veiller.ts (tour) le ferait ───────────────────────────────────────────────
// Qui est prévenu : des destinataires inventés (exploitation/alertes.sh les règle sur un vrai serveur), que la console ne
// voit que masqués. WinSMS refuse le SMS de la coupure.
const SERVEUR = 'app.skanfact.tn';
const DESTINATAIRES = {
  courriel: { a: masquerCourriel('veille@exemple.tn') ?? '•••', pret: true },
  sms: { a: masquerTelephone('+216 20 000 456') ?? '•••', pret: true },
};
const SMS_REFUSE: [number, number] = [COUPURE[0], COUPURE[0] + 5 * MIN];
type Lu = { minutes: MinuteMesuree[]; sourdines: Sourdine[]; demandes: { id: string; sorte: string }[] };
let enCours: Veille = { problemes: {} };
function tourDeVeille(t: number, lu: Lu): [unknown, unknown, unknown, EnvoiVeille[]] {
  const maintenant = new Date(t);
  const r = releve(t);
  const req = requetes(lu.minutes, maintenant, enCours);
  const sourdines = lu.sourdines.filter((s) => Date.parse(s.fin) > t);
  const { apres, messages } = decider(enCours, [...problemes(r), ...req.problemes], maintenant, sourdines);
  const envois: EnvoiVeille[] = [];
  let parti = true;
  const a = alerte(SERVEUR, messages);
  if (a) {
    const p = { courriel: true, sms: a.sms ? !dedans(t, SMS_REFUSE) : null };
    parti = p.courriel || p.sms === true;
    envois.push(...envoisDe(messages, p, maintenant).filter((e) => e.sorte === 'regle' || e.courriel !== null || e.sms !== null));
  }
  for (const d of lu.demandes) {
    if (d.sorte === 'essai') envois.push({ le: maintenant.toISOString(), sorte: 'essai', cle: null, titre: null, depuis: null, grave: false, courriel: true, sms: true, demande: d.id });
  }
  enCours = { ...retenir(enCours, apres, messages, parti), ...(sourdines.length ? { sourdines } : {}) };
  const x = pourLaConsole(r, enCours, machine(t), { destinataires: DESTINATAIRES, lu: req.lu });
  return [x.releve, x.problemes, x.nuits, envois];
}

// ── Écrire ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const c = new pg.Client({ connectionString: base.toString() });
await c.connect();
await c.query(`truncate plateforme.service_minute, plateforme.service_heure, plateforme.service_route, plateforme.service_releve,
  plateforme.service_alerte, plateforme.service_nuit, plateforme.service_envoi, plateforme.service_sourdine, plateforme.service_demande`);
// La veille rejouée dans l'ordre : une fonction de la session, qui appelle noter_veille minute après minute.
await c.query(`create function pg_temp.rejouer_veille(p jsonb) returns void language plpgsql as $$
  declare x record;
  begin
    for x in select e.v from jsonb_array_elements(p) with ordinality e(v, i) order by e.i loop
      perform plateforme.noter_veille(x.v->0, x.v->1, x.v->2, x.v->3);
    end loop;
  end $$`);

// 1. Les requêtes, heure par heure, par la collecte du serveur. Les minutes de plus de trois jours ne partent pas : la base
//    ne les garde pas (la veille rejouée les lit ici).
const collecte = new Collecte();
let requetesNotees = 0;
for (let h = DEBUT_REQUETES; h < MAINTENANT; h += HEURE) {
  for (let t = h; t < Math.min(h + HEURE, MAINTENANT); t += MIN) requetesNotees += trafic(collecte, t);
  const envoi: Envoi = collecte.prendre();
  garderLesMinutes(envoi);
  if (h + HEURE < MAINTENANT - 3 * JOUR) envoi.minutes = [];
  await c.query('select plateforme.noter_requetes($1, $2::jsonb)', ['vps-1:8080', JSON.stringify(envoi)]);
}

// 2. La veille, minute par minute, par ses règles ; envoyée jour par jour.
let lot: unknown[] = [];
let releves = 0;
const envoyer = async () => { if (lot.length) await c.query('select pg_temp.rejouer_veille($1::jsonb)', [JSON.stringify(lot)]); lot = []; };
for (let t = VEILLE_POSEE; t <= MAINTENANT; t += MIN) {
  if (dedans(t, VEILLE_TUE)) continue;
  lot.push(tourDeVeille(t, { minutes: quinzeMinutes(t), sourdines: [], demandes: [] }));
  releves++;
  if (lot.length >= 1440) await envoyer();
}
await envoyer();

const compte = await c.query<{ ouvertes: string; finies: string; envois: string }>(`select count(*) filter (where fin is null) ouvertes,
  count(*) filter (where fin is not null) finies, (select count(*) from plateforme.service_envoi) envois from plateforme.service_alerte`);
// Le fichier de la veille, comme elle l'écrit chaque minute : la console y lit « en ce moment ».
fs.writeFileSync(fichierVeille, JSON.stringify(enCours, null, 2));
console.log(`${requetesNotees} requêtes, ${releves} relevés de la veille, ${compte.rows[0]?.finies} alertes réglées et ${compte.rows[0]?.ouvertes} ouvertes, ${compte.rows[0]?.envois} messages partis.`);
console.log(`veille : ${fichierVeille}${suivre ? '' : ' (touch le fichier chaque minute pour qu\'elle reste « vivante », ou relance avec --suivre)'}`);

// 3. `--suivre` : la veille continue, chaque minute, avec le trafic de l'histoire.
if (suivre) {
  console.log('La veille suit l\'histoire minute par minute (Ctrl+C pour l\'arrêter).');
  let derniere = MAINTENANT;
  for (;;) {
    const t = Math.floor(Date.now() / MIN) * MIN;
    if (t > derniere) {
      for (let x = derniere; x < t; x += MIN) trafic(collecte, x);
      await c.query('select plateforme.noter_requetes($1, $2::jsonb)', ['vps-1:8080', JSON.stringify(collecte.prendre())]);
      const l = (await c.query<{ l: { minutes: [string, number, number, number[] | null][]; sourdines: Sourdine[]; demandes: { id: string; sorte: string }[] } }>(
        'select plateforme.veille_lire($1, 15) l', [new Date(t).toISOString()])).rows[0]?.l;
      const lu: Lu = { minutes: (l?.minutes ?? []).map(([minute, n, pannes, lecture]) => ({ minute, n, pannes, lecture })), sourdines: l?.sourdines ?? [], demandes: l?.demandes ?? [] };
      const v = tourDeVeille(t, lu);
      await c.query('select plateforme.noter_veille($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)', v.map((x) => JSON.stringify(x)));
      fs.writeFileSync(fichierVeille, JSON.stringify(enCours, null, 2));
      const heure = new Date(t + TUNIS).toISOString().slice(11, 16);
      const dit = v[3].map((e) => `${e.sorte}${e.cle ? ` ${e.cle}` : ''}`).join(', ');
      console.log(`${heure} : ${Object.keys(enCours.problemes).length} problème(s) suivi(s)${lu.sourdines.length ? `, ${lu.sourdines.length} sourdine(s)` : ''}${dit ? ` — parti : ${dit}` : ''}`);
      derniere = t;
    }
    await new Promise((fin) => setTimeout(fin, 5_000));
  }
}
await c.end();
