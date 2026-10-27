-- La facture électronique reçue garde son fichier (27/10/2026 ; maquette achat « E-facture », « Justificatif joint :
-- …xml ») : le XML El Fatoora lu se joint à l'achat comme son justificatif, tel quel, dix ans comme les photos et les
-- PDF. Rien d'autre n'entre : le serveur le reconnaît à son en-tête XML (serveur/achats/sorte.ts), jamais à son nom.
alter table socle.piece_jointe drop constraint piece_jointe_type_check;
alter table socle.piece_jointe add constraint piece_jointe_type_check
  check (type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml'));
