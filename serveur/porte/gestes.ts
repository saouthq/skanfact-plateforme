// Les gestes et qui peut les faire (03 § 2.1). Chaque module DÉCLARE ses gestes (02 M1) ; la porte
// ne connaît que ces déclarations. Une route qui ne déclare pas de geste ne démarre pas (03 D2).
//
// Ici : les gestes du socle (l'entreprise et son équipe). Les modules ajouteront les leurs.

import { t, texteConnu } from '../../textes/index.ts';

export const ROLES_ENTREPRISE = [
  'proprietaire', 'administrateur', 'commercial', 'caissier', 'serveur', 'magasinier', 'comptabilite_interne', 'paie', 'lecture',
] as const;
export const ROLES_CABINET = ['supervision', 'revision', 'saisie', 'paie'] as const;
export type Role = (typeof ROLES_ENTREPRISE)[number] | (typeof ROLES_CABINET)[number];

// Le nom d'un rôle, tel qu'une personne le lit : au catalogue des textes (« role.<code> »).
export const nomDuRole = (r: Role) => t(`role.${r}`);

// « oui » : le geste est permis ; « voir » : lecture seule ; les autres rôles n'ont rien (le geste
// ne paraît pas, D3).
export type Acces = 'oui' | 'voir';

export type Geste = {
  code: string;
  module: string;
  // Ce que le refus dira, « ton rôle ne permet pas de … », est au catalogue des textes : la clé
  // « geste.<code> » (textes/socle.ts, ou les textes du module).
  // Écrit-il quelque chose ? (sinon c'est une lecture : « voir » suffit)
  ecrit: boolean;
  roles: Partial<Record<Role, Acces>>;
  // Le propriétaire est prévenu quand un autre que lui fait ce geste (03 § 7).
  prevenirProprietaire?: boolean;
  // Une donnée sensible : même une LECTURE est tracée (D10).
  sensible?: boolean;
  // Jamais donné à une clé de l'API (03 § 8) : ce qui gouverne l'entreprise reste aux personnes.
  horsCle?: true;
  // Ce qu'il faut au mandat d'un cabinet pour ce geste, quand ce n'est pas le périmètre de son module
  // (03 § 3.4 : les déclarations sont une case à part).
  perimetre?: string[];
  // Réservé au cabinet quand un mandat comprend cette case (03 § 2, C8 : avec un mandat de comptabilité,
  // c'est le cabinet qui valide) : personne de l'entreprise ne le fait alors, et un refus nomme le cabinet.
  auCabinet?: string;
};

const P: Acces = 'oui';
const V: Acces = 'voir';

export const GESTES_SOCLE: Geste[] = [
  { code: 'socle.accueil.voir', module: 'socle', ecrit: false,
    roles: { proprietaire: P, administrateur: P, commercial: P, caissier: P, serveur: P, magasinier: P, comptabilite_interne: P, paie: P, lecture: P } },
  { code: 'socle.fiche_societe.modifier', module: 'socle', ecrit: true,
    roles: { proprietaire: P, administrateur: P, comptabilite_interne: V, lecture: V } },
  { code: 'socle.rib_societe.modifier', module: 'socle', horsCle: true, ecrit: true, prevenirProprietaire: true, sensible: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.reglages_fiscaux.modifier', module: 'socle', ecrit: true,
    roles: { proprietaire: P, administrateur: P, comptabilite_interne: V, lecture: V } },
  { code: 'socle.equipe.gerer', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.propriete.transferer', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P } },
  { code: 'socle.offre.changer', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: V } },
  { code: 'socle.abonnement.payer', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.cabinet.choisir', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P } },
  { code: 'socle.support.autoriser', module: 'socle', horsCle: true, ecrit: true, prevenirProprietaire: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.export_complet', module: 'socle', horsCle: true, ecrit: false, prevenirProprietaire: true, sensible: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.audit.lire', module: 'socle', ecrit: false,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.cles_api.gerer', module: 'socle', horsCle: true, ecrit: true, prevenirProprietaire: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.avis.gerer', module: 'socle', horsCle: true, ecrit: true, prevenirProprietaire: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.abonnement.resilier', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P } },
  // Le dossier que l'interface de la v10 tient en entier (0011, décision de Skander du 28/09/2026) :
  // tant qu'il n'est pas découpé par module, seuls ceux qui voient TOUTE l'entreprise l'ouvrent. Une
  // clé de l'API n'y touche pas : les logiciels branchés passent par les routes de chaque module.
  { code: 'socle.dossier.voir', module: 'socle', horsCle: true, ecrit: false,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.dossier.modifier', module: 'socle', horsCle: true, ecrit: true,
    roles: { proprietaire: P, administrateur: P } },
];

// Les gestes PERSONNELS : ils ne portent sur aucune entreprise (son compte, ses appareils).
export const GESTES_PERSONNELS = [
  'compte.voir', 'compte.deconnecter', 'compte.code.configurer', 'compte.appareils.gerer', 'compte.trace.voir',
  'compte.entreprise.creer', 'compte.invitation.accepter', 'compte.transfert.accepter', 'compte.file.envoyer',
  'compte.a_reprendre.resoudre', 'compte.cabinet.creer', 'compte.cabinets.voir', 'compte.cabinet.gerer', 'public',
] as const;

export function registreDesGestes(...listes: Geste[][]): Map<string, Geste> {
  const registre = new Map<string, Geste>();
  for (const g of listes.flat()) {
    if (registre.has(g.code)) throw new Error(`le geste ${g.code} est déclaré deux fois`);
    if (!/^[a-z_]+(\.[a-z_]+)+$/.test(g.code)) throw new Error(`nom de geste invalide : ${g.code}`);
    if (!texteConnu(`geste.${g.code}`)) throw new Error(`le geste ${g.code} n'a pas son texte au catalogue (geste.${g.code})`);
    registre.set(g.code, g);
  }
  return registre;
}

export const GESTES = registreDesGestes(GESTES_SOCLE);

// Un module déclare ses gestes au démarrage (02 M1) ; un geste déjà déclaré ne se remplace pas.
export function declarerGestes(liste: Geste[]): void {
  for (const g of registreDesGestes(liste).values()) {
    if (GESTES.has(g.code)) throw new Error(`le geste ${g.code} est déclaré deux fois`);
    GESTES.set(g.code, g);
  }
}
