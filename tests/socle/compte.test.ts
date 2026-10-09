// Ton compte (lot onboarding, décision de Skander du 09/10/2026 ; 03 § 6 ; migration 0076 ; serveur/compte.ts), joué
// contre la vraie base : retirer le code du téléphone (avec ce code ou un code de secours, jamais pour un comptable de
// cabinet), de nouveaux codes de secours, changer son mot de passe et son adresse, ou la vérifier (0077). Ce qui part chez le relais
// d'e-mails : l'adresse, l'objet, et un texte qui ne porte que le code ou le lien.

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { activerCode, changerMotDePasse, confirmerChangementAdresse, confirmerVerificationAdresse, demanderChangementAdresse, demanderVerificationAdresse, nouveauxCodesDeSecours, preparerCode, retirerCode } from '../../serveur/compte.ts';
import { connecter, inscrire, mettreEnPlaceCode, quiEst, validerCode, type Contexte, type Qui } from '../../serveur/connexion.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date('2026-10-09T08:00:00Z');
const avancer = (minutes: number) => { horloge = new Date(horloge.getTime() + minutes * 60_000); };
const courriels: Courriel[] = [];
const base = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), maintenant: () => horloge, sms: { envoyer: async () => {} } };
const ctx: Contexte = { ...base, courriel: { envoi: { envoyer: async (c) => { courriels.push(c); } }, adresse: () => 'https://app.exemple.tn' } };
const sansRelais: Contexte = base;
const MDP = 'Un-bon-mot-de-passe';
const POSTE = { nom: 'Portable', type: 'navigateur' as const };

let n = 0;
// Une personne neuve, connectée (sans relais : pas de code par e-mail à l'entrée), avec ou sans le code du téléphone.
async function personne(options: { code?: boolean; cabinet?: boolean } = {}) {
  const email = `compte${++n}@exemple.tn`;
  const r = await inscrire(base, email, `Compte ${n}`, MDP);
  if (!r.ok) throw new Error(String(r.motif));
  await enTantQue(pool, r.utilisateur, (tx) => tx.query(`select socle.creer_entreprise('Société ${n}')`));
  const c = await connecter(sansRelais, { email, motDePasse: MDP, appareil: POSTE });
  if (c.etat !== 'connecte') throw new Error('connexion attendue');
  const qui = await quiEst(sansRelais, c.jeton) as Qui;
  let secret = '';
  let secours: string[] = [];
  if (options.code) ({ secret, codesDeSecours: secours } = await mettreEnPlaceCode(sansRelais, qui, 'application') as { secret: string; codesDeSecours: string[] });
  if (options.cabinet) await enTantQue(pool, r.utilisateur, (tx) => tx.query(`select * from socle.creer_cabinet('Cabinet ${n}')`));
  return { email, id: r.utilisateur, qui, jeton: c.jeton, secret, secours };
}
const codeDe = (secret: string) => codeTotp(depuisBase32(secret), horloge.getTime());
const methode = async (id: string) => (await admin.query('select code_methode m from socle.utilisateur where id = $1', [id])).rows[0].m as string | null;

beforeAll(async () => { await admin.connect(); });
afterAll(async () => { await admin.end(); await pool.end(); });

// Se connecter depuis un appareil neuf avec un code (du téléphone, ou de secours) : l'état final.
async function entrerAvec(email: string, code: string) {
  const c = await connecter(sansRelais, { email, motDePasse: MDP, appareil: { nom: `Neuf ${++n}`, type: 'navigateur' } });
  if (c.etat !== 'code') return c.etat;
  return (await validerCode(sansRelais, { defi: c.defi, code })).etat;
}
const faux = (bon: string) => (bon === '000000' ? '111111' : '000000');

