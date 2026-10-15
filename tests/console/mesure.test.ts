// La mesure (1.23.0 ; base 0116 ; serveur/console/mesure.ts ; docs/console.md C39) : l'entonnoir des essais finis, les
// inscriptions de la période et celles d'avant, les départs, les offres (médianes), ce qu'on promet (le support dans son
// délai). Pur d'abord ; puis la base : ce qu'elle compte, et pour qui.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { lireEntreprises } from '../../serveur/console/decider.ts';
import { bornes, lireMesure, mesurer, PIECES_HABITUDE } from '../../serveur/console/mesure.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const JOUR = '2026-10-15'; // un jeudi
const MAINTENANT = new Date('2026-10-15T10:00:00Z');
const moisDe = (i: string) => i.slice(0, 7);
let n = 0;
function ligne(faits: Record<string, unknown>, autre: Record<string, unknown> = {}) {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, raisonSociale: `Société ${n}`, matricule: null, active: true, creeLe: '2026-09-01',
    organisation: { id: 'o', type: 'independant', nom: `Société ${n}` }, tenuePar: null, proprietaire: { nom: `Proprio ${n}`, email: `p${n}@exemple.tn` },
    membres: 1, derniereActivite: null, pieces: 4,
    faits: { connu: true, essaiJusquAu: plusJours(JOUR, 20), payeJusquAu: null, offre: null, periodicite: null, resilieLe: null, suspenduLe: null, offert: false, bacASable: false, tenuParCabinet: false, ...faits },
    ...autre,
  };
}
const rien = lireMesure({});

