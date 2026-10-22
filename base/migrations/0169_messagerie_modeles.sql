-- 0169 — Les modèles de messages du cabinet (1.117.0 ; docs/revue-messagerie.md, lot 3, point 9).
--
-- Revue du 22/10/2026 : un comptable écrit les mêmes phrases à soixante clients (« Il me manque les pièces de
-- septembre », « Ta déclaration est déposée »). Décidé par délégation : le cabinet garde ses modèles (un titre, un
-- texte), partagés par toute son équipe ; un modèle se pose dans la zone d'écriture, où il se relit et se change avant
-- de partir. Deux mots se remplacent à ce moment-là, dans le navigateur : {client} (le nom du client) et {mois} (le
-- mois qui vient de finir). Les modèles appartiennent au cabinet : ils ne partent pas avec l'export d'une entreprise.

create table messagerie.modele (
  id uuid primary key default socle.uuidv7(),
  cabinet uuid not null references socle.organisation(id),
  titre text not null check (length(titre) between 1 and 80 and titre = trim(titre)),
  texte text not null check (length(texte) between 1 and 4000 and texte = trim(texte)),
  modifie_par uuid references socle.utilisateur(id),
  modifie_le timestamptz not null default now(),
  unique (cabinet, titre)
);
create index modele_cabinet on messagerie.modele (cabinet, titre);

-- Les lit et les écrit qui est du cabinet ; un cabinet, pas un groupe.
alter table messagerie.modele enable row level security;
alter table messagerie.modele force row level security;
create policy visible on messagerie.modele
  using (cabinet in (select socle.mes_organisations()))
  with check (cabinet in (select socle.mes_organisations())
              and exists (select 1 from socle.organisation o where o.id = cabinet and o.type = 'cabinet'));
-- Les écritures passent par les fonctions (leurs règles) : l'application ne fait que lire la table.
grant select on messagerie.modele to skanfact_app;

-- Poser un modèle (le créer, ou le changer : `p_id`) et le retirer. Les règles vivent ici : un modèle se nomme en 80
-- caractères et tient en 4 000 (comme un message), deux modèles du même cabinet ne portent pas le même titre, et un
-- cabinet en garde cinquante au plus (une liste qu'on parcourt d'un coup d'œil, au moment d'écrire).
create function messagerie.modele_poser(p_cabinet uuid, p_id uuid, p_titre text, p_texte text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_titre text := trim(coalesce(p_titre, '')); v_texte text := trim(coalesce(p_texte, '')); v_id uuid;
begin
  if socle.moi() is null or not exists (select 1 from socle.mes_organisations() o join socle.organisation g on g.id = o
                                          where o = p_cabinet and g.type = 'cabinet') then
    perform socle.refus('ce cabinet n''est pas le tien');
  end if;
  if length(v_titre) = 0 then perform socle.refus('un modèle a un titre'); end if;
  if length(v_titre) > 80 then perform socle.refus('le titre d''un modèle tient en 80 caractères'); end if;
  if length(v_texte) = 0 then perform socle.refus('un modèle a un texte'); end if;
  if length(v_texte) > 4000 then perform socle.refus('un message tient en 4 000 caractères'); end if;
  perform pg_advisory_xact_lock(hashtextextended('messagerie.modele:' || p_cabinet::text, 0));
  if exists (select 1 from messagerie.modele m where m.cabinet = p_cabinet and lower(m.titre) = lower(v_titre) and m.id is distinct from p_id) then
    perform socle.refus('un modèle de ton cabinet porte déjà ce titre');
  end if;
  if p_id is null then
    if (select count(*) from messagerie.modele m where m.cabinet = p_cabinet) >= 50 then
      perform socle.refus('un cabinet garde cinquante modèles au plus');
    end if;
    insert into messagerie.modele (cabinet, titre, texte, modifie_par) values (p_cabinet, v_titre, v_texte, socle.moi()) returning id into v_id;
  else
    update messagerie.modele set titre = v_titre, texte = v_texte, modifie_par = socle.moi(), modifie_le = clock_timestamp()
     where id = p_id and cabinet = p_cabinet returning id into v_id;
    if v_id is null then perform socle.refus('ce modèle n''est plus là'); end if;
  end if;
  return v_id;
end $$;

create function messagerie.modele_retirer(p_cabinet uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null or not exists (select 1 from socle.mes_organisations() o where o = p_cabinet) then
    perform socle.refus('ce cabinet n''est pas le tien');
  end if;
  delete from messagerie.modele where id = p_id and cabinet = p_cabinet;
  if not found then perform socle.refus('ce modèle n''est plus là'); end if;
end $$;

revoke execute on function messagerie.modele_poser(uuid, uuid, text, text), messagerie.modele_retirer(uuid, uuid) from public;
grant execute on function messagerie.modele_poser(uuid, uuid, text, text), messagerie.modele_retirer(uuid, uuid) to skanfact_app;

-- Chercher dans un fil (point 10) : « steg » trouve « STEG », « reçue » trouve « recue ». Les minuscules, et les
-- lettres accentuées du français ramenées à leur lettre simple.
create function messagerie.plier(p text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select translate(lower(coalesce(p, '')), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa')
$$;
grant execute on function messagerie.plier(text) to skanfact_app;
