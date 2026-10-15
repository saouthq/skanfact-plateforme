-- Le support et les travaux suivis (1.22.0 ; docs/console.md C38 ; l'audit du 14/10/2026, troisième partie : F13, F18,
-- F19, F21).
--   1. Une demande du support a quelqu'un qui la suit, qu'on confie à un autre ; une priorité (normale ou urgente) ; et
--      l'attente de la technique, avec son motif (l'audit F13).
--   2. Un envoi à la TTN arrêté sur une panne se reprend depuis la console, sans attendre son prochain essai : le facteur
--      redemande d'abord à la TTN si elle a la pièce (jamais deux dépôts). Un refus, un compte retenu : jamais d'ici
--      (l'entreprise corrige) (F18).
--   3. Les e-mails laissent une trace : l'instant, et s'ils sont partis. Ni l'adresse, ni l'objet, ni l'entreprise (F19).
--   4. Les chaînes d'empreintes se relisent seules, par lots, chaque heure ; chaque chaîne garde son dernier contrôle et
--      son point de rupture ; la veille le lit (F21). Le contenu des pièces, lui, n'est pas encore recomparé : la console
--      le dit.

-- ── 1. Qui suit une demande, sa priorité, l'attente de la technique ──────────────────────────────────────────────────
alter table plateforme.demande_support
  add column priorite text not null default 'normale' check (priorite in ('normale', 'urgente')),
  add column technique_le timestamptz,
  add column technique_motif text check (technique_motif is null or length(btrim(technique_motif)) between 3 and 500),
  add constraint demande_technique check ((technique_le is null) = (technique_motif is null));

-- Une ligne de la liste (0095) : qui la suit (son nom et qui il est), sa priorité, l'attente de la technique.
create or replace function plateforme.support_ligne(d plateforme.demande_support) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet, 'canal', d.canal, 'ouverteLe', d.ouverte_le,
    'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale, 'essai', e.essai),
    'demandeur', jsonb_build_object('id', p.id, 'nom', p.nom),
    'noteePar', (select u.nom from socle.utilisateur u where u.id = d.notee_par),
    'suiviePar', (select u.nom from socle.utilisateur u where u.id = d.suivie_par), 'suivieParId', d.suivie_par, 'priorite', d.priorite,
    'technique', case when d.technique_le is null then null else jsonb_build_object('le', d.technique_le, 'motif', d.technique_motif) end,
    'dernierClientLe', (select max(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'client'),
    'dernierEquipeLe', (select max(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'),
    'dernierCote', (select m.cote from plateforme.message_support m where m.demande = d.id order by m.ecrit_le desc, m.id desc limit 1),
    'messages', (select count(*) from plateforme.message_support m where m.demande = d.id),
    'close', case when d.close_le is null then null else jsonb_build_object('le', d.close_le, 'cote', d.close_cote,
               'par', (select u.nom from socle.utilisateur u where u.id = d.close_par), 'motif', d.close_motif) end)
    from socle.entreprise e, socle.utilisateur p
   where e.id = d.entreprise and p.id = d.demandeur
$$;

-- La liste (0114), avec l'équipe à qui confier une demande.
create or replace function plateforme.console_support(p_entreprise uuid, p_demande uuid, p_closes_debut integer default 0) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return jsonb_build_object(
    'ouvertes', (select coalesce(jsonb_agg(plateforme.support_ligne(d) order by d.ouverte_le, d.id), '[]'::jsonb)
                   from plateforme.demande_support d where d.close_le is null and (p_entreprise is null or d.entreprise = p_entreprise)),
    'closes', (select coalesce(jsonb_agg(plateforme.support_ligne(d) order by d.close_le desc, d.id desc), '[]'::jsonb)
                 from plateforme.demande_support d
                where d.id in (select c.id from plateforme.demande_support c where c.close_le is not null and (p_entreprise is null or c.entreprise = p_entreprise)
                                order by c.close_le desc, c.id desc offset greatest(coalesce(p_closes_debut, 0), 0) limit 50)),
    -- Ceux à qui une demande se confie : l'équipe qui répond au support (la direction et le support).
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nom', u.nom, 'role', e.role) order by e.role, u.nom, u.id), '[]'::jsonb)
                 from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where e.actif and e.role in ('direction', 'support')),
    'nCloses', (select count(*) from plateforme.demande_support c where c.close_le is not null and (p_entreprise is null or c.entreprise = p_entreprise)),
    'demande', (select jsonb_build_object('ligne', plateforme.support_ligne(d), 'version', d.version, 'page', d.page,
                  -- La personne, comme la liste fermée la dit (10 § 4) : son nom, son adresse, ses rôles ; jamais son téléphone.
                  'personne', jsonb_build_object('nom', p.nom, 'email', p.email,
                    'roles', (select coalesce(to_jsonb(m.roles), '[]'::jsonb) from socle.membre m
                               where m.utilisateur = p.id and m.entreprise = d.entreprise order by m.actif desc limit 1)),
                  'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'cote', m.cote, 'texte', m.texte, 'article', m.article,
                                 'le', m.ecrit_le, 'nom', u.nom, 'notePar', (select n.nom from socle.utilisateur n where n.id = m.note_par))
                                 order by m.ecrit_le, m.id), '[]'::jsonb)
                                 from plateforme.message_support m join socle.utilisateur u on u.id = m.auteur where m.demande = d.id))
                  from plateforme.demande_support d join socle.utilisateur p on p.id = d.demandeur where d.id = p_demande));
