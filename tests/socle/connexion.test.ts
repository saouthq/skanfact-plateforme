// Se connecter (03 § 6), joué contre la vraie base : mot de passe, attente après des erreurs, code
// par SMS ou par application, codes de secours, appareils reconnus, sessions, révocation.

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { connecter, corrigerAdresse, deconnecter, inscrire, mettreEnPlaceCode, quiEst, renvoyerCode, revoquerAppareil, validerCode, type Contexte } from '../../serveur/connexion.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { listeDepuisFichier, verifierPolitique } from '../../serveur/mot-de-passe.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const listeVolee = listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt'));

let horloge = new Date('2026-10-01T08:00:00Z');
const avancer = (minutes: number) => { horloge = new Date(horloge.getTime() + minutes * 60_000); };
const envoyes: { telephone: string; texte: string }[] = [];
const ctx: Contexte = {
  pool, listeVolee, maintenant: () => horloge,
  sms: { envoyer: async (telephone, texte) => { envoyes.push({ telephone, texte }); } },
};
// Le même serveur, qui sait envoyer des e-mails (0076) : ce qui partirait chez le relais est gardé ici.
const courriels: Courriel[] = [];
const ctxCourriel: Contexte = { ...ctx, courriel: { envoi: { envoyer: async (c) => { courriels.push(c); } }, adresse: () => 'https://app.exemple.tn' } };
const codeDuCourriel = () => /\n\n(\d{6})\n\n/.exec(courriels.at(-1)?.texte ?? '')?.[1] ?? '';
const MDP = 'Un-bon-mot-de-passe';
const POSTE = { nom: 'Portable', type: 'bureau' as const };

// Une personne neuve à chaque test : les tests ne se marchent pas dessus.
let n = 0;
async function personne(options: { proprietaire?: boolean; telephone?: string } = {}) {
  const email = `personne${++n}@exemple.tn`;
  const r = await inscrire(ctx, email, `Personne ${n}`, MDP);
  if (!r.ok) throw new Error(String(r.motif));
  if (options.telephone) await admin.query('update socle.utilisateur set telephone = $1 where id = $2', [options.telephone, r.utilisateur]);
  if (options.proprietaire) await enTantQue(pool, r.utilisateur, (tx) => tx.query(`select socle.creer_entreprise('Société ${n}')`));
  return { email, id: r.utilisateur };
}
// La session derrière un jeton (le test tombe si elle n'existe pas).
const sessionDe = async (jeton: string) => { const q = await quiEst(ctx, jeton); if (!q) throw new Error('session attendue'); return q; };
const dernierCode = () => /(\d{3}) (\d{3})$/.exec(envoyes.at(-1)?.texte ?? '')?.slice(1).join('') ?? '';

beforeAll(async () => { await admin.connect(); });
afterAll(async () => { await admin.end(); await pool.end(); });

describe('le mot de passe', () => {
  it('10 caractères au moins, et jamais un mot de passe déjà volé', () => {
    expect(verifierPolitique('court', listeVolee).ok).toBe(false);
    const vole = verifierPolitique('motdepasse123', listeVolee);
    expect(vole.ok || String(vole.motif)).toMatch(/déjà volés/);
    expect(verifierPolitique('Un-bon-mot-de-passe', listeVolee)).toEqual({ ok: true });
  });

  it('il n\'est gardé qu\'en empreinte Argon2id', async () => {
    const p = await personne();
    const e = (await admin.query('select empreinte_mot_de_passe e from socle.utilisateur where id = $1', [p.id])).rows[0].e;
    expect(e).toMatch(/^\$argon2id\$/);
    expect(e).not.toContain(MDP);
  });

  it('une adresse inconnue et un mauvais mot de passe reçoivent la même réponse', async () => {
    const p = await personne();
    const inconnue = await connecter(ctx, { email: 'personne@nulle-part.tn', motDePasse: MDP, appareil: POSTE });
    const mauvais = await connecter(ctx, { email: p.email, motDePasse: 'pas-le-bon-du-tout', appareil: POSTE });
    expect(inconnue).toEqual(mauvais);
    expect(mauvais.etat).toBe('refuse');
  });

  it('personne ne voit l\'empreinte d\'un autre, même un collègue, et on ne se donne pas un rôle', async () => {
    const p = await personne({ proprietaire: true });
    await expect(enTantQue(pool, p.id, (tx) => tx.query('select empreinte_mot_de_passe from socle.utilisateur'))).rejects.toThrow(/permission denied/);
    await expect(enTantQue(pool, p.id, (tx) => tx.query(`update socle.membre set roles = '{proprietaire,paie}'`))).rejects.toThrow(/permission denied/);
  });
});

