-- (1.321.0) L'état des impayés que le client envoie à son comptable, lu par qui lit ses livres (les Relances jouées le
-- 07/11/2026, décidé par délégation). Le reste dû d'une facture, le cabinet le lit dans les livres ; ce qu'il n'y lit pas,
-- c'est ce que l'entreprise sait de son client : ses relances, et s'il conteste la facture. Le client envoie l'état de ses
-- impayés (`etatsImpayes` de son dossier : chaque facture en retard, son reste, son retard, ses relances, le litige noté) ;
-- son cabinet le LIT, sous un mandat qui comprend la comptabilité (compta.mes_entreprises), sans jamais l'écrire, et en
-- juge s'il faut une provision.
create policy etat_des_impayes_au_cabinet on socle.dossier_v10 for select using (
  collection = 'etatsImpayes' and entreprise in (select compta.mes_entreprises()));
