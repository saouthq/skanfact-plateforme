-- La paie tenue par le serveur (brique 31, 29/09/2026 ; docs/paie.md) : les salariés et leurs
-- bulletins. L'interface v10 les saisit dans son dossier (0011) ; à chaque enregistrement, le serveur
-- recalcule chaque bulletin en entiers (moteur/paie.ts) avec le barème que le bulletin a figé, refuse
-- s'il ne trouve pas les mêmes montants que l'écran, et tient ces tables au même état, dans la même
-- transaction.
--
-- Des données sensibles (03 D10) : la base elle-même ne les montre qu'à ceux qui font la paie (le
-- propriétaire, l'administrateur, le rôle Paie, une clé de l'API qui a un geste de la paie). La
-- masse salariale, un total sans nom, se lit par sa fonction.

create schema paie;
grant usage on schema paie to skanfact_app;

-- Les entreprises dont je tiens la paie : parmi les miennes, celles où j'ai un rôle qui la fait, et
-- celle de la clé qui agit si elle porte un geste de la paie.
create function paie.mes_entreprises() returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e from socle.mes_entreprises() e
   where socle.mes_roles(e) && array['proprietaire', 'administrateur', 'paie']::text[]
      or exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = e
                   and exists (select 1 from unnest(k.gestes) g where g like 'paie.%'))
$$;
revoke execute on function paie.mes_entreprises() from public;
grant execute on function paie.mes_entreprises() to skanfact_app;

