// Les routes du dossier v10 (0011) : le point de contact de l'interface v10 (web/public/plateforme/
// pont.js) lit le dossier entier, y renvoie les objets qui changent, et fait émettre une facture ou un
// avoir par le serveur. Une clé de l'API n'y entre pas (gestes « horsCle ») : un logiciel branché passe par les
// routes de chaque module.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { motif, rendre, t } from '../../textes/index.ts';
import type { Route } from '../app.ts';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import { sceller } from '../coffre.ts';
import { mettreEnQuarantaine, type Contexte } from '../connexion.ts';
import { Refus, texteDuRefus } from '../erreurs.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { tracer } from '../trace.ts';
import { accordRemiseDeLaPiece, commandeDuServeur, depassementDuServeur, estResponsable, remiseDuServeur } from './accords.ts';
import { avecSesTickets, filtrer, mesRoles } from './droits.ts';
import { appliquer, Conflit, emettreDepuisV10, lireDepuis, lireDossier, marqueDeLecture, PARTIES_A_AUTEUR, type Changement } from './dossier.ts';
import { nombreEnTexte } from './lecture.ts';
import { etatDeNumerotation, sessionOuverte } from '../caisse/routes.ts';
import { empreinteDuPoste, PREMIERE, ticketDuPoste } from '../caisse/chaine.ts';
import { remiseAuDelaDuPlafond } from '../caisse/remise.ts';
import { codeDuResponsable } from '../caisse/retour.ts';
import { routesContrats } from './api-contrats.ts';
import { poserCompte, renvoyer } from './envoi.ts';
import { demanderPaiement, verifierPaiement } from './paiement.ts';
import { demanderSignature, signerAvecLeCode } from './signature.ts';

// Une clé v10 : l'identifiant qu'elle a donné à l'objet, ou le nom d'un champ du dossier.
const cle = z.string().min(1).max(200);
const collection = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,60}$/);
// Un objet du dossier : du JSON, sans nombre à virgule (l'interface les écrit en texte exact).
const contenu: z.ZodType<unknown> = z.lazy(() => z.union([z.number().int(), z.string(), z.boolean(), z.null(), z.array(contenu), z.record(z.string(), contenu)]));

const changement = z.object({ collection, cle, rang: z.number().int().min(0).nullable(), revision: z.number().int().min(1).nullable(), contenu: contenu });

