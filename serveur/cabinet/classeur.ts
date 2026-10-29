// Le classeur d'un client au Cabinet (« Tout le dossier », 1.172.0 ; 0180 ; maquette docs/maquettes/cabinet/classeur.html).
// Deux choses que les livres et les pièces reçues ne portaient pas :
//   - joindre une pièce reçue à une écriture de ses livres (l'achat saisi sans justificatif), et la détacher ;
//   - les documents que le cabinet range lui-même : le dossier permanent, les courriers, l'accusé de dépôt d'une
//     déclaration, les pièces qu'on lui a données (« Déposer des pièces »). Ils appartiennent au cabinet (0180) : seul qui
//     en est ET voit le dossier les lit. Un document ne s'efface jamais ; il se classe, ou un autre le remplace.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { motif, rendre, t } from '../../textes/index.ts';
import { IARefuse, propositionDeLIA } from '../achats/lecture-ia.ts';
import { noterPresence } from '../v10/presence.ts';
import { sorteDe } from '../achats/sorte.ts';
import { refusDuDossierTenu } from '../abonnement/condition.ts';
import './textes.ts';

const uuid = z.string().uuid();
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };
const LIMITE_FICHIER = 10 * 1_048_576;
const LIMITE_CORPS = 16 * 1_048_576;
// Un export : 200 Mo au plus (le ZIP d'une année, ses photos et ses PDF).
const LIMITE_EXPORT = 200 * 1_048_576;
const MOIS = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const TYPE_DE = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' } as const;
const JOUR = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const DOCUMENT = z.object({
  rubrique: z.enum(['permanent', 'courrier', 'accuse', 'piece']),
  categorie: z.enum(['juridique', 'fiscal', 'contrats', 'banque', 'cabinet']).nullable().default(null),
  periode: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/).nullable().default(null),
  titre: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(300).nullable().default(null),
  echeance: JOUR.nullable().default(null),
  provenance: z.string().trim().min(1).max(100).nullable().default(null),
  nom: z.string().trim().min(1).max(200),
  contenu: z.string().min(1).max(LIMITE_CORPS),
  // Le document qu'il remplace : l'ancien reste, marqué remplacé.
  remplace: uuid.nullable().default(null),
}).strict();

type Ligne = {
  id: string; rubrique: string; categorie: string | null; periode: string | null; titre: string; detail: string | null; echeance: string | null;
  provenance: string | null; nom: string; type: string; taille: number; depose_par: string; depose_nom: string | null; depose_le: Date;
  remplace_par: string | null; classee_le: Date | null; classee_par: string | null; classee_raison: string | null; jointe_ecriture: string | null;
  double_de: string | null; double_de_sorte: string | null;
};

// Le dossier est-il au portefeuille de la personne, avec un mandat actif ? Sinon il n'existe pas pour elle (comme sa fiche).
const auPortefeuille = async (tx: Transaction, cabinet: string, entreprise: string) =>
  !!(await tx.query(`select 1 from socle.portefeuille($1) where entreprise = $2 and statut = 'actif'`, [cabinet, entreprise])).rowCount;

// Le client a-t-il coupé la lecture de ses pièces par l'IA ? (Le cabinet ne lit pas la fiche de sa société.)
async function lectureCoupee(tx: Transaction, entreprise: string): Promise<boolean> {
  return (await tx.query('select cabinet.lecture_ia_coupee($1) c', [entreprise])).rows[0]?.c === true;
}

