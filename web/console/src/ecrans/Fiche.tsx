// La fiche d'un client (serveur/console/routes.ts, GET /console/entreprises/:id ; 0083, console_entreprise) : qui il est,
// son abonnement et son histoire (chaque geste, son motif, son auteur), les gestes que ton rôle permet AUJOURD'HUI, ses
// membres, et des comptes. La liste fermée de la console (10 § 4) : jamais le contenu d'un dossier.
//
// Recalée sur sa maquette (docs/console.md C21) : « Ce qui attend, pour ce client » en tête (les lignes d'« À décider »
// qui le nomment, par la même fonction, avec le geste qui y répond), puis des onglets — l'aperçu (son entreprise, ses
// comptes, à qui parler, son cabinet), l'abonnement, les membres, le journal de son abonnement.
//
// Un geste (10 § 2.4) passe par sa fenêtre : ses paramètres, son motif, puis l'APERÇU de l'état d'après (le serveur le
// calcule par la même règle que le geste, sans rien écrire), et seulement alors le geste. La ligne d'abonnement lue
// part avec lui : changée entre-temps, le serveur refuse au lieu d'écraser (01 R15), et la fiche se relit.
import { useEffect, useRef, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { abonnementEnMots, expliquer, offreEtPeriode, puceDe, type Etat, type Faits, type Offre, type Periodicite } from '../abonnement.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture, useRelireQuandOnRegarde, type Role } from '../contexte.ts';
import { dans, heureDe, jourCourt, jourDe, moisEnMots, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Champ, Choix, Dialogue, Icone, Lien, maj, parcourirMenu, Puce, toast, Vide, Zone, type NomIcone, type TonPuce } from '../ui.tsx';
import { organisationEnMots } from './Clients.tsx';
import type { Place } from './Cabinets.tsx';
import { depuisEnMots, etatEnMots, NoterDemande, refDemande, type LigneDemande } from './Support.tsx';
import { AccesDossier } from './AccesDossier.tsx';
import { contexteDe, EcrireAuContact, NoterAppel, resultatEnMots, type ResultatAppel } from './Echanges.tsx';
import { montant } from '../argent.ts';
import { CarteReprise, repriseEnCours, type Reprise } from './Reprise.tsx';
import { defaiteEnMots } from './Accueil.tsx';

export type Geste = 'prolonger' | 'payer' | 'resilier' | 'annuler-resiliation' | 'suspendre' | 'reprendre' | 'offrir' | 'retirer-offert' | 'ouvrir-module' | 'fermer-module'
  | 'accorder-delai' | 'offrir-mois' | 'changer-offre';
// Les modules achetés seuls sur Essentiel (14c ; 0099).
type ModuleAchete = 'paie' | 'compta';
const MODULES: readonly ModuleAchete[] = ['paie', 'compta'];
type LigneAbo = { essai_jusqu_au: string; paye_jusqu_au: string | null; offre: Offre | null; periodicite: Periodicite | null; resilie_le: string | null; suspendu_le: string | null; offert: boolean;
  modules?: ModuleAchete[]; delai_echeance?: string | null; delai_jusqu_au?: string | null; suivante_offre?: Offre | null; suivante_periodicite?: Periodicite | null; suivante_a_partir_du?: string | null;
  // 0113 : le mois offert qui attend la prochaine facture, les modules qui partent au renouvellement.
  mois_offerts?: number; modules_a_retirer?: ModuleAchete[] };
// `derniereIci` (0114) : son dernier geste dans CETTE entreprise ; `derniereConnexion`, sa dernière connexion, où que ce soit.
type Membre = { nom: string; email: string; roles: string[]; depuis: string; derniereConnexion: string | null; derniereIci?: string | null };
type CabinetDe = { id: string; nom: string; place: Place; mandat: { statut: 'propose' | 'actif'; debut: string } | null };
type Evenement = { id: string; le: string; nature: string; par: 'systeme' | 'exploitation'; motif: string | null; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null; qui: { nom: string; role: Role } | null };
type Donnees = {
  aujourdhui: string; id: string; raisonSociale: string; matricule: string | null; formeJuridique: string | null; active: boolean; devise: string; creeLe: string;
  organisation: { id: string; type: string; nom: string }; tenuePar: string | null; faits: Faits; ligne: LigneAbo | null; etat: Etat; gestes: Geste[];
  membres: Membre[]; comptes: { etablissements: number; caisses: number; salaries: number; piecesCreees: number; piecesEmises: { mois: string; n: number }[] };
  prolongeDejaUneFois: boolean; evenements: Evenement[]; cabinets: CabinetDe[]; attend: Attente[];
  // Le dernier instant où quelqu'un a travaillé dans cette entreprise (0114, par entreprise : jamais ailleurs).
  derniereActivite?: string | null;
  // Ses demandes au support (0095), rangées par la fonction de l'écran Support (C3).
  support: { comptes: { ouvertes: number; aRepondre: number }; ouvertes: LigneDemande[]; closes: LigneDemande[] };
  // Ses factures d'abonnement (docs/abonnement.md B2–B4), et l'entreprise SkanFact où elles naissent.
  factures: { lignes: LigneFacture[]; editeur: { entreprise: string; raisonSociale: string; proprietaire: boolean } | null };
  // Son groupe, les sociétés de la même propriétaire, et la remise de sa prochaine période (0106, docs/abonnement.md C17).
  groupe: GroupeDe;
  // 0110 : son numéro, sa ville, le téléphone vérifié de sa propriétaire, son dernier appel ; ses notes d'appel ; ce que
  // la liste dit en plus (les pièces émises du mois, l'essai, la facture qui attend). 0111 : l'offre de la prochaine
  // échéance, le délai accordé.
  identite: { numero: string | null; ville: string | null; telephone: string | null; dernierAppel: { le: string; resultat: ResultatAppel; qui: string | null } | null } | null;
  notes: { id: string; le: string; resultat: ResultatAppel; qui: string | null; resume: string | null }[];
  enPlus: { piecesMois: number; essaiJours: number | null; prolonge: number; prolongeUneFois: boolean } | null;
  offreSuivante: { offre: Offre; periodicite: Periodicite; aPartirDu: string } | null;
  delai: { echeance: string; jusquAu: string } | null;
  // La procédure de reprise en cours, ou la dernière (0112) : la direction seule la reçoit.
  reprise: Reprise | null;
  // Ce que sa prochaine facture coûtera (0113), par la règle de la facture : le même chiffre que la liste et les échéances.
  prochaineFacture: { debut: string; montantHt: string } | null;
};
// La remise d'une période (serveur/abonnement/remise.ts) : la plus forte des deux ; `aussi`, l'autre, qui ne s'ajoute pas.
type RemiseSeule = { nature: 'groupe' | 'cabinet'; taux: number; groupe: string | null; premiere: string | null; cabinet: string | null; jusquAu: string | null };
type Remise = RemiseSeule & { aussi: RemiseSeule | null };
type MembreGroupe = { entreprise: string; raisonSociale: string; premierePeriode: string | null };
type GroupeDe = {
  groupe: { id: string; nom: string; depuis: string; motif: string; membres: (MembreGroupe & { depuis: string })[] } | null;
  voisines: { entreprise: string; raisonSociale: string }[]; groupes: { id: string; nom: string; membres: number }[];
  tauxGroupe: number; remise: Remise | null; prochaine: string;
};
type EtatFacture = 'a_emettre' | 'supprimee' | 'payee' | 'annulee' | 'partielle' | 'en_retard' | 'a_payer';
type LigneFacture = {
  id: string; editeur: string; piece: string; offre: Offre; periodicite: Periodicite; debut: string; fin: string; montantHt: string;
  prepareLe: string; preparePar: string | null; payeeLe: string | null; etat: EtatFacture; numero: string | null; echeance: string | null;
  net: string | null; reste: string | null; devise: string | null; ecran: string;
};
// L'état d'une facture d'abonnement, comme une pastille : ce qui attend un geste se voit, ce qui est réglé se calme.
const PUCE_FACTURE: Record<EtatFacture, TonPuce> = {
  a_emettre: 'semaine', supprimee: 'hors', a_payer: 'essai', partielle: 'essai', en_retard: 'en_retard', payee: 'actif', annulee: 'hors',
};
// Les lignes d'« À décider » qui nomment ce client (serveur/console/decider.ts, aDecider) : celles d'un client seulement.
type Attente =
  | { sorte: 'en_retard'; echeance: string; lectureSeuleLe: string; jours: number; apresEssai: boolean }
  | { sorte: 'lecture_seule'; depuis: string; raison: 'essai_termine' | 'non_renouvele' | 'resilie' | 'suspendu' }
  | { sorte: 'essai_sans_usage'; jusquAu: string; jours: number; proprietaire: { nom: string; email: string } | null }
  | { sorte: 'support'; demande: { id: string; numero: number; sujet: string }; demandeur: string; heures: number }
  // L'argent (0113), pour la direction.
  | { sorte: 'facture_defaite'; numero: string | null; payeeLe: string; fin: string; ecran: string; cause: 'avoir' | 'reglement'; trop: string | null }
  | { sorte: 'a_emettre'; debut: string; fin: string; prepareLe: string; jours: number; ecran: string }
  | { sorte: 'trop_percu'; numero: string | null; trop: string; devise: string; annulee: boolean; ecran: string };
export type OngletFiche = 'apercu' | 'abonnement' | 'factures' | 'support' | 'membres' | 'journal';
export const ONGLETS_FICHE: readonly OngletFiche[] = ['apercu', 'abonnement', 'factures', 'support', 'membres', 'journal'];

const cleGeste = (g: Geste) => g.replace('-', '_');

// Ce qu'un geste a changé, case par case (« essai jusqu'au : 12/10/2026 → 26/10/2026 ») : les cases d'une ligne
// d'abonnement, et ce que le geste retient (les jours ajoutés, la période payée, celle d'une facture préparée).
const CASES = ['essai_jusqu_au', 'paye_jusqu_au', 'offre', 'periodicite', 'resilie_le', 'suspendu_le', 'offert', 'modules', 'role', 'actif', 'jours', 'debut', 'fin',
  'facture_du', 'facture_au', 'montant_ht', 'remise', 'delai_echeance', 'delai_jusqu_au', 'suivante_offre', 'suivante_periodicite', 'suivante_a_partir_du',
  // 0113 : le paiement reçu et sa preuve, le mois offert, les modules qui partent.
  'facture', 'montant', 'moyen', 'le', 'mois_offert', 'mois_offerts', 'du', 'au', 'modules_a_retirer', 'au_renouvellement',
  // 0115 : qui suit une demande, sa priorité, l'attente de la technique ; le prochain essai d'un envoi repris.
  'suivie_par', 'priorite', 'technique', 'prochain'] as const;
// Les modules achetés, en mots (« Paie, Comptabilité complète ») ; aucun : « — ».
const nomsModules = (v: unknown) => (Array.isArray(v) ? v.filter((m): m is ModuleAchete => m === 'paie' || m === 'compta').map((m) => titre(`console.ecran.abo.module.${m}`)).join(', ') : '');
function valeurLisible(cle: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return dire(v ? 'console.ecran.fiche.oui' : 'console.ecran.fiche.non');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return jourCourt(v);
  if ((cle === 'offre' || cle === 'suivante_offre') && (v === 'essentiel' || v === 'complet')) return dire(`console.ecran.abo.offre.${v}`);
  if ((cle === 'periodicite' || cle === 'suivante_periodicite') && (v === 'annuel' || v === 'mensuel')) return dire(`console.ecran.abo.periodicite.${v}`);
  if (cle === 'role' && typeof v === 'string') return titre(`console.ecran.role.${v}`);
  if (cle === 'montant_ht' && typeof v === 'string') return montant(v);
  if (cle === 'modules' || cle === 'modules_a_retirer') return nomsModules(v) || '—';
  // Un montant reçu (0113) : des millimes, en texte.
  if (cle === 'montant' && typeof v === 'string' && /^\d+$/.test(v)) return montant(`${v.slice(0, -3) || '0'}.${v.slice(-3).padStart(3, '0')}`);
  if (cle === 'moyen' && (v === 'virement' || v === 'cheque' || v === 'especes')) return dire(`console.ecran.geste.recu.moyen.${v}`);
  if (cle === 'mois_offerts' && typeof v === 'number') return dire(v > 0 ? 'console.ecran.fiche.oui' : 'console.ecran.fiche.non');
  if (cle === 'priorite' && (v === 'normale' || v === 'urgente')) return dire(`console.ecran.support.priorite.${v}`);
  // L'attente de la technique se dit oui ou non (son instant est celui du geste) ; le prochain essai, son jour et son heure.
  if (cle === 'technique') return dire('console.ecran.fiche.oui');
  if (cle === 'prochain' && typeof v === 'string' && Number.isFinite(Date.parse(v))) return `${jourCourt(jourDe(v))} ${heureDe(v)}`;
  // La remise d'une facture préparée (0106) : laquelle, son taux, son montant.
  if (cle === 'remise' && v && typeof v === 'object') {
    const r = v as { nature?: unknown; taux?: unknown; montantHt?: unknown };
    if ((r.nature === 'groupe' || r.nature === 'cabinet') && typeof r.taux === 'number' && typeof r.montantHt === 'string') {
      return `${dire(`console.ecran.fiche.fa.remise.${r.nature}`, { taux: r.taux })} : ${montant(`-${r.montantHt}`)}`;
    }
  }
  return String(v);
}
// Les premiers événements (0082) écrivent leurs cases à la façon de l'API (« essaiJusquAu ») : on les lit comme celles
// d'une ligne (« essai_jusqu_au »).
const casesDe = (o: Record<string, unknown> | null) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`), v])) : null);
// `empile` (le journal, sa maquette) : chaque case sur ses lignes — son nom, la valeur d'avant barrée (s'il y en avait
// une), la nouvelle dessous ; jamais « — → … » pour une case qui était vide.
export function Changements({ avant: avantBrut, apres: apresBrut, empile }: { avant: Record<string, unknown> | null; apres: Record<string, unknown> | null; empile?: boolean }) {
  const avant = casesDe(avantBrut), apres = casesDe(apresBrut);
  const a = avant ?? {}, b = apres ?? {};
  // Une liste (les modules) se compare par son contenu ; une liste vide, à la création, ne se dit pas.
  const pareil = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const lignes = CASES.filter((c) => c in b && (avant === null ? b[c] !== null && b[c] !== false && !(Array.isArray(b[c]) && !(b[c] as unknown[]).length) : !pareil(a[c], b[c]))
    && !(c === 'actif' && b.actif === true && avant === null) && !(c === 'modules' && !(c in a) && Array.isArray(b[c]) && !(b[c] as unknown[]).length));
  if (!lignes.length) return null;
  if (empile) {
    return (
      <span className="c-changes c-changes-empile">
        {lignes.map((c) => (
          <span key={c} className="c-change">
            <span className="c-change-champ">{titre(`console.ecran.champ.${c}`)}</span>
            {avant !== null && a[c] !== null && a[c] !== undefined ? <del data-donnee>{valeurLisible(c, a[c])}</del> : null}
            <ins data-donnee>{valeurLisible(c, b[c])}</ins>
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="c-changes">
      {lignes.map((c) => (
        <span key={c} className="c-change">
          {titre(`console.ecran.champ.${c}`)} : {c in a && avant !== null ? <><del data-donnee>{valeurLisible(c, a[c])}</del> → </> : null}<ins data-donnee>{valeurLisible(c, b[c])}</ins>
        </span>
      ))}
    </span>
  );
}

// ── La fenêtre d'un geste ───────────────────────────────────────────────────────────────────────────────────────────
type Apercu = { avant: Etat; apres: Etat; details: Record<string, unknown>; modules?: ModuleAchete[]; modulesARetirer?: ModuleAchete[] };
// Un paiement reçu hors de la plateforme (0113) : son moyen.
type MoyenRecu = 'virement' | 'cheque' | 'especes';
const MOYENS_RECUS: readonly MoyenRecu[] = ['virement', 'cheque', 'especes'];
function FenetreGeste({ geste, fiche, role, fermer, fait }: { geste: Geste; fiche: Donnees; role: Role; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const support = role === 'support';
  const [jours, setJours] = useState(geste === 'accorder-delai' ? '7' : support ? '14' : '30');
  // Changer d'offre propose d'abord l'autre offre, au même rythme.
  const [offre, setOffre] = useState<Offre>(geste === 'changer-offre' ? (fiche.faits.offre === 'complet' ? 'essentiel' : 'complet') : fiche.faits.offre ?? 'essentiel');
  const [periodicite, setPeriodicite] = useState<Periodicite>(fiche.faits.periodicite ?? 'annuel');
  // Le module à ouvrir (un qui ne l'est pas encore, ou qui allait partir) ou à retirer (un qui l'est et ne part pas déjà).
  const achetes = fiche.ligne?.modules ?? [];
  const partent = fiche.ligne?.modules_a_retirer ?? [];
  const choixModules = geste === 'fermer-module' ? MODULES.filter((m) => achetes.includes(m) && !partent.includes(m))
    : MODULES.filter((m) => !achetes.includes(m) || partent.includes(m));
  const [module, setModule] = useState<ModuleAchete>(choixModules[0] ?? 'paie');
  // La preuve d'un paiement reçu hors de la plateforme (0113) : la facture faite ailleurs, le montant, le moyen, le jour.
  const [facture, setFacture] = useState('');
  const [recu, setRecu] = useState('');
  const [moyen, setMoyen] = useState<MoyenRecu>('virement');
  const [le, setLe] = useState(fiche.aujourdhui);
  const [motif, setMotif] = useState('');
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [perimee, setPerimee] = useState(false);
  const [occupe, setOccupe] = useState(false);
  // La case fautive (le motif, une case de la preuve d'un paiement) : elle se montre, rouge, et prend le curseur.
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const fauter = (champ: string) => setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 }));
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  // Un délai : de 1 à 60 jours (serveur/abonnement/gestes.ts, DELAI_MAX_JOURS).
  const min = support ? 7 : 1, max = geste === 'accorder-delai' ? 60 : support ? 30 : 365;
  const n = Number(jours);
  const avecJours = geste === 'prolonger' || geste === 'accorder-delai';
  const joursValides = !avecJours || (Number.isInteger(n) && n >= min && n <= max);
  const chemin = `/console/entreprises/${fiche.id}/abonnement/${geste}`;
  const corps = (apercuSeul: boolean) => ({
    motif, ligne: fiche.ligne, ...(apercuSeul ? { apercu: true } : {}),
    ...(avecJours ? { jours: n } : {}), ...(geste === 'payer' || geste === 'changer-offre' ? { offre, periodicite } : {}),
    ...(geste === 'ouvrir-module' || geste === 'fermer-module' ? { module } : {}),
    ...(geste === 'payer' && !apercuSeul ? { paiement: { facture, montant: recu, moyen, le } } : {}),
  });

  // L'aperçu se recalcule à chaque changement de paramètre : c'est le serveur qui le dit (la même règle que le geste).
  const tour = useRef(0);
  useEffect(() => {
    if (!joursValides) { setApercu(null); return; }
    const t = ++tour.current;
    const minuteur = setTimeout(() => {
      void (async () => {
        try {
          const r = await api<Apercu & { apercu: boolean }>('POST', chemin, corps(true));
          if (!r || t !== tour.current) return;
          if (r.statut === 200) { setApercu(r.corps); setRefus(null); } else { setApercu(null); setRefus(refusDe(r)); setPerimee(r.statut === 409); }
        } catch (x) { if (t === tour.current) setRefus(panneDe(x)); }
      })();
    }, 250);
    return () => clearTimeout(minuteur);
  }, [jours, offre, periodicite, module, geste]);

  const faire = () => {
    // Un paiement : le serveur relit sa preuve case par case, de haut en bas, puis le motif ; il dit la case fautive.
    if (geste !== 'payer' && motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); fauter('motif'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api<{ fait: boolean }>('POST', chemin, corps(false));
        if (!r) return;
        if (r.statut === 200) {
          // Un module qui part au renouvellement n'est pas retiré aujourd'hui, un retrait annulé n'est pas un achat : la
          // confirmation dit ce qui s'est passé.
          const d = apercu?.details ?? {};
          const nomModule = titre(`console.ecran.abo.module.${module}`);
          toast(geste === 'fermer-module' && typeof d.jusquAu === 'string' ? phrase('console.ecran.geste.fait_module_part', { module: nomModule, le: jourCourt(d.jusquAu) })
            : geste === 'ouvrir-module' && d.annuleRetrait === true ? phrase('console.ecran.geste.fait_retrait_annule', { module: nomModule })
              : phrase('console.ecran.geste.fait', { geste: dire(`console.ecran.journal.g.abonnement.${cleGeste(geste)}`) }));
          fait(); return;
        }
        setRefus(refusDe(r));
        setPerimee(r.statut === 409);
        if (typeof r.corps.champ === 'string') fauter(r.corps.champ);
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };

  // Le nom du menu qui l'a ouverte (« Réactiver » en lecture seule, « Prolonger la grâce » pendant la grâce).
  const nom = nomDuGeste(geste, fiche.etat);
  const sous = phrase(geste === 'prolonger' && support ? 'console.ecran.geste.sous.prolonger_support'
    : geste === 'offrir-mois' && support ? 'console.ecran.geste.sous.offrir_mois_support' : `console.ecran.geste.sous.${cleGeste(geste)}`);
  const cote = (etiquette: string, e: Etat) => {
    const p = puceDe(e);
    return (
      <div className="c-apercu-cote">
        <span>{etiquette}</span>
        <Puce ton={p.ton}>{p.texte}</Puce>
        <small>{expliquer(e, fiche.aujourdhui)}</small>
      </div>
    );
  };
  const details = apercu?.details ?? {};
  return (
    <Dialogue titre={nom} sous={sous} pour={pourQui(fiche)} fermer={fermer} occupe={occupe}
      pied={perimee
        ? <><Bouton ferme onClick={fermer}>{titre('console.ecran.annuler')}</Bouton><Bouton ton="principal" onClick={fait}>{titre('console.ecran.geste.relire')}</Bouton></>
        : <><Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton><Bouton ton="principal" occupe={occupe} desactive={!apercu} onClick={faire}>{nom}</Bouton></>}>
      {avecJours ? (
        <Champ libelle={titre('console.ecran.geste.jours')} aide={dire('console.ecran.geste.jours_aide', { min, max })} type="number" inputMode="numeric" autoComplete="off" min={min} max={max} valeur={jours} changer={setJours} />
      ) : null}
      {geste === 'payer' || geste === 'changer-offre' ? (
        <div className="c-champs-2">
          <Choix libelle={titre('console.ecran.geste.offre')} valeur={offre} changer={(v) => setOffre(v as Offre)}
            options={(['essentiel', 'complet'] as const).map((o) => ({ valeur: o, texte: dire(`console.ecran.abo.offre.${o}`) }))} />
          <Choix libelle={titre('console.ecran.geste.periodicite')} valeur={periodicite} changer={(v) => setPeriodicite(v as Periodicite)}
            options={(['annuel', 'mensuel'] as const).map((p) => ({ valeur: p, texte: titre(`console.ecran.abo.periodicite.${p}`) }))} />
        </div>
      ) : null}
      {geste === 'payer' ? (
        <>
          <div className="c-champs-2">
            <Champ libelle={titre('console.ecran.geste.recu.facture')} valeur={facture} changer={setFacture} autoComplete="off" {...fauteDe('facture')} />
            <Champ libelle={titre('console.ecran.geste.recu.montant')} aide={phrase('console.ecran.geste.recu.montant_aide')} inputMode="decimal" autoComplete="off" valeur={recu} changer={setRecu} {...fauteDe('montant')} />
          </div>
          <div className="c-champs-2">
            <Choix libelle={titre('console.ecran.geste.recu.moyen')} valeur={moyen} changer={(v) => setMoyen(v as MoyenRecu)}
              options={MOYENS_RECUS.map((m) => ({ valeur: m, texte: titre(`console.ecran.geste.recu.moyen.${m}`) }))} />
            <Champ libelle={titre('console.ecran.geste.recu.le')} type="date" max={fiche.aujourdhui} valeur={le} changer={setLe} {...fauteDe('le')} />
          </div>
        </>
      ) : null}
      {geste === 'ouvrir-module' || geste === 'fermer-module' ? (
        <Choix libelle={titre('console.ecran.geste.module')} aide={geste === 'ouvrir-module' ? phrase('console.ecran.geste.module_aide') : undefined} valeur={module}
          changer={(v) => setModule(v as ModuleAchete)} options={choixModules.map((m) => ({ valeur: m, texte: titre(`console.ecran.abo.module.${m}`) }))} />
      ) : null}
      <div className="c-champs">
        <span className="c-champ-libelle">{titre('console.ecran.geste.apercu')}</span>
        {/* L'aperçu garde sa place quoi qu'il dise (le calcul, un refus, des jours hors des bornes) : le motif, dessous,
            ne bouge pas pendant qu'on tape le nombre de jours, et le clic suivant tombe là où on le vise. */}
        <div className="c-apercu-zone">
        {!joursValides ? (
          <p className="c-apercu-attente c-apercu-refus">{phrase(support ? 'console.ecran.geste.jours_hors_support' : 'console.ecran.geste.jours_hors', { min, max })}</p>
        ) : apercu ? (
          <div className="c-apercu">
            {/* Un geste qui ne change rien aujourd'hui (un mois offert, un module, une offre à l'échéance) : une colonne, pas
                deux pareilles ; ce qu'il fait se dit dessous. */}
            {JSON.stringify(apercu.avant) === JSON.stringify(apercu.apres) ? cote(titre('console.ecran.geste.inchange'), apercu.avant) : <>
              {cote(titre('console.ecran.geste.avant'), apercu.avant)}
              <span className="c-fleche"><Icone nom="fleche" /></span>
              {cote(titre('console.ecran.geste.apres'), apercu.apres)}
            </>}
            {typeof details.debut === 'string' && typeof details.fin === 'string'
              ? <span className="c-apercu-details">{phrase(details.moisOffert === true ? 'console.ecran.geste.periode_offert' : 'console.ecran.geste.periode', { debut: jourCourt(details.debut), fin: jourCourt(details.fin) })}</span> : null}
            {/* Un mois offert ne change rien aujourd'hui : l'état d'après est celui d'avant ; ce qu'il fait se dit dessous. */}
            {geste === 'offrir-mois' && typeof details.du === 'string' && typeof details.au === 'string'
              ? <span className="c-apercu-details">{phrase('console.ecran.geste.mois_sur_facture', { du: jourCourt(details.du), au: jourCourt(details.au) })}</span> : null}
            {typeof details.jours === 'number' && geste === 'prolonger' ? <span className="c-apercu-details">{phrase('console.ecran.geste.ajoute', { n: details.jours })}</span> : null}
            {/* Un délai : la colonne « après le geste » dit déjà la nouvelle date ; une offre qui change à l'échéance, non
                (l'état ne change pas aujourd'hui) : elle se dit dessous. */}
            {geste === 'changer-offre' && typeof details.aPartirDu === 'string' ? <span className="c-apercu-details">{phrase('console.ecran.geste.offre_des', {
              offre: offreEtPeriode(offre, periodicite), le: jourCourt(details.aPartirDu) })}</span> : null}
            {/* Un module (0113) : un retrait prévu annulé, un module qui part au renouvellement, un achat que la prochaine
                facture rattrape ; sinon, la liste des modules d'après. */}
            {(geste === 'ouvrir-module' || geste === 'fermer-module') && apercu.modules ? (
              <span className="c-apercu-details">{details.annuleRetrait === true ? phrase('console.ecran.geste.module_retrait_annule', { module: titre(`console.ecran.abo.module.${module}`) })
                : typeof details.jusquAu === 'string' && typeof details.auRenouvellement === 'string' ? phrase('console.ecran.geste.module_jusqu', { module: titre(`console.ecran.abo.module.${module}`), le: jourCourt(details.jusquAu) })
                  : geste === 'ouvrir-module' && apercu.avant.etat === 'actif' ? phrase('console.ecran.geste.module_rattrape', { module: titre(`console.ecran.abo.module.${module}`) })
                    : phrase('console.ecran.geste.modules_apres', { modules: nomsModules(apercu.modules) || dire('console.ecran.geste.aucun_module') })}</span>
            ) : null}
          </div>
        ) : refus ? <p className="c-apercu-attente c-apercu-refus">{refus}</p>
          : <p className="c-apercu-attente">{phrase('console.ecran.geste.apercu_calcul')}</p>}
        </div>
      </div>
      {/* Le refus du geste (le motif trop court) reste jusqu'au clic suivant : retiré à la frappe, il ferait remonter les
          boutons sous le curseur au moment où l'on vise « Valider ». Le clic suivant le remplace ou referme la fenêtre. */}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.geste.motif_aide')} valeur={motif} changer={setMotif} {...fauteDe('motif')} />
      {refus && apercu ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Préparer la facture d'une période (docs/abonnement.md B2) ───────────────────────────────────────────────────────
// L'offre et la périodicité, puis ce que la facture dira (le serveur le calcule par le moteur de l'entreprise SkanFact,
// sans rien écrire), puis le geste, avec son motif. Le brouillon naît dans le dossier de l'entreprise SkanFact ; il
// s'émet dans son application.
type FactureApercu = {
  editeur: string; offre: Offre; periodicite: Periodicite; debut: string; fin: string; echeance: string; montantHt: string;
  ceQueDira: { ht: string; tva: string; timbre: string; ttc: string; net: string };
  // L'offre au prix du jour, et ce qui s'ajoute (14c) : un module acheté seul, ou ce qui dépasse l'offre.
  prixOffreHt: string; enPlus: { option: string; quantite: number; compte: number; inclus: number; prixHt: string; totalHt: string; du?: string; au?: string }[];
  // La remise de la période (0106), sur tout le hors taxes, et son montant.
  brutHt: string; remise: (Remise & { montantHt: string }) | null;
  // Le mois offert qu'elle porte (0113) : sa période en couvre un de plus.
  moisOffert?: boolean;
};
function FenetreFacture({ fiche, fermer, fait }: { fiche: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [offre, setOffre] = useState<Offre>(fiche.faits.offre ?? 'complet');
  const [periodicite, setPeriodicite] = useState<Periodicite>(fiche.faits.periodicite ?? 'annuel');
  const [motif, setMotif] = useState('');
  const [apercu, setApercu] = useState<FactureApercu | null>(null);
  // Le prix d'aujourd'hui, quand la période commence après un nouveau prix (0103) : l'aperçu dit pourquoi le montant change.
  const [aujourdhui, setAujourdhui] = useState<string | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [faute, setFaute] = useState(0);
  const chemin = `/console/entreprises/${fiche.id}/factures`;
  const editeur = fiche.factures.editeur?.raisonSociale ?? '—';
  const tour = useRef(0);
  useEffect(() => {
    const t = ++tour.current;
    const minuteur = setTimeout(() => {
      void (async () => {
        try {
          const r = await api<{ facture: FactureApercu; prixAujourdhuiHt: string | null }>('POST', chemin, { offre, periodicite, motif: '', apercu: true });
          if (!r || t !== tour.current) return;
          if (r.statut === 200) { setApercu(r.corps.facture); setAujourdhui(r.corps.prixAujourdhuiHt); setRefus(null); } else { setApercu(null); setRefus(refusDe(r)); }
        } catch (x) { if (t === tour.current) setRefus(panneDe(x)); }
      })();
    }, 250);
    return () => clearTimeout(minuteur);
  }, [offre, periodicite]);
  const faire = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', chemin, { offre, periodicite, motif: motif.trim() });
        if (!r) return;
        if (r.statut === 201) { toast(phrase('console.ecran.fiche.fa.fait', { editeur })); fait(); return; }
        setRefus(refusDe(r));
        if (r.corps.champ === 'motif') setFaute((x) => x + 1);
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const c = apercu?.ceQueDira;
  return (
    <Dialogue titre={titre('console.ecran.fiche.fa.titre')} sous={phrase('console.ecran.fiche.fa.sous', { editeur })} fermer={fermer} occupe={occupe}
      pied={<><Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} desactive={!apercu} onClick={faire}>{titre('console.ecran.fiche.fa.bouton')}</Bouton></>}>
      <div className="c-champs-2">
        <Choix libelle={titre('console.ecran.geste.offre')} valeur={offre} changer={(v) => setOffre(v as Offre)}
          options={(['essentiel', 'complet'] as const).map((o) => ({ valeur: o, texte: dire(`console.ecran.abo.offre.${o}`) }))} />
        <Choix libelle={titre('console.ecran.geste.periodicite')} valeur={periodicite} changer={(v) => setPeriodicite(v as Periodicite)}
          options={(['annuel', 'mensuel'] as const).map((p) => ({ valeur: p, texte: titre(`console.ecran.abo.periodicite.${p}`) }))} />
      </div>
      <div className="c-champs">
        <span className="c-champ-libelle">{titre('console.ecran.fiche.fa.dira')}</span>
        {/* L'aperçu garde sa place quoi qu'il dise (le calcul, un refus) : le motif, dessous, ne bouge pas. */}
        <div className="c-apercu-zone">
          {apercu && c ? (
            <div className="c-fa-apercu">
              <p>{phrase(apercu.moisOffert ? 'console.ecran.fiche.fa.periode_offert' : 'console.ecran.fiche.fa.periode', { debut: jourCourt(apercu.debut), fin: jourCourt(apercu.fin), avant: jourCourt(apercu.echeance) })}</p>
              {aujourdhui ? <p className="c-sous">{phrase('console.ecran.fiche.fa.nouveau_prix', { jour: jourCourt(apercu.debut), prix: montant(aujourdhui) })}</p> : null}
              {/* Ses lignes, hors taxes : l'offre, puis ce qui s'ajoute (14c), chacune avec sa quantité et ce qui l'explique. */}
              <ul className="c-fa-lignes">
                <li><span>{offreEtPeriode(apercu.offre, apercu.periodicite)}</span><span data-donnee>{montant(apercu.prixOffreHt)}</span></li>
                {apercu.enPlus.map((l) => (
                  <li key={l.option}>
                    <span>{titre(`console.ecran.fiche.fa.option.${l.option}`)}{l.du && l.au ? <small>{phrase('console.ecran.fiche.fa.rattrapage', { jours: l.compte, sur: l.inclus, du: jourCourt(l.du), au: jourCourt(l.au) })}</small>
                      : l.option.startsWith('module_') ? null
                        : <small>{phrase('console.ecran.fiche.fa.au_dela', { compte: l.compte, inclus: l.inclus, n: l.quantite, prix: montant(l.prixHt) })}</small>}</span>
                    <span data-donnee>{montant(l.totalHt)}</span>
                  </li>
                ))}
                {/* La remise de la période (0106) : laquelle, pourquoi, et son montant, sur tout ce qui précède. */}
                {apercu.remise ? (
                  <li className="c-fa-remise">
                    <span>{titre(`console.ecran.fiche.fa.remise.${apercu.remise.nature}`, { taux: apercu.remise.taux })}<small>{pourquoiRemise(apercu.remise)}</small></span>
                    <span data-donnee>{montant(`-${apercu.remise.montantHt}`)}</span>
                  </li>
                ) : null}
              </ul>
              <dl className="c-fa-montants">
                <div><dt>{titre('console.ecran.fiche.fa.ht')}</dt><dd data-donnee>{montant(c.ht)}</dd></div>
                <div><dt>{titre('console.ecran.fiche.fa.tva')}</dt><dd data-donnee>{montant(c.tva)}</dd></div>
                <div><dt>{titre('console.ecran.fiche.fa.timbre')}</dt><dd data-donnee>{montant(c.timbre)}</dd></div>
                <div className="c-fa-net"><dt>{titre('console.ecran.fiche.fa.net')}</dt><dd data-donnee>{montant(c.net)}</dd></div>
              </dl>
            </div>
          ) : refus && !apercu ? <p className="c-apercu-attente c-apercu-refus">{refus}</p>
            : <p className="c-apercu-attente">{phrase('console.ecran.geste.apercu_calcul')}</p>}
        </div>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.fiche.fa.motif_aide')} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      {refus && apercu ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// Ses factures SkanFact : chacune, son état, ce qu'elle doit encore, et l'endroit où elle s'émet et se règle.
// La facture qui attend encore un geste (l'émettre, l'encaisser) : tant qu'elle existe, en préparer une autre serait
// refusé (la même période), et l'étape suivante est la sienne.
const factureOuverte = (lignes: Donnees['factures']['lignes']) =>
  lignes.find((x) => x.etat === 'a_emettre' || x.etat === 'a_payer' || x.etat === 'partielle' || x.etat === 'en_retard');

function SesFactures({ f, role, preparer }: { f: Donnees; role: Role; preparer: () => void }) {
  const ed = f.factures.editeur;
  const peut = role === 'direction' && !!ed?.proprietaire && !f.faits.tenuParCabinet && !factureOuverte(f.factures.lignes);
  const note = f.faits.tenuParCabinet ? phrase('console.ecran.fiche.fa.cabinet')
    : !ed ? phrase('console.ecran.fiche.fa.sans_editeur')
      : role !== 'direction' ? phrase('console.ecran.fiche.fa.direction')
        : !ed.proprietaire ? phrase('console.ecran.fiche.fa.pas_proprietaire', { editeur: ed.raisonSociale }) : null;
  return (
    <section className="c-carte c-liste-carte c-fiche-factures" aria-labelledby="fiche-factures">
      <div className="c-carte-tete">
        <div>
          <h2 id="fiche-factures">{titre('console.ecran.fiche.fa.liste')}</h2>
          <p className="c-carte-sous">{ed ? phrase('console.ecran.fiche.fa.liste_sous', { editeur: ed.raisonSociale }) : phrase('console.ecran.fiche.fa.liste_sous_sans')}</p>
        </div>
        {peut ? <Bouton petit icone="plus" onClick={preparer}>{titre('console.ecran.fiche.fa.preparer')}</Bouton> : null}
      </div>
      {note ? <p className="c-sous c-fa-note">{note}{!ed && role === 'direction' ? <> <a href="#/reglages">{titre('console.ecran.fiche.fa.vers_reglages')}</a></> : null}</p> : null}
      {f.factures.lignes.length ? (
        <div className="c-defile">
          <table className="c-table c-fa-table">
            <thead><tr>
              <th scope="col">{titre('console.ecran.fiche.fa.col.facture')}</th>
              <th scope="col">{titre('console.ecran.fiche.fa.col.periode')}</th>
              <th scope="col" className="c-droite">{titre('console.ecran.fiche.fa.col.net')}</th>
              <th scope="col" className="c-droite">{titre('console.ecran.fiche.fa.col.reste')}</th>
              <th scope="col">{titre('console.ecran.fiche.fa.col.etat')}</th>
              <th scope="col"><span className="c-cache">{titre('console.ecran.fiche.fa.col.ouvrir')}</span></th>
            </tr></thead>
            <tbody>
              {f.factures.lignes.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.numero ? <b className="c-mono" data-donnee>{x.numero}</b> : <b>{titre('console.ecran.fiche.fa.brouillon')}</b>}
                    <span className="c-sous c-bloc">{offreEtPeriode(x.offre, x.periodicite)} · {dire('console.ecran.fiche.fa.ht_de', { montant: montant(x.montantHt) })}</span>
                  </td>
                  <td data-libelle={titre('console.ecran.fiche.fa.col.periode')}>{dire('console.ecran.fiche.fa.du_au', { debut: jourCourt(x.debut), fin: jourCourt(x.fin) })}
                    {x.echeance && (x.etat === 'a_emettre' || x.etat === 'a_payer' || x.etat === 'partielle' || x.etat === 'en_retard') ? <span className="c-sous c-bloc">{dire('console.ecran.fiche.fa.avant_le', { jour: jourCourt(x.echeance) })}</span> : null}</td>
                  <td className="c-droite" data-libelle={titre('console.ecran.fiche.fa.col.net')}>{x.net ? <span data-donnee>{montant(x.net)}</span> : '—'}</td>
                  <td className="c-droite" data-libelle={titre('console.ecran.fiche.fa.col.reste')}>{x.reste ? <span data-donnee>{montant(x.reste)}</span> : '—'}</td>
                  <td data-libelle={titre('console.ecran.fiche.fa.col.etat')}><Puce ton={PUCE_FACTURE[x.etat]}>{titre(`console.ecran.fiche.fa.etat.${x.etat}`)}</Puce>
                    {x.payeeLe ? <span className="c-sous c-bloc">{dire('console.ecran.fiche.fa.payee_le', { quand: quand(x.payeeLe, f.aujourdhui) })}</span> : null}</td>
                  <td className="c-droite">{x.etat !== 'supprimee' && ed?.proprietaire
                    ? <Lien petit ailleurs href={x.ecran}>{titre(x.etat === 'a_emettre' ? 'console.ecran.fiche.fa.emettre' : 'console.ecran.fiche.fa.ouvrir')}</Lien> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Vide icone="info">{phrase('console.ecran.fiche.fa.aucune')}</Vide>}
    </section>
  );
}

// ── Son groupe et sa remise (docs/abonnement.md C17 ; 0106) ─────────────────────────────────────────────────────────
// La remise de sa prochaine période et pourquoi (la plus forte des deux, jamais leur somme), puis son groupe : les
// sociétés dans l'ordre de leur première période payée, la première au prix normal. La direction crée un groupe, y met
// une société ou l'en retire, chaque fois avec son motif et l'aperçu de qui paiera quoi.
const pourquoiRemise = (r: RemiseSeule) => (r.nature === 'groupe'
  ? phrase('console.ecran.fiche.gr.pourquoi.groupe', { groupe: r.groupe ?? '—', premiere: r.premiere ?? '—' })
  : phrase('console.ecran.fiche.gr.pourquoi.cabinet', { cabinet: r.cabinet ?? '—', jour: jourCourt(r.jusquAu) }));
// Qui a la remise de groupe dans une liste rangée (la première abonnée d'abord) : toutes sauf la première, dès qu'une
// société du groupe a payé ; tant qu'aucune n'a payé, chacune paierait le prix normal.
const aLaRemise = (membres: MembreGroupe[], i: number, taux: number) => taux > 0 && i > 0 && membres[0]?.premierePeriode != null;

function MembresDuGroupe({ membres, taux, ici, liens }: { membres: MembreGroupe[]; taux: number; ici: string; liens: boolean }) {
  return (
    <ul className="c-gr-membres">
      {membres.map((m, i) => (
        <li key={m.entreprise}>
          <span className="c-gr-membre">
            {m.entreprise === ici || !liens ? <b data-donnee>{m.raisonSociale}</b> : <a href={`#/clients/${m.entreprise}?onglet=abonnement`} data-donnee>{m.raisonSociale}</a>}
            {m.entreprise === ici ? <span className="c-gr-ici">{dire('console.ecran.fiche.gr.cette_fiche')}</span> : null}
            <small>{m.premierePeriode ? titre('console.ecran.fiche.gr.abonnee', { jour: jourCourt(m.premierePeriode) }) : titre('console.ecran.fiche.gr.pas_abonnee')}</small>
          </span>
          {aLaRemise(membres, i, taux) ? <Puce ton="actif">{dire('console.ecran.fiche.gr.moins', { taux })}</Puce> : <Puce ton="hors">{dire('console.ecran.fiche.gr.prix_normal')}</Puce>}
        </li>
      ))}
    </ul>
  );
}