export function routesV10(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/dossier-v10', geste: 'socle.dossier.voir',
    traiter: async ({ params, query, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      // Chacun n'en lit que ce que ses rôles voient (brique 99), et l'écran sait ce qu'il ne doit ni montrer ni renvoyer.
      const ent = params.entreprise ?? '';
      const roles = await mesRoles(tx, ent);
      // Relire par différence (brique 119) : le poste qui a sa copie donne la marque de sa dernière lecture et ce qu'elle
      // supposait (cette base, cette personne, ces rôles) ; si rien de cela n'a changé, seul ce qui a changé depuis repart.
      // Sinon, tout. La personne en fait partie (brique 123) : au changement de caissier, le poste ne garde pas ce que
      // le précédent voyait (ses tickets, les pièces qu'il n'a pas faites).
      const { marque, avenir, base } = await marqueDeLecture(tx);
      const profil = `${base}/${qui.utilisateur}/${[...roles].sort().join(',')}`;
      // Les pièces qu'un autre a faites (brique 117) : l'écran dit, avant le geste, qu'il ne les supprime pas. Seulement
      // pour qui n'est ni propriétaire ni administrateur (eux suppriment tout brouillon).
      const responsable = roles.some((r) => r === 'proprietaire' || r === 'administrateur');
      const autrui = responsable ? {} : Object.fromEntries((await tx.query(`select d.collection || '/' || d.cle k, coalesce(u.nom, '') nom from socle.dossier_v10 d
          left join socle.utilisateur u on u.id = d.cree_par
         where d.entreprise = $1 and d.collection = any($2) and d.cree_par is distinct from $3`, [ent, PARTIES_A_AUTEUR, qui.utilisateur])).rows.map((r) => [r.k, r.nom]));
      const depuis = query.depuis ?? '';
      if (/^\d{1,20}$/.test(depuis) && query.profil === profil && BigInt(depuis) <= BigInt(marque)) {
        const d = await lireDepuis(tx, ent, depuis, avenir);
        const f = filtrer(roles, d.objets);
        return { corps: { ...f, objets: await avecSesTickets(tx, ent, qui.utilisateur, roles, d.objets, f.objets), retires: filtrer(roles, d.retires).objets, partiel: true, marque, profil, autrui } };
      }
      const tous = await lireDossier(tx, ent, qui.utilisateur);
      const f = filtrer(roles, tous);
      return { corps: { ...f, objets: await avecSesTickets(tx, ent, qui.utilisateur, roles, tous, f.objets), marque, profil, autrui } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/dossier-v10', geste: 'socle.dossier.modifier',
    corps: z.object({ changements: z.array(changement).min(1).max(2000) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      return { corps: { revisions: await appliquer(tx, params.entreprise ?? '', qui.utilisateur, corps.changements as Changement[]) } };
    },
  });

  // Émettre une facture, ou un avoir : chacun sa route, chacun son geste (03 § 2.1).
  const demande = z.object({
    document: z.record(z.string(), contenu), client: z.record(z.string(), contenu).nullable(),
    revision: z.number().int().min(1).nullable(), rang: z.number().int().min(0).nullable(), netAPayer: z.string().regex(/^-?\d+(\.\d+)?$/),
  });
  for (const [type, chemin, geste] of [['facture', 'emettre', 'ventes.facture.emettre'], ['avoir', 'emettre-avoir', 'ventes.avoir.emettre']] as const) {
    ajouter({
      methode: 'POST', chemin: `/entreprises/:entreprise/dossier-v10/${chemin}`, geste, corps: demande,
      traiter: async ({ params, corps, qui }, tx) => {
        if (!tx || !qui) throw new Error('transaction attendue');
        return { corps: await emettreDepuisV10(tx, params.entreprise ?? '', qui.utilisateur, corps as Parameters<typeof emettreDepuisV10>[3], type) };
      },
    });
  }

  // ── Le ticket de caisse (brique 115 ; docs/caisse.md) ───────────────────────────────────────────
  // Encaisser : le serveur numérote le ticket dans SA série (TIC), le scelle comme une facture (montants en entiers,
  // maillon du journal), puis enregistre son paiement dans le même geste. Un ticket est payé en entier à
  // l'encaissement : sinon rien n'est vendu, et aucun numéro n'est pris (tout s'annule).
  // La caisse sans réseau (brique 120 ; docs/caisse.md, H1 à H4) : le poste dit ce qu'il a fait (la session, le numéro
  // qu'il a imprimé, sa chaîne, l'heure au comptoir, sans réseau ou non). Le serveur émet comme toujours, puis compare :
  // un écart n'est jamais corrigé, il devient une alerte.
  const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
  const poste = z.object({ session: z.string().uuid(), numero: z.string().min(1).max(60), precedente: hex64, empreinte: hex64,
    encaisseLe: z.string().datetime({ offset: true }), horsLigne: z.boolean() });
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/dossier-v10/ticket', geste: 'caisse.ticket.encaisser',
    corps: z.object({ document: z.record(z.string(), contenu), rang: z.number().int().min(0).nullable(), netAPayer: z.string().regex(/^\d+(\.\d+)?$/), poste: poste.optional(),
      responsable: z.object({ utilisateur: z.uuid(), code: z.string().trim().max(20) }).optional() }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const doc = corps.document as Record<string, unknown>;
      const paiements = Array.isArray(doc.payments) ? doc.payments as Record<string, unknown>[] : [];
      // Le paiement fait le total, au millime (le reçu et le rendu restent sur le ticket, `caisse`).
      const dec = (corps.netAPayer.split('.')[1] ?? '').length;
      const paye = paiements.reduce((s, p) => s + depuisTexte(nombreEnTexte(p.amount), dec), 0n);
      if (paye !== depuisTexte(corps.netAPayer, dec)) throw new Refus('caisse.paiement_manquant', { valeurs: { paye: versTexte(paye, dec), total: corps.netAPayer } });
      // La caisse ouverte sur CET appareil (brique 116) : un ticket ne s'encaisse que là (une caisse, un appareil).
      // Un ticket encaissé sans réseau revient dans SA session, même fermée entre-temps (dit en alerte).
      // Un poste en ligne qui croit tenir une session déjà finie (fermée d'ailleurs, puis rouverte) : sa numérotation est
      // périmée, il la réapprend avec la réponse ; rien à comparer.
      const ouverte = await sessionOuverte(tx, ent);
      const p = corps.poste && (corps.poste.horsLigne || corps.poste.session === ouverte?.id) ? corps.poste : undefined;
      // Envoyé deux fois (la réponse perdue en route, 04 § 4), un ticket ne compte qu'une fois : le même ticket du même
      // poste rend ce qu'il a déjà rendu.
      if (p) {
        const deja = (await tx.query(`select d.contenu, d.revision, vp.numero_texte from caisse.ticket t join ventes.piece vp on vp.id = t.piece
            join socle.dossier_v10 d on d.entreprise = vp.entreprise and d.collection = 'documents' and d.cle = vp.ref_v10
           where t.entreprise = $1 and vp.ref_v10 = $2 and t.empreinte_poste = $3`, [ent, String(doc.id ?? ''), p.empreinte])).rows[0];
        if (deja) return { corps: { contenu: deja.contenu, revision: Number(deja.revision), numero: deja.numero_texte, caisse: await etatDeNumerotation(tx, ent) } };
      }
      let session: { id: string; ferme: boolean };
      if (p?.horsLigne) {
        const s = (await tx.query(`select id, appareil, fermee_le from caisse.session where id = $1 and entreprise = $2`, [p.session, ent])).rows[0] as
          { id: string; appareil: string; fermee_le: Date | null } | undefined;
        if (!s) throw new Refus('caisse.session_inconnue');
        if (s.appareil !== qui.appareil) throw new Refus('caisse.pas_ce_poste');
        session = { id: s.id, ferme: s.fermee_le !== null };
      } else {
        const s = ouverte;
        if (!s) throw new Refus('caisse.fermee', { bouton: 'caisse.session.ouvrir' });
        if (s.appareil !== qui.appareil) throw new Refus('caisse.ouverte_ailleurs', { valeurs: { appareil: s.appareil_nom, qui: s.qui } });
        session = { id: s.id, ferme: false };
      }
      // La remise à la caisse (brique 125 ; docs/caisse.md, M1 à M4) : au-delà du plafond de l'entreprise (0 % par défaut),
      // le code d'un responsable présent, sauf pour un responsable lui-même. Sans réseau, le code ne se vérifie pas : le
      // ticket s'enregistre (c'est un fait), et l'écart se dit en alerte.
      const remise = await remiseAuDelaDuPlafond(tx, ent, doc);
      let remiseCaisse: { taux: string; approuvePar: string } | null = null;
      let remiseSansAccord = false;
      if (remise && !(await estResponsable(tx, ent))) {
        if (p?.horsLigne) remiseSansAccord = true;
        else {
          const v = await codeDuResponsable(tx, ent, corps.responsable, qui.appareil,
            { sans: 'caisse.remise_sans_responsable', inconnu: 'caisse.remise_responsable_inconnu', faux: 'caisse.remise_code_faux', valeurs: remise });
          if ('reponse' in v) return v.reponse;
          remiseCaisse = { taux: remise.taux, approuvePar: v.approuvePar.nom };
        }
      }
      // Le client, s'il y en a un, est celui du dossier (jamais celui de l'écran).
      let client: Record<string, unknown> | null = null;
      if (typeof doc.clientId === 'string' && doc.clientId) {
        client = (await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'clients' and cle = $2`, [ent, doc.clientId])).rows[0]?.contenu ?? null;
        if (!client) throw new Refus('caisse.client_inconnu');
      }
      // La dernière empreinte de la session (avant ce ticket) : la précédente attendue.
      const derniere = String((await tx.query(`select empreinte_poste from caisse.ticket where session = $1 and empreinte_poste is not null
        order by cree_le desc, piece desc limit 1`, [session.id])).rows[0]?.empreinte_poste ?? PREMIERE);
      const r = await emettreDepuisV10(tx, ent, qui.utilisateur, { document: { ...doc, payments: [], ...(remiseCaisse ? { remiseCaisse } : {}) }, client, revision: null, rang: corps.rang, netAPayer: corps.netAPayer }, 'facture', { ticket: true });
      const cle = String(doc.id);
      const piece = String((await tx.query(`insert into caisse.ticket (piece, entreprise, session, numero_poste, precedente, empreinte_poste, encaisse_le, hors_ligne)
        select id, entreprise, $3, $4, $5, $6, $7, $8 from ventes.piece where entreprise = $1 and ref_v10 = $2 returning piece`,
      [ent, cle, session.id, p?.numero ?? null, p?.precedente ?? null, p?.empreinte ?? null, p?.encaisseLe ?? null, p?.horsLigne === true])).rows[0].piece);
      // Ce que le serveur constate, sans rien corriger.
      if (p) {
        const alerter = (nature: string, detail: Record<string, unknown> = {}) => tx.query(`insert into caisse.alerte (entreprise, session, piece, nature, numero_poste, numero_serie, detail)
          values ($1, $2, $3, $4, $5, $6, $7)`, [ent, session.id, piece, nature, p.numero, r.numero, JSON.stringify(detail)]);
        if (p.numero !== r.numero) await alerter('numero');
        if (p.precedente !== derniere) await alerter('chaine', { attendue: derniere, recue: p.precedente });
        if (empreinteDuPoste(p.precedente, ticketDuPoste(doc, corps.netAPayer, p.numero, p.encaisseLe)) !== p.empreinte) await alerter('empreinte');
        if (session.ferme) await alerter('apres_fermeture');
        if (remiseSansAccord && remise) await alerter('remise', remise);
      }
      const avecPaiement = { ...r.contenu, payments: paiements, ...(p ? { numeroPoste: p.numero } : {}) };
      const [ecrit] = await appliquer(tx, ent, qui.utilisateur, [{ collection: 'documents', cle, rang: corps.rang, revision: r.revision, contenu: avecPaiement }], { serveur: true });
      return { corps: { contenu: avecPaiement, revision: ecrit?.revision ?? r.revision, numero: r.numero, caisse: await etatDeNumerotation(tx, ent) } };
    },
  });

  // ── L'accord d'un responsable au-delà de l'encours (brique 98 ; docs/accords.md) ──────────────────────
  // Demander : le serveur recalcule le dépassement (jamais celui de l'écran) et garde la demande, en attente.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/dossier-v10/accord', geste: 'ventes.facture.emettre',
    corps: z.object({ document: z.record(z.string(), contenu) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const doc = corps.document as Record<string, unknown>;
      const piece = String(doc.id ?? '');
      if (!piece || doc.type !== 'facture' || typeof doc.clientId !== 'string' || !doc.clientId) throw new Refus('ventes.seule_facture');
      const qui = async () => (await tx.query(`select u.nom from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
        where m.entreprise = $1 and m.actif and m.roles && array['proprietaire', 'administrateur'] order by u.nom`, [ent])).rows.map((x) => String(x.nom));
      // La remise d'abord (brique 103), comme à l'émission : au-delà du seuil et sans accord, c'est elle qu'on demande.
      const rem = await remiseDuServeur(tx, ent, doc);
      if (rem && !(await accordRemiseDeLaPiece(tx, ent, piece, rem.taux))) {
        const dejaR = (await tx.query(`select id from ventes.accord where entreprise = $1 and piece_v10 = $2 and statut = 'en_attente' and geste = 'remise' and taux = $3
          order by demande_le desc limit 1`, [ent, piece, rem.taux])).rows[0] as { id: string } | undefined;
        const idR = dejaR?.id ?? String((await tx.query(`insert into ventes.accord (entreprise, geste, piece_v10, client_v10, montant, encours, taux, seuil, demande_par)
          values ($1, 'remise', $2, $3, $4, 0, $5, $6, socle.moi()) returning id`, [ent, piece, doc.clientId, Math.max(1, rem.montant), rem.taux, rem.seuil])).rows[0].id);
        return { corps: { id: idR, statut: 'en_attente', geste: 'remise', responsables: await qui() } };
      }
      const d = await depassementDuServeur(tx, ent, doc);
      if (!d) throw new Refus('ventes.accord_inutile');
      const deja = (await tx.query(`select id from ventes.accord where entreprise = $1 and piece_v10 = $2 and statut = 'en_attente' and montant = $3 and geste = 'encours'
        order by demande_le desc limit 1`, [ent, piece, d.piece])).rows[0] as { id: string } | undefined;
      const id = deja?.id ?? String((await tx.query(`insert into ventes.accord (entreprise, geste, piece_v10, client_v10, montant, encours, plafond, demande_par)
        values ($1, 'encours', $2, $3, $4, $5, $6, socle.moi()) returning id`, [ent, piece, doc.clientId, d.piece, d.encours, d.plafond])).rows[0].id);
      return { corps: { id, statut: 'en_attente', geste: 'encours', responsables: await qui() } };
    },
  });
  // La commande fournisseur au-delà du seuil (brique 114) : qui écrit les commandes demande l'accord. Le serveur
  // recalcule le montant (jamais celui de l'écran) ; l'enregistrement le vérifiera de nouveau quand elle partira.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/dossier-v10/accord-commande', geste: 'achats.pieces.modifier',
    corps: z.object({ commande: z.record(z.string(), contenu) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const o = corps.commande as Record<string, unknown>;
      const piece = String(o.id ?? '');
      if (!piece || typeof o.supplierId !== 'string' || !o.supplierId) throw new Refus('achats.seule_commande');
      const d = await commandeDuServeur(tx, ent, o);
      if (!d) throw new Refus('achats.accord_inutile');
      const deja = (await tx.query(`select id from ventes.accord where entreprise = $1 and piece_v10 = $2 and montant = $3 and statut = 'en_attente' and geste = 'commande'
        order by demande_le desc limit 1`, [ent, piece, d.montant])).rows[0] as { id: string } | undefined;
      const id = deja?.id ?? String((await tx.query(`insert into ventes.accord (entreprise, geste, piece_v10, client_v10, montant, encours, plafond, demande_par)
        values ($1, 'commande', $2, $3, $4, 0, $5, socle.moi()) returning id`, [ent, piece, o.supplierId, d.montant, d.seuil])).rows[0].id);
      const responsables = (await tx.query(`select u.nom from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
        where m.entreprise = $1 and m.actif and m.roles && array['proprietaire', 'administrateur'] order by u.nom`, [ent])).rows.map((x) => String(x.nom));
      return { corps: { id, statut: 'en_attente', geste: 'commande', responsables } };
    },
  });
  // Les demandes : celles qui attendent, puis les dernières décidées ; `peutDecider` dit si la personne en décide.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/accords', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const lignes = (await tx.query(`select a.id, a.geste, a.taux, a.seuil, a.piece_v10, a.client_v10, a.montant, a.encours, a.plafond, a.statut, a.motif, a.demande_le, a.decide_le,
          d.nom demandeur, x.nom decideur, (a.demande_par = socle.moi()) mienne
        from ventes.accord a join socle.utilisateur d on d.id = a.demande_par left join socle.utilisateur x on x.id = a.decide_par
        where a.entreprise = $1 order by (a.statut = 'en_attente') desc, coalesce(a.decide_le, a.demande_le) desc limit 50`, [ent])).rows;
      return { corps: { peutDecider: await estResponsable(tx, ent), accords: lignes.map((l) => ({
        id: l.id, geste: l.geste, taux: l.taux === null ? null : Number(l.taux), seuil: l.seuil === null ? null : Number(l.seuil),
        piece: l.piece_v10, client: l.client_v10, montant: Number(l.montant), encours: Number(l.encours), plafond: l.plafond === null ? null : Number(l.plafond),
        statut: l.statut, motif: l.motif, demandeLe: l.demande_le, decideLe: l.decide_le, demandeur: l.demandeur, decideur: l.decideur, mienne: l.mienne })) } };
    },
  });
  // Décider : accorder ou refuser (le propriétaire, un administrateur ; jamais sa propre demande).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/accords/:accord/decider', geste: 'ventes.accord.donner',
    corps: z.object({ decision: z.enum(['accorder', 'refuser']), motif: z.string().trim().max(500).optional() }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      if (!z.string().uuid().safeParse(params.accord).success) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const a = (await tx.query(`select statut, (demande_par = socle.moi()) mienne from ventes.accord where id = $1 and entreprise = $2 for update`,
        [params.accord, params.entreprise])).rows[0] as { statut: string; mienne: boolean } | undefined;
      if (!a) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      if (a.statut !== 'en_attente') throw new Refus('ventes.accord_deja_decide');
      if (a.mienne) throw new Refus('ventes.accord_le_sien');
      await tx.query(`update ventes.accord set statut = $2, decide_par = socle.moi(), decide_le = now(), motif = $3 where id = $1`,
        [params.accord, corps.decision === 'accorder' ? 'accorde' : 'refuse', corps.motif || null]);
      return { corps: { statut: corps.decision === 'accorder' ? 'accorde' : 'refuse' } };
    },
  });

  // ── La facture électronique (brique 80 ; docs/facture-electronique.md) ────────────────────────────
  // Le fichier TEIF qu'a écrit le serveur à l'émission (c'est lui qui sera signé et envoyé) : le même,
  // chaque fois. Une pièce qui n'en a pas (une entreprise non soumise, une fiche incomplète) : 404.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/dossier-v10/:cle/teif', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      // Signé (brique 81) : le fichier signé ; accepté par la TTN (brique 82) : la facture validée, qui fait foi.
      const f = (await tx.query(`select e.nom, coalesce(x.xml_valide, g.xml, e.xml) xml, coalesce(g.empreinte, e.empreinte) empreinte, (g.piece is not null) signe,
          g.signe_le, g.titulaire, x.statut envoi, x.depose_le, x.accepte_le, x.reference, x.motif, s.essai
          from ventes.efacture e join ventes.piece p on p.id = e.piece left join ventes.efacture_signee g on g.piece = e.piece
          left join ventes.envoi_ttn x on x.piece = e.piece join socle.entreprise s on s.id = p.entreprise
        where p.entreprise = $1 and p.ref_v10 = $2`, [params.entreprise, params.cle])).rows[0] as { nom: string; xml: string; empreinte: string; signe: boolean;
          signe_le: Date | null; titulaire: string | null; envoi: string | null; depose_le: Date | null; accepte_le: Date | null; reference: string | null;
          motif: { cle: string; valeurs: Record<string, string> } | null; essai: boolean } | undefined;
      if (!f) return { statut: 404, corps: { motif: motif('efacture.absent') } };
      const nom = f.envoi === 'acceptee' ? f.nom.replace(/\.xml$/, '_ttn.xml') : f.signe ? f.nom.replace(/\.xml$/, '_signe.xml') : f.nom;
      return { corps: { nom, xml: f.xml, empreinte: f.empreinte, signe: f.signe, signeLe: f.signe_le ? f.signe_le.toISOString() : null, titulaire: f.titulaire,
        essai: f.essai, ttnBranche: Boolean(ctx.ttn?.adresse),
        envoi: f.envoi ? { statut: f.envoi, deposeLe: f.depose_le ? f.depose_le.toISOString() : null, accepteLe: f.accepte_le ? f.accepte_le.toISOString() : null,
          reference: f.reference, motif: f.motif ? t(f.motif.cle, f.motif.valeurs) : null, motifCle: f.motif?.cle ?? null } : null } };
    },
  });

  // ── La signature DigiGo (brique 81 ; docs/facture-electronique.md) ─────────────────────────────────
  // Qui signe pour l'entreprise : son identifiant DigiGo (le propriétaire ou un administrateur le pose).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/efacture/signataire', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const s = (await tx.query(`select s.identifiant, s.pose_le, u.nom pose_par from ventes.signataire s left join socle.utilisateur u on u.id = s.pose_par
        where s.entreprise = $1`, [params.entreprise])).rows[0] as { identifiant: string; pose_le: Date; pose_par: string | null } | undefined;
      return { corps: { signataire: s ? { identifiant: s.identifiant, poseLe: s.pose_le.toISOString(), posePar: s.pose_par ?? '' } : null, branche: !!ctx.efacture } };
    },
  });
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/efacture/signataire', geste: 'ventes.efacture.regler',
    corps: z.object({ identifiant: z.string().trim().min(4).max(60) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      await tx.query(`insert into ventes.signataire (entreprise, identifiant, pose_le, pose_par) values ($1, $2, now(), $3)
        on conflict (entreprise) do update set identifiant = excluded.identifiant, pose_le = excluded.pose_le, pose_par = excluded.pose_par`, [ent, corps.identifiant, qui.utilisateur]);
      await tracer(tx, ent, 'ventes.efacture.regler', { type: 'signataire', id: null }, null, { identifiant: corps.identifiant });
      return { corps: { ok: true } };
    },
  });
  // Signer des pièces émises : DigiGo envoie un code au signataire…
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/efacture/signatures', geste: 'ventes.facture.signer',
    corps: z.object({ pieces: z.array(z.string().min(1).max(200)).min(1).max(100) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      return demanderSignature(ctx, tx, params.entreprise ?? '', qui.utilisateur, [...new Set(corps.pieces)]);
    },
  });
  // … et ce code, tapé, signe les fichiers.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/efacture/signatures/:demande/code', geste: 'ventes.facture.signer',
    corps: z.object({ code: z.string().trim().regex(/^\d{4,8}$/) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      if (!/^[0-9a-f-]{36}$/.test(params.demande ?? '')) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      return signerAvecLeCode(ctx, tx, params.entreprise ?? '', qui.utilisateur, params.demande ?? '', corps.code);
    },
  });

  // ── L'envoi à la TTN (brique 82 ; docs/facture-electronique.md) ────────────────────────────────────
  // Le compte El Fatoora (jamais le mot de passe), son dernier refus, et les derniers envois.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/efacture/ttn', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const c = (await tx.query(`select c.identifiant, c.pose_le, u.nom pose_par, c.dernier_refus, c.dernier_refus_le
        from ventes.ttn_compte c left join socle.utilisateur u on u.id = c.pose_par where c.entreprise = $1`, [params.entreprise])).rows[0] as
        { identifiant: string; pose_le: Date; pose_par: string | null; dernier_refus: { cle: string; valeurs: Record<string, string> } | null; dernier_refus_le: Date | null } | undefined;
      const envois = (await tx.query(`select p.numero_texte numero, x.statut, x.depose_le, x.accepte_le, x.reference, x.motif
        from ventes.envoi_ttn x join ventes.piece p on p.id = x.piece where x.entreprise = $1 order by x.cree_le desc limit 10`, [params.entreprise])).rows as
        { numero: string; statut: string; depose_le: Date | null; accepte_le: Date | null; reference: string | null; motif: { cle: string; valeurs: Record<string, string> } | null }[];
      const essai = Boolean((await tx.query('select essai from socle.entreprise where id = $1', [params.entreprise])).rows[0]?.essai);
      const dire = (m: { cle: string; valeurs: Record<string, string> } | null) => (m ? t(m.cle, m.valeurs) : null);
      return {
        corps: {
          branche: Boolean(ctx.ttn?.adresse), essai,
          compte: c ? { identifiant: c.identifiant, poseLe: c.pose_le.toISOString(), posePar: c.pose_par ?? '', dernierRefus: dire(c.dernier_refus),
            dernierRefusLe: c.dernier_refus_le ? c.dernier_refus_le.toISOString() : null } : null,
          envois: envois.map((x) => ({ numero: x.numero, statut: x.statut, deposeLe: x.depose_le ? x.depose_le.toISOString() : null,
            accepteLe: x.accepte_le ? x.accepte_le.toISOString() : null, reference: x.reference, motif: dire(x.motif) })),
        },
      };
    },
  });
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/efacture/ttn', geste: 'ventes.efacture.regler',
    corps: z.object({ identifiant: z.string().trim().min(1).max(100), motDePasse: z.string().min(1).max(200) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      await poserCompte(ctx, tx, params.entreprise ?? '', qui.utilisateur, corps.identifiant, corps.motDePasse);
      return { corps: { ok: true } };
    },
  });
  // Renvoyer une pièce que la TTN a refusée.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/efacture/envois/:cle/renvoyer', geste: 'ventes.facture.envoyer',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      return renvoyer(ctx, tx, params.entreprise ?? '', params.cle ?? '');
    },
  });

  // ── La quarantaine (brique 74 bis ; docs/hors-ligne.md, H10 ; 04 § 7) ──────────────────────────
  // Un appareil retiré remet ce qui attendait le réseau, par son jeton (qui n'ouvre plus rien d'autre) :
  // reçu, jamais appliqué d'office. Une seule remise par session ; tout un dossier peut y tenir.
  ajouter({
    // (Une route sans session : l'entreprise est dans le corps, la porte ne la juge pas ; la base, si.)
    // (8 Mo : une route sans session ne lit pas plus ; une journée de travail hors ligne y tient large.)
    methode: 'POST', chemin: '/quarantaine', geste: 'public', limiteCorps: 8 * 1024 * 1024,
    corps: z.object({ entreprise: z.string().uuid(), changements: z.array(changement).min(1).max(20_000) }),
    traiter: async ({ corps, requete }) => {
      const jeton = /^Bearer (.+)$/.exec(requete.headers.authorization ?? '')?.[1];
      const recus = jeton ? await mettreEnQuarantaine(ctx, jeton, corps.entreprise, corps.changements) : null;
      if (recus === null) return { statut: 401, corps: { motif: motif('commun.connexion_requise'), bouton: 'connexion' } };
      return { corps: { recus } };
    },
  });

  // Ce qui attend la décision : qui l'a remis, depuis quel appareil, quand, et quoi.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/quarantaine', geste: 'socle.dossier.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await tx.query(`select q.id, q.appareil_nom, u.nom utilisateur, q.recue_le, q.changements
        from socle.quarantaine q left join socle.utilisateur u on u.id = q.utilisateur
        where q.entreprise = $1 and q.decision is null order by q.recue_le, q.id limit 50`, [params.entreprise]);
      return {
        corps: {
          remises: (r.rows as { id: string; appareil_nom: string; utilisateur: string | null; recue_le: Date; changements: Changement[] }[]).map((q) => ({
            id: q.id, appareil: q.appareil_nom, utilisateur: q.utilisateur ?? '', recueLe: q.recue_le.toISOString(), changements: q.changements,
          })),
        },
      };
    },
  });

  // Décider : rejeter (rien ne s'applique, la remise reste) ; accepter (chaque changement s'applique
  // comme s'il arrivait maintenant, avec la révision que l'appareil avait vue : ce qui a changé depuis,
  // ou que le serveur refuse, est mis de côté et dit ; jamais deux versions fusionnées en une troisième).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/quarantaine/:remise', geste: 'socle.dossier.modifier',
    corps: z.object({ accepter: z.boolean() }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      if (!/^[0-9a-f-]{36}$/i.test(params.remise ?? '')) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const q = (await tx.query('select changements, decision from socle.quarantaine where id = $1 and entreprise = $2 for update', [params.remise, params.entreprise])).rows[0] as
        { changements: Changement[]; decision: string | null } | undefined;
      if (!q) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      if (q.decision) return { statut: 409, corps: { motif: motif('quarantaine.deja_decidee') } };
      let appliques = 0;
      const misDeCote: { collection: string; cle: string; raison: unknown }[] = [];
      if (corps.accepter) {
        for (const c of q.changements) {
          await tx.query('savepoint changement');
          try {
            await appliquer(tx, params.entreprise ?? '', qui.utilisateur, [c]);
            await tx.query('release savepoint changement');
            // On compte ce que la personne avait fait (les réglages du dossier suivent sans se compter, H6).
            if (c.collection !== '_racine') appliques++;
          } catch (e) {
            await tx.query('rollback to savepoint changement');
            // Changé depuis, ou refusé (par le serveur ou par la base : une facture émise, un mois
            // fermé) : mis de côté, avec sa raison ; le reste de la remise s'applique quand même.
            if (e instanceof Conflit) misDeCote.push({ collection: c.collection, cle: c.cle, raison: motif('quarantaine.change_depuis') });
            else if (e instanceof Refus || (e as { code?: unknown }).code === '42501') misDeCote.push({ collection: c.collection, cle: c.cle, raison: texteDuRefus(e as Error) });
            else throw e;
          }
        }
      }
      await tx.query(`update socle.quarantaine set decision = $2, decidee_le = $3, decidee_par = socle.moi(), mis_de_cote = $4 where id = $1`,
        [params.remise, corps.accepter ? 'acceptee' : 'rejetee', (ctx.maintenant ?? (() => new Date()))(), corps.accepter ? JSON.stringify(misDeCote) : null]);
      return { corps: { appliques, misDeCote } };
    },
  });

  // ── Le paiement en ligne (brique 78 ; docs/paiement-en-ligne.md ; 14 § 2.2) ─────────────────────
  // Les réglages : l'entreprise branche SON compte Konnect (le portefeuille, et la clé de son API,
  // scellée par le coffre : aucune route ne la rend jamais). Le compte de trésorerie « Konnect » naît
  // dans le dossier la première fois : les paiements en ligne y arrivent.
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/paiement-en-ligne', geste: 'ventes.paiement.regler',
    corps: z.object({ portefeuille: z.string().trim().min(1).max(100), cle: z.string().trim().min(8).max(500) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || !ctx.paiement) throw new Error('transaction et paiement attendus');
      const ent = params.entreprise ?? '';
      const maintenant = (ctx.maintenant ?? (() => new Date()))();
      const deja = (await tx.query('select compte_v10 from ventes.prestataire where entreprise = $1', [ent])).rows[0]?.compte_v10 as string | undefined;
      const existe = deja ? (await tx.query("select 1 from socle.dossier_v10 where entreprise = $1 and collection = 'accounts' and cle = $2", [ent, deja])).rowCount : 0;
      let compte = existe ? String(deja) : '';
      if (!compte) {
        compte = randomUUID();
        const rang = Number((await tx.query("select coalesce(max(rang), -1) + 1 r from socle.dossier_v10 where entreprise = $1 and collection = 'accounts'", [ent])).rows[0].r);
        await appliquer(tx, ent, qui.utilisateur, [{ collection: 'accounts', cle: compte, rang, revision: null, contenu: {
          id: compte, name: rendre(t('paiement.compte_nom'), 'fr'), kind: 'autre', bank: 'Konnect', rib: '', opening: 0,
          openingDate: aujourdhuiATunis(maintenant), isDefault: false, statementBalance: '', notes: '',
        } }]);
      }
      const cleFin = corps.cle.slice(-4);
      // (Pas d'« on conflict » : il relirait la clé scellée, que le compte du serveur ne peut pas lire.)
      const valeurs = [ent, corps.portefeuille, sceller(ctx.paiement.coffre, ent, corps.cle), cleFin, compte, maintenant, qui.utilisateur];
      const change = await tx.query(`update ventes.prestataire set prestataire = 'konnect', portefeuille = $2, cle_scellee = $3, cle_fin = $4, compte_v10 = $5,
        pose_le = $6, pose_par = $7, dernier_refus = null, dernier_refus_le = null where entreprise = $1`, valeurs);
      if (!change.rowCount) {
        await tx.query(`insert into ventes.prestataire (entreprise, prestataire, portefeuille, cle_scellee, cle_fin, compte_v10, pose_le, pose_par)
          values ($1, 'konnect', $2, $3, $4, $5, $6, $7)`, valeurs);
      }
      await tracer(tx, ent, 'ventes.paiement.regler', { type: 'prestataire', id: null }, null, { prestataire: 'konnect', portefeuille: corps.portefeuille, cleFin });
      return { corps: { ok: true } };
    },
  });

  // Débrancher : plus de « Payer en ligne » ; le compte de trésorerie et les paiements passés restent.
  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/paiement-en-ligne', geste: 'ventes.paiement.regler',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await tx.query('delete from ventes.prestataire where entreprise = $1', [params.entreprise]);
      if (!r.rowCount) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await tracer(tx, params.entreprise ?? '', 'ventes.paiement.arreter', { type: 'prestataire', id: null }, null, null);
      return { corps: { ok: true } };
    },
  });

  // Ce qui est branché (jamais la clé : ses derniers caractères), le dernier refus du prestataire, et
  // les derniers paiements demandés.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/paiement-en-ligne', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const p = (await tx.query(`select pr.portefeuille, pr.cle_fin, pr.pose_le, u.nom pose_par, pr.dernier_refus, pr.dernier_refus_le
        from ventes.prestataire pr left join socle.utilisateur u on u.id = pr.pose_par where pr.entreprise = $1`, [params.entreprise])).rows[0] as
        { portefeuille: string; cle_fin: string; pose_le: Date; pose_par: string | null; dernier_refus: { cle: string; valeurs: Record<string, string> } | null; dernier_refus_le: Date | null } | undefined;
      const demandes = (await tx.query(`select x.cree_le, p.numero_texte numero, x.montant, dv.decimales, x.devise, x.statut, x.encaisse_le, x.motif
        from ventes.paiement_en_ligne x join ventes.piece p on p.id = x.piece join socle.devise dv on dv.code = x.devise
        where x.entreprise = $1 order by x.cree_le desc limit 20`, [params.entreprise])).rows as
        { cree_le: Date; numero: string; montant: bigint; decimales: number; devise: string; statut: string; encaisse_le: Date | null; motif: { cle: string; valeurs: Record<string, string> } | null }[];
      const dire = (m: { cle: string; valeurs: Record<string, string> } | null) => (m ? t(m.cle, m.valeurs) : null);
      return {
        corps: {
          branche: p ? { prestataire: 'konnect', portefeuille: p.portefeuille, cleFin: p.cle_fin, poseLe: p.pose_le.toISOString(), posePar: p.pose_par ?? '',
            dernierRefus: dire(p.dernier_refus), dernierRefusLe: p.dernier_refus_le ? p.dernier_refus_le.toISOString() : null } : null,
          demandes: demandes.map((d) => ({ demandeLe: d.cree_le.toISOString(), numero: d.numero, montant: versTexte(d.montant, d.decimales), devise: d.devise, statut: d.statut,
            encaisseLe: d.encaisse_le ? d.encaisse_le.toISOString() : null, motif: dire(d.motif) })),
        },
      };
    },
  });

  // Le client paie depuis son espace (une route sans session : le lien secret, dans le corps).
  ajouter({
    methode: 'POST', chemin: '/espace/payer', geste: 'public',
    corps: z.object({ jeton: z.string().min(10).max(100), numero: z.string().min(1).max(60) }),
    traiter: async ({ corps }) => {
      const r = await demanderPaiement(ctx, corps.jeton, corps.numero);
      if (!r) return { statut: 404, corps: { motif: motif('espace.lien_invalide') } };
      if ('refus' in r) return { statut: r.statut, corps: { motif: r.refus } };
      return { corps: { adresse: r.adresse } };
    },
  });

  // La page de retour : où en est CE paiement (le secret de son adresse de retour le prouve). La même
  // vérification que l'avis du prestataire : si l'avis n'est pas arrivé, c'est elle qui enregistre.
  ajouter({
    methode: 'POST', chemin: '/espace/paiement', geste: 'public',
    corps: z.object({ paiement: z.string().uuid(), s: z.string().min(10).max(100) }),
    traiter: async ({ corps }) => {
      const e = await verifierPaiement(ctx, { id: corps.paiement, secret: corps.s });
      if (!e) return { statut: 404, corps: { motif: motif('paiement.retour_inconnu') } };
      return { corps: { etat: e.etat, numero: e.numero, montant: e.montant, devise: e.devise } };
    },
  });

  // L'avis du prestataire (« va regarder ») : il n'est pas signé, n'importe qui peut l'appeler ; il ne
  // décide de rien, il déclenche la question au prestataire. Il répond toujours pareil.
  for (const methode of ['GET', 'POST'] as const) {
    ajouter({
      methode, chemin: '/paiements/konnect', geste: 'public',
      traiter: async ({ query }) => {
        const ref = typeof query.payment_ref === 'string' ? query.payment_ref.slice(0, 200) : '';
        if (ref) await verifierPaiement(ctx, { ref });
        return { corps: { ok: true } };
      },
    });
  }

  routes.push(...routesContrats());
  return routes;
}
