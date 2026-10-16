// Les routes de la console (skanfact docs/cadrage/10-console.md ; docs/console.md ; 0083). Chacune déclare un geste de
// la console (serveur/console/gestes.ts) : le serveur ouvre alors la transaction au nom du membre de l'équipe, avec SA
// session de la console posée pour la base (app.session_console), et chaque fonction de la base revérifie le rôle.
// L'entrée (se connecter, le code, le renvoyer) est publique, comme celle de l'application.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { Introuvable, Perimee } from '../erreurs.ts';
import { activerCode, activerSms, changerMotDePasse, envoyerPreuveSms, nouveauxCodesDeSecours, preparerCode, preparerSms, type Refuse } from '../compte.ts';
import { numeroMasque } from '../sms.ts';
import * as invitations from './invitations.ts';
import { enMots, envoyerInvitation, etatVu, lienConsole, noterAEnvoyer, roleDansLaPhrase } from '../invitation-courriel.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { etatAbonnement, lireDelai, lireAVenir, lireFaits, lireModules, lireOffreSuivante, lireRegles, plusJours, regleAu, type Etat, type Faits, type Regles } from '../abonnement/etat.ts';
import { calculerGeste, GESTES_ABONNEMENT, MOYENS_RECUS, type GesteAbonnement, type LigneAbonnement, type PaiementRecu } from '../abonnement/gestes.ts';
import { lireFacturesAbonnement, lireLignesEnPlus, periodeDeLaFacture, preparerFacture } from '../abonnement/factures.ts';
import { lireRemise } from '../abonnement/remise.ts';
import { lireApercuGroupe, lireGroupeDe } from './groupes.ts';
import { motif, rendre, t, type Valeurs } from '../../textes/index.ts';
import { EXERCICE_TROP_VIEUX_J, HORS_MACHINE_EN_RETARD_MIN, HORS_MACHINE_GRAVE_MIN, REGLES, SAUVEGARDE_TROP_VIEILLE_H } from '../../exploitation/veille.ts';
import { connecterConsole, renvoyerCodeConsole, validerCodeConsole } from './connexion.ts';
import { lireDiffusions, portee, PUBLICS } from './diffusion.ts';
import { lireEffets, periodes } from './impact.ts';
import { aDecider, CATEGORIES, inscriteCetteSemaine, lireEntreprises, lireVeille, tableau, type Entreprise, type Veille } from './decider.ts';
import { cabinetsDe, chercherCabinets, ficheCabinet, ligneCabinet, lireCabinets } from './cabinets.ts';
import { renouvellementsDe } from './renouvellements.ts';
import { prevoir } from './previsions.ts';
import { lireDocs, lireNotes, reponsesOffertes, SORTES_DOC } from './docsupport.ts';
import { ETATS_EVOLUTION, lireEvolutionDe, lireEvolutions } from './evolutions.ts';
import { avecEnPlus, avecVenues, lireEnPlus, dansLaVue, ligneClient, ligneExport, TRIS_CLIENTS, VUES_CLIENTS, type VueClients } from './clients.ts';
import { categorieOrg, chercherOrg, lireFiltresOrg, optionsDesFiltresOrg, orgDansLaVue, orgDansLesFiltres, organisations, parAnDeLaLigne, parAnDesLignes, trierOrg,
  usageDeLaLigne, vuDeLaLigne, type TriOrg } from './organisations.ts';
import { lireIdentites, lireNotesAppel } from './identites.ts';
import { annuel, AVENIR_JOURS, cartes, lignesEcheances, lireExtras, lirePrix, lireRemisesEcheances, relancesRecentes, vue, VUES, type Vue } from './echeances.ts';
import {
  alertesOuvertes, BUDGET_DU_GRAPHIQUE, bornes, briques, disponibilite, enLigne, ensemble, estPeriode, journal, joursDuService, lireVeilleDeLaBase,
  misesEnLigne, PERIODES, resume, serie, SEUILS_DU_SERVICE, SORTE_DU_GRAPHIQUE, traficRecent, trenteJours, TUILES, type Periode,
} from './service.ts';
import { enCours, histoire, lireAlertes, MINUTES_JUGEES, prevenus, regles, RYTHME, sujetDuService } from './alertes.ts';
import {
  CALENDRIER, COMMANDES, commandesRemise, copies, exercices, GARDE, horsDeLaMachine, lArchivage, laSauvegarde, leDernierExercice, lignesParNuit,
  lireSauvegardes, nuits as nuitsGardees, pointLePlusAncien, promesses, REMISE_PREUVE_J, retardsParHeure,
} from './sauvegardes.ts';
import { attenteDe, etatTour, lireTravaux, PARTENAIRES, quatorzeJours, SANS_TRACE, TOURS } from './travaux.ts';
import { depuisLa, plageDe, reserveALaDirection, sorteDe } from './journal.ts';
import { CHAINES_PAR_LOT, CHAINES_PAS_MS, etatRelecture, joursDeRelecture, lireChaines } from './chaines.ts';
import { lireMesure, mesurer, periodeMesure } from './mesure.ts';
import { CANAUX_CONTESTATION, ISSUES, lireContestations } from './contestations.ts';
import { lireSecrets, ranger as rangerSecrets, SECRET_BIENTOT_JOURS } from './secrets.ts';
import { aLAccueil, lireUrgences } from './urgence.ts';
import { argentADecider, couts, encaisse, encaisseDuMois, lirePaiements, moisAvantDe, moisDemande, MOYENS, ouvertes } from './paiements.ts';
import { dansLeFiltre, etatTtn, FILTRES, ligne, lireNosFactures, resume as resumeDesFactures, type Filtre } from './nosfactures.ts';
import { joursDuCertificat, lireClesDeCommande, lireSecurite, rangerARegarder, REGLES as REGLES_DE_CONNEXION } from './securite.ts';
import { historique, lireEtatSuiveur, lireVersionsDeLaBase, prochaine, systemeDe, taches, titreDeTache, versionDAvant, type EtatSuiveur } from './versions.ts';
import { fichesServies, FICHES, lireIncidents, lirePageEtat, maintenances, ouverts, passes, refIncident, suites, type PageEtat } from './incidents.ts';
import { budgets, comparable, exemplaires, laBase, periodeDAvant, routes as lesRoutes, SORTES_DESSINEES } from './performances.ts';
import {
  ecartDePrix, essaisEnCours, grille, grilleAjouts, lireAjouts, lirePrixPrepares, lireReglages, lireReglesAbonnement, CODES_REGLE, lireContenuOffres, lireRemises, CODES_REMISE, QUOI_CONTENU, preparesPar, QUOI_PRIX, registre, sujetDesReglages, type QuoiPrix,
} from './reglages.ts';
import { lireFormats, registreDesFormats } from './formats.ts';
import { etatDesNouveautes, listeDesNouveautes, NOUVEAUTES } from '../nouveautes.ts';
import { arrivee, enArrivee } from './arrivee.ts';
import { CAUSES_SORTIE, lireSortie, lireSorties } from './sortie.ts';
import { avecRisque, lireUsages, payant, risqueDe } from './risque.ts';
import {
  articleConnu, articlesDeLAide, CANAUX_NOTES, CLOSES_PAR_PAGE, compter, etatDe, type LigneDemande, lireSupport, PRIORITES, ranger, SANS_REPONSE_HEURES, SANS_REPONSE_HEURES_URGENTE,
  suggererPour, VERSION, versionAtteinte,
} from './support.ts';
import { lireAcces, HEURES_MAX, PAGE } from '../support/acces.ts';
import { filtrer } from '../v10/droits.ts';
import { versionTeif } from '../v10/teif.ts';
import { BUDGETS } from '../service/mesures.ts';
import { LISTE_GESTES_CONSOLE, type RoleConsole } from './gestes.ts';
import './textes.ts';

const uuid = z.string().uuid();
const REGLES_BRANCHEES = new Set(REGLES.filter((r) => r.branchee).map((r) => r.id));
const motifGeste = z.string().trim().min(3, 'console.motif_requis').max(500);
// L'instant d'une version lue (l'audit 1.42.0, A03), tel que la base l'a rendu : on le lui rend tel quel.
const instantLu = z.string().max(40).refine((x) => Number.isFinite(Date.parse(x)));
const LIMITE_MAX = 200;
const limite = (q: Record<string, string>) => Math.min(Math.max(Number(q.limite ?? 50) || 50, 1), LIMITE_MAX);
// Les filtres du journal (0114), lus de l'adresse : qui, une entreprise, la sorte, la période, un mot, les gestes réservés à la
// direction, ce que le système a fait seul.
function filtresDuJournal(q: Record<string, string>, jour: string) {
  const plage = plageDe(q.plage);
  const mot = typeof q.q === 'string' ? q.q.trim().slice(0, 100) : '';
  return {
    qui: uuid.safeParse(q.qui).success ? q.qui as string : null, entreprise: uuid.safeParse(q.entreprise).success ? q.entreprise as string : null,
    sorte: sorteDe(q.sorte), plage, depuis: depuisLa(plage, jour), q: mot || null, reserves: q.reserves === '1', systeme: q.systeme === '1',
  };
}
const EXPORT_JOURNAL_MAX = 5000;
// Les gestes écrits au journal qui sont réservés à la direction (serveur/console/journal.ts).
async function gestesReserves(tx: Transaction): Promise<string[]> {
  return (await lireJson<string[]>(tx, 'select plateforme.console_gestes_ecrits() v')).filter(reserveALaDirection);
}
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
    // 0111 : le délai d'une échéance, l'offre de la prochaine.
    delai_echeance: jour(l.delai_echeance), delai_jusqu_au: jour(l.delai_jusqu_au),
    suivante_offre: l.suivante_offre === 'essentiel' || l.suivante_offre === 'complet' ? l.suivante_offre : null,
    suivante_periodicite: l.suivante_periodicite === 'annuel' || l.suivante_periodicite === 'mensuel' ? l.suivante_periodicite : null,
    suivante_a_partir_du: jour(l.suivante_a_partir_du),
    // 0113 : le mois offert qui attend la prochaine facture, les modules qui partent au renouvellement.
    mois_offerts: l.mois_offerts === 1 ? 1 : 0, modules_a_retirer: lireModules(l.modules_a_retirer),
    // 0121 : ce qu'une période payée d'avance change, qui attend son premier jour.
    a_venir_le: jour(l.a_venir_le), a_venir_offre: l.a_venir_offre === 'essentiel' || l.a_venir_offre === 'complet' ? l.a_venir_offre : null,
    a_venir_periodicite: l.a_venir_periodicite === 'annuel' || l.a_venir_periodicite === 'mensuel' ? l.a_venir_periodicite : null,
    a_venir_retraits: lireModules(l.a_venir_retraits),
  };
}
// Deux lignes pareilles : chaque champ, et les modules achetés (une liste) un par un.
const memeLigne = (a: LigneAbonnement | null, b: LigneAbonnement | null) =>
  (a === null || b === null) ? a === b : (Object.keys(a) as (keyof LigneAbonnement)[]).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// Les faits d'après un geste, pour dire l'état d'après AVANT de le faire.
const faitsApres = (f: Faits, l: LigneAbonnement): Faits => ({ ...lireFaits({
  connu: true, essaiJusquAu: l.essai_jusqu_au, payeJusquAu: l.paye_jusqu_au, offre: l.offre, periodicite: l.periodicite,
  resilieLe: l.resilie_le, suspenduLe: l.suspendu_le, offert: l.offert, bacASable: f.bacASable, tenuParCabinet: f.tenuParCabinet, modules: l.modules,
  delai: l.delai_jusqu_au ? { echeance: l.delai_echeance, jusquAu: l.delai_jusqu_au } : null,
  offreSuivante: l.suivante_offre ? { offre: l.suivante_offre, periodicite: l.suivante_periodicite, aPartirDu: l.suivante_a_partir_du } : null,
  moisOffert: (l.mois_offerts ?? 0) > 0, modulesARetirer: l.modules_a_retirer ?? [],
  aVenir: l.a_venir_le ? { le: l.a_venir_le, offre: l.a_venir_offre, periodicite: l.a_venir_periodicite, retraits: l.a_venir_retraits ?? [] } : null,
}), regles: f.regles });

// Ce que l'écran des échéances dit des règles : les relances d'aujourd'hui, la grâce d'une échéance qui tomberait
// aujourd'hui (aucune règle : « — », jamais un nombre deviné), l'horizon de « à venir ».
const reglesDuJour = (r: Regles, jour: string) =>
  ({ relances: [...(regleAu(r.relances, jour) ?? [])].sort((a, b) => b - a), grace: regleAu(r.grace, plusJours(jour, 1))?.[0] ?? null, avenir: AVENIR_JOURS });

// Les règles de l'abonnement (0104 : la grâce, les relances, datées), lues une fois par requête : la console les ajoute
// aux faits de chaque entreprise, comme la base le fait pour l'application (plateforme.faits_abonnement).
const lireLesRegles = async (x: Transaction): Promise<Regles> => lireRegles(await lireJson(x, 'select plateforme.regles_abonnement_histoire() v'));
// Le délai d'une échéance et l'offre de la prochaine (0111), le mois offert qui attend et les modules qui partent (0113),
// posés sur les faits de chaque entreprise avant que l'état s'en déduise : la porte (plateforme.faits_abonnement) les lit
// de la même façon.
const lesFaitsEnPlus = async (x: Transaction) => {
  const b = await lireJson<Record<string, Record<string, unknown>>>(x, 'select plateforme.console_faits_en_plus() v');
  return new Map(Object.entries(b ?? {}).map(([id, v]) => [id, { delai: lireDelai(v?.delai), offreSuivante: lireOffreSuivante(v?.offreSuivante),
    moisOffert: v?.moisOffert === true, modulesARetirer: lireModules(v?.modulesARetirer), aVenir: lireAVenir(v?.aVenir) }]));
};
const lesEntreprises = async (x: Transaction, jour: string) =>
  lireEntreprises(await lireJson(x, 'select plateforme.console_entreprises() v'), jour, await lireLesRegles(x), await lesFaitsEnPlus(x));
const faitsDeLaFiche = async (x: Transaction, fiche: Record<string, unknown>): Promise<Faits> =>
  ({ ...lireFaits((fiche.faits ?? {}) as Record<string, unknown>), regles: await lireLesRegles(x), ...((await lesFaitsEnPlus(x)).get(String(fiche.id)) ?? {}) });

