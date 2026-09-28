// Les gestes et qui peut les faire (03 § 2.1). Chaque module DÉCLARE ses gestes (02 M1) ; la porte
// ne connaît que ces déclarations. Une route qui ne déclare pas de geste ne démarre pas (03 D2).
//
// Ici : les gestes du socle (l'entreprise et son équipe). Les modules ajouteront les leurs.

export const ROLES_ENTREPRISE = [
  'proprietaire', 'administrateur', 'commercial', 'caissier', 'serveur', 'magasinier', 'comptabilite_interne', 'paie', 'lecture',
] as const;
export const ROLES_CABINET = ['supervision', 'revision', 'saisie', 'paie'] as const;
export type Role = (typeof ROLES_ENTREPRISE)[number] | (typeof ROLES_CABINET)[number];

export const NOM_ROLE: Record<Role, string> = {
  proprietaire: 'Propriétaire', administrateur: 'Administrateur', commercial: 'Commercial', caissier: 'Caissier',
  serveur: 'Serveur', magasinier: 'Magasinier', comptabilite_interne: 'Comptabilité interne', paie: 'Paie',
  lecture: 'Lecture', supervision: 'Associé', revision: 'Collaborateur', saisie: 'Assistant de saisie',
};

// « oui » : le geste est permis ; « voir » : lecture seule ; les autres rôles n'ont rien (le geste
// ne paraît pas, D3).
export type Acces = 'oui' | 'voir';

export type Geste = {
  code: string;
  module: string;
  // Ce que le refus dira : « ton rôle ne permet pas de <libelle> ».
  libelle: string;
  // Écrit-il quelque chose ? (sinon c'est une lecture : « voir » suffit)
  ecrit: boolean;
  roles: Partial<Record<Role, Acces>>;
  // Le propriétaire est prévenu quand un autre que lui fait ce geste (03 § 7).
  prevenirProprietaire?: boolean;
  // Une donnée sensible : même une LECTURE est tracée (D10).
  sensible?: boolean;
};

const P: Acces = 'oui';
const V: Acces = 'voir';

export const GESTES_SOCLE: Geste[] = [
  { code: 'socle.accueil.voir', module: 'socle', libelle: 'voir l\'accueil', ecrit: false,
    roles: { proprietaire: P, administrateur: P, commercial: P, caissier: P, serveur: P, magasinier: P, comptabilite_interne: P, paie: P, lecture: P } },
  { code: 'socle.fiche_societe.modifier', module: 'socle', libelle: 'modifier la fiche de la société', ecrit: true,
    roles: { proprietaire: P, administrateur: P, comptabilite_interne: V, lecture: V } },
  { code: 'socle.rib_societe.modifier', module: 'socle', libelle: 'modifier le RIB de la société', ecrit: true, prevenirProprietaire: true, sensible: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.reglages_fiscaux.modifier', module: 'socle', libelle: 'modifier le régime fiscal, l\'exercice ou les séries', ecrit: true,
    roles: { proprietaire: P, administrateur: P, comptabilite_interne: V, lecture: V } },
  { code: 'socle.equipe.gerer', module: 'socle', libelle: 'inviter, retirer un membre ou changer un rôle', ecrit: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.propriete.transferer', module: 'socle', libelle: 'transférer la propriété', ecrit: true,
    roles: { proprietaire: P } },
  { code: 'socle.offre.changer', module: 'socle', libelle: 'changer d\'offre ou acheter un module', ecrit: true,
    roles: { proprietaire: P, administrateur: V } },
  { code: 'socle.abonnement.payer', module: 'socle', libelle: 'payer une échéance de l\'abonnement', ecrit: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.cabinet.choisir', module: 'socle', libelle: 'choisir le cabinet ou arrêter son mandat', ecrit: true,
    roles: { proprietaire: P } },
  { code: 'socle.support.autoriser', module: 'socle', libelle: 'accorder un accès au support', ecrit: true, prevenirProprietaire: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.export_complet', module: 'socle', libelle: 'exporter toute l\'entreprise', ecrit: false, prevenirProprietaire: true, sensible: true,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.audit.lire', module: 'socle', libelle: 'lire la trace de toute l\'entreprise', ecrit: false,
    roles: { proprietaire: P, administrateur: P } },
  { code: 'socle.abonnement.resilier', module: 'socle', libelle: 'résilier l\'abonnement', ecrit: true,
    roles: { proprietaire: P } },
];

// Les gestes PERSONNELS : ils ne portent sur aucune entreprise (son compte, ses appareils).
export const GESTES_PERSONNELS = [
  'compte.voir', 'compte.deconnecter', 'compte.code.configurer', 'compte.appareils.gerer', 'compte.trace.voir',
  'compte.entreprise.creer', 'compte.invitation.accepter', 'compte.transfert.accepter', 'public',
] as const;

export function registreDesGestes(...listes: Geste[][]): Map<string, Geste> {
  const registre = new Map<string, Geste>();
  for (const g of listes.flat()) {
    if (registre.has(g.code)) throw new Error(`le geste ${g.code} est déclaré deux fois`);
    if (!/^[a-z_]+(\.[a-z_]+)+$/.test(g.code)) throw new Error(`nom de geste invalide : ${g.code}`);
    registre.set(g.code, g);
  }
  return registre;
}

export const GESTES = registreDesGestes(GESTES_SOCLE);
