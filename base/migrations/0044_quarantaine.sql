-- La quarantaine (brique 74 bis ; docs/hors-ligne.md, H10 ; 04 § 7). Un appareil retiré (perdu, volé,
-- rendu) qui avait des changements faits hors ligne les REMET au serveur à sa reconnexion, avant
-- d'effacer ce qu'il garde : ils sont reçus, jamais appliqués d'office. Le propriétaire (ou un
-- administrateur) les voit et décide : les accepter (ils s'appliquent, sauf ce qui a changé depuis ou
-- que le serveur refuse : mis de côté, et dit) ou les rejeter. Rien n'est perdu (la remise reste,
-- décidée ou non), rien n'est cru sur parole (les ventes d'une caisse retirée par erreur, ou ce
-- qu'a fait un voleur).

create table socle.quarantaine (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  -- La session de l'appareil retiré qui l'a remise : une seule remise par session et par entreprise.
  -- (Un simple repère : une session ne part jamais avec l'entreprise, base/entreprise.ts.)
  session uuid not null,
  appareil uuid not null references socle.appareil(id),
  -- Son nom au moment de la remise (le propriétaire ne voit pas les appareils des autres).
  appareil_nom text not null,
  utilisateur uuid not null references socle.utilisateur(id),
  recue_le timestamptz not null,
  -- Les changements tels que le poste les aurait envoyés (objet, révision vue, contenu), en entiers.
  changements jsonb not null check (jsonb_typeof(changements) = 'array' and socle.sans_virgule(changements)),
  decision text check (decision in ('acceptee', 'rejetee')),
  decidee_le timestamptz,
  decidee_par uuid references socle.utilisateur(id),
  -- À l'acceptation : ce qui n'a pas pu s'appliquer, et pourquoi (changé depuis, ou refusé).
  mis_de_cote jsonb,
  unique (session, entreprise),
  check ((decision is null) = (decidee_le is null) and (decision is null) = (decidee_par is null))
);
create index quarantaine_a_decider on socle.quarantaine (entreprise, recue_le) where decision is null;
alter table socle.quarantaine enable row level security;
alter table socle.quarantaine force row level security;
create policy visible on socle.quarantaine using (entreprise in (select socle.mes_entreprises()));
grant select, update on socle.quarantaine to skanfact_app;

-- Une remise reçue ne se réécrit pas : seule sa décision s'ajoute, une fois.
create function socle.quarantaine_intouchable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.decision is null and new.decision is not null
     and (to_jsonb(new) - 'decision' - 'decidee_le' - 'decidee_par' - 'mis_de_cote') = (to_jsonb(old) - 'decision' - 'decidee_le' - 'decidee_par' - 'mis_de_cote') then
    return new;
  end if;
  raise exception 'une remise en quarantaine ne se modifie pas et ne s''efface pas' using errcode = '42501';
end $$;
create trigger quarantaine_intouchable before update or delete on socle.quarantaine
  for each row execute function socle.quarantaine_intouchable();

-- Remettre ce qui attendait le réseau, par le jeton de l'appareil retiré (le serveur seul le demande,
-- par l'empreinte du jeton présenté). Seule une session encore ouverte quand l'appareil a été retiré
-- remet (une session fermée avant n'avait plus rien à envoyer), et seulement dans une entreprise dont
-- la personne est membre. Rend le nombre de changements reçus que la personne a faits (les pièces et
-- les fiches : les réglages du dossier qui changent avec elles ne se comptent pas, H6), ou null (rien
-- n'est reçu).
-- Les changements qu'une personne a faits : ni les réglages du dossier (« _racine »).
create function socle.changements_faits(p jsonb) returns integer
language sql immutable as $$
  select count(*)::integer from jsonb_array_elements(p) e where e->>'collection' is distinct from '_racine'
$$;

create function socle.mettre_en_quarantaine(p_jeton_empreinte text, p_entreprise uuid, p_changements jsonb, p_maintenant timestamptz)
returns integer
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare s record;
begin
  select se.id, se.utilisateur, se.appareil, a.nom into s
    from socle.session se join socle.appareil a on a.id = se.appareil
   where se.jeton_empreinte = p_jeton_empreinte and a.revoque_le is not null and se.fermee_le = a.revoque_le;
  if not found then return null; end if;
  if not exists (select 1 from socle.membre m where m.utilisateur = s.utilisateur and m.entreprise = p_entreprise) then return null; end if;
  insert into socle.quarantaine (entreprise, session, appareil, appareil_nom, utilisateur, recue_le, changements)
    values (p_entreprise, s.id, s.appareil, s.nom, s.utilisateur, p_maintenant, p_changements)
    on conflict (session, entreprise) do nothing;
  return socle.changements_faits(p_changements);
end $$;
revoke execute on function socle.mettre_en_quarantaine(text, uuid, jsonb, timestamptz) from public;
grant execute on function socle.mettre_en_quarantaine(text, uuid, jsonb, timestamptz) to skanfact_app;

-- Combien cette session d'un appareil retiré a-t-elle remis ? L'entrée le dit à la personne.
create function socle.remis_par_ce_jeton(p_jeton_empreinte text) returns integer
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce(sum(socle.changements_faits(q.changements)), 0)::integer
    from socle.quarantaine q join socle.session s on s.id = q.session
   where s.jeton_empreinte = p_jeton_empreinte
$$;
revoke execute on function socle.remis_par_ce_jeton(text) from public;
grant execute on function socle.remis_par_ce_jeton(text) to skanfact_app;
