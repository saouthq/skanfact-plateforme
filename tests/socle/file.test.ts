// La file d'opérations (04 § 4 à § 6), jouée par l'API contre la vraie base, avec deux gestes
// d'essai : poser un réglage (un geste ordinaire) et encaisser un ticket (un FAIT).

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { creerApp } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { MiseDeCote, registreDesTraitements, traitement } from '../../serveur/file.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { declarerGestes } from '../../serveur/porte/gestes.ts';
import { routesFile } from '../../serveur/routes/file.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = {
  pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
};

declarerGestes([
  { code: 'essai.reglage.poser', module: 'essai', libelle: 'poser un réglage d\'essai', ecrit: true, roles: { proprietaire: 'oui', administrateur: 'oui' } },
  { code: 'essai.ticket.encaisser', module: 'essai', libelle: 'encaisser un ticket d\'essai', ecrit: true, roles: { proprietaire: 'oui', caissier: 'oui' } },
]);
const reglage = traitement<{ code: string; valeur: number; miseDeCote?: boolean | undefined; panne?: boolean | undefined }>({
  geste: 'essai.reglage.poser', formats: [1, 2],
  charge: z.object({ code: z.string(), valeur: z.number().int(), miseDeCote: z.boolean().optional(), panne: z.boolean().optional() }),
  traiter: async (tx, op) => {
    const id = (await tx.query(`select socle.poser_regle_entreprise($1, $2, $3, '2026-01-01', null, 'Essai de la file') id`,
      [op.entreprise, op.charge.code, JSON.stringify(op.charge.valeur)])).rows[0].id;
    if (op.charge.miseDeCote) throw new MiseDeCote('la fiche a changé depuis que le poste l\'a lue');
    if (op.charge.panne) throw new Error('panne du serveur');
    return { regle: id };
  },
});
const ticket = traitement<{ montant: number }>({
  geste: 'essai.ticket.encaisser', fait: true, formats: [1],
  charge: z.object({ montant: z.number().int() }),
  traiter: async (tx, op) => {
    await tx.query(`select socle.tracer($1, 'essai.ticket.encaisser', 'ticket', $2, null, $3)`, [op.entreprise, op.id, JSON.stringify(op.charge)]);
    return { ticket: op.id };
  },
});

