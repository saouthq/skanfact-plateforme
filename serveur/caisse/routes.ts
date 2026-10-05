// La caisse et sa session (brique 116 ; 01 § 10 ; 03 § 2.1 « Caisse » ; 04 § 3.1 ; docs/caisse.md).
//
// Une caisse n'est tenue que par UN appareil à la fois (04 § 3.1) : la session s'ouvre avec le fond de caisse sur un
// appareil, qui tient la caisse jusqu'à la fermeture ; un ticket ne s'encaisse que sur cet appareil. La fermeture
// compte les espèces du tiroir, dit ce qu'il devait contenir (le fond, plus les espèces encaissées pendant la session)
// et l'écart, et fige le Z, calculé par le serveur sur ses propres tickets. À VÉRIFIER avec le cahier des charges NACEF.

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Transaction } from '../base.ts';
import { attenteLisible } from '../connexion.ts';
import { Refus } from '../erreurs.ts';
import { correspond, empreinte } from '../mot-de-passe.ts';
import { tracer } from '../trace.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { PREMIERE } from './chaine.ts';
import { routeRetour } from './retour.ts';
import { motif, rendre, t } from '../../textes/index.ts';
import './textes.ts';

const montant = z.string().trim().min(1).max(30);

// La devise de l'entreprise et ses décimales : la caisse compte dans la devise de l'entreprise.
async function deviseDe(tx: Transaction, entreprise: string) {
  const r = (await tx.query(`select e.devise_base devise, coalesce(d.decimales, 3) decimales from socle.entreprise e
    left join socle.devise d on d.code = e.devise_base where e.id = $1`, [entreprise])).rows[0] as { devise: string; decimales: number };
  return { devise: r.devise, decimales: Number(r.decimales) };
}
// Un montant tapé au comptoir (« 150 », « 150,5 », « 150.500 ») en entier de la devise ; illisible, refusé en le disant.
function lireMontant(valeur: string, decimales: number): bigint {
  const v = valeur.replace(/\s/g, '').replace(',', '.');
  try {
    if (!/^\d+(\.\d+)?$/.test(v)) throw new Error('illisible');
    return depuisTexte(v, decimales);
  } catch {
    throw new Refus('caisse.montant_illisible', { valeurs: { valeur } });
  }
}

// La session ouverte de l'entreprise (une caisse par entreprise, pour commencer), avec qui la tient et où.
export async function sessionOuverte(tx: Transaction, entreprise: string) {
  return (await tx.query(`select s.id, s.caisse, s.appareil, s.fond, s.ouverte_le, u.nom qui, s.appareil_nom
      from caisse.session s join socle.utilisateur u on u.id = s.ouverte_par
     where s.entreprise = $1 and s.fermee_le is null order by s.ouverte_le limit 1`, [entreprise])).rows[0] as
    { id: string; caisse: string; appareil: string; fond: string; ouverte_le: Date; qui: string; appareil_nom: string } | undefined;
}

