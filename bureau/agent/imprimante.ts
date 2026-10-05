// L'agent local (brique 136 ; docs/bureau.md) : l'envoi à l'imprimante de tickets. Deux branchements, ceux du matériel
// vendu en Tunisie :
//   - par le réseau : l'imprimante écoute sur son port « brut » (9100 d'ordinaire) ; l'agent s'y connecte, envoie, ferme
//     (il n'écoute rien lui-même) ;
//   - par un port de la machine : un chemin où l'on écrit les octets tels quels (/dev/usb/lp0 sous Linux ; sous Windows,
//     une imprimante partagée en mode brut, \\localhost\NomDuPartage : À VÉRIFIER sur les pilotes des modèles vendus).
// Un échec dit lequel : l'imprimante ne répond pas, ne répond pas assez vite, ou le chemin n'existe pas ; jamais un
// ticket « imprimé » qui ne l'a pas été.

import fs from 'node:fs/promises';
import net from 'node:net';
import { z } from 'zod';

export const reglage = z.discriminatedUnion('branchement', [
  z.object({ branchement: z.literal('reseau'), hote: z.string().trim().min(1).max(255), port: z.number().int().min(1).max(65535).default(9100) }),
  z.object({ branchement: z.literal('port'), chemin: z.string().trim().min(1).max(500) }),
]);
export type Reglage = z.infer<typeof reglage>;

export type Echec = 'injoignable' | 'trop_lente' | 'chemin_inconnu' | 'refusee';
export class ImpressionImpossible extends Error {
  readonly raison: Echec;
  constructor(raison: Echec, detail: string) { super(`${raison} : ${detail}`); this.raison = raison; }
}

const DELAI_MS = 5_000;

export async function envoyer(r: Reglage, octets: Uint8Array, delaiMs = DELAI_MS): Promise<void> {
  if (r.branchement === 'reseau') return envoyerReseau(r.hote, r.port, octets, delaiMs);
  try {
    await fs.writeFile(r.chemin, octets, { flag: 'w' });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? '';
    throw new ImpressionImpossible(code === 'ENOENT' ? 'chemin_inconnu' : 'refusee', `${r.chemin} (${code})`);
  }
}

function envoyerReseau(hote: string, port: number, octets: Uint8Array, delaiMs: number): Promise<void> {
  return new Promise((ok, ko) => {
    const s = net.connect({ host: hote, port });
    let fini = false;
    const finir = (e?: ImpressionImpossible) => { if (fini) return; fini = true; clearTimeout(minuterie); s.destroy(); if (e) ko(e); else ok(); };
    const minuterie = setTimeout(() => finir(new ImpressionImpossible('trop_lente', `${hote}:${port}`)), delaiMs);
    s.on('error', (e: NodeJS.ErrnoException) => finir(new ImpressionImpossible('injoignable', `${hote}:${port} (${e.code ?? e.message})`)));
    // Tout est remis à l'imprimante quand la fermeture de notre côté est acquittée.
    s.on('connect', () => s.end(Buffer.from(octets), () => finir()));
  });
}
