-- 0231 — La version minimale imposée (pilotage depuis la console, point 6 ; Skander, 25/11/2026 : « recharger les écrans
-- trop anciens après une correction importante »).
--
-- Un onglet ouvert depuis lundi garde le code de lundi : une correction publiée mardi ne l'atteint qu'au prochain
-- rechargement. Le titulaire de la console impose la version EN LIGNE comme minimum : un écran plus ancien voit un bandeau
-- « recharge la page », et le serveur refuse ses enregistrements (un vieux code n'écrit plus de travers). L'écran le dit,
-- et ce qui est à l'écran n'est pas perdu tant qu'on ne recharge pas.
--
-- La dernière ligne fait foi ; une ligne sans version retire le minimum. Chaque geste a son motif et sa ligne au journal.

create table plateforme.version_minimale (
  id bigserial primary key,
  -- La version imposée (« 1.388.76 ») ; vide : plus de minimum.
  version text check (version is null or version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  -- Ce que voient les clients, en plus de la phrase de l'application (facultatif).
  message text,
  motif text not null,
  posee_le timestamptz not null,
  posee_par uuid not null references socle.utilisateur(id)
);
alter table plateforme.version_minimale enable row level security;
alter table plateforme.version_minimale force row level security;

-- Ce que le serveur lit (au plus toutes les cinq secondes), sans session : la version imposée, ou rien.
create function plateforme.version_minimale_en_vigueur() returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select case when v.version is null then null else jsonb_build_object('id', v.id, 'version', v.version, 'message', v.message) end
    from (select * from plateforme.version_minimale order by id desc limit 1) v;
$$;

-- Imposer une version (la version en ligne, que le serveur donne), ou la retirer (p_version vide).
create function plateforme.console_poser_version_minimale(p_version text, p_message text, p_motif text, p_maintenant timestamptz) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_avant jsonb := plateforme.version_minimale_en_vigueur();
  v_id bigint;
begin
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console impose une version minimale');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  if p_version is null then
    if v_avant is null then perform socle.refus('aucune version minimale n''est imposée : il n''y a rien à retirer'); end if;
    if v_msg is not null then perform socle.refus('un message aux clients accompagne une version imposée : la retirer efface aussi le message'); end if;
  else
    if p_version !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then perform socle.refus('cette version ne se lit pas'); end if;
    if v_avant is not null and v_avant->>'version' = p_version and v_avant->>'message' is not distinct from v_msg then
      perform socle.refus('cette version est déjà imposée');
    end if;
    if v_msg is not null then
      if length(v_msg) not between 3 and 300 or v_msg ~ '[<>]' then perform socle.refus('le message aux clients tient entre trois et trois cents caractères, sans balise'); end if;
      perform plateforme.motif_sans_secret(v_msg);
    end if;
  end if;
  insert into plateforme.version_minimale (version, message, motif, posee_le, posee_par)
    values (p_version, v_msg, btrim(p_motif), p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, case when p_version is null then 'service.version_minimale_retiree' else 'service.version_minimale' end, btrim(p_motif),
      v_avant, case when p_version is null then null else jsonb_build_object('version', p_version, 'message', v_msg) end);
  return v_id;
end $$;

-- La console : la version imposée, et les dix derniers gestes.
create function plateforme.console_version_minimale() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']);
begin
  return jsonb_build_object(
    'titulaire', plateforme.suis_titulaire_console(),
    'nomTitulaire', (select u.nom from socle.utilisateur u where u.id = plateforme.titulaire_console()),
    'lignes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'message', v.message, 'motif', v.motif,
        'le', v.posee_le, 'par', (select u.nom from socle.utilisateur u where u.id = v.posee_par)) order by v.id desc)
      from (select * from plateforme.version_minimale order by id desc limit 10) v), '[]'::jsonb));
end $$;

revoke execute on function plateforme.version_minimale_en_vigueur(), plateforme.console_poser_version_minimale(text, text, text, timestamptz),
  plateforme.console_version_minimale() from public;
grant execute on function plateforme.version_minimale_en_vigueur(), plateforme.console_poser_version_minimale(text, text, text, timestamptz),
  plateforme.console_version_minimale() to skanfact_app;
