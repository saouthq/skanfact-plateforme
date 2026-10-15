-- Les nouveautés qu'on allume (1.27.0 ; docs/console.md C43 ; skanfact docs/cadrage/02-modules.md § 7, 10-console § 2.11 ;
-- la maquette « Réglages », onglet « Nouveautés allumées »). Une nouveauté s'allume d'abord pour des entreprises
-- volontaires, avant tout le monde : c'est l'essai sans installation. Elle n'existe que si la version en service la porte :
-- la liste des nouveautés vit dans le code (serveur/nouveautes.ts) ; la base ne tient que pour qui elles sont allumées,
-- depuis quand, par qui et pourquoi. Éteindre ne détruit rien : la ligne garde son histoire, les données de l'entreprise
-- restent les siennes.

-- Une nouveauté allumée pour UNE entreprise. Une seule ligne allumée à la fois par nouveauté et par entreprise.
create table plateforme.nouveaute_entreprise (
  id uuid primary key default socle.uuidv7(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  entreprise uuid not null references socle.entreprise(id),
  allumee_le timestamptz not null,
  allumee_par uuid not null references socle.utilisateur(id),
  motif text not null check (length(btrim(motif)) >= 3),
  eteinte_le timestamptz,
  eteinte_par uuid references socle.utilisateur(id),
  eteinte_motif text,
  check ((eteinte_le is null) = (eteinte_par is null) and (eteinte_le is null) = (eteinte_motif is null))
);
create unique index nouveaute_entreprise_allumee on plateforme.nouveaute_entreprise (code, entreprise) where eteinte_le is null;
alter table plateforme.nouveaute_entreprise enable row level security;
alter table plateforme.nouveaute_entreprise force row level security;

-- Une nouveauté ouverte à TOUTES les entreprises. Une seule ouverture en cours par nouveauté ; la refermer laisse
-- allumées les entreprises volontaires qui l'avaient avant.
create table plateforme.nouveaute_tous (
  id uuid primary key default socle.uuidv7(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  ouverte_le timestamptz not null,
  ouverte_par uuid not null references socle.utilisateur(id),
  motif text not null check (length(btrim(motif)) >= 3),
  refermee_le timestamptz,
  refermee_par uuid references socle.utilisateur(id),
  refermee_motif text,
  check ((refermee_le is null) = (refermee_par is null) and (refermee_le is null) = (refermee_motif is null))
);
create unique index nouveaute_tous_ouverte on plateforme.nouveaute_tous (code) where refermee_le is null;
alter table plateforme.nouveaute_tous enable row level security;
alter table plateforme.nouveaute_tous force row level security;

-- ── Ce que lit la console (la direction et le support, comme les autres réglages) ────────────────────────────────────
-- Pour chaque nouveauté qui a une ligne en cours : les entreprises pour qui elle est allumée (leur numéro, leur nom, qui
-- l'a allumée, quand et pourquoi) et son ouverture à tous. Les nouveautés que le code ne porte plus, le serveur les tait.
create function plateforme.console_nouveautes() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return jsonb_build_object(
    'allumees', (select coalesce(jsonb_agg(jsonb_build_object('code', n.code, 'entreprise', n.entreprise, 'numero', plateforme.numero_texte(n.entreprise),
                   'nom', e.raison_sociale, 'le', n.allumee_le, 'par', u.nom, 'motif', n.motif) order by n.code, n.allumee_le, n.id), '[]'::jsonb)
                 from plateforme.nouveaute_entreprise n join socle.entreprise e on e.id = n.entreprise join socle.utilisateur u on u.id = n.allumee_par
                where n.eteinte_le is null),
    'ouvertes', (select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'le', o.ouverte_le, 'par', u.nom, 'motif', o.motif) order by o.code), '[]'::jsonb)
                 from plateforme.nouveaute_tous o join socle.utilisateur u on u.id = o.ouverte_par
                where o.refermee_le is null));
end $$;

-- ── Les gestes : la direction seule, chacun avec son motif, chacun au journal de l'équipe ─────────────────────────────
-- Allumer pour une entreprise, désignée par son numéro de client (« E-0012 » : celui qu'on se dit au téléphone, jamais
-- son nom). Le serveur a déjà vérifié que la version en service porte cette nouveauté.
create function plateforme.console_allumer_nouveaute(p_code text, p_numero text, p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']); v_entreprise uuid; v_id uuid;
  v_numero text := upper(btrim(coalesce(p_numero, '')));
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('allumer une nouveauté demande son motif (trois caractères au moins)'); end if;
  if v_numero !~ '^E-?[0-9]{1,9}$' then perform socle.refus('une entreprise se désigne par son numéro de client (E-0012)'); end if;
  select n.objet into v_entreprise from plateforme.numero_client n
   where n.sorte = 'E' and n.numero = regexp_replace(v_numero, '^E-?', '')::integer;
  if v_entreprise is null then perform socle.refus('aucune entreprise ne porte ce numéro de client'); end if;
  perform pg_advisory_xact_lock(hashtext('plateforme.nouveaute'), hashtext(p_code));
  if exists (select 1 from plateforme.nouveaute_tous o where o.code = p_code and o.refermee_le is null) then
    perform socle.refus('cette nouveauté est déjà ouverte à toutes les entreprises');
  end if;
  if exists (select 1 from plateforme.nouveaute_entreprise n where n.code = p_code and n.entreprise = v_entreprise and n.eteinte_le is null) then
    perform socle.refus('cette nouveauté est déjà allumée pour cette entreprise');
  end if;
  insert into plateforme.nouveaute_entreprise (code, entreprise, allumee_le, allumee_par, motif)
    values (p_code, v_entreprise, p_maintenant, socle.moi(), btrim(p_motif)) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.nouveaute_allumee', v_entreprise, btrim(p_motif), null,
            jsonb_build_object('nouveaute', p_code, 'numero', plateforme.numero_texte(v_entreprise)));
  return v_id;
