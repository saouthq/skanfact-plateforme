// Se connecter à la console (skanfact docs/cadrage/10-console.md § 1, 06 § 3 ; docs/console.md ; 0083). Une connexion à
// part, plus stricte que celle de l'application :
//   1. l'adresse et le mot de passe du compte SkanFact (la même attente qui s'allonge après cinq erreurs, comptée avec
//      celle de l'application : c'est le même mot de passe) ;
//   2. seulement pour un membre de l'équipe SkanFact ; à quelqu'un d'autre, la console répond comme à un mot de passe
//      faux (elle ne dit pas qui est dans l'équipe) ;
//   3. le code du téléphone (SMS ou application) à CHAQUE connexion, même sur un appareil reconnu ; un code de secours le
//      remplace, une fois. Sans code du téléphone en place, un membre arrivé depuis moins de sept jours le pose ici (une
//      application d'authentification : le premier code juste l'active et ouvre la session, 0118) ; passé ce délai, la
//      console le refuse et renvoie à « Ton compte » ;
//   4. une session de la console : son jeton n'ouvre rien dans l'application, et celui de l'application n'ouvre pas la
//      console. Jamais sur l'ordinateur d'un autre ; une heure sans geste, douze heures au plus.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { enTantQue } from '../base.ts';
import { attenteLisible, empreinteDuSecours, envoyerSms, tirerCodesDeSecours, type Appareil, type Contexte } from '../connexion.ts';
import { correspond, verifierPourRien } from '../mot-de-passe.ts';
import { numeroMasque } from '../sms.ts';
import { adresseTotp, nouveauSecret, verifierTotp } from '../totp.ts';
import { motif, type Texte } from '../../textes/index.ts';
import { estRoleConsole, type RoleConsole } from './gestes.ts';

export type ResultatConsole =
  | { etat: 'refuse'; motif: Texte; champ?: 'motDePasse' }
  | { etat: 'attendre'; jusqua: Date; motif: Texte }
  | { etat: 'code'; defi: string; methode: 'application'; appareil: string }
  | { etat: 'code'; defi: string; methode: 'sms'; appareil: string; telephone: string; envoi: 'parti' | 'rate' | 'limite' }
  | { etat: 'pose'; defi: string; appareil: string; adresseApplication: string; cle: string; codesDeSecours: string[] }
  | { etat: 'connecte'; jeton: string; appareil: string };

export type QuiConsole = { utilisateur: string; session: string; appareil: string; role: RoleConsole };

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const DUREE_DEFI = '10 minutes';
const codeSms = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const maintenantDe = (ctx: Contexte) => (ctx.maintenant ?? (() => new Date()))();

