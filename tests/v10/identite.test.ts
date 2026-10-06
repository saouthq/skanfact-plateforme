// L'identité de l'entreprise suit sa fiche société (lot facture, 05/10/2026 ; docs/facture-details.md, D6 ; 0071 ;
// serveur/v10/identite.ts). Trouvé en faisant le parcours d'une facture en commerçant : une entreprise créée sans
// matricule, puis complétée dans Paramètres → Mon entreprise, gardait au serveur le nom et le matricule de sa création —
// la liste des entreprises, le portefeuille du cabinet et la copie figée de ses factures ne voyaient jamais la fiche.
// Ce que le serveur garantit :
//   - la raison sociale et le matricule écrits dans la fiche deviennent ceux de l'entreprise, le matricule sous sa
//     forme lisible (2718281A/B/M/000) quelle que soit la façon de l'écrire ; la trace le dit ; la facture émise
//     ensuite les fige ;
//   - un matricule mal formé ne se porte pas (l'entreprise garde le sien) ; un matricule déjà porté par une autre
//     entreprise se refuse en le disant, et rien n'est écrit ;
//   - l'entreprise d'essai garde les siens.

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
import { routesVentes } from '../../serveur/ventes/routes.ts';

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
let n = 0;
// Une personne, son code posé, et son entreprise : une vraie (sans matricule, comme la porte la crée quand on le laisse
// vide) ou celle d'essai.
async function entreprise(essai: boolean) {
  const email = `identite-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Identité ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((essai ? await appeler('POST', '/entreprises-essai', jeton) : await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Pâtisserie Mahdia' })).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const fiche = async () => (await lire()).find((o) => o.collection === '_racine' && o.cle === 'company') as Objet;
  const ecrireFiche = async (champs: Record<string, unknown>) => {
    const f = await fiche();
    return appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: f.revision, contenu: { ...f.contenu, ...champs } }] });
  };
  const auServeur = async () => (await admin.query('select e.raison_sociale, e.matricule_fiscal, o.nom organisation from socle.entreprise e join socle.organisation o on o.id = e.organisation where e.id = $1', [ent])).rows[0] as { raison_sociale: string; matricule_fiscal: string | null; organisation: string };
  return { jeton, ent, lire, fiche, ecrireFiche, auServeur };
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('l\'identité de l\'entreprise suit sa fiche société', () => {
  it('le nom et le matricule écrits dans la fiche deviennent ceux de l\'entreprise, sous leur forme lisible ; la trace le dit, et la facture suivante les fige', async () => {
    const e = await entreprise(false);
    expect(await e.auServeur()).toEqual({ raison_sociale: 'Pâtisserie Mahdia', matricule_fiscal: null, organisation: 'Pâtisserie Mahdia' });
    // Écrit comme on le recopie d'une carte, en minuscules et avec des espaces.
    expect((await e.ecrireFiche({ name: 'Pâtisserie Mahdia SARL', matricule: ' 2718281 a / b / m / 000 ' })).statut).toBe(200);
    expect(await e.auServeur()).toEqual({ raison_sociale: 'Pâtisserie Mahdia SARL', matricule_fiscal: '2718281A/B/M/000', organisation: 'Pâtisserie Mahdia SARL' });
    // La liste des entreprises de la personne (la porte) dit le nouveau nom.
    const moi = (await appeler('GET', '/moi', e.jeton)).corps as { entreprises: { id: string; raison_sociale: string }[] };
    expect(moi.entreprises.find((x) => x.id === e.ent)?.raison_sociale).toBe('Pâtisserie Mahdia SARL');
    const trace = (await admin.query(`select avant, apres from socle.audit where entreprise = $1 and geste = 'socle.entreprise.identite'`, [e.ent])).rows;
    expect(trace).toEqual([{ avant: { raisonSociale: 'Pâtisserie Mahdia', matriculeFiscal: null }, apres: { raisonSociale: 'Pâtisserie Mahdia SARL', matriculeFiscal: '2718281A/B/M/000' } }]);
    // Réécrire la fiche sans toucher au nom ni au matricule ne trace rien de plus.
    expect((await e.ecrireFiche({ phone: '74 000 000' })).statut).toBe(200);
    expect((await admin.query(`select count(*)::int n from socle.audit where entreprise = $1 and geste = 'socle.entreprise.identite'`, [e.ent])).rows[0].n).toBe(1);

    // Une facture émise ensuite fige ce nom et ce matricule.
    const client = { id: 'c1', name: 'Hôtel Les Oliviers', matricule: '7654321C/A/M/000', address: 'Sousse' };
    const doc = { id: 'f1', type: 'facture', number: '', date: '2026-10-05', dueDate: '2026-11-04', clientId: 'c1', subject: 'Gâteaux', status: 'brouillon',
      lines: [{ label: 'Gâteau d\'anniversaire', description: '', qty: 1, unit: '', unitPrice: { '~n': '185.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1 };
    await appeler('POST', `/entreprises/${e.ent}/dossier-v10`, e.jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client }, { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: doc }] });
    // 185,500 + TVA 19 % (35,245) + timbre 1,000 = 221,745.
    const emise = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: doc, client, revision: 1, rang: 0, netAPayer: '221.745' });
    expect(emise.statut).toBe(200);
    const copie = (await admin.query(`select copie from ventes.piece where entreprise = $1 and type = 'facture'`, [e.ent])).rows[0].copie as { societe: unknown };
    expect(copie.societe).toEqual({ raisonSociale: 'Pâtisserie Mahdia SARL', matriculeFiscal: '2718281A/B/M/000' });
  });

  it('un matricule mal formé ne se porte pas ; celui d\'une autre entreprise se refuse en le disant, et rien n\'est écrit', async () => {
    const autre = await entreprise(false);
    // Des matricules à ce fichier seul : les tests partagent une base, et un matricule n'est celui que d'une entreprise
    // (tests/matricule-libre.ts).
    expect((await autre.ecrireFiche({ matricule: '1618033C/A/M/000' })).statut).toBe(200);
    const e = await entreprise(false);
    expect((await e.ecrireFiche({ matricule: '1111111A/A/M/000' })).statut).toBe(200);
    // Mal formé (il manque le code TVA, la catégorie et l'établissement) : la fiche le garde tel quel, l'entreprise garde le sien.
    expect((await e.ecrireFiche({ matricule: '1111111A' })).statut).toBe(200);
    expect((await e.fiche()).contenu.matricule).toBe('1111111A');
    expect((await e.auServeur()).matricule_fiscal).toBe('1111111A/A/M/000');
    // Le matricule d'une autre entreprise : refusé, avec sa raison ; ni la fiche ni l'entreprise ne changent.
    const avant = await e.fiche();
    const refus = await e.ecrireFiche({ name: 'Pâtisserie Mahdia bis', matricule: '1618033c/a/m/000' });
    expect(refus.statut).toBe(403);
    expect(refus.corps.motif).toBe('Ce matricule fiscal est déjà celui d\'une autre entreprise sur SkanFact : relis-le sur ta carte d\'identification fiscale.');
    // Le refus nomme le matricule (E5) : le point de contact ne refuse que lui, et renvoie le reste.
    expect(refus.corps.champ).toBe('matriculeFiscal');
    expect(await e.fiche()).toEqual(avant);
    expect(await e.auServeur()).toMatchObject({ raison_sociale: 'Pâtisserie Mahdia', matricule_fiscal: '1111111A/A/M/000' });
    // Effacé dans la fiche : l'entreprise n'en a plus.
    expect((await e.ecrireFiche({ matricule: '' })).statut).toBe(200);
    expect((await e.auServeur()).matricule_fiscal).toBeNull();
  });

  it('l\'entreprise d\'essai garde son nom et son matricule, quoi qu\'écrive sa fiche', async () => {
    const e = await entreprise(true);
    const avant = await e.auServeur();
    expect((await e.ecrireFiche({ name: 'Atelier Lumière', matricule: '2222222A/A/M/000' })).statut).toBe(200);
    expect(await e.auServeur()).toEqual(avant);
    expect((await admin.query(`select count(*)::int n from socle.audit where entreprise = $1 and geste = 'socle.entreprise.identite'`, [e.ent])).rows[0].n).toBe(0);
  });
});
