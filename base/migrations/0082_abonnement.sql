-- L'abonnement d'une entreprise (lot « les fonctions qui manquent », 12/10/2026 ; skanfact docs/cadrage/07-offres-et-prix.md,
-- 10-console.md § 2.4, 01 § 18 ; docs/abonnement.md).
--
-- Le schéma `plateforme` est celui de la console : il n'appartient à aucune entreprise, et l'application n'y lit rien
-- directement. Ce qu'une entreprise y a (son essai, son échéance, ce qu'elle a payé) se lit par une fonction qui vérifie
-- d'abord que la personne voit cette entreprise.
--
-- 1. Chaque entreprise a son abonnement dès sa création : un essai de 30 jours, tout ouvert, sans carte (07). Celles qui
--    existaient avant cette migration ont leurs 30 jours à partir d'aujourd'hui, jamais moins qu'à partir de leur création.
-- 2. On garde des FAITS (le dernier jour de l'essai, le dernier jour payé, une résiliation, une suspension, un abonnement
--    offert) ; l'état (essai, actif, en retard, lecture seule) se DÉDUIT à chaque lecture, du jour qu'il est à Tunis
--    (serveur/abonnement/etat.ts). Un état écrit se périmerait à minuit.
-- 3. Chaque geste sur un abonnement laisse un événement : quoi, quand, par qui, pourquoi. Il ne se modifie pas et ne
--    s'efface pas.
-- 4. Les relances parties (15 jours, 7 jours, la veille de l'échéance, la lecture seule) : une fois chacune par échéance.
-- 5. Les prix, datés (07, 10 § 2.11) : un nouveau prix ne touche jamais une période déjà payée.

create schema plateforme;
grant usage on schema plateforme to skanfact_app;

-- ── 1. L'abonnement ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Des jours de calendrier, jamais des instants (01 R5). Une offre et sa périodicité n'existent que payées.
create table plateforme.abonnement (
  entreprise uuid primary key references socle.entreprise(id),
  essai_jusqu_au date not null,
  paye_jusqu_au date,
  offre text check (offre in ('essentiel', 'complet')),
  periodicite text check (periodicite in ('annuel', 'mensuel')),
  -- La résiliation demandée : l'abonnement va au bout de ce qui est payé, puis la lecture seule, sans grâce ni relance.
  resilie_le date,
  -- Mise en lecture seule par SkanFact (la console, 10 § 2.4), avant l'échéance.
  suspendu_le date,
  -- Offert par SkanFact : jamais d'échéance (l'entreprise de SkanFact elle-même, un partenaire).
  offert boolean not null default false,
  modifie_le timestamptz not null default now(),
  check ((paye_jusqu_au is null) = (offre is null) and (offre is null) = (periodicite is null))
);
alter table plateforme.abonnement enable row level security;
alter table plateforme.abonnement force row level security;

-- ── 2. Ce qui lui est arrivé ─────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.evenement_abonnement (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  le timestamptz not null default now(),
  nature text not null check (nature in ('essai_commence', 'essai_prolonge', 'paye', 'resilie', 'resiliation_annulee',
    'suspendu', 'repris', 'offert', 'offert_retire')),
  -- Le serveur lui-même (la création d'une entreprise), ou l'exploitation de SkanFact (son outil, puis sa console).
  par text not null check (par in ('systeme', 'exploitation')),
  motif text check (motif is null or length(btrim(motif)) >= 3),
  avant jsonb,
  apres jsonb
);
create index evenement_abonnement_entreprise on plateforme.evenement_abonnement (entreprise, le);
alter table plateforme.evenement_abonnement enable row level security;
alter table plateforme.evenement_abonnement force row level security;

create function plateforme.evenement_intouchable() returns trigger
language plpgsql as $$
begin
  raise exception 'un événement d''abonnement ne se modifie pas et ne s''efface pas';
end $$;
create trigger evenement_intouchable before update or delete on plateforme.evenement_abonnement
  for each row execute function plateforme.evenement_intouchable();

-- ── 3. Les relances parties ──────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.relance_abonnement (
  entreprise uuid not null references socle.entreprise(id),
  echeance date not null,
  rang text not null check (rang in ('j15', 'j7', 'j1', 'lecture_seule')),
  partie_le timestamptz not null,
  primary key (entreprise, echeance, rang)
);
alter table plateforme.relance_abonnement enable row level security;
alter table plateforme.relance_abonnement force row level security;

-- ── 4. Les prix, datés ───────────────────────────────────────────────────────────────────────────────────────────────
-- Hors taxes, en millimes. La grille du 28/09/2026 (07, décidée par délégation de Skander, révisable après les
-- entretiens) : Essentiel 390 DT par an ou 39 DT par mois, Complet 690 DT par an ou 69 DT par mois.
create table plateforme.prix (
  offre text not null check (offre in ('essentiel', 'complet')),
  periodicite text not null check (periodicite in ('annuel', 'mensuel')),
  a_partir_du date not null,
  montant_ht bigint not null check (montant_ht > 0),
  primary key (offre, periodicite, a_partir_du)
);
alter table plateforme.prix enable row level security;
alter table plateforme.prix force row level security;
insert into plateforme.prix (offre, periodicite, a_partir_du, montant_ht) values
  ('essentiel', 'annuel', '2026-09-28', 390000), ('essentiel', 'mensuel', '2026-09-28', 39000),
  ('complet', 'annuel', '2026-09-28', 690000), ('complet', 'mensuel', '2026-09-28', 69000);

-- ── 5. L'essai naît avec l'entreprise ────────────────────────────────────────────────────────────────────────────────
-- Trente jours APRÈS le jour de sa création, au fuseau de l'entreprise : le jour même, il en reste trente.
create function plateforme.ouvrir_essai() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, plateforme as $$
begin
  insert into plateforme.abonnement (entreprise, essai_jusqu_au)
    values (new.id, (now() at time zone new.fuseau)::date + 30);
  insert into plateforme.evenement_abonnement (entreprise, nature, par, apres)
    values (new.id, 'essai_commence', 'systeme', jsonb_build_object('essaiJusquAu', (now() at time zone new.fuseau)::date + 30));
  return new;
end $$;
create trigger ouvrir_essai after insert on socle.entreprise for each row execute function plateforme.ouvrir_essai();

-- Les entreprises d'avant : trente jours à partir d'aujourd'hui (jamais moins qu'à partir de leur création).
insert into plateforme.abonnement (entreprise, essai_jusqu_au)
  select e.id, greatest((e.cree_le at time zone e.fuseau)::date, (now() at time zone e.fuseau)::date) + 30 from socle.entreprise e;
insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, apres)
  select a.entreprise, 'essai_commence', 'systeme', 'à la mise en place de l''abonnement', jsonb_build_object('essaiJusquAu', a.essai_jusqu_au)
    from plateforme.abonnement a;

-- ── 6. Les lectures, chacune par une fonction ────────────────────────────────────────────────────────────────────────
-- Les faits d'UNE entreprise, pour une personne qui la voit (sinon rien) : la porte (la lecture seule), l'écran (la
-- pastille, l'onglet « Ton abonnement »). `connu` : l'entreprise a sa ligne ; sans elle, rien ne se ferme jamais.
create function plateforme.faits_abonnement(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'connu', a.entreprise is not null,
    'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le, 'offert', coalesce(a.offert, false),
    'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null)
    from socle.entreprise e left join plateforme.abonnement a on a.entreprise = e.id
   where e.id = p_entreprise and e.id in (select socle.mes_entreprises())
$$;

-- Ce qui est arrivé à l'abonnement d'UNE entreprise, pour qui gère l'abonnement (le propriétaire, un administrateur) :
-- la nature et le jour ; jamais le motif, qui est une note de SkanFact.
create function plateforme.historique_abonnement(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('le', v.le, 'nature', v.nature, 'apres', v.apres) order by v.le desc), '[]'::jsonb)
    from plateforme.evenement_abonnement v
   where v.entreprise = p_entreprise
     and socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']
$$;

-- Les prix d'un jour : pour chaque offre et chaque périodicité, le dernier posé à cette date.
create function plateforme.prix_du_jour(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('offre', p.offre, 'periodicite', p.periodicite, 'montantHt', p.montant_ht::text)
    order by p.offre desc, p.periodicite), '[]'::jsonb)
    from (select distinct on (offre, periodicite) offre, periodicite, montant_ht from plateforme.prix
           where a_partir_du <= p_jour order by offre, periodicite, a_partir_du desc) p
$$;

-- Les relances à examiner (un tour du serveur, sans personne derrière) : les abonnements dont l'échéance tombe dans les
-- quinze jours qui viennent ou les huit derniers, avec les relances déjà parties et l'adresse de qui gère l'abonnement.
-- Le serveur décide (serveur/abonnement/etat.ts) : ici, on ne fait que choisir large.
create function plateforme.relances_a_examiner(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'entreprise', a.entreprise,
    'faits', jsonb_build_object('connu', true, 'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au, 'offre', a.offre,
      'periodicite', a.periodicite, 'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le, 'offert', a.offert,
      'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null),
    'parties', (select coalesce(jsonb_agg(jsonb_build_object('echeance', r.echeance, 'rang', r.rang)), '[]'::jsonb)
                  from plateforme.relance_abonnement r where r.entreprise = a.entreprise),
    'adresses', (select coalesce(jsonb_agg(distinct u.email), '[]'::jsonb) from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                  where m.entreprise = a.entreprise and m.actif and m.roles && array['proprietaire', 'administrateur']))), '[]'::jsonb)
    from plateforme.abonnement a join socle.entreprise e on e.id = a.entreprise
   where e.active and greatest(a.essai_jusqu_au, coalesce(a.paye_jusqu_au, a.essai_jusqu_au)) between p_jour - 8 and p_jour + 15
$$;

create function plateforme.relance_partie(p_entreprise uuid, p_echeance date, p_rang text, p_le timestamptz) returns void
language sql volatile security definer set search_path = pg_catalog, plateforme as $$
  insert into plateforme.relance_abonnement (entreprise, echeance, rang, partie_le) values (p_entreprise, p_echeance, p_rang, p_le)
    on conflict do nothing
$$;

revoke execute on function plateforme.faits_abonnement(uuid), plateforme.historique_abonnement(uuid), plateforme.prix_du_jour(date),
  plateforme.relances_a_examiner(date), plateforme.relance_partie(uuid, date, text, timestamptz), plateforme.ouvrir_essai() from public;
grant execute on function plateforme.faits_abonnement(uuid), plateforme.historique_abonnement(uuid), plateforme.prix_du_jour(date),
  plateforme.relances_a_examiner(date), plateforme.relance_partie(uuid, date, text, timestamptz) to skanfact_app;
