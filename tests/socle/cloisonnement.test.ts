// Le cloisonnement entre entreprises (01 R2, 03 D1 et § 9) : c'est la BASE qui refuse, même si le
// code du serveur se trompait. Chaque test se connecte comme le serveur (rôle skanfact_app) et agit
// au nom d'une personne précise.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
// Un pool d'UNE connexion : la même connexion resservira d'une personne à l'autre, ce qui permet de
// prouver qu'elle ne garde jamais le nom de la précédente.
const poolUnique = new pg.Pool({ connectionString: inject('pgApp'), max: 1 });

const T: Record<string, string> = {};
// L'identifiant d'une personne, d'une entreprise ou d'un mandat créé plus haut.
const id = (cle: string): string => { const v = T[cle]; if (!v) throw new Error(`inconnu : ${cle}`); return v; };
const un = async (sql: string, args: unknown[] = []) => (await admin.query(sql, args)).rows[0];

// Les tables qui portent les DONNÉES d'une entreprise, et la colonne qui dit laquelle. Le mandat n'y
// est pas : un cabinet voit le mandat qu'il a proposé, sans voir pour autant les données du client
// (un test plus bas le vérifie à part).
const TABLES_ENTREPRISE: [string, string][] = [
  ['socle.entreprise', 'id'], ['socle.etablissement', 'entreprise'], ['socle.membre', 'entreprise'],
];

async function personne(cle: string) {
  T[cle] = (await un(`insert into socle.utilisateur (email, nom) values ($1, $2) returning id`, [`${cle}@exemple.tn`, cle])).id;
}
async function entreprise(cle: string, organisation: string) {
  T[cle] = (await un(`insert into socle.entreprise (organisation, raison_sociale) values ($1, $2) returning id`, [organisation, `Société ${cle}`])).id;
  await admin.query(`insert into socle.etablissement (entreprise, code, nom) values ($1, '000', 'Siège')`, [T[cle]]);
}
async function organisation(cle: string, type: string) {
  T[cle] = (await un(`insert into socle.organisation (type, nom) values ($1, $2) returning id`, [type, `Organisation ${cle}`])).id;
}
async function membre(cle: string, qui: string, ou: { entreprise?: string; organisation?: string }, roles: string[]) {
  T[cle] = (await un(`insert into socle.membre (utilisateur, entreprise, organisation, roles) values ($1, $2, $3, $4) returning id`,
    [T[qui], ou.entreprise ?? null, ou.organisation ?? null, roles])).id;
}

beforeAll(async () => {
  await admin.connect();
  for (const p of ['alice', 'bob', 'carla', 'dora', 'eric', 'fares', 'gerant', 'inconnu']) await personne(p);
  await organisation('orgA', 'independant'); await entreprise('A', id('orgA'));
  await organisation('orgB', 'independant'); await entreprise('B', id('orgB'));
  await organisation('groupe', 'groupe'); await entreprise('G1', id('groupe')); await entreprise('G2', id('groupe'));
  await organisation('cabinet', 'cabinet');
  await membre('mAlice', 'alice', { entreprise: id('A') }, ['proprietaire']);
  await membre('mCarla', 'carla', { entreprise: id('A') }, ['commercial']);
  await membre('mBob', 'bob', { entreprise: id('B') }, ['proprietaire']);
  await membre('mGerant', 'gerant', { organisation: id('groupe') }, ['administrateur']);
  await membre('mDora', 'dora', { organisation: id('cabinet') }, ['supervision']);
  await membre('mEric', 'eric', { organisation: id('cabinet') }, ['revision']);
  await membre('mFares', 'fares', { organisation: id('cabinet') }, ['revision']);
  // Le cabinet a un mandat ACTIF sur A (confié à Eric), et seulement PROPOSÉ sur B.
  T.mandatA = (await un(`insert into socle.mandat (cabinet, entreprise, debut, statut) values ($1, $2, current_date - 30, 'actif') returning id`, [id('cabinet'), id('A')])).id;
  T.mandatB = (await un(`insert into socle.mandat (cabinet, entreprise, debut, statut) values ($1, $2, current_date - 30, 'propose') returning id`, [id('cabinet'), id('B')])).id;
  await admin.query(`insert into socle.mandat_affectation (mandat, membre, role) values ($1, $2, 'revision')`, [id('mandatA'), id('mEric')]);
  // Un dossier tenu (03 § 3.5) : l'entreprise d'un client pas encore sur SkanFact, rangée dans
  // l'organisation du cabinet, confiée à Eric par un mandat.
  await entreprise('tenu', id('cabinet'));
  T.mandatTenu = (await un(`insert into socle.mandat (cabinet, entreprise, debut, statut) values ($1, $2, current_date - 30, 'actif') returning id`, [id('cabinet'), id('tenu')])).id;
  await admin.query(`insert into socle.mandat_affectation (mandat, membre, role) values ($1, $2, 'revision')`, [id('mandatTenu'), id('mEric')]);
  await admin.query(`insert into socle.appareil (utilisateur, nom, type) values ($1, 'Portable d''Alice', 'bureau'), ($2, 'Téléphone de Bob', 'telephone')`, [id('alice'), id('bob')]);
});

