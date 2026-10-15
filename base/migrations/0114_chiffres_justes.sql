-- Des chiffres et des accès justes (docs/console.md C37 ; l'audit du 14/10/2026, deuxième partie ; décidé par délégation
-- le 15/10/2026 — Skander : « faut faire tout ce qui manque ») :
--
--   1. « A servi » n'a qu'une définition : une pièce créée dans l'entreprise — un devis, une facture, un achat de son
--      dossier, ou une pièce faite par le serveur ou l'API (une vente, un ticket, un achat sans pièce du dossier). La liste,
--      « À décider » et la fiche lisent la même fonction (plateforme.pieces_creees).
--   2. La dernière activité se compte PAR ENTREPRISE : le serveur note, au plus une fois toutes les cinq minutes, qu'une
--      personne a travaillé dans une entreprise (socle.activite : la personne, l'entreprise, l'instant ; rien d'autre).
--      Avant, une entreprise prenait l'activité de ses membres ailleurs (le comptable qui tient dix dossiers les rendait
--      tous « vus aujourd'hui »).
--   3. La technique ne reçoit plus aucun identifiant de client dans les travaux du service (03 § 5).
--   4. Une relecture automatique d'un écran de la console ne prolonge plus la session : l'inaction se compte en gestes
--      humains (qui_est_console prend `p_prolonger`).
--   5. La direction ferme la session ou oublie l'appareil d'un membre de l'équipe sans le retirer ; chacun le fait pour
--      lui-même. Le geste demande son motif et va au journal.
--   6. Les demandes closes du support se lisent par pages de cinquante (plus de limite à cent).
--   7. Le journal se filtre par sorte de geste, par période, par mot, par ce qui est réservé à la direction ; il montre ce
--      que le système a fait seul (les relances, les paiements reconnus) ; le support y lit ses propres gestes ; les accès
--      aux dossiers ont leur liste.
--   8. Une de nos factures que ses avoirs annulent, timbre mis à part, est une facture défaite (le timbre d'un avoir : À
--      VÉRIFIER avec le comptable) ; la règle du moteur, elle, ne change pas.

-- ── 1. « A servi » : une seule définition ───────────────────────────────────────────────────────────────────────────
-- Les pièces créées dans une entreprise : celles de son dossier (devis, factures, achats), et celles que le serveur ou
-- l'API ont faites sans pièce du dossier derrière (une vente, un ticket de caisse, un achat). Une pièce du dossier émise par
-- le serveur porte sa référence (ref_v10) : elle ne compte qu'une fois.
create function plateforme.pieces_creees(p_entreprise uuid) returns bigint
language sql stable security definer set search_path = pg_catalog, socle, ventes, achats as $$
  select (select count(*) from socle.dossier_v10 d where d.entreprise = p_entreprise and d.collection in ('documents', 'purchases'))
       + (select count(*) from ventes.piece p where p.entreprise = p_entreprise and p.ref_v10 is null)
       + (select count(*) from achats.piece p where p.entreprise = p_entreprise and p.ref_v10 is null)
$$;

-- ── 2. La dernière activité, par entreprise ──────────────────────────────────────────────────────────────────────────
-- Une ligne par personne et par entreprise : le dernier instant où elle y a travaillé (une requête acceptée sur une route
-- de l'entreprise). Ni la page, ni le geste, ni l'adresse : seulement l'instant. Chacun ne lit que les siennes ; la
-- console les lit par ses fonctions.
create table socle.activite (
  -- Elle suit l'entreprise et la personne : une entreprise remise par-dessus son état l'efface avec elle.
  entreprise uuid not null references socle.entreprise(id) on delete cascade,
  utilisateur uuid not null references socle.utilisateur(id) on delete cascade,
  derniere timestamptz not null,
  primary key (entreprise, utilisateur)
);
alter table socle.activite enable row level security;
alter table socle.activite force row level security;
create policy visible on socle.activite using (utilisateur = socle.moi());

-- Le serveur la note après une requête acceptée, au nom de la personne, dans une entreprise qu'elle voit ; un instant plus
-- ancien que celui qui est noté ne recule rien.
create function socle.noter_activite(p_entreprise uuid, p_maintenant timestamptz) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into socle.activite (entreprise, utilisateur, derniere)
  select p_entreprise, socle.moi(), p_maintenant
   where socle.moi() is not null and p_entreprise in (select socle.mes_entreprises())
  on conflict (entreprise, utilisateur) do update set derniere = excluded.derniere where activite.derniere < excluded.derniere
$$;
revoke execute on function socle.noter_activite(uuid, timestamptz) from public;
grant execute on function socle.noter_activite(uuid, timestamptz) to skanfact_app;

-- Ce qui existe déjà le dit au mieux : le dernier changement de chacun dans le dossier et dans les pièces de chaque
-- entreprise (jamais l'activité d'une personne ailleurs).
insert into socle.activite (entreprise, utilisateur, derniere)
select x.entreprise, x.utilisateur, max(x.le) from (
  select d.entreprise, d.modifie_par utilisateur, d.modifie_le le from socle.dossier_v10 d where d.modifie_par is not null
  union all
  select p.entreprise, p.cree_par, p.modifie_le from ventes.piece p
  union all
  select p.entreprise, p.cree_par, p.modifie_le from achats.piece p) x
group by x.entreprise, x.utilisateur
on conflict do nothing;
create or replace function plateforme.console_entreprises() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal, 'active', e.active,
      'creeLe', (e.cree_le at time zone e.fuseau)::date,
      'organisation', jsonb_build_object('id', o.id, 'type', o.type, 'nom', o.nom),
      'tenuePar', (select c.nom from socle.organisation c where c.id = e.tenue_par),
      'faits', jsonb_build_object('connu', a.entreprise is not null, 'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au,
        'offre', a.offre, 'periodicite', a.periodicite, 'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le,
        'offert', coalesce(a.offert, false), 'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null),
      'proprietaire', (select jsonb_build_object('nom', u.nom, 'email', u.email) from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                        where m.entreprise = e.id and m.actif and 'proprietaire' = any(m.roles) order by m.depuis limit 1),
      'membres', (select count(*) from socle.membre m where m.entreprise = e.id and m.actif),
      -- Le dernier instant où quelqu'un a travaillé DANS cette entreprise (socle.activite) : ni ailleurs, ni une connexion.
      'derniereActivite', (select max(a.derniere) from socle.activite a where a.entreprise = e.id),
      'pieces', plateforme.pieces_creees(e.id)
    ) order by e.cree_le desc, e.id), '[]'::jsonb)
    from socle.entreprise e join socle.organisation o on o.id = e.organisation
    left join plateforme.abonnement a on a.entreprise = e.id
   where not e.essai);
