-- 0232 — Les réglages à distance (pilotage depuis la console, point 7 ; Skander, 25/11/2026 : « limites, textes, délais
-- changés sans nouvelle version »).
--
-- Quelques chiffres du serveur se règlent depuis la console, sans nouvelle version : les limites d'appels de l'entrée et
-- de l'API, la durée du lien « mot de passe oublié » et celle du code reçu par e-mail. La liste de ce qui se règle, ses
-- bornes et ses valeurs d'origine vivent dans le code du serveur (serveur/reglages-distants.ts) : la base ne garde que
-- ce que le titulaire a changé. Revenir à la valeur d'origine retire la ligne. Chaque geste a son motif et sa ligne au
-- journal.

create table plateforme.reglage_distant (
  cle text primary key check (cle ~ '^[a-z_]{2,30}\.[a-z_]{2,30}$'),
  valeur integer not null,
  motif text not null,
  le timestamptz not null,
  par uuid not null references socle.utilisateur(id)
);
alter table plateforme.reglage_distant enable row level security;
alter table plateforme.reglage_distant force row level security;

-- Ce que le serveur lit (au plus toutes les dix secondes), sans session : les réglages changés, rien d'autre.
create function plateforme.reglages_distants_en_vigueur() returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) from plateforme.reglage_distant;
$$;

-- Changer un réglage (dans les bornes que le serveur donne), ou le ramener à sa valeur d'origine (p_valeur vide).
create function plateforme.console_poser_reglage_distant(p_cle text, p_valeur integer, p_min integer, p_max integer, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_avant integer := (select valeur from plateforme.reglage_distant where cle = p_cle);
begin
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console change un réglage à distance');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  if p_cle !~ '^[a-z_]{2,30}\.[a-z_]{2,30}$' then perform socle.refus('ce réglage n''existe pas'); end if;
  if p_valeur is null then
    if v_avant is null then perform socle.refus('ce réglage a déjà sa valeur d''origine'); end if;
    delete from plateforme.reglage_distant where cle = p_cle;
    insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
      values (socle.moi(), v_role, 'reglages.distant_origine', btrim(p_motif), jsonb_build_object('cle', p_cle, 'valeur', v_avant), jsonb_build_object('cle', p_cle, 'valeur', null));
    return;
  end if;
  if p_valeur < p_min or p_valeur > p_max then perform socle.refus('cette valeur sort des bornes de ce réglage'); end if;
  if v_avant = p_valeur then perform socle.refus('ce réglage a déjà cette valeur'); end if;
  insert into plateforme.reglage_distant (cle, valeur, motif, le, par) values (p_cle, p_valeur, btrim(p_motif), p_maintenant, socle.moi())
    on conflict (cle) do update set valeur = excluded.valeur, motif = excluded.motif, le = excluded.le, par = excluded.par;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.distant', btrim(p_motif), jsonb_build_object('cle', p_cle, 'valeur', v_avant), jsonb_build_object('cle', p_cle, 'valeur', p_valeur));
end $$;

-- La console : les réglages changés (qui, quand, pourquoi) et les vingt derniers gestes.
create function plateforme.console_reglages_distants() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']);
begin
  return jsonb_build_object(
    'titulaire', plateforme.suis_titulaire_console(),
    'nomTitulaire', (select u.nom from socle.utilisateur u where u.id = plateforme.titulaire_console()),
    'changes', coalesce((select jsonb_object_agg(r.cle, jsonb_build_object('valeur', r.valeur, 'motif', r.motif, 'le', r.le,
        'par', (select u.nom from socle.utilisateur u where u.id = r.par))) from plateforme.reglage_distant r), '{}'::jsonb),
    'historique', coalesce((select jsonb_agg(h order by h.le desc, h.id desc) from (
      select g.id, g.le, g.geste, g.motif, g.avant, g.apres, u.nom par
        from plateforme.geste_console g left join socle.utilisateur u on u.id = g.qui
       where g.geste in ('reglages.distant', 'reglages.distant_origine')
       order by g.le desc, g.id desc limit 20) h), '[]'::jsonb));
end $$;

revoke execute on function plateforme.reglages_distants_en_vigueur(), plateforme.console_poser_reglage_distant(text, integer, integer, integer, text, timestamptz),
  plateforme.console_reglages_distants() from public;
grant execute on function plateforme.reglages_distants_en_vigueur(), plateforme.console_poser_reglage_distant(text, integer, integer, integer, text, timestamptz),
  plateforme.console_reglages_distants() to skanfact_app;
