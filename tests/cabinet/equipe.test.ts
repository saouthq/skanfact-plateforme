// L'équipe du cabinet (brique 46 ; docs/cabinet.md, C36), par l'API et dans la base. Ce que le serveur
// garantit :
//   - l'associé invite une personne par son adresse, avec un rôle ; elle rejoint le cabinet en ouvrant
//     le lien, connectée avec CETTE adresse ; une invitation annulée, acceptée ou échue ne vaut plus ;
//   - seul un associé invite, change un rôle, retire quelqu'un ; personne ne change son propre rôle ni
//     ne se retire : le cabinet garde toujours un associé ;
//   - retirée, la personne n'ouvre plus rien du cabinet (ses dossiers confiés non plus) ; chaque geste
//     se trace au nom du cabinet.


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
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesPaie } from '../../serveur/paie/routes.ts';
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

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta(); declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

async function personneA(email: string, nom: string) {
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Equipe = { membres: { membre: string; nom: string; email: string; roles: string[] }[]; invitations: { id: string; email: string; role: string }[];
  affectations: { entreprise: string; membre: string; role: string }[] };
const equipe = async (cabinet: string, p: Personne) => (await appeler('GET', `/cabinets/${cabinet}/equipe`, p.jeton)).corps as Equipe;

describe('l\'équipe du cabinet', () => {
  it('l\'associé invite par l\'adresse ; la personne rejoint avec cette adresse ; on lui confie un dossier ; retirée, elle n\'ouvre plus rien', async () => {
    const associe = await personne('associe');
    const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
    const cabinet = String(c.corps.id);
    const adresse = `amine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    const inv = await appeler('POST', `/cabinets/${cabinet}/invitations`, associe.jeton, { email: adresse, role: 'revision' });
    expect(inv.statut, JSON.stringify(inv.corps)).toBe(201);
    expect((await equipe(cabinet, associe)).invitations.map((i) => [i.email, i.role])).toEqual([[adresse, 'revision']]);
    // Une autre personne ne l'accepte pas à sa place.
    const autre = await personne('autre');
    expect((await appeler('POST', '/invitations/accepter', autre.jeton, { jeton: inv.corps.jeton })).corps.motif).toBe('Cette invitation a été envoyée à une autre adresse.');
    const amine = await personneA(adresse, 'Amine');
    const r = await appeler('POST', '/invitations/accepter', amine.jeton, { jeton: inv.corps.jeton });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(r.corps).toMatchObject({ cabinet, entreprise: null });
    expect(((await appeler('GET', '/cabinets', amine.jeton)).corps.cabinets as { id: string; roles: string[] }[]).map((x) => [x.id, x.roles])).toEqual([[cabinet, ['revision']]]);
    expect((await appeler('POST', '/invitations/accepter', amine.jeton, { jeton: inv.corps.jeton })).corps.motif).toBe('Cette invitation n\'est plus valable : demande-en une nouvelle.');
    const eq = await equipe(cabinet, associe);
    expect(eq.membres.map((m) => [m.nom, m.roles])).toEqual([['Amine', ['revision']], ['associe', ['supervision']]]);
    expect(eq.invitations).toEqual([]);
    // Un dossier tenu, confié à Amine : il le voit dans son portefeuille.
    const cafe = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const mandat = String((await admin.query('select id from socle.mandat where entreprise = $1', [cafe])).rows[0].id);
    const membreAmine = String(eq.membres.find((m) => m.nom === 'Amine')?.membre);
    expect((await appeler('PUT', `/cabinets/${cabinet}/mandats/${mandat}/affectations/${membreAmine}`, associe.jeton, { role: 'revision' })).statut).toBe(200);
    expect(((await appeler('GET', `/cabinets/${cabinet}/portefeuille`, amine.jeton)).corps.dossiers as { entreprise: string }[]).map((d) => d.entreprise)).toEqual([cafe]);
    expect((await equipe(cabinet, amine)).affectations.map((a) => [a.entreprise, a.membre, a.role])).toEqual([[cafe, membreAmine, 'revision']]);
    // Retiré : plus de cabinet, plus de dossier.
    expect((await appeler('DELETE', `/cabinets/${cabinet}/membres/${membreAmine}`, associe.jeton)).statut).toBe(200);
    expect((await appeler('GET', '/cabinets', amine.jeton)).corps.cabinets).toEqual([]);
    expect((await appeler('GET', `/entreprises/${cafe}/compta/ecritures?limite=10`, amine.jeton)).statut).toBe(404);
    expect((await equipe(cabinet, associe)).membres.map((m) => m.nom)).toEqual(['associe']);
    const traces = (await admin.query(`select geste from socle.audit where objet_id = $1 and geste like 'cabinet.equipe.%' order by instant, id`, [cabinet])).rows.map((x) => x.geste);
    expect(traces).toEqual(['cabinet.equipe.inviter', 'cabinet.equipe.accepter', 'cabinet.equipe.retirer']);
  });

  it('ce qui a changé dans l\'équipe : l\'associé le lit, du plus récent au plus ancien, avec qui l\'a fait et qui est visé ; personne d\'autre', async () => {
    const associe = await personneA(`leila-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`, 'Leila');
    const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
    const cabinet = String(c.corps.id);
    const adresse = `amine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    const inv = await appeler('POST', `/cabinets/${cabinet}/invitations`, associe.jeton, { email: adresse, role: 'saisie' });
    const autreAdresse = `sonia-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    const inv2 = await appeler('POST', `/cabinets/${cabinet}/invitations`, associe.jeton, { email: autreAdresse, role: 'revision' });
    expect((await appeler('DELETE', `/cabinets/${cabinet}/invitations/${inv2.corps.id}`, associe.jeton)).statut).toBe(200);
    const amine = await personneA(adresse, 'Amine');
    expect((await appeler('POST', '/invitations/accepter', amine.jeton, { jeton: inv.corps.jeton })).statut).toBe(200);
    const membreAmine = String((await equipe(cabinet, associe)).membres.find((m) => m.nom === 'Amine')?.membre);
    // Un collaborateur ne lit pas la trace de l'équipe.
    const refus = await appeler('GET', `/cabinets/${cabinet}/equipe/trace`, amine.jeton);
    expect([refus.statut, refus.corps.motif]).toEqual([403, 'Seul un associé du cabinet lit ce qui a changé dans son équipe.']);
    expect((await appeler('PUT', `/cabinets/${cabinet}/membres/${membreAmine}`, associe.jeton, { role: 'revision' })).statut).toBe(200);
    expect((await appeler('PUT', `/cabinets/${cabinet}/nom`, associe.jeton, { nom: 'Cabinet Ennour et associés' })).statut).toBe(200);
    expect((await appeler('DELETE', `/cabinets/${cabinet}/membres/${membreAmine}`, associe.jeton)).statut).toBe(200);
    type Trace = { instant: string; qui: string; geste: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null; membre: string };
    const trace = (await appeler('GET', `/cabinets/${cabinet}/equipe/trace`, associe.jeton)).corps.trace as Trace[];
    expect(trace.map((x) => [x.geste, x.qui, x.membre])).toEqual([
      ['cabinet.equipe.retirer', 'Leila', 'Amine'],
      ['cabinet.renommer', 'Leila', ''],
      ['cabinet.equipe.changer_role', 'Leila', 'Amine'],
      ['cabinet.equipe.accepter', 'Amine', 'Amine'],
      ['cabinet.equipe.annuler', 'Leila', ''],
      ['cabinet.equipe.inviter', 'Leila', ''],
      ['cabinet.equipe.inviter', 'Leila', ''],
    ]);
    expect([trace[2]?.avant?.roles, trace[2]?.apres?.roles, trace[1]?.apres?.nom, trace[4]?.apres?.email]).toEqual([['saisie'], ['revision'], 'Cabinet Ennour et associés', autreAdresse]);
    // Un associé d'un autre cabinet ne la lit pas.
    const ailleurs = await personne('ailleurs');
    await appeler('POST', '/cabinets', ailleurs.jeton, { nom: 'Autre cabinet' });
    expect((await appeler('GET', `/cabinets/${cabinet}/equipe/trace`, ailleurs.jeton)).statut).toBe(403);
  });

  it('seul un associé invite, change un rôle, retire ; personne ne change son propre rôle ni ne se retire ; une invitation annulée ne vaut plus', async () => {
    const associe = await personne('associe');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const adresse = `nour-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    const inviter = (p: Personne, email: string, role = 'saisie') => appeler('POST', `/cabinets/${cabinet}/invitations`, p.jeton, { email, role });
    expect((await inviter(associe, associe.email)).corps.motif).toBe('Personne ne s\'invite soi-même.');
    expect((await inviter(associe, adresse, 'paie')).statut).toBe(400);
    const nour = await personneA(adresse, 'Nour');
    await appeler('POST', '/invitations/accepter', nour.jeton, { jeton: (await inviter(associe, adresse)).corps.jeton });
    expect((await inviter(associe, adresse)).corps.motif).toBe('Cette personne fait déjà partie du cabinet.');
    // Nour (assistant de saisie) n'invite pas, ne change rien — dans la base aussi.
    expect((await inviter(nour, `x-${adresse}`)).corps.motif).toBe('Seul un associé du cabinet invite quelqu\'un dans son équipe.');
    const eq = await equipe(cabinet, associe);
    const mNour = String(eq.membres.find((m) => m.nom === 'Nour')?.membre);
    const mAssocie = String(eq.membres.find((m) => m.nom === 'associe')?.membre);
    expect((await appeler('PUT', `/cabinets/${cabinet}/membres/${mAssocie}`, nour.jeton, { role: 'saisie' })).corps.motif).toBe('Seul un associé du cabinet change son équipe.');
    await expect(enTantQue(pool, nour.utilisateur, (tx) => tx.query('select socle.retirer_du_cabinet($1, $2)', [cabinet, mAssocie])))
      .rejects.toThrow('seul un associé du cabinet change son équipe');
    // L'associé ne se rétrograde ni ne se retire : un autre associé le fait.
    expect((await appeler('PUT', `/cabinets/${cabinet}/membres/${mAssocie}`, associe.jeton, { role: 'revision' })).corps.motif)
      .toBe('Personne ne change son propre rôle, ni ne se retire soi-même : un autre associé le fait.');
    expect((await appeler('DELETE', `/cabinets/${cabinet}/membres/${mAssocie}`, associe.jeton)).corps.motif)
      .toBe('Personne ne change son propre rôle, ni ne se retire soi-même : un autre associé le fait.');
    // Nour devient associée ; elle peut alors rétrograder le premier.
    expect((await appeler('PUT', `/cabinets/${cabinet}/membres/${mNour}`, associe.jeton, { role: 'supervision' })).statut).toBe(200);
    expect((await appeler('PUT', `/cabinets/${cabinet}/membres/${mAssocie}`, nour.jeton, { role: 'revision' })).statut).toBe(200);
    // L'équipe se lit dans l'ordre des noms, sans tenir compte des majuscules (ni de la langue de la base).
    expect((await equipe(cabinet, nour)).membres.map((m) => [m.nom, m.roles])).toEqual([['associe', ['revision']], ['Nour', ['supervision']]]);
    // Une invitation annulée ne vaut plus.
    const tard = `tard-${adresse}`;
    const inv = await inviter(nour, tard);
    expect((await appeler('DELETE', `/cabinets/${cabinet}/invitations/${inv.corps.id}`, nour.jeton)).statut).toBe(200);
    const tardif = await personneA(tard, 'Tard');
    expect((await appeler('POST', '/invitations/accepter', tardif.jeton, { jeton: inv.corps.jeton })).corps.motif).toBe('Cette invitation n\'est plus valable : demande-en une nouvelle.');
    expect((await equipe(cabinet, nour)).invitations).toEqual([]);
  });
});
