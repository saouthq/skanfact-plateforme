// Se connecter (03 § 6). Le parcours, dans l'ordre :
//   1. l'adresse et le mot de passe (une attente qui s'allonge après 5 erreurs, jamais un blocage) ;
//   2. le code sur le téléphone, si la personne en a un ou si son rôle l'exige (un comptable de cabinet, depuis le
//      09/10/2026), sauf sur un appareil déjà reconnu (30 jours) ; un code de secours remplace le code ;
//   2 bis. sans code du téléphone, un code par e-mail (si ce serveur sait en envoyer) : à la première connexion d'un
//      compte dont l'adresse n'est pas vérifiée, et sur un appareil inconnu (0076) ;
//   3. une session, dont le jeton n'est gardé qu'en empreinte.
//
// Ce qui part chez le fournisseur de SMS : le numéro et le code, RIEN d'autre (03 § 6). Chez le relais d'e-mails :
// l'adresse, l'objet et un texte qui ne porte que le code ou le lien.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import type pg from 'pg';
import type { Lecteur } from './achats/lecteur.ts';
import type { EnvoiCourriel } from './courriel.ts';
import { enTantQue } from './base.ts';
import { Refus } from './erreurs.ts';
import { correspond, empreinte, verifierPolitique, verifierPourRien, type ListeVolee } from './mot-de-passe.ts';
import type { Partenaire } from './partenaires.ts';
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
  // La signature de la facture électronique (brique 81) : l'API DigiGo de TunTrust, et la clé de SkanFact
  // comme « entité d'intégration » (de l'environnement du serveur, jamais du dépôt).
  efacture?: { digigo: string; cleDigigo: string };
  // Les partenaires déclarés (brique 133 ; serveur/partenaires.ts), et la clé qui dérive leurs clés de leurs codes.
  partenaires?: { liste: Partenaire[]; cle: Buffer };
  // L'envoi à la TTN (brique 82) : l'adresse du service El Fatoora (null : pas branché sur ce serveur), et
  // la clé du coffre qui scelle le mot de passe El Fatoora de chaque entreprise.
  ttn?: { adresse: string | null; coffre: Buffer };
  // La lecture des factures d'achat (brique 84) : le moteur de ce serveur (Tesseract et Poppler), et sa
  // file ; absent ou non disponible, la lecture n'est pas branchée (et l'écran le dit).
  lecteur?: Lecteur;
  // L'envoi des e-mails (lot entrée ; serveur/courriel.ts) et l'adresse publique où mènent ses liens ; absent, aucun
  // e-mail ne part.
  courriel?: { envoi: EnvoiCourriel; adresse: () => string };
};

export type Appareil = { id?: string; nom: string; type: 'navigateur' | 'bureau' | 'telephone' };

export type ResultatConnexion =
  | { etat: 'refuse'; motif: Texte }
  | { etat: 'attendre'; jusqua: Date; motif: Texte }
  | { etat: 'code'; defi: string; methode: 'sms' | 'application'; appareil: string }
  // Le code par e-mail : à l'adresse du compte, qui le reçoit (« inscription » : l'adresse n'est pas encore vérifiée).
  | { etat: 'code'; defi: string; methode: 'courriel'; appareil: string; adresse: string; raison: 'inscription' | 'appareil' }
  | { etat: 'connecte'; jeton: string; appareil: string | null; codeAConfigurer: boolean };

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const DUREE_DEFI = '10 minutes';
// Un e-mail met plus longtemps qu'un SMS à arriver, et se lit sur un autre écran.
const DUREE_DEFI_COURRIEL_MINUTES = 15;
const MOTIF_REFUS = () => motif('connexion.refusee');

