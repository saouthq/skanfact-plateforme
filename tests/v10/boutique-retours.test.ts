// Le retour d'une commande d'une boutique en ligne (brique 132 ; docs/boutique.md, B4). Ce que le serveur garantit :
//   - un retour est un AVOIR émis sur la facture de la commande, avec son numéro (toute la commande, ou les lignes
//     rendues, au millime de leur TTC) ; l'article reconnu revient au stock ;
//   - l'argent rendu au client s'enregistre sur la facture (un règlement négatif, comme la v10), jamais plus que ce que
//     le client a payé au-delà de ce qu'il doit ; ses écritures suivent ;
//   - le même retour renvoyé ne fait jamais un second avoir ni un second remboursement ;
//   - on ne rend jamais plus que la commande : rien n'est émis, aucun numéro n'est pris.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { cleDeCommande, cleDuRetour } from '../../serveur/v10/boutique.ts';
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

describe('le retour d\'une commande en ligne', () => {
  it('un retour est un avoir de la facture, l\'argent rendu un règlement négatif, une seule fois, jamais plus que la commande', async () => {
    const email = `retours-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Yasmine', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Yasmine Bijoux' })).corps.id);
    await appeler('POST', '/moi/code', jeton, { methode: 'application' });
    const cle = String((await appeler('POST', `/entreprises/${ent}/cles-api`, jeton, { nom: 'Boutique SkanEcom', gestes: ['ventes.boutique.facturer', 'ventes.pieces.voir'], expireLe: dansUnAn() })).corps.cle);
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'catalog', cle: 'art-collier', rang: 0, revision: null, contenu: { id: 'art-collier', label: 'Collier argent 925', code: 'COL925', unitPrice: 25, vatRate: 19, tracked: true, initialQty: 10 } },
    ] })).statut).toBe(200);
    const amel = { nom: 'Amel Ben Salah', ref: 'C-77', email: 'amel@exemple.tn' };
    // 2 colliers à 29,900 + bracelet 12,500 + livraison 7,000 + timbre 1,000 = 80,300, payés en ligne.
    const r = await appeler('POST', `/entreprises/${ent}/commandes-en-ligne`, cle, {
      reference: 'SK-2001', date: '2026-10-01', client: amel, timbre: true,
      lignes: [
        { designation: 'Collier argent', code: 'COL925', quantite: '2', prixUnitaireTTC: '29.900', tauxTva: '19' },
        { designation: 'Bracelet', quantite: '1', prixUnitaireTTC: '12.500', tauxTva: '19' },
        { designation: 'Livraison', quantite: '1', prixUnitaireTTC: '7.000', tauxTva: '7' },
      ],
      paiement: { id: 'pay-1', mode: 'en_ligne', montant: '80.300', date: '2026-10-01' },
    });
    expect(r).toMatchObject({ statut: 201, corps: { facture: { netAPayer: '80.300', reste: '0.000' } } });
    const retourner = (ref: string, corps: unknown) => appeler('POST', `/entreprises/${ent}/commandes-en-ligne/${ref}/retours`, cle, corps);

    // La cliente renvoie un collier : un avoir de 29,900, remboursé en ligne.
    const un = { id: 'ret-1', date: '2026-10-04', motif: 'Taille', timbre: false,
      lignes: [{ designation: 'Collier argent', code: 'COL925', quantite: '1', prixUnitaireTTC: '29.900', tauxTva: '19' }],
      remboursement: { mode: 'en_ligne', montant: '29.900', reference: 'KONNECT-R-9' } };
    const r1 = await retourner('SK-2001', un);
    expect(r1.statut).toBe(201);
    const avoir = (r1.corps.retour as Record<string, unknown>).avoir as Record<string, unknown>;
    expect(r1.corps).toMatchObject({ reference: 'SK-2001', facture: { netAPayer: '80.300', reste: '0.000' },
      retour: { id: 'ret-1', deja: false, avoir: { numero: 'AVO-2026-001', date: '2026-10-04', montant: '29.900', ecran: `/v10/?e=${ent}#/doc/${cleDuRetour('SK-2001', 'ret-1')}` }, rembourse: '29.900' } });
    expect(avoir.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r1.corps.deja).toBeUndefined();
    const doc = (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2`, [ent, cleDuRetour('SK-2001', 'ret-1')])).rows[0].contenu;
    expect(doc).toMatchObject({ type: 'avoir', status: 'émis', number: 'AVO-2026-001', creditOf: cleDeCommande('SK-2001'), creditOfNumber: 'FAC-2026-001', creditReason: 'Taille',
      subject: 'Retour de la commande SK-2001 (ret-1)', applyStamp: false,
      lines: [{ label: 'Collier argent', itemId: 'art-collier', qty: 1, vatRate: 19 }] });
    // L'argent rendu : un règlement négatif sur la facture (comme la v10), et ses écritures (D client / C banque).
    const facture = (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2`, [ent, cleDeCommande('SK-2001')])).rows[0].contenu;
    expect(facture.payments).toHaveLength(2);
    expect(facture.payments[1]).toMatchObject({ amount: { '~n': '-29.9' }, method: 'en_ligne', reference: 'KONNECT-R-9', date: '2026-10-04' });
    const ecritures = (await admin.query(`select e.origine_type, sum(l.debit)::int d, sum(l.credit)::int c from compta.ecriture e join compta.ligne l on l.ecriture = e.id
      where e.entreprise = $1 group by e.origine_type order by e.origine_type`, [ent])).rows;
    // La vente et son avoir (80,300 + 29,900), l'encaissement et le remboursement (80,300 + 29,900).
    expect(ecritures).toEqual([{ origine_type: 'encaissement', d: 110200, c: 110200 }, { origine_type: 'vente', d: 110200, c: 110200 }]);
    const sorties = (await admin.query(`select sum(l.credit - l.debit)::int net from compta.ecriture e join compta.ligne l on l.ecriture = e.id
      where e.entreprise = $1 and e.origine_type = 'encaissement' and l.compte like '5%'`, [ent])).rows[0].net;
    expect(sorties).toBe(29900 - 80300);

    // Le même retour renvoyé : le même avoir, aucun second remboursement.
    const encore = await retourner('SK-2001', un);
    expect(encore).toMatchObject({ statut: 200, corps: { retour: { deja: true, avoir: { numero: 'AVO-2026-001' } }, facture: { reste: '0.000' } } });
    expect((await admin.query(`select count(*)::int n from ventes.piece where entreprise = $1 and type = 'avoir'`, [ent])).rows[0].n).toBe(1);
    expect((await admin.query(`select count(*)::int n from ventes.reglement where entreprise = $1`, [ent])).rows[0].n).toBe(2);

    // Rendre plus que ce que la cliente a payé en trop : rien n'est émis, aucun numéro n'est pris.
    const trop = await retourner('SK-2001', { id: 'ret-2', date: '2026-10-05', timbre: false,
      lignes: [{ designation: 'Bracelet', quantite: '1', prixUnitaireTTC: '12.500', tauxTva: '19' }],
      remboursement: { mode: 'en_ligne', montant: '20.000' } });
    expect(trop).toMatchObject({ statut: 403, corps: { motif: 'Le client n\'a payé que 12.500 de plus que ce qu\'il doit : on ne lui rend pas 20.000. Rien n\'a été enregistré.' } });
    expect((await admin.query(`select count(*)::int n from ventes.piece where entreprise = $1 and type = 'avoir'`, [ent])).rows[0].n).toBe(1);
    // Rendre plus que la commande : refusé, rien n'est émis.
    const plus = await retourner('SK-2001', { id: 'ret-3', date: '2026-10-05', timbre: false,
      lignes: [{ designation: 'Collier argent', quantite: '2', prixUnitaireTTC: '29.900', tauxTva: '19' }] });
    expect(plus).toMatchObject({ statut: 403, corps: { motif: 'Ce retour ferait 59.800 alors qu\'il ne reste que 50.400 de la commande à rendre : rien n\'a été enregistré.' } });
    // Toute la commande, une fois qu'une partie est déjà rendue : il faut dire les lignes.
    expect(await retourner('SK-2001', { id: 'ret-4', date: '2026-10-05', timbre: false })).toMatchObject({ statut: 409 });
    expect((await admin.query(`select count(*)::int n from ventes.piece where entreprise = $1 and type = 'avoir'`, [ent])).rows[0].n).toBe(1);
    // Le remboursement plus tard : le même retour, renvoyé avec l'argent rendu cette fois.
    const deux = { id: 'ret-2', date: '2026-10-05', timbre: false, lignes: [{ designation: 'Bracelet', quantite: '1', prixUnitaireTTC: '12.500', tauxTva: '19' }] };
    expect(await retourner('SK-2001', deux)).toMatchObject({ statut: 201, corps: { facture: { reste: '-12.500' }, retour: { avoir: { numero: 'AVO-2026-002', montant: '12.500' }, rembourse: '0.000' } } });
    expect(await retourner('SK-2001', { ...deux, remboursement: { mode: 'especes', montant: '12.500' } }))
      .toMatchObject({ statut: 200, corps: { facture: { reste: '0.000' }, retour: { deja: true, rembourse: '12.500' } } });

    // Une commande à payer à la livraison, refusée par le client : toute la commande, timbre compris. La facture est
    // soldée sans argent rendu.
    const cod = await appeler('POST', `/entreprises/${ent}/commandes-en-ligne`, cle, { reference: 'SK-2002', date: '2026-10-02', client: amel, timbre: true,
      lignes: [{ designation: 'Porte-clé', quantite: '1', prixUnitaireTTC: '1.005', tauxTva: '19' }, { designation: 'Bague', quantite: '1', prixUnitaireTTC: '8.000', tauxTva: '19' }] });
    expect(cod).toMatchObject({ statut: 201, corps: { facture: { netAPayer: '10.005' } } });
    const refus = await retourner('SK-2002', { id: 'refusee', date: '2026-10-06', motif: 'Refusée à la livraison', timbre: true });
    expect(refus).toMatchObject({ statut: 201, corps: { facture: { reste: '0.000' }, retour: { avoir: { numero: 'AVO-2026-003', montant: '10.005' }, rembourse: '0.000' } } });
    // Le timbre ne se rend qu'une fois, et seulement s'il a été payé. 3,000 + 2 × 5,000 + timbre = 14,000.
    const commander = (reference: string, timbre: boolean) => appeler('POST', `/entreprises/${ent}/commandes-en-ligne`, cle, { reference, date: '2026-10-02', client: amel, timbre,
      lignes: [{ designation: 'Bougie', quantite: '1', prixUnitaireTTC: '3.000', tauxTva: '19' }, { designation: 'Savon', quantite: '2', prixUnitaireTTC: '5.000', tauxTva: '19' }] });
    expect(await commander('SK-2005', true)).toMatchObject({ statut: 201, corps: { facture: { netAPayer: '14.000' } } });
    const bougie = { designation: 'Bougie', quantite: '1', prixUnitaireTTC: '3.000', tauxTva: '19' };
    const savon = { designation: 'Savon', quantite: '1', prixUnitaireTTC: '5.000', tauxTva: '19' };
    expect(await retourner('SK-2005', { id: 'a', date: '2026-10-06', timbre: true, lignes: [bougie] })).toMatchObject({ statut: 201, corps: { retour: { avoir: { montant: '4.000' } } } });
    expect(await retourner('SK-2005', { id: 'b', date: '2026-10-06', timbre: true, lignes: [savon] }))
      .toMatchObject({ statut: 403, corps: { motif: 'Le timbre de cette commande n\'est pas à rendre : sa facture n\'en a pas, ou un autre retour l\'a déjà rendu.' } });
    expect(await retourner('SK-2005', { id: 'b', date: '2026-10-06', timbre: false, lignes: [savon] })).toMatchObject({ statut: 201, corps: { retour: { avoir: { montant: '5.000' } } } });
    expect(await commander('SK-2006', false)).toMatchObject({ statut: 201, corps: { facture: { netAPayer: '13.000' } } });
    expect(await retourner('SK-2006', { id: 'a', date: '2026-10-06', timbre: true, lignes: [bougie] }))
      .toMatchObject({ statut: 403, corps: { motif: 'Le timbre de cette commande n\'est pas à rendre : sa facture n\'en a pas, ou un autre retour l\'a déjà rendu.' } });
    // Deux chemins, un chiffre : le total annoncé par la boutique doit être celui de l'avoir.
    expect(await retourner('SK-2006', { id: 'a', date: '2026-10-06', timbre: false, lignes: [bougie], totalAttendu: '3.500' }))
      .toMatchObject({ statut: 403, corps: { motif: 'L\'avoir ferait 3.000 et le retour 3.500 : rien n\'a été enregistré, et aucun numéro n\'est pris. Vérifie les taux de TVA et le timbre du retour.' } });
    expect((await admin.query(`select count(*)::int n from ventes.piece where entreprise = $1 and type = 'avoir'`, [ent])).rows[0].n).toBe(5);
    // Un montant de zéro ne se paie ni ne se rend.
    expect((await appeler('POST', `/entreprises/${ent}/commandes-en-ligne/SK-2006/paiements`, cle, { id: 'z', mode: 'especes', montant: '0.000', date: '2026-10-06' })).statut).toBe(400);

    // Une commande inconnue : 404. Une clé sans le geste : 403.
    expect((await retourner('SK-9999', un)).statut).toBe(404);
    const lecture = String((await appeler('POST', `/entreprises/${ent}/cles-api`, jeton, { nom: 'Lecture', gestes: ['ventes.pieces.voir'], expireLe: dansUnAn() })).corps.cle);
    expect((await appeler('POST', `/entreprises/${ent}/commandes-en-ligne/SK-2001/retours`, lecture, { ...un, id: 'autre' })).statut).toBe(403);
  });
});
