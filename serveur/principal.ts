// Le programme serveur (vision § 5 : un seul programme, rangé en modules) : il lit sa configuration,
// écoute, fait tourner le livreur des avis d'événement, et s'arrête proprement.
//
//   SKANFACT_BASE=postgres://compte-du-serveur@…/skanfact  SKANFACT_ENVIRONNEMENT=test  node serveur/principal.ts
//
// La configuration vient de l'environnement, JAMAIS du dépôt (aucun secret n'y entre) :
//   SKANFACT_BASE            l'adresse de la base, avec le compte du serveur (rattaché à skanfact_app)
//   SKANFACT_ENVIRONNEMENT   « test » ou « production »
//   SKANFACT_PORT, SKANFACT_HOTE   où écouter (8080, 127.0.0.1 par défaut : un proxy https est devant)
//   SKANFACT_LISTE_VOLEE     la liste des mots de passe volés (tests/donnees/… par défaut, en test)
//   SKANFACT_WEB             l'application web construite (dist/web par défaut), servie à côté de l'API
//   SKANFACT_SMS             « aucun » tant que le fournisseur de SMS tunisien n'est pas choisi
//                            (03 § 6, 12 : question ouverte) ; le code se reçoit alors par une
//                            application d'authentification. En production, un fournisseur est exigé.
//   SKANFACT_ADRESSE         l'adresse publique du serveur (https), où reviennent le client et l'avis
//                            du prestataire de paiement ; par défaut, celle où il écoute
//   SKANFACT_KONNECT         l'API de Konnect (https://api.konnect.network/api/v2 par défaut)
//   SKANFACT_DIGIGO          l'API DigiGo de TunTrust (la signature de la facture électronique) ; sans elle,
//                            la signature n'est pas branchée (et le dit)
//   SKANFACT_DIGIGO_CLE      la clé de SkanFact comme « entité d'intégration » DigiGo (exigée avec l'API)
//   SKANFACT_TTN             le service El Fatoora de la TTN (l'envoi des factures électroniques signées) ;
//                            sans lui, les pièces signées attendent (et l'écran le dit)
//   SKANFACT_TTN_MS          le rythme du facteur de la TTN, en millisecondes (60 000 par défaut)
//   SKANFACT_COFFRE          la clé du coffre (32 octets en base64) qui scelle les clés confiées par les
//                            entreprises (serveur/coffre.ts) ; exigée en production, une clé d'essai
//                            connue de tous sinon
//   SKANFACT_LECTURES        combien de factures d'achat se lisent à la fois sur ce serveur (2 par défaut) ;
//                            la lecture demande Tesseract (avec le français) et Poppler, sinon elle n'est
//                            pas branchée (et l'écran le dit)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerApp } from './app.ts';
import { courrielSmtp, type EnvoiCourriel } from './courriel.ts';
import { emettreLesContrats } from './v10/contrats.ts';
import { envoyerHttps, livrerAvis, type Envoyeur } from './avis.ts';
import { creerPool } from './base.ts';
import { CLE_DU_COFFRE_D_ESSAI, cleDuCoffre, CoffreFaux } from './coffre.ts';
import type { Contexte } from './connexion.ts';
import { choisirEncodage, compressible, SEUIL_COMPRESSION } from './compression.ts';
import { dejaGarde, fichiersDesEcrans, versionDuCode } from './ecrans.ts';
import { Refus } from './erreurs.ts';
import { listeDepuisFichier } from './mot-de-passe.ts';
import { routesSocle } from './routes/socle.ts';
import { routesGroupe } from './groupe.ts';
import { routesCaisse } from './caisse/routes.ts';
import { declarerGestesAchats } from './achats/gestes.ts';
import { declarerGestesCaisse } from './caisse/gestes.ts';
import { lecteurDuServeur } from './achats/lecteur.ts';
import { routesAchats } from './achats/routes.ts';
import { declarerGestesCompta } from './compta/gestes.ts';
import { routesCabinet } from './cabinet/routes.ts';
import { routesCompta } from './compta/routes.ts';
import { declarerGestesPaie } from './paie/gestes.ts';
import { routesPaie } from './paie/routes.ts';
import { declarerGestesVentes } from './ventes/gestes.ts';
import { routesVentes } from './ventes/routes.ts';
import { envoyerALaTtn } from './v10/envoi.ts';
import { verifierEnAttente } from './v10/paiement.ts';
import { routesV10 } from './v10/routes.ts';
import { lirePartenaires, routesPartenaires, type Partenaire } from './partenaires.ts';
import { KONNECT_PAR_DEFAUT } from './ventes/konnect.ts';

