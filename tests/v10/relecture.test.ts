// Relire le dossier par différence (brique 119 ; 0059 ; docs/leger.md, S4). Ce que le serveur garantit :
//   - une lecture rend sa marque et ce qu'elle suppose (cette base, ces rôles) ; donnée à la lecture suivante, seul ce
//     qui a changé depuis repart, et ce qui a été retiré ;
//   - une écriture encore en cours pendant une lecture n'est jamais perdue : elle repart à la lecture suivante ;
//   - une autre base, d'autres rôles, une marque « de l'avenir » : tout repart ;
//   - ce qu'un rôle ne voit pas ne repart pas plus par différence (ni ses objets, ni ses retraits) ;
//   - un numéro « de l'avenir » (une entreprise restaurée d'une autre base) n'entre pas dans une différence.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

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
type Lecture = { objets: Objet[]; retires?: { collection: string; cle: string }[]; partiel?: boolean; marque: string; profil: string };
let n = 0;
async function personne(prenom: string) {
  const email = `relecture-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('relire le dossier par différence', () => {
  it('seul ce qui a changé repart, et ce qui a été retiré ; une écriture en cours n\'est jamais perdue ; sinon tout repart', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const lire = async (jeton: string, depuis?: Lecture) =>
      (await appeler('GET', `/entreprises/${ent}/dossier-v10${depuis ? `?depuis=${depuis.marque}&profil=${encodeURIComponent(depuis.profil)}` : ''}`, jeton)).corps as unknown as Lecture;
    const ecrire = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    const cles = (l: Lecture) => l.objets.map((o) => `${o.collection}/${o.cle}`).sort();

    await lire(nadia.jeton); // l'amorce
    const l1 = await lire(nadia.jeton);
    expect(l1.partiel).toBeUndefined();
    expect(l1.marque).toMatch(/^\d+$/);
    const toutes = l1.objets.length;
    expect(toutes).toBeGreaterThan(0);

    // Rien n'a changé : rien ne repart.
    const l2 = await lire(nadia.jeton, l1);
    expect(l2).toMatchObject({ partiel: true, objets: [], retires: [] });

    // Un client noté : lui seul repart.
    expect((await ecrire(nadia.jeton, [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Café El Walima' } }])).statut).toBe(200);
    const l3 = await lire(nadia.jeton, l2);
    expect(l3.partiel).toBe(true);
    expect(cles(l3)).toEqual(['clients/c1']);
    expect(l3.objets[0]).toMatchObject({ revision: 1, contenu: { name: 'Café El Walima' } });

    // Retiré : la différence le dit ; recréé, il repart, et sa trace de retrait s'efface.
    expect((await ecrire(nadia.jeton, [{ collection: 'clients', cle: 'c1', rang: null, revision: 1, contenu: null }])).statut).toBe(200);
    const l4 = await lire(nadia.jeton, l3);
    expect(l4).toMatchObject({ partiel: true, objets: [], retires: [{ collection: 'clients', cle: 'c1' }] });
    expect((await ecrire(nadia.jeton, [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Café El Walima, Sfax' } }])).statut).toBe(200);
    const l5 = await lire(nadia.jeton, l4);
    expect(cles(l5)).toEqual(['clients/c1']);
    expect(l5.retires).toEqual([]);

    // Une écriture encore en cours pendant la lecture : la lecture ne la voit pas, la suivante la rend.
    await admin.query('begin');
    await admin.query(`update socle.dossier_v10 set contenu = jsonb_set(contenu, '{name}', '"Café El Walima, Sousse"') where entreprise = $1 and cle = 'c1'`, [ent]);
    const l6 = await lire(nadia.jeton, l5);
    expect(l6.objets.find((o) => o.cle === 'c1')?.contenu.name ?? 'pas relu').not.toBe('Café El Walima, Sousse');
    await admin.query('commit');
    const l7 = await lire(nadia.jeton, l6);
    expect(l7.objets.find((o) => o.cle === 'c1')?.contenu.name).toBe('Café El Walima, Sousse');

    // Une autre base, une marque « de l'avenir » : tout repart.
    const autreBase = { marque: l7.marque, profil: l7.profil.replace(/^[0-9a-f-]+/, '00000000-0000-0000-0000-000000000000') };
    expect((await lire(nadia.jeton, autreBase as Lecture)).objets.length).toBeGreaterThan(toutes);
    expect((await lire(nadia.jeton, { ...l7, marque: '99999999999' })).partiel).toBeUndefined();

    // D'autres rôles : Karim, commercial, ne complète pas une copie faite avec les rôles de Nadia, et sa différence ne
    // porte pas ce qu'il ne voit pas (la paie).
    const karim = await personne('Karim');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: karim.email, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', karim.jeton, { jeton: inv })).statut).toBe(200);
    expect((await lire(karim.jeton, l7)).partiel).toBeUndefined();
    const k1 = await lire(karim.jeton);
    expect((await ecrire(nadia.jeton, [
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Sami Trabelsi', salary: 1200 } },
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: { id: 'c2', name: 'Hôtel Dar Said' } },
    ])).statut).toBe(200);
    const k2 = await lire(karim.jeton, k1);
    expect(k2.partiel).toBe(true);
    expect(cles(k2)).toEqual(['clients/c2']);
    expect((await ecrire(nadia.jeton, [{ collection: 'employees', cle: 'e1', rang: null, revision: 1, contenu: null }])).statut).toBe(200);
    expect((await lire(karim.jeton, k2)).retires).toEqual([]);

    // Un numéro « de l'avenir » (une entreprise restaurée d'une autre base garde les siens) : lu en entier, jamais
    // dans une différence.
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`update socle.dossier_v10 set xid = '999999999999'::xid8 where entreprise = $1 and cle = 'c2'`, [ent]);
    await admin.query('commit');
    const l8 = await lire(nadia.jeton);
    expect(cles(l8)).toContain('clients/c2');
    expect(cles(await lire(nadia.jeton, l8))).toEqual([]);
  });

  it('sur un dossier de 1 500 pièces, rouvrir après une pièce de plus ne fait repartir qu\'elle', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Quincaillerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const piece = (i: number) => ({ collection: 'documents', cle: `d${i}`, rang: i, revision: null, contenu: { id: `d${i}`, type: 'devis', number: `DEV-2026-${String(i).padStart(4, '0')}`,
      status: 'brouillon', date: '2026-09-01', clientId: 'c1', createdAt: i,
      lines: [{ label: 'Visserie inox, boîte de 200', qty: 3, unit: 'u', unitPrice: { '~n': '12.35' }, vatRate: 19 }, { label: 'Perceuse à percussion 750 W', qty: 1, unit: 'u', unitPrice: { '~n': '189.9' }, vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, payments: [] } });
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton);
    for (let i = 0; i < 1_500; i += 500) {
      expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: Array.from({ length: 500 }, (_, j) => piece(i + j)) })).statut).toBe(200);
    }
    const lire = (q = '') => app.inject({ method: 'GET', url: `${VERSION}/entreprises/${ent}/dossier-v10${q}`, headers: { authorization: `Bearer ${nadia.jeton}` } });
    const entiere = await lire();
    const l = entiere.json() as Lecture;
    expect(l.objets.filter((o) => o.collection === 'documents')).toHaveLength(1_500);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [piece(1_500)] })).statut).toBe(200);
    const difference = await lire(`?depuis=${l.marque}&profil=${encodeURIComponent(l.profil)}`);
    expect((difference.json() as Lecture).objets.map((o) => o.cle)).toEqual(['d1500']);
    const fs = await import('node:fs');
    fs.mkdirSync(path.join(import.meta.dirname, '../../dist/mesures'), { recursive: true });
    fs.writeFileSync(path.join(import.meta.dirname, '../../dist/mesures/relecture-volume.txt'),
      `1 500 pièces : lecture entière ${entiere.rawPayload.length} octets ; différence après une pièce de plus ${difference.rawPayload.length} octets (avant compression)\n`);
    expect(difference.rawPayload.length).toBeLessThan(entiere.rawPayload.length / 100);
  });
});
