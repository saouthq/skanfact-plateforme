// Les clés d'accès (passkeys ; 1.390.0, tâche 107) : ce que le navigateur rend à la création d'une clé et à la connexion,
// vérifié ici, sans bibliothèque. Une clé d'accès est une paire de clés que l'appareil garde (le téléphone, l'ordinateur,
// un gestionnaire de mots de passe) : le serveur ne voit jamais que la moitié publique, et chaque connexion signe un défi
// qu'il vient de tirer. Elle remplace le mot de passe ET le code : l'appareil exige l'empreinte, le visage ou son code à
// lui (« vérification de l'utilisateur »), et on la refuse sans.
//
// Ce qu'on vérifie, et dans cet ordre (W3C WebAuthn niveau 2, § 7.1 et 7.2) : le type de la demande, le défi (celui
// qu'on a tiré, une fois), l'origine (l'adresse de SkanFact, jamais une autre : c'est ce qui rend l'hameçonnage
// inutile), l'empreinte du domaine dans les données de l'appareil, la présence ET la vérification de la personne, puis —
// à la connexion — la signature et le compteur. L'attestation (qui a fabriqué l'appareil) n'est pas demandée : on ne
// choisit pas les appareils des gens.

import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

export type Refus = { ok: false; raison: string };

// ── Un décodeur CBOR (RFC 8949), réduit à ce que WebAuthn écrit : entiers, octets, textes, listes, tables, vrai/faux/nul.
// Il rend la valeur et l'endroit où elle s'arrête : la clé publique d'une création est suivie d'autres données.
type Cbor = number | bigint | Buffer | string | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>;
const PROFONDEUR_MAX = 16;
export function lireCbor(b: Buffer, debut = 0, profondeur = 0): [Cbor, number] {
  if (profondeur > PROFONDEUR_MAX) throw new Error('cbor trop profond');
  if (debut >= b.length) throw new Error('cbor tronqué');
  const tete = b[debut] as number;
  const majeur = tete >> 5;
  const mineur = tete & 31;
  let i = debut + 1;
  const longueur = (): number => {
    if (mineur < 24) return mineur;
    const n = mineur === 24 ? 1 : mineur === 25 ? 2 : mineur === 26 ? 4 : mineur === 27 ? 8 : 0;
    if (!n || i + n > b.length) throw new Error('cbor : longueur illisible');
    const v = n === 8 ? Number(b.readBigUInt64BE(i)) : b.readUIntBE(i, n);
    i += n;
    if (!Number.isSafeInteger(v)) throw new Error('cbor : longueur trop grande');
    return v;
  };
  switch (majeur) {
    case 0: return [longueur(), i];
    case 1: return [-1 - longueur(), i];
    case 2: case 3: {
      const n = longueur();
      if (i + n > b.length) throw new Error('cbor tronqué');
      const o = b.subarray(i, i + n);
      return [majeur === 2 ? Buffer.from(o) : o.toString('utf8'), i + n];
    }
    case 4: {
      const n = longueur();
      if (n > 1000) throw new Error('cbor : liste trop longue');
      const l: Cbor[] = [];
      for (let k = 0; k < n; k++) { const [v, j] = lireCbor(b, i, profondeur + 1); l.push(v); i = j; }
      return [l, i];
    }
    case 5: {
      const n = longueur();
      if (n > 1000) throw new Error('cbor : table trop longue');
      const m = new Map<Cbor, Cbor>();
      for (let k = 0; k < n; k++) {
        const [cle, j] = lireCbor(b, i, profondeur + 1);
        const [v, j2] = lireCbor(b, j, profondeur + 1);
        m.set(cle, v); i = j2;
      }
      return [m, i];
    }
    case 7:
      if (mineur === 20) return [false, i];
      if (mineur === 21) return [true, i];
      if (mineur === 22) return [null, i];
      if (mineur === 23) return [undefined, i];
      throw new Error('cbor : valeur simple inconnue');
    default: throw new Error('cbor : type non pris en charge');
  }
}

