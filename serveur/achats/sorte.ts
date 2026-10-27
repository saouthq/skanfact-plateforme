// La sorte d'une pièce envoyée à la lecture (brique 84 ; docs/achats.md) : une photo ou un PDF, reconnue par ses
// premiers octets, jamais par son nom ni par ce qu'en dit l'envoyeur.
//
// (27/10/2026, décision de Skander) Les pièces ne se lisent plus sur nos serveurs (Tesseract et Poppler se
// trompaient trop) : seule l'IA de Claude les lit, avec l'accord de la personne (lecture-ia.ts).

export type Sorte = 'jpeg' | 'png' | 'webp' | 'pdf';
// (27/10/2026) Un justificatif peut aussi être le fichier XML d'une facture électronique (El Fatoora) : il se joint, il
// ne se lit pas par l'IA. Reconnu à son en-tête « <?xml » (après une marque d'ordre des octets éventuelle).
export type SorteJointe = Sorte | 'xml';

export function sorteDe(b: Buffer): Sorte | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

export function sorteJointeDe(b: Buffer): SorteJointe | null {
  const s = sorteDe(b);
  if (s) return s;
  // Le XML : son en-tête, puis comme élément principal TEIF (celui d'El Fatoora), et rien qu'un navigateur exécuterait
  // (ni script, ni SVG, ni XHTML) : il ne se joint que ce que la lecture d'une e-facture accepte.
  const texte = (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b).toString('utf8');
  if (!/^\s*<\?xml[^>]*\?>/.test(texte)) return null;
  const apres = texte.slice(0, 4096).replace(/^\s*<\?xml[^>]*\?>/, '').replace(/^(\s*(<!--[\s\S]*?-->|<\?[\s\S]*?\?>))*\s*/, '');
  if (!/^<TEIF[\s>/]/.test(apres)) return null;
  if (/<\s*script\b|<!DOCTYPE|<!ENTITY|http:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml)/i.test(texte)) return null;
  return 'xml';
}