end
$$;

-- Suivre une demande, ou la confier à un autre membre qui répond au support : avec son motif, au journal.
create function plateforme.console_suivre_demande(p_demande uuid, p_membre uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v plateforme.demande_support; v_qui uuid := coalesce(p_membre, socle.moi());
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if v.close_le is not null then perform socle.refus('cette demande est close : rouvre-la d''abord'); end if;
  if not exists (select 1 from plateforme.equipe e where e.utilisateur = v_qui and e.actif and e.role in ('direction', 'support')) then
    perform socle.refus('une demande se confie à un membre de l''équipe qui répond au support : la direction ou le support');
  end if;
  if v.suivie_par is not distinct from v_qui then perform socle.refus('cette personne suit déjà cette demande'); end if;
  update plateforme.demande_support set suivie_par = v_qui where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.confiee', v.entreprise, btrim(p_motif),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'suiviePar', (select u.nom from socle.utilisateur u where u.id = v.suivie_par)),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'suiviePar', (select u.nom from socle.utilisateur u where u.id = v_qui)));
end $$;

-- La priorité d'une demande : normale (une réponse dans la journée) ou urgente (dans les deux heures).
create function plateforme.console_priorite_demande(p_demande uuid, p_priorite text, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v plateforme.demande_support;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_priorite is null or p_priorite not in ('normale', 'urgente') then perform socle.refus('une demande est normale ou urgente'); end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if v.close_le is not null then perform socle.refus('cette demande est close : rouvre-la d''abord'); end if;
  if v.priorite = p_priorite then perform socle.refus('cette demande a déjà cette priorité'); end if;
  update plateforme.demande_support set priorite = p_priorite where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.priorite', v.entreprise, btrim(p_motif),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'priorite', v.priorite),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'priorite', p_priorite));
end $$;

-- L'attente de la technique : la demande attend une correction ou une réponse de la technique (son motif dit laquelle),
-- puis la technique a répondu et la demande revient au support. Le motif de l'attente se garde sur la demande.
create function plateforme.console_attente_technique(p_demande uuid, p_attend boolean, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v plateforme.demande_support;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if v.close_le is not null then perform socle.refus('cette demande est close : rouvre-la d''abord'); end if;
  if p_attend and v.technique_le is not null then perform socle.refus('cette demande attend déjà la technique'); end if;
  if not p_attend and v.technique_le is null then perform socle.refus('cette demande n''attend pas la technique'); end if;
  update plateforme.demande_support
     set technique_le = case when p_attend then p_maintenant end, technique_motif = case when p_attend then left(btrim(p_motif), 500) end
   where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, case when p_attend then 'support.technique' else 'support.technique_levee' end, v.entreprise, btrim(p_motif),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'technique', v.technique_le),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'technique', case when p_attend then p_maintenant end));
end $$;

