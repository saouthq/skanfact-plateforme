-- La facture d'un contrat préparée après coup, et le mois qu'elle couvre (1.315.0 ; la Facturation récurrente jouée le
-- 07/11/2026, décidé par délégation). Une période en retard se facture datée du jour où elle part, jamais dans un mois passé
-- (un mois peut-être déclaré) ; son objet dit le mois qu'elle couvre, et sa pièce du dossier v10 le garde (`periode`). Le
-- livre du comptable le disait-il ? Non : « Facture FAC-2026-001 — Clinique » en novembre, sans rien de l'août qu'elle
-- facture, alors que c'est ce qu'il lui faut pour rattacher un produit à son exercice. Le serveur réécrit ces écritures
-- quel que soit celui dont le geste les réécrit : la question se pose ici, pour qui voit l'entreprise, et ne rend qu'une
-- date (ou rien : une facture qui ne vient pas d'un contrat, ou une période illisible).
create function ventes.periode_de_contrat(p_entreprise uuid, p_piece uuid) returns date
language sql stable security definer set search_path = pg_catalog, socle as $$
  select case when d.contenu->>'periode' ~ '^\d{4}-\d{2}-\d{2}$' then (d.contenu->>'periode')::date end
    from ventes.piece p join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'documents' and d.cle = p.ref_v10
   where p.entreprise = p_entreprise and p.id = p_piece and coalesce(d.contenu->>'recurringId', '') <> ''
     and p_entreprise in (select socle.mes_entreprises())
$$;
revoke all on function ventes.periode_de_contrat(uuid, uuid) from public;
grant execute on function ventes.periode_de_contrat(uuid, uuid) to skanfact_app;
