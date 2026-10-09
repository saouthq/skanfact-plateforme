// Ton compte (lot onboarding, décision de Skander du 09/10/2026 ; skanfact docs/cadrage/03-droits.md § 6 ; migration
// 0076 ; docs/entree.md) : le code du téléphone qu'on retire ou dont on renouvelle les codes de secours, le mot de passe
// et l'adresse qu'on change, ou qu'on vérifie (0077). Chaque geste qui affaiblit ou déplace le compte se prouve
// d'abord : le code du moment (ou un code de secours) pour le code, le mot de passe actuel pour le mot de passe et
// l'adresse. Les erreurs comptent comme à la connexion (une attente qui s'allonge, jamais un blocage).
//
// Ce qui part chez le relais d'e-mails, compté et décidé (03 § 6) : l'adresse, l'objet, et un texte qui ne porte que le
// code ou le lien. La confirmation d'un code retiré ne porte que l'adresse de l'application ; celle d'une adresse
// changée, partie à l'ancienne, ne nomme pas la nouvelle.

import { createHash, randomInt } from 'node:crypto';
import { attenteLisible, empreinteDuSecours, tirerCodesDeSecours, type Contexte, type Qui } from './connexion.ts';
import { enTantQue } from './base.ts';
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
async function monAdresse(ctx: Contexte, qui: Qui): Promise<string> {
  return enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select email from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0].email as string);
}
async function attente(ctx: Contexte, email: string): Promise<Refuse | null> {
  const maintenant = maintenantDe(ctx);
  const a = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select socle.attente_connexion($1, $2) a', [email, maintenant])).rows[0].a as Date | null);
  return a ? { ok: false, motif: attenteLisible(a, maintenant), attendre: true } : null;
}
async function erreur(ctx: Contexte, email: string, refus: Refuse): Promise<Refuse> {
  const maintenant = maintenantDe(ctx);
  const a = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select socle.noter_erreur($1, $2) a', [email, maintenant])).rows[0].a as Date | null);
  return a ? { ok: false, motif: attenteLisible(a, maintenant), attendre: true, ...(refus.champ ? { champ: refus.champ } : {}) } : refus;
}

// Le code de l'application, ou un code de secours encore valable : c'est bien la personne. Le code par SMS n'est pas
// encore en service (03 § 6) : qui l'aurait prouve par un code de secours.
async function monCodeEstBon(ctx: Contexte, qui: Qui, code: string): Promise<boolean> {
  const maintenant = maintenantDe(ctx);
  const saisi = code.replace(/\s/g, '');
  return enTantQue(ctx.pool, qui.utilisateur, async (tx) => {
    if (/^[0-9]{6}$/.test(saisi)) {
      const secret = (await tx.query('select socle.mon_secret_d_application() s')).rows[0]?.s as string | null;
      return !!secret && verifierTotp(secret, saisi, maintenant.getTime());
    }
    const e = empreinteDuSecours(saisi.toUpperCase());
    const restants = (await tx.query('select * from socle.codes_secours_restants($1)', [qui.utilisateur])).rows as { empreinte: string }[];
    return restants.some((r) => r.empreinte === e);
  });
}

