-- 0093 — Les réglages de la plateforme (Console ; docs/console.md C28 ; skanfact docs/cadrage/10-console.md § 2.9).
-- Ce qui vaut pour tous les clients, lu au même endroit par la console : la grille des prix (plateforme.prix, 0082) et
-- le registre des règles communes (socle.regle_fiscale, 0004 ; base/regles-communes.json). Et deux choses neuves :
--   - la RELECTURE d'une règle par un comptable, écrite À CÔTÉ de la règle, jamais dans la règle (une règle ne se
--     modifie pas, 0004) : qui l'a relue, son avis, ce qu'il en dit ; une relecture ne se modifie pas non plus ;
--   - le MESSAGE affiché en haut de l'application de tous les clients : daté (du jour où il paraît au jour où il
--     disparaît, au calendrier de Tunis), jamais plus d'un à la fois — un nouveau remplace celui qui attend ou qui
--     s'affiche, qui va dans les messages passés. Un incident ne passe pas par ici : il se publie depuis Service ·
--     Incidents, sur la page d'état.
-- Les gestes sont à la direction seule ; la lecture, à la direction et au support (pour répondre à un client sur un prix).
-- Ce qui se range par date se départage par l'identifiant, qui suit le temps (uuidv7) : deux gestes du même instant
-- gardent leur ordre.

create table plateforme.relecture_regle (
  id uuid primary key default socle.uuidv7(),
  regle uuid not null references socle.regle_fiscale(id),
  -- Qui l'a relue : le nom du comptable et de son cabinet, tel qu'on l'écrit.
  relue_par text not null check (length(btrim(relue_par)) between 3 and 200),
  avis text not null check (avis in ('juste', 'a_corriger')),
  dit text check (dit is null or length(btrim(dit)) between 1 and 1000),
  motif text not null check (length(btrim(motif)) >= 3),
  qui uuid not null references socle.utilisateur(id),
  le timestamptz not null
);
alter table plateforme.relecture_regle enable row level security;
alter table plateforme.relecture_regle force row level security;
create index on plateforme.relecture_regle (regle, le desc);

create function plateforme.relecture_intouchable() returns trigger
language plpgsql as $$
begin
  raise exception 'une relecture ne se modifie pas et ne s''efface pas : on en note une nouvelle' using errcode = '42501';
end $$;
create trigger relecture_regle_intouchable before update or delete on plateforme.relecture_regle
  for each row execute function plateforme.relecture_intouchable();

create table plateforme.message_clients (
  id uuid primary key default socle.uuidv7(),
  sorte text not null check (sorte in ('nouveaute', 'maintenance')),
  -- Ce que les clients lisent : une ou deux lignes, sans balise.
  texte text not null check (length(btrim(texte)) between 10 and 240 and texte !~ '[<>]'),
  -- Les jours où il s'affiche, au calendrier de Tunis, bornes comprises.
  du date not null,
  au date not null,
  motif text not null check (length(btrim(motif)) >= 3),
  qui uuid not null references socle.utilisateur(id),
  le timestamptz not null,
  -- Retiré avant sa fin : à la main (avec son motif), ou remplacé par un nouveau message.
  retire_le timestamptz,
  retire_par uuid references socle.utilisateur(id),
  retire_motif text,
  remplace_par uuid references plateforme.message_clients(id),
  check (au >= du),
  check (au <= du + 30),
  check ((retire_le is null) = (retire_par is null)),
  check (retire_le is not null or remplace_par is null)
);
alter table plateforme.message_clients enable row level security;
alter table plateforme.message_clients force row level security;
create index on plateforme.message_clients (le desc);

-- Le message qui attend ou qui s'affiche un jour donné : pas retiré, et pas fini. Jamais plus d'un (les gestes le tiennent).
create function plateforme.message_en_cours(m plateforme.message_clients, p_jour date) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select m.retire_le is null and m.au >= p_jour
$$;

