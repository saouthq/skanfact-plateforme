// Les clés d'accès (passkeys ; 1.390.0, tâche 107 ; migration 0244 ; la vérification : serveur/webauthn.ts).
//
// Deux chemins, chacun en deux temps (le serveur tire un défi, l'appareil le signe) :
//   - ajouter une clé, depuis « Ton compte » : on prouve d'abord son mot de passe (une clé qu'on ajoute est un moyen
//     d'entrer pour toujours ; une session laissée ouverte ne doit pas suffire), et un e-mail le dit à l'adresse du compte ;
//   - se connecter avec elle, depuis l'entrée : ni adresse, ni mot de passe, ni code — l'appareil a demandé l'empreinte, le
//     visage ou son propre code, et la signature ne vaut que pour l'adresse de SkanFact.
// Une clé ne marche que sur une adresse https (ou « localhost » pour les essais) : sur une adresse IP, le navigateur la
// refuse, et l'écran ne la propose pas (`cleDisponible`).
//
// Ce qui part chez le relais d'e-mails (03 § 6) : l'adresse du compte, un objet et un texte fixes. Ni le nom de la clé,
// ni l'appareil.

import { createHash, randomBytes } from 'node:crypto';
import { enTantQue } from './base.ts';
import type { Appareil, Contexte, Qui, ResultatConnexion } from './connexion.ts';
import { prouverMotDePasse, type Refuse } from './compte.ts';
import { origineEtDomaine, verifierAssertion, verifierCreation } from './webauthn.ts';
import { motif, rendre, t } from '../textes/index.ts';

const DUREE = '5 minutes';
const AIDE = 'contact@skanfact.tn';
const maintenantDe = (ctx: Contexte) => (ctx.maintenant ?? (() => new Date()))();

// L'adresse de SkanFact vue par les clés : https, ou http seulement sur « localhost » ; jamais une adresse IP.
export function partieDeConfiance(ctx: Contexte): { origine: string; domaine: string } | null {
  const adresse = ctx.cles?.adresse();
  const od = adresse ? origineEtDomaine(adresse) : null;
  if (!od) return null;
  const ip = /^[0-9.]+$/.test(od.domaine) || od.domaine.includes(':') || od.domaine.startsWith('[');
  if (ip) return null;
  if (!od.origine.startsWith('https://') && od.domaine !== 'localhost') return null;
  return od;
}
export const cleDisponible = (ctx: Contexte) => partieDeConfiance(ctx) !== null;
const indisponible = (): Refuse => ({ ok: false, motif: motif('compte.cle_indisponible') });

// L'identifiant de la personne pour l'appareil : les octets de son identifiant SkanFact (rien de lisible).
const octetsUuid = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex').toString('base64url');

