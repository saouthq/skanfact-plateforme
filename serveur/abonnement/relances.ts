// Les relances de l'abonnement (docs/abonnement.md ; skanfact docs/cadrage/07-offres-et-prix.md, 10-console.md § 2.4) :
// aux jours que la règle du jour dit (0104 ; à la mise en place, quinze jours, sept jours et la veille de l'échéance),
// puis le jour où l'entreprise passe en lecture seule. Chaque heure,
// le serveur regarde les échéances proches, et prévient qui gère l'abonnement (le propriétaire, les administrateurs).
//
// Une relance part une fois par échéance (plateforme.relance_abonnement) : une échéance qui change (un paiement, un
// essai prolongé) a les siennes. Un envoi qui échoue n'est pas noté : il se retente au tour suivant.
//
// Ce qui part chez le relais d'e-mails, compté et décidé (règle du projet ; décidé le 12/10/2026, comme l'alerte de la
// messagerie) : l'adresse, un objet, la date d'échéance, et l'adresse de l'application. Ni le nom de l'entreprise, ni
// un identifiant, ni un montant.

import { enTantQue } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { rendre, t } from '../../textes/index.ts';
import { etatAbonnement, graceDe, jourEnFrancais, lireFaits, relanceDue } from './etat.ts';
import './textes.ts';

type AExaminer = { entreprise: string; faits: Record<string, unknown>; parties: { echeance: string; rang: string }[]; adresses: string[] };

// Un tour : le nombre de relances parties (une par entreprise et par rang, quel que soit le nombre d'adresses).
export async function relancerLesAbonnements(ctx: Contexte, maintenant: Date = ctx.maintenant?.() ?? new Date()): Promise<number> {
  const courriel = ctx.courriel;
  if (!courriel) return 0;
  const jour = aujourdhuiATunis(maintenant);
  const liste = await enTantQue(ctx.pool, null, async (tx) =>
    (await tx.query('select plateforme.relances_a_examiner($1::date) l', [jour])).rows[0].l as AExaminer[]);
  let parties = 0;
  for (const a of liste) {
    const faits = lireFaits(a.faits);
    const due = relanceDue(faits, jour, a.parties.map((p) => ({ echeance: String(p.echeance), rang: String(p.rang) })));
    if (!due || !a.adresses.length) continue;
    const e = etatAbonnement(faits, jour);
    // L'essai, une période payée, ou la lecture seule ; et le jour que l'e-mail dit : l'échéance, ou celui de la lecture seule.
    const nature = due.rang === 'lecture_seule' ? 'lecture_seule' : e.etat === 'actif' ? 'abonnement' : 'essai';
    const date = e.etat === 'lecture_seule' ? e.depuis : due.echeance;
    const quand = due.jours <= 0 ? t('abonnement.relance.quand.aujourdhui') : due.jours === 1 ? t('abonnement.relance.quand.demain')
      : t('abonnement.relance.quand.jours', { jours: due.jours });
    // Ce qui suit l'échéance : la grâce de cette échéance-là (une grâce qu'on ne connaît pas ne se promet pas : aucune).
    const grace = graceDe(faits, due.echeance) ?? 0;
    const apres = grace === 0 ? t('abonnement.relance.apres.sans_grace') : grace === 1 ? t('abonnement.relance.apres.grace_1')
      : t('abonnement.relance.apres.grace_n', { jours: grace });
    // Le français : l'anglais viendra avec son catalogue (vague 4).
    const langue = 'fr';
    try {
      for (const adresse of a.adresses) {
        await courriel.envoi.envoyer({
          a: adresse,
          objet: rendre(t(`abonnement.relance.objet.${nature}`, { quand }), langue),
          texte: rendre(t(`abonnement.relance.texte.${nature}`, { date: jourEnFrancais(date), apres, lien: `${courriel.adresse()}/` }), langue),
          bouton: rendre(t('abonnement.relance.bouton'), langue),
          langue,
        });
      }
    } catch (x) {
      console.error(`une relance d'abonnement n'est pas partie : ${String(x)}`);
      continue;
    }
    await enTantQue(ctx.pool, null, async (tx) => { await tx.query('select plateforme.relance_partie($1, $2::date, $3, $4)', [a.entreprise, due.echeance, due.rang, maintenant]); });
    parties++;
  }
  return parties;
}
