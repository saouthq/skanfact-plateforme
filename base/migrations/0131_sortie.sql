-- 0131 : la sortie d'un client et la conservation de ses données (1.38.0 ; la liste des fonctions qui manquent, 8 et
-- 33 ; docs/console.md C54). Un client s'en va : la console suit sa sortie comme une procédure, de son ouverture à sa
-- clôture, et la fiche dit à chaque instant ce qui reste à faire :
--   1. le contrat : son abonnement ne se renouvelle plus (résilié, suspendu, ou une échéance passée sans paiement ; un
--      abonnement offert, jamais) ; il va au bout de ce qui est payé, puis l'entreprise passe en lecture seule ;
--   2. ses données remises : c'est LUI qui les télécharge (Réglages › Données › Toutes les données de l'entreprise) ;
--      la console lit seulement la trace de ce téléchargement dans son journal (socle.export_complet), jamais le fichier.
--      Personne chez SkanFact n'en fait une copie pour lui ;
--   3. le remboursement : rien à rendre, ou rendu (la référence de l'avoir ou du virement, fait dans l'application de
--      SkanFact) ; la direction seule, c'est de l'argent ;
--   4. la conservation : ses données restent sur nos serveurs, en lecture seule, jusqu'au dernier jour de son contrat
--      plus dix ans (À VÉRIFIER : la durée que la loi impose ; un livre et ses pièces se gardent dix ans). Rien ne
--      s'efface avant sans sa demande écrite ; l'effacement au terme est une opération de l'exploitation, hors de la
--      console (À DÉCIDER : sa procédure).
-- La sortie se clôt de deux façons : le client est parti (le contrat arrêté et le remboursement réglé), ou il reste
-- (il s'est ravisé). La direction seule ouvre, règle et clôt. Chaque geste entre au journal de la console ; rien ne
-- s'écrit dans le dossier du client.

create table plateforme.sortie (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  -- Pourquoi il s'en va, dans une liste courte (ce que la mesure des départs comptera), et dans ses mots.
  cause text not null check (cause in ('prix', 'manque', 'fermeture', 'concurrent', 'autre')),
  dit text not null check (length(btrim(dit)) between 3 and 1000),
  ouverte_le timestamptz not null,
  ouverte_par uuid not null references socle.utilisateur(id),
  -- Le remboursement : rien à rendre, ou rendu avec sa référence.
  remboursement text check (remboursement in ('aucun', 'fait')),
  remboursement_reference text check (remboursement_reference is null or length(btrim(remboursement_reference)) between 1 and 60),
  remboursement_le timestamptz,
  remboursement_par uuid references socle.utilisateur(id),
  -- La clôture ; « partie » garde une copie du dernier jour du contrat et du terme de la conservation, tels qu'ils
  -- étaient (une pièce garde ce qui a servi à la calculer).
  close_le timestamptz,
  close_par uuid references socle.utilisateur(id),
  issue text check (issue in ('partie', 'reste')),
  close_motif text,
  fin_contrat date,
  conserver_jusqu_au date,
  check ((remboursement is null) = (remboursement_le is null) and (remboursement_le is null) = (remboursement_par is null)),
  check ((remboursement = 'fait') = (remboursement_reference is not null)),
  check ((close_le is null) = (close_par is null) and (close_le is null) = (issue is null) and (close_le is null) = (close_motif is null)),
  check ((issue = 'partie') = (fin_contrat is not null) and (fin_contrat is null) = (conserver_jusqu_au is null)),
  check (issue is distinct from 'partie' or remboursement is not null)
);
-- Une seule sortie en cours par entreprise.
create unique index sortie_en_cours on plateforme.sortie (entreprise) where close_le is null;
alter table plateforme.sortie enable row level security;
alter table plateforme.sortie force row level security;

-- La durée de la conservation, une seule fois (À VÉRIFIER).
create function plateforme.sortie_conservation() returns interval
language sql immutable as $$ select interval '10 years' $$;

-- Le contrat d'une entreprise, du point de vue d'une sortie : s'arrête-t-il, et son dernier jour (celui que payé ou
-- l'essai couvre ; une suspension l'avance à la veille).
create function plateforme.sortie_contrat(p_entreprise uuid, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select case when a.entreprise is null then jsonb_build_object('arrete', false, 'fin', null, 'offert', false)
    else jsonb_build_object(
      'arrete', not a.offert and (a.resilie_le is not null or a.suspendu_le is not null or a.paye_jusqu_au is null
                                  or a.paye_jusqu_au < p_jour),
      'fin', case when a.offert then null
                  when a.suspendu_le is not null then least(a.suspendu_le - 1, coalesce(a.paye_jusqu_au, a.essai_jusqu_au))
                  else coalesce(a.paye_jusqu_au, a.essai_jusqu_au) end,
      'offert', a.offert, 'resilie', a.resilie_le is not null, 'suspendu', a.suspendu_le is not null) end
    from (select p_entreprise e) x left join plateforme.abonnement a on a.entreprise = x.e
$$;
revoke execute on function plateforme.sortie_contrat(uuid, date) from public;

create function plateforme.sortie_lue(s plateforme.sortie, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'id', s.id, 'cause', s.cause, 'dit', s.dit, 'ouverteLe', s.ouverte_le,
    'ouvertePar', (select u.nom from socle.utilisateur u where u.id = s.ouverte_par),
    'contrat', c.v,
    -- Le dernier téléchargement de toutes ses données, par qui (la trace de son journal ; jamais le fichier).
    'export', (select jsonb_build_object('le', a.instant, 'par', (select u.nom from socle.utilisateur u where u.id = a.utilisateur))
                 from socle.audit a where a.entreprise = s.entreprise and a.geste = 'socle.export_complet'
                order by a.instant desc limit 1),
    'remboursement', case when s.remboursement is null then null else jsonb_build_object('sorte', s.remboursement,
                       'reference', s.remboursement_reference, 'le', s.remboursement_le,
                       'par', (select u.nom from socle.utilisateur u where u.id = s.remboursement_par)) end,
    -- La conservation : la copie gardée à la clôture, sinon le terme d'aujourd'hui (le contrat peut encore bouger).
    'conserverJusquAu', coalesce(s.conserver_jusqu_au, ((c.v->>'fin')::date + plateforme.sortie_conservation())::date),
    'close', case when s.close_le is null then null else jsonb_build_object('le', s.close_le, 'issue', s.issue, 'motif', s.close_motif,
               'par', (select u.nom from socle.utilisateur u where u.id = s.close_par), 'finContrat', s.fin_contrat) end)
  from (select plateforme.sortie_contrat(s.entreprise, p_jour) v) c
$$;
revoke execute on function plateforme.sortie_lue(plateforme.sortie, date) from public;

-- Ce que la fiche lit : la sortie en cours, sinon la dernière, sinon rien.
create function plateforme.console_sortie(p_entreprise uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare s plateforme.sortie;
begin
  perform plateforme.exiger_role_console(array['direction']);
  select * into s from plateforme.sortie where entreprise = p_entreprise order by (close_le is null) desc, ouverte_le desc limit 1;
  if not found then return null; end if;
  return plateforme.sortie_lue(s, p_jour);
end $$;

-- Les sorties en cours, pour « À décider » : chacune avec son entreprise.
create function plateforme.console_sorties(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return (select coalesce(jsonb_agg(plateforme.sortie_lue(s, p_jour) || jsonb_build_object('entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale))
                                    order by s.ouverte_le), '[]'::jsonb)
            from plateforme.sortie s join socle.entreprise e on e.id = s.entreprise where s.close_le is null);
end $$;

-- Ouvrir la sortie d'un client : pourquoi il s'en va.
create function plateforme.console_ouvrir_sortie(p_entreprise uuid, p_cause text, p_dit text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_nom text; v_id uuid;
begin
  if p_cause is null or p_cause not in ('prix', 'manque', 'fermeture', 'concurrent', 'autre') then
    perform socle.refus('pourquoi il s''en va : le prix, une fonction qui manque, son activité qui ferme, un concurrent, ou autre');
  end if;
  if length(btrim(coalesce(p_dit, ''))) not between 3 and 1000 then
    perform socle.refus('ce que le client dit de son départ : de trois à mille caractères');
  end if;
  select raison_sociale into v_nom from socle.entreprise where id = p_entreprise for update;
  if not found then perform socle.refus('cette entreprise n''existe pas'); end if;
  if exists (select 1 from plateforme.sortie where entreprise = p_entreprise and close_le is null) then
    perform socle.refus('la sortie de ce client est déjà ouverte : elle se suit sur sa fiche');
  end if;
  insert into plateforme.sortie (entreprise, cause, dit, ouverte_le, ouverte_par)
    values (p_entreprise, p_cause, btrim(p_dit), p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.sortie_ouverte', p_entreprise, btrim(p_dit), null, jsonb_build_object('cause', p_cause));
  return v_id;
end $$;

-- Régler le remboursement : rien à rendre, ou rendu (sa référence).
create function plateforme.console_sortie_remboursement(p_sortie uuid, p_remboursement text, p_reference text, p_motif text, p_maintenant timestamptz)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  s plateforme.sortie; v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_remboursement is null or p_remboursement not in ('aucun', 'fait') then
    perform socle.refus('le remboursement d''une sortie : rien à rendre, ou rendu');
  end if;
  if p_remboursement = 'fait' and v_ref is null then
    perform socle.refus('un remboursement se retrouve par sa référence : le numéro de l''avoir, la référence du virement');
  end if;
  if v_ref is not null and length(v_ref) > 60 then perform socle.refus('la référence d''un remboursement : soixante caractères au plus'); end if;
  select * into s from plateforme.sortie where id = p_sortie for update;
  if not found then perform socle.refus('cette sortie n''existe pas'); end if;
  if s.close_le is not null then perform socle.refus('cette sortie est close'); end if;
  update plateforme.sortie
     set remboursement = p_remboursement, remboursement_reference = case when p_remboursement = 'fait' then v_ref end,
         remboursement_le = p_maintenant, remboursement_par = socle.moi()
   where id = s.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.sortie_remboursement', s.entreprise, btrim(p_motif),
            case when s.remboursement is null then null else jsonb_build_object('remboursement', s.remboursement, 'reference', s.remboursement_reference) end,
            jsonb_build_object('remboursement', p_remboursement, 'reference', case when p_remboursement = 'fait' then v_ref end));
end $$;

-- La clore : il est parti (le contrat arrêté, le remboursement réglé), ou il reste.
create function plateforme.console_clore_sortie(p_sortie uuid, p_issue text, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  s plateforme.sortie; v_contrat jsonb; v_fin date;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_issue is null or p_issue not in ('partie', 'reste') then
    perform socle.refus('une sortie se clôt de deux façons : le client est parti, ou il reste');
  end if;
  select * into s from plateforme.sortie where id = p_sortie for update;
  if not found then perform socle.refus('cette sortie n''existe pas'); end if;
  if s.close_le is not null then perform socle.refus('cette sortie est close'); end if;
  -- Le contrat, lu sous verrou : un paiement concurrent qui le prolonge attend la fin de ce geste.
  perform 1 from plateforme.abonnement where entreprise = s.entreprise for update;
  v_contrat := plateforme.sortie_contrat(s.entreprise, (p_maintenant at time zone 'Africa/Tunis')::date);
  v_fin := (v_contrat->>'fin')::date;
  if p_issue = 'partie' then
    if not (v_contrat->>'arrete')::boolean or v_fin is null then
      perform socle.refus('son abonnement se renouvelle encore : résilie-le d''abord, il ira au bout de ce qui est payé');
    end if;
    if s.remboursement is null then
      perform socle.refus('le remboursement n''est pas réglé : dis s''il n''y a rien à rendre, ou la référence de ce qui a été rendu');
    end if;
  end if;
  update plateforme.sortie
     set close_le = p_maintenant, close_par = socle.moi(), issue = p_issue, close_motif = btrim(p_motif),
         fin_contrat = case when p_issue = 'partie' then v_fin end,
         conserver_jusqu_au = case when p_issue = 'partie' then (v_fin + plateforme.sortie_conservation())::date end
   where id = s.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.sortie_close', s.entreprise, btrim(p_motif), null,
            jsonb_build_object('issue', p_issue, 'finContrat', case when p_issue = 'partie' then v_fin end,
                               'conserverJusquAu', case when p_issue = 'partie' then (v_fin + plateforme.sortie_conservation())::date end));
end $$;

revoke execute on function plateforme.console_sortie(uuid, date), plateforme.console_sorties(date),
  plateforme.console_ouvrir_sortie(uuid, text, text, timestamptz), plateforme.console_sortie_remboursement(uuid, text, text, text, timestamptz),
  plateforme.console_clore_sortie(uuid, text, text, timestamptz) from public;
grant execute on function plateforme.console_sortie(uuid, date), plateforme.console_sorties(date),
  plateforme.console_ouvrir_sortie(uuid, text, text, timestamptz), plateforme.console_sortie_remboursement(uuid, text, text, text, timestamptz),
  plateforme.console_clore_sortie(uuid, text, text, timestamptz) to skanfact_app;
