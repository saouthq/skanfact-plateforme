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
//   SKANFACT_SMS             « aucun » (par défaut) ou « winsms » : le code de connexion par SMS (décision de
//                            Skander du 12/10/2026 ; 0081). Sans lui, le SMS ne se propose pas : l'e-mail
//                            (par défaut) et l'application d'authentification restent
//   SKANFACT_SMS_CLE         la clé de l'API WinSMS (exigée avec « winsms » ; exploitation/sms.sh la pose)
//   SKANFACT_SMS_EXPEDITEUR  le nom d'expéditeur accordé par WinSMS (« SkanFact ») ; sans lui, celui du compte
//   SKANFACT_SMS_ADRESSE     l'API de WinSMS (https://www.winsmspro.com/sms/sms/api par défaut)
//   SKANFACT_SMTP, SKANFACT_COURRIEL_DE   le relais des e-mails et l'adresse d'où ils partent ; exigés en
//                            production : le code par e-mail est le code de connexion par défaut
//   SKANFACT_ADRESSE         l'adresse publique du serveur (https), où reviennent le client et l'avis
//                            du prestataire de paiement ; par défaut, celle où il écoute
//   SKANFACT_KONNECT         l'API de Konnect (https://api.konnect.network/api/v2 par défaut)
//   SKANFACT_DIGIGO          l'API DigiGo de TunTrust (la signature de la facture électronique) ; sans elle,
//                            la signature n'est pas branchée (et le dit)
//   SKANFACT_DIGIGO_CLE      la clé de SkanFact comme « entité d'intégration » DigiGo (exigée avec l'API)
//   SKANFACT_TTN             le service El Fatoora de la TTN (l'envoi des factures électroniques signées) ;
//                            sans lui, les pièces signées attendent (et l'écran le dit)
//   SKANFACT_TTN_MS          le rythme du facteur de la TTN, en millisecondes (60 000 par défaut)
//   SKANFACT_ALERTES_MS      le rythme des alertes par e-mail de la messagerie, en millisecondes (60 000 par
//                            défaut) ; sans relais d'e-mails, aucune ne part
//   SKANFACT_COFFRE          la clé du coffre (32 octets en base64) qui scelle les clés confiées par les
//                            entreprises (serveur/coffre.ts) ; exigée en production, une clé d'essai
//                            connue de tous sinon
//   SKANFACT_LECTURES        combien de factures d'achat se lisent à la fois sur ce serveur (2 par défaut) ;
//                            la lecture demande Tesseract (avec le français) et Poppler, sinon elle n'est
//                            pas branchée (et l'écran le dit)
//   SKANFACT_VEILLE_FICHIER  ce que la veille du serveur écrit chaque minute (/var/lib/skanfact/veille.json par
//                            défaut) : la console le lit ; absent, elle dit le service « non mesuré »
//   SKANFACT_MESURES_MS      le rythme où le serveur range ses mesures dans la base (60 000 par défaut ;
//                            serveur/service/collecte.ts)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerApp, type Route } from './app.ts';
import { courrielSmtp, type EnvoiCourriel } from './courriel.ts';
import { emettreLesContrats } from './v10/contrats.ts';
import { envoyerHttps, livrerAvis, type Envoyeur } from './avis.ts';
import { creerPool } from './base.ts';
import { CLE_DU_COFFRE_D_ESSAI, cleDuCoffre, CoffreFaux } from './coffre.ts';
import type { Contexte } from './connexion.ts';
import { choisirEncodage, compressible, SEUIL_COMPRESSION } from './compression.ts';
import { dejaGarde, fichiersDesEcrans, versionDuCode } from './ecrans.ts';
import { noterPanne, Refus } from './erreurs.ts';
import { listeDepuisFichier } from './mot-de-passe.ts';
import { smsWinsms, WINSMS_PAR_DEFAUT } from './sms.ts';
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
import { declarerGestesMessagerie } from './messagerie/gestes.ts';
import { prevenirParCourriel } from './messagerie/postier.ts';
import { relancerLesAbonnements } from './abonnement/relances.ts';
import { routesAbonnement } from './abonnement/routes.ts';
import { routesConsole } from './console/routes.ts';
import { routesMessagerie } from './messagerie/routes.ts';
import { declarerGestesVentes } from './ventes/gestes.ts';
import { routesVentes } from './ventes/routes.ts';
import { envoyerALaTtn } from './v10/envoi.ts';
import { verifierEnAttente } from './v10/paiement.ts';
import { routesV10 } from './v10/routes.ts';
import { lirePartenaires, routesPartenaires, type Partenaire } from './partenaires.ts';
import { KONNECT_PAR_DEFAUT } from './ventes/konnect.ts';
import { Collecte, envoyerMesures, nomExemplaire } from './service/collecte.ts';

