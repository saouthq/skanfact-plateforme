-- Le cabinet côté serveur (brique 36, 29/09/2026 ; docs/cabinet.md). Le socle connaissait déjà les
-- cabinets, les mandats et leurs affectations (0001), et un collaborateur voyait les entreprises de
-- ses mandats actifs (0007). Ici :
--   - créer un cabinet, lui confier un dossier (le mandat que le PROPRIÉTAIRE propose, que l'associé
--     accepte, que l'un ou l'autre arrête), créer un dossier tenu (un client pas encore sur
--     SkanFact), confier un dossier à un collaborateur ;
--   - le rôle d'un collaborateur SUR un dossier (03 § 3 : un rôle posé sur un dossier l'emporte) ;
--   - le PÉRIMÈTRE du mandat, que la base garde elle-même (03 § 3.4) : la comptabilité ouvre les
--     livres au cabinet, la paie ouvre la paie ;
--   - avec un mandat de comptabilité, c'est le cabinet qui valide la période (03 § 2, C8).

-- Un dossier tenu : créé par un cabinet pour un client qui n'est pas (encore) sur SkanFact.
alter table socle.entreprise add column tenue_par uuid references socle.organisation(id);

-- ── Le rôle d'une personne sur une entreprise ─────────────────────────────────────────────────────
-- Ses rôles de membre (0003), plus, par un mandat actif de son cabinet : le rôle posé sur ce dossier
-- (mandat_affectation), sinon « supervision » si elle est associée du cabinet. Le rôle « paie » d'un
-- collaborateur ne vaut que si le mandat comprend la paie.
create or replace function socle.mes_roles(p_entreprise uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce(array_agg(distinct r) filter (where r is not null), '{}') from (
    select unnest(m.roles) r from socle.membre m
     where m.utilisateur = socle.moi() and m.actif and m.entreprise = p_entreprise
    union all
    select unnest(m.roles) from socle.membre m join socle.entreprise e on e.organisation = m.organisation
     where m.utilisateur = socle.moi() and m.actif and e.id = p_entreprise
       and exists (select 1 from socle.organisation o where o.id = e.organisation and o.type <> 'cabinet')
    union all
    select case when a.role = 'paie' and not ('paie' = any(d.perimetre)) then null
                else coalesce(a.role, case when 'supervision' = any(m.roles) then 'supervision' end) end
      from socle.mandat d
      join socle.membre m on m.organisation = d.cabinet and m.utilisateur = socle.moi() and m.actif
      left join socle.mandat_affectation a on a.mandat = d.id and a.membre = m.id
     where d.entreprise = p_entreprise and d.statut = 'actif'
       and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
  ) t
$$;

-- Le périmètre du mandat par lequel j'agis sur cette entreprise, si je n'y agis QUE par mon cabinet
-- (aucun rôle de membre de l'entreprise) ; vide sinon. La porte et la base s'en servent pour
-- refuser ce qui sort du périmètre.
create function socle.perimetre_cabinet(p_entreprise uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, socle as $$
  select case
    when exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif and m.entreprise = p_entreprise) then null
    else (select d.perimetre from socle.mandat d
            join socle.membre m on m.organisation = d.cabinet and m.utilisateur = socle.moi() and m.actif
           where d.entreprise = p_entreprise and d.statut = 'actif'
             and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
           limit 1)
  end
$$;
revoke execute on function socle.perimetre_cabinet(uuid) from public;
grant execute on function socle.perimetre_cabinet(uuid) to skanfact_app;

-- Les livres : aussi au cabinet dont le mandat comprend la comptabilité.
create or replace function compta.mes_entreprises() returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e from socle.mes_entreprises() e
   where (socle.mes_roles(e) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'lecture']::text[]
          and socle.perimetre_cabinet(e) is null)
      or (socle.mes_roles(e) && array['supervision', 'revision', 'saisie']::text[]
          and 'comptabilite' = any(coalesce(socle.perimetre_cabinet(e), '{}')))
      or exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = e
                   and exists (select 1 from unnest(k.gestes) g where g like 'compta.%'))
$$;

-- La paie : aussi au cabinet dont le mandat comprend la paie (son associé, son collaborateur Paie).
create or replace function paie.mes_entreprises() returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e from socle.mes_entreprises() e
   where (socle.mes_roles(e) && array['proprietaire', 'administrateur', 'paie']::text[] and socle.perimetre_cabinet(e) is null)
      or (socle.mes_roles(e) && array['supervision', 'paie']::text[] and 'paie' = any(coalesce(socle.perimetre_cabinet(e), '{}')))
      or exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = e
                   and exists (select 1 from unnest(k.gestes) g where g like 'paie.%'))
