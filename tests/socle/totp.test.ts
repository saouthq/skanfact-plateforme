// Le code TOTP contre les exemples officiels de la RFC 6238 (annexe B, SHA-1, 8 chiffres).

import { describe, expect, it } from 'vitest';
import { base32, codeTotp, depuisBase32, verifierTotp } from '../../serveur/totp.ts';

const SECRET = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
    [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
  ])('à %i secondes, le code est %s', (secondes, attendu) => {
    expect(codeTotp(SECRET, secondes * 1000, 8)).toBe(attendu);
  });

  it('le base32 fait l\'aller et le retour', () => {
    expect(base32(SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(depuisBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(SECRET)).toBe(true);
  });

  it('accepte le code d\'avant et d\'après, pas celui d\'il y a deux minutes', () => {
    const s = base32(SECRET);
    const t = 1_700_000_000_000;
    expect(verifierTotp(s, codeTotp(SECRET, t - 30_000), t)).toBe(true);
    expect(verifierTotp(s, codeTotp(SECRET, t + 30_000), t)).toBe(true);
    expect(verifierTotp(s, codeTotp(SECRET, t - 120_000), t)).toBe(false);
    expect(verifierTotp(s, 'abcdef', t)).toBe(false);
  });
});