export type Configuration = {
  base: string; environnement: 'test' | 'production'; port: number; hote: string; listeVolee: string;
  // Le fournisseur de SMS (0081) : aucun, ou WinSMS avec sa clé (de l'environnement, jamais du dépôt).
  sms: 'aucun' | { fournisseur: 'winsms'; cle: string; expediteur: string | null; adresse: string }; livreurMs: number; web: string; adresse: string | null; konnect: string; coffre: Buffer; verificationMs: number;
  digigo: { base: string; cle: string } | null;
  ttn: string | null; ttnMs: number; contratsMs: number; alertesMs: number; relancesMs: number; mesuresMs: number;
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
  // Le fichier où la veille du serveur écrit ce qu'elle voit chaque minute (exploitation/veiller.ts) : la console le lit
  // (docs/console.md). Absent, la console dit le service « non mesuré ».
  veille: string;
};

export class ConfigurationFausse extends Error {}

export function lireConfiguration(env: Record<string, string | undefined>): Configuration {
  const base = env.SKANFACT_BASE;
  if (!base) throw new ConfigurationFausse('SKANFACT_BASE manque : l\'adresse de la base, avec le compte du serveur');
  const environnement = env.SKANFACT_ENVIRONNEMENT;
  if (environnement !== 'test' && environnement !== 'production') throw new ConfigurationFausse('SKANFACT_ENVIRONNEMENT : « test » ou « production »');
  // La clé du coffre : celle de la production ne vient que de l'environnement (jamais la clé d'essai).
  if (environnement === 'production' && !env.SKANFACT_COFFRE) throw new ConfigurationFausse('SKANFACT_COFFRE manque : la production scelle les clés des entreprises avec SA clé');
  let coffre: Buffer;
  try { coffre = env.SKANFACT_COFFRE ? cleDuCoffre(env.SKANFACT_COFFRE) : CLE_DU_COFFRE_D_ESSAI; } catch (e) {
    if (!(e instanceof CoffreFaux)) throw e;
    throw new ConfigurationFausse('SKANFACT_COFFRE : la clé du coffre fait 32 octets, écrits en base64 (openssl rand -base64 32)');
  }
  // En production, le nombre de relais se dit toujours (même 0) : oublié derrière le frontal, chaque visiteur aurait
  // l'adresse de la machine, que la limite par adresse ne compte pas (brique 142).
  if (environnement === 'production' && env.SKANFACT_PROXY === undefined) throw new ConfigurationFausse('SKANFACT_PROXY manque : combien de relais de confiance (le frontal) se tiennent devant le serveur, 0 s\'il n\'y en a pas');
  const choixSms = env.SKANFACT_SMS ?? 'aucun';
  if (choixSms !== 'aucun' && choixSms !== 'winsms') throw new ConfigurationFausse(`SKANFACT_SMS « ${choixSms} » : « aucun » ou « winsms »`);
  let sms: Configuration['sms'] = 'aucun';
  if (choixSms === 'winsms') {
    if (!env.SKANFACT_SMS_CLE) throw new ConfigurationFausse('SKANFACT_SMS_CLE manque : la clé de l\'API WinSMS (exploitation/sms.sh la pose)');
    const adresseSms = (env.SKANFACT_SMS_ADRESSE ?? WINSMS_PAR_DEFAUT).replace(/\/+$/, '');
    if (!/^https:\/\//.test(adresseSms)) throw new ConfigurationFausse(`SKANFACT_SMS_ADRESSE « ${adresseSms} » : l'API de WinSMS, en https`);
    const expediteur = env.SKANFACT_SMS_EXPEDITEUR?.trim() || null;
    if (expediteur && !/^[A-Za-z0-9 ]{1,11}$/.test(expediteur)) throw new ConfigurationFausse('SKANFACT_SMS_EXPEDITEUR : le nom d\'expéditeur accordé par WinSMS, onze lettres ou chiffres au plus');
    sms = { fournisseur: 'winsms', cle: env.SKANFACT_SMS_CLE, expediteur, adresse: adresseSms };
  }
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
  if (smtp && !(de && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(de))) throw new ConfigurationFausse('SKANFACT_COURRIEL_DE : l\'adresse d\'où partent les e-mails (par exemple ne-pas-repondre@send.skanfact.tn)');
  // Le code par e-mail est le code de connexion par défaut (0081) : sans relais, la production n'en aurait aucun.
  if (environnement === 'production' && !smtp) throw new ConfigurationFausse('SKANFACT_SMTP manque : la production envoie le code de connexion par e-mail (exploitation/courriel.sh pose le relais)');
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
    alertesMs: Number(env.SKANFACT_ALERTES_MS ?? 60_000),
    relancesMs: Number(env.SKANFACT_RELANCES_MS ?? 3_600_000),
    mesuresMs: Number(env.SKANFACT_MESURES_MS ?? 60_000),
    lectures, partenaires, proxy, version: env.SKANFACT_VERSION ?? versionDuCode(),
    courriel: smtp && de ? { smtp, de } : null,
    veille: env.SKANFACT_VEILLE_FICHIER ?? path.join(env.SKANFACT_ETAT ?? '/var/lib/skanfact', 'veille.json'),
  };
}

