// L'envoi à la TTN (brique 82 ; docs/facture-electronique.md ; 05 § 3.1 et 3.8). Une pièce signée part
// d'elle-même : le facteur (un tour du serveur, toutes les minutes) prend les envois dus, et pour chacun :
//   1. le bail, dans une transaction courte : aucun autre tour n'y touche pendant cinq minutes ;
//   2. la TTN, hors transaction : d'abord « as-tu déjà cette pièce ? » (jamais deux dépôts, même quand la
//      réponse d'un dépôt s'est perdue), puis le dépôt s'il le faut ; une pièce déposée se consulte jusqu'à
//      ce que la TTN l'accepte (sa référence, son code QR, la facture validée) ou la refuse (pourquoi) ;
//   3. l'issue, dans une transaction courte, et le bail rendu.
// Une panne se réessaie (1, 5, 15 minutes, puis toutes les heures) ; un compte absent ou refusé retient la
// pièce, et le dit, jusqu'à ce qu'il soit posé ou corrigé. Une entreprise d'essai n'envoie jamais rien.

import { motif, t, type Texte } from '../../textes/index.ts';
import { enTantQue, type Transaction } from '../base.ts';
import { CoffreFaux, ouvrir, sceller } from '../coffre.ts';
import type { Contexte } from '../connexion.ts';
import { Refus } from '../erreurs.ts';
import { tracer } from '../trace.ts';
import { appliquer } from './dossier.ts';
import { champ, consulter, deposer, type Compte, type Depot } from './ttn.ts';
import './textes.ts';

const MINUTE = 60_000;
const ATTENTES = [1, 5, 15, 60];
const attente = (essais: number) => (ATTENTES[Math.min(essais, ATTENTES.length - 1)] ?? 60) * MINUTE;
const BAIL = 5 * MINUTE;
const maintenantDe = (ctx: Contexte) => (ctx.maintenant ?? (() => new Date()))();
const enJson = (m: Texte) => JSON.stringify({ cle: m.cle, valeurs: m.valeurs });
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

type Du = { piece: string; entreprise: string; proprietaire: string | null };
type Pris = { statut: 'a_envoyer' | 'deposee'; essais: number; xml: string; numero: string; compte: { identifiant: string; mot_de_passe_scelle: string } | null };
// L'issue d'un tour pour une pièce.
type Issue =
  | { quoi: 'attendre'; motif: Texte | null; essais: number; apres: number; compteRefuse?: Texte }
  | { quoi: 'deposee'; depot: Depot | null; essais: number; apres: number }
  | { quoi: 'acceptee'; depot: Depot }
  | { quoi: 'refusee'; motif: Texte };

// Signée, une pièce se met en route vers la TTN (une entreprise d'essai : jamais).
export async function mettreEnRoute(tx: Transaction, entreprise: string, utilisateur: string, pieces: string[], maintenant: Date): Promise<void> {
  const e = (await tx.query('select essai from socle.entreprise where id = $1', [entreprise])).rows[0] as { essai: boolean } | undefined;
  if (!e || e.essai) return;
  for (const piece of pieces) {
    await tx.query(`insert into ventes.envoi_ttn (piece, entreprise, prochain_essai, cree_le, cree_par) values ($1, $2, $3, $3, $4)
      on conflict (piece) do nothing`, [piece, entreprise, maintenant, utilisateur]);
  }
}

// Un tour du facteur : le nombre de pièces qu'il a fait avancer.
export async function envoyerALaTtn(ctx: Contexte): Promise<number> {
  const adresse = ctx.ttn?.adresse;
  if (!adresse || !ctx.ttn) return 0;
  const maintenant = maintenantDe(ctx);
  const dus = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select ventes.envois_ttn_dus($1) v', [maintenant])).rows[0]?.v as Du[] | null);
  let faits = 0;
  for (const d of dus ?? []) if (d.proprietaire && await unEnvoi(ctx, adresse, ctx.ttn.coffre, { ...d, proprietaire: d.proprietaire })) faits++;
  return faits;
}

async function unEnvoi(ctx: Contexte, adresse: string, coffre: Buffer, d: Du & { proprietaire: string }): Promise<boolean> {
  const maintenant = maintenantDe(ctx);
  // 1. Le bail : si un autre tour l'a déjà, on passe.
  const pris = await enTantQue(ctx.pool, d.proprietaire, async (tx): Promise<Pris | null> => {
    const x = (await tx.query(`update ventes.envoi_ttn set bail = $2 where piece = $1 and statut in ('a_envoyer', 'deposee')
        and prochain_essai <= $3 and (bail is null or bail < $3) returning statut, essais`, [d.piece, plus(maintenant, BAIL), maintenant])).rows[0] as
      { statut: 'a_envoyer' | 'deposee'; essais: number } | undefined;
    if (!x) return null;
    const f = (await tx.query(`select g.xml, p.numero_texte from ventes.efacture_signee g join ventes.piece p on p.id = g.piece where g.piece = $1`, [d.piece])).rows[0] as
      { xml: string; numero_texte: string };
    const compte = (await tx.query('select ventes.ttn_compte_scelle($1) v', [d.entreprise])).rows[0]?.v as Pris['compte'];
    return { ...x, xml: f.xml, numero: f.numero_texte, compte };
  });
  if (!pris) return false;
  // 2. La TTN (hors transaction). 3. L'issue, et le bail rendu.
  const issue = await aLaTtn(adresse, coffre, d.entreprise, pris);
  await enTantQue(ctx.pool, d.proprietaire, (tx) => noter(tx, d, pris, issue, maintenantDe(ctx)));
  return true;
}