export function attenteLisible(jusqua: Date, maintenant: Date): Texte {
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

    // Sans code du téléphone : l'adresse pas encore vérifiée (juste après l'inscription), ou un appareil inconnu, se
    // prouvent par un code envoyé par e-mail — seulement si ce serveur sait en envoyer (on ne demande jamais ce qu'on ne
    // sait pas envoyer). Un comptable de cabinet sans code encore en place passe aussi par là d'abord.
    if (!aUnCode && ctx.courriel) {
      const verifiee = (await tx.query('select socle.adresse_verifiee($1) v', [u.utilisateur])).rows[0].v as boolean;
      if (!verifiee || !(reconnu && !posteDUnAutre)) {
        const code = codeSms();
        const defi = (await tx.query('select socle.ouvrir_defi($1, $2, $3, $4, $5, $6) id',
          [u.utilisateur, appareil, 'courriel', sha256(code), maintenant, `${DUREE_DEFI_COURRIEL_MINUTES} minutes`])).rows[0].id as string;
        const email = (await tx.query('select email from socle.lire_defi($1, $2)', [defi, maintenant])).rows[0].email as string;
        const raison = verifiee ? 'appareil' : 'inscription';
        envoyerCodeParCourriel(ctx, email, code, raison);
        return { etat: 'code', defi, methode: 'courriel', appareil: appareil as string, adresse: email, raison };
      }
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
    bon = lu.methode === 'sms' || lu.methode === 'courriel' ? sha256(saisi) === lu.code_empreinte : verifierTotp(lu.code_secret ?? '', saisi, maintenant.getTime());
  } else if (lu.methode === 'courriel') {
    // Un code par e-mail ne se remplace pas : la personne n'a pas de code du téléphone, donc pas de codes de secours.
    bon = false;
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
    // Le code reçu par e-mail, puis tapé : l'adresse est prouvée.
    if (lu.methode === 'courriel') await tx.query('select socle.prouver_adresse($1, $2)', [demande.defi, maintenant]);
    await tx.query('select socle.effacer_erreurs($1)', [lu.email]);
  });
  return { etat: 'connecte', jeton, appareil: lu.appareil, codeAConfigurer: false };
}

// Le code par e-mail : à l'adresse du compte, sans attendre l'envoi (le relais peut prendre quelques secondes ; un
// échec se dit dans le journal du serveur, et « Renvoyer le code » le redemande).
function envoyerCodeParCourriel(ctx: Contexte, a: string, code: string, raison: 'inscription' | 'appareil') {
  const courriel = ctx.courriel;
  if (!courriel) return;
  // Le français : l'anglais viendra avec son catalogue (vague 4).
  const langue = 'fr';
  void courriel.envoi.envoyer({
    a,
    objet: rendre(t('connexion.courriel_objet', { code }), langue),
    texte: rendre(t(raison === 'inscription' ? 'connexion.courriel_inscription' : 'connexion.courriel_appareil', { code, minutes: DUREE_DEFI_COURRIEL_MINUTES }), langue),
  }).catch((e: unknown) => { console.error(`le code par e-mail n'est pas parti : ${String(e)}`); });
}

// « Renvoyer le code » : un nouveau code remplace l'ancien, au plus cinq envois par défi, pas deux en moins de 30
// secondes (personne ne remplit la boîte d'un autre).
export async function renvoyerCode(ctx: Contexte, defi: string): Promise<{ ok: true } | { ok: false; motif: Texte }> {
  if (!ctx.courriel) return { ok: false, motif: motif('connexion.oubli_indisponible') };
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const code = codeSms();
  const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.renvoyer_defi($1, $2, $3, $4)',
    [defi, sha256(code), maintenant, `${DUREE_DEFI_COURRIEL_MINUTES} minutes`])).rows[0] as { a_email: string; a_verifiee: boolean } | undefined);
  if (!r) return { ok: false, motif: motif('connexion.renvoi_impossible') };
  envoyerCodeParCourriel(ctx, r.a_email, code, r.a_verifiee ? 'appareil' : 'inscription');
  return { ok: true };
}

// « Ce n'est pas ton adresse ? La corriger » (0076) : pendant le défi de l'inscription seulement, tant que l'adresse n'a
// jamais été prouvée. Le nouveau code part à la nouvelle adresse ; l'ancien ne vaut plus.
export async function corrigerAdresse(ctx: Contexte, defi: string, adresse: string): Promise<{ ok: true; adresse: string } | { ok: false; motif: Texte }> {
  if (!ctx.courriel) return { ok: false, motif: motif('connexion.oubli_indisponible') };
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const nouvelle = adresse.trim().toLowerCase();
  const code = codeSms();
  const ok = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select socle.corriger_adresse_du_defi($1, $2, $3, $4, $5) ok',
    [defi, nouvelle, sha256(code), maintenant, `${DUREE_DEFI_COURRIEL_MINUTES} minutes`])).rows[0].ok as boolean);
  if (!ok) return { ok: false, motif: motif('connexion.correction_impossible') };
  envoyerCodeParCourriel(ctx, nouvelle, code, 'inscription');
  return { ok: true, adresse: nouvelle };
}

