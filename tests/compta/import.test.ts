// Les écritures par tableur (brique 39 bis ; docs/cabinet.md, C18), par l'API et dans la base. Ce que
// le serveur garantit :
//   - un lot : chaque pièce entre, ou remplace un brouillard, à part des autres ; une pièce refusée
//     (déséquilibrée, dans la période validée, un brouillard changé ailleurs) est nommée avec sa raison
//     et ne laisse aucune trace ; les autres entrent quand même ; qui ne saisit pas n'importe rien ;
//   - corriger une validée : sa contre-passation et sa version corrigée au brouillard, d'un geste — les
//     deux, ou rien ; l'assistant ne corrige pas ; une écriture née d'une pièce se corrige dans sa pièce.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
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
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Personne = Awaited<ReturnType<typeof personne>>;

// Un client et son entreprise ; son cabinet, qui accepte le mandat de comptabilité ; un collaborateur
// et un assistant de saisie à qui le dossier est confié.
async function dossier() {
  const client = await personne('client');
  const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
  const associe = await personne('associe');
  const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
  const cabinet = String(c.corps.id);
  const mandat = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: String(c.corps.code) })).corps.mandat);
  await appeler('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe.jeton);
  const membre = async (role: string) => {
    const p = await personne(role);
    const id = String((await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, $3) returning id`, [p.utilisateur, cabinet, [role]])).rows[0].id);
    await appeler('PUT', `/cabinets/${cabinet}/mandats/${mandat}/affectations/${id}`, associe.jeton, { role });
    return p;
  };
  const collaborateur = await membre('revision');
  const assistant = await membre('saisie');
  return { client, ent, associe, cabinet, mandat, collaborateur, assistant };
}

type EcritureLue = { id: string; journal: string; date: string; piece: string | null; libelle: string; statut: string; numero: string | null; revision: number;
  origine: { type: string; id: string }; lignes: { compte: string; debit: string; credit: string }[] };
const livres = async (ent: string, p: Personne) => (await appeler('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, p.jeton)).corps.ecritures as EcritureLue[];
// Une opération diverse aux montants qui discriminent.
const od = (date: string, piece: string, lignes: [string, string, string][]) => ({
  date, journal: 'OD', piece, libelle: `Pièce ${piece}`, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })),
});
const lot = (ent: string, p: Personne, pieces: unknown[]) => appeler('POST', `/entreprises/${ent}/compta/ecritures/lot`, p.jeton, { pieces });
const montants = (e: EcritureLue | undefined) => e?.lignes.map((l) => [l.compte, l.debit, l.credit]);

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les écritures par tableur', () => {
  it('un lot : chaque pièce entre, ou remplace un brouillard, ou est nommée avec sa raison sans laisser de trace ; qui ne saisit pas n\'importe rien', async () => {
    const d = await dossier();
    // Un brouillard de mars, repris une fois ailleurs : sa révision 1 est périmée.
    const b = await appeler('POST', `/entreprises/${d.ent}/compta/ecritures`, d.assistant.jeton, od('2026-03-10', 'OD-1', [['6132', '700', ''], ['532', '', '700']]));
    const idB = String(b.corps.id);
    expect((await appeler('PUT', `/entreprises/${d.ent}/compta/ecritures/${idB}`, d.collaborateur.jeton, { ...od('2026-03-10', 'OD-1', [['6132', '710', ''], ['532', '', '710']]), revision: 1 })).statut).toBe(200);
    // Janvier est validé : rien ne s'y écrit plus.
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/valider`, d.collaborateur.jeton, { jusqua: '2026-01-31' })).statut).toBe(200);

    const r = await lot(d.ent, d.assistant, [
      { ecriture: od('2026-03-12', 'OD-2', [['6226', '350,250', ''], ['401', '', '350,250']]) },
      { ecriture: od('2026-03-13', 'OD-3', [['6061', '100', ''], ['401', '', '90']]) },
      { ecriture: od('2026-03-10', 'OD-1', [['6132', '720,125', ''], ['532', '', '720,125']]), remplace: { id: idB, revision: 1 } },
      { ecriture: od('2026-03-10', 'OD-1', [['6132', '730,500', ''], ['532', '', '730,500']]), remplace: { id: idB, revision: 2 } },
      { ecriture: od('2026-01-15', 'OD-4', [['6132', '5', ''], ['532', '', '5']]) },
    ]);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const res = r.corps.resultats as { statut: string; motif?: string; id?: string; revision?: number }[];
    expect(res.map((x) => x.statut)).toEqual(['ajoutee', 'refusee', 'refusee', 'remplacee', 'refusee']);
    expect(res[1]?.motif).toBe('Débit 100,000 ≠ crédit 90,000 : l\'écriture ne tombe pas juste.');
    expect(res[2]?.motif).toBe('Ce brouillard a été changé ailleurs entre-temps : recharge-le, rien n\'a été enregistré.');
    expect(res[3]).toMatchObject({ id: idB, revision: 3 });
    expect(res[4]?.motif).toBe('La période est validée jusqu\'au 31/01/2026 : une écriture ne s\'y écrit plus.');

    // Les refusées n'ont laissé aucune trace ; les autres sont entrées, au brouillard.
    const apres = await livres(d.ent, d.collaborateur);
    expect(apres.map((e) => [e.piece, e.statut]).sort()).toEqual([['OD-1', 'brouillard'], ['OD-2', 'brouillard']]);
    expect(montants(apres.find((e) => e.piece === 'OD-2'))).toEqual([['6226', '350.250', '0.000'], ['401', '0.000', '350.250']]);
    expect(montants(apres.find((e) => e.piece === 'OD-1'))).toEqual([['6132', '730.500', '0.000'], ['532', '0.000', '730.500']]);

    // Qui ne saisit pas n'importe rien ; un lot se borne à cinq cents pièces.
    const lecteur = await personne('lecture');
    const inv = String((await appeler('POST', `/entreprises/${d.ent}/invitations`, d.client.jeton, { email: lecteur.email, roles: ['lecture'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', lecteur.jeton, { jeton: inv });
    expect((await lot(d.ent, lecteur, [{ ecriture: od('2026-03-20', 'OD-5', [['6132', '1', ''], ['532', '', '1']]) }])).statut).toBe(403);
    const trop = await lot(d.ent, d.assistant, Array.from({ length: 501 }, (_, i) => ({ ecriture: od('2026-03-20', `L-${i}`, [['6132', '1', ''], ['532', '', '1']]) })));
    expect([trop.statut, trop.corps.champ]).toEqual([400, 'pieces']);
    expect((await livres(d.ent, d.collaborateur)).length).toBe(2);
  });

  it('corriger une validée : sa contre-passation et sa version corrigée, d\'un geste, ou rien ; l\'assistant ne corrige pas ; une écriture née d\'une pièce se corrige dans sa pièce', async () => {
    const d = await dossier();
    const v = String((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures`, d.assistant.jeton, od('2026-04-05', 'OD-9', [['6132', '500', ''], ['532', '', '500']]))).corps.id);
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.collaborateur.jeton, { ids: [v] })).statut).toBe(200);
    const corrigee = od('2026-04-05', 'OD-9', [['6132', '550,750', ''], ['532', '', '550,750']]);
    const corriger = (p: Personne, id: string, corps: unknown) => appeler('POST', `/entreprises/${d.ent}/compta/ecritures/${id}/corriger`, p.jeton, corps);

    expect((await corriger(d.assistant, v, { date: '2026-04-30', ecriture: corrigee })).corps.motif).toMatch(/^Ton rôle \(Assistant de saisie\) ne permet pas de valider/);
    const r = await corriger(d.collaborateur, v, { date: '2026-04-30', ecriture: corrigee });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(r.corps.miroir).toMatchObject({ date: '2026-04-30' });
    const apres = await livres(d.ent, d.collaborateur);
    // La validée ne bouge pas ; son miroir est validé ; la version corrigée attend au brouillard.
    expect(montants(apres.find((e) => e.id === v))).toEqual([['6132', '500.000', '0.000'], ['532', '0.000', '500.000']]);
    expect(apres.find((e) => e.origine.type === 'contre_passation' && e.origine.id === v)).toMatchObject({ statut: 'validee', date: '2026-04-30' });
    expect(apres.find((e) => e.id === r.corps.id)).toMatchObject({ statut: 'brouillard', piece: 'OD-9' });
    expect(montants(apres.find((e) => e.id === r.corps.id))).toEqual([['6132', '550.750', '0.000'], ['532', '0.000', '550.750']]);
    // Une version corrigée qui ne tombe pas juste : rien n'est fait — ni le miroir, ni la version.
    const w = String((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures`, d.assistant.jeton, od('2026-04-06', 'OD-10', [['6132', '300', ''], ['532', '', '300']]))).corps.id);
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.collaborateur.jeton, { ids: [w] })).statut).toBe(200);
    const avant = (await livres(d.ent, d.collaborateur)).length;
    const bancale = await corriger(d.collaborateur, w, { ecriture: od('2026-04-06', 'OD-10', [['6132', '1', ''], ['532', '', '2']]) });
    expect(bancale.corps.motif).toBe('Débit 1,000 ≠ crédit 2,000 : l\'écriture ne tombe pas juste.');
    const toujours = await livres(d.ent, d.collaborateur);
    expect(toujours.length).toBe(avant);
    expect(toujours.filter((e) => e.origine.type === 'contre_passation' && e.origine.id === w)).toEqual([]);

    // L'achat du client, validé : il se corrige dans sa pièce, jamais par le tableur.
    await appeler('GET', `/entreprises/${d.ent}/dossier-v10`, d.client.jeton);
    const envoyer = (collection: string, cle: string, contenu: unknown) =>
      appeler('POST', `/entreprises/${d.ent}/dossier-v10`, d.client.jeton, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    await envoyer('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-04-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
    });
    const achat = (await livres(d.ent, d.collaborateur)).find((e) => e.origine.type === 'achat');
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.collaborateur.jeton, { ids: [achat?.id] })).statut).toBe(200);
    const n = (await livres(d.ent, d.collaborateur)).length;
    const refus = await corriger(d.collaborateur, String(achat?.id), { ecriture: od('2026-04-03', 'FF-1', [['6064', '1000', ''], ['401', '', '1000']]) });
    expect(refus.statut).toBe(403);
    expect(String(refus.corps.motif)).toMatch(/pièce/);
    expect((await livres(d.ent, d.collaborateur)).length).toBe(n);
  });
});