// ── Les données de l'appareil (authenticatorData, § 6.1) ──────────────────────────────────────────────────────────────
export type DonneesAppareil = {
  domaine: Buffer; present: boolean; verifie: boolean; compteur: number;
  identifiant?: Buffer; cleCose?: Map<Cbor, Cbor>;
};
const PRESENT = 0x01, VERIFIE = 0x04, CLE_JOINTE = 0x40;
export function lireDonneesAppareil(b: Buffer): DonneesAppareil {
  if (b.length < 37) throw new Error('données de l\'appareil trop courtes');
  const drapeaux = b[32] as number;
  const d: DonneesAppareil = { domaine: b.subarray(0, 32), present: !!(drapeaux & PRESENT), verifie: !!(drapeaux & VERIFIE), compteur: b.readUInt32BE(33) };
  if (drapeaux & CLE_JOINTE) {
    if (b.length < 55) throw new Error('données de la clé trop courtes');
    const n = b.readUInt16BE(53);
    if (n < 16 || n > 1023 || 55 + n > b.length) throw new Error('identifiant de clé illisible');
    d.identifiant = Buffer.from(b.subarray(55, 55 + n));
    const [cle] = lireCbor(b, 55 + n);
    if (!(cle instanceof Map)) throw new Error('clé publique illisible');
    d.cleCose = cle;
  }
  return d;
}

// ── La clé publique COSE (RFC 9053) vers une clé de node : ES256, EdDSA (Ed25519) et RS256, les trois que l'on propose.
export const ALGORITHMES = [-7, -8, -257] as const;
export function cleDepuisCose(cose: Map<Cbor, Cbor>): { cle: KeyObject; algorithme: number } {
  const kty = cose.get(1), alg = cose.get(3);
  const octets = (k: number): Buffer => { const v = cose.get(k); if (!Buffer.isBuffer(v)) throw new Error('clé COSE incomplète'); return v; };
  const b64 = (o: Buffer) => o.toString('base64url');
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    const x = octets(-2), y = octets(-3);
    if (x.length !== 32 || y.length !== 32) throw new Error('clé P-256 de mauvaise taille');
    return { cle: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(x), y: b64(y) }, format: 'jwk' }), algorithme: -7 };
  }
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) {
    const x = octets(-2);
    if (x.length !== 32) throw new Error('clé Ed25519 de mauvaise taille');
    return { cle: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64(x) }, format: 'jwk' }), algorithme: -8 };
  }
  if (kty === 3 && alg === -257) {
    const n = octets(-1), e = octets(-2);
    if (n.length < 256) throw new Error('clé RSA trop courte');
    return { cle: createPublicKey({ key: { kty: 'RSA', n: b64(n), e: b64(e) }, format: 'jwk' }), algorithme: -257 };
  }
  throw new Error('algorithme de clé non pris en charge');
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();
const memes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
// Les octets qu'envoie le navigateur arrivent en base64url ; un texte qui n'en est pas devient un refus, pas une panne.
export function octetsDe(t: string): Buffer | null {
  if (typeof t !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(t)) return null;
  return Buffer.from(t, 'base64url');
}

// Ce que le navigateur dit de la demande (clientDataJSON, § 5.8.1) : son type, le défi et l'origine.
function lireDemande(json: Buffer, type: 'webauthn.create' | 'webauthn.get', defi: Buffer, origine: string): Refus | null {
  let d: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try { d = JSON.parse(json.toString('utf8')); } catch { return { ok: false, raison: 'demande_illisible' }; }
  if (d.type !== type) return { ok: false, raison: 'type' };
  const recu = typeof d.challenge === 'string' ? octetsDe(d.challenge) : null;
  if (!recu || !memes(recu, defi)) return { ok: false, raison: 'defi' };
  if (d.origin !== origine) return { ok: false, raison: 'origine' };
  if (d.crossOrigin === true) return { ok: false, raison: 'origine_croisee' };
  return null;
}

function controlerAppareil(a: DonneesAppareil, domaine: string): Refus | null {
  if (!memes(a.domaine, sha256(domaine))) return { ok: false, raison: 'domaine' };
  if (!a.present) return { ok: false, raison: 'presence' };
  if (!a.verifie) return { ok: false, raison: 'verification' };
  return null;
}