end
$$;

create or replace function plateforme.console_entreprise(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_fuseau text;
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  select e.fuseau into v_fuseau from socle.entreprise e where e.id = p_entreprise and not e.essai;
  if v_fuseau is null then return null; end if;
  return (select jsonb_build_object(
      'id', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal, 'formeJuridique', e.forme_juridique,
      'active', e.active, 'devise', e.devise_base, 'creeLe', (e.cree_le at time zone e.fuseau)::date,
      'organisation', jsonb_build_object('id', o.id, 'type', o.type, 'nom', o.nom),
      'tenuePar', (select c.nom from socle.organisation c where c.id = e.tenue_par),
      'faits', jsonb_build_object('connu', a.entreprise is not null, 'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au,
        'offre', a.offre, 'periodicite', a.periodicite, 'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le,
        'offert', coalesce(a.offert, false), 'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null),
      'ligne', plateforme.ligne_abonnement(a),
      'membres', (select coalesce(jsonb_agg(jsonb_build_object('nom', u.nom, 'email', u.email, 'roles', m.roles, 'depuis', m.depuis,
                     'derniereConnexion', (select max(s.derniere_activite) from socle.session s where s.utilisateur = u.id),
                     -- Son dernier geste dans CETTE entreprise (une personne peut en tenir plusieurs).
                     'derniereIci', (select a.derniere from socle.activite a where a.entreprise = e.id and a.utilisateur = u.id))
                     order by ('proprietaire' = any(m.roles)) desc, u.nom), '[]'::jsonb)
                    from socle.membre m join socle.utilisateur u on u.id = m.utilisateur where m.entreprise = e.id and m.actif),
      'comptes', jsonb_build_object(
        'etablissements', (select count(*) from socle.etablissement t where t.entreprise = e.id and t.actif),
        'caisses', (select count(*) from caisse.caisse k where k.entreprise = e.id and k.active),
        'salaries', (select count(*) from paie.salarie s where s.entreprise = e.id and s.date_sortie is null),
        'piecesCreees', plateforme.pieces_creees(e.id),
        -- Les pièces émises, mois par mois, sur les douze derniers mois (jour de l'entreprise).
        'piecesEmises', (select coalesce(jsonb_agg(jsonb_build_object('mois', x.mois, 'n', x.n) order by x.mois), '[]'::jsonb) from (
            select to_char(p.emise_le at time zone e.fuseau, 'YYYY-MM') mois, count(*) n from ventes.piece p
             where p.entreprise = e.id and p.statut = 'emise' and p.emise_le > now() - interval '12 months'
             group by 1) x)),
      'derniereActivite', (select max(a.derniere) from socle.activite a where a.entreprise = e.id),
      'prolongeDejaUneFois', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'essai_prolonge'),
      'evenements', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'le', v.le, 'nature', v.nature, 'par', v.par, 'motif', v.motif,
                        'avant', v.avant, 'apres', v.apres,
                        'qui', (select jsonb_build_object('nom', u.nom, 'role', g.role) from plateforme.geste_console g
                                  join socle.utilisateur u on u.id = g.qui where g.evenement = v.id))
                        order by v.le desc, v.id desc), '[]'::jsonb)
                       from plateforme.evenement_abonnement v where v.entreprise = e.id))
    from socle.entreprise e join socle.organisation o on o.id = e.organisation
    left join plateforme.abonnement a on a.entreprise = e.id
   where e.id = p_entreprise);
