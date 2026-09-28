// La porte des droits (03 D1 à D7, § 2.1 et § 9).
//
// La matrice attendue ci-dessous est RECOPIÉE À LA MAIN depuis le tableau du document 03 (§ 2.1,
// « Le socle »), sans lire le code : c'est l'autre chemin. Si la déclaration des gestes
// (serveur/porte/gestes.ts) s'en écarte, ce test tombe.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { GESTES, GESTES_SOCLE, ROLES_ENTREPRISE } from '../../serveur/porte/gestes.ts';
import { peut } from '../../serveur/porte/porte.ts';
import { motif } from '../../textes/index.ts';

//                                   P    A    C    K    S    M    I    Pa   L
const MATRICE: Record<string, string[]> = {
  'socle.accueil.voir':           ['✓', '✓', '✓', '✓', '✓', '✓', '✓', '✓', '✓'],
  'socle.fiche_societe.modifier': ['✓', '✓', '—', '—', '—', '—', 'v', '—', 'v'],
  'socle.rib_societe.modifier':   ['✓', '✓', '—', '—', '—', '—', '—', '—', '—'],
  'socle.reglages_fiscaux.modifier': ['✓', '✓', '—', '—', '—', '—', 'v', '—', 'v'],
  'socle.equipe.gerer':           ['✓', '✓', '—', '—', '—', '—', '—', '—', '—'],
  'socle.propriete.transferer':   ['✓', '—', '—', '—', '—', '—', '—', '—', '—'],
  'socle.offre.changer':          ['✓', 'v', '—', '—', '—', '—', '—', '—', '—'],
  'socle.abonnement.payer':       ['✓', '✓', '—', '—', '—', '—', '—', '—', '—'],
  'socle.cabinet.choisir':        ['✓', '—', '—', '—', '—', '—', '—', '—', '—'],
  'socle.support.autoriser':      ['✓', '✓', '—', '—', '—', '—', '—', '—', '—'],
  'socle.export_complet':         ['✓', '✓', '—', '—', '—', '—', '—', '—', '—'],
  'socle.audit.lire':             ['✓', '✓', '—', '—', '—', '—', '—', '—', '—'],
  'socle.abonnement.resilier':    ['✓', '—', '—', '—', '—', '—', '—', '—', '—'],
  'socle.cles_api.gerer':         ['✓', '✓', '—', '—', '—', '—', '—', '—', '—'],
  'socle.avis.gerer':             ['✓', '✓', '—', '—', '—', '—', '—', '—', '—'],
};
const ORDRE = ['proprietaire', 'administrateur', 'commercial', 'caissier', 'serveur', 'magasinier', 'comptabilite_interne', 'paie', 'lecture'];

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const P: Record<string, string> = {};
let ent = '';
let autre = '';

beforeAll(async () => {
  await admin.connect();
  const u = async (cle: string) => (P[cle] = (await admin.query(`insert into socle.utilisateur (email, nom) values ($1, $2) returning id`, [`porte-${cle}@exemple.tn`, `Porte ${cle}`])).rows[0].id);
  for (const r of ORDRE) await u(r);
  await u('etranger');
  await u('multi');
  const org = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Porte') returning id`)).rows[0].id;
  ent = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Société de la porte') returning id`, [org])).rows[0].id;
  const org2 = (await admin.query(`insert into socle.organisation (type, nom) values ('independant', 'Autre') returning id`)).rows[0].id;
  autre = (await admin.query(`insert into socle.entreprise (organisation, raison_sociale) values ($1, 'Autre société') returning id`, [org2])).rows[0].id;
  for (const r of ORDRE) await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, $3)`, [P[r], ent, [r]]);
  await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{commercial,caissier}')`, [P.multi, ent]);
  await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{proprietaire}')`, [P.etranger, autre]);
});
afterAll(async () => { await admin.end(); await pool.end(); });

