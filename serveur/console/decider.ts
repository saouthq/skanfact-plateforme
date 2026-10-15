// L'accueil de la console (skanfact docs/cadrage/10-console.md § 2.1 à 2.3 ; docs/console.md), pur : la liste des
// clients avec leur état, le tableau du matin, et « À décider ». Trois règles :
//   - C3 : un chiffre et la liste qu'il ouvre viennent de la MÊME fonction (`categorie`, `lireEntreprises`) ;
//   - C2 : rien n'est vert sans mesure. Ce que la console ne mesure pas encore se dit « non mesuré », avec la raison ;
//   - une console où rien ne se passe affiche une liste vide, et le dit : elle n'invente pas de travail.

import { confirme } from '../../exploitation/veille.ts';
import { etatAbonnement, joursEntre, lireFaits, plusJours, type Delai, type Etat, type Faits, type AVenir, type ModuleAchete, type OffreSuivante, type Regles } from '../abonnement/etat.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import type { RoleConsole } from './gestes.ts';
import type { AEmettre, Defaite, MesureEncaisse, Trop } from './paiements.ts';
import { compter, etatDe, type LigneDemande } from './support.ts';
import { CONTESTATION_JOURS, enCours, joursDAttente, type Contestation } from './contestations.ts';
import type { SecretLu } from './secrets.ts';

export type Entreprise = {
  id: string; raisonSociale: string; matricule: string | null; active: boolean; creeLe: string;
  organisation: { id: string; type: string; nom: string }; tenuePar: string | null;
  proprietaire: { nom: string; email: string } | null; membres: number; derniereActivite: string | null; pieces: number;
  faits: Faits; etat: Etat;
  // Venue par un cabinet (0107 ; la sixième vue de Clients) : son cabinet et le jour où son mandat commence. Seule la
  // liste des clients le lit ; ailleurs, absent.
  venuePar?: { cabinet: string; depuis: string } | null;
  // La remise de sa prochaine période (0106), que « par an » déduit comme les échéances (la liste des clients seulement).
  remise?: { nature: 'groupe' | 'cabinet'; taux: number } | null;
  // Ce que la liste des clients dit en plus de chaque ligne (0110 ; serveur/console/clients.ts, avecEnPlus) : les pièces
  // émises du mois, les jours ajoutés à son essai, la facture d'abonnement qui attend son paiement. Ailleurs, absent.
  enPlus?: EnPlus;
};
// La facture d'abonnement qui attend (préparée, pas encore payée) : son offre, son état, ce qu'il en reste à payer et
// d'ici quand. `reste` est vide tant qu'elle n'est pas émise (elle attend dans le dossier de SkanFact).
export type FactureQuiAttend = { offre: 'essentiel' | 'complet'; periodicite: 'annuel' | 'mensuel'; etat: string; reste: string | null; devise: string | null; echeance: string | null };
// `moisOffertRecent` (0113) : un mois lui a été offert ces douze derniers mois (le support n'en offre pas un second).
// `premiereFactureLe` (0127) : le jour de sa première facture émise — sa première utilisation réelle (serveur/console/arrivee.ts).
export type EnPlus = { piecesMois: number; essaiJours: number | null; prolonge: number; prolongeUneFois: boolean; moisOffertRecent?: boolean; attend: FactureQuiAttend | null; premiereFactureLe?: string | null };

// Ce que la base rend (plateforme.console_entreprises), lu prudemment : un champ illisible vaut « rien », jamais une
// valeur devinée ; l'état se déduit du jour de Tunis, avec les règles de l'abonnement (la grâce, les relances : 0104),
// lues une fois pour toute la liste.
// `enPlus` : le délai d'une échéance et l'offre de la prochaine (0111), le mois offert qui attend et les modules qui
// partent (0113), par entreprise.
export type FaitsEnPlus = { delai: Delai | null; offreSuivante: OffreSuivante | null; moisOffert?: boolean; modulesARetirer?: readonly ModuleAchete[]; aVenir?: AVenir | null };
export function lireEntreprises(brut: unknown, jour: string, regles: Regles, enPlus: ReadonlyMap<string, FaitsEnPlus> = new Map()): Entreprise[] {
  if (!Array.isArray(brut)) return [];
  return brut.map((x: Record<string, unknown>) => {
    const faits = { ...lireFaits((x.faits ?? {}) as Record<string, unknown>), regles, ...(enPlus.get(String(x.id)) ?? {}) };
    const o = (x.organisation ?? {}) as Record<string, unknown>;
    const p = x.proprietaire as Record<string, unknown> | null;
    return {
      id: String(x.id), raisonSociale: String(x.raisonSociale ?? ''), matricule: typeof x.matricule === 'string' ? x.matricule : null,
      active: x.active !== false, creeLe: String(x.creeLe ?? ''),
      organisation: { id: String(o.id ?? ''), type: String(o.type ?? ''), nom: String(o.nom ?? '') },
      tenuePar: typeof x.tenuePar === 'string' ? x.tenuePar : null,
      proprietaire: p && typeof p.nom === 'string' ? { nom: p.nom, email: String(p.email ?? '') } : null,
      membres: Number(x.membres ?? 0), derniereActivite: typeof x.derniereActivite === 'string' ? x.derniereActivite : null,
      pieces: Number(x.pieces ?? 0), faits, etat: etatAbonnement(faits, jour),
    };
  });
}

