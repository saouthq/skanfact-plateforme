-- La validation des écritures (brique 35, 29/09/2026 ; docs/ecritures.md). Jusqu'ici, toute
-- écriture était un brouillard que sa famille réécrivait. Valider une période (jusqu'à un jour) :
--   - chaque écriture en brouillard de la période prend son NUMÉRO (par journal et par année :
--     « VT-2026-000001 »), et devient un maillon de la chaîne d'empreintes des livres (socle.sceller) ;
--   - la période est CLOSE : plus aucune écriture ne s'y écrit, ni ne s'y efface.
-- Ensuite, une pièce qui change réécrit sa famille autrement : une écriture validée qui ne tient
-- plus se CONTRE-PASSE (l'écriture inverse, en brouillard), et la nouvelle s'écrit à côté ; tout ce
-- qui tomberait dans la période close s'écrit au premier jour ouvert (01 R6 ; 10.14.0 : un fait se
-- régularise à la date où il change, jamais en réécrivant un mois déclaré). À VÉRIFIER avec le
-- comptable : le premier jour ouvert comme date de la correction.

alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur', 'paie', 'salaires', 'avance', 'contre_passation'));
-- Le maillon d'une écriture validée (son rang dans la chaîne des livres, son empreinte).
alter table compta.ecriture add column chaine_rang bigint, add column empreinte text check (empreinte is null or empreinte ~ '^[0-9a-f]{64}$');
alter table compta.ecriture add constraint validee_scellee check (statut = 'brouillard' or (numero is not null and chaine_rang is not null and empreinte is not null));
create unique index ecriture_numero on compta.ecriture (entreprise, numero) where numero is not null;

-- La période close de chaque entreprise : validée jusqu'à ce jour-là, inclus.
create table compta.cloture (
  entreprise uuid primary key references socle.entreprise(id),
  jusqua date not null,
  par uuid references socle.utilisateur(id),
  le timestamptz not null default now()
);
alter table compta.cloture enable row level security;
alter table compta.cloture force row level security;
create policy visible on compta.cloture using (entreprise in (select socle.mes_entreprises()));
grant select on compta.cloture to skanfact_app;

-- Le dernier numéro de chaque journal, chaque année.
create table compta.compteur (
  entreprise uuid not null references socle.entreprise(id),
  journal text not null,
  annee int not null,
  dernier bigint not null check (dernier >= 1),
  primary key (entreprise, journal, annee)
);
alter table compta.compteur enable row level security;
alter table compta.compteur force row level security;
create policy visible on compta.compteur using (entreprise in (select compta.mes_entreprises()));
grant select on compta.compteur to skanfact_app;

-- Le contenu scellé d'une écriture : tout ce qui la fait, dans un ordre fixe. Son empreinte entre
-- dans la chaîne ; le contrôle la recalcule (une ligne retouchée par-dessous la base se voit).
create function compta.contenu_ecriture(p_id uuid, p_numero text) returns text
language sql stable security definer set search_path = pg_catalog, compta as $$
  select encode(sha256(convert_to(concat_ws('|', p_numero, e.journal, e.date_ecriture::text, e.origine_type, e.origine::text, coalesce(e.piece, ''), e.libelle,
           (select string_agg(concat_ws(':', l.compte, l.debit::text, l.credit::text, l.libelle), ';' order by l.rang) from compta.ligne l where l.ecriture = e.id)), 'UTF8')), 'hex')
    from compta.ecriture e where e.id = p_id
$$;
revoke execute on function compta.contenu_ecriture(uuid, text) from public;

-- ── Écrire une famille, avec la période close et la contre-passation ───────────────────────────
-- `p_options.contre` : le libellé d'une contre-passation, où « {numero} » devient le numéro de
-- l'écriture contre-passée (le texte vient du catalogue du serveur).
drop function compta.ecrire_famille(uuid, uuid, jsonb);
create function compta.ecrire_famille(p_entreprise uuid, p_famille uuid, p_ecritures jsonb, p_options jsonb default '{}')
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare e jsonb; l jsonb; v record; v_id uuid; r int; v_rang int := 0; restantes jsonb := coalesce(p_ecritures, '[]'::jsonb);
        v_ouvert date; i int; trouve int; lignes_v jsonb;
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then
    perform socle.refus('entreprise introuvable');
  end if;
  -- Le premier jour ouvert : le lendemain de la période close (aucune : tout est ouvert).
  select c.jusqua + 1 into v_ouvert from compta.cloture c where c.entreprise = p_entreprise;
  delete from compta.ecriture where entreprise = p_entreprise and famille = p_famille and statut = 'brouillard';
  -- Chaque écriture validée de la famille qui compte encore (pas déjà contre-passée par une
  -- écriture validée) : si la famille la veut telle quelle, elle reste ; sinon elle se contre-passe.
  for v in select x.* from compta.ecriture x
            where x.entreprise = p_entreprise and x.famille = p_famille and x.statut = 'validee' and x.origine_type <> 'contre_passation'
              and not exists (select 1 from compta.ecriture c where c.entreprise = p_entreprise and c.origine_type = 'contre_passation'
                                and c.origine = x.id and c.statut = 'validee')
            order by x.date_ecriture, x.rang loop
    select coalesce(jsonb_agg(jsonb_build_object('compte', y.compte, 'debit', y.debit::text, 'credit', y.credit::text) order by y.rang), '[]'::jsonb)
      into lignes_v from compta.ligne y where y.ecriture = v.id;
    trouve := null;
    for i in 0 .. jsonb_array_length(restantes) - 1 loop
      e := restantes -> i;
      if e->>'origine_type' = v.origine_type and (e->>'origine')::uuid = v.origine and e->>'journal' = v.journal
         and (e->>'date')::date = v.date_ecriture
         and (select coalesce(jsonb_agg(jsonb_build_object('compte', z.value->>'compte', 'debit', z.value->>'debit', 'credit', z.value->>'credit') order by z.n), '[]'::jsonb)
                from jsonb_array_elements(e->'lignes') with ordinality z(value, n)) = lignes_v then
        trouve := i; exit;
      end if;
    end loop;
    if trouve is not null then
      restantes := restantes - trouve;
    else
      insert into compta.ecriture (entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, tiers, libelle)
      values (p_entreprise, v.journal, greatest(v.date_ecriture, coalesce(v_ouvert, v.date_ecriture)), 'contre_passation', v.id, p_famille, v_rang, v.piece, v.tiers,
              left(replace(coalesce(p_options->>'contre', '{numero}'), '{numero}', v.numero), 500))
      returning id into v_id;
      v_rang := v_rang + 1;
      insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, taux_tva)
      select v_id, p_entreprise, y.rang, y.compte, y.libelle, y.credit, y.debit, y.taux_tva from compta.ligne y where y.ecriture = v.id;
    end if;
  end loop;
  -- Ce que la famille veut et qui n'est pas déjà validé : en brouillard, jamais dans la période close.
  for e in select value from jsonb_array_elements(restantes) loop
    insert into compta.ecriture (entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, tiers, libelle)
    values (p_entreprise, e->>'journal', greatest((e->>'date')::date, coalesce(v_ouvert, (e->>'date')::date)), e->>'origine_type', (e->>'origine')::uuid, p_famille,
            v_rang, e->>'piece', (e->>'tiers')::uuid, e->>'libelle')
    returning id into v_id;
    v_rang := v_rang + 1;
    r := 0;
    for l in select value from jsonb_array_elements(e->'lignes') loop
      r := r + 1;
      insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, taux_tva)
      values (v_id, p_entreprise, r, l->>'compte', l->>'libelle', (l->>'debit')::bigint, (l->>'credit')::bigint, (l->>'taux_tva')::bigint);
    end loop;
  end loop;
