// L'alerte par e-mail de la messagerie (lot messagerie, 09/10/2026 ; docs/messagerie.md) : chaque minute, le serveur
// cherche qui a, depuis plus de cinq minutes, un message à lire (messagerie.alertes_dues, 0078), et le prévient.
//
// Ce qui part chez le relais, compté et décidé (règle du projet) : l'adresse de la personne, un objet et un texte FIXES
// qui ne portent que l'adresse de l'application. Ni le message, ni son auteur, ni le nom de l'entreprise ou du cabinet,
// ni un identifiant (décidé le 09/10/2026 : « une alerte e-mail sans contenu »). Une personne reçoit au plus un e-mail
// par tour et par côté, quel que soit le nombre de fils qui l'attendent ; puis plus rien avant d'avoir relu.

import { enTantQue } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { rendre, t } from '../../textes/index.ts';
import './textes.ts';

type Due = { utilisateur: string; email: string; langue: string; cote: 'entreprise' | 'cabinet'; entreprise: string; cabinet: string };

// Le délai avant d'alerter : un message lu dans les cinq minutes (la page ouverte le montre dans la minute) ne fait
// partir aucun e-mail.
export const DELAI_ALERTE_MINUTES = 5;

// Un tour : le nombre d'e-mails partis. Un envoi qui échoue se retente au tour suivant (rien n'est noté pour lui).
export async function prevenirParCourriel(ctx: Contexte, maintenant: Date = ctx.maintenant?.() ?? new Date()): Promise<number> {
  const courriel = ctx.courriel;
  if (!courriel) return 0;
  const dues = await enTantQue(ctx.pool, null, async (tx) =>
    (await tx.query('select messagerie.alertes_dues($1, make_interval(mins => $2)) d', [maintenant, DELAI_ALERTE_MINUTES])).rows[0].d as Due[]);
  const parPersonne = new Map<string, Due[]>();
  for (const d of dues) {
    const cle = `${d.utilisateur}/${d.cote}`;
    parPersonne.set(cle, [...(parPersonne.get(cle) ?? []), d]);
  }
  let partis = 0;
  for (const fils of parPersonne.values()) {
    const p = fils[0];
    if (!p) continue;
    // Le français : l'anglais viendra avec son catalogue (vague 4).
    const langue = 'fr';
    try {
      await courriel.envoi.envoyer({
        a: p.email,
        objet: rendre(t('messagerie.alerte.objet'), langue),
        texte: rendre(t(p.cote === 'cabinet' ? 'messagerie.alerte.cabinet' : 'messagerie.alerte.entreprise', { lien: `${courriel.adresse()}/` }), langue),
        bouton: rendre(t('messagerie.alerte.bouton'), langue),
        langue,
      });
    } catch (e) {
      console.error(`une alerte de la messagerie n'est pas partie : ${String(e)}`);
      continue;
    }
    await enTantQue(ctx.pool, null, async (tx) => {
      for (const f of fils) await tx.query('select messagerie.alerte_partie($1, $2, $3, $4)', [f.utilisateur, f.entreprise, f.cabinet, maintenant]);
    });
    partis++;
  }
  return partis;
}

// (1.116.0, 0168) Les relances des pièces demandées : restée sans réponse à sa date « pour le », une demande se relance
// ce jour-là, puis une fois par semaine, trois fois au plus (messagerie.relances_dues). Le même e-mail sans contenu que
// l'alerte : ni la pièce, ni le cabinet, ni l'entreprise. Une personne reçoit un seul e-mail par tour, quel que soit le
// nombre de demandes qui l'attendent ; une demande se note relancée quand au moins une personne l'a reçue.
type Relance = { message: string; utilisateur: string; email: string; langue: string; entreprise: string; cabinet: string };
export async function relancerLesDemandes(ctx: Contexte, maintenant: Date = ctx.maintenant?.() ?? new Date()): Promise<number> {
  const courriel = ctx.courriel;
  if (!courriel) return 0;
  const dues = await enTantQue(ctx.pool, null, async (tx) =>
    (await tx.query('select messagerie.relances_dues($1) d', [maintenant])).rows[0].d as Relance[]);
  const parPersonne = new Map<string, Relance[]>();
  for (const d of dues) parPersonne.set(d.utilisateur, [...(parPersonne.get(d.utilisateur) ?? []), d]);
  const relancees = new Set<string>();
  let partis = 0;
  for (const demandes of parPersonne.values()) {
    const p = demandes[0];
    if (!p) continue;
    const langue = 'fr';
    try {
      await courriel.envoi.envoyer({
        a: p.email,
        objet: rendre(t('messagerie.relance.objet'), langue),
        texte: rendre(t('messagerie.relance.texte', { lien: `${courriel.adresse()}/` }), langue),
        bouton: rendre(t('messagerie.relance.bouton'), langue),
        langue,
      });
    } catch (e) {
      console.error(`une relance de la messagerie n'est pas partie : ${String(e)}`);
      continue;
    }
    for (const d of demandes) relancees.add(d.message);
    partis++;
  }
  if (relancees.size) {
    await enTantQue(ctx.pool, null, async (tx) => {
      for (const m of relancees) await tx.query('select messagerie.relance_partie($1, $2)', [m, maintenant]);
    });
  }
  return partis;
}