// La création d'une clé (§ 7.1). `defi` : les octets tirés pour cette création ; `origine` : https://adresse-de-skanfact ;
// `domaine` : son nom d'hôte. Rend la clé publique (SPKI, base64url) à garder, son algorithme et son compteur.
export function verifierCreation(r: { attestation: string; demande: string }, attendu: { defi: Buffer; origine: string; domaine: string }):
  { ok: true; identifiant: string; clePublique: string; algorithme: number; compteur: number } | Refus {
  const json = octetsDe(r.demande), att = octetsDe(r.attestation);
  if (!json || !att) return { ok: false, raison: 'illisible' };
  const refus = lireDemande(json, 'webauthn.create', attendu.defi, attendu.origine);
  if (refus) return refus;
  let a: DonneesAppareil;
  try {
    const [objet] = lireCbor(att);
    const donnees = objet instanceof Map ? objet.get('authData') : null;
    if (!Buffer.isBuffer(donnees)) return { ok: false, raison: 'attestation_illisible' };
    a = lireDonneesAppareil(donnees);
  } catch { return { ok: false, raison: 'attestation_illisible' }; }
  const r2 = controlerAppareil(a, attendu.domaine);
  if (r2) return r2;
  if (!a.identifiant || !a.cleCose) return { ok: false, raison: 'cle_absente' };
  let cle: { cle: KeyObject; algorithme: number };
  try { cle = cleDepuisCose(a.cleCose); } catch { return { ok: false, raison: 'algorithme' }; }
  return { ok: true, identifiant: a.identifiant.toString('base64url'), clePublique: cle.cle.export({ type: 'spki', format: 'der' }).toString('base64url'), algorithme: cle.algorithme, compteur: a.compteur };
}

// La connexion (§ 7.2) : la signature porte sur les données de l'appareil suivies de l'empreinte de la demande. Le
// compteur, quand l'appareil en tient un, ne recule jamais : sinon la clé a été copiée.
export function verifierAssertion(r: { donnees: string; demande: string; signature: string },
  attendu: { defi: Buffer; origine: string; domaine: string; clePublique: string; algorithme: number; compteur: number }):
  { ok: true; compteur: number } | Refus {
  const json = octetsDe(r.demande), donnees = octetsDe(r.donnees), signature = octetsDe(r.signature);
  if (!json || !donnees || !signature) return { ok: false, raison: 'illisible' };
  const refus = lireDemande(json, 'webauthn.get', attendu.defi, attendu.origine);
  if (refus) return refus;
  let a: DonneesAppareil;
  try { a = lireDonneesAppareil(donnees); } catch { return { ok: false, raison: 'donnees_illisibles' }; }
  const r2 = controlerAppareil(a, attendu.domaine);
  if (r2) return r2;
  let cle: KeyObject;
  try { cle = createPublicKey({ key: Buffer.from(attendu.clePublique, 'base64url'), format: 'der', type: 'spki' }); } catch { return { ok: false, raison: 'cle_gardee_illisible' }; }
  const signe = Buffer.concat([donnees, sha256(json)]);
  const verifier = () => {
    try {
      return attendu.algorithme === -8 ? verify(null, signe, cle, signature)
        : attendu.algorithme === -7 || attendu.algorithme === -257 ? verify('sha256', signe, cle, signature)
          : false;
    } catch { return false; }
  };
  if (!verifier()) return { ok: false, raison: 'signature' };
  if ((a.compteur !== 0 || attendu.compteur !== 0) && a.compteur <= attendu.compteur) return { ok: false, raison: 'compteur' };
  return { ok: true, compteur: a.compteur };
}

// L'origine et le domaine de SkanFact, tirés de son adresse publique : le domaine est son nom d'hôte, sans le port.
export function origineEtDomaine(adresse: string): { origine: string; domaine: string } | null {
  try { const u = new URL(adresse); return { origine: u.origin, domaine: u.hostname }; } catch { return null; }
}
