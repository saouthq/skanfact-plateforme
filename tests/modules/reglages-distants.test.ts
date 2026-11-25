// 1.388.77 — Les réglages à distance (pilotage depuis la console, point 7 ; base 0232). Ce que le serveur garantit :
//   - la liste de ce qui se règle vit dans le code, avec ses bornes et ses valeurs d'origine (celles du code qui s'en sert) ;
//   - le titulaire de la console seul change un réglage, dans ses bornes, avec un motif ; il le ramène à son origine ;
//   - le réglage est BRANCHÉ : les limites d'appels freinent pour de vrai, l'e-mail du lien dit sa nouvelle durée ;
//   - la page Sécurité de la console dit les chiffres en vigueur.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe, titulaire as designerTitulaire } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { reglagesChanges, reglerLesLimites, REGLAGES_DISTANTS, routesReglagesDistants, valeurReglage, oublierLesReglagesDistants } from '../../serveur/reglages-distants.ts';
import { Limiteur, LIMITES_PAR_ADRESSE, LIMITES_PAR_DEFAUT } from '../../serveur/limites.ts';
import { reglesEnVigueur, REGLES } from '../../serveur/console/securite.ts';
import { demanderReinitialisation } from '../../serveur/connexion.ts';
import { routesMessageClients } from '../../serveur/console/message-clients.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reglages-distants-')), 'veille.json');
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `distant-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${qui} ${n}`, motDePasse: MDP });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
async function membre(prenom: string, role: 'direction' | 'support') {
  const { email, jeton: appli } = await inscrire(prenom);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return { appli, console: String(k.corps.jeton), nom: `${prenom} ${n}`, email };
}
let amira: Awaited<ReturnType<typeof membre>>;
let karim: Awaited<ReturnType<typeof membre>>;
const nettoyer = () => admin.query("delete from plateforme.reglage_distant where motif like 'Essai réglage%'");

beforeAll(async () => {
  await admin.connect();
  await nettoyer();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesMessageClients(), ...routesReglagesDistants(ctx)]);
  await app.ready();
  amira = await membre('amira', 'direction');
  karim = await membre('karim', 'support');
  // Amira pilote les modules : c'est le titulaire (0226) ; une autre personne de la direction ne le peut pas.
  if (!(await admin.query('select titulaire from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where u.email = $1', [amira.email])).rows[0]?.titulaire) {
    await designerTitulaire(admin, amira.email, 'mise en place des essais');
  }
});
afterAll(async () => {
  await nettoyer();
  await app.close(); await admin.end(); await pool.end();
});
describe('le catalogue (pur)', () => {
  it('les valeurs d\'origine sont celles du code qui s\'en sert ; chaque valeur d\'origine tient dans ses bornes', () => {
    const d = Object.fromEntries(REGLAGES_DISTANTS.map((r) => [r.cle, r.defaut]));
    expect(d).toEqual({ 'entree.rafale': LIMITES_PAR_ADRESSE.capacite, 'entree.par_seconde': LIMITES_PAR_ADRESSE.parSeconde,
      'api.par_minute': LIMITES_PAR_DEFAUT.parSeconde * 60, 'api.rafale': LIMITES_PAR_DEFAUT.capacite, 'connexion.lien_minutes': 30, 'connexion.code_minutes': 15 });
    for (const r of REGLAGES_DISTANTS) {
      expect(r.cle).toMatch(/^[a-z_]{2,30}\.[a-z_]{2,30}$/);
      expect(r.defaut).toBeGreaterThanOrEqual(r.min);
      expect(r.defaut).toBeLessThanOrEqual(r.max);
    }
  });
  it('un limiteur se règle sans perdre ses seaux, et revient à ses chiffres de départ', () => {
    let t = 0;
    const l = new Limiteur({ capacite: 5, parSeconde: 1, maintenant: () => t });
    for (let i = 0; i < 5; i++) expect(l.appel('a').permis).toBe(true);
    expect(l.appel('a').permis).toBe(false);
    l.regler({ capacite: 2, parSeconde: 1 });
    expect(l.limite).toBe(2);
    t = 10_000;
    expect(l.appel('a').permis).toBe(true);
    expect(l.appel('a').permis).toBe(true);
    expect(l.appel('a').permis).toBe(false);
    l.revenir();
    expect(l.limite).toBe(5);
  });
  it('la page Sécurité dit les chiffres en vigueur', () => {
    const v = reglesEnVigueur(REGLES, new Map([['entree.rafale', 120], ['api.par_minute', 1200]]));
    expect(v.find((r) => r.nom === 'sans_session')?.valeurs).toEqual({ rafale: 120, parSeconde: LIMITES_PAR_ADRESSE.parSeconde });
    expect(v.find((r) => r.nom === 'api')?.valeurs).toEqual({ minute: 1200, rafale: LIMITES_PAR_DEFAUT.capacite });
    expect(reglesEnVigueur(REGLES, new Map())).toEqual(REGLES);
  });
});

