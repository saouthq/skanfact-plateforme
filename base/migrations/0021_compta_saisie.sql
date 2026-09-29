-- La saisie dans les livres du serveur (brique 38, 29/09/2026 ; docs/cabinet.md). Jusqu'ici, toute
-- écriture naissait d'une pièce que le serveur tient, et se validait par période. Ici, les gestes du
-- comptable (le cabinet, ou la comptabilité interne de l'entreprise) sur ces mêmes livres :
--   - SAISIR une écriture (une OD, une écriture de banque…) : en brouillard, modifiable et
--     supprimable tant qu'elle n'est pas validée ; elle est sa propre famille (origine « saisie ») ;
--   - VALIDER des écritures une à une ou par lot (le numéro et le maillon naissent là, comme pour
--     une période) ;
--   - CONTRE-PASSER une écriture saisie et validée, EXTOURNER une écriture saisie au premier jour
--     du mois suivant : le miroir se pose validé, jamais dans la période close ;
--   - LETTRER des écritures validées d'un même compte dont la somme fait zéro, et délettrer.
-- Une écriture née d'une pièce de l'entreprise ne se modifie, ne se supprime ni ne se contre-passe
-- jamais à la main : elle suit sa pièce (C6 ; la correction d'une imputation viendra à part).
-- Qui fait quoi (03 § 2.1 et § 3.1), gardé ici ET à la porte : saisir, la comptabilité de
-- l'entreprise et tout le cabinet ; valider, contre-passer, extourner et lettrer, la comptabilité de
-- l'entreprise (sans mandat de comptabilité pour valider : C8) et l'associé ou le collaborateur.

alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur', 'paie', 'salaires', 'avance',
                          'contre_passation', 'saisie', 'extourne'));

-- Qui l'a saisie ; sa révision (un brouillard changé ailleurs n'est jamais écrasé : 01 R15) ; qui l'a
-- validée, et quand.
alter table compta.ecriture
  add column saisie_par uuid references socle.utilisateur(id),
  add column revision int not null default 1 check (revision >= 1),
  add column validee_par uuid references socle.utilisateur(id),
  add column validee_le timestamptz;

-- Le tiers d'une ligne, en clair : un dossier tenu n'a pas de fiche de tiers, et c'est lui qui fait
-- la balance auxiliaire.
alter table compta.ligne add column tiers_libelle text check (tiers_libelle is null or length(tiers_libelle) between 1 and 200);

-- Qui a validé, et quand : posé au passage au statut validé, quel que soit le chemin (une période,
-- une écriture, un miroir).
create function compta.dater_validation() returns trigger
language plpgsql as $$
begin
  if old.statut = 'brouillard' and new.statut = 'validee' then
    new.validee_le := now();
    new.validee_par := socle.moi();
  end if;
  return new;
end $$;
create trigger ecriture_validee_datee before update on compta.ecriture
  for each row execute function compta.dater_validation();

-- Un montant en millimes, écrit comme l'écran l'écrit : « 1 191,000 ».
create function compta.en_texte(v bigint) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when v < 0 then '−' else '' end
      || regexp_replace((abs(v) / 1000)::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g') || ',' || lpad((abs(v) % 1000)::text, 3, '0')
$$;

-- ── Qui peut ─────────────────────────────────────────────────────────────────────────────────────
-- `p_geste` : compta.ecritures.saisir, compta.ecritures.valider (valider, contre-passer, extourner),
-- compta.lettrage.poser (lettrer, délettrer).
create function compta.peut(p_entreprise uuid, p_geste text) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p_entreprise in (select socle.mes_entreprises()) and case
    -- Par son cabinet : le mandat comprend la comptabilité, et le rôle sur ce dossier le permet.
    when socle.perimetre_cabinet(p_entreprise) is not null then
      'comptabilite' = any(socle.perimetre_cabinet(p_entreprise))
      and socle.mes_roles(p_entreprise) && case when p_geste = 'compta.ecritures.saisir'
            then array['supervision', 'revision', 'saisie']::text[] else array['supervision', 'revision']::text[] end
    -- Une clé de l'API : le geste doit y être.
    when socle.ma_cle() is not null then
      exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = p_entreprise and p_geste = any (k.gestes))
    -- Un membre de l'entreprise : sa comptabilité ; valider revient au cabinet quand il a le mandat.
    else socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
      and (p_geste <> 'compta.ecritures.valider' or not exists (
            select 1 from socle.mandat d where d.entreprise = p_entreprise and d.statut = 'actif'
               and d.debut <= current_date and (d.fin is null or d.fin >= current_date) and 'comptabilite' = any (d.perimetre)))
  end