export async function connecterConsole(ctx: Contexte, demande: { email: string; motDePasse: string; appareil: Appareil; ip?: string | undefined }): Promise<ResultatConsole> {
  const maintenant = maintenantDe(ctx);
  const r = await enTantQue(ctx.pool, null, async (tx): Promise<(ResultatConsole & { aEnvoyer?: { telephone: string; code: string } | null }) | { poser: { utilisateur: string; email: string; appareil: string } }> => {
    const attente = (await tx.query('select socle.attente_connexion($1, $2) a', [demande.email, maintenant])).rows[0].a as Date | null;
    if (attente) return { etat: 'attendre', jusqua: attente, motif: attenteLisible(attente, maintenant) };

    const u = (await tx.query('select * from socle.pour_connexion($1)', [demande.email])).rows[0];
    const bon = u?.empreinte ? await correspond(u.empreinte, demande.motDePasse) : await verifierPourRien(demande.motDePasse);
    if (!bon) {
      const a = (await tx.query('select socle.noter_erreur($1, $2) a', [demande.email, maintenant])).rows[0].a as Date | null;
      return a ? { etat: 'attendre', jusqua: a, motif: attenteLisible(a, maintenant) } : { etat: 'refuse', motif: motif('connexion.refusee'), champ: 'motDePasse' };
    }
    // Hors de l'équipe : la même réponse qu'un mot de passe faux, champ compris. La console ne dit pas qui en fait partie.
    const role = (await tx.query('select plateforme.role_dans_l_equipe($1) r', [u.utilisateur])).rows[0].r as string | null;
    if (!estRoleConsole(role)) return { etat: 'refuse', motif: motif('connexion.refusee'), champ: 'motDePasse' };
    const sansCode = u.code_methode !== 'sms' && u.code_methode !== 'application';
    if (sansCode && !(await tx.query('select plateforme.peut_poser_code_console($1, $2) p', [u.utilisateur, maintenant])).rows[0].p) {
      return { etat: 'refuse', motif: motif('console.code_obligatoire') };
    }

    // L'appareil : celui qu'on connaît déjà s'il est à cette personne et pas retiré, sinon un nouveau.
    let appareil = demande.appareil.id ?? null;
    const aLui = appareil ? (await tx.query('select socle.appareil_de($1, $2) r', [u.utilisateur, appareil])).rows[0].r as boolean : false;
    if (!aLui) appareil = (await tx.query('select socle.declarer_appareil($1, $2, $3, $4) id', [u.utilisateur, demande.appareil.nom, demande.appareil.type, maintenant])).rows[0].id as string;

    if (sansCode) return { poser: { utilisateur: u.utilisateur as string, email: u.email as string, appareil: appareil as string } };
    if (u.code_methode === 'sms') {
      const code = codeSms();
      const defi = (await tx.query('select plateforme.ouvrir_defi_console($1, $2, $3, $4, $5, $6) id',
        [u.utilisateur, appareil, 'sms', sha256(code), maintenant, DUREE_DEFI])).rows[0].id as string;
      const permis = (await tx.query('select socle.compter_sms($1, $2, $3) p', [u.utilisateur, 'connexion', maintenant])).rows[0].p as boolean;
      return { etat: 'code', defi, methode: 'sms', appareil: appareil as string, telephone: numeroMasque(u.telephone),
        envoi: permis ? 'parti' : 'limite', aEnvoyer: permis ? { telephone: u.telephone as string, code } : null };
    }
    const defi = (await tx.query('select plateforme.ouvrir_defi_console($1, $2, $3, $4, $5, $6) id',
      [u.utilisateur, appareil, 'application', null, maintenant, DUREE_DEFI])).rows[0].id as string;
    return { etat: 'code', defi, methode: 'application', appareil: appareil as string };
  });
  if ('poser' in r) return poserCode(ctx, r.poser, maintenant);
  if (!('aEnvoyer' in r)) return r;
  const { aEnvoyer, ...reponse } = r;
  if (aEnvoyer && reponse.etat === 'code' && reponse.methode === 'sms' && !await envoyerSms(ctx, aEnvoyer.telephone, aEnvoyer.code)) reponse.envoi = 'rate';
  return reponse;
}

// Le premier code, à la première connexion (0118) : préparé au nom de la personne (le secret et les dix codes de secours
// attendent une heure, comme dans l'application), puis un défi « pose ». Une page rechargée garde le même secret.
async function poserCode(ctx: Contexte, p: { utilisateur: string; email: string; appareil: string }, maintenant: Date): Promise<ResultatConsole> {
  const codes = tirerCodesDeSecours();
  const secret = await enTantQue(ctx.pool, p.utilisateur, async (tx) => {
    const s = ((await tx.query('select socle.mon_secret_en_attente($1) s', [maintenant])).rows[0]?.s as string | null) ?? nouveauSecret();
    await tx.query('select socle.preparer_code($1, $2, $3)', [s, codes.map(empreinteDuSecours), maintenant]);
    return s;
  });
  const defi = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select plateforme.ouvrir_defi_console($1, $2, $3, $4, $5, $6) id',
    [p.utilisateur, p.appareil, 'pose', null, maintenant, DUREE_DEFI])).rows[0].id as string);
  return { etat: 'pose', defi, appareil: p.appareil, adresseApplication: adresseTotp(secret, p.email), cle: secret, codesDeSecours: codes };
}