-- ── 2. Reprendre un envoi arrêté sur une panne ───────────────────────────────────────────────────────────────────────
-- Par la clé que la console montre (la FIN de l'identifiant de la pièce, 0114) : l'envoi repart au prochain tour du
-- facteur, qui demande d'abord à la TTN si elle a déjà la pièce. Refusé : un envoi fini (accepté, refusé — un refus se
-- corrige chez l'entreprise), retenu par son compte El Fatoora (l'entreprise le pose ou le corrige), pris par un tour en
-- ce moment, ou qui repart déjà.
create function plateforme.console_reessayer_envoi(p_cle text, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme, ventes as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v ventes.envoi_ttn; n integer;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_cle is null or p_cle !~ '^[0-9A-Fa-f]{8}$' then perform socle.refus('cet envoi n''existe pas'); end if;
  select count(*) into n from ventes.envoi_ttn x join socle.entreprise e on e.id = x.entreprise
   where not e.essai and upper(right(replace(x.piece::text, '-', ''), 8)) = upper(p_cle);
  if n = 0 then perform socle.refus('cet envoi n''existe pas'); end if;
  if n > 1 then perform socle.refus('deux envois portent cette clé : ils se reprennent depuis le serveur, un par un'); end if;
  select x.* into v from ventes.envoi_ttn x where upper(right(replace(x.piece::text, '-', ''), 8)) = upper(p_cle) for update;
  if v.statut not in ('a_envoyer', 'deposee') then
    perform socle.refus('cet envoi est fini : la TTN l''a accepté ou refusé, et un refus se corrige chez l''entreprise');
  end if;
  if (v.motif ->> 'cle') in ('ttn.sans_compte', 'ttn.compte_refuse', 'ttn.compte_illisible') then
    perform socle.refus('cet envoi attend le compte El Fatoora de l''entreprise : c''est elle qui le pose ou le corrige');
  end if;
  if v.bail is not null and v.bail > p_maintenant then perform socle.refus('le facteur y travaille en ce moment : regarde-le dans quelques minutes'); end if;
  if v.prochain_essai <= p_maintenant then perform socle.refus('cet envoi repart déjà au prochain tour du facteur'); end if;
  update ventes.envoi_ttn set prochain_essai = p_maintenant where piece = v.piece;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'service.envoi_repris', v.entreprise, btrim(p_motif),
            jsonb_build_object('cle', upper(p_cle), 'essais', v.essais, 'prochain', v.prochain_essai),
            jsonb_build_object('cle', upper(p_cle), 'prochain', p_maintenant));
end $$;

-- ── 3. La trace des e-mails ──────────────────────────────────────────────────────────────────────────────────────────
-- Un e-mail parti, ou refusé par le relais : l'instant, et s'il est parti. Rien d'autre (ni l'adresse, ni l'objet, ni
-- l'entreprise). Trente jours se gardent : l'écran Travaux en montre quatorze.
create table plateforme.courriel_trace (
  le timestamptz not null,
  ok boolean not null
);
create index courriel_trace_le on plateforme.courriel_trace (le);
alter table plateforme.courriel_trace enable row level security;
alter table plateforme.courriel_trace force row level security;

