// Les routes de la console (skanfact docs/cadrage/10-console.md ; docs/console.md ; 0083). Chacune déclare un geste de
// la console (serveur/console/gestes.ts) : le serveur ouvre alors la transaction au nom du membre de l'équipe, avec SA
// session de la console posée pour la base (app.session_console), et chaque fonction de la base revérifie le rôle.
// L'entrée (se connecter, le code, le renvoyer) est publique, comme celle de l'application.

import fs from 'node:fs/promises';
import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { Introuvable, Perimee } from '../erreurs.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { etatAbonnement, GRACE_JOURS, lireFaits, RELANCES, type Etat, type Faits } from '../abonnement/etat.ts';
import { calculerGeste, GESTES_ABONNEMENT, type GesteAbonnement, type LigneAbonnement } from '../abonnement/gestes.ts';
import { motif, t } from '../../textes/index.ts';
import { connecterConsole, renvoyerCodeConsole, validerCodeConsole } from './connexion.ts';
import { aDecider, CATEGORIES, categorie, chercher, inscriteCetteSemaine, lireEntreprises, lireVeille, rangerParUrgence, tableau, type Veille } from './decider.ts';
import { cabinetsDe, chercherCabinets, ficheCabinet, ligneCabinet, lireCabinets } from './cabinets.ts';
import { annuel, AVENIR_JOURS, cartes, lignesEcheances, lireExtras, lirePrix, vue, VUES, type Vue } from './echeances.ts';
import type { RoleConsole } from './gestes.ts';
import './textes.ts';

const uuid = z.string().uuid();
const motifGeste = z.string().trim().min(3, 'console.motif_requis').max(500);
const LIMITE_MAX = 200;
const limite = (q: Record<string, string>) => Math.min(Math.max(Number(q.limite ?? 50) || 50, 1), LIMITE_MAX);
const CURSEUR = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?))\|([0-9a-f-]{36})$/;

// Ce que la base rend, lu au nom du membre de l'équipe (la base refuse sans session de la console).
const lireJson = async <T>(tx: Transaction, requete: string, valeurs: unknown[] = []): Promise<T> => (await tx.query(requete, valeurs)).rows[0]?.v as T;

// La veille du serveur, lue dans son fichier : son contenu et l'heure de son dernier passage ; rien si elle n'existe pas.
async function lireLaVeille(fichier: string | null, maintenant: Date): Promise<Veille> {
  if (!fichier) return lireVeille(null, null, maintenant);
  try {
    const [contenu, s] = await Promise.all([fs.readFile(fichier, 'utf8'), fs.stat(fichier)]);
    return lireVeille(contenu, s.mtime, maintenant);
  } catch { return lireVeille(null, null, maintenant); }
}

// La ligne d'abonnement telle que la base la rend (plateforme.ligne_abonnement), relue prudemment.
function lireLigne(x: unknown): LigneAbonnement | null {
  if (!x || typeof x !== 'object') return null;
  const l = x as Record<string, unknown>;
  const jour = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const essai = jour(l.essai_jusqu_au);
  if (!essai) return null;
  return {
    essai_jusqu_au: essai, paye_jusqu_au: jour(l.paye_jusqu_au),
    offre: l.offre === 'essentiel' || l.offre === 'complet' ? l.offre : null,
    periodicite: l.periodicite === 'annuel' || l.periodicite === 'mensuel' ? l.periodicite : null,
    resilie_le: jour(l.resilie_le), suspendu_le: jour(l.suspendu_le), offert: l.offert === true,
  };
}
const memeLigne = (a: LigneAbonnement | null, b: LigneAbonnement | null) =>
  (a === null || b === null) ? a === b : (Object.keys(a) as (keyof LigneAbonnement)[]).every((k) => a[k] === b[k]);

// Les faits d'après un geste, pour dire l'état d'après AVANT de le faire.
const faitsApres = (f: Faits, l: LigneAbonnement): Faits => lireFaits({
  connu: true, essaiJusquAu: l.essai_jusqu_au, payeJusquAu: l.paye_jusqu_au, offre: l.offre, periodicite: l.periodicite,
  resilieLe: l.resilie_le, suspenduLe: l.suspendu_le, offert: l.offert, bacASable: f.bacASable, tenuParCabinet: f.tenuParCabinet,
});

