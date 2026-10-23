// L'abonnement après sa revue, lot 2 (1.119.0 ; 0171 ; docs/abonnement.md C21 ; docs/revue-abonnement.md, P1 4, P2 11
// et 12), par l'API. Ce que le serveur garantit :
//   - le choix d'une offre se facture ET s'émet seul (serveur/abonnement/facturier.ts) : une facture à payer, au nom de
//     l'entreprise SkanFact, par la même préparation que la console, notée « au choix » ; deux tours n'en font pas deux ;
//     un choix qui ne se facture pas garde son motif, que la console lit dans « À décider », et l'abonnée l'apprend ;
//   - « Ne pas renouveler » et le reprendre, par qui gère l'abonnement, pendant une période payée qui court ; refusé quand
//     la facture de la période suivante attend son paiement ; l'histoire dit que c'est le client lui-même ;
//   - un module ouvert tout de suite : l'aperçu dit le rattrapage, et la prochaine facture le compte au même millime ;
//   - le prix TTC de chaque offre, par le moteur de la facture.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { CLE_DU_COFFRE_D_ESSAI } from '../../serveur/coffre.ts';
import { plusJours, plusMois } from '../../serveur/abonnement/etat.ts';
import { facturerLesChoix } from '../../serveur/abonnement/facturier.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { konnectSimule } from '../konnect-simule.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'facture-au-choix-')), 'veille.json');
const jour = aujourdhuiATunis();
let konnect: Awaited<ReturnType<typeof konnectSimule>>;
let ctx: Contexte;
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
const adresse = (qui: string) => `au-choix-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
async function connecter(email: string) {
  return String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
}
async function direction() {
  const email = adresse('amira');
  await appeler('POST', '/inscription', undefined, { email, nom: 'Amira Équipe', motDePasse: MDP });
  const appli = await connecter(email);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, 'direction', 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return { appli, console: String(k.corps.jeton) };
}
async function abonnee(nom: string, essaiDans: number) {
  const email = adresse('proprio');
  await appeler('POST', '/inscription', undefined, { email, nom: `Proprio ${n}`, motDePasse: MDP });
  const jeton = await connecter(email);
  const id = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
  await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + $3::int where entreprise = $1', [id, jour, essaiDans]);
  return { id, jeton };
}
// Un abonnement payé qui court : sa période, du paiement qui l'a payée (comme 0097 la note), Essentiel au mois.
async function payee(b: { id: string }, debut: string, fin: string) {
  await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 1, paye_jusqu_au = $3::date, offre = 'essentiel', periodicite = 'mensuel'
    where entreprise = $1`, [b.id, debut, fin]);
  await admin.query(`insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, apres)
    values ($1, 'paye', 'systeme', 'payée en ligne', jsonb_build_object('debut', $2::text, 'fin', $3::text))`, [b.id, debut, fin]);
}
type Piece = { type: string; numero: string; net: string; reste: string | null; statut: string | null; payable: boolean; periode: Corps | null };
const sonAbonnement = async (b: { id: string; jeton: string }) => {
  const r = await appeler('GET', `/entreprises/${b.id}/abonnement`, b.jeton);
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  return r.corps as Corps & { factures: { pieces: Piece[] } | null; choix: Corps | null };
};
const sesFactures = async (b: { id: string }) =>
  (await admin.query('select offre, periodicite, debut::text, au_choix, prepare_par from plateforme.facture_abonnement where entreprise = $1 order by prepare_le', [b.id])).rows as
    { offre: string; periodicite: string; debut: string; au_choix: boolean; prepare_par: string }[];
// Attendre que le tour lancé juste après le choix ait fini (facturerBientot) : la facture, ou le refus noté.
async function attendreLeTour(b: { id: string }) {
  await expect.poll(async () => Number((await admin.query(`select (select count(*) from plateforme.facture_abonnement where entreprise = $1)
    + (select count(*) from plateforme.choix_refuse r join plateforme.offre_choisie c on c.id = r.choix where c.entreprise = $1) n`, [b.id])).rows[0].n),
  { timeout: 15_000, interval: 200 }).toBeGreaterThan(0);
}

