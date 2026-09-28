-- 0004 — Les règles fiscales datées, la numérotation et le journal inaltérable
-- (cadrage : 01-modele-de-donnees.md R3, R9, R11, R12, § 3, § 6, § 17).
--
--   - Une règle de droit (taux, timbre, barème) est une DONNÉE datée, jamais du code (R12). Une loi
--     de finances ajoute des lignes ; une ligne existante ne se modifie pas, on ferme sa date de fin.
--     Une règle qu'on ne connaît pas vaut « non renseigné », jamais un chiffre inventé.
--   - Un numéro de pièce légale est pris par le serveur, dans la transaction qui émet : si l'émission
--     échoue, le numéro n'a jamais été pris (la série ne se troue pas).
--   - Chaque pièce scellée devient un maillon d'une chaîne d'empreintes : modifier le passé casse la
--     chaîne, et le contrôle le voit (R9).

create extension if not exists btree_gist;

-- Un nombre à virgule n'entre pas dans une règle : les taux sont des entiers à six décimales
-- (19 % s'écrit 190000), l'argent des entiers dans la plus petite unité (R3).
create function socle.sans_virgule(v jsonb) returns boolean
language sql immutable as $$
  select not jsonb_path_exists(v, 'lax $.** ? (@.type() == "number" && @.floor() != @)')
$$;

-- ── Les devises (01 § 3) ─────────────────────────────────────────────────────────────────────────
create table socle.devise (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  symbole text not null,
  decimales smallint not null check (decimales between 0 and 4),
  nom text not null
);
-- Les décimales de la norme ISO 4217 : le dinar en a trois (le millime).
insert into socle.devise (code, symbole, decimales, nom) values
  ('TND', 'DT', 3, 'Dinar tunisien'), ('EUR', '€', 2, 'Euro'), ('USD', '$', 2, 'Dollar des États-Unis');
alter table socle.devise enable row level security;
alter table socle.devise force row level security;
create policy lire on socle.devise for select using (true);
grant select on socle.devise to skanfact_app;

-- ── Les règles communes (01 § 3) ─────────────────────────────────────────────────────────────────
-- `fin` est le DERNIER jour d'effet (inclus) ; vide = toujours en vigueur. Deux lignes d'un même
-- code ne se chevauchent jamais : à une date, une règle au plus.
create table socle.regle_fiscale (
  id uuid primary key default socle.uuidv7(),
  code text not null check (code ~ '^[a-z_]+(\.[a-z0-9_]+)+$'),
  valeur jsonb not null check (socle.sans_virgule(valeur)),
  debut date not null,
  fin date,
  -- Jamais sans source : le texte de loi, la note, l'article (R12).
  source text not null check (length(trim(source)) > 0),
  verifiee_par text,
  verifiee_le date,
  cree_le timestamptz not null default now(),
  check (fin is null or fin >= debut),
  constraint regle_fiscale_sans_chevauchement exclude using gist (code with =, daterange(debut, fin, '[]') with &&)
);
alter table socle.regle_fiscale enable row level security;
alter table socle.regle_fiscale force row level security;
create policy lire on socle.regle_fiscale for select using (true);
grant select on socle.regle_fiscale to skanfact_app;

-- Une règle ne se réécrit pas : on ferme sa date de fin (une seule fois), c'est tout.
create function socle.regle_intouchable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'une règle ne s''efface pas : on ferme sa date de fin' using errcode = '42501';
  end if;
  if old.fin is null and new.fin is not null
     and (to_jsonb(new) - 'fin') = (to_jsonb(old) - 'fin') then
    return new;
  end if;
  raise exception 'une règle ne se modifie pas : on ferme sa date de fin et on en écrit une nouvelle' using errcode = '42501';
end $$;
create trigger regle_fiscale_intouchable before update or delete on socle.regle_fiscale
  for each row execute function socle.regle_intouchable();

-- ── Les règles de l'entreprise (01 § 3) ──────────────────────────────────────────────────────────
-- Ce que l'entreprise règle elle-même : un taux de retenue particulier, une exonération avec son
-- attestation. Même forme, mêmes dates, même refus des chevauchements.
create table socle.regle_entreprise (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  code text not null check (code ~ '^[a-z_]+(\.[a-z0-9_]+)+$'),
  valeur jsonb not null check (socle.sans_virgule(valeur)),
  debut date not null,
  fin date,
  motif text not null check (length(trim(motif)) > 0),
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  check (fin is null or fin >= debut),
  constraint regle_entreprise_sans_chevauchement exclude using gist (entreprise with =, code with =, daterange(debut, fin, '[]') with &&)
);
alter table socle.regle_entreprise enable row level security;
alter table socle.regle_entreprise force row level security;
create policy lire on socle.regle_entreprise for select using (entreprise in (select socle.mes_entreprises()));
grant select on socle.regle_entreprise to skanfact_app;
create trigger regle_entreprise_intouchable before update or delete on socle.regle_entreprise
  for each row execute function socle.regle_intouchable();

-- Poser une règle de l'entreprise, à partir d'une date. Celle qui courait encore se ferme la veille ;
-- une règle qui commence le même jour ou plus tard ne se remplace pas (on ne réécrit pas le passé).
create function socle.poser_regle_entreprise(p_entreprise uuid, p_code text, p_valeur jsonb, p_debut date, p_fin date, p_motif text)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid; ouverte record;
begin
  if not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    perform socle.refus('ton rôle ne permet pas de modifier les réglages fiscaux');
  end if;
  select * into ouverte from socle.regle_entreprise
   where entreprise = p_entreprise and code = p_code and fin is null for update;
  if found then
    if ouverte.debut >= p_debut then
      perform socle.refus('une règle commence déjà ce jour-là ou après : on ne réécrit pas le passé');
    end if;
    update socle.regle_entreprise set fin = p_debut - 1 where id = ouverte.id;
  end if;
  insert into socle.regle_entreprise (entreprise, code, valeur, debut, fin, motif, cree_par)
  values (p_entreprise, p_code, p_valeur, p_debut, p_fin, p_motif, socle.moi()) returning id into v;
  perform socle.tracer(p_entreprise, 'socle.regle.poser', 'regle_entreprise', v, null,
    jsonb_build_object('code', p_code, 'valeur', p_valeur, 'debut', p_debut, 'fin', p_fin, 'motif', p_motif));
  return v;
end $$;

-- La règle à une date (R11) : celle de l'entreprise, sinon la commune, sinon RIEN (R12). Lue avec
-- les droits de la personne : la règle d'une autre entreprise ne se voit pas.
create function socle.regle(p_entreprise uuid, p_code text, p_date date)
returns table (valeur jsonb, origine text, regle uuid, source text)
language sql stable set search_path = pg_catalog, socle as $$
  select t.valeur, t.origine, t.regle, t.source from (
    select r.valeur, 'entreprise' origine, r.id regle, r.motif source, 0 ordre from socle.regle_entreprise r
     where r.entreprise = p_entreprise and r.code = p_code and p_date >= r.debut and (r.fin is null or p_date <= r.fin)
    union all
    select r.valeur, 'commune', r.id, r.source, 1 from socle.regle_fiscale r
     where r.code = p_code and p_date >= r.debut and (r.fin is null or p_date <= r.fin)
  ) t order by t.ordre limit 1
$$;

-- ── La numérotation (01 § 6) ─────────────────────────────────────────────────────────────────────
create table socle.serie (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  etablissement uuid references socle.etablissement(id),
  type text not null check (type ~ '^[a-z_]+$'),
  prefixe text not null check (prefixe ~ '^[A-Z0-9]{1,10}$'),
  -- Le numéro repart à 1 chaque année, ou jamais.
  remise text not null default 'annuelle' check (remise in ('annuelle', 'jamais')),
  -- {P} le préfixe, {AAAA} l'année de la pièce, {N:3} le numéro sur au moins 3 chiffres.
  format text not null default '{P}-{AAAA}-{N:3}' check (format ~ '\{N(:[1-9])?\}'),
  -- Une série légale (facture, avoir) ne se numérote que sur le serveur, jamais hors ligne.
  legale boolean not null,
  active boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (entreprise, prefixe)
);
alter table socle.serie enable row level security;
alter table socle.serie force row level security;
create policy lire on socle.serie for select using (entreprise in (select socle.mes_entreprises()));
grant select on socle.serie to skanfact_app;

-- Le dernier numéro pris, par série et par période (l'année, ou 0 pour une série sans remise).
-- `repris` : le numéro annoncé par l'entreprise quand la série a commencé ailleurs (213b de la v10).
create table socle.compteur (
  serie uuid not null references socle.serie(id),
  entreprise uuid not null references socle.entreprise(id),
  periode int not null,
  dernier bigint not null check (dernier >= 0),
  repris bigint check (repris >= 0),
  primary key (serie, periode)
);
alter table socle.compteur enable row level security;
alter table socle.compteur force row level security;
create policy lire on socle.compteur for select using (entreprise in (select socle.mes_entreprises()));
grant select on socle.compteur to skanfact_app;

create function socle.formater_numero(p_format text, p_prefixe text, p_date date, p_numero bigint) returns text
language plpgsql immutable as $$
declare largeur int; chiffres text := p_numero::text; resultat text;
begin
  largeur := coalesce((regexp_match(p_format, '\{N:([1-9])\}'))[1]::int, 1);
  -- lpad COUPE un texte plus long que la largeur : 1000 sur 3 chiffres deviendrait « 100 ».
  if length(chiffres) < largeur then chiffres := lpad(chiffres, largeur, '0'); end if;
  resultat := replace(p_format, '{P}', p_prefixe);
  resultat := replace(resultat, '{AAAA}', to_char(p_date, 'YYYY'));
  return regexp_replace(resultat, '\{N(:[1-9])?\}', chiffres);
end $$;

create function socle.periode_de(p_remise text, p_date date) returns int
language sql immutable as $$ select case p_remise when 'annuelle' then extract(year from p_date)::int else 0 end $$;

create function socle.creer_serie(p_entreprise uuid, p_type text, p_prefixe text, p_legale boolean, p_remise text, p_format text)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    perform socle.refus('ton rôle ne permet pas de créer une série de numéros');
  end if;
  insert into socle.serie (entreprise, type, prefixe, legale, remise, format)
  values (p_entreprise, p_type, p_prefixe, p_legale, coalesce(p_remise, 'annuelle'), coalesce(p_format, '{P}-{AAAA}-{N:3}'))
  returning id into v;
  perform socle.tracer(p_entreprise, 'socle.serie.creer', 'serie', v, null,
    jsonb_build_object('type', p_type, 'prefixe', p_prefixe, 'legale', p_legale));
  return v;
end $$;

-- « Mon dernier numéro était FAC-2026-147 » : possible tant qu'aucun numéro n'a été pris ici
-- dans cette période (sinon la série se trouerait ou se doublerait).
create function socle.reprendre_serie(p_serie uuid, p_periode int, p_dernier bigint) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare s record; c record; existait boolean;
begin
  select * into s from socle.serie where id = p_serie;
  if not found or s.entreprise not in (select socle.mes_entreprises()) then perform socle.refus('série introuvable'); end if;
  if not (socle.mes_roles(s.entreprise) && array['proprietaire', 'administrateur']::text[]) then
    perform socle.refus('ton rôle ne permet pas de modifier une série de numéros');
  end if;
  select * into c from socle.compteur where serie = p_serie and periode = p_periode for update;
  existait := found;
  if existait and c.dernier <> coalesce(c.repris, 0) then
    perform socle.refus('des numéros ont déjà été donnés dans SkanFact pour cette période : changer la suite trouerait la série');
  end if;
  insert into socle.compteur (serie, entreprise, periode, dernier, repris) values (p_serie, s.entreprise, p_periode, p_dernier, p_dernier)
  on conflict (serie, periode) do update set dernier = excluded.dernier, repris = excluded.repris;
  perform socle.tracer(s.entreprise, 'socle.serie.reprendre', 'serie', p_serie,
    case when existait then jsonb_build_object('dernier', c.dernier) end, jsonb_build_object('periode', p_periode, 'dernier', p_dernier));
end $$;

-- Prendre le numéro suivant : à appeler dans la transaction qui émet, APRÈS tous les contrôles.
-- La ligne du compteur reste verrouillée jusqu'à la fin de la transaction : deux émissions
-- simultanées ne prennent jamais le même numéro, et une émission annulée rend le sien.
create function socle.prendre_numero(p_serie uuid, p_date date) returns table (numero bigint, texte text)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare s record; n bigint;
begin
  select * into s from socle.serie where id = p_serie;
  if not found or s.entreprise not in (select socle.mes_entreprises()) then perform socle.refus('série introuvable'); end if;
  if not s.active then perform socle.refus('cette série n''est plus active'); end if;
  insert into socle.compteur (serie, entreprise, periode, dernier) values (p_serie, s.entreprise, socle.periode_de(s.remise, p_date), 1)
  on conflict (serie, periode) do update set dernier = socle.compteur.dernier + 1
  returning socle.compteur.dernier into n;
  return query select n, socle.formater_numero(s.format, s.prefixe, p_date, n);
end $$;

-- Le prochain numéro se LIT, il ne se réserve pas (aperçu de la prochaine facture).
create function socle.prochain_numero(p_serie uuid, p_date date) returns table (numero bigint, texte text)
language sql stable set search_path = pg_catalog, socle as $$
  select coalesce(c.dernier, 0) + 1, socle.formater_numero(s.format, s.prefixe, p_date, coalesce(c.dernier, 0) + 1)
    from socle.serie s left join socle.compteur c on c.serie = s.id and c.periode = socle.periode_de(s.remise, p_date)
   where s.id = p_serie
$$;

-- ── Le journal inaltérable (R9) ──────────────────────────────────────────────────────────────────
-- Une chaîne par série de factures, par caisse, par exercice : `cle` la nomme (« serie:<id> »…).
-- Chaque maillon : l'empreinte du CONTENU de la pièce (calculée par le serveur sur sa forme
-- canonique, serveur/journal.ts), celle du maillon précédent, et
--   empreinte = sha256( précédente || contenu )   (en hexadécimal ; la première précédente est 64 « 0 »)
-- Une formule simple, qu'un poste de caisse hors ligne refait à l'identique.
create table socle.chaine (
  entreprise uuid not null references socle.entreprise(id),
  cle text not null check (cle ~ '^[a-z_]+:[0-9a-f-]{36}$'),
  rang bigint not null default 0,
  derniere text not null default repeat('0', 64),
  controle_le timestamptz,
  controle_ok boolean,
  primary key (entreprise, cle)
);
alter table socle.chaine enable row level security;
alter table socle.chaine force row level security;
create policy lire on socle.chaine for select using (entreprise in (select socle.mes_entreprises()));
grant select on socle.chaine to skanfact_app;

-- À REVOIR à la mesure de charge (npm run charge, étape 4) : un maillon par ticket de caisse ;
-- découper par entreprise si la table grossit trop.
create table socle.maillon (
  entreprise uuid not null references socle.entreprise(id),
  cle text not null,
  rang bigint not null check (rang >= 1),
  objet_type text not null,
  objet_id uuid not null,
  contenu text not null check (contenu ~ '^[0-9a-f]{64}$'),
  precedente text not null check (precedente ~ '^[0-9a-f]{64}$'),
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  instant timestamptz not null default now(),
  primary key (entreprise, cle, rang),
  -- Une pièce ne se scelle qu'une fois.
  unique (objet_type, objet_id)
);
alter table socle.maillon enable row level security;
alter table socle.maillon force row level security;
create policy lire on socle.maillon for select using (entreprise in (select socle.mes_entreprises()));
grant select on socle.maillon to skanfact_app;

create function socle.journal_intouchable() returns trigger
language plpgsql as $$
begin
  raise exception 'le journal inaltérable ne se modifie pas et ne s''efface pas (01 R9)' using errcode = '42501';
end $$;
create trigger maillon_intouchable before update or delete on socle.maillon
  for each row execute function socle.journal_intouchable();

create function socle.empreinte_maillon(p_precedente text, p_contenu text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p_precedente || p_contenu, 'UTF8')), 'hex') $$;

