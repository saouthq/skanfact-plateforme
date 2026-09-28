// Les règles fiscales datées, la numérotation et le journal inaltérable (01 R9, R11, R12, § 3, § 6),
// joués contre la vraie base. Les règles ci-dessous sont des règles D'ESSAI (codes « essai.* ») :
// aucun taux réel n'est écrit dans les tests non plus.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { canonique, controler, DEPART, empreinteContenu, empreinteMaillon, sceller } from '../../serveur/journal.ts';
import { prendreNumero, prochainNumero } from '../../serveur/numeros.ts';
import { regle } from '../../serveur/regles.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const P: Record<string, string> = {};
let A = '';
let B = '';
const qui = (cle: string) => P[cle] ?? '';

beforeAll(async () => {
  await admin.connect();
  for (const cle of ['alice', 'bob', 'carla']) {
    P[cle] = (await admin.query(`insert into socle.utilisateur (email, nom) values ($1, $2) returning id`, [`rnc-${cle}@exemple.tn`, cle])).rows[0].id;
  }
  const entreprise = async (nom: string) => {
    const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', $1) returning id`, [nom])).rows[0].id;
    return (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, $2) returning id`, [org, nom])).rows[0].id as string;
  };
  A = await entreprise('Atelier A');
  B = await entreprise('Boutique B');
  await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}'), ($3, $2, '{caissier}'), ($4, $5, '{proprietaire}')`,
    [qui('alice'), A, qui('carla'), qui('bob'), B]);
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, fin, source) values
    ('essai.taux', '190000', '2026-01-01', '2026-12-31', 'Règle d''essai 2026'),
    ('essai.taux', '180000', '2027-01-01', null, 'Règle d''essai 2027')`);
});
afterAll(async () => { await admin.end(); await pool.end(); });

describe('les règles fiscales datées (R11, R12)', () => {
  it('une règle se lit à la date de la pièce : l\'ancienne avant la loi, la nouvelle après', async () => {
    const [avant, apres] = await enTantQue(pool, qui('alice'), async (tx) => [await regle(tx, A, 'essai.taux', '2026-12-31'), await regle(tx, A, 'essai.taux', '2027-01-01')]);
    expect(avant).toMatchObject({ valeur: 190000, origine: 'commune', source: 'Règle d\'essai 2026' });
    expect(apres).toMatchObject({ valeur: 180000, origine: 'commune' });
  });

  it('une règle inconnue vaut « non renseigné », jamais zéro', async () => {
    expect(await enTantQue(pool, qui('alice'), (tx) => regle(tx, A, 'essai.inconnue', '2026-06-01'))).toBeNull();
    // Avant la première règle aussi.
    expect(await enTantQue(pool, qui('alice'), (tx) => regle(tx, A, 'essai.taux', '2025-12-31'))).toBeNull();
  });

  it('une règle se lit à un jour du calendrier, jamais à un instant', async () => {
    await expect(enTantQue(pool, qui('alice'), (tx) => regle(tx, A, 'essai.taux', '2026-06-01T23:30:00Z'))).rejects.toThrow(/jour du calendrier/);
  });

  it('la règle de l\'entreprise passe avant la commune, et seulement chez elle', async () => {
    await enTantQue(pool, qui('alice'), (tx) => tx.query(`select socle.poser_regle_entreprise($1, 'essai.taux', '70000', '2026-07-01', null, 'Attestation d''essai')`, [A]));
    const [chezA, avantChezA, chezB] = await Promise.all([
      enTantQue(pool, qui('alice'), (tx) => regle(tx, A, 'essai.taux', '2026-08-01')),
      enTantQue(pool, qui('alice'), (tx) => regle(tx, A, 'essai.taux', '2026-06-30')),
      enTantQue(pool, qui('bob'), (tx) => regle(tx, B, 'essai.taux', '2026-08-01')),
    ]);
    expect(chezA).toMatchObject({ valeur: 70000, origine: 'entreprise', source: 'Attestation d\'essai' });
    expect(avantChezA).toMatchObject({ valeur: 190000, origine: 'commune' });
    expect(chezB).toMatchObject({ valeur: 190000, origine: 'commune' });
    // Bob ne voit pas la règle d'Alice, même en la demandant pour A.
    expect(await enTantQue(pool, qui('bob'), (tx) => regle(tx, A, 'essai.taux', '2026-08-01'))).toMatchObject({ origine: 'commune' });
  });

  it('une nouvelle règle de l\'entreprise ferme la précédente la veille, et ne réécrit pas le passé', async () => {
    await enTantQue(pool, qui('alice'), (tx) => tx.query(`select socle.poser_regle_entreprise($1, 'essai.seuil', '1000000', '2026-01-01', null, 'Choix d''essai')`, [A]));
    await enTantQue(pool, qui('alice'), (tx) => tx.query(`select socle.poser_regle_entreprise($1, 'essai.seuil', '2000000', '2026-09-01', null, 'Choix d''essai 2')`, [A]));
    const lignes = (await admin.query(`select valeur, debut::text, fin::text from socle.regle_entreprise where entreprise = $1 and code = 'essai.seuil' order by debut`, [A])).rows;
    expect(lignes).toEqual([
      { valeur: 1000000, debut: '2026-01-01', fin: '2026-08-31' },
      { valeur: 2000000, debut: '2026-09-01', fin: null },
    ]);
    await expect(enTantQue(pool, qui('alice'), (tx) => tx.query(`select socle.poser_regle_entreprise($1, 'essai.seuil', '3000000', '2026-09-01', null, 'Réécrire')`, [A])))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('seuls le propriétaire et l\'administrateur posent une règle de l\'entreprise', async () => {
    await expect(enTantQue(pool, qui('carla'), (tx) => tx.query(`select socle.poser_regle_entreprise($1, 'essai.autre', '1', '2026-01-01', null, 'Caissière')`, [A])))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('deux règles d\'un même code ne se chevauchent jamais', async () => {
    await expect(admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source) values ('essai.taux', '1', '2026-06-01', 'Chevauche')`))
      .rejects.toMatchObject({ code: '23P01' });
  });

  it('une règle ne se réécrit pas : on ferme sa date de fin, une seule fois', async () => {
    const id = (await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source) values ('essai.ferme', '5', '2026-01-01', 'Essai') returning id`)).rows[0].id;
    await expect(admin.query(`update socle.regle_fiscale set valeur = '6' where id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    await admin.query(`update socle.regle_fiscale set fin = '2026-12-31' where id = $1`, [id]);
    await expect(admin.query(`update socle.regle_fiscale set fin = '2027-12-31' where id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query(`delete from socle.regle_fiscale where id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
  });

  it('un nombre à virgule n\'entre pas dans une règle (les taux s\'écrivent en entiers)', async () => {
    await expect(admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source) values ('essai.virgule', '19.5', '2026-01-01', 'Essai')`))
      .rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source) values ('essai.virgule', '{"tranches": [{"taux": 0.26}]}', '2026-01-01', 'Essai')`))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('le serveur n\'écrit pas les règles communes', async () => {
    await expect(enTantQue(pool, qui('alice'), (tx) => tx.query(`insert into socle.regle_fiscale (code, valeur, debut, source) values ('essai.pirate', '1', '2026-01-01', 'x')`)))
      .rejects.toMatchObject({ code: '42501' });
  });
});

