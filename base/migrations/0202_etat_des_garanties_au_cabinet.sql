-- (1.322.0) Le parc sous garantie que le client envoie à son comptable, lu par qui lit ses livres (les Garanties jouées le
-- 07/11/2026, décidé par délégation). À la clôture, le comptable juge s'il faut une provision pour les réparations que
-- l'entreprise fera gratuitement sur ce qu'elle a déjà vendu : rien de cela n'est dans ses livres. Le client envoie l'état
-- de son parc à une date (`etatsGaranties` de son dossier : par article, combien d'appareils livrés sont encore garantis,
-- ce qu'ils ont été vendus hors taxes, jusqu'à quand ; ni client ni numéro de série) ; son cabinet le LIT, sous un mandat
-- qui comprend la comptabilité (compta.mes_entreprises), sans jamais l'écrire.
create policy etat_des_garanties_au_cabinet on socle.dossier_v10 for select using (
  collection = 'etatsGaranties' and entreprise in (select compta.mes_entreprises()));
