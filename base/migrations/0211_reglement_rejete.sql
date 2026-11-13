-- 0211 — Le chèque ou l'effet revenu impayé (1.359.0 ; docs/revue-modules.md, bout en bout 21).
--
-- Un client paie par chèque, la banque le rejette quelques jours plus tard. Le seul geste offert était de SUPPRIMER le
-- paiement : la trace du chèque disparaissait (la relance n'avait plus rien à dire), et le relevé de la banque, qui montre la
-- remise ET son rejet, ne s'accordait plus avec ce que l'entreprise avait saisi. Le rejet est un règlement NÉGATIF qui
-- désigne le paiement qu'il annule (`rejet_de`, l'identifiant que la v10 a donné à ce paiement) : la facture redevient due,
-- la banque voit la sortie, et l'écriture se nomme « Chèque impayé » chez le comptable au lieu de « Remboursement ».
--   ventes.reglement.rejet_de  : le paiement rejeté ;
--   achats.reglement.rejet_de  : la même case (les deux tables ont les mêmes colonnes, serveur/reglements.ts).
alter table ventes.reglement add column rejet_de text
  check (rejet_de is null or (length(rejet_de) between 1 and 200 and montant < 0));
alter table achats.reglement add column rejet_de text
  check (rejet_de is null or (length(rejet_de) between 1 and 200 and montant < 0));