describe('la mesure, lue sans la base', () => {
  it('l\'entonnoir : les essais finis ces trente jours (hier oui, aujourd\'hui non), qui ont servi, pris, se sont abonnés', () => {
    const liste = lireEntreprises([
      // Finis ces trente jours : 5. Une sans pièce, une à 9 pièces (pas encore « prise »), deux à dix et plus, abonnées.
      ligne({ essaiJusquAu: plusJours(JOUR, -1) }, { pieces: 0 }),
      ligne({ essaiJusquAu: plusJours(JOUR, -5) }, { pieces: PIECES_HABITUDE - 1 }),
      ligne({ essaiJusquAu: plusJours(JOUR, -30), payeJusquAu: plusJours(JOUR, 330), offre: 'essentiel', periodicite: 'annuel' }, { pieces: 23 }),
      ligne({ essaiJusquAu: plusJours(JOUR, -12), payeJusquAu: plusJours(JOUR, 18), offre: 'complet', periodicite: 'mensuel' }, { pieces: PIECES_HABITUDE }),
      ligne({ essaiJusquAu: plusJours(JOUR, -20) }, { pieces: 3 }),
      // Pas dans l'entonnoir : un essai qui finit ce soir, un fini il y a trente et un jours, un bac à sable, un dossier tenu.
      ligne({ essaiJusquAu: JOUR }, { pieces: 50 }),
      ligne({ essaiJusquAu: plusJours(JOUR, -31) }, { pieces: 50 }),
      ligne({ essaiJusquAu: plusJours(JOUR, -3), bacASable: true }, { pieces: 50 }),
      ligne({ essaiJusquAu: plusJours(JOUR, -3), tenuParCabinet: true }, { pieces: 50 }),
    ], JOUR, REGLES_DE_DEPART);
    const m = mesurer(liste, rien, JOUR, 'semaine', MAINTENANT, moisDe);
    expect(m.entonnoir).toEqual({ essais: 5, servi: 4, pris: 2, abonnees: 2, parOffre: { essentiel: 1, complet: 1 }, annuel: 1, mensuel: 1 });
  });

  it('les inscriptions : cette semaine depuis lundi contre la semaine d\'avant, entière ; ce mois-ci ; trente jours contre trente', () => {
    expect(bornes('semaine', JOUR)).toEqual({ du: '2026-10-12', au: JOUR, avantDu: '2026-10-05', avantAu: '2026-10-11' });
    expect(bornes('semaine', '2026-10-12')).toMatchObject({ du: '2026-10-12', avantDu: '2026-10-05' }); // un lundi
    expect(bornes('semaine', '2026-10-18')).toMatchObject({ du: '2026-10-12' }); // un dimanche
    expect(bornes('mois', JOUR)).toEqual({ du: '2026-10-01', au: JOUR, avantDu: '2026-09-01', avantAu: '2026-09-30' });
    expect(bornes('trente', JOUR)).toEqual({ du: '2026-09-16', au: JOUR, avantDu: '2026-08-17', avantAu: '2026-09-15' });
    const liste = lireEntreprises(['2026-10-11', '2026-10-12', '2026-10-15', '2026-10-05', '2026-10-04', '2026-09-30'].map((c) => ligne({}, { creeLe: c })), JOUR, REGLES_DE_DEPART);
    expect(mesurer(liste, rien, JOUR, 'semaine', MAINTENANT, moisDe).inscriptions).toMatchObject({ periode: 2, avant: 2 });
    expect(mesurer(liste, rien, JOUR, 'mois', MAINTENANT, moisDe).inscriptions).toMatchObject({ periode: 5, avant: 1 });
  });

  it('les départs : les résiliations depuis la première inscription, les non renouvelés en lecture seule', () => {
    const liste = lireEntreprises([
      ligne({ essaiJusquAu: '2026-07-01', payeJusquAu: plusJours(JOUR, 40), offre: 'essentiel', periodicite: 'mensuel', resilieLe: plusJours(JOUR, -2) }, { creeLe: '2026-06-01' }),
      ligne({ essaiJusquAu: '2026-07-01', payeJusquAu: plusJours(JOUR, -60), offre: 'essentiel', periodicite: 'mensuel' }, { creeLe: '2026-06-09' }),
      ligne({}, { creeLe: '2026-09-07' }),
    ], JOUR, REGLES_DE_DEPART);
    expect(mesurer(liste, rien, JOUR, 'semaine', MAINTENANT, moisDe).departs).toEqual({ depuis: '2026-06-01', resiliations: 1, nonRenouveles: 1 });
  });

  it('par offre : la médiane des pièces des trente jours et des membres ; les modules achetés en plus, pour Essentiel seulement', () => {
    const e1 = ligne({ essaiJusquAu: '2026-07-01', payeJusquAu: plusJours(JOUR, 40), offre: 'essentiel', periodicite: 'mensuel', modules: ['paie'] }, { membres: 2 });
    const e2 = ligne({ essaiJusquAu: '2026-07-01', payeJusquAu: plusJours(JOUR, 40), offre: 'essentiel', periodicite: 'mensuel' }, { membres: 3 });
    const e3 = ligne({ essaiJusquAu: '2026-07-01', payeJusquAu: plusJours(JOUR, 40), offre: 'essentiel', periodicite: 'annuel' }, { membres: 7 });
    const c1 = ligne({ essaiJusquAu: '2026-07-01', payeJusquAu: plusJours(JOUR, 40), offre: 'complet', periodicite: 'annuel' }, { membres: 4 });
    const es = ligne({}, { membres: 1 });
    const liste = lireEntreprises([e1, e2, e3, c1, es], JOUR, REGLES_DE_DEPART);
    const lu = lireMesure({ piecesTrente: { [e1.id]: 11, [e2.id]: 30, [e3.id]: 4, [c1.id]: 61, inconnue: 'x' } });
    const o = mesurer(liste, lu, JOUR, 'semaine', MAINTENANT, moisDe).parOffre;
    expect(o).toEqual([
      { offre: 'essai', n: 1, pieces: 0, membres: 1, modules: { paie: null, compta: null } },
      { offre: 'essentiel', n: 3, pieces: 11, membres: 3, modules: { paie: 33, compta: 0 } },
      { offre: 'complet', n: 1, pieces: 61, membres: 4, modules: { paie: null, compta: null } },
    ]);
    // Une médiane de deux : leur moyenne.
    const deux = lireEntreprises([e1, e2], JOUR, REGLES_DE_DEPART);
    expect(mesurer(deux, lu, JOUR, 'semaine', MAINTENANT, moisDe).parOffre[1]).toMatchObject({ pieces: 20.5, membres: 2.5 });
  });

  it('le support dans son délai, mois par mois : tenue, manquée, pas encore due ; l\'urgente à deux heures', () => {
    const lu = lireMesure({
      demandes: [
        // Septembre : une tenue (3 h), une manquée (30 h), une urgente manquée (3 h), une urgente tenue (1 h).
        { ouverteLe: '2026-09-10T08:00:00Z', priorite: 'normale', reponduLe: '2026-09-10T11:00:00Z' },
        { ouverteLe: '2026-09-11T08:00:00Z', priorite: 'normale', reponduLe: '2026-09-12T14:00:00Z' },
        { ouverteLe: '2026-09-12T08:00:00Z', priorite: 'urgente', reponduLe: '2026-09-12T11:00:00Z' },
        { ouverteLe: '2026-09-13T08:00:00Z', priorite: 'urgente', reponduLe: '2026-09-13T09:00:00Z' },
        // Octobre : une sans réponse depuis 26 heures (manquée), une sans réponse depuis 2 heures (pas encore due).
        { ouverteLe: '2026-10-14T08:00:00Z', priorite: 'normale', reponduLe: null },
        { ouverteLe: '2026-10-15T08:00:00Z', priorite: 'normale', reponduLe: null },
        { ouverteLe: 'pas une date', priorite: 'normale' },
      ],
      urgentes: [{ ouverteLe: '2026-09-12T08:00:00Z', reponduLe: '2026-09-12T11:00:00Z' }, { ouverteLe: '2026-09-13T08:00:00Z', reponduLe: '2026-09-13T09:00:00Z' },
        { ouverteLe: '2026-10-15T09:30:00Z', reponduLe: null }],
    });
    const p = mesurer([], lu, JOUR, 'semaine', MAINTENANT, moisDe).promesses;
    expect(p.support).toEqual([{ mois: '2026-09', tenues: 2, dues: 4 }, { mois: '2026-10', tenues: 0, dues: 1 }]);
    expect(p.urgentes).toEqual({ tenues: 1, dues: 2 });
    expect(p.attendLePlus).toBe(26);
    expect([p.heures, p.heuresUrgente]).toEqual([24, 2]);
  });
});