async function aLaTtn(adresse: string, coffre: Buffer, entreprise: string, e: Pris): Promise<Issue> {
  const retenir = (m: Texte, compteRefuse?: Texte): Issue => ({ quoi: 'attendre', motif: m, essais: e.essais, apres: 60 * MINUTE, ...(compteRefuse ? { compteRefuse } : {}) });
  const panne = (m: Texte): Issue => ({ quoi: 'attendre', motif: m, essais: e.essais + 1, apres: attente(e.essais) });
  if (!e.compte) return retenir(t('ttn.sans_compte'));
  let motDePasse: string;
  try {
    motDePasse = ouvrir(coffre, entreprise, e.compte.mot_de_passe_scelle);
  } catch (x) {
    if (x instanceof CoffreFaux) return retenir(t('ttn.compte_illisible'));
    throw x;
  }
  const compte: Compte = { identifiant: e.compte.identifiant, motDePasse, matricule: champ(e.xml, 'MessageSenderIdentifier')?.trim() ?? '' };
  // Jamais deux fois : la TTN a-t-elle déjà cette pièce ? (Un refus ici n'est pas celui de la pièce, qui n'a
  // rien demandé : c'est le compte.)
  const vu = await consulter(adresse, compte, e.numero);
  if (!vu.ok) {
    if (vu.panne) return panne(vu.motif);
    const m = t('ttn.compte_refuse', { message: vu.message });
    return retenir(m, m);
  }
  if (vu.valeur) return verdict(vu.valeur, e);
  // Déposée, mais pas encore visible à la TTN : on repassera.
  if (e.statut === 'deposee') return { quoi: 'deposee', depot: null, essais: e.essais + 1, apres: attente(e.essais) };
  const r = await deposer(adresse, compte, e.xml);
  if (!r.ok) return r.panne ? panne(r.motif) : { quoi: 'refusee', motif: t('ttn.depot_refuse', { message: r.message }) };
  return { quoi: 'deposee', depot: null, essais: 0, apres: MINUTE };
}

// Ce que dit la TTN d'une pièce qu'elle a : acceptée (sa référence et la facture validée), refusée (ses
// accusés), ou encore en traitement.
function verdict(depot: Depot, e: Pris): Issue {
  if (depot.reference && depot.xmlValide) return { quoi: 'acceptee', depot };
  if (depot.accuses.length) return { quoi: 'refusee', motif: t('ttn.refusee', { accuses: depot.accuses.map((a) => (a.code ? `${a.code} : ${a.message}` : a.message)).join(' ; ') }) };
  return { quoi: 'deposee', depot, essais: e.statut === 'deposee' ? e.essais + 1 : 0, apres: attente(e.statut === 'deposee' ? e.essais : 0) };
}

async function noter(tx: Transaction, d: Du & { proprietaire: string }, e: Pris, issue: Issue, maintenant: Date): Promise<void> {
  const objet = { type: 'piece', id: d.piece };
  switch (issue.quoi) {
    case 'attendre':
      await tx.query(`update ventes.envoi_ttn set bail = null, essais = $2, prochain_essai = $3, motif = $4 where piece = $1`,
        [d.piece, issue.essais, plus(maintenant, issue.apres), issue.motif ? enJson(issue.motif) : null]);
      if (issue.compteRefuse) {
        await tx.query('update ventes.ttn_compte set dernier_refus = $2, dernier_refus_le = $3 where entreprise = $1', [d.entreprise, enJson(issue.compteRefuse), maintenant]);
      }
      return;
    case 'deposee':
      await tx.query(`update ventes.envoi_ttn set statut = 'deposee', depose_le = coalesce(depose_le, $2), id_ttn = coalesce($3, id_ttn),
          essais = $4, prochain_essai = $5, motif = null, bail = null where piece = $1`,
        [d.piece, maintenant, issue.depot?.idTtn ?? null, issue.essais, plus(maintenant, issue.apres)]);
      if (e.statut === 'a_envoyer') await tracer(tx, d.entreprise, 'ventes.facture.envoyer', objet, null, { etape: 'deposee', numero: e.numero });
      return;
    case 'acceptee':
      await tx.query(`update ventes.envoi_ttn set statut = 'acceptee', depose_le = coalesce(depose_le, $2), accepte_le = $2, id_ttn = coalesce($3, id_ttn),
          reference = $4, qr = $5, xml_valide = $6, motif = null, bail = null where piece = $1`,
        [d.piece, maintenant, issue.depot.idTtn, issue.depot.reference, issue.depot.qr, issue.depot.xmlValide]);
      await tracer(tx, d.entreprise, 'ventes.facture.envoyer', objet, null, { etape: 'acceptee', numero: e.numero, reference: issue.depot.reference });
      await poserLaReference(tx, d, issue.depot, maintenant);
      return;
    case 'refusee':
      await tx.query(`update ventes.envoi_ttn set statut = 'refusee', motif = $2, bail = null where piece = $1`, [d.piece, enJson(issue.motif)]);
      await tracer(tx, d.entreprise, 'ventes.facture.envoyer', objet, null, { etape: 'refusee', numero: e.numero, motif: issue.motif.cle });
      return;
  }
}

