// Les nouveautés qu'on allume (1.27.0 ; base 0120 ; serveur/nouveautes.ts ; docs/console.md C43) : la liste vient du code,
// la base dit pour qui chacune est allumée. Allumer pour une entreprise désignée par son numéro de client, l'éteindre,
// l'ouvrir à toutes, la refermer ; la direction seule, chaque geste au journal avec son motif ; une entreprise ne lit que
// les siennes.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { etatDesNouveautes, listeDesNouveautes, NOUVEAUTES, nouveautesDe, routesNouveautes } from '../../serveur/nouveautes.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
// Deux nouveautés propres à ce passage : la base est commune aux essais, et « ouverte à tous » vaut pour toutes.
const suffixe = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SALLE = `salle_${suffixe}`, AUTRE = `autre_${suffixe}`;
const LISTE = [
  { code: SALLE, nom: 'La caisse en salle', quoi: 'Les tables, les commandes en cuisine, l\'addition.' },
  { code: AUTRE, nom: 'Le rapprochement bancaire', quoi: 'Le relevé de la banque, pointé tout seul.' },
];
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, nouveautes: LISTE };
let app: FastifyInstance;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
}
const appareil = { nom: 'Bureau', type: 'navigateur' };
let k = 0;
const adresse = (qui: string) => `nouv-${qui}${++k}-${Date.now() % 100000}@exemple.tn`;
async function compte(email: string, nom = `Compte ${k}`) {
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
  return String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil })).corps.jeton);
}
async function membre(qui: string, role: 'direction' | 'support', nom: string) {
  const email = adresse(qui);
  const jeton = await compte(email, nom);
  const q = await quiEst(ctx, jeton);
  if (!q) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, q, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return String(c.corps.jeton);
}
// Une entreprise, sa propriétaire, et son numéro de client (« E-0012 »).
async function entreprise(nom: string) {
  const jeton = await compte(adresse('patron'));
  const id = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
  const numero = String((await admin.query('select plateforme.numero_texte($1) n', [id])).rows[0]?.n);
  return { id, jeton, numero };
}
const siennes = async (e: { id: string; jeton: string }) => (await appeler('GET', `/entreprises/${e.id}/nouveautes`, e.jeton)).corps.nouveautes;
type Etat = { code: string; nom: string; ouverte: { par: string; motif: string } | null; allumees: { entreprise: string; numero: string; nom: string; par: string; motif: string }[] };
const etat = async (jeton: string, code: string) =>
  ((await appeler('GET', '/console/reglages', jeton)).corps.nouveautes as Etat[]).find((n) => n.code === code);
const gestes = async (code: string) => (await admin.query(`select g.geste, g.entreprise, g.motif from plateforme.geste_console g
   where g.geste like 'reglages.nouveaute%' and coalesce(g.apres, g.avant) ->> 'nouveaute' = $1 order by g.le, g.id`, [code])).rows as { geste: string; entreprise: string | null; motif: string }[];

