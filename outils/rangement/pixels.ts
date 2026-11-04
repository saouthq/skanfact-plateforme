// Les pixels d'une photo d'écran (docs/cadrage/17-rangement.md § 6 ; lot R0d, 04/11/2026). Deux photos des mêmes
// écrans, prises l'une après l'autre, peuvent différer de quelques pixels : le lissage du bord d'une lettre ou d'un rond,
// que le navigateur ne dessine pas toujours au même octet. La comparaison des écrans compte donc les pixels qui
// changent, au lieu de comparer les fichiers : un pixel change quand une de ses couleurs bouge de plus de TOLERANCE
// niveaux sur 255 (le lissage mesuré le 04/11/2026 : 3 à 15 ; un style changé, jusqu'à 218) ; jusqu'à SEUIL_PIXELS
// pixels changés, c'est ce lissage ; au-delà, c'est un changement (un style changé sur un seul titre en déplace des
// milliers). Lu sans dépendance : le PNG que le navigateur écrit
// (8 bits, en couleurs, avec ou sans transparence, non entrelacé).

import zlib from 'node:zlib';

export type Image = { largeur: number; hauteur: number; canaux: number; donnees: Uint8Array };
export const SEUIL_PIXELS = 32;
export const TOLERANCE = 16;
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function lirePng(png: Buffer): Image {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('Ce fichier n\'est pas une image PNG.');
  let i = 8, largeur = 0, hauteur = 0, canaux = 0;
  const idat: Buffer[] = [];
  while (i + 8 <= png.length) {
    const n = png.readUInt32BE(i), type = png.toString('latin1', i + 4, i + 8), d = png.subarray(i + 8, i + 8 + n);
    if (type === 'IHDR') {
      largeur = d.readUInt32BE(0);
      hauteur = d.readUInt32BE(4);
      const profondeur = d[8], couleur = d[9], entrelacee = d[12];
      canaux = couleur === 2 ? 3 : couleur === 6 ? 4 : 0;
      if (profondeur !== 8 || !canaux || entrelacee) throw new Error(`Une image PNG que l'outil ne lit pas (profondeur ${profondeur}, couleur ${couleur}, entrelacée ${entrelacee}).`);
    } else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    i += 12 + n;
  }
  const brut = zlib.inflateSync(Buffer.concat(idat));
  const ligne = largeur * canaux;
  const donnees = new Uint8Array(ligne * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (ligne + 1)], src = y * (ligne + 1) + 1, dst = y * ligne;
    for (let x = 0; x < ligne; x++) {
      const v = brut[src + x] ?? 0;
      const a = x >= canaux ? donnees[dst + x - canaux] ?? 0 : 0;
      const b = y ? donnees[dst - ligne + x] ?? 0 : 0;
      const c = x >= canaux && y ? donnees[dst - ligne + x - canaux] ?? 0 : 0;
      let r: number;
      if (filtre === 0) r = v;
      else if (filtre === 1) r = v + a;
      else if (filtre === 2) r = v + b;
      else if (filtre === 3) r = v + ((a + b) >> 1);
      else if (filtre === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`Une ligne d'image PNG au filtre inconnu (${String(filtre)}).`);
      donnees[dst + x] = r & 255;
    }
  }
  return { largeur, hauteur, canaux, donnees };
}

// Une image PNG (pour les essais de l'outil) : chaque ligne avec un filtre différent, pour que la lecture les prouve tous.
export function ecrirePng(im: Image): Buffer {
  const ligne = im.largeur * im.canaux;
  const brut = Buffer.alloc((ligne + 1) * im.hauteur);
  const px = (y: number, x: number) => (x >= 0 && y >= 0 ? im.donnees[y * ligne + x] ?? 0 : 0);
  for (let y = 0; y < im.hauteur; y++) {
    const filtre = y % 5;
    brut[y * (ligne + 1)] = filtre;
    for (let x = 0; x < ligne; x++) {
      const v = px(y, x), a = x >= im.canaux ? px(y, x - im.canaux) : 0, b = px(y - 1, x), c = x >= im.canaux ? px(y - 1, x - im.canaux) : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filtre] ?? 0;
      brut[y * (ligne + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  const morceau = (type: string, d: Buffer) => {
    const t = Buffer.concat([Buffer.from(type, 'latin1'), d]);
    const n = Buffer.alloc(4), crc = Buffer.alloc(4);
    n.writeUInt32BE(d.length);
    crc.writeUInt32BE(zlib.crc32(t));
    return Buffer.concat([n, t, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(im.largeur, 0);
  ihdr.writeUInt32BE(im.hauteur, 4);
  ihdr[8] = 8;
  ihdr[9] = im.canaux === 4 ? 6 : 2;
  return Buffer.concat([SIGNATURE, morceau('IHDR', ihdr), morceau('IDAT', zlib.deflateSync(brut)), morceau('IEND', Buffer.alloc(0))]);
}

// Le nombre de pixels qui changent (de plus de TOLERANCE niveaux) entre deux images ; deux tailles différentes : tous.
export function pixelsDifferents(a: Image, b: Image): number {
  if (a.largeur !== b.largeur || a.hauteur !== b.hauteur || a.canaux !== b.canaux) return Infinity;
  let n = 0;
  for (let i = 0; i < a.donnees.length; i += a.canaux) {
    for (let k = 0; k < a.canaux; k++) if (Math.abs((a.donnees[i + k] ?? 0) - (b.donnees[i + k] ?? 0)) > TOLERANCE) { n++; break; }
  }
  return n;
}