$$;

-- Le refus, avec sa raison, quand la personne ne peut pas.
create function compta.exiger(p_entreprise uuid, p_geste text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  if compta.peut(p_entreprise, p_geste) then return; end if;
  if p_geste = 'compta.ecritures.valider' and socle.perimetre_cabinet(p_entreprise) is null and socle.ma_cle() is null
     and socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[] then
    perform socle.refus('avec un mandat de comptabilité, c''est le cabinet qui valide les écritures');
  end if;
  if p_geste = 'compta.ecritures.saisir' then perform socle.refus('ton rôle ne permet pas de saisir dans ces livres'); end if;
  if p_geste = 'compta.lettrage.poser' then perform socle.refus('ton rôle ne permet pas de lettrer ces comptes'); end if;
  perform socle.refus('ton rôle ne permet pas de valider ces écritures');
end $$;

-- ── Numéroter et sceller une écriture ────────────────────────────────────────────────────────────
-- Le même geste que la validation d'une période (0018) : le numéro de son journal et de son année,
-- son maillon dans la chaîne des livres. Appelée par les fonctions ci-dessous, jamais par le serveur.
create function compta.numeroter(p_id uuid) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x record; num bigint; v_numero text; m record;
begin
  select * into x from compta.ecriture where id = p_id for update;
  insert into compta.compteur (entreprise, journal, annee, dernier) values (x.entreprise, x.journal, extract(year from x.date_ecriture)::int, 1)
  on conflict (entreprise, journal, annee) do update set dernier = compta.compteur.dernier + 1
  returning dernier into num;
  v_numero := x.journal || '-' || extract(year from x.date_ecriture)::int || '-' || lpad(num::text, 6, '0');
  select * into m from socle.sceller(x.entreprise, 'livres:' || x.entreprise::text, 'ecriture', x.id, compta.contenu_ecriture(x.id, v_numero));
  update compta.ecriture set statut = 'validee', numero = v_numero, chaine_rang = m.rang, empreinte = m.empreinte where id = x.id;
  return v_numero;
end $$;
revoke execute on function compta.numeroter(uuid) from public;

-- ── Saisir, modifier, supprimer un brouillard ────────────────────────────────────────────────────
-- `p_ecriture` : date (AAAA-MM-JJ), journal, piece, libelle, lignes [{ compte, libelle, tiers, debit,
-- credit }], les montants en millimes (texte). Les contrôles de la v10 (compta.js, ecritureValide),
-- AVANT toute écriture. Une ligne sans libellé prend celui de l'écriture ; une écriture sans libellé
-- prend celui de sa première ligne : sans aucun, elle ne dirait pas ce qu'elle enregistre.
create function compta.poser_saisie(p_entreprise uuid, p_id uuid, p_ecriture jsonb, p_nouvelle boolean)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_date date; v_journal text := p_ecriture->>'journal'; v_libelle text; c date; l jsonb; i int := 0;
        d bigint; cr bigint; td bigint := 0; tc bigint := 0; n int;
begin
  if coalesce(p_ecriture->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform socle.refus('la date manque'); end if;
  v_date := (p_ecriture->>'date')::date;
  if v_journal is null or not (v_journal = any (array['VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE', 'AN'])) then
    perform socle.refus('le journal manque : c''est lui qui range l''écriture');
  end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise;
  if c is not null and v_date <= c then
    perform socle.refus(format('la période est validée jusqu''au %s : une écriture ne s''y écrit plus', to_char(c, 'DD/MM/YYYY')));
  end if;
  n := coalesce(jsonb_array_length(p_ecriture->'lignes'), 0);
  if n < 2 then perform socle.refus('une écriture a au moins deux lignes'); end if;
  v_libelle := left(coalesce(nullif(btrim(p_ecriture->>'libelle'), ''),
    (select nullif(btrim(x.value->>'libelle'), '') from jsonb_array_elements(p_ecriture->'lignes') with ordinality x(value, k)
      where nullif(btrim(x.value->>'libelle'), '') is not null order by x.k limit 1)), 500);
  if v_libelle is null then perform socle.refus('le libellé manque : écris-le sur la pièce ou sur une ligne'); end if;
  for l in select value from jsonb_array_elements(p_ecriture->'lignes') loop
    i := i + 1;
    if coalesce(l->>'compte', '') !~ '^[0-9]{1,12}$' then perform socle.refus(format('ligne %s : le compte doit être un numéro', i)); end if;
    if coalesce(l->>'debit', '0') !~ '^[0-9]{1,15}$' or coalesce(l->>'credit', '0') !~ '^[0-9]{1,15}$' then
      perform socle.refus(format('ligne %s : un montant se lit en millimes, sans signe', i));
    end if;
    d := coalesce(l->>'debit', '0')::bigint; cr := coalesce(l->>'credit', '0')::bigint;
    if d > 0 and cr > 0 then perform socle.refus(format('ligne %s : une ligne va au débit ou au crédit, pas les deux', i)); end if;
    if d = 0 and cr = 0 then perform socle.refus(format('ligne %s : aucun montant', i)); end if;
    td := td + d; tc := tc + cr;
  end loop;
  if td <> tc then
    perform socle.refus(format('débit %s ≠ crédit %s : l''écriture ne tombe pas juste', compta.en_texte(td), compta.en_texte(tc)));
  end if;
  if p_nouvelle then
    insert into compta.ecriture (id, entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, libelle, saisie_par)
    values (p_id, p_entreprise, v_journal, v_date, 'saisie', p_id, p_id, 0, left(nullif(btrim(p_ecriture->>'piece'), ''), 200), v_libelle, socle.moi());
  else
    update compta.ecriture set journal = v_journal, date_ecriture = v_date, piece = left(nullif(btrim(p_ecriture->>'piece'), ''), 200),
           libelle = v_libelle, revision = revision + 1
     where id = p_id;
    delete from compta.ligne where ecriture = p_id;
  end if;
  i := 0;
  for l in select value from jsonb_array_elements(p_ecriture->'lignes') loop
    i := i + 1;
    insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, tiers_libelle)
    values (p_id, p_entreprise, i, l->>'compte', left(coalesce(nullif(btrim(l->>'libelle'), ''), v_libelle), 500),
            coalesce(l->>'debit', '0')::bigint, coalesce(l->>'credit', '0')::bigint, left(nullif(btrim(l->>'tiers'), ''), 200));
  end loop;
end $$;
revoke execute on function compta.poser_saisie(uuid, uuid, jsonb, boolean) from public;

create function compta.saisir(p_entreprise uuid, p_ecriture jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_id uuid := socle.uuidv7();
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  perform compta.poser_saisie(p_entreprise, v_id, p_ecriture, true);
  perform socle.tracer(p_entreprise, 'compta.ecriture.saisir', 'ecriture', v_id, null, p_ecriture);
  return v_id;
end $$;

-- Le brouillard à modifier ou supprimer : saisi à la main, pas encore validé, et dans la révision
-- que la personne a vue (sinon, on ne l'écrase pas : errcode SK409, le serveur rend un 409).
create function compta.brouillard_saisi(p_entreprise uuid, p_id uuid, p_revision int) returns compta.ecriture
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.ecriture;
begin
  select * into x from compta.ecriture where id = p_id and entreprise = p_entreprise for update;
  if not found then perform socle.refus('cette écriture n''existe pas'); end if;
  if x.statut = 'validee' then perform socle.refus('une écriture validée ne se modifie pas : elle se contre-passe'); end if;
  if x.origine_type <> 'saisie' then
    perform socle.refus('cette écriture vient d''une pièce de l''entreprise : elle suit sa pièce, elle ne se change pas dans les livres');
  end if;
  if x.revision <> p_revision then
    raise exception 'ce brouillard a été changé ailleurs entre-temps : recharge-le, rien n''a été enregistré' using errcode = 'SK409';
  end if;
  return x;
end $$;
revoke execute on function compta.brouillard_saisi(uuid, uuid, int) from public;

create function compta.modifier_saisie(p_entreprise uuid, p_id uuid, p_revision int, p_ecriture jsonb) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.ecriture; r int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  x := compta.brouillard_saisi(p_entreprise, p_id, p_revision);
  perform compta.poser_saisie(p_entreprise, p_id, p_ecriture, false);
  select revision into r from compta.ecriture where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.ecriture.modifier', 'ecriture', p_id, null, p_ecriture);
  return r;
end $$;

create function compta.supprimer_saisie(p_entreprise uuid, p_id uuid, p_revision int) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.ecriture;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  x := compta.brouillard_saisi(p_entreprise, p_id, p_revision);
  delete from compta.ecriture where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.ecriture.supprimer', 'ecriture', p_id,
    jsonb_build_object('journal', x.journal, 'date', x.date_ecriture, 'piece', x.piece, 'libelle', x.libelle), null);
end $$;

-- ── Valider des écritures ────────────────────────────────────────────────────────────────────────
-- Une par une, dans l'ordre des dates puis de la saisie. Le contrôle passe AVANT le numéro : une
-- écriture refusée au milieu d'un lot ne troue pas la numérotation, et elle est NOMMÉE avec sa raison.
create function compta.valider_ecritures(p_entreprise uuid, p_ids uuid[])
returns table (r_id uuid, r_numero text, r_chaine bigint, r_motif text)
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x record; v_numero text; aujourdhui date := (now() at time zone 'Africa/Tunis')::date; faites uuid[] := '{}'; pourquoi text;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  for x in select e.id, e.statut, e.date_ecriture from compta.ecriture e
            where e.entreprise = p_entreprise and e.id = any (p_ids)
            order by e.date_ecriture, e.cree_le, e.id for update loop
    if x.statut <> 'brouillard' then
      pourquoi := 'cette écriture est déjà validée : elle se contre-passe, elle ne se revalide pas';
      r_id := x.id; r_numero := null; r_chaine := null; r_motif := pourquoi;
      return next; continue;
    end if;
    if x.date_ecriture > aujourdhui then
      pourquoi := 'elle est datée du %s : une écriture ne se valide pas avant son jour';
      r_id := x.id; r_numero := null; r_chaine := null; r_motif := format(pourquoi, to_char(x.date_ecriture, 'DD/MM/YYYY'));
      return next; continue;
    end if;
    v_numero := compta.numeroter(x.id);
    r_id := x.id; r_numero := v_numero; r_motif := null;
    select e.chaine_rang into r_chaine from compta.ecriture e where e.id = x.id;
    faites := faites || x.id;
    return next;
  end loop;
  for x in select i from unnest(p_ids) i where not exists (select 1 from compta.ecriture e where e.id = i and e.entreprise = p_entreprise) loop
    pourquoi := 'cette écriture n''existe pas';
    r_id := x.i; r_numero := null; r_chaine := null; r_motif := pourquoi;
    return next;
  end loop;
  if cardinality(faites) > 0 then
    perform socle.tracer(p_entreprise, 'compta.ecritures.valider', 'ecriture', null, null, jsonb_build_object('ecritures', to_jsonb(faites)));
  end if;
end $$;

-- ── Le miroir d'une écriture saisie : contre-passation, extourne ───────────────────────────────────
-- Posé et validé d'un geste (comme la v10) ; ses lignes inversées gardent compte, tiers et libellé.
create function compta.poser_miroir(x compta.ecriture, p_type text, p_date date, p_libelle text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_id uuid := socle.uuidv7();
begin
  insert into compta.ecriture (id, entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, tiers, libelle, saisie_par)
  values (v_id, x.entreprise, x.journal, p_date, p_type, x.id, x.famille,
          (select coalesce(max(f.rang), 0) + 1 from compta.ecriture f where f.entreprise = x.entreprise and f.famille = x.famille),
          x.piece, x.tiers, left(replace(coalesce(p_libelle, '{numero}'), '{numero}', x.numero), 500), socle.moi());
  insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, taux_tva, tiers_libelle)
  select v_id, x.entreprise, y.rang, y.compte, y.libelle, y.credit, y.debit, y.taux_tva, y.tiers_libelle from compta.ligne y where y.ecriture = x.id;
  perform compta.numeroter(v_id);
  return v_id;
end $$;
revoke execute on function compta.poser_miroir(compta.ecriture, text, date, text) from public;

-- Contre-passer : au jour demandé, jamais avant l'écriture corrigée ni dans la période close.
create function compta.contrepasser(p_entreprise uuid, p_id uuid, p_date date, p_libelle text)
returns table (r_id uuid, r_numero text, r_chaine bigint, r_date date)
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.ecriture; c date; v_date date; aujourdhui date := (now() at time zone 'Africa/Tunis')::date;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  select * into x from compta.ecriture where id = p_id and entreprise = p_entreprise for update;
  if not found then perform socle.refus('cette écriture n''existe pas'); end if;
  if x.statut <> 'validee' then perform socle.refus('une écriture en brouillard se modifie : elle n''a pas besoin d''être contre-passée'); end if;
  if x.origine_type = 'contre_passation' then
    perform socle.refus('c''est déjà une contre-passation : pour rétablir l''écriture, saisis-la de nouveau');
  end if;
  if x.origine_type not in ('saisie', 'extourne') then
    perform socle.refus('cette écriture vient d''une pièce de l''entreprise : elle se corrige dans la pièce, et le serveur la contre-passe alors lui-même');
  end if;
  if exists (select 1 from compta.ecriture k where k.entreprise = p_entreprise and k.origine_type = 'contre_passation' and k.origine = x.id) then
    perform socle.refus('cette écriture a déjà été contre-passée');
  end if;
  if p_date is not null and p_date > aujourdhui then perform socle.refus('une contre-passation ne se date pas dans l''avenir'); end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise;
  v_date := greatest(coalesce(p_date, aujourdhui), x.date_ecriture, coalesce(c + 1, x.date_ecriture));
  r_id := compta.poser_miroir(x, 'contre_passation', v_date, p_libelle);
  select e.numero, e.chaine_rang, e.date_ecriture into r_numero, r_chaine, r_date from compta.ecriture e where e.id = r_id;
  perform socle.tracer(p_entreprise, 'compta.ecriture.contrepasser', 'ecriture', x.id, null, jsonb_build_object('miroir', r_id, 'numero', r_numero));
  return next;
end $$;

-- Extourner : le miroir au premier jour du mois suivant ; l'écriture d'origine garde sa place.
create function compta.extourner(p_entreprise uuid, p_id uuid, p_libelle text)
returns table (r_id uuid, r_numero text, r_chaine bigint, r_date date)
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.ecriture; c date; v_date date;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  select * into x from compta.ecriture where id = p_id and entreprise = p_entreprise for update;
  if not found then perform socle.refus('cette écriture n''existe pas'); end if;
  if x.statut <> 'validee' then perform socle.refus('on extourne une écriture validée : un brouillard se modifie ou se supprime'); end if;
  if x.origine_type <> 'saisie' then
    perform socle.refus('on extourne une écriture saisie dans les livres : une écriture née d''une pièce suit sa pièce');
  end if;
  if x.journal = 'AN' then perform socle.refus('des à-nouveaux ne s''extournent pas : ils ouvrent l''exercice'); end if;
  if exists (select 1 from compta.ecriture k where k.entreprise = p_entreprise and k.origine_type = 'extourne' and k.origine = x.id) then
    perform socle.refus('cette écriture a déjà été extournée');
  end if;
  if exists (select 1 from compta.ecriture k where k.entreprise = p_entreprise and k.origine_type = 'contre_passation' and k.origine = x.id) then
    perform socle.refus('cette écriture a été contre-passée : elle ne compte plus, il n''y a rien à extourner');
  end if;
  v_date := (date_trunc('month', x.date_ecriture) + interval '1 month')::date;
  select jusqua into c from compta.cloture where entreprise = p_entreprise;
  if c is not null and v_date <= c then
    perform socle.refus(format('son extourne tomberait le %s, dans la période validée : saisis-la au premier jour ouvert', to_char(v_date, 'DD/MM/YYYY')));
  end if;
  r_id := compta.poser_miroir(x, 'extourne', v_date, p_libelle);
  select e.numero, e.chaine_rang, e.date_ecriture into r_numero, r_chaine, r_date from compta.ecriture e where e.id = r_id;
  perform socle.tracer(p_entreprise, 'compta.ecriture.extourner', 'ecriture', x.id, null, jsonb_build_object('miroir', r_id, 'numero', r_numero));
  return next;
end $$;

-- ── Le lettrage ──────────────────────────────────────────────────────────────────────────────────
-- Relier des écritures VALIDÉES d'un même compte dont la somme débit − crédit fait zéro : c'est la
-- preuve qu'une facture est payée par ce règlement. Un brouillard peut encore changer (sa pièce, ou
-- sa saisie) : il ne se lettre pas. Une lettre désigne un lettrage de l'entreprise.
create table compta.lettrage (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  compte text not null check (compte ~ '^[0-9]{1,12}$'),
  lettre text not null check (lettre ~ '^[A-Z]{1,5}$'),
  rang bigint check (rang >= 1),
  cree_par uuid references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  unique (entreprise, lettre)
);
alter table compta.lettrage enable row level security;
alter table compta.lettrage force row level security;
create policy visible on compta.lettrage using (entreprise in (select compta.mes_entreprises()));
grant select on compta.lettrage to skanfact_app;

create table compta.ligne_lettree (
  ligne uuid primary key references compta.ligne(id),
  lettrage uuid not null references compta.lettrage(id) on delete cascade,
  entreprise uuid not null references socle.entreprise(id)
);
create index ligne_lettree_lettrage on compta.ligne_lettree (lettrage);
alter table compta.ligne_lettree enable row level security;
alter table compta.ligne_lettree force row level security;
create policy visible on compta.ligne_lettree using (entreprise in (select compta.mes_entreprises()));
grant select on compta.ligne_lettree to skanfact_app;

-- La lettre d'un rang : A … Z, AA … ZZ, AAA …
create function compta.lettre_de(p_rang bigint) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare n bigint := p_rang; s text := '';
begin
  while n > 0 loop
    n := n - 1;
    s := chr(65 + (n % 26)::int) || s;
    n := n / 26;
  end loop;
  return s;
end $$;

create function compta.lettrer(p_entreprise uuid, p_compte text, p_ecritures uuid[], p_lettre text) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int; solde bigint; v_lettre text := upper(nullif(btrim(p_lettre), '')); v_rang bigint; v_id uuid;
begin
  perform compta.exiger(p_entreprise, 'compta.lettrage.poser');
  -- Deux lettrages de la même entreprise, au même instant, passent l'un après l'autre : le second voit
  -- la lettre prise et les lignes déjà lettrées (sa phrase), jamais une erreur de doublon.
  perform pg_advisory_xact_lock(hashtextextended('compta.lettrage:' || p_entreprise::text, 0));
  if coalesce(p_compte, '') !~ '^[0-9]{1,12}$' then perform socle.refus('le compte à lettrer doit être un numéro'); end if;
  select count(distinct i) into n from unnest(p_ecritures) i;
  if n < 2 then perform socle.refus('le lettrage relie au moins deux écritures : une facture et son règlement'); end if;
  if exists (select 1 from unnest(p_ecritures) i where not exists (select 1 from compta.ecriture e where e.id = i and e.entreprise = p_entreprise)) then
    perform socle.refus('une des écritures à lettrer n''existe pas');
  end if;
  if exists (select 1 from compta.ecriture e where e.id = any (p_ecritures) and e.statut <> 'validee') then
    perform socle.refus('on lettre des écritures validées : un brouillard peut encore changer');
  end if;
  if not exists (select 1 from compta.ligne l where l.ecriture = any (p_ecritures) and l.compte = p_compte) then
    perform socle.refus(format('aucune de ces écritures ne touche le compte %s', p_compte));
  end if;
  if exists (select 1 from compta.ligne l join compta.ligne_lettree t on t.ligne = l.id where l.ecriture = any (p_ecritures) and l.compte = p_compte) then
    perform socle.refus('une de ces lignes est déjà lettrée : délettre-la d''abord');
  end if;
  select sum(l.debit - l.credit) into solde from compta.ligne l where l.ecriture = any (p_ecritures) and l.compte = p_compte;
  if solde <> 0 then perform socle.refus(format('ces écritures ne se soldent pas : il reste %s', compta.en_texte(solde))); end if;
  if v_lettre is not null then
    if v_lettre !~ '^[A-Z]{1,5}$' then perform socle.refus('une lettre s''écrit de une à cinq lettres, de A à Z'); end if;
    if exists (select 1 from compta.lettrage g where g.entreprise = p_entreprise and g.lettre = v_lettre) then
      perform socle.refus(format('la lettre %s est déjà prise', v_lettre));
    end if;
  else
    select coalesce(max(g.rang), 0) + 1 into v_rang from compta.lettrage g where g.entreprise = p_entreprise;
    loop
      v_lettre := compta.lettre_de(v_rang);
      exit when not exists (select 1 from compta.lettrage g where g.entreprise = p_entreprise and g.lettre = v_lettre);
      v_rang := v_rang + 1;
    end loop;
  end if;
  insert into compta.lettrage (entreprise, compte, lettre, rang, cree_par) values (p_entreprise, p_compte, v_lettre, v_rang, socle.moi())
  returning id into v_id;
  insert into compta.ligne_lettree (ligne, lettrage, entreprise)
  select l.id, v_id, p_entreprise from compta.ligne l where l.ecriture = any (p_ecritures) and l.compte = p_compte;
  perform socle.tracer(p_entreprise, 'compta.lettrage.poser', 'lettrage', v_id, null,
    jsonb_build_object('lettre', v_lettre, 'compte', p_compte, 'ecritures', to_jsonb(p_ecritures)));
  return v_lettre;
end $$;

create function compta.delettrer(p_entreprise uuid, p_lettre text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare g record;
begin
  perform compta.exiger(p_entreprise, 'compta.lettrage.poser');
  delete from compta.lettrage where entreprise = p_entreprise and lettre = upper(btrim(coalesce(p_lettre, ''))) returning * into g;
  if not found then perform socle.refus('ce lettrage n''existe pas'); end if;
  perform socle.tracer(p_entreprise, 'compta.lettrage.defaire', 'lettrage', g.id, jsonb_build_object('lettre', g.lettre, 'compte', g.compte), null);
end $$;

revoke execute on function compta.peut(uuid, text), compta.exiger(uuid, text), compta.saisir(uuid, jsonb),
  compta.modifier_saisie(uuid, uuid, int, jsonb), compta.supprimer_saisie(uuid, uuid, int), compta.valider_ecritures(uuid, uuid[]),
  compta.contrepasser(uuid, uuid, date, text), compta.extourner(uuid, uuid, text), compta.lettrer(uuid, text, uuid[], text),
  compta.delettrer(uuid, text) from public;
grant execute on function compta.peut(uuid, text), compta.saisir(uuid, jsonb),
  compta.modifier_saisie(uuid, uuid, int, jsonb), compta.supprimer_saisie(uuid, uuid, int), compta.valider_ecritures(uuid, uuid[]),
  compta.contrepasser(uuid, uuid, date, text), compta.extourner(uuid, uuid, text), compta.lettrer(uuid, text, uuid[], text),
  compta.delettrer(uuid, text) to skanfact_app;

-- ── Les mois des dossiers d'un cabinet ───────────────────────────────────────────────────────────
-- Pour le tableau du portefeuille : chaque dossier, chaque mois où ses livres ont des écritures —
-- combien, combien encore au brouillard, le chiffre d'affaires du mois (comptes 70, en millimes) et
-- le dernier mouvement. Seulement les livres que la personne voit (la sécurité par ligne le décide).
create function compta.mois_du_portefeuille(p_cabinet uuid, p_depuis date)
returns table (entreprise uuid, mois text, ecritures bigint, brouillards bigint, ca bigint, dernier timestamptz)
language sql stable security invoker set search_path = pg_catalog, socle, compta as $$
  select e.entreprise, to_char(e.date_ecriture, 'YYYY-MM'), count(*), count(*) filter (where e.statut = 'brouillard'),
         coalesce(sum(v.ca), 0)::bigint, max(greatest(e.cree_le, e.validee_le))
    from compta.ecriture e
    left join lateral (select sum(l.credit - l.debit) ca from compta.ligne l where l.ecriture = e.id and l.compte like '70%') v on true
   where e.entreprise in (select p.entreprise from socle.portefeuille(p_cabinet) p where p.statut = 'actif')
     and e.date_ecriture >= p_depuis
   group by e.entreprise, to_char(e.date_ecriture, 'YYYY-MM')
$$;
revoke execute on function compta.mois_du_portefeuille(uuid, date) from public;
grant execute on function compta.mois_du_portefeuille(uuid, date) to skanfact_app;
