// Une réponse qui ne vient pas du serveur, à chaque porte (vu sur le serveur d'essai le 05/10/2026 : « Unexpected token
// 'u', "upstream r"… is not valid JSON » ; docs/facture-details.md, E1) : un relais qui coupe une demande trop longue,
// la page d'erreur du frontal pendant une installation. Aucune porte n'en montre le texte brut ni l'erreur du lecteur :
//   - le Cabinet (plateforme/pont-cabinet.js) dit que le serveur n'a pas répondu, et garde la phrase d'un vrai refus ;
//   - les écrans d'entrée (web/src/api.ts) la disent comme un serveur qui ne répond pas (ErreurReseau), et rendent un
//     vrai refus tel quel.
// L'entreprise (plateforme/pont.js), et l'exemple qui se redemande : tests/v10/pont-exemple.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PONT_CABINET = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/plateforme/pont-cabinet.js'), 'utf8');
const CABINET = '00000000-0000-4000-8000-0000000000c1';
const COUPE = 'Le serveur n\'a pas répondu à temps : réessaie dans un instant.';

type Reponse = { statut: number; texte: string };
// Ce qu'un relais ou le frontal renvoie à la place du serveur.
const PAS_DU_SERVEUR: Reponse[] = [
  { statut: 504, texte: 'upstream request timeout' },
  { statut: 502, texte: '<html><head><title>502 Bad Gateway</title></head><body>502 Bad Gateway</body></html>' },
  { statut: 200, texte: '<!doctype html><html><body>Maintenance</body></html>' },
  { statut: 503, texte: '' },
];
const REFUS: Reponse = { statut: 403, texte: JSON.stringify({ motif: 'Ce dossier n\'est pas confié à ton cabinet.' }) };

// Le point de contact du Cabinet, chargé dans un bac à sable devant un serveur qui répond toujours `reponse()`.
function cabinet(reponse: () => Reponse) {
  const element = () => ({ style: {}, textContent: '', appendChild: () => undefined, addEventListener: () => undefined, setAttribute: () => undefined });
  const bac: Record<string, unknown> = {
    sessionStorage: { getItem: (k: string) => (k === 'skanfact.jeton' ? 'jeton' : null), setItem: () => undefined, removeItem: () => undefined },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    location: { search: `?c=${CABINET}`, pathname: '/v10/cabinet/', hash: '', replace: () => undefined, assign: () => undefined },
    document: { createElement: element, head: element(), body: element(), addEventListener: () => undefined, querySelector: () => null, querySelectorAll: () => [] },
    URLSearchParams, console, setTimeout, clearTimeout, addEventListener: () => undefined,
    fetch: async () => { const r = reponse(); return { status: r.statut, ok: r.statut >= 200 && r.statut < 300, text: async () => r.texte }; },
  };
  bac.window = bac;
  vm.runInNewContext(PONT_CABINET, bac);
  return bac.cabinet as { state: () => Promise<unknown> };
}
const echec = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);

describe('une réponse qui ne vient pas du serveur', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('au Cabinet : « le serveur n\'a pas répondu », jamais le texte du relais ; un vrai refus garde sa phrase', async () => {
    for (const r of PAS_DU_SERVEUR) {
      const e = await echec(cabinet(() => r).state());
      expect(e?.message, `${r.statut} ${r.texte}`).toBe(COUPE);
    }
    expect((await echec(cabinet(() => REFUS).state()))?.message).toBe('Ce dossier n\'est pas confié à ton cabinet.');
  });

  it('aux écrans d\'entrée : un serveur qui ne répond pas (ErreurReseau), jamais l\'erreur du lecteur ; un vrai refus rendu tel quel', async () => {
    const memoire = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
    let reponse: Reponse = REFUS;
    vi.stubGlobal('sessionStorage', memoire());
    vi.stubGlobal('localStorage', memoire());
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('fetch', async () => ({ status: reponse.statut, ok: reponse.statut >= 200 && reponse.statut < 300, text: async () => reponse.texte }));
    const { appeler, ErreurReseau } = await import('../../web/src/api.ts');
    for (const r of PAS_DU_SERVEUR.filter((x) => x.texte)) {
      reponse = r;
      expect(await echec(appeler('POST', '/connexion', { email: 'samia@exemple.tn' })), `${r.statut} ${r.texte}`).toBeInstanceOf(ErreurReseau);
    }
    // Vide, la réponse reste celle du serveur : l'écran dit « le serveur a rencontré une erreur ».
    reponse = { statut: 503, texte: '' };
    expect(await appeler('POST', '/connexion', {})).toEqual({ statut: 503, corps: {} });
    reponse = REFUS;
    expect(await appeler('POST', '/connexion', {})).toEqual({ statut: 403, corps: { motif: 'Ce dossier n\'est pas confié à ton cabinet.' } });
  });
});
