// La porte du module de la comptabilité, au serveur (cadrage 17 ; le contrôle des frontières, F13) : ce que les autres
// dossiers du serveur en appellent passe par ici, pour que le module se range sans les casser. Sa première entrée (1.303.0) :
// l'opération diverse que le client saisit, suivie dans les livres. Les appels plus anciens (les ventes, les achats, les
// mouvements, la paie) restent comptés dans la liste des écarts connus, jusqu'à ce qu'ils passent par ici.

export { suivreOperations } from './operations.ts';