describe('les réglages à distance (base et serveur)', () => {
  const poser = (cle: string, valeur: number | null, motif: string, jeton = amira.console) => appeler('POST', '/console/reglages-distants', jeton, { cle, valeur, motif });

  it('changer, refuser hors des bornes, freiner pour de vrai, revenir à l\'origine', async () => {
    // Le journal se lit depuis le début de CE test : un autre fichier (le parcours à la souris) en pose aussi.
    const debut = (await admin.query('select now() t')).rows[0]?.t as Date;
    // Le support lit (la liste et les valeurs d'origine), ne change rien ; un motif court, une clé inconnue, une valeur hors
    // des bornes, une origine déjà là : refusés.
    const lu0 = (await appeler('GET', '/console/reglages-distants', karim.console)).corps as { titulaire: boolean; reglages: { cle: string }[]; changes: Record<string, unknown> };
    expect(lu0.titulaire).toBe(false);
    expect(lu0.reglages.map((r) => r.cle)).toEqual(REGLAGES_DISTANTS.map((r) => r.cle));
    expect((await poser('entree.rafale', 20, 'Essai réglage support', karim.console)).statut).toBe(403);
    expect((await poser('entree.rafale', 20, 'ok')).statut).toBeGreaterThanOrEqual(400);
    expect((await poser('entree.inconnu', 20, 'Essai réglage inconnu')).statut).toBe(404);
    const hors = await poser('entree.rafale', 5000, 'Essai réglage trop haut');
    expect(hors.statut).toBeGreaterThanOrEqual(400);
    expect(String(hors.corps.motif)).toMatch(/bornes/i);
    expect(String((await poser('entree.rafale', null, 'Essai réglage origine')).corps.motif)).toMatch(/déjà sa valeur d'origine/i);

    // Douze appels d'un coup, un par seconde : le treizième appel sans session d'une même adresse est freiné.
    expect((await poser('entree.rafale', 12, 'Essai réglage rafale')).statut).toBe(200);
    expect(String((await poser('entree.rafale', 12, 'Essai réglage rafale encore')).corps.motif)).toMatch(/déjà cette valeur/i);
    const connexion = () => app.inject({ method: 'GET', url: `${VERSION}/connexion/options`, remoteAddress: '203.0.113.77' });
    const statuts: number[] = [];
    for (let i = 0; i < 13; i++) statuts.push((await connexion()).statusCode);
    expect(statuts.slice(0, 12), String(statuts)).not.toContain(429);
    expect(statuts[12]).toBe(429);

    // La console la montre changée, avec qui et pourquoi ; le journal garde le geste.
    const lu = (await appeler('GET', '/console/reglages-distants', karim.console)).corps as { changes: Record<string, { valeur: number; motif: string; par: string | null }>; historique: { geste: string; avant: { valeur: number | null }; apres: { valeur: number | null } }[] };
    expect(lu.changes['entree.rafale']).toMatchObject({ valeur: 12, motif: 'Essai réglage rafale', par: amira.nom });
    expect(lu.historique[0]).toMatchObject({ geste: 'reglages.distant', avant: { valeur: null }, apres: { valeur: 12 } });

    // Revenir à l'origine : la ligne s'efface, le limiteur retrouve ses chiffres.
    expect((await poser('entree.rafale', null, 'Essai réglage retour')).statut).toBe(200);
    expect((await reglagesChanges(ctx)).has('entree.rafale')).toBe(false);
    const entree = new Limiteur(LIMITES_PAR_ADRESSE), api = new Limiteur();
    entree.regler({ capacite: 3, parSeconde: 1 });
    await reglerLesLimites(ctx, entree, api);
    expect(entree.limite).toBe(LIMITES_PAR_ADRESSE.capacite);
    const journal = (await admin.query("select geste from plateforme.geste_console where geste like 'reglages.distant%' and motif in ('Essai réglage rafale', 'Essai réglage retour') and le >= $1 order by le, id", [debut])).rows.map((r) => r.geste);
    expect(journal).toEqual(['reglages.distant', 'reglages.distant_origine']);
  });

  it('les limites de l\'API suivent leur réglage ; le lien « mot de passe oublié » dit sa nouvelle durée', async () => {
    expect((await poser('api.rafale', 25, 'Essai réglage API')).statut).toBe(200);
    const entree = new Limiteur(LIMITES_PAR_ADRESSE), api = new Limiteur();
    await reglerLesLimites(ctx, entree, api);
    expect(api.limite).toBe(25);
    expect(entree.limite).toBe(LIMITES_PAR_ADRESSE.capacite);

    expect((await poser('connexion.lien_minutes', 45, 'Essai réglage lien')).statut).toBe(200);
    expect(await valeurReglage(ctx, 'connexion.lien_minutes')).toBe(45);
    const envoyes: { texte: string }[] = [];
    const { email } = await inscrire('oubli');
    const avecCourriel: Contexte = { ...ctx, courriel: { envoi: { envoyer: async (m: { texte: string }) => { envoyes.push(m); } } as never, adresse: () => 'https://essai.exemple', console: () => 'https://essai.exemple/console' } };
    await demanderReinitialisation(avecCourriel, email);
    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]?.texte).toContain('45 minutes');
    expect(envoyes[0]?.texte).not.toContain('30 minutes');

    for (const c of ['api.rafale', 'connexion.lien_minutes']) expect((await poser(c, null, 'Essai réglage retour')).statut).toBe(200);
    oublierLesReglagesDistants();
    expect(await valeurReglage(ctx, 'connexion.lien_minutes')).toBe(30);
  });
});