create function plateforme.noter_courriel(p_ok boolean, p_le timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note un e-mail parti'); end if;
  insert into plateforme.courriel_trace (le, ok) values (p_le, coalesce(p_ok, false));
  delete from plateforme.courriel_trace where le < p_le - interval '30 days';
end $$;

-- Travaux (0114), avec les e-mails.
create or replace function plateforme.console_service_travaux(p_maintenant timestamptz) returns jsonb
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
    'courriel', jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n, 'envoyes', j.envoyes, 'echoues', j.echoues) order by j.jour), '[]'::jsonb) from (
          select (c.le at time zone 'Africa/Tunis')::date jour, count(*) n, count(*) filter (where c.ok) envoyes, count(*) filter (where not c.ok) echoues
            from plateforme.courriel_trace c where c.le >= v_depuis group by 1) j)),
    'relances', jsonb_build_object(
      'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n) order by j.jour), '[]'::jsonb) from (
          select (r.partie_le at time zone 'Africa/Tunis')::date jour, count(*) n from plateforme.relance_abonnement r
           where r.partie_le >= v_depuis group by 1) j)),
    -- Ce qui reste à regarder : la TTN pas finie après un essai ou retenue, refusée cette semaine ; une signature ou un
    -- paiement échoué cette semaine. Une clé courte, jamais la pièce : la FIN de l'identifiant (le début d'un uuidv7 est
    -- son heure : deux envois de la même seconde y porteraient la même clé).
    'aRegarder', (select coalesce(jsonb_agg(x.l order by x.depuis), '[]'::jsonb) from (
        select v.cree_le depuis, jsonb_build_object('sorte', 'ttn', 'cle', upper(right(replace(v.piece::text, '-', ''), 8)),
                 'entreprise', case when v_role = 'direction' then jsonb_build_object('id', v.entreprise, 'nom', e.raison_sociale) end,
                 'statut', v.statut, 'essais', v.essais, 'prochain', v.prochain_essai, 'deposeLe', v.depose_le, 'depuis', v.cree_le,
                 'motif', v.motif) l
          from ventes.envoi_ttn v join socle.entreprise e on e.id = v.entreprise
         where not e.essai and ((v.statut in ('a_envoyer', 'deposee') and (v.essais > 0 or v.motif is not null))
                                or (v.statut = 'refusee' and v.cree_le >= p_maintenant - interval '7 days'))
        union all
        select s.cree_le, jsonb_build_object('sorte', 'signature', 'cle', upper(right(replace(s.id::text, '-', ''), 8)),
                 'entreprise', case when v_role = 'direction' then jsonb_build_object('id', s.entreprise, 'nom', e.raison_sociale) end,
                 'statut', s.statut, 'essais', s.essais, 'prochain', null, 'deposeLe', null, 'depuis', s.cree_le, 'motif', s.motif,
                 'pieces', cardinality(s.pieces))
          from ventes.signature_demande s join socle.entreprise e on e.id = s.entreprise
         where not e.essai and s.statut = 'echouee' and s.cree_le >= p_maintenant - interval '7 days'
        union all
        select p.cree_le, jsonb_build_object('sorte', 'paiement', 'cle', upper(right(replace(p.id::text, '-', ''), 8)),
                 'entreprise', case when v_role = 'direction' then jsonb_build_object('id', p.entreprise, 'nom', e.raison_sociale) end,
                 'statut', p.statut, 'essais', null, 'prochain', null, 'deposeLe', null, 'depuis', p.cree_le, 'motif', p.motif)
          from ventes.paiement_en_ligne p join socle.entreprise e on e.id = p.entreprise
         where not e.essai and p.statut = 'echoue' and p.cree_le >= p_maintenant - interval '7 days'
        order by 1 limit 200) x),
    'jour', v_jour);
end
$$;

-- ── 4. Les chaînes d'empreintes, relues seules ───────────────────────────────────────────────────────────────────────
-- Chaque chaîne garde son dernier contrôle ET son point de rupture (le premier rang qui ne va pas, et pourquoi).
alter table socle.chaine add column casse_rang bigint, add column casse_motif text;

-- Le contrôle d'une chaîne, sans la porte (0004, `controler_chaine`, la garde ; ici, le contrôle lui-même) : appelé par
-- la porte pour une personne, et par la relecture du serveur pour toutes. Personne d'autre ne l'appelle.
create function socle.verifier_chaine(p_entreprise uuid, p_cle text, p_le timestamptz)
returns table (ok boolean, rang bigint, motif text)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare c record; m record; attendu_rang bigint := 0; attendue text := repeat('0', 64); casse bigint; pourquoi text;
begin
  select * into c from socle.chaine ch where ch.entreprise = p_entreprise and ch.cle = p_cle;
  for m in select * from socle.maillon ml where ml.entreprise = p_entreprise and ml.cle = p_cle order by ml.rang loop
    attendu_rang := attendu_rang + 1;
    if m.rang <> attendu_rang then casse := attendu_rang; pourquoi := 'maillon manquant'; exit; end if;
    if m.precedente <> attendue then casse := m.rang; pourquoi := 'ne suit pas le maillon précédent'; exit; end if;
    if m.empreinte <> socle.empreinte_maillon(m.precedente, m.contenu) then casse := m.rang; pourquoi := 'empreinte fausse'; exit; end if;
    attendue := m.empreinte;
  end loop;
  if casse is null and (coalesce(c.rang, 0) <> attendu_rang or coalesce(c.derniere, repeat('0', 64)) <> attendue) then
    casse := attendu_rang + 1; pourquoi := 'la fin de la chaîne manque';
  end if;
  update socle.chaine ch set controle_le = p_le, controle_ok = (casse is null), casse_rang = casse, casse_motif = pourquoi where ch.entreprise = p_entreprise and ch.cle = p_cle;
  return query select casse is null, casse, pourquoi;