end
$$;

-- ── 3. Les travaux du service : aucun identifiant de client pour la technique ─────────────────────────────────────────
-- La direction lit l'entreprise d'un envoi à regarder (son nom, sa fiche) ; la technique, rien : ni son nom, ni son
-- identifiant (03 § 5). La clé courte de l'envoi lui suffit pour en parler.
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

-- ── 4. Une relecture automatique ne prolonge pas la session ──────────────────────────────────────────────────────────
-- Qui est derrière ce jeton de la console : la même règle qu'en 0083 ; `p_prolonger` faux (l'écran se relit seul, aucun
-- geste humain depuis dix secondes) lit la session sans repousser son inaction.
drop function plateforme.qui_est_console(text, timestamptz);
create function plateforme.qui_est_console(p_jeton_empreinte text, p_maintenant timestamptz, p_prolonger boolean)
returns table (utilisateur uuid, session uuid, appareil uuid, role text)
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  return query
  update plateforme.session_console s set derniere_activite = case when p_prolonger then p_maintenant else s.derniere_activite end
    from plateforme.equipe e
   where e.utilisateur = s.utilisateur and e.actif
     and s.jeton_empreinte = p_jeton_empreinte and s.fermee_le is null
     and s.expire_le > p_maintenant and s.derniere_activite + interval '1 hour' > p_maintenant
     and not exists (select 1 from socle.appareil a where a.id = s.appareil and a.revoque_le is not null)
  returning s.utilisateur, s.id, s.appareil, e.role;
end $$;
revoke execute on function plateforme.qui_est_console(text, timestamptz, boolean) from public;
grant execute on function plateforme.qui_est_console(text, timestamptz, boolean) to skanfact_app;

-- ── 5. Les appareils et les sessions d'un membre de l'équipe ─────────────────────────────────────────────────────────
create or replace function plateforme.console_equipe(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'utilisateur', u.id, 'nom', u.nom, 'email', u.email, 'role', q.role, 'actif', q.actif, 'ajouteLe', q.ajoute_le, 'retireLe', q.retire_le,
      'code', case when u.code_methode in ('sms', 'application') then u.code_methode end,
      -- Ses codes de secours qui restent, ses appareils reconnus (jamais retirés, encore dans leurs trente jours), ses
      -- gestes des trente derniers jours (le journal).
      'secours', (select count(*) from socle.code_secours c where c.utilisateur = u.id and c.utilise_le is null),
      'reconnus', (select count(*) from socle.appareil a where a.utilisateur = u.id and a.revoque_le is null and a.reconnu_jusqu_au > p_maintenant
                     and exists (select 1 from plateforme.session_console s where s.appareil = a.id)),
      'gestes30', (select count(*) from plateforme.geste_console g where g.qui = u.id and g.le > p_maintenant - interval '30 days'),
      'moi', u.id = socle.moi(),
      'derniereConnexion', (select max(s.derniere_activite) from plateforme.session_console s where s.utilisateur = u.id),
      'appareils', (select coalesce(jsonb_agg(distinct jsonb_build_object('nom', a.nom, 'type', a.type)), '[]'::jsonb)
                      from plateforme.session_console s join socle.appareil a on a.id = s.appareil
                     where s.utilisateur = u.id and s.fermee_le is null and s.expire_le > p_maintenant
                       and s.derniere_activite + interval '1 hour' > p_maintenant and a.revoque_le is null)
    ) order by q.actif desc, case q.role when 'direction' then 0 when 'support' then 1 else 2 end, u.nom), '[]'::jsonb)
    from plateforme.equipe q join socle.utilisateur u on u.id = q.utilisateur);