afterAll(async () => { await admin.end(); await pool.end(); await poolUnique.end(); });

// Les entreprises qu'une personne voit, par la table des entreprises.
const voit = (qui: string | null) => enTantQue(pool, qui, async (tx) =>
  (await tx.query('select id from socle.entreprise order by raison_sociale')).rows.map((r) => r.id as string));

// Toutes les lignes, dans toutes les tables du socle, qui appartiennent à une entreprise donnée.
const lignesDe = (qui: string | null, ent: string) => enTantQue(pool, qui, async (tx) => {
  let n = 0;
  for (const [table, col] of TABLES_ENTREPRISE) n += Number((await tx.query(`select count(*) n from ${table} where ${col} = $1`, [ent])).rows[0].n);
  return n;
});

describe('sans nom, rien', () => {
  it('une transaction qui ne dit pas qui agit ne voit aucune ligne, dans aucune table', async () => {
    await enTantQue(pool, null, async (tx) => {
      for (const t of ['organisation', 'entreprise', 'etablissement', 'utilisateur', 'membre', 'mandat', 'mandat_affectation', 'appareil']) {
        expect((await tx.query(`select count(*) n from socle.${t}`)).rows[0].n, t).toBe(0n);
      }
    });
  });

  it('une connexion rendue au pool ne garde jamais le nom de la personne précédente', async () => {
    const avant = await enTantQue(poolUnique, id('alice'), async (tx) => (await tx.query('select count(*) n from socle.entreprise')).rows[0].n);
    expect(avant).toBe(1n);
    const apres = await poolUnique.query('select count(*) n from socle.entreprise');
    expect(apres.rows[0].n).toBe(0n);
  });
});

describe('une entreprise ne voit jamais sa voisine', () => {
  it('la propriétaire de A voit A, et rien de B', async () => {
    expect(await voit(id('alice'))).toEqual([id('A')]);
    expect(await lignesDe(id('alice'), id('B'))).toBe(0);
    expect(await lignesDe(id('alice'), id('A'))).toBeGreaterThan(0);
  });

  it('le propriétaire de B ne voit rien de A, par aucune table du socle', async () => {
    expect(await voit(id('bob'))).toEqual([id('B')]);
    expect(await lignesDe(id('bob'), id('A'))).toBe(0);
    const mandatsEtAffectations = await enTantQue(pool, id('bob'), async (tx) => [
      (await tx.query('select count(*) n from socle.mandat where entreprise = $1', [id('A')])).rows[0].n,
      (await tx.query('select count(*) n from socle.mandat_affectation')).rows[0].n,
    ]);
    expect(mandatsEtAffectations).toEqual([0n, 0n]);
  });

  it('il ne peut pas écrire chez sa voisine : ni ajouter, ni modifier', async () => {
    await expect(enTantQue(pool, id('bob'), (tx) => tx.query(`insert into socle.etablissement (entreprise, code, nom) values ($1, '001', 'Intrus')`, [id('A')])))
      .rejects.toThrow(/row-level security/);
    const modifiees = await enTantQue(pool, id('bob'), async (tx) => (await tx.query(`update socle.entreprise set raison_sociale = 'Volée' where id = $1`, [id('A')])).rowCount);
    expect(modifiees).toBe(0);
    expect((await un('select raison_sociale from socle.entreprise where id = $1', [id('A')])).raison_sociale).toBe('Société A');
  });

  it('il ne peut pas déplacer sa propre ligne chez la voisine', async () => {
    await expect(enTantQue(pool, id('bob'), (tx) => tx.query(`update socle.etablissement set entreprise = $1 where entreprise = $2`, [id('A'), id('B')])))
      .rejects.toThrow(/row-level security/);
  });

  it('une personne qui n\'est membre de rien ne voit rien', async () => {
    expect(await voit(id('inconnu'))).toEqual([]);
  });
});