export type Qui = {
  utilisateur: string; session: string; appareil: string | null; posteDUnAutre: boolean; codeAConfigurer: boolean;
  // Une clé de l'API qui agit (03 § 8) : `utilisateur` est alors celui qui l'a créée (les pièces
  // portent son nom), mais la transaction est ouverte au nom de la CLÉ, jamais au sien.
  cle?: { id: string; gestes: string[] } | undefined;
  // Une session ouverte par un code de caisse (brique 123) : elle ne sert qu'à cette entreprise.
  caisseDe?: string | null | undefined;
};

// Qui est derrière ce jeton ? `null` si la session est fermée, trop longtemps inactive, ou si son
// appareil a été révoqué.
export async function quiEst(ctx: Contexte, jeton: string): Promise<Qui | null> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.qui_est($1, $2)', [sha256(jeton), maintenant])).rows[0]);
  return r ? { utilisateur: r.utilisateur, session: r.session, appareil: r.appareil, posteDUnAutre: r.poste_d_un_autre, codeAConfigurer: r.code_a_configurer, caisseDe: r.caisse_de } : null;
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
// Dix codes de secours (XXXX-XXXX), à montrer une fois ; la base n'en garde que l'empreinte (`empreinteDuSecours`).
export function tirerCodesDeSecours(): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I, qu'on confond à l'écrit
  return Array.from({ length: 10 }, () => {
    const b = randomBytes(8);
    const brut = [...b].map((o) => alphabet[o % alphabet.length]).join('');
    return `${brut.slice(0, 4)}-${brut.slice(4)}`;
  });
}
export const empreinteDuSecours = (code: string) => sha256(code.replace('-', ''));

export async function mettreEnPlaceCode(ctx: Contexte, qui: Qui, methode: 'sms' | 'application') {
  const secret = methode === 'application' ? nouveauSecret() : null;
  const codes = tirerCodesDeSecours();
  const email = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => {
    await tx.query('select socle.poser_code($1, $2, $3)', [methode, secret, codes.map(empreinteDuSecours)]);
    return (await tx.query('select email from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0].email as string;
  });
  return { codesDeSecours: codes, adresseApplication: secret ? adresseTotp(secret, email) : null, secret };
}

// Essayer le premier code de l'application qu'on vient d'ajouter (brique 145) : rien ne change, on dit seulement si
// le code tapé correspond au secret posé. Sans application posée, aucun code ne correspond.
export async function essayerCode(ctx: Contexte, qui: Qui, code: string): Promise<boolean> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const secret = await enTantQue(ctx.pool, qui.utilisateur, async (tx) =>
    (await tx.query('select socle.mon_secret_d_application() s')).rows[0]?.s as string | null);
  return !!secret && verifierTotp(secret, code.replace(/\s/g, ''), maintenant.getTime());
}

export async function revoquerAppareil(ctx: Contexte, qui: Qui, appareil: string): Promise<boolean> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  return enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.revoquer_appareil($1, $2) ok', [appareil, maintenant])).rows[0].ok);
}

// ── Le mot de passe oublié (lot entrée, 06/10/2026 ; migration 0075, docs/entree.md) ─────────────────────────────────
const DUREE_REINITIALISATION_MINUTES = 30;

