// Le code de connexion au choix (décision de Skander du 12/10/2026 ; migration 0081 ; serveur/sms.ts, compte.ts,
// connexion.ts ; docs/entree.md), joué contre la vraie base : l'e-mail par défaut, le SMS (WinSMS), ou une application.
// Le SMS s'active en deux temps et son numéro ne change qu'en le prouvant ; chaque SMS se compte ; un SMS qui ne part
// pas ne ferme pas la porte ; un comptable de cabinet entre par le code reçu par e-mail ; le mot de passe oublié d'un
// compte au SMS. Ce qui part chez le fournisseur : le numéro et le code, rien d'autre.

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { activerSms, envoyerPreuveSms, preparerSms, retirerCode } from '../../serveur/compte.ts';
import { connecter, demanderReinitialisation, envoyerCodeReinitialisation, inscrire, lireReinitialisation, quiEst, reinitialiser, renvoyerCode, validerCode, type Contexte, type Qui } from '../../serveur/connexion.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { numeroMasque, numeroTunisien, reponseEnErreur, smsWinsms } from '../../serveur/sms.ts';
import { smsAucun } from '../../serveur/principal.ts';
import { winsmsSimule } from '../winsms-simule.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date('2026-10-12T08:00:00Z');
const avancer = (minutes: number) => { horloge = new Date(horloge.getTime() + minutes * 60_000); };
// Le fournisseur de SMS du test : il garde ce qui part ; en panne, il refuse.
const envoyes: { telephone: string; texte: string }[] = [];
let panne = false;
const sms: Contexte['sms'] = { envoyer: async (telephone, texte) => { if (panne) throw new Error('fournisseur en panne'); envoyes.push({ telephone, texte }); } };
const base: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), maintenant: () => horloge, sms };
const courriels: Courriel[] = [];
const avecRelais: Contexte = { ...base, courriel: { envoi: { envoyer: async (c) => { courriels.push(c); } }, adresse: () => 'https://app.exemple.tn' } };
const MDP = 'Un-bon-mot-de-passe';
const dernierSms = () => /(\d{3}) (\d{3})$/.exec(envoyes.at(-1)?.texte ?? '')?.slice(1).join('') ?? '';
const faux = (bon: string) => (bon === '000000' ? '111111' : '000000');

let n = 0;
// Une personne neuve, connectée sans relais (pas de code par e-mail à l'entrée), propriétaire d'une entreprise.
async function personne() {
  const email = `choix${++n}@exemple.tn`;
  const r = await inscrire(base, email, `Choix ${n}`, MDP);
  if (!r.ok) throw new Error(String(r.motif));
  await enTantQue(pool, r.utilisateur, (tx) => tx.query(`select socle.creer_entreprise('Société ${n}')`));
  const c = await connecter(base, { email, motDePasse: MDP, appareil: { nom: 'Portable', type: 'navigateur' } });
  if (c.etat !== 'connecte') throw new Error('connexion attendue');
  return { email, id: r.utilisateur, qui: await quiEst(base, c.jeton) as Qui, jeton: c.jeton };
}
// Le SMS activé au numéro donné ; rend les codes de secours.
async function avecSms(p: { qui: Qui }, telephone = '22 123 456') {
  if (!(await preparerSms(base, p.qui, telephone)).ok) throw new Error('préparation attendue');
  const r = await activerSms(base, p.qui, dernierSms());
  if (!r.ok) throw new Error('activation attendue');
  return r.codesDeSecours;
}
const enregistre = async (id: string) => (await admin.query('select code_methode, telephone, telephone_verifie_le from socle.utilisateur where id = $1', [id])).rows[0] as
  { code_methode: string | null; telephone: string | null; telephone_verifie_le: Date | null };
const entrer = (email: string, ctx: Contexte = base) => connecter(ctx, { email, motDePasse: MDP, appareil: { nom: `Neuf ${++n}`, type: 'navigateur' } });

beforeAll(async () => { await admin.connect(); });
afterAll(async () => { await admin.end(); await pool.end(); });

