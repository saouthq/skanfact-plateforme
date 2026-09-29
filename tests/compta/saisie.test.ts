// La saisie dans les livres du serveur (brique 38 ; docs/cabinet.md), par l'API et dans la base.
// Ce que le serveur garantit :
//   - une écriture saisie entre au brouillard, avec les contrôles de la v10 (deux lignes, un côté par
//     ligne, un compte en chiffres, l'équilibre, un libellé) et jamais dans la période close ; elle se
//     modifie et se supprime tant qu'elle n'est pas validée, et jamais par-dessus un autre poste ;
//   - une écriture née d'une pièce de l'entreprise ne se change pas dans les livres ;
//   - valider une écriture ou un lot : le numéro de son journal, le maillon de la chaîne ; une
//     écriture refusée est nommée et ne troue pas la numérotation ;
//   - contre-passer et extourner une écriture saisie : le miroir validé, jamais dans la période close ;
//   - lettrer des écritures validées dont la somme fait zéro ; délettrer ;
//   - qui fait quoi (03 § 2.1 et § 3.1), à la porte ET dans la base ;
//   - les mois du portefeuille : ce que disent les livres (deux chemins, un chiffre).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
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

// Un client, son entreprise et un achat du 3 août (une écriture née d'une pièce) ; son cabinet, qui
// accepte le mandat de comptabilité ; un collaborateur et un assistant de saisie à qui le dossier
// est confié.
async function dossier() {
  const client = await personne('client');
  const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
  await appeler('GET', `/entreprises/${ent}/dossier-v10`, client.jeton);
  const envoyer = (collection: string, cle: string, contenu: unknown) =>
    appeler('POST', `/entreprises/${ent}/dossier-v10`, client.jeton, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
  await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
  await envoyer('purchases', 'a1', {
    id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
    tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
  });
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

type Ligne = { compte: string; libelle: string; debit: string; credit: string; tiers: string | null; lettre: string | null };
type EcritureLue = { id: string; journal: string; date: string; piece: string | null; libelle: string; statut: string; numero: string | null; chaine: number | null;
  origine: { type: string; id: string }; revision: number; lignes: Ligne[] };
async function livres(ent: string, p: Personne): Promise<EcritureLue[]> {
  return (await appeler('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, p.jeton)).corps.ecritures as EcritureLue[];
}
const od = (date: string, lignes: [string, string, string][], extra: Record<string, unknown> = {}) => ({
  date, journal: 'OD', piece: 'OD-1', libelle: 'Régularisation', ...extra,
  lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })),
});
const saisir = async (ent: string, p: Personne, corps: unknown) => {
  const r = await appeler('POST', `/entreprises/${ent}/compta/ecritures`, p.jeton, corps);
  expect(r.statut, JSON.stringify(r.corps)).toBe(201);
  return String(r.corps.id);
};
const valider = (ent: string, p: Personne, ids: string[]) => appeler('POST', `/entreprises/${ent}/compta/ecritures/valider`, p.jeton, { ids });
const auJour = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la saisie dans les livres du serveur', () => {
  it('saisir au brouillard avec les contrôles de la v10, modifier sans écraser un autre poste, supprimer ; une écriture née d\'une pièce ne se change pas', async () => {
    const d = await dossier();
    // L'assistant saisit une OD : elle entre au brouillard, sans numéro ; une ligne sans libellé
    // prend celui de l'écriture ; le tiers de la ligne est gardé.
    const id = await saisir(d.ent, d.assistant, {
      date: '2026-08-20', journal: 'OD', piece: 'OD-1', libelle: 'Loyer d\'août',
      lignes: [{ compte: '6132', debit: '850,500' }, { compte: '401', credit: '850.5', libelle: 'Agence du Lac', tiers: 'Agence du Lac' }],
    });
    let lue = (await livres(d.ent, d.client)).find((e) => e.id === id);
    expect(lue).toMatchObject({ statut: 'brouillard', numero: null, origine: { type: 'saisie', id }, revision: 1, libelle: 'Loyer d\'août' });
    expect(lue?.lignes).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), compte: '6132', libelle: 'Loyer d\'août', debit: '850.500', credit: '0.000', tauxTva: null, tiers: null, lettre: null },
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), compte: '401', libelle: 'Agence du Lac', debit: '0.000', credit: '850.500', tauxTva: null, tiers: 'Agence du Lac', lettre: null },
    ]);
    // Les contrôles de la v10, chacun avec sa phrase et le numéro de sa ligne.
    const refus = async (corps: unknown) => (await appeler('POST', `/entreprises/${d.ent}/compta/ecritures`, d.assistant.jeton, corps)).corps.motif;
    expect(await refus(od('2026-08-20', [['6132', '10', ''], ['401', '', '9']]))).toBe('Débit 10,000 ≠ crédit 9,000 : l\'écriture ne tombe pas juste.');
    expect(await refus(od('2026-08-20', [['6132', '10', '']]))).toBe('Une écriture a au moins deux lignes.');
    expect(await refus(od('2026-08-20', [['6132', '10', ''], ['4O1', '', '10']]))).toBe('Ligne 2 : le compte doit être un numéro.');
    expect(await refus(od('2026-08-20', [['6132', '10', '10'], ['401', '', '10']]))).toBe('Ligne 1 : une ligne va au débit ou au crédit, pas les deux.');
    expect(await refus(od('2026-08-20', [['6132', '10', ''], ['401', '', '']]))).toBe('Ligne 2 : aucun montant.');
    expect(await refus(od('2026-08-20', [['6132', '10', ''], ['401', '', '10']], { libelle: '' }))).toBe('Le libellé manque : écris-le sur la pièce ou sur une ligne.');
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures`, d.assistant.jeton, od('2026-08-20', [['6132', '-10', ''], ['401', '', '-10']]))).statut).toBe(400);

    // Modifier : la révision vue ; un autre poste qui n'a pas relu est refusé, rien n'est écrasé.
    const modifier = (p: Personne, revision: number, corps: Record<string, unknown>) =>
      appeler('PUT', `/entreprises/${d.ent}/compta/ecritures/${id}`, p.jeton, { ...corps, revision });
    const m = await modifier(d.collaborateur, 1, od('2026-08-21', [['6132', '900', ''], ['401', '', '900']], { libelle: 'Loyer d\'août (corrigé)' }));
    expect(m.corps).toEqual({ id, revision: 2 });
    const perime = await modifier(d.assistant, 1, od('2026-08-20', [['6132', '1', ''], ['401', '', '1']]));
    expect(perime.statut).toBe(409);
    expect(perime.corps.motif).toBe('Ce brouillard a été changé ailleurs entre-temps : recharge-le, rien n\'a été enregistré.');
    lue = (await livres(d.ent, d.client)).find((e) => e.id === id);
    expect(lue).toMatchObject({ date: '2026-08-21', revision: 2, libelle: 'Loyer d\'août (corrigé)' });
    expect(lue?.lignes.map((l) => l.debit)).toEqual(['900.000', '0.000']);

    // L'écriture née de l'achat suit sa pièce : ni modifiée, ni supprimée dans les livres.
    const achat = (await livres(d.ent, d.client)).find((e) => e.origine.type === 'achat');
    expect(achat).toBeDefined();
    const surAchat = await appeler('PUT', `/entreprises/${d.ent}/compta/ecritures/${achat?.id}`, d.collaborateur.jeton,
      { ...od('2026-08-03', [['6061', '1', ''], ['401', '', '1']]), revision: 1 });
    expect(surAchat.corps.motif).toBe('Cette écriture vient d\'une pièce de l\'entreprise : elle suit sa pièce, elle ne se change pas dans les livres.');
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/ecritures/${achat?.id}?revision=1`, d.collaborateur.jeton)).statut).toBe(403);

    // Supprimer : avec la révision vue, sinon refusé.
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/ecritures/${id}?revision=1`, d.assistant.jeton)).statut).toBe(409);
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/ecritures/${id}?revision=2`, d.assistant.jeton)).statut).toBe(200);
    expect((await livres(d.ent, d.client)).some((e) => e.id === id)).toBe(false);

    // La période validée est close : on n'y saisit plus.
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/valider`, d.associe.jeton, { jusqua: '2026-08-31' })).statut).toBe(200);
    expect(await refus(od('2026-08-15', [['6132', '10', ''], ['401', '', '10']])))
      .toBe('La période est validée jusqu\'au 31/08/2026 : une écriture ne s\'y écrit plus.');

    // La trace dit qui a saisi, modifié, supprimé.
    const traces = (await admin.query(`select geste, utilisateur from socle.audit where entreprise = $1 and objet_id = $2 order by instant, id`, [d.ent, id])).rows;
    expect(traces).toEqual([
      { geste: 'compta.ecriture.saisir', utilisateur: d.assistant.utilisateur },
      { geste: 'compta.ecriture.modifier', utilisateur: d.collaborateur.utilisateur },
      { geste: 'compta.ecriture.supprimer', utilisateur: d.assistant.utilisateur },
    ]);
  });

  it('qui saisit : la comptabilité de l\'entreprise et tout le cabinet ; ni la lecture, ni un cabinet sans la comptabilité, ni dans la base', async () => {
    const d = await dossier();
    expect(await saisir(d.ent, d.client, od('2026-08-20', [['6132', '10', ''], ['401', '', '10']]))).toMatch(/^[0-9a-f-]{36}$/);
    const lecteur = await personne('lecture');
    const inv = String((await appeler('POST', `/entreprises/${d.ent}/invitations`, d.client.jeton, { email: lecteur.email, roles: ['lecture'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', lecteur.jeton, { jeton: inv });
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures`, lecteur.jeton, od('2026-08-20', [['6132', '10', ''], ['401', '', '10']]))).statut).toBe(403);
    await expect(enTantQue(pool, lecteur.utilisateur, (tx) => tx.query('select compta.saisir($1, $2::jsonb)',
      [d.ent, JSON.stringify(od('2026-08-20', [['6132', '10000', '0'], ['401', '0', '10000']]))]))).rejects.toThrow(/ne permet pas de saisir/);
    // Sans la comptabilité dans le mandat, le cabinet ne saisit plus, même dans la base.
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['paie'] })).statut).toBe(200);
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select compta.saisir($1, $2::jsonb)',
      [d.ent, JSON.stringify(od('2026-08-20', [['6132', '10000', '0'], ['401', '0', '10000']]))]))).rejects.toThrow(/entreprise introuvable|ne permet pas/);
  });

  it('valider une écriture ou un lot : le numéro de son journal et le maillon de la chaîne ; une écriture datée de demain est nommée sans trouer la numérotation ; l\'assistant et le client ne valident pas', async () => {
    const d = await dossier();
    const a = await saisir(d.ent, d.assistant, od('2026-08-20', [['6132', '10', ''], ['401', '', '10']]));
    const b = await saisir(d.ent, d.assistant, od('2026-08-21', [['6132', '20', ''], ['401', '', '20']]));
    const demain = new Date(Date.now() + 2 * 86_400_000);
    const futur = await saisir(d.ent, d.assistant, od(auJour(demain), [['6132', '30', ''], ['401', '', '30']]));
    // Ni l'assistant (à la porte, qui nomme son rôle, et dans la base), ni le client qui a confié sa
    // comptabilité.
    const refusAssistant = await valider(d.ent, d.assistant, [a]);
    expect(refusAssistant.statut).toBe(403);
    expect(String(refusAssistant.corps.motif)).toMatch(/ton rôle \(Assistant de saisie\)/i);
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select * from compta.valider_ecritures($1, $2::uuid[])', [d.ent, [a]])))
      .rejects.toThrow(/ne permet pas de valider/);
    expect((await valider(d.ent, d.client, [a])).corps.motif).toBe('Avec un mandat de comptabilité, c\'est le cabinet qui valide les écritures.');
    // Le collaborateur valide le lot : dans l'ordre des dates, sans trou ; l'écriture de demain est nommée.
    const r = await valider(d.ent, d.collaborateur, [futur, b, a]);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const validees = r.corps.validees as { id: string; numero: string; chaine: number }[];
    expect(validees.map((v) => [v.id, v.numero])).toEqual([[a, 'OD-2026-000001'], [b, 'OD-2026-000002']]);
    expect(validees.map((v) => v.chaine - (validees[0]?.chaine ?? 0))).toEqual([0, 1]);
    expect(r.corps.refusees).toEqual([{ id: futur, motif: `Elle est datée du ${auJour(demain).split('-').reverse().join('/')} : une écriture ne se valide pas avant son jour.` }]);
    // Validée : ni revalidée, ni modifiée, ni supprimée ; qui et quand sont écrits.
    expect(((await valider(d.ent, d.collaborateur, [a])).corps.refusees as unknown[])).toEqual([{ id: a, motif: 'Cette écriture est déjà validée : elle se contre-passe, elle ne se revalide pas.' }]);
    expect((await appeler('PUT', `/entreprises/${d.ent}/compta/ecritures/${a}`, d.collaborateur.jeton, { ...od('2026-08-20', [['6132', '1', ''], ['401', '', '1']]), revision: 1 })).corps.motif)
      .toBe('Une écriture validée ne se modifie pas : elle se contre-passe.');
    const qui = (await admin.query('select validee_par, validee_le is not null le from compta.ecriture where id = $1', [a])).rows[0];
    expect(qui).toEqual({ validee_par: d.collaborateur.utilisateur, le: true });
    // Les livres se contrôlent : la chaîne, et chaque écriture validée recalculée.
    expect((await appeler('GET', `/entreprises/${d.ent}/compta/cloture`, d.associe.jeton)).corps.controle).toEqual({ ok: true, numero: null, motif: null });
    // Une écriture inconnue est nommée, rien d'autre ne bouge.
    const inconnue = '00000000-0000-7000-8000-000000000009';
    expect((await valider(d.ent, d.collaborateur, [inconnue])).corps).toEqual({ validees: [], refusees: [{ id: inconnue, motif: 'Cette écriture n\'existe pas.' }] });
  });

  it('contre-passer et extourner une écriture saisie : le miroir validé, jamais dans la période close ; une écriture née d\'une pièce se corrige dans sa pièce', async () => {
    const d = await dossier();
    const x = await saisir(d.ent, d.assistant, od('2026-08-20', [['6132', '850,5', ''], ['401', '', '850,5']], { libelle: 'Loyer' }));
    const provision = await saisir(d.ent, d.assistant, od('2026-07-31', [['6226', '300', ''], ['4286', '', '300']], { libelle: 'Honoraires à payer' }));
    await valider(d.ent, d.collaborateur, [x, provision]);
    const numeroX = (await livres(d.ent, d.client)).find((e) => e.id === x)?.numero;
    const contrepasser = (id: string, p: Personne, date?: string) => appeler('POST', `/entreprises/${d.ent}/compta/ecritures/${id}/contrepasser`, p.jeton, date ? { date } : {});
    // Un brouillard ne se contre-passe pas ; l'avenir non plus ; l'assistant ne contre-passe pas.
    const brouillard = await saisir(d.ent, d.assistant, od('2026-08-22', [['6132', '1', ''], ['401', '', '1']]));
    expect((await contrepasser(brouillard, d.collaborateur)).corps.motif).toBe('Une écriture en brouillard se modifie : elle n\'a pas besoin d\'être contre-passée.');
    expect((await contrepasser(x, d.collaborateur, auJour(new Date(Date.now() + 3 * 86_400_000)))).corps.motif).toBe('Une contre-passation ne se date pas dans l\'avenir.');
    expect((await contrepasser(x, d.assistant)).statut).toBe(403);
    // La période validée jusqu'au 31 août : le miroir demandé au 25 août tombe au premier jour ouvert.
    await appeler('POST', `/entreprises/${d.ent}/compta/valider`, d.associe.jeton, { jusqua: '2026-08-31' });
    const cp = await contrepasser(x, d.collaborateur, '2026-08-25');
    expect(cp.statut, JSON.stringify(cp.corps)).toBe(201);
    expect(cp.corps).toMatchObject({ date: '2026-09-01', numero: 'OD-2026-000004' });
    const miroir = (await livres(d.ent, d.client)).find((e) => e.id === cp.corps.id);
    expect(miroir).toMatchObject({ statut: 'validee', libelle: `Contre-passation de ${numeroX}`, origine: { type: 'contre_passation', id: x } });
    expect(miroir?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['6132', '0.000', '850.500'], ['401', '850.500', '0.000']]);
    expect((await contrepasser(x, d.collaborateur)).corps.motif).toBe('Cette écriture a déjà été contre-passée.');
    expect((await contrepasser(String(cp.corps.id), d.collaborateur)).corps.motif).toBe('C\'est déjà une contre-passation : pour rétablir l\'écriture, saisis-la de nouveau.');
    // L'écriture de l'achat (validée avec la période) se corrige dans la pièce.
    const achat = (await livres(d.ent, d.client)).find((e) => e.origine.type === 'achat');
    expect((await contrepasser(String(achat?.id), d.collaborateur)).corps.motif)
      .toBe('Cette écriture vient d\'une pièce de l\'entreprise : elle se corrige dans la pièce, et le serveur la contre-passe alors lui-même.');
    // L'extourne de la provision de juillet tomberait le 1er août, dans la période validée : refusée.
    const extourner = (id: string) => appeler('POST', `/entreprises/${d.ent}/compta/ecritures/${id}/extourner`, d.collaborateur.jeton, {});
    expect((await extourner(provision)).corps.motif).toBe('Son extourne tomberait le 01/08/2026, dans la période validée : saisis-la au premier jour ouvert.');
    // Une provision de septembre s'extourne au 1er octobre, validée d'un geste ; une seule fois.
    const sept = await saisir(d.ent, d.assistant, od('2026-09-15', [['6226', '120', ''], ['4286', '', '120']], { libelle: 'Honoraires de septembre' }));
    await valider(d.ent, d.collaborateur, [sept]);
    const ex = await extourner(sept);
    expect(ex.statut, JSON.stringify(ex.corps)).toBe(201);
    expect(ex.corps).toMatchObject({ date: '2026-10-01' });
    const miroirEx = (await livres(d.ent, d.client)).find((e) => e.id === ex.corps.id);
    expect(miroirEx).toMatchObject({ statut: 'validee', origine: { type: 'extourne', id: sept } });
    expect(miroirEx?.libelle).toMatch(/^Extourne de OD-2026-\d{6}$/);
    expect((await extourner(sept)).corps.motif).toBe('Cette écriture a déjà été extournée.');
    expect((await extourner(x)).corps.motif).toBe('Cette écriture a été contre-passée : elle ne compte plus, il n\'y a rien à extourner.');
    expect((await extourner(String(achat?.id))).corps.motif).toBe('On extourne une écriture saisie dans les livres : une écriture née d\'une pièce suit sa pièce.');
    // Ce que les deux gestes ont posé se tient : le loyer contre-passé ne compte plus (850,500 − 850,500),
    // il ne reste au 6132 que le brouillard d'un dinar, validé avec la période ; la chaîne est intacte.
    const bal = (await appeler('GET', `/entreprises/${d.ent}/compta/balance?du=2026-01-01&au=2026-12-31`, d.client.jeton)).corps.comptes as { compte: string; solde: string }[];
    expect(bal.find((c) => c.compte === '6132')?.solde).toBe('1.000');
    expect(bal.find((c) => c.compte === '6226')?.solde).toBe('300.000');
    expect((await appeler('GET', `/entreprises/${d.ent}/compta/cloture`, d.associe.jeton)).corps.controle).toEqual({ ok: true, numero: null, motif: null });
  });

  it('lettrer une facture et son règlement : la somme fait zéro, sinon l\'écart est dit ; un brouillard ne se lettre pas ; délettrer', async () => {
    const d = await dossier();
    const facture = await saisir(d.ent, d.assistant, { date: '2026-08-05', journal: 'VT', piece: 'F-12', libelle: 'Facture F-12', lignes: [{ compte: '411', debit: '1190' }, { compte: '706', credit: '1190' }] });
    const partiel = await saisir(d.ent, d.assistant, { date: '2026-08-10', journal: 'BQ', libelle: 'Acompte F-12', lignes: [{ compte: '532', debit: '500' }, { compte: '411', credit: '500' }] });
    const solde = await saisir(d.ent, d.assistant, { date: '2026-08-20', journal: 'BQ', libelle: 'Solde F-12', lignes: [{ compte: '532', debit: '690' }, { compte: '411', credit: '690' }] });
    const lettrer = (p: Personne, ecritures: string[], lettre?: string) => appeler('POST', `/entreprises/${d.ent}/compta/lettrages`, p.jeton, { compte: '411', ecritures, ...(lettre ? { lettre } : {}) });
    expect((await lettrer(d.collaborateur, [facture, partiel])).corps.motif).toBe('On lettre des écritures validées : un brouillard peut encore changer.');
    await valider(d.ent, d.collaborateur, [facture, partiel, solde]);
    expect((await lettrer(d.collaborateur, [facture, partiel])).corps.motif).toBe('Ces écritures ne se soldent pas : il reste 690,000.');
    expect((await lettrer(d.collaborateur, [facture])).corps.motif).toBe('Le lettrage relie au moins deux écritures : une facture et son règlement.');
    const refusAssistant = await lettrer(d.assistant, [facture, partiel, solde]);
    expect(refusAssistant.statut).toBe(403);
    expect(String(refusAssistant.corps.motif)).toMatch(/ton rôle \(Assistant de saisie\)/i);
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select compta.lettrer($1, $2, $3::uuid[], null)', [d.ent, '411', [facture, partiel, solde]])))
      .rejects.toThrow(/ne permet pas de lettrer/);
    const l = await lettrer(d.collaborateur, [facture, partiel, solde]);
    expect(l.statut, JSON.stringify(l.corps)).toBe(201);
    expect(l.corps.lettre).toBe('A');
    // La lettre est sur les lignes du 411, et seulement elles.
    const lues = (await livres(d.ent, d.client)).filter((e) => [facture, partiel, solde].includes(e.id));
    expect(lues.flatMap((e) => e.lignes.map((x) => `${x.compte}:${x.lettre ?? ''}`)).sort()).toEqual(['411:A', '411:A', '411:A', '532:', '532:', '706:']);
    expect((await lettrer(d.collaborateur, [facture, solde])).corps.motif).toBe('Une de ces lignes est déjà lettrée : délettre-la d\'abord.');
    // Délettrer, puis relettrer sous une lettre choisie.
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/lettrages/A`, d.collaborateur.jeton)).statut).toBe(200);
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/lettrages/A`, d.collaborateur.jeton)).corps.motif).toBe('Ce lettrage n\'existe pas.');
    expect((await livres(d.ent, d.client)).flatMap((e) => e.lignes).some((x) => x.lettre)).toBe(false);
    expect((await lettrer(d.collaborateur, [facture, partiel, solde], 'f')).corps.lettre).toBe('F');
    const autre = await saisir(d.ent, d.assistant, { date: '2026-08-06', journal: 'VT', libelle: 'Facture F-13', lignes: [{ compte: '411', debit: '10' }, { compte: '706', credit: '10' }] });
    const reg = await saisir(d.ent, d.assistant, { date: '2026-08-07', journal: 'BQ', libelle: 'Règlement F-13', lignes: [{ compte: '532', debit: '10' }, { compte: '411', credit: '10' }] });
    await valider(d.ent, d.collaborateur, [autre, reg]);
    expect((await lettrer(d.collaborateur, [autre, reg], 'F')).corps.motif).toBe('La lettre F est déjà prise.');
    // Deux postes lettrent les mêmes écritures au même instant : le premier a posé sa lettre et n'a pas
    // encore fini quand le second arrive. Le second attend, puis lit sa phrase (jamais une erreur de
    // doublon) ; le premier garde sa lettre.
    let liberer: () => void = () => {};
    const garde = new Promise<void>((r) => { liberer = r; });
    let premierPose: () => void = () => {};
    const pose = new Promise<void>((r) => { premierPose = r; });
    const lettrerEnBase = (tx: Parameters<Parameters<typeof enTantQue>[2]>[0]) =>
      tx.query('select compta.lettrer($1, $2, $3::uuid[], null) lettre', [d.ent, '411', [autre, reg]]);
    const premier = enTantQue(pool, d.collaborateur.utilisateur, async (tx) => {
      const r = await lettrerEnBase(tx);
      premierPose();
      await garde;
      return r.rows[0].lettre as string;
    });
    await pose;
    const second = enTantQue(pool, d.associe.utilisateur, lettrerEnBase).then(() => 'passé', (e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 300));
    liberer();
    expect(await premier).toMatch(/^[A-Z]+$/);
    expect(await second).toBe('une de ces lignes est déjà lettrée : délettre-la d\'abord');
  });

  it('les mois du portefeuille disent ce que disent les livres : écritures, brouillards, chiffre d\'affaires (deux chemins, un chiffre)', async () => {
    const d = await dossier();
    const f = await saisir(d.ent, d.assistant, { date: '2026-08-05', journal: 'VT', libelle: 'Facture F-12', lignes: [{ compte: '411', debit: '1428' }, { compte: '7061', credit: '1200,250' }, { compte: '4367', credit: '227,750' }] });
    await saisir(d.ent, d.assistant, { date: '2026-08-06', journal: 'VT', libelle: 'Avoir A-1', lignes: [{ compte: '706', debit: '100,125' }, { compte: '411', credit: '100,125' }] });
    await saisir(d.ent, d.assistant, { date: '2026-09-02', journal: 'OD', libelle: 'Loyer', lignes: [{ compte: '6132', debit: '10' }, { compte: '401', credit: '10' }] });
    await valider(d.ent, d.collaborateur, [f]);
    const mois = (p: Personne, cabinet = d.cabinet) => appeler('GET', `/cabinets/${cabinet}/mois?depuis=2026-01-01`, p.jeton);
    const lus = (await mois(d.associe)).corps.mois as { entreprise: string; mois: string; ecritures: number; brouillards: number; ca: string }[];
    expect(lus.map((x) => [x.mois, x.ecritures, x.brouillards, x.ca])).toEqual([['2026-08', 3, 2, '1100.125'], ['2026-09', 1, 1, '0.000']]);
    // Le même chiffre que la balance d'août, comptes 70.
    const bal = (await appeler('GET', `/entreprises/${d.ent}/compta/balance?du=2026-08-01&au=2026-08-31`, d.client.jeton)).corps.comptes as { compte: string; debit: string; credit: string }[];
    const ca = bal.filter((c) => c.compte.startsWith('70')).reduce((s, c) => s + BigInt(c.credit.replace('.', '')) - BigInt(c.debit.replace('.', '')), 0n);
    expect(lus[0]?.ca.replace('.', '')).toBe(ca.toString());
    // Chacun ne voit que ses dossiers ; la date se refuse mal écrite.
    const seul = await personne('associe');
    const autre = String((await appeler('POST', '/cabinets', seul.jeton, { nom: 'Autre cabinet' })).corps.id);
    expect((await mois(seul, autre)).corps.mois).toEqual([]);
    expect((await mois(seul)).corps.mois).toEqual([]);
    expect((await appeler('GET', `/cabinets/${d.cabinet}/mois?depuis=2026-01-15`, d.associe.jeton)).statut).toBe(400);
  });
});