export type Configuration = {
  base: string; environnement: 'test' | 'production'; port: number; hote: string; listeVolee: string;
  sms: 'aucun'; livreurMs: number; web: string; adresse: string | null; konnect: string; coffre: Buffer; verificationMs: number;
  digigo: { base: string; cle: string } | null;
  ttn: string | null; ttnMs: number; contratsMs: number;
  lectures: number;
  partenaires: Partenaire[];
  // Combien de relais de confiance (le frontal) se tiennent devant le serveur (brique 142) : 0, le serveur est
  // appelé en direct.
  proxy: number;
  // L'envoi des e-mails (lot entrée, 06/10/2026 ; serveur/courriel.ts) : le relais SMTP et l'adresse d'expédition ;
  // null, aucun e-mail ne part (et le mot de passe oublié ne se propose pas).
  courriel: { smtp: string; de: string } | null;
  // La version du code, écrite dans chaque page et au pied du menu (serveur/ecrans.ts) : lue dans le dépôt, sauf si
  // l'environnement la donne (SKANFACT_VERSION).
  version: string;
};

export class ConfigurationFausse extends Error {}

export function lireConfiguration(env: Record<string, string | undefined>): Configuration {
  const base = env.SKANFACT_BASE;
  if (!base) throw new ConfigurationFausse('SKANFACT_BASE manque : l\'adresse de la base, avec le compte du serveur');
  const environnement = env.SKANFACT_ENVIRONNEMENT;
  if (environnement !== 'test' && environnement !== 'production') throw new ConfigurationFausse('SKANFACT_ENVIRONNEMENT : « test » ou « production »');
  // La clé du coffre : celle de la production ne vient que de l'environnement (jamais la clé d'essai).
  // Contrôlée avant le fournisseur de SMS, pour que la règle se prouve dès aujourd'hui.
  if (environnement === 'production' && !env.SKANFACT_COFFRE) throw new ConfigurationFausse('SKANFACT_COFFRE manque : la production scelle les clés des entreprises avec SA clé');
  let coffre: Buffer;
  try { coffre = env.SKANFACT_COFFRE ? cleDuCoffre(env.SKANFACT_COFFRE) : CLE_DU_COFFRE_D_ESSAI; } catch (e) {
    if (!(e instanceof CoffreFaux)) throw e;
    throw new ConfigurationFausse('SKANFACT_COFFRE : la clé du coffre fait 32 octets, écrits en base64 (openssl rand -base64 32)');
  }
  // En production, le nombre de relais se dit toujours (même 0) : oublié derrière le frontal, chaque visiteur aurait
  // l'adresse de la machine, que la limite par adresse ne compte pas (brique 142).
  if (environnement === 'production' && env.SKANFACT_PROXY === undefined) throw new ConfigurationFausse('SKANFACT_PROXY manque : combien de relais de confiance (le frontal) se tiennent devant le serveur, 0 s\'il n\'y en a pas');
  const sms = env.SKANFACT_SMS ?? 'aucun';
  if (sms !== 'aucun') throw new ConfigurationFausse(`SKANFACT_SMS « ${sms} » : aucun fournisseur de SMS n'est encore branché`);
  if (environnement === 'production') throw new ConfigurationFausse('la production exige un fournisseur de SMS, qui n\'est pas encore choisi (03 § 6)');
  const port = Number(env.SKANFACT_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigurationFausse(`SKANFACT_PORT « ${env.SKANFACT_PORT} » n'est pas un port`);
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const adresse = env.SKANFACT_ADRESSE ? env.SKANFACT_ADRESSE.replace(/\/+$/, '') : null;
  if (adresse && !/^https?:\/\/[^/]+$/.test(adresse)) throw new ConfigurationFausse(`SKANFACT_ADRESSE « ${adresse} » : une origine (https://nom), sans chemin`);
  const konnect = (env.SKANFACT_KONNECT ?? KONNECT_PAR_DEFAUT).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(konnect)) throw new ConfigurationFausse(`SKANFACT_KONNECT « ${konnect} » n'est pas une adresse`);
  const digigo = env.SKANFACT_DIGIGO ? env.SKANFACT_DIGIGO.replace(/\/+$/, '') : null;
  if (digigo && !/^https?:\/\//.test(digigo)) throw new ConfigurationFausse(`SKANFACT_DIGIGO « ${digigo} » n'est pas une adresse`);
  if (digigo && !env.SKANFACT_DIGIGO_CLE) throw new ConfigurationFausse('SKANFACT_DIGIGO_CLE manque : la clé de SkanFact comme entité d\'intégration DigiGo');
  const ttn = env.SKANFACT_TTN ? env.SKANFACT_TTN.replace(/\/+$/, '') : null;
  if (ttn && !/^https?:\/\//.test(ttn)) throw new ConfigurationFausse(`SKANFACT_TTN « ${ttn} » n'est pas une adresse`);
  const lectures = Number(env.SKANFACT_LECTURES ?? 2);
  if (!Number.isInteger(lectures) || lectures < 1 || lectures > 32) throw new ConfigurationFausse(`SKANFACT_LECTURES « ${env.SKANFACT_LECTURES} » : un nombre de lectures à la fois, de 1 à 32`);
  const proxy = Number(env.SKANFACT_PROXY ?? 0);
  if (!Number.isInteger(proxy) || proxy < 0 || proxy > 5) throw new ConfigurationFausse(`SKANFACT_PROXY « ${env.SKANFACT_PROXY} » : le nombre de relais de confiance devant le serveur, de 0 à 5`);
  const smtp = env.SKANFACT_SMTP ?? null;
  if (smtp && !/^smtps?:\/\/[^/]+$/.test(smtp)) throw new ConfigurationFausse('SKANFACT_SMTP : l\'adresse du relais, smtp://utilisateur:mot-de-passe@hote:587 (ou smtps://…:465)');
  const de = env.SKANFACT_COURRIEL_DE ?? null;
  if (smtp && !(de && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(de))) throw new ConfigurationFausse('SKANFACT_COURRIEL_DE : l\'adresse d\'où partent les e-mails (par exemple ne-pas-repondre@skanfact.tn)');
  let partenaires: Partenaire[];
  // Les partenaires déclarés (brique 133) : ceux du dépôt (serveur/partenaires.json : des adresses et des empreintes,
  // rien de secret), sauf si l'environnement en donne d'autres. Un serveur d'essai admet aussi un retour sur le poste.
  try { partenaires = lirePartenaires(env.SKANFACT_PARTENAIRES ?? fs.readFileSync(path.join(ici, 'partenaires.json'), 'utf8'), { essai: environnement === 'test' }); } catch {
    throw new ConfigurationFausse('SKANFACT_PARTENAIRES : la liste des partenaires en JSON (code, nom, retours https, empreinteSecret, gestes)');
  }
  return {
    base, environnement, port, hote: env.SKANFACT_HOTE ?? '127.0.0.1', sms,
    listeVolee: env.SKANFACT_LISTE_VOLEE ?? path.join(ici, '../tests/donnees/mots-de-passe-voles.txt'),
    livreurMs: Number(env.SKANFACT_LIVREUR_MS ?? 15_000),
    web: env.SKANFACT_WEB ?? path.join(ici, '../dist/web'),
    adresse, konnect, coffre, verificationMs: Number(env.SKANFACT_VERIFICATION_MS ?? 60_000),
    digigo: digigo ? { base: digigo, cle: env.SKANFACT_DIGIGO_CLE ?? '' } : null,
    ttn, ttnMs: Number(env.SKANFACT_TTN_MS ?? 60_000), contratsMs: Number(env.SKANFACT_CONTRATS_MS ?? 3_600_000),
    lectures, partenaires, proxy, version: env.SKANFACT_VERSION ?? versionDuCode(),
    courriel: smtp && de ? { smtp, de } : null,
  };
}

// Sans fournisseur, un SMS ne part jamais en silence : la personne est invitée à choisir
// l'application d'authentification.
export const smsAucun: Contexte['sms'] = { envoyer: async () => { throw new Refus('connexion.sms_indisponible', { bouton: 'compte.code.configurer' }); } };

// Les écrans : l'application web construite, servie à la même adresse que l'API (même origine).
// Une adresse inconnue rend l'application (elle choisit son écran) ; une adresse inconnue de l'API,
// jamais. Les en-têtes interdisent tout script venu d'ailleurs et l'intégration dans un autre site.
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  // Les polices de l'entrée, et celles que l'assistant de démarrage charge depuis plateforme/polices : déjà compressées.
  '.woff2': 'font/woff2',
};
// L'aperçu d'un document de la v10 se dessine dans un cadre (`frame-src` : data: et blob:, comme sa
// propre politique le permet).
const POLITIQUE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' data: blob:; "
  + "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
export function servirLesEcrans(app: ReturnType<typeof creerApp>, dossier: string, version = 'dev') {
  const racine = path.resolve(dossier);
  if (!fs.existsSync(path.join(racine, 'index.html'))) return;
  const ecrans = fichiersDesEcrans(racine, version);
  app.get('/*', async (requete, reponse) => {
    const chemin = decodeURIComponent(new URL(requete.url, 'http://x').pathname);
    if (chemin.startsWith('/v1/') || chemin === '/v1') return reponse.code(404).send({});
    let fichier = path.resolve(racine, `.${chemin}`);
    if (!fichier.startsWith(racine + path.sep) && fichier !== racine) return reponse.code(404).send({});
    // Un dossier sert sa propre page d'entrée (/v10/ : l'application v10) ; une adresse inconnue,
    // l'entrée de l'application.
    if (fs.existsSync(fichier) && fs.statSync(fichier).isDirectory()) fichier = path.join(fichier, 'index.html');
    if (!fs.existsSync(fichier)) fichier = path.join(racine, 'index.html');
    // Léger sur une connexion lente (brique 118 ; docs/leger.md) : un fichier demandé avec son empreinte (« ?v= ») ne
    // change jamais et se garde un an ; sans elle, il se revalide (304 s'il n'a pas changé) ; il part compressé.
    const f = ecrans.lire(fichier);
    const type = TYPES[path.extname(fichier)] ?? 'application/octet-stream';
    const etag = `"${f.empreinte}"`;
    const immuable = fichier.includes(`${path.sep}assets${path.sep}`) || new URL(requete.url, 'http://x').searchParams.get('v') === f.empreinte;
    reponse.header('content-type', type)
      .header('content-security-policy', POLITIQUE).header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer')
      .header('cache-control', immuable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .header('etag', etag).header('vary', 'accept-encoding');
    if (dejaGarde(requete.headers['if-none-match'], etag)) return reponse.code(304).send();
    const encodage = f.contenu.length > SEUIL_COMPRESSION && compressible(type) ? choisirEncodage(requete.headers['accept-encoding']) : null;
    if (encodage) return reponse.header('content-encoding', encodage).send(ecrans.compresse(f, encodage));
    return reponse.send(f.contenu);
  });
}

export async function demarrer(c: Configuration, dependances: { envoyer?: Envoyeur; courriel?: EnvoiCourriel } = {}): Promise<{ adresse: string; arreter: () => Promise<void> }> {
  const pool = creerPool(c.base);
  // L'adresse publique : réglée, sinon celle où le serveur écoute (connue une fois qu'il écoute).
  let publique = c.adresse ?? '';
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(c.listeVolee), sms: smsAucun, paiement: { konnect: c.konnect, coffre: c.coffre, adresse: () => publique },
    ...(c.digigo ? { efacture: { digigo: c.digigo.base, cleDigigo: c.digigo.cle } } : {}), ttn: { adresse: c.ttn, coffre: c.coffre },
    lecteur: await lecteurDuServeur({ simultanees: c.lectures }), partenaires: { liste: c.partenaires, cle: c.coffre } };
  // Le relais des e-mails (un essai en donne un autre, qui garde ce qu'il reçoit) ; sans lui, aucun e-mail ne part.
  const envoiCourriel = dependances.courriel ?? (c.courriel ? courrielSmtp(c.courriel.smtp, c.courriel.de) : null);
  if (envoiCourriel) ctx.courriel = { envoi: envoiCourriel, adresse: () => publique };
  declarerGestesVentes();
  declarerGestesCaisse();
  declarerGestesAchats();
  declarerGestesPaie();
  declarerGestesCompta();
  const app = creerApp(ctx, [...routesSocle(ctx), ...routesGroupe(ctx), ...routesVentes(ctx), ...routesCaisse(), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx), ...routesPartenaires(ctx)], { proxy: c.proxy });
  servirLesEcrans(app, c.web, c.version);
  const adresse = await app.listen({ port: c.port, host: c.hote });
  if (!publique) publique = adresse;

  // Le livreur des avis : un tour à la fois, jamais deux en même temps.
  const envoyer = dependances.envoyer ?? envoyerHttps;
  let tour: Promise<unknown> = Promise.resolve();
  let enCours = false;
  const minuterie = setInterval(() => {
    if (enCours) return;
    enCours = true;
    tour = livrerAvis(pool, envoyer).catch((e: unknown) => { app.log.error(e); }).finally(() => { enCours = false; });
  }, c.livreurMs);

  // Le filet du paiement en ligne (brique 78) : chaque minute, les demandes restées ouvertes se
  // redemandent au prestataire ; un seul tour à la fois.
  let verification: Promise<unknown> = Promise.resolve();
  let verifie = false;
  const veilleur = setInterval(() => {
    if (verifie) return;
    verifie = true;
    verification = verifierEnAttente(ctx).catch((e: unknown) => { app.log.error(e); }).finally(() => { verifie = false; });
  }, c.verificationMs);

  // Le facteur de la TTN (brique 82) : les pièces signées à déposer, celles déposées à relire ; un seul
  // tour à la fois.
  let tournee: Promise<unknown> = Promise.resolve();
  let enTournee = false;
  const facteur = setInterval(() => {
    if (enTournee || !c.ttn) return;
    enTournee = true;
    tournee = envoyerALaTtn(ctx).catch((e: unknown) => { app.log.error(e); }).finally(() => { enTournee = false; });
  }, c.ttnMs);

  // Les factures périodiques émises seules (brique 129) : au démarrage (un serveur redémarré plus souvent qu'une fois
  // l'heure ne les oublierait pas), puis chaque heure, les contrats dus ; un seul tour à la fois.
  let echeancier: Promise<unknown> = Promise.resolve();
  let enEcheances = false;
  const tourDesContrats = () => {
    if (enEcheances) return;
    enEcheances = true;
    echeancier = emettreLesContrats(ctx).catch((e: unknown) => { app.log.error(e); }).finally(() => { enEcheances = false; });
  };
  tourDesContrats();
  const contrats = setInterval(tourDesContrats, c.contratsMs);

  return {
    adresse,
    arreter: async () => {
      clearInterval(minuterie);
      clearInterval(veilleur);
      clearInterval(facteur);
      clearInterval(contrats);
      await tour;
      await verification;
      await tournee;
      await echeancier;
      await app.close();
      await pool.end();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const c = lireConfiguration(process.env);
    const s = await demarrer(c);
    console.log(`SkanFact écoute sur ${s.adresse} (${c.environnement})`);
    const fin = () => { void s.arreter().then(() => process.exit(0)); };
    process.on('SIGTERM', fin);
    process.on('SIGINT', fin);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(e instanceof ConfigurationFausse ? 2 : 1);
  }
}
