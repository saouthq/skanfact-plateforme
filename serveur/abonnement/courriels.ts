// Les e-mails d'une facture de l'abonnement (1.118.0 ; 0170 ; docs/revue-abonnement.md, P2 7) : quand l'entreprise
// SkanFact l'émet, qui gère l'abonnement l'apprend (sinon il fallait revenir voir) ; quand elle est payée, un reçu part.
// Chaque minute, avec le postier : une fois par facture et par nature ; un envoi qui échoue n'est pas noté et se retente
// au tour suivant. Une facture sans personne à prévenir se note quand même : elle ne s'annoncera pas des semaines plus
// tard.
//
// Ce qui part chez le relais d'e-mails, compté et décidé (règle du projet ; 22/10/2026, comme les relances de 0082) :
// l'adresse, un objet, une date (l'échéance de la facture, ou le jour jusqu'où l'abonnement est payé), et l'adresse de
// l'application. Ni le montant, ni le numéro, ni le nom de l'entreprise.

import { enTantQue } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { enPause } from '../service/pauses.ts';
import { rendre, t } from '../../textes/index.ts';
import { jourEnFrancais } from './etat.ts';
import './textes.ts';

type AAnnoncer = { facture: string; nature: 'emise' | 'payee'; le: string | null; adresses: string[] };

// Un tour : le nombre de factures annoncées (une par facture et par nature, quel que soit le nombre d'adresses).
export async function annoncerLesFactures(ctx: Contexte, maintenant: Date = ctx.maintenant?.() ?? new Date()): Promise<number> {
  const courriel = ctx.courriel;
  if (!courriel) return 0;
  // Les e-mails de l'abonnement suivent la pause des relances (0145) : rien ne part pendant elle, tout part après.
  if (await enPause(ctx.pool, 'relances', maintenant)) return 0;
  const liste = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select plateforme.factures_a_annoncer() l')).rows[0].l as AAnnoncer[]);
  let annoncees = 0;
  const langue = 'fr';
  for (const a of liste) {
    const date = typeof a.le === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a.le) ? jourEnFrancais(a.le.slice(0, 10)) : '';
    try {
      for (const adresse of a.adresses) {
        await courriel.envoi.envoyer({
          a: adresse,
          objet: rendre(t(`abonnement.facture.courriel.objet.${a.nature}`), langue),
          texte: rendre(t(`abonnement.facture.courriel.texte.${a.nature}`, { date, lien: `${courriel.adresse()}/` }), langue),
          bouton: rendre(t('abonnement.facture.courriel.bouton'), langue),
          langue,
        });
      }
    } catch (x) {
      console.error(`un e-mail de facture d'abonnement n'est pas parti : ${String(x)}`);
      continue;
    }
    await enTantQue(ctx.pool, null, async (tx) => { await tx.query('select plateforme.facture_annoncee($1, $2, $3)', [a.facture, a.nature, maintenant]); });
    annoncees++;
  }
  return annoncees;
}
