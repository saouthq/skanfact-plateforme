// Ton compte (lot onboarding, décision de Skander du 09/10/2026 ; skanfact docs/cadrage/03-droits.md § 6 ; migration
// 0076 ; docs/entree.md) : le code du téléphone qu'on retire ou dont on renouvelle les codes de secours, le mot de passe
// et l'adresse qu'on change, ou qu'on vérifie (0077). Chaque geste qui affaiblit ou déplace le compte se prouve
// d'abord : le code du moment (ou un code de secours) pour le code, le mot de passe actuel pour le mot de passe et
// l'adresse. Les erreurs comptent comme à la connexion (une attente qui s'allonge, jamais un blocage).
//
// Le code se choisit (décision de Skander du 12/10/2026, 0081) : l'e-mail par défaut (rien à activer), le SMS, ou une
// application d'authentification ; le SMS et l'application s'activent en deux temps.
//
// Ce qui part chez le relais d'e-mails, compté et décidé (03 § 6) : l'adresse, l'objet, et un texte qui ne porte que le
// code ou le lien. Chez le fournisseur de SMS : le numéro et le code. La confirmation d'un code retiré ne porte que l'adresse de l'application ; celle d'une adresse
// changée, partie à l'ancienne, ne nomme pas la nouvelle.

import { createHash, randomInt } from 'node:crypto';
import { attenteLisible, empreinteDuSecours, envoyerSms, tirerCodesDeSecours, type Contexte, type Qui } from './connexion.ts';
import { numeroMasque, numeroTunisien } from './sms.ts';
import { enTantQue, type Transaction } from './base.ts';
import { correspond, empreinte, verifierPolitique } from './mot-de-passe.ts';
import { adresseTotp, nouveauSecret, verifierTotp } from './totp.ts';
import { motif, rendre, t, type Texte } from '../textes/index.ts';

const sha256 = (texte: string) => createHash('sha256').update(texte, 'utf8').digest('hex');
const maintenantDe = (ctx: Contexte) => (ctx.maintenant ?? (() => new Date()))();
const DUREE_ADRESSE_MINUTES = 15;
// L'aide de SkanFact, que nomme l'e-mail d'une adresse changée.
const AIDE = 'https://skanfact.tn/contact.html';

// `attendre` : trop d'erreurs, une attente court (429).
export type Refuse = { ok: false; motif: Texte; champ?: string; attendre?: true };

// Mon adresse, et l'attente en cours après des erreurs (la même que la connexion : les essais se comptent par adresse).
// Dans la transaction de la route quand elle en donne une (la console ; l'audit C03 pour le mot de passe, l'audit 1.42.0 A02
// pour le code du téléphone et les codes de secours : un geste sur son compte réussit ou
// échoue d'un bloc, et ne prend pas une seconde connexion pendant qu'il en tient une), sinon dans une à lui.
type Dans = Transaction | null | undefined;
const dans = <T>(ctx: Contexte, tx: Dans, utilisateur: string | null, travail: (tx: Transaction) => Promise<T>): Promise<T> =>
  (tx ? travail(tx) : enTantQue(ctx.pool, utilisateur, travail));
