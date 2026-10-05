// Libérer un matricule fictif avant de le prendre (lot facture, 05/10/2026 ; docs/facture-details.md, D6).
// Les tests partagent UNE base (vitest.config.ts), et un matricule n'est celui que d'une entreprise à la fois : depuis
// 0071, celui qu'écrit la fiche société devient celui de l'entreprise. Or certains sont imposés par ce que les tests
// rejouent : celui de Nadia (7654321B/A/M/000) est imprimé sur les factures photographiées et connu de la TTN simulée,
// celui de la quincaillerie (1234567A/B/M/000) aussi. Le test qui en a besoin le reprend à l'entreprise d'un test
// précédent (les fichiers passent l'un après l'autre : celui-là est fini). Un matricule que rien n'impose, chaque test
// le choisit à lui.

import pg from 'pg';

export async function libererMatricule(adresseAdmin: string, matricule: string): Promise<void> {
  const c = new pg.Client({ connectionString: adresseAdmin });
  await c.connect();
  try {
    await c.query('update socle.entreprise set matricule_fiscal = null where matricule_fiscal = $1', [matricule]);
  } finally {
    await c.end();
  }
}