describe('les erreurs : une attente qui s\'allonge, jamais un blocage', () => {
  it('après 5 erreurs, 1 minute ; puis 5, puis 15, puis 60 au plus ; et le bon mot de passe passe après l\'attente', async () => {
    const p = await personne();
    const essai = (mdp: string) => connecter(ctx, { email: p.email, motDePasse: mdp, appareil: POSTE });
    for (let i = 0; i < 4; i++) expect((await essai('faux-faux-faux')).etat).toBe('refuse');
    const cinquieme = await essai('faux-faux-faux');
    expect(cinquieme.etat).toBe('attendre');
    // Pendant l'attente, même le bon mot de passe attend (sinon l'attente ne protégerait rien).
    expect((await essai(MDP)).etat).toBe('attendre');
    const attentes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await (async () => { avancer(61); return essai('faux-faux-faux'); })();
      if (r.etat === 'attendre') attentes.push(Math.round((r.jusqua.getTime() - horloge.getTime()) / 60_000));
    }
    expect(attentes).toEqual([5, 15, 60, 60, 60]);
    avancer(61);
    const bon = await essai(MDP);
    expect(bon.etat).toBe('connecte');
    // Et le compteur repart de zéro.
    expect((await essai('faux-faux-faux')).etat).toBe('refuse');
  });
});

describe('le code sur le téléphone', () => {
  it('sans rôle qui l\'exige ni code en place : connecté tout de suite', async () => {
    const p = await personne();
    const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    expect(r).toMatchObject({ etat: 'connecte', codeAConfigurer: false });
    if (r.etat !== 'connecte') return;
    expect((await quiEst(ctx, r.jeton))?.utilisateur).toBe(p.id);
  });

  it('un propriétaire entre sans code du téléphone : recommandé, jamais imposé (09/10/2026)', async () => {
    const p = await personne({ proprietaire: true, telephone: '+216 20 000 009' });
    const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    expect(r).toMatchObject({ etat: 'connecte', codeAConfigurer: false });
    if (r.etat !== 'connecte') return;
    expect((await sessionDe(r.jeton)).codeAConfigurer).toBe(false);
    expect((await enTantQue(pool, p.id, (tx) => tx.query('select socle.code_manquant() m'))).rows[0].m).toBe(false);
  });

  it('un comptable de cabinet sans code : une session qui ne sert qu\'à le mettre en place', async () => {
    const p = await personne({ telephone: '+216 20 000 001' });
    await enTantQue(pool, p.id, (tx) => tx.query(`select * from socle.creer_cabinet('Cabinet ${n}')`));
    const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    expect(r).toMatchObject({ etat: 'connecte', codeAConfigurer: true });
    if (r.etat !== 'connecte') return;
    const qui = await sessionDe(r.jeton);
    expect(qui.codeAConfigurer).toBe(true);
    const { codesDeSecours } = await mettreEnPlaceCode(ctx, qui, 'sms');
    expect(codesDeSecours).toHaveLength(10);
    expect(new Set(codesDeSecours).size).toBe(10);
    expect((await quiEst(ctx, r.jeton))?.codeAConfigurer).toBe(false);
  });

  it('par SMS : seuls le numéro et le code partent ; un mauvais code est refusé ; un code ne sert qu\'une fois', async () => {
    const p = await personne({ proprietaire: true, telephone: '+216 20 000 002' });
    const r0 = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r0.etat === 'connecte') await mettreEnPlaceCode(ctx, await sessionDe(r0.jeton), 'sms');
    const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: { nom: 'Autre poste', type: 'navigateur' } });
    expect(r).toMatchObject({ etat: 'code', methode: 'sms' });
    if (r.etat !== 'code') return;
    expect(envoyes.at(-1)).toEqual({ telephone: '+216 20 000 002', texte: expect.stringMatching(/^Ton code SkanFact : \d{3} \d{3}$/) });
    const code = dernierCode();
    const faux = code === '000000' ? '111111' : '000000';
    expect((await validerCode(ctx, { defi: r.defi, code: faux })).etat).toBe('refuse');
    const ok = await validerCode(ctx, { defi: r.defi, code: `${code.slice(0, 3)} ${code.slice(3)}` });
    expect(ok.etat).toBe('connecte');
    expect((await validerCode(ctx, { defi: r.defi, code })).etat).toBe('refuse');
  });

  it('un code trop vieux (10 minutes) n\'est plus valable', async () => {
    const p = await personne({ proprietaire: true, telephone: '+216 20 000 003' });
    const r0 = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r0.etat === 'connecte') await mettreEnPlaceCode(ctx, await sessionDe(r0.jeton), 'sms');
    const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: { nom: 'Autre', type: 'navigateur' } });
    if (r.etat !== 'code') throw new Error('code attendu');
    avancer(11);
    expect((await validerCode(ctx, { defi: r.defi, code: dernierCode() })).etat).toBe('refuse');
  });

  it('par une application d\'authentification', async () => {
    const p = await personne({ proprietaire: true });
    const r0 = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r0.etat !== 'connecte') throw new Error('connexion attendue');
    const { secret, adresseApplication } = await mettreEnPlaceCode(ctx, await sessionDe(r0.jeton), 'application');
    expect(adresseApplication).toMatch(/^otpauth:\/\/totp\/SkanFact/);
    const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: { nom: 'Autre', type: 'navigateur' } });
    expect(r).toMatchObject({ etat: 'code', methode: 'application' });
    if (r.etat !== 'code') return;
    const code = codeTotp(depuisBase32(secret ?? ''), horloge.getTime());
    expect((await validerCode(ctx, { defi: r.defi, code })).etat).toBe('connecte');
  });

  it('un code de secours remplace le code, une seule fois', async () => {
    const p = await personne({ proprietaire: true, telephone: '+216 20 000 004' });
    const r0 = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r0.etat !== 'connecte') throw new Error('connexion attendue');
    const { codesDeSecours } = await mettreEnPlaceCode(ctx, await sessionDe(r0.jeton), 'sms');
    const secours = codesDeSecours[3] ?? '';
    const essai = async () => {
      const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: { nom: 'Téléphone perdu', type: 'telephone' } });
      if (r.etat !== 'code') throw new Error('code attendu');
      return validerCode(ctx, { defi: r.defi, code: secours.toLowerCase() });
    };
    expect((await essai()).etat).toBe('connecte');
    expect((await essai()).etat).toBe('refuse');
  });
});

