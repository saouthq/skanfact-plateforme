// Ce que chaque offre comprend se règle dans la console (docs/abonnement.md C16 ; 0105), comme un prix. Ce que le
// serveur garantit :
//   - la direction prépare un changement (des caisses, des établissements, des salariés avec la paie, un module), avec
//     son motif, au plus tôt après le préavis d'un nouveau prix ; le support ne le peut pas ; un seul à venir par ligne,
//     jamais ce que l'offre comprend déjà ;
//   - le client le lit à venir dans « Ton abonnement » dès qu'il est préparé (sans le motif, une note de SkanFact) ;
//   - il se retire avant sa date ; un contenu en vigueur ne change ni ne disparaît, quoi qu'on demande à la base ;
//   - la facture d'une période se compte au contenu de son PREMIER JOUR, comme son prix : une période commencée garde ce
//     qu'elle comprend ;
//   - la porte des modules lit le contenu du premier jour de la période qui court : un changement n'ouvre ni ne ferme rien
//     au milieu d'une période.
// Les changements préparés ici sont à venir : ils s'effacent à la fin, pour les fichiers de test qui suivent.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { lireFaits, plusJours, plusMois, type Faits } from '../../serveur/abonnement/etat.ts';
import { modulesFermes } from '../../serveur/abonnement/offre.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { REGLES_DE_DEPART } from '../regles-de-depart.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'contenu-')), 'veille.json');
const jour = aujourdhuiATunis();
const enFrancais = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`;
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `contenu-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${qui} ${n}`, motDePasse: MDP });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
// Un membre de l'équipe SkanFact : sa session de l'application et celle de la console.
async function membre(prenom: string, role: 'direction' | 'support') {
  const { email, jeton: appli } = await inscrire(prenom);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return { appli, console: String(k.corps.jeton), nom: `${prenom} ${n}`, email };
}
let amira: Awaited<ReturnType<typeof membre>>;
let karim: Awaited<ReturnType<typeof membre>>;
const preparer = (corps: Corps, jeton = amira.console) => appeler('POST', '/console/reglages/contenu', jeton, corps);
const retirer = (corps: Corps) => appeler('POST', '/console/reglages/contenu/retirer', amira.console, corps);
type ContenuLu = { duJour: Record<string, Record<string, number | null>>; aVenir: Corps[] };
const contenuConsole = async () => (await appeler('GET', '/console/reglages', amira.console)).corps.contenu as ContenuLu;
const dernierGeste = async (geste: string) => (await admin.query('select avant, apres, motif from plateforme.geste_console where geste = $1 order by le desc, id desc limit 1', [geste])).rows[0] as
  { avant: Corps; apres: Corps; motif: string } | undefined;
const ligneDe = async (ent: string) => (await appeler('GET', `/console/entreprises/${ent}`, amira.console)).corps.ligne;
const geste = (ent: string, g: string, corps: Corps) => appeler('POST', `/console/entreprises/${ent}/abonnement/${g}`, amira.console, corps);

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  // Aucun changement à venir laissé par un essai interrompu : chaque test part du contenu d'aujourd'hui.
  await admin.query('delete from plateforme.contenu_offre where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  amira = await membre('amira', 'direction');
  karim = await membre('karim', 'support');
});
// Les changements à venir ne restent pas : la base les laisse effacer tant que leur date n'est pas venue.
afterAll(async () => {
  await admin.query('delete from plateforme.contenu_offre where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');
  await app.close(); await admin.end(); await pool.end();
});

describe('ce que chaque offre comprend, réglé dans la console', () => {
  it('la direction prépare un changement au plus tôt après le préavis, le client le lit à venir ; il se retire avant sa date, et un contenu en vigueur ne bouge jamais', async () => {
    const plusTot = plusJours(jour, 30);
    // Le contenu de départ, lu par le support, qui ne le change pas.
    const lu = (await appeler('GET', '/console/reglages', karim.console)).corps.contenu as ContenuLu;
    expect(lu.duJour).toEqual({ essentiel: { caisses: 1, etablissements: 1, salaries: 10, paie: 0, compta: 0 },
      complet: { caisses: 2, etablissements: 2, salaries: 20, paie: 1, compta: 1 } });
    expect((await preparer({ offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: plusTot, motif: 'Deux caisses en Essentiel' }, karim.console)).statut).toBe(403);
    // La base le refuse aussi, à qui l'appellerait sans passer par la porte du serveur.
    const session = (await admin.query(`select s.id, s.utilisateur from plateforme.session_console s join socle.utilisateur u on u.id = s.utilisateur
      where u.email = $1 and s.fermee_le is null order by s.ouverte_le desc limit 1`, [karim.email])).rows[0] as { id: string; utilisateur: string };
    const k = await pool.connect();
    try {
      await k.query('begin');
      await k.query("select set_config('app.utilisateur', $1, true), set_config('app.session_console', $2, true)", [session.utilisateur, session.id]);
      await expect(k.query('select plateforme.console_preparer_contenu($1, $2, $3, $4::date, $5, now(), $6::date)', ['essentiel', 'caisses', 2, plusTot, 'Deux caisses en Essentiel', jour]))
        .rejects.toThrow(/ton rôle dans l'équipe SkanFact ne permet pas ce geste/);
    } finally { await k.query('rollback'); k.release(); }
    // Refusé, avec la raison : trop tôt, ce qui ne changerait rien, un module qui n'est ni compris ni acheté seul.
    const refus = async (corps: Corps) => { const r = await preparer(corps); expect(r.statut, JSON.stringify(r.corps)).toBe(403); return String(r.corps.motif); };
    expect(await refus({ offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: plusJours(jour, 29), motif: 'Deux caisses en Essentiel' }))
      .toBe(`Un nouveau contenu commence au plus tôt le ${enFrancais(plusTot)} : c'est le préavis en vigueur.`);
    expect(await refus({ offre: 'essentiel', quoi: 'caisses', nombre: 1, aPartirDu: plusTot, motif: 'La même caisse' }))
      .toBe('C\'est déjà ce que l\'offre comprend : rien ne changerait.');
    expect(await refus({ offre: 'complet', quoi: 'paie', nombre: 2, aPartirDu: plusTot, motif: 'Deux paies' }))
      .toBe('Ce que l\'offre comprend est un nombre de 0 à 1000 ; un module est compris ou acheté seul.');
    // Préparé : au journal, de ce que l'offre comprend à ce qu'elle comprendra, avec sa date et le motif.
    expect((await preparer({ offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: plusTot, motif: 'Deux caisses en Essentiel' })).statut).toBe(201);
    expect(await dernierGeste('reglages.contenu_prepare')).toMatchObject({ motif: 'Deux caisses en Essentiel',
      avant: { offre: 'essentiel', quoi: 'caisses', nombre: 1 }, apres: { offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: plusTot } });
    // Un seul à venir par ligne : l'autre offre, ou une autre ligne, se préparent à part.
    expect(await refus({ offre: 'essentiel', quoi: 'caisses', nombre: 3, aPartirDu: plusJours(jour, 60), motif: 'Trois caisses' }))
      .toMatch(/^Un changement est déjà préparé pour cette ligne/);
    // La console le montre à venir, avec qui l'a préparé et pourquoi ; aujourd'hui ne change pas.
    const c = await contenuConsole();
    expect(c.duJour.essentiel?.caisses).toBe(1);
    expect(c.aVenir).toEqual([{ offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: plusTot, motif: 'Deux caisses en Essentiel', par: amira.nom, le: expect.any(String) }]);
    // Le client le lit dès maintenant, sans le motif.
    const client = await inscrire('lina');
    const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Épicerie Avertie' })).corps.id);
    const abo = (await appeler('GET', `/entreprises/${ent}/abonnement`, client.jeton)).corps as { contenu: ContenuLu };
    expect(abo.contenu.duJour.essentiel).toEqual({ caisses: 1, etablissements: 1, salaries: 10, paie: 0, compta: 0 });
    expect(abo.contenu.aVenir).toEqual([{ offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: plusTot }]);
    // Retiré avant sa date : aujourd'hui reste, le client ne le lit plus, le journal garde le changement retiré.
    expect((await retirer({ offre: 'essentiel', quoi: 'caisses', aPartirDu: plusTot, motif: 'Annoncé trop tôt' })).statut).toBe(200);
    expect((await contenuConsole()).aVenir).toEqual([]);
    expect(((await appeler('GET', `/entreprises/${ent}/abonnement`, client.jeton)).corps as { contenu: ContenuLu }).contenu.aVenir).toEqual([]);
    expect(await dernierGeste('reglages.contenu_retire')).toMatchObject({ motif: 'Annoncé trop tôt',
      avant: { offre: 'essentiel', quoi: 'caisses', nombre: 2, aPartirDu: plusTot }, apres: { nombre: 1 } });
    expect(String((await retirer({ offre: 'essentiel', quoi: 'caisses', aPartirDu: plusTot, motif: 'Encore' })).corps.motif))
      .toMatch(/^Ce changement n'existe pas, ou il a déjà été retiré/);
    // Un contenu en vigueur ne se retire pas ; la base refuse de l'effacer ou de le changer, quoi qu'on lui demande.
    expect(String((await retirer({ offre: 'essentiel', quoi: 'caisses', aPartirDu: '2000-01-01', motif: 'Essai' })).corps.motif)).toMatch(/^Ce contenu est déjà en vigueur/);
    await expect(admin.query("delete from plateforme.contenu_offre where offre = 'essentiel' and quoi = 'caisses' and a_partir_du = '2000-01-01'")).rejects.toThrow(/ne s'efface jamais/);
    await expect(admin.query("update plateforme.contenu_offre set nombre = 5 where offre = 'complet' and quoi = 'caisses'")).rejects.toThrow(/ne se modifie pas/);
  });

  it('la facture d\'une période se compte au contenu de son premier jour : un changement ne touche jamais une période commencée', async () => {
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    const editeur = String((await appeler('POST', '/entreprises', amira.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
    expect((await appeler('POST', '/console/reglages/factures/editeur', amira.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    await appeler('GET', `/entreprises/${editeur}/dossier-v10`, amira.appli);
    // Complet comprendra vingt-cinq salariés au lieu de vingt, dans trente jours.
    const date = plusJours(jour, 30);
    expect((await preparer({ offre: 'complet', quoi: 'salaries', nombre: 25, aPartirDu: date, motif: 'Vingt-cinq salariés en Complet' })).statut).toBe(201);
    // Deux cliniques au mois, vingt et un salariés chacune : la prochaine période de l'une commence avant la date, celle de
    // l'autre après.
    const p = await inscrire('ines');
    const clinique = async (nom: string, payeJusquAu: string) => {
      const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom })).corps.id);
      expect((await geste(ent, 'payer', { motif: 'le mois', ligne: await ligneDe(ent), offre: 'complet', periodicite: 'mensuel' })).statut).toBe(200);
      // L'essai fini depuis longtemps : l'échéance est celle de la période payée.
      await admin.query('update plateforme.abonnement set paye_jusqu_au = $2, essai_jusqu_au = $3 where entreprise = $1', [ent, payeJusquAu, plusJours(jour, -60)]);
      for (let i = 1; i <= 21; i++) {
        await admin.query('insert into socle.dossier_v10 (entreprise, collection, cle, rang, contenu) values ($1, $2, $3, $4, $5)',
          [ent, 'employees', `s${i}`, i, JSON.stringify({ id: `s${i}`, name: `Salarié ${i}`, endDate: '' })]);
      }
      return ent;
    };
    const avant = await clinique('Clinique Avant', plusJours(date, -5));
    const apres = await clinique('Clinique Après', plusJours(date, 3));
    const apercu = async (ent: string) => (await appeler('POST', `/console/entreprises/${ent}/factures`, amira.console,
      { offre: 'complet', periodicite: 'mensuel', motif: '', apercu: true })).corps.facture as { debut: string; enPlus: Corps[] };
    // Avant : sa période commence sous les vingt salariés de départ, un salarié de plus se facture.
    const a = await apercu(avant);
    expect(a.debut).toBe(plusJours(date, -4));
    expect(a.enPlus).toMatchObject([{ option: 'salarie', quantite: 1, compte: 21, inclus: 20 }]);
    // Après : sa période commence sous les vingt-cinq, rien ne s'ajoute.
    const b = await apercu(apres);
    expect(b.debut).toBe(plusJours(date, 4));
    expect(b.enPlus).toEqual([]);
  });

  it('la porte des modules lit le contenu du premier jour de la période qui court', async () => {
    // Essentiel comprendra la comptabilité complète dans trente jours.
    const date = plusJours(jour, 30);
    expect((await preparer({ offre: 'essentiel', quoi: 'compta', nombre: 1, aPartirDu: date, motif: 'La comptabilité dans Essentiel' })).statut).toBe(201);
    const p = await inscrire('sami');
    const qui = await quiEst(ctx, p.jeton);
    const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Atelier Daté' })).corps.id);
    expect((await geste(ent, 'payer', { motif: 'l\'année', ligne: await ligneDe(ent), offre: 'essentiel', periodicite: 'annuel' })).statut).toBe(200);
    // Les faits que la base rend à la propriétaire portent l'histoire du contenu ; la porte se calcule un jour donné.
    const faitsSi = async (payeJusquAu: string): Promise<Faits> => {
      await admin.query('update plateforme.abonnement set paye_jusqu_au = $2, essai_jusqu_au = $3 where entreprise = $1', [ent, payeJusquAu, plusJours(jour, -60)]);
      const f = await enTantQue(pool, qui?.utilisateur ?? null, async (tx) => (await tx.query('select plateforme.faits_abonnement($1) f', [ent])).rows[0].f as Corps);
      return lireFaits(f);
    };
    const lendemain = plusJours(date, 1);
    // Une année commencée avant la date : le lendemain de la date, la comptabilité reste fermée (rien ne s'ouvre au milieu).
    expect(modulesFermes(await faitsSi(plusJours(date, 300)), lendemain)).toEqual(['paie', 'compta']);
    // Une année commencée à la date : la comptabilité est ouverte, la paie reste fermée.
    expect(modulesFermes(await faitsSi(plusJours(plusMois(date, 12), -1)), lendemain)).toEqual(['paie']);
    // Sans l'histoire du contenu (une base qui ne la rendrait pas), rien ne se ferme.
    const sans: Faits = { ...(await faitsSi(plusJours(date, 300))), contenu: {}, regles: REGLES_DE_DEPART };
    expect(modulesFermes(sans, lendemain)).toEqual([]);
  });
});
