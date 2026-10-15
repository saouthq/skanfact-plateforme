-- 0130 : les secrets et leur échéance (1.37.0 ; la liste des fonctions qui manquent, 32 : « suivi des configurations et
-- des secrets : état, rotation et renouvellement, sans exposition des secrets » ; docs/console.md C53). Les clés et les
-- mots de passe du service (le relais d'e-mails, les SMS, le stockage hors de la machine, le chiffrement des sauvegardes,
-- le prestataire de paiement…) vivent sur le serveur ou chez Cloudflare, JAMAIS ici. La console en garde le registre :
-- le nom de chacun, à quoi il sert, où il vit, quand il a été renouvelé, quand il expire et tous les combien on le
-- renouvelle. Jamais sa valeur : une phrase qui ressemble à une clé est refusée. La direction et la technique le tiennent ;
-- chaque geste au journal, avec son motif.

create table plateforme.secret_suivi (
  id uuid primary key default socle.uuidv7(),
  nom text not null check (length(btrim(nom)) between 3 and 80),
  role text not null check (length(btrim(role)) between 3 and 200),
  ou text not null check (length(btrim(ou)) between 3 and 200),
  renouvele_le date not null,
  expire_le date check (expire_le is null or expire_le >= renouvele_le),
  rotation_jours integer check (rotation_jours is null or rotation_jours between 1 and 3650),
  note_le timestamptz not null,
  note_par uuid not null references socle.utilisateur(id),
  retire_le timestamptz,
  retire_par uuid references socle.utilisateur(id),
  check ((retire_le is null) = (retire_par is null)),
  -- Une valeur ne s'écrit jamais ici : pas de longue suite de caractères comme en ont les clés.
  check (nom !~ '[A-Za-z0-9+=_-]{32,}' and role !~ '[A-Za-z0-9+=_-]{32,}' and ou !~ '[A-Za-z0-9+=_-]{32,}')
);
-- Un nom, un secret suivi (sans la casse) tant qu'il n'est pas retiré.
create unique index secret_suivi_nom on plateforme.secret_suivi (lower(btrim(nom))) where retire_le is null;
alter table plateforme.secret_suivi enable row level security;
alter table plateforme.secret_suivi force row level security;

-- Les refus communs aux gestes : un texte qui ressemble à une clé, des dates qui ne vont pas ensemble.
create function plateforme.secret_textes_sains(p_nom text, p_role text, p_ou text) returns void
language plpgsql immutable set search_path = pg_catalog, socle as $$
begin
  if coalesce(p_nom, '') ~ '[A-Za-z0-9+=_-]{32,}' or coalesce(p_role, '') ~ '[A-Za-z0-9+=_-]{32,}' or coalesce(p_ou, '') ~ '[A-Za-z0-9+=_-]{32,}' then
    perform socle.refus('cela ressemble à la valeur d''un secret : on n''écrit ici que son nom, à quoi il sert, où il vit et ses dates');
  end if;
end $$;

create function plateforme.console_secrets() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'nom', s.nom, 'role', s.role, 'ou', s.ou, 'renouveleLe', s.renouvele_le, 'expireLe', s.expire_le,
      'rotationJours', s.rotation_jours, 'noteLe', s.note_le, 'notePar', (select u.nom from socle.utilisateur u where u.id = s.note_par))
      order by lower(s.nom)), '[]'::jsonb)
    from plateforme.secret_suivi s where s.retire_le is null);
end $$;

