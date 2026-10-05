// L'agent local, sans matériel (brique 136 ; docs/bureau.md, A1 à A3) :
//   - l'image du ticket devient du raster ESC/POS au point près (1 = noir, le point de gauche dans le bit fort, par
//     bandes), ramenée à la largeur du rouleau ; puis la coupe, et l'impulsion du tiroir seulement si on la demande ;
//   - l'envoi : une imprimante réseau reçoit exactement les octets ; une imprimante éteinte, trop lente ou un chemin
//     inconnu le disent, jamais un ticket « imprimé » qui ne l'a pas été.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUPE, enGris, INIT, POINTS, raster, ticket, TIROIR, type Image } from '../../bureau/agent/escpos.ts';
import { envoyer, ImpressionImpossible, reglage } from '../../bureau/agent/imprimante.ts';

const image = (largeur: number, hauteur: number, noir: (x: number, y: number) => boolean): Image => {
  const gris = new Uint8Array(largeur * hauteur);
  for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) gris[y * largeur + x] = noir(x, y) ? 0 : 255;
  return { largeur, hauteur, gris };
};
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('le ticket en ESC/POS', () => {
  it('le raster au point près : une ligne noire, puis les deux bords ; une largeur qui ne tombe pas sur 8 se complète de blanc', () => {
    expect(hex(raster(image(16, 2, (x, y) => y === 0 || x === 0 || x === 15))))
      .toBe('1d7630' + '00' + '0200' + '0200' + 'ffff' + '8001');
    // 10 points : deux octets par ligne, les six derniers bits blancs.
    expect(hex(raster(image(10, 1, (x) => x === 9)))).toBe('1d7630' + '00' + '0200' + '0100' + '0040');
    // Le seuil : 159 s'imprime, 160 non.
    expect(hex(raster({ largeur: 8, hauteur: 1, gris: Uint8Array.of(159, 160, 0, 255, 0, 255, 0, 255) }))).toBe('1d76300001000100aa');
  });

  it('par bandes de 128 lignes : une longue bande de papier ne déborde pas la mémoire des petites imprimantes', () => {
    const b = raster(image(576, 300, () => false));
    const parLigne = 72;
    expect(b.length).toBe(3 * 8 + 300 * parLigne);
    const tetes = [0, 8 + 128 * parLigne, 2 * (8 + 128 * parLigne)].map((o) => hex(b.subarray(o, o + 8)));
    expect(tetes).toEqual(['1d76300048008000', '1d76300048008000', '1d7630004800' + '2c00']);
  });

  it('le ticket : remise à zéro, l\'image, la coupe ; le tiroir seulement si on le demande', () => {
    const img = image(8, 1, () => true);
    expect(hex(ticket(img))).toBe(hex(INIT) + '1d76300001000100ff' + hex(COUPE));
    expect(hex(ticket(img, { tiroir: true }))).toBe(hex(INIT) + '1d76300001000100ff' + hex(COUPE) + '1b700019fa');
    expect(hex(TIROIR)).toBe('1b700019fa');
  });

  it('une capture d\'écran (BGRA) ramenée au rouleau : 80 mm = 576 points, 58 mm = 384 ; le transparent est du papier', () => {
    expect(POINTS).toEqual({ 80: 576, 58: 384 });
    // Une capture deux fois plus fine que le rouleau de 80 : deux lignes rouges, deux lignes transparentes.
    const largeur = 1152;
    const bgra = new Uint8Array(largeur * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < largeur; x++) bgra.set(y < 2 ? [0, 0, 255, 255] : [0, 0, 0, 0], (y * largeur + x) * 4);
    const g = enGris(bgra, largeur, 4, 80);
    expect([g.largeur, g.hauteur]).toEqual([576, 2]);
    expect([g.gris[0], g.gris[575], g.gris[576]]).toEqual([76, 76, 255]); // le rouge pur en gris ; le transparent, du papier
    const g58 = enGris(bgra, largeur, 4, 58);
    expect([g58.largeur, g58.hauteur]).toEqual([384, 1]);
    expect(() => enGris(new Uint8Array(5), 2, 1, 80)).toThrow(/capture de 5 octets/);
  });
});

describe('l\'envoi à l\'imprimante', () => {
  const imprimante = async (lire = true) => {
    const recu: Buffer[] = [];
    const sockets: net.Socket[] = [];
    const s = net.createServer((c) => { sockets.push(c); if (lire) c.on('data', (d) => recu.push(d)); else c.pause(); });
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
    const port = (s.address() as net.AddressInfo).port;
    return { port, recu, fermer: () => new Promise<void>((ok) => { for (const c of sockets) c.destroy(); s.close(() => ok()); }) };
  };

  it('par le réseau : l\'imprimante reçoit exactement les octets, port 9100 par défaut', async () => {
    expect(reglage.parse({ branchement: 'reseau', hote: '192.168.1.50' })).toEqual({ branchement: 'reseau', hote: '192.168.1.50', port: 9100 });
    const p = await imprimante();
    const octets = ticket(image(576, 40, (x, y) => (x + y) % 3 === 0), { tiroir: true });
    await envoyer({ branchement: 'reseau', hote: '127.0.0.1', port: p.port }, octets);
    await expect.poll(() => Buffer.concat(p.recu).length).toBe(octets.length);
    expect(Buffer.concat(p.recu).equals(Buffer.from(octets))).toBe(true);
    await p.fermer();
  });

  it('éteinte, trop lente, ou un chemin inconnu : l\'échec dit lequel', async () => {
    const eteinte = await imprimante();
    await eteinte.fermer();
    const raison = (p: Promise<unknown>) => p.then(() => 'imprimé', (e: unknown) => (e instanceof ImpressionImpossible ? e.raison : String(e)));
    expect(await raison(envoyer({ branchement: 'reseau', hote: '127.0.0.1', port: eteinte.port }, INIT))).toBe('injoignable');
    // Elle accepte mais ne lit rien : le papier ne sort pas, l'agent ne l'annonce pas sorti.
    const bloquee = await imprimante(false);
    expect(await raison(envoyer({ branchement: 'reseau', hote: '127.0.0.1', port: bloquee.port }, new Uint8Array(64 * 1024 * 1024), 500))).toBe('trop_lente');
    await bloquee.fermer();
    expect(await raison(envoyer({ branchement: 'port', chemin: path.join(os.tmpdir(), 'pas-de-dossier-ici', 'lp0') }, INIT))).toBe('chemin_inconnu');
  });

  it('par un port de la machine : les octets tels quels', async () => {
    const chemin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-')), 'lp0');
    await envoyer({ branchement: 'port', chemin }, Uint8Array.of(1, 2, 3, 0x1b));
    expect(hex(fs.readFileSync(chemin))).toBe('0102031b');
  });
});
