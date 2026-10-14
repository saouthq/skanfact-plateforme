-- 0100 — Ce que l'offre compte, lu par l'entreprise (abonnement 14c, deuxième partie, b ; docs/abonnement.md « 14c » ;
-- skanfact docs/cadrage/07-offres-et-prix.md, 03 § 4.1). Décidé par délégation le 14/10/2026.
--
-- La facture compte ce qui dépasse l'offre le jour où elle se prépare (0099). L'entreprise doit le lire AVANT : « Ton
-- abonnement » dit ce qu'elle utilise sur ce que son offre comprend, et « L'équipe » prévient avant l'invitation qui
-- coûtera un utilisateur de plus (03 § 4.1). Un compteur et la liste qu'il annonce se calculent avec la même fonction :
-- ce que l'entreprise utilise (plateforme.comptes_de_l_entreprise) et ce que l'offre comprend
-- (plateforme.inclus_de_l_offre) vivent ICI, une fois, et la facture (plateforme.lignes_en_plus, refaite) les lit aussi.

-- ── 1. Ce que l'entreprise utilise, un jour donné ──────────────────────────────────────────────────────────────────────
--   - les utilisateurs : chaque membre ACTIF, une fois, quel que soit son rôle — sauf qui n'a que les rôles de la caisse
--     (caissier, serveur : c'est la caisse qui se paie). Jamais l'équipe d'un cabinet (03 § 4.1) ;
--   - les invitations qui attendent et qui compteront une fois acceptées (mêmes rôles) : l'écran prévient avec elles ;
--     la facture, elle, ne les compte jamais ;
--   - les salariés : les fiches de la paie sans date de sortie, ou sortis ce jour-là ou après ;
--   - les caisses et les établissements actifs.
create function plateforme.comptes_de_l_entreprise(p_entreprise uuid, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, caisse, plateforme as $$
  select jsonb_build_object(
    'utilisateurs', (select count(*) from socle.membre m where m.entreprise = p_entreprise and m.actif
                       and not (m.roles <@ array['caissier', 'serveur']::text[]))::int,
    'invitations', (select count(*) from socle.invitation i where i.entreprise = p_entreprise and i.acceptee_le is null
                      and i.annulee_le is null and i.expire_le > now() and not (i.roles <@ array['caissier', 'serveur']::text[]))::int,
    'salaries', (select count(*) from socle.dossier_v10 d where d.entreprise = p_entreprise and d.collection = 'employees'
                   and coalesce(nullif(d.contenu->>'endDate', ''), '9999-12-31') >= to_char(p_jour, 'YYYY-MM-DD'))::int,
    'caisses', (select count(*) from caisse.caisse c where c.entreprise = p_entreprise and c.active)::int,
    'etablissements', (select count(*) from socle.etablissement e where e.entreprise = p_entreprise and e.actif)::int)
$$;

-- ── 2. Ce que chaque offre comprend (07) ───────────────────────────────────────────────────────────────────────────────
-- Essentiel : 3 utilisateurs, 1 caisse, 1 établissement, et 10 salariés avec la paie achetée ; Complet : des utilisateurs
-- sans limite, 2 caisses, 2 établissements, 20 salariés. `null` : sans limite (les utilisateurs de Complet) ou rien à
-- compter (les salariés sans la paie). Une offre inconnue (l'essai, un abonnement offert) ne compte rien.
create function plateforme.inclus_de_l_offre(p_offre text, p_modules text[]) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case p_offre
    when 'essentiel' then jsonb_build_object('utilisateurs', 3, 'caisses', 1, 'etablissements', 1,
      'salaries', case when 'paie' = any(coalesce(p_modules, '{}')) then 10 end)
    when 'complet' then jsonb_build_object('utilisateurs', null, 'caisses', 2, 'etablissements', 2, 'salaries', 20)
  end
$$;

-- ── 3. Les lignes en plus d'une facture, sur ces deux fonctions ───────────────────────────────────────────────────────
-- Le même résultat que 0099, compté au même endroit que ce que l'écran montre.
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
        ('utilisateur', (v_comptes->>'utilisateurs')::int, (v_inclus->>'utilisateurs')::int),
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

-- ── 4. Ce que l'entreprise lit ─────────────────────────────────────────────────────────────────────────────────────────
-- Pour qui gère l'abonnement ou l'équipe (le propriétaire, un administrateur), jamais une clé d'API : ce qu'elle utilise
-- et ce que l'offre donnée (celle qui décide aujourd'hui, que le serveur déduit) comprend. Pour les autres : rien.
create function plateforme.ce_que_l_offre_compte(p_entreprise uuid, p_offre text, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    return null;
  end if;
  return jsonb_build_object('comptes', plateforme.comptes_de_l_entreprise(p_entreprise, p_jour),
    'inclus', plateforme.inclus_de_l_offre(p_offre, (select a.modules from plateforme.abonnement a where a.entreprise = p_entreprise)));
end $$;

revoke execute on function plateforme.comptes_de_l_entreprise(uuid, date), plateforme.ce_que_l_offre_compte(uuid, text, date) from public;
grant execute on function plateforme.ce_que_l_offre_compte(uuid, text, date) to skanfact_app;
