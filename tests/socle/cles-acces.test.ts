// Les clés d'accès (1.390.0 ; serveur/webauthn.ts, serveur/cle-acces.ts, migration 0244), par l'API, avec un appareil
// imité dans le test : une vraie paire de clés (P-256 ou Ed25519), et les octets qu'un navigateur enverrait. Ce que le
// serveur garantit :
//   - ajouter une clé demande le mot de passe actuel, ne sert qu'une fois par défi, et l'adresse du compte est prévenue ;
//   - la même clé ne s'ajoute pas deux fois ;
//   - se connecter avec elle ouvre une session, sans adresse ni mot de passe ;
//   - un défi rejoué, une autre origine, une personne non vérifiée, une signature retouchée, un compteur qui recule, une
//     clé retirée : refusés, sans dire laquelle des raisons ;
//   - sur une adresse IP (où le navigateur refuse les clés), rien ne se propose.

import path from 'node:path';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { lireCbor, verifierAssertion, verifierCreation } from '../../serveur/webauthn.ts';

const ORIGINE = 'https://app.skanfact.test';
const DOMAINE = 'app.skanfact.test';
const MDP = 'Passerelle-des-clés-2026';

// ── Un encodeur CBOR, juste ce qu'il faut pour imiter un appareil ────────────────────────────────────────────────────
type V = number | Buffer | string | V[] | Map<V, V> | boolean;
function tete(majeur: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(majeur << 5) | n]);
  if (n < 256) return Buffer.from([(majeur << 5) | 24, n]);
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = (majeur << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (majeur << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
function cbor(v: V): Buffer {
  if (typeof v === 'number') return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (typeof v === 'boolean') return Buffer.from([v ? 0xf5 : 0xf4]);
  if (Buffer.isBuffer(v)) return Buffer.concat([tete(2, v.length), v]);
  if (typeof v === 'string') { const o = Buffer.from(v, 'utf8'); return Buffer.concat([tete(3, o.length), o]); }
  if (Array.isArray(v)) return Buffer.concat([tete(4, v.length), ...v.map(cbor)]);
  return Buffer.concat([tete(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
const b64 = (b: Buffer) => b.toString('base64url');

// Un appareil : sa paire de clés, son identifiant de clé, son compteur. Il répond comme un navigateur.
function appareil(genre: 'p256' | 'ed25519' = 'p256', o: { compteur?: number } = {}) {
  const paire = genre === 'p256' ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('ed25519');
  const identifiant = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + Math.floor(Math.random() * 256)) % 256));
  let compteur = o.compteur ?? 0;
  const jwk = paire.publicKey.export({ format: 'jwk' }) as { x: string; y?: string };
  const cose = genre === 'p256'
    ? new Map<V, V>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y ?? '', 'base64url')]])
    : new Map<V, V>([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, 'base64url')]]);
  const donnees = (drapeaux: number, avecCle: boolean, domaine = DOMAINE) => {
    const c = Buffer.alloc(4); c.writeUInt32BE(compteur);
    const base = Buffer.concat([sha(domaine), Buffer.from([drapeaux]), c]);
    if (!avecCle) return base;
    const n = Buffer.alloc(2); n.writeUInt16BE(identifiant.length);
    return Buffer.concat([base, Buffer.alloc(16), n, identifiant, cbor(cose)]);
  };
  const demande = (type: string, challenge: string, origine = ORIGINE) => Buffer.from(JSON.stringify({ type, challenge, origin: origine, crossOrigin: false }));
  const signer = (cle: KeyObject, octets: Buffer) => (genre === 'p256' ? sign('sha256', octets, cle) : sign(null, octets, cle));
  return {
    identifiant: b64(identifiant),
    creer: (challenge: string, x: { origine?: string; drapeaux?: number } = {}) => ({
      attestation: b64(cbor(new Map<V, V>([['fmt', 'none'], ['attStmt', new Map()], ['authData', donnees(x.drapeaux ?? 0x45, true)]]))),
      demande: b64(demande('webauthn.create', challenge, x.origine)),
    }),
    signer: (challenge: string, x: { origine?: string; drapeaux?: number; compteur?: number; retoucher?: boolean; domaine?: string } = {}) => {
      if (x.compteur !== undefined) compteur = x.compteur; else if (compteur > 0) compteur += 1;
      const d = donnees(x.drapeaux ?? 0x05, false, x.domaine);
      const j = demande('webauthn.get', challenge, x.origine);
      const s = signer(paire.privateKey, Buffer.concat([d, sha(j)]));
      if (x.retoucher) s[s.length - 1] = (s[s.length - 1] as number) ^ 1;
      return { identifiant: b64(identifiant), donnees: b64(d), demande: b64(j), signature: b64(s) };
    },
  };
}

