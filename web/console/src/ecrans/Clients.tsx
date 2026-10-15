// La liste des clients (serveur/console/routes.ts, GET /console/entreprises) : une ligne par entreprise, le plus urgent en
// haut. Au-dessus, les vues du métier (serveur/console/clients.ts : à appeler, l'argent attendu, les silencieux, les
// dossiers tenus à convertir) ; dessous, les puces d'état. Chaque carte et chaque puce porte son compte, calculé par la
// MÊME fonction que le filtre qu'elle ouvre (C3) ; la recherche porte sur le nom, le matricule, l'organisation, le
// propriétaire et le cabinet, sans accents ni casse. Chaque ligne dit son échéance et ce qu'elle rapporte par an ; la
// liste se trie et se pagine. Jamais le contenu d'un dossier : des comptes, un état, une date, un montant.
import { useEffect, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { CATEGORIES, puceDe, type Categorie, type Etat, type Faits, type Offre, type Periodicite } from '../abonnement.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { montant } from '../argent.ts';
import { deMois, heureDe, jourCourt, jourDe, jourMois, joursEntre } from '../temps.ts';
import { Alerte, Avatar, Bouton, Dialogue, Icone, Lien, maj, MenuLigne, Puce, toast, Vide, Zone, type ActionLigne } from '../ui.tsx';
import { EnteteClients } from './Cabinets.tsx';
import { DETRUIT, GesteDuMenu, libelleDuGeste, type Geste } from './Fiche.tsx';
import { Demander } from './AccesDossier.tsx';
import { contexteDe, EcrireAuContact, NoterAppel, type Contexte } from './Echanges.tsx';

export type Entreprise = {
  id: string; raisonSociale: string; matricule: string | null; active: boolean; creeLe: string;
  organisation: { id: string; type: string; nom: string }; tenuePar: string | null;
  proprietaire: { nom: string; email: string } | null; membres: number; derniereActivite: string | null; pieces: number;
  faits: Faits; etat: Etat;
  // Venue par un cabinet (0107) : son cabinet et le jour où son mandat commence (la liste des clients seulement).
  venuePar?: { cabinet: string; depuis: string } | null;
};
// La facture d'abonnement qui attend son paiement (préparée, pas encore réglée) : `reste` est vide tant qu'elle n'est
// pas émise.
type FactureQuiAttend = { offre: Offre; periodicite: Periodicite; etat: string; reste: string | null; devise: string | null; echeance: string | null };
// Ce que la liste ajoute à chaque ligne : son échéance (le prochain jour où quelque chose change), ce qu'elle rapporte
// par an, hors taxes — `attendu` quand c'est une offre choisie qui n'est pas encore payée —, la remise de sa prochaine
// période, ce que le mois a vu (0110 : les pièces émises, l'essai prolongé, la facture qui attend), les vues du métier
// où elle se range et les gestes de son menu (le serveur les dit, par les fonctions des cartes et de la fiche).
export type Ligne = Entreprise & {
  echeance: string | null; parAn: { montantHt: string; attendu: boolean; remise: { nature: 'groupe' | 'cabinet'; taux: number } | null } | null;
  remise?: { nature: 'groupe' | 'cabinet'; taux: number } | null;
  enPlus: { piecesMois: number; essaiJours: number | null; prolonge: number; prolongeUneFois: boolean; attend: FactureQuiAttend | null };
  vues: VueClients[]; gestes: Geste[];
  numero: string | null; ville: string | null;
  // Son arrivée, les trente jours après son inscription (serveur/console/arrivee.ts) ; vide passé ce temps.
  arrivee?: Arrivee | null;
  // Son risque de départ (serveur/console/risque.ts) : les signes qu'il montre, son usage sur deux fois trente jours.
  risque?: Risque | null;
};
// Les signes d'un départ, dans l'ordre du serveur (serveur/console/risque.ts, SIGNES_RISQUE).
export const SIGNES_RISQUE = ['resiliation', 'retard', 'contestation', 'demandes', 'usage_en_baisse', 'silencieux'] as const;
export type Risque = { signes: (typeof SIGNES_RISQUE[number])[]; usage: { trente: number; avant: number } | null };
// L'arrivée d'un nouveau client (serveur/console/arrivee.ts) : cinq marches, de l'inscription à l'abonnement payé.
export const MARCHES = ['inscrite', 'ouverte', 'premiere_piece', 'premiere_facture', 'abonnee'] as const;
type Marche = typeof MARCHES[number];
export type Arrivee = {
  jours: number; marches: { id: Marche; faite: boolean; le: string | null; avant: string | null }[];
  franchies: number; suivante: Marche | null; bloquee: { marche: Marche; depuis: number } | null;
};
// Une ligne de la liste : une organisation (0110 ; serveur/console/organisations.ts) — une entreprise seule, un groupe et
// ses sociétés (la plus urgente d'abord), un dossier qu'un cabinet tient, un cabinet.
type Sorte = 'entreprise' | 'groupe' | 'tenu' | 'cabinet';
type CabinetDeLigne = { id: string; nom: string; associes: { nom: string; email: string }[]; collaborateurs: number; comptes: { client: number; tenu: number; en_attente: number }; derniereActivite: string | null };
export type LigneOrg = {
  id: string; sorte: Sorte; numero: string | null; nom: string; ville: string | null; cabinet: CabinetDeLigne | null;
  parAnHt: string | null; attenduHt: string | null; usage: number; vu: string | null; societes: Ligne[];
};
export const VUES = ['tout', 'arrivees', 'a_appeler', 'argent', 'silencieux', 'a_risque', 'tenus', 'cabinet'] as const;
export type VueClients = typeof VUES[number];
export const TRIS = ['urgence', 'echeance', 'par_an', 'usage', 'nom', 'vu'] as const;
type Tri = typeof TRIS[number];
// Les filtres de la ligne d'outils (serveur/console/clients.ts) : le type d'organisation, l'offre, le cabinet.
const TYPES = ['seules', 'groupes', 'tenues', 'cabinets'] as const;
// « Sans cabinet » : ni un cabinet qui tient son dossier, ni un cabinet par qui elle est venue (serveur : SANS_CABINET).
const SANS_CABINET = '__aucun';
const OFFRES = ['essentiel', 'complet', 'aucune'] as const;
type TypeClient = typeof TYPES[number];
type OffreClient = typeof OFFRES[number];
type Liste = {
  aujourdhui: string; total: number; tous: number; vue: VueClients; tri: Tri; vues: Record<VueClients, number>; comptes: Record<Categorie, number>;
  options: { type: Record<TypeClient, number>; offre: Record<OffreClient, number>; cabinet: { nom: string; n: number }[]; sansCabinet: number };
  parAn: { montantHt: string; abonnements: number }; lignes: LigneOrg[]; suite: number | null;
};
type LigneExport = {
  entreprise: string; matricule: string | null; organisation: string | null; typeOrganisation: string; cabinet: string | null; offre: string | null;
  periodicite: string | null; etat: string; echeance: string | null; parAnHt: string | null; attenduHt: string | null; pieces: number; membres: number;
  proprietaire: string | null; email: string | null; inscriteLe: string; derniereActivite: string | null;
};
// Combien de lignes par page : 25 d'abord (la maquette), au choix 50 ou 100.
const TAILLES = [25, 50, 100] as const;

// L'organisation en quelques mots : « entreprise seule », « groupe Gharbi », « cabinet Ben Youssef ».
export const organisationEnMots = (o: Entreprise['organisation']) =>
  o.type === 'groupe' || o.type === 'cabinet' ? dire(`console.ecran.org.${o.type}`, { nom: o.nom }) : dire('console.ecran.org.independant');
const nombre = (n: number, un: string, plusieurs: string, aucun?: string) => (n === 0 && aucun ? dire(aucun) : n === 1 ? dire(un) : dire(plusieurs, { n }));

// Une ligne en mots, comme la maquette Clients la dit : l'abonnement (l'offre et ce qui la précise, la remise de sa
// prochaine période), et sous la puce d'état, la phrase qui dit ce qui va se passer — en orange quand c'est proche.
// L'état vient du serveur (serveur/abonnement/etat.ts) ; ces phrases ne le recalculent pas, elles le disent.
const L = 'console.ecran.clients.l', N = 'console.ecran.clients.n';
const offreEnMots = (o: Offre) => dire(`console.ecran.abo.offre.${o}`);
const periodeEnMots = (p: Periodicite) => dire(`console.ecran.abo.periodicite.${p}`);
type EnMots = { offre: string; precise: string | null; remise: string | null; phrase: string | null; alerte: boolean };
export function ligneEnMots(e: Ligne, aujourdhui: string): EnMots {
  const s = e.etat, f = e.faits, att = e.enPlus.attend;
  const aPayer = att?.reste ? montant(att.reste) : null;
  const remise = e.remise ? (e.remise.nature === 'cabinet'
    ? dire(`${L}.remise.cabinet`, { taux: e.remise.taux, nom: e.venuePar?.cabinet ?? e.tenuePar ?? dire(`${L}.son_cabinet`) })
    : dire(`${L}.remise.groupe`, { taux: e.remise.taux })) : null;
  const r = (offre: string, precise: string | null, phrase: string | null, alerte = false): EnMots => ({ offre, precise, remise, phrase, alerte });
  switch (s.etat) {
    // Le jour d'une échéance s'écrit une fois, dans sa colonne : sous la puce, ce qui arrive ce jour-là.
    case 'essai': {
      if (att) {
        return r(dire(`${L}.essai_choisi`, { offre: offreEnMots(att.offre) }), dire(`${L}.des_la_fin`, { periodicite: periodeEnMots(att.periodicite) }),
          aPayer ? dire(`${N}.a_payer`, { montant: aPayer }) : dire(`${N}.a_emettre`));
      }
      const duree = e.enPlus.essaiJours;
      return r(duree ? dire(`${L}.essai_jours`, { n: duree }) : dire(`${L}.essai`),
        e.enPlus.prolonge > 0 ? dire(`${L}.prolonge`, { n: e.enPlus.prolonge }) : dire(`${L}.tout_ouvert`),
        e.vues.includes('a_appeler') ? `${dire(`${N}.fin_essai`)} · ${dire(`${N}.rien_fait`)}` : dire(`${N}.fin_essai`), s.jours <= 3);
    }
    case 'actif': {
      const offre = dire('console.ecran.abo.offre_periodicite', { offre: offreEnMots(s.offre), periodicite: periodeEnMots(s.periodicite) });
      if (s.resilie) return r(offre, f.resilieLe ? dire(`${L}.resilie_le`, { le: jourCourt(f.resilieLe) }) : null, dire(`${N}.arrete`));
      return r(offre, null, dire(`${N}.renouvellement.${s.periodicite}`));
    }
    case 'en_retard': {
      const o = att?.offre ?? f.offre, p = att?.periodicite ?? f.periodicite;
      const lecture = dire(`${N}.passe_lecture`);
      if (!o || !p) return r(dire(`${L}.aucune_offre`), s.apresEssai ? dire(`${L}.essai_fini`, { le: jourCourt(s.echeance) }) : null, `${lecture} · ${dire(`${N}.aucune_offre`)}`, true);
      return r(dire('console.ecran.abo.offre_periodicite', { offre: offreEnMots(o), periodicite: periodeEnMots(p) }),
        s.apresEssai ? dire(`${L}.choisi_pendant`) : dire(`${L}.echue_le`, { le: jourCourt(s.echeance) }),
        aPayer ? `${lecture} · ${dire(`${N}.reste`, { montant: aPayer })}` : lecture, true);
    }
    case 'lecture_seule': {
      const depuis = s.depuis === aujourdhui ? dire(`${N}.depuis_matin`) : dire(`${N}.depuis`, { le: jourCourt(s.depuis) });
      // Ce que la colonne Abonnement dit déjà ne se redit pas sous la puce : seulement depuis quand.
      if (s.raison === 'suspendu') return r(dire(`${L}.suspendu`), null, depuis);
      if (s.raison === 'essai_termine' || !f.offre || !f.periodicite) {
        return r(dire(`${L}.aucune_offre`), f.essaiJusquAu ? dire(`${L}.essai_fini`, { le: jourCourt(f.essaiJusquAu) }) : null, `${depuis} · ${dire(`${N}.lecture.essai_termine`)}`);
      }
      const offre = dire('console.ecran.abo.offre_periodicite', { offre: offreEnMots(f.offre), periodicite: periodeEnMots(f.periodicite) });
      if (s.raison === 'resilie') return r(offre, f.resilieLe ? dire(`${L}.resilie_le`, { le: jourCourt(f.resilieLe) }) : null, f.resilieLe ? depuis : `${depuis} · ${dire(`${N}.lecture.resilie`)}`);
      return r(offre, null, `${depuis} · ${dire(`${N}.lecture.non_renouvele`)}`);
    }
    default:
      // Sans échéance : la puce le dit ; ni remise (pas de période à payer), ni phrase redite.
      if (s.raison === 'tenu_par_cabinet') return { ...r(dire(`${L}.pas_abonne`), e.tenuePar ? dire(`${L}.tenu_par`, { nom: e.tenuePar }) : null, dire(`${N}.tenu`)), remise: null };
      if (s.raison === 'offert') return { ...r(f.offre ? dire(`${L}.offert`, { offre: offreEnMots(f.offre) }) : dire('console.ecran.abo.hors.offert'), f.offre ? dire(`${N}.offert`) : null, null), remise: null };
      return { ...r(dire(`console.ecran.abo.hors.${s.raison}`), null, null), remise: null };
  }
}
// Un jour proche, court : « aujourd'hui », « demain », « dans 3 j », « hier », « il y a 4 j ».
function dansCourt(jour: string, aujourdhui: string): string {
  const n = joursEntre(aujourdhui, jour);
  if (n === 0) return dire('console.ecran.temps.aujourdhui');
  if (n === 1) return dire('console.ecran.temps.demain');
  if (n === -1) return dire('console.ecran.temps.hier');
  return n > 0 ? dire('console.ecran.temps.dans_court', { n }) : dire('console.ecran.temps.il_y_a_court', { n: -n });
}
// La dernière fois qu'on l'a vu : « aujourd'hui, 08:12 », « hier, 19:40 », « il y a 3 jours » (la semaine), « le 03/10 ».
function vuEnMots(instant: string | null, aujourdhui: string): string {
  if (!instant) return dire('console.ecran.temps.jamais');
  const j = jourDe(instant), n = joursEntre(j, aujourdhui);
  if (n <= 0) return `${dire('console.ecran.temps.aujourdhui')}, ${heureDe(instant)}`;
  if (n === 1) return `${dire('console.ecran.temps.hier')}, ${heureDe(instant)}`;
  return n < 7 ? dire('console.ecran.temps.il_y_a', { n }) : dire('console.ecran.temps.le', { jour: jourMois(j) });
}
// Les numéros des pages : la première, la dernière, celles autour de la page lue ; « … » pour ce qui est sauté.
export function numerosDePages(page: number, pages: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}
const vueDe = (v: string | null): VueClients => (VUES.includes(v as VueClients) ? v as VueClients : 'tout');
const triDe = (t: string | null): Tri => (TRIS.includes(t as Tri) ? t as Tri : 'urgence');
const typeDe = (t: string | null): TypeClient | null => (TYPES.includes(t as TypeClient) ? t as TypeClient : null);
const offreDe = (o: string | null): OffreClient | null => (OFFRES.includes(o as OffreClient) ? o as OffreClient : null);

// Le fichier de l'export : un tableau pour un tableur (le point-virgule et la virgule décimale d'un tableur en français),
// une ligne par entreprise de la sélection, les noms des colonnes au catalogue. Il se télécharge sur l'ordinateur ; rien
// ne part ailleurs.
const C = 'console.ecran.clients.ex.col';
const COLONNES: [string, (l: LigneExport) => string | number | null][] = [
  ['entreprise', (l) => l.entreprise], ['matricule', (l) => l.matricule], ['organisation', (l) => l.organisation], ['cabinet', (l) => l.cabinet],
  ['offre', (l) => (l.offre ? titre(`console.ecran.clients.offre.${l.offre}`) : null)],
  ['periodicite', (l) => (l.periodicite ? dire(`console.ecran.clients.ex.periodicite.${l.periodicite}`) : null)],
  ['etat', (l) => titre(`console.ecran.etat.${l.etat === 'actif' || l.etat === 'essai' || l.etat === 'en_retard' || l.etat === 'lecture_seule' ? l.etat : 'hors'}`)],
  ['echeance', (l) => (l.echeance ? jourCourt(l.echeance) : null)], ['par_an', (l) => l.parAnHt?.replace('.', ',') ?? null],
  ['attendu', (l) => l.attenduHt?.replace('.', ',') ?? null], ['pieces', (l) => l.pieces], ['membres', (l) => l.membres],
  ['proprietaire', (l) => l.proprietaire], ['email', (l) => l.email], ['inscrite', (l) => jourCourt(l.inscriteLe)],
  ['vu', (l) => (l.derniereActivite ? jourCourt(l.derniereActivite.slice(0, 10)) : null)],
];
const cellule = (v: string | number | null) => { const t = v === null ? '' : String(v); return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
function telecharger(lignes: LigneExport[], jour: string) {
  const csv = [COLONNES.map(([c]) => cellule(maj(dire(`${C}.${c}`)))).join(';'), ...lignes.map((l) => COLONNES.map(([, f]) => cellule(f(l))).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${dire('console.ecran.clients.ex.fichier')}-${jour}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// Exporter la sélection : la direction seule, avec son motif (le journal le garde, avec le nombre de lignes, jamais les
// lignes) ; le fichier est la liste telle qu'elle est filtrée, toutes ses pages.
function FenetreExport({ total, filtres, fermer }: { total: number; filtres: Record<string, string>; fermer: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/entreprises/export', { motif: motif.trim(), filtres });
        if (!r) return;
        if (r.statut === 201) {
          const c = r.corps as { aujourdhui: string; lignes: LigneExport[] };
          telecharger(c.lignes, c.aujourdhui);
          toast(phrase('console.ecran.clients.ex.fait', { n: c.lignes.length }));
          fermer();
          return;
        }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre('console.ecran.clients.ex.titre')} sous={maj(selon(total, 'console.ecran.clients.resume_tout'))} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" icone="telecharger" occupe={occupe} onClick={envoyer}>{titre('console.ecran.clients.ex.bouton')}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((x) => <li key={x}>{phrase(`console.ecran.clients.ex.${x}`)}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase('console.ecran.clients.ex.motif_aide')} valeur={motif} changer={setMotif} premier faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// Le menu « … » d'une ligne (la maquette Clients : un nom et sa phrase, sans icône) : pointer son paiement quand une
// facture l'attend, puis les gestes que le serveur permet sur son abonnement AUJOURD'HUI à ce rôle (la règle de sa
// fiche), nos échanges (noter un appel, écrire au contact), ce qui détruit, et demander l'accès à son dossier ; un trait
// sépare chaque famille. Un geste ouvre sa fenêtre ici, sur la liste : rien ne fait perdre sa place.
export type FaireDuMenu = { geste: (g: Geste) => void; acces: () => void; appel: () => void; ecrire: () => void };
export function actionsDe(e: Ligne, role: string, faire: FaireDuMenu): ActionLigne[] {
  const out: ActionLigne[] = [];
  const att = e.enPlus.attend;
  if (att && att.reste && (e.etat.etat === 'en_retard' || e.etat.etat === 'essai')) {
    out.push({ titre: titre('console.ecran.clients.m.pointer'), sous: phrase('console.ecran.clients.m.pointer_sous'), faire: () => { location.hash = '#/paiements'; } });
  }
  const action = (g: Geste): ActionLigne => {
    // Le nom, celui de la fiche (libelleDuGeste) ; sa phrase dit le temps qu'il paie, ou qu'il choisisse son offre.
    const cle = g === 'accorder-delai' && e.etat.etat === 'lecture_seule' ? 'accorder_delai_lecture' : g.replace('-', '_');
    const sous = g === 'prolonger' ? phrase(role === 'support' ? 'console.ecran.clients.m.prolonger_support' : e.enPlus.prolongeUneFois ? 'console.ecran.clients.m.prolonger_deja' : 'console.ecran.clients.m.prolonger_sous')
      : g === 'accorder-delai' ? phrase(`console.ecran.clients.m.${cle}${e.faits.offre ? '' : '_choisir'}_sous`)
        : phrase(`console.ecran.clients.m.${cle}_sous`);
    return { titre: libelleDuGeste(g, e.etat), sous, faire: () => faire.geste(g), danger: DETRUIT.has(g) };
  };
  out.push(...e.gestes.filter((g) => !DETRUIT.has(g)).map(action));
  // Un dossier qu'un cabinet tient : on parle au cabinet, depuis sa fiche à lui.
  const tenu = e.etat.etat === 'hors' && e.etat.raison === 'tenu_par_cabinet';
  if (!tenu) {
    out.push({ titre: titre('console.ecran.clients.m.appel'), sous: phrase('console.ecran.clients.m.appel_sous'), faire: faire.appel, trait: out.length > 0 });
    if (e.membres > 0) {
      out.push({ titre: titre('console.ecran.clients.m.ecrire'), sous: e.proprietaire ? `${e.proprietaire.nom} · ${e.proprietaire.email}` : phrase('console.ecran.clients.m.ecrire_sous'), faire: faire.ecrire, donnee: !!e.proprietaire });
    }
  }
  out.push(...e.gestes.filter((g) => DETRUIT.has(g)).map((g, i) => ({ ...action(g), trait: i === 0 && out.length > 0 })));
  if (!tenu) out.push({ titre: titre('console.ecran.clients.m.acces'), sous: phrase('console.ecran.clients.m.acces_sous'), faire: faire.acces, trait: out.length > 0 });
  return out;
}

// Une ligne de la liste, quelle que soit l'organisation (la maquette Clients) : son nom, ce qu'elle est, sa ville et son
// numéro ; l'abonnement et l'état de sa société la plus urgente (un groupe dit les offres de toutes, et l'état qui presse
// le plus) ; l'échéance, ce qu'elle rapporte, son usage du mois, quand on l'a vue ; « Ouvrir » et son menu.
const lienDe = (o: LigneOrg) => (o.sorte === 'groupe' ? `#/clients/groupe/${o.id}` : o.sorte === 'cabinet' ? `#/cabinets/${o.id}` : `#/clients/${o.id}`);
// Chaque morceau reste entier (« E-0094 » ne se coupe jamais au trait d'union) ; la ligne se coupe entre eux, jamais
// avant le point qui les sépare.
function sousNom(o: LigneOrg): string[] {
  const quoi = o.sorte === 'groupe' ? dire('console.ecran.clients.sorte.groupe', { n: o.societes.length })
    : dire(`console.ecran.clients.sorte.${o.sorte}`);
  const numeros = o.sorte === 'groupe' ? o.societes.map((e) => e.numero).filter((x): x is string => !!x) : [o.numero];
  return [maj(quoi), o.ville, ...numeros].filter((x): x is string => !!x);
}
// Les marches d'une arrivée en cinq points (franchie, bloquée, à venir), chacun dit aussi en mots pour qui ne voit pas
// les couleurs : la couleur n'est jamais seule, le texte à côté nomme la marche qui manque.
export function Marches({ a }: { a: Arrivee }) {
  return (
    <span className="c-ar-points" role="img" aria-label={dire('console.ecran.clients.ar.points', { n: a.franchies, total: a.marches.length })}>
      {a.marches.map((m) => <span key={m.id} className={`c-ar-point${m.faite ? ' c-ar-faite' : a.bloquee?.marche === m.id ? ' c-ar-bloquee' : ''}`} />)}
    </span>
  );
}
// Où en est l'arrivée, en mots : « bloquée : première facture · 4 j de retard », « prochaine : première pièce, d'ici le
// 20/10 » (trente jours au plus : l'année va de soi), « arrivée complète ».
export function arriveeEnMots(a: Arrivee): { texte: string; alerte: boolean } {
  if (a.bloquee) return { texte: dire('console.ecran.clients.ar.bloquee', { marche: dire(`console.ecran.clients.ar.m.${a.bloquee.marche}`), n: a.bloquee.depuis }), alerte: true };
  const suivante = a.marches.find((m) => m.id === a.suivante);
  if (!suivante) return { texte: dire('console.ecran.clients.ar.complete'), alerte: false };
  return { texte: dire('console.ecran.clients.ar.prochaine', { marche: dire(`console.ecran.clients.ar.m.${suivante.id}`), le: jourMois(suivante.avant) }), alerte: false };
}
const SousNom = ({ morceaux }: { morceaux: string[] }) => <>{morceaux.map((x, i) => <span key={i}>{i ? '\u00a0· ' : null}<span className="c-insecable">{x}</span></span>)}</>;
function LigneDeLaListe({ o, aujourdhui, role, reserve, arrivees, risques, faireDuMenu }: { o: LigneOrg; aujourdhui: string; role: string; reserve: string | null; arrivees: boolean; risques: boolean; faireDuMenu: (e: Ligne) => FaireDuMenu }) {
  const e = o.societes[0] ?? null;
  const groupe = o.sorte === 'groupe', cabinet = o.sorte === 'cabinet', tenu = o.sorte === 'tenu';
  const m = e ? ligneEnMots(e, aujourdhui) : null;
  const puce = e ? puceDe(e.etat) : { ton: 'hors' as const, texte: dire('console.ecran.etat.hors') };
  const proche = e?.echeance ? joursEntre(aujourdhui, e.echeance) <= 3 : false;
  // Un groupe : les offres de ses sociétés (« Essentiel + Complet »), leurs rythmes, et la remise de groupe.
  const offres = groupe ? [...new Set(o.societes.map((x) => x.faits.offre).filter((x): x is Offre => !!x))].map((x) => dire(`console.ecran.abo.offre.${x}`)) : [];
  const rythmes = groupe ? [...new Set(o.societes.map((x) => x.faits.periodicite).filter((x): x is Periodicite => !!x))].map((x) => dire(`console.ecran.abo.periodicite.${x}`)) : [];
  const remiseGroupe = groupe ? o.societes.map((x) => x.remise).find((r) => r?.nature === 'groupe') ?? null : null;
  const membres = cabinet ? (o.cabinet?.collaborateurs ?? 0) : o.societes.reduce((n, x) => n + x.membres, 0);
  const silencieux = o.societes.some((x) => x.vues.includes('silencieux'));
  const nom = o.nom;
  // La vue des arrivées : la colonne de l'usage dit où en est l'arrivée de la société (la plus urgente d'un groupe).
  const arrivee = arrivees ? o.societes.find((x) => x.arrivee)?.arrivee ?? null : null;
  const ar = arrivee ? arriveeEnMots(arrivee) : null;
  // La vue « à risque » : la colonne de l'usage dit ses signes de départ (ceux de la première société qui en montre).
  const risque = risques ? o.societes.find((x) => (x.risque?.signes.length ?? 0) > 0)?.risque ?? null : null;
  return (
    <tr>
      <td>
        <div className="c-cellule-nom">
          <Avatar nom={nom} nuit={groupe} />
          <div>
            <a href={lienDe(o)}><b data-donnee>{nom}</b></a>
            <span className="c-sous" data-donnee><SousNom morceaux={sousNom(o)} /></span>
          </div>
        </div>
      </td>
      <td className="c-cl-abo">
        {cabinet ? <><b>{maj(dire('console.ecran.clients.cab.offre'))}</b>
          <span className="c-sous">{selon(o.cabinet?.comptes.client ?? 0, 'console.ecran.clients.cab.clients')} · {selon(o.cabinet?.comptes.tenu ?? 0, 'console.ecran.clients.cab.tenus')}</span></>
          : groupe ? <><b data-donnee>{offres.length ? offres.join(' + ') : maj(dire('console.ecran.clients.l.aucune_offre'))}</b>
            {rythmes.length ? <span className="c-sous">{rythmes.join(', ')}</span> : null}
            {remiseGroupe ? <span className="c-cl-remise" data-donnee>{dire('console.ecran.clients.l.remise.groupe', { taux: remiseGroupe.taux })}</span> : null}</>
            : m ? <><b data-donnee>{maj(m.offre)}</b>
              {m.precise ? <span className="c-sous" data-donnee>{m.precise}</span> : null}
              {m.remise ? <span className="c-cl-remise" data-donnee>{m.remise}</span> : null}</> : null}
      </td>
      <td className="c-cl-etat">
        <Puce ton={puce.ton}>{puce.texte}</Puce>
        {cabinet ? <span className="c-sous c-sous-espace">{dire('console.ecran.clients.cab.sans')}</span>
          : m?.phrase ? <span className={`c-sous c-sous-espace${m.alerte ? ' c-cl-proche' : ''}`} data-donnee>{groupe && e ? `${e.raisonSociale} : ${m.phrase}` : m.phrase}</span> : null}
      </td>
      <td className="c-cl-echeance">
        {e?.echeance ? <><b className="c-mono">{jourCourt(e.echeance)}</b><span className={`c-sous${proche ? ' c-cl-proche' : ''}`}>{dansCourt(e.echeance, aujourdhui)}</span></>
          : <><span className="c-cl-rien">—</span><span className="c-sous">{dire(e?.etat.etat === 'lecture_seule' ? 'console.ecran.clients.ech.en_lecture' : 'console.ecran.clients.ech.sans')}</span></>}
      </td>
      <td className="c-droite c-cl-par-an">
        {o.parAnHt ? <><b className="c-mono" data-donnee>{montant(o.parAnHt)}</b>
          {e && !groupe && e.etat.etat === 'actif' && e.etat.periodicite === 'mensuel' ? <span className="c-sous">{dire('console.ecran.clients.mensuel_12')}</span> : null}</>
          : o.attenduHt ? <><b className="c-mono c-cl-attendu" data-donnee>{montant(o.attenduHt)}</b><span className="c-sous">{dire('console.ecran.clients.quand_paye')}</span></>
            : <><span className="c-cl-rien">—</span>{e && !groupe && e.etat.etat === 'actif' && e.etat.resilie ? <span className="c-sous">{dire('console.ecran.clients.ne_revient_pas')}</span> : null}</>}
      </td>
      <td className="c-cl-usage">
        {risque ? <>
          <span className="c-cl-proche">{maj(risque.signes.map((x) => dire(`console.ecran.clients.ri.${x}`)).join(' · '))}</span>
          <span className="c-sous">{risque.usage ? dire('console.ecran.clients.ri.usage', { trente: risque.usage.trente, avant: risque.usage.avant }) : dire('console.ecran.clients.ri.usage_rien')}</span>
        </> : arrivee && ar ? <>
          <span className="c-ar-ligne"><Marches a={arrivee} /><span className={ar.alerte ? 'c-cl-proche' : undefined}>{maj(ar.texte)}</span></span>
          <span className="c-sous">{dire('console.ecran.clients.ar.jour', { n: arrivee.jours + 1 })}</span>
        </> : <>
          {cabinet ? <span>{maj(nombre((o.cabinet?.comptes.client ?? 0) + (o.cabinet?.comptes.tenu ?? 0), 'console.ecran.clients.cab.dossier', 'console.ecran.clients.cab.dossiers_n', 'console.ecran.clients.cab.aucun_dossier'))}</span>
            : tenu ? <span>{maj(dire('console.ecran.clients.tenu_cabinet'))}</span>
              : <span className={o.usage === 0 ? 'c-cl-proche' : undefined}>{maj(nombre(o.usage, 'console.ecran.clients.piece_emise', 'console.ecran.clients.pieces_emises', 'console.ecran.clients.aucune_piece'))}</span>}
          <span className="c-sous">{maj(cabinet ? nombre(membres, 'console.ecran.clients.cab.collaborateur', 'console.ecran.clients.cab.collaborateurs')
            : nombre(membres, 'console.ecran.clients.membre', 'console.ecran.clients.membres', tenu ? 'console.ecran.clients.aucun_membre_tenu' : 'console.ecran.clients.aucun_membre'))}</span>
        </>}
      </td>
      <td className={`c-cl-vu${silencieux ? ' c-cl-proche' : ''}`}>{maj(vuEnMots(o.vu, aujourdhui))}</td>
      <td className="c-droite c-cl-ouvrir">
        <span className="c-boutons-ligne c-cl-boutons">
          <Lien href={lienDe(o)} petit fleche etiquette={titre('console.ecran.clients.ouvrir_fiche', { nom })}><span className="c-cl-ouvrir-mot">{titre('console.ecran.clients.ouvrir')}</span></Lien>
          {e && !cabinet ? (
            <MenuLigne etiquette={titre('console.ecran.clients.menu', { nom })} note={reserve}
              actions={o.societes.flatMap((x) => actionsDe(x, role, faireDuMenu(x))
                .map((a) => (groupe ? { ...a, section: x.raisonSociale } : a)))} />
          ) : <span className="c-cl-sans-menu" aria-hidden="true" />}
        </span>
      </td>
    </tr>
  );
}

export function Clients({ etat: etatDemande, q: qDemande, nouvelles: nouvellesDemande, vue: vueDemandee, tri: triDemande, type: typeDemande, offre: offreDemandee, cabinet: cabinetDemande }:
  { etat: string | null; q: string; nouvelles: boolean; vue: string | null; tri: string | null; type: string | null; offre: string | null; cabinet: string | null }) {
  const { moi } = useConsole();
  const [q, setQ] = useState(qDemande);
  const [qLue, setQLue] = useState(qDemande);
  const [vue, setVue] = useState<VueClients>(vueDe(vueDemandee));
  const [tri, setTri] = useState<Tri>(triDe(triDemande));
  const [etat, setEtat] = useState<Categorie | null>(CATEGORIES.includes(etatDemande as Categorie) ? etatDemande as Categorie : null);
  const [debut, setDebut] = useState(0);
  const [taille, setTaille] = useState<number>(TAILLES[0]);
  // Les seules inscrites de la semaine : la liste que compte la tuile « Inscriptions » du tableau du matin.
  const [nouvelles, setNouvelles] = useState(nouvellesDemande);
  const [type, setType] = useState<TypeClient | null>(typeDe(typeDemande));
  const [offre, setOffre] = useState<OffreClient | null>(offreDe(offreDemandee));
  const [cabinet, setCabinet] = useState<string | null>(cabinetDemande || null);
  const [exporter, setExporter] = useState(false);
  // Le geste choisi dans le menu d'une ligne, et la demande d'accès à un dossier : leur fenêtre s'ouvre sur la liste.
  const [geste, setGeste] = useState<{ id: string; geste: Geste } | null>(null);
  const [acces, setAcces] = useState<{ id: string; nom: string } | null>(null);
  // Nos échanges, depuis le menu d'une ligne (0110) : noter un appel, écrire au contact.
  const [appel, setAppel] = useState<{ id: string; nom: string } | null>(null);
  const [ecrire, setEcrire] = useState<{ client: { id: string; nom: string }; contexte: Contexte } | null>(null);

  // Une recherche lancée d'ailleurs (la barre du haut, un chiffre du tableau du matin) remplace celle-ci.
  useEffect(() => {
    setQ(qDemande); setQLue(qDemande); setDebut(0); setNouvelles(nouvellesDemande);
    setEtat(CATEGORIES.includes(etatDemande as Categorie) ? etatDemande as Categorie : null);
    setVue(vueDe(vueDemandee)); setTri(triDe(triDemande));
    setType(typeDe(typeDemande)); setOffre(offreDe(offreDemandee)); setCabinet(cabinetDemande || null);
  }, [qDemande, etatDemande, nouvellesDemande, vueDemandee, triDemande, typeDemande, offreDemandee, cabinetDemande]);
  // La frappe se lit après un temps de pause, et l'adresse suit (elle se recopie, elle se garde en favori).
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim() !== qLue) { setQLue(q.trim()); setDebut(0); } }, 300);
    return () => clearTimeout(t);
  }, [q, qLue]);
  // La sélection, telle que l'adresse la garde et que l'export la reprend : ce qui s'exporte est ce qui se voit.
  const selection: Record<string, string> = Object.fromEntries(([['nouvelles', nouvelles ? '1' : ''], ['vue', vue !== 'tout' ? vue : ''], ['etat', etat ?? ''],
    ['q', qLue], ['type', type ?? ''], ['offre', offre ?? ''], ['cabinet', cabinet ?? ''], ['tri', tri !== 'urgence' ? tri : '']] as [string, string][]).filter(([, v]) => v !== ''));
  const cleSelection = new URLSearchParams(selection).toString();
  useEffect(() => { history.replaceState(null, '', `#/clients${cleSelection ? `?${cleSelection}` : ''}`); }, [cleSelection]);

  const p = new URLSearchParams({ limite: String(taille), debut: String(debut), ...selection });
  const [l, relire] = useLecture<Liste>(`/console/entreprises?${p.toString()}`, 'clients');
  const lu = l.etat === 'lu' ? l.donnees : null;
  const aujourdhui = lu?.aujourdhui ?? moi.aujourdhui;
  const choisir = (c: Categorie | null) => { setEtat(c); setDebut(0); };
  // Une vue du métier est un raccourci : elle ouvre toute sa liste, quelle que soit la puce d'état choisie avant.
  const choisirVue = (v: VueClients) => { setVue(v); setEtat(null); setDebut(0); };
  // Tout ce qui resserre la liste se défait d'un geste : la recherche, les filtres, la vue, la puce, les inscrites de la semaine.
  const filtre = !!(qLue || type || offre || cabinet || etat || vue !== 'tout' || nouvelles);
  // Les cartes comptent la recherche et les filtres : la première ne se dit « tout le portefeuille » que sans eux.
  const restreint = !!(qLue || type || offre || cabinet || nouvelles);
  const nomDeVue = (v: string) => (v === 'tout' && restreint ? 'tout_selection' : v);
  const toutEffacer = () => { setQ(''); setQLue(''); setType(null); setOffre(null); setCabinet(null); setEtat(null); setVue('tout'); setNouvelles(false); setDebut(0); };
  const direction = moi.role === 'direction';
  const page = Math.floor(debut / taille) + 1;
  const pages = lu ? Math.max(1, Math.ceil(lu.total / taille)) : 1;
  const allerA = (n: number) => setDebut((Math.min(Math.max(n, 1), pages) - 1) * taille);
  // Une aide sous les cartes quand une vue demande un mot de plus (la maquette Clients) : ce qu'on y fait, et pourquoi.
  const aide = vue === 'silencieux' || vue === 'tenus' || vue === 'arrivees' || vue === 'a_risque' ? phrase(`console.ecran.clients.aide.${vue}`) : null;
  // Ce que ce rôle ne fait pas depuis le menu, et qui le fait (le support prolonge un essai, une fois).
  const reserve = direction ? null : phrase('console.ecran.clients.m.reserve');

  return (
    <>
      <EnteteClients action={direction && lu && lu.total > 0
        ? <Bouton icone="telecharger" onClick={() => setExporter(true)}>{titre('console.ecran.clients.ex.ouvrir')}</Bouton> : null} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      <div className="c-vues" role="group" aria-label={titre('console.ecran.clients.vues')}>
        {VUES.map((v) => (
          <button key={v} type="button" className="c-vue" aria-pressed={vue === v} onClick={() => choisirVue(v)}>
            <span className="c-vue-titre"><span>{titre(`console.ecran.clients.vue.${nomDeVue(v)}`)}</span><span className={`c-pilule-point c-point-v-${v}`} aria-hidden="true" /></span>
            <span className="c-vue-n">{lu ? lu.vues[v] : '·'}</span>
            <span className="c-vue-sous">{maj(dire(`console.ecran.clients.vue.${nomDeVue(v)}_sous`))}</span>
          </button>
        ))}
      </div>
      <section className="c-carte c-liste-carte" aria-label={titre('console.ecran.clients.titre')}>
        <div className="c-liste-outils">
          {nouvelles ? (
            <span className="c-filtre-actif">
              {titre('console.ecran.clients.nouvelles')}
              <button type="button" aria-label={titre('console.ecran.clients.retirer_filtre')} title={titre('console.ecran.clients.retirer_filtre')}
                onClick={() => { setNouvelles(false); setDebut(0); }}><Icone nom="croix" taille={15} /></button>
            </span>
          ) : null}
          <div className="c-pilules" role="group" aria-label={titre('console.ecran.clients.etats')}>
            <button type="button" className="c-pilule" aria-pressed={etat === null} onClick={() => choisir(null)}>
              {titre('console.ecran.clients.tous')} <span className="c-pilule-n">{lu ? lu.tous : '·'}</span>
            </button>
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className="c-pilule" aria-pressed={etat === c} onClick={() => choisir(c)}>
                <span className={`c-pilule-point c-point-${c}`} aria-hidden="true" />
                {titre(`console.ecran.etat.${c}`)} <span className="c-pilule-n">{lu ? lu.comptes[c] : '·'}</span>
              </button>
            ))}
          </div>
          <div className="c-cl-filtres" role="group" aria-label={titre('console.ecran.clients.filtres')}>
            <label className="c-recherche">
              <span className="c-cache">{titre('console.ecran.chercher_label')}</span>
              <Icone nom="chercher" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={titre('console.ecran.clients.chercher')} />
            </label>
            <label className="c-cl-filtre">
              <span className="c-cache">{titre('console.ecran.clients.filtre.type')}</span>
              <select className="c-select" value={type ?? ''} onChange={(e) => { setType(typeDe(e.target.value)); setDebut(0); }}>
                <option value="">{titre('console.ecran.clients.type.tous')}</option>
                {TYPES.map((t) => <option key={t} value={t}>{`${titre(`console.ecran.clients.type.${t}`)} (${lu ? lu.options.type[t] : '·'})`}</option>)}
              </select>
            </label>
            <label className="c-cl-filtre">
              <span className="c-cache">{titre('console.ecran.clients.filtre.offre')}</span>
              <select className="c-select" value={offre ?? ''} onChange={(e) => { setOffre(offreDe(e.target.value)); setDebut(0); }}>
                <option value="">{titre('console.ecran.clients.offre.toutes')}</option>
                {OFFRES.map((o) => <option key={o} value={o}>{`${titre(`console.ecran.clients.offre.${o}`)} (${lu ? lu.options.offre[o] : '·'})`}</option>)}
              </select>
            </label>
            <label className="c-cl-filtre">
              <span className="c-cache">{titre('console.ecran.clients.filtre.cabinet')}</span>
              <select className="c-select" value={cabinet ?? ''} onChange={(e) => { setCabinet(e.target.value || null); setDebut(0); }}>
                <option value="">{titre('console.ecran.clients.cabinet.tous')}</option>
                <option value={SANS_CABINET}>{`${titre('console.ecran.clients.cabinet.aucun')} (${lu ? lu.options.sansCabinet : '·'})`}</option>
                {/* Le cabinet choisi reste dans la liste même quand la sélection ne le montre plus : on voit ce qu'on a choisi. */}
                {[...(lu?.options.cabinet ?? []), ...(cabinet && cabinet !== SANS_CABINET && !lu?.options.cabinet.some((c) => c.nom === cabinet) ? [{ nom: cabinet, n: 0 }] : [])]
                  .map((c) => <option key={c.nom} value={c.nom} data-donnee>{`${c.nom} (${c.n})`}</option>)}
              </select>
            </label>
            {filtre ? <Bouton ton="discret" petit icone="croix" onClick={toutEffacer}>{titre('console.ecran.clients.effacer_filtres')}</Bouton> : null}
          </div>
          {aide ? <p className="c-cl-aide"><Icone nom="info" taille={16} /><span>{aide}</span></p> : null}
        </div>
        {!lu ? (l.etat === 'lecture' ? <p className="c-vide">{titre('console.ecran.lecture')}</p> : null)
          : lu.total === 0 ? (
            // Rien du tout, rien qui réponde à la recherche ou aux inscrites de la semaine ; sinon c'est la vue ou la puce
            // choisie qui est vide, et elle le dit avec le geste qui rend tout le portefeuille.
            lu.vues.tout === 0 ? (
              !qLue && !nouvelles ? <Vide icone="clients">{phrase('console.ecran.clients.vide')}</Vide>
                : qLue ? <Vide icone="chercher"><span>{phrase('console.ecran.clients.rien_trouve')}</span> <Bouton ton="discret" petit onClick={() => setQ('')}>{titre('console.ecran.clients.effacer')}</Bouton></Vide>
                  : <Vide icone="clients">{phrase('console.ecran.clients.aucune_nouvelle')}</Vide>
            ) : vue !== 'tout' && !etat ? (
              <Vide icone="clients"><span>{phrase(`console.ecran.clients.vue_vide.${vue}`)}</span> <Bouton ton="discret" petit onClick={() => choisirVue('tout')}>{titre('console.ecran.clients.voir_tout')}</Bouton></Vide>
            ) : (type || offre || cabinet) && !etat ? (
              <Vide icone="chercher"><span>{phrase('console.ecran.clients.rien_filtre')}</span> <Bouton ton="discret" petit onClick={toutEffacer}>{titre('console.ecran.clients.effacer_filtres')}</Bouton></Vide>
            ) : <Vide icone="clients">{phrase('console.ecran.clients.aucune_dans_etat')}</Vide>
          ) : (
            <>
              <div className="c-liste-resume">
                <p>
                  <b>{lu.total > lu.lignes.length
                    ? dire('console.ecran.clients.resume', { debut: debut + 1, fin: debut + lu.lignes.length, total: lu.total })
                    : maj(selon(lu.total, 'console.ecran.clients.resume_tout'))}</b>
                  {' · '}
                  {lu.parAn.abonnements === 0 ? dire('console.ecran.clients.par_an_0')
                    : <>{selon(lu.parAn.abonnements, 'console.ecran.clients.par_an')} <b className="c-mono" data-donnee>{montant(lu.parAn.montantHt)}</b> {dire('console.ecran.clients.par_an_fin')}</>}
                </p>
                <label className="c-tri">
                  <span>{titre('console.ecran.clients.trier')}</span>
                  <select className="c-select" value={tri} onChange={(e) => { setTri(triDe(e.target.value)); setDebut(0); }}>
                    {TRIS.map((t) => <option key={t} value={t}>{titre(`console.ecran.clients.tri.${t}`)}</option>)}
                  </select>
                </label>
              </div>
              <div className="c-defile">
                <table className="c-table c-table-clients">
                  <thead>
                    <tr>
                      <th scope="col">{titre('console.ecran.clients.colonne.organisation')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.abonnement')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.etat')}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.echeance')}</th>
                      <th scope="col" className="c-droite">{titre('console.ecran.clients.colonne.par_an')}</th>
                      <th scope="col">{vue === 'arrivees' ? titre('console.ecran.clients.colonne.arrivee') : vue === 'a_risque' ? titre('console.ecran.clients.colonne.risque') : titre('console.ecran.clients.colonne.usage_mois', { mois: deMois(aujourdhui.slice(0, 7), false) })}</th>
                      <th scope="col">{titre('console.ecran.clients.colonne.vu')}</th>
                      <th scope="col"><span className="c-cache">{titre('console.ecran.clients.ouvrir')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lu.lignes.map((o) => <LigneDeLaListe key={o.id} o={o} aujourdhui={aujourdhui} role={moi.role} reserve={reserve} arrivees={vue === 'arrivees'} risques={vue === 'a_risque'}
                      faireDuMenu={(x) => ({ geste: (g) => setGeste({ id: x.id, geste: g }), acces: () => setAcces({ id: x.id, nom: x.raisonSociale }),
                        appel: () => setAppel({ id: x.id, nom: x.raisonSociale }), ecrire: () => setEcrire({ client: { id: x.id, nom: x.raisonSociale }, contexte: contexteDe(x.etat.etat, x.etat.etat === 'lecture_seule' ? x.etat.raison : undefined) }) })} />)}
                  </tbody>
                </table>
              </div>
              {/* Le compte des lignes se lit au-dessus du tableau : en bas, la page, sa taille, et de quoi tourner les pages. */}
              <nav className="c-liste-pied c-cl-pages" aria-label={titre('console.ecran.clients.pages')}>
                <span className="c-cl-taille">
                  {maj(dire('console.ecran.clients.page_sur', { page, pages }))}
                  <label>
                    <span>{dire('console.ecran.clients.par_page')}</span>
                    <select className="c-select" value={taille} onChange={(e) => { setTaille(Number(e.target.value)); setDebut(0); }}>
                      {TAILLES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                </span>
                {pages > 1 ? (
                  <span className="c-liste-pied-boutons">
                    <Bouton petit desactive={page <= 1} onClick={() => allerA(page - 1)}>{titre('console.ecran.clients.precedente')}</Bouton>
                    {numerosDePages(page, pages).map((x, i) => (x === null ? <span key={`s${i}`} className="c-cl-saut" aria-hidden="true">…</span> : (
                      <button key={x} type="button" className="c-cl-num" aria-current={x === page ? 'page' : undefined}
                        aria-label={titre('console.ecran.clients.aller_page', { n: x })} onClick={() => allerA(x)}>{x}</button>
                    )))}
                    <Bouton petit desactive={page >= pages} onClick={() => allerA(page + 1)}>{titre('console.ecran.clients.suivante')}</Bouton>
                  </span>
                ) : null}
              </nav>
            </>
          )}
      </section>
      <p className="c-cl-notes"><span>{phrase('console.ecran.clients.note_groupe')}</span> <span>{maj(dire('console.ecran.clients.note_par_an'))} <b className="c-cl-verifier">{dire('console.ecran.clients.note_a_verifier')}</b> {dire('console.ecran.clients.note_par_an_fin')}</span></p>
      {exporter && lu ? <FenetreExport total={lu.total} filtres={selection} fermer={() => setExporter(false)} /> : null}
      {geste ? <GesteDuMenu id={geste.id} geste={geste.geste} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
      {acces ? <Demander client={acces} demande={null} fermer={() => setAcces(null)} fait={() => setAcces(null)} /> : null}
      {appel ? <NoterAppel client={appel} fermer={() => setAppel(null)} fait={() => { setAppel(null); relire(); }} /> : null}
      {ecrire ? <EcrireAuContact client={ecrire.client} contexte={ecrire.contexte} fermer={() => setEcrire(null)} fait={() => setEcrire(null)} /> : null}
    </>
  );
}