// Les gestes qu'un rôle peut faire sur cet abonnement, AUJOURD'HUI : l'écran ne propose que ceux-là (la base, elle,
// refuse les autres). Le support prolonge un essai, une fois, et offre un mois, un sur douze mois (0113) ; le reste est
// à la direction.
export function gestesDisponibles(role: RoleConsole, f: Faits, ligne: LigneAbonnement | null, e: Etat, prolongeUneFois: boolean, moisOffertRecent = false): GesteAbonnement[] {
  if (role === 'technique' || f.bacASable || f.tenuParCabinet) return [];
  const essaiOuSuite = !ligne || e.etat === 'essai' || (e.etat === 'en_retard' && e.apresEssai) || (e.etat === 'lecture_seule' && e.raison === 'essai_termine');
  // Un mois offert va sur la prochaine facture (calculerGeste, 'offrir-mois') : à un abonné dont l'offre est choisie, qui
  // se renouvelle, sans un mois qui attend déjà.
  const moisPossible = !!ligne && !f.offert && !!ligne.offre && !!ligne.periodicite && e.etat !== 'hors' && e.etat !== 'essai'
    && !ligne.resilie_le && !ligne.suspendu_le && !(ligne.mois_offerts ?? 0);
  if (role === 'support') {
    return [...(essaiOuSuite && ligne && !prolongeUneFois && !f.offert ? ['prolonger' as const] : []), ...(moisPossible && !moisOffertRecent ? ['offrir-mois' as const] : [])];
  }
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
  // Un module qui part au renouvellement (0113) se rouvre ; un module ne se retire pas deux fois.
  const partent = ligne.modules_a_retirer ?? [];
  if (!f.offert && ligne.offre !== 'complet' && (ligne.modules.length < 2 || partent.length > 0)) g.push('ouvrir-module');
  if (ligne.modules.some((m) => !partent.includes(m))) g.push('fermer-module');
  // 0111 : un délai à qui est en grâce ou en lecture seule après une échéance manquée ; un mois offert à un abonnement
  // payé qui court ; une autre offre à la prochaine échéance d'un abonné.
  if (!f.offert && (e.etat === 'en_retard' || (e.etat === 'lecture_seule' && (e.raison === 'essai_termine' || e.raison === 'non_renouvele')))) g.push('accorder-delai');
  if (moisPossible) g.push('offrir-mois');
  if (!f.offert && ligne.offre && ligne.periodicite && !ligne.resilie_le && (e.etat === 'actif' || e.etat === 'en_retard')) g.push('changer-offre');
  return g;
}

// Les gestes du menu « … » d'une ligne de la liste des clients (la maquette Clients) : ceux que sa fiche proposerait, par
// la MÊME règle (gestesDisponibles), sur la ligne d'abonnement que ses faits décrivent ; seulement ceux qui se font sans
// lire la fiche (payer, offrir, un module : sur la fiche, où se lit ce qu'ils changent).
const GESTES_DE_LA_LISTE: readonly GesteAbonnement[] = ['prolonger', 'accorder-delai', 'reprendre', 'offrir-mois', 'changer-offre', 'annuler-resiliation',
  'suspendre', 'resilier', 'retirer-offert'];
export function gestesDeLaListe(role: RoleConsole, e: Entreprise): GesteAbonnement[] {
  const f = e.faits;
  const ligne: LigneAbonnement | null = f.connu ? { essai_jusqu_au: f.essaiJusquAu ?? '', paye_jusqu_au: f.payeJusquAu, offre: f.offre, periodicite: f.periodicite,
    resilie_le: f.resilieLe, suspendu_le: f.suspenduLe, offert: f.offert, modules: [...(f.modules ?? [])], suivante_offre: f.offreSuivante?.offre ?? null,
    mois_offerts: f.moisOffert ? 1 : 0, modules_a_retirer: [...(f.modulesARetirer ?? [])],
    a_venir_le: f.aVenir?.le ?? null, a_venir_offre: f.aVenir?.offre ?? null, a_venir_periodicite: f.aVenir?.periodicite ?? null,
    a_venir_retraits: [...(f.aVenir?.retraits ?? [])] } : null;
  const permis = gestesDisponibles(role, f, ligne, e.etat, e.enPlus?.prolongeUneFois ?? false, e.enPlus?.moisOffertRecent ?? false);
  return GESTES_DE_LA_LISTE.filter((g) => permis.includes(g));
}