// Les gestes qu'un rôle peut faire sur cet abonnement, AUJOURD'HUI : l'écran ne propose que ceux-là (la base, elle,
// refuse les autres). Le support prolonge un essai, une fois ; le reste est à la direction.
export function gestesDisponibles(role: RoleConsole, f: Faits, ligne: LigneAbonnement | null, e: Etat, prolongeUneFois: boolean): GesteAbonnement[] {
  if (role === 'technique' || f.bacASable || f.tenuParCabinet) return [];
  const essaiOuSuite = !ligne || e.etat === 'essai' || (e.etat === 'en_retard' && e.apresEssai) || (e.etat === 'lecture_seule' && e.raison === 'essai_termine');
  if (role === 'support') return essaiOuSuite && ligne && !prolongeUneFois && !f.offert ? ['prolonger'] : [];
  if (!ligne) return ['prolonger'];
  const g: GesteAbonnement[] = [];
  if (essaiOuSuite && !f.offert) g.push('prolonger');
  if (!f.offert) g.push('payer');
  if (e.etat === 'actif' && !ligne.resilie_le) g.push('resilier');
  if (ligne.resilie_le) g.push('annuler-resiliation');
  if (!ligne.suspendu_le && !f.offert) g.push('suspendre');
  if (ligne.suspendu_le) g.push('reprendre');
  g.push(f.offert ? 'retirer-offert' : 'offrir');
  return g;
}

