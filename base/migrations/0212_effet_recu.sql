-- 0212 — La traite reçue (ou remise) avant son échéance (1.361.0 ; docs/revue-modules.md, bout en bout 24).
--
-- Un client règle par traite à soixante jours. Dans SkanFact, la facture est « payée » le jour où la traite est reçue :
-- c'est vrai, la créance a changé de forme. Mais le serveur ne gardait que l'échéance, et le comptable ne voyait rien
-- avant elle : son lettrage disait que le client devait encore la facture, pendant que l'entreprise la disait réglée.
-- Deux chemins, deux chiffres, pendant deux mois — et sur le bilan, si l'échéance tombe après la clôture.
-- Le règlement garde maintenant le jour où l'effet a été reçu : ce jour-là la créance passe du client (411) aux effets à
-- recevoir (413), et l'encaissement, à l'échéance, solde le 413. Côté achats, la traite remise au fournisseur passe du
-- 401 aux effets à payer (403). À VÉRIFIER avec le comptable : 413 / 403, et le journal des opérations diverses.
--   ventes.reglement.effet_recu_le  : le jour où la traite est reçue (avant son échéance, seulement pour un paiement reçu) ;
--   achats.reglement.effet_recu_le  : la même case (les deux tables ont les mêmes colonnes, serveur/reglements.ts) ;
--   compta.ecriture.origine_type    : « effet », l'écriture du jour de la réception.
alter table ventes.reglement add column effet_recu_le date
  check (effet_recu_le is null or (montant > 0 and effet_recu_le < date_reglement));
alter table achats.reglement add column effet_recu_le date
  check (effet_recu_le is null or (montant > 0 and effet_recu_le < date_reglement));

alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur', 'paie', 'salaires', 'avance',
                          'mouvement', 'contre_passation', 'saisie', 'extourne', 'reprise_v10', 'declaration_sociale', 'saisie_salaire',
                          'operation_diverse', 'effet'));

-- Les traites déjà saisies : le jour de leur réception est dans la pièce du dossier (`effet.recuLe`), le serveur ne le
-- gardait pas. Leur écriture du jour de réception suit à la prochaine modification de la pièce (sa famille se réécrit).
update ventes.reglement r set effet_recu_le = (p.value->'effet'->>'recuLe')::date
  from ventes.piece v, socle.dossier_v10 d,
       jsonb_array_elements(case when jsonb_typeof(d.contenu->'payments') = 'array' then d.contenu->'payments' else '[]'::jsonb end) p
  where v.id = r.piece and d.entreprise = r.entreprise and d.collection = 'documents' and d.cle = v.ref_v10
    and p.value->>'id' = r.ref_v10 and r.montant > 0 and r.rejet_de is null
    and coalesce(p.value->'effet'->>'recuLe', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and (p.value->'effet'->>'recuLe') < r.date_reglement::text;
update achats.reglement r set effet_recu_le = (p.value->'effet'->>'recuLe')::date
  from achats.piece v, socle.dossier_v10 d,
       jsonb_array_elements(case when jsonb_typeof(d.contenu->'payments') = 'array' then d.contenu->'payments' else '[]'::jsonb end) p
  where v.id = r.piece and d.entreprise = r.entreprise and d.collection = 'purchases' and d.cle = v.ref_v10
    and p.value->>'id' = r.ref_v10 and r.montant > 0 and r.rejet_de is null
    and coalesce(p.value->'effet'->>'recuLe', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and (p.value->'effet'->>'recuLe') < r.date_reglement::text;
