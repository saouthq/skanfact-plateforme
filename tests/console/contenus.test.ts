// Le contenu des pièces scellées, relu contre son empreinte (0142 ; docs/console.md C66 ; l'audit 1.42.0 § 4 ; 01 R9) :
//   - une facture ou une écriture retouchée par-dessous la base garde son maillon intact : la relecture des liens ne la
//     voit pas, celle du contenu la nomme, au rang près ;
//   - une pièce disparue se dit, une sorte de pièce inconnue ne se dit jamais « intacte » ;
//   - une relecture se demande depuis la console (toutes, ou une entreprise pour la direction), une à la fois, et la
//     console suit où elle en est ; une chaîne cassée se relie à son incident.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { demandeArretee, lireChaines } from '../../serveur/console/chaines.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { faireLaRelectureDemandee, MOTIFS, relireLeContenu, relireLesContenus } from '../../serveur/service/contenus.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

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
let n = 0;
async function personne(prenom: string) {
  const email = `contenus-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id), nom: `${prenom} ${n}` };
}
async function membre(prenom: string, role: 'direction' | 'technique') {
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
// Une entreprise qui a émis trois factures (trois maillons de sa série) et validé leurs écritures (des maillons de ses livres).
async function entrepriseAvecPieces(nom: string) {
  const proprio = await personne('proprio');
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: nom, matriculeFiscal: `${String(3_100_000 + n).slice(-7)}A/A/M/000` })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const serie = String((await appeler('POST', `/entreprises/${ent}/series`, proprio.jeton, { type: 'facture', prefixe: 'FAC', legale: true })).corps.id);
  const client = String((await appeler('POST', `/entreprises/${ent}/clients`, proprio.jeton, { raisonSociale: 'Garage Nord', identifiant: '7654321B/A/M/000', typeIdentifiant: 'matricule' })).corps.id);
  const factures: string[] = [];
  for (const [i, prix] of ['500.125', '1234.567', '89.999'].entries()) {
    const b = await appeler('POST', `/entreprises/${ent}/ventes`, proprio.jeton, {
      type: 'facture', tiers: client, datePiece: `2026-09-0${i + 1}`,
      lignes: [{ designation: 'Porte en chêne', quantite: '3', prixUnitaire: prix, tauxTva: '19' }, { designation: 'Pose', quantite: '1', prixUnitaire: '100', tauxTva: '7' }],
    });
    expect(b.statut, JSON.stringify(b.corps)).toBe(201);
    const id = String(b.corps.id);
    const e = await appeler('POST', `/entreprises/${ent}/ventes/${id}/emettre`, proprio.jeton);
    expect(e.statut, JSON.stringify(e.corps)).toBeLessThan(300);
    factures.push(id);
  }
  await enTantQue(pool, proprio.id, (tx) => tx.query('select compta.valider($1, $2::date)', [ent, '2026-09-30']));
  return { ent, proprio, serie, factures };
}
// Une retouche par-dessous la base : déclencheurs suspendus, comme un intrus le ferait (la base refuse sinon).
async function parDessous(requete: string, valeurs: unknown[]) {
  await admin.query('begin');
  await admin.query('set local session_replication_role = replica');
  await admin.query(requete, valeurs);
  await admin.query('commit');
}
const etatDe = async (ent: string, cle: string) => (await admin.query(
  'select controle_ok, contenu_ok, contenu_rang::int contenu_rang, contenu_motif, contenu_jusqua::int contenu_jusqua from socle.chaine where entreprise = $1 and cle = $2', [ent, cle])).rows[0];

let direction: Awaited<ReturnType<typeof membre>>, technique: Awaited<ReturnType<typeof membre>>;
beforeAll(async () => {
  await admin.connect();
  // Le timbre, une règle commune d'essai : 1 DT depuis 2000 (une vraie règle a sa source légale).
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  technique = await membre('technique', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('le contenu des pièces scellées, relu contre son empreinte (0142)', () => {
  it('une facture et une écriture retouchées par-dessous la base : les liens ne voient rien, le contenu les nomme au rang près', async () => {
    const e = await entrepriseAvecPieces('Contenu Relu');
    const serie = `serie:${e.serie}`, livres = `livres:${e.ent}`;
    const rangLivres = Number((await admin.query('select rang from socle.chaine where entreprise = $1 and cle = $2', [e.ent, livres])).rows[0]?.rang ?? 0);
    expect(rangLivres).toBeGreaterThanOrEqual(3);
    // Intactes : chaque pièce relue, son contenu d'aujourd'hui égal à celui qu'on a scellé (deux chemins, un chiffre).
    expect(await relireLeContenu(pool, e.ent, serie, 3, horloge)).toEqual({ ok: true, pieces: 3 });
    expect(await relireLeContenu(pool, e.ent, livres, rangLivres, horloge)).toEqual({ ok: true, pieces: rangLivres });
    expect(await etatDe(e.ent, serie)).toMatchObject({ contenu_ok: true, contenu_rang: null, contenu_motif: null, contenu_jusqua: 3 });

    // Un millime de moins sur la deuxième facture, par-dessous la base : son maillon n'a pas bougé.
    await parDessous('update ventes.piece set net_a_payer = net_a_payer - 1 where id = $1', [e.factures[1]]);
    const liens = await enTantQue(pool, null, async (tx) => (await tx.query('select plateforme.relire_liens($1, $2, $3) v', [e.ent, serie, horloge])).rows[0].v);
    expect(liens).toBe(true);
    expect(await relireLeContenu(pool, e.ent, serie, 3, horloge)).toEqual({ ok: false, pieces: 2, rang: 2, motif: MOTIFS.modifiee });
    expect(await etatDe(e.ent, serie)).toMatchObject({ controle_ok: true, contenu_ok: false, contenu_rang: 2, contenu_motif: MOTIFS.modifiee });
    // Le libellé d'une ligne d'écriture validée, retouché : la première écriture de ses livres.
    const premiere = (await admin.query('select objet_id from socle.maillon where entreprise = $1 and cle = $2 and rang = 1', [e.ent, livres])).rows[0].objet_id as string;
    await parDessous('update compta.ligne set libelle = libelle || \'.\' where ecriture = $1 and rang = 1', [premiere]);
    expect(await relireLeContenu(pool, e.ent, livres, rangLivres, horloge)).toEqual({ ok: false, pieces: 1, rang: 1, motif: MOTIFS.modifiee });

    // Remises comme elles étaient, la relecture suivante les dit intactes.
    await parDessous('update ventes.piece set net_a_payer = net_a_payer + 1 where id = $1', [e.factures[1]]);
    await parDessous('update compta.ligne set libelle = left(libelle, length(libelle) - 1) where ecriture = $1 and rang = 1', [premiere]);
    expect(await relireLeContenu(pool, e.ent, serie, 3, horloge)).toEqual({ ok: true, pieces: 3 });
    expect(await relireLeContenu(pool, e.ent, livres, rangLivres, horloge)).toEqual({ ok: true, pieces: rangLivres });
    expect(await etatDe(e.ent, livres)).toMatchObject({ contenu_ok: true, contenu_rang: null });
  });

  it('une pièce disparue se dit ; une sorte que la relecture ne lit pas n\'est jamais « intacte » ; une personne n\'y touche pas', async () => {
    const e = await entrepriseAvecPieces('Contenu Disparu');
    const autre = `livres:${e.ent.replace(/^.{8}/, 'aaaaaaaa')}`;
    await enTantQue(pool, e.proprio.id, async (tx) => {
      // Une écriture qui n'existe pas (son maillon seul), puis une sorte de pièce que personne ne relit encore.
      await tx.query('select * from socle.sceller($1, $2, $3, gen_random_uuid(), $4)', [e.ent, autre, 'ecriture', 'a'.repeat(64)]);
      await tx.query('select * from socle.sceller($1, $2, $3, gen_random_uuid(), $4)', [e.ent, autre, 'ticket_futur', 'b'.repeat(64)]);
    });
    expect(await relireLeContenu(pool, e.ent, autre, 2, horloge)).toEqual({ ok: false, pieces: 1, rang: 1, motif: MOTIFS.disparue });
    await parDessous('delete from socle.maillon where entreprise = $1 and cle = $2 and rang = 1', [e.ent, autre]);
    await parDessous('update socle.maillon set rang = 1 where entreprise = $1 and cle = $2 and rang = 2', [e.ent, autre]);
    const inconnue = await relireLeContenu(pool, e.ent, autre, 2, horloge);
    expect(inconnue).toMatchObject({ ok: null, rang: 1 });
    expect(inconnue.ok === true ? '' : inconnue.motif).toContain('ticket_futur');
    expect(await etatDe(e.ent, autre)).toMatchObject({ contenu_ok: null, contenu_rang: 1 });
    // Une personne connectée n'appelle aucune fonction de la relecture : ni les pièces, ni les maillons, ni la note.
    for (const [sql, valeurs] of [
      ['select * from plateforme.pieces_a_relire($1, $2)', [e.ent, e.factures]],
      ['select * from plateforme.maillons_a_relire($1, $2, 0, 10, 10)', [e.ent, `serie:${e.serie}`]],
      ['select plateforme.noter_contenu($1, $2, now(), true, null, null, 3)', [e.ent, `serie:${e.serie}`]],
      ['select plateforme.relecture_prendre(now())', []],
    ] as const) {
      await expect(enTantQue(pool, e.proprio.id, (tx) => tx.query(sql, [...valeurs]))).rejects.toThrow(/seul le serveur relit le contenu/);
    }
    await parDessous('delete from socle.maillon where entreprise = $1 and cle = $2', [e.ent, autre]);
    await parDessous('delete from socle.chaine where entreprise = $1 and cle = $2', [e.ent, autre]);
  });

  it('le tour de chaque heure : un lot des chaînes les moins récemment relues, compté', async () => {
    const e = await entrepriseAvecPieces('Contenu Du Tour');
    horloge = new Date(horloge.getTime() + 60_000);
    const r = await relireLesContenus(pool, horloge, { lot: 100_000 });
    expect(r.chaines).toBeGreaterThanOrEqual(2);
    expect(r.pieces).toBeGreaterThanOrEqual(6);
    expect((await etatDe(e.ent, `serie:${e.serie}`)).contenu_ok).toBe(true);
    const releve = (await admin.query('select chaines, pieces::int pieces from plateforme.releve_contenus where le = $1', [horloge])).rows[0];
    expect(releve).toEqual({ chaines: r.chaines, pieces: r.pieces });
  });
});

describe('relire depuis la console (0142)', () => {
  it('une entreprise, par la direction : demandée, faite par le serveur, suivie ; une chaîne cassée se relie à son incident', async () => {
    const e = await entrepriseAvecPieces('Contenu Console');
    const numero = (await admin.query('select plateforme.numero_texte($1) v', [e.ent])).rows[0].v as string;
    expect(numero).toMatch(/^E-\d{4,}$/);
    await parDessous('update ventes.piece set net_a_payer = net_a_payer - 1 where id = $1', [e.factures[2]]);
    // La technique ne nomme pas une entreprise ; un numéro inconnu se refuse ; un motif manque.
    expect(await appeler('POST', '/console/service/securite/relire', technique.console, { client: numero, motif: 'un doute' }))
      .toMatchObject({ statut: 403, corps: { motif: 'Relire une entreprise nommée est un geste de la direction.' } });
    expect((await appeler('POST', '/console/service/securite/relire', direction.console, { client: 'E-999999', motif: 'un doute' })).corps.motif)
      .toMatch(/^Aucune entreprise ne porte ce numéro de client/);
    expect((await appeler('POST', '/console/service/securite/relire', direction.console, { client: numero, motif: '' })).statut).toBe(400);

    const d = await appeler('POST', '/console/service/securite/relire', direction.console, { client: numero.toLowerCase(), motif: 'le client doute d\'une facture' });
    expect(d.statut, JSON.stringify(d.corps)).toBe(201);
    // Une seule à la fois.
    expect((await appeler('POST', '/console/service/securite/relire', technique.console, { client: null, motif: 'tout relire' })).corps.motif)
      .toBe('Une relecture est déjà en cours : la suivante se demande quand elle est finie.');
    let s = (await appeler('GET', '/console/service/securite', direction.console)).corps.chaines as Record<string, unknown> & { demande: Record<string, unknown> };
    expect(s.demande).toMatchObject({ toutes: false, entreprise: { id: e.ent, numero }, commencee: false, finieLe: null, arretee: false, par: direction.nom });

    // Un serveur la prend : un second ne la prend pas tant que le premier en donne des nouvelles.
    const prendre = (le: Date) => enTantQue(pool, null, async (tx) => (await tx.query('select plateforme.relecture_prendre($1) v', [le])).rows[0].v as { entreprise: string } | null);
    expect(await prendre(horloge)).toMatchObject({ entreprise: e.ent });
    expect(await prendre(new Date(horloge.getTime() + 60_000))).toBeNull();
    // Arrêté en route : six minutes sans nouvelles, l'écran le dit ; un autre serveur la reprend et la fait, les chaînes de
    // cette entreprise seules (sa série, ses livres).
    horloge = new Date(horloge.getTime() + 6 * 60_000);
    s = (await appeler('GET', '/console/service/securite', direction.console)).corps.chaines as typeof s;
    expect(s.demande).toMatchObject({ commencee: true, finieLe: null, arretee: true });
    const r = await faireLaRelectureDemandee(pool, () => horloge);
    expect(r).toEqual({ demandes: 1, chaines: 2, pieces: expect.any(Number), cassees: 1 });
    expect(await faireLaRelectureDemandee(pool, () => horloge)).toMatchObject({ demandes: 0 });
    s = (await appeler('GET', '/console/service/securite', direction.console)).corps.chaines as typeof s;
    expect(s.demande).toMatchObject({ total: 2, faites: 2, cassees: 1, commencee: true, finieLe: expect.any(String), arretee: false });
    expect(s.cassees).toContainEqual(expect.objectContaining({ sorte: 'serie', quoi: 'contenu', rang: 3, motif: MOTIFS.modifiee, entreprise: { id: e.ent, nom: 'Contenu Console', numero } }));
    expect(s.etat).toBe('casse');
    expect(s.incident).toBeNull();
    // La technique voit la rupture, jamais l'entreprise.
    const t = (await appeler('GET', '/console/service/securite', technique.console)).corps.chaines as { cassees: { entreprise: unknown }[]; demande: { entreprise: unknown } };
    expect(t.cassees.every((c) => c.entreprise === null)).toBe(true);
    expect(t.demande.entreprise).toBeNull();
    expect(JSON.stringify(t)).not.toContain(e.ent);
    // La veille compte une chaîne cassée par son contenu.
    const v = (await enTantQue(pool, null, (tx) => tx.query('select plateforme.veille_lire($1, 15) v', [horloge]))).rows[0].v as { chaines: { cassees: number } };
    expect(v.chaines.cassees).toBeGreaterThanOrEqual(1);
    // Le geste est au journal de la console, avec son motif.
    expect((await admin.query('select geste, entreprise, motif from plateforme.geste_console where geste = $1 and entreprise = $2', ['service.relecture_demandee', e.ent])).rows)
      .toEqual([{ geste: 'service.relecture_demandee', entreprise: e.ent, motif: 'le client doute d\'une facture' }]);

    // L'incident ouvert sur la fiche « une chaîne d'empreintes cassée » : l'écran Sécurité le relie.
    const i = await appeler('POST', '/console/service/incidents', direction.console, { titre: 'Une chaîne d\'empreintes cassée', gravite: 'critique', fiche: 'empreinte', public: null, motif: 'relecture du contenu' });
    expect(i.statut, JSON.stringify(i.corps)).toBe(201);
    s = (await appeler('GET', '/console/service/securite', direction.console)).corps.chaines as typeof s;
    expect(s.incident).toEqual({ id: i.corps.id, ref: i.corps.ref });

    // Remise, puis relue : intacte (les essais suivants ne voient pas une chaîne cassée).
    await parDessous('update ventes.piece set net_a_payer = net_a_payer + 1 where id = $1', [e.factures[2]]);
    expect(await relireLeContenu(pool, e.ent, `serie:${e.serie}`, 3, horloge)).toEqual({ ok: true, pieces: 3 });
    await appeler('POST', `/console/service/incidents/${String(i.corps.id)}/clore`, direction.console, {
      fin: horloge.toISOString(), effet: 'aucun effet chez un client', cause: 'une retouche d\'essai', change: 'rien à changer, un essai', motif: 'essai fini', suites: [],
    });
  });

  it('toutes les entreprises : la direction ou la technique ; une demande qui ne bouge plus se dit', async () => {
    horloge = new Date(horloge.getTime() + 60_000);
    const d = await appeler('POST', '/console/service/securite/relire', technique.console, { client: null, motif: 'après une mise à jour' });
    expect(d.statut, JSON.stringify(d.corps)).toBe(201);
    const total = Number((await admin.query('select count(*) n from socle.chaine where rang > 0')).rows[0].n);
    const r = await faireLaRelectureDemandee(pool, () => horloge);
    expect(r.demandes).toBe(1);
    expect(r.chaines).toBeGreaterThanOrEqual(total);
    // Elle compte comme une relecture des liens (0115) et du contenu, à son instant.
    expect((await admin.query('select chaines from plateforme.releve_chaines where le = $1', [horloge])).rows).toEqual([{ chaines: r.chaines }]);
    expect((await admin.query('select chaines from plateforme.releve_contenus where le = $1', [horloge])).rows).toEqual([{ chaines: r.chaines }]);
    const s = lireChaines((await appeler('GET', '/console/service/securite', direction.console)).corps.chaines);
    expect(s.demande).toMatchObject({ toutes: true, faites: r.chaines, total: r.chaines });
    // Une demande sans nouvelle du serveur depuis plus de cinq minutes ne bouge plus ; finie, jamais.
    const le = '2026-10-19T10:00:00.000Z';
    expect(demandeArretee({ demandeeLe: le, nouvelleLe: le, finieLe: null }, new Date('2026-10-19T10:05:01Z'))).toBe(true);
    expect(demandeArretee({ demandeeLe: le, nouvelleLe: le, finieLe: null }, new Date('2026-10-19T10:04:59Z'))).toBe(false);
    expect(demandeArretee({ demandeeLe: le, nouvelleLe: null, finieLe: null }, new Date('2026-10-19T10:06:00Z'))).toBe(true);
    expect(demandeArretee({ demandeeLe: le, nouvelleLe: le, finieLe: le }, new Date('2026-10-19T12:00:00Z'))).toBe(false);
  });
});