$$;

-- La masse salariale (un total, sans nom) : aussi au cabinet dont le mandat comprend la
-- comptabilité ou la paie (les totaux de la paie sont déjà dans ses livres).
create or replace function paie.masse_salariale(p_entreprise uuid, p_du date, p_au date)
returns table (bulletins bigint, brut numeric, net numeric, charges_patronales numeric, cout_employeur numeric)
language plpgsql stable security definer set search_path = pg_catalog, socle, paie as $$
begin
  if not (p_entreprise in (select socle.mes_entreprises())
          and ((socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne', 'paie', 'lecture']::text[]
                and socle.perimetre_cabinet(p_entreprise) is null)
               or (socle.mes_roles(p_entreprise) && array['supervision', 'revision', 'saisie', 'paie']::text[]
                   and coalesce(socle.perimetre_cabinet(p_entreprise), '{}') && array['comptabilite', 'paie']::text[])
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

-- ── Le cabinet ───────────────────────────────────────────────────────────────────────────────────
-- Son créateur en est l'associé (03 § 1) ; son code (six à dix lettres ou chiffres) est ce que le
-- client donne pour le choisir.
create function socle.creer_cabinet(p_nom text) returns table (cabinet uuid, code text)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_code text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when length(v_code) = 8 and not exists (select 1 from socle.organisation o where o.code_cabinet = v_code);
  end loop;
  insert into socle.organisation (type, nom, code_cabinet) values ('cabinet', p_nom, v_code) returning organisation.id into v_org;
  insert into socle.membre (utilisateur, organisation, roles) values (socle.moi(), v_org, array['supervision']);
  return query select v_org, v_code;
end $$;

-- Suis-je associé de ce cabinet ?
create function socle.suis_associe(p_cabinet uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (select 1 from socle.membre m join socle.organisation o on o.id = m.organisation
                  where m.organisation = p_cabinet and o.type = 'cabinet' and m.utilisateur = socle.moi()
                    and m.actif and 'supervision' = any(m.roles))
$$;

-- ── Le mandat ────────────────────────────────────────────────────────────────────────────────────
-- Seul le PROPRIÉTAIRE le propose, en donnant le code du cabinet et le périmètre (03 § 3.4 : la
-- paie décochée par défaut) ; une entreprise n'a qu'un cabinet à la fois.
create function socle.proposer_mandat(p_entreprise uuid, p_code text, p_perimetre text[]) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid; v_id uuid;
begin
  if not ('proprietaire' = any(socle.mes_roles(p_entreprise))) or socle.perimetre_cabinet(p_entreprise) is not null then
    perform socle.refus('seul le propriétaire de l''entreprise choisit son cabinet');
  end if;
  select o.id into v_cabinet from socle.organisation o where o.type = 'cabinet' and o.code_cabinet = upper(trim(p_code));
  if v_cabinet is null then perform socle.refus('aucun cabinet n''a ce code'); end if;
  if exists (select 1 from socle.mandat d where d.entreprise = p_entreprise and d.statut in ('propose', 'actif')) then
    perform socle.refus('cette entreprise a déjà un cabinet : arrête d''abord son mandat');
  end if;
  insert into socle.mandat (cabinet, entreprise, accorde_par, debut, perimetre, statut)
  values (v_cabinet, p_entreprise, socle.moi(), current_date, p_perimetre, 'propose') returning id into v_id;
  return v_id;
end $$;

-- L'associé accepte : le dossier entre au portefeuille, le mandat commence aujourd'hui.
create function socle.accepter_mandat(p_mandat uuid) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare d record;
begin
  select * into d from socle.mandat where id = p_mandat for update;
  if not found or not socle.suis_associe(d.cabinet) then perform socle.refus('seul un associé du cabinet accepte un dossier'); end if;
  if d.statut <> 'propose' then perform socle.refus('ce mandat n''attend pas d''être accepté'); end if;
  update socle.mandat set statut = 'actif', debut = current_date where id = p_mandat;
  return d.entreprise;
end $$;

-- Le propriétaire de l'entreprise ou un associé du cabinet l'arrête : le cabinet ne voit plus rien.
create function socle.arreter_mandat(p_mandat uuid) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare d record;
begin
  select * into d from socle.mandat where id = p_mandat for update;
  if not found or not (socle.suis_associe(d.cabinet)
                       or ('proprietaire' = any(socle.mes_roles(d.entreprise)) and socle.perimetre_cabinet(d.entreprise) is null)) then
    perform socle.refus('seuls le propriétaire de l''entreprise et un associé du cabinet arrêtent un mandat');
  end if;
  if d.statut = 'termine' then perform socle.refus('ce mandat est déjà arrêté'); end if;
  update socle.mandat set statut = 'termine', fin = greatest(current_date, debut) where id = p_mandat;
  return d.entreprise;
end $$;

-- Le périmètre ne change que par le propriétaire (03 § 3.4).
create function socle.changer_perimetre(p_mandat uuid, p_perimetre text[]) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare d record;
begin
  select * into d from socle.mandat where id = p_mandat for update;
  if not found or not ('proprietaire' = any(socle.mes_roles(d.entreprise))) or socle.perimetre_cabinet(d.entreprise) is not null then
    perform socle.refus('seul le propriétaire de l''entreprise change le périmètre de son cabinet');
  end if;
  if d.statut = 'termine' then perform socle.refus('ce mandat est déjà arrêté'); end if;
  update socle.mandat set perimetre = p_perimetre where id = p_mandat;
  return d.entreprise;
end $$;

-- Le dossier tenu (03 § 3.5) : l'entreprise d'un client qui n'est pas sur SkanFact. Aucun membre
-- côté client ; le mandat est actif et son périmètre complet, puisque personne ne peut l'accepter.
create function socle.creer_dossier_tenu(p_cabinet uuid, p_raison_sociale text, p_matricule text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet crée un dossier'); end if;
  insert into socle.organisation (type, nom) values ('independant', p_raison_sociale) returning id into v_org;
  insert into socle.entreprise (organisation, raison_sociale, matricule_fiscal, tenue_par)
    values (v_org, p_raison_sociale, p_matricule, p_cabinet) returning id into v_ent;
  insert into socle.etablissement (entreprise, code, nom, type) values (v_ent, '000', 'Siège', 'siege');
  insert into socle.mandat (cabinet, entreprise, accorde_par, debut, perimetre, statut)
  values (p_cabinet, v_ent, socle.moi(), current_date, array['comptabilite', 'declarations', 'saisie_achats', 'paie'], 'actif');
  return v_ent;
end $$;

-- Confier un dossier à un membre du cabinet, avec son rôle sur ce dossier (03 § 3.2 : l'associé).
create function socle.confier_dossier(p_mandat uuid, p_membre uuid, p_role text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare d record;
begin
  select * into d from socle.mandat where id = p_mandat;
  if not found or not socle.suis_associe(d.cabinet) then perform socle.refus('seul un associé du cabinet confie un dossier'); end if;
  if not exists (select 1 from socle.membre m where m.id = p_membre and m.organisation = d.cabinet and m.actif) then
    perform socle.refus('cette personne n''est pas de l''équipe du cabinet');
  end if;
  insert into socle.mandat_affectation (mandat, membre, role) values (p_mandat, p_membre, p_role)
  on conflict (mandat, membre) do update set role = excluded.role;
  return d.entreprise;
end $$;

create function socle.reprendre_dossier(p_mandat uuid, p_membre uuid) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare d record;
begin
  select * into d from socle.mandat where id = p_mandat;
  if not found or not socle.suis_associe(d.cabinet) then perform socle.refus('seul un associé du cabinet confie un dossier'); end if;
  delete from socle.mandat_affectation where mandat = p_mandat and membre = p_membre;
  return d.entreprise;
end $$;

-- Le portefeuille : tous les dossiers pour un associé (y compris les mandats proposés, qu'il
-- accepte), ceux qui lui sont confiés pour un collaborateur ; le nom du client, son matricule, le
-- statut, le périmètre, et le rôle de la personne sur chacun.
create function socle.portefeuille(p_cabinet uuid)
returns table (mandat uuid, entreprise uuid, raison_sociale text, matricule_fiscal text, statut text, perimetre text[],
               debut date, tenu boolean, role text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.id, d.entreprise, e.raison_sociale, e.matricule_fiscal, d.statut, d.perimetre, d.debut, e.tenue_par is not null,
         coalesce(a.role, case when 'supervision' = any(m.roles) then 'supervision' end)
    from socle.mandat d
    join socle.entreprise e on e.id = d.entreprise
    join socle.membre m on m.organisation = d.cabinet and m.utilisateur = socle.moi() and m.actif
    left join socle.mandat_affectation a on a.mandat = d.id and a.membre = m.id
   where d.cabinet = p_cabinet and d.statut in ('propose', 'actif')
     and ('supervision' = any(m.roles) or (a.role is not null and d.statut = 'actif'))
   order by e.raison_sociale, d.id
$$;

revoke execute on function socle.creer_cabinet(text), socle.suis_associe(uuid), socle.proposer_mandat(uuid, text, text[]),
  socle.accepter_mandat(uuid), socle.arreter_mandat(uuid), socle.changer_perimetre(uuid, text[]),
  socle.creer_dossier_tenu(uuid, text, text), socle.confier_dossier(uuid, uuid, text), socle.reprendre_dossier(uuid, uuid),
  socle.portefeuille(uuid) from public;
grant execute on function socle.creer_cabinet(text), socle.suis_associe(uuid), socle.proposer_mandat(uuid, text, text[]),
  socle.accepter_mandat(uuid), socle.arreter_mandat(uuid), socle.changer_perimetre(uuid, text[]),
  socle.creer_dossier_tenu(uuid, text, text), socle.confier_dossier(uuid, uuid, text), socle.reprendre_dossier(uuid, uuid),
  socle.portefeuille(uuid) to skanfact_app;

-- ── Valider une période : au cabinet quand il a le mandat de comptabilité ───────────────────────
-- La validation de 0018, avec une seule différence : quand un cabinet a un mandat actif qui
-- comprend la comptabilité, c'est lui (associé ou collaborateur) qui valide ; l'entreprise voit
-- l'état et peut le lui demander (03 § 2, C8).
create or replace function compta.valider(p_entreprise uuid, p_jusqua date)
returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x record; n int := 0; c date; num bigint; v_numero text; m record; aujourdhui date := (now() at time zone 'Africa/Tunis')::date;
        v_mandat boolean; v_perimetre text[];
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  v_mandat := exists (select 1 from socle.mandat d where d.entreprise = p_entreprise and d.statut = 'actif'
                        and d.debut <= current_date and (d.fin is null or d.fin >= current_date) and 'comptabilite' = any(d.perimetre));
  v_perimetre := socle.perimetre_cabinet(p_entreprise);
  if v_perimetre is not null then
    if not ('comptabilite' = any(v_perimetre) and socle.mes_roles(p_entreprise) && array['supervision', 'revision']::text[]) then
      perform socle.refus('valider une période est réservé à l''associé et aux collaborateurs du cabinet');
    end if;
  elsif v_mandat and ma_cle() is null then
    perform socle.refus('avec un mandat de comptabilité, c''est le cabinet qui valide la période');
  elsif not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
          or exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = p_entreprise
                       and 'compta.ecritures.valider' = any (k.gestes))) then
    perform socle.refus('valider une période est réservé au propriétaire, à l''administrateur et à la comptabilité interne');
  end if;
  if p_jusqua is null or p_jusqua > aujourdhui then perform socle.refus('on ne valide pas une période qui n''est pas finie'); end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise for update;
  if c is not null and p_jusqua <= c then perform socle.refus(format('la période est déjà validée jusqu''au %s', to_char(c, 'DD/MM/YYYY'))); end if;
  for x in select * from compta.ecriture
            where entreprise = p_entreprise and statut = 'brouillard' and date_ecriture <= p_jusqua
            order by date_ecriture, journal, famille, rang loop
    insert into compta.compteur (entreprise, journal, annee, dernier) values (p_entreprise, x.journal, extract(year from x.date_ecriture)::int, 1)
    on conflict (entreprise, journal, annee) do update set dernier = compta.compteur.dernier + 1
    returning dernier into num;
    v_numero := x.journal || '-' || extract(year from x.date_ecriture)::int || '-' || lpad(num::text, 6, '0');
    select * into m from socle.sceller(p_entreprise, 'livres:' || p_entreprise::text, 'ecriture', x.id, compta.contenu_ecriture(x.id, v_numero));
    update compta.ecriture set statut = 'validee', numero = v_numero, chaine_rang = m.rang, empreinte = m.empreinte where id = x.id;
    n := n + 1;
  end loop;
  insert into compta.cloture (entreprise, jusqua, par) values (p_entreprise, p_jusqua, socle.moi())
  on conflict (entreprise) do update set jusqua = excluded.jusqua, par = excluded.par, le = now();
  return n;
end $$;
