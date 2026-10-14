-- 0104 — L'essai, la grâce et les relances se règlent dans la console (Réglages ; docs/abonnement.md C15 ; skanfact
-- docs/cadrage/07-offres-et-prix.md « Tout se règle depuis la console », décidé par Skander le 14/10/2026).
--
-- Jusqu'ici, trente jours d'essai, sept jours de grâce et les relances à quinze jours, sept jours et la veille de
-- l'échéance s'écrivaient dans le code (serveur/abonnement/etat.ts) et dans une migration (0082). Ce sont maintenant des
-- règles datées de plateforme.regle_abonnement (0103), que la direction pose avec leur motif et leur ligne au journal :
--   - l'ESSAI d'une entreprise se fixe à sa création, par la règle de ce jour-là : une règle changée ne touche jamais un
--     essai commencé ;
--   - la GRÂCE d'une échéance est celle de la règle en vigueur le lendemain de l'échéance, son premier jour : une règle
--     changée ne touche jamais une grâce commencée ;
--   - les RELANCES qui partent un jour sont celles de la règle de ce jour-là.
-- Une règle posée vaut à partir du jour où elle est posée ; la dernière posée un même jour l'emporte (regle_du_jour).

-- ── 1. Trois règles de plus ──────────────────────────────────────────────────────────────────────────────────────────
alter table plateforme.regle_abonnement drop constraint regle_abonnement_code_check;
alter table plateforme.regle_abonnement add constraint regle_abonnement_code_check check (code in ('preavis_prix', 'essai', 'grace', 'relances'));
alter table plateforme.regle_abonnement add constraint regle_abonnement_une_valeur check (code not in ('essai', 'grace') or cardinality(jours) = 1);

-- Les règles de départ, celles du cadrage (07, 27/09/2026) : elles valent depuis toujours, pour que toute échéance
-- passée ait la sienne.
insert into plateforme.regle_abonnement (code, jours, a_partir_du, motif) values
  ('essai', '{30}', '2000-01-01', 'Cadrage 07 (27/09/2026) : trente jours d''essai, tout ouvert, sans carte'),
  ('grace', '{7}', '2000-01-01', 'Cadrage 07 (27/09/2026) : sept jours de grâce après l''échéance, où tout marche encore'),
  ('relances', '{15,7,1}', '2000-01-01', 'Cadrage 07 (27/09/2026) : quinze jours, sept jours et la veille de l''échéance');

-- Une relance se nomme par ses jours avant l'échéance (« j15 », « j3 ») : les règles en posent d'autres que 15, 7 et 1.
alter table plateforme.relance_abonnement drop constraint relance_abonnement_rang_check;
alter table plateforme.relance_abonnement add constraint relance_abonnement_rang_check check (rang = 'lecture_seule' or rang ~ '^j[1-9][0-9]?$');

-- ── 2. Leur histoire, que l'état d'un abonnement lit (serveur/abonnement/etat.ts) ─────────────────────────────────────
-- La grâce et les relances, chacune de la plus ancienne à la plus récente : le serveur prend, pour un jour donné, la
-- dernière qui vaut ce jour-là. Ni le motif ni qui l'a posée : ce sont des notes de SkanFact.
create function plateforme.regles_abonnement_histoire() returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'grace', (select coalesce(jsonb_agg(jsonb_build_object('aPartirDu', r.a_partir_du, 'jours', to_jsonb(r.jours)) order by r.a_partir_du, r.le, r.id), '[]'::jsonb)
                from plateforme.regle_abonnement r where r.code = 'grace'),
    'relances', (select coalesce(jsonb_agg(jsonb_build_object('aPartirDu', r.a_partir_du, 'jours', to_jsonb(r.jours)) order by r.a_partir_du, r.le, r.id), '[]'::jsonb)
                   from plateforme.regle_abonnement r where r.code = 'relances'))
$$;

-- ── 3. L'essai naît avec l'entreprise, à la règle de son premier jour ─────────────────────────────────────────────────
create or replace function plateforme.ouvrir_essai() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, plateforme as $$
declare
  v_jour date := (now() at time zone new.fuseau)::date;
  v_jusqu_au date := v_jour + (plateforme.regle_du_jour('essai', v_jour))[1];
begin
  insert into plateforme.abonnement (entreprise, essai_jusqu_au) values (new.id, v_jusqu_au);
  insert into plateforme.evenement_abonnement (entreprise, nature, par, apres)
    values (new.id, 'essai_commence', 'systeme', jsonb_build_object('essaiJusquAu', v_jusqu_au));
  return new;
end $$;

-- ── 4. Les faits que l'état lit portent les règles ────────────────────────────────────────────────────────────────────
create or replace function plateforme.faits_abonnement(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'connu', a.entreprise is not null,
    'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le, 'offert', coalesce(a.offert, false),
    'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null, 'modules', coalesce(to_jsonb(a.modules), '[]'::jsonb),
    'regles', plateforme.regles_abonnement_histoire())
    from socle.entreprise e left join plateforme.abonnement a on a.entreprise = e.id
   where e.id = p_entreprise and e.id in (select socle.mes_entreprises())
