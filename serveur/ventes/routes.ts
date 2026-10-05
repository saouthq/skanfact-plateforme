// Les routes du module Ventes : les clients (la fiche tiers du socle, par le geste du tableau
// « Ventes » de 03 § 2.1), les brouillons, la lecture d'une pièce et l'émission d'une facture.
// Les nombres entrent et sortent en TEXTE exact (« 2.525 », « 1191.000 ») : jamais en nombre à
// virgule (01 R3).

import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import { enTantQue, requetes } from '../base.ts';
import { cleDeVerification } from '../validation.ts';
import type { Contexte } from '../connexion.ts';
import { tracer } from '../trace.ts';
import { creerBrouillon, DECIMALES, emettre, lirePiece, modifierBrouillon, supprimerBrouillon, type BrouillonSaisi } from './pieces.ts';
import { soldesDeFactures } from './reglements.ts';
import { lienEcran, situationClient } from './situation.ts';
import { payableEnLigne, vueEspace } from './espace.ts';
import { motif, t } from '../../textes/index.ts';

// Toute liste qu'on nomme se pagine (règle du projet) : 50 lignes par défaut, 200 au plus.
const LIMITE_MAX = 200;
const limite = (q: Record<string, string>) => Math.min(Math.max(Number(q.limite ?? 50) || 50, 1), LIMITE_MAX);
const uuid = z.string().uuid();
// La page suivante se demande par un curseur opaque : la clé de tri de la dernière ligne vue, puis
// son identifiant, qui départage deux lignes égales (jamais une ligne sautée ni vue deux fois).
// Un curseur absent ou illisible part du début.
const versCurseur = (cle: string, id: string) => Buffer.from(JSON.stringify([cle, id])).toString('base64url');
function depuisCurseur(texte: string | undefined, cle: RegExp): [string, string] | null {
  if (!texte) return null;
  try {
    const [c, id] = JSON.parse(Buffer.from(texte, 'base64url').toString('utf8')) as unknown[];
    if (typeof c === 'string' && cle.test(c) && typeof id === 'string' && uuid.safeParse(id).success) return [c, id];
  } catch { /* illisible : on repart du début */ }
  return null;
}
const TYPES_PIECE = ['devis', 'proforma', 'commande', 'livraison', 'facture', 'note_honoraires'] as const;
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'champ.jour');
// Un nombre écrit en texte, à `dec` décimales au plus.
const decimal = (dec: number) => z.string().max(30).refine((v) => { try { depuisTexte(v, dec); return true; } catch { return false; } },
  cleDeVerification('ventes.champ.decimal', { dec }));
// zod poursuit les vérifications après un échec : un texte illisible, déjà dit par `decimal`, ne doit
// pas faire tomber celle-ci (ce serait une erreur 500 au lieu d'un refus sur le champ).
const taux = decimal(DECIMALES.taux).refine((v) => {
  let t: bigint;
  try { t = depuisTexte(v, DECIMALES.taux); } catch { return true; }
  return t >= 0n && t <= 1_000_000n;
}, 'ventes.champ.pourcentage');

const ligne = z.object({
  designation: z.string().trim().min(1).max(500), description: z.string().max(4000).optional(),
  quantite: decimal(DECIMALES.quantite), prixUnitaire: decimal(DECIMALES.prix), tauxTva: taux, sansRemise: z.boolean().optional(),
});
const brouillon = z.object({
  type: z.enum(TYPES_PIECE),
  tiers: uuid, datePiece: jour, echeance: jour.optional(), devise: z.string().regex(/^[A-Z]{3}$/).optional(),
  cours: decimal(DECIMALES.cours).optional(), tauxRemise: taux.optional(), tauxRetenue: taux.optional(),
  appliquerTimbre: z.boolean().optional(), objet: z.string().max(500).optional(), notes: z.string().max(4000).optional(),
  lignes: z.array(ligne).min(1).max(500),
}).refine((b) => b.devise === undefined || b.devise === 'TND' || b.cours !== undefined, { message: 'ventes.champ.cours_requis', path: ['cours'] });

