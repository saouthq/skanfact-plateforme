// Le retour à la caisse, côté serveur (brique 124 ; 03 § 2.1 ; docs/caisse.md, T1 à T5). Ce que le serveur garantit :
//   - le propriétaire et l'administrateur posent LEUR code de responsable (4 chiffres qui ne se devinent pas d'emblée) ;
//     un caissier, jamais ;
//   - un caissier ne rend rien sans le code d'un responsable présent ; un code faux le dit, cinq font attendre ;
//   - chaque ligne rendue est une ligne du ticket, jamais plus que ce qui reste à rendre ; l'argent rendu est le net de
//     l'avoir, numéroté par le serveur (AVO), qui porte les deux noms ;
//   - l'argent rendu sort du tiroir de la session ouverte sur ce poste : le Z le compte.

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
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string, appareil: string) {
  const email = `retour-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
// Le motif tel que le catalogue l'écrit (l'API le rend en phrase : majuscule et point).
const motif = (r: Reponse) => { const m = String(r.corps.motif); return m.charAt(0).toLowerCase() + m.slice(1).replace(/\.$/, ''); };
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
const annee = aujourdhui.slice(0, 4);
const pain = { itemId: 'pain', label: 'Pain de mie', unit: 'u', unitPrice: { '~n': '1.2' }, vatRate: 7 };
const ticket = (id: string) => ({
  id, type: 'facture', ticket: true, number: '', date: aujourdhui, dueDate: aujourdhui, clientId: '', subject: '', reference: '',
  lines: [{ ...pain, qty: 3 }], discountRate: 0, applyStamp: false, stampFee: 0, status: 'envoyée', notes: '', withholdingRate: 0,
  lang: 'fr', currency: 'DT', exchangeRate: '', createdAt: 1, issuedTs: Date.now(), caisse: { mode: 'especes', recu: null, rendu: null },
  payments: [{ id: `p-${id}`, date: aujourdhui, amount: { '~n': '3.852' }, method: 'especes', accountId: 'k-caisse', reference: '', note: 'Encaissé en caisse' }],
});
// Ce que l'écran envoie pour un retour (comme C.remboursementDeTicket de la v10) : l'avoir et l'argent rendu.
const retour = (id: string, qty: number, net: string, autre: { unitPrice?: unknown } = {}) => ({
  ticket: 't1', rang: null, netAPayer: net,
  avoir: { id, type: 'avoir', number: '', status: 'émis', date: aujourdhui, dueDate: '', clientId: '', subject: 'Retour sur le ticket', reference: '',
    creditOf: 't1', creditReason: 'Pain rassis', lines: [{ ...pain, ...autre, qty, ligneTicket: 0 }], discountRate: 0, applyStamp: false, stampFee: 0,
    notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '', payments: [], createdAt: 1, issuedTs: Date.now() },
  paiement: { id: `p-${id}`, date: aujourdhui, amount: { '~n': `-${net}` }, method: 'especes', accountId: 'k-caisse', reference: '', note: 'Rendu sur le ticket' },
});

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('le retour à la caisse', () => {
  it('Sami rend un pain avec le code de Nadia ; jamais plus que vendu ; le Z compte l\'argent rendu', async () => {
    const nadia = await personne('Nadia', 'Bureau de Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const inviter = async (qui: { email: string; jeton: string }, roles: string[]) => {
      const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: qui.email, roles })).corps.jeton);
      expect((await appeler('POST', '/invitations/accepter', qui.jeton, { jeton: inv })).statut).toBe(200);
    };
    const sami = await personne('Sami', 'Caisse du comptoir');
    const karim = await personne('Karim', 'Bureau de Karim');
    await inviter(sami, ['caissier']);
    await appeler('POST', '/moi/code', karim.jeton, { methode: 'application' });
    await inviter(karim, ['administrateur']);
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
    ] })).statut).toBe(200);
    const ids = Object.fromEntries(((await appeler('GET', `/entreprises/${ent}/equipe`, nadia.jeton)).corps.membres as { utilisateur: string; nom: string }[]).map((m) => [m.nom, m.utilisateur]));

    // Les codes de responsable : la propriétaire et l'administrateur, chacun le sien ; le caissier, jamais.
    const poser = (jeton: string, code: string) => appeler('PUT', `/entreprises/${ent}/caisse/code-responsable`, jeton, { code });
    expect(motif(await poser(nadia.jeton, '12'))).toBe('le code de caisse a 4 chiffres, ni plus ni moins : rien n\'a été changé');
    expect(motif(await poser(nadia.jeton, '3456'))).toContain('se devine trop vite');
    expect((await poser(nadia.jeton, '1357')).statut).toBe(200);
    expect((await poser(karim.jeton, '8024')).statut).toBe(200);
    expect((await poser(sami.jeton, '5190')).statut).toBe(403);
    expect((await appeler('GET', `/entreprises/${ent}/caisse/responsables`, sami.jeton)).corps.responsables)
      .toEqual([{ id: ids.Karim, nom: 'Karim' }, { id: ids.Nadia, nom: 'Nadia' }]);

    // Sami ouvre la caisse et vend trois pains (3,852 DT).
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, sami.jeton, { fond: '50' })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, sami.jeton, { document: ticket('t1'), rang: 0, netAPayer: '3.852' })).corps.numero).toBe(`TIC-${annee}-001`);

    const rendre = (jeton: string, demande: unknown) => appeler('POST', `/entreprises/${ent}/dossier-v10/rendre`, jeton, demande);
    const avecCode = (d: object, utilisateur: string | undefined, code: string) => ({ ...d, responsable: { utilisateur, code } });
    // Sans le code d'un responsable : rien n'est rendu, et le bouton qui débloque est dit.
    expect(await rendre(sami.jeton, retour('a1', 1, '1.284'))).toMatchObject({ statut: 403, corps: { bouton: 'caisse.responsable' } });
    expect(motif(await rendre(sami.jeton, retour('a1', 1, '1.284')))).toBe('un retour se fait avec le code d\'un responsable présent (le propriétaire ou un administrateur) : rien n\'a été rendu');
    // Un code faux : rien n'est rendu.
    expect(motif(await rendre(sami.jeton, avecCode(retour('a1', 1, '1.284'), ids.Nadia, '1358')))).toBe('ce code de responsable ne correspond pas : rien n\'a été rendu');
    // Un caissier n'approuve pas, même avec un code.
    expect(motif(await rendre(sami.jeton, avecCode(retour('a1', 1, '1.284'), ids.Sami, '5190')))).toContain('cette personne n\'approuve pas à la caisse');
    // Plus que vendu, ou un autre prix : non.
    expect(motif(await rendre(sami.jeton, avecCode(retour('a1', 4, '5.136'), ids.Nadia, '1357')))).toBe(`on ne rend pas plus de « Pain de mie » que le ticket TIC-${annee}-001 n'en a vendu, retours déjà faits compris : rien n'a été rendu`);
    expect(motif(await rendre(sami.jeton, avecCode(retour('a1', 1, '2.140', { unitPrice: { '~n': '2' } }), ids.Nadia, '1357')))).toBe(`une ligne rendue n'est pas une ligne du ticket TIC-${annee}-001 (le même article, au même prix) : rien n'a été rendu`);
    // L'argent rendu est le net de l'avoir.
    const faux = retour('a1', 1, '1.284');
    expect(motif(await rendre(sami.jeton, avecCode({ ...faux, paiement: { ...faux.paiement, amount: { '~n': '-2' } } }, ids.Nadia, '1357')))).toBe('l\'argent rendu doit être le montant de l\'avoir (1.284), aujourd\'hui : rien n\'a été rendu');
    // Ailleurs que sur le poste de la caisse : non (l'argent sort de son tiroir).
    expect(motif(await rendre(nadia.jeton, retour('a1', 1, '1.284')))).toContain('la caisse est ouverte sur un autre appareil');

    // Le bon code : l'avoir AVO-…-001, numéroté par le serveur, porte les deux noms ; l'argent rendu va sur le ticket.
    const r1 = await rendre(sami.jeton, avecCode(retour('a1', 1, '1.284'), ids.Nadia, '1357'));
    expect(r1.corps).toMatchObject({ numero: `AVO-${annee}-001`, avoir: { contenu: { number: `AVO-${annee}-001`, creditOf: 't1', retourCaisse: { faitPar: 'Sami', approuvePar: 'Nadia' } } } });
    const paiements = ((r1.corps.ticket as { contenu: { payments: { amount: unknown; reference: string }[] } }).contenu.payments).map((p) => [p.amount, p.reference]);
    expect(paiements).toEqual([[{ '~n': '3.852' }, ''], [{ '~n': '-1.284' }, `AVO-${annee}-001`]]);
    // Cinq codes faux pour Karim : une attente, que même le bon code respecte ; jamais un blocage (Nadia, elle, approuve).
    for (let i = 0; i < 4; i++) expect(motif(await rendre(sami.jeton, avecCode(retour('a2', 2, '2.568'), ids.Karim, '1111')))).toBe('ce code de responsable ne correspond pas : rien n\'a été rendu');
    expect(motif(await rendre(sami.jeton, avecCode(retour('a2', 2, '2.568'), ids.Karim, '1111')))).toBe('trop d\'essais : réessaie dans 1 minute. Ton compte n\'est pas bloqué');
    expect(motif(await rendre(sami.jeton, avecCode(retour('a2', 2, '2.568'), ids.Karim, '8024')))).toBe('trop d\'essais : réessaie dans 1 minute. Ton compte n\'est pas bloqué');
    // Ce qui reste : deux pains. Trois, non ; deux, oui ; puis plus rien.
    expect(motif(await rendre(sami.jeton, avecCode(retour('a2', 3, '3.852'), ids.Nadia, '1357')))).toContain('on ne rend pas plus de « Pain de mie »');
    expect((await rendre(sami.jeton, avecCode(retour('a2', 2, '2.568'), ids.Nadia, '1357'))).corps).toMatchObject({ numero: `AVO-${annee}-002` });
    expect(motif(await rendre(sami.jeton, avecCode(retour('a3', 1, '1.284'), ids.Nadia, '1357')))).toContain('on ne rend pas plus de « Pain de mie »');


    // Le Z : 50 de fond, 3,852 encaissés, 3,852 rendus en espèces : le tiroir doit contenir 50. Il cite ses deux avoirs
    // (vu sur le serveur d'essai le 05/10/2026 : il ne les nommait pas) et le net des ventes : rien, ici.
    const z = (await appeler('POST', `/entreprises/${ent}/caisse/fermer`, sami.jeton, { compte: '50' })).corps.z;
    expect(z).toMatchObject({ nombre: 1, parMode: { especes: '3.852' }, rendu: { especes: '3.852' }, retours: 2, attendu: '50.000', ecart: '0.000',
      avoirs: [{ numero: `AVO-${annee}-001`, ticket: `TIC-${annee}-001`, montant: '1.284' }, { numero: `AVO-${annee}-002`, ticket: `TIC-${annee}-001`, montant: '2.568' }],
      retoursTtc: '3.852', net: '0.000', tvaNette: '0.000' });
    // Karim n'est plus administrateur : il n'approuve plus à la caisse, même avec son code.
    const karimMembre = ((await appeler('GET', `/entreprises/${ent}/equipe`, nadia.jeton)).corps.membres as { id: string; nom: string }[]).find((m) => m.nom === 'Karim')?.id;
    expect((await appeler('PUT', `/entreprises/${ent}/membres/${karimMembre}/roles`, nadia.jeton, { roles: ['commercial'] })).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/caisse/responsables`, sami.jeton)).corps.responsables).toEqual([{ id: ids.Nadia, nom: 'Nadia' }]);
    // Sami voit ses retours avec son ticket (sinon sa page lui proposerait de rendre deux fois).
    const siens = ((await appeler('GET', `/entreprises/${ent}/dossier-v10`, sami.jeton)).corps.objets as { collection: string; cle: string }[])
      .filter((o) => o.collection === 'documents').map((o) => o.cle).sort();
    expect(siens).toEqual(['a1', 'a2', 't1']);
    // Le caissier n'émet toujours pas d'avoir par la route des avoirs.
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre-avoir`, sami.jeton, { document: retour('a9', 1, '1.284').avoir, client: null, revision: null, rang: null, netAPayer: '1.284' })).statut).toBe(403);
  });
});