end $$;

-- La porte (0004) : une personne contrôle les chaînes de ses entreprises ; le contrôle est celui de la relecture.
create or replace function socle.controler_chaine(p_entreprise uuid, p_cle text)
returns table (ok boolean, rang bigint, motif text)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if p_entreprise not in (select socle.mes_entreprises()) then perform socle.refus('entreprise introuvable'); end if;
  return query select v.ok, v.rang, v.motif from socle.verifier_chaine(p_entreprise, p_cle, now()) v;
end $$;

-- Chaque relecture : quand, combien de chaînes et de maillons relus, combien de chaînes cassées en tout après elle, et
-- combien de temps. Quatre-vingt-dix jours se gardent.
create table plateforme.releve_chaines (
  le timestamptz primary key,
  chaines integer not null check (chaines >= 0),
  maillons bigint not null check (maillons >= 0),
  cassees integer not null check (cassees >= 0),
  duree_ms integer not null check (duree_ms >= 0)
);
alter table plateforme.releve_chaines enable row level security;
alter table plateforme.releve_chaines force row level security;

-- La relecture, par le serveur seul : les chaînes les moins récemment contrôlées d'abord (jamais contrôlées en tête),
-- `p_lot` au plus à chaque passage ; un tour par heure les reprend toutes, de lot en lot.
create function plateforme.relire_chaines(p_maintenant timestamptz, p_lot integer) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare c record; n integer := 0; m bigint := 0; v_cassees integer; t0 timestamptz := clock_timestamp();
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur relit les chaînes d''empreintes'); end if;
  for c in select ch.entreprise, ch.cle, ch.rang from socle.chaine ch
            order by ch.controle_le nulls first, ch.entreprise, ch.cle limit greatest(coalesce(p_lot, 1), 1) loop
    perform 1 from socle.verifier_chaine(c.entreprise, c.cle, p_maintenant);
    n := n + 1; m := m + c.rang;
  end loop;
  select count(*) into v_cassees from socle.chaine ch where ch.controle_ok = false;
  insert into plateforme.releve_chaines (le, chaines, maillons, cassees, duree_ms)
    values (p_maintenant, n, m, v_cassees, greatest(0, (extract(epoch from clock_timestamp() - t0) * 1000)::integer))
    on conflict (le) do update set chaines = excluded.chaines, maillons = excluded.maillons, cassees = excluded.cassees, duree_ms = excluded.duree_ms;
  delete from plateforme.releve_chaines where le < p_maintenant - interval '90 days';
  return jsonb_build_object('chaines', n, 'maillons', m, 'cassees', v_cassees);
end $$;

-- Ce que l'écran Sécurité en montre (la direction et la technique) : la dernière relecture, ce qui n'a jamais été relu,
-- le plus ancien contrôle, et les chaînes cassées (leur sorte, leur point de rupture ; l'entreprise pour la direction).
create function plateforme.console_chaines(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
begin
  return jsonb_build_object(
    'dernier', (select jsonb_build_object('le', r.le, 'chaines', r.chaines, 'maillons', r.maillons, 'cassees', r.cassees, 'dureeMs', r.duree_ms)
                  from plateforme.releve_chaines r order by r.le desc limit 1),
    'total', (select count(*) from socle.chaine),
    'maillons', (select coalesce(sum(ch.rang), 0) from socle.chaine ch),
    'jamais', (select count(*) from socle.chaine ch where ch.controle_le is null),
    'plusAncien', (select min(ch.controle_le) from socle.chaine ch),
    'nCassees', (select count(*) from socle.chaine ch where ch.controle_ok = false),
    -- Les trente derniers jours (jour de Tunis) : combien de relectures, et le plus de chaînes cassées vues ce jour-là.
    'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n, 'cassees', j.cassees) order by j.jour), '[]'::jsonb) from (
                select (r.le at time zone 'Africa/Tunis')::date jour, count(*) n, max(r.cassees) cassees from plateforme.releve_chaines r
                 where r.le >= p_maintenant - interval '30 days' group by 1) j),
    'cassees', (select coalesce(jsonb_agg(jsonb_build_object('sorte', split_part(ch.cle, ':', 1), 'rang', ch.casse_rang, 'motif', ch.casse_motif,
                  'le', ch.controle_le, 'entreprise', case when v_role = 'direction' then jsonb_build_object('id', e.id, 'nom', e.raison_sociale) end)
                  order by ch.controle_le desc), '[]'::jsonb)
                  from (select * from socle.chaine x where x.controle_ok = false order by x.controle_le desc limit 20) ch
                  join socle.entreprise e on e.id = ch.entreprise));
