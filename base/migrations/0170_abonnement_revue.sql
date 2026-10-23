-- 0170 — L'abonnement après sa revue, lot 1 (1.118.0 ; docs/revue-abonnement.md, P2 7 à 9).
--
-- Revue du 22/10/2026 : l'abonné ne savait ni quand sa facture était prête (aucun e-mail), ni que son paiement était
-- reçu (aucun reçu), ni ce que dirait sa prochaine facture, et l'onglet annonçait un rappel déjà parti. Décidé par
-- délégation (Skander, « go » du 22/10/2026) :
--   - un e-mail quand une facture de l'abonnement est émise, un autre quand elle est payée (le reçu). Ce qui part chez le
--     relais d'e-mails, compté et décidé comme les rappels (0082) : l'adresse, un objet, une date (l'échéance de la
--     facture, ou le jour jusqu'où l'abonnement est payé), l'adresse de l'application. Ni le montant, ni le numéro, ni le
--     nom de l'entreprise. Une seule fois par facture et par nature ; un envoi raté se retente au tour suivant ;
--   - ce que la prochaine facture dira, lu par qui gère l'abonnement, par la MÊME règle que la facture et la console ;
--   - les rappels déjà partis pour l'échéance qui vient, que l'onglet dit au lieu d'en annoncer un.

-- ── 1. Les e-mails d'une facture : annoncée, puis reçue ─────────────────────────────────────────────────────────────
alter table plateforme.facture_abonnement add column annoncee_le timestamptz, add column recu_le timestamptz;
-- Les factures d'avant ne s'annoncent pas après coup : elles sont connues de leurs abonnés.
update plateforme.facture_abonnement set annoncee_le = now();
update plateforme.facture_abonnement set recu_le = now() where payee_le is not null;

-- Ce qui attend un e-mail (le serveur, chaque minute, hors de toute personne) : une facture émise pas encore annoncée,
-- une facture payée dont le reçu n'est pas parti. Pour chacune, les adresses de qui gère l'abonnement (le propriétaire,
-- les administrateurs : celles des rappels, relances_a_examiner), et la date que l'e-mail dit.
create function plateforme.factures_a_annoncer() returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
  with dus as (
    select f.id, f.entreprise, 'emise'::text nature, p.echeance le
      from plateforme.facture_abonnement f
      join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
     where f.annoncee_le is null and f.payee_le is null
    union all
    select f.id, f.entreprise, 'payee', a.paye_jusqu_au
      from plateforme.facture_abonnement f join plateforme.abonnement a on a.entreprise = f.entreprise
     where f.payee_le is not null and f.recu_le is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('facture', d.id, 'nature', d.nature, 'le', d.le,
           'adresses', (select coalesce(jsonb_agg(distinct u.email), '[]'::jsonb) from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                         where m.entreprise = d.entreprise and m.actif
                           and m.roles && array['proprietaire', 'administrateur']::text[]))
           order by d.id, d.nature), '[]'::jsonb)
    from dus d join socle.entreprise e on e.id = d.entreprise
   where socle.moi() is null and e.active
$$;

-- L'e-mail est parti (ou il n'y avait personne à prévenir) : la facture ne s'annonce plus.
create function plateforme.facture_annoncee(p_facture uuid, p_nature text, p_le timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note un e-mail de facture parti'); end if;
  if p_nature = 'emise' then
    update plateforme.facture_abonnement set annoncee_le = p_le where id = p_facture and annoncee_le is null;
  elsif p_nature = 'payee' then
    -- Payée sans avoir été annoncée (réglée le jour même) : le reçu dit tout, l'annonce ne part plus.
    update plateforme.facture_abonnement set recu_le = p_le, annoncee_le = coalesce(annoncee_le, p_le) where id = p_facture and recu_le is null;
  else
    perform socle.refus('nature inconnue');
  end if;
end $$;

-- ── 2. Ce que dira la prochaine facture ─────────────────────────────────────────────────────────────────────────────
-- Pour qui gère l'abonnement : le prix de l'offre au premier jour de la période, ce qui s'y ajoute, et la remise de la
-- période — ce que la console lit pour la même entreprise (console_renouvellements), compté ensuite par la règle de la
-- facture (htDeLaPeriode). Rien pour un autre rôle.
create function plateforme.ma_prochaine_facture(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date, p_debut date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    return null;
  end if;
  if p_offre not in ('essentiel', 'complet') or p_periodicite not in ('annuel', 'mensuel') then return null; end if;
  return jsonb_build_object(
    'prixHt', plateforme.prix_de(p_offre, p_periodicite, p_debut)::text,
    'enPlus', plateforme.lignes_en_plus(p_entreprise, p_offre, p_periodicite, p_jour, p_debut),
    'remise', plateforme.remise_de(p_entreprise, p_debut));
end $$;

-- ── 3. Les rappels déjà partis ──────────────────────────────────────────────────────────────────────────────────────
-- Pour qui gère l'abonnement : les rappels partis pour une échéance, avec leur jour.
create function plateforme.mes_rappels(p_entreprise uuid, p_echeance date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    return '[]'::jsonb;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('rang', r.rang, 'le', r.partie_le) order by r.partie_le), '[]'::jsonb)
            from plateforme.relance_abonnement r where r.entreprise = p_entreprise and r.echeance = p_echeance);
end $$;

revoke execute on function plateforme.factures_a_annoncer(), plateforme.facture_annoncee(uuid, text, timestamptz),
  plateforme.ma_prochaine_facture(uuid, text, text, date, date), plateforme.mes_rappels(uuid, date) from public;
grant execute on function plateforme.factures_a_annoncer(), plateforme.facture_annoncee(uuid, text, timestamptz),
  plateforme.ma_prochaine_facture(uuid, text, text, date, date), plateforme.mes_rappels(uuid, date) to skanfact_app;