async function monAdresse(ctx: Contexte, qui: Qui, tx?: Dans): Promise<string> {
  return dans(ctx, tx, qui.utilisateur, async (t) => (await t.query('select email from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0].email as string);
}
async function attente(ctx: Contexte, email: string, tx?: Dans): Promise<Refuse | null> {
  const maintenant = maintenantDe(ctx);
  const a = await dans(ctx, tx, null, async (t) => (await t.query('select socle.attente_connexion($1, $2) a', [email, maintenant])).rows[0].a as Date | null);
  return a ? { ok: false, motif: attenteLisible(a, maintenant), attendre: true } : null;
}
async function erreur(ctx: Contexte, email: string, refus: Refuse, tx?: Dans): Promise<Refuse> {
  const maintenant = maintenantDe(ctx);
  const a = await dans(ctx, tx, null, async (t) => (await t.query('select socle.noter_erreur($1, $2) a', [email, maintenant])).rows[0].a as Date | null);
  return a ? { ok: false, motif: attenteLisible(a, maintenant), attendre: true, ...(refus.champ ? { champ: refus.champ } : {}) } : refus;
}

// Le code de l'application, le code de preuve reçu par SMS (0081 : il ne sert qu'une fois), ou un code de secours encore
// valable : c'est bien la personne.
async function monCodeEstBon(ctx: Contexte, qui: Qui, code: string, tx?: Dans): Promise<boolean> {
  const maintenant = maintenantDe(ctx);
  const saisi = code.replace(/\s/g, '');
  return dans(ctx, tx, qui.utilisateur, async (tx) => {
    if (/^[0-9]{6}$/.test(saisi)) {
      const secret = (await tx.query('select socle.mon_secret_d_application() s')).rows[0]?.s as string | null;
      if (secret) return verifierTotp(secret, saisi, maintenant.getTime());
      return (await tx.query('select socle.consommer_preuve_sms($1, $2) b', [sha256(saisi), maintenant])).rows[0].b as boolean;
    }
    const e = empreinteDuSecours(saisi.toUpperCase());
    const restants = (await tx.query('select * from socle.codes_secours_restants($1)', [qui.utilisateur])).rows as { empreinte: string }[];
    return restants.some((r) => r.empreinte === e);
  });
}

// Qui a déjà un code (l'application ou le SMS) prouve l'actuel, ou un code de secours, avant d'en préparer un autre :
// une session volée ne met pas son téléphone, ni son numéro, à la place du sien. Sans code (l'e-mail par défaut), rien
// à prouver. Rend l'adresse du compte, ou le refus.
async function prouverCodeActuel(ctx: Contexte, qui: Qui, code: string | undefined, dansLa?: Dans): Promise<{ email: string } | Refuse> {
  const { email, actif, parSms } = await dans(ctx, dansLa, qui.utilisateur, async (tx) => {
    const u = (await tx.query('select email, code_methode from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0] as { email: string; code_methode: string | null };
    return { email: u.email, actif: u.code_methode !== null, parSms: u.code_methode === 'sms' };
  });
  if (!actif) return { email };
  if (!code?.trim()) return { ok: false, motif: motif(parSms ? 'compte.preuve_sms_manque' : 'compte.code_actuel_manque'), champ: 'code' };
  const bloque = await attente(ctx, email, dansLa);
  if (bloque) return bloque;
  if (!await monCodeEstBon(ctx, qui, code, dansLa)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' }, dansLa);
  await dans(ctx, dansLa, null, (tx) => tx.query('select socle.effacer_erreurs($1)', [email]));
  return { email };
}

// Activer le code du téléphone en deux temps (0076 § 1 bis). Préparé d'abord : le secret et les codes de secours
// attendent une heure au plus et ne remplacent rien ; une activation abandonnée ne ferme donc jamais la porte. Une
// page rechargée garde le même secret (pas de seconde ligne SkanFact dans l'application) ; les codes de secours, gardés
// en empreinte, se tirent à nouveau. Qui a déjà un code (il change de téléphone) prouve d'abord l'actuel, ou un code de
// secours : une session volée ne suffit pas à mettre son téléphone à la place du sien.
export async function preparerCode(ctx: Contexte, qui: Qui, code?: string, dansLa?: Dans): Promise<{ ok: true; codesDeSecours: string[]; adresseApplication: string; cle: string } | Refuse> {
  const maintenant = maintenantDe(ctx);
  const preuve = await prouverCodeActuel(ctx, qui, code, dansLa);
  if ('ok' in preuve) return preuve;
  const { email } = preuve;
  const codes = tirerCodesDeSecours();
  const secret = await dans(ctx, dansLa, qui.utilisateur, async (tx) => {
    const s = ((await tx.query('select socle.mon_secret_en_attente($1) s', [maintenant])).rows[0]?.s as string | null) ?? nouveauSecret();
    await tx.query('select socle.preparer_code($1, $2, $3)', [s, codes.map(empreinteDuSecours), maintenant]);
    return s;
  });
  return { ok: true, codesDeSecours: codes, adresseApplication: adresseTotp(secret, email), cle: secret };
}

// Le premier code de l'application qu'on vient d'ajouter : juste, le code préparé devient celui du compte. Une erreur
// ici ne se compte pas comme à la connexion (la personne a déjà sa session ; le secret vient de lui être montré).
export async function activerCode(ctx: Contexte, qui: Qui, code: string, dansLa?: Dans): Promise<{ ok: true } | Refuse> {
  const maintenant = maintenantDe(ctx);
  const saisi = code.replace(/\s/g, '');
  return dans(ctx, dansLa, qui.utilisateur, async (tx): Promise<{ ok: true } | Refuse> => {
    const secret = (await tx.query('select socle.mon_secret_en_attente($1) s', [maintenant])).rows[0]?.s as string | null;
    if (!secret) return { ok: false, motif: motif('compte.code_attente_perimee') };
    if (!/^[0-9]{6}$/.test(saisi) || !verifierTotp(secret, saisi, maintenant.getTime())) return { ok: false, motif: motif('compte.code_essai_faux'), champ: 'code' };
    const active = (await tx.query('select socle.activer_code_en_attente($1) a', [maintenant])).rows[0].a as boolean;
    return active ? { ok: true } : { ok: false, motif: motif('compte.code_attente_perimee') };
  });
}

// ── Le code par SMS (0081) ──────────────────────────────────────────────────────────────────────────────────────
// Ce qui part chez le fournisseur : le numéro et le code, rien d'autre.
const codeSix = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// Préparer le SMS : un code part au numéro donné ; rien ne change tant qu'il n'est pas tapé (15 minutes, cinq essais).
// Qui a déjà un code (il change de numéro, ou passe de l'application au SMS) prouve d'abord l'actuel.
export async function preparerSms(ctx: Contexte, qui: Qui, telephone: string, code?: string, dansLa?: Dans): Promise<{ ok: true; telephone: string } | Refuse> {
  if (ctx.sms.disponible === false) return { ok: false, motif: motif('connexion.sms_indisponible') };
  const numero = numeroTunisien(telephone);
  if (!numero) return { ok: false, motif: motif('compte.telephone_invalide'), champ: 'telephone' };
  const maintenant = maintenantDe(ctx);
  const preuve = await prouverCodeActuel(ctx, qui, code, dansLa);
  if ('ok' in preuve) return preuve;
  const nouveau = codeSix();
  const etat = await dans(ctx, dansLa, qui.utilisateur, async (tx) => (await tx.query('select socle.preparer_sms($1, $2, $3) e', [numero, sha256(nouveau), maintenant])).rows[0].e as string);
  if (etat === 'limite') return { ok: false, motif: motif('compte.sms_limite'), champ: 'telephone' };
  if (!await envoyerSms(ctx, numero, nouveau)) return { ok: false, motif: motif('compte.sms_rate'), champ: 'telephone' };
  return { ok: true, telephone: numeroMasque(numero) };
}

// Le code reçu, tapé : le SMS devient le code du compte. Rend les 10 codes de secours, à montrer UNE fois.
export async function activerSms(ctx: Contexte, qui: Qui, code: string, dansLa?: Dans): Promise<{ ok: true; codesDeSecours: string[] } | Refuse> {
  const saisi = code.replace(/\s/g, '');
  if (!/^[0-9]{6}$/.test(saisi)) return { ok: false, motif: motif('compte.sms_essai_faux'), champ: 'code' };
  const codes = tirerCodesDeSecours();
  const etat = await dans(ctx, dansLa, qui.utilisateur, async (tx) => (await tx.query('select socle.activer_sms_en_attente($1, $2, $3) e',
    [sha256(saisi), codes.map(empreinteDuSecours), maintenantDe(ctx)])).rows[0].e as string);
  if (etat === 'faux') return { ok: false, motif: motif('compte.sms_essai_faux'), champ: 'code' };
  if (etat === 'perime') return { ok: false, motif: motif('compte.sms_attente_perimee'), champ: 'code' };
  return { ok: true, codesDeSecours: codes };
}

// Prouver le code actuel quand on a le SMS (retirer le code, de nouveaux codes de secours, changer de numéro) : un code
// de preuve part au numéro du compte, valable 10 minutes, une fois.
export async function envoyerPreuveSms(ctx: Contexte, qui: Qui, dansLa?: Dans): Promise<{ ok: true; telephone: string } | Refuse> {
  if (ctx.sms.disponible === false) return { ok: false, motif: motif('connexion.sms_indisponible') };
  const code = codeSix();
  const tel = await dans(ctx, dansLa, qui.utilisateur, async (tx) => (await tx.query('select socle.poser_preuve_sms($1, $2) t', [sha256(code), maintenantDe(ctx)])).rows[0].t as string | null);
  if (!tel) return { ok: false, motif: motif('compte.sms_limite') };
  if (!await envoyerSms(ctx, tel, code)) return { ok: false, motif: motif('compte.sms_rate') };
  return { ok: true, telephone: numeroMasque(tel) };
}

// Retirer le code du téléphone. Un e-mail le confirme (si ce serveur sait en envoyer) : qui ne l'a pas fait le saura.
export async function retirerCode(ctx: Contexte, qui: Qui, code: string): Promise<{ ok: true; confirme: boolean } | Refuse> {
  const email = await monAdresse(ctx, qui);
  const bloque = await attente(ctx, email);
  if (bloque) return bloque;
  if (!await monCodeEstBon(ctx, qui, code)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' });
  // Ce serveur envoie des e-mails : le code par e-mail tient lieu de code, un comptable de cabinet y revient (0081).
  const a = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.retirer_code($1) a', [!!ctx.courriel])).rows[0].a as string);
  await enTantQue(ctx.pool, null, (tx) => tx.query('select socle.effacer_erreurs($1)', [email]));
  const courriel = ctx.courriel;
  if (courriel) {
    void courriel.envoi.envoyer({
      a, objet: rendre(t('compte.code_retire_objet'), 'fr'), texte: rendre(t('compte.code_retire_texte', { adresse: courriel.adresse() }), 'fr'),
      bouton: rendre(t('compte.code_retire_bouton'), 'fr'), langue: 'fr',
    }).catch((e: unknown) => { console.error(`la confirmation du code retiré n'est pas partie : ${String(e)}`); });
  }
  return { ok: true, confirme: !!courriel };
}

// De nouveaux codes de secours, à montrer UNE fois (les anciens ne valent plus).
export async function nouveauxCodesDeSecours(ctx: Contexte, qui: Qui, code: string, dansLa?: Dans): Promise<{ ok: true; codes: string[] } | Refuse> {
  const email = await monAdresse(ctx, qui, dansLa);
  const bloque = await attente(ctx, email, dansLa);
  if (bloque) return bloque;
  if (!await monCodeEstBon(ctx, qui, code, dansLa)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' }, dansLa);
  const codes = tirerCodesDeSecours();
  await dans(ctx, dansLa, qui.utilisateur, (tx) => tx.query('select socle.nouveaux_codes_secours($1)', [codes.map(empreinteDuSecours)]));
  await dans(ctx, dansLa, null, (tx) => tx.query('select socle.effacer_erreurs($1)', [email]));
  return { ok: true, codes };
}

// Le mot de passe actuel est-il le bon ?
async function motDePasseBon(ctx: Contexte, email: string, motDePasse: string, tx?: Dans): Promise<boolean> {
  const u = await dans(ctx, tx, null, async (t) => (await t.query('select empreinte from socle.pour_connexion($1)', [email])).rows[0] as { empreinte: string | null } | undefined);
  return !!u?.empreinte && await correspond(u.empreinte, motDePasse);
}

// Changer son mot de passe : les autres sessions se ferment, celle-ci reste ouverte.
// `tx` : celle de la route de la console (le journal de l'équipe s'écrit dans la même) ; l'application n'en donne pas.
export async function changerMotDePasse(ctx: Contexte, qui: Qui, actuel: string, nouveau: string, tx?: Dans): Promise<{ ok: true } | Refuse> {
  const email = await monAdresse(ctx, qui, tx);
  const bloque = await attente(ctx, email, tx);
  if (bloque) return bloque;
  if (!await motDePasseBon(ctx, email, actuel, tx)) return erreur(ctx, email, { ok: false, motif: motif('compte.mot_de_passe_actuel_faux'), champ: 'actuel' }, tx);
  const politique = verifierPolitique(nouveau, ctx.listeVolee);
  if (!politique.ok) return { ok: false, motif: politique.motif, champ: 'nouveau' };
  const e = await empreinte(nouveau);
  await dans(ctx, tx, qui.utilisateur, (t) => t.query('select socle.changer_mot_de_passe($1, $2, $3)', [e, qui.session, maintenantDe(ctx)]));
  await dans(ctx, tx, null, (t) => t.query('select socle.effacer_erreurs($1)', [email]));
  return { ok: true };
}

// Changer d'adresse. Avec un relais d'e-mails, la nouvelle reçoit un code (`demande` : à confirmer) ; sans relais, on
// ne sait rien envoyer : l'adresse change tout de suite et reste à vérifier (`demande` : null).
export async function demanderChangementAdresse(ctx: Contexte, qui: Qui, nouvelle: string, motDePasse: string): Promise<{ ok: true; demande: string | null } | Refuse> {
  const email = await monAdresse(ctx, qui);
  const adresse = nouvelle.trim().toLowerCase();
  if (adresse === email.trim().toLowerCase()) return { ok: false, motif: motif('compte.adresse_meme'), champ: 'adresse' };
  const bloque = await attente(ctx, email);
  if (bloque) return bloque;
  if (!await motDePasseBon(ctx, email, motDePasse)) return erreur(ctx, email, { ok: false, motif: motif('compte.mot_de_passe_actuel_faux'), champ: 'motDePasse' });
  await enTantQue(ctx.pool, null, (tx) => tx.query('select socle.effacer_erreurs($1)', [email]));
  const courriel = ctx.courriel;
  if (!courriel) {
    await enTantQue(ctx.pool, qui.utilisateur, (tx) => tx.query('select socle.changer_adresse_sans_code($1)', [adresse]));
    return { ok: true, demande: null };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const demande = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.demander_changement_adresse($1, $2, $3, $4) id',
    [adresse, sha256(code), maintenantDe(ctx), `${DUREE_ADRESSE_MINUTES} minutes`])).rows[0].id as string);
  void courriel.envoi.envoyer({
    a: adresse, objet: rendre(t('compte.adresse_objet', { code }), 'fr'), texte: rendre(t('compte.adresse_texte', { code, minutes: DUREE_ADRESSE_MINUTES }), 'fr'),
    langue: 'fr',
  }).catch((e: unknown) => { console.error(`le code de la nouvelle adresse n'est pas parti : ${String(e)}`); });
  return { ok: true, demande };
}

// Vérifier l'adresse du compte sans en changer (0077) : un code part à cette adresse ; tapé, il la prouve. Qui a le code
// du téléphone ne reçoit jamais de code par e-mail à la connexion : sans ce geste, son adresse ne se prouvait jamais.
// Le texte est celui de l'inscription (« Voici ton code pour vérifier ton adresse e-mail »).
export async function demanderVerificationAdresse(ctx: Contexte, qui: Qui): Promise<{ ok: true; demande: string } | Refuse> {
  const courriel = ctx.courriel;
  if (!courriel) return { ok: false, motif: motif('connexion.oubli_indisponible') };
  const email = await monAdresse(ctx, qui);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const demande = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.demander_verification_adresse($1, $2, $3) id',
    [sha256(code), maintenantDe(ctx), `${DUREE_ADRESSE_MINUTES} minutes`])).rows[0].id as string);
  void courriel.envoi.envoyer({
    a: email, objet: rendre(t('connexion.courriel_objet', { code }), 'fr'), texte: rendre(t('connexion.courriel_inscription', { code, minutes: DUREE_ADRESSE_MINUTES }), 'fr'),
    langue: 'fr',
  }).catch((e: unknown) => { console.error(`le code de vérification de l'adresse n'est pas parti : ${String(e)}`); });
  return { ok: true, demande };
}
export async function confirmerVerificationAdresse(ctx: Contexte, qui: Qui, demande: string, code: string): Promise<{ ok: true } | Refuse> {
  const saisi = code.replace(/\s/g, '');
  const bon = /^[0-9]{6}$/.test(saisi)
    && await enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.confirmer_verification_adresse($1, $2, $3) b', [demande, sha256(saisi), maintenantDe(ctx)])).rows[0].b as boolean);
  return bon ? { ok: true } : { ok: false, motif: motif('connexion.code_faux'), champ: 'code' };
}

// Le code reçu à la nouvelle adresse : elle remplace l'ancienne, prouvée ; l'ancienne est prévenue.
export async function confirmerChangementAdresse(ctx: Contexte, qui: Qui, demande: string, code: string): Promise<{ ok: true } | Refuse> {
  const saisi = code.replace(/\s/g, '');
  const ancienne = /^[0-9]{6}$/.test(saisi)
    ? await enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.confirmer_changement_adresse($1, $2, $3) a', [demande, sha256(saisi), maintenantDe(ctx)])).rows[0].a as string | null)
    : null;
  if (!ancienne) return { ok: false, motif: motif('connexion.code_faux'), champ: 'code' };
  const courriel = ctx.courriel;
  if (courriel) {
    void courriel.envoi.envoyer({
      a: ancienne, objet: rendre(t('compte.adresse_changee_objet'), 'fr'), texte: rendre(t('compte.adresse_changee_texte', { aide: AIDE }), 'fr'),
      bouton: rendre(t('compte.adresse_changee_bouton'), 'fr'), langue: 'fr',
    }).catch((e: unknown) => { console.error(`l'avis à l'ancienne adresse n'est pas parti : ${String(e)}`); });
  }
  return { ok: true };
}
