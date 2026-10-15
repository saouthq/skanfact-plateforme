// L'invitation, envoyée par SkanFact (0119 ; docs/console.md C42 ; décidé par Skander le 15/10/2026). Trois portes : l'équipe
// d'une entreprise, celle d'un cabinet, l'équipe SkanFact. Le lien n'existe qu'ici et dans le message (la base n'en garde
// que l'empreinte) ; la personne qui invite le voit aussi une fois, en secours.
//
// Ce qui part chez le relais, compté et décidé : l'adresse invitée, le nom de qui invite, où (l'entreprise, le cabinet,
// l'équipe SkanFact), le rôle, le lien et le jour où il cesse de valoir. Sans relais, rien ne part : l'écran le dit, et le
// lien se transmet à la main.

import { rendre, t } from '../textes/index.ts';
import { enTantQue } from './base.ts';
import type { Contexte } from './connexion.ts';

export type Invitation = { a: string; qui: string; ou: string | null; role: string; lien: string; expire: Date };

// Le jour, à Tunis (jj/mm/aaaa).
const jourATunis = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric' });

// Ce que l'e-mail d'une invitation est devenu (0124, l'audit C07) : « parti » (le relais l'a accepté — ce n'est pas encore
// la preuve qu'il est arrivé), « refuse » (le relais a dit non), « en_attente » (le relais n'a pas répondu à temps : la
// réponse, quand elle vient, est notée), « sans_relais » (ce serveur n'envoie pas d'e-mails : le lien se transmet à la main).
export type EtatCourriel = 'parti' | 'refuse' | 'en_attente' | 'sans_relais';
export const ATTENTE_RELAIS_MS = 8_000;

// Envoie l'invitation, APRÈS que l'invitation est écrite (la route l'appelle une fois sa transaction validée : plus jamais
// un lien envoyé pour une invitation que la base a refusée), et attend la réponse du relais un moment. L'état se note
// sur l'invitation (par l'empreinte de son lien), et celui d'une réponse tardive aussi.
export async function envoyerInvitation(ctx: Contexte, i: Invitation, empreinte: string, attenteMs = ATTENTE_RELAIS_MS): Promise<EtatCourriel> {
  const noter = (etat: EtatCourriel) => enTantQue(ctx.pool, null, (tx) => tx.query('select socle.noter_courriel_invitation($1, $2, $3)',
    [empreinte, etat, (ctx.maintenant ?? (() => new Date()))()])).catch((e: unknown) => { console.error(`l'état de l'invitation n'est pas noté : ${String(e)}`); });
  const courriel = ctx.courriel;
  if (!courriel) { await noter('sans_relais'); return 'sans_relais'; }
  const langue = 'fr';
  const valeurs = { qui: i.qui, ou: i.ou ?? '', role: i.role, lien: i.lien, le: jourATunis(i.expire), email: i.a };
  const cle = i.ou === null ? 'invitation.equipe' : 'invitation.membre';
  let finie = false;
  const envoi = courriel.envoi.envoyer({
    a: i.a,
    objet: rendre(t(`${cle}_objet`, valeurs), langue),
    texte: rendre(t(`${cle}_texte`, valeurs), langue),
    bouton: rendre(t(`${cle}_bouton`, valeurs), langue),
    langue,
  }).then((): EtatCourriel => 'parti', (e: unknown): EtatCourriel => { console.error(`l'invitation n'est pas partie : ${String(e)}`); return 'refuse'; })
    .then(async (etat) => { finie = true; await noter(etat); return etat; });
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<EtatCourriel>((r) => { minuterie = setTimeout(() => r('en_attente'), attenteMs); });
  const etat = await Promise.race([envoi, delai]);
  clearTimeout(minuterie);
  if (etat === 'en_attente' && !finie) await noter('en_attente');
  return etat;
}

// Ce que la réponse en dit : `courriel` (vrai seulement si le relais l'a accepté : l'écran ne dit « partie » que là) et
// `courrielEtat`, pour dire le reste (refusé, en attente du relais, sans relais).
export const enMots = (etat: EtatCourriel) => ({ courriel: etat === 'parti', courrielEtat: etat });

// L'adresse d'un lien de l'application (une invitation dans une entreprise, un cabinet), et celle de la console.
export const lienApplication = (ctx: Contexte, jeton: string) => `${ctx.courriel?.adresse() ?? ''}/?invitation=${encodeURIComponent(jeton)}`;
export const lienConsole = (ctx: Contexte, jeton: string) => `${ctx.courriel?.console?.() ?? `${ctx.courriel?.adresse() ?? ''}/console`}/#/invitation/${jeton}`;

// Un rôle dit dans la phrase (« comme commercial »), d'après le catalogue des rôles.
export const roleDansLaPhrase = (role: string) => rendre(t(`role.${role}`), 'fr').toLowerCase();
