// Le code de l'interface v10 est REPRIS, pas réécrit (décision de Skander, 28/09/2026) : les fichiers
// de web/public/v10 sortent de `npm run reprendre-v10`, qui les copie tels quels et n'y applique que
// les adaptations écrites (web/v10/adaptations.mjs). Ce test refuse toute retouche à la main : chaque
// fichier doit avoir l'empreinte notée à la reprise, et aucun fichier ne doit s'y ajouter en douce.
// Il vérifie aussi que chaque adaptation a bien laissé sa trace dans le code repris.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADAPTATIONS } from '../../web/v10/adaptations.mjs';

const V10 = path.join(import.meta.dirname, '../../web/public/v10');
const provenance = JSON.parse(fs.readFileSync(path.join(V10, 'PROVENANCE.json'), 'utf8')) as {
  depot: string; branche: string; commit: string; adaptations: number; fichiers: Record<string, string>;
};

describe('la reprise du code v10', () => {
  it('chaque fichier repris a l\'empreinte notée à la reprise, et il n\'y en a pas d\'autre', () => {
    // Tous les fichiers, sous-dossiers compris (le Cabinet vit dans cabinet/).
    const presents = (fs.readdirSync(V10, { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/'))
      .filter((f) => f !== 'PROVENANCE.json' && fs.statSync(path.join(V10, f)).isFile()).sort();
    expect(presents).toEqual(Object.keys(provenance.fichiers).sort());
    for (const f of presents) {
      expect({ f, empreinte: createHash('sha256').update(fs.readFileSync(path.join(V10, f))).digest('hex') }).toEqual({ f, empreinte: provenance.fichiers[f] });
    }
  });

  it('la reprise vient de la v10 publiée, et chaque adaptation écrite est dans le code repris', () => {
    expect(provenance).toMatchObject({ depot: 'saouthq/skanfact', branche: 'beta', adaptations: ADAPTATIONS.length });
    for (const a of ADAPTATIONS) {
      const texte = fs.readFileSync(path.join(V10, a.fichier), 'utf8');
      expect({ pourquoi: a.pourquoi, trouve: texte.includes(a.apres) }).toEqual({ pourquoi: a.pourquoi, trouve: true });
    }
  });
});