export async function validerCodeConsole(ctx: Contexte, demande: { defi: string; code: string; ip?: string | undefined }): Promise<ResultatConsole> {
  const maintenant = maintenantDe(ctx);
  const lu = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from plateforme.lire_defi_console($1, $2)', [demande.defi, maintenant])).rows[0]);
  if (!lu) return { etat: 'refuse', motif: motif('connexion.code_perime') };

  const saisi = demande.code.replace(/\s/g, '');
  let bon: boolean;
  let secours: string | null = null;
  if (lu.methode === 'pose') {
    // Le code qu'on pose : seulement le premier code de l'application qu'on vient d'ajouter (un code de secours n'est
    // pas encore en place).
    bon = /^[0-9]{6}$/.test(saisi) && verifierTotp(lu.code_secret ?? '', saisi, maintenant.getTime());
  } else if (/^[0-9]{6}$/.test(saisi)) {
    bon = lu.methode === 'sms' ? sha256(saisi) === lu.code_empreinte : verifierTotp(lu.code_secret ?? '', saisi, maintenant.getTime());
  } else {
    // Un code de secours (XXXX-XXXX) remplace le code, une seule fois.
    const e = sha256(saisi.toUpperCase().replace(/-/g, ''));
    const restants = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.codes_secours_restants($1)', [lu.utilisateur])).rows);
    secours = restants.find((x) => x.empreinte === e)?.id ?? null;
    bon = secours !== null;
  }
  if (!bon) {
    const a = await enTantQue(ctx.pool, null, async (tx) => {
      await tx.query('select plateforme.defi_console_erreur($1)', [demande.defi]);
      return (await tx.query('select socle.noter_erreur($1, $2) a', [lu.email, maintenant])).rows[0].a as Date | null;
    });
    return a ? { etat: 'attendre', jusqua: a, motif: attenteLisible(a, maintenant) } : { etat: 'refuse', motif: motif('connexion.code_faux') };
  }

  // Le code posé devient celui du compte (au nom de la personne, comme dans l'application), et le journal le garde.
  if (lu.methode === 'pose') {
    const active = await enTantQue(ctx.pool, lu.utilisateur as string, async (tx) => (await tx.query('select socle.activer_code_en_attente($1) a', [maintenant])).rows[0].a as boolean);
    if (!active) return { etat: 'refuse', motif: motif('compte.code_attente_perimee') };
    await enTantQue(ctx.pool, null, (tx) => tx.query('select plateforme.code_pose_console($1)', [lu.utilisateur]));
  }
  const jeton = randomBytes(32).toString('base64url');
  await enTantQue(ctx.pool, null, async (tx) => {
    if (secours && !(await tx.query('select socle.consommer_code_secours($1, $2) ok', [secours, maintenant])).rows[0].ok) {
      throw new Error('ce code de secours vient déjà de servir');
    }
    await tx.query('select plateforme.conclure_defi_console($1, $2, $3, $4)', [demande.defi, sha256(jeton), maintenant, demande.ip ?? null]);
    await tx.query('select socle.effacer_erreurs($1)', [lu.email]);
  });
  return { etat: 'connecte', jeton, appareil: lu.appareil as string };
}

// « Renvoyer le code » d'un défi par SMS : cinq envois au plus, pas deux en moins de trente secondes, dans la limite des
// SMS de la personne (comptés avec ceux de l'application).
export async function renvoyerCodeConsole(ctx: Contexte, defi: string): Promise<{ ok: true } | { ok: false; motif: Texte }> {
  if (ctx.sms.disponible === false) return { ok: false, motif: motif('connexion.sms_indisponible') };
  const maintenant = maintenantDe(ctx);
  const code = codeSms();
  const r = await enTantQue(ctx.pool, null, async (tx) => {
    const lu = (await tx.query('select utilisateur, methode from plateforme.lire_defi_console($1, $2)', [defi, maintenant])).rows[0] as { utilisateur: string; methode: string } | undefined;
    if (!lu || lu.methode !== 'sms') return { motif: motif('connexion.renvoi_sms_impossible') };
    if (!(await tx.query('select socle.sms_permis($1, $2) p', [lu.utilisateur, maintenant])).rows[0].p) return { motif: motif('connexion.sms_limite') };
    const tel = (await tx.query('select plateforme.renvoyer_defi_console($1, $2, $3, $4) t', [defi, sha256(code), maintenant, DUREE_DEFI])).rows[0].t as string | null;
    if (!tel) return { motif: motif('connexion.renvoi_sms_impossible') };
    await tx.query('select socle.compter_sms($1, $2, $3)', [lu.utilisateur, 'connexion', maintenant]);
    return { telephone: tel };
  });
  if ('motif' in r) return { ok: false, motif: r.motif };
  return await envoyerSms(ctx, r.telephone, code) ? { ok: true } : { ok: false, motif: motif('connexion.sms_rate') };
}

// Qui est derrière ce jeton de la console ? `null` si la session est fermée, trop longtemps sans geste, finie, si son
// appareil a été retiré, ou si la personne n'est plus dans l'équipe. `prolonger` faux : une relecture automatique, qui ne
// repousse pas l'inaction (0114 : l'inaction se compte en gestes humains).
export async function quiEstConsole(ctx: Contexte, jeton: string, prolonger = true): Promise<QuiConsole | null> {
  const maintenant = maintenantDe(ctx);
  const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from plateforme.qui_est_console($1, $2, $3)', [sha256(jeton), maintenant, prolonger])).rows[0]);
  if (!r || !estRoleConsole(r.role)) return null;
  return { utilisateur: r.utilisateur as string, session: r.session as string, appareil: r.appareil as string, role: r.role };
}
