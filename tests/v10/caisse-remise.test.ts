// La remise à la caisse, côté serveur (brique 125 ; 03 § 2.1 ; docs/caisse.md, M1 à M4). Ce que le serveur garantit :
//   - le plafond de la caisse vaut 0 % par défaut : toute remise d'un caissier demande le code d'un responsable présent ;
//   - le plafond se règle par le propriétaire ou un administrateur, jamais par le caissier ; en dessous, pas de code ;
//   - le ticket remisé avec accord porte le taux et le nom du responsable ;
//   - sans réseau, le code ne se vérifie pas : le ticket remisé au-delà s'enregistre, et l'écart devient une alerte.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { empreinteDuPoste, formaterNumero, ticketDuPoste } from '../../serveur/caisse/chaine.ts';
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
  const email = `remise-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
const motif = (r: Reponse) => { const m = String(r.corps.motif); return m.charAt(0).toLowerCase() + m.slice(1).replace(/\.$/, ''); };
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
const annee = Number(aujourdhui.slice(0, 4));
// Trois pains à 1,2 DT HT (TVA 7 %), remisés de `remise` %, payés `paye`.
const ticket = (id: string, remise: number, paye: string) => ({
  id, type: 'facture', ticket: true, number: '', date: aujourdhui, dueDate: aujourdhui, clientId: '', subject: '', reference: '',
  lines: [{ itemId: 'pain', label: 'Pain de mie', unit: 'u', qty: 3, unitPrice: { '~n': '1.2' }, vatRate: 7 }], discountRate: remise,
  applyStamp: false, stampFee: 0, status: 'envoyée', notes: '', withholdingRate: 0, lang: 'fr', currency: 'DT', exchangeRate: '',
  createdAt: 1, issuedTs: Date.now(), caisse: { mode: 'especes', recu: null, rendu: null },
  payments: [{ id: `p-${id}`, date: aujourdhui, amount: { '~n': paye }, method: 'especes', accountId: 'k-caisse', reference: '', note: 'Encaissé en caisse' }],
});

beforeAll(async () => {
  declarerGestesVentes();
  declarerGestesCaisse();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesCaisse(), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('la remise à la caisse', () => {
  it('au-delà du plafond (0 % par défaut), le code d\'un responsable ; en dessous, rien ; sans réseau, une alerte', async () => {
    const nadia = await personne('Nadia', 'Bureau de Nadia');
    const ent = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const sami = await personne('Sami', 'Caisse du comptoir');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: sami.email, roles: ['caissier'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', sami.jeton, { jeton: inv })).statut).toBe(200);
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton);
    const ids = Object.fromEntries(((await appeler('GET', `/entreprises/${ent}/equipe`, nadia.jeton)).corps.membres as { utilisateur: string; nom: string }[]).map((m) => [m.nom, m.utilisateur]));
    expect((await appeler('PUT', `/entreprises/${ent}/caisse/code-responsable`, nadia.jeton, { code: '1357' })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${ent}/caisse/ouvrir`, sami.jeton, { fond: '20' })).statut).toBe(200);
    const vendre = (demande: Record<string, unknown>) => appeler('POST', `/entreprises/${ent}/dossier-v10/ticket`, sami.jeton, demande);

    // Sans remise : pas de code.
    expect((await vendre({ document: ticket('t0', 0, '3.852'), rang: 0, netAPayer: '3.852' })).corps.numero).toBe(`TIC-${annee}-001`);
    // 10 % : au-delà du plafond par défaut (0 %), le code d'un responsable présent.
    const dix = { document: ticket('t1', 10, '3.467'), rang: 1, netAPayer: '3.467' };
    expect(await vendre(dix)).toMatchObject({ statut: 403, corps: { bouton: 'caisse.responsable' } });
    expect(motif(await vendre(dix))).toBe('une remise de 10 % dépasse ce que la caisse permet sans accord (0 %) : il faut le code d\'un responsable présent (le propriétaire ou un administrateur). Rien n\'a été vendu');
    expect(motif(await vendre({ ...dix, responsable: { utilisateur: ids.Nadia, code: '1358' } }))).toBe('ce code de responsable ne correspond pas : rien n\'a été vendu');
    expect(motif(await vendre({ ...dix, responsable: { utilisateur: ids.Sami, code: '1357' } }))).toContain('cette personne n\'approuve pas à la caisse');
    const t1 = await vendre({ ...dix, responsable: { utilisateur: ids.Nadia, code: '1357' } });
    expect(t1.corps).toMatchObject({ numero: `TIC-${annee}-002`, contenu: { remiseCaisse: { taux: '10', approuvePar: 'Nadia' } } });

    // Le plafond se règle par Nadia (15 %), jamais par Sami ; en dessous, plus de code.
    const fiche = async (jeton: string, plafond: number) => {
      const l = (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown>; revision: number }[];
      const c = l.find((o) => o.collection === '_racine' && o.cle === 'company');
      return appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: c?.revision ?? null, contenu: { ...(c?.contenu ?? {}), remiseCaisseAuDela: plafond } }] });
    };
    expect((await fiche(nadia.jeton, 15)).statut).toBe(200);
    expect(motif(await fiche(sami.jeton, 50))).toContain('ton rôle ne permet pas d\'enregistrer la fiche de la société');
    // Jusque dans la base : le caissier ne change pas le plafond, même en écrivant la fiche lui-même.
    await expect(enTantQue(pool, String(ids.Sami), (tx) => tx.query(`update socle.dossier_v10 set contenu = contenu || '{"remiseCaisseAuDela": 50}'::jsonb
      where entreprise = $1 and collection = '_racine' and cle = 'company'`, [ent]))).rejects.toMatchObject({ code: '42501', message: 'Le plafond de remise de la caisse se règle par le propriétaire ou un administrateur.' });
    const t2 = await vendre({ document: ticket('t2', 10, '3.467'), rang: 2, netAPayer: '3.467' });
    expect(t2.corps.numero).toBe(`TIC-${annee}-003`);
    expect((t2.corps.contenu as Record<string, unknown>).remiseCaisse).toBeUndefined();
    expect(motif(await vendre({ document: ticket('t3', 20, '3.082'), rang: 3, netAPayer: '3.082' }))).toContain('une remise de 20 % dépasse ce que la caisse permet sans accord (15 %)');

    // Sans réseau, un ticket remisé de 20 % sans responsable : enregistré, et dit en alerte à Nadia.
    const etat = (await appeler('GET', `/entreprises/${ent}/caisse`, sami.jeton)).corps.numerotation as { session: string; serie: { format: string; prefixe: string }; prochain: { numero: number }; chaine: string };
    const doc = ticket('t4', 20, '3.082');
    const numero = formaterNumero(etat.serie.format, etat.serie.prefixe, annee, etat.prochain.numero);
    const encaisseLe = new Date().toISOString();
    const poste = { session: etat.session, numero, precedente: etat.chaine, empreinte: empreinteDuPoste(etat.chaine, ticketDuPoste(doc, '3.082', numero, encaisseLe)), encaisseLe, horsLigne: true };
    expect((await vendre({ document: doc, rang: 4, netAPayer: '3.082', poste })).corps.numero).toBe(`TIC-${annee}-004`);
    const alertes = (await appeler('GET', `/entreprises/${ent}/caisse`, nadia.jeton)).corps.alertes as { nature: string; detail: Record<string, string> }[];
    expect(alertes.map((a) => [a.nature, a.detail])).toEqual([['remise', { taux: '20', plafond: '15' }]]);
  });
});