describe('le code par e-mail (0076 ; seulement si le serveur sait envoyer un e-mail)', () => {
  it('à la première connexion, l\'adresse se vérifie par un code reçu par e-mail : seuls l\'adresse et le code partent', async () => {
    const p = await personne({ proprietaire: true });
    // Sans relais d'e-mails, rien ne se demande par e-mail.
    expect((await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE })).etat).toBe('connecte');
    const avant = courriels.length;
    const r = await connecter(ctxCourriel, { email: p.email.toUpperCase(), motDePasse: MDP, appareil: POSTE });
    expect(r).toMatchObject({ etat: 'code', methode: 'courriel', raison: 'inscription', adresse: p.email });
    if (r.etat !== 'code') return;
    expect(courriels).toHaveLength(avant + 1);
    const c = courriels.at(-1);
    const code = codeDuCourriel();
    expect(c).toEqual({ a: p.email, objet: `Ton code SkanFact : ${code}`, texte: expect.stringContaining('vérifier ton adresse') });
    // Ni le nom de la personne, ni son entreprise.
    expect(JSON.stringify(c)).not.toMatch(new RegExp(`Personne ${p.email.match(/\d+/)?.[0]}\b|Société`));
    // Un code faux, puis un code de secours : refusés (pas de code du téléphone, donc pas de codes de secours).
    expect((await validerCode(ctxCourriel, { defi: r.defi, code: code === '000000' ? '111111' : '000000' })).etat).toBe('refuse');
    expect((await validerCode(ctxCourriel, { defi: r.defi, code: 'ABCD-EFGH' })).etat).toBe('refuse');
    const ok = await validerCode(ctxCourriel, { defi: r.defi, code });
    expect(ok.etat).toBe('connecte');
    if (ok.etat !== 'connecte') return;
    expect((await admin.query('select adresse_verifiee_le v from socle.utilisateur where id = $1', [p.id])).rows[0].v).not.toBeNull();
    // L'appareil est reconnu : la connexion suivante n'en demande plus.
    expect((await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: { ...POSTE, id: r.appareil } })).etat).toBe('connecte');
  });

  it('sans code du téléphone, un appareil inconnu (ou le poste d\'un autre) demande un code par e-mail ; un appareil reconnu, non', async () => {
    const p = await personne();
    const r0 = await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r0.etat !== 'code') throw new Error('code attendu');
    const ok0 = await validerCode(ctxCourriel, { defi: r0.defi, code: codeDuCourriel() });
    if (ok0.etat !== 'connecte' || !ok0.appareil) throw new Error('connexion attendue');
    const ailleurs = await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: { nom: 'Téléphone', type: 'telephone' } });
    expect(ailleurs).toMatchObject({ etat: 'code', methode: 'courriel', raison: 'appareil' });
    expect(courriels.at(-1)?.texte).toMatch(/nouvel appareil/);
    expect((await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: { ...POSTE, id: ok0.appareil }, posteDUnAutre: true })).etat).toBe('code');
    expect((await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: { ...POSTE, id: ok0.appareil } })).etat).toBe('connecte');
    // Trente et un jours plus tard, l'appareil n'est plus reconnu.
    avancer(60 * 24 * 31);
    expect((await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: { ...POSTE, id: ok0.appareil } })).etat).toBe('code');
  });

  it('qui a le code du téléphone le tape : aucun e-mail ne part', async () => {
    const p = await personne({ proprietaire: true });
    const r0 = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r0.etat !== 'connecte') throw new Error('connexion attendue');
    await mettreEnPlaceCode(ctx, await sessionDe(r0.jeton), 'application');
    const avant = courriels.length;
    const r = await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: { nom: 'Autre', type: 'navigateur' } });
    expect(r).toMatchObject({ etat: 'code', methode: 'application' });
    expect(courriels).toHaveLength(avant);
  });

  it('renvoyer le code : pas avant 30 secondes, cinq envois au plus ; le nouveau remplace l\'ancien, et un code de 15 minutes ne vaut plus', async () => {
    const p = await personne();
    const r = await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r.etat !== 'code') throw new Error('code attendu');
    const premier = codeDuCourriel();
    expect(await renvoyerCode(ctxCourriel, r.defi)).toMatchObject({ ok: false });
    for (let i = 0; i < 4; i++) {
      avancer(0.6);
      expect(await renvoyerCode(ctxCourriel, r.defi)).toEqual({ ok: true });
    }
    avancer(0.6);
    expect(await renvoyerCode(ctxCourriel, r.defi)).toMatchObject({ ok: false });
    const dernier = codeDuCourriel();
    expect(courriels.at(-1)?.a).toBe(p.email);
    if (premier !== dernier) expect((await validerCode(ctxCourriel, { defi: r.defi, code: premier })).etat).toBe('refuse');
    expect((await validerCode(ctxCourriel, { defi: r.defi, code: dernier })).etat).toBe('connecte');
    // Un autre défi, laissé 15 minutes : son code ne vaut plus.
    const r2 = await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: { nom: 'Tablette', type: 'navigateur' } });
    if (r2.etat !== 'code') throw new Error('code attendu');
    avancer(16);
    expect((await validerCode(ctxCourriel, { defi: r2.defi, code: codeDuCourriel() })).etat).toBe('refuse');
  });

  it('« Ce n\'est pas ton adresse ? La corriger » : pendant le défi de l\'inscription seulement, le code part à la nouvelle', async () => {
    const p = await personne();
    const autre = await personne();
    const r = await connecter(ctxCourriel, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r.etat !== 'code') throw new Error('code attendu');
    const ancien = codeDuCourriel();
    const nouvelle = `Corrigee${n}@Exemple.tn`;
    // L'adresse d'un autre compte se refuse.
    await expect(corrigerAdresse(ctxCourriel, r.defi, autre.email)).rejects.toThrow(/déjà celle d'un autre compte/);
    expect(await corrigerAdresse(ctxCourriel, r.defi, nouvelle)).toEqual({ ok: true, adresse: nouvelle.toLowerCase() });
    expect(courriels.at(-1)).toMatchObject({ a: nouvelle.toLowerCase(), texte: expect.stringContaining('vérifier ton adresse') });
    expect((await admin.query('select email from socle.utilisateur where id = $1', [p.id])).rows[0].email).toBe(nouvelle.toLowerCase());
    // L'ancien code ne vaut plus ; le nouveau prouve la nouvelle adresse.
    if (ancien !== codeDuCourriel()) expect((await validerCode(ctxCourriel, { defi: r.defi, code: ancien })).etat).toBe('refuse');
    expect((await validerCode(ctxCourriel, { defi: r.defi, code: codeDuCourriel() })).etat).toBe('connecte');
    expect((await admin.query('select adresse_verifiee_le v from socle.utilisateur where id = $1', [p.id])).rows[0].v).not.toBeNull();
    // Une adresse prouvée ne se corrige plus ainsi (le défi d'un nouvel appareil ne le permet pas).
    const ailleurs = await connecter(ctxCourriel, { email: nouvelle, motDePasse: MDP, appareil: { nom: 'Téléphone', type: 'telephone' } });
    if (ailleurs.etat !== 'code') throw new Error('code attendu');
    expect(await corrigerAdresse(ctxCourriel, ailleurs.defi, `encore${n}@exemple.tn`)).toMatchObject({ ok: false });
    expect((await admin.query('select email from socle.utilisateur where id = $1', [p.id])).rows[0].email).toBe(nouvelle.toLowerCase());
  });
});