end $$;

-- Ce que la veille lit (0089), avec les chaînes.
create or replace function plateforme.veille_lire(p_maintenant timestamptz, p_minutes int) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'sourdines', (select coalesce(jsonb_agg(jsonb_build_object('regle', s.regle, 'debut', s.debut, 'fin', s.fin) order by s.debut), '[]'::jsonb)
                    from plateforme.service_sourdine s where s.levee_le is null and s.debut <= p_maintenant and s.fin > p_maintenant),
    'demandes', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'sorte', d.sorte) order by d.le), '[]'::jsonb)
                   from plateforme.service_demande d where d.faite_le is null),
    'minutes', (select coalesce(jsonb_agg(jsonb_build_array(m.minute, m.n, m.pannes, m.lecture) order by m.minute), '[]'::jsonb) from (
                  select minute, sum(n)::int n, sum(pannes)::int pannes, plateforme.somme_seaux(seaux) filter (where sorte = 'lecture') lecture
                    from plateforme.service_minute
                   where minute >= date_trunc('minute', p_maintenant) - make_interval(mins => least(greatest(p_minutes, 1), 60))
                     and minute < date_trunc('minute', p_maintenant)
                   group by minute) m),
    -- Les chaînes d'empreintes (0115) : combien sont cassées, et la dernière relecture.
    'chaines', jsonb_build_object('cassees', (select count(*) from socle.chaine ch where ch.controle_ok = false),
                                  'dernierLe', (select max(r.le) from plateforme.releve_chaines r)),
    'annonce', jsonb_build_object(
      'incident', (select jsonb_build_object('gravite', i.gravite, 'texte', i.public, 'le', i.public_le, 'depuis', i.ouvert_le)
                     from plateforme.service_incident i where i.clos_le is null and i.public is not null
                    order by plateforme.rang_gravite(i.gravite) desc, i.public_le desc limit 1),
      'maintenance', (select jsonb_build_object('titre', m.titre, 'texte', m.texte, 'debut', m.debut, 'fin', m.fin)
                        from plateforme.service_maintenance m
                       where m.annulee_le is null and m.fin > p_maintenant and m.debut <= p_maintenant + interval '48 hours'
                       order by m.debut limit 1)));
$$;

-- ── Les droits ───────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function plateforme.console_suivre_demande(uuid, uuid, text, timestamptz),
  plateforme.console_priorite_demande(uuid, text, text, timestamptz), plateforme.console_attente_technique(uuid, boolean, text, timestamptz),
  plateforme.console_reessayer_envoi(text, text, timestamptz), plateforme.noter_courriel(boolean, timestamptz),
  socle.verifier_chaine(uuid, text, timestamptz), plateforme.relire_chaines(timestamptz, integer), plateforme.console_chaines(timestamptz) from public;
grant execute on function plateforme.console_suivre_demande(uuid, uuid, text, timestamptz),
  plateforme.console_priorite_demande(uuid, text, text, timestamptz), plateforme.console_attente_technique(uuid, boolean, text, timestamptz),
  plateforme.console_reessayer_envoi(text, text, timestamptz), plateforme.noter_courriel(boolean, timestamptz),
  plateforme.relire_chaines(timestamptz, integer), plateforme.console_chaines(timestamptz) to skanfact_app;
