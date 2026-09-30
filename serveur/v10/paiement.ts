// Le paiement en ligne (brique 78 ; docs/paiement-en-ligne.md ; 14 § 2.2), du côté du dossier v10 :
//   - le client, depuis son espace, demande à payer le RESTE d'une facture (le chiffre du serveur, la
//     même fonction que partout) : la demande est notée, puis ouverte chez le prestataire avec la clé
//     de l'entreprise (l'argent va sur SON portefeuille) ;
//   - la preuve se redemande au prestataire, avec cette clé, quand son avis arrive ET quand le client
//     revient sur la page de retour (le même geste : un chemin de secours ne sert que s'il se
//     déclenche tout seul) ; ni l'un ni l'autre ne décide ;
//   - prouvé, le règlement s'ajoute à la facture du dossier (sur le compte de trésorerie du
//     prestataire), par le même chemin qu'un règlement saisi, une seule fois.
// Le règlement est au nom du propriétaire de l'entreprise (le client n'est pas un utilisateur) ; la
// trace dit qu'il vient du paiement en ligne.

import { createHash, randomBytes } from 'node:crypto';
import { versTexte } from '../../moteur/argent.ts';
import { soldeFacture } from '../../moteur/reglements.ts';
import { motif, rendre, t, type Texte } from '../../textes/index.ts';
import { enTantQue } from '../base.ts';
import { CoffreFaux, ouvrir } from '../coffre.ts';
import type { Contexte } from '../connexion.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { tracer } from '../trace.ts';
import { initier, lire, verdict } from '../ventes/konnect.ts';
import { appliquer, Conflit, enNombreV10 } from './dossier.ts';

export const empreinte = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const enJson = (m: Texte) => JSON.stringify({ cle: m.cle, valeurs: m.valeurs });
const reglage = (ctx: Contexte) => {
  if (!ctx.paiement) throw new Error('le paiement en ligne n\'est pas réglé sur ce serveur');
  return ctx.paiement;
};
const maintenantDe = (ctx: Contexte) => (ctx.maintenant ?? (() => new Date()))();
// La clé de l'entreprise, ouverte ; null si elle ne s'ouvre plus (le coffre du serveur a changé).
const cleDe = (ctx: Contexte, entreprise: string, scelle: string) => {
  try { return ouvrir(reglage(ctx).coffre, entreprise, scelle); } catch (e) { if (e instanceof CoffreFaux) return null; throw e; }
};
const public_ = <T>(ctx: Contexte, sql: string, valeurs: unknown[]) =>
  enTantQue(ctx.pool, null, async (tx) => (await tx.query(sql, valeurs)).rows[0]?.v as T | null);

type APayer = { entreprise: string; piece: { id: string; devise: string; net: string; avoirs: string[]; reglements: string[] }; prestataire: { portefeuille: string } | null };
type Demande = { id: string; adresse?: string; entreprise?: string; portefeuille?: string; cle_scellee?: string };

export type Demandee = { adresse: string } | { refus: Texte; statut: number };

