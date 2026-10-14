// Les routes de la console (skanfact docs/cadrage/10-console.md ; docs/console.md ; 0083). Chacune déclare un geste de
// la console (serveur/console/gestes.ts) : le serveur ouvre alors la transaction au nom du membre de l'équipe, avec SA
// session de la console posée pour la base (app.session_console), et chaque fonction de la base revérifie le rôle.
// L'entrée (se connecter, le code, le renvoyer) est publique, comme celle de l'application.

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { Introuvable, Perimee } from '../erreurs.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { ESSAI_JOURS, etatAbonnement, GRACE_JOURS, lireFaits, lireModules, RELANCES, type Etat, type Faits } from '../abonnement/etat.ts';
import { calculerGeste, GESTES_ABONNEMENT, type GesteAbonnement, type LigneAbonnement } from '../abonnement/gestes.ts';
import { lireFacturesAbonnement, lireLignesEnPlus, preparerFacture } from '../abonnement/factures.ts';
import { motif, rendre, t, type Valeurs } from '../../textes/index.ts';
import { EXERCICE_TROP_VIEUX_J, HORS_MACHINE_EN_RETARD_MIN, HORS_MACHINE_GRAVE_MIN, REGLES, SAUVEGARDE_TROP_VIEILLE_H } from '../../exploitation/veille.ts';
import { connecterConsole, renvoyerCodeConsole, validerCodeConsole } from './connexion.ts';
import { aDecider, CATEGORIES, categorie, chercher, inscriteCetteSemaine, lireEntreprises, lireVeille, rangerParUrgence, tableau, type Veille } from './decider.ts';
import { cabinetsDe, chercherCabinets, ficheCabinet, ligneCabinet, lireCabinets } from './cabinets.ts';
import { comptesDesVues, dansLaVue, ligneClient, parAnDeLaSelection, trier, TRIS_CLIENTS, VUES_CLIENTS, type TriClients, type VueClients } from './clients.ts';
import { annuel, AVENIR_JOURS, cartes, lignesEcheances, lireExtras, lirePrix, relancesRecentes, vue, VUES, type Vue } from './echeances.ts';
import {
  alertesOuvertes, BUDGET_DU_GRAPHIQUE, bornes, briques, disponibilite, enLigne, ensemble, estPeriode, journal, joursDuService, lireVeilleDeLaBase,
  misesEnLigne, PERIODES, resume, serie, SEUILS_DU_SERVICE, SORTE_DU_GRAPHIQUE, traficRecent, trenteJours, TUILES, type Periode,
} from './service.ts';
import { enCours, histoire, lireAlertes, MINUTES_JUGEES, prevenus, regles, RYTHME, sujetDuService } from './alertes.ts';
import {
  CALENDRIER, COMMANDES, commandesRemise, copies, exercices, GARDE, horsDeLaMachine, lArchivage, laSauvegarde, leDernierExercice, lignesParNuit,
  lireSauvegardes, nuits as nuitsGardees, pointLePlusAncien, promesses, retardsParHeure,
} from './sauvegardes.ts';
import { attenteDe, etatTour, lireTravaux, PARTENAIRES, quatorzeJours, SANS_TRACE, TOURS } from './travaux.ts';
import { joursDuCertificat, lireClesDeCommande, lireSecurite, rangerARegarder, REGLES as REGLES_DE_CONNEXION } from './securite.ts';
import { historique, lireEtatSuiveur, lireVersionsDeLaBase, prochaine, systemeDe, taches, titreDeTache, versionDAvant, type EtatSuiveur } from './versions.ts';
import { fichesServies, FICHES, lireIncidents, lirePageEtat, maintenances, ouverts, passes, refIncident, suites, type PageEtat } from './incidents.ts';
import { budgets, comparable, exemplaires, laBase, periodeDAvant, routes as lesRoutes, SORTES_DESSINEES } from './performances.ts';
import { essaisEnCours, grille, grilleAjouts, lireAjouts, lireReglages, registre, sujetDesReglages } from './reglages.ts';
import { lireFormats, registreDesFormats } from './formats.ts';
import { articleConnu, articlesDeLAide, CANAUX_NOTES, compter, etatDe, lireSupport, ranger, SANS_REPONSE_HEURES, suggererPour } from './support.ts';
import { lireAcces, HEURES_MAX, PAGE } from '../support/acces.ts';
import { filtrer } from '../v10/droits.ts';
import { versionTeif } from '../v10/teif.ts';
import { BUDGETS } from '../service/mesures.ts';
import { LISTE_GESTES_CONSOLE, type RoleConsole } from './gestes.ts';
import './textes.ts';

const uuid = z.string().uuid();
const REGLES_BRANCHEES = new Set(REGLES.filter((r) => r.branchee).map((r) => r.id));
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
    resilie_le: jour(l.resilie_le), suspendu_le: jour(l.suspendu_le), offert: l.offert === true, modules: lireModules(l.modules),
  };
}
// Deux lignes pareilles : chaque champ, et les modules achetés (une liste) un par un.
const memeLigne = (a: LigneAbonnement | null, b: LigneAbonnement | null) =>
  (a === null || b === null) ? a === b : (Object.keys(a) as (keyof LigneAbonnement)[]).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// Les faits d'après un geste, pour dire l'état d'après AVANT de le faire.