// Activer le code du téléphone en deux temps (0076 § 1 bis). Préparé d'abord : le secret et les codes de secours
// attendent une heure au plus et ne remplacent rien ; une activation abandonnée ne ferme donc jamais la porte. Une
// page rechargée garde le même secret (pas de seconde ligne SkanFact dans l'application) ; les codes de secours, gardés
// en empreinte, se tirent à nouveau. Qui a déjà un code (il change de téléphone) prouve d'abord l'actuel, ou un code de
// secours : une session volée ne suffit pas à mettre son téléphone à la place du sien.
export async function preparerCode(ctx: Contexte, qui: Qui, code?: string): Promise<{ ok: true; codesDeSecours: string[]; adresseApplication: string; cle: string } | Refuse> {
  const maintenant = maintenantDe(ctx);
  const { email, actif } = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => {
    const u = (await tx.query('select email, code_methode from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0] as { email: string; code_methode: string | null };
    return { email: u.email, actif: u.code_methode !== null };
  });
  if (actif) {
    if (!code?.trim()) return { ok: false, motif: motif('compte.code_actuel_manque'), champ: 'code' };
    const bloque = await attente(ctx, email);
    if (bloque) return bloque;
    if (!await monCodeEstBon(ctx, qui, code)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' });
    await enTantQue(ctx.pool, null, (tx) => tx.query('select socle.effacer_erreurs($1)', [email]));
  }
  const codes = tirerCodesDeSecours();
  const secret = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => {
    const s = ((await tx.query('select socle.mon_secret_en_attente($1) s', [maintenant])).rows[0]?.s as string | null) ?? nouveauSecret();
    await tx.query('select socle.preparer_code($1, $2, $3)', [s, codes.map(empreinteDuSecours), maintenant]);
    return s;
  });
  return { ok: true, codesDeSecours: codes, adresseApplication: adresseTotp(secret, email), cle: secret };
}

// Le premier code de l'application qu'on vient d'ajouter : juste, le code préparé devient celui du compte. Une erreur
// ici ne se compte pas comme à la connexion (la personne a déjà sa session ; le secret vient de lui être montré).
export async function activerCode(ctx: Contexte, qui: Qui, code: string): Promise<{ ok: true } | Refuse> {
  const maintenant = maintenantDe(ctx);
  const saisi = code.replace(/\s/g, '');
  return enTantQue(ctx.pool, qui.utilisateur, async (tx): Promise<{ ok: true } | Refuse> => {
    const secret = (await tx.query('select socle.mon_secret_en_attente($1) s', [maintenant])).rows[0]?.s as string | null;
    if (!secret) return { ok: false, motif: motif('compte.code_attente_perimee') };
    if (!/^[0-9]{6}$/.test(saisi) || !verifierTotp(secret, saisi, maintenant.getTime())) return { ok: false, motif: motif('compte.code_essai_faux'), champ: 'code' };
    const active = (await tx.query('select socle.activer_code_en_attente($1) a', [maintenant])).rows[0].a as boolean;
    return active ? { ok: true } : { ok: false, motif: motif('compte.code_attente_perimee') };
  });
}

// Retirer le code du téléphone. Un e-mail le confirme (si ce serveur sait en envoyer) : qui ne l'a pas fait le saura.
export async function retirerCode(ctx: Contexte, qui: Qui, code: string): Promise<{ ok: true; confirme: boolean } | Refuse> {
  const email = await monAdresse(ctx, qui);
  const bloque = await attente(ctx, email);
  if (bloque) return bloque;
  if (!await monCodeEstBon(ctx, qui, code)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' });
  const a = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.retirer_code() a')).rows[0].a as string);
  await enTantQue(ctx.pool, null, (tx) => tx.query('select socle.effacer_erreurs($1)', [email]));
  const courriel = ctx.courriel;
  if (courriel) {
    void courriel.envoi.envoyer({
      a, objet: rendre(t('compte.code_retire_objet'), 'fr'), texte: rendre(t('compte.code_retire_texte', { adresse: courriel.adresse() }), 'fr'),
    }).catch((e: unknown) => { console.error(`la confirmation du code retiré n'est pas partie : ${String(e)}`); });
  }
  return { ok: true, confirme: !!courriel };
}

// De nouveaux codes de secours, à montrer UNE fois (les anciens ne valent plus).
export async function nouveauxCodesDeSecours(ctx: Contexte, qui: Qui, code: string): Promise<{ ok: true; codes: string[] } | Refuse> {
  const email = await monAdresse(ctx, qui);
  const bloque = await attente(ctx, email);
  if (bloque) return bloque;
  if (!await monCodeEstBon(ctx, qui, code)) return erreur(ctx, email, { ok: false, motif: motif('connexion.code_faux'), champ: 'code' });
  const codes = tirerCodesDeSecours();
  await enTantQue(ctx.pool, qui.utilisateur, (tx) => tx.query('select socle.nouveaux_codes_secours($1)', [codes.map(empreinteDuSecours)]));
  await enTantQue(ctx.pool, null, (tx) => tx.query('select socle.effacer_erreurs($1)', [email]));
  return { ok: true, codes };
}

// Le mot de passe actuel est-il le bon ?
async function motDePasseBon(ctx: Contexte, email: string, motDePasse: string): Promise<boolean> {
  const u = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select empreinte from socle.pour_connexion($1)', [email])).rows[0] as { empreinte: string | null } | undefined);
  return !!u?.empreinte && await correspond(u.empreinte, motDePasse);
}

// Changer son mot de passe : les autres sessions se ferment, celle-ci reste ouverte.
export async function changerMotDePasse(ctx: Contexte, qui: Qui, actuel: string, nouveau: string): Promise<{ ok: true } | Refuse> {
  const email = await monAdresse(ctx, qui);
  const bloque = await attente(ctx, email);
  if (bloque) return bloque;
  if (!await motDePasseBon(ctx, email, actuel)) return erreur(ctx, email, { ok: false, motif: motif('compte.mot_de_passe_actuel_faux'), champ: 'actuel' });
  const politique = verifierPolitique(nouveau, ctx.listeVolee);
  if (!politique.ok) return { ok: false, motif: politique.motif, champ: 'nouveau' };
  const e = await empreinte(nouveau);
  await enTantQue(ctx.pool, qui.utilisateur, (tx) => tx.query('select socle.changer_mot_de_passe($1, $2, $3)', [e, qui.session, maintenantDe(ctx)]));
  await enTantQue(ctx.pool, null, (tx) => tx.query('select socle.effacer_erreurs($1)', [email]));
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
    }).catch((e: unknown) => { console.error(`l'avis à l'ancienne adresse n'est pas parti : ${String(e)}`); });
  }
  return { ok: true };
}