// Acceptée, la pièce du dossier porte sa référence et le contenu de son code QR (brique 83) : elle s'imprime
// avec, à l'écran comme dans l'espace client. Seul le serveur les écrit (serveur/v10/dossier.ts).
async function poserLaReference(tx: Transaction, d: Du & { proprietaire: string }, depot: Depot, maintenant: Date): Promise<void> {
  const x = (await tx.query(`select dv.contenu, dv.revision, dv.rang, p.ref_v10 from ventes.piece p
      join socle.dossier_v10 dv on dv.entreprise = p.entreprise and dv.collection = 'documents' and dv.cle = p.ref_v10 where p.id = $1`, [d.piece])).rows[0] as
    { contenu: Record<string, unknown>; revision: string; rang: number | null; ref_v10: string } | undefined;
  if (!x) return;
  await appliquer(tx, d.entreprise, d.proprietaire, [{ collection: 'documents', cle: x.ref_v10, rang: x.rang, revision: Number(x.revision),
    contenu: { ...x.contenu, ttn: { reference: depot.reference, qr: depot.qr, le: maintenant.toISOString() } } }], { serveur: true });
}

// Le compte El Fatoora de l'entreprise : posé (ou changé), les pièces retenues repartent aussitôt.
export async function poserCompte(ctx: Contexte, tx: Transaction, entreprise: string, utilisateur: string, identifiant: string, motDePasse: string): Promise<void> {
  if (!ctx.ttn) throw new Error('le coffre du serveur manque : le compte El Fatoora ne peut pas se sceller');
  const maintenant = maintenantDe(ctx);
  // (Pas d'« on conflict » : il relirait le mot de passe scellé, que le compte du serveur ne peut pas lire.)
  const valeurs = [entreprise, identifiant, sceller(ctx.ttn.coffre, entreprise, motDePasse), maintenant, utilisateur];
  const change = await tx.query(`update ventes.ttn_compte set identifiant = $2, mot_de_passe_scelle = $3, pose_le = $4, pose_par = $5,
    dernier_refus = null, dernier_refus_le = null where entreprise = $1`, valeurs);
  if (!change.rowCount) {
    await tx.query('insert into ventes.ttn_compte (entreprise, identifiant, mot_de_passe_scelle, pose_le, pose_par) values ($1, $2, $3, $4, $5)', valeurs);
  }
  // Ce qui retenait les pièces à cause du compte ne se dit plus : il est posé.
  await tx.query(`update ventes.envoi_ttn set prochain_essai = $2, essais = 0,
      motif = case when motif ->> 'cle' in ('ttn.sans_compte', 'ttn.compte_refuse', 'ttn.compte_illisible') then null else motif end
    where entreprise = $1 and statut in ('a_envoyer', 'deposee')`, [entreprise, maintenant]);
  await tracer(tx, entreprise, 'ventes.efacture.regler', { type: 'ttn_compte', id: null }, null, { identifiant });
}

// Renvoyer une pièce que la TTN a refusée (une fois la cause corrigée) : elle repart au prochain tour.
export async function renvoyer(ctx: Contexte, tx: Transaction, entreprise: string, cle: string): Promise<{ statut?: number; corps: Record<string, unknown> }> {
  const x = (await tx.query(`select x.piece, x.statut, p.numero_texte from ventes.envoi_ttn x join ventes.piece p on p.id = x.piece
    where x.entreprise = $1 and p.ref_v10 = $2`, [entreprise, cle])).rows[0] as { piece: string; statut: string; numero_texte: string } | undefined;
  if (!x) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
  if (x.statut !== 'refusee') throw new Refus('ttn.renvoi_impossible', { valeurs: { numero: x.numero_texte } });
  await tx.query(`update ventes.envoi_ttn set statut = 'a_envoyer', motif = null, essais = 0, prochain_essai = $2 where piece = $1`, [x.piece, maintenantDe(ctx)]);
  await tracer(tx, entreprise, 'ventes.facture.envoyer', { type: 'piece', id: x.piece }, null, { etape: 'renvoyee', numero: x.numero_texte });
  return { corps: { ok: true } };
}
