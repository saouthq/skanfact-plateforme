-- Les immobilisations (brique 42, 29/09/2026 ; docs/cabinet.md, C28 et C29). Le Cabinet v10 tenait,
-- dans le livre de chaque exercice, les fiches des biens d'un dossier (compta.js : ajouterImmobilisation,
-- planDuBien, ecrituresImmobilisations) : leur plan d'amortissement se calcule, les dotations, les
-- reprises de subvention et les sorties d'actif s'écrivent au brouillard, et chaque ligne du plan
-- retient l'écriture qui la porte — c'est ce qui empêche de passer deux fois la même dotation.
-- Ici :
--   - le calcul reste celui de la v10, sur le livre du serveur, dans le navigateur ;
--   - la FICHE d'un bien se garde au serveur, une fois pour toute la vie de l'entreprise (plus de
--     « bien repris » d'un exercice à l'autre) : ses montants en millimes, sa durée en centièmes
--     d'année, un taux dégressif en entier à quatre décimales ; une révision ;
--   - le LIEN entre un bien, une année et l'écriture qui porte sa dotation ou sa sortie ; une écriture
--     supprimée emporte son lien, une écriture contre-passée ne vaut plus ;
--   - tant qu'une dotation est écrite, ce qui fait le plan (valeur, durée, dates, méthode…) ne change
--     pas, et la fiche ne se supprime pas : la dotation serait fausse, ou sans bien.
-- Poser une fiche : qui saisit. Écrire les dotations : qui valide (la v10 : « validation »).

create table compta.immobilisation (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  fiche jsonb not null check (jsonb_typeof(fiche) = 'object' and socle.sans_virgule(fiche)),
  revision bigint not null default 1,
  cree_par uuid references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);
create index immobilisation_entreprise on compta.immobilisation (entreprise);
alter table compta.immobilisation enable row level security;
alter table compta.immobilisation force row level security;
create policy visible on compta.immobilisation using (entreprise in (select compta.mes_entreprises()));
grant select on compta.immobilisation to skanfact_app;

create table compta.immobilisation_ecriture (
  immobilisation uuid not null references compta.immobilisation(id) on delete cascade,
  annee int not null check (annee between 1900 and 2999),
  genre text not null check (genre in ('dotation', 'cession')),
  ecriture uuid not null references compta.ecriture(id) on delete cascade,
  entreprise uuid not null references socle.entreprise(id),
  primary key (immobilisation, annee, genre)
);
alter table compta.immobilisation_ecriture enable row level security;
alter table compta.immobilisation_ecriture force row level security;
create policy visible on compta.immobilisation_ecriture using (entreprise in (select compta.mes_entreprises()));
grant select on compta.immobilisation_ecriture to skanfact_app;

-- Ce qui fait le plan d'amortissement : tant qu'une dotation est écrite, ça ne change pas.
create function compta.champs_du_plan() returns text[]
language sql immutable as $$
  select array['valeur', 'residuelle', 'methode', 'dureeCentiemes', 'tauxDegressif', 'bascule', 'dateMiseEnService', 'dateAcquisition']
$$;

-- La première année (la plus ancienne) où ce bien a une écriture qui vaut encore, ou null.
create function compta.annee_ecrite(p_immobilisation uuid) returns int
language sql stable security definer set search_path = pg_catalog, compta as $$
  select min(l.annee) from compta.immobilisation_ecriture l where l.immobilisation = p_immobilisation and compta.ecriture_vivante(l.ecriture)
$$;

