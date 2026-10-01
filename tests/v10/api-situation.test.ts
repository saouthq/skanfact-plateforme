// Ce que la console d'un partenaire lit de la facturation (brique 127 ; docs/api-situation.md, S1 à S5), par une clé de
// l'API qui ne fait que lire :
//   - les factures d'un client qui restent à payer, avec leur échéance, ce qu'elles doivent encore, et le lien de l'écran ;
//   - la situation d'un client en un appel : reste dû, dont échu, le plus vieux retard, le dernier règlement reçu ;
//   - un client retrouvé par son matricule (les espaces et la casse ne comptent pas) ;
//   - les mêmes chiffres que les écrans (deux chemins, un chiffre).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
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
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
let n = 0;
async function essai() {
  const email = `situation-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Situation ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const envoyer = (changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  return { jeton, ent, lire, envoyer };
}
// Un jour du calendrier à Tunis, compté depuis aujourd'hui (les échéances se comparent au jour où la console lit).
const jour = (decalage: number) => aujourdhuiATunis(new Date(Date.now() + decalage * 86_400_000));
// 2 × 450,500 ; TVA 19 % ; timbre 1,000 : 1 073,190.
const facture = (id: string, clientId: string, date: string, dueDate: string) => ({
  id, type: 'facture', number: '', date, dueDate, clientId, subject: 'Abonnement de la boutique', status: 'brouillon',
  lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
  discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
});

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la situation d\'un client, lue par une clé de l\'API', () => {
  it('les factures à payer, la situation, le client retrouvé par son matricule, les liens des écrans', async () => {
    const e = await essai();
    const objets = await e.lire();
    const menuiserie = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    const atelier = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Atelier'));
    if (!menuiserie || !atelier) throw new Error('clients d\'exemple absents');
    const fiche = { ...menuiserie.contenu, matricule: '1234567 a/M/000' };
    expect((await e.envoyer([{ collection: 'clients', cle: menuiserie.cle, rang: menuiserie.rang, revision: menuiserie.revision, contenu: fiche }])).statut).toBe(200);
    const clients = { [menuiserie.cle]: fiche, [atelier.cle]: atelier.contenu };

    // Émises dans l'ordre de leurs dates ; chacune garde sa révision pour qu'on y saisisse un règlement.
    const emises: Record<string, { contenu: Record<string, unknown>; revision: number; numero: string }> = {};
    const emettre = async (cle: string, client: string, date: string, echeance: string, autre: Record<string, unknown> = {}, netAPayer = '1073.190') => {
      const doc = { ...facture(cle, client, date, echeance), ...autre };
      await e.envoyer([{ collection: 'documents', cle, rang: 0, revision: null, contenu: doc }]);
      const r = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: doc, client: clients[client], revision: 1, rang: 0, netAPayer });
      if (r.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(r.corps)}`);
      emises[cle] = { contenu: r.corps.contenu as Record<string, unknown>, revision: Number(r.corps.revision), numero: String(r.corps.numero) };
    };
    const payer = async (cle: string, payments: unknown[]) => {
      const f = emises[cle];
      if (!f) throw new Error(`${cle} n'est pas émise`);
      const r = await e.envoyer([{ collection: 'documents', cle, rang: 0, revision: f.revision, contenu: { ...f.contenu, payments } }]);
      expect(r.statut).toBe(200);
    };
    // f3 est émise après f1, mais à plus court terme : c'est elle, la plus vieille échéance.
    await emettre('f1', menuiserie.cle, jour(-60), jour(-5));
    await emettre('f2', menuiserie.cle, jour(-50), jour(-40));
    await emettre('f5', atelier.cle, jour(-30), jour(-15));
    await emettre('f3', menuiserie.cle, jour(-20), jour(-45));
    // f4 arrive à échéance aujourd'hui : elle n'est pas encore échue.
    await emettre('f4', menuiserie.cle, jour(-2), jour(0));
    // f6, en euros : elle ne s'additionne pas aux dinars.
    await emettre('f6', menuiserie.cle, jour(-1), jour(30), { currency: 'EUR', exchangeRate: { '~n': '3.4' }, applyStamp: false, stampFee: 0,
      lines: [{ label: 'Hébergement', description: '', qty: 1, unit: '', unitPrice: { '~n': '100' }, vatRate: 0 }] }, '100.00');
    // f1 : 300,000 reçus il y a dix jours (il reste 773,190) ; f2 : réglée en deux fois, la dernière le même jour, saisie après.
    await payer('f1', [{ id: 'p1', date: jour(-10), amount: 300, method: 'virement' }]);
    await payer('f2', [{ id: 'p2', date: jour(-35), amount: { '~n': '73.19' }, method: 'especes' }, { id: 'p3', date: jour(-10), amount: 1000, method: 'cheque' }]);
    // L'Atelier, lui, a payé hier : ce n'est pas un règlement de la Menuiserie.
    await payer('f5', [{ id: 'p5', date: jour(-1), amount: 50, method: 'especes' }]);

    // La console lit avec une clé qui ne fait que lire.
    const cle = String((await appeler('POST', `/entreprises/${e.ent}/cles-api`, e.jeton, { nom: 'Console de la boutique', gestes: ['ventes.pieces.voir'], expireLe: jour(90) })).corps.cle);
    expect(cle).toMatch(/^skf_/);
    const ecran = (vue: string, ref: string) => `/v10/?e=${e.ent}#/${vue}/${ref}`;

    // S1. Retrouver le client par son matricule, tel qu'on le tape (espaces, minuscules).
    const trouves = await appeler('GET', `/entreprises/${e.ent}/clients?identifiant=${encodeURIComponent('1234567A/m/000 ')}`, cle);
    expect(trouves.statut).toBe(200);
    const liste = trouves.corps.clients as Record<string, unknown>[];
    expect(liste).toHaveLength(1);
    const id = String(liste[0]?.id);
    expect(liste[0]).toMatchObject({ raison_sociale: expect.stringMatching(/^Menuiserie du Lac/), identifiant: '1234567 a/M/000', ecran: ecran('client', menuiserie.cle) });
    expect((await appeler('GET', `/entreprises/${e.ent}/clients?identifiant=7654321B`, cle)).corps.clients).toEqual([]);

    // Un brouillon du client, déjà chiffré (ce que les écrans de demain pourraient garder) : il ne doit rien.
    const proprietaire = (await admin.query('select utilisateur from socle.membre where entreprise = $1', [e.ent])).rows[0].utilisateur;
    await admin.query(`insert into ventes.piece (entreprise, type, tiers, date_piece, echeance, net_a_payer, cree_par) values ($1, 'facture', $2, $3, $4, 5000, $5)`,
      [e.ent, id, jour(0), jour(-1), proprietaire]);

    // S2. Ses factures qui restent à payer, les plus récentes d'abord, avec leur échéance et leur reste.
    const aPayer = await appeler('GET', `/entreprises/${e.ent}/ventes?type=facture&client=${id}&aPayer=1`, cle);
    expect(aPayer.statut).toBe(200);
    const lignes = aPayer.corps.lignes as Record<string, unknown>[];
    expect(lignes.map((l) => [l.numero, l.echeance, l.devise, l.netAPayer, l.reste, l.clientId, l.ecran])).toEqual([
      [emises.f6?.numero, jour(30), 'EUR', '100.00', '100.00', id, ecran('doc', 'f6')],
      [emises.f4?.numero, jour(0), 'TND', '1073.190', '1073.190', id, ecran('doc', 'f4')],
      [emises.f3?.numero, jour(-45), 'TND', '1073.190', '1073.190', id, ecran('doc', 'f3')],
      [emises.f1?.numero, jour(-5), 'TND', '1073.190', '773.190', id, ecran('doc', 'f1')],
    ]);
    expect(aPayer.corps).toMatchObject({ suite: null, total: null });
    // Par pages de deux : la deuxième passe par-dessus f2, réglée.
    const page = async (avant?: unknown) => (await appeler('GET', `/entreprises/${e.ent}/ventes?type=facture&client=${id}&aPayer=1&limite=2${avant ? `&avant=${encodeURIComponent(String(avant))}` : ''}`, cle)).corps;
    const p1 = await page();
    expect((p1.lignes as Record<string, unknown>[]).map((l) => l.numero)).toEqual([emises.f6?.numero, emises.f4?.numero]);
    const p2 = await page(p1.suite);
    expect((p2.lignes as Record<string, unknown>[]).map((l) => l.numero)).toEqual([emises.f3?.numero, emises.f1?.numero]);
    expect(await page(p2.suite)).toMatchObject({ lignes: [], suite: null });
    // Sans « à payer » : toutes ses factures, le brouillon compris (pas celle de l'Atelier), et leur nombre.
    const toutes = await appeler('GET', `/entreprises/${e.ent}/ventes?type=facture&client=${id}`, cle);
    expect((toutes.corps.lignes as Record<string, unknown>[]).map((l) => l.numero)).toEqual([null, ...['f6', 'f4', 'f3', 'f2', 'f1'].map((f) => emises[f]?.numero)]);
    expect(toutes.corps.total).toBe(6);
    // Ce que la liste dit d'une facture est ce que dit sa lecture.
    const f1 = lignes.find((l) => l.numero === emises.f1?.numero);
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes/${String(f1?.id)}`, cle)).corps.suivi).toMatchObject({ reste: '773.190' });
    // Un filtre qui n'a pas de sens est refusé, et dit pourquoi.
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes?type=devis&aPayer=1`, cle))).toMatchObject({ statut: 400, corps: { champ: 'aPayer' } });
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes?client=menuiserie`, cle))).toMatchObject({ statut: 400, corps: { champ: 'client' } });

    // S3. La situation en un appel.
    const situation = await appeler('GET', `/entreprises/${e.ent}/clients/${id}/situation`, cle);
    expect(situation).toEqual({ statut: 200, corps: {
      client: { id, raisonSociale: expect.stringMatching(/^Menuiserie du Lac/), identifiant: '1234567 a/M/000', ecran: ecran('client', menuiserie.cle) },
      au: jour(0),
      soldes: [
        { devise: 'TND', reste: '2919.570', echu: '1846.380', facturesAPayer: 3, facturesEchues: 2 },
        { devise: 'EUR', reste: '100.00', echu: '0.00', facturesAPayer: 1, facturesEchues: 0 },
      ],
      retard: { depuis: jour(-45), jours: 45, numero: emises.f3?.numero, ecran: ecran('doc', 'f3') },
      dernierReglement: { date: jour(-10), montant: '1000.000', devise: 'TND', facture: emises.f2?.numero },
    } });
    // Deux chemins, un chiffre : le reste dû en dinars est la somme des restes en dinars de la liste.
    expect(lignes.filter((l) => l.devise === 'TND').reduce((s, l) => s + Math.round(Number(l.reste) * 1000), 0)).toBe(2_919_570);

    // Un client né hors des écrans, sans facture : pas de lien d'écran ; rien de dû, ni retard, ni règlement.
    const neuf = (await admin.query(`insert into socle.tiers (entreprise, nature, raison_sociale, pays, roles) values ($1, 'societe', 'Venu par l''API', 'TN', '{client}') returning id`, [e.ent])).rows[0].id;
    expect((await appeler('GET', `/entreprises/${e.ent}/clients/${neuf}/situation`, cle)).corps)
      .toMatchObject({ client: { raisonSociale: 'Venu par l\'API', ecran: null }, soldes: [], retard: null, dernierReglement: null });
    // Ce qui n'est pas un client de cette entreprise n'existe pas.
    const autre = await essai();
    const etranger = (await autre.lire()).find((o) => o.collection === 'clients')?.cle;
    for (const x of [etranger, '00000000-0000-4000-8000-000000000000', 'menuiserie']) {
      expect((await appeler('GET', `/entreprises/${e.ent}/clients/${x}/situation`, cle)).statut).toBe(404);
    }
    const fournisseur = (await admin.query(`insert into socle.tiers (entreprise, nature, raison_sociale, pays, roles) values ($1, 'societe', 'Bois du Nord', 'TN', '{fournisseur}') returning id`, [e.ent])).rows[0].id;
    expect((await appeler('GET', `/entreprises/${e.ent}/clients/${fournisseur}/situation`, cle)).statut).toBe(404);
  });
});
