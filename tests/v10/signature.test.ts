// La signature de la facture électronique (brique 81 ; docs/facture-electronique.md ; vision § 5), par l'API,
// avec un DigiGo simulé (tests/digigo-simule.ts). Ce que le serveur garantit :
//   - l'entreprise désigne son signataire (son identifiant DigiGo) ; sans lui, rien ne se signe, et c'est dit ;
//   - signer ouvre une session DigiGo : un code part sur le téléphone du signataire ; le bon code signe les
//     fichiers TEIF que le serveur a écrits à l'émission, et le fichier signé se garde (jamais réécrit) ;
//   - ce que DigiGo rend est vérifié : la signature enveloppe le fichier envoyé, au caractère près ;
//     sinon rien n'est gardé ;
//   - trois codes faux perdent la demande ; une pièce ne se signe qu'une fois.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { signatureEnveloppe } from '../../serveur/v10/digigo.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { digigoSimule } from '../digigo-simule.ts';
import { v10, type DocV10 } from '../moteur/v10.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let digigo: Awaited<ReturnType<typeof digigoSimule>>;
let ctx: Contexte;
let app: FastifyInstance;
let sansDigigo: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown, a: FastifyInstance = app): Promise<Reponse> {
  const r = await a.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);

let n = 0;
// Une entreprise soumise, trois factures émises à la Menuiserie (leurs fichiers écrits par le serveur).
async function essai() {
  const email = `signature-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Signature ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const ent = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const objets = (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const societe = objets.find((x) => x.collection === '_racine' && x.cle === 'company');
  const menuiserie = objets.find((x) => x.collection === 'clients' && String(x.contenu.name).startsWith('Menuiserie'));
  if (!menuiserie) throw new Error('client d\'exemple absent');
  const client = { ...menuiserie.contenu, matricule: '1234567A/A/M/000' };
  await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
    { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...societe?.contenu, matricule: '7654321B/A/M/000', efacture: true } },
    { collection: 'clients', cle: menuiserie.cle, rang: menuiserie.rang, revision: menuiserie.revision, contenu: client },
  ] });
  for (const [k, id] of ['f1', 'f2', 'f3'].entries()) {
    const d: Record<string, unknown> = {
      id, type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2 + k, unit: '', unitPrice: 450.5, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
    };
    await appeler('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: id, rang: k, revision: null, contenu: enc(d) }] });
    const r = await appeler('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: enc(d), client, revision: 1, rang: k,
      netAPayer: v10.computeTotals(d as DocV10, { currency: 'DT', stampFee: 1 }).netToPay.toFixed(3) });
    if (r.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(r.corps)}`);
  }
  return {
    jeton, ent,
    signataire: (identifiant: string) => appeler('PUT', `/entreprises/${ent}/efacture/signataire`, jeton, { identifiant }),
    demander: (pieces: string[], a?: FastifyInstance) => appeler('POST', `/entreprises/${ent}/efacture/signatures`, jeton, { pieces }, a),
    code: (demande: unknown, code: string) => appeler('POST', `/entreprises/${ent}/efacture/signatures/${String(demande)}/code`, jeton, { code }),
    teif: (cle: string) => appeler('GET', `/entreprises/${ent}/dossier-v10/${cle}/teif`, jeton),
  };
}
// Un code qui n'est pas celui envoyé.
const faux = (vrai: string | undefined) => (vrai === '000000' ? '111111' : '000000');

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  digigo = await digigoSimule();
  const base: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
  ctx = { ...base, efacture: { digigo: digigo.base, cleDigigo: digigo.cleIntegrateur } };
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
  // Un serveur où DigiGo n'est pas branché.
  sansDigigo = creerApp(base, [...routesSocle(base), ...routesVentes(base), ...routesV10(base)]);
  await sansDigigo.ready();
});
afterAll(async () => { await app.close(); await sansDigigo.close(); await digigo.fermer(); await admin.end(); await pool.end(); });

