// Le code d'un tiers recopié tel quel dans les écrans (web/public/tiers) : le dessin des codes QR de la TTN
// (brique 83 ; docs/facture-electronique.md), qrcode-generator (MIT). Il ne se retouche jamais à la main : il
// est, octet pour octet, celui de la version épinglée du paquet npm (une mise à jour passe par le paquet).

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(RACINE, f));

describe('le code des tiers dans les écrans', () => {
  it('le dessin des codes QR est celui du paquet épinglé, octet pour octet', () => {
    const paquet = JSON.parse(lire('node_modules/qrcode-generator/package.json').toString('utf8')) as { version: string };
    const nous = JSON.parse(lire('package.json').toString('utf8')) as { devDependencies: Record<string, string> };
    expect(nous.devDependencies['qrcode-generator']).toBe(paquet.version);
    expect(lire('web/public/tiers/qrcode.js').equals(lire('node_modules/qrcode-generator/dist/qrcode.js'))).toBe(true);
  });
});
