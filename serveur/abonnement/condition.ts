// La lecture seule d'un abonnement, à la porte des gestes (03 D1, deuxième question : « possible ici et maintenant ? » ;
// docs/abonnement.md ; skanfact docs/cadrage/07-offres-et-prix.md).
//
// Ce que la lecture seule ferme, le serveur le ferme lui-même, quoi que l'écran envoie : ce qui a de la valeur et ce qui
// engage, une pièce fiscale NOUVELLE (une facture, un avoir, un ticket, la facture d'une commande en ligne), la caisse
// qu'on ouvre, la lecture d'une facture d'achat. Le reste de la création (un brouillon, une fiche, un achat, un bulletin)
// l'écran le retient AVANT le geste, par la porte de la v10 (`licenceBlock`, sur chaque point de création).
//
// Ce qui reste ouvert, et pourquoi : lire et exporter (jamais de données en otage, 6.4.0) ; ce qui fait sortir de la
// lecture seule (payer, changer d'offre) ; ce qui gouverne l'entreprise sans rien y créer (l'équipe, le cabinet, les
// clés) ; ce que la loi demande pour ce qui EXISTE déjà (signer et déposer une facture émise, la clôture de la caisse,
// la comptabilité et les déclarations) ; parler à son comptable ; noter qu'une pièce déjà émise est payée.
//
// Chaque geste qui écrit a SA ligne ici (un test le vérifie) : un geste nouveau reçoit sa décision, comme une table
// nouvelle reçoit sa place dans l'export.

