// Les routes du socle : le compte, la connexion, l'entreprise, l'équipe et la trace. Chacune déclare
// son geste (03 D2). Les écritures sensibles passent par les fonctions de la base, qui appliquent
// les règles de l'équipe (D4 à D6) et tracent.

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import { connecter, deconnecter, essayerCode, inscrire, mettreEnPlaceCode, revoquerAppareil, validerCode, type Contexte } from '../connexion.ts';
import { prochainNumero } from '../numeros.ts';
import { regle } from '../regles.ts';
import { requetes } from '../base.ts';
import { creerCle } from '../cles.ts';
import { EVENEMENTS, nouveauSecret } from '../avis.ts';
import { motif, t } from '../../textes/index.ts';
import { Refus } from '../erreurs.ts';
import { matriculeCanonique, refusDuMatricule } from '../matricule.ts';

const uuid = z.string().uuid();
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'champ.jour');
const codeRegle = z.string().regex(/^[a-z_]+(\.[a-z0-9_]+)+$/, 'champ.code_regle');
// Une valeur de règle : des entiers, des textes, des listes et des objets, jamais un nombre à virgule.
const valeurRegle: z.ZodType<unknown> = z.lazy(() => z.union([z.number().int(), z.string(), z.boolean(), z.null(), z.array(valeurRegle), z.record(z.string(), valeurRegle)]));
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
const ROLES = z.array(z.enum(['administrateur', 'commercial', 'caissier', 'serveur', 'magasinier', 'comptabilite_interne', 'paie', 'lecture'])).min(1);
// Toute liste qu'on nomme se pagine (règle du projet).
const LIMITE_MAX = 200;
const limite = (q: Record<string, string>) => Math.min(Math.max(Number(q.limite ?? 50) || 50, 1), LIMITE_MAX);
// La page suivante d'une trace se demande par un curseur « instant|id » : plusieurs gestes d'une
// même transaction ont le même instant, l'identifiant les départage (jamais une ligne sautée).
const CURSEUR = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?)\|([0-9a-f-]{36})$/;
function curseur(q: Record<string, string>): [string, string] {
  const m = CURSEUR.exec(q.avant ?? '');
  return m?.[1] && m[2] ? [m[1], m[2]] : ['infinity', 'ffffffff-ffff-ffff-ffff-ffffffffffff'];
}
function page<T extends { curseur: string; id: string }>(lignes: T[], n: number) {
  const derniere = lignes.at(-1);
  return {
    lignes: lignes.map((l) => { const reste: Partial<T> = { ...l }; delete reste.curseur; return reste; }),
    suite: lignes.length === n && derniere ? `${derniere.curseur}|${derniere.id}` : null,
  };
}

