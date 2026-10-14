-- 0102 — Plus aucune offre ne compte les utilisateurs (Skander, 14/10/2026 ; skanfact docs/cadrage/07-offres-et-prix.md,
-- 03 § 4.1 révisé). Une petite entreprise a 1 à 3 personnes au bureau (les caissiers et le comptable ne comptaient déjà
-- pas) : le prix d'un utilisateur de plus ne rapportait presque rien, compliquait l'équipe et contredisait le premier
-- principe (un prix par entreprise, jamais par personne). Essentiel a donc, comme Complet, des utilisateurs sans limite.
--
-- Ce que l'entreprise utilise et ce que l'offre comprend restent UNE fonction chacune (0100), que la facture et l'écran
-- lisent toutes deux : elles ne parlent plus d'utilisateurs. Le prix de l'utilisateur de plus (0099) n'a jamais servi
-- à une facture réelle (aucune n'est encore émise à un vrai client) : il s'efface, et l'option avec lui.

create or replace function plateforme.comptes_de_l_entreprise(p_entreprise uuid, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, caisse, plateforme as $$
  select jsonb_build_object(
    'salaries', (select count(*) from socle.dossier_v10 d where d.entreprise = p_entreprise and d.collection = 'employees'
                   and coalesce(nullif(d.contenu->>'endDate', ''), '9999-12-31') >= to_char(p_jour, 'YYYY-MM-DD'))::int,
    'caisses', (select count(*) from caisse.caisse c where c.entreprise = p_entreprise and c.active)::int,
    'etablissements', (select count(*) from socle.etablissement e where e.entreprise = p_entreprise and e.actif)::int)
$$;

create or replace function plateforme.inclus_de_l_offre(p_offre text, p_modules text[]) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case p_offre
    when 'essentiel' then jsonb_build_object('caisses', 1, 'etablissements', 1,
      'salaries', case when 'paie' = any(coalesce(p_modules, '{}')) then 10 end)
    when 'complet' then jsonb_build_object('caisses', 2, 'etablissements', 2, 'salaries', 20)
  end
$$;

create or replace function plateforme.lignes_en_plus(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, caisse, plateforme as $$
declare
  v_modules text[] := coalesce((select a.modules from plateforme.abonnement a where a.entreprise = p_entreprise), '{}');
  v_comptes jsonb := plateforme.comptes_de_l_entreprise(p_entreprise, p_jour);
  v_inclus jsonb := plateforme.inclus_de_l_offre(p_offre, v_modules);
  v_lignes jsonb := '[]'::jsonb;
  v_c record;
  v_prix bigint;
begin
  for v_c in
    select x.option, x.compte, x.inclus,
           case when x.option like 'module_%' then x.compte when x.inclus is null then 0 else greatest(x.compte - x.inclus, 0) end quantite
      from (values
        ('module_paie', case when p_offre = 'essentiel' and 'paie' = any(v_modules) then 1 else 0 end, 0),
        ('module_compta', case when p_offre = 'essentiel' and 'compta' = any(v_modules) then 1 else 0 end, 0),
        ('caisse', (v_comptes->>'caisses')::int, (v_inclus->>'caisses')::int),
        ('etablissement', (v_comptes->>'etablissements')::int, (v_inclus->>'etablissements')::int),
        ('salarie', (v_comptes->>'salaries')::int, (v_inclus->>'salaries')::int)
      ) as x(option, compte, inclus)
  loop
    continue when v_c.quantite <= 0;
    select p.montant_ht into v_prix from plateforme.prix_option p
     where p.option = v_c.option and p.periodicite = p_periodicite and p.a_partir_du <= p_jour order by p.a_partir_du desc limit 1;
    if v_prix is null then perform socle.refus(format('aucun prix n''est posé pour cette ligne de la facture : %s', v_c.option)); end if;
    v_lignes := v_lignes || jsonb_build_object('option', v_c.option, 'quantite', v_c.quantite, 'compte', v_c.compte,
      'inclus', v_c.inclus, 'prixHt', v_prix::text);
  end loop;
  return v_lignes;
end $$;

delete from plateforme.prix_option where option = 'utilisateur';
alter table plateforme.prix_option drop constraint prix_option_option_check;
alter table plateforme.prix_option add constraint prix_option_option_check
  check (option in ('module_paie', 'module_compta', 'caisse', 'etablissement', 'salarie'));