let direction = '', support = '';
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null }), ...routesNouveautes(ctx)]);
  await app.ready();
  direction = await membre('dir', 'direction', 'Amel Direction');
  support = await membre('sup', 'support', 'Sami Support');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('les nouveautés qu\'on allume (0120)', () => {
  it('la liste vient du code : une nouveauté que la version ne porte pas est refusée avant la base ; la liste est vérifiée', async () => {
    expect(NOUVEAUTES).toEqual([]);
    const r = await appeler('POST', '/console/reglages/nouveautes/inventee_xyz/ouvrir', direction, { motif: 'essai d\'une inconnue' });
    expect(r.statut).toBe(404);
    expect((await admin.query('select count(*)::int n from plateforme.nouveaute_tous where code = $1', ['inventee_xyz'])).rows[0]?.n).toBe(0);
    expect(() => listeDesNouveautes([{ code: 'a_b', nom: 'x', quoi: 'y' }, { code: 'a_b', nom: 'x', quoi: 'y' }])).toThrow(/deux fois/);
    expect(() => listeDesNouveautes([{ code: 'Avec-Tiret', nom: 'x', quoi: 'y' }])).toThrow(/invalide/);
    // Ce que la base dit d'un code que la liste ne porte plus, la console le tait.
    expect(etatDesNouveautes(LISTE.slice(0, 1), { allumees: [{ code: 'ancienne', entreprise: 'e', nom: 'X' }], ouvertes: [{ code: 'ancienne' }] }))
      .toEqual([{ ...LISTE[0], ouverte: null, allumees: [] }]);
  });

  it('allumer pour une entreprise par son numéro : elle seule la voit ; deux fois ou un numéro inconnu, refusé ; éteindre : elle ne la voit plus', async () => {
    const dar = await entreprise('Restaurant Dar Essai');
    const voisine = await entreprise('Épicerie Voisine');
    expect(await siennes(dar)).toEqual([]);
    const r = await appeler('POST', `/console/reglages/nouveautes/${SALLE}/allumer`, direction, { numero: dar.numero.toLowerCase().replace('-', ''), motif: 'volontaire pour essayer' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect(await siennes(dar)).toEqual([SALLE]);
    expect(await siennes(voisine)).toEqual([]);
    const vu = await etat(direction, SALLE);
    expect(vu?.ouverte).toBeNull();
    expect(vu?.allumees).toEqual([expect.objectContaining({ entreprise: dar.id, numero: dar.numero, nom: 'Restaurant Dar Essai', par: 'Amel Direction', motif: 'volontaire pour essayer' })]);
    expect((await appeler('POST', `/console/reglages/nouveautes/${SALLE}/allumer`, direction, { numero: dar.numero, motif: 'une seconde fois' })).statut).toBe(403);
    const inconnu = await appeler('POST', `/console/reglages/nouveautes/${SALLE}/allumer`, direction, { numero: 'E-999999999', motif: 'un numéro inventé' });
    expect([inconnu.statut, inconnu.corps.motif]).toEqual([403, expect.stringMatching(/aucune entreprise ne porte ce numéro/i)]);
    expect((await appeler('POST', `/console/reglages/nouveautes/${SALLE}/allumer`, direction, { numero: 'Dar Essai', motif: 'par son nom' })).statut).toBe(403);
    // Éteindre : elle ne la voit plus ; la ligne garde qui l'avait allumée, et qui l'a éteinte.
    expect((await appeler('POST', `/console/reglages/nouveautes/${SALLE}/eteindre`, direction, { entreprise: dar.id, motif: 'elle préfère attendre' })).statut).toBe(200);
    expect(await siennes(dar)).toEqual([]);
    expect((await etat(direction, SALLE))?.allumees).toEqual([]);
    expect((await admin.query('select motif, eteinte_motif from plateforme.nouveaute_entreprise where code = $1 and entreprise = $2', [SALLE, dar.id])).rows)
      .toEqual([{ motif: 'volontaire pour essayer', eteinte_motif: 'elle préfère attendre' }]);
    expect((await appeler('POST', `/console/reglages/nouveautes/${SALLE}/eteindre`, direction, { entreprise: dar.id, motif: 'encore une fois' })).statut).toBe(403);
    expect(await gestes(SALLE)).toEqual([
      { geste: 'reglages.nouveaute_allumee', entreprise: dar.id, motif: 'volontaire pour essayer' },
      { geste: 'reglages.nouveaute_eteinte', entreprise: dar.id, motif: 'elle préfère attendre' },
    ]);
  });

  it('l\'ouvrir à tous : toutes la voient, l\'allumer pour une seule est refusé ; la refermer : les volontaires la gardent', async () => {
    const volontaire = await entreprise('Café Volontaire');
    const autre = await entreprise('Librairie Autre');
    await appeler('POST', `/console/reglages/nouveautes/${AUTRE}/allumer`, direction, { numero: volontaire.numero, motif: 'volontaire au téléphone' });
    expect((await appeler('POST', `/console/reglages/nouveautes/${AUTRE}/ouvrir`, direction, { motif: 'essayée trois semaines' })).statut).toBe(200);
    expect(await siennes(autre)).toEqual([AUTRE]);
    expect(await siennes(volontaire)).toEqual([AUTRE]);
    expect((await etat(direction, AUTRE))?.ouverte).toMatchObject({ par: 'Amel Direction', motif: 'essayée trois semaines' });
    expect((await appeler('POST', `/console/reglages/nouveautes/${AUTRE}/allumer`, direction, { numero: autre.numero, motif: 'déjà ouverte' })).statut).toBe(403);
    expect((await appeler('POST', `/console/reglages/nouveautes/${AUTRE}/ouvrir`, direction, { motif: 'deux fois' })).statut).toBe(403);
    expect((await appeler('POST', `/console/reglages/nouveautes/${AUTRE}/refermer`, direction, { motif: 'un défaut trouvé' })).statut).toBe(200);
    expect(await siennes(autre)).toEqual([]);
    expect(await siennes(volontaire)).toEqual([AUTRE]);
    expect((await etat(direction, AUTRE))?.ouverte).toBeNull();
    expect((await appeler('POST', `/console/reglages/nouveautes/${AUTRE}/refermer`, direction, { motif: 'deux fois' })).statut).toBe(403);
    expect((await gestes(AUTRE)).map((g) => g.geste)).toEqual(['reglages.nouveaute_allumee', 'reglages.nouveaute_ouverte', 'reglages.nouveaute_refermee']);
  });

  it('le support lit et ne touche à rien ; un geste sans motif est refusé ; une entreprise ne lit pas les nouveautés d\'une autre', async () => {
    const e = await entreprise('Quincaillerie Témoin');
    expect((await etat(support, SALLE))?.nom).toBe('La caisse en salle');
    for (const [g, corps] of [['allumer', { numero: e.numero, motif: 'le support essaie' }], ['eteindre', { entreprise: e.id, motif: 'le support essaie' }],
      ['ouvrir', { motif: 'le support essaie' }], ['refermer', { motif: 'le support essaie' }]] as const) {
      expect((await appeler('POST', `/console/reglages/nouveautes/${SALLE}/${g}`, support, corps)).statut, g).toBe(403);
    }
    expect((await appeler('POST', `/console/reglages/nouveautes/${SALLE}/allumer`, direction, { numero: e.numero, motif: '' })).statut).toBe(400);
    expect(await siennes(e)).toEqual([]);
    const intrus = await entreprise('Entreprise Intruse');
    expect((await appeler('GET', `/entreprises/${e.id}/nouveautes`, intrus.jeton)).statut).toBe(404);
    // La base aussi : celle d'une autre ne se lit pas, même en l'appelant directement.
    const q = await quiEst(ctx, intrus.jeton);
    await expect(enTantQue(pool, q?.utilisateur ?? null, (tx) => nouveautesDe(tx, e.id, LISTE))).rejects.toThrow(/accès à cette entreprise/);
    const p = await quiEst(ctx, e.jeton);
    expect(await enTantQue(pool, p?.utilisateur ?? null, (tx) => nouveautesDe(tx, e.id, LISTE))).toEqual([]);
  });
});
