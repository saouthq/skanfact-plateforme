-- (1.274.0, audit du 04/11/2026, G06) Un salarié n'a qu'un bulletin par mois. La référence technique (ref_v10) était seule
-- unique : deux références pour le même salarié et le même mois doublaient le salaire, les cotisations et le paiement. Le
-- serveur le refuse avec une phrase (serveur/v10/paie.ts, tenirBulletin) ; la base le tient quand deux envois arrivent
-- ensemble. Aucune donnée réelle n'existe encore : un doublon déjà là arrêterait la migration, et se règle à la main.
create unique index bulletin_un_par_mois on paie.bulletin (entreprise, salarie, annee, mois);
