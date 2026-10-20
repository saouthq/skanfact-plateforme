-- La reprise du Cabinet v10 retirée (1.76.0, 20/10/2026 ; décision de Skander : « la v10 n'est installée chez
-- personne… supprime même la fonction »). Le livre d'un exercice de la v10 (0037 à 0042 : écritures, lettrages,
-- relevés, biens, questions, déclarations et inventaire) et le portefeuille d'un cabinet (brique 70, sans fonction
-- en base) ne se reprennent plus : leurs routes et leurs lecteurs sont partis du serveur, leurs fonctions partent
-- d'ici. Ce qu'une reprise a déjà écrit reste tel quel : des écritures, des biens et des relevés comme les autres.
-- La reprise d'un FEC, elle, reste (C61).

drop function compta.reprendre_livre_v10(uuid, int, date, date, jsonb, text);
drop function compta.reprendre_immobilisation_v10(uuid, int, jsonb, jsonb);
drop function compta.reprendre_declaration_v10(uuid, jsonb);
drop function compta.reprendre_inventaire_v10(uuid, int, jsonb);
drop function compta.reprendre_questions_v10(uuid, jsonb);
