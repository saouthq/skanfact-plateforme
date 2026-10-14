-- 0112 — La procédure de reprise d'une entreprise (docs/console.md C34 ; la maquette Fiche, « Plus rare : la procédure
-- de reprise »).
--
-- Quand la propriétaire n'est plus joignable (départ, décès, cession, conflit d'associés), l'entreprise change de
-- propriétaire SUR PIÈCES, jamais sur un simple appel. La direction seule, en trois temps :
--   1. ouvrir : la cause, le repreneur (son nom, son adresse), le motif ; la propriétaire actuelle est prévenue dans son
--      application (une demande au support que SkanFact commence ; l'alerte par e-mail ne porte pas le texte) et a
--      quinze jours pour s'y opposer (À VÉRIFIER : le délai) ;
--   2. vérifier les trois pièces (l'acte de décès ou de cession, le registre du commerce, la pièce d'identité du
--      repreneur) : on note qu'elles sont vues, par qui et quand, JAMAIS les fichiers ; une opposition reçue se note et
--      clôt la procédure ;
--   3. confirmer : l'AUTRE membre de la direction, pas celui qui l'a ouverte, une fois les trois pièces vues et le délai
--      d'opposition passé. Le repreneur devient propriétaire (il a son compte SkanFact à cette adresse) ; l'ancienne
--      propriétaire quitte l'équipe (À VÉRIFIER : selon la cause). Rien du dossier ne bouge : ni pièce, ni écriture.
-- Chaque temps entre au journal de la console, et le changement de propriétaire au journal de l'entreprise.

create table plateforme.reprise (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  cause text not null check (cause in ('deces', 'cession', 'depart', 'conflit')),
  repreneur_nom text not null check (length(btrim(repreneur_nom)) between 3 and 120),
  repreneur_email text not null check (repreneur_email ~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' and length(repreneur_email) <= 254),
  motif text not null check (length(btrim(motif)) >= 3),
  ouverte_par uuid not null references socle.utilisateur(id),
  ouverte_le timestamptz not null,
  -- La propriétaire prévenue à l'ouverture (aucune : personne à prévenir), et le message qu'elle a reçu.
  proprietaire uuid references socle.utilisateur(id),
  demande uuid references plateforme.demande_support(id),
  opposition_jusqu_au date not null,
  -- Les pièces vues : { "acte": { "par": uuid, "le": instant }, "registre": …, "identite": … }. Jamais le fichier.
  pieces jsonb not null default '{}'::jsonb check (jsonb_typeof(pieces) = 'object'),
  opposee_le timestamptz,
  appliquee_le timestamptz,
  appliquee_par uuid references socle.utilisateur(id),
  close_le timestamptz,
  close_par uuid references socle.utilisateur(id),
  close_motif text,
  check ((appliquee_le is null) = (appliquee_par is null)),
  check ((close_le is null) = (close_par is null)),
  check (appliquee_le is null or close_le is null),
  check (appliquee_par is null or appliquee_par <> ouverte_par)
);
-- Une seule procédure en cours par entreprise.
create unique index reprise_en_cours on plateforme.reprise (entreprise) where appliquee_le is null and close_le is null;
alter table plateforme.reprise enable row level security;
alter table plateforme.reprise force row level security;

create function plateforme.reprise_lue(r plateforme.reprise, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'id', r.id, 'cause', r.cause, 'repreneur', jsonb_build_object('nom', r.repreneur_nom, 'email', r.repreneur_email,
      'aUnCompte', exists (select 1 from socle.utilisateur u where lower(u.email) = lower(r.repreneur_email))),
    'motif', r.motif, 'ouverteLe', r.ouverte_le, 'ouvertePar', jsonb_build_object('id', r.ouverte_par, 'nom', (select u.nom from socle.utilisateur u where u.id = r.ouverte_par)),
    'prevenue', (select u.nom from socle.utilisateur u where u.id = r.proprietaire), 'demande', r.demande,
    'demandeNumero', (select d.numero from plateforme.demande_support d where d.id = r.demande),
    'oppositionJusquAu', r.opposition_jusqu_au, 'delaiPasse', p_jour > r.opposition_jusqu_au,
    'pieces', (select coalesce(jsonb_object_agg(k, jsonb_build_object('le', v->>'le', 'par', (select u.nom from socle.utilisateur u where u.id = (v->>'par')::uuid))), '{}'::jsonb)
                 from jsonb_each(r.pieces) as p(k, v)),
    'opposeeLe', r.opposee_le, 'appliqueeLe', r.appliquee_le, 'appliqueePar', (select u.nom from socle.utilisateur u where u.id = r.appliquee_par),
    'closeLe', r.close_le, 'closePar', (select u.nom from socle.utilisateur u where u.id = r.close_par), 'closeMotif', r.close_motif)
$$;
revoke execute on function plateforme.reprise_lue(plateforme.reprise, date) from public;

-- Ce que la fiche lit : la procédure en cours, sinon la dernière (appliquée ou close), sinon rien.
create function plateforme.console_reprise(p_entreprise uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare r plateforme.reprise;
begin
  perform plateforme.exiger_role_console(array['direction']);
  select * into r from plateforme.reprise where entreprise = p_entreprise
   order by (appliquee_le is null and close_le is null) desc, ouverte_le desc limit 1;
  if not found then return null; end if;
  return plateforme.reprise_lue(r, p_jour);
end $$;
revoke execute on function plateforme.console_reprise(uuid, date) from public;
grant execute on function plateforme.console_reprise(uuid, date) to skanfact_app;

-- 1. Ouvrir. Le serveur écrit l'objet et le texte du message à la propriétaire (son catalogue) ; la base le range comme
--    « Écrire au contact » (0110) : une demande au support que SkanFact commence, à son nom.
create function plateforme.console_ouvrir_reprise(p_entreprise uuid, p_cause text, p_nom text, p_email text, p_motif text,
                                                  p_sujet text, p_texte text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_id uuid; v_proprio uuid; v_demande uuid;
  v_jour date := (p_maintenant at time zone 'Africa/Tunis')::date;
begin
  if p_cause is null or p_cause not in ('deces', 'cession', 'depart', 'conflit') then
    perform socle.refus('une reprise a sa cause : décès, cession, départ ou conflit d''associés');
  end if;
  if length(btrim(coalesce(p_nom, ''))) < 3 then perform socle.refus('le repreneur se nomme : son nom et son prénom'); end if;
  if coalesce(p_email, '') !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then perform socle.refus('l''adresse du repreneur ne ressemble pas à une adresse : nom@domaine.tn'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('une reprise dit pourquoi : le motif, en quelques mots'); end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;
  if exists (select 1 from plateforme.reprise r where r.entreprise = p_entreprise and r.appliquee_le is null and r.close_le is null) then
    perform socle.refus('une procédure de reprise est déjà en cours pour cette entreprise : on la mène au bout ou on la clôt');
  end if;
  if exists (select 1 from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
              where m.entreprise = p_entreprise and m.actif and 'proprietaire' = any(m.roles) and lower(u.email) = lower(btrim(p_email))) then
    perform socle.refus('le repreneur est déjà propriétaire de cette entreprise : il n''y a rien à reprendre');
  end if;
  select m.utilisateur into v_proprio from socle.membre m
   where m.entreprise = p_entreprise and m.actif and 'proprietaire' = any(m.roles) order by m.depuis limit 1;
  -- La propriétaire est prévenue dans son application (sans contenu dans l'e-mail) ; sans propriétaire, personne à prévenir.
  if v_proprio is not null then
    if length(btrim(coalesce(p_sujet, ''))) < 3 or length(btrim(coalesce(p_texte, ''))) < 3 then
      perform socle.refus('le message à la propriétaire manque');
    end if;
    insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, notee_par, suivie_par, ouverte_le)
      values (p_entreprise, v_proprio, 'skanfact', btrim(p_sujet), socle.moi(), socle.moi(), p_maintenant) returning id into v_demande;
    -- La date limite de l'opposition est celle que la base pose ici (« %JUSQU_AU% » dans le texte du serveur).
    insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le)
      values (v_demande, 'equipe', socle.moi(), replace(btrim(p_texte), '%JUSQU_AU%', to_char(v_jour + 15, 'DD/MM/YYYY')), p_maintenant);
  end if;
  insert into plateforme.reprise (entreprise, cause, repreneur_nom, repreneur_email, motif, ouverte_par, ouverte_le, proprietaire, demande, opposition_jusqu_au)
    values (p_entreprise, p_cause, btrim(p_nom), lower(btrim(p_email)), btrim(p_motif), socle.moi(), p_maintenant, v_proprio, v_demande, v_jour + 15)
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.reprise_ouverte', p_entreprise, btrim(p_motif), null,
            jsonb_build_object('reprise', v_id, 'cause', p_cause, 'repreneur', btrim(p_nom), 'oppositionJusquAu', v_jour + 15));
  return v_id;
end $$;
revoke execute on function plateforme.console_ouvrir_reprise(uuid, text, text, text, text, text, text, timestamptz) from public;
grant execute on function plateforme.console_ouvrir_reprise(uuid, text, text, text, text, text, text, timestamptz) to skanfact_app;

-- La procédure en cours d'une entreprise, verrouillée (les temps 2 et 3).
create function plateforme.reprise_en_cours(p_reprise uuid) returns plateforme.reprise
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare r plateforme.reprise;
begin
  select * into r from plateforme.reprise where id = p_reprise for update;
  if not found then perform socle.refus('cette procédure de reprise n''existe pas'); end if;
  if r.appliquee_le is not null then perform socle.refus('cette reprise est déjà appliquée'); end if;
  if r.close_le is not null then perform socle.refus('cette procédure de reprise est close : on en ouvre une autre au besoin'); end if;
  return r;
end $$;
revoke execute on function plateforme.reprise_en_cours(uuid) from public;

-- 2. Une pièce vue (jamais le fichier : qui l'a vue, et quand).
create function plateforme.console_piece_reprise(p_reprise uuid, p_piece text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  r plateforme.reprise := plateforme.reprise_en_cours(p_reprise);
begin
  if p_piece is null or p_piece not in ('acte', 'registre', 'identite') then
    perform socle.refus('une pièce de la reprise : l''acte, le registre du commerce ou la pièce d''identité du repreneur');
  end if;
  if r.pieces ? p_piece then perform socle.refus('cette pièce est déjà notée comme vue'); end if;
  update plateforme.reprise set pieces = pieces || jsonb_build_object(p_piece, jsonb_build_object('par', socle.moi(), 'le', p_maintenant)) where id = r.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.reprise_piece', r.entreprise, 'pièce vue : ' || p_piece, null, jsonb_build_object('reprise', r.id, 'piece', p_piece));
end $$;
revoke execute on function plateforme.console_piece_reprise(uuid, text, timestamptz) from public;
grant execute on function plateforme.console_piece_reprise(uuid, text, timestamptz) to skanfact_app;

-- Clore sans reprise : une opposition reçue (la propriétaire a répondu), ou la direction renonce. Le motif dit pourquoi.
create function plateforme.console_clore_reprise(p_reprise uuid, p_opposition boolean, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  r plateforme.reprise := plateforme.reprise_en_cours(p_reprise);
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('clore une reprise dit pourquoi : le motif, en quelques mots'); end if;
  update plateforme.reprise set close_le = p_maintenant, close_par = socle.moi(), close_motif = btrim(p_motif),
         opposee_le = case when p_opposition then p_maintenant end where id = r.id;
  -- Deux gestes au journal, écrits en clair (tests/console/journal.test.ts les lit dans ce fichier).
  if p_opposition then
    insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
      values (socle.moi(), v_role, 'clients.reprise_opposee', r.entreprise, btrim(p_motif), null, jsonb_build_object('reprise', r.id));
  else
    insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
      values (socle.moi(), v_role, 'clients.reprise_close', r.entreprise, btrim(p_motif), null, jsonb_build_object('reprise', r.id));
  end if;
end $$;
revoke execute on function plateforme.console_clore_reprise(uuid, boolean, text, timestamptz) from public;
grant execute on function plateforme.console_clore_reprise(uuid, boolean, text, timestamptz) to skanfact_app;

-- 3. Confirmer : l'autre membre de la direction, les trois pièces vues, le délai d'opposition passé, le repreneur avec
--    son compte SkanFact à cette adresse. Il devient propriétaire ; l'ancienne propriétaire quitte l'équipe.
create function plateforme.console_appliquer_reprise(p_reprise uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  r plateforme.reprise := plateforme.reprise_en_cours(p_reprise);
  v_jour date := (p_maintenant at time zone 'Africa/Tunis')::date;
  v_repreneur uuid; v_anciens jsonb;
begin
  if r.ouverte_par = socle.moi() then
    perform socle.refus('l''autre membre de la direction confirme une reprise : pas celui qui l''a ouverte');
  end if;
  if not (r.pieces ? 'acte' and r.pieces ? 'registre' and r.pieces ? 'identite') then
    perform socle.refus('les trois pièces ne sont pas toutes vues : l''acte, le registre du commerce, la pièce d''identité du repreneur');
  end if;
  if v_jour <= r.opposition_jusqu_au then
    perform socle.refus(format('le délai d''opposition court jusqu''au %s inclus : la reprise se confirme après', to_char(r.opposition_jusqu_au, 'DD/MM/YYYY')));
  end if;
  select u.id into v_repreneur from socle.utilisateur u where lower(u.email) = lower(r.repreneur_email);
  if v_repreneur is null then
    perform socle.refus('le repreneur n''a pas encore de compte SkanFact à cette adresse : il le crée (c''est gratuit), puis on confirme');
  end if;
  select coalesce(jsonb_agg(m.utilisateur), '[]'::jsonb) into v_anciens from socle.membre m
   where m.entreprise = r.entreprise and m.actif and 'proprietaire' = any(m.roles) and m.utilisateur <> v_repreneur;
  update socle.membre set actif = false
   where entreprise = r.entreprise and actif and 'proprietaire' = any(roles) and utilisateur <> v_repreneur;
  if exists (select 1 from socle.membre m where m.entreprise = r.entreprise and m.utilisateur = v_repreneur) then
    update socle.membre set actif = true, roles = array(select distinct x from unnest(array_append(roles, 'proprietaire')) x)
     where entreprise = r.entreprise and utilisateur = v_repreneur;
  else
    insert into socle.membre (utilisateur, entreprise, roles, invite_par, depuis) values (v_repreneur, r.entreprise, array['proprietaire'], socle.moi(), p_maintenant);
  end if;
  update plateforme.reprise set appliquee_le = p_maintenant, appliquee_par = socle.moi() where id = r.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.reprise_appliquee', r.entreprise, r.motif, jsonb_build_object('proprietaires', v_anciens),
            jsonb_build_object('reprise', r.id, 'proprietaire', v_repreneur, 'repreneur', r.repreneur_nom));
  -- Le journal de l'entreprise le dit aussi : qui l'a changé, d'où à qui.
  perform socle.tracer(r.entreprise, 'socle.propriete.reprise', 'reprise', r.id, jsonb_build_object('proprietaires', v_anciens),
                       jsonb_build_object('proprietaire', v_repreneur, 'cause', r.cause));
end $$;
revoke execute on function plateforme.console_appliquer_reprise(uuid, timestamptz) from public;
grant execute on function plateforme.console_appliquer_reprise(uuid, timestamptz) to skanfact_app;
