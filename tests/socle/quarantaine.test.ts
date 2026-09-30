// La quarantaine (brique 74 bis ; docs/hors-ligne.md, H10 ; 04 § 7), par l'API et dans la base. Ce
// que le serveur garantit :
//   - un appareil retiré remet, par son jeton, ce qui attendait le réseau : reçu, JAMAIS appliqué
//     d'office ; une seule remise par session (la renvoyer ne double rien) ; seule une session encore
//     ouverte au retrait remet, et seulement dans une entreprise dont la personne est membre ; un
//     jeton valable n'y remet rien ;
//   - l'entrée dit à l'appareil combien de ses changements sont mis de côté ;
//   - le propriétaire voit la remise (qui, quel appareil, quoi) et décide : accepter applique chaque
//     changement comme s'il arrivait maintenant, avec la révision que l'appareil avait vue ; ce qui a
//     changé depuis est mis de côté et dit, la version du serveur gardée ; rejeter n'applique rien ;
//     une remise ne se décide qu'une fois, et ne se réécrit jamais ;
//   - une personne retirée de l'équipe (brique 76) remet aussi, par sa session valable ; encore membre,
//     jamais membre, ou session fermée : rien.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
// Une personne, son entreprise (le dossier amorcé, un client), et une session par appareil, avec le code.
async function nadia() {
  const email = `quarantaine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
  const premier = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
  const secret = /secret=([A-Z2-7]+)/.exec(String((await appeler('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
  const ent = String((await appeler('POST', '/entreprises', premier, { raisonSociale: 'Épicerie Nadia' })).corps.id);
  const session = async (nom: string) => {
    const r = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom, type: 'navigateur' } });
    const c = await appeler('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) });
    return { jeton: String(c.corps.jeton), appareil: String(c.corps.appareil ?? r.corps.appareil) };
  };
  const bureau = await session('PC du bureau');
  await appeler('GET', `/entreprises/${ent}/dossier-v10`, bureau.jeton);
  await appeler('POST', `/entreprises/${ent}/dossier-v10`, bureau.jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Boulangerie du Lac' } }] });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { ent, bureau, session, utilisateur };
}
type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
const client = async (ent: string, jeton: string, cle: string) =>
  ((await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === 'clients' && o.cle === cle);

describe('la quarantaine', () => {
  it('remis par l\'appareil retiré, jamais appliqué d\'office ; accepté, ce qui a changé depuis est mis de côté et dit', async () => {
    const { ent, bureau, session } = await nadia();
    const portable = await session('Portable perdu');
    const rev = (await client(ent, portable.jeton, 'c1'))?.revision ?? 0;
    // Ce que le portable avait fait hors ligne : un client créé, c1 renommé (sur la révision vue), un
    // réglage, et une facture qui se dit émise sans être passée par le serveur (ce qu'il refuse).
    const changements = [
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: { id: 'c2', name: 'Café des Arts' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: rev, contenu: { id: 'c1', name: 'Boulangerie du Lac (portable)' } },
      { collection: '_racine', cle: 'reglage', rang: null, revision: null, contenu: { vu: 1 } },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', type: 'facture', number: 'F-2026-0001', status: 'envoyée', clientId: 'c2' } },
    ];
    // Un jeton valable n'y remet rien.
    expect((await appeler('POST', '/quarantaine', portable.jeton, { entreprise: ent, changements })).statut).toBe(401);
    // Pendant ce temps, au bureau, c1 change.
    await appeler('POST', `/entreprises/${ent}/dossier-v10`, bureau.jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: rev, contenu: { id: 'c1', name: 'Boulangerie du Lac (bureau)' } }] });
    expect((await appeler('DELETE', `/moi/appareils/${portable.appareil}`, bureau.jeton)).statut).toBe(200);

    // Le portable remet ; le renvoyer ne double rien.
    expect(await appeler('POST', '/quarantaine', portable.jeton, { entreprise: ent, changements })).toEqual({ statut: 200, corps: { recus: 3 } });
    expect((await appeler('POST', '/quarantaine', portable.jeton, { entreprise: ent, changements })).statut).toBe(200);
    // Reçu, pas appliqué.
    expect(await client(ent, bureau.jeton, 'c2')).toBe(undefined);
    // L'entrée le dit à l'appareil.
    expect((await appeler('GET', '/moi', portable.jeton)).corps).toEqual({
      motif: 'Cet appareil a été retiré de ton compte : ce qu\'il gardait pour travailler sans réseau est effacé, et tes 3 changements faits hors ligne sont mis de côté au serveur, où le propriétaire de l\'entreprise les acceptera ou les rejettera ; reconnecte-toi pour continuer.',
      bouton: 'connexion', effacer: true,
    });

    // Le propriétaire la voit : qui, depuis quel appareil, quoi.
    const remises = (await appeler('GET', `/entreprises/${ent}/quarantaine`, bureau.jeton)).corps.remises as { id: string; appareil: string; utilisateur: string; changements: unknown[] }[];
    expect(remises.map((r) => [r.appareil, r.utilisateur, r.changements.length])).toEqual([['Portable perdu', 'Nadia', 4]]);
    const id = remises[0]?.id ?? '';

    // Accepter : c2 et le réglage s'appliquent (seul c2 se compte : c'est ce que la personne a fait) ;
    // c1, changé depuis, et la facture, refusée, sont mis de côté et dits ; le reste s'applique quand même.
    const d = await appeler('POST', `/entreprises/${ent}/quarantaine/${id}`, bureau.jeton, { accepter: true });
    expect(d).toEqual({ statut: 200, corps: { appliques: 1, misDeCote: [
      { collection: 'clients', cle: 'c1', raison: 'Elle a changé depuis sur le serveur : la version du serveur est gardée, celle de l\'appareil reste avec la remise.' },
      { collection: 'documents', cle: 'd1', raison: 'Une facture ou un avoir ne s\'émet qu\'avec le bouton « Émettre » : c\'est le serveur qui lui donne son numéro.' },
    ] } });
    expect(await appeler('GET', `/entreprises/${ent}/dossier-v10`, bureau.jeton).then((r) => (r.corps.objets as Objet[]).some((o) => o.collection === 'documents'))).toBe(false);
    expect((await client(ent, bureau.jeton, 'c2'))?.contenu.name).toBe('Café des Arts');
    expect((await client(ent, bureau.jeton, 'c1'))?.contenu.name).toBe('Boulangerie du Lac (bureau)');
    expect(((await appeler('GET', `/entreprises/${ent}/dossier-v10`, bureau.jeton)).corps.objets as Objet[]).find((o) => o.cle === 'reglage')?.contenu).toEqual({ vu: 1 });
    // Une fois décidée, elle ne se décide plus, et ne s'affiche plus.
    expect((await appeler('POST', `/entreprises/${ent}/quarantaine/${id}`, bureau.jeton, { accepter: false })).statut).toBe(409);
    expect((await appeler('GET', `/entreprises/${ent}/quarantaine`, bureau.jeton)).corps.remises).toEqual([]);
    // Elle reste, décidée, et ne se réécrit jamais.
    expect((await admin.query('select decision, mis_de_cote from socle.quarantaine where id = $1', [id])).rows[0].decision).toBe('acceptee');
    const moi = String((await admin.query('select utilisateur from socle.session where jeton_empreinte = encode(sha256(convert_to($1, \'utf8\')), \'hex\')', [bureau.jeton])).rows[0].utilisateur);
    await expect(enTantQue(pool, moi, (tx) => tx.query('update socle.quarantaine set changements = \'[]\' where id = $1', [id]))).rejects.toThrow(/ne se modifie pas/);
  });

  it('rejeter n\'applique rien ; une session fermée avant le retrait, ou une entreprise d\'un autre, ne remet rien', async () => {
    const { ent, bureau, session } = await nadia();
    const tablette = await session('Tablette');
    const ancienne = await session('Vieux portable');
    const autre = await nadia();
    const changements = [{ collection: 'clients', cle: 'c3', rang: 1, revision: null, contenu: { id: 'c3', name: 'Pâtisserie Ennour' } }];
    // La session du vieux portable s'est fermée (déconnexion) avant son retrait : elle n'a rien à remettre.
    await appeler('POST', '/deconnexion', ancienne.jeton);
    for (const a of [tablette, ancienne]) expect((await appeler('DELETE', `/moi/appareils/${a.appareil}`, bureau.jeton)).statut).toBe(200);
    expect((await appeler('POST', '/quarantaine', ancienne.jeton, { entreprise: ent, changements })).statut).toBe(401);
    // La tablette ne remet que dans ses entreprises.
    expect((await appeler('POST', '/quarantaine', tablette.jeton, { entreprise: autre.ent, changements })).statut).toBe(401);
    expect((await appeler('POST', '/quarantaine', tablette.jeton, { entreprise: ent, changements })).corps).toEqual({ recus: 1 });
    expect((await appeler('GET', '/moi', tablette.jeton)).corps.motif).toBe('Cet appareil a été retiré de ton compte : ce qu\'il gardait pour travailler sans réseau est effacé, et ton changement fait hors ligne est mis de côté au serveur, où le propriétaire de l\'entreprise l\'acceptera ou le rejettera ; reconnecte-toi pour continuer.');

    const id = ((await appeler('GET', `/entreprises/${ent}/quarantaine`, bureau.jeton)).corps.remises as { id: string }[])[0]?.id ?? '';
    expect(await appeler('POST', `/entreprises/${ent}/quarantaine/${id}`, bureau.jeton, { accepter: false })).toEqual({ statut: 200, corps: { appliques: 0, misDeCote: [] } });
    expect(await client(ent, bureau.jeton, 'c3')).toBe(undefined);
    expect((await admin.query('select decision from socle.quarantaine where id = $1', [id])).rows[0].decision).toBe('rejetee');
    // L'autre entreprise ne voit rien de tout ça, pas même dans la base.
    expect((await appeler('GET', `/entreprises/${autre.ent}/quarantaine`, autre.bureau.jeton)).corps.remises).toEqual([]);
    expect((await enTantQue(pool, autre.utilisateur, (tx) => tx.query('select count(*)::int n from socle.quarantaine'))).rows[0].n).toBe(0);
  });

  it('un membre retiré remet par sa session valable ; encore membre, ou jamais membre, rien n\'est reçu', async () => {
    const { ent, bureau, session } = await nadia();
    // Karim, administrateur de l'épicerie (le code en place : son rôle l'exige).
    const email = `karim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Portable de Karim', type: 'navigateur' } })).corps.jeton);
    await appeler('POST', '/moi/code', karim, { methode: 'application' });
    const invitation = String((await appeler('POST', `/entreprises/${ent}/invitations`, bureau.jeton, { email, roles: ['administrateur'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', karim, { jeton: invitation })).statut).toBe(200);
    const changements = [{ collection: 'clients', cle: 'k1', rang: 1, revision: null, contenu: { id: 'k1', name: 'Client de Karim' } }];
    // Encore membre : il enregistre par le chemin ordinaire, rien n'est reçu ici.
    expect((await appeler('POST', '/quarantaine', karim, { entreprise: ent, changements })).statut).toBe(401);
    // Retiré de l'épicerie : sa session reste valable (il a d'autres entreprises), et il remet.
    const membre = String((await admin.query('select m.id from socle.membre m join socle.utilisateur u on u.id = m.utilisateur where u.email = $1 and m.entreprise = $2', [email, ent])).rows[0].id);
    expect((await appeler('DELETE', `/entreprises/${ent}/membres/${membre}`, bureau.jeton)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/dossier-v10`, karim)).statut).toBe(404);
    expect(await appeler('POST', '/quarantaine', karim, { entreprise: ent, changements })).toEqual({ statut: 200, corps: { recus: 1 } });
    // Jamais membre de l'autre entreprise : rien.
    const autre = await nadia();
    expect((await appeler('POST', '/quarantaine', karim, { entreprise: autre.ent, changements })).statut).toBe(401);
    // Le propriétaire la voit : Karim, depuis son portable.
    const remises = (await appeler('GET', `/entreprises/${ent}/quarantaine`, bureau.jeton)).corps.remises as { appareil: string; utilisateur: string }[];
    expect(remises.map((r) => [r.appareil, r.utilisateur])).toEqual([['Portable de Karim', 'Karim']]);
    // Une session fermée ne remet plus rien.
    await appeler('POST', '/deconnexion', karim);
    expect((await appeler('POST', '/quarantaine', karim, { entreprise: ent, changements })).statut).toBe(401);
    void session;
  });
});