// « Payer en ligne » : l'adresse où le client paie, ou pourquoi il ne peut pas (null : lien ou pièce
// inconnus).
export async function demanderPaiement(ctx: Contexte, jeton: string, numero: string): Promise<Demandee | null> {
  const r = reglage(ctx);
  const maintenant = maintenantDe(ctx);
  const lien = empreinte(jeton);
  const a = await public_<APayer>(ctx, 'select ventes.espace_a_payer($1, $2) v', [lien, numero]);
  if (!a) return null;
  if (!a.prestataire) return { refus: motif('paiement.pas_en_ligne'), statut: 409 };
  // Le dinar seulement : les autres devises de Konnect, À VÉRIFIER (docs/paiement-en-ligne.md).
  if (a.piece.devise !== 'TND') return { refus: motif('paiement.devise'), statut: 409 };
  const reste = soldeFacture(BigInt(a.piece.net), a.piece.avoirs.map(BigInt), a.piece.reglements.map(BigInt)).reste;
  if (reste <= 0n) return { refus: motif('paiement.rien_a_payer'), statut: 409 };

  const secret = randomBytes(18).toString('base64url');
  const d = await public_<Demande>(ctx, 'select ventes.paiement_demander($1, $2, $3, $4, $5) v', [lien, numero, reste.toString(), empreinte(secret), maintenant]);
  if (!d) return null;
  // Une demande déjà ouverte se redonne, sauf si elle est déjà payée (son avis perdu) : on le sait en le
  // demandant, et elle s'enregistre au passage ; rien ne se paie deux fois.
  if (d.adresse) {
    const e = await verifierPaiement(ctx, { id: d.id });
    if (e?.etat === 'encaisse') return { refus: motif('paiement.rien_a_payer'), statut: 409 };
    // Refusée entre-temps (un « payé » qui ne correspondait pas) : une nouvelle demande.
    if (e?.etat === 'echoue') return demanderPaiement(ctx, jeton, numero);
    return { adresse: d.adresse };
  }
  const base = r.adresse();
  // Le retour porte la demande et son secret dans le fragment « # » : le navigateur ne l'envoie à
  // personne, et une référence que le prestataire ajouterait à l'adresse ne le coupe pas.
  const retour = `${base}/espace/retour.html#paiement=${d.id}&s=${secret}`;
  const cle = cleDe(ctx, String(d.entreprise), String(d.cle_scellee));
  if (cle === null) {
    await public_(ctx, 'select ventes.paiement_refuse($1, $2, $3) v', [d.id, enJson(t('paiement.cle_illisible')), maintenant]);
    return { refus: motif('paiement.prestataire_indisponible'), statut: 502 };
  }
  const ouvert = await initier(r.konnect, cle, {
    portefeuille: String(d.portefeuille), montant: reste, devise: 'TND', commande: d.id, description: rendre(t('paiement.description', { numero }), 'fr'),
    avis: `${base}/v1/paiements/konnect`, succes: retour, echec: `${retour}&echec=1`,
  });
  if (!ouvert.ok) {
    await public_(ctx, 'select ventes.paiement_refuse($1, $2, $3) v', [d.id, enJson(ouvert.motif), maintenant]);
    return { refus: motif('paiement.prestataire_indisponible'), statut: 502 };
  }
  await public_(ctx, 'select ventes.paiement_initie($1, $2, $3) v', [d.id, ouvert.ref, ouvert.adresse]);
  return { adresse: ouvert.adresse };
}

type AVerifier = {
  id: string; entreprise: string; piece_v10: string; numero: string; montant: string; devise: string; decimales: number;
  statut: 'initie' | 'encaisse' | 'echoue'; ref: string | null; retour_empreinte: string;
  portefeuille: string | null; cle_scellee: string | null; compte_v10: string | null; proprietaire: string | null;
};
// `montant` : en texte exact, comme partout (« 873.190 »).
export type Etat = { etat: 'encaisse' | 'attente' | 'echoue'; id: string; numero: string; montant: string; devise: string };

// Où en est une demande (par notre identifiant, ou par la référence du prestataire) : on le redemande
// au prestataire, et un paiement prouvé s'enregistre. Null : demande inconnue, ou (pour la page de
// retour) un secret qui n'est pas le sien : on ne questionne alors même pas le prestataire.
export async function verifierPaiement(ctx: Contexte, par: { id?: string; ref?: string; secret?: string }): Promise<Etat | null> {
  const r = reglage(ctx);
  const v = await public_<AVerifier>(ctx, 'select ventes.paiement_a_verifier($1, $2) v', [par.id ?? null, par.ref ?? null]);
  if (!v) return null;
  if (par.secret !== undefined && v.retour_empreinte !== empreinte(par.secret)) return null;
  const etat = (e: Etat['etat']): Etat => ({ etat: e, id: v.id, numero: v.numero, montant: versTexte(BigInt(v.montant), v.decimales), devise: v.devise });
  if (v.statut !== 'initie') return etat(v.statut === 'encaisse' ? 'encaisse' : 'echoue');
  // Pas encore ouvert chez le prestataire, ou l'entreprise a débranché son prestataire : on attend.
  const cle = v.cle_scellee ? cleDe(ctx, v.entreprise, v.cle_scellee) : null;
  if (!v.ref || !cle || !v.compte_v10) return etat('attente');
  const lu = await lire(r.konnect, cle, v.ref);
  if (!lu.ok) return etat('attente');
  const verdit = verdict(lu.paiement, { commande: v.id, montant: BigInt(v.montant) });
  if (verdit.etat === 'attente') return etat('attente');
  if (verdit.etat === 'echoue') {
    await public_(ctx, 'select ventes.paiement_echoue($1, $2) v', [v.id, enJson(verdit.motif)]);
    return etat('echoue');
  }
  return etat(await enregistrer(ctx, v) ? 'encaisse' : 'attente');
}

