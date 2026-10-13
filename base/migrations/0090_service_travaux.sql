-- 0090 — Les travaux et les envois du service (Console 3e ; docs/console.md C25 ; skanfact docs/cadrage/10-console.md
-- § 2.8). Ce que le serveur fait seul et ce qu'il envoie aux partenaires, lu sans jamais voir une pièce :
--   1. les tours du serveur (le facteur de la TTN, les contrats, le livreur des avis, le postier, les relances, le
--      mesureur) notent leur passage — sans quoi personne ne sait qu'un tour s'est arrêté ;
--   2. la console lit, partenaire par partenaire, ce qui est parti, ce qui est revenu et ce qui reste à regarder :
--      une clé courte, la sorte d'envoi, le motif, les essais, la suite. Ni le contenu d'une pièce ni un montant ; le nom
--      de l'entreprise pour la direction seule (03 § 5 : la technique ne voit aucune donnée de client).
-- Ce qui n'a pas de trace (les e-mails partis par le relais, la TEJ, la CNSS) n'est pas inventé : l'écran le dit.

-- ── 1. Les tours du serveur ──────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_tour (
  nom text primary key check (nom ~ '^[a-z-]{2,40}$'),
  -- Le dernier passage fini, ce qu'il a duré, s'il a réussi, et ce qu'il a fait (des nombres nommés, jamais un contenu).
  dernier_le timestamptz not null,
  duree_ms integer not null check (duree_ms >= 0),
  ok boolean not null,
  compte jsonb not null default '{}'::jsonb check (jsonb_typeof(compte) = 'object'),
  -- Le dernier échec, pour le dire même après un tour réussi.
  echec_le timestamptz,
  echec text check (length(echec) <= 300)
);
alter table plateforme.service_tour enable row level security;
alter table plateforme.service_tour force row level security;

-- Le serveur, sans identité (comme noter_requetes) : un tour note son passage.
create function plateforme.noter_tour(p_nom text, p_le timestamptz, p_duree_ms integer, p_ok boolean, p_compte jsonb, p_echec text)
returns void language plpgsql volatile security definer set search_path = pg_catalog, plateforme as $$
begin
  insert into plateforme.service_tour as t (nom, dernier_le, duree_ms, ok, compte, echec_le, echec)
  values (p_nom, p_le, greatest(p_duree_ms, 0), p_ok, coalesce(p_compte, '{}'::jsonb),
          case when p_ok then null else p_le end, case when p_ok then null else left(p_echec, 300) end)
  on conflict (nom) do update set dernier_le = excluded.dernier_le, duree_ms = excluded.duree_ms, ok = excluded.ok,
    compte = excluded.compte,
    echec_le = case when excluded.ok then t.echec_le else excluded.echec_le end,
    echec = case when excluded.ok then t.echec else excluded.echec end;
end $$;
grant execute on function plateforme.noter_tour(text, timestamptz, integer, boolean, jsonb, text) to skanfact_app;

