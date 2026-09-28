// Le code des applications d'authentification (TOTP, RFC 6238) : 6 chiffres, toutes les 30
// secondes, calculés depuis un secret partagé. Écrit ici, sans bibliothèque : une vingtaine de
// lignes, vérifiées contre les exemples officiels de la RFC (tests/socle/totp.test.ts).

import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(octets: Uint8Array): string {
  let bits = 0, valeur = 0, sortie = '';
  for (const o of octets) {
    valeur = (valeur << 8) | o; bits += 8;
    while (bits >= 5) { sortie += ALPHABET[(valeur >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) sortie += ALPHABET[(valeur << (5 - bits)) & 31];
  return sortie;
}

export function depuisBase32(texte: string): Buffer {
  const propre = texte.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0, valeur = 0;
  const octets: number[] = [];
  for (const c of propre) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('secret invalide');
    valeur = (valeur << 5) | i; bits += 5;
    if (bits >= 8) { octets.push((valeur >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(octets);
}

export function nouveauSecret(): string {
  return base32(randomBytes(20));
}

// Le code à un instant donné. `pas` : 30 secondes ; `chiffres` : 6 ; `algo` : sha1 (ce que lisent
// toutes les applications du marché).
export function codeTotp(secret: Buffer, instantMs: number, chiffres = 6, pas = 30, algo = 'sha1'): string {
  const compteur = Math.floor(instantMs / 1000 / pas);
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(compteur));
  const h = createHmac(algo, secret).update(tampon).digest();
  const decalage = (h[h.length - 1] as number) & 0x0f;
  const nombre = h.readUInt32BE(decalage) & 0x7fffffff;
  return String(nombre % 10 ** chiffres).padStart(chiffres, '0');
}

// Accepte le code de l'instant, et celui d'avant ou d'après (horloge du téléphone un peu décalée).
export function verifierTotp(secretBase32: string, code: string, instantMs: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = depuisBase32(secretBase32);
  return [-1, 0, 1].some((d) => codeTotp(secret, instantMs + d * 30_000) === code);
}

// L'adresse que l'application d'authentification lit dans le QR code.
export function adresseTotp(secretBase32: string, email: string): string {
  return `otpauth://totp/${encodeURIComponent('SkanFact:' + email)}?secret=${secretBase32}&issuer=SkanFact&digits=6&period=30`;
}