end
$$;

-- Ses appareils (ceux qui ont ouvert la console) et ses sessions : la direction, pour chacun ; chacun, pour lui-même.
-- Jamais une adresse, un mot de passe ni un code : l'appareil et ses dates.
create function plateforme.console_appareils_membre(p_membre uuid, p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']);
begin
  if p_membre <> socle.moi() and v_role <> 'direction' then perform socle.refus('seule la direction voit les appareils d''un autre membre'); end if;
  if not exists (select 1 from plateforme.equipe q where q.utilisateur = p_membre) then return null; end if;
  return jsonb_build_object(
    'membre', (select jsonb_build_object('utilisateur', u.id, 'nom', u.nom, 'email', u.email, 'role', q.role, 'actif', q.actif, 'moi', u.id = socle.moi())
                 from plateforme.equipe q join socle.utilisateur u on u.id = q.utilisateur where q.utilisateur = p_membre),
    'appareils', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nom', a.nom, 'type', a.type, 'premierVu', a.premier_vu, 'dernierVu', a.dernier_vu,
        'reconnuJusquAu', a.reconnu_jusqu_au, 'oublieLe', a.revoque_le,
        'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ouverteLe', s.ouverte_le, 'derniereActivite', s.derniere_activite,
                        'expireLe', s.expire_le, 'celleCi', s.id = nullif(current_setting('app.session_console', true), '')::uuid)
                        order by s.ouverte_le desc), '[]'::jsonb)
                       from plateforme.session_console s
                      where s.appareil = a.id and s.utilisateur = p_membre and s.fermee_le is null and s.expire_le > p_maintenant
                        and s.derniere_activite + interval '1 hour' > p_maintenant))
        order by a.revoque_le nulls first, a.dernier_vu desc nulls last, a.id), '[]'::jsonb)
      from socle.appareil a
     where a.utilisateur = p_membre and exists (select 1 from plateforme.session_console s where s.appareil = a.id and s.utilisateur = p_membre)));
end $$;

-- Fermer une session de la console : la direction, celle de chacun ; chacun, la sienne. Avec son motif, au journal.
create function plateforme.console_fermer_session(p_session uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']); v plateforme.session_console; v_nom text;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('fermer une session demande son motif (trois caractères au moins)'); end if;
  select * into v from plateforme.session_console where id = p_session for update;
  if not found or not exists (select 1 from plateforme.equipe q where q.utilisateur = v.utilisateur) then perform socle.refus('cette session n''existe pas'); end if;
  if v.utilisateur <> socle.moi() and v_role <> 'direction' then perform socle.refus('seule la direction ferme la session d''un autre membre'); end if;
  if v.fermee_le is not null or v.expire_le <= p_maintenant or v.derniere_activite + interval '1 hour' <= p_maintenant then
    perform socle.refus('cette session est déjà fermée');
  end if;
  update plateforme.session_console set fermee_le = p_maintenant where id = p_session;
  select a.nom into v_nom from socle.appareil a where a.id = v.appareil;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.session_fermee', v.utilisateur, btrim(p_motif),
            jsonb_build_object('appareil', v_nom, 'ouverteLe', v.ouverte_le), jsonb_build_object('fermeeLe', p_maintenant));
end $$;

