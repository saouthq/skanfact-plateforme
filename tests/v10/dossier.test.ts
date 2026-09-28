// Le dossier v10 tenu par le serveur (0011 ; décision de Skander, 28/09/2026 : la plateforme reprend
// le CODE de l'interface v10 et ne change que son branchement). Ce que le serveur garantit, quel que
// soit ce que l'interface lui envoie :
//   - le premier chargement naît de ce que le serveur sait (la fiche, les clients) ;
//   - un objet changé ailleurs n'est jamais écrasé, et un envoi refusé n'écrit RIEN ;
//   - jamais un nombre à virgule en base ;
//   - une facture ne devient émise que par le serveur, avec son numéro, au millime de l'écran ;
//   - une facture émise ne change plus ce qui a été scellé, et ne s'efface pas, ni ne s'annule ;
//   - un avoir s'émet par le serveur, lié à sa facture (0012) ;
//   - les règlements d'une facture émise sont tenus par le serveur, avec leur trace (0012).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { controler } from '../../serveur/journal.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { relirePourChaine } from '../../serveur/ventes/pieces.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
let n = 0;
// Une personne, son entreprise d'essai (trois clients d'exemple) et le code du téléphone en place.
async function essai() {
  const email = `dossier-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Dossier ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const envoyer = (changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  return { jeton, ent, lire, envoyer };
}
// Une facture v10 en brouillon, telle que l'éditeur de la v10 l'écrit (nombres non entiers en texte exact).
const brouillon = (id: string, clientId: string) => ({
  id, type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId, subject: 'Mobilier', status: 'brouillon',
  lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
  discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
});

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('le dossier v10 tenu par le serveur', () => {
  it('le premier chargement naît de la fiche de l\'entreprise et de ses clients, dans leur ordre ; le suivant relit la même chose', async () => {
    const e = await essai();
    const objets = await e.lire();
    expect(objets.find((o) => o.collection === '_racine' && o.cle === 'company')?.contenu).toMatchObject({ name: expect.stringMatching(/^Entreprise d'essai de Dossier/) });
    const clients = objets.filter((o) => o.collection === 'clients');
    expect(clients.map((c) => c.contenu.name).sort()).toEqual(['Amel Ben Salah (exemple)', 'Atelier Lumière (exemple)', 'Menuiserie du Lac (exemple)']);
    expect(clients.map((c) => c.rang)).toEqual([0, 1, 2]);
    // Un client amorcé porte l'identifiant de sa fiche du serveur, qui le reconnaît.
    const lies = (await admin.query('select count(*)::int n from socle.tiers where entreprise = $1 and ref_v10 = id::text', [e.ent])).rows[0].n;
    expect(lies).toBe(3);
    expect(await e.lire()).toEqual(objets);
  });

  it('un objet changé ailleurs n\'est jamais écrasé, et un envoi refusé n\'écrit rien, pas même ses autres objets', async () => {
    const e = await essai();
    expect((await e.envoyer([{ collection: 'catalog', cle: 'a1', rang: 0, revision: null, contenu: { id: 'a1', label: 'Pose', unitPrice: 85 } }])).statut).toBe(200);
    expect((await e.envoyer([{ collection: 'catalog', cle: 'a1', rang: 0, revision: 1, contenu: { id: 'a1', label: 'Pose et réglage', unitPrice: 90 } }])).statut).toBe(200);
    // Un second poste, resté sur la révision 1, écrit l'article ET un nouvel objet : tout est refusé.
    const refus = await e.envoyer([
      { collection: 'catalog', cle: 'b2', rang: 1, revision: null, contenu: { id: 'b2', label: 'Livraison', unitPrice: 30 } },
      { collection: 'catalog', cle: 'a1', rang: 0, revision: 1, contenu: { id: 'a1', label: 'Pose (ancienne)', unitPrice: 85 } },
    ]);
    expect(refus).toMatchObject({ statut: 409, corps: { bouton: 'recharger' } });
    const catalogue = (await e.lire()).filter((o) => o.collection === 'catalog');
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]).toMatchObject({ revision: 2, contenu: { label: 'Pose et réglage', unitPrice: 90 } });
  });

  it('jamais un nombre à virgule en base : il arrive en texte exact, ou il est refusé', async () => {
    const e = await essai();
    expect((await e.envoyer([{ collection: 'catalog', cle: 'c3', rang: 0, revision: null, contenu: { id: 'c3', unitPrice: 12.5 } }])).statut).toBe(400);
    expect((await e.envoyer([{ collection: 'catalog', cle: 'c3', rang: 0, revision: null, contenu: { id: 'c3', unitPrice: { '~n': '12.5' } } }])).statut).toBe(200);
    // Et la base elle-même le refuse, même si un chemin oubliait la vérification de la route.
    await expect(admin.query(`insert into socle.dossier_v10 (entreprise, collection, cle, contenu) values ($1, 'catalog', 'd4', '{"prix": 2.5}')`, [e.ent]))
      .rejects.toThrow(/dossier_v10_contenu_check/);
  });

  it('une facture ou un avoir ne devient émis que par le serveur', async () => {
    const e = await essai();
    const client = (await e.lire()).find((o) => o.collection === 'clients')?.cle ?? '';
    const motif = 'Une facture ou un avoir ne s\'émet qu\'avec le bouton « Émettre » : c\'est le serveur qui lui donne son numéro.';
    const faux = { ...brouillon('f1', client), number: 'FAC-2026-001', status: 'envoyée' };
    expect(await e.envoyer([{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: faux }])).toMatchObject({ statut: 403, corps: { motif } });
    const avoir = { ...brouillon('a1', client), type: 'avoir', number: 'AVO-2026-001', status: 'émis' };
    expect((await e.envoyer([{ collection: 'documents', cle: 'a1', rang: 0, revision: null, contenu: avoir }])).corps.motif).toBe(motif);
    expect((await e.lire()).filter((o) => o.collection === 'documents')).toEqual([]);
  });

  it('l\'émission : le numéro du serveur, le net à payer de l\'écran au millime, la fiche du client, la chaîne ; un écart n\'émet rien et ne prend aucun numéro', async () => {
    const e = await essai();
    const objets = await e.lire();
    const client = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!client) throw new Error('client d\'exemple absent');
    // Le client a changé de nom dans l'application : c'est ce nom que la facture emporte.
    const renomme = { ...client.contenu, name: 'Menuiserie du Lac SARL' };
    await e.envoyer([{ collection: 'clients', cle: client.cle, rang: client.rang, revision: client.revision, contenu: renomme },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: brouillon('f1', client.cle) }]);
    const emettre = (netAPayer: string, revision: number | null) => appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton,
      { document: brouillon('f1', client.cle), client: renomme, revision, rang: 0, netAPayer });
    // 2 × 450,500 = 901,000 ; TVA 19 % = 171,190 ; timbre 1,000 → 1 073,190. L'écran annonce 1 073,19 : écart d'un arrondi ? Non,
    // un autre chiffre (1 073,180) : refusé, rien d'émis, aucun numéro pris.
    const ecart = await emettre('1073.180', 1);
    expect(ecart).toMatchObject({ statut: 403 });
    expect(String(ecart.corps.motif)).toContain('1073.180 à l\'écran, 1073.190 au serveur');
    expect((await admin.query('select count(*)::int n from ventes.piece where entreprise = $1', [e.ent])).rows[0].n).toBe(0);
    const ok = await emettre('1073.190', 1);
    expect(ok).toMatchObject({ statut: 200, corps: { numero: 'FAC-2026-001', revision: 2, contenu: { number: 'FAC-2026-001', status: 'envoyée', stampFee: 1 } } });
    const piece = (await admin.query('select id, statut, numero_texte, net_a_payer, ref_v10, copie from ventes.piece where entreprise = $1', [e.ent])).rows[0];
    expect(piece).toMatchObject({ statut: 'emise', numero_texte: 'FAC-2026-001', net_a_payer: 1073190n, ref_v10: 'f1', copie: { client: { raisonSociale: 'Menuiserie du Lac SARL' } } });
    const stocke = (await e.lire()).find((o) => o.collection === 'documents' && o.cle === 'f1');
    expect(stocke).toMatchObject({ revision: 2, contenu: { number: 'FAC-2026-001', status: 'envoyée' } });
    const serie = (await admin.query(`select id from socle.serie where entreprise = $1 and prefixe = 'FAC'`, [e.ent])).rows[0].id as string;
    expect(await enTantQue(pool, (await admin.query('select utilisateur from socle.membre where entreprise = $1', [e.ent])).rows[0].utilisateur,
      (tx) => controler(tx, e.ent, `serie:${serie}`, (o) => relirePourChaine(tx, e.ent, o.id)))).toEqual({ ok: true });
    // Une seconde émission de la même pièce est refusée : jamais deux numéros pour une facture.
    expect((await emettre('1073.190', 2)).statut).toBe(403);
    expect((await admin.query('select count(*)::int n from ventes.piece where entreprise = $1 and statut = $2', [e.ent, 'emise'])).rows[0].n).toBe(1);
  });

  it('une facture émise ne change plus ce qui a été scellé et ne s\'efface pas ; ses règlements et son heure d\'émission, oui', async () => {
    const e = await essai();
    const client = (await e.lire()).find((o) => o.collection === 'clients');
    if (!client) throw new Error('client d\'exemple absent');
    await e.envoyer([{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: brouillon('f1', client.cle) }]);
    const r = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: brouillon('f1', client.cle), client: client.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
    const emise = r.corps.contenu as Record<string, unknown>;
    const changer = (contenu: unknown, revision = 2) => e.envoyer([{ collection: 'documents', cle: 'f1', rang: 0, revision, contenu }]);
    // Les lignes, le client, la date : scellés. Même l'ordre des champs d'une ligne, rangés autrement par
    // la base, ne compte pas : seul le contenu compte.
    expect((await changer({ ...emise, lines: [{ label: 'Table en chêne massif', qty: 3, unitPrice: { '~n': '450.5' }, vatRate: 19, description: '', unit: '' }] })).corps.motif)
      .toBe('La facture FAC-2026-001 est émise : elle ne se modifie plus, on la corrige par un avoir.');
    expect((await changer({ ...emise, date: '2026-10-02' })).statut).toBe(403);
    expect((await changer(null)).corps.motif).toBe('La facture FAC-2026-001 est émise : elle ne s\'efface jamais, on la corrige par un avoir.');
    const lignesRangees = (emise.lines as Record<string, unknown>[]).map((l) => Object.fromEntries(Object.entries(l).reverse()));
    expect((await changer({ ...emise, lines: lignesRangees, issuedTs: 1790628906757, payments: [{ id: 'p1', date: '2026-10-05', amount: { '~n': '500.5' } }] })).statut).toBe(200);
    expect((await e.lire()).find((o) => o.cle === 'f1')?.contenu).toMatchObject({ number: 'FAC-2026-001', payments: [{ id: 'p1' }] });
    // Elle ne s'annule pas non plus : un avoir la corrige (01 § 7).
    expect((await changer({ ...emise, status: 'annulée' }, 3)).corps.motif)
      .toBe('La facture FAC-2026-001 est émise : elle ne s\'annule pas, on la corrige par un avoir (un avoir total la solde).');
  });

  // Une facture émise par le serveur, telle que le parcours de l'interface la laisse.
  async function factureEmise(e: Awaited<ReturnType<typeof essai>>, cle: string, doc: Record<string, unknown>, netAPayer: string) {
    const client = (await e.lire()).find((o) => o.collection === 'clients' && o.cle === doc.clientId);
    await e.envoyer([{ collection: 'documents', cle, rang: 0, revision: null, contenu: doc }]);
    const r = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: doc, client: client?.contenu, revision: 1, rang: 0, netAPayer });
    if (r.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(r.corps)}`);
    const piece = String((await admin.query('select id from ventes.piece where entreprise = $1 and ref_v10 = $2', [e.ent, cle])).rows[0].id);
    return { contenu: r.corps.contenu as Record<string, unknown>, revision: Number(r.corps.revision), piece };
  }
  const avoirDe = (id: string, clientId: string, creditOf: string | undefined, lignes = [{ label: 'Table en chêne massif', description: '', qty: 1, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }]) => ({
    id, type: 'avoir', number: '', date: '2026-10-10', clientId, ...(creditOf ? { creditOf } : {}), creditReason: 'Une table rendue', status: 'brouillon',
    lines: lignes, discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
  });

  it('l\'avoir s\'émet par le serveur : série AVO, lié à sa facture et scellé avec elle ; refusé sans facture émise ; seulement par sa route', async () => {
    const e = await essai();
    const client = (await e.lire()).find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!client) throw new Error('client d\'exemple absent');
    const f = await factureEmise(e, 'f1', brouillon('f1', client.cle), '1073.190');
    const emettreAvoir = (doc: Record<string, unknown>, netAPayer: string, route = 'emettre-avoir', revision: number | null = null) =>
      appeler('POST', `/entreprises/${e.ent}/dossier-v10/${route}`, e.jeton, { document: doc, client: client.contenu, revision, rang: 1, netAPayer });
    // 1 × 450,500 ; TVA 19 % : 85,595 ; sans timbre : 536,095.
    expect((await emettreAvoir(avoirDe('a1', client.cle, undefined), '536.095')).corps.motif).toBe('Un avoir corrige une facture : indique laquelle.');
    expect((await emettreAvoir(avoirDe('a1', client.cle, 'f9'), '536.095')).corps.motif).toBe('Un avoir ne corrige qu\'une facture émise.');
    // Un avoir ne passe pas par la route de la facture (dont le geste est ouvert au commercial).
    expect((await emettreAvoir(avoirDe('a1', client.cle, 'f1'), '536.095', 'emettre')).statut).toBe(403);
    expect((await admin.query(`select count(*)::int n from ventes.piece where entreprise = $1 and type = 'avoir'`, [e.ent])).rows[0].n).toBe(0);
    const ok = await emettreAvoir(avoirDe('a1', client.cle, 'f1'), '536.095');
    expect(ok).toMatchObject({ statut: 200, corps: { numero: 'AVO-2026-001', contenu: { number: 'AVO-2026-001', status: 'émis', creditOf: 'f1' } } });
    const avoir = (await admin.query(`select numero_texte, corrige, net_a_payer, statut from ventes.piece where entreprise = $1 and type = 'avoir'`, [e.ent])).rows[0];
    expect(avoir).toEqual({ numero_texte: 'AVO-2026-001', corrige: f.piece, net_a_payer: 536095n, statut: 'emise' });
    // La chaîne de la série des avoirs est intègre, et elle scelle la facture corrigée.
    const serie = (await admin.query(`select id from socle.serie where entreprise = $1 and prefixe = 'AVO' and type = 'avoir'`, [e.ent])).rows[0].id as string;
    const proprietaire = (await admin.query('select utilisateur from socle.membre where entreprise = $1', [e.ent])).rows[0].utilisateur;
    const controle = () => enTantQue(pool, proprietaire, (tx) => controler(tx, e.ent, `serie:${serie}`, (o) => relirePourChaine(tx, e.ent, o.id)));
    expect(await controle()).toEqual({ ok: true });
    // La facture corrigée est scellée avec l'avoir : la changer en contournant la base (ses règles
    // tues, comme le ferait une restauration trafiquée) se voit au contrôle de la chaîne.
    const autre = (await factureEmise(e, 'f2', brouillon('f2', client.cle), '1073.190')).piece;
    const avoirId = (await admin.query(`select id from ventes.piece where entreprise = $1 and type = 'avoir'`, [e.ent])).rows[0].id;
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query('update ventes.piece set corrige = $1 where id = $2', [autre, avoirId]);
    await admin.query('commit');
    expect(await controle()).toMatchObject({ ok: false });
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query('update ventes.piece set corrige = $1 where id = $2', [f.piece, avoirId]);
    await admin.query('commit');
    expect(await controle()).toEqual({ ok: true });
    // Émis, il ne change plus de facture ni de motif, et ne s'efface pas.
    const emis = ok.corps.contenu as Record<string, unknown>;
    const changer = (contenu: unknown) => e.envoyer([{ collection: 'documents', cle: 'a1', rang: 1, revision: 1, contenu }]);
    expect((await changer({ ...emis, creditOf: 'f2' })).corps.motif).toBe('L\'avoir AVO-2026-001 est émis : il ne se modifie plus.');
    expect((await changer({ ...emis, creditReason: 'autre chose' })).statut).toBe(403);
    expect((await changer(null)).corps.motif).toBe('L\'avoir AVO-2026-001 est émis : il ne s\'efface jamais.');
    // La facture lue par l'API : l'avoir la crédite, le reste le dit.
    const lue = (await appeler('GET', `/entreprises/${e.ent}/ventes/${f.piece}`, e.jeton)).corps;
    expect(lue.suivi).toMatchObject({ credite: '536.095', reste: '537.095', statut: 'partielle', avoirs: [{ numero: 'AVO-2026-001', netAPayer: '536.095' }] });
  });

  it('une facture que ses avoirs couvrent en entier se lit « annulée » : c\'est déduit, jamais saisi', async () => {
    const e = await essai();
    const client = (await e.lire()).find((o) => o.collection === 'clients');
    if (!client) throw new Error('client d\'exemple absent');
    const sansTimbre = { ...brouillon('f1', client.cle), applyStamp: false };
    const f = await factureEmise(e, 'f1', sansTimbre, '1072.190');
    const toutes = [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }];
    const r = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre-avoir`, e.jeton, { document: avoirDe('a1', client.cle, 'f1', toutes), client: client.contenu, revision: null, rang: 1, netAPayer: '1072.190' });
    expect(r.statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${e.ent}/ventes/${f.piece}`, e.jeton)).corps.suivi).toMatchObject({ reste: '0.000', statut: 'annulee' });
  });

  it('les règlements d\'une facture émise sont tenus par le serveur : ajoutés, modifiés, retirés, chacun avec sa trace ; la retenue naît à chacun', async () => {
    const e = await essai();
    const client = (await e.lire()).find((o) => o.collection === 'clients');
    if (!client) throw new Error('client d\'exemple absent');
    // Retenue 1,5 % sur 1 072,190 (TTC hors timbre) : 16,083 ; net à payer 1 073,190 − 16,083 = 1 057,107.
    const f = await factureEmise(e, 'f1', { ...brouillon('f1', client.cle), withholdingRate: { '~n': '1.5' } }, '1057.107');
    let revision = f.revision;
    const payer = async (payments: unknown[]) => {
      const r = await e.envoyer([{ collection: 'documents', cle: 'f1', rang: 0, revision, contenu: { ...f.contenu, payments } }]);
      if (r.statut === 200) revision = Number((r.corps.revisions as { revision: number }[])[0]?.revision);
      return r;
    };
    const auServeur = async () => (await admin.query(`select ref_v10, rang, date_reglement, montant, mode, revision from ventes.reglement where entreprise = $1 order by rang`, [e.ent])).rows;
    const trace = async () => (await admin.query(`select geste from socle.audit where entreprise = $1 and geste like 'ventes.reglement.%' order by instant, id`, [e.ent])).rows.map((x) => x.geste);
    const suivi = async () => (await appeler('GET', `/entreprises/${e.ent}/ventes/${f.piece}`, e.jeton)).corps.suivi as Record<string, unknown>;

    const p1 = { id: 'p1', date: '2026-10-05', amount: { '~n': '528.554' }, method: 'virement', reference: 'VIR 17' };
    expect((await payer([p1])).statut).toBe(200);
    expect(await auServeur()).toEqual([{ ref_v10: 'p1', rang: 0, date_reglement: '2026-10-05', montant: 528554n, mode: 'virement', revision: 1n }]);
    // 16 083 × 528 554 / 1 057 107 = 8 041,5… : 8,042 de retenue nées de ce règlement.
    expect(await suivi()).toMatchObject({ paye: '528.554', reste: '528.553', statut: 'partielle', retenueOperee: '8.042', reglements: [{ montant: '528.554', retenue: '8.042' }] });

    // Un second règlement ; puis le premier corrigé (le client avait versé 300,000 de plus).
    const p2 = { id: 'p2', date: '2026-10-20', amount: 300, method: 'cheque' };
    expect((await payer([p1, p2])).statut).toBe(200);
    expect((await suivi()).reglements).toMatchObject([{ retenue: '8.042' }, { retenue: '4.564' }]);
    expect((await payer([{ ...p1, amount: { '~n': '228.554' } }, p2])).statut).toBe(200);
    expect(await auServeur()).toMatchObject([{ ref_v10: 'p1', montant: 228554n, revision: 2n }, { ref_v10: 'p2', montant: 300000n, revision: 1n }]);
    // Le premier retiré : le second prend sa place.
    expect((await payer([p2])).statut).toBe(200);
    expect(await auServeur()).toMatchObject([{ ref_v10: 'p2', rang: 0 }]);
    expect(await trace()).toEqual(['ventes.reglement.enregistrer', 'ventes.reglement.enregistrer', 'ventes.reglement.modifier', 'ventes.reglement.supprimer']);
    // Le règlement qui solde prend le reste de la retenue : 16,083 en tout.
    expect((await payer([p2, { id: 'p3', date: '2026-11-02', amount: { '~n': '757.107' }, method: 'virement' }])).statut).toBe(200);
    expect(await suivi()).toMatchObject({ reste: '0.000', statut: 'payee', retenueOperee: '16.083', retenueDue: '16.083' });

    // Un seul paiement illisible, et rien n'est écrit.
    const avant = await auServeur();
    const refus = async (payments: unknown[]) => (await payer(payments)).corps.motif;
    expect(await refus([p2, { id: 'p4', date: '2026-11-03', amount: 0 }])).toBe('Un paiement de la facture FAC-2026-001 n\'a pas de montant : rien n\'a été enregistré.');
    expect(await refus([p2, { id: 'p4', date: '2026-13-01', amount: 5 }])).toBe('Un paiement de la facture FAC-2026-001 n\'a pas de date valable : rien n\'a été enregistré.');
    expect(await refus([p2, { ...p2 }])).toBe('Deux paiements de la facture FAC-2026-001 portent le même identifiant : rien n\'a été enregistré.');
    expect(await refus([p2, { id: 'p4', date: '2026-11-03', amount: { '~n': '1.2345' } }])).toBe('Un paiement en TND se compte à 3 décimales au plus (1.2345) : rien n\'a été enregistré.');
    expect(await auServeur()).toEqual(avant);
  });

  it('un paiement ne se saisit que sur une facture émise ; la base refuse elle-même un règlement ailleurs', async () => {
    const e = await essai();
    const client = (await e.lire()).find((o) => o.collection === 'clients');
    if (!client) throw new Error('client d\'exemple absent');
    const payeTot = { ...brouillon('f1', client.cle), payments: [{ id: 'p1', date: '2026-10-05', amount: 10 }] };
    expect((await e.envoyer([{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: payeTot }])).corps.motif)
      .toBe('Un paiement ne s\'enregistre que sur une facture émise : émets-la d\'abord.');
    // Un brouillon au serveur : la base refuse qu'un règlement s'y rattache.
    await e.envoyer([{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: brouillon('f1', client.cle) }]);
    const proprietaire = (await admin.query('select utilisateur from socle.membre where entreprise = $1', [e.ent])).rows[0].utilisateur;
    const tiers = (await admin.query('select id from socle.tiers where entreprise = $1 limit 1', [e.ent])).rows[0].id;
    const b = (await admin.query(`insert into ventes.piece (entreprise, type, tiers, date_piece, cree_par) values ($1, 'facture', $2, '2026-10-01', $3) returning id`, [e.ent, tiers, proprietaire])).rows[0].id;
    await expect(admin.query(`insert into ventes.reglement (entreprise, piece, rang, date_reglement, montant, mode, cree_par) values ($1, $2, 0, '2026-10-05', 1000, 'virement', $3)`, [e.ent, b, proprietaire]))
      .rejects.toThrow(/un règlement porte sur une facture émise/);
    // Et un avoir ne corrige qu'une facture de son entreprise.
    await expect(admin.query(`insert into ventes.piece (entreprise, type, tiers, date_piece, cree_par, corrige) values ($1, 'devis', $2, '2026-10-01', $3, $4)`, [e.ent, tiers, proprietaire, b]))
      .rejects.toThrow(/corrige_seulement_avoir/);
  });

  it('les droits : seuls ceux qui voient toute l\'entreprise ouvrent son dossier ; une autre entreprise n\'y lit rien', async () => {
    const e = await essai();
    const autre = await essai();
    // Pour qui n'en est pas membre, l'entreprise n'existe pas (03 D3) : 404, pas 403.
    expect((await appeler('GET', `/entreprises/${e.ent}/dossier-v10`, autre.jeton)).statut).toBe(404);
    // Un commercial de l'entreprise : il émet des factures, mais n'ouvre pas le dossier entier.
    const email = `commercial-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Commercial', motDePasse: 'Un-bon-mot-de-passe' });
    const jc = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await appeler('POST', `/entreprises/${e.ent}/invitations`, e.jeton, { email, roles: ['commercial'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', jc, { jeton: invitation });
    expect((await appeler('GET', `/entreprises/${e.ent}/dossier-v10`, jc)).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${e.ent}/dossier-v10`, jc, { changements: [{ collection: 'catalog', cle: 'x', rang: 0, revision: null, contenu: { id: 'x' } }] })).statut).toBe(403);
  });
});
