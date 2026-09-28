// Les phrases que la BASE écrit elle-même (socle.refus, les règles des tables, les motifs du
// contrôle de la chaîne), mot pour mot, et la clé du catalogue qui les dit. Une migration appliquée
// ne se réécrit jamais : la base garde sa phrase, le serveur la reconnaît et la rend dans la langue
// de la personne, avec le texte du catalogue (qui peut dire mieux : sans renvoi aux documents).
// Un test tombe si une phrase de la base n'est pas ici, ou si une ligne d'ici n'est plus dans la base.

import { declarerTextes, t, type Texte } from './textes.ts';

type MessageDeLaBase = { base: string; cle: string; fr: string; valeurs?: string[] };

// `base` : la phrase exacte (un « %s » y tient la place d'une valeur, dans l'ordre de `valeurs`).
export const MESSAGES_DE_LA_BASE: MessageDeLaBase[] = [
  { base: 'personne n\'est connecté : impossible de créer une entreprise', cle: 'base.entreprise.sans_personne', fr: 'personne n\'est connecté : impossible de créer une entreprise' },
  { base: 'ce code n\'est plus valable : recommence la connexion', cle: 'base.connexion.code_perime', fr: 'ce code n\'est plus valable : recommence la connexion' },
  { base: 'personne ne change le mot de passe d\'un autre', cle: 'base.connexion.mot_de_passe_autre', fr: 'personne ne change le mot de passe d\'un autre' },
  { base: 'personne n\'est connecté', cle: 'base.connexion.personne', fr: 'personne n\'est connecté' },
  { base: 'il faut 10 codes de secours', cle: 'base.connexion.codes_secours', fr: 'il faut 10 codes de secours' },
  { base: 'la trace ne se modifie pas et ne s\'efface pas (01 R10)', cle: 'base.trace.intouchable', fr: 'la trace ne se modifie pas et ne s\'efface pas' },
  { base: 'ton rôle ne permet pas d\'inviter quelqu\'un dans l\'équipe', cle: 'base.equipe.inviter_interdit', fr: 'ton rôle ne permet pas d\'inviter quelqu\'un dans l\'équipe' },
  { base: 'tu ne peux pas donner ce rôle', cle: 'base.equipe.role_interdit', fr: 'tu ne peux pas donner ce rôle' },
  { base: 'personne ne s\'invite soi-même', cle: 'base.equipe.soi_meme', fr: 'personne ne s\'invite soi-même' },
  { base: 'cette invitation n\'est plus valable : demande-en une nouvelle', cle: 'base.equipe.invitation_perimee', fr: 'cette invitation n\'est plus valable : demande-en une nouvelle' },
  { base: 'cette invitation a été envoyée à une autre adresse', cle: 'base.equipe.invitation_autre_adresse', fr: 'cette invitation a été envoyée à une autre adresse' },
  { base: 'tu es le propriétaire de cette entreprise : ton rôle ne change pas par une invitation', cle: 'base.equipe.proprietaire_invite', fr: 'tu es le propriétaire de cette entreprise : ton rôle ne change pas par une invitation' },
  { base: 'membre introuvable', cle: 'base.equipe.membre_introuvable', fr: 'membre introuvable' },
  { base: 'personne ne change son propre rôle', cle: 'base.equipe.propre_role', fr: 'personne ne change son propre rôle' },
  { base: 'le rôle du propriétaire ne se change pas : il se transfère', cle: 'base.equipe.role_proprietaire', fr: 'le rôle du propriétaire ne se change pas : il se transfère' },
  { base: 'on ne retire pas le propriétaire : il transfère d\'abord la propriété', cle: 'base.equipe.retirer_proprietaire', fr: 'on ne retire pas le propriétaire : il transfère d\'abord la propriété' },
  { base: 'ton rôle ne permet pas de retirer un membre', cle: 'base.equipe.retirer_interdit', fr: 'ton rôle ne permet pas de retirer un membre' },
  { base: 'ton rôle ne permet pas de retirer un administrateur', cle: 'base.equipe.retirer_administrateur', fr: 'ton rôle ne permet pas de retirer un administrateur' },
  { base: 'seul le propriétaire transfère la propriété', cle: 'base.equipe.transfert_proprietaire', fr: 'seul le propriétaire transfère la propriété' },
  { base: 'la propriété se transfère à un membre de l\'équipe', cle: 'base.equipe.transfert_membre', fr: 'la propriété se transfère à un membre de l\'équipe' },
  { base: 'tu es déjà le propriétaire', cle: 'base.equipe.deja_proprietaire', fr: 'tu es déjà le propriétaire' },
  { base: 'ce transfert n\'est plus valable', cle: 'base.equipe.transfert_perime', fr: 'ce transfert n\'est plus valable' },
  { base: 'une règle ne s\'efface pas : on ferme sa date de fin', cle: 'base.regles.effacer', fr: 'une règle ne s\'efface pas : on ferme sa date de fin' },
  { base: 'une règle ne se modifie pas : on ferme sa date de fin et on en écrit une nouvelle', cle: 'base.regles.modifier', fr: 'une règle ne se modifie pas : on ferme sa date de fin et on en écrit une nouvelle' },
  { base: 'ton rôle ne permet pas de modifier les réglages fiscaux', cle: 'base.regles.interdit', fr: 'ton rôle ne permet pas de modifier les réglages fiscaux' },
  { base: 'une règle commence déjà ce jour-là ou après : on ne réécrit pas le passé', cle: 'base.regles.passe', fr: 'une règle commence déjà ce jour-là ou après : on ne réécrit pas le passé' },
  { base: 'ton rôle ne permet pas de créer une série de numéros', cle: 'base.series.creer_interdit', fr: 'ton rôle ne permet pas de créer une série de numéros' },
  { base: 'série introuvable', cle: 'base.series.introuvable', fr: 'série introuvable' },
  { base: 'ton rôle ne permet pas de modifier une série de numéros', cle: 'base.series.modifier_interdit', fr: 'ton rôle ne permet pas de modifier une série de numéros' },
  { base: 'des numéros ont déjà été donnés dans SkanFact pour cette période : changer la suite trouerait la série', cle: 'base.series.deja_donnes', fr: 'des numéros ont déjà été donnés dans SkanFact pour cette période : changer la suite trouerait la série' },
  { base: 'cette série n\'est plus active', cle: 'base.series.inactive', fr: 'cette série n\'est plus active' },
  { base: 'le journal inaltérable ne se modifie pas et ne s\'efface pas (01 R9)', cle: 'base.journal.intouchable', fr: 'le journal inaltérable ne se modifie pas et ne s\'efface pas' },
  { base: 'entreprise introuvable', cle: 'base.entreprise.introuvable', fr: 'entreprise introuvable' },
  { base: 'maillon manquant', cle: 'base.journal.maillon_manquant', fr: 'un maillon manque' },
  { base: 'ne suit pas le maillon précédent', cle: 'base.journal.ne_suit_pas', fr: 'ce maillon ne suit pas le précédent' },
  { base: 'empreinte fausse', cle: 'base.journal.empreinte_fausse', fr: 'une empreinte est fausse' },
  { base: 'la fin de la chaîne manque', cle: 'base.journal.fin_manque', fr: 'la fin de la chaîne manque' },
  { base: 'une opération reçue ne se modifie pas et ne s\'efface pas', cle: 'base.file.intouchable', fr: 'une opération reçue ne se modifie pas et ne s\'efface pas' },
  { base: 'appareil inconnu ou révoqué', cle: 'base.file.appareil', fr: 'appareil inconnu ou révoqué' },
  { base: 'file introuvable', cle: 'base.file.introuvable', fr: 'file introuvable' },
  { base: 'l\'opération attendue porte le numéro %s', cle: 'base.file.attendue', fr: 'l\'opération attendue porte le numéro {numero}', valeurs: ['numero'] },
  { base: 'opération introuvable', cle: 'base.file.operation_introuvable', fr: 'opération introuvable' },
  { base: 'cette opération a été acceptée : il n\'y a rien à reprendre', cle: 'base.file.rien_a_reprendre', fr: 'cette opération a été acceptée : il n\'y a rien à reprendre' },
  { base: 'cette opération a déjà été reprise', cle: 'base.file.deja_reprise', fr: 'cette opération a déjà été reprise' },
  { base: 'dis en quelques mots ce qui a été fait', cle: 'base.file.dire_quoi', fr: 'dis en quelques mots ce qui a été fait' },
  { base: 'une ligne appartient à l\'entreprise de sa pièce', cle: 'base.ventes.ligne_entreprise', fr: 'une ligne appartient à l\'entreprise de sa pièce' },
  { base: 'le client appartient à l\'entreprise de la pièce', cle: 'base.ventes.client_entreprise', fr: 'le client appartient à l\'entreprise de la pièce' },
  { base: 'une pièce émise ne s\'efface jamais (01 R6)', cle: 'base.ventes.piece_effacer', fr: 'une pièce émise ne s\'efface jamais : on la corrige par un avoir' },
  { base: 'une pièce émise ne se modifie plus : on la corrige par un avoir (01 R6)', cle: 'base.ventes.piece_modifier', fr: 'une pièce émise ne se modifie plus : on la corrige par un avoir' },
  { base: 'une ligne ne change pas de pièce', cle: 'base.ventes.ligne_piece', fr: 'une ligne ne change pas de pièce' },
  { base: 'ton rôle ne permet pas de gérer les clés de l\'API', cle: 'base.cles.interdit', fr: 'ton rôle ne permet pas de gérer les clés de l\'API' },
  { base: 'clé introuvable', cle: 'base.cles.introuvable', fr: 'clé introuvable' },
  { base: 'cette clé est déjà révoquée', cle: 'base.cles.deja_revoquee', fr: 'cette clé est déjà révoquée' },
  { base: 'ton rôle ne permet pas de gérer les avis d\'événement', cle: 'base.avis.interdit', fr: 'ton rôle ne permet pas de gérer les avis d\'événement' },
  { base: 'abonnement introuvable', cle: 'base.avis.introuvable', fr: 'abonnement introuvable' },
  { base: 'cet abonnement est déjà arrêté', cle: 'base.avis.deja_arrete', fr: 'cet abonnement est déjà arrêté' },
  { base: 'une entreprise d\'essai le reste, et une vraie ne le devient jamais', cle: 'base.essai.immuable', fr: 'une entreprise d\'essai le reste, et une vraie ne le devient jamais' },
  { base: 'tu as déjà une entreprise d\'essai', cle: 'base.essai.deja', fr: 'tu as déjà une entreprise d\'essai' },
  { base: 'les lignes d\'une pièce émise ne se modifient plus (01 R6)', cle: 'base.ventes.lignes_emises', fr: 'les lignes d\'une pièce émise ne se modifient plus' },
];

declarerTextes(Object.fromEntries(MESSAGES_DE_LA_BASE.map((m) => [m.cle, m.fr])));

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RECONNUS = MESSAGES_DE_LA_BASE.map((m) => ({ ...m, motif: new RegExp(`^${echapper(m.base).replaceAll('%s', '(.+?)')}$`) }));

// La phrase de la base → le texte du catalogue (null si elle est inconnue : un test l'empêche).
export function reconnaitre(message: string): Texte | null {
  for (const m of RECONNUS) {
    const r = m.motif.exec(message);
    if (r) return t(m.cle, Object.fromEntries((m.valeurs ?? []).map((nom, i) => [nom, r[i + 1] ?? ''])));
  }
  return null;
}
