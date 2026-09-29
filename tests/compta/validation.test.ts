// La validation des livres (brique 35 ; docs/ecritures.md), par le vrai chemin : l'écran de la v10
// enregistre un achat et son règlement ; la comptabilité valide une période. Ce que le serveur
// garantit :
//   - valider donne à chaque écriture de la période son numéro (par journal et par année) et son
//     maillon dans la chaîne des livres, et ferme la période ; jamais l'avenir, jamais à reculons ;
//   - une pièce qui change après la validation ne réécrit pas le passé : l'écriture validée reste,
//     sa contre-passation et la nouvelle s'écrivent au premier jour ouvert ; si rien ne change dans
//     ses montants, rien ne s'écrit ;
//   - la chaîne se contrôle : une ligne retouchée par-dessous la base se voit ;
//   - seuls le propriétaire, l'administrateur et la comptabilité interne valident, même dans la base.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
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
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Objet = { collection: string; cle: string; revision: number };
async function essai() {
  const moi = await personne('validation');
  const ent = String((await appeler('POST', '/entreprises-essai', moi.jeton)).corps.id);
  await appeler('POST', '/moi/code', moi.jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, moi.jeton)).corps.objets as Objet[];
  await lire();
  const envoyer = async (collection: string, cle: string, contenu: unknown, rang: number | null = 0) => {
    const revision = (await lire()).find((o) => o.collection === collection && o.cle === cle)?.revision ?? null;
    return appeler('POST', `/entreprises/${ent}/dossier-v10`, moi.jeton, { changements: [{ collection, cle, rang: contenu === null ? null : rang, revision, contenu }] });
  };
  const inviter = async (role: string) => {
    const p = await personne(role);
    const invitation = String((await appeler('POST', `/entreprises/${ent}/invitations`, moi.jeton, { email: p.email, roles: [role] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', p.jeton, { jeton: invitation });
    await appeler('POST', '/moi/code', p.jeton, { methode: 'application' });
    return p;
  };
  // Les écritures, en clair : « journal date statut numéro | lignes ».
  const ecritures = async () => (await admin.query(`select e.origine_type, e.journal, e.date_ecriture::text date, e.statut, e.numero,
      string_agg(l.compte || ' ' || l.debit || ' ' || l.credit, ' | ' order by l.rang) lignes
    from compta.ecriture e join compta.ligne l on l.ecriture = e.id where e.entreprise = $1
    group by e.id order by e.date_ecriture, e.statut desc, e.rang`, [ent])).rows as { origine_type: string; journal: string; date: string; statut: string; numero: string | null; lignes: string }[];
  const valider = (jusqua: string, jeton = moi.jeton) => appeler('POST', `/entreprises/${ent}/compta/valider`, jeton, { jusqua });
  const cloture = async () => (await appeler('GET', `/entreprises/${ent}/compta/cloture`, moi.jeton)).corps as { jusqua: string | null; controle: { ok: boolean; numero: string | null; motif: string | null } };
  return { ...moi, ent, envoyer, inviter, ecritures, valider, cloture };
}

// 1 000,000 HT à 19 %, 1,000 de frais, retenue 1,5 % de 1 190,000 = 17,850 ; réglé 600,000 le 10/08.
const ligne = (prix: number) => ({ label: 'Papier', qty: 1, unitPrice: prix, vatRate: 19, destination: 'charge', deductible: true });
const achat = (prix: number, x: Record<string, unknown> = {}) => ({
  id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 1, withholdingRate: { '~n': '1.5' },
  tvaRecuperable: true, lines: [ligne(prix)], payments: [{ id: 'r1', date: '2026-08-10', amount: 600, method: 'especes' }], ...x,
});
const AC_1000 = '606 1000000 0 | 608 1000 0 | 4366 190000 0 | 401 0 1191000';

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesCompta(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la validation des livres', () => {
  it('valider numérote et ferme la période ; une pièce changée ensuite se contre-passe au premier jour ouvert ; retirée, elle se contre-passe entière', async () => {
    const e = await essai();
    expect((await e.envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' })).statut).toBe(200);
    expect((await e.envoyer('purchases', 'a1', achat(1000))).statut).toBe(200);
    const REGLEMENT = '401 609129 0 | 54 0 600000 | 4352 0 9129';
    expect((await e.ecritures()).map((x) => x.lignes)).toEqual([AC_1000, REGLEMENT]);

    // Valider jusqu'au 5 août : l'achat prend son numéro ; le règlement du 10 reste en brouillard.
    const v = await e.valider('2026-08-05');
    expect(v.statut, JSON.stringify(v.corps)).toBe(200);
    expect(v.corps.validees).toBe(1);
    expect(await e.ecritures()).toEqual([
      { origine_type: 'achat', journal: 'AC', date: '2026-08-03', statut: 'validee', numero: 'AC-2026-000001', lignes: AC_1000 },
      { origine_type: 'reglement_fournisseur', journal: 'CA', date: '2026-08-10', statut: 'brouillard', numero: null, lignes: REGLEMENT },
    ]);
    expect(await e.cloture()).toMatchObject({ jusqua: '2026-08-05', controle: { ok: true } });
    // Jamais à reculons, jamais l'avenir, jamais un jour qui n'en est pas un.
    const recul = await e.valider('2026-08-04');
    expect(recul.statut).toBe(403);
    expect(String(recul.corps.motif)).toContain('05/08/2026');
    expect((await e.valider('2099-01-31')).corps.motif).toMatch(/pas finie/);
    expect((await e.valider('2026-02-30')).statut).toBe(400);

    // Changer ce qui n'entre pas dans les montants (l'objet de l'achat) : rien ne s'écrit.
    expect((await e.envoyer('purchases', 'a1', achat(1000, { subject: 'Rames A4' }))).statut).toBe(200);
    expect((await e.ecritures()).map((x) => `${x.origine_type} ${x.statut}`)).toEqual(['achat validee', 'reglement_fournisseur brouillard']);

    // Le prix corrigé à 1 200,000 : l'écriture validée reste ; sa contre-passation et la nouvelle
    // s'écrivent au 6 août, premier jour ouvert ; la retenue du règlement devient
    // 21,420 × 600 / 1 407,580 = 9,131.
    expect((await e.envoyer('purchases', 'a1', achat(1200))).statut).toBe(200);
    const AC_1200 = '606 1200000 0 | 608 1000 0 | 4366 228000 0 | 401 0 1429000';
    const CP_1000 = '606 0 1000000 | 608 0 1000 | 4366 0 190000 | 401 1191000 0';
    const REGLEMENT_1200 = '401 609131 0 | 54 0 600000 | 4352 0 9131';
    expect((await e.ecritures()).map((x) => `${x.origine_type} ${x.date} ${x.statut} ${x.lignes}`)).toEqual([
      `achat 2026-08-03 validee ${AC_1000}`,
      `contre_passation 2026-08-06 brouillard ${CP_1000}`,
      `achat 2026-08-06 brouillard ${AC_1200}`,
      `reglement_fournisseur 2026-08-10 brouillard ${REGLEMENT_1200}`,
    ]);
    // Réécrite encore (un autre changement), la famille ne double rien.
    expect((await e.envoyer('purchases', 'a1', achat(1200, { subject: 'Rames A3' }))).statut).toBe(200);
    expect((await e.ecritures()).length).toBe(4);

    // Valider le mois : les numéros se suivent, par journal ; la chaîne tient.
    expect((await e.valider('2026-08-31')).corps.validees).toBe(3);
    expect((await e.ecritures()).map((x) => `${x.origine_type} ${x.numero}`)).toEqual([
      'achat AC-2026-000001', 'contre_passation AC-2026-000002', 'achat AC-2026-000003', 'reglement_fournisseur CA-2026-000001',
    ]);
    expect((await e.cloture()).controle).toEqual({ ok: true, numero: null, motif: null });

    // Un achat daté dans la période close s'écrit au premier jour ouvert.
    expect((await e.envoyer('purchases', 'a2', { ...achat(100), id: 'a2', number: 'FF-2', date: '2026-08-20', payments: [], withholdingRate: 0, fees: 0 }, 1)).statut).toBe(200);
    expect((await e.ecritures()).filter((x) => x.statut === 'brouillard').map((x) => `${x.origine_type} ${x.date}`)).toEqual(['achat 2026-09-01']);

    // L'achat FF-1 retiré : ce qui compte encore de lui (la nouvelle écriture et le règlement) se
    // contre-passe au 1er septembre ; l'ancienne, déjà contre-passée et validée, ne bouge pas.
    expect((await e.envoyer('purchases', 'a1', null)).statut).toBe(200);
    const apres = await e.ecritures();
    expect(apres.filter((x) => x.statut === 'brouillard').map((x) => `${x.origine_type} ${x.date} ${x.lignes}`).sort()).toEqual([
      'achat 2026-09-01 606 100000 0 | 4366 19000 0 | 401 0 119000',
      `contre_passation 2026-09-01 606 0 1200000 | 608 0 1000 | 4366 0 228000 | 401 1429000 0`,
      'contre_passation 2026-09-01 401 0 609131 | 54 600000 0 | 4352 9131 0',
    ].sort());
    // FF-1 ne pèse plus rien : chaque compte, sans FF-2, revient à zéro.
    const soldes = (await admin.query(`select l.compte, sum(l.debit - l.credit)::text solde from compta.ligne l join compta.ecriture e on e.id = l.ecriture
      where e.entreprise = $1 and not (e.origine_type = 'achat' and e.date_ecriture = '2026-09-01') group by l.compte having sum(l.debit - l.credit) <> 0`, [e.ent])).rows;
    expect(soldes).toEqual([]);
  });

  it('la chaîne des livres se contrôle : une ligne retouchée par-dessous la base se voit', async () => {
    const e = await essai();
    await e.envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    await e.envoyer('purchases', 'a1', achat(1000));
    expect((await e.valider('2026-08-31')).corps.validees).toBe(2);
    expect((await e.cloture()).controle.ok).toBe(true);
    // Par-dessous : les déclencheurs coupés (ce que seul un administrateur de la base peut faire).
    await admin.query('begin');
    await admin.query(`set local session_replication_role = replica`);
    await admin.query(`update compta.ligne set debit = debit + 1 where entreprise = $1 and compte = '606'`, [e.ent]);
    await admin.query('commit');
    expect((await e.cloture()).controle).toEqual({ ok: false, numero: 'AC-2026-000001', motif: 'contenu changé depuis la validation' });
  });

  it('valider : le propriétaire, l\'administrateur, la comptabilité interne ; ni le commercial ni la lecture, même dans la base', async () => {
    const e = await essai();
    await e.envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    await e.envoyer('purchases', 'a1', achat(1000));
    const commercial = await e.inviter('commercial');
    const lecture = await e.inviter('lecture');
    const compta = await e.inviter('comptabilite_interne');
    const refus = await e.valider('2026-08-05', commercial.jeton);
    expect(refus.statut).toBe(403);
    // Le refus dit qui peut valider : les personnes de l'entreprise qui en ont le rôle.
    expect((refus.corps.qui as { roles: string[] }[]).flatMap((q) => q.roles).sort()).toEqual(['comptabilite_interne', 'proprietaire']);
    expect((await e.valider('2026-08-05', lecture.jeton)).statut).toBe(403);
    // La base refuse aussi, sans passer par la porte.
    await expect(enTantQue(pool, commercial.utilisateur, (tx) => tx.query('select compta.valider($1, $2::date)', [e.ent, '2026-08-05'])))
      .rejects.toThrow(/réservé au propriétaire/);
    expect((await admin.query(`select count(*)::int n from compta.ecriture where entreprise = $1 and statut = 'validee'`, [e.ent])).rows[0].n).toBe(0);
    const ok = await e.valider('2026-08-05', compta.jeton);
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(200);
    expect(ok.corps.validees).toBe(1);
  });
});