// ── Ajouter une clé ─────────────────────────────────────────────────────────────────────────────────────────────────
export type OptionsCreation = {
  defi: string; challenge: string; rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string }; exclure: string[];
};
export async function preparerCreation(ctx: Contexte, qui: Qui, motDePasse: string): Promise<{ ok: true; options: OptionsCreation } | Refuse> {
  const pc = partieDeConfiance(ctx);
  if (!pc) return indisponible();
  const refus = await prouverMotDePasse(ctx, qui, motDePasse);
  if (refus) return refus;
  const challenge = randomBytes(32).toString('base64url');
  return enTantQue(ctx.pool, qui.utilisateur, async (tx) => {
    const defi = (await tx.query('select socle.ouvrir_defi_cle($1, $2, $3, $4) id', ['creation', challenge, maintenantDe(ctx), DUREE])).rows[0].id as string;
    const u = (await tx.query('select email, nom from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0] as { email: string; nom: string | null };
    const exclure = (await tx.query('select identifiant from socle.mes_cles_acces()')).rows.map((r) => String(r.identifiant));
    return { ok: true as const, options: { defi, challenge, rp: { id: pc.domaine, name: 'SkanFact' }, user: { id: octetsUuid(qui.utilisateur), name: u.email, displayName: u.nom || u.email }, exclure } };
  });
}

export async function terminerCreation(ctx: Contexte, qui: Qui, r: { defi: string; attestation: string; demande: string; nom: string }):
  Promise<{ ok: true; id: string; nom: string } | Refuse> {
  const pc = partieDeConfiance(ctx);
  if (!pc) return indisponible();
  const nom = r.nom.trim().slice(0, 80) || rendre(t('compte.cle_nom_defaut'), 'fr');
  // La même clé ne s'ajoute pas deux fois (elle est peut-être déjà sur un autre compte : on ne dit pas lequel) : la base
  // garde l'identifiant unique, et le refus dit seulement qu'elle est déjà enregistrée.
  const fait = await enTantQue(ctx.pool, qui.utilisateur, async (tx): Promise<{ ok: true; id: string; email: string } | Refuse> => {
    const defi = (await tx.query('select socle.prendre_defi_cle($1, $2, $3) d', [r.defi, 'creation', maintenantDe(ctx)])).rows[0]?.d as string | null;
    if (!defi) return { ok: false, motif: motif('compte.cle_perimee') };
    const v = verifierCreation({ attestation: r.attestation, demande: r.demande }, { defi: Buffer.from(defi, 'base64url'), origine: pc.origine, domaine: pc.domaine });
    if (!v.ok) return { ok: false, motif: motif('compte.cle_refusee') };
    const id = (await tx.query('select socle.ajouter_cle_acces($1, $2, $3, $4, $5, $6) id', [v.identifiant, v.clePublique, v.algorithme, v.compteur, nom, maintenantDe(ctx)])).rows[0].id as string;
    const email = (await tx.query('select email from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0].email as string;
    return { ok: true, id, email };
  }).catch((x: unknown): Refuse => { if ((x as { code?: string }).code === '23505') return { ok: false, motif: motif('compte.cle_deja') }; throw x; });
  if (!fait.ok) return fait;
  const courriel = ctx.courriel;
  if (courriel) {
    void courriel.envoi.envoyer({
      a: fait.email, objet: rendre(t('compte.cle_ajoutee_objet'), 'fr'), texte: rendre(t('compte.cle_ajoutee_texte', { aide: AIDE }), 'fr'),
      bouton: rendre(t('compte.adresse_changee_bouton'), 'fr'), langue: 'fr',
    }).catch((e: unknown) => { console.error(`l'avis de la clé d'accès n'est pas parti : ${String(e)}`); });
  }
  return { ok: true, id: fait.id, nom };
}

export async function mesCles(ctx: Contexte, qui: Qui) {
  return enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select id, nom, creee_le, utilisee_le from socle.mes_cles_acces()')).rows
    .map((c) => ({ id: String(c.id), nom: String(c.nom), creeeLe: (c.creee_le as Date).toISOString(), utiliseeLe: c.utilisee_le ? (c.utilisee_le as Date).toISOString() : null })));
}
export async function retirerCle(ctx: Contexte, qui: Qui, id: string): Promise<boolean> {
  return enTantQue(ctx.pool, qui.utilisateur, async (tx) => (await tx.query('select socle.retirer_cle_acces($1, $2) ok', [id, maintenantDe(ctx)])).rows[0].ok as boolean);
}

// ── Se connecter avec une clé ───────────────────────────────────────────────────────────────────────────────────────
export async function preparerConnexion(ctx: Contexte): Promise<{ ok: true; defi: string; challenge: string; rpId: string } | Refuse> {
  const pc = partieDeConfiance(ctx);
  if (!pc) return indisponible();
  const challenge = randomBytes(32).toString('base64url');
  const defi = await enTantQue(ctx.pool, null, async (tx) =>
    (await tx.query('select socle.ouvrir_defi_cle($1, $2, $3, $4) id', ['connexion', challenge, maintenantDe(ctx), DUREE])).rows[0].id as string | null);
  // Trop de défis ouverts d'un coup : on ne refuse pas l'entrée, on renvoie au mot de passe.
  return defi ? { ok: true, defi, challenge, rpId: pc.domaine } : { ok: false, motif: motif('connexion.cle_occupee') };
}

export async function connecterParCle(ctx: Contexte, d: {
  defi: string; identifiant: string; donnees: string; demande: string; signature: string;
  appareil: Appareil; posteDUnAutre?: boolean | undefined; ip?: string | undefined;
}): Promise<ResultatConnexion> {
  const pc = partieDeConfiance(ctx);
  const refus = (): ResultatConnexion => ({ etat: 'refuse', motif: motif('connexion.cle_refusee') });
  if (!pc) return { etat: 'refuse', motif: motif('compte.cle_indisponible') };
  const maintenant = maintenantDe(ctx);
  const posteDUnAutre = d.posteDUnAutre ?? false;
  return enTantQue(ctx.pool, null, async (tx): Promise<ResultatConnexion> => {
    const defi = (await tx.query('select socle.prendre_defi_cle($1, $2, $3) d', [d.defi, 'connexion', maintenant])).rows[0]?.d as string | null;
    if (!defi) return { etat: 'refuse', motif: motif('connexion.cle_perimee'), perime: true };
    const cle = (await tx.query('select * from socle.cle_pour_connexion($1)', [d.identifiant])).rows[0] as
      { id: string; utilisateur: string; cle_publique: string; algorithme: number; compteur: string | number; email: string } | undefined;
    if (!cle) return refus();
    const v = verifierAssertion({ donnees: d.donnees, demande: d.demande, signature: d.signature },
      { defi: Buffer.from(defi, 'base64url'), origine: pc.origine, domaine: pc.domaine, clePublique: cle.cle_publique, algorithme: cle.algorithme, compteur: Number(cle.compteur) });
    if (!v.ok) return refus();
    await tx.query('select socle.noter_cle_utilisee($1, $2, $3)', [cle.id, v.compteur, maintenant]);
    // L'appareil : celui qu'on connaît déjà, s'il est à cette personne et pas retiré ; sinon un nouveau.
    let appareil = d.appareil.id ?? null;
    const aLui = appareil ? (await tx.query('select socle.appareil_de($1, $2) r', [cle.utilisateur, appareil])).rows[0].r as boolean : false;
    if (!aLui) appareil = (await tx.query('select socle.declarer_appareil($1, $2, $3, $4) id', [cle.utilisateur, d.appareil.nom, d.appareil.type, maintenant])).rows[0].id as string;
    const jeton = randomBytes(32).toString('base64url');
    await tx.query('select socle.ouvrir_session($1, $2, $3, $4, $5, $6, $7)',
      [cle.utilisateur, appareil, createHash('sha256').update(jeton, 'utf8').digest('hex'), maintenant, posteDUnAutre, d.ip ?? null, false]);
    await tx.query('select socle.effacer_erreurs($1)', [cle.email]);
    return { etat: 'connecte', jeton, appareil, codeAConfigurer: false };
  });
}
