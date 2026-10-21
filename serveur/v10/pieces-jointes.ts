// Les pièces jointes du dossier (lot Fonctions 3 ; docs/pieces-jointes.md ; base 0160). La v10 les copiait à côté de son
// fichier de données ; ici, la base de l'entreprise les garde dix ans. Une photo ou un PDF, reconnu à ses premiers
// octets (jamais à son nom), dix mégaoctets au plus, en base 64 dans le corps comme les fichiers de la messagerie. La
// pièce du dossier garde sa fiche (nom, identifiant, taille, date) : ces routes ne gardent que le fichier. Les gestes
// sont ceux du dossier : un cabinet ne les a pas (il ne voit pas les pièces, 0035), et la base le redit (0160).

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Route } from '../app.ts';
import { motif } from '../../textes/index.ts';
import { sorteDe } from '../achats/lecteur.ts';
import './textes-pieces-jointes.ts';

const uuid = z.string().uuid();
export const LIMITE_PIECE = 10 * 1_048_576;
// En base 64, un tiers de plus : accepté jusqu'à 16 Mo, pour qu'un fichier un peu trop lourd reçoive sa phrase.
const LIMITE_CORPS = 16 * 1_048_576;
const TYPE_DE = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' } as const;
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };
const jour = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

export function routesPiecesJointes(): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Déposer un fichier : il revient avec la fiche que la pièce garde (celle de la v10 : name, file, size, date).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/pieces-jointes', geste: 'socle.dossier.modifier', limiteCorps: LIMITE_CORPS,
    corps: z.object({ nom: z.string().trim().min(1).max(200), contenu: z.string().min(1).max(LIMITE_CORPS) }).strict(),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const fichier = /^[A-Za-z0-9+/]+={0,2}$/.test(corps.contenu) ? Buffer.from(corps.contenu, 'base64') : Buffer.alloc(0);
      if (fichier.length > LIMITE_PIECE) {
        return { statut: 413, corps: { motif: motif('pieces_jointes.trop_lourd', { nom: corps.nom, taille: (fichier.length / 1_048_576).toFixed(1).replace('.', ','), limite: LIMITE_PIECE / 1_048_576 }), bouton: null } };
      }
      const sorte = sorteDe(fichier);
      if (!sorte) return { statut: 415, corps: { motif: motif('pieces_jointes.format', { nom: corps.nom }), bouton: null } };
      const r = (await tx.query(`insert into socle.piece_jointe (entreprise, nom, type, taille, contenu, empreinte, depose_par)
          values ($1, $2, $3, $4, $5, $6, $7) returning id, depose_le, conserver_jusqu_au::text conserver`,
        [params.entreprise ?? '', corps.nom, TYPE_DE[sorte], fichier.length, fichier, createHash('sha256').update(fichier).digest('hex'), qui.utilisateur])).rows[0] as
        { id: string; depose_le: Date; conserver: string };
      return { statut: 201, corps: { name: corps.nom, file: r.id, size: fichier.length, date: jour(r.depose_le), type: TYPE_DE[sorte], conserverJusquAu: r.conserver } };
    },
  });

  // Un fichier, en base 64 (l'écran l'ouvre ou l'enregistre).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/pieces-jointes/:fichier', geste: 'socle.dossier.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.fichier).success) return introuvable;
      const f = (await tx.query('select nom, type, contenu from socle.piece_jointe where id = $1 and entreprise = $2', [params.fichier, params.entreprise ?? ''])).rows[0] as
        { nom: string; type: string; contenu: Buffer } | undefined;
      if (!f) return introuvable;
      return { corps: { nom: f.nom, type: f.type, taille: f.contenu.length, contenu: f.contenu.toString('base64') } };
    },
  });

  // Retirer : qui l'a déposé l'efface dans les vingt-quatre heures (la base le dit, 0160) ; sinon la copie reste jusqu'à
  // sa date, et seule la pièce l'oublie. La réponse dit lequel des deux.
  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/pieces-jointes/:fichier', geste: 'socle.dossier.modifier',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!uuid.safeParse(params.fichier).success) return introuvable;
      const ici = (await tx.query('select conserver_jusqu_au::text conserver from socle.piece_jointe where id = $1 and entreprise = $2', [params.fichier, params.entreprise ?? ''])).rows[0] as
        { conserver: string } | undefined;
      if (!ici) return introuvable;
      const efface = ((await tx.query('delete from socle.piece_jointe where id = $1 and entreprise = $2', [params.fichier, params.entreprise ?? ''])).rowCount ?? 0) > 0;
      return { corps: efface ? { efface: true } : { efface: false, conserverJusquAu: ici.conserver } };
    },
  });
  return routes;
}
