// Le dossier v10 tenu par le serveur (0011 ; décision de Skander, 28/09/2026 : la plateforme reprend
// le CODE de l'interface v10 et ne change que son branchement). Ce que le serveur garantit, quel que
// soit ce que l'interface lui envoie :
//   - le premier chargement naît de ce que le serveur sait (la fiche, les clients) ;
//   - un objet changé ailleurs n'est jamais écrasé, et un envoi refusé n'écrit RIEN ;
//   - jamais un nombre à virgule en base ;
//   - une facture ne devient émise que par le serveur, avec son numéro, au millime de l'écran ;
//   - une facture émise ne change plus ce qui a été scellé, et ne s'efface pas.

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

  it('une facture ne devient émise que par le serveur ; un avoir n\'est pas encore branché et le refus le dit', async () => {
    const e = await essai();
    const client = (await e.lire()).find((o) => o.collection === 'clients')?.cle ?? '';
    const faux = { ...brouillon('f1', client), number: 'FAC-2026-001', status: 'envoyée' };
    expect(await e.envoyer([{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: faux }]))
      .toMatchObject({ statut: 403, corps: { motif: 'Une facture ne s\'émet qu\'avec le bouton « Émettre » : c\'est le serveur qui lui donne son numéro.' } });
    const avoir = { ...brouillon('a1', client), type: 'avoir', number: 'AVO-2026-001', status: 'émis' };
    expect((await e.envoyer([{ collection: 'documents', cle: 'a1', rang: 0, revision: null, contenu: avoir }])).corps.motif)
      .toBe('L\'émission d\'un avoir n\'est pas encore branchée sur le serveur : garde-le en brouillon pour l\'instant.');
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