// Une demande : si un compte répond à l'adresse, son lien part par e-mail. La réponse est la même dans tous les cas (on
// ne dit jamais si une adresse a un compte), et elle n'attend pas l'e-mail : le temps de réponse ne le dirait pas non
// plus. Sans relais d'e-mails, la demande se refuse : l'écran ne la propose d'ailleurs pas.
export async function demanderReinitialisation(ctx: Contexte, email: string): Promise<void> {
  const courriel = ctx.courriel;
  if (!courriel) throw new Refus('connexion.oubli_indisponible');
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const jeton = randomBytes(32).toString('base64url');
  const a = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.demander_reinitialisation($1, $2, $3, $4)',
    [email, sha256(jeton), maintenant, `${DUREE_REINITIALISATION_MINUTES} minutes`])).rows[0] as { a_email: string } | undefined);
  if (!a) return;
  // Le français : l'anglais viendra avec son catalogue (vague 4).
  const langue = 'fr';
  const lien = `${courriel.adresse()}/?reinitialiser=${jeton}`;
  void courriel.envoi.envoyer({
    a: a.a_email,
    objet: rendre(t('connexion.oubli_objet'), langue),
    texte: rendre(t('connexion.oubli_texte', { lien, minutes: DUREE_REINITIALISATION_MINUTES }), langue),
  }).catch((e: unknown) => { console.error(`l'e-mail du mot de passe oublié n'est pas parti : ${String(e)}`); });
}

// Ce lien vaut-il encore, et faut-il aussi le code du téléphone ?
export async function lireReinitialisation(ctx: Contexte, jeton: string): Promise<{ valable: boolean; code: boolean }> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.lire_reinitialisation($1, $2)', [sha256(jeton), maintenant])).rows[0]);
  return r ? { valable: true, code: r.code_methode === 'sms' || r.code_methode === 'application' } : { valable: false, code: false };
}

export type ResultatReinitialisation = { ok: true } | { ok: false; motif: Texte; champ: 'jeton' | 'code' | 'motDePasse' };

// Le nouveau mot de passe. Le lien seul ne suffit pas à un compte qui a le code du téléphone : il faut aussi ce code,
// ou un code de secours (sinon, qui lit la boîte de la personne prendrait son compte). Cinq codes faux, et le lien ne
// vaut plus rien.
export async function reinitialiser(ctx: Contexte, demande: { jeton: string; motDePasse: string; code?: string | undefined }): Promise<ResultatReinitialisation> {
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const e = sha256(demande.jeton);
  const lu = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.lire_reinitialisation($1, $2)', [e, maintenant])).rows[0]);
  if (!lu) return { ok: false, motif: motif('connexion.oubli_lien_perime'), champ: 'jeton' };

  let secours: string | null = null;
  if (lu.code_methode === 'sms' || lu.code_methode === 'application') {
    const saisi = (demande.code ?? '').replace(/\s/g, '');
    if (!saisi) return { ok: false, motif: motif('connexion.oubli_code_manque'), champ: 'code' };
    let bon: boolean;
    if (/^[0-9]{6}$/.test(saisi)) bon = lu.code_methode === 'application' && verifierTotp(lu.code_secret ?? '', saisi, maintenant.getTime());
    else {
      const empreinteSecours = sha256(saisi.toUpperCase().replace(/-/g, ''));
      const restants = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.codes_secours_restants($1)', [lu.utilisateur])).rows);
      secours = restants.find((r) => r.empreinte === empreinteSecours)?.id ?? null;
      bon = secours !== null;
    }
    if (!bon) {
      await enTantQue(ctx.pool, null, (tx) => tx.query('select socle.reinitialisation_erreur($1)', [e]));
      return { ok: false, motif: motif('connexion.code_faux'), champ: 'code' };
    }
  }

  const politique = verifierPolitique(demande.motDePasse, ctx.listeVolee);
  if (!politique.ok) return { ok: false, motif: politique.motif, champ: 'motDePasse' };
  const nouvelle = await empreinte(demande.motDePasse);
  const fait = await enTantQue(ctx.pool, null, async (tx) => {
    if (secours && !(await tx.query('select socle.consommer_code_secours($1, $2) ok', [secours, maintenant])).rows[0].ok) return false;
    const ok = (await tx.query('select socle.conclure_reinitialisation($1, $2, $3) ok', [e, nouvelle, maintenant])).rows[0].ok as boolean;
    if (ok) await tx.query('select socle.effacer_erreurs($1)', [lu.email]);
    return ok;
  });
  return fait ? { ok: true } : { ok: false, motif: motif('connexion.oubli_lien_perime'), champ: 'jeton' };
}
