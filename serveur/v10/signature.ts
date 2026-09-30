// La signature de la facture électronique (brique 81 ; docs/facture-electronique.md ; vision § 5) : DigiGo
// (TunTrust) signe à distance. L'entreprise désigne son signataire (son identifiant DigiGo) ; signer une ou
// plusieurs pièces émises ouvre une session DigiGo pour lui, un code part sur SON téléphone, et ce code tapé
// autorise la signature des fichiers TEIF que le serveur a écrits à l'émission. Le fichier signé se garde
// (jamais réécrit), après une vérification : la signature enveloppe le fichier envoyé, au caractère près.

import { createHash } from 'node:crypto';
import { motif, type Texte } from '../../textes/index.ts';
import type { Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { Refus } from '../erreurs.ts';
import { tracer } from '../trace.ts';
import { activer, ouvrirSession, signatureEnveloppe, signer } from './digigo.ts';
import { mettreEnRoute } from './envoi.ts';
import './textes.ts';

const ESSAIS = 3;
const reglage = (ctx: Contexte) => {
  if (!ctx.efacture) throw new Refus('efacture.signature_indisponible');
  return ctx.efacture;
};
const maintenantDe = (ctx: Contexte) => (ctx.maintenant ?? (() => new Date()))();
const phrase = (x: Texte) => motif(x.cle, x.valeurs);
type Reponse = { statut?: number; corps: Record<string, unknown> };

// Demander la signature de pièces émises (par leur clé du dossier) : chacune a son fichier, aucune n'est
// signée ; DigiGo envoie un code au signataire.
export async function demanderSignature(ctx: Contexte, tx: Transaction, entreprise: string, utilisateur: string, cles: string[]): Promise<Reponse> {
  const r = reglage(ctx);
  const s = (await tx.query('select identifiant from ventes.signataire where entreprise = $1', [entreprise])).rows[0] as { identifiant: string } | undefined;
  if (!s) throw new Refus('efacture.sans_signataire', { bouton: 'efacture.signataire' });
  const lues = (await tx.query(`select p.id, p.ref_v10, p.numero_texte, (e.piece is not null) fichier, (g.piece is not null) signee
      from ventes.piece p left join ventes.efacture e on e.piece = p.id left join ventes.efacture_signee g on g.piece = p.id
     where p.entreprise = $1 and p.ref_v10 = any($2::text[]) and p.statut = 'emise'`, [entreprise, cles])).rows as { id: string; ref_v10: string; numero_texte: string; fichier: boolean; signee: boolean }[];
  const pieces: string[] = [];
  for (const cle of cles) {
    const p = lues.find((x) => x.ref_v10 === cle);
    if (!p?.fichier) throw new Refus('efacture.sans_fichier', { valeurs: { numero: p?.numero_texte ?? cle } });
    if (p.signee) throw new Refus('efacture.deja_signee', { valeurs: { numero: p.numero_texte } });
    pieces.push(p.id);
  }
  const o = await ouvrirSession(r.digigo, r.cleDigigo, s.identifiant);
  if (!o.ok) return { statut: 502, corps: { motif: phrase(o.motif) } };
  const id = String((await tx.query(`insert into ventes.signature_demande (entreprise, pieces, identifiant, session, titulaire, cree_le, cree_par)
    values ($1, $2, $3, $4, $5, $6, $7) returning id`, [entreprise, pieces, s.identifiant, o.valeur.session, o.valeur.nom ?? null, maintenantDe(ctx), utilisateur])).rows[0].id);
  return { statut: 201, corps: { id, titulaire: o.valeur.nom ?? null, pieces: pieces.length } };
}

// Le code reçu par le signataire : il active la session, et chaque fichier se signe. Trois codes faux, et la
// demande est perdue (rien n'est signé).
export async function signerAvecLeCode(ctx: Contexte, tx: Transaction, entreprise: string, utilisateur: string, demande: string, code: string): Promise<Reponse> {
  const r = reglage(ctx);
  const d = (await tx.query(`select id, pieces, session, titulaire, statut, essais from ventes.signature_demande
    where id = $1 and entreprise = $2 for update`, [demande, entreprise])).rows[0] as { id: string; pieces: string[]; session: string; titulaire: string | null; statut: string; essais: number } | undefined;
  if (!d) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
  if (d.statut !== 'code_envoye') throw new Refus('efacture.demande_finie', { bouton: 'efacture.recommencer' });
  // Une demande à moitié signée se recommence : la session a servi, la demande est perdue, et on dit
  // pourquoi (le bouton qui débloque : un nouveau code).
  const echec = async (m: Texte) => {
    await tx.query(`update ventes.signature_demande set statut = 'echouee', motif = $2 where id = $1`, [d.id, JSON.stringify({ cle: m.cle, valeurs: m.valeurs })]);
    return { statut: 502, corps: { motif: phrase(m), bouton: 'efacture.recommencer' } };
  };
  const a = await activer(r.digigo, r.cleDigigo, d.session, code);
  if (!a.ok) {
    // DigiGo ne répond pas : le même code se retape. Il refuse la session (expirée, inconnue, bloquée) :
    // elle ne servira plus, la demande est perdue.
    if (a.statut === 0 || a.statut >= 500) return { statut: 502, corps: { motif: phrase(a.motif), bouton: null } };
    if (a.statut !== 401) return echec(a.motif);
    const essais = d.essais + 1;
    const perdue = essais >= ESSAIS;
    await tx.query(`update ventes.signature_demande set essais = $2, statut = $3 where id = $1`, [d.id, essais, perdue ? 'echouee' : 'code_envoye']);
    const restants = ESSAIS - essais;
    // Perdue, la demande se recommence (le bouton le dit) ; sinon, le même code se retape.
    return { statut: 409, corps: perdue ? { motif: motif('efacture.code_epuise'), bouton: 'efacture.recommencer' }
      : { motif: restants === 1 ? motif('efacture.code_faux_dernier') : motif('efacture.code_faux', { restants }), bouton: null } };
  }
  // Chaque fichier se signe ; rien ne se garde tant que TOUS ne le sont pas.
  const faits: { piece: string; xml: string; numero: string }[] = [];
  for (const piece of d.pieces) {
    const f = (await tx.query(`select e.xml, p.numero_texte from ventes.efacture e join ventes.piece p on p.id = e.piece where e.piece = $1`, [piece])).rows[0] as { xml: string; numero_texte: string };
    const s = await signer(r.digigo, r.cleDigigo, d.session, f.xml);
    if (!s.ok) return echec(s.motif);
    // Deux chemins, un fichier : ce que DigiGo rend est le fichier envoyé, avec une signature, rien d'autre.
    if (!signatureEnveloppe(f.xml, s.valeur)) return echec(motif('efacture.signature_fausse'));
    faits.push({ piece, xml: s.valeur, numero: f.numero_texte });
  }
  const maintenant = maintenantDe(ctx);
  for (const f of faits) {
    await tx.query(`insert into ventes.efacture_signee (piece, entreprise, xml, empreinte, titulaire, demande, signe_le, signe_par)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`, [f.piece, entreprise, f.xml, createHash('sha256').update(f.xml, 'utf8').digest('hex'), d.titulaire, d.id, maintenant, utilisateur]);
    await tracer(tx, entreprise, 'ventes.facture.signer', { type: 'piece', id: f.piece }, null, { demande: d.id, numero: f.numero, titulaire: d.titulaire });
  }
  // Signées, elles partent d'elles-mêmes à la TTN (brique 82).
  await mettreEnRoute(tx, entreprise, utilisateur, faits.map((f) => f.piece), maintenant);
  const signees = faits.map((f) => f.numero);
  await tx.query(`update ventes.signature_demande set statut = 'signee', essais = $2 where id = $1`, [d.id, d.essais]);
  return { corps: { signees, titulaire: d.titulaire, signeLe: maintenant.toISOString() } };
}