export function routesVentes(ctx: Contexte): Route<never>[] {
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  const empreinte = (jeton: string) => createHash('sha256').update(jeton, 'utf8').digest('hex');
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const idValide = (v: string | undefined) => uuid.safeParse(v).success;

  // ── Les clients ─────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/clients', geste: 'ventes.client.modifier',
    corps: z.object({
      raisonSociale: z.string().trim().min(1).max(300), nature: z.enum(['societe', 'personne', 'etranger']).optional(),
      identifiant: z.string().trim().min(1).max(40).optional(), typeIdentifiant: z.enum(['matricule', 'cin', 'carte_sejour', 'etranger']).optional(),
      adresse: z.string().max(1000).optional(), pays: z.string().regex(/^[A-Z]{2}$/).optional(),
      email: z.string().email().optional(), telephone: z.string().max(40).optional(), devise: z.string().regex(/^[A-Z]{3}$/).optional(),
    }).refine((c) => (c.identifiant === undefined) === (c.typeIdentifiant === undefined), { message: 'ventes.champ.identifiant_et_type', path: ['typeIdentifiant'] }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = params.entreprise ?? '';
      const { id } = await requetes(tx).insertInto('socle.tiers').values({
        entreprise, nature: corps.nature ?? 'societe', raison_sociale: corps.raisonSociale, identifiant: corps.identifiant ?? null,
        type_identifiant: corps.typeIdentifiant ?? null, adresse: corps.adresse ?? null, pays: corps.pays ?? 'TN', email: corps.email ?? null,
        telephone: corps.telephone ?? null, devise: corps.devise ?? 'TND', roles: ['client'],
      }).returning('id').executeTakeFirstOrThrow();
      await tracer(tx, entreprise, 'ventes.client.creer', { type: 'tiers', id }, null, { raisonSociale: corps.raisonSociale });
      return { statut: 201, corps: { id } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/clients', geste: 'ventes.pieces.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      // Par ordre alphabétique ; la page suivante commence après le dernier client vu.
      const n = limite(query);
      const apres = depuisCurseur(query.apres, /^.+$/s);
      // (Brique 127) Retrouver un client par son matricule (ou son identifiant) : les espaces et la casse ne comptent pas.
      const identifiant = query.identifiant ? query.identifiant.replace(/\s+/g, '').toUpperCase() : null;
      const lignes = await requetes(tx).selectFrom('socle.tiers').select(['id', 'raison_sociale', 'nature', 'identifiant', 'pays', 'devise', 'ref_v10'])
        .where('entreprise', '=', params.entreprise ?? '').where(sql<boolean>`'client' = any(roles)`)
        .$if(identifiant !== null, (q) => q.where(sql<boolean>`upper(regexp_replace(identifiant, '[[:space:]]', '', 'g')) = ${identifiant}`))
        .$if(apres !== null, (q) => q.where(sql<boolean>`(raison_sociale, id) > (${apres?.[0]}, ${apres?.[1]}::uuid)`))
        .orderBy('raison_sociale').orderBy('id').limit(n).execute();
      const dernier = lignes.at(-1);
      const clients = lignes.map(({ ref_v10, ...c }) => ({ ...c, ecran: lienEcran(params.entreprise ?? '', 'client', ref_v10) }));
      return { corps: { clients, suite: lignes.length === n && dernier ? versCurseur(dernier.raison_sociale, dernier.id) : null } };
    },
  });

  // ── Les pièces ──────────────────────────────────────────────────────────────────────────────
  // La liste, la plus récente d'abord ; la page suivante commence avant la dernière pièce vue. Une
  // pièce émise montre le client de sa copie figée (R7) et son net à payer ; un brouillon, le client
  // de sa fiche, sans montant (il se calcule en l'ouvrant).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/ventes', geste: 'ventes.pieces.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const type = z.enum(TYPES_PIECE).safeParse(query.type ?? 'facture');
      if (!type.success) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'type', raison: t('champ.choix', { valeurs: TYPES_PIECE.join(', ') }) }), champ: 'type' } };
      // (Brique 127) Les pièces d'un client ; et, pour les factures, celles qui restent à payer (`aPayer=1`).
      const client = query.client ?? null;
      if (client !== null && !idValide(client)) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'client', raison: t('champ.identifiant') }), champ: 'client' } };
      const aPayer = query.aPayer === '1';
      if (aPayer && type.data !== 'facture') return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'aPayer', raison: t('champ.choix', { valeurs: 'type=facture' }) }), champ: 'aPayer' } };
      const n = limite(query);
      const lire = (avant: [string, string] | null, combien: number) => requetes(tx).selectFrom('ventes.piece as p')
        .innerJoin('socle.tiers as t', 't.id', 'p.tiers').innerJoin('socle.devise as d', 'd.code', 'p.devise')
        .select(['p.id', 'p.type', 'p.statut', 'p.numero_texte', 'p.date_piece', 'p.echeance', 'p.objet', 'p.devise', 'd.symbole', 'd.decimales', 'p.net_a_payer', 'p.ref_v10', 'p.tiers'])
        .select(sql<string>`coalesce(p.copie->'client'->>'raisonSociale', t.raison_sociale)`.as('client'))
        .where('p.entreprise', '=', ent).where('p.type', '=', type.data)
        .$if(client !== null, (q) => q.where('p.tiers', '=', client ?? ''))
        .$if(avant !== null, (q) => q.where(sql<boolean>`(p.date_piece, p.id) < (${avant?.[0]}::date, ${avant?.[1]}::uuid)`))
        .orderBy('p.date_piece', 'desc').orderBy('p.id', 'desc').limit(combien).execute();
      // Ce qui reste à encaisser sur une facture émise : ses règlements et ses avoirs retranchés, par la
      // même fonction que la lecture d'une facture (serveur/ventes/reglements.ts).
      const restes = async (ls: Awaited<ReturnType<typeof lire>>) => soldesDeFactures(tx, ent, ls.filter((l) => l.type === 'facture' && l.statut === 'emise' && l.net_a_payer !== null)
        .map((l) => ({ id: l.id, net: l.net_a_payer ?? 0n })));
      let lignes: Awaited<ReturnType<typeof lire>>;
      let soldes: Awaited<ReturnType<typeof restes>>;
      let plein: boolean;
      if (!aPayer) {
        lignes = await lire(depuisCurseur(query.avant, /^\d{4}-\d{2}-\d{2}$/), n);
        soldes = await restes(lignes);
        plein = lignes.length === n;
      } else {
        // Celles qui doivent encore : lues par lots de la taille de la page, gardées tant qu'elle n'est pas pleine.
        lignes = []; soldes = new Map(); plein = false;
        let avant = depuisCurseur(query.avant, /^\d{4}-\d{2}-\d{2}$/);
        for (;;) {
          const lot = await lire(avant, n);
          const s = await restes(lot);
          for (const l of lot) {
            if ((s.get(l.id)?.reste ?? 0n) <= 0n) continue;
            lignes.push(l); soldes.set(l.id, s.get(l.id) as NonNullable<ReturnType<typeof s.get>>);
            if (lignes.length === n) break;
          }
          if (lignes.length === n) { plein = true; break; }
          const fin = lot.at(-1);
          if (lot.length < n || !fin) break;
          avant = [fin.date_piece, fin.id];
        }
      }
      const dernier = lignes.at(-1);
      // Le compte de toute la liste, pour dire « 1–25 sur 443 » et le nombre de pages, comme la v10 ; pas pour
      // celles qui restent à payer (il faudrait toutes les relire).
      const total = aPayer ? null : Number((await requetes(tx).selectFrom('ventes.piece').select((eb) => eb.fn.countAll<string>().as('total'))
        .where('entreprise', '=', ent).where('type', '=', type.data).$if(client !== null, (q) => q.where('tiers', '=', client ?? '')).executeTakeFirstOrThrow()).total);
      return {
        corps: {
          lignes: lignes.map((l) => {
            const net = l.net_a_payer === null ? null : versTexte(l.net_a_payer, l.decimales);
            return {
              id: l.id, type: l.type, statut: l.statut, numero: l.numero_texte, datePiece: l.date_piece, echeance: l.echeance, client: l.client, clientId: l.tiers,
              objet: l.objet, devise: l.devise, symbole: l.symbole, netAPayer: net,
              reste: soldes.has(l.id) ? versTexte(soldes.get(l.id)?.reste ?? 0n, l.decimales) : net,
              ecran: lienEcran(ent, 'doc', l.ref_v10),
            };
          }),
          suite: plein && dernier ? versCurseur(dernier.date_piece, dernier.id) : null,
          total,
        },
      };
    },
  });

  // La situation d'un client en un appel (brique 127 ; docs/api-situation.md) : reste dû, dont échu, retard, dernier
  // règlement ; pour la console d'un partenaire qui lit la facturation de SkanFact.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/clients/:client/situation', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!idValide(params.client)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const s = await situationClient(tx, params.entreprise ?? '', params.client ?? '');
      return s ? { corps: s } : { statut: 404, corps: { motif: motif('commun.introuvable') } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/ventes', geste: 'ventes.brouillon.modifier', corps: brouillon,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const id = await creerBrouillon(tx, qui.utilisateur, params.entreprise ?? '', corps as BrouillonSaisi);
      return { statut: 201, corps: { id } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/ventes/:piece', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      return { corps: await lirePiece(tx, params.entreprise ?? '', params.piece ?? '') };
    },
  });

  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/ventes/:piece', geste: 'ventes.brouillon.modifier',
    corps: z.object({ revision: z.number().int().min(1), brouillon }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const revision = await modifierBrouillon(tx, params.entreprise ?? '', params.piece ?? '', corps.revision, corps.brouillon as BrouillonSaisi);
      return { corps: { revision } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/ventes/:piece', geste: 'ventes.brouillon.modifier',
    traiter: async ({ params }, tx) => {
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await supprimerBrouillon(tx, params.entreprise ?? '', params.piece ?? '');
      return { corps: { ok: true } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/ventes/:piece/emettre', geste: 'ventes.facture.emettre',
    traiter: async ({ params, qui }, tx) => {
      if (!tx || !qui || !idValide(params.piece)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await emettre(tx, qui.utilisateur, params.entreprise ?? '', params.piece ?? '');
      return { corps: await lirePiece(tx, params.entreprise ?? '', params.piece ?? '') };
    },
  });

  // ── L'espace client (brique 77 ; docs/espace-client.md ; 14 § 2.1) ────────────────────────────
  // Un lien secret vers les pièces émises d'un client : d'une pièce, ou de son compte (sans pièce).
  // Le jeton n'est rendu qu'ici, une fois ; la base n'en garde que l'empreinte. Un lien créé par un envoi
  // (brique 79) note par où il part, et dit si la pièce se règle en ligne (la phrase du message le dit).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/espace/liens', geste: 'ventes.lien.partager',
    corps: z.object({ client: z.string().min(1).max(200), piece: z.string().min(1).max(200).optional(), canal: z.enum(['email', 'whatsapp']).optional() }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const client = (await tx.query("select 1 from socle.dossier_v10 where entreprise = $1 and collection = 'clients' and cle = $2", [ent, corps.client])).rowCount;
      if (!client) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      // Une pièce se partage émise, et avec SON client (jamais un ticket de caisse : il se remet au comptoir).
      let piece: { id: string; type: string; devise: string; net_a_payer: string | null } | undefined;
      if (corps.piece) {
        piece = (await tx.query(`select p.id, p.type, p.devise, p.net_a_payer from ventes.piece p join socle.tiers t on t.id = p.tiers
          join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'documents' and d.cle = p.ref_v10
          where p.entreprise = $1 and p.ref_v10 = $2 and t.ref_v10 = $3 and p.statut = 'emise' and p.type in ('facture', 'avoir')
            and (d.contenu -> 'ticket') is distinct from 'true'::jsonb`, [ent, corps.piece, corps.client])).rows[0];
        if (!piece) return { statut: 409, corps: { motif: motif('espace.piece_non_emise') } };
      }
      const jeton = randomBytes(24).toString('base64url');
      const id = String((await tx.query(`insert into ventes.lien (entreprise, client_v10, piece_v10, jeton_empreinte, cree_par, cree_le, canal)
        values ($1, $2, $3, $4, socle.moi(), $5, $6) returning id`, [ent, corps.client, corps.piece ?? null, empreinte(jeton), maintenant(), corps.canal ?? null])).rows[0].id);
      await tracer(tx, ent, 'ventes.lien.partager', { type: 'lien', id }, null, { client: corps.client, piece: corps.piece ?? null, canal: corps.canal ?? null });
      // Se règle-t-elle en ligne ? Le reste par la fonction de la liste des ventes, la règle de l'espace.
      let payable = false;
      if (piece) {
        const net = BigInt(piece.net_a_payer ?? '0');
        const reste = piece.type === 'facture' ? (await soldesDeFactures(tx, ent, [{ id: piece.id, net }])).get(piece.id)?.reste ?? null : null;
        const paiement = !!(await tx.query('select 1 from ventes.prestataire where entreprise = $1', [ent])).rowCount;
        payable = payableEnLigne(piece.type, piece.devise, reste, paiement);
      }
      return { statut: 201, corps: { id, jeton, adresse: `/espace/#${jeton}`, payable } };
    },
  });

  // Les liens d'un client (ou d'une pièce) : quand ils ont été donnés, par qui, s'ils ont été vus.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/espace/liens', geste: 'ventes.pieces.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await tx.query(`select l.id, l.client_v10, l.piece_v10, l.canal, l.cree_le, u.nom cree_par, l.vu_le, l.vues, l.revoque_le
        from ventes.lien l left join socle.utilisateur u on u.id = l.cree_par
        where l.entreprise = $1 and ($2::text is null or l.client_v10 = $2) and ($3::text is null or l.piece_v10 = $3)
        order by l.cree_le desc, l.id desc limit 50`, [params.entreprise, query.client ?? null, query.piece ?? null]);
      return {
        corps: {
          liens: (r.rows as { id: string; client_v10: string; piece_v10: string | null; canal: string | null; cree_le: Date; cree_par: string | null; vu_le: Date | null; vues: number; revoque_le: Date | null }[]).map((l) => ({
            id: l.id, client: l.client_v10, piece: l.piece_v10, canal: l.canal, creeLe: l.cree_le.toISOString(), creePar: l.cree_par ?? '',
            vuLe: l.vu_le ? l.vu_le.toISOString() : null, vues: l.vues, retireLe: l.revoque_le ? l.revoque_le.toISOString() : null,
          })),
        },
      };
    },
  });

  // Retirer un lien : il ne s'ouvre plus.
  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/espace/liens/:lien', geste: 'ventes.lien.partager',
    traiter: async ({ params }, tx) => {
      if (!tx || !idValide(params.lien)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const r = await tx.query(`update ventes.lien set revoque_le = $3, revoque_par = socle.moi()
        where id = $1 and entreprise = $2 and revoque_le is null`, [params.lien, params.entreprise, maintenant()]);
      if (!r.rowCount) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await tracer(tx, params.entreprise ?? '', 'ventes.lien.retirer', { type: 'lien', id: params.lien ?? null }, null, null);
      return { corps: { ok: true } };
    },
  });

  // Ce que le client voit par son lien (une route sans session : le jeton, dans le corps, jamais dans une
  // adresse ; la page le lit dans le fragment « # », que le navigateur n'envoie jamais).
  ajouter({
    methode: 'POST', chemin: '/espace', geste: 'public',
    corps: z.object({ jeton: z.string().min(10).max(100) }),
    traiter: async ({ corps }) => {
      const vue = await vueEspace(ctx, empreinte(corps.jeton));
      if (!vue) return { statut: 404, corps: { motif: motif('espace.lien_invalide') } };
      return { corps: vue };
    },
  });

  // La facture que la TTN a validée, par le lien (brique 141 ; docs/espace-client.md, E8) : c'est elle qui fait foi.
  ajouter({
    methode: 'POST', chemin: '/espace/efacture', geste: 'public',
    corps: z.object({ jeton: z.string().min(10).max(100), type: z.enum(['facture', 'avoir']), numero: z.string().min(1).max(100) }),
    traiter: async ({ corps }) => {
      const f = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select ventes.espace_efacture($1, $2, $3) f',
        [empreinte(corps.jeton), corps.type, corps.numero])).rows[0].f as { nom: string; xml: string } | { lien: false } | null);
      if (!f) return { statut: 404, corps: { motif: motif('espace.efacture_absente') } };
      if ('lien' in f) return { statut: 404, corps: { motif: motif('espace.lien_invalide') } };
      return { corps: f };
    },
  });

  return routes;
}
