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
//   SKANFACT_SMS             « aucun » tant que le fournisseur de SMS tunisien n'est pas choisi
//                            (03 § 6, 12 : question ouverte) ; le code se reçoit alors par une
//                            application d'authentification. En production, un fournisseur est exigé.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerApp } from './app.ts';
import { envoyerHttps, livrerAvis, type Envoyeur } from './avis.ts';
import { creerPool } from './base.ts';
import type { Contexte } from './connexion.ts';
import { Refus } from './erreurs.ts';
import { listeDepuisFichier } from './mot-de-passe.ts';
import { routesSocle } from './routes/socle.ts';
import { declarerGestesVentes } from './ventes/gestes.ts';
import { routesVentes } from './ventes/routes.ts';

export type Configuration = {
  base: string; environnement: 'test' | 'production'; port: number; hote: string; listeVolee: string;
  sms: 'aucun'; livreurMs: number;
};

export class ConfigurationFausse extends Error {}

export function lireConfiguration(env: Record<string, string | undefined>): Configuration {
  const base = env.SKANFACT_BASE;
  if (!base) throw new ConfigurationFausse('SKANFACT_BASE manque : l\'adresse de la base, avec le compte du serveur');
  const environnement = env.SKANFACT_ENVIRONNEMENT;
  if (environnement !== 'test' && environnement !== 'production') throw new ConfigurationFausse('SKANFACT_ENVIRONNEMENT : « test » ou « production »');
  const sms = env.SKANFACT_SMS ?? 'aucun';
  if (sms !== 'aucun') throw new ConfigurationFausse(`SKANFACT_SMS « ${sms} » : aucun fournisseur de SMS n'est encore branché`);
  if (environnement === 'production') throw new ConfigurationFausse('la production exige un fournisseur de SMS, qui n\'est pas encore choisi (03 § 6)');
  const port = Number(env.SKANFACT_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigurationFausse(`SKANFACT_PORT « ${env.SKANFACT_PORT} » n'est pas un port`);
  const ici = path.dirname(fileURLToPath(import.meta.url));
  return {
    base, environnement, port, hote: env.SKANFACT_HOTE ?? '127.0.0.1', sms,
    listeVolee: env.SKANFACT_LISTE_VOLEE ?? path.join(ici, '../tests/donnees/mots-de-passe-voles.txt'),
    livreurMs: Number(env.SKANFACT_LIVREUR_MS ?? 15_000),
  };
}

// Sans fournisseur, un SMS ne part jamais en silence : la personne est invitée à choisir
// l'application d'authentification.
export const smsAucun: Contexte['sms'] = { envoyer: async () => { throw new Refus('connexion.sms_indisponible', { bouton: 'compte.code.configurer' }); } };

export async function demarrer(c: Configuration, dependances: { envoyer?: Envoyeur } = {}): Promise<{ adresse: string; arreter: () => Promise<void> }> {
  const pool = creerPool(c.base);
  const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(c.listeVolee), sms: smsAucun };
  declarerGestesVentes();
  const app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
  const adresse = await app.listen({ port: c.port, host: c.hote });

  // Le livreur des avis : un tour à la fois, jamais deux en même temps.
  const envoyer = dependances.envoyer ?? envoyerHttps;
  let tour: Promise<unknown> = Promise.resolve();
  let enCours = false;
  const minuterie = setInterval(() => {
    if (enCours) return;
    enCours = true;
    tour = livrerAvis(pool, envoyer).catch((e: unknown) => { app.log.error(e); }).finally(() => { enCours = false; });
  }, c.livreurMs);

  return {
    adresse,
    arreter: async () => {
      clearInterval(minuterie);
      await tour;
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