-- Noter un secret à suivre.
create function plateforme.console_noter_secret(p_nom text, p_role text, p_ou text, p_renouvele_le date, p_expire_le date, p_rotation integer,
  p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.secret_textes_sains(p_nom, p_role, p_ou);
  if length(btrim(coalesce(p_nom, ''))) not between 3 and 80 then perform socle.refus('le nom d''un secret : de trois à quatre-vingts caractères'); end if;
  if length(btrim(coalesce(p_role, ''))) not between 3 and 200 or length(btrim(coalesce(p_ou, ''))) not between 3 and 200 then
    perform socle.refus('à quoi sert un secret, et où il vit : de trois à deux cents caractères chacun');
  end if;
  if p_renouvele_le is null or p_renouvele_le > (p_maintenant at time zone 'Africa/Tunis')::date then
    perform socle.refus('le jour où le secret a été renouvelé : aujourd''hui ou avant');
  end if;
  if p_expire_le is not null and p_expire_le < p_renouvele_le then perform socle.refus('un secret n''expire pas avant d''avoir été renouvelé'); end if;
  if p_rotation is not null and p_rotation not between 1 and 3650 then perform socle.refus('un rythme de renouvellement : d''un jour à dix ans'); end if;
  if exists (select 1 from plateforme.secret_suivi s where lower(btrim(s.nom)) = lower(btrim(p_nom)) and s.retire_le is null) then
    perform socle.refus('ce secret est déjà suivi : note son renouvellement sur sa ligne');
  end if;
  insert into plateforme.secret_suivi (nom, role, ou, renouvele_le, expire_le, rotation_jours, note_le, note_par)
    values (btrim(p_nom), btrim(p_role), btrim(p_ou), p_renouvele_le, p_expire_le, p_rotation, p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'service.secret_note', null, btrim(p_motif), null,
            jsonb_build_object('nom', btrim(p_nom), 'renouveleLe', p_renouvele_le, 'expireLe', p_expire_le, 'rotationJours', p_rotation));
  return v_id;
end $$;

-- Noter qu'un secret a été renouvelé : le jour, et sa nouvelle date d'expiration s'il en a une.
create function plateforme.console_secret_renouvele(p_id uuid, p_le date, p_expire_le date, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); s plateforme.secret_suivi;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select * into s from plateforme.secret_suivi where id = p_id and retire_le is null for update;
  if not found then perform socle.refus('ce secret n''est pas suivi'); end if;
  if p_le is null or p_le > (p_maintenant at time zone 'Africa/Tunis')::date then
    perform socle.refus('le jour où le secret a été renouvelé : aujourd''hui ou avant');
  end if;
  if p_le < s.renouvele_le then perform socle.refus('un renouvellement vient après le précédent'); end if;
  if p_expire_le is not null and p_expire_le < p_le then perform socle.refus('un secret n''expire pas avant d''avoir été renouvelé'); end if;
  update plateforme.secret_suivi set renouvele_le = p_le, expire_le = p_expire_le where id = s.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'service.secret_renouvele', null, btrim(p_motif),
            jsonb_build_object('nom', s.nom, 'renouveleLe', s.renouvele_le, 'expireLe', s.expire_le),
            jsonb_build_object('nom', s.nom, 'renouveleLe', p_le, 'expireLe', p_expire_le));
end $$;

-- Ne plus le suivre (il n'existe plus) : la ligne reste, retirée, et le journal le dit.
create function plateforme.console_retirer_secret(p_id uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); s plateforme.secret_suivi;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select * into s from plateforme.secret_suivi where id = p_id and retire_le is null for update;
  if not found then perform socle.refus('ce secret n''est pas suivi'); end if;
  update plateforme.secret_suivi set retire_le = p_maintenant, retire_par = socle.moi() where id = s.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'service.secret_retire', null, btrim(p_motif), jsonb_build_object('nom', s.nom), null);
end $$;

revoke execute on function plateforme.secret_textes_sains(text, text, text), plateforme.console_secrets(),
  plateforme.console_noter_secret(text, text, text, date, date, integer, text, timestamptz),
  plateforme.console_secret_renouvele(uuid, date, date, text, timestamptz), plateforme.console_retirer_secret(uuid, text, timestamptz) from public;
grant execute on function plateforme.console_secrets(), plateforme.console_noter_secret(text, text, text, date, date, integer, text, timestamptz),
  plateforme.console_secret_renouvele(uuid, date, date, text, timestamptz), plateforme.console_retirer_secret(uuid, text, timestamptz) to skanfact_app;
