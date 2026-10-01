// Compresser ce qui part au navigateur (brique 118 ; docs/leger.md, S3). Sur une connexion lente, c'est le gain le
// plus simple : les écrans de la v10 passent de 4,1 Mo à environ 1 Mo, un dossier en JSON au quart. Brotli quand le
// navigateur le connaît, sinon gzip, sinon tel quel ; un envoi de 1 Ko ou moins part tel quel (le compresser coûterait
// plus qu'il ne gagne).
import zlib from 'node:zlib';

export type Encodage = 'br' | 'gzip';
export const SEUIL_COMPRESSION = 1024;

// Les types qui se compressent (une image ou un PDF le sont déjà).
export const compressible = (type: string) => /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/.test(type);

// L'encodage que le navigateur accepte (« accept-encoding »), brotli d'abord ; un « q=0 » le refuse.
export function choisirEncodage(accepte: string | string[] | undefined): Encodage | null {
  const permis = new Set<string>();
  for (const partie of String(accepte ?? '').toLowerCase().split(',')) {
    const [nom, ...params] = partie.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (nom && !(q && Number(q.slice(2)) === 0)) permis.add(nom.trim());
  }
  if (permis.has('br')) return 'br';
  if (permis.has('gzip')) return 'gzip';
  return null;
}

// Compresser : `fort` pour un écran (compressé une fois, gardé), sinon rapide (une réponse de l'API, à chaque fois).
export function compresser(corps: Buffer, encodage: Encodage, fort = false): Buffer {
  if (encodage === 'gzip') return zlib.gzipSync(corps, { level: fort ? 9 : 6 });
  return zlib.brotliCompressSync(corps, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: fort ? 9 : 4,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: corps.length,
  } });
}
