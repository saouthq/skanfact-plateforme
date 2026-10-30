// Le suivi d'une conversation au cabinet (1.178.0, base 0183 ; maquette « Messages », lot 3). Ce que le serveur garantit :
//   - la promesse du client (« je vous envoie tout vendredi ») fait passer la conversation de « À traiter » à « Attend le
//     client » ; un message du client après elle la rend caduque (« À traiter ») ; son jour passé sans rien, elle revient
//     seule dans « À traiter » (échue) ; un jour déjà passé est refusé ; elle se retire ;
//   - « Me le remontrer » sort la conversation de MON « À traiter » (« plus tard ») jusqu'au jour dit, pas de celui d'un
//     collègue ; un jour qui n'est pas à venir est refusé ;
//   - le suivi d'un dossier se lit d'un coup (notes, promesse tenue ou non, mon rappel, déclarations déposées) ;
//   - le client ne lit ni la promesse ni le rappel (sécurité par ligne).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { declarerGestesMessagerie } from '../../serveur/messagerie/gestes.ts';
import { routesMessagerie } from '../../serveur/messagerie/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.body ? r.json() : {} };
}
async function personne(nom: string) {
  const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
// Un jour de Tunis, décalé de `n` jours.
const jourDans = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
type Dossier = { entreprise: string; etat: string; promesse: { pour: string; quoi: string; par: string; echue: boolean } | null; rappel: string | null };

beforeAll(async () => {
  await admin.connect();
  declarerGestesCompta(); declarerGestesMessagerie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesMessagerie(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('le suivi d\'une conversation au cabinet', () => {
  it('la promesse du client et « Me le remontrer » : la boîte suit, le client n\'en lit rien', async () => {
    const anis = await personne('Anis Mrad');
    const cab = (await appeler('POST', '/cabinets', anis.jeton, { nom: 'Jlassi Conseil' })).corps;
    const cabinet = String(cab.id);
    const amel = await personne('Amel Ennour');
    const librairie = String((await appeler('POST', '/entreprises', amel.jeton, { raisonSociale: 'Librairie Ennour' })).corps.id);
    const mandat = String((await appeler('POST', `/entreprises/${librairie}/mandat`, amel.jeton, { codeCabinet: String(cab.code) })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, anis.jeton)).statut).toBe(200);
    // Rim, collègue à qui le dossier est confié aussi : son « À traiter » est le sien.
    const rim = await personne('Rim Ayari');
    const inv = await appeler('POST', `/cabinets/${cabinet}/invitations`, anis.jeton, { email: rim.email, role: 'revision' });
    expect((await appeler('POST', '/invitations/accepter', rim.jeton, { jeton: inv.corps.jeton })).statut).toBe(200);
    const eq = (await appeler('GET', `/cabinets/${cabinet}/equipe`, anis.jeton)).corps as { membres: { membre: string; nom: string }[] };
    const membreRim = String(eq.membres.find((m) => m.nom === 'Rim Ayari')?.membre);
    expect((await appeler('PUT', `/cabinets/${cabinet}/mandats/${mandat}/affectations/${membreRim}`, anis.jeton, { role: 'revision' })).statut).toBe(200);
    const boite = async (j: string) => ((await appeler('GET', `/cabinets/${cabinet}/messages`, j)).corps.dossiers as Dossier[]).find((d) => d.entreprise === librairie) as Dossier;

    // Amel écrit sa promesse : « À traiter ».
    expect((await appeler('POST', `/entreprises/${librairie}/messages`, amel.jeton, { cote: 'entreprise', texte: 'Je vous envoie tout vendredi, promis.' })).statut).toBe(201);
    expect((await boite(anis.jeton)).etat).toBe('a_traiter');
    // Un jour passé est refusé ; noter pour dans trois jours : « Attend le client », la promesse se lit.
    expect((await appeler('PUT', `/cabinets/${cabinet}/promesses/${librairie}`, anis.jeton, { pour: jourDans(-1), quoi: 'ses pièces de septembre' })).statut).toBe(400);
    const pour = jourDans(3);
    expect((await appeler('PUT', `/cabinets/${cabinet}/promesses/${librairie}`, anis.jeton, { pour, quoi: 'ses pièces de septembre' })).statut).toBe(200);
    const promis = await boite(anis.jeton);
    expect([promis.etat, promis.promesse]).toEqual(['attend_client', { pour, quoi: 'ses pièces de septembre', par: 'Anis Mrad', noteeLe: expect.any(String), echue: false }]);
    expect((await boite(rim.jeton)).etat).toBe('attend_client');
    const suivi = async (j: string) => (await appeler('GET', `/cabinets/${cabinet}/suivi/${librairie}`, j)).corps as { promesse: { tenue: boolean; echue: boolean; moi: boolean } | null; rappel: string | null; notes: unknown[]; jalons: unknown[] };
    expect((await suivi(anis.jeton)).promesse).toMatchObject({ tenue: false, echue: false, moi: true });
    expect((await suivi(rim.jeton)).promesse).toMatchObject({ moi: false });

    // Le jour promis passe sans rien : elle revient seule dans « À traiter », échue.
    await admin.query(`update cabinet.promesse set pour = $2 where entreprise = $1`, [librairie, jourDans(-1)]);
    const echue = await boite(anis.jeton);
    expect([echue.etat, echue.promesse?.echue]).toEqual(['a_traiter', true]);
    await admin.query(`update cabinet.promesse set pour = $2 where entreprise = $1`, [librairie, pour]);

    // Le client ne lit ni la promesse ni le rappel, même dans la table.
    const vues = await enTantQue(pool, amel.utilisateur, async (tx) => [
      (await tx.query('select count(*)::int n from cabinet.promesse where entreprise = $1', [librairie])).rows[0].n,
      (await tx.query('select count(*)::int n from cabinet.rappel where entreprise = $1', [librairie])).rows[0].n]);
    expect(vues).toEqual([0, 0]);
    expect((await appeler('PUT', `/cabinets/${cabinet}/promesses/${librairie}`, amel.jeton, { pour, quoi: 'rien' })).statut).toBe(404);

    // Amel écrit : la promesse ne compte plus (tenue), la conversation est « À traiter ».
    expect((await appeler('POST', `/entreprises/${librairie}/messages`, amel.jeton, { cote: 'entreprise', texte: 'Voilà, tout est parti.' })).statut).toBe(201);
    const tenue = await boite(anis.jeton);
    expect([tenue.etat, tenue.promesse]).toEqual(['a_traiter', null]);
    expect((await suivi(anis.jeton)).promesse).toMatchObject({ tenue: true });

    // « Me le remontrer demain » : plus tard pour Anis, toujours à traiter pour Rim ; un jour qui n'est pas à venir est refusé.
    expect((await appeler('PUT', `/cabinets/${cabinet}/rappels/${librairie}`, anis.jeton, { le: jourDans(0) })).statut).toBe(400);
    expect((await appeler('PUT', `/cabinets/${cabinet}/rappels/${librairie}`, anis.jeton, { le: jourDans(1) })).statut).toBe(200);
    expect([(await boite(anis.jeton)).etat, (await boite(anis.jeton)).rappel]).toEqual(['plus_tard', jourDans(1)]);
    expect((await boite(rim.jeton)).etat).toBe('a_traiter');
    expect((await suivi(anis.jeton)).rappel).toBe(jourDans(1));
    expect((await suivi(rim.jeton)).rappel).toBeNull();
    // Le rappel d'Anis est à lui : même dans la table, Rim ne le lit pas.
    expect((await enTantQue(pool, rim.utilisateur, (tx) => tx.query('select count(*)::int n from cabinet.rappel where entreprise = $1', [librairie]))).rows[0].n).toBe(0);
    const compteurs = (await appeler('GET', `/cabinets/${cabinet}/messages`, anis.jeton)).corps.compteurs as { aTraiter: number };
    expect(compteurs.aTraiter).toBe(0);
    // Son jour venu (le rappel passé), elle revient.
    await admin.query(`update cabinet.rappel set le = $2 where entreprise = $1`, [librairie, jourDans(0)]);
    expect((await boite(anis.jeton)).etat).toBe('a_traiter');
    // Retirer l'un et l'autre.
    expect((await appeler('DELETE', `/cabinets/${cabinet}/rappels/${librairie}`, anis.jeton)).statut).toBe(200);
    expect((await appeler('DELETE', `/cabinets/${cabinet}/promesses/${librairie}`, anis.jeton)).statut).toBe(200);
    expect((await suivi(anis.jeton)).promesse).toBeNull();
  });
});