-- ── Le salarié ───────────────────────────────────────────────────────────────────────────────────
-- Ce que la paie calcule et déclare, rien de plus : ni la CIN, ni le RIB (ils restent dans le
-- dossier de l'entreprise). Un salarié retiré du dossier garde sa fiche : ses bulletins la nomment.
create table paie.salarie (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  ref_v10 text check (ref_v10 is null or length(ref_v10) between 1 and 200),
  nom text not null check (length(trim(nom)) between 1 and 300),
  numero_cnss text check (numero_cnss is null or length(numero_cnss) <= 40),
  poste text check (poste is null or length(poste) <= 200),
  contrat text check (contrat is null or length(contrat) <= 40),
  chef_de_famille boolean not null default false,
  enfants int not null default 0 check (enfants between 0 and 99),
  date_entree date,
  date_sortie date,
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  revision bigint not null default 1
);
create unique index salarie_ref_v10 on paie.salarie (entreprise, ref_v10) where ref_v10 is not null;
alter table paie.salarie enable row level security;
alter table paie.salarie force row level security;
create policy visible on paie.salarie using (entreprise in (select paie.mes_entreprises()));
grant select, insert, update, delete on paie.salarie to skanfact_app;

-- ── Le bulletin ──────────────────────────────────────────────────────────────────────────────────
-- Il garde TOUT ce qui l'a calculé (01 R7) : la saisie du mois, la situation du salarié ce mois-là,
-- et le barème entier (taux, tranches de l'IRPP, frais professionnels, déductions de famille), en
-- entiers. Relu après une loi de finances, il se recalcule au même millime.
create table paie.bulletin (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  ref_v10 text check (ref_v10 is null or length(ref_v10) between 1 and 200),
  salarie uuid not null references paie.salarie(id),
  annee int not null check (annee between 2000 and 2200),
  mois int not null check (mois between 1 and 12),
  -- La saisie : le brut de base (millimes), les jours en millièmes (une demi-journée = 500), les
  -- primes [{libelle, montant, imposable}] et les retenues [{libelle, montant}], en millimes.
  brut_de_base bigint not null,
  jours_ouvrables bigint not null check (jours_ouvrables > 0),
  jours_absence bigint not null default 0 check (jours_absence >= 0),
  primes jsonb not null default '[]' check (jsonb_typeof(primes) = 'array' and socle.sans_virgule(primes)),
  retenues jsonb not null default '[]' check (jsonb_typeof(retenues) = 'array' and socle.sans_virgule(retenues)),
  -- La situation du salarié ce mois-là, et le barème qui a calculé le bulletin (taux à six
  -- décimales : 9,18 % = 91 800 ; montants en millimes).
  contrat text check (contrat is null or length(contrat) <= 40),
  chef_de_famille boolean not null,
  enfants int not null check (enfants between 0 and 99),
  bareme jsonb not null check (jsonb_typeof(bareme) = 'object' and socle.sans_virgule(bareme)),
  -- Le calcul du moteur, en millimes.
  retenue_absence bigint not null, primes_imposables bigint not null, primes_non_imposables bigint not null,
  brut bigint not null, assiette_cnss bigint not null, cnss_salarie bigint not null,
  frais_pro bigint not null, deductions_famille bigint not null, imposable_annuel bigint not null,
  irpp_annuel bigint not null, irpp bigint not null, css bigint not null, autres_retenues bigint not null,
  net bigint not null,
  cnss_employeur bigint not null, accident_travail bigint not null, tfp bigint not null, foprolos bigint not null,
  charges_patronales bigint not null, cout_employeur bigint not null,
  -- Le salaire versé.
  paye_le date,
  mode text check (mode is null or length(mode) <= 40),
  compte text check (compte is null or length(compte) <= 200),
  reference text check (reference is null or length(reference) <= 200),
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  modifie_par uuid references socle.utilisateur(id),
  modifie_le timestamptz not null default now(),
  revision bigint not null default 1,
  -- Un bulletin au brut nul ou au net négatif n'existe pas (le formulaire de la v10 le refuse
  -- depuis la 10.10.0 ; son écriture inverserait ses colonnes).
  check (brut > 0),
  check (net >= 0),
  -- Et ses montants se tiennent entre eux, quoi qu'on y écrive.
  check (net = brut - cnss_salarie - irpp - css - autres_retenues),
  check (charges_patronales = cnss_employeur + accident_travail + tfp + foprolos),
  check (cout_employeur = brut + charges_patronales)
);
create unique index bulletin_ref_v10 on paie.bulletin (entreprise, ref_v10) where ref_v10 is not null;
create index bulletin_periode on paie.bulletin (entreprise, annee, mois);
create index bulletin_salarie on paie.bulletin (salarie);
alter table paie.bulletin enable row level security;
alter table paie.bulletin force row level security;
create policy visible on paie.bulletin using (entreprise in (select paie.mes_entreprises()));
grant select, insert, update, delete on paie.bulletin to skanfact_app;

-- Le salarié d'un bulletin est un salarié de la même entreprise, et il ne change pas.
create function paie.bulletin_de_son_salarie() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.salarie <> old.salarie then
    raise exception 'un bulletin ne change pas de salarié' using errcode = '42501';
  end if;
  if not exists (select 1 from paie.salarie s where s.id = new.salarie and s.entreprise = new.entreprise) then
    raise exception 'un bulletin appartient à l''entreprise de son salarié' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger bulletin_de_son_salarie before insert or update on paie.bulletin
  for each row execute function paie.bulletin_de_son_salarie();

-- ── La masse salariale : un total, sans nom (03 § 2.1) ───────────────────────────────────────────
-- La comptabilité interne et la lecture la voient, sans lire un seul salaire. Un bulletin compte au
-- dernier jour de son mois, comme dans la v10 (`payslipDate`).
create function paie.masse_salariale(p_entreprise uuid, p_du date, p_au date)
returns table (bulletins bigint, brut numeric, net numeric, charges_patronales numeric, cout_employeur numeric)
language plpgsql stable security definer set search_path = pg_catalog, socle, paie as $$
begin
  if not (p_entreprise in (select socle.mes_entreprises())
          and (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'paie', 'lecture']::text[]
               or exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = p_entreprise
                            and 'paie.masse.voir' = any(k.gestes)))) then
    perform socle.refus('ton rôle ne permet pas de voir la masse salariale');
  end if;
  return query
    select count(*), coalesce(sum(b.brut), 0), coalesce(sum(b.net), 0), coalesce(sum(b.charges_patronales), 0), coalesce(sum(b.cout_employeur), 0)
      from paie.bulletin b
     where b.entreprise = p_entreprise
       and (make_date(b.annee, b.mois, 1) + interval '1 month' - interval '1 day')::date between p_du and p_au;
end $$;
revoke execute on function paie.masse_salariale(uuid, date, date) from public;
grant execute on function paie.masse_salariale(uuid, date, date) to skanfact_app;