export function routesSocle(ctx: Contexte, maintenant: () => Date = () => new Date()): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // ── Le compte et la connexion ───────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/inscription', geste: 'public',
    corps: z.object({ email: z.string().email(), nom: z.string().min(1).max(120), motDePasse: z.string().max(200) }),
    traiter: async ({ corps }) => {
      const r = await inscrire(ctx, corps.email, corps.nom, corps.motDePasse);
      return r.ok ? { statut: 201, corps: { ok: true } } : { statut: 400, corps: { motif: r.motif, champ: 'motDePasse' } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/connexion', geste: 'public',
    corps: z.object({
      email: z.string().min(1), motDePasse: z.string().max(200), posteDUnAutre: z.boolean().optional(),
      appareil: z.object({ id: uuid.optional(), nom: z.string().min(1).max(80), type: z.enum(['navigateur', 'bureau', 'telephone']) }),
    }),
    traiter: async ({ corps, requete }) => {
      const r = await connecter(ctx, { ...corps, appareil: { nom: corps.appareil.nom, type: corps.appareil.type, ...(corps.appareil.id ? { id: corps.appareil.id } : {}) }, ip: requete.ip });
      const statut = r.etat === 'refuse' ? 401 : r.etat === 'attendre' ? 429 : 200;
      return { statut, corps: r };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/connexion/code', geste: 'public',
    corps: z.object({ defi: uuid, code: z.string().min(1).max(20), posteDUnAutre: z.boolean().optional() }),
    traiter: async ({ corps, requete }) => {
      const r = await validerCode(ctx, { ...corps, ip: requete.ip });
      return { statut: r.etat === 'connecte' ? 200 : r.etat === 'attendre' ? 429 : 401, corps: r };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/deconnexion', geste: 'compte.deconnecter',
    traiter: async ({ qui }) => { if (qui) await deconnecter(ctx, qui); return { corps: { ok: true } }; },
  });

  ajouter({
    methode: 'GET', chemin: '/moi', geste: 'compte.voir',
    traiter: async ({ qui }, tx) => {
      if (!qui || !tx) throw new Error('session attendue');
      const moi = (await tx.query('select id, email, nom, langue, code_methode from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0];
      // Les entreprises de la personne, et celles qu'elle voit par un mandat de son cabinet
      // (parCabinet : elles s'ouvrent dans le Cabinet, jamais comme les siennes).
      const entreprises = (await tx.query(`select e.id, e.raison_sociale, e.essai, socle.mes_roles(e.id) roles,
          socle.perimetre_cabinet(e.id) is not null "parCabinet" from socle.entreprise e order by e.raison_sociale`)).rows;
      const cabinets = (await tx.query(`select o.id, o.nom from socle.organisation o
          join socle.membre m on m.organisation = o.id and m.utilisateur = socle.moi() and m.actif
         where o.type = 'cabinet' order by o.nom, o.id`)).rows;
      return { corps: { ...moi, codeAConfigurer: qui.codeAConfigurer, entreprises, cabinets } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/moi/code', geste: 'compte.code.configurer',
    corps: z.object({ methode: z.enum(['sms', 'application']) }),
    // La réponse montre les codes de secours UNE fois : ils ne sont gardés qu'en empreinte.
    traiter: async ({ qui, corps }) => {
      if (!qui) throw new Error('session attendue');
      const r = await mettreEnPlaceCode(ctx, qui, corps.methode);
      // La clé seule (brique 145) : pour qui l'ajoute à la main dans son application, sans scanner le code QR.
      return { corps: { codesDeSecours: r.codesDeSecours, adresseApplication: r.adresseApplication, cle: r.secret } };
    },
  });
  // Le premier code de l'application qu'on vient d'ajouter (brique 145) : avant de quitter l'écran, la personne vérifie
  // que son téléphone donne le bon code. Rien ne change.
  ajouter({
    methode: 'POST', chemin: '/moi/code/essayer', geste: 'compte.code.configurer',
    corps: z.object({ code: z.string().max(20) }),
    traiter: async ({ qui, corps }) => {
      if (!qui) throw new Error('session attendue');
      if (!await essayerCode(ctx, qui, corps.code)) throw new Refus('compte.code_essai_faux');
      return { corps: { bon: true } };
    },
  });

  // Ses appareils (brique 74) : chacun, son nom, sa dernière activité, s'il est retiré ; celui qui
  // demande est marqué. La base ne montre que les siens.
  ajouter({
    methode: 'GET', chemin: '/moi/appareils', geste: 'compte.appareils.gerer',
    traiter: async ({ qui }, tx) => {
      if (!qui || !tx) throw new Error('session attendue');
      const r = await tx.query(`select a.id, a.nom, a.type, a.premier_vu, a.revoque_le,
          (select max(s.derniere_activite) from socle.session s where s.appareil = a.id) derniere_activite
        from socle.appareil a order by a.revoque_le nulls first, a.premier_vu desc limit 100`);
      return {
        corps: {
          appareils: (r.rows as { id: string; nom: string; type: string; premier_vu: Date; revoque_le: Date | null; derniere_activite: Date | null }[]).map((a) => ({
            id: a.id, nom: a.nom, type: a.type, premierVu: a.premier_vu.toISOString(), retireLe: a.revoque_le ? a.revoque_le.toISOString() : null,
            derniereActivite: a.derniere_activite ? a.derniere_activite.toISOString() : null, celuiCi: a.id === qui.appareil,
          })),
        },
      };
    },
  });
  ajouter({
    methode: 'DELETE', chemin: '/moi/appareils/:appareil', geste: 'compte.appareils.gerer',
    traiter: async ({ qui, params }) => {
      if (!qui || !uuid.safeParse(params.appareil).success) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const ok = await revoquerAppareil(ctx, qui, params.appareil ?? '');
      return ok ? { corps: { ok: true } } : { statut: 404, corps: { motif: motif('commun.introuvable') } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/moi/trace', geste: 'compte.trace.voir',
    traiter: async ({ qui, query }, tx) => {
      if (!qui || !tx) throw new Error('session attendue');
      const [instant, id] = curseur(query);
      const n = limite(query);
      const lignes = (await tx.query(`select id, instant, instant::text curseur, entreprise, geste, objet_type, objet_id, lecture from socle.audit
        where utilisateur = $1 and (instant, id) < ($2::timestamptz, $3::uuid) order by instant desc, id desc limit $4`, [qui.utilisateur, instant, id, n])).rows;
      return { corps: page(lignes, n) };
    },
  });

  // ── L'entreprise ────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/entreprises', geste: 'compte.entreprise.creer',
    corps: z.object({ raisonSociale: z.string().min(1).max(200), matriculeFiscal: z.string().max(40).optional() }),
    traiter: async ({ corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      // Le matricule, écrit comme on le recopie, se garde sous sa forme lisible ; mal formé, il se refuse sur son champ ;
      // déjà celui d'une autre entreprise, la base le refuse en le disant (E4 : la porte répondait par une erreur du
      // serveur, et le même matricule écrit sans barres passait).
      const matricule = matriculeCanonique(corps.matriculeFiscal);
      if (matricule === undefined) return refusDuMatricule(corps.matriculeFiscal);
      const id = (await tx.query('select socle.creer_entreprise($1, $2) id', [corps.raisonSociale, matricule])).rows[0].id;
      await tx.query(`select socle.tracer($1, 'socle.entreprise.creer', 'entreprise', $1, null, $2)`, [id, JSON.stringify({ raisonSociale: corps.raisonSociale })]);
      return { statut: 201, corps: { id } };
    },
  });

  // L'entreprise d'essai des développeurs (14 § 2.5) : une par personne, déjà garnie de clients
  // d'exemple, marquée « essai » pour toujours.
  ajouter({
    methode: 'POST', chemin: '/entreprises-essai', geste: 'compte.entreprise.creer',
    traiter: async (_r, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const id = (await tx.query('select socle.creer_entreprise_essai() id')).rows[0].id as string;
      return { statut: 201, corps: { id, essai: true } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/equipe', geste: 'socle.accueil.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const membres = (await tx.query(`select m.id, m.utilisateur, u.nom, u.email, m.roles, m.actif from socle.membre m
        join socle.utilisateur u on u.id = m.utilisateur where m.entreprise = $1 and m.actif order by u.nom limit $2`, [params.entreprise, LIMITE_MAX])).rows;
      return { corps: { membres } };
    },
  });

  // ── L'équipe ────────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/invitations', geste: 'socle.equipe.gerer',
    corps: z.object({ email: z.string().email(), roles: ROLES }),
    // Le lien d'invitation n'est rendu qu'ici, une fois ; la base n'en garde que l'empreinte.
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const jeton = randomBytes(24).toString('base64url');
      const expire = new Date(maintenant().getTime() + 7 * 24 * 3600_000);
      const id = (await tx.query('select socle.inviter($1, $2, $3, $4, $5) id', [params.entreprise, corps.email, corps.roles, sha256(jeton), expire])).rows[0].id;
      return { statut: 201, corps: { id, jeton, expire } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/invitations/accepter', geste: 'compte.invitation.accepter',
    corps: z.object({ jeton: z.string().min(10).max(100) }),
    traiter: async ({ corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const membre = (await tx.query('select socle.accepter_invitation($1, $2) id', [sha256(corps.jeton), maintenant()])).rows[0].id;
      // Ce que la personne vient de rejoindre : une entreprise, ou un cabinet (brique 46).
      const ou = (await tx.query('select entreprise, organisation from socle.membre where id = $1', [membre])).rows[0] as { entreprise: string | null; organisation: string | null } | undefined;
      return { corps: { membre, entreprise: ou?.entreprise ?? null, cabinet: ou?.organisation ?? null } };
    },
  });

  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/membres/:membre/roles', geste: 'socle.equipe.gerer',
    corps: z.object({ roles: ROLES }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.membre).success) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const dans = (await tx.query('select 1 from socle.membre where id = $1 and entreprise = $2', [params.membre, params.entreprise])).rowCount;
      if (!dans) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await tx.query('select socle.changer_roles($1, $2)', [params.membre, corps.roles]);
      return { corps: { ok: true } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/membres/:membre', geste: 'socle.equipe.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.membre).success) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const dans = (await tx.query('select 1 from socle.membre where id = $1 and entreprise = $2', [params.membre, params.entreprise])).rowCount;
      if (!dans) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await tx.query('select socle.retirer_membre($1)', [params.membre]);
      return { corps: { ok: true } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/transfert', geste: 'socle.propriete.transferer',
    corps: z.object({ vers: uuid }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const id = (await tx.query('select socle.demander_transfert($1, $2) id', [params.entreprise, corps.vers])).rows[0].id;
      return { statut: 201, corps: { id } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/transferts/:transfert/accepter', geste: 'compte.transfert.accepter',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.transfert).success) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await tx.query('select socle.accepter_transfert($1, $2)', [params.transfert, maintenant()]);
      return { corps: { ok: true } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/trace', geste: 'socle.audit.lire',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const [instant, id] = curseur(query);
      const n = limite(query);
      const lignes = (await tx.query(`select a.id, a.instant, a.instant::text curseur, a.utilisateur, u.nom, a.geste, a.objet_type, a.objet_id, a.avant, a.apres, a.lecture
        from socle.audit a left join socle.utilisateur u on u.id = a.utilisateur
        where a.entreprise = $1 and (a.instant, a.id) < ($2::timestamptz, $3::uuid) order by a.instant desc, a.id desc limit $4`, [params.entreprise, instant, id, n])).rows;
      return { corps: page(lignes, n) };
    },
  });

  // ── Les règles fiscales et les séries (01 § 3, § 6) ─────────────────────────────────────────
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/regles/:code', geste: 'socle.accueil.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const code = codeRegle.safeParse(params.code);
      const date = jour.safeParse(query.date);
      if (!code.success || !date.success) return { statut: 400, corps: { motif: motif('regles.code_et_date'), champ: code.success ? 'date' : 'code' } };
      const r = await regle(tx, params.entreprise ?? '', code.data, date.data);
      // Une règle inconnue se dit « non renseignée » : jamais un chiffre inventé (01 R12).
      return { corps: r ?? { valeur: null, motif: motif('regles.non_renseignee') } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/regles', geste: 'socle.reglages_fiscaux.modifier',
    corps: z.object({ code: codeRegle, valeur: valeurRegle, debut: jour, fin: jour.optional(), motif: z.string().min(1).max(500) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const id = (await tx.query('select socle.poser_regle_entreprise($1, $2, $3, $4, $5, $6) id',
        [params.entreprise, corps.code, JSON.stringify(corps.valeur), corps.debut, corps.fin ?? null, corps.motif])).rows[0].id;
      return { statut: 201, corps: { id } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/series', geste: 'socle.accueil.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const series = (await tx.query(`select id, type, prefixe, remise, format, legale, active from socle.serie
        where entreprise = $1 order by type, prefixe limit $2`, [params.entreprise, LIMITE_MAX])).rows;
      return { corps: { series } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/series', geste: 'socle.reglages_fiscaux.modifier',
    corps: z.object({
      type: z.string().regex(/^[a-z_]+$/), prefixe: z.string().regex(/^[A-Z0-9]{1,10}$/, 'champ.prefixe'),
      legale: z.boolean(), remise: z.enum(['annuelle', 'jamais']).optional(), format: z.string().max(40).optional(),
    }).refine((c) => (c.remise ?? 'annuelle') !== 'annuelle' || (c.format ?? '{AAAA}').includes('{AAAA}'),
      { message: 'series.annee_requise', path: ['format'] }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const id = (await tx.query('select socle.creer_serie($1, $2, $3, $4, $5, $6) id',
        [params.entreprise, corps.type, corps.prefixe, corps.legale, corps.remise ?? null, corps.format ?? null])).rows[0].id;
      return { statut: 201, corps: { id } };
    },
  });

  // Une série se touche depuis SON entreprise : jamais par le chemin d'une autre.
  const serieDe = async (tx: Transaction, entreprise: string, serie: string | undefined) =>
    uuid.safeParse(serie).success && (await tx.query('select 1 from socle.serie where id = $1 and entreprise = $2', [serie, entreprise])).rowCount === 1;

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/series/:serie/reprise', geste: 'socle.reglages_fiscaux.modifier',
    corps: z.object({ periode: z.number().int().min(0).max(9999), dernier: z.number().int().min(0) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !(await serieDe(tx, params.entreprise ?? '', params.serie))) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await tx.query('select socle.reprendre_serie($1, $2, $3)', [params.serie, corps.periode, corps.dernier]);
      return { corps: { ok: true } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/series/:serie/prochain', geste: 'socle.accueil.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx || !(await serieDe(tx, params.entreprise ?? '', params.serie))) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const date = jour.safeParse(query.date);
      if (!date.success) return { statut: 400, corps: { motif: motif('series.date_requise'), champ: 'date' } };
      return { corps: await prochainNumero(tx, params.serie ?? '', date.data) };
    },
  });

  // L'état des chaînes du journal inaltérable (le dernier contrôle de chacune).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/chaines', geste: 'socle.audit.lire',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const chaines = (await tx.query(`select cle, rang, controle_le, controle_ok from socle.chaine where entreprise = $1 order by cle limit $2`,
        [params.entreprise, LIMITE_MAX])).rows;
      return { corps: { chaines } };
    },
  });

  // ── Les clés de l'API (03 § 8) ──────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/cles-api', geste: 'socle.cles_api.gerer',
    corps: z.object({ nom: z.string().trim().min(1).max(100), gestes: z.array(z.string().min(3).max(100)).min(1).max(100), expireLe: jour }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      // La clé expire à la fin du jour dit (heure de Tunis, UTC+1).
      const expireLe = new Date(`${corps.expireLe}T23:59:59+01:00`);
      const cle = await creerCle(tx, qui, params.entreprise ?? '', { nom: corps.nom, gestes: corps.gestes, expireLe }, maintenant());
      // La clé ne se montre qu'ici, une seule fois.
      return { statut: 201, corps: cle };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/cles-api', geste: 'socle.cles_api.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const cles = await requetes(tx).selectFrom('socle.cle_api')
        .select(['id', 'nom', 'prefixe', 'gestes', 'cree_par', 'cree_le', 'expire_le', 'revoquee_le', 'derniere_utilisation'])
        .where('entreprise', '=', params.entreprise ?? '').orderBy('cree_le', 'desc').orderBy('id').limit(LIMITE_MAX).execute();
      // Ce que chaque clé peut faire, en mots (« Services connectés », brique 134).
      return { corps: { cles: cles.map((k) => ({ ...k, peut: k.gestes.map((g) => t(`geste.${g}`)) })) } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/cles-api/:cle', geste: 'socle.cles_api.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cle).success) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await tx.query('select socle.revoquer_cle_api($1)', [params.cle]);
      return { corps: { ok: true } };
    },
  });

  // ── Les avis d'événement (14 § 2.5) ─────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/avis-abonnements', geste: 'socle.avis.gerer',
    corps: z.object({
      url: z.string().trim().max(2000).regex(/^https:\/\/[^\s/?#]+[^\s]*$/, 'champ.https'),
      evenements: z.array(z.enum(EVENEMENTS)).min(1).max(EVENEMENTS.length),
    }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const secret = nouveauSecret();
      const id = (await tx.query('select socle.creer_abonnement_avis($1, $2, $3, $4) id',
        [params.entreprise, corps.url, [...new Set(corps.evenements)], secret])).rows[0].id as string;
      // Le secret de signature ne se montre qu'ici, une seule fois.
      return { statut: 201, corps: { id, secret } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/avis-abonnements', geste: 'socle.avis.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const abonnements = await requetes(tx).selectFrom('socle.abonnement_avis')
        .select(['id', 'url', 'evenements', 'cree_par', 'cree_le', 'arrete_le'])
        .where('entreprise', '=', params.entreprise ?? '').orderBy('cree_le', 'desc').orderBy('id').limit(LIMITE_MAX).execute();
      return { corps: { abonnements } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/avis', geste: 'socle.avis.gerer',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const avis = await requetes(tx).selectFrom('socle.avis')
        .select(['id', 'abonnement', 'evenement', 'cree_le', 'essais', 'prochain_essai', 'livre_le', 'abandonne_le', 'dernier_statut', 'derniere_erreur'])
        .where('entreprise', '=', params.entreprise ?? '').orderBy('cree_le', 'desc').orderBy('id', 'desc').limit(limite(query)).execute();
      return { corps: { avis } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/avis-abonnements/:abonnement', geste: 'socle.avis.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.abonnement).success) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await tx.query('select socle.arreter_abonnement_avis($1)', [params.abonnement]);
      return { corps: { ok: true } };
    },
  });

  return routes;
}
