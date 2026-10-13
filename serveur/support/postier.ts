// L'alerte par e-mail d'une réponse du support (Support S1 ; docs/support.md ; 0095) : chaque minute, avec le postier de
// la messagerie, le serveur cherche qui a une réponse de l'équipe SkanFact non lue depuis plus de cinq minutes
// (plateforme.support_alertes_dues), et le prévient — une fois par réponse, jamais deux.
//
// Ce qui part chez le relais, compté et décidé (règle du projet) : l'adresse de la personne, un objet et un texte FIXES
// qui ne portent que l'adresse de l'application. Ni la réponse, ni son auteur, ni le sujet de la demande, ni le nom de
// l'entreprise (comme l'alerte de la messagerie, décidée le 09/10/2026 : « une alerte e-mail sans contenu »). Plusieurs
// réponses non lues pour la même personne : un seul e-mail par tour.

import { enTantQue } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { rendre, t } from '../../textes/index.ts';
import { DELAI_ALERTE_MINUTES } from '../messagerie/postier.ts';
import './textes.ts';

type Due = { demande: string; utilisateur: string; email: string; langue: string };

// Un tour : le nombre d'e-mails partis. Un envoi qui échoue se retente au tour suivant (rien n'est noté pour lui).
export async function prevenirDesReponses(ctx: Contexte, maintenant: Date = ctx.maintenant?.() ?? new Date()): Promise<number> {
  const courriel = ctx.courriel;
  if (!courriel) return 0;
  const dues = await enTantQue(ctx.pool, null, async (tx) =>
    (await tx.query('select plateforme.support_alertes_dues($1, make_interval(mins => $2)) d', [maintenant, DELAI_ALERTE_MINUTES])).rows[0].d as Due[]);
  const parPersonne = new Map<string, Due[]>();
  for (const d of dues) parPersonne.set(d.utilisateur, [...(parPersonne.get(d.utilisateur) ?? []), d]);
  let partis = 0;
  for (const demandes of parPersonne.values()) {
    const p = demandes[0];
    if (!p) continue;
    // Le français : l'anglais viendra avec son catalogue (vague 4).
    const langue = 'fr';
    try {
      await courriel.envoi.envoyer({
        a: p.email,
        objet: rendre(t('support.alerte.objet'), langue),
        texte: rendre(t('support.alerte.texte', { lien: `${courriel.adresse()}/` }), langue),
        bouton: rendre(t('support.alerte.bouton'), langue),
        langue,
      });
    } catch (e) {
      console.error(`une alerte du support n'est pas partie : ${String(e)}`);
      continue;
    }
    await enTantQue(ctx.pool, null, async (tx) => {
      for (const d of demandes) await tx.query('select plateforme.support_alerte_partie($1, $2)', [d.demande, maintenant]);
    });
    partis++;
  }
  return partis;
}