let amira: Awaited<ReturnType<typeof direction>>;
let editeur: string;
let proprietaire: string;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  konnect = await konnectSimule();
  ctx = {
    pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
    paiement: { konnect: konnect.base, coffre: CLE_DU_COFFRE_D_ESSAI, adresse: () => 'https://skanfact.exemple.tn' },
    factureAuChoix: true,
  };
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  amira = await direction();
  editeur = String((await appeler('POST', '/entreprises', amira.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
  await admin.query('delete from plateforme.facture_abonnement');
  await admin.query('delete from plateforme.editeur');
  expect((await appeler('POST', '/console/reglages/factures/editeur', amira.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
  // Amira ouvre l'application de SkanFact une fois (son dossier naît, avec sa fiche), et y branche Konnect.
  expect((await appeler('GET', `/entreprises/${editeur}/dossier-v10`, amira.appli)).statut).toBe(200);
  expect((await appeler('PUT', `/entreprises/${editeur}/paiement-en-ligne`, amira.appli, { portefeuille: `portefeuille-${Date.now()}`, cle: 'sk_test_cle-de-l-api-konnect-b3f2' })).statut).toBe(200);
  proprietaire = String((await admin.query("select utilisateur from socle.membre where entreprise = $1 and 'proprietaire' = any(roles)", [editeur])).rows[0].utilisateur);
});
afterAll(async () => { await app.close(); await konnect.fermer(); await admin.end(); await pool.end(); });

describe('la facture au choix', () => {
  it('l\'abonnée choisit son offre : sa facture s\'émet seule, à payer en ligne, au nom de SkanFact ; un second tour n\'en fait pas deux', async () => {
    const a = await abonnee('Boulangerie au Choix', 4);
    expect((await sonAbonnement(a)).auto).toBe(true);
    expect((await appeler('POST', `/entreprises/${a.id}/abonnement/choisir`, a.jeton, { offre: 'essentiel', periodicite: 'mensuel' })).statut).toBe(201);
    await attendreLeTour(a);
    // La période commence au lendemain de l'essai ; la facture est préparée au nom de la propriétaire de SkanFact, au choix.
    const debut = plusJours(jour, 5);
    expect(await sesFactures(a)).toEqual([{ offre: 'essentiel', periodicite: 'mensuel', debut, au_choix: true, prepare_par: proprietaire }]);
    // Émise : un numéro de la série de SkanFact, 39 HT + 7,410 de TVA + 1 de timbre, payable en ligne. Le choix s'éteint.
    const lu = await sonAbonnement(a);
    expect(lu.choix).toBeNull();
    expect(lu.factures?.pieces).toEqual([expect.objectContaining({
      type: 'facture', net: '47.410', reste: '47.410', statut: 'a_payer', payable: true,
      periode: expect.objectContaining({ debut, fin: plusJours(plusMois(debut, 1), -1), offre: 'essentiel', periodicite: 'mensuel' }) })]);
    expect(lu.factures?.pieces[0]?.numero).toMatch(/\d/);
    // La pièce scellée au dossier de SkanFact, avec son numéro : la même que la console aurait préparée.
    const piece = (await admin.query("select statut from ventes.piece where entreprise = $1 and type = 'facture' and ref_v10 = $2",
      [editeur, `abonnement-${a.id}-${debut}`])).rows;
    expect(piece).toEqual([{ statut: 'emise' }]);
    // Un tour de plus (la minute suivante, ou deux serveurs) : rien de nouveau.
    expect(await facturerLesChoix(ctx, { entreprise: a.id })).toEqual({ choix: 0, emises: 0, refusees: 0 });
    expect(await sesFactures(a)).toHaveLength(1);
    // Payée en ligne, l'abonnement suit : la facture au choix est une facture comme les autres.
    const r = await appeler('POST', `/entreprises/${a.id}/abonnement/payer`, a.jeton, { numero: lu.factures?.pieces[0]?.numero });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  });

  it('un choix qui ne se facture pas garde son motif : la console le lit dans « À décider », l\'abonnée l\'apprend, et il attend le lendemain', async () => {
    const b = await abonnee('Épicerie Refusée', 6);
    // Une pièce de cette période attend déjà, en brouillon, dans l'application de SkanFact (préparée à la main).
    const debut = plusJours(jour, 7);
    const cle = `abonnement-${b.id}-${debut}`;
    expect((await appeler('POST', `/entreprises/${editeur}/dossier-v10`, amira.appli, { changements: [{ collection: 'documents', cle, rang: null, revision: null,
      contenu: { id: cle, type: 'facture', number: '', date: jour, status: 'brouillon', lines: [] } }] })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${b.id}/abonnement/choisir`, b.jeton, { offre: 'complet', periodicite: 'annuel' })).statut).toBe(201);
    await attendreLeTour(b);
    // Rien n'est noté ni émis (une seule transaction) ; le motif dit pourquoi.
    expect(await sesFactures(b)).toEqual([]);
    const motif = String((await admin.query('select r.motif from plateforme.choix_refuse r join plateforme.offre_choisie c on c.id = r.choix where c.entreprise = $1', [b.id])).rows[0]?.motif);
    expect(motif).toMatch(/attend|brouillon|préparée/i);
    const ligne = ((await appeler('GET', '/console/accueil', amira.console)).corps.decider as { sorte: string; entreprise?: { id: string }; refus?: string | null }[])
      .find((l) => l.entreprise?.id === b.id);
    expect(ligne).toMatchObject({ sorte: 'offre_choisie', refus: motif });
    // L'abonnée lit son choix, et qu'il passe par SkanFact.
    expect((await sonAbonnement(b)).choix).toMatchObject({ offre: 'complet', periodicite: 'annuel', refuse: true });
    // Le tour de la minute ne le retente pas avant le lendemain.
    expect(await facturerLesChoix(ctx, { entreprise: b.id })).toEqual({ choix: 0, emises: 0, refusees: 0 });
    // Le lendemain, la pièce retirée, il se facture ; le motif ne se lit plus.
    await admin.query('update plateforme.choix_refuse r set le = r.le - interval \'25 hours\' from plateforme.offre_choisie c where c.id = r.choix and c.entreprise = $1', [b.id]);
    await admin.query("delete from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2", [editeur, cle]);
    expect(await facturerLesChoix(ctx, { entreprise: b.id })).toEqual({ choix: 1, emises: 1, refusees: 0 });
    expect((await sesFactures(b)).map((f) => [f.offre, f.periodicite, f.au_choix])).toEqual([['complet', 'annuel', true]]);
    expect(((await appeler('GET', '/console/accueil', amira.console)).corps.decider as { entreprise?: { id: string } }[]).filter((l) => l.entreprise?.id === b.id)).toEqual([]);
  });

  it('ni pour un abonnement offert, ni pour un dossier qui ne se renouvelle plus : la console garde ces cas', async () => {
    const c = await abonnee('Mercerie Offerte', 3);
    await admin.query('update plateforme.abonnement set offert = true where entreprise = $1', [c.id]);
    const d = await abonnee('Quincaillerie Partante', 3);
    await payee(d, plusJours(jour, -10), plusJours(jour, 20));
    expect((await appeler('POST', `/entreprises/${d.id}/abonnement/renouvellement`, d.jeton, { renouveler: false })).statut).toBe(200);
    for (const x of [c, d]) {
      await admin.query("insert into plateforme.offre_choisie (entreprise, offre, periodicite, par) select $1, 'essentiel', 'annuel', utilisateur from socle.membre where entreprise = $1 limit 1", [x.id]);
      expect(await facturerLesChoix(ctx, { entreprise: x.id })).toEqual({ choix: 0, emises: 0, refusees: 0 });
      expect(await sesFactures(x)).toEqual([]);
    }
  });
});

describe('ce que le client fait lui-même', () => {
  it('« Ne pas renouveler » puis le reprendre, pendant la période payée ; l\'histoire dit que c\'est le client ; un commercial ne le fait pas', async () => {
    const e = await abonnee('Pressing Hésitant', 2);
    // En essai : rien à ne pas renouveler (la base refuse, et dit pourquoi).
    const essai = await appeler('POST', `/entreprises/${e.id}/abonnement/renouvellement`, e.jeton, { renouveler: false });
    expect([essai.statut, String(essai.corps.motif)]).toEqual([403, expect.stringMatching(/payé qui court/)]);
    await payee(e, plusJours(jour, -10), plusJours(jour, 20));
    const resilie = async () => (await admin.query('select resilie_le::text r from plateforme.abonnement where entreprise = $1', [e.id])).rows[0].r as string | null;
    expect((await appeler('POST', `/entreprises/${e.id}/abonnement/renouvellement`, e.jeton, { renouveler: false })).statut).toBe(200);
    expect(await resilie()).toBe(jour);
    // Toujours actif jusqu'au bout de sa période.
    expect((await appeler('GET', `/entreprises/${e.id}/abonnement/etat`, e.jeton)).corps.etat).toBe('actif');
    expect((await appeler('POST', `/entreprises/${e.id}/abonnement/renouvellement`, e.jeton, { renouveler: false })).corps.motif).toMatch(/déjà plus/);
    expect((await appeler('POST', `/entreprises/${e.id}/abonnement/renouvellement`, e.jeton, { renouveler: true })).statut).toBe(200);
    expect(await resilie()).toBeNull();
    const histoire = (await admin.query("select nature, par from plateforme.evenement_abonnement where entreprise = $1 and nature in ('resilie', 'resiliation_annulee') order by le", [e.id])).rows;
    expect(histoire).toEqual([{ nature: 'resilie', par: 'abonne' }, { nature: 'resiliation_annulee', par: 'abonne' }]);
    // Un commercial de l'entreprise n'y touche pas.
    const email = adresse('karim');
    await appeler('POST', '/inscription', undefined, { email, nom: 'Karim Commercial', motDePasse: MDP });
    const karim = await connecter(email);
    const inv = String((await appeler('POST', `/entreprises/${e.id}/invitations`, e.jeton, { email, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', karim, { jeton: inv })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${e.id}/abonnement/renouvellement`, karim, { renouveler: false })).statut).toBe(403);
    expect(await resilie()).toBeNull();
  });

  it('ne pas renouveler est refusé quand la facture de la période suivante attend son paiement : le refus dit quoi faire', async () => {
    const f = await abonnee('Droguerie Facturée', 2);
    const fin = plusJours(jour, 20);
    await payee(f, plusJours(jour, -10), fin);
    expect((await appeler('POST', `/entreprises/${f.id}/abonnement/choisir`, f.jeton, { offre: 'essentiel', periodicite: 'mensuel' })).statut).toBe(201);
    await attendreLeTour(f);
    expect((await sesFactures(f)).map((x) => x.debut)).toEqual([plusJours(fin, 1)]);
    const r = await appeler('POST', `/entreprises/${f.id}/abonnement/renouvellement`, f.jeton, { renouveler: false });
    expect(r.statut).toBe(403);
    expect(String(r.corps.motif)).toMatch(/attend déjà son paiement.*contact@skanfact\.tn/);
  });

  it('un module ouvert tout de suite : l\'aperçu dit le rattrapage, et la prochaine facture le compte au même millime', async () => {
    const g = await abonnee('Atelier qui Grandit', 2);
    // Payée du 10 jours avant au 20 jours après : 31 jours, dont 21 restent.
    await payee(g, plusJours(jour, -10), plusJours(jour, 20));
    const apercu = await appeler('POST', `/entreprises/${g.id}/abonnement/module`, g.jeton, { module: 'paie', apercu: true });
    expect(apercu.statut, JSON.stringify(apercu.corps)).toBe(200);
    // 15 DT au mois × 21 / 31 = 10,161 (arrondi au millime le plus proche).
    expect(apercu.corps).toMatchObject({ module: 'paie', jours: 21, sur: 31, du: jour, au: plusJours(jour, 20), rattrapageHt: '10.161', prixHt: '15.000', periodicite: 'mensuel' });
    // L'aperçu n'ouvre rien.
    expect((await sonAbonnement(g)).modules).toEqual([]);
    expect((await appeler('POST', `/entreprises/${g.id}/abonnement/module`, g.jeton, { module: 'paie' })).statut).toBe(200);
    expect((await sonAbonnement(g)).modules).toEqual(['paie']);
    expect((await admin.query("select par from plateforme.evenement_abonnement where entreprise = $1 and nature = 'module_ouvert'", [g.id])).rows).toEqual([{ par: 'abonne' }]);
    // Une seconde fois : déjà acheté.
    expect((await appeler('POST', `/entreprises/${g.id}/abonnement/module`, g.jeton, { module: 'paie' })).corps.motif).toMatch(/déjà acheté/);
    // La prochaine facture : 39 (Essentiel) + 15 (la paie) + 10,161 (le rattrapage), par le calcul de la facture.
    expect((await sonAbonnement(g)).prochaine).toMatchObject({ debut: plusJours(jour, 21), montantHt: '64.161' });
  });

  it('sans le paiement de sa période dans l\'histoire, rien à rattraper, et la facture compte pareil ; la facture suivante déjà faite, le module attend', async () => {
    // Payé, mais sans le paiement de la période dans l'histoire (une reprise, un geste d'avant 0097) : la règle de la
    // facture ne rattrape rien ; l'aperçu le dit, au lieu d'annoncer un prix entier pour quelques jours.
    const i = await abonnee('Quincaillerie sans Histoire', 2);
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 40, paye_jusqu_au = $2::date + 10, offre = 'essentiel', periodicite = 'mensuel'
      where entreprise = $1`, [i.id, jour]);
    const apercu = await appeler('POST', `/entreprises/${i.id}/abonnement/module`, i.jeton, { module: 'paie', apercu: true });
    expect(apercu.corps).toMatchObject({ module: 'paie', jours: 0, rattrapageHt: '0.000', prixHt: '15.000' });
    expect((await appeler('POST', `/entreprises/${i.id}/abonnement/module`, i.jeton, { module: 'paie' })).statut).toBe(200);
    expect((await sonAbonnement(i)).prochaine).toMatchObject({ debut: plusJours(jour, 11), montantHt: '54.000' });
    // La facture de la période suivante déjà faite (choisie, émise d'avance) : elle ne compterait pas le module ; il attend.
    const k = await abonnee('Bazar Facturé d\'Avance', 2);
    await payee(k, plusJours(jour, -10), plusJours(jour, 20));
    expect((await appeler('POST', `/entreprises/${k.id}/abonnement/choisir`, k.jeton, { offre: 'essentiel', periodicite: 'mensuel' })).statut).toBe(201);
    await attendreLeTour(k);
    expect(await sesFactures(k)).toHaveLength(1);
    const r = await appeler('POST', `/entreprises/${k.id}/abonnement/module`, k.jeton, { module: 'paie', apercu: true });
    expect([r.statut, String(r.corps.motif)]).toEqual([403, expect.stringMatching(/période suivante est déjà faite.*contact@skanfact\.tn/)]);
  });

  it('chaque offre dit son prix TTC, par le moteur de la facture (TVA et timbre de l\'entreprise SkanFact)', async () => {
    const h = await abonnee('Librairie TTC', 9);
    const prix = (await sonAbonnement(h)).prix as { offre: string; periodicite: string; montantHt: string; net: string | null }[];
    expect(prix.find((p) => p.offre === 'essentiel' && p.periodicite === 'mensuel')).toMatchObject({ montantHt: '39.000', net: '47.410' });
    for (const p of prix) expect(p.net, JSON.stringify(p)).toMatch(/^\d+\.\d{3}$/);
  });
});
