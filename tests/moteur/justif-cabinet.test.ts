// (1.173.0) Un achat dont le cabinet a joint la pièce dans son classeur est justifié chez le client aussi (Skander,
// 29/10/2026 : « oui, tout ») : le drapeau `justifCabinet`, posé à la lecture et jamais écrit dans le dossier, suffit à
// `sansJustificatif` (la règle qui compte et qui montre : la liste des achats, le contrôle du mois, « Mon comptable »).

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

const C = ecranDeLaPlateforme('core.js') as { sansJustificatif: (p: unknown) => boolean };

describe('un achat justifié par le cabinet', () => {
  it('n\'est plus « sans justificatif » ; le drapeau ne part pas avec l\'achat', () => {
    const achat: Record<string, unknown> = { id: 'a1', attachments: [] };
    expect(C.sansJustificatif(achat)).toBe(true);
    Object.defineProperty(achat, 'justifCabinet', { value: { nom: 'facture-steg.png', cabinet: 'Jlassi Conseil' }, enumerable: false, configurable: true, writable: true });
    expect(C.sansJustificatif(achat)).toBe(false);
    // Non énumérable : l'achat enregistré dans le dossier ne le porte pas.
    expect(JSON.parse(JSON.stringify(achat))).toEqual({ id: 'a1', attachments: [] });
    expect(C.sansJustificatif({ attachments: [{ file: 'x.pdf' }] })).toBe(false);
  });
});