// Sans fournisseur, un SMS ne part jamais en silence : l'écran ne le propose pas (`disponible`), et un envoi demandé
// quand même se refuse en invitant à choisir l'e-mail ou l'application.
export const smsAucun: Contexte['sms'] = { disponible: false, envoyer: async () => { throw new Refus('connexion.sms_indisponible', { bouton: 'compte.code.configurer' }); } };

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

// Toutes les routes du serveur, chaque module déclarant d'abord ses gestes : ce que le serveur sert, et ce qu'un test lit
// sans le démarrer (le contexte n'est lu qu'au moment de servir).
export function routesDuServeur(ctx: Contexte, options: { veille: string | null }): Route<never>[] {
  declarerGestesVentes();
  declarerGestesCaisse();
  declarerGestesAchats();
  declarerGestesPaie();
  declarerGestesCompta();
  declarerGestesMessagerie();
  return [...routesSocle(ctx), ...routesGroupe(ctx), ...routesVentes(ctx), ...routesCaisse(), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx),
    ...routesCabinet(ctx), ...routesV10(ctx), ...routesPartenaires(ctx), ...routesMessagerie(ctx), ...routesAbonnement(), ...routesConsole(ctx, options)];
}

export async function demarrer(c: Configuration, dependances: { envoyer?: Envoyeur; courriel?: EnvoiCourriel; sms?: Contexte['sms'] } = {}): Promise<{ adresse: string; arreter: () => Promise<void> }> {
  const pool = creerPool(c.base);
  // L'adresse publique : réglée, sinon celle où le serveur écoute (connue une fois qu'il écoute).
  let publique = c.adresse ?? '';
  // Le fournisseur de SMS (un essai en donne un autre, qui garde ce qu'il reçoit) ; sans lui, aucun SMS ne part.
  const sms = dependances.sms ?? (c.sms === 'aucun' ? smsAucun : smsWinsms({ cle: c.sms.cle, expediteur: c.sms.expediteur, adresse: c.sms.adresse }));
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(c.listeVolee), sms, paiement: { konnect: c.konnect, coffre: c.coffre, adresse: () => publique },
    ...(c.digigo ? { efacture: { digigo: c.digigo.base, cleDigigo: c.digigo.cle } } : {}), ttn: { adresse: c.ttn, coffre: c.coffre },
    lecteur: await lecteurDuServeur({ simultanees: c.lectures }), partenaires: { liste: c.partenaires, cle: c.coffre } };
  // Le relais des e-mails (un essai en donne un autre, qui garde ce qu'il reçoit) ; sans lui, aucun e-mail ne part.
  const envoiCourriel = dependances.courriel ?? (c.courriel ? courrielSmtp(c.courriel.smtp, c.courriel.de) : null);
  if (envoiCourriel) ctx.courriel = { envoi: envoiCourriel, adresse: () => publique };
  const collecte = new Collecte();
  const app = creerApp(ctx, routesDuServeur(ctx, { veille: c.veille }), { proxy: c.proxy, collecte });
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
    tour = livrerAvis(pool, envoyer).catch((e: unknown) => { noterPanne('tâche livrerAvis', e); }).finally(() => { enCours = false; });
  }, c.livreurMs);

  // Le filet du paiement en ligne (brique 78) : chaque minute, les demandes restées ouvertes se
  // redemandent au prestataire ; un seul tour à la fois.
  let verification: Promise<unknown> = Promise.resolve();
  let verifie = false;
  const veilleur = setInterval(() => {
    if (verifie) return;
    verifie = true;
    verification = verifierEnAttente(ctx).catch((e: unknown) => { noterPanne('tâche verifierEnAttente', e); }).finally(() => { verifie = false; });
  }, c.verificationMs);

  // Le facteur de la TTN (brique 82) : les pièces signées à déposer, celles déposées à relire ; un seul
  // tour à la fois.
  let tournee: Promise<unknown> = Promise.resolve();
  let enTournee = false;
  const facteur = setInterval(() => {
    if (enTournee || !c.ttn) return;
    enTournee = true;
    tournee = envoyerALaTtn(ctx).catch((e: unknown) => { noterPanne('tâche envoyerALaTtn', e); }).finally(() => { enTournee = false; });
  }, c.ttnMs);

  // Les factures périodiques émises seules (brique 129) : au démarrage (un serveur redémarré plus souvent qu'une fois
  // l'heure ne les oublierait pas), puis chaque heure, les contrats dus ; un seul tour à la fois.
  let echeancier: Promise<unknown> = Promise.resolve();
  let enEcheances = false;
  const tourDesContrats = () => {
    if (enEcheances) return;
    enEcheances = true;
    echeancier = emettreLesContrats(ctx).catch((e: unknown) => { noterPanne('tâche emettreLesContrats', e); }).finally(() => { enEcheances = false; });
  };
  tourDesContrats();
  const contrats = setInterval(tourDesContrats, c.contratsMs);

  // Les alertes par e-mail de la messagerie (lot messagerie) : chaque minute, qui a un message à lire depuis cinq
  // minutes ; un seul tour à la fois, et rien sans relais d'e-mails.
  let alertes: Promise<unknown> = Promise.resolve();
  let enAlertes = false;
  const postier = setInterval(() => {
    if (enAlertes || !ctx.courriel) return;
    enAlertes = true;
    alertes = prevenirParCourriel(ctx).catch((e: unknown) => { noterPanne('tâche prevenirParCourriel', e); }).finally(() => { enAlertes = false; });
  }, c.alertesMs);

  // Les relances de l'abonnement (docs/abonnement.md) : au démarrage, puis chaque heure, les échéances proches ; un seul
  // tour à la fois, et rien sans relais d'e-mails.
  let relances: Promise<unknown> = Promise.resolve();
  let enRelances = false;
  const tourDesRelances = () => {
    if (enRelances || !ctx.courriel) return;
    enRelances = true;
    relances = relancerLesAbonnements(ctx).catch((e: unknown) => { noterPanne('tâche relancerLesAbonnements', e); }).finally(() => { enRelances = false; });
  };
  tourDesRelances();
  const relanceur = setInterval(tourDesRelances, c.relancesMs);

  // Les mesures du service (docs/console.md, C12) : chaque minute, ce qui s'est ajouté part dans la base ; un envoi à la
  // fois (une base lente ne les empile pas), et le dernier part à l'arrêt (une installation ne perd pas sa minute).
  const exemplaire = nomExemplaire(os.hostname(), new URL(adresse).port);
  let mesures: Promise<unknown> = Promise.resolve();
  let enMesures = false;
  const mesureur = setInterval(() => {
    if (enMesures) return;
    enMesures = true;
    mesures = envoyerMesures(pool, exemplaire, collecte).finally(() => { enMesures = false; });
  }, c.mesuresMs);

  return {
    adresse,
    arreter: async () => {
      clearInterval(minuterie);
      clearInterval(veilleur);
      clearInterval(facteur);
      clearInterval(contrats);
      clearInterval(postier);
      clearInterval(relanceur);
      clearInterval(mesureur);
      await tour;
      await verification;
      await tournee;
      await echeancier;
      await alertes;
      await relances;
      await app.close();
      await mesures;
      await envoyerMesures(pool, exemplaire, collecte);
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