describe('activer le code du téléphone en deux temps (0076 § 1 bis)', () => {
  it('rien ne change avant le premier code juste : une activation abandonnée ne ferme pas la porte', async () => {
    const p = await personne();
    const r = await preparerCode(ctx, p.qui);
    if (!r.ok) throw new Error('préparation attendue');
    expect(r.codesDeSecours).toHaveLength(10);
    expect(r.adresseApplication).toBe(`otpauth://totp/${encodeURIComponent(`SkanFact:${p.email}`)}?secret=${r.cle}&issuer=SkanFact&digits=6&period=30`);
    // La page fermée ici : la personne entre toujours avec son seul mot de passe.
    expect(await methode(p.id)).toBeNull();
    expect(await entrerAvec(p.email, '')).toBe('connecte');
    expect(await activerCode(ctx, p.qui, faux(codeDe(r.cle)))).toMatchObject({ ok: false, champ: 'code' });
    expect(await methode(p.id)).toBeNull();
    expect(await activerCode(ctx, p.qui, codeDe(r.cle))).toEqual({ ok: true });
    expect(await methode(p.id)).toBe('application');
    expect((await admin.query(`select count(*)::int n from socle.audit where utilisateur = $1 and geste = 'compte.code.activer'`, [p.id])).rows[0].n).toBe(1);
    // Désormais, un appareil neuf demande le code ; les codes de secours montrés à la préparation sont les bons.
    avancer(1);
    expect(await entrerAvec(p.email, faux(codeDe(r.cle)))).toBe('refuse');
    expect(await entrerAvec(p.email, r.codesDeSecours[3] ?? '')).toBe('connecte');
  });

  it('une page rechargée garde le même secret, avec de nouveaux codes de secours ; après une heure, on recommence', async () => {
    const p = await personne();
    const r1 = await preparerCode(ctx, p.qui);
    const r2 = await preparerCode(ctx, p.qui);
    if (!r1.ok || !r2.ok) throw new Error('préparation attendue');
    expect(r2.cle).toBe(r1.cle);
    expect(r2.codesDeSecours.some((c) => r1.codesDeSecours.includes(c))).toBe(false);
    expect(await activerCode(ctx, p.qui, codeDe(r2.cle))).toEqual({ ok: true });
    avancer(1);
    expect(await entrerAvec(p.email, r1.codesDeSecours[0] ?? '')).toBe('refuse');
    expect(await entrerAvec(p.email, r2.codesDeSecours[0] ?? '')).toBe('connecte');

    const q = await personne();
    const r = await preparerCode(ctx, q.qui);
    if (!r.ok) throw new Error('préparation attendue');
    avancer(61);
    expect(await activerCode(ctx, q.qui, codeDe(r.cle))).toEqual({ ok: false, motif: expect.objectContaining({ cle: 'compte.code_attente_perimee' }) });
    expect(await methode(q.id)).toBeNull();
    // Recommencer donne un secret neuf.
    const neuf = await preparerCode(ctx, q.qui);
    expect(neuf.ok && neuf.cle !== r.cle).toBe(true);
  });

  it('qui a déjà un code prouve l\'actuel avant d\'en préparer un autre (changer de téléphone) ; un comptable de cabinet le peut', async () => {
    const p = await personne({ code: true, cabinet: true });
    expect(await preparerCode(ctx, p.qui)).toMatchObject({ ok: false, champ: 'code', motif: expect.objectContaining({ cle: 'compte.code_actuel_manque' }) });
    expect(await preparerCode(ctx, p.qui, faux(codeDe(p.secret)))).toMatchObject({ ok: false, champ: 'code' });
    const r = await preparerCode(ctx, p.qui, codeDe(p.secret));
    if (!r.ok) throw new Error('préparation attendue');
    expect(r.cle).not.toBe(p.secret);
    // L'ancien téléphone vaut encore tant que le nouveau n'a pas donné son premier code.
    avancer(1);
    expect(await entrerAvec(p.email, codeDe(p.secret))).toBe('connecte');
    avancer(1);
    expect(await activerCode(ctx, p.qui, codeDe(r.cle))).toEqual({ ok: true });
    avancer(1);
    expect(await entrerAvec(p.email, codeDe(p.secret))).toBe('refuse');
    avancer(1);
    expect(await entrerAvec(p.email, codeDe(r.cle))).toBe('connecte');
  });

  it('le code posé d\'un coup (gardé pour l\'API) ne remplace pas un code actif : une session volée ne met pas le sien', async () => {
    const p = await personne({ code: true });
    await expect(mettreEnPlaceCode(sansRelais, p.qui, 'application')).rejects.toThrow(/déjà activé/);
    avancer(1);
    expect(await entrerAvec(p.email, codeDe(p.secret))).toBe('connecte');
  });

  it('un comptable de cabinet sans code : l\'activation lève la session réduite', async () => {
    const p = await personne({ cabinet: true });
    const c = await connecter(sansRelais, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (c.etat !== 'connecte') throw new Error('connexion attendue');
    const qui = await quiEst(sansRelais, c.jeton) as Qui;
    expect(qui.codeAConfigurer).toBe(true);
    const r = await preparerCode(ctx, qui);
    if (!r.ok) throw new Error('préparation attendue');
    expect((await quiEst(sansRelais, c.jeton))?.codeAConfigurer).toBe(true);
    expect(await activerCode(ctx, qui, codeDe(r.cle))).toEqual({ ok: true });
    expect((await quiEst(sansRelais, c.jeton))?.codeAConfigurer).toBe(false);
  });
});

describe('retirer le code du téléphone (Paramètres → Ton compte)', () => {
  it('il faut le code du moment ou un code de secours ; un e-mail le confirme, qui ne porte que l\'adresse de l\'application', async () => {
    const p = await personne({ code: true });
    // Le mot de passe seul ne suffit pas, ni un code faux.
    expect(await retirerCode(ctx, p.qui, 'pas-un-code')).toMatchObject({ ok: false, champ: 'code' });
    expect(await retirerCode(ctx, p.qui, codeDe(p.secret) === '000000' ? '111111' : '000000')).toMatchObject({ ok: false, champ: 'code' });
    expect(await methode(p.id)).toBe('application');
    const avant = courriels.length;
    expect(await retirerCode(ctx, p.qui, codeDe(p.secret))).toEqual({ ok: true, confirme: true });
    expect(await methode(p.id)).toBeNull();
    expect((await admin.query('select count(*)::int n from socle.code_secours where utilisateur = $1', [p.id])).rows[0].n).toBe(0);
    expect(courriels.slice(avant)).toEqual([{ a: p.email, objet: 'Le code du téléphone a été désactivé', texte: expect.stringContaining('https://app.exemple.tn') }]);
    expect(courriels.at(-1)?.texte).not.toMatch(/Compte \d|Société/);
    // Tracé au nom de la personne.
    expect((await admin.query(`select count(*)::int n from socle.audit where utilisateur = $1 and geste = 'compte.code.retirer'`, [p.id])).rows[0].n).toBe(1);
    // Et la connexion suivante ne le demande plus.
    expect((await connecter(sansRelais, { email: p.email, motDePasse: MDP, appareil: { nom: 'Autre', type: 'navigateur' } })).etat).toBe('connecte');
  });

  it('un code de secours suffit aussi, et sans relais rien ne part', async () => {
    const p = await personne({ code: true });
    const avant = courriels.length;
    expect(await retirerCode(sansRelais, p.qui, (p.secours[2] ?? '').toLowerCase())).toEqual({ ok: true, confirme: false });
    expect(await methode(p.id)).toBeNull();
    expect(courriels).toHaveLength(avant);
  });

  it('un comptable de cabinet ne retire pas son code : il lui est exigé', async () => {
    const p = await personne({ code: true, cabinet: true });
    await expect(retirerCode(ctx, p.qui, codeDe(p.secret))).rejects.toThrow(/exigé de chaque comptable d'un cabinet/);
    expect(await methode(p.id)).toBe('application');
  });

  it('les erreurs comptent comme à la connexion : une attente qui s\'allonge, jamais un blocage', async () => {
    const p = await personne({ code: true });
    for (let i = 0; i < 4; i++) expect(await retirerCode(ctx, p.qui, 'ZZZZ-ZZZZ')).toMatchObject({ ok: false });
    expect(await retirerCode(ctx, p.qui, 'ZZZZ-ZZZZ')).toMatchObject({ ok: false, attendre: true });
    // Pendant l'attente, même le bon code attend.
    expect(await retirerCode(ctx, p.qui, codeDe(p.secret))).toMatchObject({ ok: false, attendre: true });
    avancer(2);
    expect(await retirerCode(ctx, p.qui, codeDe(p.secret))).toMatchObject({ ok: true });
  });
});

describe('de nouveaux codes de secours', () => {
  it('avec le code du moment ; les anciens ne valent plus, les nouveaux remplacent le code une fois', async () => {
    const p = await personne({ code: true });
    const r = await nouveauxCodesDeSecours(ctx, p.qui, codeDe(p.secret));
    if (!r.ok) throw new Error('codes attendus');
    expect(r.codes).toHaveLength(10);
    expect(r.codes.some((c) => p.secours.includes(c))).toBe(false);
    const essai = async (code: string) => {
      const c = await connecter(sansRelais, { email: p.email, motDePasse: MDP, appareil: { nom: 'Téléphone perdu', type: 'telephone' } });
      if (c.etat !== 'code') throw new Error('code attendu');
      return (await validerCode(sansRelais, { defi: c.defi, code })).etat;
    };
    expect(await essai(p.secours[0] ?? '')).toBe('refuse');
    expect(await essai(r.codes[0] ?? '')).toBe('connecte');
  });
});

describe('changer son mot de passe', () => {
  it('l\'actuel d\'abord, puis la même règle qu\'à l\'inscription ; les autres sessions se ferment, pas celle-ci', async () => {
    const p = await personne();
    const autre = await connecter(sansRelais, { email: p.email, motDePasse: MDP, appareil: { nom: 'Tablette', type: 'navigateur' } });
    if (autre.etat !== 'connecte') throw new Error('connexion attendue');
    expect(await changerMotDePasse(ctx, p.qui, 'pas-le-bon-du-tout', 'Un-nouveau-mot-de-passe')).toMatchObject({ ok: false, champ: 'actuel' });
    expect(await changerMotDePasse(ctx, p.qui, MDP, 'court')).toMatchObject({ ok: false, champ: 'nouveau' });
    expect(await changerMotDePasse(ctx, p.qui, MDP, 'Un-nouveau-mot-de-passe')).toEqual({ ok: true });
    expect(await quiEst(sansRelais, p.jeton)).not.toBeNull();
    expect(await quiEst(sansRelais, autre.jeton)).toBeNull();
    expect((await connecter(sansRelais, { email: p.email, motDePasse: MDP, appareil: POSTE })).etat).toBe('refuse');
    expect((await connecter(sansRelais, { email: p.email, motDePasse: 'Un-nouveau-mot-de-passe', appareil: POSTE })).etat).toBe('connecte');
  });
});

describe('changer d\'adresse', () => {
  it('avec un relais : un code à la nouvelle adresse, puis elle remplace l\'ancienne, prouvée ; l\'ancienne est prévenue sans nommer la nouvelle', async () => {
    const p = await personne();
    const nouvelle = `nouvelle${n}@exemple.tn`;
    expect(await demanderChangementAdresse(ctx, p.qui, nouvelle, 'pas-le-bon-du-tout')).toMatchObject({ ok: false, champ: 'motDePasse' });
    expect(await demanderChangementAdresse(ctx, p.qui, p.email.toUpperCase(), MDP)).toMatchObject({ ok: false, champ: 'adresse' });
    const r = await demanderChangementAdresse(ctx, p.qui, nouvelle, MDP);
    if (!r.ok || !r.demande) throw new Error('demande attendue');
    const envoi = courriels.at(-1);
    const code = /\n\n(\d{6})\n\n/.exec(envoi?.texte ?? '')?.[1] ?? '';
    expect(envoi).toEqual({ a: nouvelle, objet: `Ton code SkanFact : ${code}`, texte: expect.stringContaining('nouvelle adresse') });
    // Rien ne change avant le code.
    expect((await admin.query('select email from socle.utilisateur where id = $1', [p.id])).rows[0].email).toBe(p.email);
    expect(await confirmerChangementAdresse(ctx, p.qui, r.demande, code === '000000' ? '111111' : '000000')).toMatchObject({ ok: false, champ: 'code' });
    expect(await confirmerChangementAdresse(ctx, p.qui, r.demande, code)).toEqual({ ok: true });
    const u = (await admin.query('select email, adresse_verifiee_le from socle.utilisateur where id = $1', [p.id])).rows[0];
    expect(u.email).toBe(nouvelle);
    expect(u.adresse_verifiee_le).not.toBeNull();
    const avis = courriels.at(-1);
    expect(avis?.a).toBe(p.email);
    expect(JSON.stringify(avis)).not.toContain(nouvelle);
    // On se connecte avec la nouvelle adresse.
    expect((await connecter(sansRelais, { email: nouvelle, motDePasse: MDP, appareil: POSTE })).etat).toBe('connecte');
  });

  it('sans relais : on ne sait rien envoyer, l\'adresse change tout de suite et reste à vérifier', async () => {
    const p = await personne();
    // Une adresse déjà prouvée : la nouvelle, elle, ne l'est pas.
    await admin.query('update socle.utilisateur set adresse_verifiee_le = $1 where id = $2', [horloge, p.id]);
    const nouvelle = `corrigee${n}@exemple.tn`;
    expect(await demanderChangementAdresse(sansRelais, p.qui, nouvelle, MDP)).toEqual({ ok: true, demande: null });
    const u = (await admin.query('select email, adresse_verifiee_le from socle.utilisateur where id = $1', [p.id])).rows[0];
    expect(u).toEqual({ email: nouvelle, adresse_verifiee_le: null });
  });

  it('une adresse déjà celle d\'un autre compte se refuse', async () => {
    const p = await personne();
    const autre = await personne();
    await expect(demanderChangementAdresse(ctx, p.qui, autre.email, MDP)).rejects.toThrow(/déjà celle d'un autre compte/);
  });
});

describe('vérifier son adresse sans en changer (0077)', () => {
  const verifiee = async (id: string) => (await admin.query('select adresse_verifiee_le is not null v from socle.utilisateur where id = $1', [id])).rows[0].v as boolean;
  const traces = async (id: string, geste: string) => (await admin.query('select count(*)::int n from socle.audit where utilisateur = $1 and geste = $2', [id, geste])).rows[0].n as number;

  it('qui a le code du téléphone ne reçoit jamais de code à la connexion : un code part à son adresse et la prouve, tracé « vérifiée », sans avis de changement', async () => {
    const p = await personne({ code: true });
    expect(await verifiee(p.id)).toBe(false);
    // Sans relais, rien ne part : on le dit.
    expect(await demanderVerificationAdresse(sansRelais, p.qui)).toMatchObject({ ok: false, motif: expect.anything() });
    const r = await demanderVerificationAdresse(ctx, p.qui);
    if (!r.ok) throw new Error('demande attendue');
    const envoi = courriels.at(-1);
    const code = /\n\n(\d{6})\n\n/.exec(envoi?.texte ?? '')?.[1] ?? '';
    expect(envoi).toEqual({ a: p.email, objet: `Ton code SkanFact : ${code}`, texte: expect.stringContaining('vérifier ton adresse e-mail') });
    expect(await confirmerVerificationAdresse(ctx, p.qui, r.demande, faux(code))).toMatchObject({ ok: false, champ: 'code' });
    expect(await verifiee(p.id)).toBe(false);
    expect(await confirmerVerificationAdresse(ctx, p.qui, r.demande, code)).toEqual({ ok: true });
    expect(await verifiee(p.id)).toBe(true);
    expect([await traces(p.id, 'compte.adresse.verifier'), await traces(p.id, 'compte.adresse.changer')]).toEqual([1, 0]);
    expect(courriels.at(-1)).toBe(envoi);
    // Une adresse déjà prouvée ne se redemande pas.
    await expect(demanderVerificationAdresse(ctx, p.qui)).rejects.toThrow(/déjà vérifiée/);
  });

  it('le code ne prouve que l\'adresse où il est parti : changée entre-temps, la demande ne vaut plus ; cinq erreurs, et elle ne vaut plus non plus ; trois demandes par heure', async () => {
    const p = await personne();
    const r = await demanderVerificationAdresse(ctx, p.qui);
    if (!r.ok) throw new Error('demande attendue');
    const code = /\n\n(\d{6})\n\n/.exec(courriels.at(-1)?.texte ?? '')?.[1] ?? '';
    expect(await demanderChangementAdresse(sansRelais, p.qui, `ailleurs${n}@exemple.tn`, MDP)).toEqual({ ok: true, demande: null });
    await expect(confirmerVerificationAdresse(ctx, p.qui, r.demande, code)).rejects.toThrow(/plus valable/);
    expect(await verifiee(p.id)).toBe(false);
    const q = await personne();
    const s = await demanderVerificationAdresse(ctx, q.qui);
    if (!s.ok) throw new Error('demande attendue');
    const bon = /\n\n(\d{6})\n\n/.exec(courriels.at(-1)?.texte ?? '')?.[1] ?? '';
    for (let i = 0; i < 5; i++) expect(await confirmerVerificationAdresse(ctx, q.qui, s.demande, faux(bon))).toMatchObject({ ok: false });
    await expect(confirmerVerificationAdresse(ctx, q.qui, s.demande, bon)).rejects.toThrow(/plus valable/);
    expect(await verifiee(q.id)).toBe(false);
    // Un nouveau code se redemande : trois demandes par heure, comptées avec celles d'un changement d'adresse.
    expect(await demanderVerificationAdresse(ctx, q.qui)).toMatchObject({ ok: true });
    expect(await demanderVerificationAdresse(ctx, q.qui)).toMatchObject({ ok: true });
    await expect(demanderVerificationAdresse(ctx, q.qui)).rejects.toThrow(/trois demandes/);
  });
});