const faitsApres = (f: Faits, l: LigneAbonnement): Faits => lireFaits({
  connu: true, essaiJusquAu: l.essai_jusqu_au, payeJusquAu: l.paye_jusqu_au, offre: l.offre, periodicite: l.periodicite,
  resilieLe: l.resilie_le, suspenduLe: l.suspendu_le, offert: l.offert, bacASable: f.bacASable, tenuParCabinet: f.tenuParCabinet, modules: l.modules,
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
  // Un module acheté seul (14c) : sur ce qui n'est ni Complet ni offert ; se retire tant qu'il en reste un.
  if (!f.offert && ligne.offre !== 'complet' && ligne.modules.length < 2) g.push('ouvrir-module');
  if (ligne.modules.length) g.push('fermer-module');
  return g;
}

export function routesConsole(ctx: Contexte, options: { veille?: string | null } = {}): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  const fichierVeille = options.veille ?? null;
  // L'état que le suiveur écrit à chaque tour (à côté de la page d'état, dans le dossier public : https://…/etat.json) :
  // la version en service, les versions du dépôt, leur numéro (« 1.4.2 »), les consignes lues (C27).
  const lireEtatDuSuiveur = async (): Promise<EtatSuiveur | null> => {
    if (!fichierVeille) return null;
    try { return lireEtatSuiveur(JSON.parse(await fs.readFile(path.join(path.dirname(fichierVeille), 'public', 'etat.json'), 'utf8'))); } catch { return null; }
  };
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
      const instant = maintenant();
      const jour = aujourdhuiATunis();
      const veille = await lireLaVeille(fichierVeille, instant);
      // La technique ne lit aucune donnée de client (03 § 5) : ni la liste, ni ses chiffres, ni les demandes au support.
      const liste = role === 'technique' ? [] : lireEntreprises(await lireJson(transaction(tx), 'select plateforme.console_entreprises() v'), jour);
      const demandes = role === 'technique' ? [] : lireSupport(await lireJson(transaction(tx), 'select plateforme.console_support(null, null) v')).ouvertes;
      const t = tableau(liste, veille, jour, demandes, instant);
      // Les relances que le serveur a envoyées tout seul depuis hier (la même table que l'écran Abonnements).
      const relances = role === 'technique' ? []
        : relancesRecentes(liste, lireExtras(await lireJson(transaction(tx), 'select plateforme.console_echeances() v')), instant);
      return { corps: { aujourdhui: jour, role, tableau: role === 'technique' ? { service: t.service } : t, decider: aDecider(liste, veille, jour, role, demandes, instant), relances } };
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
      const t = transaction(tx);
      const toutes = rangerParUrgence(lireEntreprises(await lireJson(t, 'select plateforme.console_entreprises() v'), jour), jour);
      const prix = lirePrix(await lireJson(t, 'select plateforme.prix_du_jour($1::date) v', [jour]));
      const nouvelles = query.nouvelles === '1' ? toutes.filter((e) => inscriteCetteSemaine(e, jour)) : toutes;
      const cherchees = chercher(nouvelles, String(query.q ?? ''));
      // Les cartes du métier comptent la recherche ; les puces d'état comptent la carte choisie (C3 : chacune par la
      // fonction qui filtre la liste qu'elle ouvre).
      const vues = comptesDesVues(cherchees, jour);
      const laVue: VueClients = VUES_CLIENTS.includes(query.vue as never) ? query.vue as VueClients : 'tout';
      const dansVue = cherchees.filter((e) => dansLaVue(e, laVue, jour));
      const comptes = Object.fromEntries(CATEGORIES.map((c) => [c, dansVue.filter((e) => categorie(e) === c).length]));
      const etat = CATEGORIES.includes(query.etat as never) ? query.etat : null;
      const tri: TriClients = TRIS_CLIENTS.includes(query.tri as never) ? query.tri as TriClients : 'urgence';
      const gardees = trier(etat ? dansVue.filter((e) => categorie(e) === etat) : dansVue, tri, prix);
      const debut = Math.max(Number(query.debut ?? 0) || 0, 0);
      const n = limite(query);
      const page = gardees.slice(debut, debut + n).map((e) => ligneClient(e, prix));
      return {
        corps: {
          aujourdhui: jour, total: gardees.length, tous: dansVue.length, vue: laVue, tri, vues, comptes, parAn: parAnDeLaSelection(gardees, prix),
          lignes: page, suite: debut + n < gardees.length ? debut + n : null,
        },
      };
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
      // Ce qui attend pour ce client : les lignes d'« À décider » qui le nomment, par la MÊME fonction (C3) — sur la liste
      // telle que l'accueil la lit, jamais une règle écrite une seconde fois pour la fiche.
      const role = roleDe(qui);
      const liste = lireEntreprises(await lireJson(transaction(tx), 'select plateforme.console_entreprises() v'), jour).filter((e) => e.id === id);
      // Ses demandes au support, comptées par la même fonction que l'écran Support ; celles qui attendent depuis 24 h
      // entrent dans « ce qui attend », comme à l'accueil.
      const support = lireSupport(await lireJson(transaction(tx), 'select plateforme.console_support($1, null) v', [id]));
      const attend = aDecider(liste, { etat: 'absente' }, jour, role, support.ouvertes, maintenant());
      const instant = maintenant();
      // Ses factures d'abonnement (docs/abonnement.md B2–B4), et l'entreprise SkanFact où elles naissent.
      const nos = await lireJson<{ editeur: Record<string, unknown> | null }>(transaction(tx), 'select plateforme.console_editeur() v');
      const factures = { lignes: lireFacturesAbonnement(await lireJson(transaction(tx), 'select plateforme.console_factures_abonnement($1) v', [id]), jour), editeur: nos?.editeur ?? null };
      return { corps: { aujourdhui: jour, ...fiche, etat, cabinets, attend, factures, gestes: gestesDisponibles(role, faits, ligne, etat, fiche.prolongeDejaUneFois === true),
        support: { comptes: compter(support.ouvertes, instant), ouvertes: ranger(support.ouvertes, instant), closes: support.closes.map((l) => ({ ...l, etat: etatDe(l, instant) })) } } };
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
    periodicite: z.enum(['annuel', 'mensuel']).optional(), module: z.enum(['paie', 'compta']).optional(),
  });
  const jouer = async (tx: Transaction, id: string, geste: GesteAbonnement, corps: z.infer<typeof corpsGeste>) => {
    if (!uuid.safeParse(id).success) throw new Introuvable();
    const fiche = await lireJson<Record<string, unknown> | null>(tx, 'select plateforme.console_entreprise($1) v', [id]);
    if (!fiche) throw new Introuvable();
    const jour = aujourdhuiATunis();
    const ligne = lireLigne(fiche.ligne);
    if (!memeLigne(ligne, lireLigne(corps.ligne))) throw new Perimee('console.abonnement_change');
    const faits = lireFaits((fiche.faits ?? {}) as Record<string, unknown>);
    const { apres, details } = calculerGeste(ligne, faits, { geste, motif: corps.motif, jours: corps.jours, offre: corps.offre, periodicite: corps.periodicite, module: corps.module }, jour);
    const etatApres = etatAbonnement(faitsApres(faits, apres), jour);
    // Un module ouvert ou retiré ne change pas l'état : l'aperçu dit aussi la liste des modules d'après.
    if (corps.apercu) return { corps: { apercu: true, avant: etatAbonnement(faits, jour), apres: etatApres, details, modules: apres.modules } };
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

  // ── Préparer la facture d'une période (docs/abonnement.md B2) : l'aperçu d'abord (ce que la facture dira), puis le geste.
  // Au nom de la personne, dans le dossier de l'entreprise SkanFact (la base vérifie qu'elle en est propriétaire).
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/factures', geste: 'console.factures.preparer',
    corps: z.object({ offre: z.enum(['essentiel', 'complet']), periodicite: z.enum(['annuel', 'mensuel']), motif: z.string().max(500), apercu: z.boolean().optional() }),
    traiter: async ({ params, corps, qui }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success || !qui) throw new Introuvable();
      const x = transaction(tx);
      const fiche = await lireJson<Record<string, unknown> | null>(x, 'select plateforme.console_entreprise($1) v', [id]);
      if (!fiche) throw new Introuvable();
      const faits = lireFaits((fiche.faits ?? {}) as Record<string, unknown>);
      if (faits.tenuParCabinet) return { statut: 409, corps: { motif: motif('abonnement.facture.tenu_par_cabinet') } };
      if (!corps.apercu && corps.motif.trim().length < 3) return { statut: 400, corps: { motif: motif('console.motif_requis'), champ: 'motif', raison: t('console.motif_requis') } };
      const jour = aujourdhuiATunis(maintenant());
      const prix = lirePrix(await lireJson(x, 'select plateforme.prix_du_jour($1::date) v', [jour])).get(`${corps.offre}/${corps.periodicite}`) ?? null;
      // Ce qui s'ajoute à l'offre (14c) : la base le compte, au jour de la préparation, et le rejouera en notant la facture.
      const enPlus = lireLignesEnPlus(await lireJson(x, 'select plateforme.console_lignes_facture($1, $2, $3, $4::date) v', [id, corps.offre, corps.periodicite, jour]));
      const membres = Array.isArray(fiche.membres) ? fiche.membres as { email?: unknown; roles?: unknown }[] : [];
      const proprio = membres.find((m) => Array.isArray(m.roles) && m.roles.includes('proprietaire'));
      const facture = await preparerFacture(x, qui.utilisateur, {
        id, raisonSociale: String(fiche.raisonSociale ?? ''), matricule: typeof fiche.matricule === 'string' ? fiche.matricule : null,
        email: typeof proprio?.email === 'string' ? proprio.email : null,
      }, faits, { offre: corps.offre, periodicite: corps.periodicite }, prix, jour, { apercu: corps.apercu === true, motif: corps.motif.trim() }, enPlus);
      return { statut: corps.apercu ? 200 : 201, corps: { apercu: corps.apercu === true, facture } };
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
      const lignes = await lireJson<{ curseur: string; id: string; geste: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }[]>(transaction(tx),
        'select plateforme.console_journal($1, $2, $3::timestamptz, $4::uuid, $5) v', [qui, entreprise, m?.[1] ?? null, m?.[2] ?? null, n]);
      const derniere = lignes.at(-1);
      // Le curseur ne sert qu'à la suite : il ne part pas avec chaque ligne. Un geste du service, ou des réglages, dit sur quoi
      // il porte.
      return {
        corps: {
          lignes: lignes.map((l) => ({ ...l, curseur: undefined, service: sujetDuService(l.geste, l.avant, l.apres) ?? undefined,
            reglages: sujetDesReglages(l.geste, l.avant, l.apres) ?? undefined })),
          suite: lignes.length === n && derniere ? `${derniere.curseur}|${derniere.id}` : null,
        },
      };
    },
  });

  // ── L'équipe (10 § 2.10) ─────────────────────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'GET', chemin: '/console/equipe', geste: 'console.equipe.voir',
    // `droits` : ce que chaque rôle ouvre, lu dans la liste des gestes (serveur/console/gestes.ts) — l'écran ne le recopie
    // pas : écrit une seconde fois, il dirait un jour autre chose que ce que le serveur laisse faire.
    traiter: async (_r, tx) => ({ corps: {
      membres: await lireJson(transaction(tx), 'select plateforme.console_equipe($1) v', [maintenant()]),
      droits: LISTE_GESTES_CONSOLE.filter((g) => g.code !== 'console.session').map((g) => ({ code: g.code, roles: g.roles })),
    } }),
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

  // ── Le service (10 § 2.8 ; Console 3, docs/console.md C12) ─────────────────────────────────────────────────────────
  // Ce que la veille dit à l'instant (son fichier), et ce que la base a gardé : les requêtes du serveur sur la période
  // choisie et les dernières 24 heures, les relevés, les alertes et les nuits des trente derniers jours.
  ajouter({
    methode: 'GET', chemin: '/console/service', geste: 'console.service.voir',
    traiter: async ({ query }, tx) => {
      const t = maintenant();
      const jour = aujourdhuiATunis(t);
      const periode: Periode = estPeriode(query.periode) ? query.periode : '24h';
      // Une série, sur tous ses pas, et la même série en un seul chiffre (ses seaux fusionnés).
      const lireSerie = async (p: { duree: number; pas: number; grain: 'minute' | 'heure' }) => {
        const b = bornes(p, t);
        const brut = await lireJson(transaction(tx), 'select plateforme.console_service_serie($1, $2::interval, $3, $4) v',
          [b.depuis.toISOString(), `${b.pas / 1000} seconds`, b.grain, SORTE_DU_GRAPHIQUE]);
        return { depuis: b.depuis.toISOString(), points: serie(brut, p, t), total: ensemble(brut) };
      };
      const grand = await lireSerie(PERIODES[periode]);
      const dernierJour = await lireSerie(TUILES);
      // Le trafic d'en ce moment se lit sur la dernière heure, minute par minute, quelle que soit la période choisie.
      const derniereHeure = periode === '1h' ? grand : await lireSerie(PERIODES['1h']);
      const v = lireVeilleDeLaBase(await lireJson(transaction(tx), 'select plateforme.console_service_veille($1) v', [`${trenteJours(jour)[0]}T00:00:00+01:00`]));
      const veille = await lireLaVeille(fichierVeille, t);
      return {
        corps: {
          maintenant: t.toISOString(), aujourdhui: jour, periode, budget: BUDGET_DU_GRAPHIQUE, seuils: SEUILS_DU_SERVICE, veille,
          depuis: grand.depuis, pas: PERIODES[periode].pas, points: grand.points, resume: resume(grand.points), total: grand.total,
          tuiles: dernierJour.points, total24h: dernierJour.total, trafic: traficRecent(derniereHeure.points, t),
          disponibilite: disponibilite(v), jours: joursDuService(v, jour, t), coupures: v.coupures.slice(0, 10),
          briques: briques(v, jour, t, veille.etat === 'ok'), nuits: v.nuits.slice(0, 14), exercice: v.exercice,
          journal: journal(v), machine: v.machine, dernier: v.dernier, misesEnLigne: misesEnLigne(v), enLigne: enLigne(v), numeros: (await lireEtatDuSuiveur())?.numeros ?? {},
          alertesEnCours: alertesOuvertes(v.alertes),
        },
      };
    },
  });

  // ── Les alertes du service (Console 3c, docs/console.md C13) ─────────────────────────────────────────────────────────
  // Ce qui est en cours et sa chronologie, qui est prévenu, le rythme, les règles de la veille et ce qu'elles voient,
  // l'histoire des trente derniers jours. Le compte de l'onglet est celui des alertes ouvertes, la même règle que la vue
  // d'ensemble (C3).
  const depuisTrenteJours = (jour: string) => `${trenteJours(jour)[0]}T00:00:00+01:00`;
  ajouter({
    methode: 'GET', chemin: '/console/service/alertes', geste: 'console.service.voir',
    traiter: async (_r, tx) => {
      const t = maintenant();
      const jour = aujourdhuiATunis(t);
      const lu = lireAlertes(await lireJson(transaction(tx), 'select plateforme.console_service_alertes($1) v', [depuisTrenteJours(jour)]));
      const v = lireVeilleDeLaBase(await lireJson(transaction(tx), 'select plateforme.console_service_veille($1) v', [depuisTrenteJours(jour)]));
      const veille = await lireLaVeille(fichierVeille, t);
      return {
        corps: {
          maintenant: t.toISOString(), aujourdhui: jour, veille, alertesEnCours: alertesOuvertes(lu.alertes), briques: briques(v, jour, t, veille.etat === 'ok'),
          enCours: enCours(lu, t), prevenus: prevenus(lu), rythme: RYTHME, regles: regles(lu, t), minutesJugees: MINUTES_JUGEES,
          histoire: histoire(lu, t),
          // Ce que chaque règle a vu en dernier (la vue d'ensemble en tire les mêmes faits).
          faits: { dernier: v.dernier, nuit: v.nuits[0] ?? null, exercice: v.exercice, machine: v.machine.at(-1) ?? null, enLigne: enLigne(v), jour: joursDuService(v, jour, t).at(-1) ?? null },
          numeros: (await lireEtatDuSuiveur())?.numeros ?? {},
        },
      };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/alertes/:alerte/prendre', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.alerte).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_prendre_alerte($1, $2, $3)', [params.alerte, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/sourdines', geste: 'console.service.gerer',
    corps: z.object({ regle: z.string().regex(/^[a-z-]{1,40}$/), minutes: z.number().int().min(15).max(1440), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      // La console ne met en sourdine que les règles de la veille qui préviennent (une règle pas branchée ne dit rien).
      if (!REGLES_BRANCHEES.has(corps.regle)) throw new Introuvable();
      const quand = maintenant();
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_sourdine($1, $2, $3, $4) v', [corps.regle, corps.minutes, corps.motif, quand]);
      // Sa fin, comptée sur l'heure du serveur (celle que la base a posée) : l'écran la dit telle quelle.
      return { statut: 201, corps: { id, fin: new Date(quand.getTime() + corps.minutes * 60_000).toISOString() } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/sourdines/:sourdine/lever', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.sourdine).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_lever_sourdine($1, $2, $3)', [params.sourdine, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/essai', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_demander_essai($1, $2) v', [corps.motif, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });

  // ── Les sauvegardes du service (Console 3c, docs/console.md C14) ─────────────────────────────────────────────────────
  // Ce qu'on promet de pouvoir reprendre et ce que la mesure en dit, où sont les copies, nuit par nuit, la copie hors de
  // la machine heure par heure, les exercices, et les remises d'une entreprise (leur détail nomme le client : la direction
  // seule). La console ne touche jamais au serveur : un geste y est une commande composée, à copier.
  const lireLesSauvegardes = async (tx: Transaction, t: Date) => lireSauvegardes(await lireJson(tx, 'select plateforme.console_service_sauvegardes($1) v', [t.toISOString()]));
  ajouter({
    methode: 'GET', chemin: '/console/service/sauvegardes', geste: 'console.service.voir',
    traiter: async ({ qui }, tx) => {
      const t = maintenant();
      const jour = aujourdhuiATunis(t);
      const role = roleDe(qui);
      const l = await lireLesSauvegardes(transaction(tx), t);
      const v = lireVeilleDeLaBase(await lireJson(transaction(tx), 'select plateforme.console_service_veille($1) v', [depuisTrenteJours(jour)]));
      const veille = await lireLaVeille(fichierVeille, t);
      return {
        corps: {
          maintenant: t.toISOString(), aujourdhui: jour, role, veille, alertesEnCours: alertesOuvertes(v.alertes), briques: briques(v, jour, t, veille.etat === 'ok'),
          situation: { sauvegarde: laSauvegarde(l, t), archivage: lArchivage(l), hors: horsDeLaMachine(l), exercice: leDernierExercice(l, t) },
          promesses: promesses(l, t), copies: copies(l, t),
          nuits: nuitsGardees(l, GARDE.nuits), lignes: lignesParNuit(l, GARDE.jours), retards: retardsParHeure(l, t),
          pointLePlusAncien: pointLePlusAncien(l, t), exercices: exercices(l).slice(0, 12),
          remisesFaites: l.remisesFaites, remises: l.remises,
          calendrier: CALENDRIER, garde: GARDE, commandes: COMMANDES,
          seuils: { sauvegardeH: SAUVEGARDE_TROP_VIEILLE_H, horsMachineMin: HORS_MACHINE_EN_RETARD_MIN, horsMachineGraveMin: HORS_MACHINE_GRAVE_MIN, exerciceJ: EXERCICE_TROP_VIEUX_J },
        },
      };
    },
  });
  // Préparer la remise d'UNE entreprise à une minute : la console vérifie ce qu'elle peut (le client, la minute dans ce
  // qu'on peut reprendre, le motif), note le geste au journal, et rend l'essai puis la remise à copier dans la console du
  // serveur. Elle ne les exécute jamais.
  ajouter({
    methode: 'POST', chemin: '/console/service/remise', geste: 'console.service.remise',
    corps: z.object({ entreprise: z.string().max(40), minute: z.string().max(20), motif: z.string().max(400) }),
    traiter: async ({ corps }, tx) => {
      const quand = maintenant();
      const l = await lireLesSauvegardes(transaction(tx), quand);
      const c = commandesRemise(corps, { depuis: pointLePlusAncien(l, quand), maintenant: quand });
      if (!c.ok) {
        const cle = `console.remise.${c.champ}_${c.raison}`;
        return { statut: 400, corps: { motif: motif(cle), champ: c.champ, raison: t(cle) } };
      }
      // La base refuse une entreprise inconnue ou d'exemple, et note le geste (journal de la console et de l'entreprise).
      await transaction(tx).query('select plateforme.console_preparer_remise($1, $2, $3)', [corps.entreprise, corps.minute, corps.motif.trim()]);
      return { statut: 201, corps: { essai: c.essai, remise: c.remise } };
    },
  });

  // ── Les performances du service (Console 3e, docs/console.md C15) ───────────────────────────────────────────────────
  // Les budgets de la vision en face de la mesure, le temps de réponse sorte par sorte, le trafic contre la période
  // d'avant, les routes du serveur sur sept jours, la base et les exemplaires du programme. Rien de neuf n'est relevé.
  const lireUneSerie = async (tx: Transaction, p: { duree: number; pas: number; grain: 'minute' | 'heure' }, quand: Date, sorte: string) => {
    const b = bornes(p, quand);
    const brut = await lireJson(tx, 'select plateforme.console_service_serie($1, $2::interval, $3, $4) v', [b.depuis.toISOString(), `${b.pas / 1000} seconds`, b.grain, sorte]);
    return { depuis: b.depuis.toISOString(), points: serie(brut, p, quand), total: ensemble(brut) };
  };
  ajouter({
    methode: 'GET', chemin: '/console/service/performances', geste: 'console.service.voir',
    traiter: async ({ query }, tx) => {
      const t = maintenant();
      const jour = aujourdhuiATunis(t);
      const periode: Periode = estPeriode(query.periode) ? query.periode : '24h';
      const p = PERIODES[periode];
      const x = transaction(tx);
      const sortes = Object.fromEntries(await Promise.all(SORTES_DESSINEES.map(async (s) => [s, await lireUneSerie(x, p, t, s)] as const)));
      const lecture = sortes.lecture;
      // La période d'avant, sur les mêmes pas : seulement si sa table la garde encore.
      const lue = comparable(p) ? await lireUneSerie(x, p, new Date(t.getTime() - p.duree), 'lecture') : null;
      const avant = lue ? periodeDAvant(lue.points, p.pas) : null;
      const derniereHeure = periode === '1h' ? lecture : await lireUneSerie(x, PERIODES['1h'], t, 'lecture');
      const sept = trenteJours(jour).slice(-7)[0] ?? jour;
      const brut = await lireJson<Record<string, unknown>>(x, 'select plateforme.console_service_performances($1, $2) v', [sept, t.toISOString()]);
      const v = lireVeilleDeLaBase(await lireJson(x, 'select plateforme.console_service_veille($1) v', [depuisTrenteJours(jour)]));
      const veille = await lireLaVeille(fichierVeille, t);
      const lesSortes = Object.fromEntries(SORTES_DESSINEES.map((s) => [s, { points: sortes[s]?.points.map((pt) => ({ debut: pt.debut, p95: pt.p95, p50: pt.p50, lectures: pt.lectures })) ?? [],
        total: { lectures: sortes[s]?.total.lectures ?? 0, p95: sortes[s]?.total.p95 ?? null, p50: sortes[s]?.total.p50 ?? null } }]));
      return {
        corps: {
          maintenant: t.toISOString(), aujourdhui: jour, periode, pas: p.pas, depuis: lecture?.depuis, veille, alertesEnCours: alertesOuvertes(v.alertes),
          briques: briques(v, jour, t, veille.etat === 'ok'), seuils: SEUILS_DU_SERVICE,
          budgets: budgets(Object.fromEntries(SORTES_DESSINEES.map((s) => [s, { lectures: sortes[s]?.total.lectures ?? 0, p95: sortes[s]?.total.p95 ?? null }]))),
          sortes: lesSortes, budgetsDesSortes: Object.fromEntries(SORTES_DESSINEES.map((s) => [s, BUDGETS[s]])),
          trafic: { points: lecture?.points.map((pt) => ({ debut: pt.debut, n: pt.n, pannes: pt.pannes, parMinute: pt.parMinute })) ?? [],
            avant: avant ? avant.points : null,
            total: { n: lecture?.total.n ?? 0, pannes: lecture?.total.pannes ?? 0, partPannes: lecture?.total.partPannes ?? null },
            totalAvant: avant ? avant.total : null,
            recent: traficRecent(derniereHeure?.points ?? [], t) },
          routes: lesRoutes(brut.routes), routesDepuis: sept, exemplaires: exemplaires(brut.exemplaires, t), base: laBase(brut.base),
        },
      };
    },
  });

  // ── Les incidents du service et la page d'état (Console 3d, docs/console.md C24) ─────────────────────────────────────
  // L'incident ouvert et ses points, les suites promises, ce que la page d'état publique dit en ce moment (ce que la veille
  // a écrit à côté d'elle), les maintenances (annoncées, et les mises en ligne vues), les incidents passés sur trente jours
  // et sur l'année avec ce que la veille a mesuré, et quand chaque fiche réflexe a servi.
  const pageEtatDe = async (): Promise<PageEtat | null> => {
    if (!fichierVeille) return null;
    try { return lirePageEtat(JSON.parse(await fs.readFile(path.join(path.dirname(fichierVeille), 'page-etat.json'), 'utf8'))); } catch { return null; }
  };
  ajouter({
    methode: 'GET', chemin: '/console/service/incidents', geste: 'console.service.voir',
    traiter: async (_r, tx) => {
      const t = maintenant();
      const jour = aujourdhuiATunis(t);
      const x = transaction(tx);
      const debut30 = trenteJours(jour)[0] ?? jour;
      const debutAn = `${jour.slice(0, 4)}-01-01`;
      const depuis = debut30 < debutAn ? debut30 : debutAn;
      const v = lireVeilleDeLaBase(await lireJson(x, 'select plateforme.console_service_veille($1) v', [`${depuis}T00:00:00+01:00`]));
      const lu = lireIncidents(await lireJson(x, 'select plateforme.console_service_incidents($1) v', [t.toISOString()]));
      const veille = await lireLaVeille(fichierVeille, t);
      const mesure = (a: string) => v.jours.filter((j) => j.jour >= a).reduce((m, j) => ({ mesurees: m.mesurees + j.mesurees, bas: m.bas + j.bas }), { mesurees: 0, bas: 0 });
      const deVeille30 = { ...v, jours: v.jours.filter((j) => j.jour >= debut30), alertes: v.alertes };
      const s = suites(lu, jour);
      return {
        corps: {
          maintenant: t.toISOString(), aujourdhui: jour, veille, alertesEnCours: alertesOuvertes(deVeille30.alertes), briques: briques(deVeille30, jour, t, veille.etat === 'ok'),
          ouverts: ouverts(lu), suites: s.aTenir, suitesEnRetard: s.enRetard, suitesFaites: s.faites,
          page: await pageEtatDe(), disponibilite30: disponibilite(deVeille30).taux,
          maintenances: maintenances(lu, misesEnLigne(v).filter((m) => m.le >= `${debut30}T00:00:00`), v.coupures, t),
          passes: { trente: passes(lu, `${debut30}T00:00:00+01:00`, mesure(debut30)), annee: passes(lu, `${debutAn}T00:00:00+01:00`, mesure(debutAn)), annee_n: Number(jour.slice(0, 4)) },
          fiches: fichesServies(lu), exercice: v.exercice, equipe: lu.equipe, fichesConnues: FICHES,
        },
      };
    },
  });
  // ── Les travaux et les envois du service (Console 3e, docs/console.md C25) ────────────────────────────────────────────
  // Ce que le serveur fait seul (ses tours) et ce qu'il envoie aux partenaires, quatorze jours chacun, et ce qui reste à
  // regarder. Ni une pièce ni un montant ; le nom de l'entreprise pour la direction seule (la base le tait sinon).
  const texteDuMotif = (m: { cle: string; valeurs: Record<string, unknown> }): string | null => {
    try { return rendre(t(m.cle, m.valeurs as Valeurs), 'fr'); } catch { return null; }
  };
  ajouter({
    methode: 'GET', chemin: '/console/service/travaux', geste: 'console.service.voir',
    traiter: async ({ qui }, tx) => {
      const instant = maintenant();
      const jour = aujourdhuiATunis(instant);
      const x = transaction(tx);
      const v = lireVeilleDeLaBase(await lireJson(x, 'select plateforme.console_service_veille($1) v', [depuisTrenteJours(jour)]));
      const lu = lireTravaux(await lireJson(x, 'select plateforme.console_service_travaux($1) v', [instant.toISOString()]));
      const veille = await lireLaVeille(fichierVeille, instant);
      return {
        corps: {
          maintenant: instant.toISOString(), aujourdhui: jour, role: roleDe(qui), veille, alertesEnCours: alertesOuvertes(v.alertes), briques: briques(v, jour, instant, veille.etat === 'ok'),
          tours: TOURS.map((o) => ({ ...o, ...etatTour(o.nom, lu.tours, instant) })),
          partenaires: PARTENAIRES.map((p) => ({ nom: p, jours: quatorzeJours(lu.partenaires[p], jour) })),
          sansTrace: SANS_TRACE, ttn: lu.ttn,
          // Le motif d'un refus peut citer ce que la TTN a lu (un matricule, un numéro) : en toutes lettres pour la direction,
          // sa nature seule pour la technique. Un motif rangé par une version plus ancienne peut ne plus être au catalogue :
          // il n'a pas de texte, et l'écran dit l'état de l'envoi (jamais une page en panne pour une ligne).
          aRegarder: lu.aRegarder.map(({ motif: m, ...r }) => ({ ...r, attente: attenteDe({ ...r, motif: m }), motifCle: m?.cle ?? null,
            motifTexte: m && roleDe(qui) === 'direction' ? texteDuMotif(m) : null })),
          nuit: v.nuits.at(-1) ?? null, exercice: v.exercice, version: v.dernier?.version ?? null,
          // La TTN est branchée par son adresse (le contexte porte toujours son coffre) ; le relais d'e-mails, par sa présence.
          branches: { ttn: Boolean(ctx.ttn?.adresse), courriel: Boolean(ctx.courriel) },
        },
      };
    },
  });
  // La sécurité (C26) : les connexions de vingt-quatre heures, ce qui demande un regard, l'équipe, les règles qui
  // freinent (tirées du code), et qui peut commander le serveur — le fichier des clés relu à chaque demande, comme le
  // serveur d'accès le relit (une clé retirée dans le dépôt se voit ici à la mise en ligne suivante).
  const fichierCles = path.join(import.meta.dirname, '../../exploitation/acces-cles.json');
  ajouter({
    methode: 'GET', chemin: '/console/service/securite', geste: 'console.service.voir',
    traiter: async ({ qui }, tx) => {
      const instant = maintenant();
      const jour = aujourdhuiATunis(instant);
      const x = transaction(tx);
      const v = lireVeilleDeLaBase(await lireJson(x, 'select plateforme.console_service_veille($1) v', [depuisTrenteJours(jour)]));
      const lu = lireSecurite(await lireJson(x, 'select plateforme.console_service_securite($1) v', [instant.toISOString()]));
      const veille = await lireLaVeille(fichierVeille, instant);
      const cles = await fs.readFile(fichierCles, 'utf8').then((t) => lireClesDeCommande(JSON.parse(t))).catch(() => null);
      return {
        corps: {
          maintenant: instant.toISOString(), aujourdhui: jour, role: roleDe(qui), veille, alertesEnCours: alertesOuvertes(v.alertes), briques: briques(v, jour, instant, veille.etat === 'ok'),
          heures: lu.heures, motsDePasseFaux: lu.motsDePasseFaux, freines: lu.freines, aRegarder: rangerARegarder(lu.aRegarder), equipe: lu.equipe,
          regles: REGLES_DE_CONNEXION.map((r) => ({ ...r, compte: r.nom === 'mot_de_passe' ? lu.freines : null })),
          cles, certificat: v.dernier?.certificat ? { expire: v.dernier.certificat, jours: joursDuCertificat(v.dernier.certificat, jour) } : null,
        },
      };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/securite/attentes/:compte/lever', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!/^[0-9a-f]{32}$/.test(params.compte ?? '')) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_lever_attente($1, $2, $3)', [params.compte, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // Les versions (C27) : l'état que le suiveur écrit à chaque tour (à côté de la page d'état, dans le dossier public :
  // https://…/etat.json), la base (les migrations, les versions vues par la veille, les consignes), les tâches
  // d'entretien du dépôt en service, et la machine (le système, Node, PostgreSQL, les correctifs automatiques).
  const dossierTaches = path.join(import.meta.dirname, '../../exploitation/taches');
  const lireTachesDuDepot = async () => {
    const noms = await fs.readdir(dossierTaches).catch(() => [] as string[]);
    return Promise.all(noms.filter((n) => /^\d{4}-[a-z0-9-]+\.sh$/.test(n)).map(async (nom) =>
      ({ nom, titre: await fs.readFile(path.join(dossierTaches, nom), 'utf8').then(titreDeTache, () => null) })));
  };
  // Une date de fichier, ou null (le fichier n'existe pas ici : une machine de développement, un serveur sans correctifs).
  const dateDe = async (f: string) => fs.stat(f).then((x) => x.mtime.toISOString(), () => null);
  ajouter({
    methode: 'GET', chemin: '/console/service/versions', geste: 'console.service.voir',
    traiter: async ({ qui }, tx) => {
      const instant = maintenant();
      const jour = aujourdhuiATunis(instant);
      const x = transaction(tx);
      const v = lireVeilleDeLaBase(await lireJson(x, 'select plateforme.console_service_veille($1) v', [depuisTrenteJours(jour)]));
      const b = lireVersionsDeLaBase(await lireJson(x, 'select plateforme.console_service_versions($1) v', [instant.toISOString()]));
      const veille = await lireLaVeille(fichierVeille, instant);
      const e = await lireEtatDuSuiveur();
      const h = e ? historique(e, b) : [];
      const redemarrage = await dateDe('/var/run/reboot-required');
      const paquets = redemarrage ? await fs.readFile('/var/run/reboot-required.pkgs', 'utf8').then((t) => new Set(t.split('\n').filter(Boolean)).size, () => null) : null;
      return {
        corps: {
          maintenant: instant.toISOString(), aujourdhui: jour, role: roleDe(qui), veille, alertesEnCours: alertesOuvertes(v.alertes), briques: briques(v, jour, instant, veille.etat === 'ok'),
          suiveur: e ? {
            version: e.version, installeeLe: e.installeeLe, regardeLe: e.regardeLe, derniere: e.derniere, echec: e.echec, verification: e.verification,
            consignesLues: e.consignes?.lues ?? null, plan: e.plan,
          } : null,
          titres: Object.fromEntries((e?.commits ?? []).map((c) => [c.version, c.titre])), numeros: e?.numeros ?? {},
          dansLeDepot: (e?.commits ?? []).map((c) => c.version),
          historique: h, avant: e ? versionDAvant(h, e) : null, prochaine: e ? prochaine(e, b.consignes, instant) : null,
          consignes: b.consignes, migrations: b.migrations.slice(0, 12),
          taches: e ? taches(await lireTachesDuDepot(), e) : [],
          machine: {
            systeme: systemeDe(await fs.readFile('/etc/os-release', 'utf8').catch(() => null)), node: process.version, postgres: b.postgres,
            correctifs: await dateDe('/var/lib/apt/periodic/unattended-upgrades-stamp'), redemarrage: redemarrage ? { depuis: redemarrage, paquets } : null,
          },
        },
      };
    },
  });
  const lireUuidConsigne = (x: string | undefined) => { if (!x || !uuid.safeParse(x).success) throw new Introuvable(); return x; };
  // Les consignes : poser un gel, retenir une version, revenir à une version d'avant, en lever une. Revenir ne vise
  // qu'une version que le suiveur sait installer (parmi les trente dernières du dépôt) ; la version quittée est celle que
  // le suiveur dit en service.
  const sha = z.string().regex(/^[0-9a-f]{40}$/);
  const refusVersion = (cle: string) => ({ statut: 400, corps: { motif: motif(cle), champ: 'version', raison: t(cle) } });
  ajouter({
    methode: 'POST', chemin: '/console/service/versions/geler', geste: 'console.service.gerer',
    corps: z.object({ jusquAu: z.string().datetime({ offset: true }), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      await transaction(tx).query('select plateforme.console_versions_geler($1, $2, $3)', [corps.jusquAu, corps.motif, maintenant()]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/versions/retenir', geste: 'console.service.gerer',
    corps: z.object({ version: sha, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const e = await lireEtatDuSuiveur();
      if (e && corps.version === e.version) return refusVersion('console.versions.retenir_en_service');
      await transaction(tx).query('select plateforme.console_versions_retenir($1, $2, $3)', [corps.version, corps.motif, maintenant()]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/versions/revenir', geste: 'console.service.gerer',
    corps: z.object({ version: sha, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const e = await lireEtatDuSuiveur();
      if (!e?.version) return refusVersion('console.versions.en_service_inconnue');
      if (!e.commits.some((c) => c.version === corps.version)) return refusVersion('console.versions.hors_depot');
      await transaction(tx).query('select plateforme.console_versions_revenir($1, $2, $3, $4)', [corps.version, e.version, corps.motif, maintenant()]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/versions/consignes/:consigne/lever', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_versions_lever($1, $2, $3)', [lireUuidConsigne(params.consigne), corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  const gravite = z.enum(['mineur', 'majeur', 'critique']);
  const sansBalise = (min: number, max: number) => z.string().trim().min(min).max(max).refine((x) => !/[<>]/.test(x), 'console.sans_balise');
  const lireUuid = (x: string | undefined) => { if (!x || !uuid.safeParse(x).success) throw new Introuvable(); return x; };
  ajouter({
    methode: 'POST', chemin: '/console/service/incidents', geste: 'console.service.gerer',
    corps: z.object({ titre: z.string().trim().min(3).max(200), gravite, fiche: z.enum(FICHES).nullable(), public: sansBalise(3, 500).nullable(), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const r = await lireJson<{ id: string; annee: number; numero: number }>(transaction(tx), 'select plateforme.console_ouvrir_incident($1, $2, $3, $4, $5, $6) v',
        [corps.titre, corps.gravite, corps.fiche, corps.public, corps.motif, maintenant()]);
      return { statut: 201, corps: { id: r.id, ref: refIncident(r.annee, r.numero) } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/incidents/:incident/points', geste: 'console.service.gerer',
    corps: z.object({ texte: z.string().trim().min(3).max(1000), public: z.boolean(), gravite: gravite.nullable() }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_point_incident($1, $2, $3, $4, $5)', [lireUuid(params.incident), corps.texte, corps.public, corps.gravite, maintenant()]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/incidents/:incident/retirer', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_retirer_public($1, $2, $3)', [lireUuid(params.incident), corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/incidents/:incident/clore', geste: 'console.service.gerer',
    corps: z.object({
      fin: z.string().datetime({ offset: true }), effet: z.string().trim().min(10).max(2000), cause: z.string().trim().min(10).max(2000),
      change: z.string().trim().min(10).max(2000), motif: motifGeste,
      suites: z.array(z.object({ titre: z.string().trim().min(3).max(200), responsable: uuid, due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(20),
    }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_clore_incident($1, $2, $3, $4, $5, $6::jsonb, $7, $8)',
        [lireUuid(params.incident), corps.fin, corps.effet, corps.cause, corps.change, JSON.stringify(corps.suites), corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/suites/:suite/faite', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_suite_faite($1, $2, $3)', [lireUuid(params.suite), corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/suites/:suite/repousser', geste: 'console.service.gerer',
    corps: z.object({ due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_repousser_suite($1, $2::date, $3, $4)', [lireUuid(params.suite), corps.due, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/maintenances', geste: 'console.service.gerer',
    corps: z.object({ titre: sansBalise(3, 200), texte: sansBalise(3, 500), debut: z.string().datetime({ offset: true }), fin: z.string().datetime({ offset: true }), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_annoncer_maintenance($1, $2, $3, $4, $5, $6) v',
        [corps.titre, corps.texte, corps.debut, corps.fin, corps.motif, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/maintenances/:maintenance/annuler', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_annuler_maintenance($1, $2, $3)', [lireUuid(params.maintenance), corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });

  // ── Les réglages de la plateforme (docs/console.md C28) ─────────────────────────────────────────────────────────────
  // La grille des prix (datée), les abonnés de chaque offre (le même état que la liste des clients), les règles qui font
  // l'échéance (tirées du code : les relances, la grâce, l'essai), le registre des règles communes avec ses relectures,
  // et le message aux clients : celui en cours, puis les passés.
  ajouter({
    methode: 'GET', chemin: '/console/reglages', geste: 'console.reglages.voir',
    traiter: async ({ qui }, tx) => {
      const x = transaction(tx);
      const jour = aujourdhuiATunis(maintenant());
      const r = lireReglages(await lireJson(x, 'select plateforme.console_reglages($1::date) v', [jour]));
      const entreprises = lireEntreprises(await lireJson(x, 'select plateforme.console_entreprises() v'), jour);
      // Les formats officiels : le registre du code, ce que la plateforme en a fait (0094), et si ce serveur a l'adresse
      // de la TTN et de DigiGo (sans elle, les pièces attendent).
      const formats = registreDesFormats(lireFormats(await lireJson(x, 'select plateforme.console_formats() v')), { teif: versionTeif() },
        { ttn: !!ctx.ttn?.adresse, digigo: !!ctx.efacture?.digigo });
      return {
        corps: {
          aujourdhui: jour, role: roleDe(qui),
          grille: grille(r.prix, entreprises, jour), essai: { jours: ESSAI_JOURS, enCours: essaisEnCours(entreprises) },
          // Ce qui s'ajoute à l'offre (14c) : ses prix datés, et les modules achetés seuls par les abonnés d'aujourd'hui.
          ajouts: grilleAjouts(lireAjouts(await lireJson(x, 'select plateforme.console_ajouts($1::date) v', [jour])), entreprises, jour),
          echeance: { relances: RELANCES, grace: GRACE_JOURS },
          registre: registre(r.regles, jour),
          message: r.messages.find((m) => m.enCours) ?? null, passes: r.messages.filter((m) => !m.enCours).slice(0, 30),
          formats,
          // Nos factures (docs/abonnement.md B1) : l'entreprise SkanFact désignée, et celles que je pourrais désigner.
          factures: await lireJson(x, 'select plateforme.console_editeur() v'),
        },
      };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/factures/editeur', geste: 'console.reglages.gerer',
    corps: z.object({ entreprise: z.string().uuid(), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      await transaction(tx).query('select plateforme.console_poser_editeur($1, $2)', [corps.entreprise, corps.motif]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/regles/:regle/relire', geste: 'console.reglages.gerer',
    corps: z.object({ reluePar: z.string().trim().min(3).max(200), avis: z.enum(['juste', 'a_corriger']), dit: z.string().trim().max(1000).nullable(), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_relire_regle($1, $2, $3, $4, $5, $6)',
        [lireUuid(params.regle), corps.reluePar, corps.avis, corps.dit, corps.motif, maintenant()]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  const jourIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  ajouter({
    methode: 'POST', chemin: '/console/reglages/messages', geste: 'console.reglages.gerer',
    corps: z.object({ sorte: z.enum(['nouveaute', 'maintenance']), texte: z.string().trim().min(10).max(240), du: jourIso, au: jourIso, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_ecrire_message($1, $2, $3::date, $4::date, $5, $6, $7::date) v',
        [corps.sorte, corps.texte, corps.du, corps.au, corps.motif, instant, aujourdhuiATunis(instant)]);
      return { statut: 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/messages/:message/retirer', geste: 'console.reglages.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      const instant = maintenant();
      await transaction(tx).query('select plateforme.console_retirer_message($1, $2, $3, $4::date)', [lireUuid(params.message), corps.motif, instant, aujourdhuiATunis(instant)]);
      return { corps: { ok: true } };
    },
  });

  // ── Le support (docs/support.md ; 0095) ─────────────────────────────────────────────────────────────────────────────
  // Les demandes ouvertes, rangées (sans réponse depuis 24 h d'abord), puis les cent dernières closes ; celles d'un seul
  // client si on le nomme (sa fiche). La demande ouverte à l'écran porte ses messages, de quoi joindre la personne, et la
  // carte de son client — lue sur la MÊME liste que les clients (C3). Les réponses types : les articles de l'Aide que le
  // client lit dans son application, jamais un second texte.
  ajouter({
    methode: 'GET', chemin: '/console/support', geste: 'console.support.voir',
    traiter: async ({ query }, tx) => {
      const x = transaction(tx);
      const t = maintenant();
      const jour = aujourdhuiATunis(t);
      const entreprise = uuid.safeParse(query.entreprise).success ? query.entreprise : null;
      const demande = uuid.safeParse(query.demande).success ? query.demande : null;
      const s = lireSupport(await lireJson(x, 'select plateforme.console_support($1, $2) v', [entreprise, demande]));
      const client = s.demande
        ? lireEntreprises(await lireJson(x, 'select plateforme.console_entreprises() v'), jour).find((e) => e.id === s.demande?.ligne.entreprise.id) ?? null
        : null;
      return {
        corps: {
          aujourdhui: jour, maintenant: t.toISOString(), entreprise,
          comptes: compter(s.ouvertes, t),
          ouvertes: ranger(s.ouvertes, t), closes: s.closes.map((l) => ({ ...l, etat: etatDe(l, t) })),
          demande: s.demande ? { ...s.demande, etat: etatDe(s.demande.ligne, t), suggestions: suggererPour(s.demande) } : null,
          client: client ? {
            id: client.id, nom: client.raisonSociale, etat: client.etat, faits: client.faits,
            membres: client.membres, pieces: client.pieces, derniereActivite: client.derniereActivite, tenuePar: client.tenuePar,
          } : null,
          articles: articlesDeLAide(), regles: { sansReponseHeures: SANS_REPONSE_HEURES },
        },
      };
    },
  });
  // Les personnes d'un client à qui une demande reçue ailleurs se rattache (elle la lira dans son application). Le chemin
  // dit « :client » : « :entreprise » est réservé aux gestes d'une entreprise (serveur/app.ts).
  ajouter({
    methode: 'GET', chemin: '/console/support/personnes/:client', geste: 'console.support.voir',
    traiter: async ({ params }, tx) => ({ corps: { personnes: await lireJson(transaction(tx), 'select plateforme.console_support_personnes($1) v', [lireUuid(params.client)]) } }),
  });
  const sujetDemande = z.string().trim().min(3, 'console.support.sujet_court').max(140, 'console.support.sujet_long').refine((v) => !/[<>]/.test(v), 'console.support.sans_balise');
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes', geste: 'console.support.repondre',
    corps: z.object({
      entreprise: uuid, demandeur: uuid, canal: z.enum(CANAUX_NOTES as ['email', 'whatsapp', 'telephone']),
      sujet: sujetDemande, texte: z.string().trim().min(3, 'console.support.texte_court').max(4000),
    }),
    traiter: async ({ corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_noter_demande($1, $2, $3, $4, $5, $6) v',
        [corps.entreprise, corps.demandeur, corps.canal, corps.sujet, corps.texte, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/repondre', geste: 'console.support.repondre',
    corps: z.object({
      texte: z.string().trim().min(3, 'console.support.reponse_courte').max(4000),
      article: z.string().nullable().refine((a) => a === null || articleConnu(a), 'console.support.article_inconnu'),
    }),
    traiter: async ({ params, corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_repondre_demande($1, $2, $3, $4) v',
        [lireUuid(params.demande), corps.texte, corps.article, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/clore', geste: 'console.support.repondre',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_clore_demande($1, $2, $3)', [lireUuid(params.demande), corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/rouvrir', geste: 'console.support.repondre',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_rouvrir_demande($1, $2, $3)', [lireUuid(params.demande), corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });

  // ── L'accès au dossier d'un client (Support S2 ; docs/support.md ; 0096) ─────────────────────────────────────────────
  // La console DEMANDE l'accès, avec son motif ; l'entreprise l'accorde (quelques heures, quarante-huit au plus), le
  // refuse ou le retire, dans son application. Pendant qu'il court, celui qui l'a demandé lit le dossier en LECTURE, ce
  // que lit un membre « Lecture » de l'entreprise, chaque page tracée ; personne chez SkanFact n'écrit dans les données
  // d'un client (03 § 5). La base vérifie l'accès à chaque lecture : ces routes ne font que l'appeler.
  ajouter({
    methode: 'GET', chemin: '/console/support/acces', geste: 'console.support.voir',
    traiter: async ({ query }, tx) => {
      const client = uuid.safeParse(query.client).success ? query.client as string : null;
      if (!client) throw new Introuvable();
      const t = maintenant();
      const acces = lireAcces(await lireJson(transaction(tx), 'select plateforme.console_acces_support($1, $2) v', [client, t]));
      return { corps: { maintenant: t.toISOString(), acces, regles: { heuresMax: HEURES_MAX } } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/acces', geste: 'console.support.acces',
    corps: z.object({
      entreprise: uuid, demande: uuid.nullable().default(null),
      motif: z.string().trim().min(3, 'console.support.acces_motif_court').max(300, 'console.support.acces_motif_long')
        .refine((v) => !/[<>]/.test(v), 'console.support.acces_motif_balise'),
    }).strict(),
    traiter: async ({ corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_demander_acces($1, $2, $3, $4) v',
        [corps.entreprise, corps.demande, corps.motif, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/acces/:acces/clore', geste: 'console.support.acces',
    traiter: async ({ params }, tx) => {
      await transaction(tx).query('select plateforme.console_clore_acces($1, $2)', [lireUuid(params.acces), maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // Lire le dossier pendant l'accès, tel que la page de l'application le lirait (le même découpage en objets), filtré
  // par le rôle « Lecture » ; rien n'y est écrivable. `page` : le nom de la page ouverte, que la base trace.
  ajouter({
    methode: 'GET', chemin: '/console/support/acces/:acces/dossier', geste: 'console.support.acces',
    traiter: async ({ params, query }, tx) => {
      const page = typeof query.page === 'string' && PAGE.test(query.page) ? query.page : 'accueil';
      const lu = await lireJson<{ entreprise: string; fin: string; nom: string; objets: { collection: string; cle: string; rang: number | null; contenu: unknown; revision: number }[] }>(
        transaction(tx), 'select plateforme.support_dossier($1, $2, $3) v', [lireUuid(params.acces), page, maintenant()]);
      const { objets, droits } = filtrer(['lecture'], lu.objets.map((o) => ({ ...o, revision: Number(o.revision) })));
      return {
        corps: {
          entreprise: lu.entreprise, nom: lu.nom, fin: lu.fin, lecture: true, objets, marque: '', profil: '', autrui: {},
          // En lecture : rien ne repart, quoi que le rôle « Lecture » permette un jour d'écrire.
          droits: { ...droits, lectureSeule: [...new Set([...droits.lectureSeule, ...droits.ecrivables])].sort(), ecrivables: [], tout: false, responsable: false, caisse: false },
        },
      };
    },
  });
  // La page ouverte (l'écran le dit à chaque page) : tracée, sauf une page relue dans la minute.
  ajouter({
    methode: 'POST', chemin: '/console/support/acces/:acces/page', geste: 'console.support.acces',
    corps: z.object({ page: z.string().regex(PAGE) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.support_noter_page($1, $2, $3)', [lireUuid(params.acces), corps.page, maintenant()]);
      return { corps: { ok: true } };
    },
  });

  return routes;
}
