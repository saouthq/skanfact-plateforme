// Le tableau de bord du groupe (brique 113 ; 14 § 3.6 ; serveur/groupe.ts). Nadia tient deux sociétés et vend dans une
// troisième (commerciale) :
//   - ses deux sociétés ont leurs chiffres, lus dans leurs livres : le chiffre d'affaires est celui de la balance (classe
//     70), ce qui reste à encaisser celui du 411 — deux chemins, un chiffre ; le total les additionne (une devise) ;
//   - la troisième est nommée, sans ses chiffres : son rôle ne lui montre pas les livres ;
//   - une entreprise d'essai n'y est pas (ce ne sont pas des données).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import { routesGroupe } from '../../serveur/groupe.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `groupe-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

// Une facture émise par le serveur, sans timbre : `qte` × `pu` HT à 19 %.
async function vendre(jeton: string, ent: string, id: string, qte: number, pu: string, netAPayer: string) {
  await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton);
  const client = { id: `c-${id}`, name: 'Menuiserie El Amel', address: 'Route de Gabès, Sfax', matricule: '1234567A/A/M/000' };
  const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: client.id, createdAt: 1,
    lines: [{ label: 'Table en chêne', qty: qte, unit: 'u', unitPrice: { '~n': pu }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] }, client, revision: null, rang: 0, netAPayer });
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
}

beforeAll(async () => {
  app = await creerApp(ctx, [...routesSocle(ctx), ...routesGroupe(ctx), ...routesVentes(ctx), ...routesCompta(ctx), ...routesV10(ctx)]);
});
afterAll(async () => { await app?.close(); await pool.end(); });

describe('le tableau de bord du groupe', () => {
  it('les sociétés de la personne, leurs chiffres tirés de leurs livres et leur total ; une société sans les livres, nommée sans chiffres', async () => {
    const nadia = await personne('Nadia');
    const a = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
    // Le code du téléphone, que son rôle de propriétaire exige avant une deuxième société.
    await appeler('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const b = String((await appeler('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Bois du Sahel' })).corps.id);
    await appeler('POST', '/entreprises-essai', nadia.jeton);
    // 12 × 25,125 = 301,500 HT, TVA 57,285 → 358,785 ; 3 × 33,333 = 99,999 HT, TVA 19,000 → 118,999 (des montants qui discriminent).
    await vendre(nadia.jeton, a, 'fa1', 12, '25.125', '358.785');
    await vendre(nadia.jeton, b, 'fb1', 3, '33.333', '118.999');
    // Une troisième société, d'une autre propriétaire, où Nadia est commerciale.
    const sami = await personne('Sami');
    const c = String((await appeler('POST', '/entreprises', sami.jeton, { raisonSociale: 'Comptoir Sami' })).corps.id);
    await appeler('POST', '/moi/code', sami.jeton, { methode: 'application' });
    const inv = String((await appeler('POST', `/entreprises/${c}/invitations`, sami.jeton, { email: nadia.email, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', nadia.jeton, { jeton: inv })).statut).toBe(200);

    const r = await appeler('GET', '/moi/groupe', nadia.jeton);
    expect(r.statut).toBe(200);
    const societes = r.corps.societes as { id: string; raisonSociale: string; devise: string; chiffres: Record<string, string> | null; motif?: unknown }[];
    expect(societes.map((s) => s.raisonSociale)).toEqual(['Atelier Nadia', 'Bois du Sahel', 'Comptoir Sami']);
    const [sa, sb, sc] = societes;
    expect(sa?.chiffres).toEqual({ caMois: '301.500', caExercice: '301.500', aEncaisser: '358.785', aPayer: '0.000', tresorerie: '0.000' });
    expect(sb?.chiffres).toMatchObject({ caMois: '99.999', aEncaisser: '118.999' });
    expect(sc?.chiffres).toBeNull();
    expect(JSON.stringify(sc?.motif)).toContain('ne te montre pas ses livres');
    expect(r.corps.totaux).toEqual([{ devise: 'TND', chiffres: { caMois: '401.499', caExercice: '401.499', aEncaisser: '477.784', aPayer: '0.000', tresorerie: '0.000' } }]);

    // Deux chemins, un chiffre : la balance de chaque société dit le même chiffre d'affaires et le même dû client.
    for (const [ent, s] of [[a, sa], [b, sb]] as const) {
      const comptes = (await appeler('GET', `/entreprises/${ent}/compta/balance?du=${aujourdhui.slice(0, 7)}-01&au=${aujourdhui}`, nadia.jeton)).corps.comptes as { compte: string; debit: string; credit: string }[];
      const solde = (prefixe: string, sens: 1 | -1) => comptes.filter((x) => x.compte.startsWith(prefixe)).reduce((t, x) => t + sens * (Number(x.credit) - Number(x.debit)), 0);
      expect(solde('70', 1).toFixed(3)).toBe(s?.chiffres?.caMois);
      expect(solde('411', -1).toFixed(3)).toBe(s?.chiffres?.aEncaisser);
    }
  });
});
