// L'envoi à la TTN (brique 82 ; docs/facture-electronique.md ; 05 § 3.1 et 3.8), par l'API, avec une TTN
// simulée (tests/ttn-simule.ts) et un DigiGo simulé. Ce que le serveur garantit :
//   - une pièce signée part d'elle-même ; sans compte El Fatoora, elle attend, et c'est dit ;
//   - déposée, elle se relit jusqu'à la réponse de la TTN : acceptée, sa référence, son code QR et la facture
//     validée se gardent (et ne changent plus) ; refusée, on dit pourquoi, et elle se renvoie ;
//   - JAMAIS deux dépôts d'une même pièce : ni quand la réponse d'un dépôt se perd, ni quand deux tours du
//     facteur se croisent ;
//   - une panne se réessaie plus tard ; un compte refusé se dit à l'entreprise ;
//   - une entreprise d'essai n'envoie jamais rien.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { CLE_DU_COFFRE_D_ESSAI } from '../../serveur/coffre.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { envoyerALaTtn } from '../../serveur/v10/envoi.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { digigoSimule } from '../digigo-simule.ts';
import { libererMatricule } from '../matricule-libre.ts';
import { v10, type DocV10 } from '../moteur/v10.ts';
import { ttnSimulee } from '../ttn-simule.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let digigo: Awaited<ReturnType<typeof digigoSimule>>;
let ttn: Awaited<ReturnType<typeof ttnSimulee>>;
let app: FastifyInstance;
// L'horloge du serveur : le facteur ne reprend une pièce qu'à son heure.
let horloge = new Date('2026-10-01T09:00:00Z');
const avancer = (minutes: number) => { horloge = new Date(horloge.getTime() + minutes * 60_000); };
let ctx: Contexte;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };
const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
  : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);

