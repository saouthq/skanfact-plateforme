-- 0209 — Tout ce qui entre et sort du tiroir pendant la journée de caisse (1.357.6 ; docs/revue-modules.md, bout en bout 15).
--
-- 0189 avait réglé la paie : un salaire payé en espèces du tiroir, caisse ouverte, et le Z en faisait un manque qu'il sortait
-- une seconde fois contre le 658. Le même défaut vivait partout ailleurs. Une boulangerie verse les espèces du comptoir à la
-- BIAT (un virement de la Trésorerie), paie une dépense « à la caisse », encaisse en espèces une facture d'hôtel : les livres
-- et la Trésorerie le savent, le Z non — il annonçait le soir 50 DT de manque pour les 50 DT versés le matin, et le livre les
-- sortait deux fois. Chaque flux du tiroir noté ailleurs que sur un ticket, la caisse ouverte, se note dans sa session : une
-- SORTIE en positif, une ENTRÉE en négatif (le fond complété par la banque, une facture payée en espèces au comptoir) ; le Z
-- les retire, ou les ajoute, à ce que le tiroir devait contenir, et les nomme à part de la paie.
--   mouvement : un mouvement de la Trésorerie (virement, apport, retrait, autre sortie…) depuis ou vers le tiroir ;
--   achat     : un règlement fournisseur payé du tiroir (ou un remboursement qu'il reçoit) ;
--   vente     : un paiement de client reçu dans le tiroir hors d'un ticket (ou un remboursement qui en sort).

alter table caisse.sortie drop constraint sortie_nature_check;
alter table caisse.sortie add constraint sortie_nature_check check (nature in ('salaire', 'avance', 'mouvement', 'achat', 'vente'));
alter table caisse.sortie drop constraint sortie_montant_check;
alter table caisse.sortie add constraint sortie_montant_check check (montant <> 0 and (montant > 0 or nature in ('mouvement', 'achat', 'vente')));
