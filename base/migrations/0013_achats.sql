-- Les achats tenus par le serveur (brique 30, 29/09/2026 ; docs/achats.md) : la facture d'un
-- fournisseur, la dépense, l'avoir et l'acompte fournisseur, leurs lignes et leurs règlements.
-- L'interface v10 les saisit dans son dossier (0011) ; à chaque enregistrement, le serveur les
-- vérifie, les calcule en entiers (moteur/achats.ts) et tient ces tables au même état, dans la même
-- transaction.

create schema achats;
grant usage on schema achats to skanfact_app;

-- ── La pièce d'un fournisseur ─────────────────────────────────────────────────────────────────────
-- Son numéro est celui du FOURNISSEUR : l'entreprise ne numérote rien, rien ne se scelle ici. Un
-- achat se modifie et se supprime comme dans la v10 (D1), et chaque geste laisse sa trace.
create table achats.piece (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  -- L'identifiant que l'interface v10 a donné à la pièce : c'est par lui que le serveur la retrouve.
  ref_v10 text check (ref_v10 is null or length(ref_v10) between 1 and 200),
  nature text not null check (nature in ('facture', 'depense', 'avoir', 'acompte')),
  fournisseur uuid references socle.tiers(id),
  numero_fournisseur text check (numero_fournisseur is null or length(numero_fournisseur) <= 200),
  date_piece date not null,
  echeance date,
  devise text not null default 'TND' references socle.devise(code),
  -- « 1 unité de la devise = x dinars », à six décimales ; une pièce en devise le porte (D5).
  cours bigint check (cours > 0),
  taux_retenue bigint not null default 0 check (taux_retenue between 0 and 1000000),
  frais bigint not null default 0,             -- timbre du fournisseur, port : dans la devise de la pièce
  -- L'entreprise récupère-t-elle la TVA de cet achat ? Gardé sur la pièce (D6) : un changement de
  -- régime ne réécrit pas les achats d'avant.
  tva_recuperable boolean not null,
  -- La facture (ou la dépense) qu'un avoir ou un acompte diminue ; vide : la pièce est libre.
  lie uuid references achats.piece(id),
  objet text check (objet is null or length(objet) <= 500),
  categorie text check (categorie is null or length(categorie) <= 200),
  -- Calculés par le moteur à chaque enregistrement, dans la devise de la pièce.
  total_ht bigint not null, total_tva bigint not null, tva_deductible bigint not null,
  total_ttc bigint not null, retenue bigint not null, net_a_payer bigint not null,
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  modifie_par uuid references socle.utilisateur(id),
  modifie_le timestamptz not null default now(),
  revision bigint not null default 1,
  check (devise = 'TND' or cours is not null),
  check (lie is null or nature in ('avoir', 'acompte')),
  check (lie is null or lie <> id)
);
create unique index piece_ref_v10 on achats.piece (entreprise, ref_v10) where ref_v10 is not null;
create index piece_entreprise on achats.piece (entreprise, date_piece);
create index piece_lie on achats.piece (lie) where lie is not null;
create index piece_fournisseur on achats.piece (fournisseur) where fournisseur is not null;
alter table achats.piece enable row level security;
alter table achats.piece force row level security;
create policy visible on achats.piece using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on achats.piece to skanfact_app;

-- Le fournisseur d'un achat est un tiers de la même entreprise (01 R14) ; ce qu'un avoir ou un
-- acompte diminue est une facture ou une dépense de la même entreprise.
create function achats.piece_de_l_entreprise() returns trigger
language plpgsql as $$
begin
  if new.fournisseur is not null and not exists (
    select 1 from socle.tiers t where t.id = new.fournisseur and t.entreprise = new.entreprise
  ) then
    raise exception 'le fournisseur appartient à l''entreprise de l''achat' using errcode = '42501';
  end if;
  if new.lie is not null and not exists (
    select 1 from achats.piece f where f.id = new.lie and f.entreprise = new.entreprise and f.nature in ('facture', 'depense')
  ) then
    raise exception 'un avoir ou un acompte se rattache à une facture ou une dépense de son entreprise' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger piece_de_l_entreprise before insert or update on achats.piece
  for each row execute function achats.piece_de_l_entreprise();