end $$;

-- L'éteindre pour une entreprise : ses données restent ; elle ne la voit plus à sa page suivante.
create function plateforme.console_eteindre_nouveaute(p_code text, p_entreprise uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('éteindre une nouveauté demande son motif (trois caractères au moins)'); end if;
  update plateforme.nouveaute_entreprise set eteinte_le = p_maintenant, eteinte_par = socle.moi(), eteinte_motif = btrim(p_motif)
   where code = p_code and entreprise = p_entreprise and eteinte_le is null returning id into v_id;
  if v_id is null then perform socle.refus('cette nouveauté n''est pas allumée pour cette entreprise'); end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.nouveaute_eteinte', p_entreprise, btrim(p_motif),
            jsonb_build_object('nouveaute', p_code, 'numero', plateforme.numero_texte(p_entreprise)), null);
end $$;

-- L'ouvrir à toutes les entreprises.
create function plateforme.console_ouvrir_nouveaute(p_code text, p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('ouvrir une nouveauté à tous demande son motif (trois caractères au moins)'); end if;
  perform pg_advisory_xact_lock(hashtext('plateforme.nouveaute'), hashtext(p_code));
  if exists (select 1 from plateforme.nouveaute_tous o where o.code = p_code and o.refermee_le is null) then
    perform socle.refus('cette nouveauté est déjà ouverte à toutes les entreprises');
  end if;
  insert into plateforme.nouveaute_tous (code, ouverte_le, ouverte_par, motif)
    values (p_code, p_maintenant, socle.moi(), btrim(p_motif)) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.nouveaute_ouverte', btrim(p_motif),
            jsonb_build_object('nouveaute', p_code, 'volontaires', (select count(*) from plateforme.nouveaute_entreprise n where n.code = p_code and n.eteinte_le is null)),
            jsonb_build_object('nouveaute', p_code));
  return v_id;
end $$;

-- La refermer : les entreprises volontaires qui l'avaient allumée la gardent.
create function plateforme.console_refermer_nouveaute(p_code text, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('refermer une nouveauté demande son motif (trois caractères au moins)'); end if;
  update plateforme.nouveaute_tous set refermee_le = p_maintenant, refermee_par = socle.moi(), refermee_motif = btrim(p_motif)
   where code = p_code and refermee_le is null returning id into v_id;
  if v_id is null then perform socle.refus('cette nouveauté n''est pas ouverte à toutes les entreprises'); end if;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.nouveaute_refermee', btrim(p_motif), jsonb_build_object('nouveaute', p_code),
            jsonb_build_object('nouveaute', p_code, 'volontaires', (select count(*) from plateforme.nouveaute_entreprise n where n.code = p_code and n.eteinte_le is null)));
end $$;

-- ── Ce que lit l'application : les nouveautés allumées pour CETTE entreprise ─────────────────────────────────────────
-- Un membre de l'entreprise seulement (une clé d'API aussi, si l'entreprise l'a donnée : ce n'est que la liste des codes).
-- Ni qui les a allumées, ni pourquoi : une note de SkanFact.
create function plateforme.nouveautes_de(p_entreprise uuid) returns text[]
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if coalesce(cardinality(socle.mes_roles(p_entreprise)), 0) = 0 then perform socle.refus('tu n''as pas accès à cette entreprise'); end if;
  return array(select c from (
      select n.code c from plateforme.nouveaute_entreprise n where n.entreprise = p_entreprise and n.eteinte_le is null
      union select o.code from plateforme.nouveaute_tous o where o.refermee_le is null) x order by c);
end $$;

revoke execute on function plateforme.console_nouveautes(), plateforme.console_allumer_nouveaute(text, text, text, timestamptz),
  plateforme.console_eteindre_nouveaute(text, uuid, text, timestamptz), plateforme.console_ouvrir_nouveaute(text, text, timestamptz),
  plateforme.console_refermer_nouveaute(text, text, timestamptz), plateforme.nouveautes_de(uuid) from public;
grant execute on function plateforme.console_nouveautes(), plateforme.console_allumer_nouveaute(text, text, text, timestamptz),
  plateforme.console_eteindre_nouveaute(text, uuid, text, timestamptz), plateforme.console_ouvrir_nouveaute(text, text, timestamptz),
  plateforme.console_refermer_nouveaute(text, text, timestamptz), plateforme.nouveautes_de(uuid) to skanfact_app;
