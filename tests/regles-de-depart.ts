// Les règles de l'abonnement de la mise en place (0104 ; skanfact docs/cadrage/07-offres-et-prix.md) : sept jours de
// grâce, les relances à quinze jours, sept jours et la veille. Les tests qui construisent des faits à la main les
// portent, comme la base les ajoute à ceux qu'elle rend.

import type pg from 'pg';
import type { Regles } from '../serveur/abonnement/etat.ts';

export const REGLES_DE_DEPART: Regles = {
  grace: [{ aPartirDu: '2000-01-01', jours: [7] }],
  relances: [{ aPartirDu: '2000-01-01', jours: [15, 7, 1] }],
};

// Les tests qui changent une règle dans la base partagée la reposent, avant et après eux : une règle posée ne s'efface
// pas, la plus récente du jour l'emporte. Reposée telle que la migration l'a écrite (son motif, personne pour l'avoir
// posée), elle se lit comme au premier jour, quel que soit l'ordre des fichiers de test.
export async function reposerLesReglesDeDepart(admin: pg.Client, jour: string): Promise<void> {
  await admin.query(`insert into plateforme.regle_abonnement (code, jours, a_partir_du, motif, le) values
    ('essai', '{30}', $1, 'Cadrage 07 (27/09/2026) : trente jours d''essai, tout ouvert, sans carte', clock_timestamp()),
    ('grace', '{7}', $1, 'Cadrage 07 (27/09/2026) : sept jours de grâce après l''échéance, où tout marche encore', clock_timestamp()),
    ('relances', '{15,7,1}', $1, 'Cadrage 07 (27/09/2026) : quinze jours, sept jours et la veille de l''échéance', clock_timestamp())`, [jour]);
}