-- ── Les lignes ───────────────────────────────────────────────────────────────────────────────────
create table achats.ligne (
  id uuid primary key default socle.uuidv7(),
  piece uuid not null references achats.piece(id) on delete cascade,
  entreprise uuid not null references socle.entreprise(id),
  rang int not null check (rang >= 1),
  designation text not null check (length(trim(designation)) > 0),
  quantite bigint not null,                    -- en millièmes
  prix_unitaire bigint not null,               -- à six décimales, dans la devise de la pièce
  taux_tva bigint not null check (taux_tva between 0 and 1000000),
  destination text not null default 'charge' check (destination in ('charge', 'stock', 'immobilisation')),
  -- TVA non déductible (voiture de tourisme, réception…) : elle entre dans le coût. À VÉRIFIER.
  non_deductible boolean not null default false,
  ht bigint not null, tva bigint not null, ttc bigint not null,
  unique (piece, rang)
);
alter table achats.ligne enable row level security;
alter table achats.ligne force row level security;
create policy visible on achats.ligne using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on achats.ligne to skanfact_app;

create function achats.ligne_de_sa_piece() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.piece <> old.piece then
    raise exception 'une ligne ne change pas de pièce' using errcode = '42501';
  end if;
  if not exists (select 1 from achats.piece p where p.id = new.piece and p.entreprise = new.entreprise) then
    raise exception 'une ligne appartient à l''entreprise de sa pièce' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ligne_de_sa_piece before insert or update on achats.ligne
  for each row execute function achats.ligne_de_sa_piece();

-- ── Les règlements d'un achat ────────────────────────────────────────────────────────────────────
-- Le jumeau de ventes.reglement (0012). Sur une facture ou une dépense, ce que l'entreprise verse
-- (négatif : un trop-payé que le fournisseur rend) ; sur un avoir, ce que le fournisseur rembourse ;
-- sur un acompte, l'avance versée.
create table achats.reglement (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  piece uuid not null references achats.piece(id),
  ref_v10 text check (ref_v10 is null or length(ref_v10) between 1 and 200),
  -- Sa place parmi les règlements de la pièce : le même jour, la retenue se répartit dans l'ordre
  -- où ils ont été saisis (moteur/reglements.ts).
  rang int not null check (rang >= 0),
  date_reglement date not null,
  -- Dans la devise de la PIÈCE, en entier dans son unité (millimes, centimes). Jamais nul.
  montant bigint not null check (montant <> 0),
  cours bigint check (cours > 0),              -- le cours du jour (six décimales), s'il diffère de la pièce
  mode text not null check (length(mode) between 1 and 40),
  compte text check (compte is null or length(compte) <= 200),
  reference text check (reference is null or length(reference) <= 200),
  note text check (note is null or length(note) <= 1000),
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  modifie_par uuid references socle.utilisateur(id),
  modifie_le timestamptz not null default now(),
  revision bigint not null default 1
);
create unique index reglement_ref_v10 on achats.reglement (entreprise, ref_v10) where ref_v10 is not null;
create index reglement_piece on achats.reglement (piece, date_reglement);
alter table achats.reglement enable row level security;
alter table achats.reglement force row level security;
create policy visible on achats.reglement using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on achats.reglement to skanfact_app;

create function achats.reglement_de_sa_piece() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.piece <> old.piece then
    raise exception 'un règlement ne change pas de pièce' using errcode = '42501';
  end if;
  if not exists (select 1 from achats.piece p where p.id = new.piece and p.entreprise = new.entreprise) then
    raise exception 'un règlement porte sur un achat de son entreprise' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger reglement_de_sa_piece before insert or update on achats.reglement
  for each row execute function achats.reglement_de_sa_piece();
