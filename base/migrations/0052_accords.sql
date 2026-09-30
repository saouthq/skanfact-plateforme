-- L'accord d'un responsable (brique 98 ; 03 D11 ; 14 § 3.2 : « Encours autorisé par client : au-delà, SkanFact
-- avertit ou demande l'accord d'un responsable » ; docs/accords.md). Quand l'entreprise le demande, une facture
-- qui ferait dépasser l'encours autorisé de son client ne s'émet par un commercial qu'avec l'accord du
-- propriétaire ou d'un administrateur. L'accord se demande, se donne ou se refuse ; il garde sa trace (qui a
-- demandé, qui a décidé, quand, pourquoi), et la pièce émise porte les deux noms.

-- 1. Les demandes. Une demande naît en attente, par la personne qui la fait ; seul un responsable (propriétaire,
--    administrateur) la décide, et jamais la sienne ; une demande décidée ne change plus.
create table ventes.accord (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  geste text not null check (geste in ('encours')),
  -- La pièce du dossier (sa clé) et son client (sa clé) : le brouillon qu'on voudrait émettre.
  piece_v10 text not null check (length(piece_v10) between 1 and 200),
  client_v10 text not null check (length(client_v10) between 1 and 200),
  -- En millimes, dans la devise de l'entreprise : la pièce, l'encours sans elle, le plafond du client.
  montant bigint not null check (montant > 0),
  encours bigint not null,
  plafond bigint not null check (plafond > 0),
  demande_par uuid not null references socle.utilisateur(id),
  demande_le timestamptz not null default now(),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'accorde', 'refuse')),
  decide_par uuid references socle.utilisateur(id),
  decide_le timestamptz,
  motif text check (motif is null or length(motif) <= 500),
  check ((statut = 'en_attente') = (decide_par is null)),
  check ((statut = 'en_attente') = (decide_le is null)),
  check (decide_par is null or decide_par <> demande_par)
);
create index accord_piece on ventes.accord (entreprise, piece_v10, demande_le);
create index accord_attente on ventes.accord (entreprise, demande_le) where statut = 'en_attente';
alter table ventes.accord enable row level security;
alter table ventes.accord force row level security;
create policy visible on ventes.accord using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update on ventes.accord to skanfact_app;

create function ventes.accord_regles() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.statut <> 'en_attente' then
      raise exception 'Une demande d''accord naît en attente.' using errcode = '42501';
    end if;
    if new.demande_par is distinct from socle.moi() then
      raise exception 'Une demande d''accord se fait en son propre nom.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.statut <> 'en_attente' then
    raise exception 'Une demande d''accord déjà décidée ne change plus.' using errcode = '42501';
  end if;
  if (new.entreprise, new.geste, new.piece_v10, new.client_v10, new.montant, new.encours, new.plafond, new.demande_par, new.demande_le)
     is distinct from (old.entreprise, old.geste, old.piece_v10, old.client_v10, old.montant, old.encours, old.plafond, old.demande_par, old.demande_le) then
    raise exception 'Une demande d''accord ne se réécrit pas : on en fait une autre.' using errcode = '42501';
  end if;
  if new.statut <> 'en_attente' then
    if new.decide_par is distinct from socle.moi() then
      raise exception 'Un accord se donne en son propre nom.' using errcode = '42501';
    end if;
    if not (socle.mes_roles(new.entreprise) && array['proprietaire', 'administrateur']) then
      raise exception 'Seul le propriétaire ou un administrateur accorde ou refuse.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger accord_regles before insert or update on ventes.accord
  for each row execute function ventes.accord_regles();

-- 2. Les seuils se règlent par un responsable (03 § 2.3, « Seuils d'accord : les régler » : P, A). Dans le dossier,
--    l'encours autorisé d'un client (`creditLimit`) et le réglage de l'entreprise (`encoursAccord`) ne changent
--    que par le propriétaire ou un administrateur ; sinon le commercial lèverait lui-même la barrière. (Sans
--    personne connectée — une restauration — rien n'est vérifié ici : la restauration a ses propres règles.)
create function socle.dossier_v10_seuils() returns trigger
language plpgsql as $$
declare
  champ text;
  avant jsonb;
  apres jsonb;
begin
  if new.collection = 'clients' then champ := 'creditLimit';
  elsif new.collection = '_racine' and new.cle = 'company' then champ := 'encoursAccord';
  else return new;
  end if;
  apres := new.contenu -> champ;
  avant := case when tg_op = 'UPDATE' then old.contenu -> champ else null end;
  -- Absent, vide, zéro ou faux : « pas de seuil » ; c'est la valeur qui ne change rien (03 D11).
  if coalesce(apres, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '0'::jsonb, 'false'::jsonb) then apres := null; end if;
  if coalesce(avant, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '0'::jsonb, 'false'::jsonb) then avant := null; end if;
  if apres is distinct from avant and socle.moi() is not null
     and not (socle.mes_roles(new.entreprise) && array['proprietaire', 'administrateur']) then
    if champ = 'creditLimit' then
      raise exception 'L''encours autorisé d''un client se règle par le propriétaire ou un administrateur.' using errcode = '42501';
    end if;
    raise exception 'L''accord au-delà de l''encours se règle par le propriétaire ou un administrateur.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger dossier_v10_seuils before insert or update on socle.dossier_v10
  for each row execute function socle.dossier_v10_seuils();