// ── La base ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
}
let k = 0;
async function personne(prenom: string) {
  const email = `mesure-${prenom}${++k}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${k}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  return { email, jeton: String(c.corps.jeton) };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  const s = (await admin.query(`select s.id, s.utilisateur from plateforme.session_console s join socle.utilisateur u on u.id = s.utilisateur
     where u.email = $1 and s.fermee_le is null`, [p.email])).rows[0] as { id: string; utilisateur: string };
  return { jeton: String(c.corps.jeton), session: s.id, utilisateur: s.utilisateur };
}
// La fonction de la base, appelée comme le serveur l'appelle : la personne, et sa session de la console.
const laBase = (m: { session: string; utilisateur: string }, jour: string) => enTantQue(pool, m.utilisateur, async (tx) => {
  await tx.query(`select set_config('app.session_console', $1, true)`, [m.session]);
  return (await tx.query('select plateforme.console_mesure($1::date) v', [jour])).rows[0].v as { piecesTrente: Record<string, number>; demandes: { reponduLe: string | null }[] };
});
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la mesure, dans la base (0116)', () => {
  it('la direction seule, à la route comme à la base ; aucun nom ni identifiant d\'entreprise à l\'écran ; une période inconnue vaut la semaine', async () => {
    const direction = await membre('direction', 'direction');
    const support = await membre('support', 'support');
    const technique = await membre('technique', 'technique');
    const p = await personne('proprio');
    const cree = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Atelier Mesuré', matriculeFiscal: '5400991C/A/M/000' });
    const id = String(cree.corps.id);
    expect((await appeler('GET', '/console/mesure', support.jeton)).statut).toBe(403);
    expect((await appeler('GET', '/console/mesure', technique.jeton)).statut).toBe(403);
    await expect(laBase(technique, '2026-10-15')).rejects.toThrow();
    await expect(laBase(support, '2026-10-15')).rejects.toThrow();
    const r = await appeler('GET', '/console/mesure?periode=nimporte', direction.jeton);
    expect(r.statut).toBe(200);
    expect(r.corps.periode).toBe('semaine');
    expect(JSON.stringify(r.corps)).not.toContain(id);
    expect(JSON.stringify(r.corps)).not.toContain('Atelier Mesuré');
    // Inscrite aujourd'hui : elle compte dans la semaine.
    expect((r.corps.inscriptions as { periode: number }).periode).toBeGreaterThanOrEqual(1);
  });

  it('les pièces des trente jours : émises, au jour de leur fuseau ; un brouillon ou une pièce plus vieille ne comptent pas ; la première réponse du support', async () => {
    const direction = await membre('direction', 'direction');
    const p = await personne('pieces');
    const cree = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Pièces Comptées', matriculeFiscal: '5400992C/A/M/000' });
    const id = String(cree.corps.id);
    const jour = (await admin.query(`select (now() at time zone 'Africa/Tunis')::date::text j`)).rows[0].j as string;
    const proprio = (await admin.query('select id from socle.utilisateur where email = $1', [p.email])).rows[0].id as string;
    // Posées sans le parcours (déclencheurs suspendus) : émises il y a 29 et 30 jours (au jour de Tunis), un brouillon d'hier.
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    for (const [statut, ilYA] of [['emise', 29], ['emise', 30], ['brouillon', 1]] as const) {
      const emise = statut === 'emise';
      await admin.query(`insert into ventes.piece (entreprise, type, statut, tiers, date_piece, emise_le, numero, numero_texte, copie, empreinte, net_a_payer, cree_par)
        values ($1, 'facture', $2, gen_random_uuid(), $3::date - $4::int, case when $5 then (($3::date - $4::int) + time '00:30') at time zone 'Africa/Tunis' end,
                case when $5 then $4 end, case when $5 then 'F-' || $4 end, case when $5 then '{}'::jsonb end, case when $5 then repeat('a', 64) end,
                case when $5 then 1000 end, $6)`,
        [id, statut, jour, ilYA, emise, proprio]);
    }
    // Une demande au support, répondue deux heures après (une note du client avant la réponse ne compte pas).
    const d = (await admin.query(`insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, ouverte_le) values ($1, $2, 'application', 'Mesure', now() - interval '3 hours') returning id`,
      [id, proprio])).rows[0].id as string;
    await admin.query(`insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le) values ($1, 'client', $2, 'Bonjour', now() - interval '3 hours'),
      ($1, 'client', $2, 'Alors ?', now() - interval '2 hours'), ($1, 'equipe', $2, 'Voilà', now() - interval '1 hour')`, [d, proprio]);
    await admin.query('commit');
    const v = await laBase(direction, jour);
    // 0 h 30 à Tunis il y a 29 jours (la veille au soir en UTC) : dans la fenêtre ; il y a 30 jours : dehors.
    expect(v.piecesTrente[id]).toBe(1);
    const reponses = (await admin.query(`select min(ecrit_le) le from plateforme.message_support where demande = $1 and cote = 'equipe'`, [d])).rows[0].le as Date;
    expect(v.demandes.some((x) => x.reponduLe !== null && Date.parse(x.reponduLe) === reponses.getTime())).toBe(true);
  });
});
