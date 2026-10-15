// L'invitation, envoyée par SkanFact (0119 ; docs/console.md C42 ; décidé par Skander le 15/10/2026). Trois portes : l'équipe
// d'une entreprise, celle d'un cabinet, l'équipe SkanFact. Le lien n'existe qu'ici et dans le message (la base n'en garde
// que l'empreinte) ; la personne qui invite le voit aussi une fois, en secours.
//
// Ce qui part chez le relais, compté et décidé : l'adresse invitée, le nom de qui invite, où (l'entreprise, le cabinet,
// l'équipe SkanFact), le rôle, le lien et le jour où il cesse de valoir. Sans relais, rien ne part : l'écran le dit, et le
// lien se transmet à la main.

import { rendre, t } from '../textes/index.ts';
import type { Contexte } from './connexion.ts';

export type Invitation = { a: string; qui: string; ou: string | null; role: string; lien: string; expire: Date };

// Le jour, à Tunis (jj/mm/aaaa).
const jourATunis = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric' });

// Envoie l'invitation (sans attendre le relais : un relais lent ne retient pas la réponse). Rend vrai si un e-mail part.
export function envoyerInvitation(ctx: Contexte, i: Invitation): boolean {
  const courriel = ctx.courriel;
  if (!courriel) return false;
  const langue = 'fr';
  const valeurs = { qui: i.qui, ou: i.ou ?? '', role: i.role, lien: i.lien, le: jourATunis(i.expire), email: i.a };
  const cle = i.ou === null ? 'invitation.equipe' : 'invitation.membre';
  void courriel.envoi.envoyer({
    a: i.a,
    objet: rendre(t(`${cle}_objet`, valeurs), langue),
    texte: rendre(t(`${cle}_texte`, valeurs), langue),
    bouton: rendre(t(`${cle}_bouton`, valeurs), langue),
    langue,
  }).catch((e: unknown) => { console.error(`l'invitation n'est pas partie : ${String(e)}`); });
  return true;
}

// L'adresse d'un lien de l'application (une invitation dans une entreprise, un cabinet), et celle de la console.
export const lienApplication = (ctx: Contexte, jeton: string) => `${ctx.courriel?.adresse() ?? ''}/?invitation=${encodeURIComponent(jeton)}`;
export const lienConsole = (ctx: Contexte, jeton: string) => `${ctx.courriel?.console?.() ?? `${ctx.courriel?.adresse() ?? ''}/console`}/#/invitation/${jeton}`;

// Un rôle dit dans la phrase (« comme commercial »), d'après le catalogue des rôles.
export const roleDansLaPhrase = (role: string) => rendre(t(`role.${role}`), 'fr').toLowerCase();
