// Les contrats d'abonnement par l'API (brique 130 ; docs/api-situation.md, S8). Ce que le serveur garantit :
//   - une clé crée un contrat pour un client créé par l'API, dans une entreprise que personne n'a encore ouverte à
//     l'écran : le dossier naît (avec la fiche de l'entreprise), le client y entre une fois, avec l'identifiant de sa
//     fiche (pas de double) ;
//   - « émis seul », ses factures partent par le serveur, au nom de ce client ;
//   - il se lit (tous, ou ceux d'un client), se modifie (ce qui a été facturé reste), se suspend et se reprend (sans
//     facturer les échéances passées pendant la suspension) ;
//   - un commercial n'en fait pas un contrat émis seul ; ce qui n'est pas un client, ou pas un contrat, est refusé.

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
import { echeanceSuivante, emettreLesContrats } from '../../serveur/v10/contrats.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `api-contrats-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
const dansUnAn = () => new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);

const entreprises: string[] = [];
const plusSeuls = (filtre: string, valeurs: unknown[]) => admin.query(`update socle.dossier_v10 set contenu = contenu - 'emettreSeul' where collection = 'recurring' ${filtre}`, valeurs);
beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  // Le tour des contrats parcourt toute la base : ceux des autres tests n'y sont plus émis seuls.
  await plusSeuls('', []);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await plusSeuls('and entreprise = any($1)', [entreprises]); await app.close(); await admin.end(); await pool.end(); });