export function routesConsole(ctx: Contexte, options: { veille?: string | null } = {}): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  const fichierVeille = options.veille ?? null;
  const roleDe = (qui: { console?: { role: RoleConsole } | undefined } | null): RoleConsole => {
    if (!qui?.console) throw new Error('session de la console attendue');
    return qui.console.role;
  };
  const transaction = (tx: Transaction | null): Transaction => { if (!tx) throw new Error('transaction attendue'); return tx; };

  // ── L'entrée ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/console/connexion', geste: 'public',
    corps: z.object({
      email: z.string().min(1).max(200), motDePasse: z.string().max(200),
      appareil: z.object({ id: uuid.optional(), nom: z.string().min(1).max(80), type: z.enum(['navigateur', 'bureau', 'telephone']) }),
    }),
    traiter: async ({ corps, requete }) => {
      const r = await connecterConsole(ctx, { email: corps.email, motDePasse: corps.motDePasse, ip: requete.ip,
        appareil: { nom: corps.appareil.nom, type: corps.appareil.type, ...(corps.appareil.id ? { id: corps.appareil.id } : {}) } });
      return { statut: r.etat === 'refuse' ? 401 : r.etat === 'attendre' ? 429 : 200, corps: r };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/connexion/code', geste: 'public',
    corps: z.object({ defi: uuid, code: z.string().min(1).max(20) }),
    traiter: async ({ corps, requete }) => {
      const r = await validerCodeConsole(ctx, { defi: corps.defi, code: corps.code, ip: requete.ip });
      return { statut: r.etat === 'connecte' ? 200 : r.etat === 'attendre' ? 429 : 401, corps: r };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/connexion/code/renvoyer', geste: 'public',
    corps: z.object({ defi: uuid }),
    traiter: async ({ corps }) => {
      const r = await renvoyerCodeConsole(ctx, corps.defi);
      return r.ok ? { statut: 202, corps: { ok: true } } : { statut: 409, corps: { motif: r.motif } };
    },
  });

  // ── La session ───────────────────────────────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'GET', chemin: '/console/moi', geste: 'console.session',
    traiter: async (_r, tx) => ({ corps: { aujourdhui: aujourdhuiATunis(), ...await lireJson<Record<string, unknown>>(transaction(tx), 'select plateforme.console_moi() v') } }),
  });
  ajouter({
    methode: 'POST', chemin: '/console/deconnexion', geste: 'console.session',
    traiter: async (_r, tx) => { await transaction(tx).query('select plateforme.fermer_ma_session_console($1)', [maintenant()]); return { corps: { ok: true } }; },
  });

  // ── L'accueil : le tableau du matin et « À décider » ─────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'GET', chemin: '/console/accueil', geste: 'console.accueil.voir',
    traiter: async ({ qui }, tx) => {
      const role = roleDe(qui);
      const jour = aujourdhuiATunis();
      const veille = await lireLaVeille(fichierVeille, maintenant());
      // La technique ne lit aucune donnée de client (03 § 5) : ni la liste, ni ses chiffres.
      const liste = role === 'technique' ? [] : lireEntreprises(await lireJson(transaction(tx), 'select plateforme.console_entreprises() v'), jour);
      const t = tableau(liste, veille, jour);
      return { corps: { aujourdhui: jour, role, tableau: role === 'technique' ? { service: t.service } : t, decider: aDecider(liste, veille, jour, role) } };
    },
  });

  // ── Les clients ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // La liste se range par urgence, se filtre par état (avec le compte de chaque état, calculé par la même fonction) et se
  // cherche ; elle se pagine. « nouvelles=1 » : les seules inscrites de la semaine, la liste que la tuile « Inscriptions »
  // compte (les comptes des états portent alors sur elles).
  ajouter({
    methode: 'GET', chemin: '/console/entreprises', geste: 'console.clients.voir',
    traiter: async ({ query }, tx) => {
      const jour = aujourdhuiATunis();
      const toutes = rangerParUrgence(lireEntreprises(await lireJson(transaction(tx), 'select plateforme.console_entreprises() v'), jour), jour);
      const nouvelles = query.nouvelles === '1' ? toutes.filter((e) => inscriteCetteSemaine(e, jour)) : toutes;
      const cherchees = chercher(nouvelles, String(query.q ?? ''));
      const comptes = Object.fromEntries(CATEGORIES.map((c) => [c, cherchees.filter((e) => categorie(e) === c).length]));
      const etat = CATEGORIES.includes(query.etat as never) ? query.etat : null;
      const gardees = etat ? cherchees.filter((e) => categorie(e) === etat) : cherchees;
      const debut = Math.max(Number(query.debut ?? 0) || 0, 0);
      const n = limite(query);
      const page = gardees.slice(debut, debut + n);
      return { corps: { aujourdhui: jour, total: gardees.length, tous: cherchees.length, comptes, lignes: page, suite: debut + n < gardees.length ? debut + n : null } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/console/entreprises/:id', geste: 'console.clients.voir',
    traiter: async ({ params, qui }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      const fiche = await lireJson<Record<string, unknown> | null>(transaction(tx), 'select plateforme.console_entreprise($1) v', [id]);
      if (!fiche) throw new Introuvable();
      const jour = aujourdhuiATunis();
      const faits = lireFaits((fiche.faits ?? {}) as Record<string, unknown>);
      const etat = etatAbonnement(faits, jour);
      const ligne = lireLigne(fiche.ligne);
      // Les cabinets qui la suivent : la même liste que leur fiche à eux (C3).
      const cabinets = cabinetsDe(id, lireCabinets(await lireJson(transaction(tx), 'select plateforme.console_cabinets() v')));
      return { corps: { aujourdhui: jour, ...fiche, etat, cabinets, gestes: gestesDisponibles(roleDe(qui), faits, ligne, etat, fiche.prolongeDejaUneFois === true) } };
    },
  });

  // ── Les échéances des abonnements (10 § 2.4) ───────────────────────────────────────────────────────────────────────
  // Sur la MÊME liste que les clients : chaque carte compte la liste qu'elle ouvre (C3). Ce qui vient dans les trente
  // jours d'abord ; une vue par état sinon. Les montants hors taxes, au prix du jour ; la liste se pagine.
  ajouter({
    methode: 'GET', chemin: '/console/abonnements', geste: 'console.clients.voir',
    traiter: async ({ query }, tx) => {
      const t = transaction(tx);
      const jour = aujourdhuiATunis();
      const entreprises = lireEntreprises(await lireJson(t, 'select plateforme.console_entreprises() v'), jour);
      const extras = lireExtras(await lireJson(t, 'select plateforme.console_echeances() v'));
      const prix = lirePrix(await lireJson(t, 'select plateforme.prix_du_jour($1::date) v', [jour]));
      const lignes = lignesEcheances(entreprises, extras, prix, jour);
      const v: Vue = VUES.includes(query.vue as Vue) ? query.vue as Vue : 'avenir';
      const gardees = vue(lignes, v, jour);
      const debut = Math.max(Number(query.debut ?? 0) || 0, 0);
      const n = limite(query);
      // Les règles que l'écran dit (les jours des relances, la grâce, l'horizon de « à venir ») viennent d'ici : écrites une
      // seconde fois dans les textes, elles divergeraient au premier réglage.
      return { corps: { aujourdhui: jour, vue: v, cartes: cartes(lignes, jour), annuel: annuel(lignes, prix), total: gardees.length,
        lignes: gardees.slice(debut, debut + n), suite: debut + n < gardees.length ? debut + n : null,
        regles: { relances: RELANCES, grace: GRACE_JOURS, avenir: AVENIR_JOURS } } };
    },
  });

  // ── Les cabinets (10 § 2.3) ──────────────────────────────────────────────────────────────────────────────────────────
  // La liste compte ce que chaque fiche montre, par la même règle ; un dossier s'y dit comme dans la liste des clients.
  ajouter({
    methode: 'GET', chemin: '/console/cabinets', geste: 'console.clients.voir',
    traiter: async ({ query }, tx) => {
      const t = transaction(tx);
      const jour = aujourdhuiATunis();
      const connues = new Set(lireEntreprises(await lireJson(t, 'select plateforme.console_entreprises() v'), jour).map((e) => e.id));
      const tous = lireCabinets(await lireJson(t, 'select plateforme.console_cabinets() v')).map((c) => ligneCabinet(c, connues));
      const gardes = chercherCabinets(tous, String(query.q ?? ''));
      const debut = Math.max(Number(query.debut ?? 0) || 0, 0);
      const n = limite(query);
      return { corps: { aujourdhui: jour, total: gardes.length, tous: tous.length, lignes: gardes.slice(debut, debut + n), suite: debut + n < gardes.length ? debut + n : null } };
    },
  });
  ajouter({
    methode: 'GET', chemin: '/console/cabinets/:id', geste: 'console.clients.voir',
    traiter: async ({ params }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      const t = transaction(tx);
      const cabinet = lireCabinets(await lireJson(t, 'select plateforme.console_cabinets() v')).find((c) => c.id === id);
      if (!cabinet) throw new Introuvable();
      const jour = aujourdhuiATunis();
      const entreprises = lireEntreprises(await lireJson(t, 'select plateforme.console_entreprises() v'), jour);
      return { corps: { aujourdhui: jour, ...ficheCabinet(cabinet, entreprises) } };
    },
  });

  // ── Un geste sur l'abonnement (10 § 2.4) : l'aperçu d'abord (ce que deviendra l'état), puis le geste ──────────────────
  // `ligne` : la ligne d'abonnement que l'écran a lue. Changée depuis, le geste se refuse (01 R15) : on relit d'abord.
  const corpsGeste = z.object({
    motif: z.string().max(500), ligne: z.unknown(), apercu: z.boolean().optional(),
    jours: z.number().int().min(1).max(365).optional(), offre: z.enum(['essentiel', 'complet']).optional(),
    periodicite: z.enum(['annuel', 'mensuel']).optional(),
  });
  const jouer = async (tx: Transaction, id: string, geste: GesteAbonnement, corps: z.infer<typeof corpsGeste>) => {
    if (!uuid.safeParse(id).success) throw new Introuvable();
    const fiche = await lireJson<Record<string, unknown> | null>(tx, 'select plateforme.console_entreprise($1) v', [id]);
    if (!fiche) throw new Introuvable();
    const jour = aujourdhuiATunis();
    const ligne = lireLigne(fiche.ligne);
    if (!memeLigne(ligne, lireLigne(corps.ligne))) throw new Perimee('console.abonnement_change');
    const faits = lireFaits((fiche.faits ?? {}) as Record<string, unknown>);
    const { apres, details } = calculerGeste(ligne, faits, { geste, motif: corps.motif, jours: corps.jours, offre: corps.offre, periodicite: corps.periodicite }, jour);
    const etatApres = etatAbonnement(faitsApres(faits, apres), jour);
    if (corps.apercu) return { corps: { apercu: true, avant: etatAbonnement(faits, jour), apres: etatApres, details } };
    // Le motif reste dans l'histoire de l'abonnement (C1) : l'aperçu s'en passe, le geste jamais.
    if (corps.motif.trim().length < 3) return { statut: 400, corps: { motif: motif('console.motif_requis'), champ: 'motif', raison: t('console.motif_requis') } };
    await tx.query('select plateforme.console_poser_abonnement($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::date)',
      [id, geste, corps.motif.trim(), ligne ? JSON.stringify(ligne) : null, JSON.stringify(apres), JSON.stringify(details), jour]);
    return { corps: { fait: true, etat: etatApres } };
  };
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/abonnement/prolonger', geste: 'console.abonnement.prolonger', corps: corpsGeste,
    traiter: async ({ params, corps }, tx) => jouer(transaction(tx), params.id ?? '', 'prolonger', corps),
  });
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/abonnement/:geste', geste: 'console.abonnement.gerer', corps: corpsGeste,
    traiter: async ({ params, corps }, tx) => {
      const geste = params.geste as GesteAbonnement;
      if (!GESTES_ABONNEMENT.includes(geste)) throw new Introuvable();
      return jouer(transaction(tx), params.id ?? '', geste, corps);
    },
  });

  // ── Le journal (C1) ──────────────────────────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'GET', chemin: '/console/journal', geste: 'console.journal.voir',
    traiter: async ({ query }, tx) => {
      const m = CURSEUR.exec(query.avant ?? '');
      const n = limite(query);
      const qui = uuid.safeParse(query.qui).success ? query.qui : null;
      const entreprise = uuid.safeParse(query.entreprise).success ? query.entreprise : null;
      const lignes = await lireJson<{ curseur: string; id: string }[]>(transaction(tx), 'select plateforme.console_journal($1, $2, $3::timestamptz, $4::uuid, $5) v',
        [qui, entreprise, m?.[1] ?? null, m?.[2] ?? null, n]);
      const derniere = lignes.at(-1);
      // Le curseur ne sert qu'à la suite : il ne part pas avec chaque ligne.
      return { corps: { lignes: lignes.map((l) => ({ ...l, curseur: undefined })), suite: lignes.length === n && derniere ? `${derniere.curseur}|${derniere.id}` : null } };
    },
  });

  // ── L'équipe (10 § 2.10) ─────────────────────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'GET', chemin: '/console/equipe', geste: 'console.equipe.voir',
    traiter: async (_r, tx) => ({ corps: { membres: await lireJson(transaction(tx), 'select plateforme.console_equipe($1) v', [maintenant()]) } }),
  });
  const role = z.enum(['direction', 'support', 'technique']);
  ajouter({
    methode: 'POST', chemin: '/console/equipe', geste: 'console.equipe.gerer',
    corps: z.object({ email: z.string().trim().min(3).max(200), role, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      await transaction(tx).query('select plateforme.console_ajouter_membre($1, $2, $3)', [corps.email, corps.role, corps.motif]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'PUT', chemin: '/console/equipe/:membre', geste: 'console.equipe.gerer',
    corps: z.object({ role, motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.membre).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_changer_role($1, $2, $3)', [params.membre, corps.role, corps.motif]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/equipe/:membre/retirer', geste: 'console.equipe.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.membre).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_retirer_membre($1, $2, $3)', [params.membre, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });

  // ── Le service (10 § 2.8, première partie) : ce que la veille du serveur dit, chaque minute ──────────────────────────
  ajouter({
    methode: 'GET', chemin: '/console/service', geste: 'console.service.voir',
    traiter: async () => ({ corps: { veille: await lireLaVeille(fichierVeille, maintenant()) } }),
  });

  return routes;
}
