-- 0235 — Le Cabinet relu (vérification complète, lot Cabinet, 25/11/2026).
--
-- 1. Une question appartient au cabinet qui l'a posée : le cabinet d'aujourd'hui n'envoie, ne réécrit, ne ferme ni ne
--    retire celles d'un cabinet d'avant (elles restent dans les livres de l'entreprise, avec leur réponse).
-- 2. Une entreprise n'a qu'un cabinet à la fois : la règle était lue sans verrou par chaque chemin qui crée un mandat
--    (proposer, rejoindre par une invitation, créer un dossier tenu). Elle se tient maintenant à l'écriture du mandat,
--    pour tous les chemins, verrou pris sur l'entreprise.
-- 3. Le cabinet garde toujours un associé : deux gestes simultanés sur l'équipe d'un même cabinet passent l'un après
--    l'autre, et le second relit l'équipe laissée par le premier.

-- 1. Les questions du cabinet d'aujourd'hui seulement.
create or replace function compta.question_du_cabinet(p_entreprise uuid, p_id uuid, p_geste text) returns compta.question
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question; v_cabinet uuid;
begin
  perform compta.exiger(p_entreprise, p_geste);
  v_cabinet := compta.mon_cabinet(p_entreprise);
  if v_cabinet is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  select * into q from compta.question where id = p_id and entreprise = p_entreprise and cabinet = v_cabinet for update;
  if not found then perform socle.refus('cette question n''existe plus'); end if;
  return q;
end $$;

create or replace function compta.envoyer_questions(p_entreprise uuid, p_annee int) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int; v_cabinet uuid;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  v_cabinet := compta.mon_cabinet(p_entreprise);
  if v_cabinet is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  update compta.question set envois = envois || now(), statut = case when statut = 'ouverte' then 'envoyee' else statut end
   where entreprise = p_entreprise and cabinet = v_cabinet and left(periode, 4) = p_annee::text and statut in ('ouverte', 'envoyee')
     and (cardinality(envois) = 0
          or (envois[cardinality(envois)] at time zone 'Africa/Tunis')::date < (now() at time zone 'Africa/Tunis')::date);
  get diagnostics n = row_count;
  if n = 0 and exists (select 1 from compta.question
                        where entreprise = p_entreprise and cabinet = v_cabinet and left(periode, 4) = p_annee::text and statut = 'envoyee') then
    perform socle.refus('les questions qui attendent sont parties aujourd''hui : une relance se fait un autre jour');
  end if;
  if n = 0 then perform socle.refus('aucune question n''attend de réponse : il n''y aurait rien à envoyer'); end if;
  perform socle.tracer(p_entreprise, 'compta.questions.envoyer', 'question', null, null, jsonb_build_object('annee', p_annee, 'envoyees', n));
  return n;
end $$;

-- 2. Un cabinet à la fois, tenu à l'écriture du mandat.
create function socle.un_cabinet_a_la_fois() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if new.statut not in ('propose', 'actif') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('socle.mandat:' || new.entreprise::text));
  if exists (select 1 from socle.mandat d where d.entreprise = new.entreprise and d.id <> new.id and d.statut in ('propose', 'actif')) then
    perform socle.refus('cette entreprise a déjà un cabinet : arrête d''abord son mandat');
  end if;
  return new;
end $$;
create trigger mandat_un_cabinet_a_la_fois before insert or update of statut, entreprise on socle.mandat
  for each row execute function socle.un_cabinet_a_la_fois();
revoke execute on function socle.un_cabinet_a_la_fois() from public;

-- 3. Les gestes sur l'équipe d'un cabinet, l'un après l'autre.
create or replace function socle.membre_du_cabinet(p_cabinet uuid, p_membre uuid) returns socle.membre
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare m socle.membre;
begin
  perform pg_advisory_xact_lock(hashtext('socle.equipe:' || p_cabinet::text));
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet change son équipe'); end if;
  select * into m from socle.membre where id = p_membre and organisation = p_cabinet and actif for update;
  if not found then perform socle.refus('cette personne n''est pas de l''équipe du cabinet'); end if;
  if m.utilisateur = socle.moi() then perform socle.refus('personne ne change son propre rôle, ni ne se retire soi-même : un autre associé le fait'); end if;
  return m;
end $$;

-- 4. La demande de pièce envoyée aussi par e-mail : qui écrit au client dans la messagerie l'envoie (la règle de la
--    messagerie, côté cabinet), une fois par jour au plus pour la même demande (un second clic ne renvoie pas le même
--    e-mail), et la trace est écrite avant que l'e-mail parte (un e-mail qui ne part pas annule la trace avec la transaction).
alter table messagerie.message add column courriel_le timestamptz,
  add constraint message_courriel check (courriel_le is null or demande is not null);

create function messagerie.noter_courriel_demande(p_entreprise uuid, p_message uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid; v_le timestamptz;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  select m.courriel_le into v_le from messagerie.message m where m.id = p_message and m.entreprise = p_entreprise and m.cabinet = v_cabinet
    and m.cote = 'cabinet' and m.demande is not null for update;
  if not found then perform socle.refus('cette demande n''existe plus'); end if;
  if v_le is not null and v_le > now() - interval '1 day' then
    perform socle.refus('cette demande est déjà partie par e-mail aujourd''hui : le client l''a reçue');
  end if;
  update messagerie.message set courriel_le = now() where id = p_message;
  perform socle.tracer(p_entreprise, 'cabinet.demande_courriel', 'message', p_message, null, null);
end $$;
revoke execute on function messagerie.noter_courriel_demande(uuid, uuid) from public;
grant execute on function messagerie.noter_courriel_demande(uuid, uuid) to skanfact_app;

-- 5. Un export du classeur fait par quelqu'un qui lit la paie, dans un dossier dont le classeur porte des bulletins, suit
--    la règle des bulletins (0187) : seul qui lit la paie de l'entreprise le liste et l'ouvre. Le serveur le marque à
--    l'enregistrement (il ne lit pas le fichier) ; les exports déjà gardés sont marqués de la même façon.
alter table cabinet.export add column paie boolean not null default false;
update cabinet.export x set paie = true
 where exists (select 1 from cabinet.document d where d.cabinet = x.cabinet and d.entreprise = x.entreprise and d.paie);
drop policy visible on cabinet.export;
create policy visible on cabinet.export
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises())
         and (not paie or entreprise in (select paie.mes_entreprises())));
