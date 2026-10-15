// Le support et les travaux suivis (1.22.0 ; base 0115 ; docs/console.md C38 ; l'audit du 14/10/2026, troisième partie) :
//   - une demande a quelqu'un qui la suit, qu'on confie ; une priorité ; l'attente de la technique (F13) ;
//   - un envoi arrêté sur une panne se reprend ; un refus ou un compte retenu, jamais d'ici (F18) ;
//   - les e-mails laissent une trace : l'instant et s'ils sont partis, rien d'autre (F19) ;
//   - les chaînes d'empreintes se relisent seules, et une chaîne cassée se voit — dans la console et à la veille (F21).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { avecTrace } from '../../serveur/courriel.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { etatRelecture, lireChaines, RELECTURE_ARRETEE_H } from '../../serveur/console/chaines.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { relireLesChaines } from '../../serveur/service/chaines.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { BRIQUES, briqueDe, CHAINES_ARRETEES_H, problemes, REGLES, type Releve } from '../../exploitation/veille.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0, matricules = 0;
async function personne(prenom: string) {
  const email = `suivi-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id), nom: `${prenom} ${n}` };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(c.corps.etat, JSON.stringify(c.corps)).toBe('connecte');
  return { ...p, console: String(c.corps.jeton) };
}
async function entreprise(nom: string) {
  const p = await personne('proprio');
  const cree = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom, matriculeFiscal: `${String(5_400_000 + ++matricules).slice(-7)}C/A/M/000` });
  expect(cree.statut, JSON.stringify(cree.corps)).toBeLessThan(300);
  return { ent: String(cree.corps.id), proprio: p };
}
// Une demande écrite depuis l'application, il y a `heures` heures.
async function demande(ent: string, demandeur: string, sujet: string, heures: number) {
  const le = new Date(horloge.getTime() - heures * 3_600_000);
  const id = (await admin.query(`insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, ouverte_le) values ($1, $2, 'application', $3, $4) returning id`,
    [ent, demandeur, sujet, le])).rows[0].id as string;
  await admin.query(`insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le) values ($1, 'client', $2, 'Bonjour, ça ne marche pas.', $3)`, [id, demandeur, le]);
  return id;
}

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let technique: Awaited<ReturnType<typeof membre>>;

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  support = await membre('support', 'support');
  technique = await membre('technique', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

type LigneLue = { id: string; suiviePar: string | null; suivieParId: string | null; priorite: string; technique: { motif: string } | null;
  etat: { etat: string; sansReponse?: boolean } };
const laListe = async (jeton: string, ent: string) => (await appeler('GET', `/console/support?entreprise=${ent}`, jeton)).corps as { ouvertes: LigneLue[]; equipe: { id: string; role: string }[] };

describe('une demande suivie (0115, l\'audit F13)', () => {
  it('on la prend, on la confie à qui répond au support ; jamais à la technique ; chaque geste au journal', async () => {
    const { ent, proprio } = await entreprise('Boulangerie Suivie');
    const id = await demande(ent, proprio.id, 'La facture ne part pas', 1);
    // Personne ne la suit ; le support la prend.
    expect((await laListe(support.console, ent)).ouvertes[0]).toMatchObject({ suiviePar: null, priorite: 'normale', technique: null });
    expect((await appeler('POST', `/console/support/demandes/${id}/suivre`, support.console, { motif: 'je connais ce client' })).statut).toBe(200);
    expect((await laListe(support.console, ent)).ouvertes[0]).toMatchObject({ suivieParId: support.id, suiviePar: support.nom });
    // La reprendre quand on la suit déjà : refusé, et dit.
    const deja = await appeler('POST', `/console/support/demandes/${id}/suivre`, support.console, { motif: 'encore moi' });
    expect(deja.statut).toBe(403);
    expect(String(deja.corps.motif)).toMatch(/suit déjà/);
    // La confier à la technique : refusé (elle ne lit aucun client). À la direction : oui.
    expect((await appeler('POST', `/console/support/demandes/${id}/suivre`, support.console, { membre: technique.id, motif: 'question technique' })).statut).toBe(403);
    expect((await laListe(support.console, ent)).equipe.some((m) => m.id === technique.id)).toBe(false);
    expect((await appeler('POST', `/console/support/demandes/${id}/suivre`, support.console, { membre: direction.id, motif: 'un geste commercial à décider' })).statut).toBe(200);
    // Sans motif : refusé, le champ nommé. La technique ne touche pas au support.
    const sans = await appeler('POST', `/console/support/demandes/${id}/suivre`, direction.console, { motif: ' ' });
    expect(sans.corps.champ).toBe('motif');
    expect((await appeler('POST', `/console/support/demandes/${id}/suivre`, technique.console, { motif: 'je regarde' })).statut).toBe(403);
    const j = (await appeler('GET', `/console/journal?q=${encodeURIComponent('un geste commercial à décider')}`, direction.console)).corps.lignes as { geste: string; avant: { suiviePar: string }; apres: { suiviePar: string } }[];
    expect(j).toEqual([expect.objectContaining({ geste: 'support.confiee', avant: expect.objectContaining({ suiviePar: support.nom }), apres: expect.objectContaining({ suiviePar: direction.nom }) })]);
    // Une demande close ne se confie pas.
    await appeler('POST', `/console/support/demandes/${id}/clore`, direction.console, { motif: 'réglé au téléphone' });
    expect((await appeler('POST', `/console/support/demandes/${id}/suivre`, support.console, { motif: 'après coup' })).statut).toBe(403);
  });

  it('urgente : sans réponse après deux heures, et en tête ; normale : vingt-quatre', async () => {
    const { ent, proprio } = await entreprise('Caisse Arrêtée');
    const normale = await demande(ent, proprio.id, 'Une question sur un rapport', 3);
    const urgente = await demande(ent, proprio.id, 'La caisse ne démarre plus', 1);
    expect((await appeler('POST', `/console/support/demandes/${urgente}/priorite`, support.console, { priorite: 'urgente', motif: 'caisse arrêtée en plein service' })).statut).toBe(200);
    let l = (await laListe(support.console, ent)).ouvertes;
    // Une heure : l'urgente n'est pas encore sans réponse, mais passe devant la normale (plus ancienne).
    expect(l.map((x) => x.id)).toEqual([urgente, normale]);
    expect(l[0]).toMatchObject({ priorite: 'urgente', etat: { etat: 'nouvelle', sansReponse: false } });
    // Quatre-vingt-dix minutes plus tard (la demande recule : avancer l'horloge fermerait la session de la console).
    // Un message ne se modifie pas : on le recule déclencheurs suspendus.
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`update plateforme.message_support set ecrit_le = ecrit_le - interval '90 minutes' where demande = any($1)`, [[urgente, normale]]);
    await admin.query(`update plateforme.demande_support set ouverte_le = ouverte_le - interval '90 minutes' where id = any($1)`, [[urgente, normale]]);
    await admin.query('commit');
    l = (await laListe(support.console, ent)).ouvertes;
    expect(l.find((x) => x.id === urgente)?.etat.sansReponse).toBe(true);
    expect(l.find((x) => x.id === normale)?.etat.sansReponse).toBe(false);
    // La même priorité deux fois : refusé.
    expect((await appeler('POST', `/console/support/demandes/${urgente}/priorite`, support.console, { priorite: 'urgente', motif: 'encore' })).statut).toBe(403);
  });

  it('elle attend la technique, avec son motif ; le client réécrit : elle revient à nous ; la technique répond : elle revient au support', async () => {
    const { ent, proprio } = await entreprise('Export Bloqué');
    const id = await demande(ent, proprio.id, 'L\'export TEJ est vide', 5);
    expect((await appeler('POST', `/console/support/demandes/${id}/technique`, support.console, { attend: true, motif: 'export TEJ vide : à corriger' })).statut).toBe(200);
    let d = (await laListe(support.console, ent)).ouvertes[0];
    expect(d).toMatchObject({ technique: { motif: 'export TEJ vide : à corriger' }, etat: { etat: 'attend_technique' } });
    // Elle n'est plus « à répondre » : l'accueil ne la compte pas.
    expect((await appeler('POST', `/console/support/demandes/${id}/technique`, support.console, { attend: true, motif: 'encore' })).statut).toBe(403);
    // Le client réécrit : elle attend un mot de nous (personne ne lui a encore répondu : « nouvelle »), l'attente de la
    // technique reste dite.
    await admin.query(`insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le) values ($1, 'client', $2, 'Alors ?', $3)`, [id, proprio.id, new Date(horloge.getTime() + 60_000)]);
    d = (await laListe(support.console, ent)).ouvertes[0];
    expect(d?.etat.etat).toBe('nouvelle');
    expect(d?.technique).not.toBeNull();
    expect((await appeler('POST', `/console/support/demandes/${id}/technique`, support.console, { attend: false, motif: 'corrigé en 1.22.1' })).statut).toBe(200);
    expect((await laListe(support.console, ent)).ouvertes[0]?.technique).toBeNull();
    const j = (await appeler('GET', `/console/journal?q=${encodeURIComponent('corrigé en 1.22.1')}`, direction.console)).corps.lignes as { geste: string }[];
    expect(j.map((x) => x.geste)).toEqual(['support.technique_levee']);
  });
});

describe('reprendre un envoi (0115, l\'audit F18)', () => {
  async function poser(piece: string, ent: string, statut: string, motif: unknown, prochainDans: number, par: string) {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`insert into ventes.envoi_ttn(piece, entreprise, statut, essais, prochain_essai, motif, cree_le, cree_par)
      values ($1, $2, $3, 3, $4, $5, $6, $7)`, [piece, ent, statut, new Date(horloge.getTime() + prochainDans), motif, horloge, par]);
    await admin.query('commit');
  }
  it('une panne repart au prochain tour, avec son motif ; un refus, un compte retenu, un envoi qui repart déjà : non', async () => {
    const { ent, proprio } = await entreprise('Envois Repris');
    await poser('01b2e000-0000-7000-8000-0000000a1b01', ent, 'a_envoyer', { cle: 'ttn.injoignable', valeurs: {} }, 3_600_000, proprio.id);
    await poser('01b2e000-0000-7000-8000-0000000a1b02', ent, 'refusee', { cle: 'ttn.refusee', valeurs: { accuses: 'matricule' } }, 0, proprio.id);
    await poser('01b2e000-0000-7000-8000-0000000a1b03', ent, 'a_envoyer', { cle: 'ttn.compte_refuse', valeurs: { message: 'identifiant inconnu' } }, 3_600_000, proprio.id);
    const motif = { motif: 'la TTN répond de nouveau depuis 9 h 40' };
    // Le support ne touche pas aux envois ; la technique, oui (elle ne voit que la clé).
    expect((await appeler('POST', '/console/service/travaux/envois/0A1B01/reprendre', technique.console, motif)).statut).toBe(404);
    expect((await appeler('POST', '/console/service/travaux/envois/00A1B01/reprendre', support.console, motif)).statut).toBe(403);
    expect((await appeler('POST', '/console/service/travaux/envois/000A1B01/reprendre', technique.console, motif)).statut).toBe(200);
    expect((await admin.query('select prochain_essai <= $2 dus, essais from ventes.envoi_ttn where piece = $1', ['01b2e000-0000-7000-8000-0000000a1b01', horloge])).rows[0]).toEqual({ dus: true, essais: 3 });
    const deja = await appeler('POST', '/console/service/travaux/envois/000A1B01/reprendre', technique.console, motif);
    expect(String(deja.corps.motif)).toMatch(/repart déjà/);
    const fini = await appeler('POST', '/console/service/travaux/envois/000A1B02/reprendre', direction.console, motif);
    expect(fini.statut).toBe(403);
    expect(String(fini.corps.motif)).toMatch(/un refus se corrige chez l'entreprise/);
    const compte = await appeler('POST', '/console/service/travaux/envois/000A1B03/reprendre', direction.console, motif);
    expect(String(compte.corps.motif)).toMatch(/compte El Fatoora/);
    const j = (await appeler('GET', `/console/journal?q=${encodeURIComponent('la TTN répond de nouveau depuis 9 h 40')}`, direction.console)).corps.lignes as { geste: string; entreprise: { id: string } | null; apres: { cle: string } }[];
    expect(j).toEqual([expect.objectContaining({ geste: 'service.envoi_repris', entreprise: expect.objectContaining({ id: ent }), apres: expect.objectContaining({ cle: '000A1B01' }) })]);
  });
});

describe('la trace des e-mails (0115, l\'audit F19)', () => {
  it('un e-mail parti, un e-mail refusé : l\'instant et l\'issue, rien d\'autre ; Travaux les compte', async () => {
    const avant = (await admin.query('select count(*)::int n from plateforme.courriel_trace')).rows[0].n as number;
    let refuse = false;
    const envoi = avecTrace(pool, { envoyer: async () => { if (refuse) throw new Error('le relais refuse'); } });
    await envoi.envoyer({ a: 'quelqu-un@exemple.tn', objet: 'Ton code', texte: 'Bonjour,\n\n123456\n\nSkanFact' });
    refuse = true;
    await expect(envoi.envoyer({ a: 'quelqu-un@exemple.tn', objet: 'Ton code', texte: '…' })).rejects.toThrow('le relais refuse');
    const lignes = (await admin.query('select * from plateforme.courriel_trace order by le desc limit 2')).rows as Record<string, unknown>[];
    expect((await admin.query('select count(*)::int n from plateforme.courriel_trace')).rows[0].n).toBe(avant + 2);
    // Deux colonnes, et rien d'autre : ni l'adresse, ni l'objet.
    expect(Object.keys(lignes[0] ?? {}).sort()).toEqual(['le', 'ok']);
    expect(lignes.map((l) => l.ok).sort()).toEqual([false, true]);
    // Une personne connectée ne note rien.
    await expect(enTantQue(pool, direction.id, (tx) => tx.query('select plateforme.noter_courriel(true, now())'))).rejects.toThrow();
    const t = (await appeler('GET', '/console/service/travaux', technique.console)).corps as { partenaires: { nom: string; jours: { n: number; bons: number; refus: number }[] }[]; sansTrace: string[] };
    const c = t.partenaires.find((p) => p.nom === 'courriel');
    expect(c?.jours.at(-1)).toMatchObject({ bons: expect.any(Number), refus: expect.any(Number) });
    expect((c?.jours.at(-1)?.refus ?? 0)).toBeGreaterThanOrEqual(1);
    expect(t.sansTrace).toEqual(['tej', 'cnss']);
  });
});

describe('les chaînes d\'empreintes, relues seules (0115, l\'audit F21)', () => {
  it('relues par le serveur, par lots ; une chaîne cassée garde son point de rupture ; la console et la veille la voient', async () => {
    const { ent, proprio } = await entreprise('Chaîne Relue');
    const cle = `livres:${ent}`;
    await enTantQue(pool, proprio.id, async (tx) => {
      for (const k of [1, 2, 3]) {
        await tx.query('select * from socle.sceller($1, $2, $3, gen_random_uuid(), $4)', [ent, cle, 'ecriture', String(k).repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, 'a')]);
      }
    });
    // Toutes les chaînes de la base, en un passage (un grand lot) : celle-ci est intacte.
    await enTantQue(pool, null, (tx) => tx.query('select plateforme.relire_chaines($1, 100000)', [horloge]));
    let ch = (await admin.query('select controle_ok, casse_rang from socle.chaine where entreprise = $1 and cle = $2', [ent, cle])).rows[0];
    expect(ch).toEqual({ controle_ok: true, casse_rang: null });
    // Un maillon modifié après coup (la base le refuse : on le pose déclencheurs suspendus, comme un intrus le ferait).
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query('update socle.maillon set contenu = $3 where entreprise = $1 and cle = $2 and rang = 2', [ent, cle, 'f'.repeat(64)]);
    await admin.query('commit');
    horloge = new Date(horloge.getTime() + 60_000);
    await enTantQue(pool, null, (tx) => tx.query('select plateforme.relire_chaines($1, 100000)', [horloge]));
    ch = (await admin.query('select controle_ok, casse_rang::int casse_rang, casse_motif from socle.chaine where entreprise = $1 and cle = $2', [ent, cle])).rows[0];
    expect(ch).toEqual({ controle_ok: false, casse_rang: 2, casse_motif: 'empreinte fausse' });
    // Le tour du serveur (un lot) note sa relecture ; une personne ne relit pas tout.
    const r = await relireLesChaines(pool, new Date(horloge.getTime() + 60_000));
    expect(r.cassees).toBeGreaterThanOrEqual(1);
    await expect(enTantQue(pool, proprio.id, (tx) => tx.query('select plateforme.relire_chaines(now(), 10)'))).rejects.toThrow();
    // La porte d'une personne dit la même rupture (le même contrôle).
    const porte = (await enTantQue(pool, proprio.id, (tx) => tx.query('select ok, rang::int rang, motif from socle.controler_chaine($1, $2)', [ent, cle]))).rows[0];
    expect(porte).toMatchObject({ ok: false, rang: 2, motif: 'empreinte fausse' });
    // La console : la direction voit l'entreprise, la technique la sorte et le rang seulement.
    const s = (await appeler('GET', '/console/service/securite', direction.console)).corps.chaines as { etat: string; nCassees: number; cassees: { sorte: string; rang: number; entreprise: { id: string } | null }[]; jours: { etat: string }[] };
    expect(s.etat).toBe('casse');
    expect(s.cassees.find((c) => c.entreprise?.id === ent)).toMatchObject({ sorte: 'livres', rang: 2 });
    expect(s.jours).toHaveLength(30);
    expect(s.jours.at(-1)?.etat).toBe('casse');
    const t = (await appeler('GET', '/console/service/securite', technique.console)).corps.chaines as { cassees: { entreprise: unknown }[] };
    expect(t.cassees.every((c) => c.entreprise === null)).toBe(true);
    expect(JSON.stringify(t)).not.toContain(ent);
    // La veille lit les chaînes cassées.
    const v = (await enTantQue(pool, null, (tx) => tx.query('select plateforme.veille_lire($1, 15) v', [horloge]))).rows[0].v as { chaines: { cassees: number; dernierLe: string } };
    expect(v.chaines.cassees).toBeGreaterThanOrEqual(1);
    expect(v.chaines.dernierLe).toBeTruthy();
    // Le maillon remis, la relecture suivante la dit intacte (et les essais suivants ne voient pas une chaîne cassée).
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query('update socle.maillon set contenu = $3 where entreprise = $1 and cle = $2 and rang = 2', [ent, cle, '2'.repeat(64)]);
    await admin.query('commit');
    await enTantQue(pool, null, (tx) => tx.query('select plateforme.relire_chaines($1, 100000)', [new Date(horloge.getTime() + 120_000)]));
    expect((await admin.query('select controle_ok, casse_rang from socle.chaine where entreprise = $1 and cle = $2', [ent, cle])).rows[0]).toEqual({ controle_ok: true, casse_rang: null });
  });
});

describe('les chaînes, lues sans la base', () => {
  const releve = (chaines: Exclude<Releve['chaines'], undefined>): Releve => ({ maintenant: new Date('2026-10-15T10:00:00Z'), serviceRepond: true, base: true, etat: null, disques: [], certificat: null, chaines });
  it('une chaîne cassée est grave ; une relecture arrêtée depuis vingt-six heures se dit ; jamais relue : rien', () => {
    const cles = (r: Releve) => problemes(r).filter((p) => p.cle.startsWith('chaine')).map((p) => [p.cle, p.grave]);
    expect(cles(releve({ cassees: 2, dernierLe: '2026-10-15T09:00:00Z' }))).toEqual([['chaine', true]]);
    expect(cles(releve({ cassees: 0, dernierLe: '2026-10-14T07:59:00Z' }))).toEqual([['chaine-relecture', false]]);
    expect(cles(releve({ cassees: 0, dernierLe: '2026-10-14T08:01:00Z' }))).toEqual([]);
    expect(cles(releve({ cassees: 0, dernierLe: null }))).toEqual([]);
    expect(cles(releve(null))).toEqual([]);
    // Ses clés ont leur brique et leur règle, branchée ; le seuil est le même des deux côtés.
    expect(briqueDe('chaine')).toBe('chaines');
    expect(briqueDe('chaine-relecture')).toBe('chaines');
    expect(BRIQUES.some((b) => b.id === 'chaines')).toBe(true);
    expect(REGLES.find((r) => r.id === 'chaine')).toMatchObject({ brique: 'chaines', branchee: true });
    expect(CHAINES_ARRETEES_H).toBe(RELECTURE_ARRETEE_H);
  });
  it('l\'état de la relecture : cassée d\'abord, puis arrêtée, puis jamais ; une lecture illisible vaut « rien »', () => {
    const m = new Date('2026-10-15T10:00:00Z');
    expect(etatRelecture({ nCassees: 1, dernier: null }, m)).toBe('casse');
    expect(etatRelecture({ nCassees: 0, dernier: null }, m)).toBe('jamais');
    expect(etatRelecture({ nCassees: 0, dernier: { le: '2026-10-14T07:00:00Z', chaines: 1, maillons: 1, cassees: 0, dureeMs: 1 } }, m)).toBe('arretee');
    expect(etatRelecture({ nCassees: 0, dernier: { le: '2026-10-15T09:00:00Z', chaines: 1, maillons: 1, cassees: 0, dureeMs: 1 } }, m)).toBe('bonne');
    expect(lireChaines(null)).toMatchObject({ dernier: null, total: 0, nCassees: 0, cassees: [], jours: [] });
  });
});