-- ── La lecture de la console ─────────────────────────────────────────────────────────────────────────────────────────
create function plateforme.console_reglages(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object(
    -- Tous les prix posés, datés : ceux en vigueur et ceux à venir. Hors taxes, en millimes (en texte : jamais un nombre
    -- à virgule).
    'prix', (select coalesce(jsonb_agg(jsonb_build_object('offre', p.offre, 'periodicite', p.periodicite, 'aPartirDu', p.a_partir_du,
               'montantHt', p.montant_ht::text) order by p.offre desc, p.periodicite, p.a_partir_du), '[]'::jsonb)
               from plateforme.prix p),
    -- Le registre, règle par règle, avec ses relectures (la plus récente d'abord).
    'regles', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'valeur', r.valeur, 'debut', r.debut, 'fin', r.fin,
                 'source', r.source, 'poseeLe', r.cree_le,
                 'relectures', (select coalesce(jsonb_agg(jsonb_build_object('reluePar', l.relue_par, 'avis', l.avis, 'dit', l.dit,
                                   'motif', l.motif, 'par', u.nom, 'le', l.le) order by l.le desc, l.id desc), '[]'::jsonb)
                                  from plateforme.relecture_regle l join socle.utilisateur u on u.id = l.qui where l.regle = r.id))
                 order by r.code, r.debut desc), '[]'::jsonb)
                 from socle.regle_fiscale r),
    -- Le message en cours (au plus un), puis les trente derniers passés.
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'sorte', m.sorte, 'texte', m.texte, 'du', m.du, 'au', m.au,
                   'motif', m.motif, 'par', u.nom, 'le', m.le, 'enCours', m.en_cours,
                   'retireLe', m.retire_le, 'retirePar', x.nom, 'retireMotif', m.retire_motif, 'remplace', m.remplace_par is not null)
                   order by m.en_cours desc, m.le desc, m.id desc), '[]'::jsonb)
                   from (select c.*, plateforme.message_en_cours(c, p_jour) en_cours from plateforme.message_clients c
                          order by plateforme.message_en_cours(c, p_jour) desc, c.le desc, c.id desc limit 31) m
                   join socle.utilisateur u on u.id = m.qui left join socle.utilisateur x on x.id = m.retire_par));
end $$;

-- ── Les gestes ───────────────────────────────────────────────────────────────────────────────────────────────────────
create function plateforme.console_relire_regle(p_regle uuid, p_relue_par text, p_avis text, p_dit text, p_motif text, p_maintenant timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_r socle.regle_fiscale; v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('noter une relecture demande son motif (trois caractères au moins)'); end if;
  if length(btrim(coalesce(p_relue_par, ''))) < 3 then perform socle.refus('une relecture dit qui l''a faite : le nom du comptable et de son cabinet'); end if;
  if p_avis is null or p_avis not in ('juste', 'a_corriger') then perform socle.refus('l''avis d''une relecture : juste telle quelle, ou à corriger'); end if;
  select * into v_r from socle.regle_fiscale where id = p_regle;
  if not found then perform socle.refus('cette règle n''est pas au registre'); end if;
  insert into plateforme.relecture_regle (regle, relue_par, avis, dit, motif, qui, le)
    values (p_regle, btrim(p_relue_par), p_avis, nullif(btrim(coalesce(p_dit, '')), ''), btrim(p_motif), socle.moi(), p_maintenant)
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.relire', btrim(p_motif), null,
            jsonb_build_object('regle', v_r.code, 'debut', v_r.debut, 'reluePar', btrim(p_relue_par), 'avis', p_avis));
  return v_id;
end $$;