describe('la numérotation (01 § 6)', () => {
  const serie = async (prefixe: string) =>
    (await enTantQue(pool, qui('alice'), (tx) => tx.query(`select socle.creer_serie($1, 'facture', $2, true, null, null) id`, [A, prefixe]))).rows[0].id as string;
  const prendre = (s: string, date: string) => enTantQue(pool, qui('alice'), (tx) => prendreNumero(tx, s, date));

  it('les numéros se suivent sans trou, et repartent à 1 chaque année', async () => {
    const s = await serie('FAC');
    const pris = [await prendre(s, '2026-03-01'), await prendre(s, '2026-03-02'), await prendre(s, '2026-12-31'), await prendre(s, '2027-01-02')];
    expect(pris.map((n) => n.texte)).toEqual(['FAC-2026-001', 'FAC-2026-002', 'FAC-2026-003', 'FAC-2027-001']);
  });

  it('une émission qui échoue rend son numéro', async () => {
    const s = await serie('ECH');
    await prendre(s, '2026-05-01');
    await expect(enTantQue(pool, qui('alice'), async (tx) => { await prendreNumero(tx, s, '2026-05-01'); throw new Error('contrôle refusé après coup'); })).rejects.toThrow();
    expect((await prendre(s, '2026-05-01')).numero).toBe(2);
  });

  it('vingt émissions simultanées prennent vingt numéros différents, sans trou', async () => {
    const s = await serie('SIM');
    const pris = await Promise.all(Array.from({ length: 20 }, () => prendre(s, '2026-06-15')));
    expect(pris.map((n) => n.numero).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('le millième numéro garde tous ses chiffres', async () => {
    const s = await serie('MIL');
    await enTantQue(pool, qui('alice'), (tx) => tx.query('select socle.reprendre_serie($1, 2026, 999)', [s]));
    expect((await prendre(s, '2026-07-01')).texte).toBe('MIL-2026-1000');
  });

  it('une série commencée ailleurs continue ; le prochain numéro se lit sans se réserver', async () => {
    const s = await serie('REP');
    await enTantQue(pool, qui('alice'), (tx) => tx.query('select socle.reprendre_serie($1, 2026, 147)', [s]));
    // On peut encore corriger l'annonce tant que rien n'a été pris ici.
    await enTantQue(pool, qui('alice'), (tx) => tx.query('select socle.reprendre_serie($1, 2026, 146)', [s]));
    const lire = () => enTantQue(pool, qui('alice'), (tx) => prochainNumero(tx, s, '2026-10-01'));
    expect((await lire()).texte).toBe('REP-2026-147');
    expect((await lire()).texte).toBe('REP-2026-147');
    expect((await prendre(s, '2026-10-01')).texte).toBe('REP-2026-147');
    await expect(enTantQue(pool, qui('alice'), (tx) => tx.query('select socle.reprendre_serie($1, 2026, 500)', [s]))).rejects.toMatchObject({ code: '42501' });
  });

  it('la série d\'une autre entreprise est introuvable', async () => {
    const s = await serie('AUT');
    await expect(enTantQue(pool, qui('bob'), (tx) => prendreNumero(tx, s, '2026-01-01'))).rejects.toMatchObject({ code: '42501' });
    await expect(enTantQue(pool, qui('bob'), (tx) => prochainNumero(tx, s, '2026-01-01'))).rejects.toThrow(/série introuvable/);
  });

  it('seuls le propriétaire et l\'administrateur créent une série ; le serveur ne touche pas le compteur en direct', async () => {
    await expect(enTantQue(pool, qui('carla'), (tx) => tx.query(`select socle.creer_serie($1, 'facture', 'CAR', true, null, null)`, [A]))).rejects.toMatchObject({ code: '42501' });
    await expect(enTantQue(pool, qui('alice'), (tx) => tx.query(`update socle.compteur set dernier = 0`))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('le journal inaltérable (R9)', () => {
  const chaine = () => `serie:${randomUUID()}`;
  const pieces = [
    { numero: 'FAC-2026-001', client: 'Menuiserie du Cap', totalTtc: 1190000, lignes: [{ designation: 'Porte', montant: 1000000 }] },
    { numero: 'FAC-2026-002', client: 'Garage Nord', totalTtc: 238001, lignes: [] },
    { numero: 'FAC-2026-003', client: 'Café du Port', totalTtc: 17850, lignes: [{ designation: 'Réparation', montant: 15000 }] },
  ];
  async function sceller3(cle: string) {
    const ids: string[] = pieces.map(() => randomUUID());
    const maillons = [];
    for (const [i, p] of pieces.entries()) {
      maillons.push(await enTantQue(pool, qui('alice'), (tx) => sceller(tx, A, cle, { type: 'essai', id: ids[i] ?? '' }, p)));
    }
    const parId = new Map(ids.map((id, i) => [id, pieces[i]]));
    return { ids, maillons, relire: async (o: { id: string }) => parId.get(o.id) ?? null };
  }
  const controlerEnBase = async (cle: string) => (await enTantQue(pool, qui('alice'), (tx) => tx.query('select * from socle.controler_chaine($1, $2)', [A, cle]))).rows[0];
  async function sansGardien<T>(travail: () => Promise<T>) {
    await admin.query('alter table socle.maillon disable trigger maillon_intouchable');
    try { return await travail(); } finally { await admin.query('alter table socle.maillon enable trigger maillon_intouchable'); }
  }

  it('la forme canonique : clés triées, sans espace, et jamais un nombre à virgule', () => {
    expect(canonique({ b: 1, a: [true, null, 'é'], c: { z: 2n, y: 'x' } })).toBe('{"a":[true,null,"é"],"b":1,"c":{"y":"x","z":2}}');
    expect(() => canonique({ montant: 1.5 })).toThrow(/entier/);
    expect(() => canonique({ montant: undefined })).toThrow(/indéfini/);
    expect(empreinteContenu({ a: 1, b: 2 })).toBe(empreinteContenu({ b: 2, a: 1 }));
  });

  it('la base et le serveur calculent la même chaîne (deux chemins, un chiffre)', async () => {
    const { maillons } = await sceller3(chaine());
    let precedente = DEPART;
    for (const [i, m] of maillons.entries()) {
      expect(m.rang).toBe(i + 1);
      expect(m.precedente).toBe(precedente);
      expect(m.empreinte).toBe(empreinteMaillon(precedente, empreinteContenu(pieces[i])));
      precedente = m.empreinte;
    }
  });

  it('une chaîne intacte passe le contrôle, et le contrôle se note', async () => {
    const cle = chaine();
    const { relire } = await sceller3(cle);
    expect(await enTantQue(pool, qui('alice'), (tx) => controler(tx, A, cle, relire))).toEqual({ ok: true });
    expect((await admin.query('select controle_ok from socle.chaine where entreprise = $1 and cle = $2', [A, cle])).rows[0].controle_ok).toBe(true);
  });

  it('une pièce modifiée après son scellé se voit', async () => {
    const cle = chaine();
    const { ids } = await sceller3(cle);
    const truquee = async (o: { id: string }) => {
      const i = ids.indexOf(o.id);
      return i === 1 ? { ...pieces[1], totalTtc: 138001 } : pieces[i] ?? null;
    };
    expect(await enTantQue(pool, qui('alice'), (tx) => controler(tx, A, cle, truquee))).toEqual({ ok: false, rang: 2, motif: 'pièce modifiée après son scellé' });
  });

  it('un maillon réécrit en base se voit', async () => {
    const cle = chaine();
    await sceller3(cle);
    await sansGardien(() => admin.query(`update socle.maillon set contenu = $3 where entreprise = $1 and cle = $2 and rang = 2`, [A, cle, empreinteContenu({ faux: 1 })]));
    expect(await controlerEnBase(cle)).toEqual({ ok: false, rang: '2', motif: 'empreinte fausse' });
  });

  it('un maillon retiré au milieu, ou à la fin, se voit', async () => {
    const milieu = chaine();
    await sceller3(milieu);
    await sansGardien(() => admin.query(`delete from socle.maillon where entreprise = $1 and cle = $2 and rang = 2`, [A, milieu]));
    expect(await controlerEnBase(milieu)).toEqual({ ok: false, rang: '2', motif: 'maillon manquant' });

    const fin = chaine();
    await sceller3(fin);
    await sansGardien(() => admin.query(`delete from socle.maillon where entreprise = $1 and cle = $2 and rang = 3`, [A, fin]));
    expect(await controlerEnBase(fin)).toEqual({ ok: false, rang: '3', motif: 'la fin de la chaîne manque' });
    expect((await admin.query('select controle_ok from socle.chaine where entreprise = $1 and cle = $2', [A, fin])).rows[0].controle_ok).toBe(false);
  });

  it('le journal ne se modifie pas et ne s\'efface pas, même par le propriétaire des tables', async () => {
    const cle = chaine();
    await sceller3(cle);
    await expect(admin.query(`update socle.maillon set contenu = contenu where cle = $1`, [cle])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query(`delete from socle.maillon where cle = $1`, [cle])).rejects.toMatchObject({ code: '42501' });
  });

  it('une pièce ne se scelle qu\'une fois, et jamais chez une autre entreprise', async () => {
    const id = randomUUID();
    await enTantQue(pool, qui('alice'), (tx) => sceller(tx, A, chaine(), { type: 'essai', id }, pieces[0]));
    await expect(enTantQue(pool, qui('alice'), (tx) => sceller(tx, A, chaine(), { type: 'essai', id }, pieces[0]))).rejects.toMatchObject({ code: '23505' });
    await expect(enTantQue(pool, qui('bob'), (tx) => sceller(tx, A, chaine(), { type: 'essai', id: randomUUID() }, pieces[0]))).rejects.toMatchObject({ code: '42501' });
  });

  it('une émission qui échoue ne laisse ni numéro pris ni maillon', async () => {
    const s = (await enTantQue(pool, qui('alice'), (tx) => tx.query(`select socle.creer_serie($1, 'facture', 'EMI', true, null, null) id`, [A]))).rows[0].id as string;
    const cle = `serie:${s}`;
    const emettre = (echoue: boolean) => enTantQue(pool, qui('alice'), async (tx) => {
      const n = await prendreNumero(tx, s, '2026-11-02');
      const m = await sceller(tx, A, cle, { type: 'essai', id: randomUUID() }, { numero: n.texte });
      if (echoue) throw new Error('l\'envoi a échoué');
      return { n, m };
    });
    await expect(emettre(true)).rejects.toThrow();
    const { n, m } = await emettre(false);
    expect([n.texte, m.rang]).toEqual(['EMI-2026-001', 1]);
  });
});

describe('les garde-fous des fonctions de la base', () => {
  it('chaque porte dérobée (security definer) fixe son chemin, et le public ne l\'exécute pas', async () => {
    const r = await admin.query(`select p.proname, p.proconfig, p.proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'socle' and p.prosecdef`);
    expect(r.rows.length).toBeGreaterThanOrEqual(30);
    const fautes = r.rows.filter((f) => !(f.proconfig ?? []).some((c: string) => c.startsWith('search_path=')) || f.acl === null || /(^|[{,])=X/.test(f.acl))
      .map((f) => f.proname);
    expect(fautes).toEqual([]);
  });

  it('elles appartiennent à un rôle qui passe au-dessus de la sécurité par ligne (sinon elles ne voient rien)', async () => {
    const r = await admin.query(`select distinct o.rolname, o.rolsuper or o.rolbypassrls passe from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace join pg_roles o on o.oid = p.proowner where n.nspname = 'socle' and p.prosecdef`);
    expect(r.rows.every((x) => x.passe)).toBe(true);
  });
});