-- Créer (p_id null) ou modifier une fiche, dans la révision qu'on a lue. Rend son identifiant et sa
-- nouvelle révision.
create function compta.poser_immobilisation(p_entreprise uuid, p_id uuid, p_fiche jsonb, p_revision bigint)
returns table (r_id uuid, r_revision bigint)
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.immobilisation; v_ecrite int; v_ced_avant int; v_ced_apres int; k text; v_mes text;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  if p_fiche is null or jsonb_typeof(p_fiche) <> 'object' then perform socle.refus('une immobilisation porte sa fiche'); end if;
  if length(trim(coalesce(p_fiche->>'libelle', ''))) = 0 then perform socle.refus('le bien n''a pas de libellé : une ligne sans nom ne se retrouve jamais'); end if;
  if coalesce(p_fiche->>'compte', '') !~ '^[0-9]{1,12}$' then perform socle.refus('le compte d''immobilisation manque'); end if;
  v_mes := coalesce(p_fiche->>'dateMiseEnService', '');
  if v_mes !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then perform socle.refus('la date de mise en service manque : c''est elle qui fait partir l''amortissement'); end if;
  if jsonb_typeof(p_fiche->'valeur') <> 'number' or (p_fiche->>'valeur')::numeric <= 0 then perform socle.refus('la valeur d''acquisition doit être positive'); end if;
  if jsonb_typeof(p_fiche->'residuelle') <> 'number' or (p_fiche->>'residuelle')::numeric < 0 then perform socle.refus('une valeur résiduelle négative n''existe pas'); end if;
  if (p_fiche->>'residuelle')::numeric >= (p_fiche->>'valeur')::numeric then
    perform socle.refus('la valeur résiduelle ne peut pas atteindre la valeur d''acquisition : il n''y aurait rien à amortir');
  end if;
  if jsonb_typeof(p_fiche->'dureeCentiemes') <> 'number' or (p_fiche->>'dureeCentiemes')::numeric <= 0 then
    perform socle.refus('la durée d''amortissement doit être positive');
  end if;
  if coalesce(p_fiche->>'methode', '') not in ('lineaire', 'degressif') then perform socle.refus('la méthode d''amortissement doit être linéaire ou dégressive'); end if;
  if p_fiche->>'methode' = 'degressif' and coalesce((p_fiche->>'tauxDegressif')::numeric, 0) <= 0 then
    perform socle.refus('un amortissement dégressif demande son taux : il dépend de la durée et du régime, et l''application ne le devine pas');
  end if;
  if jsonb_typeof(p_fiche->'cession') = 'object' and coalesce(p_fiche->'cession'->>'date', '') < v_mes then
    perform socle.refus('un bien ne se cède pas avant d''être mis en service');
  end if;
  if p_id is null then
    insert into compta.immobilisation (entreprise, fiche, cree_par) values (p_entreprise, p_fiche, socle.moi()) returning * into x;
    perform socle.tracer(p_entreprise, 'compta.immobilisation.creer', 'immobilisation', x.id, null, p_fiche);
    r_id := x.id; r_revision := x.revision; return next; return;
  end if;
  select * into x from compta.immobilisation where id = p_id and entreprise = p_entreprise for update;
  if not found then perform socle.refus('cette immobilisation n''existe pas'); end if;
  if x.revision <> coalesce(p_revision, 0) then
    raise exception 'cette fiche a été changée ailleurs entre-temps : recharge-la, rien n''a été enregistré' using errcode = 'SK409';
  end if;
  v_ecrite := compta.annee_ecrite(x.id);
  if v_ecrite is not null then
    foreach k in array compta.champs_du_plan() loop
      if (x.fiche->k) is distinct from (p_fiche->k) then
        perform socle.refus(format('la dotation de %s est déjà passée en écriture : ce changement la rendrait fausse. Contre-passe-la (ou supprime-la si elle est au brouillard), puis recommence', v_ecrite));
      end if;
    end loop;
    -- Une sortie posée, déplacée ou retirée change les dotations à partir de son année.
    if (x.fiche->'cession') is distinct from (p_fiche->'cession') then
      v_ced_avant := nullif(substr(coalesce(x.fiche->'cession'->>'date', ''), 1, 4), '')::int;
      v_ced_apres := nullif(substr(coalesce(p_fiche->'cession'->>'date', ''), 1, 4), '')::int;
      if exists (select 1 from compta.immobilisation_ecriture l where l.immobilisation = x.id and compta.ecriture_vivante(l.ecriture)
                   and l.annee >= least(coalesce(v_ced_avant, 9999), coalesce(v_ced_apres, 9999))) then
        perform socle.refus(format('la dotation de %s est déjà passée en écriture : ce changement la rendrait fausse. Contre-passe-la (ou supprime-la si elle est au brouillard), puis recommence',
          (select max(l.annee) from compta.immobilisation_ecriture l where l.immobilisation = x.id and compta.ecriture_vivante(l.ecriture))));
      end if;
    end if;
  end if;
  update compta.immobilisation set fiche = p_fiche, revision = revision + 1, modifie_le = now() where id = x.id returning revision into r_revision;
  perform socle.tracer(p_entreprise, 'compta.immobilisation.modifier', 'immobilisation', x.id, x.fiche, p_fiche);
  r_id := x.id; return next;
