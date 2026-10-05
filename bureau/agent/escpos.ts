// L'agent local (brique 136 ; docs/bureau.md) : ce qu'il envoie à une imprimante de tickets, en ESC/POS (le langage des
// imprimantes thermiques compatibles Epson, celles qu'on vend en Tunisie : note `hebergement_technique.md`).
//
// Le ticket ne se recompose pas ici : l'agent IMPRIME L'IMAGE du ticket que l'écran de la v10 dessine déjà (`ticketHtml`,
// le Z, le bilan du jour). Une seule mise en page, donc les mêmes chiffres sur l'écran, en PDF et sur le papier, accents
// compris (aucune table de caractères à deviner selon le modèle). L'image part en « raster » (GS v 0), que ces
// imprimantes savent toutes imprimer ; puis la coupe, et, si on le demande, l'impulsion qui ouvre le tiroir (il est
// branché sur l'imprimante).

// La largeur imprimable, en points (203 points par pouce) : 72 mm sur un rouleau de 80, 48 mm sur un rouleau de 58.
export const POINTS = { 80: 576, 58: 384 } as const;
export type Rouleau = keyof typeof POINTS;

const ESC = 0x1b;
const GS = 0x1d;
// Une bande de 128 lignes par commande : les petites imprimantes ont une mémoire courte.
const BANDE = 128;

// L'imprimante remise à zéro (ESC @).
export const INIT = Uint8Array.of(ESC, 0x40);
// Avancer de quelques lignes puis couper en laissant une attache (GS V 66 n) : le ticket ne tombe pas.
export const COUPE = Uint8Array.of(GS, 0x56, 66, 0x30);
// L'impulsion du tiroir sur sa broche 2 (ESC p 0 t1 t2) : 50 ms de marche, 500 ms d'arrêt.
export const TIROIR = Uint8Array.of(ESC, 0x70, 0x00, 0x19, 0xfa);

export type Image = { largeur: number; hauteur: number; gris: Uint8Array };

// Une capture d'écran (BGRA, quatre octets par point, comme les rend la coque) en niveaux de gris, ramenée à la
// largeur du rouleau. Un point transparent est du papier (blanc).
export function enGris(bgra: Uint8Array, largeur: number, hauteur: number, rouleau: Rouleau): Image {
  if (bgra.length !== largeur * hauteur * 4) throw new Error(`capture de ${bgra.length} octets pour ${largeur}×${hauteur}`);
  const cible = POINTS[rouleau];
  const echelle = largeur / cible;
  const h = Math.max(1, Math.round(hauteur / echelle));
  const gris = new Uint8Array(cible * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(hauteur - 1, Math.floor(y * echelle));
    for (let x = 0; x < cible; x++) {
      const i = (sy * largeur + Math.min(largeur - 1, Math.floor(x * echelle))) * 4;
      const a = bgra[i + 3] ?? 0;
      // Luminance (Rec. 601), posée sur du blanc selon l'opacité.
      const l = 0.114 * (bgra[i] ?? 0) + 0.587 * (bgra[i + 1] ?? 0) + 0.299 * (bgra[i + 2] ?? 0);
      gris[y * cible + x] = Math.round((l * a + 255 * (255 - a)) / 255);
    }
  }
  return { largeur: cible, hauteur: h, gris };
}

// L'image en raster (GS v 0), par bandes : un bit par point, 1 = noir, le point de gauche dans le bit fort. Un point
// plus sombre que le seuil s'imprime (le texte lissé de l'écran reste net).
export function raster(image: Image, seuil = 160): Uint8Array {
  const { largeur, hauteur, gris } = image;
  if (gris.length !== largeur * hauteur) throw new Error('image incohérente');
  const parLigne = Math.ceil(largeur / 8);
  const morceaux: Uint8Array[] = [];
  for (let y0 = 0; y0 < hauteur; y0 += BANDE) {
    const lignes = Math.min(BANDE, hauteur - y0);
    const bande = new Uint8Array(8 + parLigne * lignes);
    bande.set([GS, 0x76, 0x30, 0, parLigne & 0xff, parLigne >> 8, lignes & 0xff, lignes >> 8]);
    for (let y = 0; y < lignes; y++) {
      for (let x = 0; x < largeur; x++) {
        if ((gris[(y0 + y) * largeur + x] ?? 255) < seuil) {
          const o = 8 + y * parLigne + (x >> 3);
          bande[o] = (bande[o] ?? 0) | (0x80 >> (x & 7));
        }
      }
    }
    morceaux.push(bande);
  }
  return concat(morceaux);
}

// Tout ce qui part pour un ticket : remise à zéro, l'image, la coupe, et le tiroir si on le demande.
export function ticket(image: Image, { tiroir = false }: { tiroir?: boolean } = {}): Uint8Array {
  return concat([INIT, raster(image), COUPE, ...(tiroir ? [TIROIR] : [])]);
}

export function concat(morceaux: Uint8Array[]): Uint8Array {
  const tout = new Uint8Array(morceaux.reduce((n, m) => n + m.length, 0));
  let o = 0;
  for (const m of morceaux) { tout.set(m, o); o += m.length; }
  return tout;
}
