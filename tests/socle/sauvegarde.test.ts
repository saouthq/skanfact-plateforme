// La sauvegarde et l'exercice de restauration (06 § 4.3) : une sauvegarde saine se restaure dans
// une base vide et se contrôle sans une erreur ; un fichier abîmé, un maillon falsifié, une série
// qui ne tombe plus juste (un maillon sans pièce) et une table qui a perdu des lignes sont chacun dits. Sur une base à part :
// d'autres tests cassent des chaînes exprès dans la base commune.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exerciceDeRestauration, sauvegarder, type Manifeste } from '../../base/sauvegarde.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { baseNeuve } from '../base-neuve.ts';

describe('la sauvegarde et l\'exercice de restauration', () => {
  let base: Awaited<ReturnType<typeof baseNeuve>>;
  let admin: pg.Client;
  let pool: pg.Pool;
  let app: FastifyInstance;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sauvegarde-'));
  const fichier = (nom: string) => path.join(dossier, nom);
  let ent = '';
  let brouillon = '';

  beforeAll(async () => {
    base = await baseNeuve('skanfact_sauvegarde');
    admin = new pg.Client({ connectionString: base.admin });
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source) values ('timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests')`);
    pool = creerPool(base.app);
    const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
    declarerGestesVentes();
    app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx)]);
    await app.ready();
    const appeler = async (methode: 'POST' | 'GET', url: string, jeton?: string, corps?: unknown) => (await app.inject({
      method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }),
    })).json() as Record<string, unknown>;
    await appeler('POST', '/inscription', undefined, { email: 'sauvegarde@exemple.tn', nom: 'Sauvegarde', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await appeler('POST', '/connexion', undefined, { email: 'sauvegarde@exemple.tn', motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Atelier sauvegardé' })).id);
    await appeler('POST', '/moi/code', jeton, { methode: 'application' });
    await admin.query(`insert into socle.serie (entreprise, type, prefixe, legale) values ($1, 'facture', 'FAC', true)`, [ent]);
    const client = String((await appeler('POST', `/entreprises/${ent}/clients`, jeton, { raisonSociale: 'Client sauvegardé' })).id);
    const piece = async () => String((await appeler('POST', `/entreprises/${ent}/ventes`, jeton, { type: 'facture', tiers: client, datePiece: '2026-10-01',
      lignes: [{ designation: 'Table', quantite: '1', prixUnitaire: '450.500', tauxTva: '19' }] })).id);
    for (let i = 0; i < 3; i++) await appeler('POST', `/entreprises/${ent}/ventes/${await piece()}/emettre`, jeton);
    brouillon = await piece();
  });
  afterAll(async () => { await app.close(); await pool.end(); await admin.end(); await base.jeter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  it('une sauvegarde saine se restaure dans une base vide et se contrôle sans une erreur, en un temps mesuré', async () => {
    const m = await sauvegarder(base.admin, fichier('saine.dump'));
    expect(m.tables['ventes.piece']).toBe(4);
    expect(m.chaines).toHaveLength(1);
    expect(m.chaines[0]?.rang).toBe('3');
    const r = await exerciceDeRestauration(fichier('saine.dump'), base.admin);
    expect(r.erreurs).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.tables).toBe(Object.keys(m.tables).length);
    expect(r.lignes).toBe(Object.values(m.tables).reduce((a, b) => a + b, 0));
    expect(r.chaines).toBe(1);
    expect(r.dureeMs).toBeGreaterThan(0);
    // La base de l'exercice est jetée ensuite.
    expect(Number((await admin.query(`select count(*) n from pg_database where datname = $1`, [r.base])).rows[0].n)).toBe(0);
  });

  it('un fichier abîmé est refusé ; une table qui a perdu des lignes est dite', async () => {
    fs.copyFileSync(fichier('saine.dump'), fichier('abime.dump'));
    fs.copyFileSync(fichier('saine.dump.manifeste.json'), fichier('abime.dump.manifeste.json'));
    const octets = fs.readFileSync(fichier('abime.dump'));
    octets[octets.length - 10] = (octets[octets.length - 10] ?? 0) ^ 0xff;
    fs.writeFileSync(fichier('abime.dump'), octets);
    expect((await exerciceDeRestauration(fichier('abime.dump'), base.admin)).erreurs).toEqual(['le fichier de sauvegarde n\'est pas celui du manifeste (abîmé ou remplacé)']);

    fs.copyFileSync(fichier('saine.dump'), fichier('lignes.dump'));
    const m = JSON.parse(fs.readFileSync(fichier('saine.dump.manifeste.json'), 'utf8')) as Manifeste;
    m.tables['ventes.ligne'] = (m.tables['ventes.ligne'] ?? 0) + 2;
    fs.writeFileSync(fichier('lignes.dump.manifeste.json'), JSON.stringify(m));
    expect((await exerciceDeRestauration(fichier('lignes.dump'), base.admin)).erreurs).toEqual([`ventes.ligne : ${m.tables['ventes.ligne']} lignes sauvegardées, ${(m.tables['ventes.ligne'] ?? 0) - 2} restaurées`]);
  });

  it('un maillon falsifié et une série qui ne tombe plus juste sont dits, chacun', async () => {
    // Deux défauts posés à la main dans la base (les règles de la base mises de côté pour l'essai).
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`update socle.maillon set empreinte = repeat('a', 64) where entreprise = $1 and rang = 2`, [ent]);
    // Un maillon en trop au bout de la chaîne, bien chaîné, mais sans pièce émise derrière lui.
    await admin.query(`insert into socle.maillon (entreprise, cle, rang, objet_type, objet_id, contenu, precedente, empreinte)
      select entreprise, cle, 4, objet_type, $2, contenu, empreinte, socle.empreinte_maillon(empreinte, contenu) from socle.maillon where entreprise = $1 and rang = 3`, [ent, brouillon]);
    await admin.query(`update socle.chaine c set rang = 4, derniere = m.empreinte from socle.maillon m
      where m.entreprise = c.entreprise and m.cle = c.cle and m.rang = 4 and c.entreprise = $1`, [ent]);
    await admin.query('commit');
    await sauvegarder(base.admin, fichier('falsifiee.dump'));
    const r = await exerciceDeRestauration(fichier('falsifiee.dump'), base.admin);
    expect(r.ok).toBe(false);
    const serie = (await admin.query(`select id from socle.serie where entreprise = $1`, [ent])).rows[0].id as string;
    expect(r.erreurs).toEqual([
      `chaîne serie:${serie} de ${ent} : le maillon 2 ne va pas`,
      `la série ${serie} compte 3 pièces émises et 4 maillons`,
    ]);
  });
});
