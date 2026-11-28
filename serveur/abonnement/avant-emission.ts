// Avant d'émettre une facture qui part seule (1.389.2 ; issue #29, CONS3-1) : la facture au choix d'un abonné et celle
// d'un cabinet passent par le contrôle que l'émission à la main fait voir (« Avant d'émettre · il manque le RIB ») — sans
// quoi elles partent sans que personne ne le voie, et le client lit « Paiement par virement bancaire » sans savoir où
// virer. Sans RIB, la facture ne s'émet pas : elle attend dans « À décider » avec sa raison, et se retente le lendemain.
// Le matricule fiscal du client, que l'émission à la main signale aussi, ne bloque pas : la règle reste À VÉRIFIER avec
// un expert (et un cabinet n'a pas de matricule dans la plateforme).

import { Refus } from '../erreurs.ts';
import type { Json } from '../v10/lecture.ts';

export function controlerAvantEmission(societe: Json): void {
  if (!(typeof societe.rib === 'string' && societe.rib.trim() !== '')) throw new Refus('abonnement.facture.sans_rib');
}