// Le Z d'une session : ses tickets, leurs totaux et leurs paiements par mode, comptés par le serveur. Ses retours
// (brique 124) : l'argent rendu, par mode, sorti du tiroir ; l'argent rendu sur un ticket (un règlement négatif) ne se
// compte pas avec ses encaissements, mais dans la session du retour.
async function calculerZ(tx: Transaction, session: string, fond: bigint) {
  const tot = (await tx.query(`select count(*)::int nombre, coalesce(sum(p.net_a_payer), 0)::text total, coalesce(sum(p.total_tva), 0)::text tva,
      min(p.numero_texte) premier, max(p.numero_texte) dernier
    from caisse.ticket t join ventes.piece p on p.id = t.piece where t.session = $1`, [session])).rows[0] as
    { nombre: number; total: string; tva: string; premier: string | null; dernier: string | null };
  const modes = (await tx.query(`select r.mode, sum(r.montant)::text montant from caisse.ticket t join ventes.reglement r on r.piece = t.piece
    where t.session = $1 and r.montant > 0 group by r.mode order by r.mode`, [session])).rows as { mode: string; montant: string }[];
  const parMode = Object.fromEntries(modes.map((m) => [m.mode, BigInt(m.montant)])) as Record<string, bigint>;
  const rendus = (await tx.query(`select mode, sum(montant)::text montant, count(*)::int nombre from caisse.retour where session = $1 group by mode order by mode`, [session])).rows as
    { mode: string; montant: string; nombre: number }[];
  const rendu = Object.fromEntries(rendus.map((m) => [m.mode, BigInt(m.montant)])) as Record<string, bigint>;
  const especes = (parMode.especes ?? 0n) - (rendu.especes ?? 0n);
  // Les retours de la session, nommés (vu sur le serveur d'essai le 05/10/2026 : le Z ne citait pas l'avoir du retour) :
  // chaque avoir, le ticket qu'il reprend et l'argent rendu (le net de l'avoir, vérifié au retour) ; le net des ventes
  // en déduit leur total, et leur TVA.
  const avoirs = (await tx.query(`select a.numero_texte numero, t.numero_texte ticket, r.montant::text montant, coalesce(a.total_tva, 0)::text tva
    from caisse.retour r join ventes.piece a on a.id = r.piece join ventes.piece t on t.id = r.ticket
    where r.session = $1 order by r.cree_le, a.numero_texte`, [session])).rows as { numero: string; ticket: string; montant: string; tva: string }[];
  const retoursTtc = avoirs.reduce((s, a) => s + BigInt(a.montant), 0n);
  const retoursTva = avoirs.reduce((s, a) => s + BigInt(a.tva), 0n);
  return { nombre: tot.nombre, premier: tot.premier, dernier: tot.dernier, total: BigInt(tot.total), tva: BigInt(tot.tva), parMode, rendu,
    retours: rendus.reduce((n, m) => n + m.nombre, 0), attendu: fond + especes,
    avoirs: avoirs.map((a) => ({ numero: a.numero, ticket: a.ticket, montant: BigInt(a.montant) })), retoursTtc,
    net: BigInt(tot.total) - retoursTtc, tvaNette: BigInt(tot.tva) - retoursTva };
}

// Ce que le poste qui tient la caisse doit savoir pour numéroter et chaîner sans réseau (brique 120 ; docs/caisse.md,
// H1 et H2) : la session, la forme de la série des tickets, le prochain numéro (et la période de sa remise à zéro), et
// la dernière empreinte de la chaîne de la session.
export async function etatDeNumerotation(tx: Transaction, entreprise: string) {
  const s = await sessionOuverte(tx, entreprise);
  const serie = (await tx.query(`select id, format, prefixe, remise from socle.serie where entreprise = $1 and type = 'facture' and prefixe = 'TIC'
    and legale and active order by cree_le limit 1`, [entreprise])).rows[0] as { id: string; format: string; prefixe: string; remise: string } | undefined;
  if (!s || !serie) return null;
  const jour = aujourdhuiATunis();
  const prochain = (await tx.query(`select numero::int numero, socle.periode_de($2, $3::date) periode from socle.prochain_numero($1, $3::date)`, [serie.id, serie.remise, jour])).rows[0] as
    { numero: number; periode: number };
  const chaine = String((await tx.query(`select empreinte_poste from caisse.ticket where session = $1 and empreinte_poste is not null
    order by cree_le desc, piece desc limit 1`, [s.id])).rows[0]?.empreinte_poste ?? PREMIERE);
  return { session: s.id, serie: { format: serie.format, prefixe: serie.prefixe, remise: serie.remise }, prochain: { numero: prochain.numero, periode: prochain.periode }, chaine };
}