-- Oublier un appareil : il est retiré (ses sessions, de la console comme de l'application, ne valent plus) ; la prochaine
-- connexion sur lui recommence tout, le code compris. La direction, celui de chacun ; chacun, le sien.
create function plateforme.console_oublier_appareil(p_appareil uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']); v socle.appareil;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('oublier un appareil demande son motif (trois caractères au moins)'); end if;
  select * into v from socle.appareil where id = p_appareil for update;
  if not found or not exists (select 1 from plateforme.equipe q where q.utilisateur = v.utilisateur)
     or not exists (select 1 from plateforme.session_console s where s.appareil = v.id) then perform socle.refus('cet appareil n''existe pas'); end if;
  if v.utilisateur <> socle.moi() and v_role <> 'direction' then perform socle.refus('seule la direction oublie l''appareil d''un autre membre'); end if;
  if v.revoque_le is not null then perform socle.refus('cet appareil est déjà oublié'); end if;
  update socle.appareil set revoque_le = p_maintenant, reconnu_jusqu_au = null where id = p_appareil;
  update plateforme.session_console set fermee_le = p_maintenant where appareil = p_appareil and fermee_le is null;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.appareil_oublie', v.utilisateur, btrim(p_motif),
            jsonb_build_object('appareil', v.nom, 'reconnuJusquAu', v.reconnu_jusqu_au), jsonb_build_object('oublieLe', p_maintenant));
end $$;

-- ── 6. Les demandes closes, par pages ───────────────────────────────────────────────────────────────────────────────
drop function plateforme.console_support(uuid, uuid);
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
revoke execute on function plateforme.console_support(uuid, uuid, integer) from public;
grant execute on function plateforme.console_support(uuid, uuid, integer) to skanfact_app;

-- ── 7. Le journal, exploitable ──────────────────────────────────────────────────────────────────────────────────────
-- La sorte d'un geste, lue dans son nom : le filtre du journal et la couleur de chacune (la maquette Journal).
create function plateforme.sorte_du_geste(p_geste text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case
    when p_geste like 'support.acces%' then 'acces'
    when p_geste like 'abonnement.%' or p_geste like 'groupes.%' then 'abonnements'
    when p_geste like 'service.%' or p_geste like 'versions.%' then 'service'
    when p_geste like 'systeme.%' then 'systeme'
    else split_part(p_geste, '.', 1) end
$$;

-- Le journal : les gestes de l'équipe et de l'outil de l'exploitation ; et, demandé, ce que le système a fait seul (les
-- relances parties, les paiements reconnus par le prestataire), sans motif. Filtres : qui, une entreprise, la sorte, depuis
-- quand, un mot (le motif, le client, la personne), les gestes réservés à la direction (leur liste vient du serveur, lue
-- dans la liste des gestes : jamais recopiée ici). Le support n'y lit que ses propres gestes.
drop function plateforme.console_journal(uuid, uuid, timestamptz, uuid, int);
create function plateforme.console_journal(p_qui uuid, p_entreprise uuid, p_avant_le timestamptz, p_avant_id uuid, p_limite int,
  p_sorte text, p_depuis timestamptz, p_q text, p_reserves text[], p_systeme boolean) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_qui uuid := case when v_role = 'support' then socle.moi() else p_qui end;
  v_q text := nullif(lower(btrim(coalesce(p_q, ''))), '');
begin
  return (select coalesce(jsonb_agg(x.v order by x.le desc, x.id desc), '[]'::jsonb) from (
    select g.le, g.id, jsonb_build_object(
      'id', g.id, 'le', g.le, 'curseur', g.le::text, 'role', g.role, 'geste', g.geste, 'sorte', plateforme.sorte_du_geste(g.geste),
      'motif', g.motif, 'avant', g.avant, 'apres', g.apres, 'systeme', false,
      'qui', (select jsonb_build_object('id', u.id, 'nom', u.nom) from socle.utilisateur u where u.id = g.qui),
      'entreprise', (select jsonb_build_object('id', e.id, 'raisonSociale', e.raison_sociale) from socle.entreprise e where e.id = g.entreprise),
      'membre', (select jsonb_build_object('id', u.id, 'nom', u.nom) from socle.utilisateur u where u.id = g.membre)) v
      from plateforme.geste_console g
     where (v_qui is null or g.qui = v_qui) and (p_entreprise is null or g.entreprise = p_entreprise)
       and (p_sorte is null or plateforme.sorte_du_geste(g.geste) = p_sorte)
       and (p_depuis is null or g.le >= p_depuis)
       and (p_reserves is null or g.geste = any(p_reserves))
       and (v_q is null or strpos(lower(g.motif), v_q) > 0
            or exists (select 1 from socle.entreprise e where e.id = g.entreprise and strpos(lower(e.raison_sociale), v_q) > 0)
            or exists (select 1 from socle.utilisateur u where u.id in (g.qui, g.membre) and strpos(lower(u.nom), v_q) > 0))
       and (g.le, g.id) < (coalesce(p_avant_le, 'infinity'), coalesce(p_avant_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
    union all
    -- Le système, seul : la direction, et seulement demandé (sans personne choisie, sans « réservés »).
    select y.le, y.id, jsonb_build_object('id', y.id, 'le', y.le, 'curseur', y.le::text, 'role', null, 'geste', y.geste, 'sorte', 'systeme',
      'motif', '', 'avant', null, 'apres', y.apres, 'systeme', true, 'qui', null, 'membre', null,
      'entreprise', jsonb_build_object('id', e.id, 'raisonSociale', e.raison_sociale)) v
      from (select r.partie_le le, md5(r.entreprise::text || r.echeance::text || r.rang)::uuid id, r.entreprise, 'systeme.relance' geste,
                   jsonb_build_object('echeance', r.echeance, 'rang', r.rang) apres
              from plateforme.relance_abonnement r
            union all
            select v.le, v.id, v.entreprise, 'systeme.paiement', jsonb_build_object('facture', v.apres->'facture', 'payeJusquAu', v.apres->'paye_jusqu_au')
              from plateforme.evenement_abonnement v where v.nature = 'paye' and v.par = 'systeme') y
      join socle.entreprise e on e.id = y.entreprise
     where v_role = 'direction' and p_systeme and v_qui is null and p_reserves is null
       and (p_entreprise is null or y.entreprise = p_entreprise) and (p_sorte is null or p_sorte = 'systeme')
       and (p_depuis is null or y.le >= p_depuis) and (v_q is null or strpos(lower(e.raison_sociale), v_q) > 0)
       and (y.le, y.id) < (coalesce(p_avant_le, 'infinity'), coalesce(p_avant_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
    order by 1 desc, 2 desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) x);
end $$;

-- Les gestes écrits au journal, chacun une fois : le serveur en tire ceux qui sont réservés à la direction (lus dans sa
-- liste des gestes, jamais recopiés ici).
create function plateforme.console_gestes_ecrits() returns text[]
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(array_agg(distinct g.geste order by g.geste), '{}') from plateforme.geste_console g);
end $$;

-- Les quatre chiffres du journal, sur trente jours : les gestes de l'équipe (les siens, pour le support), ceux réservés à la
-- direction, ce que le système a fait seul ; et les accès aux dossiers ouverts en ce moment.
create function plateforme.console_journal_chiffres(p_depuis timestamptz, p_reserves text[], p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v_moi uuid := socle.moi();
begin
  return jsonb_build_object(
    'gestes', (select count(*) from plateforme.geste_console g where g.le >= p_depuis and g.qui is not null and (v_role = 'direction' or g.qui = v_moi)),
    'reserves', case when v_role = 'direction' then (select count(*) from plateforme.geste_console g where g.le >= p_depuis and g.geste = any(p_reserves)) end,
    'systeme', case when v_role = 'direction' then
      (select count(*) from plateforme.relance_abonnement r where r.partie_le >= p_depuis)
      + (select count(*) from plateforme.evenement_abonnement v where v.nature = 'paye' and v.par = 'systeme' and v.le >= p_depuis) end,
    'accesOuverts', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.raison_sociale, 'fin', a.fin) order by a.fin), '[]'::jsonb)
                       from plateforme.acces_support a join socle.entreprise e on e.id = a.entreprise
                      where plateforme.acces_support_etat(a, p_maintenant) = 'actif' and (v_role = 'direction' or a.demandeur = v_moi)));
end $$;

-- Les accès aux dossiers, le plus récent d'abord, par pages de cinquante : tous pour la direction, les siens pour le
-- support. Chacun dit son client, son état, qui l'a demandé et accordé, et chaque page lue (plateforme.acces_support_json).
create function plateforme.console_acces_tous(p_debut integer, p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v_moi uuid := socle.moi();
begin
  return jsonb_build_object(
    'total', (select count(*) from plateforme.acces_support a where v_role = 'direction' or a.demandeur = v_moi),
    'lignes', (select coalesce(jsonb_agg(plateforme.acces_support_json(a, p_maintenant, true)
                 || jsonb_build_object('nom', (select e.raison_sociale from socle.entreprise e where e.id = a.entreprise))
                 order by a.demande_le desc, a.id desc), '[]'::jsonb)
                 from (select * from plateforme.acces_support a where v_role = 'direction' or a.demandeur = v_moi
                        order by a.demande_le desc, a.id desc offset greatest(coalesce(p_debut, 0), 0) limit 50) a));
end $$;

-- ── 8. Une facture que ses avoirs annulent, timbre mis à part, est défaite ──────────────────────────────────────────
create or replace function plateforme.console_paiements(p_mois date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_editeur uuid;
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin date := (date_trunc('month', p_mois) + interval '1 month' - interval '1 day')::date;
begin
  select d.entreprise into v_editeur from plateforme.editeur d;
  return jsonb_build_object(
    'mois', to_char(v_debut, 'YYYY-MM'),
    'editeur', (select jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale, 'devise', e.devise_base,
                  'decimales', (select dv.decimales from socle.devise dv where dv.code = e.devise_base))
                  from socle.entreprise e where e.id = v_editeur),
    -- Les règlements du mois sur nos factures, le plus récent d'abord ; un montant négatif est un remboursement.
    'recus', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', r.id, 'date', r.date_reglement, 'montant', r.montant::text, 'devise', p.devise, 'decimales', dv.decimales,
                  'mode', r.mode, 'reference', r.reference, 'numero', p.numero_texte, 'piece', f.piece_v10, 'editeur', f.editeur,
                  'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale), 'noteLe', r.cree_le,
                  'enLigne', (select jsonb_build_object('prestataire', l.prestataire, 'prouveLe', l.prouve_le)
                                from ventes.paiement_en_ligne l
                               where l.entreprise = r.entreprise and l.statut = 'encaisse' and l.reglement_v10 = r.ref_v10))
                  order by r.date_reglement desc, r.cree_le desc, r.id desc), '[]'::jsonb)
                from plateforme.facture_abonnement f
                join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                join ventes.reglement r on r.entreprise = p.entreprise and r.piece = p.id
                join socle.entreprise e on e.id = f.entreprise
                left join socle.devise dv on dv.code = p.devise
               where f.editeur = v_editeur and r.date_reglement between v_debut and v_fin),
    -- Les factures émises dont le solde n'est pas nul aujourd'hui (net − avoirs − règlements ≠ 0) : qui doit, qui a trop
    -- payé. Tout mois confondu : une dette ne s'arrête pas à la fin du mois.
    'ouvertes', (select coalesce(jsonb_agg(x.v order by x.echeance nulls last, x.numero), '[]'::jsonb) from (
                  select p.echeance, p.numero_texte numero, jsonb_build_object(
                    'piece', f.piece_v10, 'editeur', f.editeur, 'numero', p.numero_texte, 'echeance', p.echeance,
                    'debut', f.debut, 'fin', f.fin, 'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text, 'timbre', coalesce(p.timbre, 0)::text,
                    'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
                    'avoirs', (select coalesce(jsonb_agg(a.net_a_payer::text), '[]'::jsonb) from ventes.piece a
                                where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'),
                    'reglements', (select coalesce(jsonb_agg(r.montant::text), '[]'::jsonb) from ventes.reglement r
                                    where r.entreprise = p.entreprise and r.piece = p.id)) v
                    from plateforme.facture_abonnement f
                    join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                    join socle.entreprise e on e.id = f.entreprise
                    left join socle.devise dv on dv.code = p.devise
                   where f.editeur = v_editeur
                     and p.net_a_payer
                         - (select coalesce(sum(a.net_a_payer), 0) from ventes.piece a where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise')
                         - (select coalesce(sum(r.montant), 0) from ventes.reglement r where r.entreprise = p.entreprise and r.piece = p.id) <> 0) x),
    -- Les factures préparées qui attendent d'être émises dans l'application de SkanFact : elles ne doivent rien encore.
    'aEmettre', (select coalesce(jsonb_agg(jsonb_build_object('piece', f.piece_v10, 'editeur', f.editeur, 'debut', f.debut, 'fin', f.fin,
                    'prepareLe', f.prepare_le, 'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale))
                    order by f.prepare_le), '[]'::jsonb)
                  from plateforme.facture_abonnement f
                  join socle.entreprise e on e.id = f.entreprise
                  join socle.dossier_v10 d on d.entreprise = f.editeur and d.collection = 'documents' and d.cle = f.piece_v10
                 where f.editeur = v_editeur
                   and not exists (select 1 from ventes.piece p where p.entreprise = f.editeur and p.ref_v10 = f.piece_v10
                                     and p.type = 'facture' and p.statut = 'emise')),
    -- Les coûts du mois, retirés compris (la trace) : le premier saisi d'abord.
    'couts', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'libelle', c.libelle, 'montant', c.montant::text, 'dApres', c.d_apres,
                  'saisiLe', c.saisi_le, 'saisiPar', (select u.nom from socle.utilisateur u where u.id = c.saisi_par),
                  'retireLe', c.retire_le, 'retirePar', (select u.nom from socle.utilisateur u where u.id = c.retire_par))
                  order by c.saisi_le, c.id), '[]'::jsonb)
                from plateforme.cout_du_mois c where c.mois = v_debut),
    -- Reçus hors de la plateforme ce mois (le jour du paiement, pas celui du geste), par l'entreprise SkanFact ; le plus
    -- récent d'abord.
    'horsPlateforme', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'date', v.apres->>'le', 'montant', v.apres->>'montant',
                          'moyen', v.apres->>'moyen', 'facture', v.apres->>'facture', 'noteLe', v.le,
                          'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
                          'par', (select u.nom from plateforme.geste_console g join socle.utilisateur u on u.id = g.qui where g.evenement = v.id limit 1))
                          order by v.apres->>'le' desc, v.le desc), '[]'::jsonb)
                        from plateforme.evenement_abonnement v join socle.entreprise e on e.id = v.entreprise
                       where v.nature = 'paye' and v.par = 'exploitation' and v.apres->>'le' ~ '^\d{4}-\d{2}-\d{2}$'
                         and v.apres->>'montant' ~ '^[0-9]+$' and (v.apres->>'le')::date between v_debut and v_fin
                         and v.apres->>'editeur' = v_editeur::text),
    -- Payées, puis défaites : un avoir qui l'annule (« avoir »), ou un règlement retiré (« reglement ») — la cause se dit,
    -- elle ne demande pas le même geste. Les droits, eux, ont couru : la direction décide.
    'defaites', (select coalesce(jsonb_agg(jsonb_build_object('piece', f.piece_v10, 'editeur', f.editeur, 'numero', p.numero_texte,
                    'payeeLe', f.payee_le, 'debut', f.debut, 'fin', f.fin, 'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
                    'cause', case when s.avoirs > 0 and s.avoirs >= p.net_a_payer - coalesce(p.timbre, 0) then 'avoir' else 'reglement' end)
                    order by f.payee_le), '[]'::jsonb)
                  from plateforme.facture_abonnement f
                  join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                  join socle.entreprise e on e.id = f.entreprise
                  cross join lateral (select
                    (select coalesce(sum(a.net_a_payer), 0) from ventes.piece a where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise') avoirs,
                    (select coalesce(sum(r.montant), 0) from ventes.reglement r where r.entreprise = p.entreprise and r.piece = p.id) regle) s
                 where f.editeur = v_editeur and f.payee_le is not null
                   and ((s.avoirs > 0 and s.avoirs >= p.net_a_payer - coalesce(p.timbre, 0)) or p.net_a_payer - s.avoirs - s.regle > 0))
  );