$$;

-- Les relances à examiner : les échéances qui tombent d'ici la plus lointaine relance du jour, ou dont la grâce vient de
-- finir (la relance de la lecture seule part son premier jour). Le serveur décide ; ici, on ne fait que choisir.
create or replace function plateforme.relances_a_examiner(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'entreprise', a.entreprise,
    'faits', jsonb_build_object('connu', true, 'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au, 'offre', a.offre,
      'periodicite', a.periodicite, 'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le, 'offert', a.offert,
      'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null, 'regles', plateforme.regles_abonnement_histoire()),
    'parties', (select coalesce(jsonb_agg(jsonb_build_object('echeance', r.echeance, 'rang', r.rang)), '[]'::jsonb)
                  from plateforme.relance_abonnement r where r.entreprise = a.entreprise),
    'adresses', (select coalesce(jsonb_agg(distinct u.email), '[]'::jsonb) from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                  where m.entreprise = a.entreprise and m.actif and m.roles && array['proprietaire', 'administrateur']))), '[]'::jsonb)
    from plateforme.abonnement a join socle.entreprise e on e.id = a.entreprise
    cross join lateral (select greatest(a.essai_jusqu_au, coalesce(a.paye_jusqu_au, a.essai_jusqu_au)) echeance) x
   where e.active
     and x.echeance >= p_jour - (coalesce((plateforme.regle_du_jour('grace', x.echeance + 1))[1], 0) + 1)
     and x.echeance <= p_jour + coalesce((select max(j) from unnest(plateforme.regle_du_jour('relances', p_jour)) j), 0)
$$;

-- ── 5. Changer une règle : la direction, avec son motif ; elle vaut dès aujourd'hui ───────────────────────────────────
-- Les jours d'une règle à plusieurs valeurs (les relances) se rangent du plus loin au plus près de l'échéance.
create function plateforme.console_regler_abonnement(p_code text, p_jours integer[], p_motif text, p_maintenant timestamptz, p_jour date)
  returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_jours integer[];
  v_avant integer[];
begin
  if p_code is null or p_code not in ('essai', 'grace', 'relances') then perform socle.refus('cette règle de l''abonnement ne se règle pas ici'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('changer une règle de l''abonnement demande son motif (trois caractères au moins)'); end if;
  if p_jours is null or array_position(p_jours, null) is not null then perform socle.refus('une règle de l''abonnement se compte en jours'); end if;
  select array_agg(distinct j order by j desc) into v_jours from unnest(p_jours) j;
  if p_code = 'essai' and (cardinality(p_jours) <> 1 or p_jours[1] < 7 or p_jours[1] > 90) then
    perform socle.refus('l''essai dure de 7 à 90 jours');
  end if;
  if p_code = 'grace' and (cardinality(p_jours) <> 1 or p_jours[1] < 0 or p_jours[1] > 30) then
    perform socle.refus('la grâce compte de 0 à 30 jours');
  end if;
  if p_code = 'relances' and (cardinality(p_jours) not between 1 and 5 or cardinality(v_jours) <> cardinality(p_jours)
      or v_jours[cardinality(v_jours)] < 1 or v_jours[1] > 60) then
    perform socle.refus('les relances partent de 1 à 60 jours avant l''échéance : une à cinq, chacune un jour différent');
  end if;
  v_avant := plateforme.regle_du_jour(p_code, p_jour);
  if v_avant = v_jours then perform socle.refus('c''est déjà la règle en vigueur : rien ne changerait'); end if;
  insert into plateforme.regle_abonnement (code, jours, a_partir_du, motif, qui, le)
    values (p_code, v_jours, p_jour, btrim(p_motif), socle.moi(), p_maintenant);
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.regle_abonnement', btrim(p_motif),
            jsonb_build_object('code', p_code, 'jours', to_jsonb(v_avant)), jsonb_build_object('code', p_code, 'jours', to_jsonb(v_jours)));
end $$;

-- ── 6. Ce que la console lit : chaque règle du jour, qui l'a posée et pourquoi ────────────────────────────────────────
create function plateforme.console_regles_abonnement(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return (select coalesce(jsonb_object_agg(c.code, (
      select jsonb_build_object('jours', to_jsonb(r.jours), 'aPartirDu', r.a_partir_du, 'motif', r.motif, 'par', u.nom, 'le', r.le)
        from plateforme.regle_abonnement r left join socle.utilisateur u on u.id = r.qui
       where r.code = c.code and r.a_partir_du <= p_jour order by r.a_partir_du desc, r.le desc, r.id desc limit 1)), '{}'::jsonb)
    from unnest(array['essai', 'grace', 'relances']) c(code));
end $$;

revoke execute on function plateforme.regles_abonnement_histoire(),
  plateforme.console_regler_abonnement(text, integer[], text, timestamptz, date), plateforme.console_regles_abonnement(date) from public;
grant execute on function plateforme.regles_abonnement_histoire(),
  plateforme.console_regler_abonnement(text, integer[], text, timestamptz, date), plateforme.console_regles_abonnement(date) to skanfact_app;
