// Les commandes d'une boutique en ligne, facturées dans SkanFact (brique 131 ; docs/boutique.md). Ce que le serveur
// garantit :
//   - une commande payée devient une facture émise du dossier du commerçant (même jamais ouvert à l'écran), au client de
//     la commande, au millime du TTC payé, avec son paiement, et ses écritures (la vente et l'encaissement) ;
//   - un prix TTC redonne exactement son TTC ; quand aucun HT ne le peut, le millime qui manque va sur une ligne
//     « Arrondi » à 0 % ;
//   - la même commande renvoyée ne fait jamais une seconde facture ; le même client, d'une commande à l'autre, est un
//     seul client ;
//   - un total qui ne tombe pas juste n'émet rien et ne prend aucun numéro ;
//   - un paiement à la livraison s'ajoute plus tard, une seule fois ;
//   - un article reconnu à son code est celui du catalogue (le stock suit).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { cleDeCommande } from '../../serveur/v10/boutique.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
const dansUnAn = () => new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les commandes d\'une boutique en ligne', () => {
  it('une commande devient une facture payée, au millime, une seule fois ; ses écritures suivent', async () => {
    const email = `boutique-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Yasmine', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Yasmine Bijoux' })).corps.id);
    await appeler('POST', '/moi/code', jeton, { methode: 'application' });
    const creee = (await appeler('POST', `/entreprises/${ent}/cles-api`, jeton, { nom: 'Boutique SkanEcom', gestes: ['ventes.boutique.facturer', 'ventes.pieces.voir'], expireLe: dansUnAn() })).corps;
    const cle = String(creee.cle);
    const commander = (corps: unknown) => appeler('POST', `/entreprises/${ent}/commandes-en-ligne`, cle, corps);
    const amel = { nom: 'Amel Ben Salah', ref: 'C-77', email: 'amel@exemple.tn', telephone: '+216 22 000 111', adresse: 'Rue de Marseille, Tunis' };

    // Une commande payée en ligne : 29,900 + 3 × 12,500 + livraison 7,000 (TVA 7 %) + timbre 1,000 = 75,400.
    const c1 = {
      reference: 'SK-1001', date: '2026-10-01', client: amel, timbre: true,
      lignes: [
        { designation: 'Collier argent', quantite: '1', prixUnitaireTTC: '29.900', tauxTva: '19' },
        { designation: 'Bracelet', quantite: '3', prixUnitaireTTC: '12.500', tauxTva: '19' },
        { designation: 'Livraison', quantite: '1', prixUnitaireTTC: '7.000', tauxTva: '7' },
      ],
      paiement: { id: 'pay-1', mode: 'en_ligne', montant: '75.400', date: '2026-10-01', reference: 'KONNECT-55' },
    };
    const r1 = await commander(c1);
    expect(r1.statut).toBe(201);
    const f1 = r1.corps.facture as Record<string, unknown>;
    const amelId = String(r1.corps.client);
    expect(r1.corps).toEqual({ reference: 'SK-1001', deja: false, client: amelId,
      facture: { id: f1.id, numero: 'FAC-2026-001', date: '2026-10-01', netAPayer: '75.400', reste: '0.000', ecran: `/v10/?e=${ent}#/doc/${cleDeCommande('SK-1001')}` } });
    // La facture du dossier : les prix HT qui redonnent les TTC, le client de la commande, le paiement.
    const doc = (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2`, [ent, cleDeCommande('SK-1001')])).rows[0].contenu;
    expect(doc).toMatchObject({ number: 'FAC-2026-001', status: 'envoyée', reference: 'SK-1001', subject: 'Commande SK-1001', applyStamp: true,
      lines: [{ label: 'Collier argent', qty: 1, unitPrice: { '~n': '25.126' }, vatRate: 19 }, { label: 'Bracelet', qty: 3, unitPrice: { '~n': '10.504333' }, vatRate: 19 },
        { label: 'Livraison', qty: 1, unitPrice: { '~n': '6.542' }, vatRate: 7 }],
      payments: [{ amount: { '~n': '75.4' }, method: 'en_ligne', reference: 'KONNECT-55' }] });
    expect(doc.lines).toHaveLength(3);
    const client = (await admin.query(`select raison_sociale, email, telephone from socle.tiers where id = $1`, [amelId])).rows[0];
    expect(client).toEqual({ raison_sociale: 'Amel Ben Salah', email: 'amel@exemple.tn', telephone: '+216 22 000 111' });
    // Le dossier, jamais ouvert, est né avec la fiche de l'entreprise.
    expect((await admin.query(`select contenu->>'name' n from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'company'`, [ent])).rows).toEqual([{ n: 'Yasmine Bijoux' }]);
    // Ses écritures : la vente (équilibrée, au net à payer) et l'encaissement.
    const ecritures = (await admin.query(`select e.origine_type, sum(l.debit)::int d, sum(l.credit)::int c from compta.ecriture e join compta.ligne l on l.ecriture = e.id
      where e.entreprise = $1 group by e.origine_type order by e.origine_type`, [ent])).rows;
    expect(ecritures).toEqual([{ origine_type: 'encaissement', d: 75400, c: 75400 }, { origine_type: 'vente', d: 75400, c: 75400 }]);

    // La même commande renvoyée : la même facture, rien de plus (ni facture, ni paiement).
    const encore = await commander(c1);
    expect(encore).toMatchObject({ statut: 200, corps: { deja: true, facture: { numero: 'FAC-2026-001' } } });
    expect((await admin.query('select count(*)::int n from ventes.piece where entreprise = $1', [ent])).rows[0].n).toBe(1);
    expect((await admin.query('select count(*)::int n from ventes.reglement where entreprise = $1', [ent])).rows[0].n).toBe(1);

    // Un total qui ne tombe pas juste : rien n'est émis, aucun numéro n'est pris.
    const ecart = await commander({ reference: 'SK-1002', date: '2026-10-02', client: amel, timbre: false, totalAttendu: '10.000',
      lignes: [{ designation: 'Bague', quantite: '1', prixUnitaireTTC: '8.000', tauxTva: '19' }] });
    expect(ecart.statut).toBe(403);
    expect(String(ecart.corps.motif)).toBe('La facture ferait 8.000 et la commande 10.000 : rien n\'a été facturé, et aucun numéro n\'est pris. Vérifie les taux de TVA et le timbre de la commande.');
    expect((await admin.query('select count(*)::int n from ventes.piece where entreprise = $1', [ent])).rows[0].n).toBe(1);

    // À payer à la livraison, par la même cliente (avec une autre adresse : c'est sa référence qui compte) ; un prix
    // TTC impossible (1,005 à 19 %) : le millime qui manque va sur une ligne « Arrondi ». 1,005 + 8,000 = 9,005.
    const c3 = await commander({ reference: 'SK-1003', date: '2026-10-03', client: { ...amel, email: 'amel.bensalah@exemple.tn' }, timbre: false,
      lignes: [{ designation: 'Porte-clé', quantite: '1', prixUnitaireTTC: '1.005', tauxTva: '19' }, { designation: 'Bague', quantite: '1', prixUnitaireTTC: '8.000', tauxTva: '19' }] });
    expect(c3).toMatchObject({ statut: 201, corps: { client: amelId, facture: { numero: 'FAC-2026-002', netAPayer: '9.005', reste: '9.005' } } });
    const doc3 = (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and cle = $2`, [ent, cleDeCommande('SK-1003')])).rows[0].contenu;
    expect(doc3.lines.at(-1)).toEqual({ label: 'Arrondi', description: '', unit: '', qty: 1, unitPrice: { '~n': '0.001' }, vatRate: 0 });
    expect((await admin.query(`select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = 'clients'`, [ent])).rows[0].n).toBe(1);
    // Le livreur encaisse : le paiement s'ajoute, une seule fois.
    const payer = () => appeler('POST', `/entreprises/${ent}/commandes-en-ligne/SK-1003/paiements`, cle, { id: 'livraison-1', mode: 'especes', montant: '9.005', date: '2026-10-05' });
    expect((await payer()).corps).toMatchObject({ facture: { reste: '0.000' } });
    expect((await payer()).corps).toMatchObject({ facture: { reste: '0.000' } });
    expect((await admin.query(`select count(*)::int n from ventes.reglement r join ventes.piece p on p.id = r.piece where p.ref_v10 = $1`, [cleDeCommande('SK-1003')])).rows[0].n).toBe(1);
    expect((await appeler('GET', `/entreprises/${ent}/commandes-en-ligne/SK-1003`, cle)).corps).toMatchObject({ facture: { numero: 'FAC-2026-002', reste: '0.000' } });
    expect((await appeler('GET', `/entreprises/${ent}/commandes-en-ligne/SK-9999`, cle)).statut).toBe(404);
    expect((await appeler('POST', `/entreprises/${ent}/commandes-en-ligne/SK-9999/paiements`, cle, { id: 'x', mode: 'especes', montant: '1', date: '2026-10-05' })).statut).toBe(404);

    // Un autre client (sans référence : son e-mail) ; un article du catalogue reconnu à son code ; un prix HT.
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'catalog', cle: 'art-collier', rang: 0, revision: null, contenu: { id: 'art-collier', label: 'Collier argent 925', code: 'COL 925', unitPrice: 25, vatRate: 19, tracked: true } },
    ] })).statut).toBe(200);
    const c4 = await commander({ reference: 'SK-1004', date: '2026-10-04', client: { nom: 'Karim Jaziri', email: 'karim@exemple.tn' }, timbre: true,
      lignes: [{ designation: 'Collier argent', code: 'col925', quantite: '2', prixUnitaire: '25', tauxTva: '19' }] });
    // 2 × 25,000 = 50,000 HT ; TVA 9,500 ; timbre 1,000 : 60,500.
    expect(c4).toMatchObject({ statut: 201, corps: { facture: { numero: 'FAC-2026-003', netAPayer: '60.500' } } });
    expect(c4.corps.client).not.toBe(amelId);
    const doc4 = (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and cle = $2`, [ent, cleDeCommande('SK-1004')])).rows[0].contenu;
    expect(doc4.lines[0]).toMatchObject({ label: 'Collier argent', itemId: 'art-collier', qty: 2, unitPrice: 25 });
    // Le même client sans référence : son e-mail, quelle que soit la casse.
    const c6 = await commander({ reference: 'SK-1006', date: '2026-10-05', client: { nom: 'Karim Jaziri', email: 'KARIM@exemple.tn' }, timbre: false,
      lignes: [{ designation: 'Bague', quantite: '1', prixUnitaireTTC: '8.000', tauxTva: '19' }] });
    expect(c6).toMatchObject({ statut: 201, corps: { client: c4.corps.client } });
    // 1 015 × 0,019 TTC : aucun prix HT à six décimales ne redonne ce HT pour cette quantité ; rien n'est facturé.
    const quantite = await commander({ reference: 'SK-1007', date: '2026-10-05', client: amel, timbre: false,
      lignes: [{ designation: 'Perle', quantite: '1015', prixUnitaireTTC: '0.019', tauxTva: '19' }] });
    expect(quantite).toMatchObject({ statut: 403, corps: { motif: 'La ligne « Perle » : aucun prix HT à six décimales ne redonne son montant pour cette quantité ; envoie-la en plusieurs lignes.' } });

    // La série des factures, au nom d'une clé : seulement une clé qui vaut, de cette entreprise, avec un geste qui émet,
    // et jamais la série des tickets.
    const serie = (idCle: string, prefixe = 'FAC') => enTantQue(pool, null, async (tx) => (await tx.query(`select ventes.serie_v10($1, 'facture', $2) v`, [ent, prefixe])).rows[0].v, idCle);
    expect(await serie(String(creee.id))).toMatch(/^[0-9a-f-]{36}$/);
    await expect(serie(String(creee.id), 'TIC')).rejects.toThrow(/ton rôle ne permet pas/);
    const autreCle = async (gestes: string[]) => String((await appeler('POST', `/entreprises/${ent}/cles-api`, jeton, { nom: 'Autre', gestes, expireLe: dansUnAn() })).corps.id);
    await expect(serie(await autreCle(['ventes.pieces.voir']))).rejects.toThrow(/ton rôle ne permet pas/);
    expect(await serie(await autreCle(['ventes.facture.emettre']))).toMatch(/^[0-9a-f-]{36}$/);
    const revoquee = await autreCle(['ventes.boutique.facturer']);
    await admin.query('update socle.cle_api set revoquee_le = now() where id = $1', [revoquee]);
    await expect(serie(revoquee)).rejects.toThrow(/ton rôle ne permet pas/);
    const expiree = await autreCle(['ventes.boutique.facturer']);
    await admin.query(`update socle.cle_api set cree_le = now() - interval '2 days', expire_le = now() - interval '1 minute' where id = $1`, [expiree]);
    await expect(serie(expiree)).rejects.toThrow(/ton rôle ne permet pas/);

    // Une ligne avec deux prix, ou aucun : refusée ; une clé sans le geste : refusée.
    expect((await commander({ reference: 'SK-1005', date: '2026-10-04', client: amel, timbre: false,
      lignes: [{ designation: 'Bague', quantite: '1', prixUnitaire: '8', prixUnitaireTTC: '9.520', tauxTva: '19' }] })).statut).toBe(400);
    const lecture = String((await appeler('POST', `/entreprises/${ent}/cles-api`, jeton, { nom: 'Lecture', gestes: ['ventes.pieces.voir'], expireLe: dansUnAn() })).corps.cle);
    expect((await appeler('POST', `/entreprises/${ent}/commandes-en-ligne`, lecture, c1)).statut).toBe(403);
  });
});
