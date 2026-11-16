// (0216, 1.373.0) Le code du téléphone n'est exigé d'un comptable que sept jours après le premier vrai dossier de son
// cabinet. Les tests qui portent sur le code EXIGÉ créent donc un cabinet qui tient un dossier depuis huit jours.
import type pg from 'pg';
import { enTantQue } from '../../serveur/base.ts';

type Pool = Parameters<typeof enTantQue>[0];

export async function cabinetQuiExigeLeCode(pool: Pool, admin: pg.Client, utilisateur: string, nom: string): Promise<string> {
  const cabinet = (await enTantQue(pool, utilisateur, (tx) => tx.query('select * from socle.creer_cabinet($1)', [nom]))).rows[0].cabinet as string;
  const dossier = (await enTantQue(pool, utilisateur, (tx) => tx.query('select socle.creer_dossier_tenu($1, $2, null) d', [cabinet, `Dossier tenu par ${nom}`]))).rows[0].d as string;
  await admin.query(`update socle.entreprise set cree_le = now() - interval '8 days' where id = $1`, [dossier]);
  await admin.query(`update socle.mandat set cree_le = now() - interval '8 days' where entreprise = $1`, [dossier]);
  return cabinet;
}

// La même chose pour les tests d'écran, qui créent leur cabinet par l'API : `poster` crée le dossier tenu (la route du
// serveur, sous la session du comptable), puis ses dates reculent de huit jours.
export async function exigerLeCode(poster: (chemin: string, corps: unknown) => Promise<unknown>, admin: pg.Client, cabinet: string): Promise<void> {
  await poster(`/cabinets/${cabinet}/dossiers`, { raisonSociale: 'Dossier tenu depuis huit jours' });
  await admin.query(`update socle.entreprise set cree_le = now() - interval '8 days' where tenue_par = $1`, [cabinet]);
  await admin.query(`update socle.mandat set cree_le = now() - interval '8 days' where cabinet = $1`, [cabinet]);
}