import { motif, type Texte } from '../../textes/index.ts';
import type { Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import { brancherCondition } from '../porte/porte.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { etatAbonnement, jourEnFrancais, lireFaits, type Etat, type Faits } from './etat.ts';
import './textes.ts';

// « ferme » : refusé en lecture seule ; « ouvert » : permis ; « route » : la route décide, sur ce qu'elle reçoit.
export type Politique = 'ouvert' | 'ferme' | 'route';
export const POLITIQUE_LECTURE_SEULE: Record<string, Politique> = {
  // L'entreprise et sa gouvernance : rien ne s'y crée.
  'socle.fiche_societe.modifier': 'ouvert',
  'socle.rib_societe.modifier': 'ouvert',
  'socle.reglages_fiscaux.modifier': 'ouvert',
  'socle.equipe.gerer': 'ouvert',
  'socle.propriete.transferer': 'ouvert',
  'socle.offre.changer': 'ouvert',
  'socle.abonnement.payer': 'ouvert',
  'socle.abonnement.resilier': 'ouvert',
  'socle.cabinet.choisir': 'ouvert',
  'socle.support.autoriser': 'ouvert',
  // Demander de l'aide au support de SkanFact (docs/support.md) ne crée rien dans le dossier, et c'est souvent ce qui
  // fait sortir de la lecture seule.
  'support.ecrire': 'ouvert',
  // Demander de revenir à une minute passée (docs/sauvegardes-ecran.md) : une demande au support, rien ne change d'ici.
  'socle.sauvegardes.demander': 'ouvert',
  'socle.cles_api.gerer': 'ouvert',
  'socle.avis.gerer': 'ouvert',
  // Le dossier de la v10 : l'écran y retient la création avant le geste ; une modification reste permise (6.4.0 :
  // une faute de frappe se corrige toujours), et un paiement se note sur une pièce déjà émise.
  'socle.dossier.modifier': 'ouvert',
  'socle.dossier.tout': 'ouvert',
  'ventes.prix.modifier': 'ouvert',
  'stock.modifier': 'ouvert',
  'achats.pieces.modifier': 'ouvert',
  'tresorerie.modifier': 'ouvert',
  'tresorerie.comptes.modifier': 'ouvert',
  // Les ventes : une pièce fiscale nouvelle, non ; ce qui finit ou fait payer une pièce déjà émise, oui.
  'ventes.brouillon.modifier': 'ouvert',
  'ventes.facture.emettre': 'ferme',
  'ventes.avoir.emettre': 'ferme',
  'ventes.accord.donner': 'ouvert',
  'ventes.contrat.modifier': 'ouvert',
  'ventes.boutique.facturer': 'route',
  'ventes.client.modifier': 'ouvert',
  'ventes.lien.partager': 'ouvert',
  'ventes.paiement.regler': 'ouvert',
  'ventes.efacture.regler': 'ouvert',
  'ventes.facture.signer': 'ouvert',
  'ventes.facture.envoyer': 'ouvert',
  // La caisse : un ticket encaissé sans réseau AVANT la lecture seule se reçoit (la vente est faite, le ticket imprimé) ;
  // un nouveau, non. La journée se clôt toujours (le Z).
  'caisse.ticket.encaisser': 'route',
  'caisse.session.ouvrir': 'ferme',
  'caisse.session.fermer': 'ouvert',
  'caisse.relais': 'ouvert',
  'caisse.code.poser': 'ouvert',
  'caisse.ticket.rendre': 'ferme',
  'caisse.code_responsable.poser': 'ouvert',
  // La lecture d'une facture d'achat en photo crée un achat.
  'achats.facture.lire': 'ferme',
  // La paie : comme le dossier, l'écran retient la création.
  'paie.dossier.modifier': 'ouvert',
  // La comptabilité et les déclarations : ce que la loi demande pour l'activité passée ne se ferme jamais (07 : aucune
  // obligation légale n'est vendue en option).
  'compta.ecritures.valider': 'ouvert',
  'compta.ecritures.saisir': 'ouvert',
  'compta.lettrage.poser': 'ouvert',
  'compta.declarations.preparer': 'ouvert',
  'compta.liasse.preparer': 'ouvert',
  'compta.questions.poser': 'ouvert',
  'compta.questions.envoyer': 'ouvert',
  'compta.questions.repondre': 'ouvert',
  'compta.exercice.cloturer': 'ouvert',
  'messagerie.ecrire': 'ouvert',
};

// Les faits de l'abonnement d'une entreprise que la personne voit (sinon rien).
export async function faitsDe(tx: Transaction, entreprise: string): Promise<Faits | null> {
  const f = (await tx.query('select plateforme.faits_abonnement($1) f', [entreprise])).rows[0]?.f as Record<string, unknown> | null | undefined;
  return f ? lireFaits(f) : null;
}

export async function etatDe(tx: Transaction, entreprise: string, jour = aujourdhuiATunis()): Promise<Etat | null> {
  const f = await faitsDe(tx, entreprise);
  return f ? etatAbonnement(f, jour) : null;
}

// Le refus d'une entreprise en lecture seule : depuis quand, pourquoi, et le geste qui la rouvre.
export function refusDeLectureSeule(e: Etat): { motif: Texte; bouton: string } | null {
  if (e.etat !== 'lecture_seule') return null;
  return { motif: motif(`abonnement.lecture_seule.${e.raison}`, { depuis: jourEnFrancais(e.depuis) }), bouton: 'socle.abonnement.payer' };
}

// Pour une route qui décide sur ce qu'elle reçoit (« route ») : refuse si l'entreprise est en lecture seule, sauf ce
// qui a été fait AVANT (`faitLe`, un jour de Tunis : un ticket encaissé sans réseau quand l'abonnement courait).
// `jour` : le jour du tour qui appelle (les factures périodiques émises seules), sinon aujourd'hui.
export async function refuserSiLectureSeule(tx: Transaction, entreprise: string, options: { faitLe?: string; jour?: string } = {}): Promise<void> {
  const e = await etatDe(tx, entreprise, options.jour);
  if (!e || e.etat !== 'lecture_seule') return;
  if (options.faitLe && options.faitLe < e.depuis) return;
  const r = refusDeLectureSeule(e);
  if (r) throw new Refus(r.motif.cle, { valeurs: r.motif.valeurs, bouton: r.bouton });
}

// Un dossier tenu PAYANT d'un cabinet qui ne paie plus (1.120.0 ; 0172 ; docs/abonnement.md C22) : la lecture seule
// ferme tout ce qui écrit dans le dossier — la saisie du cabinet comprise, c'est le travail que son abonnement paie —
// sauf parler (au client, au support) et demander de l'aide. Les dossiers gratuits et ceux des clients abonnés ne sont
// jamais touchés. Tout se lit, s'imprime, s'exporte : une lecture ne passe jamais ici.
export const OUVERT_DOSSIER_TENU_BLOQUE: ReadonlySet<string> = new Set(['messagerie.ecrire', 'support.ecrire', 'socle.sauvegardes.demander']);
export async function refusDuDossierTenu(tx: Transaction, entreprise: string, jour = aujourdhuiATunis()): Promise<{ motif: Texte; bouton: string } | null> {
  const depuis = (await tx.query('select plateforme.dossier_tenu_bloque_depuis($1, $2::date) d', [entreprise, jour])).rows[0]?.d as string | null | undefined;
  return depuis ? { motif: motif('abonnement.cabinet.lecture_seule', { depuis: jourEnFrancais(depuis) }), bouton: 'compte.cabinet.gerer' } : null;
}

// Branchée une fois, par l'application (serveur/app.ts) : tout serveur la porte.
let branchee = false;
export function brancherAbonnement(): void {
  if (branchee) return;
  branchee = true;
  brancherCondition(async (tx, entreprise, geste, ecrire) => {
    // Une lecture ne se ferme jamais ; un geste sans ligne ici non plus (le test exige sa ligne).
    if (!ecrire || (POLITIQUE_LECTURE_SEULE[geste.code] ?? 'ouvert') !== 'ferme') return null;
    const e = await etatDe(tx, entreprise);
    return e ? refusDeLectureSeule(e) : null;
  });
  brancherCondition(async (tx, entreprise, geste, ecrire) => {
    if (!ecrire || OUVERT_DOSSIER_TENU_BLOQUE.has(geste.code)) return null;
    return refusDuDossierTenu(tx, entreprise);
  });
}