export type Categorie = Etat['etat'];
export const CATEGORIES: readonly Categorie[] = ['essai', 'actif', 'en_retard', 'lecture_seule', 'hors'];
export const categorie = (e: { etat: Etat }): Categorie => e.etat.etat;

// L'urgence d'un client, pour ranger la liste (« le plus urgent en haut ») : la grâce qui s'achève, la lecture seule de la
// semaine, l'essai ou l'abonnement qui finit bientôt, puis le reste.
export function urgence(e: Entreprise, jour: string): [number, number] {
  const s = e.etat;
  switch (s.etat) {
    case 'en_retard': return [0, s.jours];
    case 'lecture_seule': return joursEntre(s.depuis, jour) <= 7 ? [1, joursEntre(s.depuis, jour)] : [6, 0];
    case 'essai': return s.jours <= 7 ? [2, s.jours] : [4, s.jours];
    case 'actif': return s.jours <= 15 ? [3, s.jours] : [5, s.jours];
    default: return [7, 0];
  }
}

const comparerNoms = (a: Entreprise, b: Entreprise) => a.raisonSociale.localeCompare(b.raisonSociale, 'fr', { sensitivity: 'base' });
export function rangerParUrgence(liste: Entreprise[], jour: string): Entreprise[] {
  return [...liste].sort((a, b) => {
    const [ra, ja] = urgence(a, jour), [rb, jb] = urgence(b, jour);
    return ra - rb || ja - jb || comparerNoms(a, b);
  });
}

// Chercher un client : son nom, son matricule, son organisation, son propriétaire (nom ou adresse). Sans les accents ni
// la casse : « societe » trouve « Société ».
const plier = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function chercher(liste: Entreprise[], texte: string): Entreprise[] {
  const mots = plier(texte).split(/\s+/).filter(Boolean);
  if (!mots.length) return liste;
  return liste.filter((e) => {
    const champ = plier([e.raisonSociale, e.matricule ?? '', e.organisation.nom, e.proprietaire?.nom ?? '', e.proprietaire?.email ?? '', e.tenuePar ?? ''].join(' '));
    return mots.every((m) => champ.includes(m));
  });
}

// ── La veille du serveur (exploitation/veiller.ts, chaque minute) ────────────────────────────────────────────────────
export type SuiviVeille = { titre: string; grave: boolean; faire: string; depuis: string };
// `absente` : aucune veille sur ce serveur (un poste de développement) ; `silencieuse` : elle a écrit, mais plus depuis
// trop longtemps (elle ne veille plus) ; `ok` : son dernier passage est récent.
export type Veille = { etat: 'absente' } | { etat: 'silencieuse'; derniere: string } | { etat: 'ok'; derniere: string; problemes: (SuiviVeille & { cle: string })[] };
export const VEILLE_SILENCIEUSE_MIN = 5;

export function lireVeille(contenu: string | null, modifieLe: Date | null, maintenant: Date): Veille {
  if (contenu === null || modifieLe === null) return { etat: 'absente' };
  const derniere = modifieLe.toISOString();
  if (maintenant.getTime() - modifieLe.getTime() > VEILLE_SILENCIEUSE_MIN * 60_000) return { etat: 'silencieuse', derniere };
  let lu: unknown;
  try { lu = JSON.parse(contenu); } catch { return { etat: 'silencieuse', derniere }; }
  // Seuls les problèmes CONFIRMÉS (exploitation/veille.ts, `confirme`) : un service qui revient avant la seconde minute
  // n'est pas une alerte — ni à la page d'état, ni dans l'histoire que garde la base, ni ici. Un fichier qui ne compte
  // pas les relevés (`vus` absent) dit ses problèmes tels quels.
  const problemes = Object.entries(((lu as { problemes?: unknown })?.problemes ?? {}) as Record<string, Record<string, unknown>>)
    .filter(([cle, p]) => p && typeof p.titre === 'string' && confirme(cle, typeof p.vus === 'number' ? p.vus : Infinity))
    .map(([cle, p]) => ({ cle, titre: String(p.titre), grave: p.grave === true, faire: String(p.faire ?? ''), depuis: String(p.depuis ?? '') }))
    .sort((a, b) => Number(b.grave) - Number(a.grave) || a.depuis.localeCompare(b.depuis));
  return { etat: 'ok', derniere, problemes };
}

