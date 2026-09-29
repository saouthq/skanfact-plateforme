// La déclaration du mois (brique 41 ; docs/cabinet.md, C22 à C24), par l'API et dans la base. Ce que
// le serveur garantit :
//   - une période a UNE déclaration préparée : ses cases (la liste de la v10), en millimes ou vides ;
//     la refaire la remplace, sauf marquée déposée ; une voisine n'en lit rien ;
//   - les deux pense-bêtes : on ne paie pas ce qu'on n'a pas déposé ; dé-pointer le dépôt dé-pointe
//     le paiement, et le dit ;
//   - qui peut : le propriétaire ; au cabinet, l'associé et le collaborateur, si le mandat comprend les
//     déclarations ; jamais l'assistant ; la porte ET la base ;
//   - l'écriture du mois entre au brouillard, datée dans le mois, liée ; la repasser se refuse ; un
//     complément entre sans remplacer le lien ; supprimée ou contre-passée, le lien tombe.

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



type EcritureLue = { id: string; statut: string; revision: number; piece: string | null };
const livres = async (ent: string, p: Personne) => (await appeler('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, p.jeton)).corps.ecritures as EcritureLue[];
type Declaration = { id: string; periode: string; cases: Record<string, string | null>; par: string;
  deposee: { le: string; par: string; reference: string }; payee: { le: string; par: string }; ecriture: string | null };
const declarations = async (ent: string, p: Personne, annee = 2026) => (await appeler('GET', `/entreprises/${ent}/compta/declarations?annee=${annee}`, p.jeton)).corps.declarations as Declaration[];
const preparer = (ent: string, p: Personne, periode: string, cases: Record<string, string | null>) =>
  appeler('PUT', `/entreprises/${ent}/compta/declarations/${periode}`, p.jeton, { cases });
const pointer = (ent: string, p: Personne, periode: string, quoi: string, le: string | null, reference?: string) =>
  appeler('POST', `/entreprises/${ent}/compta/declarations/${periode}/pointer`, p.jeton, { quoi, le, ...(reference ? { reference } : {}) });
// L'écriture de mars aux montants qui discriminent : 190,125 collectée, 50,250 déductible imputée,
// 1,000 de timbre ; 140,875 à décaisser.
const ECRITURE_MARS = {
  date: '2026-03-31', journal: 'OD', piece: 'DECL-2026-03', libelle: 'Déclaration de mars 2026',
  lignes: [
    { compte: '4367', libelle: 'TVA collectée du mois', debit: '190,125' },
    { compte: '4366', libelle: 'TVA déductible imputée', credit: '50,250' },
    { compte: '4368', libelle: 'Timbre fiscal du mois', debit: '1,000' },
    { compte: '4365', libelle: 'À décaisser', credit: '140,875' },
  ],
};
const ecrire = (ent: string, p: Personne, periode: string, ecriture: unknown, complement?: boolean) =>
  appeler('POST', `/entreprises/${ent}/compta/declarations/${periode}/ecriture`, p.jeton, { ecriture, ...(complement === undefined ? {} : { complement }) });

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la déclaration du mois', () => {
  it('une période a une déclaration : ses cases au millime, refaite tant qu\'elle n\'est pas déposée ; on ne paie pas ce qu\'on n\'a pas déposé ; une voisine n\'en lit rien', async () => {
    const d = await dossier();
    expect(await declarations(d.ent, d.collaborateur)).toEqual([]);
    const r = await preparer(d.ent, d.collaborateur, '2026-03', { tvaCollectee: '190,125', tvaDeductible: '50,250', irpp: null });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const [lue] = await declarations(d.ent, d.collaborateur);
    expect(lue).toMatchObject({ id: r.corps.id, periode: '2026-03', cases: { tvaCollectee: '190.125', tvaDeductible: '50.250', irpp: null },
      deposee: { le: '', par: '', reference: '' }, payee: { le: '', par: '' }, ecriture: null });
    // Refaite, elle se remplace : la même, ses nouvelles cases.
    expect((await preparer(d.ent, d.collaborateur, '2026-03', { tvaCollectee: '285,375' })).corps.id).toBe(r.corps.id);
    expect((await declarations(d.ent, d.collaborateur)).map((x) => x.cases)).toEqual([{ tvaCollectee: '285.375' }]);
    // Ce qui ne se lit pas se refuse, nommé.
    const illisible = await preparer(d.ent, d.collaborateur, '2026-03', { tvaCollectee: '12a' });
    expect([illisible.statut, illisible.corps.champ]).toEqual([400, 'cases.tvaCollectee']);
    expect((await preparer(d.ent, d.collaborateur, '2026-03', { autre: '1' } as Record<string, string>)).statut).toBe(400);
    expect([(await preparer(d.ent, d.collaborateur, '2026-13', {})).corps.champ]).toEqual(['periode']);
    // Dans la base aussi : la liste des cases, et des millimes entiers.
    const enBase = (cases: unknown) => enTantQue(pool, d.collaborateur.utilisateur, (tx) => tx.query('select compta.poser_declaration($1, $2, $3::jsonb)', [d.ent, '2026-03', JSON.stringify(cases)]));
    await expect(enBase({ autre: 1 })).rejects.toThrow('la case « autre » n\'est pas une case de la déclaration');
    await expect(enBase({ tvaCollectee: 1.5 })).rejects.toThrow('la case « tvaCollectee » se donne en millimes, ou vide');
    await expect(enBase({ tvaCollectee: '190' })).rejects.toThrow('la case « tvaCollectee » se donne en millimes, ou vide');

    // Les deux pense-bêtes.
    expect((await pointer(d.ent, d.collaborateur, '2026-03', 'payee', '2026-04-25')).corps.motif).toBe('Cette déclaration n\'est pas marquée déposée : on ne paie pas ce qu\'on n\'a pas déposé.');
    expect((await pointer(d.ent, d.collaborateur, '2026-05', 'deposee', '2026-06-20')).corps.motif).toBe('Aucune déclaration préparée pour cette période.');
    expect((await pointer(d.ent, d.collaborateur, '2026-03', 'autre', '2026-04-20')).statut).toBe(400);
    expect((await pointer(d.ent, d.collaborateur, '2026-03', 'deposee', '2026-04-20', 'DM-2026-03-118')).corps).toEqual({ aussiPayee: false });
    expect((await declarations(d.ent, d.collaborateur))[0]?.deposee).toMatchObject({ le: '2026-04-20', reference: 'DM-2026-03-118' });
    // Déposée, elle ne se refait pas : deux chiffres auraient porté le même dépôt.
    expect((await preparer(d.ent, d.collaborateur, '2026-03', { tvaCollectee: '300' })).corps.motif)
      .toBe('La déclaration de 03/2026 est marquée déposée le 20/04/2026 : dé-pointe-la d\'abord si tu veux la refaire — sinon deux chiffres différents auraient porté le même dépôt.');
    expect((await pointer(d.ent, d.collaborateur, '2026-03', 'payee', '2026-04-25')).corps).toEqual({ aussiPayee: false });
    expect((await declarations(d.ent, d.collaborateur))[0]?.payee.le).toBe('2026-04-25');
    // Dé-pointer le dépôt dé-pointe le paiement, et le dit.
    expect((await pointer(d.ent, d.collaborateur, '2026-03', 'deposee', null)).corps).toEqual({ aussiPayee: true });
    expect((await declarations(d.ent, d.collaborateur))[0]).toMatchObject({ deposee: { le: '', reference: '' }, payee: { le: '' } });
    expect((await preparer(d.ent, d.collaborateur, '2026-03', { tvaCollectee: '300' })).statut).toBe(200);
    // Rangée dans son année ; une voisine n'en lit rien, même dans la base.
    expect(await declarations(d.ent, d.collaborateur, 2025)).toEqual([]);
    const voisine = await personne('voisine');
    await appeler('POST', '/entreprises', voisine.jeton, { raisonSociale: 'Quincaillerie voisine' });
    const vus = (qui: Personne) => enTantQue(pool, qui.utilisateur, async (tx) => Number((await tx.query('select count(*) n from compta.declaration where entreprise = $1', [d.ent])).rows[0].n));
    expect([await vus(d.collaborateur), await vus(voisine)]).toEqual([1, 0]);
    // La forme d'un montant copié pour le portail, un réglage du cabinet : l'une des trois.
    const reglage = (formatCopie: string) => appeler('PUT', `/cabinets/${d.cabinet}/reglages`, d.associe.jeton, { contenu: { formatCopie }, revision: null });
    expect((await reglage('dinars')).statut).toBe(400);
    expect((await reglage('virgule')).statut).toBe(200);
  });

  it('qui peut : le propriétaire, l\'associé, le collaborateur si le mandat comprend les déclarations ; jamais l\'assistant ; la porte et la base', async () => {
    const d = await dossier();
    expect((await preparer(d.ent, d.assistant, '2026-03', { tvaCollectee: '1' })).corps.motif)
      .toBe('Ton rôle (Assistant de saisie) ne permet pas de préparer la déclaration du mois, la marquer déposée et payée, en écrire l\'écriture. Peuvent le faire : client.');
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select compta.poser_declaration($1, $2, $3::jsonb)', [d.ent, '2026-03', '{}'])))
      .rejects.toThrow('ton rôle ne permet pas de préparer les déclarations de ce dossier');
    expect((await preparer(d.ent, d.associe, '2026-03', { tvaCollectee: '1' })).statut).toBe(200);
    expect((await preparer(d.ent, d.client, '2026-04', { tvaCollectee: '2' })).statut).toBe(200);
    // La comptabilité sans les déclarations : le cabinet lit les livres et les déclarations, il n'en prépare plus.
    expect((await appeler('PUT', `/entreprises/${d.ent}/mandat/perimetre`, d.client.jeton, { perimetre: ['comptabilite'] })).statut).toBe(200);
    const refus = await preparer(d.ent, d.collaborateur, '2026-03', { tvaCollectee: '3' });
    const horsPerimetre = 'Le mandat de ton cabinet ne comprend pas les déclarations : seul le propriétaire de l\'entreprise peut l\'ouvrir (ici, préparer la déclaration du mois, la marquer déposée et payée, en écrire l\'écriture).';
    expect([refus.statut, refus.corps.motif]).toEqual([403, horsPerimetre]);
    expect((await pointer(d.ent, d.associe, '2026-03', 'deposee', '2026-04-20')).corps.motif).toBe(horsPerimetre);
    // La base le garde aussi, derrière la porte.
    await expect(enTantQue(pool, d.collaborateur.utilisateur, (tx) => tx.query('select compta.pointer_declaration($1, $2, $3, $4::date, $5)', [d.ent, '2026-03', 'deposee', '2026-04-20', ''])))
      .rejects.toThrow('ton rôle ne permet pas de préparer les déclarations de ce dossier');
    expect((await declarations(d.ent, d.collaborateur)).map((x) => x.periode)).toEqual(['2026-03', '2026-04']);
    // Le propriétaire garde la main sur les siennes.
    expect((await pointer(d.ent, d.client, '2026-04', 'deposee', '2026-05-20')).statut).toBe(200);
  });

  it('l\'écriture du mois : au brouillard, datée dans le mois, liée ; la repasser se refuse ; un complément ne remplace pas le lien ; supprimée ou contre-passée, le lien tombe', async () => {
    const d = await dossier();
    expect((await ecrire(d.ent, d.collaborateur, '2026-03', ECRITURE_MARS)).corps.motif).toBe('Prépare la déclaration avant d\'en écrire l\'écriture.');
    await preparer(d.ent, d.collaborateur, '2026-03', { tvaCollectee: '190,125' });
    expect((await ecrire(d.ent, d.collaborateur, '2026-03', { ...ECRITURE_MARS, date: '2026-04-01' })).corps.motif).toBe('L\'écriture de la déclaration de 03/2026 se date dans ce mois.');
    expect((await ecrire(d.ent, d.assistant, '2026-03', ECRITURE_MARS)).statut).toBe(403);
    // L'assistant saisit, mais n'écrit pas une déclaration, même dans la base.
    await expect(enTantQue(pool, d.assistant.utilisateur, (tx) => tx.query('select compta.ecrire_declaration($1, $2, $3::jsonb, false)',
      [d.ent, '2026-03', JSON.stringify({ ...ECRITURE_MARS, lignes: [{ compte: '4367', debit: '190125', credit: '0' }, { compte: '4365', debit: '0', credit: '190125' }] })])))
      .rejects.toThrow('ton rôle ne permet pas de préparer les déclarations de ce dossier');
    const r = await ecrire(d.ent, d.collaborateur, '2026-03', ECRITURE_MARS);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const id = String(r.corps.id);
    expect((await declarations(d.ent, d.collaborateur))[0]?.ecriture).toBe(id);
    expect((await livres(d.ent, d.collaborateur)).map((e) => [e.id, e.statut, e.piece])).toEqual([[id, 'brouillard', 'DECL-2026-03']]);
    expect((await ecrire(d.ent, d.collaborateur, '2026-03', ECRITURE_MARS)).corps.motif)
      .toBe('L\'écriture de cette déclaration existe déjà dans le livre : la repasser compterait la TVA du mois deux fois.');
    // Un complément (une vente saisie après) entre sans remplacer le lien.
    const c = await ecrire(d.ent, d.collaborateur, '2026-03', { ...ECRITURE_MARS, piece: 'DECL-2026-03-C1', lignes: [
      { compte: '4367', debit: '19,000' }, { compte: '4365', credit: '19,000' }] }, true);
    expect(c.statut).toBe(201);
    expect((await declarations(d.ent, d.collaborateur))[0]?.ecriture).toBe(id);
    // Supprimée, le lien tombe, et elle se refait.
    const revision = (await livres(d.ent, d.collaborateur)).find((e) => e.id === id)?.revision;
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/ecritures/${id}?revision=${revision}`, d.collaborateur.jeton)).statut).toBe(200);
    expect((await declarations(d.ent, d.collaborateur))[0]?.ecriture).toBeNull();
    const refaite = String((await ecrire(d.ent, d.collaborateur, '2026-03', ECRITURE_MARS)).corps.id);
    expect((await declarations(d.ent, d.collaborateur))[0]?.ecriture).toBe(refaite);
    // Validée puis contre-passée : le lien ne vaut plus.
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.collaborateur.jeton, { ids: [refaite] })).statut).toBe(200);
    expect((await declarations(d.ent, d.collaborateur))[0]?.ecriture).toBe(refaite);
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/${refaite}/contrepasser`, d.collaborateur.jeton, { date: '2026-03-31' })).statut).toBe(201);
    expect((await declarations(d.ent, d.collaborateur))[0]?.ecriture).toBeNull();
    expect((await ecrire(d.ent, d.collaborateur, '2026-03', ECRITURE_MARS)).statut).toBe(201);
  });
});
