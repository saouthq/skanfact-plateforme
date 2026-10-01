// Changer de caissier (brique 123 ; 03 § 6 ; docs/caisse.md, R1 à R5). Ce que le serveur garantit :
//   - chaque caissier pose SON code de caisse, 4 chiffres qui ne se devinent pas d'emblée ; un propriétaire, un
//     administrateur ou un caissier qui l'est aussi n'en a jamais : quatre chiffres n'ouvrent pas ces droits ;
//   - sur l'appareil qui tient la caisse, et lui seul, un caissier prend la main avec son code : la session du poste se
//     ferme, la sienne s'ouvre sur le même appareil, la caisse continue, et ses tickets portent son nom ;
//   - la session ouverte par un code ne sert qu'à cette caisse : ni le compte, ni une autre entreprise de la personne ;
//   - un code faux le dit, et après 5 erreurs, une attente (même le bon code attend), jamais un blocage.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { declarerGestesCaisse } from '../../serveur/caisse/gestes.ts';
import { routesCaisse } from '../../serveur/caisse/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const pool = creerPool(inject('pgApp'));
// Pour lire ce que la base a écrit (auteurs, trace), au-dessus de la sécurité par ligne.
const admin = creerPool(inject('pgAdmin'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string, appareil: string) {
  const email = `relais-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
const ticket = (id: string, pu: string, paye: string) => ({
  id, type: 'facture', ticket: true, number: '', date: aujourdhui, dueDate: aujourdhui, clientId: '', subject: '', reference: '',
  lines: [{ itemId: '', label: 'Pain de mie', unit: '', qty: 1, unitPrice: { '~n': pu }, vatRate: 7 }], discountRate: 0,
  applyStamp: false, stampFee: 0, status: 'envoyée', notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '',
  createdAt: 1, issuedTs: Date.now(), caisse: { mode: 'especes', recu: null, rendu: null },
  payments: [{ id: `p-${id}`, date: aujourdhui, amount: { '~n': paye }, method: 'especes', accountId: 'k-caisse', reference: '', note: 'Encaissé en caisse' }],
});
// Le motif tel que le catalogue l'écrit (l'API le rend en phrase : majuscule et point).
const motif = (r: Reponse) => { const m = String(r.corps.motif); return m.charAt(0).toLowerCase() + m.slice(1).replace(/\.$/, ''); };

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); await admin.end(); });

describe('changer de caissier', () => {
  it('Leila prend la caisse de Sami avec son code ; sa session ne sert qu\'à la caisse ; un code faux attend, sans bloquer', async () => {
    const nadia = await personne('Nadia', 'Bureau de Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const inviter = async (qui: { email: string; jeton: string }, roles: string[]) => {
      const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: qui.email, roles })).corps.jeton);
      expect((await appeler('POST', '/invitations/accepter', qui.jeton, { jeton: inv })).statut).toBe(200);
    };
    let sami = await personne('Sami', 'Caisse du comptoir');
    const leila = await personne('Leila', 'Téléphone de Leila');
    const karim = await personne('Karim', 'Bureau de Karim');
    await inviter(sami, ['caissier']);
    await inviter(leila, ['caissier']);
    await appeler('POST', '/moi/code', karim.jeton, { methode: 'application' });
    await inviter(karim, ['caissier', 'administrateur']);
    // Leila a aussi sa propre épicerie (elle y est propriétaire, avec le code de son téléphone).
    const epicerie = String((await appeler('POST', '/entreprises', leila.jeton, { raisonSociale: 'Épicerie de Leila' })).corps.id);
    await appeler('POST', '/moi/code', leila.jeton, { methode: 'application' });
    const ids = Object.fromEntries(((await appeler('GET', `/entreprises/${ent}/equipe`, nadia.jeton)).corps.membres as { utilisateur: string; nom: string }[])
      .map((m) => [m.nom, m.utilisateur]));

    // Chacun pose SON code : 4 chiffres, pas les premiers qu'on essaie.
    const poser = (jeton: string, code: string) => appeler('PUT', `/entreprises/${ent}/caisse/mon-code`, jeton, { code });
    expect(motif(await poser(leila.jeton, '12'))).toBe('le code de caisse a 4 chiffres, ni plus ni moins : rien n\'a été changé');
    expect(motif(await poser(leila.jeton, '9876'))).toBe('le code 9876 se devine trop vite (chiffres répétés ou qui se suivent) : choisis-en un autre. Rien n\'a été changé');
    expect(motif(await poser(leila.jeton, '0000'))).toContain('se devine trop vite');
    expect((await poser(leila.jeton, '4827')).statut).toBe(200);
    expect((await poser(sami.jeton, '5190')).statut).toBe(200);
    // Un administrateur, même caissier, n'a jamais de code de caisse ; la propriétaire non plus.
    expect(motif(await poser(karim.jeton, '3071'))).toBe('seul un caissier (qui n\'est ni propriétaire, ni administrateur, ni paie) pose un code de caisse : quatre chiffres n\'ouvrent jamais ces droits');
    expect((await poser(nadia.jeton, '3071')).statut).toBe(403);

    // Sami ouvre la caisse sur le comptoir et vend un pain.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, sami.jeton, { fond: '50' })).statut).toBe(200);
    const vendre = (jeton: string, id: string) => appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, jeton, { document: ticket(id, '1', '1.07'), rang: 0, netAPayer: '1.070' });
    expect((await vendre(sami.jeton, 'ts1')).statut).toBe(200);

    // Les caissiers qui prennent la caisse par un code : ceux qui l'ont posé.
    expect((await appeler('GET', `/entreprises/${ent}/caisse/caissiers`, sami.jeton)).corps.caissiers)
      .toEqual([{ id: ids.Leila, nom: 'Leila', moi: false }, { id: ids.Sami, nom: 'Sami', moi: true }]);

    // Ce que Sami lisait (sa marque de relecture) ne sert pas à la suivante : elle relit tout.
    const lu = (await appeler('GET', `/entreprises/${ent}/dossier-v10`, sami.jeton)).corps as { marque: string; profil: string };
    const relais = (jeton: string, utilisateur: string | undefined, code: string) => appeler('POST', `/entreprises/${ent}/caisse/relais`, jeton, { utilisateur, code });
    // Ailleurs que sur le poste de la caisse : non.
    expect(motif(await relais(nadia.jeton, ids.Leila, '4827'))).toBe('on ne change de caissier que sur l\'appareil qui tient la caisse, sur « mon ordinateur » : rien n\'a changé');
    // Karim n'a pas de code : il ne prend pas la caisse ainsi.
    expect(motif(await relais(sami.jeton, ids.Karim, '3071'))).toContain('cette personne ne prend pas la caisse par un code');
    // Un code faux : la caisse reste à Sami.
    expect(motif(await relais(sami.jeton, ids.Leila, '4828'))).toBe('ce code ne correspond pas : la caisse reste à Sami');

    // Le bon : la session de Sami se ferme, celle de Leila s'ouvre sur le même poste, et la caisse continue.
    const pris = await relais(sami.jeton, ids.Leila, '4827');
    expect(pris.corps).toMatchObject({ nom: 'Leila' });
    const leilaCaisse = String(pris.corps.jeton);
    expect((await appeler('GET', `/entreprises/${ent}/caisse`, sami.jeton)).statut).toBe(401);
    expect((await appeler('GET', `/entreprises/${ent}/caisse`, leilaCaisse)).corps).toMatchObject({ session: { ici: true, qui: 'Sami', appareil: 'Caisse du comptoir' } });
    expect((await vendre(leilaCaisse, 'tl1')).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/dossier-v10?depuis=${lu.marque}&profil=${encodeURIComponent(lu.profil)}`, leilaCaisse)).corps.partiel).toBeUndefined();
    // Ses tickets portent son nom : elle voit le sien, pas celui de Sami ; Nadia voit les deux, chacun de son auteur.
    const tickets = async (jeton: string) => ((await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string }[])
      .filter((o) => o.collection === 'documents').map((o) => o.cle).sort();
    expect(await tickets(leilaCaisse)).toEqual(['tl1']);
    expect(await tickets(nadia.jeton)).toEqual(['tl1', 'ts1']);
    const auteurs = (await admin.query(`select d.cle, u.nom from socle.dossier_v10 d join socle.utilisateur u on u.id = d.cree_par
      where d.entreprise = $1 and d.collection = 'documents' order by d.cle`, [ent])).rows;
    expect(auteurs).toEqual([{ cle: 'tl1', nom: 'Leila' }, { cle: 'ts1', nom: 'Sami' }]);

    // Quatre chiffres n'ouvrent que la caisse : ni le compte de Leila, ni son épicerie.
    expect(await appeler('GET', '/moi', leilaCaisse)).toMatchObject({ statut: 403, corps: { bouton: 'session_de_caisse' } });
    expect((await appeler('GET', `/entreprises/${epicerie}/caisse`, leilaCaisse)).statut).toBe(404);
    expect((await appeler('GET', `/entreprises/${epicerie}/caisse`, leila.jeton)).statut).toBe(200);

    // Sami reprend la main avec son code (depuis la session de Leila).
    const repris = await relais(leilaCaisse, ids.Sami, '5190');
    expect(repris.corps).toMatchObject({ nom: 'Sami' });
    sami = { ...sami, jeton: String(repris.corps.jeton) };
    expect((await appeler('GET', `/entreprises/${ent}/caisse`, leilaCaisse)).statut).toBe(401);

    // Cinq erreurs sur le code de Leila : une attente, que même le bon code respecte ; jamais un blocage.
    for (let i = 0; i < 4; i++) expect(motif(await relais(sami.jeton, ids.Leila, '1111'))).toBe('ce code ne correspond pas : la caisse reste à Sami');
    expect(motif(await relais(sami.jeton, ids.Leila, '1111'))).toBe('trop d\'essais : réessaie dans 1 minute. Ton compte n\'est pas bloqué');
    expect(motif(await relais(sami.jeton, ids.Leila, '4827'))).toBe('trop d\'essais : réessaie dans 1 minute. Ton compte n\'est pas bloqué');
    // Le code de Sami, lui, n'attend pas : l'attente est celle de Leila.
    expect(motif(await relais(sami.jeton, ids.Sami, '0001'))).toBe('ce code ne correspond pas : la caisse reste à Sami');

    // La trace dit qui a passé la caisse à qui.
    const trace = (await admin.query(`select u.nom de, a.apres->>'vers' vers from socle.audit a join socle.utilisateur u on u.id = a.utilisateur
      where a.entreprise = $1 and a.geste = 'caisse.relais' order by a.id`, [ent])).rows;
    expect(trace).toEqual([{ de: 'Sami', vers: 'Leila' }, { de: 'Leila', vers: 'Sami' }]);
  });
});
