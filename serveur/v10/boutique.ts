// Les commandes d'une boutique en ligne, facturées dans SkanFact (brique 131 ; docs/boutique.md). Le commerçant d'une
// boutique SkanEcom tient sa facturation et sa comptabilité dans SkanFact : chaque commande payée (ou à payer à la
// livraison) devient une FACTURE de son dossier, émise par le serveur avec son numéro, au client de la commande, avec
// ses lignes (l'article du catalogue s'il est reconnu à son code : le stock suit) et son paiement. Les écritures et
// les avis suivent comme pour toute facture. Une commande renvoyée (la réponse perdue en route) ne fait jamais une
// seconde facture.
//
// Les prix d'une boutique sont TTC ; une facture part du HT. Pour chaque ligne, le serveur retrouve le HT (six
// décimales) qui redonne EXACTEMENT son TTC avec la TVA arrondie ligne par ligne (moteur/piece.ts). Quand aucun HT ne
// le peut (le TTC tombe entre deux marches de la TVA arrondie), il manque un millime : il va sur une ligne « Arrondi »
// à 0 %, et la facture fait le total payé, au millime (À VÉRIFIER avec un comptable).

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { depuisTexte, diviserArrondi, versTexte } from '../../moteur/argent.ts';
import { motif, rendre, t } from '../../textes/index.ts';
import type { Route } from '../app.ts';
import { requetes, type Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import { soldesDeFactures } from '../ventes/reglements.ts';
import { lienEcran } from '../ventes/situation.ts';
import { appliquer, dossierPret, emettreDepuisV10 } from './dossier.ts';
import { enNombreV10, type Json } from './lecture.ts';

const MILLION = 1_000_000n;
const decimal = (decimales: number) => z.string().regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${decimales}})?$`));
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MODES = ['carte', 'en_ligne', 'especes', 'virement', 'cheque', 'autre'] as const;
const paiement = z.object({ id: z.string().trim().min(1).max(60), mode: z.enum(MODES), montant: decimal(3), date: jour, reference: z.string().max(200).optional() });
const ligne = z.object({
  designation: z.string().trim().min(1).max(300), code: z.string().trim().max(60).optional(), quantite: decimal(3), tauxTva: decimal(4),
  prixUnitaireTTC: decimal(3).optional(), prixUnitaire: decimal(6).optional(),
}).refine((l) => (l.prixUnitaireTTC === undefined) !== (l.prixUnitaire === undefined), { message: 'boutique.un_prix', path: ['prixUnitaireTTC'] });
const commande = z.object({
  reference: z.string().trim().min(1).max(60),
  date: jour,
  client: z.object({
    nom: z.string().trim().min(1).max(300), ref: z.string().trim().max(60).optional(), email: z.string().email().optional(),
    telephone: z.string().max(40).optional(), adresse: z.string().max(1000).optional(), matricule: z.string().trim().max(40).optional(),
  }),
  lignes: z.array(ligne).min(1).max(200),
  timbre: z.boolean(),
  paiement: paiement.optional(),
  totalAttendu: decimal(3).optional(),
});
type Commande = z.infer<typeof commande>;

const empreinte = (texte: string) => createHash('sha256').update(texte, 'utf8').digest('hex');
// La clé de la facture d'une commande, et celle de son client, dans le dossier : la même commande, la même facture.
export const cleDeCommande = (reference: string) => `cmd-${empreinte(reference).slice(0, 24)}`;
const cleDuClient = (c: Commande['client']) => `boutique-${empreinte(c.ref ? `ref:${c.ref}` : c.email ? `email:${c.email.toLowerCase()}` : `nom:${c.nom}`).slice(0, 24)}`;

// Le HT (en millimes) qui redonne ce TTC avec la TVA de la ligne arrondie au millime, ou le plus grand qui reste
// en dessous (il manque alors un millime).
export function htDuTtc(ttc: bigint, taux4: bigint): { ht: bigint; manque: bigint } {
  const avecTva = (h: bigint) => h + diviserArrondi(h * taux4, MILLION);
  const h0 = diviserArrondi(ttc * MILLION, MILLION + taux4);
  let meilleur = 0n;
  for (let h = h0 - 3n; h <= h0 + 3n; h++) {
    if (h < 0n) continue;
    if (avecTva(h) === ttc) return { ht: h, manque: 0n };
    if (avecTva(h) < ttc && h > meilleur) meilleur = h;
  }
  return { ht: meilleur, manque: ttc - avecTva(meilleur) };
}

// Les lignes de la facture (au format de la v10), et le total TTC que la boutique a annoncé (s'il est tout en TTC).
export function lignesDeFacture(lignes: Commande['lignes'], catalogue: Map<string, string>) {
  let arrondi = 0n;
  let ttcTotal: bigint | null = 0n;
  const v10: Json[] = lignes.map((l) => {
    const q3 = depuisTexte(l.quantite, 3);
    const code = (l.code ?? '').replace(/\s+/g, '').toUpperCase();
    const article = code ? catalogue.get(code) : undefined;
    const base = { label: l.designation, description: '', unit: '', qty: enNombreV10(l.quantite), vatRate: enNombreV10(l.tauxTva), ...(article ? { itemId: article } : {}) };
    if (l.prixUnitaire !== undefined) { ttcTotal = null; return { ...base, unitPrice: enNombreV10(l.prixUnitaire) }; }
    // Le TTC de la ligne : la quantité fois le prix TTC, au millime.
    const ttc = diviserArrondi(q3 * depuisTexte(l.prixUnitaireTTC ?? '0', 3), 1000n);
    if (ttcTotal !== null) ttcTotal += ttc;
    const { ht, manque } = htDuTtc(ttc, depuisTexte(l.tauxTva, 4));
    arrondi += manque;
    // Le prix unitaire HT (six décimales) dont la quantité redonne ce HT au millime.
    const p6 = q3 === 0n ? 0n : diviserArrondi(ht * MILLION, q3);
    if (diviserArrondi(q3 * p6, MILLION) !== ht) throw new Refus('boutique.quantite', { valeurs: { designation: l.designation } });
    return { ...base, unitPrice: enNombreV10(versTexte(p6, 6)) };
  });
  if (arrondi > 0n) v10.push({ label: rendre(t('boutique.ligne_arrondi'), 'fr'), description: '', unit: '', qty: 1, unitPrice: enNombreV10(versTexte(arrondi * 1000n, 6)), vatRate: 0 });
  return { lignes: v10, ttcTotal: ttcTotal as bigint | null, arrondi };
}

const lire = async (tx: Transaction, entreprise: string, collection: string, cle: string) =>
  (await tx.query('select contenu, revision, rang from socle.dossier_v10 where entreprise = $1 and collection = $2 and cle = $3', [entreprise, collection, cle])).rows[0] as
    { contenu: Json; revision: string; rang: number | null } | undefined;

// Ce que l'API rend d'une commande facturée.
async function resultat(tx: Transaction, entreprise: string, reference: string, deja: boolean) {
  const cle = cleDeCommande(reference);
  const p = await requetes(tx).selectFrom('ventes.piece as p').innerJoin('socle.devise as d', 'd.code', 'p.devise')
    .select(['p.id', 'p.numero_texte', 'p.date_piece', 'p.net_a_payer', 'p.tiers', 'd.decimales'])
    .where('p.entreprise', '=', entreprise).where('p.ref_v10', '=', cle).where('p.statut', '=', 'emise').executeTakeFirst();
  if (!p) return null;
  const reste = (await soldesDeFactures(tx, entreprise, [{ id: p.id, net: p.net_a_payer ?? 0n }])).get(p.id)?.reste ?? 0n;
  return {
    reference, deja, client: p.tiers,
    facture: { id: p.id, numero: p.numero_texte, date: p.date_piece, netAPayer: versTexte(p.net_a_payer ?? 0n, p.decimales), reste: versTexte(reste, p.decimales), ecran: lienEcran(entreprise, 'doc', cle) },
  };
}

// Un paiement de la commande s'ajoute à sa facture (une seule fois : son identifiant le dit).
async function ajouterPaiement(tx: Transaction, entreprise: string, utilisateur: string, cle: string, p: z.infer<typeof paiement>) {
  const doc = await lire(tx, entreprise, 'documents', cle);
  if (!doc) return;
  const id = `cmd-pay-${empreinte(`${cle}/${p.id}`).slice(0, 24)}`;
  const paiements = Array.isArray(doc.contenu.payments) ? doc.contenu.payments as Json[] : [];
  if (paiements.some((x) => x.id === id)) return;
  await appliquer(tx, entreprise, utilisateur, [{ collection: 'documents', cle, rang: doc.rang, revision: Number(doc.revision), contenu: {
    ...doc.contenu, payments: [...paiements, { id, date: p.date, amount: enNombreV10(p.montant), method: p.mode, reference: p.reference ?? '', accountId: '', note: rendre(t('boutique.note_paiement'), 'fr') }],
  } }], { serveur: true });
}

export function routesBoutique(): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/commandes-en-ligne', geste: 'ventes.boutique.facturer', corps: commande,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      // Déjà facturée : la même réponse (la boutique a renvoyé la commande).
      const deja = await resultat(tx, ent, corps.reference, true);
      if (deja) return { corps: deja };
      await dossierPret(tx, ent, qui.utilisateur);

      // Le client de la commande : le même d'une commande à l'autre (sa référence chez la boutique, son e-mail, ou son nom).
      const clientCle = cleDuClient(corps.client);
      let client = (await lire(tx, ent, 'clients', clientCle))?.contenu;
      if (!client) {
        const { n } = await requetes(tx).selectFrom('socle.dossier_v10').select((eb) => eb.fn.countAll<string>().as('n'))
          .where('entreprise', '=', ent).where('collection', '=', 'clients').executeTakeFirstOrThrow();
        client = { id: clientCle, name: corps.client.nom, matricule: corps.client.matricule ?? '', address: corps.client.adresse ?? '', email: corps.client.email ?? '',
          phone: corps.client.telephone ?? '', currency: '' };
        await appliquer(tx, ent, qui.utilisateur, [{ collection: 'clients', cle: clientCle, rang: Number(n), revision: null, contenu: client }], { serveur: true });
      }

      // Les articles du catalogue, par leur code (comme la douchette de la caisse).
      const catalogue = new Map((await tx.query(`select cle, upper(regexp_replace(contenu->>'code', '[[:space:]]', '', 'g')) code from socle.dossier_v10
        where entreprise = $1 and collection = 'catalog' and coalesce(contenu->>'code', '') <> ''`, [ent])).rows.map((r) => [r.code as string, r.cle as string]));
      const { lignes, ttcTotal } = lignesDeFacture(corps.lignes, catalogue);
      const cle = cleDeCommande(corps.reference);
      const doc = {
        id: cle, type: 'facture', number: '', status: 'brouillon', date: corps.date, dueDate: corps.date, clientId: clientCle, subject: `Commande ${corps.reference}`,
        reference: corps.reference, lines: lignes, discountRate: 0, applyStamp: corps.timbre, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
        boutique: { reference: corps.reference }, createdAt: Date.now(),
      };
      await appliquer(tx, ent, qui.utilisateur, [{ collection: 'documents', cle, rang: null, revision: null, contenu: doc }], { serveur: true });
      await emettreDepuisV10(tx, ent, qui.utilisateur, { document: doc, client, revision: 1, rang: null, netAPayer: null });
      // Deux chemins, un chiffre : le total de la facture est celui que la boutique a annoncé (ou fait payer). Sinon
      // rien n'est émis, et aucun numéro n'est pris (tout s'annule).
      const net = (await resultat(tx, ent, corps.reference, false))?.facture.netAPayer ?? '';
      const timbre = corps.timbre ? 1000n : 0n;
      const attendu = corps.totalAttendu ?? (ttcTotal !== null ? versTexte(ttcTotal + timbre, 3) : null);
      if (attendu !== null && attendu !== net) throw new Refus('boutique.ecart', { valeurs: { attendu, serveur: net } });
      if (corps.paiement) await ajouterPaiement(tx, ent, qui.utilisateur, cle, corps.paiement);
      return { statut: 201, corps: await resultat(tx, ent, corps.reference, false) };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/commandes-en-ligne/:reference', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await resultat(tx, params.entreprise ?? '', params.reference ?? '', true);
      return r ? { corps: r } : { statut: 404, corps: { motif: motif('commun.introuvable') } };
    },
  });

  // Un paiement plus tard (à la livraison, en plusieurs fois) : il s'ajoute à la facture de la commande.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/commandes-en-ligne/:reference/paiements', geste: 'ventes.boutique.facturer', corps: paiement,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      if (!(await resultat(tx, ent, params.reference ?? '', true))) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await ajouterPaiement(tx, ent, qui.utilisateur, cleDeCommande(params.reference ?? ''), corps);
      return { corps: await resultat(tx, ent, params.reference ?? '', true) };
    },
  });
  return routes;
}
