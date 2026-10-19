-- 0145 — Les travaux du service : un partenaire mis en pause, le débit heure par heure, et ce qui ne part plus depuis
-- longtemps (docs/console.md C69 ; ce qui manquait à la console avant la recette ; décidé par délégation le 19/10/2026).
--
--   - **la pause d'un partenaire** : la TTN annonce une maintenance, un incident appelle à ne pas relancer les clients.
--     La direction ou la technique met en pause ce que le serveur envoie SEUL — le dépôt à la TTN (le facteur) ou les
--     relances d'échéance — une heure, quatre heures ou un jour, avec son motif ; jamais plus (une pause oubliée ne bloque
--     rien au-delà d'un jour). Pendant la pause, rien ne part et aucun essai ne se compte ; à la reprise (son heure, ou le
--     geste « Reprendre »), tout repart au tour suivant. Ce que les clients font eux-mêmes (signer, payer, recevoir un code)
--     ne se met jamais en pause ;
--   - **le débit heure par heure** : chaque partenaire, ses vingt-quatre dernières heures, avec la même règle que ses
--     quatorze jours ;
--   - **ce qui ne part plus** : la TTN ne cesse jamais d'essayer (une pièce signée doit se déposer), mais un envoi en panne
--     depuis plus de quatre heures se dit en tête d'« À décider » du service.

create table plateforme.pause_partenaire (
  id uuid primary key default socle.uuidv7(),
  partenaire text not null check (partenaire in ('ttn', 'relances')),
  le timestamptz not null,
  jusqu_au timestamptz not null,
  motif text not null check (length(btrim(motif)) between 3 and 500),
  par uuid not null references socle.utilisateur(id),
  levee_le timestamptz,
  levee_par uuid references socle.utilisateur(id),
  levee_motif text,
  check (jusqu_au > le and jusqu_au <= le + interval '24 hours'),
  check ((levee_le is null) = (levee_par is null) and (levee_le is null) = (levee_motif is null))
);
alter table plateforme.pause_partenaire enable row level security;
alter table plateforme.pause_partenaire force row level security;

-- En pause en ce moment : jusqu'à quand (null sinon). Le serveur le demande à chaque tour.
create function plateforme.partenaire_en_pause(p_partenaire text, p_maintenant timestamptz) returns timestamptz
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select max(p.jusqu_au) from plateforme.pause_partenaire p
   where p.partenaire = p_partenaire and p.levee_le is null and p.le <= p_maintenant and p.jusqu_au > p_maintenant
$$;

