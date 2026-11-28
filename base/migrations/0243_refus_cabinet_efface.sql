-- 0243 — Les refus restés après une facture de cabinet faite s'effacent (1.389.6 ; l'issue #29, CONS3-6).
--
-- Le refus d'une période (plateforme.facture_cabinet_refus, 0172) dit pourquoi sa facture ne s'est pas faite seule ; la
-- fiche du cabinet le montre en rouge tant qu'il existe. La facture notée l'efface (noter_facture_cabinet, 0172), mais
-- deux tours lancés ensemble — celui de la minute et celui qui suit un dossier créé — en recréaient un : le second trouvait
-- la facture faite et notait « déjà émise » comme un refus (corrigé dans serveur/abonnement/cabinet.ts). Ceux que cette
-- course a laissés s'effacent ici.

delete from plateforme.facture_cabinet_refus r
 where exists (select 1 from plateforme.facture_cabinet f where f.cabinet = r.cabinet and f.debut = r.debut);
