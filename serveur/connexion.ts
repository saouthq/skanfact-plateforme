// Se connecter (03 § 6). Le parcours, dans l'ordre :
//   1. l'adresse et le mot de passe (une attente qui s'allonge après 5 erreurs, jamais un blocage) ;
//   2. le code sur le téléphone, si la personne en a un ou si son rôle l'exige, sauf sur un appareil
//      déjà reconnu (30 jours) ; un code de secours remplace le code ;
//   3. une session, dont le jeton n'est gardé qu'en empreinte.
//
// Ce qui part chez le fournisseur de SMS : le numéro et le code, RIEN d'autre (03 § 6).

import { createHash, randomBytes, randomInt } from 'node:crypto';
import type pg from 'pg';
import { enTantQue } from './base.ts';
import { correspond, empreinte, verifierPolitique, verifierPourRien, type ListeVolee } from './mot-de-passe.ts';
import { adresseTotp, nouveauSecret, verifierTotp } from './totp.ts';
import { motif, rendre, t, type Texte } from '../textes/index.ts';

export type EnvoiSms = { envoyer: (telephone: string, texte: string) => Promise<void> };

export type Contexte = {
  pool: pg.Pool;
  listeVolee: ListeVolee;
  sms: EnvoiSms;
  maintenant?: () => Date;
  // Le paiement en ligne (brique 78) : l'adresse de l'API du prestataire, la clé du coffre du serveur
  // (serveur/coffre.ts), et l'adresse publique du serveur (où reviennent l'avis et le client).
  paiement?: { konnect: string; coffre: Buffer; adresse: () => string };
};

export type Appareil = { id?: string; nom: string; type: 'navigateur' | 'bureau' | 'telephone' };

export type ResultatConnexion =
  | { etat: 'refuse'; motif: Texte }
  | { etat: 'attendre'; jusqua: Date; motif: Texte }
  | { etat: 'code'; defi: string; methode: 'sms' | 'application'; appareil: string }
  | { etat: 'connecte'; jeton: string; appareil: string | null; codeAConfigurer: boolean };

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const DUREE_DEFI = '10 minutes';
const MOTIF_REFUS = () => motif('connexion.refusee');

function attenteLisible(jusqua: Date, maintenant: Date): Texte {
  const minutes = Math.max(1, Math.ceil((jusqua.getTime() - maintenant.getTime()) / 60_000));
  return motif(minutes > 1 ? 'connexion.trop_essais' : 'connexion.trop_essais_une', { minutes });
}

// Un code à 6 chiffres, écrit « 482 913 » dans le message.
const codeSms = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export async function inscrire(ctx: Contexte, email: string, nom: string, motDePasse: string) {
  const politique = verifierPolitique(motDePasse, ctx.listeVolee);
  if (!politique.ok) return politique;
  const e = await empreinte(motDePasse);
  const id = await enTantQue(ctx.pool, null, async (tx) => {
    const u = (await tx.query('select socle.creer_utilisateur($1, $2) id', [email, nom])).rows[0].id as string;
    await tx.query('select socle.poser_mot_de_passe($1, $2)', [u, e]);
    return u;
  });
  return { ok: true as const, utilisateur: id };
}

