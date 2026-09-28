-- L'avoir et les règlements de vente tenus par le serveur (brique 29, 28/09/2026 ;
-- docs/avoirs-reglements.md).

-- ── L'avoir et sa facture ─────────────────────────────────────────────────────────────────────────
-- La facture qu'un avoir corrige. Posée sur le brouillon, scellée avec lui à l'émission (le scellé de
-- 0006 interdit ensuite tout changement). Seul un avoir en a une.
alter table ventes.piece add column corrige uuid references ventes.piece(id);
alter table ventes.piece add constraint corrige_seulement_avoir check (corrige is null or type = 'avoir');
create index piece_corrige on ventes.piece (corrige) where corrige is not null;

-- Ce qu'un avoir corrige est une facture de la même entreprise (01 R14).
create function ventes.avoir_de_sa_facture() returns trigger
language plpgsql as $$
begin
  if new.corrige is not null and not exists (
    select 1 from ventes.piece f where f.id = new.corrige and f.entreprise = new.entreprise and f.type = 'facture'
  ) then
    raise exception 'un avoir corrige une facture de son entreprise' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger avoir_de_sa_facture before insert or update on ventes.piece
  for each row execute function ventes.avoir_de_sa_facture();

-- ── Les règlements d'une facture ─────────────────────────────────────────────────────────────────
create table ventes.reglement (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  piece uuid not null references ventes.piece(id),
  -- L'identifiant que l'interface v10 a donné au paiement : c'est par lui que le serveur le retrouve.
  ref_v10 text check (ref_v10 is null or length(ref_v10) between 1 and 200),
  -- Sa place parmi les règlements de la facture : le même jour, la retenue se répartit dans l'ordre
  -- où ils ont été saisis (retenueChrono de la v10, moteur/reglements.ts).
  rang int not null check (rang >= 0),
  date_reglement date not null,
  -- Dans la devise de la FACTURE, en entier dans son unité (millimes, centimes) ; négatif : un
  -- remboursement. Un règlement nul n'existe pas.
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
create unique index reglement_ref_v10 on ventes.reglement (entreprise, ref_v10) where ref_v10 is not null;
create index reglement_piece on ventes.reglement (piece, date_reglement);
alter table ventes.reglement enable row level security;
alter table ventes.reglement force row level security;
create policy visible on ventes.reglement using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update, delete on ventes.reglement to skanfact_app;

-- Un règlement porte sur une FACTURE ÉMISE de sa propre entreprise, et n'en change jamais.
create function ventes.reglement_de_sa_facture() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.piece <> old.piece then
    raise exception 'un règlement ne change pas de facture' using errcode = '42501';
  end if;
  if not exists (
    select 1 from ventes.piece p where p.id = new.piece and p.entreprise = new.entreprise and p.type = 'facture' and p.statut = 'emise'
  ) then
    raise exception 'un règlement porte sur une facture émise de son entreprise' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger reglement_de_sa_facture before insert or update on ventes.reglement
  for each row execute function ventes.reglement_de_sa_facture();