let n = 0;
// Une entreprise (une vraie, ou d'essai) soumise à la facture électronique, son signataire désigné, et des
// factures émises à la Menuiserie (la fiche et le client repris de l'entreprise d'essai de la personne).
async function entreprise(pieces: string[], essai = false) {
  const email = `ttn-${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Nadia ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const modele = String((await appeler('POST', '/entreprises-essai', jeton)).corps.id);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const objetsDe = async (e: string) => (await appeler('GET', `/entreprises/${e}/dossier-v10`, jeton)).corps.objets as Objet[];
  const deModele = await objetsDe(modele);
  const menuiserie = deModele.find((x) => x.collection === 'clients' && String(x.contenu.name).startsWith('Menuiserie'));
  const fiche = deModele.find((x) => x.collection === '_racine' && x.cle === 'company');
  if (!menuiserie || !fiche) throw new Error('entreprise d\'essai incomplète');
  const ent = essai ? modele : String((await appeler('POST', '/entreprises', jeton, { raisonSociale: `Atelier Nadia ${n}` })).corps.id);
  const client = { ...menuiserie.contenu, matricule: '1234567A/A/M/000' };
  // Une entreprise de la personne, soumise, avec des factures émises.
  const remplir = async (cible: string, cles: string[]) => {
    const ici = cible === modele ? deModele : await objetsDe(cible);
    const societe = ici.find((x) => x.collection === '_racine' && x.cle === 'company');
    const deja = ici.find((x) => x.collection === 'clients' && x.cle === menuiserie.cle);
    // Le matricule de Nadia, que la TTN simulée connaît : une vraie entreprise le reprend à celle d'un test précédent
    // (une entreprise à la fois : tests/matricule-libre.ts) ; l'entreprise d'essai garde le sien.
    if (cible !== modele) await libererMatricule(inject('pgAdmin'), '7654321B/A/M/000');
    const r = await appeler('POST', `/entreprises/${cible}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...fiche.contenu, ...societe?.contenu, matricule: '7654321B/A/M/000', efacture: true } },
      { collection: 'clients', cle: menuiserie.cle, rang: deja?.rang ?? 0, revision: deja?.revision ?? null, contenu: client },
    ] });
    if (r.statut !== 200) throw new Error(`dossier refusé : ${JSON.stringify(r.corps)}`);
    for (const [k, id] of cles.entries()) {
      const d: Record<string, unknown> = {
        id, type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
        lines: [{ label: 'Table en chêne massif', description: '', qty: 2 + k, unit: '', unitPrice: 450.5, vatRate: 19 }],
        discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
      };
      await appeler('POST', `/entreprises/${cible}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: id, rang: 100 + k, revision: null, contenu: enc(d) }] });
      const e = await appeler('POST', `/entreprises/${cible}/dossier-v10/emettre`, jeton, { document: enc(d), client, revision: 1, rang: 100 + k,
        netAPayer: v10.computeTotals(d as DocV10, { currency: 'DT', stampFee: 1 }).netToPay.toFixed(3) });
      if (e.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(e.corps)}`);
    }
  };
  await remplir(ent, pieces);
  await appeler('PUT', `/entreprises/${ent}/efacture/signataire`, jeton, { identifiant: '09876543' });
  return {
    jeton, ent, client: menuiserie.cle,
    // Des factures émises dans l'autre entreprise de la même personne (son entreprise d'essai).
    dansLEssai: (cles: string[]) => remplir(modele, cles),
    // Signer des pièces avec le code reçu par la signataire.
    signer: async (cles: string[]) => {
      const d = await appeler('POST', `/entreprises/${ent}/efacture/signatures`, jeton, { pieces: cles });
      const s = await appeler('POST', `/entreprises/${ent}/efacture/signatures/${String(d.corps.id)}/code`, jeton, { code: String(digigo.codeDe('09876543')) });
      if (s.statut !== 200) throw new Error(`signature refusée : ${JSON.stringify(s.corps)}`);
      return s.corps.signees as string[];
    },
    compte: (identifiant: string, motDePasse: string) => appeler('PUT', `/entreprises/${ent}/efacture/ttn`, jeton, { identifiant, motDePasse }),
    ttn: async () => (await appeler('GET', `/entreprises/${ent}/efacture/ttn`, jeton)).corps,
    teif: async (cle: string) => (await appeler('GET', `/entreprises/${ent}/dossier-v10/${cle}/teif`, jeton)).corps,
    renvoyer: (cle: string) => appeler('POST', `/entreprises/${ent}/efacture/envois/${cle}/renvoyer`, jeton),
    etats: (cles: string[]) => appeler('GET', `/entreprises/${ent}/efacture/etats?cles=${cles.join(',')}`, jeton),
    envoi: async (cle: string) => (await admin.query(`select x.* from ventes.envoi_ttn x join ventes.piece p on p.id = x.piece where p.entreprise = $1 and p.ref_v10 = $2`, [ent, cle])).rows[0] as
      Record<string, unknown> | undefined,
  };
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  digigo = await digigoSimule();
  ttn = await ttnSimulee();
  ctx = {
    pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
    maintenant: () => horloge, efacture: { digigo: digigo.base, cleDigigo: digigo.cleIntegrateur }, ttn: { adresse: ttn.base, coffre: CLE_DU_COFFRE_D_ESSAI },
  };
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx)]);
  await app.ready();
});
beforeEach(() => { ttn.vider(); });
afterAll(async () => { await app.close(); await digigo.fermer(); await ttn.fermer(); await admin.end(); await pool.end(); });