// Un code de caisse : 4 chiffres, ni répétés (0000, 1111…) ni qui se suivent (1234, 9876…), les premiers qu'on essaie.
export function codeTropSimple(code: string): boolean {
  const c = [...code].map(Number);
  const pas = c.slice(1).map((v, i) => v - (c[i] as number));
  return pas.every((p) => p === 0) || pas.every((p) => p === 1) || pas.every((p) => p === -1);
}
// Un code de caisse ou de responsable : 4 chiffres, pas les premiers qu'on essaie.
function verifierFormeDuCode(code: string) {
  if (!/^[0-9]{4}$/.test(code)) throw new Refus('caisse.code_forme');
  if (codeTropSimple(code)) throw new Refus('caisse.code_trop_simple', { valeurs: { code } });
}
// Une page de Z (brique 126).
const PAGE_Z = 20;
const sha256 = (texte: string) => createHash('sha256').update(texte, 'utf8').digest('hex');

export function routesCaisse(): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // L'état de la caisse : sa session ouverte (et si CET appareil la tient), et le dernier Z.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/caisse', geste: 'caisse.voir',
    traiter: async ({ params, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const { devise, decimales } = await deviseDe(tx, ent);
      const s = await sessionOuverte(tx, ent);
      const dernier = (await tx.query(`select z, fermee_le from caisse.session where entreprise = $1 and fermee_le is not null order by fermee_le desc limit 1`, [ent])).rows[0] as
        { z: unknown; fermee_le: Date } | undefined;
      // Les alertes de caisse (brique 120) : pour le propriétaire et l'administrateur, les plus récentes d'abord.
      const responsable = Boolean((await tx.query(`select socle.mes_roles($1) && array['proprietaire', 'administrateur'] r`, [ent])).rows[0]?.r);
      const alertes = responsable ? (await tx.query(`select nature, numero_poste "numeroPoste", numero_serie "numeroSerie", detail, cree_le "le"
        from caisse.alerte where entreprise = $1 order by cree_le desc limit 50`, [ent])).rows : [];
      // Changer de caissier (brique 123) : cet appareil est-il celui de la caisse (même fermée), et qui est au poste.
      const posteDeCaisse = qui.appareil ? Boolean((await tx.query('select 1 from caisse.caisse where entreprise = $1 and active and appareil = $2', [ent, qui.appareil])).rowCount) : false;
      const moi = String((await tx.query('select nom from socle.utilisateur where id = socle.moi()')).rows[0]?.nom ?? '');
      return { corps: { devise, decimales, posteDeCaisse, moi,
        session: s ? { id: s.id, fond: versTexte(BigInt(s.fond), decimales), ouverteLe: s.ouverte_le, qui: s.qui, appareil: s.appareil_nom, ici: s.appareil === qui.appareil } : null,
        dernierZ: dernier ? { ...(dernier.z as object), fermeeLe: dernier.fermee_le } : null,
        numerotation: s && s.appareil === qui.appareil ? await etatDeNumerotation(tx, ent) : null, alertes } };
    },
  });

  // Ouvrir : sur CET appareil, avec le fond de caisse. La caisse naît à la première ouverture.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/caisse/ouvrir', geste: 'caisse.session.ouvrir',
    corps: z.object({ fond: montant }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      if (!qui.appareil) throw new Refus('caisse.sans_appareil');
      const { decimales } = await deviseDe(tx, ent);
      const fond = lireMontant(corps.fond, decimales);
      const deja = await sessionOuverte(tx, ent);
      if (deja) {
        throw new Refus('caisse.deja_ouverte', { valeurs: { appareil: deja.appareil_nom, qui: deja.qui,
          depuis: deja.ouverte_le.toLocaleString('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } });
      }
      let caisse = (await tx.query(`select id from caisse.caisse where entreprise = $1 and active order by cree_le limit 1 for update`, [ent])).rows[0]?.id as string | undefined;
      if (!caisse) {
        caisse = String((await tx.query(`insert into caisse.caisse (entreprise, nom) values ($1, $2) returning id`, [ent, rendre(t('caisse.nom_par_defaut'), 'fr')])).rows[0].id);
      }
      await tx.query(`update caisse.caisse set appareil = $2 where id = $1`, [caisse, qui.appareil]);
      // Le nom du poste : l'appareil, si la personne le lit (le sien) ; sinon celui que la caisse lui connaît déjà (une
      // caissière qui a pris la caisse avec son code ne lit pas les appareils d'une autre personne, brique 123).
      const nom = String((await tx.query(`select coalesce((select nom from socle.appareil where id = $1),
        (select appareil_nom from caisse.session where entreprise = $2 and appareil = $1 order by ouverte_le desc limit 1), '—') nom`, [qui.appareil, ent])).rows[0].nom);
      const id = String((await tx.query(`insert into caisse.session (entreprise, caisse, appareil, appareil_nom, ouverte_par, fond) values ($1, $2, $3, $4, socle.moi(), $5) returning id`,
        [ent, caisse, qui.appareil, nom, fond.toString()])).rows[0].id);
      // La série des tickets existe dès l'ouverture (brique 120) : le poste connaît sa forme avant le premier ticket.
      await tx.query(`select ventes.serie_v10($1, 'facture', 'TIC')`, [ent]);
      await tracer(tx, ent, 'caisse.session.ouvrir', { type: 'session_caisse', id }, null, { fond: versTexte(fond, decimales) });
      return { corps: { id, fond: versTexte(fond, decimales), numerotation: await etatDeNumerotation(tx, ent) } };
    },
  });

  // Fermer : compter les espèces du tiroir ; le serveur dit ce qu'il devait contenir, l'écart, et fige le Z. Le détail du
  // comptage (la caisse tactile, 05/10/2026 : combien de billets et de pièces de chaque coupure) est facultatif ; donné, il
  // doit tomber sur le total compté, et le Z le garde.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/caisse/fermer', geste: 'caisse.session.fermer',
    corps: z.object({ compte: montant, comptage: z.array(z.object({ valeur: montant, nombre: z.number().int().min(1).max(99_999) })).max(30).optional() }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const { devise, decimales } = await deviseDe(tx, ent);
      const compte = lireMontant(corps.compte, decimales);
      const comptage = (corps.comptage ?? []).map((c) => {
        const valeur = lireMontant(c.valeur, decimales);
        return { valeur, nombre: c.nombre, total: valeur * BigInt(c.nombre) };
      });
      const somme = comptage.reduce((x, c) => x + c.total, 0n);
      if (comptage.length && somme !== compte) {
        // (Les montants s'y lisent comme à l'écran : 73,700.)
        throw new Refus('caisse.comptage_faux', { valeurs: { somme: versTexte(somme, decimales).replace('.', ','), compte: versTexte(compte, decimales).replace('.', ',') } });
      }
      const s = await sessionOuverte(tx, ent);
      if (!s) throw new Refus('caisse.pas_ouverte');
      const responsable = Boolean((await tx.query(`select socle.mes_roles($1) && array['proprietaire', 'administrateur'] r`, [ent])).rows[0]?.r);
      if (s.appareil !== qui.appareil && !responsable) throw new Refus('caisse.fermer_ailleurs', { valeurs: { appareil: s.appareil_nom } });
      await tx.query(`select 1 from caisse.session where id = $1 for update`, [s.id]);
      const fond = BigInt(s.fond);
      const z0 = await calculerZ(tx, s.id, fond);
      const texte = (n: bigint) => versTexte(n, decimales);
      // (Brique 126) Le Z dit aussi qui l'a fermé, et quand : relu ou imprimé plus tard, il se suffit.
      const fermeeLe = new Date();
      const fermePar = String((await tx.query('select nom from socle.utilisateur where id = socle.moi()')).rows[0]?.nom ?? '');
      const z = { devise, nombre: z0.nombre, premier: z0.premier, dernier: z0.dernier, total: texte(z0.total), tva: texte(z0.tva),
        parMode: Object.fromEntries(Object.entries(z0.parMode).map(([k, v]) => [k, texte(v)])),
        rendu: Object.fromEntries(Object.entries(z0.rendu).map(([k, v]) => [k, texte(v)])), retours: z0.retours,
        avoirs: z0.avoirs.map((a) => ({ numero: a.numero, ticket: a.ticket, montant: texte(a.montant) })),
        retoursTtc: texte(z0.retoursTtc), net: texte(z0.net), tvaNette: texte(z0.tvaNette),
        fond: texte(fond), attendu: texte(z0.attendu), compte: texte(compte), ecart: texte(compte - z0.attendu),
        ...(comptage.length ? { comptage: comptage.map((c) => ({ valeur: texte(c.valeur), nombre: c.nombre, total: texte(c.total) })) } : {}),
        ouverteLe: s.ouverte_le, ouvertePar: s.qui, appareil: s.appareil_nom, fermeeLe, fermePar };
      await tx.query(`update caisse.session set fermee_par = socle.moi(), fermee_le = $6, compte = $2, attendu = $3, ecart = $4, z = $5 where id = $1`,
        [s.id, compte.toString(), z0.attendu.toString(), (compte - z0.attendu).toString(), JSON.stringify(z), fermeeLe]);
      await tracer(tx, ent, 'caisse.session.fermer', { type: 'session_caisse', id: s.id }, null, { compte: z.compte, attendu: z.attendu, ecart: z.ecart, nombre: z.nombre });
      return { corps: { z } };
    },
  });

  // Les Z passés (brique 126 ; docs/caisse.md, Z1 à Z3), les plus récents d'abord, par pages de 20 (`avant` : l'instant de
  // fermeture du dernier Z lu). Le propriétaire et l'administrateur les lisent tous ; un autre membre, ceux des sessions
  // qu'il a ouvertes.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/caisse/z', geste: 'caisse.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      // L'instant de fermeture du dernier Z lu ; illisible, on repart du début.
      const avant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(query.avant ?? '') ? query.avant : null;
      const responsable = Boolean((await tx.query(`select socle.mes_roles($1) && array['proprietaire', 'administrateur'] r`, [ent])).rows[0]?.r);
      const lignes = (await tx.query(`select s.z, s.fermee_le, u.nom ferme_par from caisse.session s join socle.utilisateur u on u.id = s.fermee_par
         where s.entreprise = $1 and s.fermee_le is not null and ($2::timestamptz is null or s.fermee_le < $2)
           and ($3 or s.ouverte_par = socle.moi())
         order by s.fermee_le desc limit ${PAGE_Z + 1}`, [ent, avant, responsable])).rows as { z: Record<string, unknown>; fermee_le: Date; ferme_par: string }[];
      const page = lignes.slice(0, PAGE_Z);
      return { corps: { z: page.map((l) => ({ ...l.z, fermeeLe: l.fermee_le, fermePar: l.ferme_par })),
        suite: lignes.length > PAGE_Z ? page[page.length - 1]?.fermee_le.toISOString() ?? null : null } };
    },
  });

  // ── Changer de caissier (brique 123 ; 03 § 6 ; docs/caisse.md, R1 à R5) ──────────────────────────────────────────
  // Poser son code de caisse : la personne elle-même, caissier de l'entreprise. Il se garde en empreinte.
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/caisse/mon-code', geste: 'caisse.code.poser',
    corps: z.object({ code: z.string().trim().max(20) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      verifierFormeDuCode(corps.code);
      await tx.query('select caisse.poser_code($1, $2)', [ent, await empreinte(corps.code)]);
      await tracer(tx, ent, 'caisse.code.poser', { type: 'code_caisse', id: null }, null, null);
      return { corps: { ok: true } };
    },
  });

  // Les caissiers qui peuvent prendre la caisse sur ce poste : ceux qui ont posé leur code.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/caisse/caissiers', geste: 'caisse.relais',
    traiter: async ({ params, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const caissiers = (await tx.query('select utilisateur id, nom from caisse.caissiers($1)', [params.entreprise ?? ''])).rows as { id: string; nom: string }[];
      return { corps: { caissiers: caissiers.map((c) => ({ ...c, moi: c.id === qui.utilisateur })) } };
    },
  });

  // Le relais : sur l'appareil qui tient la caisse, un caissier tape son code ; la session du poste se ferme, la sienne
  // s'ouvre sur le même appareil (la caisse ne change pas de poste), fermée à cette entreprise. Une erreur compte : après
  // 5, une attente qui s'allonge, jamais un blocage. L'erreur s'écrit, la réponse n'est donc pas une exception.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/caisse/relais', geste: 'caisse.relais',
    corps: z.object({ utilisateur: z.uuid(), code: z.string().trim().max(20) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const poste = qui.appareil && !qui.posteDUnAutre
        ? (await tx.query('select 1 from caisse.caisse where entreprise = $1 and active and appareil = $2', [ent, qui.appareil])).rowCount : 0;
      if (!poste) throw new Refus('caisse.relais_pas_ce_poste');
      const maintenant = new Date();
      const cle = `caisse:${ent}:${corps.utilisateur}`;
      const attente = (await tx.query('select socle.attente_connexion($1, $2) a', [cle, maintenant])).rows[0].a as Date | null;
      if (attente) return { statut: 403, corps: { motif: attenteLisible(attente, maintenant), qui: [], bouton: null } };
      const e = (await tx.query('select caisse.code_pour_relais($1, $2, $3) e', [ent, corps.utilisateur, qui.appareil])).rows[0].e as string | null;
      if (!e) throw new Refus('caisse.relais_sans_code');
      if (!/^[0-9]{4}$/.test(corps.code) || !await correspond(e, corps.code)) {
        const a = (await tx.query('select socle.noter_erreur($1, $2) a', [cle, maintenant])).rows[0].a as Date | null;
        const moi = String((await tx.query('select nom from socle.utilisateur where id = socle.moi()')).rows[0]?.nom ?? '');
        return { statut: 403, corps: { motif: a ? attenteLisible(a, maintenant) : motif('caisse.relais_code_faux', { qui: moi }), qui: [], bouton: null } };
      }
      await tx.query('select socle.effacer_erreurs($1)', [cle]);
      const nom = String((await tx.query('select nom from socle.utilisateur where id = $1', [corps.utilisateur])).rows[0]?.nom ?? '');
      const jeton = randomBytes(32).toString('base64url');
      const session = String((await tx.query('select caisse.relayer($1, $2, $3, $4, $5) s', [ent, corps.utilisateur, qui.session, sha256(jeton), maintenant])).rows[0].s);
      await tracer(tx, ent, 'caisse.relais', { type: 'session', id: session }, null, { vers: nom });
      return { corps: { jeton, nom } };
    },
  });

  // ── Le retour, avec le code d'un responsable (brique 124 ; 03 § 2.1 ; docs/caisse.md, T1 à T5) ─────────────────
  // Poser son code de responsable : le propriétaire ou un administrateur, lui-même. Il n'ouvre aucune session : il
  // approuve un geste, sur l'appareil de la caisse.
  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/caisse/code-responsable', geste: 'caisse.code_responsable.poser',
    corps: z.object({ code: z.string().trim().max(20) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      verifierFormeDuCode(corps.code);
      await tx.query('select caisse.poser_code_responsable($1, $2)', [ent, await empreinte(corps.code)]);
      await tracer(tx, ent, 'caisse.code_responsable.poser', { type: 'code_responsable', id: null }, null, null);
      return { corps: { ok: true } };
    },
  });
  // Les responsables qui approuvent à la caisse : ceux qui ont posé leur code.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/caisse/responsables', geste: 'caisse.ticket.rendre',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      return { corps: { responsables: (await tx.query('select utilisateur id, nom from caisse.responsables($1)', [params.entreprise ?? ''])).rows } };
    },
  });
  routes.push(routeRetour(sessionOuverte));
  return routes;
}
