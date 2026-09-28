// Les routes du socle : le compte, la connexion, l'entreprise, l'équipe et la trace. Chacune déclare
// son geste (03 D2). Les écritures sensibles passent par les fonctions de la base, qui appliquent
// les règles de l'équipe (D4 à D6) et tracent.

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import { connecter, deconnecter, inscrire, mettreEnPlaceCode, revoquerAppareil, validerCode, type Contexte } from '../connexion.ts';
import { prochainNumero } from '../numeros.ts';
import { regle } from '../regles.ts';
import { motif } from '../../textes/index.ts';

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
      const entreprises = (await tx.query(`select e.id, e.raison_sociale, socle.mes_roles(e.id) roles from socle.entreprise e order by e.raison_sociale`)).rows;
      return { corps: { ...moi, codeAConfigurer: qui.codeAConfigurer, entreprises } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/moi/code', geste: 'compte.code.configurer',
    corps: z.object({ methode: z.enum(['sms', 'application']) }),
    // La réponse montre les codes de secours UNE fois : ils ne sont gardés qu'en empreinte.
    traiter: async ({ qui, corps }) => {
      if (!qui) throw new Error('session attendue');
      const r = await mettreEnPlaceCode(ctx, qui, corps.methode);
      return { corps: { codesDeSecours: r.codesDeSecours, adresseApplication: r.adresseApplication } };
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
    corps: z.object({ raisonSociale: z.string().min(1).max(200), matriculeFiscal: z.string().max(20).optional() }),
    traiter: async ({ corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const id = (await tx.query('select socle.creer_entreprise($1, $2) id', [corps.raisonSociale, corps.matriculeFiscal ?? null])).rows[0].id;
      await tx.query(`select socle.tracer($1, 'socle.entreprise.creer', 'entreprise', $1, null, $2)`, [id, JSON.stringify({ raisonSociale: corps.raisonSociale })]);
      return { statut: 201, corps: { id } };
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
      return { corps: { membre } };
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

  return routes;
}