// Le filet : les demandes ouvertes depuis quelques minutes (et moins d'un jour) se redemandent au
// prestataire. Un avis perdu et un client qui ferme la page avant de revenir ne laissent donc pas un
// paiement reçu hors de sa facture (un chemin de secours ne sert que s'il se déclenche tout seul).
export async function verifierEnAttente(ctx: Contexte): Promise<number> {
  const ids = await public_<string[]>(ctx, 'select ventes.paiements_a_revoir($1) v', [maintenantDe(ctx)]);
  let encaisses = 0;
  for (const id of ids ?? []) if ((await verifierPaiement(ctx, { id }))?.etat === 'encaisse') encaisses++;
  return encaisses;
}

// Le paiement prouvé s'ajoute à la facture du dossier, une seule fois (la demande est verrouillée, et
// un paiement déjà enregistré ne se refait pas). Une pièce changée entre-temps : on relit, deux fois.
// Faux s'il n'a pas pu s'enregistrer (la raison est notée sur la demande : l'entreprise la voit).
async function enregistrer(ctx: Contexte, v: AVerifier): Promise<boolean> {
  const proprietaire = v.proprietaire;
  if (!proprietaire) return false;
  const maintenant = maintenantDe(ctx);
  for (let essai = 0; ; essai++) {
    try {
      await enTantQue(ctx.pool, proprietaire, async (tx) => {
        const x = (await tx.query('select statut from ventes.paiement_en_ligne where id = $1 for update', [v.id])).rows[0] as { statut: string } | undefined;
        if (!x || x.statut !== 'initie') return;
        const doc = (await tx.query("select contenu, revision, rang from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2",
          [v.entreprise, v.piece_v10])).rows[0] as { contenu: Record<string, unknown>; revision: string; rang: number | null } | undefined;
        if (!doc) throw new Error(`pièce du dossier introuvable : ${v.piece_v10}`);
        const id = `en-ligne-${v.id}`;
        const reglement = {
          id, date: aujourdhuiATunis(maintenant), amount: enNombreV10(versTexte(BigInt(v.montant), v.decimales)), method: 'en_ligne',
          reference: `Konnect ${v.ref ?? ''}`, accountId: v.compte_v10, note: '',
        };
        const paiements = Array.isArray(doc.contenu.payments) ? doc.contenu.payments : [];
        await appliquer(tx, v.entreprise, proprietaire, [{ collection: 'documents', cle: v.piece_v10, rang: doc.rang, revision: Number(doc.revision), contenu: { ...doc.contenu, payments: [...paiements, reglement] } }]);
        await tx.query("update ventes.paiement_en_ligne set statut = 'encaisse', prouve_le = $2, encaisse_le = $2, reglement_v10 = $3, motif = null where id = $1", [v.id, maintenant, id]);
        await tracer(tx, v.entreprise, 'ventes.paiement_en_ligne.encaisser', { type: 'paiement_en_ligne', id: v.id }, null, { piece: v.numero, montant: v.montant, ref: v.ref });
      });
      return true;
    } catch (e) {
      if (e instanceof Conflit && essai < 2) continue;
      // Prouvé, pas enregistré : la raison se note (un refus du dossier), et un prochain avis réessaiera.
      const pourquoi = e instanceof Error && 'texte' in e ? (e as { texte: Texte }).texte : t('paiement.non_enregistre');
      await enTantQue(ctx.pool, proprietaire, async (tx) => {
        await tx.query("update ventes.paiement_en_ligne set prouve_le = coalesce(prouve_le, $2), motif = $3 where id = $1 and statut = 'initie'", [v.id, maintenant, enJson(pourquoi)]);
      });
      return false;
    }
  }
}
