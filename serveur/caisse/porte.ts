// La porte du module de la caisse, au serveur (cadrage 17 ; le contrôle des frontières, F13) : ce que les autres dossiers
// du serveur en appellent passe par ici, pour que le module se range sans les casser. Sa première entrée (1.357.6) : ce qui
// entre et sort du tiroir hors des tickets, suivi depuis le dossier (`suivreLeTiroir`). L'appel plus ancien de la paie
// (`noterSortieDeCaisse`) reste compté dans la liste des écarts connus, jusqu'à ce qu'il passe par ici.

export { suivreLeTiroir } from './sortie.ts';
