// Le dossier d'exemple d'un cabinet (1.370.0 ; 0214), par l'API et dans la base. Ce que le serveur garantit :
//   - un associé le charge d'un geste : un dossier tenu, marqué « exemple », que le portefeuille dit tel ;
//   - un seul à la fois ; un collaborateur ne le charge ni ne le retire ; personne d'un autre cabinet non plus ;
//   - il ne compte jamais dans l'abonnement (ni parmi les gratuits, ni parmi les payants) ;
//   - il se retire avec ses livres (un dossier tenu ordinaire qui a une écriture ne se retire pas : 0032), et se
//     recharge à neuf ensuite ;
//   - la marque ne se pose que par ce geste : créer un dossier tenu, ou écrire sa fiche, ne fait jamais un exemple.

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
const portefeuille = async (cabinet: string, p: Personne) => ((await appeler('GET', `/cabinets/${cabinet}/portefeuille`, p.jeton)).corps.dossiers ?? []) as { entreprise: string; raisonSociale: string; tenu?: boolean; exemple?: boolean; statut: string }[];
const comptes = async (cabinet: string) => (await admin.query('select entreprise from plateforme.dossiers_du_cabinet($1, current_date)', [cabinet])).rows.map((x) => String(x.entreprise));

describe('le dossier d\'exemple du cabinet', () => {
  it('un associé le charge : un dossier tenu marqué « exemple », un seul à la fois, hors abonnement ; il se retire avec ses livres et se recharge', async () => {
    const associe = await personne('associe');
    const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
    const cabinet = String(c.corps.id);
    // Quatre dossiers tenus ordinaires : trois gratuits, le quatrième payant.
    const tenus: string[] = [];
    for (const nom of ['Alpha', 'Bêta', 'Gamma', 'Delta']) tenus.push(String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: nom })).corps.entreprise));
    expect((await comptes(cabinet)).sort()).toEqual([...tenus].sort());

    const r = await appeler('POST', `/cabinets/${cabinet}/exemple`, associe.jeton, {});
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const exemple = String(r.corps.entreprise);
    expect(String(r.corps.raisonSociale)).toMatch(/^Exemple · /);
    // Le portefeuille le dit, lui seul.
    const p = await portefeuille(cabinet, associe);
    expect(p.filter((d) => d.exemple).map((d) => d.entreprise)).toEqual([exemple]);
    expect(p.find((d) => d.entreprise === exemple)).toMatchObject({ tenu: true, statut: 'actif' });
    // Hors abonnement : ni un gratuit de moins, ni un payant de plus.
    expect((await comptes(cabinet)).sort()).toEqual([...tenus].sort());
    // Un seul à la fois.
    const deux = await appeler('POST', `/cabinets/${cabinet}/exemple`, associe.jeton, {});
    expect(deux.statut).toBe(403);
    expect(String(deux.corps.motif)).toMatch(/déjà dans ton cabinet/);

    // Il se tient comme un autre : un exercice, une écriture validée.
    expect((await appeler('POST', `/entreprises/${exemple}/compta/exercices`, associe.jeton, { annee: 2026, ouverture: [] })).statut).toBe(201);
    const e = await appeler('POST', `/entreprises/${exemple}/compta/ecritures`, associe.jeton, { date: '2026-03-10', journal: 'OD', piece: 'OD-1', libelle: 'Essai',
      lignes: [{ compte: '606', libelle: '', tiers: '', debit: '100.000', credit: '' }, { compte: '532', libelle: '', tiers: '', debit: '', credit: '100.000' }] });
    expect(e.statut, JSON.stringify(e.corps)).toBe(201);
    expect((await appeler('POST', `/entreprises/${exemple}/compta/ecritures/valider`, associe.jeton, { ids: [e.corps.id] })).statut).toBe(200);

    // Il se retire avec ses livres ; les autres dossiers ne bougent pas.
    const retire = await appeler('DELETE', `/cabinets/${cabinet}/exemple`, associe.jeton);
    expect(retire.statut, JSON.stringify(retire.corps)).toBe(200);
    expect(retire.corps.retires).toBe(1);
    expect((await portefeuille(cabinet, associe)).map((d) => d.entreprise).sort()).toEqual([...tenus].sort());
    expect((await appeler('GET', `/entreprises/${exemple}/compta/ecritures?limite=10`, associe.jeton)).statut).not.toBe(200);
    // Retirer deux fois ne casse rien ; et il se recharge à neuf (une autre entreprise, sans écriture).
    expect((await appeler('DELETE', `/cabinets/${cabinet}/exemple`, associe.jeton)).corps.retires).toBe(0);
    const neuf = await appeler('POST', `/cabinets/${cabinet}/exemple`, associe.jeton, {});
    expect(neuf.statut).toBe(201);
    expect(String(neuf.corps.entreprise)).not.toBe(exemple);
    expect((await comptes(cabinet)).sort()).toEqual([...tenus].sort());
  });

  it('seul un associé de CE cabinet le charge et le retire ; un dossier tenu ordinaire n\'est jamais un exemple', async () => {
    const associe = await personne('associe');
    const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
    const cabinet = String(c.corps.id);
    const adresse = `amine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    const inv = await appeler('POST', `/cabinets/${cabinet}/invitations`, associe.jeton, { email: adresse, role: 'revision' });
    const amine = await personneA(adresse, 'Amine');
    expect((await appeler('POST', '/invitations/accepter', amine.jeton, { jeton: inv.corps.jeton })).statut).toBe(200);
    // Un collaborateur du cabinet : ni charger, ni retirer.
    const refuse = await appeler('POST', `/cabinets/${cabinet}/exemple`, amine.jeton, {});
    expect(refuse.statut).not.toBe(201);
    expect((await admin.query('select count(*)::int n from socle.entreprise where tenue_par = $1 and exemple', [cabinet])).rows[0].n).toBe(0);
    // Quelqu'un d'un autre cabinet : rien.
    const autre = await personne('autre');
    expect((await appeler('POST', `/cabinets/${cabinet}/exemple`, autre.jeton, {})).statut).not.toBe(201);
    // Un corps qui voudrait nommer ou marquer : refusé (la marque ne vient que du serveur).
    expect((await appeler('POST', `/cabinets/${cabinet}/exemple`, associe.jeton, { exemple: false, raisonSociale: 'Vrai client' })).statut).toBe(400);
    // Un dossier tenu ordinaire, même nommé « Exemple », n'est pas un exemple : il compte.
    const tenu = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Exemple · Faux' })).corps.entreprise);
    expect(await comptes(cabinet)).toEqual([tenu]);
    expect((await portefeuille(cabinet, associe)).some((d) => d.exemple)).toBe(false);
    // L'associé le charge ; le collaborateur ne le retire pas ; le dossier tenu ordinaire reste compté, seul.
    const r = await appeler('POST', `/cabinets/${cabinet}/exemple`, associe.jeton, {});
    expect(r.statut).toBe(201);
    expect((await appeler('DELETE', `/cabinets/${cabinet}/exemple`, amine.jeton)).statut).not.toBe(200);
    expect((await portefeuille(cabinet, associe)).filter((d) => d.exemple).length).toBe(1);
    expect(await comptes(cabinet)).toEqual([tenu]);
  });
});