-- Sceller une pièce : ajoute son maillon au bout de sa chaîne. La ligne de la chaîne reste
-- verrouillée jusqu'à la fin de la transaction (deux scellés simultanés ne se croisent pas).
create function socle.sceller(p_entreprise uuid, p_cle text, p_objet_type text, p_objet_id uuid, p_contenu text)
returns table (rang bigint, precedente text, empreinte text)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare c record; e text;
begin
  if p_entreprise not in (select socle.mes_entreprises()) then perform socle.refus('entreprise introuvable'); end if;
  insert into socle.chaine (entreprise, cle) values (p_entreprise, p_cle) on conflict do nothing;
  select * into c from socle.chaine ch where ch.entreprise = p_entreprise and ch.cle = p_cle for update;
  e := socle.empreinte_maillon(c.derniere, p_contenu);
  insert into socle.maillon (entreprise, cle, rang, objet_type, objet_id, contenu, precedente, empreinte)
  values (p_entreprise, p_cle, c.rang + 1, p_objet_type, p_objet_id, p_contenu, c.derniere, e);
  update socle.chaine ch set rang = c.rang + 1, derniere = e where ch.entreprise = p_entreprise and ch.cle = p_cle;
  return query select c.rang + 1, c.derniere, e;
end $$;

-- Le contrôle de la chaîne (le contrôle quotidien l'appelle) : chaque maillon suit le précédent,
-- sans trou, chaque empreinte se recalcule, et le bout de la chaîne est bien le dernier maillon (un
-- maillon retiré à la fin se voit). Rend le PREMIER rang qui ne va pas, ou « ok ».
-- Le contenu des pièces elles-mêmes se recompare côté serveur (serveur/journal.ts).
create function socle.controler_chaine(p_entreprise uuid, p_cle text)
returns table (ok boolean, rang bigint, motif text)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare c record; m record; attendu_rang bigint := 0; attendue text := repeat('0', 64); casse bigint; pourquoi text;
begin
  if p_entreprise not in (select socle.mes_entreprises()) then perform socle.refus('entreprise introuvable'); end if;
  select * into c from socle.chaine ch where ch.entreprise = p_entreprise and ch.cle = p_cle;
  for m in select * from socle.maillon ml where ml.entreprise = p_entreprise and ml.cle = p_cle order by ml.rang loop
    attendu_rang := attendu_rang + 1;
    if m.rang <> attendu_rang then casse := attendu_rang; pourquoi := 'maillon manquant'; exit; end if;
    if m.precedente <> attendue then casse := m.rang; pourquoi := 'ne suit pas le maillon précédent'; exit; end if;
    if m.empreinte <> socle.empreinte_maillon(m.precedente, m.contenu) then casse := m.rang; pourquoi := 'empreinte fausse'; exit; end if;
    attendue := m.empreinte;
  end loop;
  if casse is null and (coalesce(c.rang, 0) <> attendu_rang or coalesce(c.derniere, repeat('0', 64)) <> attendue) then
    casse := attendu_rang + 1; pourquoi := 'la fin de la chaîne manque';
  end if;
  update socle.chaine ch set controle_le = now(), controle_ok = (casse is null) where ch.entreprise = p_entreprise and ch.cle = p_cle;
  return query select casse is null, casse, pourquoi;
end $$;

revoke execute on function socle.poser_regle_entreprise(uuid, text, jsonb, date, date, text), socle.creer_serie(uuid, text, text, boolean, text, text),
  socle.reprendre_serie(uuid, int, bigint), socle.prendre_numero(uuid, date), socle.sceller(uuid, text, text, uuid, text),
  socle.controler_chaine(uuid, text) from public;
grant execute on function socle.poser_regle_entreprise(uuid, text, jsonb, date, date, text), socle.creer_serie(uuid, text, text, boolean, text, text),
  socle.reprendre_serie(uuid, int, bigint), socle.prendre_numero(uuid, date), socle.sceller(uuid, text, text, uuid, text),
  socle.controler_chaine(uuid, text) to skanfact_app;
