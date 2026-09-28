// ÉCRIT par base/generer-types.ts à partir des migrations : ne pas le modifier à la main.
// (Un test tombe si ce fichier ne suit plus la base.)

import type { ColumnType, Generated } from 'kysely';

// Un jsonb se lit tel quel ; il s'écrit en texte JSON (JSON.stringify), jamais en objet qui
// porterait un bigint.
export type Json = unknown;

export interface BaseDeDonnees {
  'socle.appareil': {
    id: Generated<string>;
    utilisateur: string;
    nom: string;
    type: string;
    premier_vu: Generated<Date>;
    dernier_vu: Date | null;
    reconnu_jusqu_au: Date | null;
    revoque_le: Date | null;
    cle_publique: string | null;
  };
  'socle.audit': {
    id: Generated<string>;
    instant: Generated<Date>;
    entreprise: string | null;
    utilisateur: string | null;
    appareil: string | null;
    geste: string;
    objet_type: string | null;
    objet_id: string | null;
    avant: ColumnType<Json | null, string | null, string | null>;
    apres: ColumnType<Json | null, string | null, string | null>;
    lecture: Generated<boolean>;
    cle_api: string | null;
  };
  'socle.chaine': {
    entreprise: string;
    cle: string;
    rang: Generated<bigint>;
    derniere: Generated<string>;
    controle_le: Date | null;
    controle_ok: boolean | null;
  };
  'socle.cle_api': {
    id: Generated<string>;
    entreprise: string;
    nom: string;
    prefixe: string;
    empreinte: string;
    gestes: string[];
    cree_par: string;
    cree_le: Generated<Date>;
    expire_le: Date;
    revoquee_le: Date | null;
    revoquee_par: string | null;
    derniere_utilisation: Date | null;
  };
  'socle.code_secours': {
    id: Generated<string>;
    utilisateur: string;
    empreinte: string;
    utilise_le: Date | null;
  };
  'socle.compteur': {
    serie: string;
    entreprise: string;
    periode: number;
    dernier: bigint;
    repris: bigint | null;
  };
  'socle.defi_connexion': {
    id: Generated<string>;
    utilisateur: string;
    appareil: string | null;
    methode: string;
    code_empreinte: string | null;
    cree_le: Date;
    expire_le: Date;
    erreurs: Generated<number>;
    resolu_le: Date | null;
  };
  'socle.devise': {
    code: string;
    symbole: string;
    decimales: number;
    nom: string;
  };
  'socle.entreprise': {
    id: Generated<string>;
    organisation: string;
    raison_sociale: string;
    forme_juridique: string | null;
    matricule_fiscal: string | null;
    devise_base: Generated<string>;
    fuseau: Generated<string>;
    debut_exercice_mois: Generated<number>;
    debut_sur_skanfact: Generated<string>;
    active: Generated<boolean>;
    cree_le: Generated<Date>;
  };
  'socle.etablissement': {
    id: Generated<string>;
    entreprise: string;
    code: string;
    nom: string;
    type: Generated<string>;
    actif: Generated<boolean>;
    cree_le: Generated<Date>;
  };
  'socle.file_appareil': {
    appareil: string;
    utilisateur: string;
    dernier_ordre: Generated<bigint>;
  };
  'socle.invitation': {
    id: Generated<string>;
    entreprise: string;
    email: string;
    roles: string[];
    jeton_empreinte: string;
    invite_par: string;
    cree_le: Generated<Date>;
    expire_le: Date;
    acceptee_le: Date | null;
    annulee_le: Date | null;
  };
  'socle.maillon': {
    entreprise: string;
    cle: string;
    rang: bigint;
    objet_type: string;
    objet_id: string;
    contenu: string;
    precedente: string;
    empreinte: string;
    instant: Generated<Date>;
  };
  'socle.mandat': {
    id: Generated<string>;
    cabinet: string;
    entreprise: string;
    accorde_par: string | null;
    debut: string;
    fin: string | null;
    perimetre: Generated<string[]>;
    statut: Generated<string>;
    cree_le: Generated<Date>;
  };
  'socle.mandat_affectation': {
    mandat: string;
    membre: string;
    role: string;
  };
  'socle.membre': {
    id: Generated<string>;
    utilisateur: string;
    organisation: string | null;
    entreprise: string | null;
    roles: string[];
    etablissements: Generated<string[]>;
    actif: Generated<boolean>;
    invite_par: string | null;
    depuis: Generated<Date>;
  };
  'socle.migration': {
    numero: number;
    nom: string;
    empreinte: string;
    appliquee_le: Generated<Date>;
  };
  'socle.operation': {
    id: string;
    appareil: string;
    utilisateur: string;
    entreprise: string | null;
    ordre: bigint;
    geste: string;
    format: number;
    revision_vue: bigint | null;
    instant_poste: Date;
    recu_le: Generated<Date>;
    horloge_ecartee: Generated<boolean>;
    charge: ColumnType<Json, string, string>;
    statut: string;
    motif: string | null;
    resultat: ColumnType<Json | null, string | null, string | null>;
    resolue_le: Date | null;
    resolue_par: string | null;
    resolution: string | null;
  };
  'socle.organisation': {
    id: Generated<string>;
    type: string;
    nom: string;
    code_cabinet: string | null;
    cree_le: Generated<Date>;
  };
  'socle.regle_entreprise': {
    id: Generated<string>;
    entreprise: string;
    code: string;
    valeur: ColumnType<Json, string, string>;
    debut: string;
    fin: string | null;
    motif: string;
    cree_par: string;
    cree_le: Generated<Date>;
  };
  'socle.regle_fiscale': {
    id: Generated<string>;
    code: string;
    valeur: ColumnType<Json, string, string>;
    debut: string;
    fin: string | null;
    source: string;
    verifiee_par: string | null;
    verifiee_le: string | null;
    cree_le: Generated<Date>;
  };
  'socle.serie': {
    id: Generated<string>;
    entreprise: string;
    etablissement: string | null;
    type: string;
    prefixe: string;
    remise: Generated<string>;
    format: Generated<string>;
    legale: boolean;
    active: Generated<boolean>;
    cree_le: Generated<Date>;
  };
  'socle.session': {
    id: Generated<string>;
    utilisateur: string;
    appareil: string | null;
    jeton_empreinte: string;
    ouverte_le: Date;
    derniere_activite: Date;
    inaction_max: string;
    poste_d_un_autre: Generated<boolean>;
    code_a_configurer: Generated<boolean>;
    fermee_le: Date | null;
    ip: string | null;
  };
  'socle.tentative': {
    cle: string;
    erreurs: Generated<number>;
    attente_jusqu_au: Date | null;
    derniere: Date | null;
  };
  'socle.tiers': {
    id: Generated<string>;
    entreprise: string;
    nature: Generated<string>;
    raison_sociale: string;
    identifiant: string | null;
    type_identifiant: string | null;
    adresse: string | null;
    pays: Generated<string>;
    email: string | null;
    telephone: string | null;
    devise: Generated<string>;
    roles: Generated<string[]>;
    revision: Generated<bigint>;
    cree_le: Generated<Date>;
    modifie_le: Generated<Date>;
  };
  'socle.transfert_propriete': {
    id: Generated<string>;
    entreprise: string;
    de: string;
    vers: string;
    demande_le: Generated<Date>;
    accepte_le: Date | null;
    annule_le: Date | null;
  };
  'socle.utilisateur': {
    id: Generated<string>;
    email: string;
    nom: string;
    telephone: string | null;
    telephone_verifie_le: Date | null;
    langue: Generated<string>;
    empreinte_mot_de_passe: string | null;
    cree_le: Generated<Date>;
    code_methode: string | null;
    code_secret: string | null;
  };
  'ventes.ligne': {
    id: Generated<string>;
    piece: string;
    entreprise: string;
    rang: number;
    designation: string;
    description: string | null;
    quantite: bigint;
    prix_unitaire: bigint;
    taux_tva: bigint;
    sans_remise: Generated<boolean>;
    ht: bigint | null;
    tva: bigint | null;
    ttc: bigint | null;
  };
  'ventes.piece': {
    id: Generated<string>;
    entreprise: string;
    type: string;
    statut: Generated<string>;
    tiers: string;
    date_piece: string;
    echeance: string | null;
    devise: Generated<string>;
    cours: bigint | null;
    taux_remise: Generated<bigint>;
    taux_retenue: Generated<bigint>;
    appliquer_timbre: boolean | null;
    objet: string | null;
    notes: string | null;
    serie: string | null;
    numero: bigint | null;
    numero_texte: string | null;
    total_ht: bigint | null;
    remise: bigint | null;
    net_ht: bigint | null;
    total_tva: bigint | null;
    timbre: bigint | null;
    timbre_base: bigint | null;
    total_ttc: bigint | null;
    retenue: bigint | null;
    net_a_payer: bigint | null;
    tva_par_taux: ColumnType<Json | null, string | null, string | null>;
    copie: ColumnType<Json | null, string | null, string | null>;
    chaine_rang: bigint | null;
    empreinte: string | null;
    emise_le: Date | null;
    emise_par: string | null;
    cree_par: string;
    cree_le: Generated<Date>;
    modifie_le: Generated<Date>;
    revision: Generated<bigint>;
  };
}