describe('les appareils et les sessions', () => {
  async function proprietaireAvecCode() {
    const p = await personne({ proprietaire: true, telephone: '+216 20 000 010' });
    const r0 = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r0.etat !== 'connecte') throw new Error('connexion attendue');
    await mettreEnPlaceCode(ctx, await sessionDe(r0.jeton), 'sms');
    const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: POSTE });
    if (r.etat !== 'code') throw new Error('code attendu');
    const ok = await validerCode(ctx, { defi: r.defi, code: dernierCode() });
    if (ok.etat !== 'connecte' || !ok.appareil) throw new Error('connexion attendue');
    return { ...p, appareil: ok.appareil, jeton: ok.jeton };
  }

  it('un appareil reconnu ne redemande le code qu\'après 30 jours', async () => {
    const p = await proprietaireAvecCode();
    const avecLuiMeme = () => connecter(ctx, { email: p.email, motDePasse: MDP, appareil: { ...POSTE, id: p.appareil } });
    avancer(60 * 24 * 29);
    expect((await avecLuiMeme()).etat).toBe('connecte');
    avancer(60 * 24 * 2);
    expect((await avecLuiMeme()).etat).toBe('code');
  });

  it('sur le poste d\'un autre : le code est toujours demandé, et la session tombe après 30 minutes d\'inaction', async () => {
    const p = await proprietaireAvecCode();
    const r = await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: { ...POSTE, id: p.appareil }, posteDUnAutre: true });
    expect(r.etat).toBe('code');
    if (r.etat !== 'code') return;
    const ok = await validerCode(ctx, { defi: r.defi, code: dernierCode(), posteDUnAutre: true });
    if (ok.etat !== 'connecte') throw new Error('connexion attendue');
    avancer(29);
    expect(await quiEst(ctx, ok.jeton)).not.toBeNull();
    avancer(29);
    expect(await quiEst(ctx, ok.jeton)).not.toBeNull();  // chaque geste repousse l'inaction
    avancer(31);
    expect(await quiEst(ctx, ok.jeton)).toBeNull();
  });

  it('une session ordinaire tombe après 12 heures d\'inaction', async () => {
    const p = await proprietaireAvecCode();
    avancer(60 * 11);
    expect(await quiEst(ctx, p.jeton)).not.toBeNull();
    avancer(60 * 12 + 1);
    expect(await quiEst(ctx, p.jeton)).toBeNull();
  });

  it('se déconnecter ferme la session', async () => {
    const p = await proprietaireAvecCode();
    await deconnecter(ctx, await sessionDe(p.jeton));
    expect(await quiEst(ctx, p.jeton)).toBeNull();
  });

  it('un appareil révoqué perd ses sessions aussitôt, et on ne révoque que les siens', async () => {
    const p = await proprietaireAvecCode();
    const autre = await proprietaireAvecCode();
    const qui = await sessionDe(p.jeton);
    expect(await revoquerAppareil(ctx, qui, autre.appareil)).toBe(false);
    expect(await quiEst(ctx, autre.jeton)).not.toBeNull();
    expect(await revoquerAppareil(ctx, qui, p.appareil)).toBe(true);
    expect(await quiEst(ctx, p.jeton)).toBeNull();
    // Et cet appareil n'est plus reconnu : le code est redemandé.
    expect((await connecter(ctx, { email: p.email, motDePasse: MDP, appareil: { ...POSTE, id: p.appareil } })).etat).toBe('code');
  });

  it('le jeton n\'est gardé qu\'en empreinte', async () => {
    const p = await proprietaireAvecCode();
    const gardes = (await admin.query('select jeton_empreinte from socle.session where utilisateur = $1', [p.id])).rows.map((r) => r.jeton_empreinte);
    expect(gardes).not.toContain(p.jeton);
    expect(gardes.every((g: string) => /^[0-9a-f]{64}$/.test(g))).toBe(true);
  });
});