type GesteGroupe = { sorte: 'creer' } | { sorte: 'entrer'; entreprise: { id: string; nom: string }; groupe: { id: string; nom: string } | null } | { sorte: 'sortir' };

function GroupeEtRemise({ f, role, faire }: { f: Donnees; role: Role; faire: (g: GesteGroupe) => void }) {
  const g = f.groupe;
  const r = g.remise;
  const direction = role === 'direction';
  const membres = g.groupe?.membres ?? [];
  const premiere = membres[0]?.entreprise === f.id && membres[0]?.premierePeriode != null;
  const dans = g.groupe ? { id: g.groupe.id, nom: g.groupe.nom } : null;
  // Les sociétés proposées sont celles de sa propriétaire : la carte la nomme.
  const proprietaire = f.membres.find((m) => m.roles.includes('proprietaire'))?.nom ?? null;
  // Sans remise : pourquoi, en une phrase (la première du groupe, un taux à 0 dans les Réglages, ni groupe ni cabinet).
  const sansRemise = g.groupe && g.tauxGroupe === 0 ? phrase('console.ecran.fiche.gr.taux_zero')
    : g.groupe && premiere ? phrase('console.ecran.fiche.gr.sans_remise_premiere')
      : g.groupe ? phrase('console.ecran.fiche.gr.personne')
        : phrase('console.ecran.fiche.gr.sans_remise_pourquoi');
  return (
    <section className="c-carte c-fiche-groupe" aria-labelledby="fiche-groupe">
      <div className="c-carte-tete">
        <div>
          <h2 id="fiche-groupe">{titre('console.ecran.fiche.gr.titre')}</h2>
          <p className="c-carte-sous">{phrase('console.ecran.fiche.gr.sous', { jour: jourCourt(g.prochaine) })}</p>
        </div>
        {direction ? (
          <div className="c-gr-actions">
            {g.groupe ? <Bouton petit onClick={() => faire({ sorte: 'sortir' })}>{titre('console.ecran.fiche.gr.sortir')}</Bouton> : <>
              {g.groupes.length ? <Bouton petit onClick={() => faire({ sorte: 'entrer', entreprise: { id: f.id, nom: f.raisonSociale }, groupe: null })}>{titre('console.ecran.fiche.gr.rejoindre')}</Bouton> : null}
              <Bouton petit icone="plus" onClick={() => faire({ sorte: 'creer' })}>{titre('console.ecran.fiche.gr.creer')}</Bouton>
            </>}
          </div>
        ) : null}
      </div>
      <div className={`c-gr-remise${r ? ' c-gr-remise-oui' : ''}`}>
        <b>{r ? dire('console.ecran.fiche.gr.remise', { taux: r.taux }) : titre('console.ecran.fiche.gr.sans_remise')}</b>
        <span>{r ? pourquoiRemise(r) : sansRemise}</span>
        {r?.aussi ? <span className="c-gr-aussi">{phrase('console.ecran.fiche.gr.aussi', { nature: dire(`console.ecran.fiche.gr.nature.${r.aussi.nature}`), taux: r.aussi.taux })}</span> : null}
      </div>
      {g.groupe ? (
        <div className="c-gr-groupe">
          <p className="c-gr-nom"><b data-donnee>{titre('console.ecran.fiche.gr.dans', { nom: g.groupe.nom })}</b>
            <span>{dire('console.ecran.fiche.gr.depuis', { jour: jourCourt(g.groupe.depuis) })} · <span data-donnee>{g.groupe.motif}</span></span></p>
          <MembresDuGroupe membres={membres} taux={g.tauxGroupe} ici={f.id} liens />
        </div>
      ) : r ? <p className="c-sous c-gr-aucun">{phrase('console.ecran.fiche.gr.aucun')}</p> : null}
      {g.voisines.length ? (
        <div className="c-gr-voisines">
          <span className="c-sous">{proprietaire ? titre(g.groupe ? 'console.ecran.fiche.gr.voisines_hors' : 'console.ecran.fiche.gr.voisines', { nom: proprietaire })
            : titre(g.groupe ? 'console.ecran.fiche.gr.voisines_hors_sans' : 'console.ecran.fiche.gr.voisines_sans')}</span>
          <ul>
            {g.voisines.map((v) => (
              <li key={v.entreprise}>
                <a href={`#/clients/${v.entreprise}?onglet=abonnement`} data-donnee>{v.raisonSociale}</a>
                {direction && dans ? <Bouton petit onClick={() => faire({ sorte: 'entrer', entreprise: { id: v.entreprise, nom: v.raisonSociale }, groupe: dans })}>
                  {titre('console.ecran.fiche.gr.ajouter')}</Bouton> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!direction ? <p className="c-sous c-gr-note">{phrase('console.ecran.fiche.gr.direction')}</p> : null}
    </section>
  );
}

type ApercuGroupe = { taux: number; membres: MembreGroupe[] };
type Trouvee = { id: string; raisonSociale: string };
function FenetreGroupe({ fiche, geste, fermer, fait }: { fiche: Donnees; geste: GesteGroupe; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const g = fiche.groupe;
  const [nom, setNom] = useState('');
  // Les sociétés de la même propriétaire sont proposées, cochées : c'est le cas courant ; une autre se cherche.
  const [cochees, setCochees] = useState<string[]>(() => g.voisines.map((v) => v.entreprise));
  const [autres, setAutres] = useState<Trouvee[]>([]);
  const [cherche, setCherche] = useState('');
  const [trouvees, setTrouvees] = useState<Trouvee[] | null>(null);
  const [groupe, setGroupe] = useState(geste.sorte === 'entrer' ? geste.groupe?.id ?? g.groupes[0]?.id ?? '' : '');
  const [motif, setMotif] = useState('');
  const [apercu, setApercu] = useState<ApercuGroupe | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [champ, setChamp] = useState<{ nom: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const entrent = geste.sorte === 'creer' ? [fiche.id, ...cochees] : geste.sorte === 'entrer' ? [geste.entreprise.id] : [];
  const cle = JSON.stringify([groupe, entrent]);
  const tour = useRef(0);
  useEffect(() => {
    const t = ++tour.current;
    const minuteur = setTimeout(() => {
      void (async () => {
        try {
          const corps = geste.sorte === 'creer' ? { groupe: null, entrent, sort: null }
            : geste.sorte === 'entrer' ? { groupe: groupe || null, entrent, sort: null } : { groupe: g.groupe?.id ?? null, entrent: [], sort: fiche.id };
          if (geste.sorte === 'entrer' && !groupe) { setApercu(null); return; }
          const r = await api<ApercuGroupe>('POST', '/console/groupes/apercu', corps);
          if (!r || t !== tour.current) return;
          if (r.statut === 200) { setApercu(r.corps); setRefus(null); } else { setApercu(null); setRefus(refusDe(r)); }
        } catch (x) { if (t === tour.current) setRefus(panneDe(x)); }
      })();
    }, 250);
    return () => clearTimeout(minuteur);
  }, [cle]);
  // Chercher une autre société : par la liste des clients (son nom, son matricule, son propriétaire).
  useEffect(() => {
    if (geste.sorte !== 'creer' || cherche.trim().length < 2) { setTrouvees(null); return; }
    let vivant = true;
    const minuteur = setTimeout(() => {
      void (async () => {
        try {
          const r = await api<{ lignes: Trouvee[] }>('GET', `/console/entreprises?q=${encodeURIComponent(cherche.trim())}&limite=6`);
          if (r && vivant && r.statut === 200) setTrouvees(r.corps.lignes.map((l) => ({ id: l.id, raisonSociale: l.raisonSociale })));
        } catch { /* la recherche se retente à la frappe suivante */ }
      })();
    }, 250);
    return () => { vivant = false; clearTimeout(minuteur); };
  }, [cherche]);
  const refuser = (texte: string, nomChamp: string) => { setRefus(texte); setChamp((c) => ({ nom: nomChamp, n: (c?.n ?? 0) + 1 })); };
  const envoyer = () => {
    if (geste.sorte === 'creer' && nom.trim().length < 2) { refuser(phrase('console.ecran.fiche.gr.f.nom_court'), 'nom'); return; }
    if (geste.sorte === 'creer' && entrent.length < 2) { refuser(phrase('console.ecran.fiche.gr.f.deux'), 'societes'); return; }
    if (geste.sorte === 'entrer' && !groupe) { refuser(phrase('console.ecran.fiche.gr.f.choisir_groupe'), 'groupe'); return; }
    if (motif.trim().length < 3) { refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    const [chemin, corps, dit] = geste.sorte === 'creer'
      ? ['/console/groupes', { nom: nom.trim(), entreprises: entrent, motif: motif.trim() }, phrase('console.ecran.fiche.gr.f.fait_creer', { nom: nom.trim(), n: entrent.length })]
      : geste.sorte === 'entrer'
        ? [`/console/entreprises/${geste.entreprise.id}/groupe`, { groupe, motif: motif.trim() },
          phrase('console.ecran.fiche.gr.f.fait_entrer', { nom: geste.entreprise.nom, groupe: g.groupes.find((x) => x.id === groupe)?.nom ?? geste.groupe?.nom ?? '' })]
        : [`/console/entreprises/${fiche.id}/groupe/sortir`, { motif: motif.trim() }, phrase('console.ecran.fiche.gr.f.fait_sortir', { nom: fiche.raisonSociale, groupe: g.groupe?.nom ?? '' })];
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', chemin, corps);
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(dit); fait(); return; }
        setRefus(refusDe(r));
        if (typeof r.corps.champ === 'string') setChamp((c) => ({ nom: r.corps.champ as string, n: (c?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const faute = (n: string) => champ?.nom === n;
  const cocher = (id: string, oui: boolean) => setCochees((c) => (oui ? [...c, id] : c.filter((x) => x !== id)));
  const proposees = [...g.voisines.map((v) => ({ id: v.entreprise, raisonSociale: v.raisonSociale, voisine: true })), ...autres.map((a) => ({ ...a, voisine: false }))];
  const dejaLa = new Set([fiche.id, ...proposees.map((p) => p.id)]);
  const titreF = geste.sorte === 'creer' ? titre('console.ecran.fiche.gr.f.titre_creer')
    : geste.sorte === 'sortir' ? titre('console.ecran.fiche.gr.f.titre_sortir')
      : titre(geste.groupe ? 'console.ecran.fiche.gr.f.titre_ajouter' : 'console.ecran.fiche.gr.f.titre_entrer', { nom: geste.entreprise.nom });
  const sous = geste.sorte === 'creer' ? phrase('console.ecran.fiche.gr.f.sous_creer')
    : geste.sorte === 'sortir' ? phrase('console.ecran.fiche.gr.f.sous_sortir', { nom: fiche.raisonSociale, groupe: g.groupe?.nom ?? '' })
      : phrase('console.ecran.fiche.gr.f.sous_entrer', { nom: geste.entreprise.nom });
  const ici = geste.sorte === 'entrer' ? geste.entreprise.id : fiche.id;
  const seule = geste.sorte === 'sortir' && apercu?.membres.length === 1 ? apercu.membres[0] : null;
  return (
    <Dialogue titre={titreF} sous={sous} fermer={fermer} occupe={occupe}
      pied={<><Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`console.ecran.fiche.gr.f.bouton.${geste.sorte}`)}</Bouton></>}>
      {geste.sorte === 'creer' ? <>
        <Champ libelle={titre('console.ecran.fiche.gr.f.nom')} aide={phrase('console.ecran.fiche.gr.f.nom_aide')} valeur={nom} changer={setNom} faute={faute('nom')} n={champ?.n ?? 0} premier />
        <div className="c-gr-societes">
          <span className="c-champ-libelle" id="gr-societes">{titre('console.ecran.fiche.gr.f.societes')}</span>
          <ul className="c-gr-cases" aria-labelledby="gr-societes">
            <li><label className="c-in-case"><input type="checkbox" checked disabled /><span><b data-donnee>{fiche.raisonSociale}</b> <small>{dire('console.ecran.fiche.gr.cette_fiche')}</small></span></label></li>
            {proposees.map((p) => (
              <li key={p.id}><label className="c-in-case"><input type="checkbox" checked={cochees.includes(p.id)} onChange={(x) => cocher(p.id, x.target.checked)} />
                <span><span data-donnee>{p.raisonSociale}</span>{p.voisine ? <> <small>{dire('console.ecran.fiche.gr.f.meme_proprietaire')}</small></> : null}</span></label></li>
            ))}
          </ul>
        </div>
        <div className="c-gr-chercher">
          <Champ libelle={titre('console.ecran.fiche.gr.f.chercher')} aide={phrase('console.ecran.fiche.gr.f.chercher_aide')} valeur={cherche} changer={setCherche} />
          {trouvees ? (
            trouvees.filter((t) => !dejaLa.has(t.id)).length ? (
              <ul className="c-gr-trouvees">
                {trouvees.filter((t) => !dejaLa.has(t.id)).map((t) => (
                  <li key={t.id}><span data-donnee>{t.raisonSociale}</span>
                    <Bouton petit icone="plus" onClick={() => { setAutres((a) => [...a, t]); cocher(t.id, true); setCherche(''); }}>{titre('console.ecran.fiche.gr.f.ajouter')}</Bouton></li>
                ))}
              </ul>
            ) : <p className="c-sous">{phrase('console.ecran.fiche.gr.f.aucune_trouvee')}</p>
          ) : null}
        </div>
      </> : null}
      {geste.sorte === 'entrer' && !geste.groupe ? (
        <Choix libelle={titre('console.ecran.fiche.gr.f.groupe')} valeur={groupe} changer={setGroupe}
          options={g.groupes.map((x) => ({ valeur: x.id, texte: dire('console.ecran.fiche.gr.f.groupe_option', { nom: x.nom, n: x.membres }), donnee: true }))} />
      ) : null}
      <div className="c-champs">
        <span className="c-champ-libelle">{titre('console.ecran.fiche.gr.f.apres')}</span>
        <div className="c-apercu-zone c-gr-apercu-zone">
          {apercu ? (
            <div className="c-gr-apercu">
              {apercu.membres.length ? <MembresDuGroupe membres={apercu.membres} taux={apercu.taux} ici={ici} liens={false} /> : null}
              {geste.sorte === 'sortir' ? <p className="c-sous">{phrase('console.ecran.fiche.gr.f.sortie_dit', { nom: fiche.raisonSociale, jour: jourCourt(g.prochaine) })}</p> : null}
              {seule ? <p className="c-sous">{phrase('console.ecran.fiche.gr.f.seule', { nom: seule.raisonSociale })}</p> : null}
            </div>
          ) : refus && !apercu ? <p className="c-apercu-attente c-apercu-refus">{refus}</p>
            : <p className="c-apercu-attente">{phrase('console.ecran.geste.apercu_calcul')}</p>}
        </div>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.fiche.gr.f.motif_aide')} valeur={motif} changer={setMotif} faute={faute('motif')} n={champ?.n ?? 0} />
      {refus && apercu ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// Le client d'une fenêtre : son nom et son numéro (« Librairie Al Kitab · E-0005 »).
export const pourQui = (f: Pick<Donnees, 'raisonSociale' | 'identite'>) => [f.raisonSociale, f.identite?.numero].filter(Boolean).join('\u00a0· ');

// ── Le menu des gestes ──────────────────────────────────────────────────────────────────────────────────────────────
// Le nom d'un geste dans un menu, le même sur la fiche et sur la liste (la maquette) : un délai se dit « Prolonger la
// grâce… » pendant la grâce, « Réactiver… » en lecture seule ; chaque nom finit par « … » (il ouvre sa fenêtre).
export const DETRUIT: ReadonlySet<Geste> = new Set<Geste>(['suspendre', 'resilier', 'retirer-offert']);
const ORDRE_DU_MENU: readonly Geste[] = ['payer', 'prolonger', 'accorder-delai', 'reprendre', 'offrir-mois', 'changer-offre', 'annuler-resiliation',
  'ouvrir-module', 'fermer-module', 'offrir', 'suspendre', 'resilier', 'retirer-offert'];
export const nomDuGeste = (g: Geste, etat: Etat) => titre(`console.ecran.geste.${cleGeste(g)}${g === 'accorder-delai' && etat.etat === 'lecture_seule' ? '_lecture' : ''}`);
export const libelleDuGeste = (g: Geste, etat: Etat) => `${nomDuGeste(g, etat)}…`;
// `reserve` : ce que ce rôle ne fait pas ici, sous le dernier choix (comme le menu d'une ligne de la liste).
function MenuGestes({ gestes, etat, choisir, raison, reserve }: { gestes: Geste[]; etat: Etat; choisir: (g: Geste) => void; raison: string | null; reserve: string | null }) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const ailleurs = (e: MouseEvent) => { if (!zone.current?.contains(e.target as Node)) setOuvert(false); };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOuvert(false); zone.current?.querySelector<HTMLElement>('button')?.focus(); } };
    document.addEventListener('mousedown', ailleurs);
    document.addEventListener('keydown', echap);
    zone.current?.querySelector<HTMLElement>('.c-menu-liste button')?.focus({ preventScroll: true });
    return () => { document.removeEventListener('mousedown', ailleurs); document.removeEventListener('keydown', echap); };
  }, [ouvert]);
  return (
    <div className="c-menu" ref={zone}>
      {/* Jamais vert : le vert de la fiche est l'étape suivante, dans « Ce qui attend » (sa maquette). Sans geste permis, le
          menu ne fait que dire pourquoi. */}
      <button type="button" className="c-btn c-fiche-gestes" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
        {titre('console.ecran.fiche.gestes')}<Icone nom="bas" taille={17} />
      </button>
      {ouvert ? (
        <div className="c-menu-liste" {...parcourirMenu}>
          <p className="c-menu-note">{gestes.length ? phrase('console.ecran.fiche.gestes_aide') : raison}</p>
          {/* Ce qui détruit en dernier, en rouge, après un trait (la maquette). */}
          {[...gestes].sort((x, y) => ORDRE_DU_MENU.indexOf(x) - ORDRE_DU_MENU.indexOf(y)).map((g, i, tous) => (
            <button key={g} type="button" className={[DETRUIT.has(g) ? 'c-menu-danger' : '', DETRUIT.has(g) && i > 0 && !DETRUIT.has(tous[i - 1] as Geste) ? 'c-menu-trait' : ''].filter(Boolean).join(' ') || undefined}
              onClick={() => { setOuvert(false); choisir(g); }}>{libelleDuGeste(g, etat)}</button>
          ))}
          {gestes.length && reserve ? <p className="c-menu-note">{reserve}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── La fiche ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Un geste lancé du menu « … » d'une ligne de la liste des clients (la maquette Clients) : sa fenêtre est celle de la
// fiche, sur la fiche telle que le serveur la rend à cet instant — la ligne d'abonnement lue part avec le geste, et
// changée entre-temps, le serveur refuse au lieu d'écraser (01 R15). Une lecture qui échoue se dit, et la fenêtre se ferme.
export function GesteDuMenu({ id, geste, fermer, fait }: { id: string; geste: Geste; fermer: () => void; fait: () => void }) {
  const { moi } = useConsole();
  const [l] = useLecture<Donnees>(`/console/entreprises/${encodeURIComponent(id)}`, `geste:${id}`);
  useEffect(() => { if (l.etat === 'panne') { toast(l.texte, true); fermer(); } }, [l]);
  return l.etat === 'lu' ? <FenetreGeste geste={geste} fiche={l.donnees} role={moi.role} fermer={fermer} fait={fait} /> : null;
}

export function Fiche({ id, onglet: ongletDemande }: { id: string; onglet: string | null }) {
  const { moi, relireDecisions } = useConsole();
  const [l, relire] = useLecture<Donnees>(`/console/entreprises/${encodeURIComponent(id)}`, id);
  const [geste, setGeste] = useState<Geste | null>(null);
  const [noter, setNoter] = useState(false);
  const [facture, setFacture] = useState(false);
  const [gesteGroupe, setGesteGroupe] = useState<GesteGroupe | null>(null);
  // Nos échanges (0110) : noter un appel, écrire au contact.
  const [appel, setAppel] = useState(false);
  const [ecrireA, setEcrireA] = useState(false);
  // La fiche envoie émettre sa facture dans l'application de SkanFact, dans un autre onglet : en revenant, elle dit ce
  // qui a bougé (émise, réglée, l'abonnement qui suit). Jamais sous une fenêtre ouverte : on ne relit pas sous les doigts.
  useRelireQuandOnRegarde(relire, { attendre: () => geste !== null || noter || facture || gesteGroupe !== null || appel || ecrireA });
  if (l.etat === 'lecture') return <p className="c-attente">{titre('console.ecran.lecture')}</p>;
  if (l.etat === 'panne') {
    return (
      <>
        <nav className="c-fil" aria-label={titre('console.ecran.fiche.retour')}><a href="#/clients">{titre('console.ecran.fiche.retour')}</a></nav>
        {l.statut === 404 ? (
          <section className="c-carte c-liste-carte">
            <Vide icone="chercher"><span>{phrase('console.ecran.fiche.introuvable')}</span> <Lien href="#/clients" petit>{titre('console.ecran.fiche.vers_liste')}</Lien></Vide>
          </section>
        ) : <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>}
      </>
    );
  }
  const f = l.donnees;
  const onglet: OngletFiche = ONGLETS_FICHE.includes(ongletDemande as OngletFiche) ? ongletDemande as OngletFiche : 'apercu';
  const puce = puceDe(f.etat);
  const proprietaires = f.membres.filter((m) => m.roles.includes('proprietaire'));
  const premier = proprietaires[0] ?? null;
  // À qui demander l'accès à son dossier : le prénom de sa propriétaire, le même dans l'aperçu et dans l'onglet.
  const inviteAcces = premier ? phrase('console.ecran.fiche.acces_invite', { prenom: premier.nom.split(/\s+/)[0] ?? premier.nom }) : phrase('console.ecran.fiche.acces_invite_sans');
  // Son groupe (la remise de groupe, la ligne de la liste des clients) : l'en-tête le nomme et le fil y remonte.
  const sonGroupe = f.groupe.groupe;
  const tient = f.cabinets.find((c) => c.place === 'tenu');
  // Ce qui revient à la direction : la même phrase que sous le menu d'une ligne de la liste.
  const reserve = moi.role === 'direction' ? null : phrase('console.ecran.clients.m.reserve');
  const raisonSansGeste = f.faits.tenuParCabinet ? phrase('console.ecran.fiche.sans_geste.cabinet') : reserve;
  const emises = f.comptes.piecesEmises;
  const faits: [string, string][] = f.ligne ? [
    [titre('console.ecran.fiche.f.essai'), jourCourt(f.ligne.essai_jusqu_au)],
    [titre('console.ecran.fiche.f.paye'), jourCourt(f.ligne.paye_jusqu_au)],
    [titre('console.ecran.fiche.f.offre'), f.ligne.offre && f.ligne.periodicite ? offreEtPeriode(f.ligne.offre, f.ligne.periodicite) : '—'],
    [titre('console.ecran.fiche.f.resilie'), jourCourt(f.ligne.resilie_le)],
    [titre('console.ecran.fiche.f.suspendu'), jourCourt(f.ligne.suspendu_le)],
    [titre('console.ecran.fiche.f.offert'), titre(f.ligne.offert ? 'console.ecran.fiche.oui' : 'console.ecran.fiche.non')],
    [titre('console.ecran.fiche.f.modules'), nomsModules(f.ligne.modules) || '—'],
  ] : [];
  const ecrire = (m: { email: string }) => `mailto:${m.email}`;
  // L'onglet vit dans l'adresse : « précédent » y revient, un lien d'ailleurs peut y mener.
  const versOnglet = (o: OngletFiche) => `#/clients/${f.id}${o === 'apercu' ? '' : `?onglet=${o}`}`;
  // Les onglets de la maquette : l'aperçu, l'abonnement, nos factures et ses paiements, le support et nos échanges, les
  // membres, le journal ; un compte quand il dit quelque chose (une facture en retard se compte en orange).
  const enRetard = f.factures.lignes.filter((x) => x.etat === 'en_retard').length;
  const onglets: { o: OngletFiche; n?: number; alerte?: boolean }[] = [{ o: 'apercu' }, { o: 'abonnement' },
    { o: 'factures', n: f.factures.lignes.length, alerte: enRetard > 0 }, { o: 'support', n: f.support.comptes.ouvertes }, { o: 'membres', n: f.membres.length }, { o: 'journal' }];
  const contexte = contexteDe(f.etat.etat, f.etat.etat === 'lecture_seule' ? f.etat.raison : undefined);
  // Le mois en cours et celui d'avant, pour « Pièces émises » (la maquette : « 214 · 353 en septembre »).
  const moisAvant = derniersMois(f.aujourdhui)[10] ?? '';
  const emisesAvant = emises.find((x) => x.mois === moisAvant)?.n ?? 0;
  const derniereActivite = f.derniereActivite ?? null;
  const remiseCabinet = f.groupe.remise && f.groupe.remise.nature === 'cabinet' ? f.groupe.remise : null;
  // Le geste qui répond à une ligne de « Ce qui attend » : encaisser quand le rôle le permet, sinon prolonger ; écrire au
  // propriétaire d'un essai qui n'a pas servi. Le premier est vert : c'est l'étape suivante.
  // Quand nos factures naissent dans l'entreprise SkanFact (14b), l'étape suivante d'une échéance passée est SA facture :
  // l'émettre si elle attend, l'ouvrir si elle est due, la préparer sinon. Noter un paiement reste dans « Gestes ».
  const facturer = moi.role === 'direction' && !!f.factures.editeur?.proprietaire && !f.faits.tenuParCabinet;
  const ouverte = factureOuverte(f.factures.lignes);
  const reponse = (a: Attente): { texte: string; geste?: Geste; href?: string; ailleurs?: boolean; faire?: () => void } | null => {
    if (a.sorte === 'support') return { texte: titre('console.ecran.decider.repondre'), href: `#/support?demande=${a.demande.id}` };
    if (a.sorte === 'essai_sans_usage') return a.proprietaire ? { texte: titre('console.ecran.fiche.attend.ecrire', { nom: a.proprietaire.nom }), href: ecrire(a.proprietaire) } : null;
    // L'argent (0113) : la facture s'ouvre dans l'application de SkanFact ; un trop-perçu, dans Paiements.
    if (a.sorte === 'facture_defaite' || a.sorte === 'a_emettre') return { texte: titre('console.ecran.decider.ouvrir_facture'), href: a.ecran, ailleurs: true };
    if (a.sorte === 'trop_percu') return { texte: titre('console.ecran.decider.ouvrir_paiements'), href: '#/paiements' };
    if (facturer && ouverte) return { texte: titre(ouverte.etat === 'a_emettre' ? 'console.ecran.fiche.attend.emettre' : 'console.ecran.fiche.attend.sa_facture'), href: ouverte.ecran, ailleurs: true };
    if (facturer) return { texte: titre('console.ecran.fiche.attend.preparer'), faire: () => setFacture(true) };
    const g = f.gestes.includes('payer') ? 'payer' : f.gestes.includes('prolonger') ? 'prolonger' : null;
    return g ? { texte: titre(`console.ecran.geste.${cleGeste(g)}`), geste: g } : null;
  };

  return (
    <>
      <nav className="c-fil" aria-label={titre('console.ecran.fiche.retour')}>
        <a href="#/clients">{titre('console.ecran.fiche.retour')}</a><Icone nom="droite" taille={14} />
        {sonGroupe ? <><a href={`#/clients/groupe/${sonGroupe.id}`} data-donnee>{sonGroupe.nom}</a><Icone nom="droite" taille={14} /></> : null}
        <span data-donnee>{f.raisonSociale}</span>
      </nav>
      <header className="c-entete">
        <div className="c-entete-texte">
          <div className="c-titre-ligne"><h1 data-donnee>{f.raisonSociale}</h1><Puce ton={puce.ton}>{puce.texte}</Puce></div>
          <p className="c-entete-sous">
            {f.tenuePar && f.faits.tenuParCabinet ? maj(dire('console.ecran.fiche.sorte.tenu', { nom: f.tenuePar }))
              : sonGroupe ? <>{titre('console.ecran.fiche.sorte.groupe')} <a href={`#/clients/groupe/${sonGroupe.id}`} data-donnee>{sonGroupe.nom}</a></>
              : maj(organisationEnMots(f.organisation))}
            {f.identite?.ville ? <> · <span data-donnee>{f.identite.ville}</span></> : null}
            {' · '}{dire('console.ecran.fiche.inscrite', { le: jourCourt(f.creeLe) })}{premier ? <> · <span data-donnee>{premier.nom}</span></> : null}
          </p>
        </div>
        <div className="c-entete-actions">
          {f.membres.length ? <Bouton onClick={() => setEcrireA(true)}>{titre('console.ecran.fiche.ecrire_court')}</Bouton> : null}
          <MenuGestes gestes={f.gestes} etat={f.etat} choisir={setGeste} raison={raisonSansGeste} reserve={f.faits.tenuParCabinet ? null : reserve} />
        </div>
      </header>

      {f.attend.length ? (
        <section className="c-carte c-fiche-attend" aria-labelledby="fiche-attend">
          <div className="c-fiche-attend-tete">
            <h2 id="fiche-attend">{titre('console.ecran.fiche.attend.titre')}</h2>
            <span>{dire('console.ecran.fiche.attend.sous')}</span>
          </div>
          <ul>
            {f.attend.map((a, i) => {
              const v = attenteEnMots(a, f.aujourdhui);
              const r = reponse(a);
              return (
                <li key={a.sorte === 'support' ? `support-${a.demande.id}` : a.sorte === 'facture_defaite' || a.sorte === 'a_emettre' || a.sorte === 'trop_percu' ? `${a.sorte}-${a.ecran}` : a.sorte}>
                  <span className={`c-ligne-icone c-${v.urgence}`}><Icone nom={v.icone} /></span>
                  <span className="c-fiche-attend-texte"><b>{v.titre}</b><span>{v.desc}</span></span>
                  {r?.geste || r?.faire ? <Bouton {...(i === 0 ? { ton: 'principal' as const } : {})} onClick={() => (r.faire ? r.faire() : setGeste(r.geste ?? null))}>{r.texte}</Bouton>
                    : r?.href ? <Lien href={r.href} {...(r.ailleurs ? { ailleurs: true } : {})} {...(i === 0 ? { ton: 'principal' as const } : {})}>{r.texte}</Lien> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <nav className="c-onglets" aria-label={titre('console.ecran.fiche.onglets')}>
        {onglets.map(({ o, n, alerte }) => (
          <a key={o} href={versOnglet(o)} aria-current={onglet === o ? 'page' : undefined}>
            {titre(`console.ecran.fiche.onglet.${o}`)}{n ? <span className={`c-onglet-n${alerte ? ' c-onglet-n-alerte' : ''}`}>{n}</span> : null}
          </a>
        ))}
      </nav>

      {onglet === 'apercu' ? (
        <div className="c-grille-2">
          <div className="c-colonne">
            <section className="c-carte" aria-labelledby="fiche-ent">
              <div className="c-carte-tete"><h2 id="fiche-ent">{titre('console.ecran.fiche.son_entreprise')}</h2></div>
              <div className={`c-fiche-ent c-fiche-ent-${f.etat.etat}`}>
                <div className="c-fiche-ent-tete"><b data-donnee>{f.raisonSociale}</b><Puce ton={puce.ton}>{puce.texte}</Puce></div>
                <span className="c-fiche-ent-ids c-mono" data-donnee>
                  {[f.identite?.numero, f.matricule ? `MF ${f.matricule}` : null].filter(Boolean).join(' · ') || titre('console.ecran.fiche.sans_matricule')}
                </span>
                <span className="c-fiche-ent-offre">{maj(abonnementEnMots(f.etat, f.faits))}</span>
                <span className="c-fiche-ent-quand">{maj(expliquer(f.etat, f.aujourdhui))}</span>
                {f.offreSuivante ? <span className="c-fiche-ent-note">{phrase('console.ecran.fiche.offre_suivante', { offre: offreEtPeriode(f.offreSuivante.offre, f.offreSuivante.periodicite), le: jourCourt(f.offreSuivante.aPartirDu) })}</span> : null}
                {f.delai && f.etat.etat === 'en_retard' ? <span className="c-fiche-ent-note">{phrase('console.ecran.fiche.delai')}</span> : null}
                {/* 0113 : ce que la prochaine facture coûtera (le chiffre de la liste et des échéances), le mois offert qui
                    l'attend, les modules qui partent au renouvellement. */}
                {f.prochaineFacture ? <span className="c-fiche-ent-note">{phrase(f.ligne?.mois_offerts ? 'console.ecran.fiche.prochaine_facture_offert' : 'console.ecran.fiche.prochaine_facture',
                  { montant: montant(f.prochaineFacture.montantHt), le: jourCourt(f.prochaineFacture.debut) })}</span>
                  : f.ligne?.mois_offerts ? <span className="c-fiche-ent-note">{phrase('console.ecran.fiche.mois_offert')}</span> : null}
                {f.ligne?.paye_jusqu_au ? (f.ligne.modules_a_retirer ?? []).map((m) => (
                  <span key={`part-${m}`} className="c-fiche-ent-note">{phrase('console.ecran.fiche.module_part', { module: titre(`console.ecran.abo.module.${m}`), le: jourCourt(f.ligne?.paye_jusqu_au) })}</span>)) : null}
                {f.enPlus?.prolonge ? <span className="c-fiche-ent-note">{phrase('console.ecran.fiche.prolonge', { n: f.enPlus.prolonge })}</span> : null}
                {f.tenuePar ? <span>{titre('console.ecran.fiche.i.cabinet')} <span data-donnee>{tient ? <a href={`#/cabinets/${tient.id}`}>{f.tenuePar}</a> : f.tenuePar}</span></span> : null}
                {!f.active ? <span className="c-fiche-ent-quand">{titre('console.ecran.fiche.inactive_long')}</span> : null}
                {/* Ce qu'elle a : ses modules achetés seuls, ses établissements, ses caisses, ses salariés (des comptes, jamais
                    ce qu'ils contiennent). */}
                <span className="c-fiche-puces">
                  {(f.ligne?.modules ?? []).map((m) => <span key={m} className="c-fiche-puce">{titre(`console.ecran.abo.module.${m}`)}</span>)}
                  <span className="c-fiche-puce">{maj(selon(f.comptes.etablissements, 'console.ecran.fiche.puce.etablissements'))}</span>
                  <span className="c-fiche-puce">{maj(selon(f.comptes.caisses, 'console.ecran.fiche.puce.caisses'))}</span>
                  {f.comptes.salaries ? <span className="c-fiche-puce">{maj(selon(f.comptes.salaries, 'console.ecran.fiche.puce.salaries'))}</span> : null}
                </span>
              </div>
            </section>

            <section className="c-carte" aria-labelledby="fiche-comptes">
              <div className="c-carte-tete">
                <h2 id="fiche-comptes">{titre('console.ecran.fiche.comptes')}</h2>
                <span className="c-carte-coin">{dire('console.ecran.fiche.comptes_sous_jour', { mois: moisEnMots(f.aujourdhui.slice(0, 7), false), jour: Number(f.aujourdhui.slice(8, 10)) })}</span>
              </div>
              {/* Huit comptes (la maquette) : ceux que la console mesure, et ceux qu'elle ne mesure pas encore, dits tels (C2). */}
              <div className="c-chiffres c-fiche-chiffres c-fiche-chiffres-8">
                {([
                  ['emises', String(f.enPlus?.piecesMois ?? 0), emisesAvant ? dire('console.ecran.fiche.c.emises_avant', { n: emisesAvant, mois: moisEnMots(moisAvant, false) }) : dire('console.ecran.fiche.c.emises_rien_avant', { mois: moisEnMots(moisAvant, false) })],
                  ['membres', String(f.membres.length), dire('console.ecran.fiche.c.membres_sous')],
                  ['salaries', String(f.comptes.salaries), dire('console.ecran.fiche.c.salaries_sous')],
                  ['caisses_etab', `${f.comptes.caisses} · ${f.comptes.etablissements}`, dire('console.ecran.fiche.c.caisses_etab_sous')],
                  ['sms', null, null], ['place', null, null], ['documents', null, null], ['api', null, null],
                ] as const).map(([k, v, sous]) => (
                  <div key={k} className="c-chiffre"><span>{titre(`console.ecran.fiche.c.${k}`)}</span>
                    {v === null ? <><b className="c-cl-rien">—</b><small>{dire('console.ecran.fiche.c.non_mesure')}</small></> : <><b>{v}</b>{sous ? <small>{sous}</small> : null}</>}</div>
                ))}
              </div>
              <p className="c-fiche-comptes-pied">{phrase('console.ecran.fiche.c.pied', { quand: derniereActivite ? quand(derniereActivite, f.aujourdhui) : dire('console.ecran.temps.jamais') })}</p>
            </section>

            {/* Une procédure de reprise en cours : dans la colonne large, sous les comptes (la carte dit ce qui manque). */}
            {moi.role === 'direction' && !f.faits.tenuParCabinet && repriseEnCours(f.reprise) ? <CarteReprise id={f.id} nom={f.raisonSociale} reprise={f.reprise} aujourdhui={f.aujourdhui} relire={relire} /> : null}
          </div>

          <div className="c-colonne">
            <section className="c-carte" aria-labelledby="fiche-parler">
              <div className="c-carte-tete"><h2 id="fiche-parler">{titre('console.ecran.fiche.a_qui_parler')}</h2></div>
              {proprietaires.length ? (
                <ul className="c-personnes">
                  {proprietaires.map((m) => (
                    <li key={m.email} className="c-fiche-parler">
                      <div className="c-texte">
                        <b data-donnee>{m.nom}</b>
                        <span>{titre('console.ecran.fiche.proprietaire')}</span>
                        {m === premier && f.identite?.telephone ? <span className="c-mono c-fiche-tel" data-donnee>{f.identite.telephone}</span> : null}
                        <a href={ecrire(m)} data-donnee>{m.email}</a>
                        <span>{titre(m.derniereConnexion ? 'console.ecran.fiche.connecte' : 'console.ecran.fiche.jamais_connecte', m.derniereConnexion ? { quand: quand(m.derniereConnexion, f.aujourdhui) } : {})}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="c-attente">{phrase('console.ecran.fiche.sans_proprietaire')}</p>}
              <div className="c-fiche-parler-gestes">
                <Bouton petit onClick={() => setAppel(true)}>{titre('console.ecran.echanges.appel.ouvrir')}</Bouton>
                {f.membres.length ? <Bouton petit onClick={() => setEcrireA(true)}>{titre('console.ecran.fiche.ecrire_court')}</Bouton> : null}
              </div>
              <p className="c-fiche-dernier">{f.identite?.dernierAppel
                ? phrase('console.ecran.echanges.dernier', { quand: quand(f.identite.dernierAppel.le, f.aujourdhui), qui: f.identite.dernierAppel.qui ?? '—', resultat: resultatEnMots(f.identite.dernierAppel.resultat) })
                : phrase('console.ecran.echanges.aucun')}</p>
            </section>

            {f.cabinets.length ? (
              <section className="c-carte" aria-labelledby="fiche-cabinets">
                <div className="c-carte-tete"><h2 id="fiche-cabinets">{titre(f.cabinets.length > 1 ? 'console.ecran.fiche.cabinets_plusieurs' : 'console.ecran.fiche.cabinets')}</h2></div>
                <ul className="c-personnes">
                  {f.cabinets.map((c) => (
                    <li key={c.id}>
                      <Avatar nom={c.nom} />
                      <div className="c-texte">
                        <b data-donnee>{c.nom}</b>
                        <span>{maj(c.mandat ? dire(`console.ecran.fiche.cabinet.${c.place}`, { le: jourCourt(c.mandat.debut) }) : dire(`console.ecran.fiche.cabinet.${c.place}_sans_date`))}</span>
                        {remiseCabinet ? <span>{phrase('console.ecran.fiche.cabinet.parrainage', { taux: remiseCabinet.taux })}</span> : null}
                        <a href={`#/cabinets/${c.id}`} className="c-fiche-vers">{titre('console.ecran.fiche.ouvrir_cabinet')}</a>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Son dossier, avec son accord : on demande, il accorde (en lecture, quelques heures) ; la console ne voit
                jamais le contenu d'un dossier sans lui. */}
            {!f.faits.tenuParCabinet ? (
              <section className="c-carte c-fiche-acces" aria-labelledby="fiche-acces">
                <div className="c-carte-tete"><h2 id="fiche-acces">{titre('console.ecran.fiche.acces_titre')}</h2></div>
                <AccesDossier client={{ id: f.id, nom: f.raisonSociale }} aujourdhui={f.aujourdhui} forme="bande" invite={inviteAcces} />
              </section>
            ) : null}

            {moi.role === 'direction' && !f.faits.tenuParCabinet && !repriseEnCours(f.reprise) ? <CarteReprise id={f.id} nom={f.raisonSociale} reprise={f.reprise} aujourdhui={f.aujourdhui} relire={relire} /> : null}
          </div>
        </div>
      ) : null}

      {onglet === 'abonnement' ? (
        <section className="c-carte" aria-labelledby="fiche-abo">
          <div className="c-carte-tete">
            <div>
              <h2 id="fiche-abo">{titre('console.ecran.fiche.abonnement')}</h2>
              <p className="c-carte-sous">{maj(expliquer(f.etat, f.aujourdhui))}</p>
            </div>
          </div>
          {f.ligne ? (
            <dl className="c-faits">{faits.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={/\d/.test(v) ? 'c-mono' : ''}>{v}</dd></div>)}</dl>
          ) : <Alerte ton="info">{phrase('console.ecran.fiche.aucune_ligne')}</Alerte>}
        </section>
      ) : null}
      {onglet === 'abonnement' ? <GroupeEtRemise f={f} role={moi.role} faire={setGesteGroupe} /> : null}
      {gesteGroupe ? <FenetreGroupe fiche={f} geste={gesteGroupe} fermer={() => setGesteGroupe(null)} fait={() => { setGesteGroupe(null); relire(); }} /> : null}
      {onglet === 'factures' ? <SesFactures f={f} role={moi.role} preparer={() => setFacture(true)} /> : null}
      {facture ? <FenetreFacture fiche={f} fermer={() => setFacture(false)} fait={() => { setFacture(false); relire(); }} /> : null}

      {onglet === 'membres' ? (
        <section className="c-carte" aria-labelledby="fiche-membres">
          <div className="c-carte-tete">
            <div>
              <h2 id="fiche-membres">{titre('console.ecran.fiche.membres')}</h2>
              <p className="c-carte-sous">{phrase('console.ecran.fiche.membres_sous')}</p>
            </div>
          </div>
          {f.membres.length === 0 ? <p className="c-attente">{phrase(tient ? 'console.ecran.fiche.membres_vide_tenue' : 'console.ecran.fiche.membres_vide')}</p> : null}
          <ul className="c-personnes">
            {f.membres.map((m) => (
              <li key={m.email}>
                <Avatar nom={m.nom} />
                <div className="c-texte">
                  <b data-donnee>{m.nom}</b>
                  <span data-donnee>{m.email}</span>
                  <span>{m.roles.map((r) => dire(`role.${r}`)).join(', ')} · {dire('console.ecran.fiche.depuis', { le: jourCourt(jourDe(m.depuis)) })}</span>
                  <span>{titre(m.derniereConnexion ? 'console.ecran.fiche.connecte' : 'console.ecran.fiche.jamais_connecte', m.derniereConnexion ? { quand: quand(m.derniereConnexion, f.aujourdhui) } : {})}</span>
                  <span>{titre(m.derniereIci ? 'console.ecran.fiche.ici' : 'console.ecran.fiche.jamais_ici', m.derniereIci ? { quand: quand(m.derniereIci, f.aujourdhui) } : {})}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {onglet === 'support' ? (
        <section className="c-carte c-liste-carte c-fiche-support" aria-labelledby="fiche-support">
          <div className="c-carte-tete">
            <div>
              <h2 id="fiche-support">{titre('console.ecran.support.fiche.titre')}</h2>
              <p className="c-carte-sous">{phrase('console.ecran.support.fiche.sous')}</p>
            </div>
            <Bouton petit icone="plus" onClick={() => setNoter(true)}>{titre('console.ecran.support.fiche.noter')}</Bouton>
          </div>
          {f.support.ouvertes.length + f.support.closes.length === 0 ? <Vide icone="courriel">{phrase('console.ecran.support.fiche.vide')}</Vide> : (
            <ul className="c-fiche-demandes">
              {[...f.support.ouvertes, ...f.support.closes].map((d) => {
                const e = etatEnMots(d.etat);
                return (
                  <li key={d.id}>
                    <a href={`#/support?demande=${d.id}`}>
                      <span className="c-fiche-demande-haut"><span className="c-mono" data-donnee>{refDemande(d.numero)}</span><b data-donnee>{d.sujet}</b><Puce ton={e.ton}>{e.texte}</Puce></span>
                      <span className="c-sous"><span data-donnee>{d.demandeur.nom}</span> · {dire(`console.ecran.support.canal.${d.canal}`)} · {depuisEnMots(d.etat, f.aujourdhui)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
      {onglet === 'support' ? (
        <section className="c-carte c-fiche-echanges" aria-labelledby="fiche-echanges">
          <div className="c-carte-tete">
            <div>
              <h2 id="fiche-echanges">{titre('console.ecran.echanges.titre')}</h2>
              <p className="c-carte-sous">{phrase('console.ecran.echanges.sous')}</p>
            </div>
            <span className="c-boutons-ligne">
              <Bouton petit icone="plus" onClick={() => setAppel(true)}>{titre('console.ecran.echanges.appel.ouvrir')}</Bouton>
              {f.membres.length ? <Bouton petit onClick={() => setEcrireA(true)}>{titre('console.ecran.fiche.ecrire_court')}</Bouton> : null}
            </span>
          </div>
          {f.notes.length ? (
            <ol className="c-histoire c-fiche-notes">
              {f.notes.map((n) => (
                <li key={n.id}>
                  <span className="c-histoire-quand">{maj(quand(n.le, f.aujourdhui))}</span>
                  <div className="c-histoire-quoi">
                    <b>{maj(resultatEnMots(n.resultat))}</b>
                    {n.resume ? <span className="c-motif" data-donnee>{n.resume}</span> : null}
                    <span className="c-qui" data-donnee>{n.qui ?? '—'}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Vide icone="echange">{phrase('console.ecran.echanges.vide')}</Vide>}
        </section>
      ) : null}
      {onglet === 'support' && !f.faits.tenuParCabinet ? (
        // Le même encart que dans l'aperçu : son titre de carte, puis la bande (sans un second « Son dossier » au-dessus).
        <section className="c-carte c-fiche-acces" aria-labelledby="fiche-acces-onglet">
          <div className="c-carte-tete"><h2 id="fiche-acces-onglet">{titre('console.ecran.fiche.acces_onglet')}</h2></div>
          <AccesDossier client={{ id: f.id, nom: f.raisonSociale }} aujourdhui={f.aujourdhui} forme="bande" invite={inviteAcces} />
        </section>
      ) : null}

      {onglet === 'journal' ? (
        <section className="c-carte" aria-labelledby="fiche-histoire">
          <div className="c-carte-tete">
            <div>
              <h2 id="fiche-histoire">{titre('console.ecran.fiche.histoire')}</h2>
              <p className="c-carte-sous">{phrase('console.ecran.fiche.histoire_sous')}</p>
            </div>
            {moi.role === 'direction' ? <Lien href={`#/journal?entreprise=${f.id}`} icone="journal" petit>{titre('console.ecran.fiche.voir_journal')}</Lien> : null}
          </div>
          {f.evenements.length ? (
            <ol className="c-histoire">
              {f.evenements.map((e) => (
                <li key={e.id}>
                  <span className="c-histoire-quand">{maj(quand(e.le, f.aujourdhui))}</span>
                  <div className="c-histoire-quoi">
                    <b>{titre(`console.ecran.nature.${e.nature}`)}</b>
                    <Changements avant={e.avant} apres={e.apres} />
                    {e.motif ? <span className="c-motif" data-donnee>{'« '}{e.motif}{' »'}</span> : null}
                    <span className="c-qui">
                      {e.par === 'systeme' ? titre(e.nature === 'paye' ? 'console.ecran.fiche.par_facture' : 'console.ecran.fiche.par_systeme')
                        : e.qui ? <><span data-donnee>{e.qui.nom}</span> · {dire(`console.ecran.role.${e.qui.role}`)}</> : titre('console.ecran.fiche.par_outil')}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Vide icone="journal">{phrase('console.ecran.fiche.histoire_vide')}</Vide>}
        </section>
      ) : null}
      {geste ? <FenetreGeste geste={geste} fiche={f} role={moi.role} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); relireDecisions(); }} /> : null}
      {noter ? <NoterDemande client={{ id: f.id, nom: f.raisonSociale }} fermer={() => setNoter(false)} /> : null}
      {appel ? <NoterAppel client={{ id: f.id, nom: f.raisonSociale }} fermer={() => setAppel(false)} fait={() => { setAppel(false); relire(); }} /> : null}
      {ecrireA ? <EcrireAuContact client={{ id: f.id, nom: f.raisonSociale }} contexte={contexte} fermer={() => setEcrireA(false)} fait={() => { setEcrireA(false); relire(); }} /> : null}
    </>
  );
}

// Une ligne de « Ce qui attend » dite pour la fiche : sans le nom du client (c'est sa fiche), avec la phrase d'« À
// décider » et son urgence.
type UrgenceAttente = 'urgent' | 'aujourdhui' | 'semaine';
function attenteEnMots(a: Attente, aujourdhui: string): { icone: NomIcone; titre: string; desc: string; urgence: UrgenceAttente & TonPuce } {
  switch (a.sorte) {
    case 'en_retard':
      return { icone: 'calendrier', titre: titre('console.ecran.fiche.attend.en_retard'), urgence: a.jours <= 2 ? 'urgent' : 'semaine',
        desc: phrase(a.apresEssai ? 'console.ecran.decider.retard_essai' : 'console.ecran.decider.retard_abonnement', { echeance: jourCourt(a.echeance), le: jourCourt(a.lectureSeuleLe), dans: dans(a.lectureSeuleLe, aujourdhui) }) };
    case 'lecture_seule':
      return { icone: 'cadenas', titre: titre('console.ecran.fiche.attend.lecture_seule'), urgence: a.depuis === aujourdhui ? 'aujourdhui' : 'semaine',
        desc: phrase(`console.ecran.decider.lecture.${a.raison}`, { le: jourCourt(a.depuis) }) };
    case 'support':
      return { icone: 'courriel', titre: titre('console.ecran.fiche.attend.support', { n: a.heures }), urgence: 'aujourdhui',
        desc: phrase('console.ecran.support.fiche.attend', { sujet: a.demande.sujet, qui: a.demandeur }) };
    case 'facture_defaite':
      return { icone: 'alerte', titre: titre('console.ecran.fiche.attend.defaite_titre'), urgence: 'aujourdhui',
        desc: defaiteEnMots(a) };
    case 'a_emettre':
      return { icone: 'calendrier', titre: titre('console.ecran.fiche.attend.a_emettre_titre'), urgence: 'semaine',
        desc: phrase('console.ecran.decider.a_emettre', { le: jourCourt(a.prepareLe), debut: jourCourt(a.debut), fin: jourCourt(a.fin) }) };
    case 'trop_percu':
      return { icone: 'alerte', titre: titre('console.ecran.fiche.attend.trop_titre', { montant: montant(a.trop) }), urgence: 'semaine',
        desc: phrase(a.annulee ? 'console.ecran.decider.trop_annulee' : 'console.ecran.decider.trop', { numero: a.numero ?? dire('console.ecran.decider.sans_numero') }) };
    default:
      return { icone: 'sablier', titre: titre('console.ecran.fiche.attend.essai_sans_usage'), urgence: a.jours <= 1 ? 'aujourdhui' : 'semaine',
        desc: phrase('console.ecran.decider.sans_usage', { le: jourCourt(a.jusquAu), dans: dans(a.jusquAu, aujourdhui) }) };
  }
}

// Les douze derniers mois, du plus ancien au mois en cours (« 2025-11 » … « 2026-10 »), en jours de calendrier.
function derniersMois(aujourdhui: string): string[] {
  const a = Number(aujourdhui.slice(0, 4)), m = Number(aujourdhui.slice(5, 7));
  return Array.from({ length: 12 }, (_, i) => {
    const k = a * 12 + (m - 1) - (11 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
  });
}