describe('la matrice des gestes du socle', () => {
  it('chaque geste du socle est dans le tableau du document 03, et inversement', () => {
    expect(GESTES_SOCLE.map((g) => g.code).sort()).toEqual(Object.keys(MATRICE).sort());
    expect([...ROLES_ENTREPRISE]).toEqual(ORDRE);
  });

  it('chaque rôle contre chaque geste : la porte répond comme le tableau', async () => {
    const ecarts: string[] = [];
    for (const [code, attendus] of Object.entries(MATRICE)) {
      for (const [i, role] of ORDRE.entries()) {
        const attendu = attendus[i];
        const [ecrire, lire] = await enTantQue(pool, P[role] ?? '', async (tx) => [await peut(tx, { utilisateur: P[role] ?? '' }, ent, code, true), await peut(tx, { utilisateur: P[role] ?? '' }, ent, code, false)]);
        const obtenu = ecrire?.ok ? '✓' : lire?.ok ? 'v' : '—';
        // Un geste de lecture (« voir l'accueil », « lire la trace ») est « ✓ » dès qu'on peut le lire.
        const geste = GESTES.get(code);
        const obtenuFinal = !geste?.ecrit && lire?.ok ? '✓' : obtenu;
        if (obtenuFinal !== attendu) ecarts.push(`${code} / ${role} : attendu ${attendu}, obtenu ${obtenuFinal}`);
      }
    }
    expect(ecarts).toEqual([]);
  });
});

describe('les réponses de la porte', () => {
  it('D7 : plusieurs rôles, c\'est l\'union de leurs droits', async () => {
    const d = await enTantQue(pool, P.multi ?? '', (tx) => peut(tx, { utilisateur: P.multi ?? '' }, ent, 'socle.accueil.voir'));
    expect(d.ok).toBe(true);
  });

  it('un refus de rôle dit ce qui est refusé, pourquoi, et qui peut (des membres présents)', async () => {
    const d = await enTantQue(pool, P.commercial ?? '', (tx) => peut(tx, { utilisateur: P.commercial ?? '' }, ent, 'socle.equipe.gerer'));
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.raison).toBe('role');
    expect(String(d.motif)).toMatch(/^Ton rôle \(Commercial\) ne permet pas d'inviter, retirer un membre ou changer un rôle\. Peuvent le faire : /);
    expect(d.qui.map((q) => q.utilisateur).sort()).toEqual([P.proprietaire, P.administrateur].sort());
    expect(d.bouton).toBe('demander');
  });

  it('D4 : la porte ne renvoie jamais vers une personne absente', async () => {
    await admin.query(`update socle.membre set actif = false where utilisateur = $1 and entreprise = $2`, [P.administrateur, ent]);
    try {
      const d = await enTantQue(pool, P.commercial ?? '', (tx) => peut(tx, { utilisateur: P.commercial ?? '' }, ent, 'socle.equipe.gerer'));
      if (d.ok) throw new Error('refus attendu');
      expect(d.qui.map((q) => q.utilisateur)).toEqual([P.proprietaire]);
    } finally {
      await admin.query(`update socle.membre set actif = true where utilisateur = $1 and entreprise = $2`, [P.administrateur, ent]);
    }
  });

  it('D3 : une entreprise qu\'on ne voit pas n\'existe pas (on ne dit même pas qui peut)', async () => {
    const d = await enTantQue(pool, P.proprietaire ?? '', (tx) => peut(tx, { utilisateur: P.proprietaire ?? '' }, autre, 'socle.accueil.voir'));
    expect(d).toEqual({ ok: false, raison: 'invisible', motif: motif('commun.introuvable'), qui: [], bouton: null });
  });

  it('un code sur le téléphone à mettre en place passe avant tout le reste', async () => {
    const d = await enTantQue(pool, P.proprietaire ?? '', (tx) => peut(tx, { utilisateur: P.proprietaire ?? '', codeAConfigurer: true }, ent, 'socle.accueil.voir'));
    expect(d).toMatchObject({ ok: false, raison: 'code_a_configurer', bouton: 'compte.code.configurer' });
  });

  it('un geste que personne n\'a déclaré est refusé', async () => {
    const d = await enTantQue(pool, P.proprietaire ?? '', (tx) => peut(tx, { utilisateur: P.proprietaire ?? '' }, ent, 'socle.inconnu.faire'));
    expect(d).toMatchObject({ ok: false, raison: 'geste_inconnu' });
  });
});