export function routesConsole(ctx: Contexte, options: { veille?: string | null } = {}): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  // Les nouveautés que ce serveur porte (0120, C43) : celles du code, sauf dans un essai qui lui en donne d'autres.
  const nouveautes = listeDesNouveautes(ctx.nouveautes ?? NOUVEAUTES);
  // Au journal, une nouveauté se dit par son nom, tant que la version en service la porte ; après, par son code.
  const avecNomDeNouveaute = <S extends { nouveaute: string | null }>(s: S | null) =>
    (s?.nouveaute ? { ...s, nomNouveaute: nouveautes.find((n) => n.code === s.nouveaute)?.nom ?? null } : s);
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
      const liste = role === 'technique' ? [] : await lesEntreprises(transaction(tx), jour);
      const demandes = role === 'technique' ? [] : lireSupport(await lireJson(transaction(tx), 'select plateforme.console_support(null, null) v')).ouvertes;
      // L'encaissé du mois : la direction seule le lit (les comptes de SkanFact), par la fonction de l'écran Paiements (C3) ;
      // et l'argent qui attend une décision (0113), par ses fonctions aussi.
      const paiements = role === 'direction' ? lirePaiements(await lireJson(transaction(tx), 'select plateforme.console_paiements($1::date) v', [`${jour.slice(0, 7)}-01`])) : null;
      const revenus = paiements ? encaisseDuMois(paiements) : undefined;
      // Les contestations (0129) et les sorties en cours (0131) entrent dans l'argent : la direction seule.
      const argent = paiements ? { ...argentADecider(paiements, liste, jour,
        lireContestations(await lireJson(transaction(tx), 'select plateforme.console_contestations($1) v', [instant]))),
        sorties: lireSorties(await lireJson(transaction(tx), 'select plateforme.console_sorties($1::date) v', [jour])) } : null;
      // La tuile « Inscriptions » compte les lignes de la liste qu'elle ouvre, par la fonction de la liste (C3 ; 0114).
      const inscriptions = role === 'technique' ? 0 : (await selectionClients(transaction(tx), jour, { nouvelles: '1' })).dansVue.length;
      const { revenusDuMois, ...pourLeSupport } = tableau(liste, veille, jour, demandes, instant, revenus, inscriptions);
      const t = role === 'direction' ? { ...pourLeSupport, revenusDuMois } : pourLeSupport;
      // Les relances que le serveur a envoyées tout seul depuis hier (la même table que l'écran Abonnements).
      const relances = role === 'technique' ? []
        : relancesRecentes(liste, lireExtras(await lireJson(transaction(tx), 'select plateforme.console_echeances() v')), instant);
      // Les secrets à renouveler (0130) : qui tient le service (la direction, la technique), jamais le support.
      const secrets = role === 'support' ? [] : rangerSecrets(lireSecrets(await lireJson(transaction(tx), 'select plateforme.console_secrets() v')), jour);
      // Les accès d'urgence de l'équipe (0135) : la direction seule.
      const urgences = role === 'direction' ? aLAccueil(lireUrgences(await lireJson(transaction(tx), 'select plateforme.console_acces_urgence($1) v', [instant])), instant) : [];
      return { corps: { aujourdhui: jour, role, tableau: role === 'technique' ? { service: t.service } : t,
        decider: aDecider(liste, veille, jour, role, demandes, instant, argent, secrets, urgences), relances } };
    },
  });

  // ── Les clients ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // La liste se range par urgence, se filtre par état (avec le compte de chaque état, calculé par la même fonction) et se
  // cherche ; elle se pagine. « nouvelles=1 » : les seules inscrites de la semaine, la liste que la tuile « Inscriptions »
  // compte (les comptes des états portent alors sur elles).
  // La sélection de la liste, telle que l'écran la montre (les inscrites de la semaine, la recherche, les filtres, la vue,
  // la puce d'état, l'ordre) : l'écran et l'export la lisent par CETTE fonction — ce qui s'exporte est ce qui se voit.
  async function selectionClients(t: ReturnType<typeof transaction>, jour: string, query: Record<string, unknown>) {
    // Celles venues par un cabinet (0107), pour la sixième vue ; la remise de la prochaine période de chacune (0106), que
    // « par an » déduit comme les échéances ; et ce que chaque ligne dit en plus (0110 : les pièces émises du mois,
    // l'essai prolongé, la facture qui attend).
    // Et son risque de départ (1.40.0 ; 0132 ; serveur/console/risque.ts) : l'usage sur deux fois trente jours, les
    // contestations encore ouvertes (0129), les demandes ouvertes au support.
    const demandes = new Map<string, number>();
    for (const d of lireSupport(await lireJson(t, 'select plateforme.console_support(null, null) v')).ouvertes) demandes.set(d.entreprise.id, (demandes.get(d.entreprise.id) ?? 0) + 1);
    const contestees = new Set(lireContestations(await lireJson(t, 'select plateforme.console_contestations($1) v', [maintenant()]))
      .filter((c) => c.close === null).map((c) => c.entreprise.id));
    const entreprises = avecRisque(avecEnPlus(avecVenues(await lesEntreprises(t, jour), await lireJson(t, 'select plateforme.console_venues_par_cabinet() v'),
      lireRemisesEcheances(await lireJson(t, 'select plateforme.console_remises_echeances() v'))),
    lireEnPlus(await lireJson(t, 'select plateforme.console_clients_en_plus($1::date) v', [jour]), jour)),
    jour, lireUsages(await lireJson(t, 'select plateforme.console_usage_trente($1::date) v', [jour])), contestees, demandes);
    // Ce que chaque renouvellement coûtera, par la règle de la facture (0113), en un passage.
    const renouvellements = await renouvellementsDe(t, entreprises, jour);
    // Le numéro, la ville, le téléphone de chaque entreprise ; les groupes de la console ce jour-là ; les cabinets (0110).
    const id = lireIdentites(await lireJson(t, 'select plateforme.console_identites($1::date) v', [jour]));
    const connues = new Set(entreprises.map((e) => e.id));
    const cabinets = lireCabinets(await lireJson(t, 'select plateforme.console_cabinets() v')).map((c) => ligneCabinet(c, connues));
    // Une ligne par organisation : un groupe, une entreprise seule, un dossier tenu, un cabinet.
    const toutes = organisations(entreprises, jour, id.entreprises, id.groupes, cabinets, id.cabinets);
    const nouvelles = query.nouvelles === '1' ? toutes.filter((o) => o.societes.some((e) => inscriteCetteSemaine(e, jour))) : toutes;
    const cherchees = chercherOrg(nouvelles, String(query.q ?? ''), id.entreprises);
    // Les filtres de la ligne d'outils (le type, l'offre, le cabinet), chaque option comptée sur ce que filtrent les autres.
    const filtres = lireFiltresOrg(query);
    const options = optionsDesFiltresOrg(cherchees, filtres);
    const filtrees = cherchees.filter((o) => orgDansLesFiltres(o, filtres));
    // Les cartes du métier comptent la recherche et les filtres ; les puces d'état comptent la carte choisie (C3 : chacune
    // par la fonction qui filtre la liste qu'elle ouvre).
    const vues = Object.fromEntries(VUES_CLIENTS.map((v) => [v, filtrees.filter((o) => orgDansLaVue(o, v, jour)).length])) as Record<VueClients, number>;
    const laVue: VueClients = VUES_CLIENTS.includes(query.vue as never) ? query.vue as VueClients : 'tout';
    const dansVue = filtrees.filter((o) => orgDansLaVue(o, laVue, jour));
    const comptes = Object.fromEntries(CATEGORIES.map((c) => [c, dansVue.filter((o) => categorieOrg(o) === c).length]));
    const etat = CATEGORIES.includes(query.etat as never) ? query.etat as string : null;
    const tri: TriOrg = TRIS_CLIENTS.includes(query.tri as never) ? query.tri as TriOrg : 'urgence';
    const gardees = trierOrg(etat ? dansVue.filter((o) => categorieOrg(o) === etat) : dansVue, tri, renouvellements, jour);
    return { renouvellements, filtres, options, vues, laVue, dansVue, comptes, tri, gardees, identites: id.entreprises };
  }
  ajouter({
    methode: 'GET', chemin: '/console/entreprises', geste: 'console.clients.voir',
    traiter: async ({ query, qui }, tx) => {
      const jour = aujourdhuiATunis();
      const role = roleDe(qui);
      const s = await selectionClients(transaction(tx), jour, query);
      const debut = Math.max(Number(query.debut ?? 0) || 0, 0);
      const n = limite(query);
      // Chaque ligne : ce qu'elle est, ce qu'elle rapporte, et chacune de ses sociétés telle que la liste la dit — les
      // vues du métier où elle se range (« n'a encore rien fait », « pas vue depuis dix jours » : la phrase et la carte qui
      // la compte, par la même fonction), les gestes de son menu, son numéro, sa ville.
      const page = s.gardees.slice(debut, debut + n).map((o) => {
        const p = parAnDeLaLigne(o, s.renouvellements);
        return {
          id: o.id, sorte: o.sorte, numero: o.numero, nom: o.nom, ville: o.ville, cabinet: o.cabinet,
          parAnHt: p.actif ? versTexte(p.actif, 3) : null, attenduHt: p.attendu ? versTexte(p.attendu, 3) : null,
          usage: usageDeLaLigne(o), vu: vuDeLaLigne(o),
          societes: o.societes.map((e) => ({ ...ligneClient(e, s.renouvellements), numero: s.identites.get(e.id)?.numero ?? null, ville: s.identites.get(e.id)?.ville ?? null,
            vues: VUES_CLIENTS.filter((v) => v !== 'tout' && dansLaVue(e, v, jour)), gestes: gestesDeLaListe(role, e),
            // Son arrivée (0127), tant qu'elle dure : les marches franchies, la suivante, si elle est bloquée.
            arrivee: enArrivee(e, jour) ? arrivee(e, jour) : null })),
        };
      });
      return {
        corps: {
          aujourdhui: jour, total: s.gardees.length, tous: s.dansVue.length, vue: s.laVue, tri: s.tri, vues: s.vues, comptes: s.comptes,
          filtres: s.filtres, options: s.options, parAn: parAnDesLignes(s.gardees, s.renouvellements),
          lignes: page, suite: debut + n < s.gardees.length ? debut + n : null,
        },
      };
    },
  });
  // Exporter la sélection (la maquette Clients) : la direction seule, avec son motif ; le geste s'écrit au journal (le
  // nombre de lignes et les filtres, jamais les lignes), puis la sélection revient, toutes ses pages, une ligne par
  // entreprise (une ligne de groupe en donne autant que de sociétés ; un cabinet, aucune).
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/export', geste: 'console.clients.exporter',
    corps: z.object({ motif: z.string().max(400), filtres: z.record(z.string(), z.string().max(200)).optional() }),
    traiter: async ({ corps }, tx) => {
      if (corps.motif.trim().length < 3) return refusDuChamp('motif', 'console.motif_requis');
      const jour = aujourdhuiATunis();
      const f = corps.filtres ?? {};
      const s = await selectionClients(transaction(tx), jour, f);
      const lignes = s.gardees.flatMap((o) => o.societes.map((e) => ({ ...ligneExport(e, s.renouvellements), numero: s.identites.get(e.id)?.numero ?? null,
        ville: s.identites.get(e.id)?.ville ?? null, groupe: o.sorte === 'groupe' ? o.nom : null })));
      const gardes = Object.fromEntries(['q', 'nouvelles', 'type', 'offre', 'cabinet', 'vue', 'etat', 'tri'].filter((k) => typeof f[k] === 'string' && f[k] !== '').map((k) => [k, f[k]]));
      await transaction(tx).query('select plateforme.console_noter_export($1, $2, $3, $4)', ['clients', lignes.length, JSON.stringify(gardes), corps.motif.trim()]);
      return { statut: 201, corps: { aujourdhui: jour, lignes } };
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
      const faits = await faitsDeLaFiche(transaction(tx), fiche);
      const etat = etatAbonnement(faits, jour);
      const ligne = lireLigne(fiche.ligne);
      // Les cabinets qui la suivent : la même liste que leur fiche à eux (C3).
      const cabinets = cabinetsDe(id, lireCabinets(await lireJson(transaction(tx), 'select plateforme.console_cabinets() v')));
      // Ce qui attend pour ce client : les lignes d'« À décider » qui le nomment, par la MÊME fonction (C3) — sur la liste
      // telle que l'accueil la lit, jamais une règle écrite une seconde fois pour la fiche.
      const role = roleDe(qui);
      const liste = (await lesEntreprises(transaction(tx), jour)).filter((e) => e.id === id);
      // Ses demandes au support, comptées par la même fonction que l'écran Support ; celles qui attendent depuis 24 h
      // entrent dans « ce qui attend », comme à l'accueil.
      const support = lireSupport(await lireJson(transaction(tx), 'select plateforme.console_support($1, null) v', [id]));
      // Ses contestations (0129), toutes : la ligne de chacune de ses factures dit la sienne.
      const contestations = lireContestations(await lireJson(transaction(tx), 'select plateforme.console_contestations($1, $2) v', [maintenant(), id]));
      // Sa sortie (0131) : en cours, sinon la dernière ; la direction seule. Elle entre dans « ce qui attend » par la même
      // règle que l'accueil.
      const sortie = role === 'direction' ? lireSortie(await lireJson(transaction(tx), 'select plateforme.console_sortie($1, $2::date) v', [id, jour])) : null;
      const argent = role === 'direction'
        ? { ...argentADecider(lirePaiements(await lireJson(transaction(tx), 'select plateforme.console_paiements($1::date) v', [`${jour.slice(0, 7)}-01`])), liste, jour, contestations),
            sorties: sortie && !sortie.close ? [{ ...sortie, entreprise: { id, nom: String(fiche.raisonSociale ?? '') } }] : [] } : null;
      const attend = aDecider(liste, { etat: 'absente' }, jour, role, support.ouvertes, maintenant(), argent);
      const instant = maintenant();
      // Ses factures d'abonnement (docs/abonnement.md B2–B4), et l'entreprise SkanFact où elles naissent.
      const nos = await lireJson<{ editeur: Record<string, unknown> | null }>(transaction(tx), 'select plateforme.console_editeur() v');
      const factures = { lignes: lireFacturesAbonnement(await lireJson(transaction(tx), 'select plateforme.console_factures_abonnement($1) v', [id]), jour), editeur: nos?.editeur ?? null };
      // Son groupe, les sociétés de la même propriétaire, et la remise de sa prochaine période (0106) : la période que la
      // prochaine facture paierait, par la même règle que la facture.
      const prochaine = periodeDeLaFacture(faits, faits.periodicite ?? 'annuel', jour).debut;
      const groupe = lireGroupeDe(await lireJson(transaction(tx), 'select plateforme.console_groupe_de($1, $2::date, $3::date) v', [id, jour, prochaine]));
      // Son numéro, sa ville, le téléphone vérifié de sa propriétaire, son dernier appel (0110) ; ses notes d'appel ; ce
      // que la liste dit en plus d'elle (les pièces émises du mois, l'essai, la facture qui attend), par les mêmes lectures.
      const identite = lireIdentites(await lireJson(transaction(tx), 'select plateforme.console_identites($1::date) v', [jour])).entreprises.get(id) ?? null;
      const notes = lireNotesAppel(await lireJson(transaction(tx), 'select plateforme.console_notes_appel($1) v', [id]));
      const enPlus = lireEnPlus(await lireJson(transaction(tx), 'select plateforme.console_clients_en_plus($1::date) v', [jour]), jour).get(id) ?? null;
      // Ce que sa prochaine facture coûtera (0113), par la règle de la facture : le chiffre de la liste et des échéances.
      const r = (await renouvellementsDe(transaction(tx), liste, jour)).get(id) ?? null;
      // Son risque de départ (1.40.0 ; 0132), par la fonction de la liste : ses signes, son usage sur deux fois trente
      // jours, et s'il paie (un essai ne « part » pas : il est à appeler).
      const usage = lireUsages(await lireJson(transaction(tx), 'select plateforme.console_usage_trente($1::date) v', [jour])).get(id) ?? null;
      const risque = liste[0] ? { ...risqueDe(liste[0], jour, usage, new Set(contestations.filter((c) => c.close === null).map((c) => c.entreprise.id)),
        new Map([[id, support.ouvertes.length]])), payant: payant(liste[0]) } : null;
      return { corps: { aujourdhui: jour, ...fiche, etat, cabinets, attend, factures, contestations, groupe: { ...groupe, prochaine }, gestes: gestesDisponibles(role, faits, ligne, etat, fiche.prolongeDejaUneFois === true, enPlus?.moisOffertRecent ?? false),
        identite, notes, enPlus, offreSuivante: faits.offreSuivante ?? null, delai: faits.delai ?? null,
        // Son arrivée (0127) : de l'inscription à la première facture émise, par la même fonction que la liste.
        // Close (0137), elle ne s'affiche plus : la fiche dit qu'elle l'est (enPlus.arriveeClose) et la rouvre.
        arrivee: liste[0] && enArrivee({ ...liste[0], enPlus: enPlus ?? {} }, jour) ? arrivee({ ...liste[0], enPlus: enPlus ?? {} }, jour) : null,
        // La procédure de reprise en cours, ou la dernière (0112) : la direction seule la voit.
        reprise: role === 'direction' ? await lireJson(transaction(tx), 'select plateforme.console_reprise($1, $2::date) v', [id, jour]) : null,
        sortie, risque,
        prochaineFacture: r ? { debut: r.debut, montantHt: versTexte(r.periodeHt, 3) } : null,
        support: { comptes: compter(support.ouvertes, instant), ouvertes: ranger(support.ouvertes, instant), closes: support.closes.map((l) => ({ ...l, etat: etatDe(l, instant) })) } } };
    },
  });

  // ── Nos échanges avec un client (0110 ; la maquette Fiche) ─────────────────────────────────────────────────────────
  // Noter un appel : comment il s'est passé, ce qui s'est dit ; rangé sur sa fiche, il ne part jamais chez le client.
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/appels', geste: 'console.clients.appeler',
    corps: z.object({ resultat: z.enum(['parle', 'sans_reponse', 'message_laisse']), resume: z.string().max(1000).optional() }),
    traiter: async ({ params, corps }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      const r = await transaction(tx).query('select plateforme.console_noter_appel($1, $2, $3, $4) id', [id, corps.resultat, corps.resume ?? null, maintenant()]);
      return { statut: 201, corps: { id: String(r.rows[0]?.id) } };
    },
  });
  // L'issue de son arrivée (1.45.0 ; l'audit 1.42.0 A06 ; 0137) : la clore (il ne s'abonnera pas, il est suivi ailleurs)
  // ou la rouvrir, avec le motif ; la direction et le support.
  for (const sens of ['clore', 'rouvrir'] as const) {
    ajouter({
      methode: 'POST', chemin: `/console/entreprises/:id/arrivee/${sens}`, geste: 'console.clients.arrivee',
      corps: z.object({ motif: z.string().max(500) }),
      traiter: async ({ params, corps }, tx) => {
        const id = params.id ?? '';
        if (!uuid.safeParse(id).success) throw new Introuvable();
        await transaction(tx).query(`select plateforme.console_${sens === 'clore' ? 'clore' : 'rouvrir'}_arrivee($1, $2, $3)`, [id, corps.motif, maintenant()]);
        return { corps: { ok: true } };
      },
    });
  }
  // Écrire au contact : un message que la personne lit dans son application (une demande au support que SkanFact
  // commence) ; l'alerte des réponses du support la prévient par e-mail, sans le texte.
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/ecrire', geste: 'console.clients.ecrire',
    corps: z.object({ destinataire: uuid, sujet: z.string().max(140), texte: z.string().max(4000) }),
    traiter: async ({ params, corps }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      const r = await transaction(tx).query('select plateforme.console_ecrire_au_contact($1, $2, $3, $4, $5) id', [id, corps.destinataire, corps.sujet, corps.texte, maintenant()]);
      return { statut: 201, corps: { demande: String(r.rows[0]?.id) } };
    },
  });
  // ── La procédure de reprise d'une entreprise (docs/console.md C34 ; 0112 ; la maquette Fiche) ──────────────────────
  // Changer de propriétaire sur pièces, jamais sur un appel : la direction l'ouvre (la propriétaire est prévenue dans son
  // application et a quinze jours pour s'y opposer), note les pièces vues, et l'AUTRE membre de la direction confirme.
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/reprises', geste: 'console.clients.reprise',
    corps: z.object({ cause: z.enum(['deces', 'cession', 'depart', 'conflit']), nom: z.string().max(120), email: z.string().max(254), motif: z.string().max(500) }),
    traiter: async ({ params, corps }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      const fiche = await lireJson<{ raisonSociale?: unknown } | null>(transaction(tx), 'select plateforme.console_entreprise($1) v', [id]);
      if (!fiche) throw new Introuvable();
      // Le message part sous le nom de l'entreprise et du repreneur ; la date limite, c'est la base qui la pose.
      const valeurs = { entreprise: String(fiche.raisonSociale ?? ''), repreneur: corps.nom.trim(), jusquAu: '%JUSQU_AU%' };
      const sujet = rendre(t('console.reprise.sujet', valeurs), 'fr').replace(/[<>]/g, '').slice(0, 140);
      const r = await transaction(tx).query('select plateforme.console_ouvrir_reprise($1, $2, $3, $4, $5, $6, $7, $8) id',
        [id, corps.cause, corps.nom, corps.email, corps.motif, sujet, rendre(t('console.reprise.texte', valeurs), 'fr'), maintenant()]);
      return { statut: 201, corps: { id: String(r.rows[0]?.id) } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reprises/:id/pieces', geste: 'console.clients.reprise',
    corps: z.object({ piece: z.enum(['acte', 'registre', 'identite']) }),
    traiter: async ({ params, corps }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_piece_reprise($1, $2, $3)', [id, corps.piece, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reprises/:id/clore', geste: 'console.clients.reprise',
    corps: z.object({ opposition: z.boolean(), motif: z.string().max(500) }),
    traiter: async ({ params, corps }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_clore_reprise($1, $2, $3, $4)', [id, corps.opposition, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reprises/:id/confirmer', geste: 'console.clients.reprise',
    traiter: async ({ params }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_appliquer_reprise($1, $2)', [id, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // ── La sortie d'un client (docs/console.md C54 ; 0131) ─────────────────────────────────────────────────────────────
  // L'ouvrir (pourquoi il s'en va), régler le remboursement, la clore (il est parti, ou il reste) ; la direction seule.
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/sorties', geste: 'console.clients.sortie',
    corps: z.object({ cause: z.enum(CAUSES_SORTIE), dit: z.string().max(1000) }),
    traiter: async ({ params, corps }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      const r = await transaction(tx).query('select plateforme.console_ouvrir_sortie($1, $2, $3, $4) id', [id, corps.cause, corps.dit, maintenant()]);
      return { statut: 201, corps: { id: String(r.rows[0]?.id) } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/sorties/:id/remboursement', geste: 'console.clients.sortie',
    // 0138 (l'audit 1.42.0 A04) : rendu, avec son montant (« 120,500 », en dinars) et son jour.
    corps: z.object({ remboursement: z.enum(['aucun', 'fait']), reference: z.string().max(60).nullable().optional(), montant: z.string().max(40).nullable().optional(),
      le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), motif: z.string().max(500) }),
    traiter: async ({ params, corps }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      // Le montant tapé (« 47,410 »), en millimes ; illisible, la case le dit (la base revérifie ce qu'il vaut).
      const montant = corps.montant?.trim() ? prixTape(corps.montant) : null;
      if (corps.montant?.trim() && (montant === null || montant <= 0n)) return refusDuChamp('montant', 'console.paiements.montant_illisible');
      await transaction(tx).query('select plateforme.console_sortie_remboursement($1, $2, $3, $4::bigint, $5::date, $6, $7)',
        [id, corps.remboursement, corps.reference ?? null, montant === null ? null : montant.toString(), corps.le ?? null, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/sorties/:id/clore', geste: 'console.clients.sortie',
    corps: z.object({ issue: z.enum(['partie', 'reste']), motif: z.string().max(500) }),
    traiter: async ({ params, corps }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_clore_sortie($1, $2, $3, $4)', [id, corps.issue, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // La fiche d'un groupe (la maquette Fiche, « Groupe Gharbi ») : ses sociétés comme la liste les dit, chacune avec son
  // numéro et sa ville, l'état le plus urgent en tête. Chaque société garde sa fiche à elle.
  ajouter({
    methode: 'GET', chemin: '/console/groupes/:id', geste: 'console.clients.voir',
    traiter: async ({ params, qui, query }, tx) => {
      const id = params.id ?? '';
      if (!uuid.safeParse(id).success) throw new Introuvable();
      const jour = aujourdhuiATunis();
      const s = await selectionClients(transaction(tx), jour, { ...query, q: '', vue: '', etat: '', type: '', offre: '', cabinet: '', nouvelles: '' });
      const o = s.gardees.find((x) => x.id === id && x.sorte === 'groupe');
      if (!o) throw new Introuvable();
      const role = roleDe(qui);
      const p = parAnDeLaLigne(o, s.renouvellements);
      return {
        corps: {
          aujourdhui: jour, id: o.id, numero: o.numero, nom: o.nom, ville: o.ville, parAnHt: p.actif ? versTexte(p.actif, 3) : null, attenduHt: p.attendu ? versTexte(p.attendu, 3) : null,
          usage: usageDeLaLigne(o), vu: vuDeLaLigne(o),
          societes: o.societes.map((e) => ({ ...ligneClient(e, s.renouvellements), numero: s.identites.get(e.id)?.numero ?? null, ville: s.identites.get(e.id)?.ville ?? null,
            telephone: s.identites.get(e.id)?.telephone ?? null, dernierAppel: s.identites.get(e.id)?.dernierAppel ?? null,
            vues: VUES_CLIENTS.filter((v) => v !== 'tout' && dansLaVue(e, v, jour)), gestes: gestesDeLaListe(role, e),
            // Son arrivée (0127), tant qu'elle dure : les marches franchies, la suivante, si elle est bloquée.
            arrivee: enArrivee(e, jour) ? arrivee(e, jour) : null })),
        },
      };
    },
  });

  // ── Les échéances des abonnements (10 § 2.4) ───────────────────────────────────────────────────────────────────────
  // Sur la MÊME liste que les clients : chaque carte compte la liste qu'elle ouvre (C3). Ce qui vient dans les trente
  // jours d'abord ; une vue par état sinon. Les montants hors taxes, ceux de la prochaine facture ; la liste se pagine.
  ajouter({
    methode: 'GET', chemin: '/console/abonnements', geste: 'console.clients.voir',
    traiter: async ({ query }, tx) => {
      const t = transaction(tx);
      const jour = aujourdhuiATunis();
      const entreprises = await lesEntreprises(t, jour);
      const extras = lireExtras(await lireJson(t, 'select plateforme.console_echeances() v'));
      // Ce que chaque prochaine facture dira (0113), par la règle de la facture : la liste des clients dit le même chiffre.
      const renouvellements = await renouvellementsDe(t, entreprises, jour);
      const lignes = lignesEcheances(entreprises, extras, renouvellements, jour);
      const v: Vue = VUES.includes(query.vue as Vue) ? query.vue as Vue : 'avenir';
      const gardees = vue(lignes, v, jour);
      const debut = Math.max(Number(query.debut ?? 0) || 0, 0);
      const n = limite(query);
      // Les règles que l'écran dit (les jours des relances, la grâce, l'horizon de « à venir ») viennent d'ici : écrites une
      // seconde fois dans les textes, elles divergeraient au premier réglage.
      return { corps: { aujourdhui: jour, vue: v, cartes: cartes(lignes, jour), annuel: annuel(lignes, renouvellements), total: gardees.length,
        lignes: gardees.slice(debut, debut + n), suite: debut + n < gardees.length ? debut + n : null,
        regles: reglesDuJour(await lireLesRegles(t), jour) } };
    },
  });

  // ── Les cabinets (10 § 2.3) ──────────────────────────────────────────────────────────────────────────────────────────
  // La liste compte ce que chaque fiche montre, par la même règle ; un dossier s'y dit comme dans la liste des clients.
  ajouter({
    methode: 'GET', chemin: '/console/cabinets', geste: 'console.clients.voir',
    traiter: async ({ query }, tx) => {
      const t = transaction(tx);
      const jour = aujourdhuiATunis();
      const connues = new Set((await lesEntreprises(t, jour)).map((e) => e.id));
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
      const entreprises = await lesEntreprises(t, jour);
      return { corps: { aujourdhui: jour, ...ficheCabinet(cabinet, entreprises) } };
    },
  });

  // ── Un geste sur l'abonnement (10 § 2.4) : l'aperçu d'abord (ce que deviendra l'état), puis le geste ──────────────────
  // `ligne` : la ligne d'abonnement que l'écran a lue. Changée depuis, le geste se refuse (01 R15) : on relit d'abord.
  // `paiement` (0113) : un paiement reçu hors de la plateforme dit sa facture faite ailleurs, le montant reçu en dinars,
  // son moyen et son jour ; l'aperçu s'en passe, le geste jamais.
  const corpsGeste = z.object({
    motif: z.string().max(500), ligne: z.unknown(), apercu: z.boolean().optional(),
    jours: z.number().int().min(1).max(365).optional(), offre: z.enum(['essentiel', 'complet']).optional(),
    periodicite: z.enum(['annuel', 'mensuel']).optional(), module: z.enum(['paie', 'compta']).optional(),
    paiement: z.object({ facture: z.string().max(200), montant: z.string().max(40), moyen: z.string().max(20), le: z.string().max(20) }).optional(),
  });
  // La preuve d'un paiement reçu, lue case par case : un refus nomme la sienne.
  const lirePaiementRecu = (p: z.infer<typeof corpsGeste>['paiement'], jour: string): PaiementRecu | ReturnType<typeof refusDuChamp> => {
    const facture = (p?.facture ?? '').trim();
    if (!facture || facture.length > 40) return refusDuChamp('facture', 'console.recu.facture');
    const montant = prixTape(p?.montant ?? '');
    if (montant === null || montant <= 0n || montant > 1_000_000_000_000n) return refusDuChamp('montant', 'console.recu.montant');
    const moyen = MOYENS_RECUS.find((m) => m === p?.moyen);
    if (!moyen) return refusDuChamp('moyen', 'console.recu.moyen');
    const le = p?.le ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(le) || !jourExiste(le) || le > jour) return refusDuChamp('le', 'console.recu.jour');
    return { facture, montant, moyen, le };
  };
  const jouer = async (tx: Transaction, id: string, geste: GesteAbonnement, corps: z.infer<typeof corpsGeste>) => {
    if (!uuid.safeParse(id).success) throw new Introuvable();
    const fiche = await lireJson<Record<string, unknown> | null>(tx, 'select plateforme.console_entreprise($1) v', [id]);
    if (!fiche) throw new Introuvable();
    const jour = aujourdhuiATunis();
    const ligne = lireLigne(fiche.ligne);
    if (!memeLigne(ligne, lireLigne(corps.ligne))) throw new Perimee('console.abonnement_change');
    const faits = await faitsDeLaFiche(tx, fiche);
    let paiement: PaiementRecu | undefined;
    if (geste === 'payer' && !corps.apercu) {
      const p = lirePaiementRecu(corps.paiement, jour);
      if ('statut' in p) return p;
      paiement = p;
    }
    const { apres, details } = calculerGeste(ligne, faits, { geste, motif: corps.motif, jours: corps.jours, offre: corps.offre, periodicite: corps.periodicite,
      module: corps.module, paiement, apercu: corps.apercu === true }, jour);
    const etatApres = etatAbonnement(faitsApres(faits, apres), jour);
    // Un module ouvert ou retiré ne change pas l'état : l'aperçu dit aussi la liste des modules d'après, et ceux qui partent
    // au renouvellement.
    if (corps.apercu) return { corps: { apercu: true, avant: etatAbonnement(faits, jour), apres: etatApres, details, modules: apres.modules, modulesARetirer: apres.modules_a_retirer ?? [] } };
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
  // Offrir un mois (0113) : le support aussi, un par entreprise sur douze mois (la base le revérifie).
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/abonnement/offrir-mois', geste: 'console.abonnement.offrir_mois', corps: corpsGeste,
    traiter: async ({ params, corps }, tx) => jouer(transaction(tx), params.id ?? '', 'offrir-mois', corps),
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
      const faits = await faitsDeLaFiche(x, fiche);
      if (faits.tenuParCabinet) return { statut: 409, corps: { motif: motif('abonnement.facture.tenu_par_cabinet') } };
      if (!corps.apercu && corps.motif.trim().length < 3) return { statut: 400, corps: { motif: motif('console.motif_requis'), champ: 'motif', raison: t('console.motif_requis') } };
      const jour = aujourdhuiATunis(maintenant());
      // Le prix d'une période : celui en vigueur à son premier jour (0103) — un nouveau prix vaut pour les périodes qui
      // commencent à sa date ou après, jamais pour une période commencée. La période : la même règle que la pièce.
      const { debut } = periodeDeLaFacture(faits, corps.periodicite, jour);
      const prix = lirePrix(await lireJson(x, 'select plateforme.prix_du_jour($1::date) v', [debut])).get(`${corps.offre}/${corps.periodicite}`) ?? null;
      // Le prix d'aujourd'hui, quand il n'est pas celui de la période : l'aperçu dit pourquoi le montant change.
      const aujourdhui = debut > jour ? lirePrix(await lireJson(x, 'select plateforme.prix_du_jour($1::date) v', [jour])).get(`${corps.offre}/${corps.periodicite}`) ?? null : prix;
      // Ce qui s'ajoute à l'offre (14c) : la base le compte au jour de la préparation, au prix du premier jour de la
      // période, et le rejouera en notant la facture.
      const enPlus = lireLignesEnPlus(await lireJson(x, 'select plateforme.console_lignes_facture($1, $2, $3, $4::date, $5::date) v',
        [id, corps.offre, corps.periodicite, jour, debut]));
      // La remise de la période (0106) : celle de son premier jour, que la base rejouera en notant la facture.
      const remise = lireRemise(await lireJson(x, 'select plateforme.console_remise($1, $2::date) v', [id, debut]));
      const membres = Array.isArray(fiche.membres) ? fiche.membres as { email?: unknown; roles?: unknown }[] : [];
      const proprio = membres.find((m) => Array.isArray(m.roles) && m.roles.includes('proprietaire'));
      const facture = await preparerFacture(x, qui.utilisateur, {
        id, raisonSociale: String(fiche.raisonSociale ?? ''), matricule: typeof fiche.matricule === 'string' ? fiche.matricule : null,
        email: typeof proprio?.email === 'string' ? proprio.email : null,
      }, faits, { offre: corps.offre, periodicite: corps.periodicite }, prix, jour, { apercu: corps.apercu === true, motif: corps.motif.trim() }, enPlus, remise);
      return { statut: corps.apercu ? 200 : 201, corps: { apercu: corps.apercu === true, facture,
        prixAujourdhuiHt: aujourdhui !== null && prix !== null && aujourdhui !== prix ? versTexte(aujourdhui, 3) : null } };
    },
  });

  // ── Les groupes (0106) : la direction relie des sociétés, avec un motif ; chacune entre et sort à son jour ─────────────
  ajouter({
    methode: 'POST', chemin: '/console/groupes', geste: 'console.abonnement.gerer',
    corps: z.object({ nom: z.string().trim().min(2).max(120), entreprises: z.array(uuid).min(2).max(50), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_creer_groupe($1, $2::uuid[], $3, $4::date) v',
        [corps.nom, corps.entreprises, corps.motif, aujourdhuiATunis(maintenant())]);
      return { statut: 201, corps: { id } };
    },
  });
  // L'aperçu d'un de ces gestes, sans rien écrire : qui sera dans le groupe, la première d'abord (elle paie le prix normal).
  ajouter({
    methode: 'POST', chemin: '/console/groupes/apercu', geste: 'console.abonnement.gerer',
    corps: z.object({ groupe: uuid.nullable(), entrent: z.array(uuid).max(50), sort: uuid.nullable() }),
    traiter: async ({ corps }, tx) => ({
      corps: lireApercuGroupe(await lireJson(transaction(tx), 'select plateforme.console_groupe_apercu($1, $2::uuid[], $3, $4::date) v',
        [corps.groupe, corps.entrent, corps.sort, aujourdhuiATunis(maintenant())])),
    }),
  });
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/groupe', geste: 'console.abonnement.gerer',
    corps: z.object({ groupe: uuid, motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.id).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_entrer_groupe($1, $2, $3, $4::date)', [corps.groupe, params.id, corps.motif, aujourdhuiATunis(maintenant())]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/entreprises/:id/groupe/sortir', geste: 'console.abonnement.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.id).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_sortir_groupe($1, $2, $3::date)', [params.id, corps.motif, aujourdhuiATunis(maintenant())]);
      return { corps: { ok: true } };
    },
  });

  // ── Le journal (C1) ──────────────────────────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'GET', chemin: '/console/journal', geste: 'console.journal.voir',
    traiter: async ({ query, qui }, tx) => {
      const m = CURSEUR.exec(query.avant ?? '');
      const n = limite(query);
      const jour = aujourdhuiATunis();
      const f = filtresDuJournal(query, jour);
      const x = transaction(tx);
      // Les gestes réservés à la direction : ceux du journal dont le geste de la console n'est ouvert qu'à elle (lu dans la
      // liste des gestes ; serveur/console/journal.ts), parmi ceux qui y sont écrits.
      const reserves = await gestesReserves(x);
      const lignes = await lireJson<{ curseur: string; id: string; geste: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }[]>(x,
        'select plateforme.console_journal($1, $2, $3::timestamptz, $4::uuid, $5, $6, $7::timestamptz, $8, $9::text[], $10) v',
        [f.qui, f.entreprise, m?.[1] ?? null, m?.[2] ?? null, n, f.sorte, f.depuis, f.q, f.reserves ? reserves : null, f.systeme]);
      const derniere = lignes.at(-1);
      // Les quatre chiffres de la maquette, sur trente jours, quel que soit le filtre (ils ouvrent chacun leur liste).
      const chiffres = await lireJson(x, 'select plateforme.console_journal_chiffres($1::timestamptz, $2::text[], $3::timestamptz) v',
        [depuisLa('30j', jour), reserves, maintenant()]);
      // Le curseur ne sert qu'à la suite : il ne part pas avec chaque ligne. Un geste du service, ou des réglages, dit sur quoi
      // il porte ; chacun dit s'il est réservé à la direction.
      return {
        corps: {
          aujourdhui: jour, role: roleDe(qui), plage: f.plage, chiffres,
          lignes: lignes.map((l) => ({ ...l, curseur: undefined, reserve: reserveALaDirection(l.geste), service: sujetDuService(l.geste, l.avant, l.apres) ?? undefined,
            reglages: avecNomDeNouveaute(sujetDesReglages(l.geste, l.avant, l.apres)) ?? undefined })),
          suite: lignes.length === n && derniere ? `${derniere.curseur}|${derniere.id}` : null,
        },
      };
    },
  });
  // Les accès aux dossiers (la maquette Journal, second onglet) : tous pour la direction, les siens pour le support ; le
  // plus récent d'abord, par pages de cinquante ; chacun avec ses pages lues.
  ajouter({
    methode: 'GET', chemin: '/console/journal/acces', geste: 'console.journal.voir',
    traiter: async ({ query }, tx) => {
      const debut = Math.max(Math.trunc(Number(query.debut ?? 0)) || 0, 0);
      const lu = await lireJson<{ total: number; lignes: unknown[] }>(transaction(tx), 'select plateforme.console_acces_tous($1, $2) v', [debut, maintenant()]);
      return { corps: { aujourdhui: aujourdhuiATunis(), debut, total: lu.total, lignes: lu.lignes, parPage: 50 } };
    },
  });
  // Exporter la sélection du journal : la direction seule, avec son motif ; le geste s'écrit au journal (le nombre de lignes
  // et les filtres, jamais les lignes), puis la sélection revient, cinq mille lignes au plus.
  ajouter({
    methode: 'POST', chemin: '/console/journal/export', geste: 'console.journal.exporter',
    corps: z.object({ motif: z.string().max(400), filtres: z.record(z.string(), z.string().max(200)).optional() }),
    traiter: async ({ corps }, tx) => {
      if (corps.motif.trim().length < 3) return refusDuChamp('motif', 'console.motif_requis');
      const jour = aujourdhuiATunis();
      const q = corps.filtres ?? {};
      const f = filtresDuJournal(q, jour);
      const x = transaction(tx);
      const reserves = await gestesReserves(x);
      type LigneLue = { le: string; id: string; geste: string; sorte: string; motif: string; role: string | null; qui: { nom: string } | null;
        entreprise: { raisonSociale: string } | null; membre: { nom: string } | null; curseur: string };
      const lignes: LigneLue[] = [];
      let avant: [string, string] | null = null;
      while (lignes.length < EXPORT_JOURNAL_MAX) {
        const page: LigneLue[] = await lireJson<LigneLue[]>(x, 'select plateforme.console_journal($1, $2, $3::timestamptz, $4::uuid, 200, $5, $6::timestamptz, $7, $8::text[], $9) v',
          [f.qui, f.entreprise, avant?.[0] ?? null, avant?.[1] ?? null, f.sorte, f.depuis, f.q, f.reserves ? reserves : null, f.systeme]);
        lignes.push(...page);
        const d: LigneLue | undefined = page.at(-1);
        if (page.length < 200 || !d) break;
        avant = [d.curseur, d.id];
      }
      const gardees = lignes.slice(0, EXPORT_JOURNAL_MAX);
      const gardes = Object.fromEntries(['qui', 'entreprise', 'sorte', 'plage', 'q', 'reserves', 'systeme'].filter((k) => typeof q[k] === 'string' && q[k] !== '').map((k) => [k, q[k]]));
      await x.query('select plateforme.console_noter_export($1, $2, $3, $4)', ['journal', gardees.length, JSON.stringify(gardes), corps.motif.trim()]);
      return { statut: 201, corps: { aujourdhui: jour, coupe: lignes.length > EXPORT_JOURNAL_MAX, lignes: gardees.map((l) => ({
        le: l.le, geste: l.geste, sorte: l.sorte, qui: l.qui?.nom ?? null, role: l.role, entreprise: l.entreprise?.raisonSociale ?? null,
        membre: l.membre?.nom ?? null, motif: l.motif, reserve: reserveALaDirection(l.geste) })) } };
    },
  });

  // ── L'équipe (10 § 2.10) ─────────────────────────────────────────────────────────────────────────────────────────────
  // Les appareils et les sessions d'un membre (0114, l'audit F09) : la direction, pour chacun ; chacun, pour lui-même (la
  // base le revérifie). Fermer une session, oublier un appareil : avec son motif, au journal.
  ajouter({
    methode: 'GET', chemin: '/console/equipe/:membre/appareils', geste: 'console.session',
    traiter: async ({ params }, tx) => {
      if (!uuid.safeParse(params.membre).success) throw new Introuvable();
      const lu = await lireJson<Record<string, unknown> | null>(transaction(tx), 'select plateforme.console_appareils_membre($1, $2) v', [params.membre, maintenant()]);
      if (!lu) throw new Introuvable();
      return { corps: { aujourdhui: aujourdhuiATunis(), ...lu } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/equipe/sessions/:session/fermer', geste: 'console.session',
    corps: z.object({ motif: z.string().max(500) }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.session).success) throw new Introuvable();
      if (corps.motif.trim().length < 3) return refusDuChamp('motif', 'console.motif_requis');
      await transaction(tx).query('select plateforme.console_fermer_session($1, $2, $3)', [params.session, corps.motif.trim(), maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/equipe/appareils/:appareil/oublier', geste: 'console.session',
    corps: z.object({ motif: z.string().max(500) }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.appareil).success) throw new Introuvable();
      if (corps.motif.trim().length < 3) return refusDuChamp('motif', 'console.motif_requis');
      await transaction(tx).query('select plateforme.console_oublier_appareil($1, $2, $3)', [params.appareil, corps.motif.trim(), maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // Ton compte (docs/console.md C40 ; 0117) : chacun, quel que soit son rôle, lit son propre compte, ce que son rôle ouvre
  // (lu dans la liste des gestes, comme l'équipe), change son mot de passe et refait ses codes de secours. Le mot de passe
  // et le code se vérifient comme dans l'application (serveur/compte.ts) ; ses autres sessions se ferment, au journal.
  const refusDuCompte = (r: Refuse) => ({ statut: r.attendre ? 429 : 400, corps: { motif: r.motif, champ: r.champ ?? null } });
  ajouter({
    methode: 'GET', chemin: '/console/moi/compte', geste: 'console.session',
    traiter: async ({ qui }, tx) => {
      const lu = await lireJson<Record<string, unknown>>(transaction(tx), 'select plateforme.console_mon_compte($1) v', [maintenant()]);
      const role = qui?.console?.role ?? 'technique';
      return { corps: {
        aujourdhui: aujourdhuiATunis(), ...lu, telephone: lu.telephone ? numeroMasque(String(lu.telephone)) : null,
        droits: LISTE_GESTES_CONSOLE.filter((g) => g.code !== 'console.session' && g.roles.includes(role)).map((g) => g.code),
      } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/moi/mot-de-passe', geste: 'console.session',
    corps: z.object({ actuel: z.string().max(200), nouveau: z.string().max(200) }),
    traiter: async ({ qui, corps }, tx) => {
      if (!qui) throw new Error('session attendue');
      // Le mot de passe, puis ses autres sessions de la console fermées et le journal de l'équipe : la même transaction
      // (l'audit C03) — une panne n'en laisse aucun à moitié ; un refus n'écrit que l'erreur comptée.
      const r = await changerMotDePasse(ctx, qui, corps.actuel, corps.nouveau, transaction(tx));
      if (!r.ok) return refusDuCompte(r);
      const n = await lireJson<number>(transaction(tx), 'select plateforme.console_mon_compte_change($1, $2) v', ['mot_de_passe', maintenant()]);
      return { corps: { ok: true, sessionsFermees: n } };
    },
  });
  // Changer de code (l'application ou le SMS ; jamais l'e-mail pour l'équipe) : les mêmes étapes que dans l'application
  // (serveur/compte.ts) — le code actuel prouvé, le nouveau préparé (rien ne change), puis activé par son premier code
  // juste ; alors seulement l'ancien s'arrête, et le geste entre au journal.
  const auJournal = (tx: Transaction | null, quoi: 'code') => transaction(tx).query('select plateforme.console_mon_compte_change($1, $2)', [quoi, maintenant()]);
  ajouter({
    methode: 'POST', chemin: '/console/moi/code/preuve-sms', geste: 'console.session',
    traiter: async ({ qui }, tx) => {
      if (!qui) throw new Error('session attendue');
      const r = await envoyerPreuveSms(ctx, qui, transaction(tx));
      return r.ok ? { statut: 202, corps: { telephone: r.telephone } } : refusDuCompte(r);
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/moi/code/preparer', geste: 'console.session',
    corps: z.object({ code: z.string().max(20).optional() }),
    traiter: async ({ qui, corps }, tx) => {
      if (!qui) throw new Error('session attendue');
      const r = await preparerCode(ctx, qui, corps.code, transaction(tx));
      return r.ok ? { corps: { codesDeSecours: r.codesDeSecours, adresseApplication: r.adresseApplication, cle: r.cle } } : refusDuCompte(r);
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/moi/code/activer', geste: 'console.session',
    corps: z.object({ code: z.string().min(1).max(20) }),
    traiter: async ({ qui, corps }, tx) => {
      if (!qui) throw new Error('session attendue');
      const r = await activerCode(ctx, qui, corps.code, transaction(tx));
      if (!r.ok) return refusDuCompte(r);
      await auJournal(tx, 'code');
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/moi/code/sms/preparer', geste: 'console.session',
    corps: z.object({ telephone: z.string().min(1).max(30), code: z.string().max(20).optional() }),
    traiter: async ({ qui, corps }, tx) => {
      if (!qui) throw new Error('session attendue');
      const r = await preparerSms(ctx, qui, corps.telephone, corps.code, transaction(tx));
      return r.ok ? { corps: { telephone: r.telephone } } : refusDuCompte(r);
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/moi/code/sms/activer', geste: 'console.session',
    corps: z.object({ code: z.string().min(1).max(20) }),
    traiter: async ({ qui, corps }, tx) => {
      if (!qui) throw new Error('session attendue');
      const r = await activerSms(ctx, qui, corps.code, transaction(tx));
      if (!r.ok) return refusDuCompte(r);
      await auJournal(tx, 'code');
      return { corps: { codesDeSecours: r.codesDeSecours } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/moi/codes-secours', geste: 'console.session',
    corps: z.object({ code: z.string().min(1).max(20) }),
    // Les nouveaux codes se montrent UNE fois : ils ne sont gardés qu'en empreinte.
    traiter: async ({ qui, corps }, tx) => {
      if (!qui) throw new Error('session attendue');
      const r = await nouveauxCodesDeSecours(ctx, qui, corps.code, transaction(tx));
      if (!r.ok) return refusDuCompte(r);
      await transaction(tx).query('select plateforme.console_mon_compte_change($1, $2)', ['codes_secours', maintenant()]);
      return { corps: { codesDeSecours: r.codes } };
    },
  });
  ajouter({
    methode: 'GET', chemin: '/console/equipe', geste: 'console.equipe.voir',
    // `droits` : ce que chaque rôle ouvre, lu dans la liste des gestes (serveur/console/gestes.ts) — l'écran ne le recopie
    // pas : écrit une seconde fois, il dirait un jour autre chose que ce que le serveur laisse faire.
    traiter: async (_r, tx) => ({ corps: {
      membres: await lireJson(transaction(tx), 'select plateforme.console_equipe($1) v', [maintenant()]),
      // L'e-mail de chaque invitation tel qu'il se lit (0138) : resté sans réponse du relais, il le dit.
      invitations: (await lireJson<Record<string, unknown>[]>(transaction(tx), 'select plateforme.console_invitations($1) v', [maintenant()]) ?? [])
        .map((i) => ({ ...i, courriel: etatVu(i.courriel, i.courrielLe, maintenant()) })),
      // Les accès d'urgence des trente derniers jours, et combien de personnes sont à la direction (0135).
      urgence: lireUrgences(await lireJson(transaction(tx), 'select plateforme.console_acces_urgence($1) v', [maintenant()])),
      droits: LISTE_GESTES_CONSOLE.filter((g) => g.code !== 'console.session').map((g) => ({ code: g.code, roles: g.roles })),
    } }),
  });
  const role = z.enum(['direction', 'support', 'technique']);
  // Inviter quelqu'un (0118, C41) : le lien n'est rendu qu'ici, une fois ; la base n'en garde que l'empreinte. Il part
  // aussi par e-mail quand le serveur a un relais (C42) ; la direction le voit une fois, en secours.
  const nouveauLien = () => {
    const jeton = randomBytes(24).toString('base64url');
    return { jeton, expire: new Date(maintenant().getTime() + invitations.JOURS_INVITATION * 24 * 3600_000) };
  };
  // L'invitation part aussi par e-mail (0119, C42) : à qui, quel rôle, qui invite, relus dans la base (dans la transaction).
  // L'e-mail, lui, part une fois l'invitation écrite (0124, l'audit C07) : la suite de la route, qui dit ce qu'il est devenu.
  const lienEnvoye = async (tx: Transaction | null, id: string, l: { jeton: string; expire: Date }) => {
    const i = (await transaction(tx).query('select * from plateforme.console_invitation_pour_courriel($1)', [id])).rows[0] as { email: string; role: string; invite_par: string } | undefined;
    // « À envoyer », dans la transaction (0138, l'audit 1.42.0 A08) : un arrêt avant l'envoi en laisse la trace.
    await noterAEnvoyer(transaction(tx), invitations.sha256(l.jeton), maintenant());
    return async () => enMots(i ? await envoyerInvitation(ctx, { a: i.email, qui: i.invite_par, ou: null, role: roleDansLaPhrase(i.role), lien: lienConsole(ctx, l.jeton), expire: l.expire },
      invitations.sha256(l.jeton)) : 'sans_relais');
  };
  ajouter({
    methode: 'POST', chemin: '/console/equipe/invitations', geste: 'console.equipe.gerer',
    corps: z.object({ email: z.string().trim().min(3).max(200), role, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const l = nouveauLien();
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_inviter($1, $2, $3, $4, $5, $6) v',
        [corps.email, corps.role, corps.motif, invitations.sha256(l.jeton), maintenant(), l.expire]);
      return { statut: 201, corps: { id, jeton: l.jeton, expire: l.expire.toISOString() }, apres: await lienEnvoye(tx, id, l) };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/equipe/invitations/:invitation/renvoyer', geste: 'console.equipe.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.invitation).success) throw new Introuvable();
      const l = nouveauLien();
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_renvoyer_invitation($1, $2, $3, $4, $5) v',
        [params.invitation, corps.motif, invitations.sha256(l.jeton), maintenant(), l.expire]);
      return { corps: { id, jeton: l.jeton, expire: l.expire.toISOString() }, apres: await lienEnvoye(tx, id, l) };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/equipe/invitations/:invitation/annuler', geste: 'console.equipe.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.invitation).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_annuler_invitation($1, $2, $3)', [params.invitation, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // Le lien, ouvert par l'invité, sans session : ce qu'il dit, puis rejoindre (avec son compte, ou en le créant).
  ajouter({
    methode: 'POST', chemin: '/console/invitation/apercu', geste: 'public',
    corps: z.object({ jeton: z.string().min(10).max(100) }),
    traiter: async ({ corps }) => {
      const a = await invitations.apercuInvitation(ctx, corps.jeton, maintenant());
      if (!a) return { corps: { valable: false } };
      return { corps: { valable: true, email: a.email, role: a.role, invitePar: a.invitePar, expire: a.expire.toISOString(), compte: a.compte } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/invitation/accepter', geste: 'public',
    corps: z.object({ jeton: z.string().min(10).max(100), motDePasse: z.string().max(200), nom: z.string().max(120).optional() }),
    traiter: async ({ corps }) => {
      const r = await invitations.accepterInvitation(ctx, corps, maintenant());
      if (!r.ok) return { statut: r.statut, corps: { motif: r.motif, champ: r.champ ?? null } };
      return { corps: { role: r.role, code: r.code } };
    },
  });
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
  // L'accès d'urgence (0135, C59) : la direction l'ouvre pour un autre membre qui a perdu son code (vingt-quatre heures,
  // une fois : il pose un nouveau code à sa prochaine connexion, après son mot de passe), ou l'annule.
  ajouter({
    methode: 'POST', chemin: '/console/equipe/:membre/urgence', geste: 'console.equipe.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.membre).success) throw new Introuvable();
      const jusqua = await lireJson<string>(transaction(tx), 'select plateforme.console_ouvrir_urgence($1, $2, $3) v', [params.membre, corps.motif, maintenant()]);
      return { corps: { jusqua: new Date(jusqua).toISOString() } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/equipe/:membre/urgence/annuler', geste: 'console.equipe.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!uuid.safeParse(params.membre).success) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_annuler_urgence($1, $2, $3)', [params.membre, corps.motif, maintenant()]);
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
          situation: { sauvegarde: laSauvegarde(l, t), archivage: lArchivage(l, t), hors: horsDeLaMachine(l, t), exercice: leDernierExercice(l, t) },
          promesses: promesses(l, t), copies: copies(l, t),
          nuits: nuitsGardees(l, GARDE.nuits), lignes: lignesParNuit(l, GARDE.jours), retards: retardsParHeure(l, t),
          pointLePlusAncien: pointLePlusAncien(l, t), exercices: exercices(l).slice(0, 12),
          remisesFaites: l.remisesFaites, remises: l.remises,
          calendrier: CALENDRIER, garde: GARDE, commandes: COMMANDES,
          seuils: { sauvegardeH: SAUVEGARDE_TROP_VIEILLE_H, horsMachineMin: HORS_MACHINE_EN_RETARD_MIN, horsMachineGraveMin: HORS_MACHINE_GRAVE_MIN, exerciceJ: EXERCICE_TROP_VIEUX_J, remiseJ: REMISE_PREUVE_J },
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
  // Reprendre un envoi arrêté sur une panne (0115 ; l'audit F18), par sa clé : il repart au prochain tour du facteur, qui
  // redemande d'abord à la TTN si elle a déjà la pièce. La base refuse un envoi fini, retenu par son compte, ou en cours.
  ajouter({
    methode: 'POST', chemin: '/console/service/travaux/envois/:cle/reprendre', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      if (!/^[0-9A-F]{8}$/.test(params.cle ?? '')) throw new Introuvable();
      await transaction(tx).query('select plateforme.console_reessayer_envoi($1, $2, $3)', [params.cle, corps.motif, maintenant()]);
      return { corps: { ok: true } };
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
      const chaines = lireChaines(await lireJson(x, 'select plateforme.console_chaines($1) v', [instant.toISOString()]));
      const veille = await lireLaVeille(fichierVeille, instant);
      const cles = await fs.readFile(fichierCles, 'utf8').then((t) => lireClesDeCommande(JSON.parse(t))).catch(() => null);
      return {
        corps: {
          maintenant: instant.toISOString(), aujourdhui: jour, role: roleDe(qui), veille, alertesEnCours: alertesOuvertes(v.alertes), briques: briques(v, jour, instant, veille.etat === 'ok'),
          heures: lu.heures, motsDePasseFaux: lu.motsDePasseFaux, freines: lu.freines, aRegarder: rangerARegarder(lu.aRegarder), equipe: lu.equipe,
          regles: REGLES_DE_CONNEXION.map((r) => ({ ...r, compte: r.nom === 'mot_de_passe' ? lu.freines : null })),
          cles, certificat: v.dernier?.certificat ? { expire: v.dernier.certificat, jours: joursDuCertificat(v.dernier.certificat, jour) } : null,
          // Les chaînes d'empreintes, relues seules (0115) : la dernière relecture, ce qui n'a jamais été relu, ce qui est cassé.
          chaines: { ...chaines, jours: joursDeRelecture(chaines.jours, jour), etat: etatRelecture(chaines, instant), pasMs: CHAINES_PAS_MS, parLot: CHAINES_PAR_LOT },
          // Les secrets et leur échéance (0130) : jamais leur valeur ; le plus pressé d'abord.
          secrets: rangerSecrets(lireSecrets(await lireJson(x, 'select plateforme.console_secrets() v')), jour), secretBientot: SECRET_BIENTOT_JOURS,
        },
      };
    },
  });
  // ── Les secrets et leur échéance (0130 ; docs/console.md C53) ─────────────────────────────────────────────────────
  // Noter un secret à suivre, son renouvellement, ou qu'on ne le suit plus ; chaque fois avec un motif. Jamais sa valeur :
  // la base refuse une phrase qui ressemble à une clé.
  const jourDuSecret = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'console.secret.jour')
    .refine((j) => { const d = new Date(`${j}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === j; }, 'console.secret.jour');
  ajouter({
    methode: 'POST', chemin: '/console/service/secrets', geste: 'console.service.gerer',
    corps: z.object({ nom: z.string().trim().min(3, 'console.secret.nom').max(80, 'console.secret.nom'), role: z.string().trim().min(3, 'console.secret.role').max(200),
      ou: z.string().trim().min(3, 'console.secret.ou').max(200), renouveleLe: jourDuSecret, expireLe: jourDuSecret.nullable(),
      rotationJours: z.number().int().min(1, 'console.secret.rotation').max(3650, 'console.secret.rotation').nullable(), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_noter_secret($1, $2, $3, $4::date, $5::date, $6, $7, $8) v',
        [corps.nom, corps.role, corps.ou, corps.renouveleLe, corps.expireLe, corps.rotationJours, corps.motif, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/secrets/:secret/renouvele', geste: 'console.service.gerer',
    corps: z.object({ le: jourDuSecret, expireLe: jourDuSecret.nullable(), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_secret_renouvele($1, $2::date, $3::date, $4, $5)', [lireUuid(params.secret), corps.le, corps.expireLe, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/service/secrets/:secret/retirer', geste: 'console.service.gerer',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_retirer_secret($1, $2, $3)', [lireUuid(params.secret), corps.motif, maintenant()]);
      return { corps: { ok: true } };
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
            consignesLues: e.consignes?.lues ?? null, consignesIllisibles: e.consignesIllisibles, plan: e.plan,
          } : null,
          titres: Object.fromEntries((e?.commits ?? []).map((c) => [c.version, c.titre])), numeros: e?.numeros ?? {},
          dansLeDepot: (e?.commits ?? []).map((c) => c.version),
          historique: h, avant: e ? versionDAvant(h, e) : null, prochaine: e ? prochaine(e, b.consignes, instant) : null,
          // L'effet de chaque version (0140, C64) : ce que la base sait déjà de chaque période où elle a tourné — ses requêtes,
          // ses pannes, sa lenteur, ses incidents, et (pour la direction) les demandes au support ; comparé à la version d'avant.
          effets: lireEffets(await lireJson(x, 'select plateforme.console_impact_versions($1::jsonb) v', [JSON.stringify(periodes(h, instant))])),
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
  // l'échéance (les relances, la grâce, l'essai : 0104), le registre des règles communes avec ses relectures,
  // et le message aux clients : celui en cours, puis les passés.
  ajouter({
    methode: 'GET', chemin: '/console/reglages', geste: 'console.reglages.voir',
    traiter: async ({ qui }, tx) => {
      const x = transaction(tx);
      const jour = aujourdhuiATunis(maintenant());
      const r = lireReglages(await lireJson(x, 'select plateforme.console_reglages($1::date) v', [jour]));
      const entreprises = await lesEntreprises(x, jour);
      const diffusions = lireDiffusions(await lireJson(x, 'select plateforme.console_diffusion_messages($1::date) v', [jour]));
      // Les prix préparés dans la console (0103) : le préavis, et qui a préparé chaque prix à venir.
      const prepares = lirePrixPrepares(await lireJson(x, 'select plateforme.console_prix_prepares($1::date) v', [jour]));
      // L'essai, la grâce et les relances (0104) : chacune telle qu'elle vaut aujourd'hui, qui l'a posée et pourquoi.
      const regles = lireReglesAbonnement(await lireJson(x, 'select plateforme.console_regles_abonnement($1::date) v', [jour]));
      // Ce que chaque offre comprend (0105) : le contenu du jour et ce qui est préparé.
      const contenu = lireContenuOffres(await lireJson(x, 'select plateforme.console_contenu_offres($1::date) v', [jour]));
      // Les remises (0106) : celle du groupe et celle du cabinet, ce qui est préparé, et combien de sociétés sont en groupe.
      const remises = lireRemises(await lireJson(x, 'select plateforme.console_remises($1::date) v', [jour]));
      // Les formats officiels : le registre du code, ce que la plateforme en a fait (0094), et si ce serveur a l'adresse
      // de la TTN et de DigiGo (sans elle, les pièces attendent).
      const formats = registreDesFormats(lireFormats(await lireJson(x, 'select plateforme.console_formats() v')), { teif: versionTeif() },
        { ttn: !!ctx.ttn?.adresse, digigo: !!ctx.efacture?.digigo });
      return {
        corps: {
          aujourdhui: jour, role: roleDe(qui),
          grille: preparesPar(grille(r.prix, entreprises, jour), (l) => l.offre, prepares.aVenir),
          essai: { jours: regles.essai?.jours[0] ?? null, enCours: essaisEnCours(entreprises) },
          // Ce qui s'ajoute à l'offre (14c) : ses prix datés, et les modules achetés seuls par les abonnés d'aujourd'hui.
          ajouts: preparesPar(grilleAjouts(lireAjouts(await lireJson(x, 'select plateforme.console_ajouts($1::date) v', [jour])), entreprises, jour, contenu.duJour),
            (l) => l.option, prepares.aVenir),
          preavis: prepares.preavis,
          // Les entreprises en grâce aujourd'hui (le même état que la liste des clients) : une grâce changée ne les touche pas.
          echeance: { relances: [...(regles.relances?.jours ?? [])].sort((a, b) => b - a), grace: regles.grace?.jours[0] ?? null,
            enGrace: entreprises.filter((e) => e.etat.etat === 'en_retard').length },
          regles,
          contenu,
          remises,
          registre: registre(r.regles, jour),
          // Chaque message avec son public et sa diffusion (0139, C63) ; et ce que chaque public atteint aujourd'hui.
          ...(() => {
            const avec = (m: (typeof r.messages)[number]) => {
              const d = diffusions.find((x) => x.id === m.id);
              return { ...m, cible: d?.cible ?? [], vus: d?.vus ?? null, caches: d?.caches ?? null };
            };
            return { message: (() => { const m = r.messages.find((x) => x.enCours); return m ? avec(m) : null; })(),
              passes: r.messages.filter((m) => !m.enCours).slice(0, 30).map(avec) };
          })(),
          portee: portee(entreprises),
          formats,
          // Nos factures (docs/abonnement.md B1) : l'entreprise SkanFact désignée, et celles que je pourrais désigner.
          factures: await lireJson(x, 'select plateforme.console_editeur() v'),
          // Les nouveautés que la version en service porte, et pour qui chacune est allumée (0120, C43).
          nouveautes: etatDesNouveautes(nouveautes, await lireJson(x, 'select plateforme.console_nouveautes() v')),
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
  // Un jour qui existe au calendrier (« 2027-02-30 » n'en est pas un).
  const jourExiste = (j: string) => { const d = new Date(`${j}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === j; };
  // Un prix tapé en dinars (« 420 », « 420,500 », « 1 200 ») en millimes ; illisible : rien.
  const prixTape = (valeur: string): bigint | null => {
    const v = valeur.replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(v)) return null;
    try { return depuisTexte(v, 3); } catch { return null; }
  };
  const refusDuChamp = (champ: string, cle: string) => ({ statut: 400, corps: { motif: motif(cle), champ, raison: t(cle) } });

  // Préparer un prix (docs/abonnement.md C14 ; 0103) : l'aperçu d'abord — le prix d'aujourd'hui, l'écart, le premier jour
  // possible (le préavis), les abonnés qui l'ont aujourd'hui —, puis le geste, que la base revérifie.
  const QUOI = z.enum(QUOI_PRIX as unknown as [QuoiPrix, ...QuoiPrix[]]);
  ajouter({
    methode: 'POST', chemin: '/console/reglages/prix', geste: 'console.reglages.gerer',
    corps: z.object({ quoi: QUOI, periodicite: z.enum(['annuel', 'mensuel']), montant: z.string().max(40), aPartirDu: jourIso, motif: z.string().max(500),
      apercu: z.boolean().optional() }),
    traiter: async ({ corps }, tx) => {
      const x = transaction(tx);
      const instant = maintenant();
      const jour = aujourdhuiATunis(instant);
      const montant = prixTape(corps.montant);
      if (montant === null || montant <= 0n) return refusDuChamp('montant', 'console.reglages.prix_illisible');
      if (!jourExiste(corps.aPartirDu)) return refusDuChamp('aPartirDu', 'console.reglages.jour_illisible');
      if (corps.apercu) {
        const r = lireReglages(await lireJson(x, 'select plateforme.console_reglages($1::date) v', [jour]));
        const entreprises = await lesEntreprises(x, jour);
        const prepares = lirePrixPrepares(await lireJson(x, 'select plateforme.console_prix_prepares($1::date) v', [jour]));
        const offre = corps.quoi === 'essentiel' || corps.quoi === 'complet' ? grille(r.prix, entreprises, jour).find((l) => l.offre === corps.quoi) : null;
        const contenu = offre ? null : lireContenuOffres(await lireJson(x, 'select plateforme.console_contenu_offres($1::date) v', [jour]));
        const ajout = offre ? null : grilleAjouts(lireAjouts(await lireJson(x, 'select plateforme.console_ajouts($1::date) v', [jour])), entreprises, jour, contenu?.duJour ?? null)
          .find((l) => l.option === corps.quoi);
        const ligne = offre ?? ajout;
        const avant = ligne?.[corps.periodicite]?.ht ?? null;
        return {
          corps: {
            apercu: true, avant, apres: versTexte(montant, 3), ecart: ecartDePrix(avant === null ? null : depuisTexte(avant, 3), montant),
            plusTot: prepares.preavis ? plusJours(jour, prepares.preavis.jours) : null,
            // Qui l'a aujourd'hui : les abonnés de l'offre à cette périodicité, ou ceux qui ont acheté le module (le même
            // état que la liste des clients) ; rien pour ce qui se compte (une caisse, un salarié de plus).
            abonnes: offre ? offre.abonnes[corps.periodicite] : ajout?.achetes ?? null,
            dejaAVenir: prepares.aVenir.find((v) => v.quoi === corps.quoi && v.periodicite === corps.periodicite)?.aPartirDu ?? null,
          },
        };
      }
      if (corps.motif.trim().length < 3) return refusDuChamp('motif', 'console.motif_requis');
      await x.query('select plateforme.console_preparer_prix($1, $2, $3::date, $4::bigint, $5, $6, $7::date)',
        [corps.quoi, corps.periodicite, corps.aPartirDu, montant.toString(), corps.motif.trim(), instant, jour]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/prix/retirer', geste: 'console.reglages.gerer',
    corps: z.object({ quoi: QUOI, periodicite: z.enum(['annuel', 'mensuel']), aPartirDu: jourIso, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      await transaction(tx).query('select plateforme.console_retirer_prix($1, $2, $3::date, $4, $5, $6::date)',
        [corps.quoi, corps.periodicite, corps.aPartirDu, corps.motif, instant, aujourdhuiATunis(instant)]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/preavis', geste: 'console.reglages.gerer',
    corps: z.object({ jours: z.number().int().min(0).max(365), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      await transaction(tx).query('select plateforme.console_regler_preavis($1, $2, $3, $4::date)', [corps.jours, corps.motif, instant, aujourdhuiATunis(instant)]);
      return { corps: { ok: true } };
    },
  });
  // Ce qu'une offre comprend (0105) : un changement préparé avec le préavis d'un prix, puis retiré avant sa date si besoin.
  ajouter({
    methode: 'POST', chemin: '/console/reglages/contenu', geste: 'console.reglages.gerer',
    corps: z.object({ offre: z.enum(['essentiel', 'complet']), quoi: z.enum(QUOI_CONTENU), nombre: z.number().int().min(0).max(1000), aPartirDu: jourIso, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      await transaction(tx).query('select plateforme.console_preparer_contenu($1, $2, $3, $4::date, $5, $6, $7::date)',
        [corps.offre, corps.quoi, corps.nombre, corps.aPartirDu, corps.motif, instant, aujourdhuiATunis(instant)]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/contenu/retirer', geste: 'console.reglages.gerer',
    corps: z.object({ offre: z.enum(['essentiel', 'complet']), quoi: z.enum(QUOI_CONTENU), aPartirDu: jourIso, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      await transaction(tx).query('select plateforme.console_retirer_contenu($1, $2, $3::date, $4, $5, $6::date)',
        [corps.offre, corps.quoi, corps.aPartirDu, corps.motif, instant, aujourdhuiATunis(instant)]);
      return { corps: { ok: true } };
    },
  });
  // Une remise (0106) : préparée comme un prix, avec le préavis, puis retirée avant sa date si besoin.
  ajouter({
    methode: 'POST', chemin: '/console/reglages/remise', geste: 'console.reglages.gerer',
    corps: z.object({ code: z.enum(CODES_REMISE), taux: z.number().int().min(0).max(90), mois: z.number().int().min(1).max(60).nullable(), aPartirDu: jourIso, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      await transaction(tx).query('select plateforme.console_preparer_remise($1, $2, $3, $4::date, $5, $6, $7::date)',
        [corps.code, corps.taux, corps.mois, corps.aPartirDu, corps.motif, instant, aujourdhuiATunis(instant)]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/remise/retirer', geste: 'console.reglages.gerer',
    corps: z.object({ code: z.enum(CODES_REMISE), aPartirDu: jourIso, motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      await transaction(tx).query('select plateforme.console_retirer_remise($1, $2::date, $3, $4, $5::date)',
        [corps.code, corps.aPartirDu, corps.motif, instant, aujourdhuiATunis(instant)]);
      return { corps: { ok: true } };
    },
  });
  // L'essai, la grâce ou les relances (0104) : une règle nouvelle, qui vaut dès aujourd'hui. La base vérifie les bornes.
  ajouter({
    methode: 'POST', chemin: '/console/reglages/regle', geste: 'console.reglages.gerer',
    corps: z.object({ code: z.enum(CODES_REGLE), jours: z.array(z.number().int().min(0).max(365)).min(1).max(5), motif: motifGeste }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      await transaction(tx).query('select plateforme.console_regler_abonnement($1, $2::integer[], $3, $4, $5::date)',
        [corps.code, corps.jours, corps.motif, instant, aujourdhuiATunis(instant)]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/messages', geste: 'console.reglages.gerer',
    // 0139 (C63) : son public, l'un de ceux que la console connaît ; absent ou « tous », il vise tout le monde.
    corps: z.object({ sorte: z.enum(['nouveaute', 'maintenance']), texte: z.string().trim().min(10).max(240), du: jourIso, au: jourIso, motif: motifGeste,
      cible: z.enum(['tous', ...PUBLICS]).optional() }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_ecrire_message($1, $2, $3::date, $4::date, $5, $6, $7::date) v',
        [corps.sorte, corps.texte, corps.du, corps.au, corps.motif, instant, aujourdhuiATunis(instant)]);
      // Dans la même transaction : un message ne paraît jamais un instant pour tous avant d'avoir son public.
      if (corps.cible && corps.cible !== 'tous') {
        await transaction(tx).query('select plateforme.console_cibler_message($1, $2::text[], $3, $4::date)', [id, [corps.cible], corps.motif, aujourdhuiATunis(instant)]);
      }
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

  // ── Les nouveautés qu'on allume (docs/console.md C43 ; 0120) ────────────────────────────────────────────────────────
  // Seules les nouveautés que la version en service porte (serveur/nouveautes.ts) se touchent : un code inconnu est refusé
  // ici, avant la base. L'entreprise se désigne par son numéro de client, jamais par son nom.
  const codeNouveaute = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
  const inconnue = (code: string) => !nouveautes.some((n) => n.code === code);
  const refusInconnue = { statut: 404, corps: { motif: motif('console.reglages.nouveaute_inconnue'), raison: t('console.reglages.nouveaute_inconnue') } };
  ajouter({
    methode: 'POST', chemin: '/console/reglages/nouveautes/:code/allumer', geste: 'console.reglages.gerer',
    corps: z.object({ numero: z.string().trim().min(1).max(20), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      const code = codeNouveaute.parse(params.code);
      if (inconnue(code)) return refusInconnue;
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_allumer_nouveaute($1, $2, $3, $4) v', [code, corps.numero, corps.motif, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/reglages/nouveautes/:code/eteindre', geste: 'console.reglages.gerer',
    corps: z.object({ entreprise: z.string().uuid(), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      const code = codeNouveaute.parse(params.code);
      if (inconnue(code)) return refusInconnue;
      await transaction(tx).query('select plateforme.console_eteindre_nouveaute($1, $2, $3, $4)', [code, corps.entreprise, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  for (const geste of ['ouvrir', 'refermer'] as const) {
    ajouter({
      methode: 'POST', chemin: `/console/reglages/nouveautes/:code/${geste}`, geste: 'console.reglages.gerer',
      corps: z.object({ motif: motifGeste }),
      traiter: async ({ params, corps }, tx) => {
        const code = codeNouveaute.parse(params.code);
        if (inconnue(code)) return refusInconnue;
        await transaction(tx).query(`select plateforme.console_${geste}_nouveaute($1, $2, $3)`, [code, corps.motif, maintenant()]);
        return { corps: { ok: true } };
      },
    });
  }

  // ── Les paiements de nos factures, et les coûts du mois (docs/console.md C30 ; 0108) ───────────────────────────────
  // La mesure (docs/console.md C39 ; 0116) : ce que la base sait déjà compter, par offre ; ce qui ne se mesure pas encore,
  // l'écran le dit sans chiffre. `periode` : celle des inscriptions (cette semaine, ce mois-ci, les trente derniers jours).
  ajouter({
    methode: 'GET', chemin: '/console/mesure', geste: 'console.mesure.voir',
    traiter: async ({ query }, tx) => {
      const x = transaction(tx);
      const instant = maintenant();
      const jour = aujourdhuiATunis(instant);
      const lu = lireMesure(await lireJson(x, 'select plateforme.console_mesure($1::date) v', [jour]));
      const liste = await lesEntreprises(x, jour);
      return { corps: { aujourdhui: jour, ...mesurer(liste, lu, jour, periodeMesure(query.periode), instant, (i) => aujourdhuiATunis(new Date(i)).slice(0, 7)) } };
    },
  });
  // Le mois demandé (« 2026-10 ») ; par défaut, celui d'aujourd'hui. L'encaissé par la MÊME fonction que la tuile de
  // l'accueil (C3) ; qui doit et qui a trop payé, avec l'état de chaque abonnement (la même liste que les clients) ; les
  // règlements du mois se paginent. Un règlement se note dans l'application de SkanFact : d'ici, le lien qui l'ouvre.
  ajouter({
    methode: 'GET', chemin: '/console/paiements', geste: 'console.paiements.voir',
    traiter: async ({ query }, tx) => {
      const x = transaction(tx);
      const jour = aujourdhuiATunis();
      const mois = moisDemande(query.mois, jour);
      const p = lirePaiements(await lireJson(x, 'select plateforme.console_paiements($1::date) v', [`${mois}-01`]));
      const e = p.editeur ? encaisse(p.recus, p.editeur, p.horsPlateforme) : null;
      const entreprises = await lesEntreprises(x, jour);
      const { doivent, trop } = ouvertes(p.ouvertes, entreprises, jour);
      // Ce qui doit rentrer (C55) : à partir d'aujourd'hui, quel que soit le mois regardé ; la liste « Qui doit encore » et
      // le prix des prochaines factures, jamais recomptés.
      // Un client dont la sortie est ouverte (0131) ne renouvellera pas : ses renouvellements sont écartés.
      const partants = new Set(lireSorties(await lireJson(x, 'select plateforme.console_sorties($1::date) v', [jour])).flatMap((s) => (s.entreprise ? [s.entreprise.id] : [])));
      const previsions = p.editeur ? prevoir(doivent, await renouvellementsDe(x, entreprises, jour), [...p.ouvertes, ...p.aEmettre], jour, p.editeur.devise, p.editeur.decimales, partants,
        p.aEmettre.map((a) => ({ ...a, montantHt: a.montantHt === null ? null : depuisTexte(a.montantHt, 3) }))) : null;
      const debut = Math.max(Number(query.debut ?? 0) || 0, 0);
      const debutHors = Math.max(Number(query.debutHors ?? 0) || 0, 0);
      const n = limite(query);
      return {
        corps: {
          aujourdhui: jour, mois, courant: mois === jour.slice(0, 7), editeur: p.editeur,
          encaisse: e ? {
            devise: e.devise, total: versTexte(e.total, e.decimales), rembourse: versTexte(e.rembourse, e.decimales), reglements: e.reglements,
            parMoyen: Object.fromEntries(MOYENS.map((m) => [m, versTexte(e.parMoyen[m], e.decimales)])),
            autresDevises: e.autresDevises.map((a) => ({ devise: a.devise, total: versTexte(a.total, a.decimales) })),
          } : null,
          recus: { total: p.recus.length, lignes: p.recus.slice(debut, debut + n).map((r) => ({ ...r, montant: versTexte(r.montant, r.decimales) })),
            suite: debut + n < p.recus.length ? debut + n : null },
          // Ce qui reste, provisoire tant que le mois court ou qu'un coût du mois d'avant manque (0114).
          doivent, trop, previsions, aEmettre: p.aEmettre, couts: couts(p.couts, e, { courant: mois === jour.slice(0, 7),
            moisAvant: lirePaiements(await lireJson(x, 'select plateforme.console_paiements($1::date) v', [`${moisAvantDe(mois)}-01`])).couts }),
          // Reçus hors de la plateforme ce mois (0113), et nos factures payées puis défaites (tout mois confondu).
          horsPlateforme: { total: p.horsPlateforme.length, lignes: p.horsPlateforme.slice(debutHors, debutHors + n).map((h) => ({ ...h, montant: versTexte(h.montant, 3) })),
            suite: debutHors + n < p.horsPlateforme.length ? debutHors + n : null },
          defaites: p.defaites,
          // 0129 : les contestations en cours, et celles régularisées depuis quatre-vingt-dix jours.
          contestations: lireContestations(await lireJson(x, 'select plateforme.console_contestations($1) v', [maintenant()])),
        },
      };
    },
  });
  // ── Les contestations de nos factures (0129 ; docs/console.md C52) ────────────────────────────────────────────────
  // La noter, depuis la ligne de sa facture sur la fiche ; la régulariser, depuis la fiche ou Paiements. La base réserve
  // à la direction l'avoir, le remboursement et la facture maintenue.
  ajouter({
    methode: 'POST', chemin: '/console/factures-abonnement/:facture/contester', geste: 'console.contestations',
    corps: z.object({ canal: z.enum(CANAUX_CONTESTATION), dit: z.string().trim().min(3, 'console.contestation.dit_court').max(1000) }),
    traiter: async ({ params, corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_contester($1, $2, $3, $4) v',
        [lireUuid(params.facture), corps.canal, corps.dit, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/contestations/:contestation/regulariser', geste: 'console.contestations',
    // 0138 (l'audit 1.42.0 A04) : un remboursement dit son montant (« 47,410 », en dinars) et son jour ; un avoir, son numéro.
    corps: z.object({ issue: z.enum(ISSUES), reference: z.string().trim().max(60).nullable(), montant: z.string().max(40).nullable().optional(),
      le: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      // Le montant tapé (« 47,410 »), en millimes ; illisible, la case le dit (la base revérifie ce qu'il vaut).
      const montant = corps.montant?.trim() ? prixTape(corps.montant) : null;
      if (corps.montant?.trim() && (montant === null || montant <= 0n)) return refusDuChamp('montant', 'console.paiements.montant_illisible');
      await transaction(tx).query('select plateforme.console_regulariser($1, $2, $3, $4::bigint, $5::date, $6, $7)',
        [lireUuid(params.contestation), corps.issue, corps.reference || null, montant === null ? null : montant.toString(), corps.le ?? null, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // ── Nos factures (docs/console.md C31 ; 0109) ─────────────────────────────────────────────────────────────────────
  // Celles d'un mois (« 2026-10 ») et les avoirs qui les corrigent : la pièce, le client, ce qu'elle paie, la TTN (le
  // motif d'un refus, en mots), le paiement ; le résumé et les filtres comptés par la fonction qui filtre (C3).
  ajouter({
    methode: 'GET', chemin: '/console/nos-factures', geste: 'console.factures.voir',
    traiter: async ({ query }, tx) => {
      const jour = aujourdhuiATunis();
      const mois = moisDemande(query.mois, jour);
      const n = lireNosFactures(await lireJson(transaction(tx), 'select plateforme.console_nos_factures($1::date) v', [`${mois}-01`]));
      const filtre: Filtre = FILTRES.includes(query.filtre as Filtre) ? query.filtre as Filtre : 'toutes';
      const gardees = n.pieces.filter((p) => dansLeFiltre(p, filtre, jour));
      const debut = Math.max(Number(query.debut ?? 0) || 0, 0);
      const nb = limite(query);
      return {
        corps: {
          aujourdhui: jour, mois, courant: mois === jour.slice(0, 7), editeur: n.editeur, resume: resumeDesFactures(n, jour), filtre,
          comptes: Object.fromEntries(FILTRES.map((f) => [f, n.pieces.filter((p) => dansLeFiltre(p, f, jour)).length])),
          // Les refusées du mois, en tête : chacune attend un geste dans SkanFact.
          refusees: n.pieces.filter((p) => etatTtn(p) === 'refusee').map((p) => ligne(p, jour, texteDuMotif)),
          total: gardees.length, lignes: gardees.slice(debut, debut + nb).map((p) => ligne(p, jour, texteDuMotif)), suite: debut + nb < gardees.length ? debut + nb : null,
        },
      };
    },
  });
  // Saisir un coût du mois : chaque case refusée se nomme ; la base revérifie tout.
  ajouter({
    methode: 'POST', chemin: '/console/paiements/couts', geste: 'console.paiements.couts',
    corps: z.object({ mois: z.string().max(10), libelle: z.string().max(200), montant: z.string().max(40), dApres: z.string().max(400) }),
    traiter: async ({ corps }, tx) => {
      const instant = maintenant();
      const jour = aujourdhuiATunis(instant);
      const libelle = corps.libelle.trim(), dApres = corps.dApres.trim();
      if (libelle.length < 2 || libelle.length > 80) return refusDuChamp('libelle', 'console.paiements.libelle_illisible');
      const montant = prixTape(corps.montant);
      if (montant === null || montant <= 0n || montant > 1_000_000_000_000n) return refusDuChamp('montant', 'console.paiements.montant_illisible');
      if (dApres.length < 3) return refusDuChamp('dApres', 'console.paiements.d_apres_court');
      if (dApres.length > 200) return refusDuChamp('dApres', 'console.paiements.d_apres_long');
      if (moisDemande(corps.mois, jour) !== corps.mois) return refusDuChamp('mois', 'console.paiements.mois_illisible');
      await transaction(tx).query('select plateforme.console_ajouter_cout($1::date, $2, $3::bigint, $4, $5::date)',
        [`${corps.mois}-01`, libelle, montant.toString(), dApres, jour]);
      return { statut: 201, corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/paiements/couts/:cout/retirer', geste: 'console.paiements.couts',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_retirer_cout($1, $2)', [lireUuid(params.cout), corps.motif]);
      return { corps: { ok: true } };
    },
  });

  // ── Le support (docs/support.md ; 0095) ─────────────────────────────────────────────────────────────────────────────
  // Les demandes ouvertes, rangées (sans réponse depuis 24 h d'abord), puis les closes par pages de cinquante (`closes`, à
  // partir de la combientième : 0114) ; celles d'un seul
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
      const debutCloses = Math.max(Math.trunc(Number(query.closes ?? 0)) || 0, 0);
      const s = lireSupport(await lireJson(x, 'select plateforme.console_support($1, $2, $3) v', [entreprise, demande, debutCloses]));
      // La version en service (le numéro que le suiveur lit pour celle qui tourne) : une correction notée « 1.32.0 » est en
      // ligne quand elle l'atteint (0126).
      const suiveur = await lireEtatDuSuiveur();
      const enService = suiveur?.version ? suiveur.numeros[suiveur.version] ?? null : null;
      const avecCorrection = <L extends LigneDemande>(l: L) => ({ ...l, correction: l.correction ? { ...l.correction, enService: versionAtteinte(l.correction.version, enService) } : null });
      const client = s.demande
        ? (await lesEntreprises(x, jour)).find((e) => e.id === s.demande?.ligne.entreprise.id) ?? null
        : null;
      return {
        corps: {
          aujourdhui: jour, maintenant: t.toISOString(), entreprise,
          comptes: compter(s.ouvertes, t),
          ouvertes: ranger(s.ouvertes, t).map(avecCorrection), closes: s.closes.map((l) => avecCorrection({ ...l, etat: etatDe(l, t) })), enService,
          pagesCloses: { debut: debutCloses, total: s.nCloses, parPage: CLOSES_PAR_PAGE },
          demande: s.demande ? { ...s.demande, ligne: avecCorrection(s.demande.ligne), etat: etatDe(s.demande.ligne, t), suggestions: suggererPour(s.demande) } : null,
          client: client ? {
            id: client.id, nom: client.raisonSociale, etat: client.etat, faits: client.faits,
            membres: client.membres, pieces: client.pieces, derniereActivite: client.derniereActivite, tenuePar: client.tenuePar,
          } : null,
          articles: articlesDeLAide(), regles: { sansReponseHeures: SANS_REPONSE_HEURES, sansReponseHeuresUrgente: SANS_REPONSE_HEURES_URGENTE },
          // À qui une demande se confie (0115) : la direction et le support.
          equipe: s.equipe,
          // La demande ouverte : ses notes privées (0133), et les réponses validées que le champ de réponse propose.
          notes: s.demande ? lireNotes(await lireJson(x, 'select plateforme.console_notes_demande($1) v', [s.demande.ligne.id])) : [],
          reponses: s.demande ? reponsesOffertes(lireDocs(await lireJson(x, 'select plateforme.console_docs_support() v'))) : [],
          // L'évolution qu'elle réclame (0134), s'il y en a une.
          evolution: s.demande ? lireEvolutionDe(await lireJson(x, 'select plateforme.console_evolution_de($1) v', [s.demande.ligne.id])) : null,
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
      // 0124 (l'audit C09) : l'identifiant de cette réponse, tiré par l'écran et gardé quand il la renvoie après une
      // coupure : la même commande ne fait qu'un message.
      commande: z.string().uuid().optional(),
    }),
    traiter: async ({ params, corps }, tx) => {
      // La même commande déjà partie avec un autre texte (l'audit 1.42.0, A07) : 409, `champ: 'commande'` — l'écran tire
      // une commande neuve, relit la conversation et garde ce qui est écrit. La base le refuse aussi (0136).
      const deja = (await transaction(tx).query('select plateforme.reponse_de_la_commande($1, $2) r', [lireUuid(params.demande), corps.commande ?? null])).rows[0]?.r as { texte: string; article: string | null } | null;
      if (deja && (deja.texte !== corps.texte || deja.article !== corps.article)) {
        return { statut: 409, corps: { motif: motif('base.support.commande_autre_texte'), champ: 'commande' } };
      }
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_repondre_demande($1, $2, $3, $4, $5) v',
        [lireUuid(params.demande), corps.texte, corps.article, maintenant(), corps.commande ?? null]);
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
  // ── Les retours des clients et les demandes d'évolution (docs/console.md C58 ; 0134) ─────────────────────────────────
  // Les évolutions, les plus demandées d'abord (le nombre de clients), avec les demandes qui les réclament.
  ajouter({
    methode: 'GET', chemin: '/console/support/evolutions', geste: 'console.support.voir',
    traiter: async (_r, tx) => ({ corps: { evolutions: lireEvolutions(await lireJson(transaction(tx), 'select plateforme.console_evolutions() v')) } }),
  });
  // Noter une évolution, et y rattacher la demande d'où elle vient.
  ajouter({
    methode: 'POST', chemin: '/console/support/evolutions', geste: 'console.support.repondre',
    corps: z.object({
      titre: z.string().trim().min(3, 'console.support.evolution_titre').max(120, 'console.support.evolution_titre'),
      description: z.string().trim().max(2000, 'console.support.evolution_description').nullable(),
      demande: uuid.nullable(),
    }),
    traiter: async ({ corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_noter_evolution($1, $2, $3, $4) v', [corps.titre, corps.description, corps.demande, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  // Rattacher une demande à une évolution, ou l'en détacher (nul).
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/evolution', geste: 'console.support.repondre',
    corps: z.object({ evolution: uuid.nullable() }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_rattacher_evolution($1, $2, $3)', [lireUuid(params.demande), corps.evolution, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // Décider de son état : la direction seule.
  ajouter({
    methode: 'POST', chemin: '/console/support/evolutions/:evolution/decider', geste: 'console.support.evolutions',
    corps: z.object({ etat: z.enum(ETATS_EVOLUTION), version: z.string().trim().max(20).nullable(), raison: z.string().trim().max(400).nullable() }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_decider_evolution($1, $2, $3, $4, $5)', [lireUuid(params.evolution), corps.etat, corps.version, corps.raison, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // ── La documentation interne du support (docs/console.md C57 ; 0133) ─────────────────────────────────────────────────
  // Une note privée sur une demande : l'équipe seule la lit, jamais le client ; au journal, sans son texte.
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/notes', geste: 'console.support.repondre',
    corps: z.object({ texte: z.string().trim().min(3, 'console.support.note_courte').max(2000, 'console.support.note_longue') }),
    traiter: async ({ params, corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_noter_en_prive($1, $2, $3) v', [lireUuid(params.demande), corps.texte, maintenant()]);
      return { statut: 201, corps: { id } };
    },
  });
  // Les fiches : les réponses (validées par la direction avant de s'offrir dans le champ de réponse) et les procédures.
  ajouter({
    methode: 'GET', chemin: '/console/support/documentation', geste: 'console.support.voir',
    traiter: async (_r, tx) => ({ corps: { fiches: lireDocs(await lireJson(transaction(tx), 'select plateforme.console_docs_support() v')) } }),
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/documentation', geste: 'console.support.repondre',
    corps: z.object({
      id: uuid.nullable(), sorte: z.enum(SORTES_DOC),
      titre: z.string().trim().min(3, 'console.support.doc_titre').max(120, 'console.support.doc_titre'),
      texte: z.string().trim().min(10, 'console.support.doc_texte').max(8000, 'console.support.doc_texte'),
      // La version reprise (l'audit 1.42.0, A03) : l'instant de la fiche telle qu'elle a été ouverte ; nul pour une fiche neuve.
      lue: instantLu.nullable().optional(),
    }),
    traiter: async ({ corps }, tx) => {
      const id = await lireJson<string>(transaction(tx), 'select plateforme.console_ecrire_doc($1, $2, $3, $4, $5::timestamptz, $6) v',
        [corps.id, corps.sorte, corps.titre, corps.texte, corps.lue ?? null, maintenant()]);
      return { statut: corps.id ? 200 : 201, corps: { id } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/documentation/:fiche/valider', geste: 'console.support.valider',
    // La version relue (l'audit 1.42.0, A03) : une fiche reprise depuis est refusée, rien n'est validé.
    corps: z.object({ lue: instantLu }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_valider_doc($1, $2::timestamptz, $3)', [lireUuid(params.fiche), corps.lue, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/documentation/:fiche/retirer', geste: 'console.support.valider',
    corps: z.object({ motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_retirer_doc($1, $2, $3)', [lireUuid(params.fiche), corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // Qui suit une demande, sa priorité, l'attente de la technique (0115 ; l'audit F13) : chacun avec son motif, au journal.
  // `membre` absent : celui qui fait le geste la prend.
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/suivre', geste: 'console.support.repondre',
    corps: z.object({ membre: uuid.nullable().optional(), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_suivre_demande($1, $2, $3, $4)', [lireUuid(params.demande), corps.membre ?? null, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/priorite', geste: 'console.support.repondre',
    corps: z.object({ priorite: z.enum(PRIORITES), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_priorite_demande($1, $2, $3, $4)', [lireUuid(params.demande), corps.priorite, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // Une demande liée à son incident, et la version qui la corrige (0126 ; la liste des fonctions qui manquent, 19) : les
  // incidents qu'elle peut rejoindre (ouverts, ou clos depuis trente jours), puis les deux gestes, chacun avec son motif.
  ajouter({
    methode: 'GET', chemin: '/console/support/incidents', geste: 'console.support.voir',
    traiter: async (_r, tx) => ({ corps: { incidents: await lireJson(transaction(tx), 'select plateforme.console_incidents_a_lier($1) v', [maintenant().toISOString()]) } }),
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/incident', geste: 'console.support.repondre',
    corps: z.object({ incident: uuid.nullable(), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_lier_incident($1, $2, $3, $4)', [lireUuid(params.demande), corps.incident, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/correction', geste: 'console.support.repondre',
    corps: z.object({ version: z.string().trim().regex(VERSION, 'console.support.version_illisible').nullable(), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_noter_correction($1, $2, $3, $4)', [lireUuid(params.demande), corps.version, corps.motif, maintenant()]);
      return { corps: { ok: true } };
    },
  });
  // Prévenir d'un coup les clients d'un incident (0128) : la même réponse à chaque demande ouverte qui lui est liée ;
  // l'identifiant de commande, tiré par l'écran, fait qu'un renvoi après une coupure n'écrit rien deux fois.
  ajouter({
    methode: 'POST', chemin: '/console/support/incidents/:incident/repondre', geste: 'console.support.repondre',
    corps: z.object({ texte: z.string().trim().min(3, 'console.support.reponse_courte').max(4000), commande: z.string().uuid() }),
    traiter: async ({ params, corps }, tx) => {
      const n = await lireJson<number>(transaction(tx), 'select plateforme.console_repondre_incident($1, $2, $3, $4) v',
        [lireUuid(params.incident), corps.texte, maintenant(), corps.commande]);
      return { statut: 201, corps: { demandes: n } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/support/demandes/:demande/technique', geste: 'console.support.repondre',
    corps: z.object({ attend: z.boolean(), motif: motifGeste }),
    traiter: async ({ params, corps }, tx) => {
      await transaction(tx).query('select plateforme.console_attente_technique($1, $2, $3, $4)', [lireUuid(params.demande), corps.attend, corps.motif, maintenant()]);
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