describe('les personnes et les appareils', () => {
  it('on voit son équipe, pas l\'annuaire', async () => {
    const vus = await enTantQue(pool, id('alice'), async (tx) => (await tx.query('select id from socle.utilisateur')).rows.map((r) => r.id));
    expect(vus.sort()).toEqual([id('alice'), id('carla')].sort());
    const deBob = await enTantQue(pool, id('bob'), async (tx) => (await tx.query('select id from socle.utilisateur')).rows.map((r) => r.id));
    expect(deBob).toEqual([id('bob')]);
  });

  it('on ne voit que ses propres appareils, même ceux d\'un collègue restent cachés', async () => {
    const noms = await enTantQue(pool, id('carla'), async (tx) => (await tx.query('select nom from socle.appareil')).rows);
    expect(noms).toEqual([]);
    const aAlice = await enTantQue(pool, id('alice'), async (tx) => (await tx.query('select nom from socle.appareil')).rows.map((r) => r.nom));
    expect(aAlice).toEqual(['Portable d\'Alice']);
  });
});

describe('le cabinet ne voit que par un mandat actif (03 § 3)', () => {
  it('l\'associé voit le client dont le mandat est actif, pas celui dont le mandat est seulement proposé', async () => {
    expect((await voit(id('dora'))).sort()).toEqual([id('A'), id('tenu')].sort());
    expect(await lignesDe(id('dora'), id('B'))).toBe(0);
  });

  it('le collaborateur voit le dossier qui lui est confié ; un autre collaborateur ne le voit pas', async () => {
    expect((await voit(id('eric'))).sort()).toEqual([id('A'), id('tenu')].sort());
    expect(await voit(id('fares'))).toEqual([]);
  });

  it('un dossier tenu, rangé dans le cabinet, ne se voit que par son mandat : pas par tout le cabinet', async () => {
    expect(await lignesDe(id('fares'), id('tenu'))).toBe(0);
    expect(await lignesDe(id('eric'), id('tenu'))).toBeGreaterThan(0);
  });

  it('un mandat terminé coupe l\'accès aussitôt, sans rien effacer', async () => {
    await admin.query(`update socle.mandat set fin = current_date - 1, statut = 'termine' where id = $1`, [id('mandatA')]);
    try {
      expect(await voit(id('dora'))).toEqual([id('tenu')]);
      expect(await voit(id('eric'))).toEqual([id('tenu')]);
      expect(Number((await un('select count(*) n from socle.mandat_affectation where mandat = $1', [id('mandatA')])).n)).toBe(1);
    } finally {
      await admin.query(`update socle.mandat set fin = null, statut = 'actif' where id = $1`, [id('mandatA')]);
    }
  });

  it('un mandat dont la date de fin est passée ne donne plus rien, même marqué actif', async () => {
    await admin.query(`update socle.mandat set fin = current_date - 1 where id = $1`, [id('mandatA')]);
    try {
      expect(await voit(id('dora'))).toEqual([id('tenu')]);
    } finally {
      await admin.query(`update socle.mandat set fin = null where id = $1`, [id('mandatA')]);
    }
  });

  it('le client voit le mandat qu\'il a donné, et le cabinet voit ses mandats', async () => {
    const duClient = await enTantQue(pool, id('alice'), async (tx) => (await tx.query('select id from socle.mandat')).rows.map((r) => r.id));
    expect(duClient).toEqual([id('mandatA')]);
    const duCabinet = await enTantQue(pool, id('fares'), async (tx) => (await tx.query('select id from socle.mandat')).rows.map((r) => r.id));
    expect(duCabinet.sort()).toEqual([id('mandatA'), id('mandatB'), id('mandatTenu')].sort());
  });
});