-- Écrire un message : il remplace celui qui attend ou qui s'affiche (jamais deux à la fois).
create function plateforme.console_ecrire_message(p_sorte text, p_texte text, p_du date, p_au date, p_motif text, p_maintenant timestamptz, p_jour date)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']); v_id uuid; v_texte text := btrim(coalesce(p_texte, ''));
begin
  -- Deux messages écrits au même instant ne se laissent pas l'un l'autre en cours : l'un attend que l'autre ait fini.
  perform pg_advisory_xact_lock(hashtext('plateforme.message_clients'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('afficher un message aux clients demande son motif (trois caractères au moins)'); end if;
  if p_sorte is null or p_sorte not in ('nouveaute', 'maintenance') then perform socle.refus('un message aux clients annonce une nouveauté ou une maintenance prévue'); end if;
  if length(v_texte) < 10 or length(v_texte) > 240 then perform socle.refus('un message aux clients : de dix à deux cent quarante caractères'); end if;
  if v_texte ~ '[<>]' then perform socle.refus('un message aux clients s''écrit sans balise'); end if;
  if p_du is null or p_au is null then perform socle.refus('un message aux clients dit le jour où il paraît et celui où il disparaît'); end if;
  if p_du < p_jour then perform socle.refus('un message aux clients ne paraît pas dans le passé : au plus tôt aujourd''hui'); end if;
  if p_au < p_du then perform socle.refus('un message aux clients disparaît après le jour où il paraît'); end if;
  if p_au > p_du + 30 then perform socle.refus('un message aux clients s''affiche trente jours au plus : on le repose s''il le faut'); end if;
  insert into plateforme.message_clients (sorte, texte, du, au, motif, qui, le)
    values (p_sorte, v_texte, p_du, p_au, btrim(p_motif), socle.moi(), p_maintenant)
    returning id into v_id;
  update plateforme.message_clients c set retire_le = p_maintenant, retire_par = socle.moi(), remplace_par = v_id
   where c.id <> v_id and plateforme.message_en_cours(c, p_jour);
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.message_affiche', btrim(p_motif),
            (select jsonb_build_object('message', a.id, 'texte', a.texte) from plateforme.message_clients a where a.remplace_par = v_id limit 1),
            jsonb_build_object('message', v_id, 'sorte', p_sorte, 'du', p_du, 'au', p_au));
  return v_id;
end $$;

create function plateforme.console_retirer_message(p_id uuid, p_motif text, p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_m plateforme.message_clients;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('retirer un message demande son motif (trois caractères au moins)'); end if;
  select * into v_m from plateforme.message_clients where id = p_id for update;
  if not found then perform socle.refus('ce message n''existe pas'); end if;
  if not plateforme.message_en_cours(v_m, p_jour) then perform socle.refus('ce message n''est plus affiché : il n''y a rien à retirer'); end if;
  update plateforme.message_clients set retire_le = p_maintenant, retire_par = socle.moi(), retire_motif = btrim(p_motif) where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.message_retire', btrim(p_motif),
            jsonb_build_object('message', p_id, 'texte', v_m.texte, 'du', v_m.du, 'au', v_m.au), jsonb_build_object('retire', p_maintenant));
end $$;

-- ── Ce que l'application des clients lit ─────────────────────────────────────────────────────────────────────────────
-- Le message qui s'affiche ce jour-là, ou rien. Le même pour tout le monde : ni l'entreprise ni la personne n'y entrent.
create function plateforme.message_du_jour(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object('id', m.id, 'sorte', m.sorte, 'texte', m.texte, 'du', m.du, 'au', m.au)
    from plateforme.message_clients m
   where m.retire_le is null and m.du <= p_jour and m.au >= p_jour
   order by m.le desc, m.id desc limit 1
$$;

revoke execute on function plateforme.message_en_cours(plateforme.message_clients, date), plateforme.console_reglages(date),
  plateforme.console_relire_regle(uuid, text, text, text, text, timestamptz),
  plateforme.console_ecrire_message(text, text, date, date, text, timestamptz, date),
  plateforme.console_retirer_message(uuid, text, timestamptz, date), plateforme.message_du_jour(date) from public;
grant execute on function plateforme.console_reglages(date), plateforme.console_relire_regle(uuid, text, text, text, text, timestamptz),
  plateforme.console_ecrire_message(text, text, date, date, text, timestamptz, date),
  plateforme.console_retirer_message(uuid, text, timestamptz, date), plateforme.message_du_jour(date) to skanfact_app;