let app: FastifyInstance;
type Reponse = { statut: number; corps: Record<string, unknown> & { motif?: string } };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `file-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse', type: 'bureau' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
// Une entreprise avec son propriétaire (code en place), et un membre par rôle demandé.
async function entreprise(...roles: string[]) {
  const proprio = await personne('proprio');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: 'Épicerie de l\'essai' })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const membres = [];
  for (const role of roles) {
    const p = await personne(role);
    const jeton = String((await appeler('POST', `/entreprises/${ent}/invitations`, proprio.jeton, { email: p.email, roles: [role] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', p.jeton, { jeton });
    membres.push(p);
  }
  return { ent, proprio, membres };
}
const maintenant = () => new Date().toISOString();
const op = (ent: string, ordre: number, geste: string, charge: unknown, autre: Record<string, unknown> = {}) =>
  ({ id: randomUUID(), ordre, geste, entreprise: ent, format: 1, instantPoste: maintenant(), charge, ...autre });
const envoyer = async (jeton: string, ...operations: unknown[]) => {
  const r = await appeler('POST', '/operations', jeton, { operations });
  expect(r.statut).toBe(200);
  return r.corps.reponses as { id: string; statut: string; motif?: string; manque?: number; resultat?: unknown }[];
};
const reglesPosees = async (ent: string, code: string) => Number((await admin.query('select count(*) n from socle.regle_entreprise where entreprise = $1 and code = $2', [ent, code])).rows[0].n);

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesFile(ctx, registreDesTraitements(reglage, ticket))]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('la file d\'un appareil (04 § 4)', () => {
  it('un geste envoyé deux fois ne compte qu\'une fois, et reçoit la même réponse', async () => {
    const { ent, proprio } = await entreprise();
    const o = op(ent, 1, 'essai.reglage.poser', { code: 'essai.file', valeur: 5 });
    const [premiere] = await envoyer(proprio.jeton, o);
    expect(premiere?.statut).toBe('acceptee');
    const [seconde] = await envoyer(proprio.jeton, o);
    expect(seconde).toEqual({ id: o.id, statut: 'deja_recue', resultat: premiere?.resultat });
    expect(await reglesPosees(ent, 'essai.file')).toBe(1);
  });

  it('les gestes se rejouent dans l\'ordre ; un trou arrête la file et dit lequel manque', async () => {
    const { ent, proprio } = await entreprise();
    const [o1, o2, o3] = [1, 2, 3].map((i) => op(ent, i, 'essai.reglage.poser', { code: `essai.ordre${i}`, valeur: i }));
    expect((await envoyer(proprio.jeton, o1))[0]?.statut).toBe('acceptee');
    expect(await envoyer(proprio.jeton, o3)).toEqual([{ id: o3?.id, statut: 'manquante', manque: 2, motif: 'Il manque le geste n° 2 de cet appareil : il faut l\'envoyer d\'abord.' }]);
    // Envoyés dans le désordre, ils sont rejoués dans l'ordre.
    expect((await envoyer(proprio.jeton, o3, o2)).map((r) => [r.id, r.statut])).toEqual([[o2?.id, 'acceptee'], [o3?.id, 'acceptee']]);
  });

  it('un numéro d\'ordre déjà pris par un autre geste est refusé, sans rien noter', async () => {
    const { ent, proprio } = await entreprise();
    await envoyer(proprio.jeton, op(ent, 1, 'essai.reglage.poser', { code: 'essai.a', valeur: 1 }));
    const [r] = await envoyer(proprio.jeton, op(ent, 1, 'essai.reglage.poser', { code: 'essai.b', valeur: 1 }));
    expect(r).toMatchObject({ statut: 'refusee', motif: 'Le numéro d\'ordre 1 a déjà servi à un autre geste de cet appareil.' });
    expect(await reglesPosees(ent, 'essai.b')).toBe(0);
  });

  it('un geste refusé par la porte va dans « À reprendre », et n\'arrête pas la suite', async () => {
    const { ent, proprio, membres: [caissier, commercial] } = await entreprise('caissier', 'commercial');
    const refuse = op(ent, 1, 'essai.reglage.poser', { code: 'essai.caisse', valeur: 1 });
    const r = await envoyer(caissier?.jeton ?? '', refuse, op(ent, 2, 'essai.ticket.encaisser', { montant: 12500 }));
    expect(r[0]).toMatchObject({ statut: 'refusee', motif: expect.stringMatching(/^Ton rôle \(Caissier\) ne permet pas de poser un réglage d'essai\./) });
    expect(r[1]?.statut).toBe('acceptee');
    const lignes = async (jeton: string) => ((await appeler('GET', `/entreprises/${ent}/a-reprendre`, jeton)).corps.lignes as { id: string }[]).map((l) => l.id);
    expect(await lignes(caissier?.jeton ?? '')).toEqual([refuse.id]);
    expect(await lignes(proprio.jeton)).toEqual([refuse.id]);
    expect(await lignes(commercial?.jeton ?? '')).toEqual([]);
  });

  it('un fait n\'est jamais refusé : le ticket d\'une caissière retirée attend la décision du propriétaire', async () => {
    const { ent, proprio, membres: [caissier] } = await entreprise('caissier');
    const membre = (await admin.query('select id from socle.membre where entreprise = $1 and utilisateur = $2', [ent, caissier?.id])).rows[0].id;
    await appeler('DELETE', `/entreprises/${ent}/membres/${membre}`, proprio.jeton);
    const t = op(ent, 1, 'essai.ticket.encaisser', { montant: 7250 });
    expect((await envoyer(caissier?.jeton ?? '', t))[0]).toEqual({ id: t.id, statut: 'en_attente_decision', motif: 'Tu ne fais plus partie de cette entreprise.' });
    const vues = (await appeler('GET', `/entreprises/${ent}/a-reprendre`, proprio.jeton)).corps.lignes as { id: string; nom: string; charge: unknown }[];
    expect(vues).toMatchObject([{ id: t.id, nom: expect.stringMatching(/^caissier/), charge: { montant: 7250 } }]);
  });

  it('un geste mis de côté ne laisse rien derrière lui', async () => {
    const { ent, proprio } = await entreprise();
    const [r] = await envoyer(proprio.jeton, op(ent, 1, 'essai.reglage.poser', { code: 'essai.cote', valeur: 1, miseDeCote: true }));
    expect(r).toMatchObject({ statut: 'mise_de_cote', motif: 'La fiche a changé depuis que le poste l\'a lue.' });
    expect(await reglesPosees(ent, 'essai.cote')).toBe(0);
  });

  it('une erreur du serveur n\'avale pas le geste : rien n\'est noté, la file s\'arrête là et reprend ensuite', async () => {
    const { ent, proprio } = await entreprise();
    const suivant = op(ent, 2, 'essai.reglage.poser', { code: 'essai.apres', valeur: 1 });
    const r = await envoyer(proprio.jeton, op(ent, 1, 'essai.reglage.poser', { code: 'essai.panne', valeur: 1, panne: true }), suivant);
    expect(r.map((x) => x.statut)).toEqual(['erreur']);
    expect(await reglesPosees(ent, 'essai.panne')).toBe(0);
    expect((await admin.query('select count(*) n from socle.operation where entreprise = $1', [ent])).rows[0].n).toBe('0');
    const [repris] = await envoyer(proprio.jeton, op(ent, 1, 'essai.reglage.poser', { code: 'essai.panne', valeur: 1 }));
    expect(repris?.statut).toBe('acceptee');
  });

  it('un geste illisible, d\'un format inconnu ou d\'un genre inconnu est refusé en disant pourquoi', async () => {
    const { ent, proprio } = await entreprise();
    const r = await envoyer(proprio.jeton,
      op(ent, 1, 'essai.reglage.poser', { valeur: 1 }),
      op(ent, 2, 'essai.reglage.poser', { code: 'essai.x', valeur: 1 }, { format: 9 }),
      op(ent, 3, 'essai.inconnu.faire', {}));
    expect(r.map((x) => x.motif)).toEqual([
      expect.stringMatching(/^Le geste est illisible : le champ « code » ne va pas/),
      'Le format 9 de ce geste n\'est pas lu par ce serveur.',
      'Ce serveur ne connaît pas le geste « essai.inconnu.faire » : l\'application est peut-être plus récente que lui.',
    ]);
  });

  it('une horloge de poste qui s\'écarte de plus de 5 minutes se signale', async () => {
    const { ent, proprio } = await entreprise();
    const loin = op(ent, 1, 'essai.reglage.poser', { code: 'essai.h1', valeur: 1 }, { instantPoste: new Date(Date.now() - 10 * 60_000).toISOString() });
    const pres = op(ent, 2, 'essai.reglage.poser', { code: 'essai.h2', valeur: 1 }, { instantPoste: new Date(Date.now() - 60_000).toISOString() });
    await envoyer(proprio.jeton, loin, pres);
    const r = (await admin.query('select id, horloge_ecartee from socle.operation where id = any($1) order by ordre', [[loin.id, pres.id]])).rows;
    expect(r.map((x) => x.horloge_ecartee)).toEqual([true, false]);
  });

  it('l\'identifiant d\'un geste d\'un autre appareil ne se réutilise pas', async () => {
    const { ent, proprio } = await entreprise();
    const o = op(ent, 1, 'essai.reglage.poser', { code: 'essai.vol', valeur: 1 });
    await envoyer(proprio.jeton, o);
    const autre = await personne('autre');
    const [r] = await envoyer(autre.jeton, { ...o });
    expect(r).toMatchObject({ statut: 'refusee', motif: 'Cet identifiant de geste appartient à un autre appareil.' });
  });
});

describe('« À reprendre » (04 § 5.2)', () => {
  it('ne se vide que par un geste, avec un mot, une seule fois, et laisse sa trace', async () => {
    const { ent, proprio, membres: [caissier, commercial] } = await entreprise('caissier', 'commercial');
    const refuse = op(ent, 1, 'essai.reglage.poser', { code: 'essai.rep', valeur: 1 });
    await envoyer(caissier?.jeton ?? '', refuse);
    expect((await appeler('POST', `/operations/${refuse.id}/reprendre`, proprio.jeton, { resolution: '  ' })).statut).toBe(400);
    expect((await appeler('POST', `/operations/${refuse.id}/reprendre`, commercial?.jeton ?? '', { resolution: 'Pas à moi' })).statut).toBe(403);
    expect((await appeler('POST', `/operations/${refuse.id}/reprendre`, proprio.jeton, { resolution: 'Réglage refait par le propriétaire' })).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/a-reprendre`, proprio.jeton)).corps.lignes).toEqual([]);
    const encore = await appeler('POST', `/operations/${refuse.id}/reprendre`, proprio.jeton, { resolution: 'Encore' });
    expect(encore).toMatchObject({ statut: 403, corps: { motif: 'Cette opération a déjà été reprise.' } });
    const trace = (await admin.query(`select apres from socle.audit where objet_id = $1 and geste = 'socle.operation.resoudre'`, [refuse.id])).rows;
    expect(trace).toEqual([{ apres: { resolution: 'Réglage refait par le propriétaire' } }]);
  });

  it('une opération reçue ne se modifie pas et ne s\'efface pas', async () => {
    const { ent, proprio } = await entreprise();
    await envoyer(proprio.jeton, op(ent, 1, 'essai.reglage.poser', { code: 'essai.fige', valeur: 1 }));
    await expect(admin.query(`update socle.operation set charge = '{}' where entreprise = $1`, [ent])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query(`delete from socle.operation where entreprise = $1`, [ent])).rejects.toMatchObject({ code: '42501' });
  });

  it('la base elle-même refuse un numéro d\'ordre qui n\'est pas le suivant, et la file d\'un autre', async () => {
    const { ent, proprio } = await entreprise();
    const autre = await personne('autre');
    const appareil = (await admin.query('select id from socle.appareil where utilisateur = $1', [proprio.id])).rows[0].id;
    await expect(enTantQue(pool, proprio.id, async (tx) => {
      await tx.query('select socle.file_prendre($1)', [appareil]);
      await tx.query(`select socle.noter_operation($1, $2, $3, 5, 'essai.reglage.poser', 1, null, now(), '{}', 'acceptee', null, null)`, [randomUUID(), appareil, ent]);
    })).rejects.toMatchObject({ code: '42501' });
    await expect(enTantQue(pool, autre.id, (tx) => tx.query('select socle.file_prendre($1)', [appareil]))).rejects.toMatchObject({ code: '42501' });
  });

  it('un geste déjà déclaré ne se remplace pas', () => {
    expect(() => declarerGestes([{ code: 'socle.equipe.gerer', module: 'essai', libelle: 'tout faire', ecrit: true, roles: { lecture: 'oui' } }]))
      .toThrow(/déclaré deux fois/);
  });

  it('le serveur ne démarre pas avec un traitement dont la porte ignore le geste', () => {
    const fantome = { ...reglage, geste: 'essai.fantome.faire' };
    expect(() => routesFile(ctx, registreDesTraitements(fantome))).toThrow(/ne connaît pas/);
  });
});
