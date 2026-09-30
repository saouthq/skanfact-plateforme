// Le paiement en ligne (brique 78 ; docs/paiement-en-ligne.md ; 14 § 2.2), par l'API, avec un Konnect
// simulé (tests/konnect-simule.ts). Ce que le serveur garantit :
//   - l'entreprise branche SON compte : la clé se scelle (jamais en clair dans la base, jamais rendue,
//     illisible même pour le compte du serveur) ; le compte de trésorerie « Konnect » naît une fois ;
//   - le client paie le RESTE de sa facture (le chiffre du serveur), sur le portefeuille de l'entreprise ;
//     deux clics ne font pas deux paiements ;
//   - rien ne s'enregistre sur la parole de l'avis ou de la page de retour : la preuve se redemande à
//     Konnect ; prouvé, le règlement s'ajoute à la facture UNE fois, au compte « Konnect » ;
//   - un refus de Konnect se voit chez l'entreprise ; un « payé » qui ne correspond pas (un autre
//     montant) ne s'enregistre pas ;
//   - débranché : plus de « Payer en ligne ».

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { CLE_DU_COFFRE_D_ESSAI, CoffreFaux, ouvrir, sceller } from '../../serveur/coffre.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { demanderPaiement, verifierEnAttente } from '../../serveur/v10/paiement.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { konnectSimule } from '../konnect-simule.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let konnect: Awaited<ReturnType<typeof konnectSimule>>;
let app: FastifyInstance;
let ctx: Contexte;
const ADRESSE = 'https://skanfact.exemple.tn';

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
let n = 0;
// Une personne, son entreprise d'essai, et une facture émise de 1 073,190 à la Menuiserie, déjà payée
// de 200 (il reste 873,190), avec le lien de son compte donné au client.
async function essai() {
  const email = `paiement-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Paiement ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const menuiserie = (await lire()).find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
  if (!menuiserie) throw new Error('client d\'exemple absent');
  const facture = async (id: string, rang: number) => {
    const doc = {
      id, type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
    };
    await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: id, rang, revision: null, contenu: doc }] });
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: menuiserie.contenu, revision: 1, rang, netAPayer: '1073.190' });
    if (r.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(r.corps)}`);
    return r.corps as { contenu: Record<string, unknown>; revision: number; numero: string };
  };
  const f1 = await facture('f1', 0);
  await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: f1.revision,
    contenu: { ...f1.contenu, payments: [{ id: 'p1', date: '2026-10-05', amount: 200, method: 'virement', reference: 'VIR-77' }] } }] });
  const lien = String((await appeler('POST', `/entreprises/${ent}/espace/liens`, jeton, { client: menuiserie.cle })).corps.jeton);
  // Chaque entreprise son portefeuille : les demandes de Konnect se retrouvent par lui.
  const portefeuille = `portefeuille-atelier-${n}`;
  return {
    jeton, ent, lire, facture, lien, portefeuille, menuiserie,
    piece: async (cle: string) => (await lire()).find((o) => o.collection === 'documents' && o.cle === cle),
    payer: (numero = 'FAC-2026-001') => appeler('POST', '/espace/payer', undefined, { jeton: lien, numero }),
    // La dernière demande que Konnect attend pour ce portefeuille.
    enAttente: () => [...konnect.paiements.values()].filter((p) => p.portefeuille === portefeuille && p.statut === 'pending').at(-1),
  };
}
const brancher = (e: { ent: string; jeton: string; portefeuille: string }, cle = 'sk_test_cle-de-l-api-konnect-b3f2') =>
  appeler('PUT', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton, { portefeuille: e.portefeuille, cle });

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  konnect = await konnectSimule();
  ctx = {
    pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
    paiement: { konnect: konnect.base, coffre: CLE_DU_COFFRE_D_ESSAI, adresse: () => ADRESSE },
  };
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await konnect.fermer(); await admin.end(); await pool.end(); });