export function routesClasseur(ctx?: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Joindre une pièce reçue à une écriture de ses livres (0180, messagerie.joindre_piece). La détacher, c'est la remettre
  // à classer (POST …/classee, { classee: false }).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages/:message/jointe', geste: 'messagerie.ecrire',
    corps: z.object({ ecriture: uuid }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.message).success) return introuvable;
      await tx.query('select messagerie.joindre_piece($1, $2, $3)', [params.entreprise ?? '', params.message, corps.ecriture]);
      return { corps: { jointe: corps.ecriture } };
    },
  });

  // Les documents du classeur d'un dossier, sans leur contenu, les plus récents d'abord ; et si le dossier est fermé à
  // l'écriture (un dossier tenu payant d'un cabinet qui ne paie plus, 0172), depuis quand : l'écran le dit avant le geste.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/classeur/:dossier/documents', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      const lignes = (await tx.query(`select d.id, d.rubrique, d.categorie, d.periode, d.titre, d.detail, to_char(d.echeance, 'YYYY-MM-DD') echeance,
          d.provenance, d.nom, d.type, d.taille, d.depose_par, u.nom depose_nom, d.depose_le, d.remplace_par, d.classee_le, d.classee_par,
          d.classee_raison, d.jointe_ecriture, d.double_de, d.double_de_sorte
        from cabinet.document d left join socle.utilisateur u on u.id = d.depose_par
       where d.cabinet = $1 and d.entreprise = $2
       order by d.depose_le desc, d.id desc limit 1000`, [cabinet, entreprise])).rows as Ligne[];
      const ferme = await refusDuDossierTenu(tx, entreprise);
      return {
        corps: {
          lectureSeule: ferme ? { motif: ferme.motif } : null,
          documents: lignes.map((l) => ({
            id: l.id, rubrique: l.rubrique, categorie: l.categorie, periode: l.periode, titre: l.titre, detail: l.detail, echeance: l.echeance,
            provenance: l.provenance, fichier: { nom: l.nom, type: l.type, taille: Number(l.taille) }, deposePar: l.depose_par, deposeNom: l.depose_nom,
            deposeLe: l.depose_le.toISOString(), remplacePar: l.remplace_par, classeeLe: l.classee_le ? l.classee_le.toISOString() : null,
            classeePar: l.classee_par, raison: l.classee_raison, jointe: l.jointe_ecriture,
            double: l.double_de ? { sorte: l.double_de_sorte, id: l.double_de } : null,
          })),
        },
      };
    },
  });

  // Un document, en base 64 (l'écran le montre ou l'enregistre).
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/classeur/:dossier/documents/:document', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || ![params.cabinet, params.dossier, params.document].every((x) => uuid.safeParse(x).success)) return introuvable;
      const f = (await tx.query('select nom, type, contenu from cabinet.document where id = $1 and cabinet = $2 and entreprise = $3',
        [params.document, params.cabinet, params.dossier])).rows[0] as { nom: string; type: string; contenu: Buffer } | undefined;
      if (!f) return introuvable;
      return { corps: { nom: f.nom, type: f.type, taille: f.contenu.length, contenu: f.contenu.toString('base64') } };
    },
  });

  // Ranger un document : une photo ou un PDF, reconnu à ses premiers octets ; un dossier fermé à l'écriture le refuse.
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/classeur/:dossier/documents', geste: 'compte.cabinet.gerer', limiteCorps: LIMITE_CORPS,
    corps: DOCUMENT,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      const ferme = await refusDuDossierTenu(tx, entreprise);
      if (ferme) return { statut: 403, corps: { motif: ferme.motif, bouton: ferme.bouton } };
      if ((corps.rubrique === 'permanent') !== (corps.categorie !== null)) return { statut: 400, corps: { motif: motif('cabinet.classeur.categorie'), champ: 'categorie' } };
      if (['accuse', 'piece'].includes(corps.rubrique) && !/^\d{4}-\d{2}$/.test(corps.periode ?? '')) return { statut: 400, corps: { motif: motif('cabinet.classeur.periode'), champ: 'periode' } };
      const fichier = /^[A-Za-z0-9+/]+={0,2}$/.test(corps.contenu) ? Buffer.from(corps.contenu, 'base64') : Buffer.alloc(0);
      if (fichier.length > LIMITE_FICHIER) return { statut: 413, corps: { motif: motif('cabinet.classeur.trop_lourd', { nom: corps.nom }), bouton: null } };
      const sorte = sorteDe(fichier);
      if (!sorte) return { statut: 415, corps: { motif: motif('cabinet.classeur.format', { nom: corps.nom }), bouton: null } };
      const id = (await tx.query(`insert into cabinet.document (cabinet, entreprise, rubrique, categorie, periode, titre, detail, echeance, provenance,
          nom, type, taille, contenu, empreinte, depose_par)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
      [cabinet, entreprise, corps.rubrique, corps.categorie, corps.periode, corps.titre, corps.detail || null, corps.echeance, corps.provenance,
        corps.nom, TYPE_DE[sorte], fichier.length, fichier, createHash('sha256').update(fichier).digest('hex'), qui.utilisateur])).rows[0].id as string;
      if (corps.remplace) {
        const r = await tx.query('update cabinet.document set remplace_par = $1 where id = $2 and cabinet = $3 and entreprise = $4 and remplace_par is null',
          [id, corps.remplace, cabinet, entreprise]);
        if (!r.rowCount) return { statut: 409, corps: { motif: motif('cabinet.classeur.deja_remplace') } };
      }
      return { statut: 201, corps: { id, type: TYPE_DE[sorte], taille: fichier.length } };
    },
  });

  // Classer une pièce déposée, la joindre à une écriture, ou défaire (`classee: false`) : comme une pièce reçue (0179).
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/classeur/:dossier/documents/:document/classement', geste: 'compte.cabinet.gerer',
    corps: z.object({ classee: z.boolean(), raison: z.enum(['saisie', 'verifiee', 'rien', 'double', 'illisible', 'banque', 'jointe']).optional(), ecriture: uuid.optional() }).strict(),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || ![params.cabinet, params.dossier, params.document].every((x) => uuid.safeParse(x).success)) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      const ferme = await refusDuDossierTenu(tx, entreprise);
      if (ferme) return { statut: 403, corps: { motif: ferme.motif, bouton: ferme.bouton } };
      if ((corps.raison === 'jointe') !== (corps.ecriture !== undefined) || (!corps.classee && corps.raison)) {
        return { statut: 400, corps: { motif: motif('cabinet.classeur.classement'), champ: 'raison' } };
      }
      if (corps.ecriture && !(await tx.query(`select 1 from compta.ecriture where id = $1 and entreprise = $2 and journal <> 'AN'`, [corps.ecriture, entreprise])).rowCount) {
        return introuvable;
      }
      const r = await tx.query(`update cabinet.document set classee_le = case when $5 then now() end, classee_par = case when $5 then $6::uuid end,
          classee_raison = case when $5 then $7 end, jointe_ecriture = case when $5 then $8::uuid end
        where id = $1 and cabinet = $2 and entreprise = $3 and rubrique = 'piece' and (classee_le is null) = $4`,
      [params.document, cabinet, entreprise, corps.classee, corps.classee, qui.utilisateur, corps.raison ?? null, corps.ecriture ?? null]);
      if (!r.rowCount) return { statut: 409, corps: { motif: motif(corps.classee ? 'cabinet.classeur.pas_a_classer' : 'cabinet.classeur.pas_classee') } };
      return { corps: { classee: corps.classee } };
    },
  });

  // ── (1.173.0, 0181) La suite du classeur ─────────────────────────────────────────────────────────────
  // Le dossier, vu du cabinet : au portefeuille, et ouvert à l'écriture (un dossier tenu payant fermé, 0172, le refuse).
  const dossierOuvert = async (tx: Transaction, cabinet: string, entreprise: string) => {
    if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
    const ferme = await refusDuDossierTenu(tx, entreprise);
    return ferme ? { statut: 403 as const, corps: { motif: ferme.motif, bouton: ferme.bouton } } : null;
  };
  const troisUuid = (p: Record<string, string | undefined>, ...cles: string[]) => cles.every((k) => uuid.safeParse(p[k]).success);

  // Une pièce reçue EN DOUBLE, sa jumelle nommée (une autre pièce reçue, ou un document du cabinet).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages/:message/double', geste: 'messagerie.ecrire',
    corps: z.object({ sorte: z.enum(['message', 'document']), jumelle: uuid }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.message).success) return introuvable;
      await tx.query('select messagerie.doubler_piece($1, $2, $3, $4)', [params.entreprise, params.message, corps.sorte, corps.jumelle]);
      return { corps: { double: corps.jumelle } };
    },
  });
  // Un document déposé, en double d'une autre pièce.
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/classeur/:dossier/documents/:document/double', geste: 'compte.cabinet.gerer',
    corps: z.object({ sorte: z.enum(['message', 'document']), jumelle: uuid }).strict(),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || !troisUuid(params, 'cabinet', 'dossier', 'document')) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      const refus = await dossierOuvert(tx, cabinet, entreprise);
      if (refus) return refus;
      const existe = corps.sorte === 'document'
        ? (await tx.query('select 1 from cabinet.document where id = $1 and cabinet = $2 and entreprise = $3', [corps.jumelle, cabinet, entreprise])).rowCount
        : (await tx.query('select 1 from messagerie.message where id = $1 and cabinet = $2 and entreprise = $3 and fichier is not null', [corps.jumelle, cabinet, entreprise])).rowCount;
      if (!existe || corps.jumelle === params.document) return { statut: 400, corps: { motif: motif('cabinet.classeur.jumelle'), champ: 'jumelle' } };
      const r = await tx.query(`update cabinet.document set classee_le = now(), classee_par = $4, classee_raison = 'double', jointe_ecriture = null,
          double_de = $5, double_de_sorte = $6
        where id = $1 and cabinet = $2 and entreprise = $3 and rubrique = 'piece' and classee_le is null`,
      [params.document, cabinet, entreprise, qui.utilisateur, corps.jumelle, corps.sorte]);
      if (!r.rowCount) return { statut: 409, corps: { motif: motif('cabinet.classeur.pas_a_classer') } };
      return { corps: { double: corps.jumelle } };
    },
  });

  // Ranger une pièce reçue dans un autre mois (null : le mois de son arrivée).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/messages/:message/mois', geste: 'messagerie.ecrire',
    corps: z.object({ mois: MOIS.nullable() }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.message).success) return introuvable;
      await tx.query('select messagerie.ranger_mois($1, $2, $3)', [params.entreprise, params.message, corps.mois]);
      return { corps: { mois: corps.mois } };
    },
  });
  // Un document déposé dans un autre mois : sa période change (une pièce du mois en a toujours une).
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/classeur/:dossier/documents/:document/mois', geste: 'compte.cabinet.gerer',
    corps: z.object({ mois: MOIS }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !troisUuid(params, 'cabinet', 'dossier', 'document')) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      const refus = await dossierOuvert(tx, cabinet, entreprise);
      if (refus) return refus;
      const r = await tx.query(`update cabinet.document set periode = $4 where id = $1 and cabinet = $2 and entreprise = $3 and rubrique = 'piece'`,
        [params.document, cabinet, entreprise, corps.mois]);
      if (!r.rowCount) return introuvable;
      return { corps: { mois: corps.mois } };
    },
  });

  // Les lectures déjà faites des pièces de ce dossier (une par pièce).
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/classeur/:dossier/lectures', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !troisUuid(params, 'cabinet', 'dossier')) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      const l = (await tx.query(`select l.message, l.document, l.fournisseur, l.numero, to_char(l.date_piece, 'YYYY-MM-DD') date, l.total, l.devise, l.lu_le, u.nom lu_nom
          from cabinet.lecture l left join socle.utilisateur u on u.id = l.lu_par
         where l.cabinet = $1 and l.entreprise = $2 order by l.lu_le desc limit 2000`, [cabinet, entreprise])).rows as
        { message: string | null; document: string | null; fournisseur: string | null; numero: string | null; date: string | null; total: string | null; devise: string | null; lu_le: Date; lu_nom: string | null }[];
      // La lecture par l'IA se propose-t-elle ici : la clé du serveur, et le client ne l'a pas coupée (le même accord que
      // ses achats, company.lectureIA).
      const coupee = await lectureCoupee(tx, entreprise);
      return {
        corps: {
          ia: !!ctx?.lecteurIA?.disponible && !coupee,
          coupee,
          lectures: l.map((x) => ({ message: x.message, document: x.document, fournisseur: x.fournisseur, numero: x.numero, date: x.date, total: x.total, devise: x.devise, luLe: x.lu_le.toISOString(), luPar: x.lu_nom })),
        },
      };
    },
  });
  // Lire une pièce par l'IA (le même accord que les achats du client : sa société ne l'a pas coupée, et la personne le
  // confirme pour CE fichier). Ce qui part : le fichier, et la consigne (lecture-ia.ts) ; ni le nom du client, ni le
  // cabinet. Le résultat se garde pour le cabinet : le fournisseur, le numéro, la date, le total.
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/classeur/:dossier/lectures', geste: 'compte.cabinet.gerer',
    corps: z.object({ message: uuid.optional(), document: uuid.optional(), ia: z.boolean() }).strict(),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || !troisUuid(params, 'cabinet', 'dossier') || (!corps.message === !corps.document)) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      if (!ctx?.lecteurIA?.disponible) return { statut: 503, corps: { motif: motif('cabinet.classeur.lecture_indisponible'), bouton: null } };
      if (await lectureCoupee(tx, entreprise)) return { statut: 409, corps: { motif: motif('cabinet.classeur.lecture_coupee'), bouton: null } };
      if (corps.ia !== true) return { statut: 409, corps: { motif: motif('cabinet.classeur.lecture_accord'), bouton: null } };
      const f = corps.message
        ? (await tx.query(`select fi.nom, fi.contenu from messagerie.message m join messagerie.fichier fi on fi.id = m.fichier
            where m.id = $1 and m.cabinet = $2 and m.entreprise = $3`, [corps.message, cabinet, entreprise])).rows[0]
        : (await tx.query('select nom, contenu from cabinet.document where id = $1 and cabinet = $2 and entreprise = $3', [corps.document, cabinet, entreprise])).rows[0];
      if (!f) return introuvable;
      const fichier = f.contenu as Buffer, nom = String(f.nom);
      const sorte = sorteDe(fichier);
      if (!sorte) return { statut: 415, corps: { motif: motif('cabinet.classeur.format', { nom }), bouton: null } };
      let r;
      try { r = await ctx.lecteurIA.lire(fichier, sorte); } catch (e) {
        console.error(`la lecture par l'IA (Cabinet) n'a pas abouti (${e instanceof Error ? e.message : String(e)})`);
        return { statut: e instanceof IARefuse ? 422 : 503, corps: { motif: motif('cabinet.classeur.lecture_echec', { nom }), bouton: null } };
      }
      if (!r.estUneFacture) return { statut: 422, corps: { motif: motif('cabinet.classeur.lecture_pas_facture', { nom }), bouton: null } };
      const ent = (await tx.query('select matricule_fiscal from socle.entreprise where id = $1', [entreprise])).rows[0] as { matricule_fiscal: string | null } | undefined;
      const p = propositionDeLIA(r, { notreMatricule: ent?.matricule_fiscal || null }).lecture;
      const total = p.totalTTC && /^\d{1,12}(\.\d{1,3})?$/.test(p.totalTTC) ? p.totalTTC : null;
      const devise = p.currency === 'EUR' || p.currency === 'USD' || p.currency === 'TND' ? p.currency : null;
      const valeurs = [cabinet, entreprise, corps.message ?? null, corps.document ?? null, p.supplier ? p.supplier.slice(0, 200) : null, p.number ? p.number.slice(0, 100) : null, p.date, total, devise, qui.utilisateur];
      await tx.query(`insert into cabinet.lecture (cabinet, entreprise, message, document, fournisseur, numero, date_piece, total, devise, lu_par)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (cabinet, ${corps.message ? 'message' : 'document'}) do update set fournisseur = excluded.fournisseur, numero = excluded.numero,
          date_piece = excluded.date_piece, total = excluded.total, devise = excluded.devise, lu_par = excluded.lu_par, lu_le = now()`, valeurs);
      return { corps: { fournisseur: valeurs[4], numero: valeurs[5], date: p.date, total, devise } };
    },
  });

  // L'export, gardé sept jours : un lien qu'on ouvre, ou qu'on transmet. Passé sept jours, il s'efface (ici, à chaque
  // nouvel export du cabinet).
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/classeur/:dossier/exports', geste: 'compte.cabinets.voir', limiteCorps: Math.ceil(LIMITE_EXPORT * 1.4),
    corps: z.object({ nom: z.string().trim().min(1).max(200), quoi: z.string().trim().min(1).max(100), contenu: z.string().min(1) }).strict(),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || !troisUuid(params, 'cabinet', 'dossier')) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      const zip = /^[A-Za-z0-9+/]+={0,2}$/.test(corps.contenu) ? Buffer.from(corps.contenu, 'base64') : Buffer.alloc(0);
      if (!zip.length) return { statut: 400, corps: { motif: motif('commun.introuvable'), champ: 'contenu' } };
      if (zip.length > LIMITE_EXPORT) return { statut: 413, corps: { motif: motif('cabinet.classeur.export_lourd'), bouton: null } };
      await tx.query('delete from cabinet.export where cabinet = $1 and expire_le < now()', [cabinet]);
      const e = (await tx.query(`insert into cabinet.export (cabinet, entreprise, nom, quoi, taille, contenu, cree_par) values ($1, $2, $3, $4, $5, $6, $7)
        returning id, expire_le`, [cabinet, entreprise, corps.nom, corps.quoi, zip.length, zip, qui.utilisateur])).rows[0] as { id: string; expire_le: Date };
      // Noté dans l'historique du dossier (la maquette) : qui l'a fait, quand, et ce qu'il contient.
      await tx.query('select socle.tracer($1, $2, $3, $4, null, $5)', [entreprise, 'cabinet.export', 'export', e.id, JSON.stringify({ nom: corps.nom, quoi: corps.quoi, taille: zip.length })]);
      return { statut: 201, corps: { id: e.id, expireLe: e.expire_le.toISOString(), taille: zip.length } };
    },
  });
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/classeur/:dossier/exports', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !troisUuid(params, 'cabinet', 'dossier')) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      const l = (await tx.query(`select x.id, x.nom, x.quoi, x.taille, x.cree_le, x.expire_le, u.nom cree_nom from cabinet.export x
          left join socle.utilisateur u on u.id = x.cree_par
         where x.cabinet = $1 and x.entreprise = $2 and x.expire_le > now() order by x.cree_le desc limit 20`, [cabinet, entreprise])).rows as
        { id: string; nom: string; quoi: string; taille: number; cree_le: Date; expire_le: Date; cree_nom: string | null }[];
      return { corps: { exports: l.map((x) => ({ id: x.id, nom: x.nom, quoi: x.quoi, taille: Number(x.taille), creeLe: x.cree_le.toISOString(), expireLe: x.expire_le.toISOString(), creePar: x.cree_nom })) } };
    },
  });
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/classeur/:dossier/exports/:export', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !troisUuid(params, 'cabinet', 'dossier', 'export')) return introuvable;
      const x = (await tx.query('select nom, contenu, expire_le from cabinet.export where id = $1 and cabinet = $2 and entreprise = $3',
        [params.export, params.cabinet, params.dossier])).rows[0] as { nom: string; contenu: Buffer; expire_le: Date } | undefined;
      if (!x) return introuvable;
      if (x.expire_le.getTime() < Date.now()) return { statut: 410, corps: { motif: motif('cabinet.classeur.export_expire') } };
      return { corps: { nom: x.nom, type: 'application/zip', contenu: x.contenu.toString('base64') } };
    },
  });

  // Une demande envoyée aussi PAR E-MAIL (Skander, 29/10/2026 : « E-mail par SkanFact ») : la demande déjà écrite dans la
  // conversation part à l'adresse de la fiche du dossier. Ce qui part chez le relais d'e-mails, compté : l'adresse, le nom
  // du cabinet, le texte de la demande, le lien vers SkanFact. Rien d'autre (ni pièce, ni chiffre).
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/classeur/:dossier/demandes/:message/courriel', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !troisUuid(params, 'cabinet', 'dossier', 'message')) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      if (!ctx?.courriel) return { statut: 503, corps: { motif: motif('cabinet.classeur.sans_courriel'), bouton: null } };
      const m = (await tx.query(`select m.texte, m.demande from messagerie.message m where m.id = $1 and m.cabinet = $2 and m.entreprise = $3
        and m.cote = 'cabinet' and m.demande is not null`, [params.message, cabinet, entreprise])).rows[0] as { texte: string; demande: string } | undefined;
      if (!m) return introuvable;
      const fiche = (await tx.query('select contenu ->> \'email\' email from cabinet.fiche where cabinet = $1 and entreprise = $2', [cabinet, entreprise])).rows[0] as { email: string | null } | undefined;
      // Sans adresse sur la fiche du cabinet : celle que le client a donnée (sous le mandat actif, ses coordonnées seules).
      const client = fiche?.email?.trim() ? null : (await tx.query('select email from socle.coordonnees_de_mes_clients() where entreprise = $1', [entreprise])).rows[0] as { email: string | null } | undefined;
      const a = String(fiche?.email?.trim() || client?.email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) return { statut: 409, corps: { motif: motif('cabinet.classeur.sans_adresse'), bouton: null } };
      const nomCabinet = String((await tx.query('select nom from socle.organisation where id = $1', [cabinet])).rows[0]?.nom ?? '');
      await ctx.courriel.envoi.envoyer({
        a,
        objet: rendre(t('cabinet.classeur.courriel.objet', { cabinet: nomCabinet }), 'fr'),
        texte: rendre(t('cabinet.classeur.courriel.texte', { cabinet: nomCabinet, demande: m.texte.slice(0, 1000), lien: `${ctx.courriel.adresse()}/` }), 'fr'),
        bouton: rendre(t('cabinet.classeur.courriel.bouton'), 'fr'),
        langue: 'fr',
      });
      await tx.query('select socle.tracer($1, $2, $3, $4, null, null)', [entreprise, 'cabinet.demande_courriel', 'message', params.message]);
      return { corps: { envoye: true } };
    },
  });

  // La présence sur une pièce du classeur (« Anis regarde aussi »), entre personnes du MÊME cabinet : la route des pièces
  // de l'entreprise refuse un cabinet (son mandat ne l'ouvre pas). Ce qui part, et ce qui se garde : comme presence.ts.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/classeur/:dossier/presence', geste: 'compte.cabinets.voir',
    traiter: async ({ params, query, qui }, tx) => {
      if (!tx || !qui || !troisUuid(params, 'cabinet', 'dossier')) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      if (!(await auPortefeuille(tx, cabinet, entreprise))) return introuvable;
      const piece = String(query.piece ?? '');
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(piece)) return { statut: 400, corps: { autres: [] } };
      const nom = String((await tx.query('select coalesce(nom, \'\') nom from socle.utilisateur where id = $1', [qui.utilisateur])).rows[0]?.nom ?? '');
      const autres = noterPresence(`cabinet:${cabinet}:${entreprise}`, piece, qui.utilisateur, nom, false, query.quitte === '1');
      return { corps: { autres: autres.map((x) => ({ nom: x.nom, ecrit: x.ecrit, depuis: new Date(x.depuis).toISOString() })) } };
    },
  });

  // ── Ce que le client lit de son cabinet (Skander, 29/10/2026 : « oui, tout ») ──────────────────────
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/cabinet/range', geste: 'messagerie.lire',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.entreprise).success) return introuvable;
      const l = (await tx.query('select * from cabinet.ce_que_mon_cabinet_a_range($1) order by depose_le desc limit 2000', [params.entreprise])).rows as
        { sorte: string; id: string; rubrique: string; categorie: string | null; periode: string | null; titre: string; nom: string; type: string; taille: number;
          depose_le: Date; depose_nom: string | null; cabinet_nom: string; jointe_le: Date | null; achat: string | null; achat_ref: string | null; ecriture_piece: string | null; fichier: string | null }[];
      return {
        corps: {
          pieces: l.map((x) => ({ sorte: x.sorte, id: x.id, rubrique: x.rubrique, categorie: x.categorie, periode: x.periode, titre: x.titre,
            fichier: { nom: x.nom, type: x.type, taille: Number(x.taille) }, deposeLe: x.depose_le.toISOString(), deposePar: x.depose_nom, cabinet: x.cabinet_nom,
            jointeLe: x.jointe_le ? x.jointe_le.toISOString() : null, achat: x.achat_ref, ecriture: x.ecriture_piece,
            // Une pièce reçue est la sienne : il la rouvre par son fichier, dans sa conversation.
            fichierId: x.fichier })),
        },
      };
    },
  });
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/cabinet/range/:document', geste: 'messagerie.lire',
    traiter: async ({ params }, tx) => {
      if (!tx || !troisUuid(params, 'entreprise', 'document')) return introuvable;
      const f = (await tx.query('select * from cabinet.document_pour_le_client($1, $2)', [params.entreprise, params.document])).rows[0] as { nom: string; type: string; contenu: Buffer } | undefined;
      if (!f) return introuvable;
      return { corps: { nom: f.nom, type: f.type, taille: f.contenu.length, contenu: f.contenu.toString('base64') } };
    },
  });

  return routes;
}
