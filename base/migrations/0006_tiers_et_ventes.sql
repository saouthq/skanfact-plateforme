-- 0006 — Les tiers (fiche commune du socle) et les pièces de vente, jusqu'à l'émission
-- (cadrage : 01 § 5, § 7, R6, R7, R9, R15 ; 02 § 2 ; 03 § 2.1 « Ventes »).
--
-- Une pièce de vente est un BROUILLON tant qu'elle n'est pas émise : on la modifie, on la
-- supprime. Émise, elle est scellée (R6) : ni elle ni ses lignes ne se modifient plus, jamais ne
-- s'effacent. Elle porte alors son numéro, ses totaux calculés en entiers, la copie figée de ce qui a
-- servi à la calculer (R7) et son maillon dans la chaîne de sa série (R9).

-- ── Une série qui repart à 1 chaque année écrit l'année dans son numéro ───────────────────────────
-- Sinon deux factures de deux années porteraient le même numéro imprimé.
alter table socle.serie add constraint serie_annuelle_ecrit_l_annee check (remise <> 'annuelle' or format like '%{AAAA}%');

-- ── Les tiers (01 § 5) ───────────────────────────────────────────────────────────────────────────
-- Par défaut, chaque entreprise a ses propres tiers (le partage dans un groupe viendra avec le
-- module Groupe). Un même tiers peut être client ET fournisseur : une seule fiche.
create table socle.tiers (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  nature text not null default 'societe' check (nature in ('societe', 'personne', 'etranger')),
  raison_sociale text not null check (length(trim(raison_sociale)) > 0),
  identifiant text,
  type_identifiant text check (type_identifiant in ('matricule', 'cin', 'carte_sejour', 'etranger')),
  adresse text,
  pays text not null default 'TN' check (pays ~ '^[A-Z]{2}$'),
  email text,
  telephone text,
  devise text not null default 'TND' references socle.devise(code),
  roles text[] not null default '{client}' check (roles <@ array['client', 'fournisseur'] and cardinality(roles) > 0),
  revision bigint not null default 1,         -- 01 R15 : un geste sur une version périmée est mis de côté
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  check ((identifiant is null) = (type_identifiant is null))
);
create index tiers_entreprise on socle.tiers (entreprise, raison_sociale);
alter table socle.tiers enable row level security;
alter table socle.tiers force row level security;
create policy visible on socle.tiers using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update on socle.tiers to skanfact_app;

-- ── Les pièces de vente (01 § 7) ─────────────────────────────────────────────────────────────────
create schema ventes;
grant usage on schema ventes to skanfact_app;

create table ventes.piece (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  type text not null check (type in ('devis', 'proforma', 'commande', 'livraison', 'facture', 'avoir', 'note_honoraires')),
  statut text not null default 'brouillon' check (statut in ('brouillon', 'emise', 'abandonnee')),
  tiers uuid not null references socle.tiers(id),
  date_piece date not null,
  echeance date,
  devise text not null default 'TND' references socle.devise(code),
  cours bigint check (cours > 0),              -- 1 unité de la devise = x DT, à six décimales
  taux_remise bigint not null default 0 check (taux_remise between 0 and 1000000),
  taux_retenue bigint not null default 0 check (taux_retenue between 0 and 1000000),
  appliquer_timbre boolean,
  objet text,
  notes text,
  -- Posés à l'émission, jamais avant (le numéro naît à la validation : leçon de la 6.0.0).
  serie uuid references socle.serie(id),
  numero bigint,
  numero_texte text,
  total_ht bigint, remise bigint, net_ht bigint, total_tva bigint, timbre bigint, timbre_base bigint,
  total_ttc bigint, retenue bigint, net_a_payer bigint,
  tva_par_taux jsonb,
  copie jsonb,                                 -- ce qui a servi à la calculer (R7)
  chaine_rang bigint,
  empreinte text,
  emise_le timestamptz,
  emise_par uuid references socle.utilisateur(id),
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  revision bigint not null default 1,
  check (devise = 'TND' or cours is not null),
  -- Émise : tout ce qui fait la pièce est là ; brouillon : rien de ce qui naît à l'émission.
  check ((statut = 'emise') = (numero is not null and emise_le is not null and copie is not null and empreinte is not null and net_a_payer is not null)),
  -- Le numéro repart à 1 chaque année : c'est le numéro ÉCRIT (avec son année) qui est unique.
  unique (serie, numero_texte)
);
create index piece_entreprise on ventes.piece (entreprise, type, date_piece);
alter table ventes.piece enable row level security;
alter table ventes.piece force row level security;
create policy visible on ventes.piece using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on ventes.piece to skanfact_app;

create table ventes.ligne (
  id uuid primary key default socle.uuidv7(),
  piece uuid not null references ventes.piece(id) on delete cascade,
  entreprise uuid not null references socle.entreprise(id),
  rang int not null check (rang >= 1),
  designation text not null check (length(trim(designation)) > 0),
  description text,
  quantite bigint not null,                    -- en millièmes
  prix_unitaire bigint not null,               -- à six décimales
  taux_tva bigint not null check (taux_tva between 0 and 1000000),
  sans_remise boolean not null default false,
  ht bigint, tva bigint, ttc bigint,           -- posés à l'émission
  unique (piece, rang)
);
alter table ventes.ligne enable row level security;
alter table ventes.ligne force row level security;
create policy visible on ventes.ligne using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on ventes.ligne to skanfact_app;

-- Une ligne appartient à la même entreprise que sa pièce (01 R14).
create function ventes.ligne_de_sa_piece() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from ventes.piece p where p.id = new.piece and p.entreprise = new.entreprise) then
    raise exception 'une ligne appartient à l''entreprise de sa pièce' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ligne_de_sa_piece before insert or update on ventes.ligne
  for each row execute function ventes.ligne_de_sa_piece();

-- Un tiers d'une pièce appartient à la même entreprise.
create function ventes.tiers_de_l_entreprise() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from socle.tiers t where t.id = new.tiers and t.entreprise = new.entreprise) then
    raise exception 'le client appartient à l''entreprise de la pièce' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tiers_de_l_entreprise before insert or update on ventes.piece
  for each row execute function ventes.tiers_de_l_entreprise();

-- ── Le scellé (R6) ───────────────────────────────────────────────────────────────────────────────
-- Une pièce émise ne se modifie plus et ne s'efface jamais ; ses lignes non plus. Le passage de
-- brouillon à émise est le seul changement permis, une fois.
create function ventes.piece_scellee() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then raise exception 'une pièce émise ne s''efface jamais (01 R6)' using errcode = '42501'; end if;
    return old;
  end if;
  if old.statut <> 'brouillon' then
    raise exception 'une pièce émise ne se modifie plus : on la corrige par un avoir (01 R6)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger piece_scellee before update or delete on ventes.piece
  for each row execute function ventes.piece_scellee();

create function ventes.ligne_scellee() returns trigger
language plpgsql as $$
declare p uuid := coalesce(new.piece, old.piece);
begin
  -- Une ligne ne change pas de pièce ; et une pièce émise ne voit plus ses lignes changer (à
  -- l'émission, les montants des lignes se posent AVANT que la pièce passe à « émise »).
  if tg_op = 'UPDATE' and new.piece <> old.piece then
    raise exception 'une ligne ne change pas de pièce' using errcode = '42501';
  end if;
  if exists (select 1 from ventes.piece x where x.id = p and x.statut <> 'brouillon') then
    raise exception 'les lignes d''une pièce émise ne se modifient plus (01 R6)' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger ligne_scellee before insert or update or delete on ventes.ligne
  for each row execute function ventes.ligne_scellee();
