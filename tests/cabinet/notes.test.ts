// Les notes pour l'équipe dans la conversation d'un client (1.177.0, base 0182 ; maquette « Messages »). Ce que le serveur
// garantit :
//   - une note s'écrit et se relit au cabinet, avec son auteur (son nom, « moi » pour qui l'a écrite) et sa date, dans
//     l'ordre où elles ont été écrites ; vide ou trop longue, elle est refusée ;
//   - le client ne la lit jamais : ni la route du cabinet, ni la table (sécurité par ligne) ;
//   - un collaborateur à qui le dossier n'est pas confié ne la lit ni n'en écrit ; un autre cabinet non plus ;
//   - une note ne se change ni ne s'efface (la base n'en donne pas le droit).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
async function personne(nom: string) {
  const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Note = { id: string; auteur: string; moi: boolean; texte: string; ecritLe: string };

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCabinet(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les notes pour l\'équipe', () => {
  it('écrites et relues au cabinet, jamais par le client, ni par qui n\'a pas le dossier ; elles ne se changent pas', async () => {
    const leila = await personne('Leïla Jlassi');
    const cab = (await appeler('POST', '/cabinets', leila.jeton, { nom: 'Jlassi Conseil' })).corps;
    const cabinet = String(cab.id);
    const code = String(cab.code);
    // Le client : son entreprise, confiée au cabinet par son mandat.
    const sami = await personne('Sami Triki');
    const garage = String((await appeler('POST', '/entreprises', sami.jeton, { raisonSociale: 'Garage Triki' })).corps.id);
    const mandat = String((await appeler('POST', `/entreprises/${garage}/mandat`, sami.jeton, { codeCabinet: code })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila.jeton)).statut).toBe(200);
    // Rim, collaboratrice, à qui le dossier est confié ; Anis, collaborateur, à qui il ne l'est pas.
    const membre = async (nom: string) => {
      const p = await personne(nom);
      const inv = await appeler('POST', `/cabinets/${cabinet}/invitations`, leila.jeton, { email: p.email, role: 'revision' });
      expect((await appeler('POST', '/invitations/accepter', p.jeton, { jeton: inv.corps.jeton })).statut).toBe(200);
      const eq = (await appeler('GET', `/cabinets/${cabinet}/equipe`, leila.jeton)).corps as { membres: { membre: string; nom: string }[] };
      return { ...p, membre: String(eq.membres.find((m) => m.nom === nom)?.membre) };
    };
    const rim = await membre('Rim Ayari');
    const anis = await membre('Anis Mrad');
    expect((await appeler('PUT', `/cabinets/${cabinet}/mandats/${mandat}/affectations/${rim.membre}`, leila.jeton, { role: 'revision' })).statut).toBe(200);
    const chemin = `/cabinets/${cabinet}/notes/${garage}`;

    // Leïla écrit, puis Rim : chacune relit les deux, dans l'ordre, la sienne marquée « moi ».
    const texte = 'Rim, l\'avoir AV-2026-0031 arrive avec les achats d\'octobre : impute-le en octobre, pas en juillet.';
    const n1 = await appeler('POST', chemin, leila.jeton, { texte: `  ${texte}  ` });
    expect(n1.statut, JSON.stringify(n1.corps)).toBe(201);
    expect((await appeler('POST', chemin, rim.jeton, { texte: 'Vu, je le passe en octobre.' })).statut).toBe(201);
    const lues = (j: string) => appeler('GET', chemin, j).then((r) => r.corps.notes as Note[]);
    expect((await lues(leila.jeton)).map((n) => [n.auteur, n.moi, n.texte])).toEqual([['Leïla Jlassi', true, texte], ['Rim Ayari', false, 'Vu, je le passe en octobre.']]);
    expect((await lues(rim.jeton)).map((n) => [n.auteur, n.moi])).toEqual([['Leïla Jlassi', false], ['Rim Ayari', true]]);
    expect((await lues(leila.jeton)).every((n) => !Number.isNaN(Date.parse(n.ecritLe)))).toBe(true);

    // Vide ou trop longue : refusée.
    expect((await appeler('POST', chemin, leila.jeton, { texte: '   ' })).statut).toBe(400);
    expect((await appeler('POST', chemin, leila.jeton, { texte: 'x'.repeat(4001) })).statut).toBe(400);

    // Anis n'a pas le dossier : il ne lit rien, il n'écrit rien.
    expect((await lues(anis.jeton))).toEqual([]);
    expect((await appeler('POST', chemin, anis.jeton, { texte: 'Je passe par là.' })).statut).toBe(404);
    // Le client non plus : ni par la route du cabinet, ni dans la table.
    expect((await appeler('GET', chemin, sami.jeton)).corps.notes ?? []).toEqual([]);
    expect((await appeler('POST', chemin, sami.jeton, { texte: 'Je lis vos notes ?' })).statut).toBe(404);
    const vuesDuClient = await enTantQue(pool, sami.utilisateur, (tx) => tx.query('select count(*)::int n from cabinet.note where entreprise = $1', [garage]));
    expect(vuesDuClient.rows[0].n).toBe(0);
    // Un autre cabinet non plus.
    const autre = await personne('Mehdi Autre');
    const autreCab = String((await appeler('POST', '/cabinets', autre.jeton, { nom: 'Autre Conseil' })).corps.id);
    expect((await appeler('GET', `/cabinets/${autreCab}/notes/${garage}`, autre.jeton)).corps.notes ?? []).toEqual([]);
    expect((await appeler('GET', chemin, autre.jeton)).corps.notes ?? []).toEqual([]);

    // Une note ne se change ni ne s'efface, même pour qui l'a écrite.
    await expect(enTantQue(pool, leila.utilisateur, (tx) => tx.query('update cabinet.note set texte = $1 where entreprise = $2', ['changée', garage]))).rejects.toThrow();
    await expect(enTantQue(pool, leila.utilisateur, (tx) => tx.query('delete from cabinet.note where entreprise = $1', [garage]))).rejects.toThrow();
    expect((await lues(leila.jeton)).map((n) => n.texte)).toEqual([texte, 'Vu, je le passe en octobre.']);
  });
});