export async function connecter(ctx: Contexte, demande: {
  email: string; motDePasse: string; appareil: Appareil; posteDUnAutre?: boolean | undefined; ip?: string | undefined;
}): Promise<ResultatConnexion> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const posteDUnAutre = demande.posteDUnAutre ?? false;
  return enTantQue(ctx.pool, null, async (tx) => {
    const attente = (await tx.query('select socle.attente_connexion($1, $2) a', [demande.email, maintenant])).rows[0].a as Date | null;
    if (attente) return { etat: 'attendre', jusqua: attente, motif: attenteLisible(attente, maintenant) };

    const u = (await tx.query('select * from socle.pour_connexion($1)', [demande.email])).rows[0];
    const bon = u?.empreinte ? await correspond(u.empreinte, demande.motDePasse) : await verifierPourRien(demande.motDePasse);
    if (!bon) {
      const a = (await tx.query('select socle.noter_erreur($1, $2) a', [demande.email, maintenant])).rows[0].a as Date | null;
      return a ? { etat: 'attendre', jusqua: a, motif: attenteLisible(a, maintenant) } : { etat: 'refuse', motif: MOTIF_REFUS() };
    }

    // L'appareil : celui qu'on connaît déjà, ou un nouveau.
    let appareil = demande.appareil.id ?? null;
    let reconnu = false;
    if (appareil) reconnu = (await tx.query('select socle.appareil_reconnu($1, $2, $3) r', [u.utilisateur, appareil, maintenant])).rows[0].r;
    if (!appareil || !reconnu) {
      // Un identifiant d'appareil qui n'est pas à cette personne ne sert à rien : on en déclare un.
      const aLui = appareil ? (await tx.query('select socle.appareil_de($1, $2) r', [u.utilisateur, appareil])).rows[0].r : false;
      if (!aLui) appareil = (await tx.query('select socle.declarer_appareil($1, $2, $3, $4) id',
        [u.utilisateur, demande.appareil.nom, demande.appareil.type, maintenant])).rows[0].id;
    }

    const aUnCode = u.code_methode === 'sms' || u.code_methode === 'application';
    const faut = (aUnCode || u.code_obligatoire) && !(reconnu && !posteDUnAutre);

    if (faut && aUnCode) {
      let codeEmpreinte: string | null = null;
      if (u.code_methode === 'sms') {
        const code = codeSms();
        codeEmpreinte = sha256(code);
        await ctx.sms.envoyer(u.telephone, rendre(t('connexion.sms', { code: `${code.slice(0, 3)} ${code.slice(3)}` }), 'fr'));
      }
      const defi = (await tx.query('select socle.ouvrir_defi($1, $2, $3, $4, $5, $6) id',
        [u.utilisateur, appareil, u.code_methode, codeEmpreinte, maintenant, DUREE_DEFI])).rows[0].id as string;
      return { etat: 'code', defi, methode: u.code_methode, appareil: appareil as string };
    }

    // Pas de code à demander ; ou un code obligatoire pas encore en place : la session ne servira
    // qu'à le mettre en place.
    const jeton = randomBytes(32).toString('base64url');
    await tx.query('select socle.ouvrir_session($1, $2, $3, $4, $5, $6, $7)',
      [u.utilisateur, appareil, sha256(jeton), maintenant, posteDUnAutre, demande.ip ?? null, faut && !aUnCode]);
    await tx.query('select socle.effacer_erreurs($1)', [demande.email]);
    return { etat: 'connecte', jeton, appareil, codeAConfigurer: faut && !aUnCode };
  });
}

export async function validerCode(ctx: Contexte, demande: {
  defi: string; code: string; posteDUnAutre?: boolean | undefined; ip?: string | undefined;
}): Promise<ResultatConnexion> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  // Un code refusé compte, même si la suite échoue : on l'écrit dans sa propre transaction.
  const lu = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.lire_defi($1, $2)', [demande.defi, maintenant])).rows[0]);
  if (!lu) return { etat: 'refuse', motif: motif('connexion.code_perime') };

  const saisi = demande.code.replace(/\s/g, '');
  let bon: boolean;
  let secours: string | null = null;
  if (/^[0-9]{6}$/.test(saisi)) {
    bon = lu.methode === 'sms' ? sha256(saisi) === lu.code_empreinte : verifierTotp(lu.code_secret ?? '', saisi, maintenant.getTime());
  } else {
    // Un code de secours (XXXX-XXXX) : il remplace le code, une seule fois.
    const e = sha256(saisi.toUpperCase().replace(/-/g, ''));
    const restants = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.codes_secours_restants($1)', [lu.utilisateur])).rows);
    secours = restants.find((r) => r.empreinte === e)?.id ?? null;
    bon = secours !== null;
  }

  if (!bon) {
    const a = await enTantQue(ctx.pool, null, async (tx) => {
      await tx.query('select socle.defi_erreur($1)', [demande.defi]);
      return (await tx.query('select socle.noter_erreur($1, $2) a', [lu.email, maintenant])).rows[0].a as Date | null;
    });
    return a ? { etat: 'attendre', jusqua: a, motif: attenteLisible(a, maintenant) } : { etat: 'refuse', motif: motif('connexion.code_faux') };
  }

  const jeton = randomBytes(32).toString('base64url');
  await enTantQue(ctx.pool, null, async (tx) => {
    if (secours && !(await tx.query('select socle.consommer_code_secours($1, $2) ok', [secours, maintenant])).rows[0].ok) {
      throw new Error('ce code de secours vient déjà de servir');
    }
    await tx.query('select socle.conclure_defi($1, $2, $3, $4, $5)', [demande.defi, sha256(jeton), maintenant, demande.posteDUnAutre ?? false, demande.ip ?? null]);
    await tx.query('select socle.effacer_erreurs($1)', [lu.email]);
  });
  return { etat: 'connecte', jeton, appareil: lu.appareil, codeAConfigurer: false };
}