describe('l\'envoi à la TTN', () => {
  it('une pièce signée part d\'elle-même, une seule fois ; acceptée, sa référence, son code QR et la facture validée se gardent', async () => {
    const e = await entreprise(['f1', 'f2', 'f3']);
    expect(await e.signer(['f1', 'f2'])).toEqual(['FAC-2026-001', 'FAC-2026-002']);
    // Signées : en route. Sans compte El Fatoora, rien ne part, et c'est dit.
    expect(await e.envoi('f1')).toMatchObject({ statut: 'a_envoyer' });
    const avant = ttn.appels();
    await envoyerALaTtn(ctx);
    expect(ttn.appels()).toBe(avant);
    expect((await e.teif('f1')).envoi).toMatchObject({ statut: 'a_envoyer', motif: 'le compte El Fatoora de l\'entreprise n\'est pas posé : branche-le dans Paramètres → Documents, et la pièce partira' });

    // Le compte posé : les deux pièces partent aussitôt (sans attendre l'heure prévue), puis se relisent.
    expect((await e.compte('nadia-el-fatoora', 'Mot-de-passe-TTN-7')).statut).toBe(200);
    expect((await e.ttn()).compte).toMatchObject({ identifiant: 'nadia-el-fatoora', dernierRefus: null });
    // Le compte posé, ce qui retenait les pièces ne se dit plus.
    expect((await e.ttn()).envois).toEqual([expect.objectContaining({ statut: 'a_envoyer', motif: null }), expect.objectContaining({ statut: 'a_envoyer', motif: null })]);
    expect(JSON.stringify(await e.ttn())).not.toContain('Mot-de-passe-TTN-7');
    expect(await envoyerALaTtn(ctx)).toBe(2);
    expect(await e.envoi('f1')).toMatchObject({ statut: 'deposee', motif: null, reference: null });
    // Pas encore l'heure de relire : rien ne se passe.
    expect(await envoyerALaTtn(ctx)).toBe(0);
    avancer(2);
    expect(await envoyerALaTtn(ctx)).toBe(2);

    // Acceptée : la référence de la TTN, le contenu du code QR, et la facture validée (le fichier signé, avec
    // la référence de la TTN), qui fait foi : « Fichier pour El Fatoora » la donne désormais.
    const x = await e.envoi('f1');
    expect(x).toMatchObject({ statut: 'acceptee', reference: expect.stringMatching(/^TTN26\d{10}$/), qr: expect.stringContaining('https://elfatoora.tn/verif?ref=TTN26') });
    const signe = String((await admin.query(`select g.xml from ventes.efacture_signee g join ventes.piece p on p.id = g.piece where p.entreprise = $1 and p.ref_v10 = 'f1'`, [e.ent])).rows[0].xml);
    expect(String(x?.xml_valide)).toContain(`<ReferenceTTN refID="I-88">${String(x?.reference)}</ReferenceTTN>`);
    expect(String(x?.xml_valide).replace(/<RefTtnVal>[\s\S]*?<\/RefTtnVal>/, '').replace(/<ds:Signature[^>]*Id="SigTTN">[\s\S]*?<\/ds:Signature>/, '')).toBe(signe);
    const f = await e.teif('f1');
    expect(f).toMatchObject({ nom: 'TEIF_7654321BAM000_FAC-2026-001_ttn.xml', xml: x?.xml_valide, envoi: { statut: 'acceptee', reference: x?.reference } });
    // Une seule tentative de dépôt par pièce ; la trace dit le dépôt et l'acceptation.
    expect([ttn.deposesDe('FAC-2026-001'), ttn.deposesDe('FAC-2026-002')]).toEqual([1, 1]);
    expect((await admin.query(`select apres ->> 'etape' etape from socle.audit where entreprise = $1 and geste = 'ventes.facture.envoyer' order by id`, [e.ent])).rows.map((r) => r.etape))
      .toEqual(['deposee', 'deposee', 'acceptee', 'acceptee']);
    // Acceptée, elle ne change plus (pas même par sa propriétaire) ; et le mot de passe ne se lit pas, même par
    // le compte du serveur.
    const proprietaire = String((await admin.query(`select utilisateur from socle.membre where entreprise = $1 and 'proprietaire' = any(roles)`, [e.ent])).rows[0].utilisateur);
    await expect(enTantQue(pool, proprietaire, (tx) => tx.query(`update ventes.envoi_ttn set reference = 'TTN-FAUSSE' where entreprise = $1`, [e.ent])))
      .rejects.toMatchObject({ code: '42501', message: 'une pièce acceptée par la TTN ne change plus' });
    await expect(pool.query('select mot_de_passe_scelle from ventes.ttn_compte')).rejects.toMatchObject({ code: '42501' });
    expect((await e.renvoyer('f1')).corps.motif).toBe('Seule une pièce refusée par la TTN se renvoie ; la pièce FAC-2026-001 ne l\'est pas.');

    // La pièce du dossier porte sa référence et le contenu de son code QR (elle s'imprime avec, brique 83) ; seul le
    // serveur les écrit : ni changées sur une pièce acceptée, ni inventées sur une autre.
    const objets = async () => (await appeler('GET', `/entreprises/${e.ent}/dossier-v10`, e.jeton)).corps.objets as Objet[];
    const p1 = (await objets()).find((o) => o.collection === 'documents' && o.cle === 'f1');
    expect(p1?.contenu.ttn).toEqual({ reference: x?.reference, qr: x?.qr, le: expect.stringMatching(/^2026-10-01T09:02:00/) });
    const ecrire = (o: Objet | undefined, ttnEcrit: unknown) => appeler('POST', `/entreprises/${e.ent}/dossier-v10`, e.jeton,
      { changements: [{ collection: 'documents', cle: o?.cle, rang: o?.rang, revision: o?.revision, contenu: { ...o?.contenu, ttn: ttnEcrit } }] });
    expect(await ecrire(p1, { reference: 'TTN-INVENTEE', qr: 'x' })).toMatchObject({ statut: 403,
      corps: { motif: 'La référence de la TTN de la pièce FAC-2026-001 ne s\'écrit que par le serveur, quand la TTN l\'accepte : rien n\'a été enregistré.' } });
    expect(await ecrire(p1, undefined)).toMatchObject({ statut: 403 });
    const p3 = (await objets()).find((o) => o.collection === 'documents' && o.cle === 'f3');
    expect(p3?.contenu.ttn).toBeUndefined();
    expect(await ecrire(p3, { reference: 'TTN-INVENTEE', qr: 'x' })).toMatchObject({ statut: 403 });
    // Une pièce acceptée garde sa référence quand elle vit sa vie (un règlement s'y ajoute).
    expect((await ecrire(p1, p1?.contenu.ttn)).statut).toBe(200);
  });

  it('jamais deux dépôts : ni quand la réponse se perd, ni quand deux tours se croisent ; une panne se réessaie plus tard', async () => {
    const e = await entreprise(['f1', 'f2', 'f3']);
    await e.compte('nadia-el-fatoora', 'Mot-de-passe-TTN-7');
    await e.signer(['f1']);
    // La TTN reçoit le dépôt, mais sa réponse se perd : le serveur croit à une panne, et repassera.
    ttn.reglage.perdre = 1;
    expect(await envoyerALaTtn(ctx)).toBe(1);
    expect(await e.envoi('f1')).toMatchObject({ statut: 'a_envoyer', essais: 1, motif: { cle: 'ttn.panne', valeurs: { statut: 504 } } });
    expect(await envoyerALaTtn(ctx)).toBe(0);
    avancer(1);
    // Il demande d'abord : la TTN l'a déjà. Pas de second dépôt.
    expect(await envoyerALaTtn(ctx)).toBe(1);
    expect(await e.envoi('f1')).toMatchObject({ statut: 'acceptee' });
    expect(ttn.deposesDe('FAC-2026-001')).toBe(1);

    // Deux tours du facteur en même temps (deux serveurs) : un seul dépose.
    await e.signer(['f2']);
    ttn.reglage.lenteur = 150;
    try {
      await Promise.all([envoyerALaTtn(ctx), envoyerALaTtn(ctx), envoyerALaTtn(ctx)]);
    } finally {
      ttn.reglage.lenteur = 0;
    }
    expect(ttn.deposesDe('FAC-2026-002')).toBe(1);
    expect(await e.envoi('f2')).toMatchObject({ statut: 'deposee' });
    avancer(1);
    await envoyerALaTtn(ctx);
    expect(await e.envoi('f2')).toMatchObject({ statut: 'acceptee' });

    // Une panne de la TTN : la pièce attend, de plus en plus longtemps (1, puis 5 minutes).
    await e.signer(['f3']);
    ttn.reglage.pannes = 2;
    await envoyerALaTtn(ctx);
    const p1 = await e.envoi('f3');
    expect(p1).toMatchObject({ statut: 'a_envoyer', essais: 1, motif: { cle: 'ttn.panne', valeurs: { statut: 503 } } });
    expect(new Date(String(p1?.prochain_essai)).getTime() - horloge.getTime()).toBe(60_000);
    avancer(1);
    await envoyerALaTtn(ctx);
    const p2 = await e.envoi('f3');
    expect(p2).toMatchObject({ essais: 2 });
    expect(new Date(String(p2?.prochain_essai)).getTime() - horloge.getTime()).toBe(5 * 60_000);
    avancer(5);
    await envoyerALaTtn(ctx);
    expect(await e.envoi('f3')).toMatchObject({ statut: 'deposee', essais: 0, motif: null });
    expect(ttn.deposesDe('FAC-2026-003')).toBe(1);
  });

  it('un refus se dit, et la pièce se renvoie ; un compte refusé se dit à l\'entreprise ; une entreprise d\'essai n\'envoie rien', async () => {
    const e = await entreprise(['f1', 'f2', 'f3']);
    await e.compte('nadia-el-fatoora', 'Mot-de-passe-TTN-7');
    // Refusée au dépôt : on dit pourquoi ; renvoyée (la cause corrigée), elle repart et se dépose.
    await e.signer(['f1']);
    ttn.reglage.fauteAuDepot = 'Signature du fournisseur invalide';
    await envoyerALaTtn(ctx);
    expect((await e.teif('f1')).envoi).toMatchObject({ statut: 'refusee', motif: 'la TTN a refusé la pièce au dépôt : « Signature du fournisseur invalide »' });
    expect((await e.ttn()).envois).toEqual([expect.objectContaining({ numero: 'FAC-2026-001', statut: 'refusee' })]);
    expect((await e.renvoyer('f1')).statut).toBe(200);
    await envoyerALaTtn(ctx);
    expect(await e.envoi('f1')).toMatchObject({ statut: 'deposee' });
    expect(ttn.deposesDe('FAC-2026-001')).toBe(2);

    // Refusée au traitement : ses accusés.
    await e.signer(['f2']);
    ttn.reglage.refusAuTraitement = 'Montant de TVA incohérent';
    await envoyerALaTtn(ctx);
    avancer(2);
    await envoyerALaTtn(ctx);
    expect((await e.teif('f2')).envoi).toMatchObject({ statut: 'refusee', motif: 'la TTN a refusé la pièce : KO-12 : Montant de TVA incohérent' });

    // Le mot de passe a changé chez la TTN : la pièce attend, et l'entreprise le lit dans ses réglages.
    const compte = ttn.comptes.get('nadia-el-fatoora');
    if (!compte) throw new Error('compte simulé absent');
    compte.motDePasse = 'Nouveau-mot-de-passe-9';
    try {
      await e.signer(['f3']);
      await envoyerALaTtn(ctx);
      const refus = 'la TTN refuse le compte El Fatoora de l\'entreprise (« Authentification refusee : identifiant ou mot de passe incorrect ») : vérifie l\'identifiant et le mot de passe dans Paramètres → Documents';
      expect(await e.envoi('f3')).toMatchObject({ statut: 'a_envoyer', motif: { cle: 'ttn.compte_refuse' } });
      expect((await e.ttn()).compte).toMatchObject({ dernierRefus: refus });
      expect(ttn.deposesDe('FAC-2026-003')).toBe(0);
      // Le bon mot de passe posé : la pièce repart aussitôt.
      await e.compte('nadia-el-fatoora', 'Nouveau-mot-de-passe-9');
      expect((await e.ttn()).compte).toMatchObject({ dernierRefus: null });
      await envoyerALaTtn(ctx);
      expect(await e.envoi('f3')).toMatchObject({ statut: 'deposee' });
    } finally {
      compte.motDePasse = 'Mot-de-passe-TTN-7';
    }

    // Une entreprise d'essai : signée, sa pièce ne part jamais.
    const essai = await entreprise(['f1'], true);
    await essai.signer(['f1']);
    expect(await essai.envoi('f1')).toBeUndefined();
    expect(await essai.teif('f1')).toMatchObject({ signe: true, essai: true, envoi: null });
  });

  it('la liste lit où en est chaque pièce, en un appel pour toute la page (brique 139)', async () => {
    const e = await entreprise(['f1', 'f2', 'f3', 'f4']);
    const etats = async (cles: string[]) => (await e.etats(cles)).corps.etats as Record<string, unknown>;
    // Émise, pas signée : à signer. Signée sans compte El Fatoora : retenue, et pourquoi.
    await e.signer(['f2']);
    await envoyerALaTtn(ctx);
    expect(await etats(['f1', 'f2'])).toEqual({
      f1: { etat: 'a_signer', reference: null, motif: null },
      f2: { etat: 'retenue', reference: null, motif: 'le compte El Fatoora de l\'entreprise n\'est pas posé : branche-le dans Paramètres → Documents, et la pièce partira' },
    });
    // Le compte posé : en route ; puis déposée ; puis acceptée, avec sa référence.
    await e.compte('nadia-el-fatoora', 'Mot-de-passe-TTN-7');
    expect((await etats(['f2'])).f2).toEqual({ etat: 'a_envoyer', reference: null, motif: null });
    await envoyerALaTtn(ctx);
    expect((await etats(['f2'])).f2).toMatchObject({ etat: 'deposee' });
    avancer(2);
    await envoyerALaTtn(ctx);
    const reference = String((await e.envoi('f2'))?.reference);
    // Refusée : pourquoi. Une pièce inconnue (ou d'ailleurs) n'est pas dans la réponse : la liste n'en dit rien.
    await e.signer(['f3']);
    ttn.reglage.fauteAuDepot = 'Signature du fournisseur invalide';
    await envoyerALaTtn(ctx);
    await e.signer(['f4']);
    expect(await etats(['f1', 'f2', 'f3', 'f4', 'inconnue'])).toEqual({
      f1: { etat: 'a_signer', reference: null, motif: null },
      f2: { etat: 'acceptee', reference: expect.stringMatching(/^TTN26\d{10}$/), motif: null },
      f3: { etat: 'refusee', reference: null, motif: 'la TTN a refusé la pièce au dépôt : « Signature du fournisseur invalide »' },
      f4: { etat: 'a_envoyer', reference: null, motif: null },
    });
    expect(reference).toMatch(/^TTN26/);
    // La même personne a une autre entreprise, où une pièce porte la même clé : chacune ne dit que les siennes.
    await e.dansLEssai(['f2']);
    expect((await etats(['f2'])).f2).toMatchObject({ etat: 'acceptee' });
    // Une entreprise d'essai : signée, sa pièce ne part pas ; elle ne lit pas les pièces d'une autre.
    const essai = await entreprise(['f1'], true);
    await essai.signer(['f1']);
    expect((await essai.etats(['f1', 'f2'])).corps.etats).toEqual({ f1: { etat: 'signee', reference: null, motif: null } });
    // Pas plus de 100 pièces à la fois (une page de la liste en a 50).
    const trop = await e.etats(Array.from({ length: 101 }, (_, i) => `p${i}`));
    expect(trop).toMatchObject({ statut: 400, corps: { champ: 'cles' } });
    expect(String(trop.corps.motif)).toContain('pas plus de 100 pièces à la fois');
    expect(Object.keys((await e.etats(Array.from({ length: 99 }, (_, i) => `p${i}`).concat('f1'))).corps.etats as object)).toEqual(['f1']);
  });

  it('les pièces qui attendent leur signature, pour qui peut signer, et un seul code pour plusieurs (brique 140)', { timeout: 120_000 }, async () => {
    const e = await entreprise(['f1', 'f2', 'f3']);
    const aSigner = async (jeton = e.jeton) => appeler('GET', `/entreprises/${e.ent}/efacture/a-signer`, jeton);
    expect((await aSigner()).corps).toEqual({ total: 3, pieces: [{ cle: 'f1', numero: 'FAC-2026-001' }, { cle: 'f2', numero: 'FAC-2026-002' }, { cle: 'f3', numero: 'FAC-2026-003' }] });
    // Un seul code signe les deux pièces ; il n'en reste qu'une à signer.
    expect(await e.signer(['f1', 'f3'])).toEqual(['FAC-2026-001', 'FAC-2026-003']);
    expect((await aSigner()).corps).toEqual({ total: 1, pieces: [{ cle: 'f2', numero: 'FAC-2026-002' }] });
    // Un commercial ne signe pas : la liste ne lui propose rien (le serveur refuse).
    const email = `ttn-commercial-${Date.now()}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const inv = String((await appeler('POST', `/entreprises/${e.ent}/invitations`, e.jeton, { email, roles: ['commercial'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', karim, { jeton: inv });
    expect((await aSigner(karim)).statut).toBe(403);
    // Plus de 100 pièces en attente : les 100 premières (une demande de signature n'en prend pas plus), dans l'ordre
    // où elles ont été émises, et le compte de toutes.
    const beaucoup = await entreprise(Array.from({ length: 101 }, (_, i) => `g${i}`));
    const lu = (await appeler('GET', `/entreprises/${beaucoup.ent}/efacture/a-signer`, beaucoup.jeton)).corps as { total: number; pieces: { numero: string }[] };
    expect([lu.total, lu.pieces.length, lu.pieces[0]?.numero, lu.pieces[99]?.numero]).toEqual([101, 100, 'FAC-2026-001', 'FAC-2026-100']);
  });

  it('le client télécharge par son lien la facture que la TTN a validée, et seulement elle (brique 141)', async () => {
    const e = await entreprise(['f1', 'f2']);
    await e.compte('nadia-el-fatoora', 'Mot-de-passe-TTN-7');
    await e.signer(['f1']);
    await envoyerALaTtn(ctx);
    avancer(2);
    await envoyerALaTtn(ctx);
    const valide = String((await e.envoi('f1'))?.xml_valide);
    expect(valide).toContain('<ReferenceTTN');
    // FAC-2026-002 signée, en route, pas encore acceptée.
    await e.signer(['f2']);
    const lien = async (piece?: string) => String((await appeler('POST', `/entreprises/${e.ent}/espace/liens`, e.jeton, { client: e.client, ...(piece ? { piece } : {}) })).corps.jeton);
    const compte = await lien();
    const efacture = (jeton: string, type: string, numero: string) => appeler('POST', '/espace/efacture', undefined, { jeton, type, numero });
    // Acceptée : la facture validée, telle que le serveur la garde, sous son nom.
    expect(await efacture(compte, 'facture', 'FAC-2026-001')).toEqual({ statut: 200, corps: { nom: 'TEIF_7654321BAM000_FAC-2026-001_ttn.xml', xml: valide } });
    // Signée mais pas encore acceptée, une autre sorte de pièce, une pièce hors du lien : rien.
    const rien = { statut: 404, corps: { motif: 'Cette pièce n\'a pas (encore) de facture électronique validée par la TTN.' } };
    expect(await efacture(compte, 'facture', 'FAC-2026-002')).toEqual(rien);
    expect(await efacture(compte, 'avoir', 'FAC-2026-001')).toEqual(rien);
    const seule2 = await lien('f2');
    expect(await efacture(seule2, 'facture', 'FAC-2026-001')).toEqual(rien);
    expect((await efacture(await lien('f1'), 'facture', 'FAC-2026-001')).statut).toBe(200);
    // Un lien retiré n'ouvre plus rien.
    const id = String((await admin.query(`select id from ventes.lien where entreprise = $1 and piece_v10 is null`, [e.ent])).rows[0].id);
    expect((await appeler('DELETE', `/entreprises/${e.ent}/espace/liens/${id}`, e.jeton)).statut).toBe(200);
    expect(await efacture(compte, 'facture', 'FAC-2026-001')).toEqual({ statut: 404, corps: { motif: 'Ce lien n\'est plus valable : demande un nouveau lien à l\'entreprise qui te l\'a envoyé.' } });
  });
});
