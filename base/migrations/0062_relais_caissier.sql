-- Changer de caissier (brique 123 ; 03 § 6 « Changer de caissier » ; docs/caisse.md, R1 à R5). Sur le poste qui tient
-- la caisse, un caissier prend la main avec son code à 4 chiffres, sans mot de passe : le poste reste le même appareil
-- (la caisse ne change pas de poste, sa session continue), et les tickets suivants portent son nom.
--
-- Quatre chiffres se devinent : ce code ne vaut donc QUE là, et la session qu'il ouvre est fermée à cette entreprise.
--   - le code se pose par la personne elle-même, connectée, et se garde en empreinte (Argon2id, calculée par le
--     serveur) ; personne ne le lit, pas même la personne : on le repose ;
--   - il ne sert que sur l'appareil qui tient (ou a tenu) une caisse de l'entreprise, pas retiré, et dans une session
--     de « mon ordinateur » (jamais sur l'ordinateur d'un autre) ;
--   - il ne sert qu'à un membre qui a le rôle Caissier, et aucun rôle de cette entreprise qui exige le code du
--     téléphone (propriétaire, administrateur, paie) : un code à 4 chiffres n'ouvre jamais ces droits ;
--   - la session ouverte ne sert qu'à CETTE entreprise (socle.session.caisse_de) : ni le compte, ni les autres
--     entreprises de la personne ;
--   - après 5 erreurs, une attente qui s'allonge (socle.noter_erreur), jamais un blocage définitif.

create table caisse.code (
  entreprise uuid not null references socle.entreprise(id),
  utilisateur uuid not null references socle.utilisateur(id),
  empreinte text not null,
  pose_le timestamptz not null default now(),
  primary key (entreprise, utilisateur)
);
-- Personne ne lit les empreintes : seules les fonctions ci-dessous les touchent.
alter table caisse.code enable row level security;
alter table caisse.code force row level security;

-- La session ouverte par un code de caisse : elle ne sert qu'à cette entreprise.
alter table socle.session add column caisse_de uuid references socle.entreprise(id);

-- Les rôles qu'un code à 4 chiffres n'ouvre jamais (ceux qui exigent le code du téléphone, 03 § 6).
create function caisse.peut_prendre_la_caisse(p_entreprise uuid, p_utilisateur uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (select 1 from socle.membre m where m.entreprise = p_entreprise and m.utilisateur = p_utilisateur and m.actif
                    and 'caissier' = any(m.roles) and not (m.roles && array['proprietaire', 'administrateur', 'paie']::text[]))
$$;

-- Poser son propre code (moi seulement, membre de l'entreprise qui peut prendre la caisse).
create function caisse.poser_code(p_entreprise uuid, p_empreinte text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null or not caisse.peut_prendre_la_caisse(p_entreprise, socle.moi()) then
    raise exception 'Seul un caissier pose son code de caisse.' using errcode = '42501';
  end if;
  insert into caisse.code (entreprise, utilisateur, empreinte) values (p_entreprise, socle.moi(), p_empreinte)
  on conflict (entreprise, utilisateur) do update set empreinte = excluded.empreinte, pose_le = now();
end $$;

-- Les caissiers qui peuvent prendre la caisse de cette entreprise (ceux qui ont posé leur code), pour un membre.
create function caisse.caissiers(p_entreprise uuid) returns table (utilisateur uuid, nom text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.id, u.nom from caisse.code c join socle.utilisateur u on u.id = c.utilisateur
   where c.entreprise = p_entreprise and p_entreprise in (select socle.mes_entreprises())
     and caisse.peut_prendre_la_caisse(p_entreprise, c.utilisateur)
   order by u.nom
$$;

-- L'empreinte d'un code, pour le relais seulement : sur l'appareil qui tient une caisse de l'entreprise, pas retiré,
-- pour un membre de cette entreprise. Rien sinon.
create function caisse.code_pour_relais(p_entreprise uuid, p_utilisateur uuid, p_appareil uuid) returns text
language sql stable security definer set search_path = pg_catalog, socle as $$
  select c.empreinte from caisse.code c
   where c.entreprise = p_entreprise and c.utilisateur = p_utilisateur
     and p_entreprise in (select socle.mes_entreprises())
     and caisse.peut_prendre_la_caisse(p_entreprise, p_utilisateur)
     and exists (select 1 from caisse.caisse k where k.entreprise = p_entreprise and k.active and k.appareil = p_appareil)
     and exists (select 1 from socle.appareil a where a.id = p_appareil and a.revoque_le is null)
$$;

-- Le relais : la session du poste se ferme, celle du caissier s'ouvre sur le MÊME appareil, fermée à l'entreprise.
create function caisse.relayer(p_entreprise uuid, p_utilisateur uuid, p_session uuid, p_jeton_empreinte text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_appareil uuid; v_session uuid;
begin
  select s.appareil into v_appareil from socle.session s
   where s.id = p_session and s.utilisateur = socle.moi() and s.fermee_le is null and not s.poste_d_un_autre;
  if v_appareil is null or caisse.code_pour_relais(p_entreprise, p_utilisateur, v_appareil) is null then
    raise exception 'Ce poste ne change pas de caissier.' using errcode = '42501';
  end if;
  update socle.session set fermee_le = p_maintenant where id = p_session;
  insert into socle.session (utilisateur, appareil, jeton_empreinte, ouverte_le, derniere_activite, inaction_max, caisse_de)
  values (p_utilisateur, v_appareil, p_jeton_empreinte, p_maintenant, p_maintenant, interval '12 hours', p_entreprise)
  returning id into v_session;
  return v_session;
end $$;

-- Qui est derrière ce jeton : la même règle qu'en 0002, et l'entreprise à laquelle la session est fermée.
drop function socle.qui_est(text, timestamptz);
create function socle.qui_est(p_jeton_empreinte text, p_maintenant timestamptz)
returns table (utilisateur uuid, session uuid, appareil uuid, poste_d_un_autre boolean, code_a_configurer boolean, caisse_de uuid)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  return query
  update socle.session s set derniere_activite = p_maintenant
   where s.jeton_empreinte = p_jeton_empreinte and s.fermee_le is null
     and s.derniere_activite + s.inaction_max > p_maintenant
     and not exists (select 1 from socle.appareil a where a.id = s.appareil and a.revoque_le is not null)
  returning s.utilisateur, s.id, s.appareil, s.poste_d_un_autre, s.code_a_configurer, s.caisse_de;
end $$;

revoke execute on function socle.qui_est(text, timestamptz), caisse.peut_prendre_la_caisse(uuid, uuid), caisse.poser_code(uuid, text),
  caisse.caissiers(uuid), caisse.code_pour_relais(uuid, uuid, uuid), caisse.relayer(uuid, uuid, uuid, text, timestamptz) from public;
grant execute on function socle.qui_est(text, timestamptz), caisse.poser_code(uuid, text),
  caisse.caissiers(uuid), caisse.code_pour_relais(uuid, uuid, uuid), caisse.relayer(uuid, uuid, uuid, text, timestamptz) to skanfact_app;
