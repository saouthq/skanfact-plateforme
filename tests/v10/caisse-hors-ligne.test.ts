// La caisse sans réseau, côté serveur (brique 120 ; 04 § 3.1 ; docs/caisse.md, H1 à H4). Ce que le serveur garantit :
//   - à l'ouverture et après chaque ticket, le poste qui tient la caisse apprend la forme de la série, le prochain
//     numéro et la dernière empreinte de sa chaîne ;
//   - un ticket encaissé sans réseau revient dans l'ordre, dans SA session, et s'émet comme en ligne ; envoyé deux fois,
//     il ne compte qu'une fois ;
//   - un écart n'est jamais corrigé en silence : numéro imprimé qui n'est pas celui de la série, chaîne cassée,
//     empreinte qui ne se recalcule pas, ticket arrivé après le Z, chacun devient une alerte, que le propriétaire voit
//     (pas le caissier) ;
//   - seul l'appareil qui tenait la caisse remet ses tickets.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { empreinteDuPoste, formaterNumero, PREMIERE, ticketDuPoste } from '../../serveur/caisse/chaine.ts';
import { declarerGestesCaisse } from '../../serveur/caisse/gestes.ts';
import { routesCaisse } from '../../serveur/caisse/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string, appareil: string) {
  const email = `horsligne-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
const annee = Number(aujourdhui.slice(0, 4));
const ticket = (id: string, qty: number, pu: string, paye: string, mode = 'especes') => ({
  id, type: 'facture', ticket: true, number: '', date: aujourdhui, dueDate: aujourdhui, clientId: '', subject: '', reference: '',
  lines: [{ itemId: '', label: 'Pain de mie', unit: '', qty, unitPrice: { '~n': pu }, vatRate: 7 }], discountRate: 0,
  applyStamp: false, stampFee: 0, status: 'envoyée', notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '',
  createdAt: 1, issuedTs: Date.now(), caisse: { mode, recu: null, rendu: null },
  payments: [{ id: `p-${id}`, date: aujourdhui, amount: { '~n': paye }, method: mode, accountId: 'k-caisse', reference: '', note: 'Encaissé en caisse' }],
});
type Numerotation = { session: string; serie: { format: string; prefixe: string; remise: string }; prochain: { numero: number; periode: number }; chaine: string };

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('la caisse sans réseau, côté serveur', () => {
  it('le poste numérote et chaîne ; au retour, ses tickets s\'émettent dans l\'ordre ; un écart devient une alerte, jamais une correction', async () => {
    const nadia = await personne('Nadia', 'Bureau de Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const sami = await personne('Sami', 'Caisse du comptoir');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: sami.email, roles: ['caissier'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', sami.jeton, { jeton: inv })).statut).toBe(200);
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton);

    // Sami ouvre : son poste apprend la forme de la série, le prochain numéro (1) et le début de sa chaîne.
    const ouverture = (await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, sami.jeton, { fond: '50' })).corps;
    let etat = ouverture.numerotation as Numerotation;
    expect(etat).toMatchObject({ session: ouverture.id, serie: { prefixe: 'TIC' }, prochain: { numero: 1, periode: annee }, chaine: PREMIERE });

    // Le poste fait chaque ticket comme le fera le point de contact : son numéro, sa chaîne.
    const faire = (doc: ReturnType<typeof ticket>, net: string, horsLigne: boolean, autre: { numero?: number; precedente?: string; empreinte?: string } = {}) => {
      const numero = formaterNumero(etat.serie.format, etat.serie.prefixe, annee, autre.numero ?? etat.prochain.numero);
      const precedente = autre.precedente ?? etat.chaine;
      const encaisseLe = new Date().toISOString();
      const empreinte = autre.empreinte ?? empreinteDuPoste(precedente, ticketDuPoste(doc, net, numero, encaisseLe));
      // Le poste avance, comme sans réseau : le numéro suivant, la nouvelle fin de chaîne.
      etat = { ...etat, prochain: { ...etat.prochain, numero: (autre.numero ?? etat.prochain.numero) + 1 }, chaine: empreinte };
      return { document: doc, rang: 0, netAPayer: net, poste: { session: etat.session, numero, precedente, empreinte, encaisseLe, horsLigne } };
    };
    const envoyer = (jeton: string, demande: unknown) => appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, jeton, demande);
    const alertes = async (jeton = nadia.jeton) => (await appeler('GET', `/entreprises/${ent}/caisse`, jeton)).corps.alertes as Record<string, unknown>[];

    // En ligne : le numéro du poste est celui de la série ; aucune alerte.
    const t1 = await envoyer(sami.jeton, faire(ticket('t1', 2, '1.2', '2.568'), '2.568', false));
    expect(t1.corps).toMatchObject({ numero: `TIC-${annee}-001`, caisse: { prochain: { numero: 2 }, chaine: etat.chaine } });

    // Sans réseau : deux tickets numérotés et chaînés par le poste, remis au retour, dans l'ordre.
    const t2 = faire(ticket('t2', 1, '3.5', '3.745'), '3.745', true);
    const t3 = faire(ticket('t3', 3, '0.25', '0.803', 'carte'), '0.803', true);
    expect((await envoyer(sami.jeton, t2)).corps.numero).toBe(`TIC-${annee}-002`);
    const r3 = await envoyer(sami.jeton, t3);
    expect(r3.corps).toMatchObject({ numero: `TIC-${annee}-003`, contenu: { numeroPoste: `TIC-${annee}-003` } });
    // Envoyé deux fois (la réponse perdue en route) : il ne compte qu'une fois.
    expect((await envoyer(sami.jeton, t3)).corps).toMatchObject({ numero: `TIC-${annee}-003` });
    expect(await alertes()).toEqual([]);

    // Seul l'appareil qui tenait la caisse remet ses tickets.
    expect((await envoyer(nadia.jeton, faire(ticket('tn', 1, '1', '1.07'), '1.070', true))).corps.motif)
      .toBe('Ce ticket a été encaissé sur la caisse d\'un autre appareil : seul l\'appareil qui la tenait le remet. Rien n\'a été enregistré.');
    etat = { ...etat, prochain: { ...etat.prochain, numero: etat.prochain.numero - 1 } };

    // Les écarts : une chaîne cassée, un numéro sauté, une empreinte qui ne se recalcule pas. Chaque ticket s'enregistre,
    // et chaque écart se dit.
    const t4 = faire(ticket('t4', 1, '2', '2.14'), '2.140', true, { precedente: 'a'.repeat(64) });
    expect((await envoyer(sami.jeton, t4)).corps.numero).toBe(`TIC-${annee}-004`);
    const t5 = faire(ticket('t5', 1, '2', '2.14'), '2.140', true, { numero: 9 });
    expect((await envoyer(sami.jeton, t5)).corps).toMatchObject({ numero: `TIC-${annee}-005`, contenu: { numeroPoste: `TIC-${annee}-009` } });
    const t6 = faire(ticket('t6', 1, '2', '2.14'), '2.140', true, { empreinte: 'b'.repeat(64) });
    expect((await envoyer(sami.jeton, t6)).statut).toBe(200);

    // Le Z de Nadia, depuis son bureau ; puis un ticket encaissé avant la coupure arrive après : enregistré, et dit.
    expect((await appeler('POST', `/entreprises/${ent}/caisse/fermer`, nadia.jeton, { compte: '57' })).statut).toBe(200);
    const t7 = faire(ticket('t7', 1, '1', '1.07'), '1.070', true);
    expect((await envoyer(sami.jeton, t7)).statut).toBe(200);

    // Chaque écart, nommé avec le numéro imprimé et celui de la série (rangés par ticket, puis par nature).
    const vues = (await alertes()).map((a) => [String(a.numeroSerie), String(a.nature), String(a.numeroPoste)]).sort();
    expect(vues).toEqual([
      [`TIC-${annee}-004`, 'chaine', `TIC-${annee}-004`],
      [`TIC-${annee}-005`, 'numero', `TIC-${annee}-009`],
      [`TIC-${annee}-006`, 'empreinte', `TIC-${annee}-010`],
      [`TIC-${annee}-006`, 'numero', `TIC-${annee}-010`],
      [`TIC-${annee}-007`, 'apres_fermeture', `TIC-${annee}-011`],
      [`TIC-${annee}-007`, 'numero', `TIC-${annee}-011`],
    ]);
    // Le caissier ne voit pas les alertes ; le propriétaire, oui.
    expect(await alertes(sami.jeton)).toEqual([]);
  });
});
