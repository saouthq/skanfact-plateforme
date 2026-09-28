// Se connecter (03 § 6), joué contre la vraie base : mot de passe, attente après des erreurs, code
// par SMS ou par application, codes de secours, appareils reconnus, sessions, révocation.

import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { connecter, deconnecter, inscrire, mettreEnPlaceCode, quiEst, revoquerAppareil, validerCode, type Contexte } from '../../serveur/connexion.ts';
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
const MDP = 'Un-bon-mot-de-passe';
const POSTE = { nom: 'Portable', type: 'bureau' as const };

// Une personne neuve à chaque test : les tests ne se marchent pas dessus.
let n = 0;
async function personne(options: { proprietaire?: boolean; telephone?: string } = {}) {
  const email = `personne${++n}@exemple.tn`;
  const r = await inscrire(ctx, email, `Personne ${n}`, MDP);
  if (!r.ok) throw new Error(r.motif);
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
    expect(verifierPolitique('motdepasse123', listeVolee)).toEqual({ ok: false, motif: expect.stringMatching(/déjà volés/) });
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

  it('un propriétaire sans code : une session qui ne sert qu\'à le mettre en place', async () => {
    const p = await personne({ proprietaire: true, telephone: '+216 20 000 001' });
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