create function plateforme.console_pause_partenaire(p_partenaire text, p_heures integer, p_motif text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_id uuid; v_jusqua timestamptz;
begin
  if coalesce(p_partenaire, '') not in ('ttn', 'relances') then perform socle.refus('seuls le dépôt à la TTN et les relances d''échéance se mettent en pause'); end if;
  if coalesce(p_heures, 0) not in (1, 4, 24) then perform socle.refus('une pause dure une heure, quatre heures ou un jour'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('mettre en pause dit pourquoi (trois caractères au moins) : le motif reste au journal de la console'); end if;
  perform pg_advisory_xact_lock(hashtext('plateforme.pause_partenaire:' || p_partenaire));
  if plateforme.partenaire_en_pause(p_partenaire, p_maintenant) is not null then
    perform socle.refus('ce partenaire est déjà en pause : reprends-le d''abord pour changer sa durée');
  end if;
  v_jusqua := p_maintenant + make_interval(hours => p_heures);
  insert into plateforme.pause_partenaire (partenaire, le, jusqu_au, motif, par) values (p_partenaire, p_maintenant, v_jusqua, btrim(p_motif), socle.moi())
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.partenaire_pause', btrim(p_motif), jsonb_build_object('partenaire', p_partenaire, 'heures', p_heures));
  return jsonb_build_object('id', v_id, 'jusquAu', v_jusqua);
end $$;

create function plateforme.console_reprendre_partenaire(p_id uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v plateforme.pause_partenaire;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('reprendre dit pourquoi (trois caractères au moins) : le motif reste au journal de la console'); end if;
  select * into v from plateforme.pause_partenaire where id = p_id for update;
  if not found then perform socle.refus('cette pause n''existe pas'); end if;
  if v.levee_le is not null or v.jusqu_au <= p_maintenant then perform socle.refus('ce partenaire n''est plus en pause'); end if;
  update plateforme.pause_partenaire set levee_le = p_maintenant, levee_par = socle.moi(), levee_motif = btrim(p_motif) where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.partenaire_repris', btrim(p_motif), jsonb_build_object('partenaire', v.partenaire));
end $$;

-- Les envois à la TTN en panne (ou sans réponse) depuis plus de `p_heures` heures : combien, et depuis quand le plus
-- ancien. Ni pièce ni entreprise : un nombre et un instant (le serveur, Travaux et « À décider » le lisent).
create function plateforme.envois_ttn_en_panne(p_maintenant timestamptz, p_heures integer) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes as $$
  select jsonb_build_object('n', count(*), 'depuis', min(v.cree_le))
    from ventes.envoi_ttn v join socle.entreprise e on e.id = v.entreprise
   where not e.essai and v.statut in ('a_envoyer', 'deposee') and v.essais > 0
     and v.cree_le <= p_maintenant - make_interval(hours => p_heures)
$$;
revoke execute on function plateforme.envois_ttn_en_panne(timestamptz, integer) from public;
grant execute on function plateforme.envois_ttn_en_panne(timestamptz, integer) to skanfact_app;

-- Ce que l'écran Travaux et « À décider » lisent : les pauses en cours et celles de la semaine ; le débit des
-- vingt-quatre dernières heures, heure par heure (le début de chaque heure ; les mêmes sources et les mêmes règles que
-- les quatorze jours de 0115 : une entreprise d'essai ne compte pas) ; les envois à la TTN en panne depuis plus de
-- `p_heures` heures (combien, et depuis quand le plus ancien).
create function plateforme.console_service_travaux_suite(p_maintenant timestamptz, p_heures integer) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme, ventes as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
  v_depuis timestamptz := date_trunc('hour', p_maintenant) - interval '23 hours';
begin
  return jsonb_build_object(
    'pauses', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'partenaire', p.partenaire, 'le', p.le, 'jusquAu', p.jusqu_au, 'motif', p.motif,
                 'par', (select u.nom from socle.utilisateur u where u.id = p.par), 'leveeLe', p.levee_le,
                 'enCours', p.levee_le is null and p.jusqu_au > p_maintenant) order by p.le desc), '[]'::jsonb)
                 from plateforme.pause_partenaire p where p.le >= p_maintenant - interval '7 days' or (p.levee_le is null and p.jusqu_au > p_maintenant)),
    'heures', jsonb_build_object(
      'ttn', (select coalesce(jsonb_agg(jsonb_build_object('heure', h.heure, 'n', h.n, 'bons', h.bons, 'refus', h.refus) order by h.heure), '[]'::jsonb) from (
          select date_trunc('hour', v.cree_le) heure, count(*) n, count(*) filter (where v.statut = 'acceptee') bons, count(*) filter (where v.statut = 'refusee') refus
            from ventes.envoi_ttn v join socle.entreprise e on e.id = v.entreprise where not e.essai and v.cree_le >= v_depuis group by 1) h),
      'signature', (select coalesce(jsonb_agg(jsonb_build_object('heure', h.heure, 'n', h.n, 'bons', h.bons, 'refus', h.refus) order by h.heure), '[]'::jsonb) from (
          select date_trunc('hour', s.cree_le) heure, count(*) n, count(*) filter (where s.statut = 'signee') bons, count(*) filter (where s.statut = 'echouee') refus
            from ventes.signature_demande s join socle.entreprise e on e.id = s.entreprise where not e.essai and s.cree_le >= v_depuis group by 1) h),
      'sms', (select coalesce(jsonb_agg(jsonb_build_object('heure', h.heure, 'n', h.n, 'bons', 0, 'refus', 0) order by h.heure), '[]'::jsonb) from (
          select date_trunc('hour', s.le) heure, count(*) n from socle.sms_envoye s where s.le >= v_depuis group by 1) h),
      'paiements', (select coalesce(jsonb_agg(jsonb_build_object('heure', h.heure, 'n', h.n, 'bons', h.bons, 'refus', h.refus) order by h.heure), '[]'::jsonb) from (
          select date_trunc('hour', p.cree_le) heure, count(*) n, count(*) filter (where p.statut = 'encaisse') bons, count(*) filter (where p.statut = 'echoue') refus
            from ventes.paiement_en_ligne p join socle.entreprise e on e.id = p.entreprise where not e.essai and p.cree_le >= v_depuis group by 1) h),
      'relances', (select coalesce(jsonb_agg(jsonb_build_object('heure', h.heure, 'n', h.n, 'bons', 0, 'refus', 0) order by h.heure), '[]'::jsonb) from (
          select date_trunc('hour', r.partie_le) heure, count(*) n from plateforme.relance_abonnement r where r.partie_le >= v_depuis group by 1) h),
      'courriel', (select coalesce(jsonb_agg(jsonb_build_object('heure', h.heure, 'n', h.n, 'bons', h.bons, 'refus', h.refus) order by h.heure), '[]'::jsonb) from (
          select date_trunc('hour', c.le) heure, count(*) n, count(*) filter (where c.ok) bons, count(*) filter (where not c.ok) refus
            from plateforme.courriel_trace c where c.le >= v_depuis group by 1) h)),
    'enPanne', plateforme.envois_ttn_en_panne(p_maintenant, p_heures));
end $$;

-- Ce qu'« À décider » en lit, à chaque accueil : les pauses en cours et ce qui ne part plus (sans le débit, qui coûte).
create function plateforme.console_travaux_a_decider(p_maintenant timestamptz, p_heures integer) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme, ventes as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
begin
  return jsonb_build_object(
    'pauses', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'partenaire', p.partenaire, 'le', p.le, 'jusquAu', p.jusqu_au, 'motif', p.motif,
                 'par', (select u.nom from socle.utilisateur u where u.id = p.par), 'leveeLe', p.levee_le, 'enCours', true) order by p.jusqu_au), '[]'::jsonb)
                 from plateforme.pause_partenaire p where p.levee_le is null and p.le <= p_maintenant and p.jusqu_au > p_maintenant),
    'enPanne', plateforme.envois_ttn_en_panne(p_maintenant, p_heures));
end $$;

revoke execute on function plateforme.console_travaux_a_decider(timestamptz, integer) from public;
grant execute on function plateforme.console_travaux_a_decider(timestamptz, integer) to skanfact_app;
revoke execute on function plateforme.partenaire_en_pause(text, timestamptz), plateforme.console_pause_partenaire(text, integer, text, timestamptz),
  plateforme.console_reprendre_partenaire(uuid, text, timestamptz), plateforme.console_service_travaux_suite(timestamptz, integer) from public;
grant execute on function plateforme.partenaire_en_pause(text, timestamptz), plateforme.console_pause_partenaire(text, integer, text, timestamptz),
  plateforme.console_reprendre_partenaire(uuid, text, timestamptz), plateforme.console_service_travaux_suite(timestamptz, integer) to skanfact_app;