describe('le groupe', () => {
  it('le membre d\'un groupe voit les sociétés du groupe, et seulement elles', async () => {
    expect((await voit(id('gerant'))).sort()).toEqual([id('G1'), id('G2')].sort());
    expect(await lignesDe(id('gerant'), id('A'))).toBe(0);
  });
});

describe('créer son compte et son entreprise', () => {
  it('le créateur devient propriétaire, avec le siège, et ne voit que la sienne', async () => {
    const hela = await enTantQue(pool, null, async (tx) => (await tx.query(`select socle.creer_utilisateur('Hela@Exemple.tn', 'Hela') id`)).rows[0].id as string);
    const ent = await enTantQue(pool, hela, async (tx) => (await tx.query(`select socle.creer_entreprise('Menuiserie Hela') id`)).rows[0].id as string);
    expect(await voit(hela)).toEqual([ent]);
    const detail = await enTantQue(pool, hela, async (tx) => ({
      roles: (await tx.query('select roles from socle.membre where entreprise = $1', [ent])).rows.map((r) => r.roles),
      sieges: (await tx.query(`select nom from socle.etablissement where entreprise = $1 and type = 'siege'`, [ent])).rows.length,
      email: (await tx.query('select email from socle.utilisateur where id = $1', [hela])).rows[0].email,
    }));
    expect(detail).toEqual({ roles: [['proprietaire']], sieges: 1, email: 'hela@exemple.tn' });
    expect(await lignesDe(id('alice'), ent)).toBe(0);
  });

  it('personne ne crée d\'entreprise sans dire qui il est', async () => {
    await expect(enTantQue(pool, null, (tx) => tx.query(`select socle.creer_entreprise('Fantôme')`))).rejects.toThrow(/personne n'est connecté/);
  });

  it('une entreprise n\'a qu\'un seul propriétaire', async () => {
    await expect(admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [id('carla'), id('B')]))
      .rejects.toThrow(/membre_un_proprietaire/);
  });
});

describe('les garde-fous de la base elle-même', () => {
  it('chaque table de chaque schéma a sa sécurité par ligne, forcée (sauf la trace des migrations)', async () => {
    const r = await admin.query(`select n.nspname || '.' || c.relname as relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
        and c.relkind in ('r', 'p') and not c.relispartition and (n.nspname, c.relname) <> ('socle', 'migration')`);
    // Le socle ET les modules (ventes…) : une table de module qui oublierait sa sécurité ferait tomber ce test.
    expect(r.rows.map((t) => t.relname)).toEqual(expect.arrayContaining(['socle.entreprise', 'ventes.piece', 'ventes.reglement']));
    for (const t of r.rows) expect([t.relname, t.relrowsecurity, t.relforcerowsecurity]).toEqual([t.relname, true, true]);
  });

  it('le compte du serveur ne passe jamais au-dessus de la sécurité par ligne, et n\'est pas administrateur', async () => {
    const r = await pool.query(`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`);
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    const app = await admin.query(`select rolbypassrls from pg_roles where rolname = 'skanfact_app'`);
    expect(app.rows[0].rolbypassrls).toBe(false);
  });

  it('le serveur ne lit pas la trace des migrations', async () => {
    await expect(pool.query('select * from socle.migration')).rejects.toThrow(/permission denied/);
  });

  it('les identifiants créés par le serveur sont des UUID version 7, dans l\'ordre du temps', async () => {
    const ids = (await admin.query('select socle.uuidv7() id from generate_series(1, 50)')).rows.map((r) => r.id as string);
    for (const u of ids) expect(u[14]).toBe('7');
    const temps = ids.map((u) => parseInt(u.replace(/-/g, '').slice(0, 12), 16));
    expect(temps).toEqual([...temps].sort((a, b) => a - b));
  });
});