end $$;
revoke execute on function compta.ecrire_famille(uuid, uuid, jsonb, jsonb) from public;
grant execute on function compta.ecrire_famille(uuid, uuid, jsonb, jsonb) to skanfact_app;

-- ── Valider une période ──────────────────────────────────────────────────────────────────────────
-- Qui valide (03 § 2.1, « Valider une période ») : propriétaire, administrateur, comptabilité
-- interne, ou une clé de l'API qui porte le geste. Les contrôles passent AVANT le premier numéro :
-- un jour passé (jamais l'avenir), après la période déjà close. Puis chaque brouillard de la période,
-- dans l'ordre des dates, prend son numéro et son maillon ; la période est close.
create function compta.valider(p_entreprise uuid, p_jusqua date)
returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x record; n int := 0; c date; num bigint; v_numero text; m record; aujourdhui date := (now() at time zone 'Africa/Tunis')::date;
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  if not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
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
revoke execute on function compta.valider(uuid, date) from public;
grant execute on function compta.valider(uuid, date) to skanfact_app;

-- Le contrôle des livres : la chaîne (chaque maillon suit le précédent) et, pour chaque écriture
-- validée, son contenu d'aujourd'hui recalculé contre celui qui a été scellé. Rend la première
-- écriture qui ne va pas, ou « ok ».
create function compta.controler(p_entreprise uuid)
returns table (ok boolean, numero text, motif text)
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare ch record; x record;
begin
  if not (p_entreprise in (select compta.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  select * into ch from socle.controler_chaine(p_entreprise, 'livres:' || p_entreprise::text);
  if not ch.ok then return query select false, null::text, 'chaîne : ' || ch.motif; return; end if;
  for x in select e.id, e.numero, e.chaine_rang, e.empreinte, m.contenu, m.empreinte empreinte_maillon from compta.ecriture e
            left join socle.maillon m on m.entreprise = e.entreprise and m.cle = 'livres:' || p_entreprise::text and m.objet_type = 'ecriture' and m.objet_id = e.id
            where e.entreprise = p_entreprise and e.statut = 'validee' order by e.chaine_rang loop
    if x.contenu is null then return query select false, x.numero, 'sans maillon'; return; end if;
    if x.contenu <> compta.contenu_ecriture(x.id, x.numero) or x.empreinte <> x.empreinte_maillon then
      return query select false, x.numero, 'contenu changé depuis la validation'; return;
    end if;
  end loop;
  return query select true, null::text, null::text;
end $$;
revoke execute on function compta.controler(uuid) from public;
grant execute on function compta.controler(uuid) to skanfact_app;
