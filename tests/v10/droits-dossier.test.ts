// Les droits geste par geste dans le dossier v10 (brique 99 ; 03 § 2.1 ; docs/droits-dossier.md). Chaque personne
// ouvre le dossier de son entreprise, et n'en lit et n'en écrit que les parties que ses rôles permettent :
//   - un commercial lit les ventes, les clients, la fiche société et le catalogue (sans l'écrire) ; il écrit ses
//     pièces et ses clients ; il ne lit ni la paie ni les achats, et n'écrit ni le catalogue ni la fiche société ;
//   - la paie ne lit que la paie (et ce que tout le monde lit) ; la comptabilité interne écrit les achats ;
//   - la lecture n'écrit rien ; un envoi qui touche une partie interdite n'écrit RIEN, et le refus la nomme ;
//   - la première facture d'une entreprise, émise par un commercial, crée sa série de numéros.

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
async function personne(prenom: string) {
  const email = `droits-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton };
}
const aujourdhui = new Date().toISOString().slice(0, 10);

// Une entreprise avec un peu de tout, et une personne par rôle.
async function entreprise() {
  const proprio = await personne('Nadia');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const membres: Record<string, { jeton: string }> = {};
  for (const role of ['commercial', 'paie', 'comptabilite_interne', 'lecture']) {
    const p = await personne(role);
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: p.email, roles: [role] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', p.jeton, { jeton: inv });
    // La paie demande le code du téléphone.
    if (role === 'paie') await appeler('POST', '/moi/code', p.jeton, { methode: 'application' });
    membres[role] = p;
  }
  const lire = async (jeton: string, depuis = '') => (await appeler('GET', `/entreprises/${ent}/dossier-v10${depuis}`, jeton)).corps as { objets: Objet[]; droits: { cachees: string[]; lectureSeule: string[]; ecrivables: string[]; tout: boolean; responsable: boolean }; marque: string; profil: string; partiel?: boolean };
  const envoyer = (jeton: string, changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  await lire(proprio.jeton);
  expect((await envoyer(proprio.jeton, [
    { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unitPrice: 21 } },
    { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Sami Trabelsi', cin: '01234567' } },
    { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte' } },
    { collection: '_racine', cle: 'payrollSettings', rang: null, revision: null, contenu: { smig: 528 } },
    { collection: '_racine', cle: 'counters', rang: null, revision: null, contenu: {} },
  ])).statut).toBe(200);
  return { ent, proprio, membres, lire, envoyer };
}
const parties = (o: Objet[]) => [...new Set(o.map((x) => (x.collection === '_racine' ? `_racine/${x.cle}` : x.collection)))].sort();

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les droits geste par geste dans le dossier v10', () => {
  it('chacun ne lit que sa part, et l\'écran sait ce qu\'il ne doit ni montrer ni renvoyer', async () => {
    const e = await entreprise();
    const tout = await e.lire(e.proprio.jeton);
    expect(parties(tout.objets)).toEqual(expect.arrayContaining(['catalog', 'employees', 'suppliers', '_racine/payrollSettings', '_racine/company']));
    expect(tout.droits).toMatchObject({ cachees: [], lectureSeule: [], tout: true, responsable: true });
    const c = await e.lire(e.membres.commercial?.jeton ?? '');
    expect(parties(c.objets)).toEqual(['_racine/company', '_racine/counters', 'catalog']);
    expect(c.droits.cachees).toEqual(expect.arrayContaining(['employees', 'payslips', 'payrollSettings', 'suppliers', 'purchases', 'accounts']));
    expect(c.droits.cachees).not.toContain('documents');
    expect(c.droits.lectureSeule).toEqual(expect.arrayContaining(['catalog', 'company']));
    expect(c.droits.tout).toBe(false);
    // Le propriétaire décide des accords ; le commercial les demande (brique 100 : l'écran grise ce que la base refuserait).
    expect(c.droits.responsable).toBe(false);
    const pa = await e.lire(e.membres.paie?.jeton ?? '');
    expect(parties(pa.objets)).toEqual(['_racine/company', '_racine/counters', '_racine/payrollSettings', 'employees']);
    const ci = await e.lire(e.membres.comptabilite_interne?.jeton ?? '');
    expect(parties(ci.objets)).toEqual(['_racine/company', '_racine/counters', 'catalog', 'suppliers']);
  });

  it('chacun n\'écrit que sa part ; un envoi qui touche une partie interdite n\'écrit rien et la nomme', async () => {
    const e = await entreprise();
    const jc = e.membres.commercial?.jeton ?? '';
    const devis = { id: 'd1', type: 'devis', number: 'DEV-2026-001', status: 'brouillon', date: aujourdhui, clientId: 'c1', lines: [], payments: [] };
    expect((await e.envoyer(jc, [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr' } },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: devis },
      { collection: '_racine', cle: 'counters', rang: null, revision: 1, contenu: { 'devis-2026': 1 } },
    ])).statut).toBe(200);
    // Le catalogue (ses prix), les salariés, la fiche société : refusés, et rien de l'envoi n'est écrit.
    const refus = await e.envoyer(jc, [
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: { id: 'c2', name: 'Café El Walima' } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: 1, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unitPrice: 1 } },
    ]);
    expect(refus.statut).toBe(403);
    expect(refus.corps.motif).toBe('Ton rôle ne permet pas d\'enregistrer le catalogue dans le dossier de l\'entreprise : rien n\'a été enregistré. Demande au propriétaire ou à un administrateur.');
    expect(parties((await e.lire(e.proprio.jeton)).objets.filter((o) => o.cle === 'c2'))).toEqual([]);
    expect((await e.envoyer(jc, [{ collection: 'employees', cle: 'e2', rang: 1, revision: null, contenu: { id: 'e2', name: 'Faux salarié' } }])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer les salariés /);
    const societe = (await e.lire(e.proprio.jeton)).objets.find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await e.envoyer(jc, [{ collection: '_racine', cle: 'company', rang: null, revision: societe?.revision, contenu: { ...societe?.contenu, name: 'Autre nom' } }])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer la fiche de la société /);
    // Une partie sans règle : seuls ceux qui voient toute l'entreprise.
    expect((await e.envoyer(jc, [{ collection: 'packs', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1' } }])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer cette partie du dossier /);
    // La paie écrit la paie ; la comptabilité interne écrit les achats, pas les pièces de vente ; la lecture, rien.
    expect((await e.envoyer(e.membres.paie?.jeton ?? '', [{ collection: 'employees', cle: 'e3', rang: 1, revision: null, contenu: { id: 'e3', name: 'Mouna Jaziri' } }])).statut).toBe(200);
    // Le pointage des salariés (1.60.0) est de la paie : la paie l'écrit ; le commercial non, et le refus le nomme.
    const pointe = { collection: 'timesheets', cle: 't1', rang: 0, revision: null, contenu: { id: 't1', employeeId: 'e3', year: 2026, month: 9, jours: { 8: 'A' }, hs: {} } };
    expect((await e.envoyer(jc, [pointe])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer le pointage des salariés /);
    expect((await e.envoyer(e.membres.paie?.jeton ?? '', [pointe])).statut).toBe(200);
    const jci = e.membres.comptabilite_interne?.jeton ?? '';
    expect((await e.envoyer(jci, [{ collection: 'suppliers', cle: 's2', rang: 1, revision: null, contenu: { id: 's2', name: 'Sable du Nord' } }])).statut).toBe(200);
    expect((await e.envoyer(jci, [{ collection: 'documents', cle: 'd2', rang: 1, revision: null, contenu: { ...devis, id: 'd2' } }])).statut).toBe(403);
    expect((await e.envoyer(e.membres.lecture?.jeton ?? '', [{ collection: 'clients', cle: 'c3', rang: 2, revision: null, contenu: { id: 'c3', name: 'X' } }])).statut).toBe(403);
  });

  // (16 § 10.1, point 8) Cinq parties sans règle tombaient au propriétaire seul : la paie ne voyait aucun mois verrouillé, et
  // ses validations restaient sur son poste. Le pointage validé est de la paie ; les heures d'une affaire suivent l'affaire.
  it('le pointage validé par le gérant se lit et s\'écrit par la paie ; les heures d\'une affaire suivent l\'affaire', async () => {
    const e = await entreprise();
    const le = '2026-09-08T17:42:00.000Z';
    expect((await e.envoyer(e.proprio.jeton, [
      { collection: '_racine', cle: 'joursValides', rang: null, revision: null, contenu: [{ iso: '2026-09-08', le }] },
      { collection: 'pointageVersions', cle: 'v1', rang: 0, revision: null, contenu: { id: 'v1', ym: '2026-09', le, par: 'Nadia' } },
      { collection: '_racine', cle: 'pointageOuverts', rang: null, revision: null, contenu: ['2026-08'] },
      { collection: 'badgeImports', cle: 'b1', rang: 0, revision: null, contenu: { id: 'b1', fichier: 'pointeuse-septembre.csv', lus: 412, rattaches: 409, deja: 0, inconnus: ['0007'], le } },
      { collection: 'projectTime', cle: 'h1', rang: 0, revision: null, contenu: { id: 'h1', projectId: 'a1', employeeId: 'e1', date: '2026-09-08', hours: { '~n': '7.5' }, note: 'Pose' } },
    ])).statut).toBe(200);
    const POINTAGE = ['_racine/joursValides', '_racine/pointageOuverts', 'badgeImports', 'pointageVersions'];
    const NOMS = ['badgeImports', 'joursValides', 'pointageOuverts', 'pointageVersions'];
    const jp = e.membres.paie?.jeton ?? '';
    const pa = await e.lire(jp);
    expect(parties(pa.objets)).toEqual(expect.arrayContaining(POINTAGE));
    expect(pa.droits.ecrivables).toEqual(expect.arrayContaining(NOMS));
    expect(parties(pa.objets)).not.toContain('projectTime');
    expect(pa.droits.cachees).toContain('projectTime');
    for (const role of ['commercial', 'comptabilite_interne', 'lecture']) {
      const l = await e.lire(e.membres[role]?.jeton ?? '');
      for (const x of POINTAGE) expect(parties(l.objets), role).not.toContain(x);
      expect(l.droits.cachees, role).toEqual(expect.arrayContaining(NOMS));
      expect(parties(l.objets), role).toContain('projectTime');
    }
    // La paie écrit ce qu'elle vient de lire, et le gérant le relit.
    const rev = (cle: string) => pa.objets.find((o) => o.cle === cle)?.revision ?? null;
    expect((await e.envoyer(jp, [
      { collection: '_racine', cle: 'joursValides', rang: null, revision: rev('joursValides'), contenu: [{ iso: '2026-09-08', le }, { iso: '2026-09-09', le }] },
      { collection: '_racine', cle: 'pointageOuverts', rang: null, revision: rev('pointageOuverts'), contenu: ['2026-09'] },
      { collection: 'pointageVersions', cle: 'v2', rang: 1, revision: null, contenu: { id: 'v2', ym: '2026-08', le, par: 'Leila' } },
      { collection: 'badgeImports', cle: 'b2', rang: 1, revision: null, contenu: { id: 'b2', fichier: 'pointeuse-octobre.csv', lus: 17, rattaches: 17, deja: 0, inconnus: [], le } },
    ])).statut).toBe(200);
    const tout = await e.lire(e.proprio.jeton);
    expect(tout.objets.find((o) => o.cle === 'pointageOuverts')?.contenu).toEqual(['2026-09']);
    expect(tout.objets.find((o) => o.cle === 'joursValides')?.contenu).toHaveLength(2);
    // Les autres sont refusés, et le refus nomme la partie.
    const jc = e.membres.commercial?.jeton ?? '', jci = e.membres.comptabilite_interne?.jeton ?? '';
    expect((await e.envoyer(jc, [{ collection: '_racine', cle: 'joursValides', rang: null, revision: null, contenu: [] }])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer les journées validées du pointage /);
    expect((await e.envoyer(jc, [{ collection: 'pointageVersions', cle: 'v3', rang: 2, revision: null, contenu: { id: 'v3' } }])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer les versions validées du pointage /);
    expect((await e.envoyer(jci, [{ collection: '_racine', cle: 'pointageOuverts', rang: null, revision: null, contenu: [] }])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer les mois de pointage rouverts /);
    expect((await e.envoyer(jci, [{ collection: 'badgeImports', cle: 'b3', rang: 2, revision: null, contenu: { id: 'b3' } }])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer les imports de la pointeuse /);
    // Les heures d'une affaire : qui écrit les affaires les note ; la paie, la comptabilité interne et la lecture non.
    const h2 = { collection: 'projectTime', cle: 'h2', rang: 1, revision: null, contenu: { id: 'h2', projectId: 'a1', employeeId: 'e1', date: '2026-09-09', hours: { '~n': '3.25' }, note: 'Finitions' } };
    expect((await e.envoyer(jp, [h2])).corps.motif).toMatch(/^Ton rôle ne permet pas d'enregistrer les heures notées sur les affaires /);
    expect((await e.envoyer(jci, [h2])).statut).toBe(403);
    expect((await e.envoyer(e.membres.lecture?.jeton ?? '', [h2])).statut).toBe(403);
    expect((await e.envoyer(jc, [h2])).statut).toBe(200);
  });

  // (16 § 10.1, point 8) La copie gardée d'un poste se complète par différence tant que son profil n'a pas changé : une
  // partie ouverte à un rôle par de nouvelles règles ne lui arrivait qu'au prochain changement de chaque objet.
  it('une copie gardée sous d\'autres règles des parties repart en entier : la paie reçoit ce que le gérant avait validé avant', async () => {
    const e = await entreprise();
    expect((await e.envoyer(e.proprio.jeton, [{ collection: 'pointageVersions', cle: 'v1', rang: 0, revision: null, contenu: { id: 'v1', ym: '2026-09' } }])).statut).toBe(200);
    const jp = e.membres.paie?.jeton ?? '';
    const l = await e.lire(jp);
    // Sous les mêmes règles, la différence marche toujours.
    expect((await e.lire(jp, `?depuis=${l.marque}&profil=${encodeURIComponent(l.profil)}`)).partiel).toBe(true);
    // La copie lue sous les règles d'avant (le profil sans leur empreinte) repart en entier, avec le mois validé.
    const avant = l.profil.split('/').slice(0, 3).join('/');
    const r = await e.lire(jp, `?depuis=${l.marque}&profil=${encodeURIComponent(avant)}`);
    expect(r.partiel).toBeUndefined();
    expect(parties(r.objets)).toContain('pointageVersions');
  });

  // (16 § 10.1, point 4) La comptabilité interne et la lecture ont droit à la masse salariale, pas à la paie : leurs soldes, leur
  // prévision et leur résultat sont sans elle. Le serveur le leur dit (un oui ou un non), jamais un nom ni un montant.
  it('la comptabilité interne et la lecture apprennent que la paie manque à leurs chiffres, sans un nom ni un montant', async () => {
    // L'entreprise a un salarié, Sami Trabelsi (CIN 01234567), et un barème de paie.
    const e = await entreprise();
    for (const role of ['comptabilite_interne', 'lecture']) {
      const l = await e.lire(e.membres[role]?.jeton ?? '');
      expect((l.droits as Record<string, unknown>).paieCachee, role).toBe(true);
      const texte = JSON.stringify(l);
      expect(texte, role).not.toContain('Sami');
      expect(texte, role).not.toContain('01234567');
    }
    expect((((await e.lire(e.proprio.jeton)).droits) as Record<string, unknown>).paieCachee).toBe(false);
    expect((((await e.lire(e.membres.paie?.jeton ?? '')).droits) as Record<string, unknown>).paieCachee).toBe(false);
    // Le commercial n'a pas droit à la masse salariale : il n'apprend même pas qu'il y a une paie.
    expect((((await e.lire(e.membres.commercial?.jeton ?? '')).droits) as Record<string, unknown>).paieCachee).toBe(false);
  });

  it('une entreprise sans paie ne dit pas « sans la paie »', async () => {
    const proprio = await personne('Nadia');
    const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Librairie El Kitab' })).corps.id);
    await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
    const ci = await personne('ci');
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: ci.email, roles: ['comptabilite_interne'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', ci.jeton, { jeton: inv });
    const lire = async () => ((await appeler('GET', `/entreprises/${ent}/dossier-v10`, ci.jeton)).corps.droits as Record<string, unknown>).paieCachee;
    await appeler('GET', `/entreprises/${ent}/dossier-v10`, proprio.jeton);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, proprio.jeton, { changements: [
      { collection: 'accounts', cle: 'b', rang: 0, revision: null, contenu: { id: 'b', kind: 'banque', name: 'BIAT' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Lycée Pilote' } }] })).statut).toBe(200);
    expect(await lire()).toBe(false);
    expect((await appeler('POST', `/entreprises/${ent}/dossier-v10`, proprio.jeton, { changements: [
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Amel Gharbi' } }] })).statut).toBe(200);
    expect(await lire()).toBe(true);
  });

  it('relue par différence, la page sait encore que la paie lui manque', async () => {
    const e = await entreprise();
    const jci = e.membres.comptabilite_interne?.jeton ?? '';
    const l = await e.lire(jci);
    const r = await e.lire(jci, `?depuis=${l.marque}&profil=${encodeURIComponent(l.profil)}`);
    expect(r.partiel).toBe(true);
    expect((r.droits as Record<string, unknown>).paieCachee).toBe(true);
  });

  // (16 § 10.1, point 13, lot A) La fusion de la v10 garde la version écartée d'une fiche (`conflictArchive`), entière ; cette
  // partie technique part chez tous ceux qui ouvrent le dossier. Une fiche de salarié n'y garde ni CIN ni RIB.
  it('(16 § 10.1, 13) une version écartée d\'une fiche de salarié ne garde ni CIN ni RIB ; celle d\'un client reste entière', async () => {
    const e = await entreprise();
    const RIB = '08006000123456789012', RIB_CLIENT = '24681357924681357924';
    const e1 = { at: '2026-11-03T10:00:00.000Z', kind: 'employees', id: 'e1', label: 'Sami Trabelsi', record: { id: 'e1', name: 'Sami Trabelsi', cin: '01234567', iban: RIB } };
    const c1 = { at: '2026-11-03T10:00:00.000Z', kind: 'clients', id: 'c1', label: 'Menuiserie du Lac', record: { id: 'c1', name: 'Menuiserie du Lac', rib: RIB_CLIENT } };
    expect((await e.envoyer(e.proprio.jeton, [
      { collection: 'conflictArchive', cle: 'e1', rang: 0, revision: null, contenu: e1 },
      { collection: 'conflictArchive', cle: 'c1', rang: 1, revision: null, contenu: c1 },
      // La même liste à la racine (un salarié revenu deux fois : la liste n'a plus d'identifiants uniques).
      { collection: '_racine', cle: 'conflictArchive', rang: null, revision: null, contenu: [e1, { ...e1, at: '2026-11-03T11:00:00.000Z' }, c1] },
    ])).statut).toBe(200);
    // En base : ni la CIN ni le RIB du salarié ; son nom et le RIB du client restent (on ne vide pas trop).
    const enBase = (await admin.query(`select string_agg(contenu::text, ' ') t from socle.dossier_v10 where entreprise = $1
      and (collection = 'conflictArchive' or (collection = '_racine' and cle = 'conflictArchive'))`, [e.ent])).rows[0].t as string;
    expect(enBase).not.toContain('01234567');
    expect(enBase).not.toContain(RIB);
    expect(enBase).toContain('Sami Trabelsi');
    expect(enBase.split(RIB_CLIENT).length - 1).toBe(2);
    // La fiche écartée garde le reste de ce qui avait été tapé : seuls la CIN et le RIB partent.
    expect((await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'conflictArchive' and cle = 'e1'`, [e.ent])).rows[0].contenu.record)
      .toEqual({ id: 'e1', name: 'Sami Trabelsi' });
    // Une archive d'avant, encore en clair en base : elle ne sort pas non plus.
    await admin.query(`update socle.dossier_v10 set contenu = jsonb_set(jsonb_set(contenu, '{record,cin}', '"01234567"'), '{record,iban}', $2::jsonb)
      where entreprise = $1 and collection = 'conflictArchive' and cle = 'e1'`, [e.ent, JSON.stringify(RIB)]);
    await admin.query(`update socle.dossier_v10 set contenu = jsonb_set(contenu, '{1,record,cin}', '"01234567"')
      where entreprise = $1 and collection = '_racine' and cle = 'conflictArchive'`, [e.ent]);
    for (const role of ['commercial', 'comptabilite_interne', 'lecture']) {
      const l = await e.lire(e.membres[role]?.jeton ?? '');
      const texte = JSON.stringify(l.objets);
      expect(texte, role).not.toContain('01234567');
      expect(texte, role).not.toContain('0800600012345678');
      expect(texte, role).toContain('Menuiserie du Lac');
      expect(l.objets.find((o) => o.collection === 'conflictArchive' && o.cle === 'e1')?.contenu.label, role).toBe('Sami Trabelsi');
    }
  });

  it('(16 § 10.1, 13) la CIN et le RIB rendus en clair à l\'écran : chaque lecture tracée, une fois par réponse ; rien pour qui ne les reçoit pas', async () => {
    const e = await entreprise();
    const traces = async () => Number((await admin.query(`select count(*) n from socle.audit where entreprise = $1 and lecture and geste = 'paie.dossier.voir'`, [e.ent])).rows[0].n);
    const depart = await traces();
    const l = await e.lire(e.proprio.jeton);
    expect(await traces()).toBe(depart + 1);
    await e.lire(e.membres.paie?.jeton ?? '');
    expect(await traces()).toBe(depart + 2);
    // Ceux qui ne reçoivent pas les salariés : rien.
    await e.lire(e.membres.commercial?.jeton ?? '');
    await e.lire(e.membres.lecture?.jeton ?? '');
    expect(await traces()).toBe(depart + 2);
    // Relu par différence, sans salarié changé : la CIN ne repart pas, rien ne se trace (tracer quand elle part, pas à chaque réponse).
    const r = await e.lire(e.proprio.jeton, `?depuis=${l.marque}&profil=${encodeURIComponent(l.profil)}`);
    expect(r.partiel).toBe(true);
    expect(await traces()).toBe(depart + 2);
  });

  it('la première facture d\'une entreprise, émise par un commercial, crée sa série de numéros', async () => {
    const e = await entreprise();
    const jc = e.membres.commercial?.jeton ?? '';
    expect((await e.envoyer(jc, [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr' } }])).statut).toBe(200);
    const client = (await e.lire(jc)).objets.find((o) => o.cle === 'c1')?.contenu ?? null;
    const f = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: 1,
      lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 2, unit: 'sac', unitPrice: 21, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] };
    const r = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, jc, { document: f, client, revision: null, rang: 0, netAPayer: '49.980' });
    expect(r.statut).toBe(200);
    expect(String((r.corps.contenu as Record<string, unknown>).number)).toMatch(/^FAC-\d{4}-001$/);
    // Créer une autre série reste au propriétaire et à l'administrateur.
    const autre = await appeler('POST', `/entreprises/${e.ent}/series`, jc, { type: 'facture', prefixe: 'FX', legale: true });
    expect(autre.statut).toBe(403);
  });
});