end $$;

create function compta.supprimer_immobilisation(p_entreprise uuid, p_id uuid, p_revision bigint) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.immobilisation; v_ecrite int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  select * into x from compta.immobilisation where id = p_id and entreprise = p_entreprise for update;
  if not found then perform socle.refus('cette immobilisation n''existe pas'); end if;
  if x.revision <> coalesce(p_revision, 0) then
    raise exception 'cette fiche a été changée ailleurs entre-temps : recharge-la, rien n''a été enregistré' using errcode = 'SK409';
  end if;
  v_ecrite := compta.annee_ecrite(x.id);
  if v_ecrite is not null then
    perform socle.refus(format('la dotation de %s est passée en écriture : supprimer la fiche laisserait une dotation sans bien. Contre-passe-la d''abord (ou supprime-la si elle est au brouillard)', v_ecrite));
  end if;
  delete from compta.immobilisation where id = x.id;
  perform socle.tracer(p_entreprise, 'compta.immobilisation.supprimer', 'immobilisation', x.id, x.fiche, null);
end $$;

-- Écrire les dotations, les reprises de subvention et les sorties d'une année, au brouillard, et lier
-- chaque dotation et chaque sortie à son bien. `p_pieces` : [{ immobilisation, genre, ecriture }],
-- l'écriture comme la saisie la reçoit, datée dans l'année.
create function compta.ecrire_immobilisations(p_entreprise uuid, p_annee int, p_pieces jsonb) returns uuid[]
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare p jsonb; x compta.immobilisation; v_id uuid; v_ids uuid[] := '{}'; v_genre text;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if p_pieces is null or jsonb_typeof(p_pieces) <> 'array' or jsonb_array_length(p_pieces) = 0 or jsonb_array_length(p_pieces) > 1000 then
    perform socle.refus('rien à passer : aucune dotation ni sortie en attente sur cet exercice');
  end if;
  for p in select * from jsonb_array_elements(p_pieces) loop
    select * into x from compta.immobilisation where id = (p->>'immobilisation')::uuid and entreprise = p_entreprise for update;
    if not found then perform socle.refus('cette immobilisation n''existe pas'); end if;
    v_genre := coalesce(p->>'genre', '');
    if v_genre not in ('dotation', 'subvention', 'cession') then perform socle.refus('une écriture d''immobilisation est une dotation, une reprise de subvention ou une sortie'); end if;
    if coalesce(p->'ecriture'->>'date', '') not like p_annee || '-%' then
      perform socle.refus(format('les écritures d''immobilisation de %s se datent dans cette année', p_annee));
    end if;
    if v_genre <> 'subvention' and exists (select 1 from compta.immobilisation_ecriture l where l.immobilisation = x.id and l.annee = p_annee
                                             and l.genre = v_genre and compta.ecriture_vivante(l.ecriture)) then
      perform socle.refus(format('la %s %s de « %s » est déjà passée : la repasser la compterait deux fois',
        case v_genre when 'dotation' then 'dotation' else 'sortie' end, p_annee, x.fiche->>'libelle'));
    end if;
    v_id := compta.saisir(p_entreprise, p->'ecriture');
    if v_genre <> 'subvention' then
      insert into compta.immobilisation_ecriture (immobilisation, annee, genre, ecriture, entreprise) values (x.id, p_annee, v_genre, v_id, p_entreprise)
      on conflict (immobilisation, annee, genre) do update set ecriture = excluded.ecriture;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end $$;

revoke execute on function compta.annee_ecrite(uuid), compta.poser_immobilisation(uuid, uuid, jsonb, bigint),
  compta.supprimer_immobilisation(uuid, uuid, bigint), compta.ecrire_immobilisations(uuid, int, jsonb) from public;
grant execute on function compta.annee_ecrite(uuid), compta.poser_immobilisation(uuid, uuid, jsonb, bigint),
  compta.supprimer_immobilisation(uuid, uuid, bigint), compta.ecrire_immobilisations(uuid, int, jsonb) to skanfact_app;
