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
import { motif } from '../../textes/index.ts';
import { sorteDe } from '../achats/sorte.ts';
import { refusDuDossierTenu } from '../abonnement/condition.ts';
import './textes.ts';

const uuid = z.string().uuid();
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };
const LIMITE_FICHIER = 10 * 1_048_576;
const LIMITE_CORPS = 16 * 1_048_576;
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
};

// Le dossier est-il au portefeuille de la personne, avec un mandat actif ? Sinon il n'existe pas pour elle (comme sa fiche).
const auPortefeuille = async (tx: Transaction, cabinet: string, entreprise: string) =>
  !!(await tx.query(`select 1 from socle.portefeuille($1) where entreprise = $2 and statut = 'actif'`, [cabinet, entreprise])).rowCount;

export function routesClasseur(): Route<never>[] {
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
          d.classee_raison, d.jointe_ecriture
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

  return routes;
}
