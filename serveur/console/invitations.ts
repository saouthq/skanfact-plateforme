// Rejoindre l'équipe SkanFact par une invitation (0118 ; docs/console.md C41). Le lien ne donne rien seul : qui l'ouvre
// prouve qu'il tient le compte de l'adresse invitée (son mot de passe, compté avec les erreurs de connexion), ou crée ce
// compte s'il n'existe pas (la règle des mots de passe de l'application). L'adresse est toujours celle de l'invitation.

import { createHash } from 'node:crypto';
import { enTantQue } from '../base.ts';
import { attenteLisible, inscrire, type Contexte } from '../connexion.ts';
import { correspond, verifierPourRien } from '../mot-de-passe.ts';
import { motif, type Texte } from '../../textes/index.ts';

export const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
export const JOURS_INVITATION = 7;

export type Apercu = { invitation: string; email: string; role: string; invitePar: string; expire: Date; compte: boolean };

export async function apercuInvitation(ctx: Contexte, jeton: string, maintenant: Date): Promise<Apercu | null> {
  const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from plateforme.apercu_invitation_console($1, $2)', [sha256(jeton), maintenant])).rows[0]) as
    { invitation: string; email: string; role: string; invite_par: string; expire_le: Date; compte: boolean } | undefined;
  return r ? { invitation: r.invitation, email: r.email, role: r.role, invitePar: r.invite_par, expire: r.expire_le, compte: r.compte } : null;
}

export type Acceptee = { ok: true; role: string; code: boolean } | { ok: false; statut: number; motif: Texte; champ?: 'motDePasse' | 'nom' };

export async function accepterInvitation(ctx: Contexte, demande: { jeton: string; motDePasse: string; nom?: string | undefined }, maintenant: Date): Promise<Acceptee> {
  const a = await apercuInvitation(ctx, demande.jeton, maintenant);
  if (!a) return { ok: false, statut: 410, motif: motif('console.invitation.perimee') };
  let utilisateur: string;
  if (a.compte) {
    // Le compte existe : son mot de passe, avec la même attente que la connexion après cinq erreurs.
    const r = await enTantQue(ctx.pool, null, async (tx): Promise<{ utilisateur: string } | Acceptee> => {
      const attente = (await tx.query('select socle.attente_connexion($1, $2) a', [a.email, maintenant])).rows[0].a as Date | null;
      if (attente) return { ok: false, statut: 429, motif: attenteLisible(attente, maintenant) };
      const u = (await tx.query('select * from socle.pour_connexion($1)', [a.email])).rows[0];
      const bon = u?.empreinte ? await correspond(u.empreinte, demande.motDePasse) : await verifierPourRien(demande.motDePasse);
      if (!bon) {
        const plusTard = (await tx.query('select socle.noter_erreur($1, $2) a', [a.email, maintenant])).rows[0].a as Date | null;
        return plusTard ? { ok: false, statut: 429, motif: attenteLisible(plusTard, maintenant) } : { ok: false, statut: 400, motif: motif('connexion.refusee'), champ: 'motDePasse' };
      }
      await tx.query('select socle.effacer_erreurs($1)', [a.email]);
      return { utilisateur: u.utilisateur as string };
    });
    if (!('utilisateur' in r)) return r;
    utilisateur = r.utilisateur;
  } else {
    const nom = demande.nom?.trim() ?? '';
    if (!nom) return { ok: false, statut: 400, motif: motif('console.invitation.nom_manque'), champ: 'nom' };
    const cree = await inscrire(ctx, a.email, nom, demande.motDePasse);
    if (!cree.ok) return { ok: false, statut: 400, motif: cree.motif, champ: 'motDePasse' };
    utilisateur = cree.utilisateur;
  }
  const fait = await enTantQue(ctx.pool, utilisateur, async (tx) => (await tx.query('select plateforme.accepter_invitation_console($1, $2) v', [sha256(demande.jeton), maintenant])).rows[0].v) as
    { role: string; code: boolean };
  return { ok: true, role: fait.role, code: fait.code };
}