describe('les contrats d\'abonnement par l\'API', () => {
  it('une clé crée, lit, modifie, suspend et reprend un contrat ; émis seul, ses factures partent par le serveur', async () => {
    const nadia = await personne('nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'SkanEcom SARL' })).corps.id);
    entreprises.push(ent);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const cle = String((await appeler('POST', `/entreprises/${ent}/cles-api`, nadia.jeton, { nom: 'Console SkanEcom',
      gestes: ['ventes.client.modifier', 'ventes.contrat.modifier', 'ventes.pieces.voir'], expireLe: dansUnAn() })).corps.cle);
    // Personne n'a ouvert le dossier : il est vide.
    expect((await admin.query('select count(*)::int n from socle.dossier_v10 where entreprise = $1', [ent])).rows[0].n).toBe(0);
    const boutique = String((await appeler('POST', `/entreprises/${ent}/clients`, cle, { raisonSociale: 'Boutique Yasmine', email: 'yasmine@exemple.tn' })).corps.id);

    const contrat = (plus: Record<string, unknown> = {}) => ({
      client: boutique, objet: 'Abonnement de la boutique — {mois}', periode: 'mois', prochaine: '2026-10-05',
      lignes: [{ designation: 'Hébergement', quantite: '1', prixUnitaire: '89.5', tauxTva: '19', unite: 'mois' }], emettreSeul: true, ...plus,
    });
    const cree = await appeler('POST', `/entreprises/${ent}/contrats`, cle, contrat());
    expect(cree.statut).toBe(201);
    const id = String(cree.corps.id);
    expect(cree.corps).toEqual({ id, client: boutique, objet: 'Abonnement de la boutique — {mois}', periode: 'mois', jour: 5, prochaine: '2026-10-05', derniere: null,
      actif: true, emettreSeul: true, refus: null, lignes: [{ designation: 'Hébergement', quantite: '1', prixUnitaire: '89.5', tauxTva: '19' }], ecran: `/v10/?e=${ent}#/contrat/${id}` });
    // Le dossier est né, avec la fiche de l'entreprise ; la boutique y est entrée, sous l'identifiant de sa fiche.
    const dossier = (await admin.query('select collection, cle, contenu from socle.dossier_v10 where entreprise = $1 order by collection collate "C", cle', [ent])).rows;
    expect(dossier.map((d) => d.collection)).toEqual(['_racine', 'clients', 'recurring']);
    expect(dossier[0].contenu).toMatchObject({ name: 'SkanEcom SARL' });
    expect(dossier[1]).toMatchObject({ cle: boutique, contenu: { id: boutique, name: 'Boutique Yasmine', email: 'yasmine@exemple.tn' } });
    expect(dossier[2].contenu).toMatchObject({ id, clientId: boutique, every: 'month', day: 5, nextDate: '2026-10-05', active: true, emettreSeul: true,
      lines: [{ label: 'Hébergement', qty: 1, unitPrice: { '~n': '89.5' }, vatRate: 19, unit: 'mois' }] });
    // Un second contrat de la même boutique ne la fait pas entrer deux fois.
    expect((await appeler('POST', `/entreprises/${ent}/contrats`, cle, contrat({ periode: 'annee', emettreSeul: false }))).statut).toBe(201);
    expect((await admin.query(`select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = 'clients'`, [ent])).rows[0].n).toBe(1);

    // Le serveur émet la facture d'octobre, au nom de la boutique (sa fiche, pas une nouvelle) : 89,500 + 17,005 + 1.
    expect(await emettreLesContrats(ctx, new Date('2026-10-06T08:00:00Z'))).toMatchObject({ emises: 1 });
    expect((await admin.query('select numero_texte, tiers, net_a_payer, objet from ventes.piece where entreprise = $1', [ent])).rows)
      .toEqual([{ numero_texte: 'FAC-2026-001', tiers: boutique, net_a_payer: 107505n, objet: 'Abonnement de la boutique — octobre 2026' }]);
    expect((await admin.query(`select count(*)::int n from socle.tiers where entreprise = $1 and 'client' = any(roles)`, [ent])).rows[0].n).toBe(1);

    // Lire : tous, ou ceux d'un client ; un contrat né à l'écran se lit aussi.
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: 'recurring', cle: 'ecran-1', rang: 9, revision: null, contenu: { id: 'ecran-1', clientId: boutique, subject: 'Maintenance', every: 'quarter', day: 1, nextDate: '2027-01-01', active: true,
        lines: [{ label: 'Maintenance', qty: 1, unitPrice: 30, vatRate: 19 }] } },
    ] })).statut).toBe(200);
    const tous = (await appeler('GET', `/entreprises/${ent}/contrats`, cle)).corps.contrats as Record<string, unknown>[];
    expect(tous.map((c) => [c.periode, c.prochaine, c.derniere])).toEqual([['mois', '2026-11-05', '2026-10-05'], ['annee', '2026-10-05', null], ['trimestre', '2027-01-01', null]]);
    const autre = String((await appeler('POST', `/entreprises/${ent}/clients`, cle, { raisonSociale: 'Boutique Karim' })).corps.id);
    expect((await appeler('GET', `/entreprises/${ent}/contrats?client=${autre}`, cle)).corps.contrats).toEqual([]);
    // Un client créé après la naissance du dossier y entre à son premier contrat, une seule fois.
    for (let i = 0; i < 2; i++) expect((await appeler('POST', `/entreprises/${ent}/contrats`, cle, contrat({ client: autre, emettreSeul: false }))).statut).toBe(201);
    expect((await admin.query(`select cle from socle.dossier_v10 where entreprise = $1 and collection = 'clients' order by cle`, [ent])).rows.map((r) => r.cle)).toEqual([boutique, autre].sort());
    expect((await admin.query('select ref_v10 from socle.tiers where id = $1', [autre])).rows).toEqual([{ ref_v10: autre }]);
    expect(((await appeler('GET', `/entreprises/${ent}/contrats?client=${autre}`, cle)).corps.contrats as unknown[]).length).toBe(2);
    expect(((await appeler('GET', `/entreprises/${ent}/contrats?client=${boutique}`, cle)).corps.contrats as unknown[]).length).toBe(3);

    // Modifier : le nouveau prix ; ce qui a été facturé reste ; un refus noté s'efface.
    await admin.query(`update socle.dossier_v10 set contenu = contenu || '{"refusServeur": {"le": "2026-10-06", "echeance": "2026-11-05", "motif": "essai"}}' where entreprise = $1 and cle = $2`, [ent, id]);
    const modifie = await appeler('PUT', `/entreprises/${ent}/contrats/${id}`, cle, contrat({ prochaine: '2026-11-05', lignes: [{ designation: 'Hébergement', quantite: '1', prixUnitaire: '99', tauxTva: '19' }] }));
    expect(modifie.corps).toMatchObject({ prochaine: '2026-11-05', derniere: '2026-10-05', refus: null, lignes: [{ prixUnitaire: '99' }] });

    // Suspendre, puis reprendre : la prochaine date est la première qui n'est pas passée (rien n'est rattrapé).
    expect((await appeler('PUT', `/entreprises/${ent}/contrats/${id}`, cle, contrat({ prochaine: '2026-01-05' }))).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/contrats/${id}/suspendre`, cle)).corps).toMatchObject({ actif: false, prochaine: '2026-01-05' });
    const auj = aujourdhuiATunis();
    let attendue = '2026-01-05';
    while (attendue < auj) attendue = echeanceSuivante(attendue, 'month', 5);
    expect((await appeler('POST', `/entreprises/${ent}/contrats/${id}/reprendre`, cle)).corps).toMatchObject({ actif: true, prochaine: attendue });

    // Les refus : un fournisseur, un contrat qui n'existe pas, une clé sans le geste, un commercial qui coche « émis seul ».
    const fournisseur = (await admin.query(`insert into socle.tiers (entreprise, nature, raison_sociale, pays, roles) values ($1, 'societe', 'Bois du Nord', 'TN', '{fournisseur}') returning id`, [ent])).rows[0].id;
    expect(await appeler('POST', `/entreprises/${ent}/contrats`, cle, contrat({ client: fournisseur }))).toMatchObject({ statut: 400, corps: { champ: 'client' } });
    expect((await appeler('PUT', `/entreprises/${ent}/contrats/inconnu`, cle, contrat())).statut).toBe(404);
    expect((await appeler('POST', `/entreprises/${ent}/contrats/inconnu/suspendre`, cle)).statut).toBe(404);
    const lecture = String((await appeler('POST', `/entreprises/${ent}/cles-api`, nadia.jeton, { nom: 'Lecture', gestes: ['ventes.pieces.voir'], expireLe: dansUnAn() })).corps.cle);
    expect((await appeler('POST', `/entreprises/${ent}/contrats`, lecture, contrat())).statut).toBe(403);
    const sami = await personne('sami');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: sami.email, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', sami.jeton, { jeton: inv })).statut).toBe(200);
    const refus = await appeler('POST', `/entreprises/${ent}/contrats`, sami.jeton, contrat());
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif)).toContain('se fait par le propriétaire ou un administrateur');
    expect((await appeler('POST', `/entreprises/${ent}/contrats`, sami.jeton, contrat({ emettreSeul: false }))).statut).toBe(201);
  });
});