export type Qui = {
  utilisateur: string; session: string; appareil: string | null; posteDUnAutre: boolean; codeAConfigurer: boolean;
  // Une clé de l'API qui agit (03 § 8) : `utilisateur` est alors celui qui l'a créée (les pièces
  // portent son nom), mais la transaction est ouverte au nom de la CLÉ, jamais au sien.
  cle?: { id: string; gestes: string[] } | undefined;
};

// Qui est derrière ce jeton ? `null` si la session est fermée, trop longtemps inactive, ou si son
// appareil a été révoqué.
export async function quiEst(ctx: Contexte, jeton: string): Promise<Qui | null> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.qui_est($1, $2)', [sha256(jeton), maintenant])).rows[0]);
  return r ? { utilisateur: r.utilisateur, session: r.session, appareil: r.appareil, posteDUnAutre: r.poste_d_un_autre, codeAConfigurer: r.code_a_configurer } : null;
}

// Ce jeton est-il celui d'un appareil retiré (brique 74) ? L'appareil l'apprend, et efface ce qu'il garde.
export async function jetonDUnAppareilRetire(ctx: Contexte, jeton: string): Promise<boolean> {
  return enTantQue(ctx.pool, null, async (tx) => (await tx.query('select socle.jeton_d_un_appareil_retire($1) r', [sha256(jeton)])).rows[0].r as boolean);
}

// La quarantaine (briques 74 bis et 76) : ce qu'un appareil retiré (0044), ou une personne retirée de
// l'entreprise (0045), avait en attente, remis par son jeton avant d'effacer. Rend le nombre de
// changements faits par la personne, ou null (rien n'est reçu : ni l'un ni l'autre).
export async function mettreEnQuarantaine(ctx: Contexte, jeton: string, entreprise: string, changements: unknown[]): Promise<number | null> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const retire = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select socle.mettre_en_quarantaine($1, $2, $3, $4) n',
    [sha256(jeton), entreprise, JSON.stringify(changements), maintenant])).rows[0].n as number | null);
  if (retire !== null) return retire;
  // Une personne retirée de l'entreprise (brique 76) : sa session est valable, elle n'en est plus membre.
  const qui = await quiEst(ctx, jeton);
  if (!qui) return null;
  return enTantQue(ctx.pool, null, async (tx) => (await tx.query('select socle.remettre_d_un_membre_retire($1, $2, $3, $4) n',
    [qui.session, entreprise, JSON.stringify(changements), maintenant])).rows[0].n as number | null);
}
// Ce que cette session d'un appareil retiré a remis : l'entrée le dit à la personne.
export async function remisParCeJeton(ctx: Contexte, jeton: string): Promise<number> {
  return enTantQue(ctx.pool, null, async (tx) => (await tx.query('select socle.remis_par_ce_jeton($1) n', [sha256(jeton)])).rows[0].n as number);
}

export async function deconnecter(ctx: Contexte, qui: Qui): Promise<void> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  await enTantQue(ctx.pool, qui.utilisateur, (tx) => tx.query('update socle.session set fermee_le = $1 where id = $2', [maintenant, qui.session]));
}

// Mettre en place le code sur le téléphone. Rend les 10 codes de secours, à montrer UNE fois, et
// pour une application, l'adresse du QR code.
export async function mettreEnPlaceCode(ctx: Contexte, qui: Qui, methode: 'sms' | 'application') {
  const secret = methode === 'application' ? nouveauSecret() : null;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I, qu'on confond à l'écrit
  const codes = Array.from({ length: 10 }, () => {
    const b = randomBytes(8);
    const brut = [...b].map((o) => alphabet[o % alphabet.length]).join('');
    return `${brut.slice(0, 4)}-${brut.slice(4)}`;
  });
  const email = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => {
    await tx.query('select socle.poser_code($1, $2, $3)', [methode, secret, codes.map((c) => sha256(c.replace('-', '')))]);
    return (await tx.query('select email from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0].email as string;
  });
  return { codesDeSecours: codes, adresseApplication: secret ? adresseTotp(secret, email) : null, secret };
}

export async function revoquerAppareil(ctx: Contexte, qui: Qui, appareil: string): Promise<boolean> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  return enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.revoquer_appareil($1, $2) ok', [appareil, maintenant])).rows[0].ok);
}
