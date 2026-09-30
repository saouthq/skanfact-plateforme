// L'espace client (brique 77 ; docs/espace-client.md ; 14 § 2.1), par l'API. Ce que le serveur garantit :
//   - un lien se donne pour un client du dossier, et pour une pièce ÉMISE de ce client seulement ;
//   - le lien d'une pièce montre elle seule ; le lien du compte, les factures et avoirs émis de CE client
//     — jamais un brouillon, jamais le client d'à côté — avec ce que chaque facture doit encore (ses
//     avoirs et ses paiements retranchés, le même chiffre que la liste des ventes) ;
//   - ne part que ce qu'une pièce imprime (des listes fermées) : ni le prix de revient d'une ligne, ni
//     les paiements, les e-mails, les relances, l'affaire, ni ce que la fiche société ou la fiche client
//     gardent pour elles ; et une pièce ainsi réduite s'imprime EXACTEMENT comme la pièce entière ;
//   - un ticket de caisse n'est pas de l'espace client ;
//   - chaque ouverture se compte (« vue le … ») ; un lien retiré ne s'ouvre plus.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { CHAMPS_SOCIETE, nettoyerClient, nettoyerPiece, nettoyerSociete } from '../../serveur/ventes/espace.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
let n = 0;
// Une personne, son entreprise d'essai (trois clients d'exemple) et le code du téléphone en place.
async function essai() {
  const email = `espace-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Espace ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const lire = async () => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const envoyer = (changements: unknown[]) => appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
  return { jeton, ent, lire, envoyer };
}
// Une facture v10 en brouillon, avec ce que l'entreprise garde pour elle (le prix de revient et
// l'article d'une ligne, l'affaire, une pièce jointe, une relance, un e-mail envoyé, l'abonnement).
const brouillon = (id: string, clientId: string) => ({
  id, type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId, subject: 'Mobilier', reference: 'BC-4471', status: 'brouillon',
  lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, unitCost: 300, itemId: 'art-7', vatRate: 19 }],
  discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
  projectId: 'affaire-secrete', attachments: [{ id: 'pj1', nom: 'bon-de-commande.pdf' }], reminders: [{ date: '2026-10-20', note: 'relancer fermement' }],
  emails: [{ a: 'achats@menuiserie.tn', le: '2026-10-01' }], recurringId: 'abonnement-3', createdAt: 1790000000000,
});
const avoir = (id: string, clientId: string, creditOf: string) => ({
  id, type: 'avoir', number: '', date: '2026-10-10', clientId, creditOf, creditReason: 'Une table rendue', status: 'brouillon',
  lines: [{ label: 'Table en chêne massif', description: '', qty: 1, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
  discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
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

describe('l\'espace client', () => {
  it('le lien d\'une pièce et celui du compte : ses pièces émises seulement, ce qu\'il en doit, rien de ce qui reste dans l\'entreprise ; retiré, il ne s\'ouvre plus', async () => {
    const e = await essai();
    const objets = await e.lire();
    const clients = objets.filter((o) => o.collection === 'clients');
    const menuiserie = clients.find((c) => String(c.contenu.name).startsWith('Menuiserie'));
    const atelier = clients.find((c) => String(c.contenu.name).startsWith('Atelier'));
    if (!menuiserie || !atelier) throw new Error('clients d\'exemple absents');
    // La fiche société et la fiche client gardent chacune un secret.
    const societe = objets.find((o) => o.collection === '_racine' && o.cle === 'company');
    await e.envoyer([
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, accountantEmail: 'comptable@cabinet.tn', revenueTarget: 500000, rib: '08 000 0001234567890 12' } },
      { collection: 'clients', cle: menuiserie.cle, rang: menuiserie.rang, revision: menuiserie.revision, contenu: { ...menuiserie.contenu, notes: 'paie toujours en retard', creditLimit: 2000 } },
    ]);
    const emettre = async (doc: Record<string, unknown>, route: string, netAPayer: string, rang: number) => {
      const client = (await e.lire()).find((o) => o.collection === 'clients' && o.cle === doc.clientId);
      await e.envoyer([{ collection: 'documents', cle: String(doc.id), rang, revision: null, contenu: doc }]);
      const r = await appeler('POST', `/entreprises/${e.ent}/dossier-v10/${route}`, e.jeton, { document: doc, client: client?.contenu, revision: 1, rang, netAPayer });
      if (r.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(r.corps)}`);
      return r.corps as { contenu: Record<string, unknown>; revision: number };
    };
    // f1 pour la Menuiserie (1 073,190), un avoir d'une table (536,095), un paiement de 200 ; f2 pour
    // l'Atelier ; f3, un brouillon de la Menuiserie ; f4, un ticket de caisse de la Menuiserie.
    const f1 = await emettre(brouillon('f1', menuiserie.cle), 'emettre', '1073.190', 0);
    await e.envoyer([{ collection: 'documents', cle: 'f1', rang: 0, revision: f1.revision, contenu: { ...f1.contenu, payments: [{ id: 'p1', date: '2026-10-05', amount: 200, method: 'virement', reference: 'VIR-77', accountId: 'banque-zitouna', note: 'client pénible' }] } }]);
    await emettre(avoir('a1', menuiserie.cle, 'f1'), 'emettre-avoir', '536.095', 1);
    await emettre(brouillon('f2', atelier.cle), 'emettre', '1073.190', 2);
    await e.envoyer([{ collection: 'documents', cle: 'f3', rang: 3, revision: null, contenu: brouillon('f3', menuiserie.cle) }]);
    await emettre({ ...brouillon('f4', menuiserie.cle), ticket: true }, 'emettre', '1073.190', 4);
    // Le brouillon f3, s'il était aussi une pièce du serveur (pas encore émise) : il reste un brouillon.
    const tiers = String((await admin.query('select id from socle.tiers where entreprise = $1 and ref_v10 = $2', [e.ent, menuiserie.cle])).rows[0].id);
    const aEmettre = await appeler('POST', `/entreprises/${e.ent}/ventes`, e.jeton, { type: 'facture', tiers, datePiece: '2026-10-02',
      lignes: [{ designation: 'Chaise', quantite: '1', prixUnitaire: '80', tauxTva: '19' }] });
    expect((await admin.query('update ventes.piece set ref_v10 = $2 where id = $1 and statut = \'brouillon\'', [aEmettre.corps.id, 'f3'])).rowCount).toBe(1);

    // Donner un lien : pour un client du dossier, et une pièce émise de CE client.
    const donner = (corps: unknown) => appeler('POST', `/entreprises/${e.ent}/espace/liens`, e.jeton, corps);
    expect((await donner({ client: 'inconnu' })).statut).toBe(404);
    expect(await donner({ client: menuiserie.cle, piece: 'f3' })).toMatchObject({ statut: 409, corps: { motif: 'Seule une facture ou un avoir émis se partage avec le client : émets la pièce d\'abord.' } });
    expect((await donner({ client: menuiserie.cle, piece: 'f2' })).statut).toBe(409);
    expect((await donner({ client: menuiserie.cle, piece: 'f4' })).statut).toBe(409);
    const dePiece = await donner({ client: menuiserie.cle, piece: 'f1' });
    expect(dePiece).toMatchObject({ statut: 201, corps: { adresse: `/espace/#${String(dePiece.corps.jeton)}` } });
    const duCompte = await donner({ client: menuiserie.cle });
    // La base ne garde que l'empreinte du jeton.
    const gardes = (await admin.query('select jeton_empreinte from ventes.lien where entreprise = $1', [e.ent])).rows.map((r) => r.jeton_empreinte as string);
    expect(gardes).not.toContain(dePiece.corps.jeton);

    const ouvrir = (jeton: unknown) => appeler('POST', '/espace', undefined, { jeton });
    type Vue = {
      lien: string; entreprise: Record<string, unknown>; client: Record<string, unknown>; totaux: { devise: string; du: string }[];
      pieces: { type: string; numero: string; net: string; paye: string | null; credite: string | null; reste: string | null; statut: string | null; document: Record<string, unknown> }[];
    };
    // Le lien d'une pièce : elle seule, ce qu'elle doit encore (1 073,190 − 536,095 − 200 = 337,095).
    const piece = (await ouvrir(dePiece.corps.jeton)).corps as Vue;
    expect(piece.lien).toBe('piece');
    expect(piece.pieces.map((p) => [p.type, p.numero, p.net, p.paye, p.credite, p.reste, p.statut])).toEqual([['facture', 'FAC-2026-001', '1073.190', '200.000', '536.095', '337.095', 'partielle']]);
    // Le lien du compte : ses factures et avoirs émis, jamais le brouillon, le ticket de caisse ni la
    // facture de l'Atelier ; ce qu'il doit en tout.
    const compte = (await ouvrir(duCompte.corps.jeton)).corps as Vue;
    expect(compte.lien).toBe('compte');
    expect(compte.pieces.map((p) => [p.type, p.numero, p.reste])).toEqual([['avoir', 'AVO-2026-001', null], ['facture', 'FAC-2026-001', '337.095']]);
    expect(compte.totaux).toEqual([{ devise: 'TND', du: '337.095' }]);
    // Le même chiffre que la liste des ventes de l'entreprise.
    const ventes = (await appeler('GET', `/entreprises/${e.ent}/ventes`, e.jeton)).corps.lignes as { numero: string; reste: string }[];
    expect(ventes.find((v) => v.numero === 'FAC-2026-001')?.reste).toBe('337.095');

    // Ne part que ce que la pièce imprime (le prix de revient, l'article, les paiements, l'affaire, les
    // pièces jointes, les relances, les e-mails et l'abonnement restent dans l'entreprise).
    const f = compte.pieces.find((p) => p.type === 'facture')?.document ?? {};
    expect(Object.keys(f).sort()).toEqual(['applyStamp', 'currency', 'date', 'discountRate', 'dueDate', 'exchangeRate', 'lines', 'number', 'reference', 'stampFee', 'status', 'subject', 'type', 'withholdingRate']);
    expect(Object.keys((f.lines as Record<string, unknown>[])[0] ?? {}).sort()).toEqual(['description', 'label', 'qty', 'unit', 'unitPrice', 'vatRate']);
    expect(compte.entreprise).toMatchObject({ rib: '08 000 0001234567890 12' });
    expect(Object.keys(compte.entreprise).filter((k) => !(CHAMPS_SOCIETE as readonly string[]).includes(k))).toEqual([]);
    expect(compte.client).toMatchObject({ name: menuiserie.contenu.name });
    expect(Object.keys(compte.client).filter((k) => !['name', 'matricule', 'address', 'email', 'phone', 'contact'].includes(k))).toEqual([]);

    // Chaque ouverture se compte ; un lien retiré ne s'ouvre plus.
    const liens = async () => (await appeler('GET', `/entreprises/${e.ent}/espace/liens?client=${menuiserie.cle}`, e.jeton)).corps.liens as { id: string; piece: string | null; vues: number; vuLe: string | null; retireLe: string | null }[];
    expect((await liens()).map((l) => [l.piece, l.vues, !!l.vuLe])).toEqual([[null, 1, true], ['f1', 1, true]]);
    expect((await appeler('DELETE', `/entreprises/${e.ent}/espace/liens/${String(dePiece.corps.id)}`, e.jeton)).statut).toBe(200);
    expect(await ouvrir(dePiece.corps.jeton)).toEqual({ statut: 404, corps: { motif: 'Ce lien n\'est plus valable : demande un nouveau lien à l\'entreprise qui te l\'a envoyé.' } });
    expect((await liens()).find((l) => l.piece === 'f1')?.retireLe).not.toBe(null);
    expect((await ouvrir(duCompte.corps.jeton)).statut).toBe(200);
    // Donner et retirer un lien s'inscrivent dans l'historique de l'entreprise.
    const traces = (await admin.query("select geste, objet_id from socle.audit where entreprise = $1 and geste like 'ventes.lien.%' order by id", [e.ent])).rows;
    expect(traces).toEqual([
      { geste: 'ventes.lien.partager', objet_id: dePiece.corps.id }, { geste: 'ventes.lien.partager', objet_id: duCompte.corps.id },
      { geste: 'ventes.lien.retirer', objet_id: dePiece.corps.id },
    ]);
    // Un jeton inventé : rien.
    expect((await ouvrir('un-jeton-invente-de-toutes-pieces')).statut).toBe(404);
  });

  // Deux chemins, un document : le gabarit d'impression de la v10, sur la pièce entière (ce que
  // l'entreprise imprime) et sur la pièce réduite (ce que le client reçoit). Chaque champ imprimé est
  // présent, avec une valeur qui se voit : un champ oublié dans les listes fermées change le document.
  it('une pièce réduite à ce qu\'elle imprime s\'imprime exactement comme la pièce entière', () => {
    const C = ecranDeLaPlateforme('core.js') as { documentHtml: (d: unknown, c: unknown, s: unknown, o: unknown) => string };
    const societe = {
      name: 'Atelier Ben Salah', matricule: '1234567/A/M/000', rc: 'B0123452026', capital: '20000', address: '12 rue de Marseille\n1000 Tunis',
      phone: '+216 71 000 000', email: 'contact@atelier.tn', website: 'atelier.tn', rib: '08 000 0001234567890 12', bank: 'Banque de Tunisie',
      logo: 'data:image/png;base64,iVBORw0KGgo=', footer: 'Merci de votre confiance', tagline: 'Mobilier sur mesure', stampImage: 'data:image/png;base64,AAAA',
      stampFee: 1.2, primaryColor: '#123456', accentColor: '#b3541e', currency: 'DT', defaultLang: 'en', paymentTerms: 'Paiement à 30 jours',
      paymentTermsEn: 'Payment within 30 days', activity: 'artisanat', taxRegime: 'forfaitaire',
      // Ce que la fiche garde pour elle.
      accountantEmail: 'comptable@cabinet.tn', revenueTarget: 500000, counters: { 'facture-2026': 12 }, exonerationsRS: [{ id: 'x', numero: 'EXO-9', du: '2026-01-01', au: '2026-12-31' }],
    };
    const client = { id: 'c1', name: 'Menuiserie du Lac', matricule: '7654321/B/M/000', rc: 'C77', address: 'Route de la Marsa\n2078 La Marsa', email: 'achats@menuiserie.tn',
      phone: '+216 98 000 000', contact: 'Mme Trabelsi', lang: 'fr', currency: 'DT', notes: 'paie toujours en retard', creditLimit: 2000 };
    const secrets = {
      id: 'f1', clientId: 'c1', projectId: 'affaire', attachments: [{ id: 'pj' }], reminders: [{ date: '2026-10-20' }], emails: [{ a: 'x@y.tn' }],
      payments: [{ id: 'p1', date: '2026-10-05', amount: 200, method: 'virement', reference: 'VIR', accountId: 'banque', note: 'n' }], caisse: { poste: 1 },
      recurringId: 'r1', createdAt: 1790000000000, issuedTs: 1790000000000, withholdingCertificate: true, fromQuoteId: 'q1', fromDocId: 'd1', fromDocType: 'devis',
    };
    const lignes = [
      { label: 'Table en chêne', description: 'Plateau massif\nFinition huilée', qty: 2.5, unit: 'm²', unitPrice: 450.5, vatRate: 19, unitCost: 300, itemId: 'art-7' },
      { label: 'Livraison', description: '', qty: 1, unit: '', unitPrice: 35, vatRate: 7, unitCost: 10 },
      { label: 'Acompte déjà facturé', description: '', qty: 1, unit: '', unitPrice: -100, vatRate: 19, noDiscount: true },
    ];
    const facture = { ...secrets, type: 'facture', number: 'FAC-2026-012', date: '2026-10-01', dueDate: '2026-10-31', status: 'envoyée', lang: 'fr', currency: 'DT', exchangeRate: '',
      subject: 'Mobilier du salon', reference: 'BC-4471', notes: 'Livraison comprise\nGarantie deux ans', lines: lignes, discountRate: 10, applyStamp: true, stampFee: 1,
      withholdingRate: 1.5, regimeTva: 'reel', exonerationRS: null, deposit: { percent: 30, quoteId: 'q1', quoteNumber: 'DEV-2026-004' } };
    const pieces = [
      facture,
      // En euros, en anglais, à réception, le solde d'un devis, une exonération de retenue figée.
      { ...facture, lang: 'en', currency: 'EUR', exchangeRate: 3.35, dueDate: '2026-10-01', deposit: undefined, withholdingRate: 0,
        settles: { quoteId: 'q1', quoteNumber: 'DEV-2026-004', depositIds: ['f0'] }, fromQuoteNumber: 'DEV-2026-004', exonerationRS: { numero: 'EXO-12', du: '2026-01-01', au: '2026-12-31' } },
      // Sans langue (celle de la société), sans timbre figé (celui de la société), un acompte en montant ; émise au
      // réel avec des lignes à 0 % (la société est passée au forfait depuis : la pièce garde sa colonne TVA).
      { ...facture, lang: undefined, stampFee: undefined, regimeTva: 'reel', lines: lignes.map((l) => ({ ...l, vatRate: 0 })), deposit: { montant: 150, quoteNumber: 'DEV-2026-005' } },
      { ...facture, deposit: undefined, fromQuoteNumber: 'DEV-2026-006' },
      { ...secrets, type: 'avoir', number: 'AVO-2026-003', date: '2026-10-10', status: 'émis', lang: 'fr', currency: 'DT', exchangeRate: '', creditOfNumber: 'FAC-2026-012',
        creditReason: 'Une table rendue', reference: 'RET-8', notes: 'Remboursé par virement', lines: [{ ...lignes[0], vatRate: 0 }], discountRate: 0, applyStamp: true, stampFee: 1, withholdingRate: 0 },
    ];
    let compares = 0;
    for (const s of [societe, { ...societe, activity: 'juridique' }]) {
      for (const p of pieces) {
        for (const o of [{ preview: true, zoom: 0.8 }, { stampText: 'Payée' }, {}]) {
          expect(C.documentHtml(nettoyerPiece(p), nettoyerClient(client), nettoyerSociete(s), o)).toBe(C.documentHtml(p, client, s, o));
          compares++;
        }
      }
    }
    expect(compares).toBe(30);
    // Et ce qui reste dans l'entreprise n'est plus là.
    for (const cle of Object.keys(secrets)) expect(nettoyerPiece(facture)).not.toHaveProperty(cle);
    expect(nettoyerPiece(facture).deposit).toEqual({ percent: 30, quoteNumber: 'DEV-2026-004' });
    expect(Object.keys((nettoyerPiece(facture).lines as Record<string, unknown>[])[0] ?? {}).sort()).toEqual(['description', 'label', 'qty', 'unit', 'unitPrice', 'vatRate']);
    for (const cle of ['accountantEmail', 'revenueTarget', 'counters', 'exonerationsRS']) expect(nettoyerSociete(societe)).not.toHaveProperty(cle);
    for (const cle of ['id', 'rc', 'lang', 'currency', 'notes', 'creditLimit']) expect(nettoyerClient(client)).not.toHaveProperty(cle);
  });
});