-- ── 2. La lecture de la console ──────────────────────────────────────────────────────────────────────────────────────
-- Par partenaire : quatorze jours (jour de Tunis), ce qui attend maintenant, et la liste de ce qui reste à regarder (deux
-- cents au plus, les plus anciens d'abord). Les entreprises d'essai n'envoient rien et ne comptent pas.
create function plateforme.console_service_travaux(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme, ventes as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
  v_depuis timestamptz := date_trunc('day', p_maintenant at time zone 'Africa/Tunis') at time zone 'Africa/Tunis' - interval '13 days';
  v_jour date := (p_maintenant at time zone 'Africa/Tunis')::date;
begin
  return jsonb_build_object(
    'tours', (select coalesce(jsonb_agg(jsonb_build_object('nom', t.nom, 'le', t.dernier_le, 'dureeMs', t.duree_ms, 'ok', t.ok,
                'compte', t.compte, 'echecLe', t.echec_le, 'echec', t.echec) order by t.nom), '[]'::jsonb) from plateforme.service_tour t),
    -- La TTN : un dépôt par pièce signée ; « fini » quand elle l'accepte ou la refuse.
    'ttn', jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n, 'acceptes', j.acceptes, 'refuses', j.refuses) order by j.jour), '[]'::jsonb) from (
          select (v.cree_le at time zone 'Africa/Tunis')::date jour, count(*) n, count(*) filter (where v.statut = 'acceptee') acceptes,
                 count(*) filter (where v.statut = 'refusee') refuses
            from ventes.envoi_ttn v join socle.entreprise e on e.id = v.entreprise
           where not e.essai and v.cree_le >= v_depuis group by 1) j),
      'enFile', (select count(*) from ventes.envoi_ttn v join socle.entreprise e on e.id = v.entreprise
                  where not e.essai and v.statut in ('a_envoyer', 'deposee') and v.prochain_essai <= p_maintenant),
      'medianeS', (select round(extract(epoch from percentile_cont(0.5) within group (order by v.accepte_le - v.depose_le)))::int
                     from ventes.envoi_ttn v join socle.entreprise e on e.id = v.entreprise
                    where not e.essai and v.accepte_le >= v_depuis and v.depose_le is not null)),
    'signature', jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n, 'reussies', j.reussies, 'echouees', j.echouees) order by j.jour), '[]'::jsonb) from (
          select (s.cree_le at time zone 'Africa/Tunis')::date jour, count(*) n, count(*) filter (where s.statut = 'signee') reussies,
                 count(*) filter (where s.statut = 'echouee') echouees
            from ventes.signature_demande s join socle.entreprise e on e.id = s.entreprise
           where not e.essai and s.cree_le >= v_depuis group by 1) j)),
    'sms', jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n) order by j.jour), '[]'::jsonb) from (
          select (s.le at time zone 'Africa/Tunis')::date jour, count(*) n from socle.sms_envoye s where s.le >= v_depuis group by 1) j)),
    'paiements', jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n, 'encaisses', j.encaisses, 'echoues', j.echoues) order by j.jour), '[]'::jsonb) from (
          select (p.cree_le at time zone 'Africa/Tunis')::date jour, count(*) n, count(*) filter (where p.statut = 'encaisse') encaisses,
                 count(*) filter (where p.statut = 'echoue') echoues
            from ventes.paiement_en_ligne p join socle.entreprise e on e.id = p.entreprise
           where not e.essai and p.cree_le >= v_depuis group by 1) j)),
    'relances', jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n) order by j.jour), '[]'::jsonb) from (
          select (r.partie_le at time zone 'Africa/Tunis')::date jour, count(*) n from plateforme.relance_abonnement r
           where r.partie_le >= v_depuis group by 1) j)),
    -- Ce qui reste à regarder : la TTN pas finie après un essai ou retenue, refusée cette semaine ; une signature ou un
    -- paiement échoué cette semaine. Une clé courte, jamais la pièce : la FIN de l'identifiant (le début d'un uuidv7 est
    -- son heure : deux envois de la même seconde y porteraient la même clé).
    'aRegarder', (select coalesce(jsonb_agg(x.l order by x.depuis), '[]'::jsonb) from (
        select v.cree_le depuis, jsonb_build_object('sorte', 'ttn', 'cle', upper(right(replace(v.piece::text, '-', ''), 8)),
                 'entreprise', jsonb_build_object('id', v.entreprise, 'nom', case when v_role = 'direction' then e.raison_sociale end),
                 'statut', v.statut, 'essais', v.essais, 'prochain', v.prochain_essai, 'deposeLe', v.depose_le, 'depuis', v.cree_le,
                 'motif', v.motif) l
          from ventes.envoi_ttn v join socle.entreprise e on e.id = v.entreprise
         where not e.essai and ((v.statut in ('a_envoyer', 'deposee') and (v.essais > 0 or v.motif is not null))
                                or (v.statut = 'refusee' and v.cree_le >= p_maintenant - interval '7 days'))
        union all
        select s.cree_le, jsonb_build_object('sorte', 'signature', 'cle', upper(right(replace(s.id::text, '-', ''), 8)),
                 'entreprise', jsonb_build_object('id', s.entreprise, 'nom', case when v_role = 'direction' then e.raison_sociale end),
                 'statut', s.statut, 'essais', s.essais, 'prochain', null, 'deposeLe', null, 'depuis', s.cree_le, 'motif', s.motif,
                 'pieces', cardinality(s.pieces))
          from ventes.signature_demande s join socle.entreprise e on e.id = s.entreprise
         where not e.essai and s.statut = 'echouee' and s.cree_le >= p_maintenant - interval '7 days'
        union all
        select p.cree_le, jsonb_build_object('sorte', 'paiement', 'cle', upper(right(replace(p.id::text, '-', ''), 8)),
                 'entreprise', jsonb_build_object('id', p.entreprise, 'nom', case when v_role = 'direction' then e.raison_sociale end),
                 'statut', p.statut, 'essais', null, 'prochain', null, 'deposeLe', null, 'depuis', p.cree_le, 'motif', p.motif)
          from ventes.paiement_en_ligne p join socle.entreprise e on e.id = p.entreprise
         where not e.essai and p.statut = 'echoue' and p.cree_le >= p_maintenant - interval '7 days'
        order by 1 limit 200) x),
    'jour', v_jour);
end $$;
grant execute on function plateforme.console_service_travaux(timestamptz) to skanfact_app;
