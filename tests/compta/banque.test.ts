// La banque (brique 40 ; docs/cabinet.md, C19 à C21), par l'API et dans la base. Ce que le serveur
// garantit :
//   - un relevé s'importe s'il se boucle (solde de début + mouvements = solde de fin), une fois (son
//     empreinte), avec son compte ; ses lignes se lisent au millime ; une voisine n'en lit rien ;
//   - un rapprochement lie une ligne du relevé à UNE ligne d'écriture du même compte ; une ligne
//     d'écriture ne répond que d'une ligne ; un brouillard qui change fait tomber son rapprochement ;
//     le jugement de l'automatique se garde ; tout se défait, et le relevé se retire sans toucher aux
//     écritures ;
//   - les réglages du cabinet (banques, mots retenus) : leurs champs, et rien d'autre ; jamais écrasés.

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


type EcritureLue = { id: string; journal: string; date: string; piece: string | null; statut: string; revision: number;
  lignes: { id: string; compte: string; debit: string; credit: string }[] };
const livres = async (ent: string, p: Personne) => (await appeler('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, p.jeton)).corps.ecritures as EcritureLue[];
type Releve = { id: string; compte: string; du: string; au: string; soldeDebut: string; soldeFin: string;
  lignes: { id: string; montant: string; niveau: string; rapprochement: { ligne: string; ecriture: string; rang: number; niveau: string; auto: boolean } | null }[] };
const releves = async (ent: string, p: Personne, annee = 2026) => (await appeler('GET', `/entreprises/${ent}/compta/releves?annee=${annee}`, p.jeton)).corps.releves as Releve[];
// Un relevé de mars aux montants qui discriminent : 10 000,500 + 1 190,250 − 85,125 − 700,000 = 10 405,625.
const MARS = {
  annee: 2026, compte: '532', banque: 'BIAT', fichier: 'releve-mars.csv', empreinte: 'a'.repeat(64), soldeDebut: '10000,500', soldeFin: '10405,625',
  lignes: [
    { date: '2026-03-02', libelle: 'VIR CLIENT DUPONT', reference: 'R1', montant: '1190,250' },
    { date: '2026-03-05', libelle: 'PRLV STEG', montant: '-85,125' },
    { date: '2026-03-10', libelle: 'CHQ 1234', montant: '-700' },
  ],
};
const importer = (ent: string, p: Personne, corps: unknown) => appeler('POST', `/entreprises/${ent}/compta/releves`, p.jeton, corps);
const saisir = async (ent: string, p: Personne, date: string, piece: string, lignes: [string, string, string][]) =>
  String((await appeler('POST', `/entreprises/${ent}/compta/ecritures`, p.jeton, { date, journal: 'BQ', piece, libelle: `Pièce ${piece}`, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) })).corps.id);

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la banque', () => {
  it('un relevé s\'importe s\'il se boucle, une fois, avec son compte ; ses lignes se lisent au millime ; une voisine n\'en lit rien', async () => {
    const d = await dossier();
    expect((await importer(d.ent, d.assistant, { ...MARS, soldeFin: '10405' })).corps.motif)
      .toBe('Ce relevé ne se boucle pas : 10 000,500 au départ, 405,125 de mouvements, cela fait 10 405,625 — et le relevé annonce 10 405,000. Il manque 0,625 : il manque des lignes, ou le solde de fin n\'est pas le bon.');
    expect((await importer(d.ent, d.assistant, { ...MARS, compte: '' })).corps.motif).toBe('Choisis le compte bancaire de ce relevé avant de l\'importer : il ne se devine pas.');
    expect((await importer(d.ent, d.assistant, { ...MARS, lignes: [] })).corps.motif).toBe('Ce relevé ne porte aucune ligne lisible.');
    const illisible = await importer(d.ent, d.assistant, { ...MARS, lignes: [{ ...MARS.lignes[0], montant: '12a' }, ...MARS.lignes.slice(1)] });
    expect([illisible.statut, illisible.corps.champ]).toEqual([400, 'lignes.0.montant']);
    expect(await releves(d.ent, d.collaborateur)).toEqual([]);

    const r = await importer(d.ent, d.assistant, MARS);
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const [lu] = await releves(d.ent, d.collaborateur);
    expect(lu).toMatchObject({ id: r.corps.id, compte: '532', du: '2026-03-02', au: '2026-03-10', soldeDebut: '10000.500', soldeFin: '10405.625' });
    expect(lu?.lignes.map((l) => [l.montant, l.niveau, l.rapprochement])).toEqual([['1190.250', 'aucun', null], ['-85.125', 'aucun', null], ['-700.000', 'aucun', null]]);
    // Le même fichier ne s'importe pas deux fois : le doublon se dit avant le bouclage.
    const aujourdhui = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
    expect((await importer(d.ent, d.assistant, { ...MARS, soldeFin: '1' })).corps.motif).toBe(`Ce fichier a déjà été importé le ${aujourdhui} (02/03/2026 → 10/03/2026).`);
    // Rangé dans le livre de son année ; une voisine n'en lit rien, même dans la base.
    expect(await releves(d.ent, d.collaborateur, 2025)).toEqual([]);
    const voisine = await personne('voisine');
    await appeler('POST', '/entreprises', voisine.jeton, { raisonSociale: 'Quincaillerie voisine' });
    const vus = (qui: Personne) => enTantQue(pool, qui.utilisateur, async (tx) => Number((await tx.query(
      'select (select count(*) from compta.releve where entreprise = $1) + (select count(*) from compta.releve_ligne where entreprise = $1) n', [d.ent])).rows[0].n));
    expect([await vus(d.collaborateur), await vus(voisine)]).toEqual([4, 0]);
  });

  it('un rapprochement : une ligne du relevé, une ligne d\'écriture du même compte, qui ne répond que d\'elle ; un brouillard qui change le fait tomber ; tout se défait, le relevé se retire', async () => {
    const d = await dossier();
    const e1 = await saisir(d.ent, d.assistant, '2026-03-02', 'VIR-1', [['532', '1190,250', ''], ['411', '', '1190,250']]);
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/ecritures/valider`, d.collaborateur.jeton, { ids: [e1] })).statut).toBe(200);
    const e2 = await saisir(d.ent, d.assistant, '2026-03-05', 'STEG-3', [['6061', '85,125', ''], ['532', '', '85,125']]);
    const id = String((await importer(d.ent, d.assistant, MARS)).corps.id);
    const [L1, L2, L3] = (await releves(d.ent, d.collaborateur))[0]?.lignes.map((l) => l.id) ?? [];
    const lignesDe = async (e: string) => (await livres(d.ent, d.collaborateur)).find((x) => x.id === e)?.lignes ?? [];
    const [banque1, client1] = await lignesDe(e1);
    const poser = (p: Personne, poses: unknown[]) => appeler('POST', `/entreprises/${d.ent}/compta/releves/${id}/rapprochements`, p.jeton, { poses });

    expect((await poser(d.assistant, [{ ligne: L1, ecritureLigne: banque1?.id, niveau: 'certain' }])).corps).toEqual({ poses: 1 });
    expect((await releves(d.ent, d.collaborateur))[0]?.lignes[0]?.rapprochement).toMatchObject({ ligne: banque1?.id, ecriture: e1, rang: 1, niveau: 'certain', auto: false });
    // Une ligne d'un autre compte ; une ligne qui répond déjà d'une autre : refusées, rien ne bouge.
    expect((await poser(d.assistant, [{ ligne: L2, ecritureLigne: client1?.id, niveau: 'certain' }])).corps.motif).toBe('Cette ligne d\'écriture ne touche pas le compte 532.');
    expect((await poser(d.assistant, [{ ligne: L3, ecritureLigne: banque1?.id, niveau: 'certain' }])).corps.motif)
      .toBe('Cette ligne d\'écriture répond déjà d\'une autre ligne de relevé : défais ce rapprochement d\'abord.');
    expect((await poser(d.assistant, [{ ligne: L1, ecritureLigne: null, niveau: 'certain' }])).corps.motif).toBe('Un jugement sans écriture en face est « probable », « à confirmer » ou « aucun ».');
    // Un brouillard rapproché (d'office, par l'automatique) ; puis il change : ses lignes renaissent,
    // et la ligne du relevé redevient « sans réponse ».
    const [, banque2] = await lignesDe(e2);
    expect((await poser(d.assistant, [{ ligne: L2, ecritureLigne: banque2?.id, niveau: 'certain', auto: true }])).statut).toBe(200);
    expect((await releves(d.ent, d.collaborateur))[0]?.lignes[1]?.rapprochement).toMatchObject({ ecriture: e2, rang: 2, auto: true });
    const revision = (await livres(d.ent, d.collaborateur)).find((x) => x.id === e2)?.revision;
    expect((await appeler('PUT', `/entreprises/${d.ent}/compta/ecritures/${e2}`, d.assistant.jeton, {
      date: '2026-03-05', journal: 'BQ', piece: 'STEG-3', libelle: 'STEG mars', lignes: [{ compte: '6061', debit: '85,125' }, { compte: '532', credit: '85,125' }], revision,
    })).statut).toBe(200);
    expect((await releves(d.ent, d.collaborateur))[0]?.lignes[1]).toMatchObject({ niveau: 'aucun', rapprochement: null });
    // Le jugement de l'automatique qui n'a pas tranché se garde sur la ligne.
    expect((await poser(d.assistant, [{ ligne: L3, ecritureLigne: null, niveau: 'a-confirmer', auto: true }])).statut).toBe(200);
    expect((await releves(d.ent, d.collaborateur))[0]?.lignes[2]).toMatchObject({ niveau: 'a-confirmer', rapprochement: null });
    // Qui ne saisit pas ne rapproche pas.
    const lecteur = await personne('lecture');
    const inv = String((await appeler('POST', `/entreprises/${d.ent}/invitations`, d.client.jeton, { email: lecteur.email, roles: ['lecture'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', lecteur.jeton, { jeton: inv });
    expect((await poser(lecteur, [{ ligne: L1, ecritureLigne: null, niveau: 'aucun' }])).statut).toBe(403);
    await expect(enTantQue(pool, lecteur.utilisateur, (tx) => tx.query('select compta.derapprocher($1, $2)', [d.ent, id]))).rejects.toThrow(/ne permet pas de saisir/);
    // Tout défaire ; retirer le relevé : les écritures restent.
    expect((await appeler('POST', `/entreprises/${d.ent}/compta/releves/${id}/derapprocher`, d.collaborateur.jeton, {})).corps).toEqual({ defaits: 1 });
    expect((await releves(d.ent, d.collaborateur))[0]?.lignes.map((l) => l.rapprochement)).toEqual([null, null, null]);
    expect((await appeler('DELETE', `/entreprises/${d.ent}/compta/releves/${id}`, d.collaborateur.jeton)).statut).toBe(200);
    expect(await releves(d.ent, d.collaborateur)).toEqual([]);
    expect((await livres(d.ent, d.collaborateur)).map((e) => e.id).sort()).toEqual([e1, e2].sort());
  });

  it('les réglages du cabinet : les banques et les mots retenus, rien d\'autre ; changés ailleurs, jamais écrasés ; un autre cabinet n\'y lit rien', async () => {
    const d = await dossier();
    const url = `/cabinets/${d.cabinet}/reglages`;
    const contenu = { banques: { BIAT: { date: 0, libelle: 1, debit: 3, credit: 4 } }, libelles: [{ motif: 'STEG', compte: '6061' }] };
    expect((await appeler('GET', url, d.collaborateur.jeton)).corps).toEqual({ contenu: {}, revision: null });
    expect((await appeler('PUT', url, d.associe.jeton, { contenu, revision: null })).corps).toEqual({ revision: 1 });
    expect((await appeler('GET', url, d.collaborateur.jeton)).corps).toEqual({ contenu, revision: 1 });
    // Le collaborateur retient un mot : il écrit les réglages, avec la révision vue.
    const plus = { ...contenu, libelles: [...contenu.libelles, { motif: 'SONEDE', compte: '6062' }] };
    expect((await appeler('PUT', url, d.collaborateur.jeton, { contenu: plus, revision: 1 })).corps).toEqual({ revision: 2 });
    expect((await appeler('PUT', url, d.associe.jeton, { contenu, revision: 1 })).statut).toBe(409);
    expect((await appeler('PUT', url, d.associe.jeton, { contenu: { ...contenu, note: 'x' }, revision: 2 })).statut).toBe(400);
    expect((await appeler('PUT', url, d.associe.jeton, { contenu: { libelles: [{ motif: 'STEG', compte: 'abc' }] }, revision: 2 })).statut).toBe(400);
    // Un autre cabinet : rien à lire, rien à écrire.
    const autre = await personne('associe');
    await appeler('POST', '/cabinets', autre.jeton, { nom: 'Autre cabinet' });
    expect((await appeler('GET', url, autre.jeton)).corps).toEqual({ contenu: {}, revision: null });
    expect((await appeler('PUT', url, autre.jeton, { contenu, revision: null })).statut).toBe(404);
    // La fiche d'un dossier garde son compte bancaire ; rien d'autre sous « banque ».
    const fiche = (banque: unknown) => appeler('PUT', `/cabinets/${d.cabinet}/fiches/${d.ent}`, d.associe.jeton, { contenu: { banque }, revision: null });
    expect((await fiche({ compte: '532', banque: 'BIAT', iban: 'x' })).statut).toBe(400);
    expect((await fiche({ compte: '532', banque: 'BIAT', jours: 3 })).statut).toBe(200);
  });
});