// ── Le tableau du matin (§ 2.2) ──────────────────────────────────────────────────────────────────────────────────────
// L'encaissé du mois (docs/console.md C30) : un montant, ou « non mesuré » avec sa raison (C2) — sans entreprise SkanFact
// désignée, rien ne s'encaisse par la plateforme. La direction seule le lit (la route le retire pour le support).
export type Mesure = MesureEncaisse;
export type Tableau = {
  entreprisesDeLaSemaine: number;
  essais: number;
  actifs: { total: number; essentiel: number; complet: number };
  enRetard: number;
  lectureSeule: number;
  revenusDuMois: Mesure;
  // Les demandes au support (0095) : ouvertes, celles qui attendent NOTRE réponse, et celles qui l'attendent depuis plus
  // de vingt-quatre heures — comptées par la fonction de l'écran Support (C3).
  support: { ouvertes: number; aRepondre: number; sansReponse: number; attenteMax: number | null };
  service: { etat: 'ok' } | { etat: 'problemes'; n: number; graves: number } | { etat: 'non_mesure'; raison: 'pas_de_veille' | 'veille_silencieuse'; derniere?: string };
};

// Une entreprise inscrite ces sept derniers jours, aujourd'hui compris : la liste des clients (« ?nouvelles=1 ») montre les
// lignes qui en ont une, par cette seule règle (C3).
export const inscriteCetteSemaine = (e: Entreprise, jour: string) => e.creeLe >= plusJours(jour, -6);

// `inscriptions` : les LIGNES de la liste que la tuile ouvre (une ligne par organisation : un groupe de deux sociétés
// nouvelles en fait une), comptées par la route avec la fonction de la liste (0114 ; avant, la tuile comptait les
// entreprises, et disait 237 pour une liste de 236). Sans elle, les entreprises de la semaine.
export function tableau(liste: Entreprise[], veille: Veille, jour: string, demandes: LigneDemande[] = [], maintenant: Date = new Date(),
  revenus: Mesure = { mesure: false, raison: 'editeur_absent' }, inscriptions: number | null = null): Tableau {
  const de = (c: Categorie) => liste.filter((e) => categorie(e) === c);
  const actifs = de('actif');
  return {
    entreprisesDeLaSemaine: inscriptions ?? liste.filter((e) => inscriteCetteSemaine(e, jour)).length,
    essais: de('essai').length,
    actifs: { total: actifs.length, essentiel: actifs.filter((e) => e.faits.offre === 'essentiel').length, complet: actifs.filter((e) => e.faits.offre === 'complet').length },
    enRetard: de('en_retard').length,
    lectureSeule: de('lecture_seule').length,
    revenusDuMois: revenus,
    support: compter(demandes, maintenant),
    service: veille.etat === 'absente' ? { etat: 'non_mesure', raison: 'pas_de_veille' }
      : veille.etat === 'silencieuse' ? { etat: 'non_mesure', raison: 'veille_silencieuse', derniere: veille.derniere }
        : veille.problemes.length ? { etat: 'problemes', n: veille.problemes.length, graves: veille.problemes.filter((p) => p.grave).length } : { etat: 'ok' },
  };
}