// ── Le serveur ───────────────────────────────────────────────────────────────────────────────────────────────────────
const pool = creerPool(inject('pgApp'));
const recus: Courriel[] = [];
let adresse = ORIGINE;
const ctx: Contexte = {
  pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
  courriel: { envoi: { envoyer: async (c) => { recus.push(c); } }, adresse: () => ORIGINE }, cles: { adresse: () => adresse },
};
let app: FastifyInstance;
beforeAll(async () => { app = creerApp(ctx, routesSocle(ctx)); await app.ready(); });
afterAll(async () => { await app.close(); await pool.end(); });

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
const APPAREIL = { nom: 'Téléphone de test', type: 'telephone' };
// Une personne connectée par son mot de passe (l'adresse se prouve d'abord : un code part par e-mail à l'inscription).
async function personne() {
  const email = `cles-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: 'Nadia Clé', motDePasse: MDP });
  const d = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: APPAREIL });
  expect([d.corps.etat, d.corps.methode]).toEqual(['code', 'courriel']);
  const code = /\b(\d{6})\b/.exec(recus.filter((c) => c.a === email).at(-1)?.texte ?? '')?.[1];
  const r = await appeler('POST', '/connexion/code', undefined, { defi: d.corps.defi, code });
  expect(r.corps.etat).toBe('connecte');
  return { email, jeton: String(r.corps.jeton) };
}
async function ajouter(jeton: string, a: ReturnType<typeof appareil>, nom = 'Mon téléphone') {
  const p = await appeler('POST', '/moi/cles/preparer', jeton, { motDePasse: MDP });
  expect(p.statut).toBe(200);
  return appeler('POST', '/moi/cles', jeton, { defi: p.corps.defi, ...a.creer(String(p.corps.challenge)), nom });
}
async function entrer(a: ReturnType<typeof appareil>, x: Parameters<ReturnType<typeof appareil>['signer']>[1] = {}) {
  const p = await appeler('POST', '/connexion/cle/preparer');
  expect(p.statut).toBe(200);
  return appeler('POST', '/connexion/cle', undefined, { defi: p.corps.defi, ...a.signer(String(p.corps.challenge), x), appareil: APPAREIL });
}

describe('les clés d\'accès', () => {
  it('le décodeur lit ce que l\'encodeur écrit, et refuse ce qui est tronqué', () => {
    const v = new Map<V, V>([[1, 2], [-3, Buffer.from([1, 2, 3])], ['fmt', 'none'], [3, [1, -257, true]]]);
    const [lu, fin] = lireCbor(cbor(v));
    expect(fin).toBe(cbor(v).length);
    expect([...(lu as Map<unknown, unknown>)].map(([k, x]) => [k, Buffer.isBuffer(x) ? [...x] : x])).toEqual([[1, 2], [-3, [1, 2, 3]], ['fmt', 'none'], [3, [1, -257, true]]]);
    expect(() => lireCbor(cbor(v).subarray(0, 8))).toThrow();
  });

  it('la vérification seule : chaque contrôle tombe sur son défaut, P-256 et Ed25519', () => {
    for (const genre of ['p256', 'ed25519'] as const) {
      const a = appareil(genre);
      const defi = Buffer.alloc(32, 7);
      const attendu = { defi, origine: ORIGINE, domaine: DOMAINE };
      const c = verifierCreation(a.creer(b64(defi)), attendu);
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.identifiant).toBe(a.identifiant);
      const garde = { ...attendu, clePublique: c.clePublique, algorithme: c.algorithme, compteur: 0 };
      expect(verifierAssertion(a.signer(b64(defi)), garde)).toEqual({ ok: true, compteur: 0 });
      expect(verifierAssertion(a.signer(b64(Buffer.alloc(32, 8))), garde)).toEqual({ ok: false, raison: 'defi' });
      expect(verifierAssertion(a.signer(b64(defi), { origine: 'https://skanfact.tn.hameconnage.example' }), garde)).toEqual({ ok: false, raison: 'origine' });
      expect(verifierAssertion(a.signer(b64(defi), { domaine: 'autre.test' }), garde)).toEqual({ ok: false, raison: 'domaine' });
      expect(verifierAssertion(a.signer(b64(defi), { drapeaux: 0x01 }), garde)).toEqual({ ok: false, raison: 'verification' });
      expect(verifierAssertion(a.signer(b64(defi), { drapeaux: 0x04 }), garde)).toEqual({ ok: false, raison: 'presence' });
      expect(verifierAssertion(a.signer(b64(defi), { retoucher: true }), garde)).toEqual({ ok: false, raison: 'signature' });
      // Le compteur : il avance (5 après 3), et un compteur qui recule dit une clé copiée.
      expect(verifierAssertion(a.signer(b64(defi), { compteur: 5 }), { ...garde, compteur: 3 })).toEqual({ ok: true, compteur: 5 });
      expect(verifierAssertion(a.signer(b64(defi), { compteur: 2 }), { ...garde, compteur: 3 })).toEqual({ ok: false, raison: 'compteur' });
      // Une création sans vérification de la personne ne s'enregistre pas.
      expect(verifierCreation(a.creer(b64(defi), { drapeaux: 0x41 }), attendu)).toEqual({ ok: false, raison: 'verification' });
      expect(verifierCreation(a.creer(b64(defi), { origine: 'http://localhost:9' }), attendu)).toEqual({ ok: false, raison: 'origine' });
    }
  });

  it('ajouter une clé : le mot de passe d\'abord, une fois par défi, la même clé pas deux fois, l\'adresse prévenue', async () => {
    const nadia = await personne();
    expect((await appeler('POST', '/moi/cles/preparer', nadia.jeton, { motDePasse: 'pas-le-bon-mot' })).corps).toMatchObject({ champ: 'motDePasse' });
    const a = appareil();
    const p = await appeler('POST', '/moi/cles/preparer', nadia.jeton, { motDePasse: MDP });
    expect(p.corps).toMatchObject({ rp: { id: DOMAINE, name: 'SkanFact' }, user: { name: nadia.email, displayName: 'Nadia Clé' }, exclure: [] });
    const avant = recus.length;
    const fait = await appeler('POST', '/moi/cles', nadia.jeton, { defi: p.corps.defi, ...a.creer(String(p.corps.challenge)), nom: 'Mon téléphone' });
    expect([fait.statut, fait.corps.nom]).toEqual([201, 'Mon téléphone']);
    expect(recus.slice(avant).map((c) => [c.a, c.objet])).toEqual([[nadia.email, 'Une clé d\'accès a été ajoutée à ton compte SkanFact']]);
    // Le même défi ne sert pas deux fois.
    expect((await appeler('POST', '/moi/cles', nadia.jeton, { defi: p.corps.defi, ...appareil().creer(String(p.corps.challenge)), nom: 'Autre' })).statut).toBe(400);
    // La même clé, une seconde fois : refusée ; et elle est désormais dans « exclure ».
    expect((await ajouter(nadia.jeton, a)).corps.motif).toBe('Cette clé d\'accès est déjà enregistrée.');
    const p2 = await appeler('POST', '/moi/cles/preparer', nadia.jeton, { motDePasse: MDP });
    expect(p2.corps.exclure).toEqual([a.identifiant]);
    const liste = await appeler('GET', '/moi/cles', nadia.jeton);
    expect([liste.corps.disponible, (liste.corps.cles as { nom: string; utiliseeLe: string | null }[]).map((c) => [c.nom, c.utiliseeLe])]).toEqual([true, [['Mon téléphone', null]]]);
    // Le défi de Nadia ne sert pas à une autre personne.
    const autre = await personne();
    expect((await appeler('POST', '/moi/cles', autre.jeton, { defi: p2.corps.defi, ...appareil().creer(String(p2.corps.challenge)), nom: 'Volé' })).statut).toBe(400);
  });

  it('se connecter avec sa clé, sans adresse ni mot de passe ; les refus ne disent pas lequel', async () => {
    const nadia = await personne();
    const a = appareil('ed25519');
    expect((await ajouter(nadia.jeton, a)).statut).toBe(201);
    const r = await entrer(a);
    expect([r.statut, r.corps.etat]).toEqual([200, 'connecte']);
    const moi = await appeler('GET', '/moi', String(r.corps.jeton));
    expect([moi.statut, moi.corps.email]).toEqual([200, nadia.email]);
    expect(((await appeler('GET', '/moi/cles', nadia.jeton)).corps.cles as { utiliseeLe: string | null }[])[0]?.utiliseeLe).not.toBe(null);

    // Le même défi ne sert pas deux fois : la demande a expiré.
    const p = await appeler('POST', '/connexion/cle/preparer');
    const signe = a.signer(String(p.corps.challenge));
    expect((await appeler('POST', '/connexion/cle', undefined, { defi: p.corps.defi, ...signe, appareil: APPAREIL })).corps.etat).toBe('connecte');
    expect((await appeler('POST', '/connexion/cle', undefined, { defi: p.corps.defi, ...signe, appareil: APPAREIL })).corps).toMatchObject({ etat: 'refuse', perime: true });

    // Une autre origine, une personne non vérifiée, une signature retouchée, une clé inconnue : la même réponse.
    const phrase = 'Cette clé d\'accès n\'est pas reconnue : connecte-toi avec ton adresse et ton mot de passe.';
    for (const x of [{ origine: 'https://skanfact.tn.hameconnage.example' }, { drapeaux: 0x01 }, { retoucher: true }]) {
      expect((await entrer(a, x)).corps).toEqual({ etat: 'refuse', motif: phrase });
    }
    expect((await entrer(appareil())).corps).toEqual({ etat: 'refuse', motif: phrase });

    // Une clé retirée ne connecte plus.
    const cle = ((await appeler('GET', '/moi/cles', nadia.jeton)).corps.cles as { id: string }[])[0]?.id;
    expect((await appeler('DELETE', `/moi/cles/${cle}`, nadia.jeton)).statut).toBe(200);
    expect((await entrer(a)).corps).toEqual({ etat: 'refuse', motif: phrase });
    expect((await appeler('DELETE', `/moi/cles/${cle}`, nadia.jeton)).statut).toBe(404);
  });

  it('un compteur qui recule : la clé a été copiée, l\'entrée est refusée', async () => {
    const nadia = await personne();
    const a = appareil('p256', { compteur: 10 });
    expect((await ajouter(nadia.jeton, a)).statut).toBe(201);
    expect((await entrer(a)).corps.etat).toBe('connecte');
    expect((await entrer(a, { compteur: 4 })).corps.etat).toBe('refuse');
  });

  it('sur une adresse IP, ou en http hors de localhost, aucune clé ne se propose', async () => {
    try {
      for (const [ici, attendu] of [['http://127.0.0.1:3000', false], ['https://10.0.0.5', false], ['https://[::1]:8443', false], ['http://app.skanfact.test', false], ['http://localhost:3000', true], [ORIGINE, true]] as const) {
        adresse = ici;
        expect([ici, (await appeler('GET', '/connexion/options')).corps.cleAcces]).toEqual([ici, attendu]);
      }
      adresse = 'http://127.0.0.1:3000';
      expect((await appeler('POST', '/connexion/cle/preparer')).statut).toBe(409);
    } finally { adresse = ORIGINE; }
  });
});
