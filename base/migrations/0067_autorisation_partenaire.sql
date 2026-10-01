-- « Connecter ma boutique » (brique 133 ; docs/boutique.md, B0) : un commerçant autorise un partenaire déclaré
-- (SkanEcom) à agir pour son entreprise, sans copier de clé. Le propriétaire ou l'administrateur clique « Autoriser » :
-- une clé est créée à son nom (avec les gestes du partenaire), valable DIX MINUTES ; le partenaire reçoit un code à
-- usage unique, qu'il échange, de serveur à serveur et avec son propre secret, contre la clé. L'échange porte la clé à
-- un an. Un code jamais échangé laisse une clé qui expire seule.
--
-- La base ne garde que l'EMPREINTE du code (comme celle de la clé) : une copie de la base ne permet aucun échange.

create table socle.autorisation_partenaire (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  partenaire text not null check (partenaire ~ '^[a-z0-9-]{2,40}$'),
  cle_api uuid not null unique references socle.cle_api(id),
  code_empreinte text not null unique check (code_empreinte ~ '^[0-9a-f]{64}$'),
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  echangee_le timestamptz,
  check (expire_le > cree_le)
);
create index autorisation_partenaire_entreprise on socle.autorisation_partenaire (entreprise);
-- Aucune règle : la table ne se lit et ne s'écrit que par les deux fonctions ci-dessous.
alter table socle.autorisation_partenaire enable row level security;
alter table socle.autorisation_partenaire force row level security;

-- Autoriser : la personne connectée, propriétaire ou administratrice de l'entreprise, pour une clé qu'elle vient de
-- créer dans cette entreprise.
create function socle.autoriser_partenaire(p_entreprise uuid, p_partenaire text, p_cle uuid, p_empreinte text, p_expire_le timestamptz)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']) then
    perform socle.refus('ton rôle ne permet pas de gérer les clés de l''API');
  end if;
  if not exists (select 1 from socle.cle_api k where k.id = p_cle and k.entreprise = p_entreprise and k.cree_par = socle.moi() and k.revoquee_le is null) then
    perform socle.refus('clé introuvable');
  end if;
  insert into socle.autorisation_partenaire (entreprise, partenaire, cle_api, code_empreinte, cree_par, expire_le)
  values (p_entreprise, p_partenaire, p_cle, p_empreinte, socle.moi(), p_expire_le);
  perform socle.tracer(p_entreprise, 'socle.partenaire.autoriser', 'cle_api', p_cle, null, jsonb_build_object('partenaire', p_partenaire));
end $$;

-- Échanger : le partenaire (son secret est vérifié par le serveur), une seule fois, avant l'expiration du code. La clé
-- prend sa durée ; une clé révoquée entre-temps ne revit pas. Rien (aucune ligne) : rien n'est remis.
create function socle.echanger_autorisation(p_partenaire text, p_empreinte text, p_expire_le timestamptz)
returns table (cle_api uuid, entreprise uuid, nom text, gestes text[])
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v socle.autorisation_partenaire;
begin
  select * into v from socle.autorisation_partenaire a where a.partenaire = p_partenaire and a.code_empreinte = p_empreinte for update;
  if v.id is null or v.echangee_le is not null or v.expire_le <= now() then return; end if;
  update socle.autorisation_partenaire set echangee_le = now() where id = v.id;
  -- (La clé expire avec le code : un code encore valable porte une clé qui l'est aussi.)
  update socle.cle_api k set expire_le = p_expire_le where k.id = v.cle_api and k.revoquee_le is null;
  if not found then return; end if;
  -- La trace : personne n'est connecté (c'est le serveur du partenaire), la ligne le dit par son geste.
  perform socle.tracer(v.entreprise, 'socle.partenaire.echanger', 'cle_api', v.cle_api, null, jsonb_build_object('partenaire', p_partenaire, 'expire_le', p_expire_le));
  return query select k.id, k.entreprise, e.raison_sociale, k.gestes from socle.cle_api k join socle.entreprise e on e.id = k.entreprise where k.id = v.cle_api;
end $$;

revoke execute on function socle.autoriser_partenaire(uuid, text, uuid, text, timestamptz), socle.echanger_autorisation(text, text, timestamptz) from public;
grant execute on function socle.autoriser_partenaire(uuid, text, uuid, text, timestamptz), socle.echanger_autorisation(text, text, timestamptz) to skanfact_app;