describe('le SMS s\'active en deux temps (0081)', () => {
  it('un numéro qui n\'est pas un mobile tunisien se refuse ; préparé, rien ne change avant le code reçu ; cinq codes faux et il faut redemander ; le bon code active le SMS', async () => {
    const p = await personne();
    expect(await preparerSms(base, p.qui, '71 123 456')).toMatchObject({ ok: false, champ: 'telephone' });
    expect(await preparerSms(base, p.qui, '+33 6 12 34 56 78')).toMatchObject({ ok: false, champ: 'telephone' });
    const avant = envoyes.length;
    expect(await preparerSms(base, p.qui, '+216 22 123 456')).toEqual({ ok: true, telephone: '+216 \u2022\u2022 \u2022\u2022\u2022 456' });
    // Ce qui part : le numéro et le code, rien d'autre.
    expect(envoyes).toHaveLength(avant + 1);
    expect(envoyes.at(-1)).toEqual({ telephone: '+21622123456', texte: expect.stringMatching(/^Ton code SkanFact : \d{3} \d{3}$/) });
    const code = dernierSms();
    // Rien ne change avant le code : la personne entre toujours avec son seul mot de passe.
    expect(await enregistre(p.id)).toMatchObject({ code_methode: null, telephone: null });
    for (let i = 0; i < 5; i++) expect(await activerSms(base, p.qui, faux(code))).toMatchObject({ ok: false, champ: 'code' });
    // Cinq erreurs : même le bon code ne vaut plus, il faut redemander un SMS.
    expect(await activerSms(base, p.qui, code)).toMatchObject({ ok: false, champ: 'code' });
    expect((await enregistre(p.id)).code_methode).toBeNull();
    expect((await preparerSms(base, p.qui, '22123456')).ok).toBe(true);
    const r = await activerSms(base, p.qui, `${dernierSms().slice(0, 3)} ${dernierSms().slice(3)}`);
    if (!r.ok) throw new Error('activation attendue');
    expect(r.codesDeSecours).toHaveLength(10);
    expect(await enregistre(p.id)).toMatchObject({ code_methode: 'sms', telephone: '+21622123456', telephone_verifie_le: expect.any(Date) });
    expect((await admin.query(`select apres from socle.audit where utilisateur = $1 and geste = 'compte.code.activer'`, [p.id])).rows).toEqual([{ apres: { methode: 'sms' } }]);
    // Désormais, un appareil neuf reçoit son code à ce numéro.
    const c = await entrer(p.email);
    expect(c).toMatchObject({ etat: 'code', methode: 'sms', telephone: '+216 \u2022\u2022 \u2022\u2022\u2022 456', envoi: 'parti' });
    if (c.etat !== 'code') return;
    expect(envoyes.at(-1)?.telephone).toBe('+21622123456');
    expect((await validerCode(base, { defi: c.defi, code: dernierSms() })).etat).toBe('connecte');
  });

  it('un code reçu il y a plus de 15 minutes ne vaut plus', async () => {
    const p = await personne();
    expect((await preparerSms(base, p.qui, '55 000 111')).ok).toBe(true);
    avancer(16);
    expect(await activerSms(base, p.qui, dernierSms())).toMatchObject({ ok: false, champ: 'code' });
    expect((await enregistre(p.id)).code_methode).toBeNull();
  });

  it('le numéro ne se change pas par une simple mise à jour : seule l\'activation le pose', async () => {
    const p = await personne();
    await expect(enTantQue(pool, p.id, (tx) => tx.query(`update socle.utilisateur set telephone = '+21699999999' where id = $1`, [p.id]))).rejects.toThrow(/permission denied/);
    // Le code posé d'un coup (l'API) ne pose pas le SMS sans numéro prouvé.
    await expect(enTantQue(pool, p.id, (tx) => tx.query(`select socle.poser_code('sms', null, array_fill('x'::text, array[10]))`))).rejects.toThrow(/s'active depuis Ton compte/);
  });

  it('changer de numéro prouve d\'abord le code actuel : la preuve part au numéro du compte, et ne sert qu\'une fois', async () => {
    const p = await personne();
    await avecSms(p, '22 000 001');
    expect(await preparerSms(base, p.qui, '50 000 002')).toMatchObject({ ok: false, champ: 'code' });
    expect(await envoyerPreuveSms(base, p.qui)).toEqual({ ok: true, telephone: '+216 \u2022\u2022 \u2022\u2022\u2022 001' });
    expect(envoyes.at(-1)?.telephone).toBe('+21622000001');
    const preuve = dernierSms();
    expect(await preparerSms(base, p.qui, '50 000 002', faux(preuve))).toMatchObject({ ok: false, champ: 'code' });
    expect(await preparerSms(base, p.qui, '50 000 002', preuve)).toMatchObject({ ok: true });
    expect(envoyes.at(-1)?.telephone).toBe('+21650000002');
    // La preuve a servi : elle ne retire pas le code ensuite.
    expect(await retirerCode(base, p.qui, preuve)).toMatchObject({ ok: false, champ: 'code' });
    expect((await activerSms(base, p.qui, dernierSms())).ok).toBe(true);
    expect((await enregistre(p.id)).telephone).toBe('+21650000002');
  });

  it('au plus cinq SMS par heure : au-delà rien ne part, la connexion le dit en gardant le défi, et un code de secours entre', async () => {
    const p = await personne();
    const secours = await avecSms(p, '29 000 003');
    for (let i = 0; i < 4; i++) expect(await entrer(p.email)).toMatchObject({ etat: 'code', envoi: 'parti' });
    const avant = envoyes.length;
    const c = await entrer(p.email);
    expect(c).toMatchObject({ etat: 'code', methode: 'sms', envoi: 'limite' });
    expect(envoyes).toHaveLength(avant);
    if (c.etat !== 'code') return;
    expect(await renvoyerCode(base, c.defi)).toMatchObject({ ok: false });
    expect((await validerCode(base, { defi: c.defi, code: secours[0] ?? '' })).etat).toBe('connecte');
    avancer(61);
    expect(await entrer(p.email)).toMatchObject({ etat: 'code', envoi: 'parti' });
  });

  it('un SMS qui ne part pas laisse le défi ouvert : la connexion le dit, et « Renvoyer » le renvoie', async () => {
    const p = await personne();
    await avecSms(p, '93 000 004');
    panne = true;
    const avant = envoyes.length;
    const c = await entrer(p.email).finally(() => { panne = false; });
    expect(c).toMatchObject({ etat: 'code', methode: 'sms', envoi: 'rate' });
    expect(envoyes).toHaveLength(avant);
    if (c.etat !== 'code') return;
    // Pas deux envois en moins de 30 secondes.
    expect(await renvoyerCode(base, c.defi)).toMatchObject({ ok: false });
    avancer(1);
    expect(await renvoyerCode(base, c.defi)).toEqual({ ok: true });
    expect(envoyes.at(-1)?.telephone).toBe('+21693000004');
    expect((await validerCode(base, { defi: c.defi, code: dernierSms() })).etat).toBe('connecte');
  });

  it('sans fournisseur, le SMS ne se prépare pas, et l\'écran ne le propose pas', async () => {
    const p = await personne();
    const sansSms: Contexte = { ...base, sms: smsAucun };
    expect(await preparerSms(sansSms, p.qui, '22 123 456')).toMatchObject({ ok: false });
    expect((await enregistre(p.id)).code_methode).toBeNull();
    const app = creerApp(sansSms, routesSocle(sansSms));
    const moi = (await app.inject({ method: 'GET', url: `${VERSION}/moi`, headers: { authorization: `Bearer ${p.jeton}` } })).json() as { compte: { sms: boolean; telephone: string | null } };
    expect(moi.compte).toMatchObject({ sms: false, telephone: null });
    await app.close();
  });
});

describe('le code par e-mail tient lieu de code pour un comptable (0081)', () => {
  let app: FastifyInstance;
  beforeAll(() => { app = creerApp(avecRelais, routesSocle(avecRelais)); });
  afterAll(async () => { await app.close(); });

  it('avec un relais, un comptable sans SMS ni application entre par le code reçu par e-mail, et rien ne lui est bloqué', async () => {
    const email = `comptable${++n}@exemple.tn`;
    const r = await inscrire(base, email, 'Comptable', MDP);
    if (!r.ok) throw new Error('inscription attendue');
    await enTantQue(pool, r.utilisateur, (tx) => tx.query(`select * from socle.creer_cabinet('Cabinet ${n}')`));
    const c = await entrer(email, avecRelais);
    expect(c).toMatchObject({ etat: 'code', methode: 'courriel' });
    if (c.etat !== 'code') return;
    const code = /\n\n(\d{6})\n\n/.exec(courriels.at(-1)?.texte ?? '')?.[1] ?? '';
    const ok = await validerCode(avecRelais, { defi: c.defi, code });
    expect(ok).toMatchObject({ etat: 'connecte', codeAConfigurer: false });
    if (ok.etat !== 'connecte') return;
    const appeler = async (methode: 'GET' | 'POST', url: string, corps?: unknown) => {
      const x = await app.inject({ method: methode, url: VERSION + url, headers: { authorization: `Bearer ${ok.jeton}` }, ...(corps ? { payload: corps as Record<string, unknown> } : {}) });
      return { statut: x.statusCode, corps: x.json() as Record<string, unknown> };
    };
    expect((await appeler('POST', '/entreprises', { raisonSociale: 'Société du comptable' })).statut).toBe(201);
    expect((await appeler('GET', '/moi')).corps).toMatchObject({ codeAConfigurer: false, compte: { codeExige: false, comptable: true, courriel: true } });
  });
});

describe('le mot de passe oublié d\'un compte au SMS (0081)', () => {
  it('le lien dit le numéro masqué ; le code part sur demande ; tapé, il choisit le nouveau mot de passe', async () => {
    const p = await personne();
    await avecSms(p, '24 000 005');
    await demanderReinitialisation(avecRelais, p.email);
    const jeton = /reinitialiser=([\w-]+)/.exec(courriels.at(-1)?.texte ?? '')?.[1] ?? '';
    expect(await lireReinitialisation(avecRelais, jeton)).toEqual({ valable: true, code: true, sms: '+216 \u2022\u2022 \u2022\u2022\u2022 005' });
    expect(await reinitialiser(avecRelais, { jeton, motDePasse: 'Un-autre-bon-mot-de-passe' })).toMatchObject({ ok: false, champ: 'code' });
    expect(await envoyerCodeReinitialisation(avecRelais, jeton)).toEqual({ ok: true });
    expect(envoyes.at(-1)?.telephone).toBe('+21624000005');
    expect(await reinitialiser(avecRelais, { jeton, motDePasse: 'Un-autre-bon-mot-de-passe', code: faux(dernierSms()) })).toMatchObject({ ok: false, champ: 'code' });
    expect(await reinitialiser(avecRelais, { jeton, motDePasse: 'Un-autre-bon-mot-de-passe', code: dernierSms() })).toEqual({ ok: true });
  });
});

describe('WinSMS (serveur/sms.ts)', () => {
  it('ce qui part : le numéro, le texte et l\'expéditeur, en POST ; la clé jamais dans l\'adresse ; un refus est un envoi raté', async () => {
    const w = await winsmsSimule();
    try {
      const envoi = smsWinsms({ cle: 'cle-d-essai', expediteur: 'SkanFact', adresse: w.adresse });
      await envoi.envoyer('+216 22 123 456', 'Ton code SkanFact : 123 456');
      expect(w.recus).toEqual([{ action: 'send-sms', cle: 'cle-d-essai', a: '21622123456', texte: 'Ton code SkanFact : 123 456', de: 'SkanFact', methode: 'POST' }]);
      w.repondre(200, JSON.stringify({ code: 'error', message: 'Insufficient balance' }));
      await expect(envoi.envoyer('22123456', 'Ton code SkanFact : 123 456')).rejects.toThrow(/WinSMS a refusé/);
      w.repondre(401, 'unauthorized');
      // Le journal du serveur ne garde jamais le code.
      await expect(envoi.envoyer('22123456', 'Ton code SkanFact : 654321')).rejects.toThrow(/^(?!.*654321)/);
      await expect(envoi.envoyer('7112', 'x')).rejects.toThrow(/numéro inutilisable/);
    } finally { await w.fermer(); }
  });

  it('les numéros tunisiens se lisent comme on les tape, et se montrent masqués', () => {
    for (const saisi of ['22123456', '22 123 456', '+216 22 123 456', '0021622123456', '216-22-123-456', '(+216) 22.123.456']) expect(numeroTunisien(saisi)).toBe('+21622123456');
    for (const saisi of ['71123456', '2212345', '221234567', '+33612345678', '', 'vingt-deux']) expect(numeroTunisien(saisi)).toBeNull();
    expect(numeroMasque('+21622123456')).toBe('+216 \u2022\u2022 \u2022\u2022\u2022 456');
    expect(numeroMasque(null)).toBe('');
    expect(reponseEnErreur('{"code":"ok","message":"Successfully Send"}')).toBe(false);
    expect(reponseEnErreur('{"status":"error"}')).toBe(true);
    expect(reponseEnErreur('Invalid API key')).toBe(true);
  });
});
