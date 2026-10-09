-- La messagerie entre l'entreprise et son cabinet (lot messagerie, décidée par Skander le 09/10/2026 sur les maquettes
-- « Mon comptable » et « Les messages de tes clients » ; skanfact docs/cadrage/14 § 2.4 ; docs/messagerie.md).
--
-- Un FIL par entreprise et par cabinet : il appartient à l'entreprise (il part avec elle), et un nouveau cabinet ne lit
-- pas ce que l'ancien s'est dit avec elle. Côté entreprise, le propriétaire, l'administrateur et la comptabilité
-- interne lisent et écrivent (ceux qui répondent déjà aux questions du cabinet) ; côté cabinet, ceux de ses membres qui
-- voient le dossier, sous un mandat actif, quel qu'en soit le périmètre. Une clé de l'API n'y entre jamais. On n'écrit
-- ces tables que par les fonctions ci-dessous : chacune refait ses contrôles, et la trace de l'entreprise les garde.
--
-- Les questions de la révision (compta.question) sont dans le fil sans y être recopiées : l'écran les lit là où elles
-- sont. Un message peut viser une pièce (« Parler d'une pièce »), demander une pièce (le cabinet), porter une photo ou
-- un PDF gardés sur nos serveurs, et dire dans quel achat ce fichier a été rangé.

create schema messagerie;
grant usage on schema messagerie to skanfact_app;

-- ── Le fil ───────────────────────────────────────────────────────────────────────────────────────
-- Où chaque côté en est de sa lecture (« Lue » : l'autre côté a lu jusque-là, pas lequel de ses membres), et l'instant
-- où le cabinet a dit le fil traité (« Rien à faire » : un message du client plus récent le remet « À traiter »).
create table messagerie.fil (
  entreprise uuid not null references socle.entreprise(id),
  cabinet uuid not null references socle.organisation(id),
  lu_entreprise timestamptz,
  lu_cabinet timestamptz,
  traite_le timestamptz,
  traite_par uuid references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  primary key (entreprise, cabinet),
  check ((traite_le is null) = (traite_par is null))
);

-- ── Les fichiers joints ──────────────────────────────────────────────────────────────────────────
-- Une photo (JPEG, PNG, WebP) ou un PDF, dix mégaoctets au plus, reconnu à ses premiers octets par le serveur (jamais à son
-- nom). Il est déposé, puis joint à UN message ; un fichier jamais joint ne se lit que de qui l'a déposé.
create table messagerie.fichier (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  cabinet uuid not null references socle.organisation(id),
  nom text not null check (length(nom) between 1 and 200),
  type text not null check (type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  taille int not null check (taille between 1 and 10485760),
  contenu bytea not null,
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  depose_par uuid not null references socle.utilisateur(id),
  depose_le timestamptz not null default now(),
  check (octet_length(contenu) = taille)
);
create index fichier_fil on messagerie.fichier (entreprise, cabinet);

-- ── Les messages ─────────────────────────────────────────────────────────────────────────────────
create table messagerie.message (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  cabinet uuid not null references socle.organisation(id),
  cote text not null check (cote in ('entreprise', 'cabinet')),
  auteur uuid not null references socle.utilisateur(id),
  -- Le nom de l'auteur quand il a écrit : le fil se relit tel qu'il a été écrit, même si le compte change de nom.
  auteur_nom text not null check (length(auteur_nom) between 1 and 200),
  texte text not null default '' check (length(texte) <= 4000),
  -- La pièce dont il parle : son genre, son identifiant dans le dossier, et ce qu'elle était à ce moment-là.
  piece_genre text check (piece_genre in ('facture', 'avoir', 'devis', 'achat')),
  piece_id text check (piece_id is null or length(piece_id) between 1 and 100),
  piece_libelle text check (piece_libelle is null or length(piece_libelle) between 1 and 300),
  -- La pièce que le cabinet demande, et quand elle a été reçue (le client l'a envoyée en réponse, ou le cabinet l'a
  -- reçue autrement).
  demande text check (demande is null or length(demande) between 1 and 300),
  demande_recue_le timestamptz,
  demande_recue_par uuid references socle.utilisateur(id),
  -- Le fichier joint, et l'achat où le client l'a rangé (« rangée dans tes achats »).
  fichier uuid references messagerie.fichier(id),
  achat_id text check (achat_id is null or length(achat_id) between 1 and 100),
  achat_libelle text check (achat_libelle is null or length(achat_libelle) between 1 and 300),
  -- La demande à laquelle ce message répond (le client envoie la pièce demandée).
  repond_a uuid references messagerie.message(id),
  ecrit_le timestamptz not null default clock_timestamp(),
  foreign key (entreprise, cabinet) references messagerie.fil (entreprise, cabinet),
  check (length(texte) > 0 or fichier is not null or demande is not null),
  check ((piece_genre is null) = (piece_id is null) and (piece_id is null) = (piece_libelle is null)),
  check (demande is null or cote = 'cabinet'),
  check (demande_recue_le is null or demande is not null),
  check ((demande_recue_le is null) = (demande_recue_par is null)),
  check ((achat_id is null) = (achat_libelle is null)),
  check (achat_id is null or fichier is not null)
);
create index message_fil on messagerie.message (entreprise, cabinet, ecrit_le desc, id desc);
create unique index message_un_fichier on messagerie.message (fichier) where fichier is not null;

-- ── L'alerte par e-mail ──────────────────────────────────────────────────────────────────────────
-- Cochée par défaut (pas de ligne : cochée). `prevenue_le` : la dernière alerte partie ; une seule tant que son côté
-- n'a pas relu le fil.
create table messagerie.alerte (
  utilisateur uuid not null references socle.utilisateur(id),
  entreprise uuid not null references socle.entreprise(id),
  cabinet uuid not null references socle.organisation(id),
  active boolean not null default true,
  prevenue_le timestamptz,
  primary key (utilisateur, entreprise, cabinet)
);

-- ── Qui lit quoi ─────────────────────────────────────────────────────────────────────────────────
-- Le cabinet par lequel je vois ce dossier : un mandat actif (quel qu'en soit le périmètre), et j'y suis associé ou
-- affecté à ce dossier.
create function messagerie.mon_cabinet(p_entreprise uuid) returns uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.cabinet from socle.mandat d
    join socle.membre m on m.organisation = d.cabinet and m.utilisateur = socle.moi() and m.actif
   where d.entreprise = p_entreprise and d.statut = 'actif' and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
     and ('supervision' = any(m.roles) or exists (select 1 from socle.mandat_affectation a where a.mandat = d.id and a.membre = m.id))
     and socle.ma_cle() is null
   order by d.debut desc limit 1
$$;

-- Suis-je du côté de l'entreprise, avec un rôle qui lit le fil ?
create function messagerie.cote_entreprise(p_entreprise uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select socle.ma_cle() is null and socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
$$;

-- Le cabinet qui tient l'entreprise aujourd'hui (son mandat actif), vu de l'entreprise.
create function messagerie.cabinet_actif(p_entreprise uuid) returns uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.cabinet from socle.mandat d
   where d.entreprise = p_entreprise and messagerie.cote_entreprise(p_entreprise)
     and d.statut = 'actif' and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
   order by d.debut desc limit 1
$$;

-- Les fils que je lis : tous ceux de mes entreprises (un ancien cabinet compris), et celui de mon cabinet sur chaque
-- dossier que je vois.
create function messagerie.mes_fils() returns table (entreprise uuid, cabinet uuid)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select f.entreprise, f.cabinet from messagerie.fil f where messagerie.cote_entreprise(f.entreprise)
  union
  select d.entreprise, d.cabinet from socle.mandat d
    join socle.membre m on m.organisation = d.cabinet and m.utilisateur = socle.moi() and m.actif
   where d.statut = 'actif' and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
     and ('supervision' = any(m.roles) or exists (select 1 from socle.mandat_affectation a where a.mandat = d.id and a.membre = m.id))
     and socle.ma_cle() is null
$$;

alter table messagerie.fil enable row level security;
alter table messagerie.fil force row level security;
create policy visible on messagerie.fil using ((entreprise, cabinet) in (select f.entreprise, f.cabinet from messagerie.mes_fils() f));
alter table messagerie.message enable row level security;
alter table messagerie.message force row level security;
create policy visible on messagerie.message using ((entreprise, cabinet) in (select f.entreprise, f.cabinet from messagerie.mes_fils() f));
-- Un fichier jamais joint ne se lit que de qui l'a déposé.
alter table messagerie.fichier enable row level security;
alter table messagerie.fichier force row level security;
create policy visible on messagerie.fichier using ((entreprise, cabinet) in (select f.entreprise, f.cabinet from messagerie.mes_fils() f)
  and (depose_par = socle.moi() or exists (select 1 from messagerie.message m where m.fichier = fichier.id)));
-- Mon alerte, à moi seul.
alter table messagerie.alerte enable row level security;
alter table messagerie.alerte force row level security;
create policy la_mienne on messagerie.alerte using (utilisateur = socle.moi());
grant select on messagerie.fil, messagerie.message, messagerie.fichier, messagerie.alerte to skanfact_app;

-- ── Les gestes ───────────────────────────────────────────────────────────────────────────────────
-- Le côté par lequel j'agis sur ce fil, ou le refus qui dit pourquoi. Rend le cabinet du fil.
create function messagerie.exiger(p_entreprise uuid, p_cote text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if socle.moi() is null or socle.ma_cle() is not null then perform socle.refus('la messagerie se tient entre personnes, jamais par une clé de l''API'); end if;
  if p_cote = 'cabinet' then
    v := messagerie.mon_cabinet(p_entreprise);
    if v is null then perform socle.refus('ce dossier n''est pas tenu par ton cabinet'); end if;
    return v;
  end if;
  if p_cote <> 'entreprise' then perform socle.refus('ce côté de la messagerie n''existe pas'); end if;
  if not messagerie.cote_entreprise(p_entreprise) then
    perform socle.refus('seuls le propriétaire, un administrateur et la comptabilité interne écrivent au cabinet');
  end if;
  v := messagerie.cabinet_actif(p_entreprise);
  if v is null then perform socle.refus('aucun cabinet ne tient ce dossier : la messagerie s''ouvre avec le mandat'); end if;
  return v;
end $$;

-- Ce côté a lu le fil jusqu'à maintenant (écrire, c'est aussi avoir lu ce qui précède).
create function messagerie.marquer_lu(p_entreprise uuid, p_cabinet uuid, p_cote text) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into messagerie.fil as f (entreprise, cabinet, lu_entreprise, lu_cabinet)
  values (p_entreprise, p_cabinet, case when p_cote = 'entreprise' then clock_timestamp() end, case when p_cote = 'cabinet' then clock_timestamp() end)
  on conflict (entreprise, cabinet) do update set
    lu_entreprise = case when p_cote = 'entreprise' then greatest(coalesce(f.lu_entreprise, '-infinity'), clock_timestamp()) else f.lu_entreprise end,
    lu_cabinet = case when p_cote = 'cabinet' then greatest(coalesce(f.lu_cabinet, '-infinity'), clock_timestamp()) else f.lu_cabinet end
$$;

-- Déposer un fichier (le serveur l'a reconnu à ses premiers octets) : il attend d'être joint à un message.
create function messagerie.deposer(p_entreprise uuid, p_cote text, p_nom text, p_type text, p_contenu bytea, p_empreinte text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid; v uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, p_cote);
  if p_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then perform socle.refus('seules une photo (JPEG, PNG, WebP) ou un PDF se joignent à un message'); end if;
  if octet_length(p_contenu) = 0 or octet_length(p_contenu) > 10485760 then perform socle.refus('un fichier joint pèse dix mégaoctets au plus'); end if;
  insert into messagerie.fil (entreprise, cabinet) values (p_entreprise, v_cabinet) on conflict do nothing;
  insert into messagerie.fichier (entreprise, cabinet, nom, type, taille, contenu, empreinte, depose_par)
  values (p_entreprise, v_cabinet, left(trim(coalesce(nullif(trim(p_nom), ''), 'fichier')), 200), p_type, octet_length(p_contenu), p_contenu, p_empreinte, socle.moi())
  returning id into v;
  return v;
end $$;

-- Écrire. `p_message` : { texte, piece: { genre, id, libelle }, demande, fichier, repondA }.
create function messagerie.ecrire(p_entreprise uuid, p_cote text, p_message jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare
  v_cabinet uuid; v_id uuid; v_texte text; v_demande text; v_fichier uuid; v_repond uuid; v_nom text;
  v_genre text; v_piece text; v_libelle text; f record;
begin
  v_cabinet := messagerie.exiger(p_entreprise, p_cote);
  v_texte := trim(coalesce(p_message->>'texte', ''));
  v_demande := nullif(trim(coalesce(p_message->>'demande', '')), '');
  v_fichier := nullif(p_message->>'fichier', '')::uuid;
  v_repond := nullif(p_message->>'repondA', '')::uuid;
  if v_demande is not null and p_cote <> 'cabinet' then perform socle.refus('seul le cabinet demande une pièce'); end if;
  if length(v_texte) = 0 and v_fichier is null and v_demande is null then perform socle.refus('un message vide n''apprend rien'); end if;
  if length(v_texte) > 4000 then perform socle.refus('un message tient en 4 000 caractères'); end if;
  if v_demande is not null and length(v_demande) > 300 then perform socle.refus('une pièce demandée se nomme en 300 caractères'); end if;
  if jsonb_typeof(p_message->'piece') = 'object' then
    v_genre := p_message->'piece'->>'genre';
    v_piece := trim(coalesce(p_message->'piece'->>'id', ''));
    v_libelle := trim(coalesce(p_message->'piece'->>'libelle', ''));
    if coalesce(v_genre, '') not in ('facture', 'avoir', 'devis', 'achat') or length(v_piece) not between 1 and 100
       or length(v_libelle) not between 1 and 300 then
      perform socle.refus('cette pièce ne se reconnaît pas : une facture, un avoir, un devis ou un achat, avec son libellé');
    end if;
  end if;
  if v_fichier is not null then
    select * into f from messagerie.fichier x where x.id = v_fichier and x.entreprise = p_entreprise and x.cabinet = v_cabinet for update;
    if not found or f.depose_par <> socle.moi() then perform socle.refus('ce fichier n''est pas là : dépose-le d''abord'); end if;
    if exists (select 1 from messagerie.message m where m.fichier = v_fichier) then perform socle.refus('ce fichier est déjà joint à un message'); end if;
  end if;
  -- La pièce demandée, envoyée en réponse : la demande est reçue.
  if v_repond is not null then
    if p_cote <> 'entreprise' or v_fichier is null then perform socle.refus('on répond à une pièce demandée en l''envoyant'); end if;
    update messagerie.message set demande_recue_le = clock_timestamp(), demande_recue_par = socle.moi()
     where id = v_repond and entreprise = p_entreprise and cabinet = v_cabinet and demande is not null and demande_recue_le is null;
    if not found then perform socle.refus('cette pièce demandée n''attend plus rien'); end if;
  end if;
  select nom into v_nom from socle.utilisateur where id = socle.moi();
  insert into messagerie.fil (entreprise, cabinet) values (p_entreprise, v_cabinet) on conflict do nothing;
  insert into messagerie.message (entreprise, cabinet, cote, auteur, auteur_nom, texte, piece_genre, piece_id, piece_libelle, demande, fichier, repond_a)
  values (p_entreprise, v_cabinet, p_cote, socle.moi(), v_nom, v_texte, v_genre, nullif(v_piece, ''), nullif(v_libelle, ''), v_demande, v_fichier, v_repond)
  returning id into v_id;
  perform messagerie.marquer_lu(p_entreprise, v_cabinet, p_cote);
  perform socle.tracer(p_entreprise, 'messagerie.ecrire', 'message', v_id, null, jsonb_build_object('cote', p_cote,
    'piece', case when v_genre is null then null else v_genre || ':' || v_piece end, 'demande', v_demande, 'fichier', v_fichier));
  return v_id;
end $$;

-- Lire le fil (le côté de qui lit) : jusqu'à maintenant. L'entreprise lit aussi le fil d'un ancien cabinet.
create function messagerie.lire(p_entreprise uuid, p_cote text, p_cabinet uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  if p_cote = 'entreprise' and p_cabinet is not null and exists (select 1 from messagerie.fil f where f.entreprise = p_entreprise and f.cabinet = p_cabinet) then
    if not messagerie.cote_entreprise(p_entreprise) then perform socle.refus('seuls le propriétaire, un administrateur et la comptabilité interne écrivent au cabinet'); end if;
    v_cabinet := p_cabinet;
  else
    v_cabinet := messagerie.exiger(p_entreprise, p_cote);
  end if;
  perform messagerie.marquer_lu(p_entreprise, v_cabinet, p_cote);
end $$;

-- Le cabinet dit le fil traité (« Rien à faire ») : jusqu'au prochain message du client.
create function messagerie.traiter(p_entreprise uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  insert into messagerie.fil as f (entreprise, cabinet, traite_le, traite_par, lu_cabinet)
  values (p_entreprise, v_cabinet, clock_timestamp(), socle.moi(), clock_timestamp())
  on conflict (entreprise, cabinet) do update set traite_le = clock_timestamp(), traite_par = socle.moi(),
    lu_cabinet = greatest(coalesce(f.lu_cabinet, '-infinity'), clock_timestamp());
  perform socle.tracer(p_entreprise, 'messagerie.traiter', 'fil', null, null, jsonb_build_object('cabinet', v_cabinet));
end $$;

-- Le cabinet a reçu la pièce demandée autrement (de la main à la main, par un autre chemin).
create function messagerie.demande_recue(p_entreprise uuid, p_message uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  update messagerie.message set demande_recue_le = clock_timestamp(), demande_recue_par = socle.moi()
   where id = p_message and entreprise = p_entreprise and cabinet = v_cabinet and demande is not null and demande_recue_le is null;
  if not found then perform socle.refus('cette pièce demandée n''attend plus rien'); end if;
  perform socle.tracer(p_entreprise, 'messagerie.demande_recue', 'message', p_message, null, null);
end $$;

-- Le fichier d'un message, rangé dans un achat du client (l'écran a enregistré l'achat ; le message le dit).
create function messagerie.ranger_achat(p_entreprise uuid, p_message uuid, p_achat text, p_libelle text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'entreprise');
  if length(trim(coalesce(p_achat, ''))) not between 1 and 100 or length(trim(coalesce(p_libelle, ''))) not between 1 and 300 then
    perform socle.refus('un achat se nomme par son identifiant et son libellé');
  end if;
  update messagerie.message set achat_id = trim(p_achat), achat_libelle = trim(p_libelle)
   where id = p_message and entreprise = p_entreprise and cabinet = v_cabinet and fichier is not null;
  if not found then perform socle.refus('ce message n''a pas de fichier à ranger'); end if;
  perform socle.tracer(p_entreprise, 'messagerie.ranger_achat', 'message', p_message, null, jsonb_build_object('achat', trim(p_achat)));
end $$;

-- Mon alerte par e-mail pour ce fil.
create function messagerie.regler_alerte(p_entreprise uuid, p_cote text, p_active boolean) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, p_cote);
  insert into messagerie.alerte as a (utilisateur, entreprise, cabinet, active) values (socle.moi(), p_entreprise, v_cabinet, p_active)
  on conflict (utilisateur, entreprise, cabinet) do update set active = p_active;
end $$;

-- ── Les alertes à envoyer (le serveur, chaque minute, hors de toute personne) ────────────────────
-- Pour chaque fil et chaque côté qui a, depuis plus de `p_delai`, quelque chose à lire (un message de l'autre côté,
-- une question envoyée au client, la réponse du client à une question), les personnes de ce côté qui n'ont pas
-- décoché l'alerte et n'ont pas déjà été prévenues depuis la dernière lecture de leur côté, à une adresse vérifiée (une
-- adresse que personne n'a prouvée ne reçoit rien : l'alerte dirait à un inconnu qu'un compte existe). Ce qui en sort :
-- l'adresse, la langue et le côté ; ni le message, ni le nom de l'entreprise, ni celui du cabinet.
create function messagerie.alertes_dues(p_maintenant timestamptz, p_delai interval) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle as $$
  with a_lire as (
    select x.entreprise, x.cabinet, x.lecteur from (
      select m.entreprise, m.cabinet, case m.cote when 'entreprise' then 'cabinet' else 'entreprise' end lecteur, m.ecrit_le quand
        from messagerie.message m
      union all
      select q.entreprise, q.cabinet, 'entreprise', q.envois[cardinality(q.envois)] from compta.question q
       where q.cabinet is not null and cardinality(q.envois) > 0 and q.statut = 'envoyee'
      union all
      select q.entreprise, q.cabinet, 'cabinet', q.repondu_le from compta.question q where q.cabinet is not null and q.repondu_le is not null
    ) x
    left join messagerie.fil f on f.entreprise = x.entreprise and f.cabinet = x.cabinet
    where x.quand <= p_maintenant - p_delai
      and x.quand > coalesce(case x.lecteur when 'entreprise' then f.lu_entreprise else f.lu_cabinet end, '-infinity')
    group by 1, 2, 3
  ),
  personnes as (
    select a.entreprise, a.cabinet, a.lecteur, m.utilisateur from a_lire a
      join socle.membre m on m.entreprise = a.entreprise and m.actif
       and m.roles && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
     where a.lecteur = 'entreprise'
    union
    select a.entreprise, a.cabinet, a.lecteur, m.utilisateur from a_lire a
      join socle.mandat d on d.entreprise = a.entreprise and d.cabinet = a.cabinet and d.statut = 'actif'
       and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
      join socle.membre m on m.organisation = d.cabinet and m.actif
       and ('supervision' = any(m.roles) or exists (select 1 from socle.mandat_affectation x where x.mandat = d.id and x.membre = m.id))
     where a.lecteur = 'cabinet'
  )
  select coalesce(jsonb_agg(jsonb_build_object('utilisateur', p.utilisateur, 'email', u.email, 'langue', u.langue, 'cote', p.lecteur,
           'entreprise', p.entreprise, 'cabinet', p.cabinet) order by p.entreprise, p.cabinet, p.utilisateur), '[]'::jsonb)
    from personnes p
    join socle.utilisateur u on u.id = p.utilisateur and u.adresse_verifiee_le is not null
    left join messagerie.fil f on f.entreprise = p.entreprise and f.cabinet = p.cabinet
    left join messagerie.alerte al on al.utilisateur = p.utilisateur and al.entreprise = p.entreprise and al.cabinet = p.cabinet
   where socle.moi() is null and coalesce(al.active, true)
     and (al.prevenue_le is null
          or al.prevenue_le < coalesce(case p.lecteur when 'entreprise' then f.lu_entreprise else f.lu_cabinet end, '-infinity'))
$$;

-- L'alerte est partie : on ne prévient plus cette personne avant que son côté ait relu le fil.
create function messagerie.alerte_partie(p_utilisateur uuid, p_entreprise uuid, p_cabinet uuid, p_le timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note une alerte partie'); end if;
  insert into messagerie.alerte as a (utilisateur, entreprise, cabinet, prevenue_le) values (p_utilisateur, p_entreprise, p_cabinet, p_le)
  on conflict (utilisateur, entreprise, cabinet) do update set prevenue_le = p_le;
end $$;

revoke execute on function messagerie.mon_cabinet(uuid), messagerie.cote_entreprise(uuid), messagerie.cabinet_actif(uuid),
  messagerie.mes_fils(), messagerie.exiger(uuid, text), messagerie.marquer_lu(uuid, uuid, text),
  messagerie.deposer(uuid, text, text, text, bytea, text), messagerie.ecrire(uuid, text, jsonb), messagerie.lire(uuid, text, uuid),
  messagerie.traiter(uuid), messagerie.demande_recue(uuid, uuid), messagerie.ranger_achat(uuid, uuid, text, text),
  messagerie.regler_alerte(uuid, text, boolean), messagerie.alertes_dues(timestamptz, interval),
  messagerie.alerte_partie(uuid, uuid, uuid, timestamptz) from public;
grant execute on function messagerie.mon_cabinet(uuid), messagerie.cote_entreprise(uuid), messagerie.cabinet_actif(uuid),
  messagerie.mes_fils(), messagerie.exiger(uuid, text),
  messagerie.deposer(uuid, text, text, text, bytea, text), messagerie.ecrire(uuid, text, jsonb), messagerie.lire(uuid, text, uuid),
  messagerie.traiter(uuid), messagerie.demande_recue(uuid, uuid), messagerie.ranger_achat(uuid, uuid, text, text),
  messagerie.regler_alerte(uuid, text, boolean), messagerie.alertes_dues(timestamptz, interval),
  messagerie.alerte_partie(uuid, uuid, uuid, timestamptz) to skanfact_app;
