-- Le cabinet lit les réglages de paie du client (19/10/2026, 1.67.0 ; docs/paie.md, « Le Cabinet lit les réglages de
-- paie du client »). Un client qui tient sa paie dans son SkanFact y règle ses taux (l'accident du travail de son
-- activité, sa TFP, ses taux par contrat, son barème) : ils vivent à la racine de son dossier v10 (`payrollSettings`).
-- Sous un mandat de paie, le cabinet établit et corrige ses bulletins ; il les calculait avec les taux par défaut, faute
-- de pouvoir lire les siens (0035 ne lui ouvre que la paie et le plan). Désormais il les LIT, sous ce seul mandat ; il ne
-- les écrit pas (la règle ne vaut que pour la lecture, et la route de la paie n'écrit que les salariés et les bulletins).
create policy reglages_de_paie_au_cabinet on socle.dossier_v10 for select using (
  collection = '_racine' and cle = 'payrollSettings' and entreprise in (select socle.mes_entreprises_au_perimetre('paie')));