// ── À décider (§ 2.1) ────────────────────────────────────────────────────────────────────────────────────────────────
// Chaque ligne dit ce qui demande une décision, et l'écran qu'elle ouvre (la fiche d'un client, le service).
export type Ligne =
  | { sorte: 'service'; ouvre: 'service'; cle: string; titre: string; faire: string; depuis: string; grave: boolean }
  // 0130 : un secret à renouveler dans trente jours au plus, ou dont l'échéance est passée (jamais sa valeur).
  | { sorte: 'secret'; ouvre: 'service'; nom: string; echeance: string; jours: number }
  | { sorte: 'veille_silencieuse'; ouvre: 'service'; derniere: string }
  | { sorte: 'en_retard'; ouvre: 'fiche'; entreprise: { id: string; nom: string }; echeance: string; lectureSeuleLe: string; jours: number; apresEssai: boolean }
  | { sorte: 'lecture_seule'; ouvre: 'fiche'; entreprise: { id: string; nom: string }; depuis: string; raison: string }
  | { sorte: 'essai_sans_usage'; ouvre: 'fiche'; entreprise: { id: string; nom: string }; jusquAu: string; jours: number; proprietaire: { nom: string; email: string } | null }
  | { sorte: 'support'; ouvre: 'support'; demande: { id: string; numero: number; sujet: string; canal: LigneDemande['canal'] }; entreprise: { id: string; nom: string }; demandeur: string; heures: number; depuis: string }
  // L'argent (0113), pour la direction : une de nos factures payée puis défaite (l'abonnement a couru sur elle), une
  // facture préparée qui attend d'être émise, un trop-perçu à rembourser ou à garder.
  // Une facture défaite par un avoir et payée quand même : une seule ligne, qui dit aussi ce qui est à rendre (`trop`).
  | { sorte: 'facture_defaite'; ouvre: 'fiche'; entreprise: { id: string; nom: string }; numero: string | null; payeeLe: string; fin: string; ecran: string;
      cause: 'avoir' | 'reglement'; trop: string | null }
  | { sorte: 'a_emettre'; ouvre: 'facture'; entreprise: { id: string; nom: string }; debut: string; fin: string; prepareLe: string; jours: number; ecran: string }
  | { sorte: 'trop_percu'; ouvre: 'paiements'; entreprise: { id: string; nom: string }; numero: string | null; trop: string; devise: string; annulee: boolean; ecran: string }
  // 0129 : une facture contestée qui attend sa régularisation depuis une semaine.
  | { sorte: 'contestation'; ouvre: 'fiche'; entreprise: { id: string; nom: string }; numero: string | null; ouverteLe: string; jours: number };
// Ce que Paiements sait de l'argent qui attend une décision (serveur/console/paiements.ts, par ses fonctions), et les
// contestations en cours (serveur/console/contestations.ts).
export type Argent = { defaites: readonly Defaite[]; aEmettre: readonly AEmettre[]; trop: readonly Trop[]; contestees?: readonly Contestation[] };
// Une facture préparée attend d'être émise : au-delà de deux jours, elle demande un geste (l'émettre, ou la supprimer).
export const A_EMETTRE_JOURS = 2;

// « A servi » n'a qu'une définition (0114, plateforme.pieces_creees) : une pièce créée dans l'entreprise — un devis, une
// facture, un achat de son dossier, ou une pièce faite par le serveur ou l'API (une vente, un ticket, un achat). La liste
// des clients (« à appeler ») et « À décider » la lisent toutes deux ici.
export const aServi = (e: Pick<Entreprise, 'pieces'>) => e.pieces > 0;
// Un essai qui finit dans trois jours sans avoir servi.
export const ESSAI_SANS_USAGE_JOURS = 3;
export const LECTURE_SEULE_DE_LA_SEMAINE = 7;

