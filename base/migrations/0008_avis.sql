-- Les avis d'événement (14 § 2.5) : quand une facture est émise, SkanFact prévient les adresses que
-- l'entreprise a choisies. Chaque avis est SIGNÉ (le destinataire sait qu'il vient de nous) et
-- RENVOYÉ s'il échoue, à intervalles croissants, puis abandonné et dit.
--   - un abonnement : une adresse https, une liste d'événements, un secret de signature montré une
--     seule fois à sa création ; seuls le propriétaire et l'administrateur le gèrent ;
--   - un avis naît dans la MÊME transaction que le fait qu'il annonce : une facture dont
--     l'émission échoue n'annonce rien, une facture émise est toujours annoncée ;
--   - le livreur prend les avis dus (en les réservant quelques minutes, pour qu'aucun autre ne les
--     envoie en même temps), les envoie hors de toute transaction, puis note le résultat.
--
-- Le secret sert à signer : la base doit le garder lisible. Le serveur ne le lit jamais par une
-- requête ordinaire (la colonne lui est fermée) ; seul le livreur le reçoit, pour signer.

create table socle.abonnement_avis (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  url text not null check (url ~ '^https://[^\s/?#]+[^\s]*$' and length(url) <= 2000),
  evenements text[] not null check (cardinality(evenements) > 0),
  secret text not null check (secret ~ '^whsec_[A-Za-z0-9_-]{43}$'),
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  arrete_le timestamptz,
  arrete_par uuid references socle.utilisateur(id)
);
create index abonnement_avis_entreprise on socle.abonnement_avis (entreprise);
alter table socle.abonnement_avis enable row level security;
alter table socle.abonnement_avis force row level security;
create policy visible on socle.abonnement_avis for select
  using (entreprise in (select socle.mes_entreprises()) and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']);
grant select (id, entreprise, url, evenements, cree_par, cree_le, arrete_le, arrete_par) on socle.abonnement_avis to skanfact_app;

create table socle.avis (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  abonnement uuid not null references socle.abonnement_avis(id),
  evenement text not null,
  corps jsonb not null,
  cree_le timestamptz not null default now(),
  essais integer not null default 0 check (essais >= 0),
  prochain_essai timestamptz not null default now(),
  livre_le timestamptz,
  abandonne_le timestamptz,
  dernier_statut integer,
  derniere_erreur text
);
create index avis_a_livrer on socle.avis (prochain_essai) where livre_le is null and abandonne_le is null;
create index avis_entreprise on socle.avis (entreprise, cree_le);
alter table socle.avis enable row level security;
alter table socle.avis force row level security;
create policy visible on socle.avis for select
  using (entreprise in (select socle.mes_entreprises()) and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']);
grant select (id, entreprise, abonnement, evenement, cree_le, essais, prochain_essai, livre_le, abandonne_le, dernier_statut, derniere_erreur)
  on socle.avis to skanfact_app;

create function socle.creer_abonnement_avis(p_entreprise uuid, p_url text, p_evenements text[], p_secret text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_id uuid;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']) then
    perform socle.refus('ton rôle ne permet pas de gérer les avis d''événement');
  end if;
  insert into socle.abonnement_avis (entreprise, url, evenements, secret, cree_par)
  values (p_entreprise, p_url, p_evenements, p_secret, socle.moi()) returning id into v_id;
  perform socle.tracer(p_entreprise, 'socle.avis.gerer', 'abonnement_avis', v_id, null, jsonb_build_object('url', p_url, 'evenements', p_evenements));
  return v_id;
end $$;

create function socle.arreter_abonnement_avis(p_abonnement uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v socle.abonnement_avis;
begin
  select * into v from socle.abonnement_avis where id = p_abonnement;
  if v.id is null or not (v.entreprise in (select socle.mes_entreprises())) then perform socle.refus('abonnement introuvable'); end if;
  if not (socle.mes_roles(v.entreprise) && array['proprietaire', 'administrateur']) then
    perform socle.refus('ton rôle ne permet pas de gérer les avis d''événement');
  end if;
  if v.arrete_le is not null then perform socle.refus('cet abonnement est déjà arrêté'); end if;
  update socle.abonnement_avis set arrete_le = now(), arrete_par = socle.moi() where id = p_abonnement;
  -- Ce qui n'est pas encore parti ne part plus.
  update socle.avis set abandonne_le = now(), derniere_erreur = 'abonnement_arrete'
   where abonnement = p_abonnement and livre_le is null and abandonne_le is null;
  perform socle.tracer(v.entreprise, 'socle.avis.gerer', 'abonnement_avis', p_abonnement, jsonb_build_object('url', v.url), null);
end $$;

-- Un fait est arrivé dans une entreprise que celui qui agit voit : un avis par abonnement actif qui
-- le demande. Appelé dans la transaction même du fait.
create function socle.emettre_avis(p_entreprise uuid, p_evenement text, p_corps jsonb) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare n integer;
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  insert into socle.avis (entreprise, abonnement, evenement, corps)
  select p_entreprise, a.id, p_evenement, p_corps from socle.abonnement_avis a
   where a.entreprise = p_entreprise and a.arrete_le is null and p_evenement = any(a.evenements);
  get diagnostics n = row_count;
  return n;
end $$;

-- Le livreur : les avis dus, RÉSERVÉS cinq minutes (un autre livreur ne les prend pas pendant ce
-- temps ; un livreur tombé en route les laisse revenir d'eux-mêmes).
create function socle.avis_a_livrer(p_maintenant timestamptz, p_limite integer)
returns table (id uuid, entreprise uuid, url text, secret text, evenement text, corps jsonb, essais integer)
language sql volatile security definer set search_path = pg_catalog, socle as $$
  with dus as (
    select v.id from socle.avis v
     where v.livre_le is null and v.abandonne_le is null and v.prochain_essai <= p_maintenant
     order by v.prochain_essai, v.id
     limit p_limite
     for update skip locked
  )
  update socle.avis v set prochain_essai = p_maintenant + interval '5 minutes'
    from dus, socle.abonnement_avis a
   where v.id = dus.id and a.id = v.abonnement
  returning v.id, v.entreprise, a.url, a.secret, v.evenement, v.corps, v.essais
$$;

-- Le résultat d'un envoi. Réussi (2xx) : livré. Sinon, le prochain essai s'éloigne (1 min, 5 min,
-- 30 min, 2 h, 6 h, 12 h, 24 h) ; après le 8e échec, l'avis est abandonné, et l'écran le dit.
create function socle.avis_resultat(p_avis uuid, p_maintenant timestamptz, p_statut integer, p_erreur text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare
  v socle.avis;
  delais interval[] := array[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours',
                             interval '6 hours', interval '12 hours', interval '24 hours'];
begin
  select * into v from socle.avis where id = p_avis for update;
  if v.id is null or v.livre_le is not null or v.abandonne_le is not null then return; end if;
  if p_statut between 200 and 299 then
    update socle.avis set essais = v.essais + 1, livre_le = p_maintenant, dernier_statut = p_statut, derniere_erreur = null where id = p_avis;
  elsif v.essais + 1 >= 8 then
    update socle.avis set essais = v.essais + 1, abandonne_le = p_maintenant, dernier_statut = p_statut, derniere_erreur = left(p_erreur, 500) where id = p_avis;
  else
    update socle.avis set essais = v.essais + 1, prochain_essai = p_maintenant + delais[v.essais + 1],
      dernier_statut = p_statut, derniere_erreur = left(p_erreur, 500) where id = p_avis;
  end if;
end $$;

revoke execute on function socle.creer_abonnement_avis(uuid, text, text[], text), socle.arreter_abonnement_avis(uuid),
  socle.emettre_avis(uuid, text, jsonb), socle.avis_a_livrer(timestamptz, integer), socle.avis_resultat(uuid, timestamptz, integer, text) from public;
grant execute on function socle.creer_abonnement_avis(uuid, text, text[], text), socle.arreter_abonnement_avis(uuid),
  socle.emettre_avis(uuid, text, jsonb), socle.avis_a_livrer(timestamptz, integer), socle.avis_resultat(uuid, timestamptz, integer, text) to skanfact_app;