describe('le paiement en ligne', () => {
  it('le coffre : un scellé ne s\'ouvre qu\'avec sa clé, pour son entreprise, intact', () => {
    const s = sceller(CLE_DU_COFFRE_D_ESSAI, 'entreprise-a', 'sk_live_secret');
    expect(s).not.toContain('sk_live_secret');
    expect(ouvrir(CLE_DU_COFFRE_D_ESSAI, 'entreprise-a', s)).toBe('sk_live_secret');
    expect(() => ouvrir(CLE_DU_COFFRE_D_ESSAI, 'entreprise-b', s)).toThrow(CoffreFaux);
    expect(() => ouvrir(Buffer.alloc(32, 7), 'entreprise-a', s)).toThrow(CoffreFaux);
    const [v, iv, tag, c = ''] = s.split('.');
    expect(() => ouvrir(CLE_DU_COFFRE_D_ESSAI, 'entreprise-a', [v, iv, tag, `${c.slice(0, -2)}AA`].join('.'))).toThrow(CoffreFaux);
    // L'étiquette tronquée à ses 4 premiers octets (vraie, mais courte : 2^32 essais pour en forger une).
    const courte = Buffer.from(tag ?? '', 'base64url').subarray(0, 4).toString('base64url');
    expect(() => ouvrir(CLE_DU_COFFRE_D_ESSAI, 'entreprise-a', [v, iv, courte, c].join('.'))).toThrow(CoffreFaux);
    expect(() => ouvrir(CLE_DU_COFFRE_D_ESSAI, 'entreprise-a', 'v1.a.b')).toThrow(CoffreFaux);
  });

  it('brancher Konnect : la clé scellée, jamais rendue ni lisible par le serveur ; le compte « Konnect » naît une fois', async () => {
    const e = await essai();
    expect((await brancher(e)).statut).toBe(200);
    const vu = await appeler('GET', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton);
    expect(vu.corps.branche).toMatchObject({ prestataire: 'konnect', portefeuille: e.portefeuille, cleFin: 'b3f2', posePar: expect.stringMatching(/^Paiement/) });
    expect(JSON.stringify(vu.corps)).not.toContain('cle-de-l-api');
    // Dans la base, seulement scellée ; et le compte du serveur ne peut pas la lire.
    const garde = String((await admin.query('select cle_scellee from ventes.prestataire where entreprise = $1', [e.ent])).rows[0].cle_scellee);
    expect(garde).not.toContain('cle-de-l-api');
    expect(ouvrir(CLE_DU_COFFRE_D_ESSAI, e.ent, garde)).toBe('sk_test_cle-de-l-api-konnect-b3f2');
    await expect(pool.query('select cle_scellee from ventes.prestataire')).rejects.toMatchObject({ code: '42501' });
    // Le compte de trésorerie « Konnect » : un seul, même si l'on change la clé.
    expect((await brancher(e, 'sk_test_autre-cle-9c1d')).statut).toBe(200);
    const comptes = (await e.lire()).filter((o) => o.collection === 'accounts');
    expect(comptes.map((c) => [c.contenu.name, c.contenu.kind, c.contenu.isDefault])).toEqual([['Konnect — paiement en ligne', 'autre', false]]);
    expect((await appeler('GET', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton)).corps.branche).toMatchObject({ cleFin: '9c1d' });
    // Le coffre du serveur a changé : la clé ne s'ouvre plus. Le client l'apprend sans erreur, et
    // l'entreprise sait quoi faire.
    const reglage = ctx.paiement;
    if (!reglage) throw new Error('paiement non réglé');
    expect(await demanderPaiement({ ...ctx, paiement: { ...reglage, coffre: Buffer.alloc(32, 7) } }, e.lien, 'FAC-2026-001')).toMatchObject({ statut: 502 });
    expect((await appeler('GET', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton)).corps.branche)
      .toMatchObject({ dernierRefus: 'la clé de Konnect ne s\'ouvre plus sur ce serveur : pose-la de nouveau' });
  });

  it('payer le reste d\'une facture : prouvé auprès de Konnect, enregistré une seule fois sur le compte « Konnect »', async () => {
    const e = await essai();
    const espace = async () => (await appeler('POST', '/espace', undefined, { jeton: e.lien })).corps as { pieces: { numero: string; reste: string; statut: string; payable: boolean }[] };
    // Pas encore branché : rien à payer en ligne.
    expect((await espace()).pieces[0]).toMatchObject({ numero: 'FAC-2026-001', reste: '873.190', payable: false });
    expect(await appeler('POST', '/espace/payer', undefined, { jeton: e.lien, numero: 'FAC-2026-001' }))
      .toMatchObject({ statut: 409, corps: { motif: 'Cette entreprise ne propose pas le paiement en ligne : écris-lui pour régler autrement.' } });
    await brancher(e);
    expect((await espace()).pieces[0]?.payable).toBe(true);

    // Payer : la demande part chez Konnect, pour le reste, sur le portefeuille de l'entreprise.
    const r = await appeler('POST', '/espace/payer', undefined, { jeton: e.lien, numero: 'FAC-2026-001' });
    expect(r.statut).toBe(200);
    const [demande, ...autres] = [...konnect.paiements.values()].filter((p) => p.portefeuille === e.portefeuille && p.statut === 'pending');
    expect(autres).toEqual([]);
    if (!demande) throw new Error('aucune demande chez Konnect');
    expect(r.corps.adresse).toMatch(new RegExp(`/payer/${demande.ref}$`));
    const id = String((await admin.query('select id from ventes.paiement_en_ligne where entreprise = $1', [e.ent])).rows[0].id);
    expect(demande).toMatchObject({ montant: 873190, devise: 'TND', commande: id, cle: 'sk_test_cle-de-l-api-konnect-b3f2', avis: `${ADRESSE}/v1/paiements/konnect` });
    expect(demande.succes).toMatch(new RegExp(`^${ADRESSE}/espace/retour\\.html#paiement=${id}&s=[A-Za-z0-9_-]{24}$`));
    const secret = /s=([A-Za-z0-9_-]+)$/.exec(demande.succes)?.[1] ?? '';
    // Deux clics : la même demande.
    expect((await appeler('POST', '/espace/payer', undefined, { jeton: e.lien, numero: 'FAC-2026-001' })).corps.adresse).toBe(r.corps.adresse);
    expect((await admin.query('select count(*)::int n from ventes.paiement_en_ligne where entreprise = $1', [e.ent])).rows[0].n).toBe(1);

    // Ni l'avis ni la page de retour ne suffisent : tant que Konnect ne dit pas « payé », rien.
    await appeler('GET', `/paiements/konnect?payment_ref=${demande.ref}`);
    expect(await appeler('POST', '/espace/paiement', undefined, { paiement: id, s: secret })).toMatchObject({ statut: 200, corps: { etat: 'attente' } });
    expect(((await e.piece('f1'))?.contenu.payments as unknown[]).length).toBe(1);

    // Le client paie (l'avis se perd) : la page de retour redemande, et c'est elle qui enregistre.
    await konnect.payer(demande.ref, { avis: false });
    expect(await appeler('POST', '/espace/paiement', undefined, { paiement: id, s: 'un-secret-invente-0000' })).toMatchObject({ statut: 404 });
    expect(await appeler('POST', '/espace/paiement', undefined, { paiement: id, s: secret }))
      .toMatchObject({ statut: 200, corps: { etat: 'encaisse', numero: 'FAC-2026-001', montant: '873.190', devise: 'TND' } });
    const compte = (await e.lire()).find((o) => o.collection === 'accounts')?.cle;
    const paiements = (await e.piece('f1'))?.contenu.payments as Record<string, unknown>[];
    expect(paiements.slice(1)).toEqual([{
      id: `en-ligne-${id}`, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), amount: { '~n': '873.19' }, method: 'en_ligne',
      reference: `Konnect ${demande.ref}`, accountId: compte, note: '',
    }]);
    // L'avis arrive ensuite (et une deuxième fois) : rien ne se double.
    await appeler('GET', `/paiements/konnect?payment_ref=${demande.ref}`);
    await appeler('POST', `/paiements/konnect?payment_ref=${demande.ref}`);
    expect(((await e.piece('f1'))?.contenu.payments as unknown[]).length).toBe(2);
    expect((await admin.query('select count(*)::int n from ventes.reglement r join ventes.piece p on p.id = r.piece where p.entreprise = $1', [e.ent])).rows[0].n).toBe(2);
    // La facture est payée : le même chiffre partout.
    const ventes = (await appeler('GET', `/entreprises/${e.ent}/ventes`, e.jeton)).corps.lignes as { numero: string; reste: string }[];
    expect(ventes.find((v) => v.numero === 'FAC-2026-001')?.reste).toBe('0.000');
    expect((await espace()).pieces[0]).toMatchObject({ reste: '0.000', statut: 'payee', payable: false });
    expect(await appeler('POST', '/espace/payer', undefined, { jeton: e.lien, numero: 'FAC-2026-001' }))
      .toMatchObject({ statut: 409, corps: { motif: 'Il ne reste rien à payer sur cette facture.' } });
    // Ce que l'entreprise voit, et la trace.
    expect(((await appeler('GET', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton)).corps.demandes as unknown[])[0])
      .toMatchObject({ numero: 'FAC-2026-001', montant: '873.190', statut: 'encaisse', encaisseLe: expect.any(String), motif: null });
    expect((await admin.query("select count(*)::int n from socle.audit where entreprise = $1 and geste = 'ventes.paiement_en_ligne.encaisser' and objet_id = $2", [e.ent, id])).rows[0].n).toBe(1);
  });

  it('un refus de Konnect se voit chez l\'entreprise ; un « payé » d\'un autre montant ne s\'enregistre pas ; débranché, plus de paiement', async () => {
    const e = await essai();
    await brancher(e);
    konnect.refuser(401, 'Invalid API key');
    expect(await appeler('POST', '/espace/payer', undefined, { jeton: e.lien, numero: 'FAC-2026-001' }))
      .toMatchObject({ statut: 502, corps: { motif: 'Le paiement en ligne ne répond pas pour le moment : réessaie dans un instant, ou règle autrement.' } });
    konnect.accepter();
    const vu = (await appeler('GET', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton)).corps as { branche: { dernierRefus: string }; demandes: { statut: string }[] };
    expect(vu.branche.dernierRefus).toBe('Konnect a refusé la demande (réponse 401) : Invalid API key');
    expect(vu.demandes.map((d) => d.statut)).toEqual(['echoue']);

    // Une nouvelle demande (873,190) ; puis l'entreprise encaisse 100 à la main : payer demande le NOUVEAU
    // reste, sans redonner la demande d'avant.
    expect((await e.payer()).statut).toBe(200);
    expect(e.enAttente()?.montant).toBe(873190);
    const f1 = await e.piece('f1');
    if (!f1) throw new Error('facture absente');
    await appeler('POST', `/entreprises/${e.ent}/dossier-v10`, e.jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: f1.revision,
      contenu: { ...f1.contenu, payments: [...(f1.contenu.payments as unknown[]), { id: 'p2', date: '2026-10-06', amount: 100, method: 'especes' }] } }] });
    expect((await e.payer()).statut).toBe(200);
    const demande = e.enAttente();
    if (!demande) throw new Error('aucune demande chez Konnect');
    expect(demande.montant).toBe(773190);
    // Konnect dit « payé », mais pas le bon montant, et l'avis se perd ; le client redemande à payer (moins
    // de 25 minutes après) : la demande ouverte se vérifie d'abord, ne s'enregistre pas, et une NOUVELLE
    // s'ouvre (jamais l'adresse de celle qui a échoué).
    demande.montant = 1000;
    await konnect.payer(demande.ref, { avis: false });
    const encore = await e.payer();
    expect(encore.statut).toBe(200);
    const autre = e.enAttente();
    if (!autre) throw new Error('aucune nouvelle demande chez Konnect');
    expect(autre.ref).not.toBe(demande.ref);
    expect(encore.corps.adresse).toMatch(new RegExp(`/payer/${autre.ref}$`));
    expect(((await e.piece('f1'))?.contenu.payments as unknown[]).length).toBe(2);
    expect(((await appeler('GET', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton)).corps.demandes as unknown[])[1])
      .toMatchObject({ statut: 'echoue', motif: 'Konnect a confirmé 1000 millimes au lieu de 773190 : le paiement n\'est pas enregistré' });
    // Konnect dit « payé » pour une autre commande (l'avis arrive) : rien ne s'enregistre non plus.
    autre.commande = 'une-autre-commande';
    await konnect.payer(autre.ref, { avis: false });
    await appeler('GET', `/paiements/konnect?payment_ref=${autre.ref}`);
    expect(((await e.piece('f1'))?.contenu.payments as unknown[]).length).toBe(2);
    expect(((await appeler('GET', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton)).corps.demandes as unknown[])[0])
      .toMatchObject({ statut: 'echoue', motif: 'Konnect a confirmé le paiement d\'une autre commande : il n\'est pas enregistré' });

    // Une facture en euros ne se paie pas en ligne (le dinar seulement, pour l'instant).
    const doc = {
      id: 'f9', type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: e.menuiserie.cle, subject: 'Export', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'EUR', exchangeRate: { '~n': '3.35' }, payments: [], stampFee: 1,
    };
    await appeler('POST', `/entreprises/${e.ent}/dossier-v10`, e.jeton, { changements: [{ collection: 'documents', cle: 'f9', rang: 9, revision: null, contenu: doc }] });
    const euros = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/emettre`, e.jeton, { document: doc, client: e.menuiserie.contenu, revision: 1, rang: 9, netAPayer: '1072.49' });
    expect(euros.statut).toBe(200);
    const numero = String(euros.corps.numero);
    const vue = (await appeler('POST', '/espace', undefined, { jeton: e.lien })).corps as { pieces: { numero: string; devise: string; reste: string; payable: boolean }[] };
    expect(vue.pieces.find((p) => p.numero === numero)).toMatchObject({ devise: 'EUR', reste: '1072.49', payable: false });
    expect(await e.payer(numero)).toMatchObject({ statut: 409, corps: { motif: 'Le paiement en ligne se fait en dinars : cette facture est dans une autre devise, écris à l\'entreprise pour la régler.' } });

    // Débranché : plus de « Payer en ligne ».
    expect((await appeler('DELETE', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${e.ent}/paiement-en-ligne`, e.jeton)).corps.branche).toBe(null);
    expect((await appeler('POST', '/espace/payer', undefined, { jeton: e.lien, numero: 'FAC-2026-001' })).statut).toBe(409);
  });

  it('le filet : un paiement dont l\'avis s\'est perdu, et dont le client n\'est pas revenu, s\'enregistre quand même ; déjà payé, on ne repaie pas', async () => {
    const e = await essai();
    await brancher(e);
    const f2 = await e.facture('f2', 1);
    // FAC-2026-001 : payée chez Konnect, l'avis perdu, le client parti ; il revient demander à payer.
    expect((await e.payer()).statut).toBe(200);
    const d1 = e.enAttente();
    if (!d1) throw new Error('aucune demande chez Konnect');
    await konnect.payer(d1.ref, { avis: false });
    expect(await e.payer()).toMatchObject({ statut: 409, corps: { motif: 'Il ne reste rien à payer sur cette facture.' } });
    expect(((await e.piece('f1'))?.contenu.payments as unknown[]).length).toBe(2);
    // FAC-2026-002 : une demande ouverte depuis plus de 25 minutes ne se redonne plus (Konnect garde son
    // adresse 30 minutes) : une nouvelle s'ouvre.
    expect((await e.payer(f2.numero)).statut).toBe(200);
    const vieille = e.enAttente();
    const dans30 = await demanderPaiement({ ...ctx, maintenant: () => new Date(Date.now() + 30 * 60_000) }, e.lien, f2.numero);
    expect(dans30 && 'adresse' in dans30 ? dans30.adresse : null).not.toBe(`${konnect.base.replace('/api/v2', '')}/payer/${vieille?.ref}`);
    expect(e.enAttente()?.ref).not.toBe(vieille?.ref);
    // Payée (la première), l'avis perdu, personne ne revient : le filet du serveur l'enregistre, mais pas
    // avant deux minutes (le client a le temps de revenir), et une seule fois.
    const d2 = vieille;
    if (!d2) throw new Error('aucune demande chez Konnect');
    await konnect.payer(d2.ref, { avis: false });
    expect(await verifierEnAttente(ctx)).toBe(0);
    const plusTard = { ...ctx, maintenant: () => new Date(Date.now() + 5 * 60_000) };
    expect(await verifierEnAttente(plusTard)).toBe(1);
    expect(await verifierEnAttente(plusTard)).toBe(0);
    expect(((await e.piece('f2'))?.contenu.payments as Record<string, unknown>[]).map((p) => p.amount)).toEqual([{ '~n': '1073.19' }]);

    // FAC-2026-003 : l'avis et la page de retour (ouverte deux fois) arrivent EN MÊME TEMPS (Konnect lent à
    // répondre : les vérifications se croisent) : un seul règlement, et chaque page dit « payé » (celle qui
    // perd la course trouve le paiement déjà enregistré, elle ne dit pas « en cours »).
    const f3 = await e.facture('f3', 2);
    expect((await e.payer(f3.numero)).statut).toBe(200);
    const d3 = e.enAttente();
    if (!d3) throw new Error('aucune demande chez Konnect');
    await konnect.payer(d3.ref, { avis: false });
    const secret3 = /s=([A-Za-z0-9_-]+)$/.exec(d3.succes)?.[1] ?? '';
    const retour3 = () => appeler('POST', '/espace/paiement', undefined, { paiement: d3.commande, s: secret3 });
    konnect.ralentir(80);
    let pages: Reponse[];
    try {
      [, ...pages] = await Promise.all([appeler('GET', `/paiements/konnect?payment_ref=${d3.ref}`), retour3(), retour3()]);
    } finally {
      konnect.ralentir(0);
    }
    expect(pages.map((p) => p.corps.etat)).toEqual(['encaisse', 'encaisse']);
    expect(((await e.piece('f3'))?.contenu.payments as Record<string, unknown>[]).map((p) => p.amount)).toEqual([{ '~n': '1073.19' }]);
    expect((await admin.query("select count(*)::int n from socle.audit where entreprise = $1 and geste = 'ventes.paiement_en_ligne.encaisser' and objet_id = $2", [e.ent, d3.commande])).rows[0].n).toBe(1);
  });
});