// Qui lit quoi : la technique, le service seulement ; le support, les clients seulement ; la direction, tout. Une demande
// au support sans réponse depuis vingt-quatre heures passe juste après un service grave : un client attend, et la
// promesse (« dans la journée ») est déjà tenue en retard ; la plus ancienne d'abord.
// L'argent (`argent`) : la direction seule, et pour les entreprises de la liste (la fiche passe la sienne).
export function aDecider(liste: Entreprise[], veille: Veille, jour: string, role: RoleConsole, demandes: LigneDemande[] = [], maintenant: Date = new Date(),
  argent: Argent | null = null, secrets: readonly SecretLu[] = []): Ligne[] {
  const lignes: [number, number, Ligne][] = [];
  const service = role !== 'support';
  const clients = role !== 'technique';
  if (role === 'direction' && argent) {
    const ici = new Set(liste.map((e) => e.id));
    // Une facture payée puis annulée par un avoir a aussi un trop-perçu : c'est le même événement, une seule décision.
    const tropDe = new Map(argent.trop.map((t) => [t.piece, t.trop]));
    const defaites = new Set(argent.defaites.map((d) => d.piece));
    for (const d of argent.defaites) {
      if (ici.has(d.entreprise.id)) lignes.push([1.5, 0, { sorte: 'facture_defaite', ouvre: 'fiche', entreprise: d.entreprise, numero: d.numero, payeeLe: d.payeeLe, fin: d.fin, ecran: d.ecran,
        cause: d.cause, trop: tropDe.get(d.piece) ?? null }]);
    }
    for (const a of argent.aEmettre) {
      // Le jour de Tunis où elle a été préparée (un instant n'est pas un jour).
      const instant = new Date(a.prepareLe);
      if (!ici.has(a.entreprise.id) || Number.isNaN(instant.getTime())) continue;
      const le = aujourdhuiATunis(instant);
      const jours = joursEntre(le, jour);
      if (jours >= A_EMETTRE_JOURS) lignes.push([2.5, -jours, { sorte: 'a_emettre', ouvre: 'facture', entreprise: a.entreprise, debut: a.debut, fin: a.fin, prepareLe: le, jours, ecran: a.ecran }]);
    }
    for (const t of argent.trop) {
      if (ici.has(t.entreprise.id) && !defaites.has(t.piece)) lignes.push([3.5, 0, { sorte: 'trop_percu', ouvre: 'paiements', entreprise: t.entreprise, numero: t.numero, trop: t.trop, devise: t.devise, annulee: t.annulee, ecran: t.ecran }]);
    }
    for (const c of enCours(argent.contestees ?? [])) {
      const jours = joursDAttente(c, jour);
      if (ici.has(c.entreprise.id) && jours >= CONTESTATION_JOURS) {
        lignes.push([3, -jours, { sorte: 'contestation', ouvre: 'fiche', entreprise: c.entreprise, numero: c.numero, ouverteLe: aujourdhuiATunis(new Date(c.ouverteLe)), jours }]);
      }
    }
  }
  if (service && veille.etat === 'silencieuse') lignes.push([0, 0, { sorte: 'veille_silencieuse', ouvre: 'service', derniere: veille.derniere }]);
  if (service && veille.etat === 'ok') {
    for (const p of veille.problemes) lignes.push([p.grave ? 0 : 2, 0, { sorte: 'service', ouvre: 'service', ...p }]);
  }
  // Les secrets (0130), pour qui tient le service : en retard juste après un service grave, bientôt après les autres.
  if (service) {
    for (const s of secrets) {
      if ((s.etat === 'en_retard' || s.etat === 'bientot') && s.echeance && s.jours !== null) {
        lignes.push([s.etat === 'en_retard' ? 0.8 : 2.8, s.jours, { sorte: 'secret', ouvre: 'service', nom: s.nom, echeance: s.echeance, jours: s.jours }]);
      }
    }
  }
  if (clients) {
    for (const d of demandes) {
      const e = etatDe(d, maintenant);
      if ((e.etat === 'nouvelle' || e.etat === 'a_repondre') && e.sansReponse) {
        lignes.push([0.5, -e.heures, { sorte: 'support', ouvre: 'support', demande: { id: d.id, numero: d.numero, sujet: d.sujet, canal: d.canal },
          entreprise: { id: d.entreprise.id, nom: d.entreprise.nom }, demandeur: d.demandeur.nom, heures: e.heures, depuis: e.attendDepuis }]);
      }
    }
  }
  if (clients) {
    for (const e of liste) {
      const s = e.etat;
      const qui = { id: e.id, nom: e.raisonSociale };
      if (s.etat === 'en_retard') lignes.push([1, s.jours, { sorte: 'en_retard', ouvre: 'fiche', entreprise: qui, echeance: s.echeance, lectureSeuleLe: s.lectureSeuleLe, jours: s.jours, apresEssai: s.apresEssai }]);
      // Une suspension est une décision de SkanFact : elle n'a pas à revenir ici.
      else if (s.etat === 'lecture_seule' && s.raison !== 'suspendu' && joursEntre(s.depuis, jour) < LECTURE_SEULE_DE_LA_SEMAINE) {
        lignes.push([3, joursEntre(s.depuis, jour), { sorte: 'lecture_seule', ouvre: 'fiche', entreprise: qui, depuis: s.depuis, raison: s.raison }]);
      } else if (s.etat === 'essai' && s.jours <= ESSAI_SANS_USAGE_JOURS && !aServi(e)) {
        lignes.push([4, s.jours, { sorte: 'essai_sans_usage', ouvre: 'fiche', entreprise: qui, jusquAu: s.jusquAu, jours: s.jours, proprietaire: e.proprietaire }]);
      }
    }
  }
  return lignes.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , l]) => l);
}
