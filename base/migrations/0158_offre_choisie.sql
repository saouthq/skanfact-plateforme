-- L'offre choisie dans l'application (1.84.0 ; docs/abonnement.md C19 ; recette du 20/10/2026). « T'abonner » disait
-- « écris-nous à contact@skanfact.tn » : la propriétaire choisit désormais son offre et sa périodicité dans « Ton
-- abonnement », et la console la voit dans « À décider », où sa facture se prépare d'un geste, sur cette offre. Le choix
-- ne paie rien et ne change pas l'abonnement : c'est la facture préparée puis payée qui le fait, comme avant. Un choix
-- attend tant qu'aucune facture d'abonnement n'a été préparée après lui ; un nouveau choix remplace le précédent.

create table plateforme.offre_choisie (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  offre text not null check (offre in ('essentiel', 'complet')),
  periodicite text not null check (periodicite in ('annuel', 'mensuel')),
  par uuid not null references socle.utilisateur(id),
  le timestamptz not null default now()
);
create index offre_choisie_entreprise on plateforme.offre_choisie (entreprise, le desc);
alter table plateforme.offre_choisie enable row level security;

-- Un choix ne se modifie ni ne s'efface : il se remplace par un autre.
create function plateforme.offre_choisie_immuable() returns trigger language plpgsql as $$
begin
  raise exception 'Un choix d''offre ne se modifie ni ne s''efface : un nouveau choix le remplace.';
end $$;
create trigger offre_choisie_immuable before update or delete on plateforme.offre_choisie
  for each row execute function plateforme.offre_choisie_immuable();

-- Le choix qui attend une entreprise : le dernier, si aucune facture d'abonnement n'a été préparée depuis.
create function plateforme.offre_choisie_en_attente(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object('offre', c.offre, 'periodicite', c.periodicite, 'le', c.le, 'par', u.nom)
    from plateforme.offre_choisie c join socle.utilisateur u on u.id = c.par
   where c.entreprise = p_entreprise
     and not exists (select 1 from plateforme.facture_abonnement f where f.entreprise = c.entreprise and f.prepare_le >= c.le)
   order by c.le desc limit 1
$$;

-- Qui peut payer l'abonnement le choisit (la propriétaire, l'administratrice : le geste socle.abonnement.payer, que la
-- porte a déjà permis) ; jamais une clé d'API. La route refuse quand une facture attend déjà son paiement.
create function plateforme.choisir_mon_offre(p_entreprise uuid, p_offre text, p_periodicite text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_moi uuid := socle.moi();
begin
  if v_moi is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    raise exception 'Seuls la propriétaire et l''administratrice de l''entreprise choisissent son offre.' using errcode = '42501';
  end if;
  if p_offre not in ('essentiel', 'complet') or p_periodicite not in ('annuel', 'mensuel') then
    raise exception 'Offre inconnue.' using errcode = '22023';
  end if;
  insert into plateforme.offre_choisie (entreprise, offre, periodicite, par) values (p_entreprise, p_offre, p_periodicite, v_moi);
  return plateforme.offre_choisie_en_attente(p_entreprise);
end $$;

-- Ce que l'abonnée lit (qui gère l'abonnement) : son choix qui attend.
create function plateforme.mon_offre_choisie(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    return null;
  end if;
  return plateforme.offre_choisie_en_attente(p_entreprise);
end $$;

-- Ce que la console lit (la direction, qui facture) : chaque choix qui attend, le plus ancien d'abord.
create function plateforme.console_offres_choisies() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return (select coalesce(jsonb_agg(x.v order by x.le), '[]'::jsonb) from (
    select c.le, jsonb_build_object('entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale), 'offre', c.offre,
             'periodicite', c.periodicite, 'le', c.le, 'par', u.nom) v
      from (select distinct on (entreprise) * from plateforme.offre_choisie order by entreprise, le desc) c
      join socle.entreprise e on e.id = c.entreprise
      join socle.utilisateur u on u.id = c.par
     where not exists (select 1 from plateforme.facture_abonnement f where f.entreprise = c.entreprise and f.prepare_le >= c.le)) x);
end $$;

revoke all on plateforme.offre_choisie from public;
revoke execute on function plateforme.offre_choisie_en_attente(uuid), plateforme.choisir_mon_offre(uuid, text, text),
  plateforme.mon_offre_choisie(uuid), plateforme.console_offres_choisies() from public;
grant execute on function plateforme.choisir_mon_offre(uuid, text, text), plateforme.mon_offre_choisie(uuid),
  plateforme.console_offres_choisies() to skanfact_app;