end
$$;

-- Exporter la sélection du journal (la maquette Journal) : la direction seule, avec son motif ; le geste s'écrit au journal
-- à son tour (le nombre de lignes et les filtres, jamais les lignes).
create or replace function plateforme.console_noter_export(p_quoi text, p_lignes integer, p_filtres jsonb, p_motif text) returns uuid
language plpgsql security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_quoi is null or p_quoi not in ('clients', 'journal') then perform socle.refus('cet export n''existe pas'); end if;
  if p_lignes is null or p_lignes < 0 then perform socle.refus('cet export n''existe pas'); end if;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, p_quoi || '.exporte', btrim(p_motif), null,
            jsonb_build_object('lignes', p_lignes, 'filtres', coalesce(p_filtres, '{}'::jsonb)))
    returning id into v_id;
  return v_id;
end
$$;

revoke execute on function plateforme.pieces_creees(uuid), plateforme.console_appareils_membre(uuid, timestamptz),
  plateforme.console_fermer_session(uuid, text, timestamptz), plateforme.console_oublier_appareil(uuid, text, timestamptz),
  plateforme.sorte_du_geste(text),
  plateforme.console_journal(uuid, uuid, timestamptz, uuid, int, text, timestamptz, text, text[], boolean),
  plateforme.console_journal_chiffres(timestamptz, text[], timestamptz), plateforme.console_acces_tous(integer, timestamptz),
  plateforme.console_gestes_ecrits() from public;
grant execute on function plateforme.console_appareils_membre(uuid, timestamptz), plateforme.console_fermer_session(uuid, text, timestamptz),
  plateforme.console_oublier_appareil(uuid, text, timestamptz),
  plateforme.console_journal(uuid, uuid, timestamptz, uuid, int, text, timestamptz, text, text[], boolean),
  plateforme.console_journal_chiffres(timestamptz, text[], timestamptz), plateforme.console_acces_tous(integer, timestamptz),
  plateforme.console_gestes_ecrits() to skanfact_app;
