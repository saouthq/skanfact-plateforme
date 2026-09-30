// Des classeurs Excel d'essai (briques 39 et 85) : une archive ZIP (entrées compressées, comme Excel les
// écrit) de XML ; une feuille dont les textes sont dans la table partagée, les nombres dans leurs cellules.
// Partagé par les tests du Cabinet (une balance) et de l'entreprise (des clients).

import zlib from 'node:zlib';

export function zip(fichiers: Record<string, string | Buffer>) {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const [nom, texte] of Object.entries(fichiers)) {
    const brut = typeof texte === 'string' ? Buffer.from(texte, 'utf8') : texte;
    const comprime = zlib.deflateRawSync(brut);
    const n = Buffer.from(nom, 'utf8');
    const crc = zlib.crc32(brut);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(comprime.length, 18); l.writeUInt32LE(brut.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comprime.length, 20); c.writeUInt32LE(brut.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(decalage, 42);
    locaux.push(l, n, comprime);
    centraux.push(c, n);
    decalage += 30 + n.length + comprime.length;
  }
  const cd = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(centraux.length / 2, 8); fin.writeUInt16LE(centraux.length / 2, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, cd, fin]);
}
// Une feuille : les textes dans la table partagée (comme Excel), les nombres dans leurs cellules.
export function classeur(rangees: (string | number | null)[][]) {
  const partages: string[] = [];
  const cellule = (v: string | number | null, ref: string) => {
    if (v === null) return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    partages.push(v);
    return `<c r="${ref}" t="s"><v>${partages.length - 1}</v></c>`;
  };
  const lignes = rangees.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellule(v, `${'ABCDEFGHIJ'[j]}${i + 1}`)).join('')}</row>`).join('');
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Balance" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="${ns}">${partages.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="${ns}"><sheetData>${lignes}</sheetData></worksheet>`,
  });
}