describe('la signature de la facture électronique', () => {
  it('le signataire désigné reçoit un code ; le bon code signe les fichiers du serveur, qui se gardent tels quels', async () => {
    const e = await essai();
    expect((await appeler('GET', `/entreprises/${e.ent}/efacture/signataire`, e.jeton)).corps).toEqual({ signataire: null, branche: true });
    expect(await e.demander(['f1'])).toMatchObject({ statut: 403, corps: { motif: 'Personne n\'est désigné pour signer : pose l\'identifiant DigiGo du signataire dans Paramètres → Documents.', bouton: 'efacture.signataire' } });
    expect((await e.signataire('09876543')).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${e.ent}/efacture/signataire`, e.jeton)).corps.signataire).toMatchObject({ identifiant: '09876543', posePar: expect.stringMatching(/^Signature/) });

    // Deux factures : un code part sur le téléphone du titulaire.
    const d = await e.demander(['f1', 'f2']);
    expect(d).toMatchObject({ statut: 201, corps: { titulaire: 'Nadia Ben Salah', pieces: 2 } });
    const vrai = digigo.codeDe('09876543');
    expect(await e.code(d.corps.id, faux(vrai))).toMatchObject({ statut: 409, corps: { motif: 'Ce n\'est pas le code envoyé par DigiGo : il te reste 2 essais.', bouton: null } });
    expect(await e.code(d.corps.id, String(vrai))).toMatchObject({ statut: 200, corps: { signees: ['FAC-2026-001', 'FAC-2026-002'], titulaire: 'Nadia Ben Salah' } });

    // Le fichier signé : le fichier du serveur, enveloppé de SA signature, rien d'autre ; c'est lui que « Fichier
    // pour El Fatoora » donne désormais.
    const original = String((await admin.query(`select e.xml from ventes.efacture e join ventes.piece p on p.id = e.piece where p.entreprise = $1 and p.ref_v10 = 'f1'`, [e.ent])).rows[0].xml);
    const f = (await e.teif('f1')).corps;
    expect(f).toMatchObject({ nom: 'TEIF_7654321BAM000_FAC-2026-001_signe.xml', signe: true, titulaire: 'Nadia Ben Salah' });
    expect(String(f.xml)).toContain('<ds:Signature');
    expect(signatureEnveloppe(original, String(f.xml))).toBe(true);
    expect(signatureEnveloppe(original, String(f.xml).replace('FAC-2026-001', 'FAC-2026-009'))).toBe(false);
    // Un fichier rendu tel quel, SANS signature, n'est pas signé.
    expect(signatureEnveloppe(original, original)).toBe(false);
    expect((await e.teif('f3')).corps).toMatchObject({ signe: false, nom: 'TEIF_7654321BAM000_FAC-2026-003.xml' });
    // Gardé : jamais réécrit ni effacé par le compte du serveur ; la trace dit qui a signé.
    await expect(pool.query('update ventes.efacture_signee set xml = $1', ['<faux/>'])).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query('delete from ventes.efacture_signee')).rejects.toMatchObject({ code: '42501' });
    expect((await admin.query("select count(*)::int n from socle.audit where entreprise = $1 and geste = 'ventes.facture.signer'", [e.ent])).rows[0].n).toBe(2);
    // Une pièce ne se signe qu'une fois ; une demande finie ne resigne rien.
    expect(await e.demander(['f1'])).toMatchObject({ statut: 403, corps: { motif: 'La pièce FAC-2026-001 est déjà signée.' } });
    expect(await e.code(d.corps.id, String(vrai))).toMatchObject({ statut: 403, corps: { motif: 'Cette demande de signature est terminée : recommence la signature si besoin.', bouton: 'efacture.recommencer' } });
  });

  it('trois codes faux perdent la demande ; un fichier rendu autre n\'est pas gardé ; sans DigiGo, rien ne se signe', async () => {
    const e = await essai();
    await e.signataire('09876543');
    const d = await e.demander(['f3']);
    const vrai = digigo.codeDe('09876543');
    expect((await e.code(d.corps.id, faux(vrai))).corps.motif).toBe('Ce n\'est pas le code envoyé par DigiGo : il te reste 2 essais.');
    expect((await e.code(d.corps.id, faux(vrai))).corps.motif).toBe('Ce n\'est pas le code envoyé par DigiGo : il te reste un essai.');
    // Perdue : le bouton qui débloque recommence (un nouveau code) ; avant, le même code se retape.
    expect((await e.code(d.corps.id, faux(vrai))).corps).toEqual({ motif: 'Trois codes faux : cette demande est perdue, rien n\'a été signé. Recommence la signature : un nouveau code partira.', bouton: 'efacture.recommencer' });
    expect((await e.code(d.corps.id, String(vrai))).statut).toBe(403);
    expect((await e.teif('f3')).corps.signe).toBe(false);

    // DigiGo rend un autre fichier que celui envoyé (le second des deux) : RIEN n'est gardé, pas même le premier,
    // bien signé ; la demande dit pourquoi.
    const d2 = await e.demander(['f2', 'f3']);
    digigo.falsifier(2);
    try {
      expect(await e.code(d2.corps.id, String(digigo.codeDe('09876543')))).toMatchObject({ statut: 502, corps: { motif: 'DigiGo a rendu un fichier qui n\'est pas celui qu\'on lui a envoyé : rien n\'a été gardé.', bouton: 'efacture.recommencer' } });
    } finally {
      digigo.falsifier(null);
    }
    expect((await e.teif('f2')).corps.signe).toBe(false);
    expect((await e.teif('f3')).corps.signe).toBe(false);
    expect((await admin.query('select statut, motif ->> \'cle\' motif from ventes.signature_demande where id = $1', [d2.corps.id])).rows[0]).toEqual({ statut: 'echouee', motif: 'efacture.signature_fausse' });

    // La session expire chez DigiGo avant le code : la demande est perdue, un nouveau code se demande.
    const d3 = await e.demander(['f3']);
    digigo.expirer();
    expect(await e.code(d3.corps.id, '123456')).toMatchObject({ statut: 502, corps: { motif: 'DigiGo a refusé la demande (réponse 404) : rien n\'a été signé.', bouton: 'efacture.recommencer' } });
    expect((await admin.query('select statut from ventes.signature_demande where id = $1', [d3.corps.id])).rows[0].statut).toBe('echouee');

    // Une pièce émise sans fichier du serveur (avant la facture électronique) ne part pas à DigiGo.
    await admin.query(`delete from ventes.efacture e using ventes.piece p where p.id = e.piece and p.entreprise = $1 and p.ref_v10 = 'f1'`, [e.ent]);
    expect(await e.demander(['f3', 'f1'])).toMatchObject({ statut: 403, corps: { motif: 'La pièce FAC-2026-001 n\'a pas de fichier El Fatoora écrit par le serveur : rien n\'a été signé.' } });

    // Un serveur sans DigiGo branché le dit ; un titulaire inconnu de DigiGo, aussi.
    expect(await e.demander(['f3'], sansDigigo)).toMatchObject({ statut: 403, corps: { motif: 'La signature DigiGo n\'est pas encore branchée sur ce serveur : rien n\'a été signé.' } });
    await e.signataire('11112222');
    expect(await e.demander(['f3'])).toMatchObject({ statut: 502, corps: { motif: 'DigiGo a refusé la demande (réponse 404) : rien n\'a été signé.' } });
  });
});
