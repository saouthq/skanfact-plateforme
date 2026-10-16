-- 0137 : l'audit de la console 1.42.0, lot 2a (1.45.0 ; docs/console.md C61) : trois constats.
--   - A10 : un secret collé dans le MOTIF d'un geste du registre des secrets passait (le contrôle ne lisait que le nom,
--     le rôle et l'emplacement), et restait au journal. Le motif passe désormais par le même contrôle.
--   - A06 : l'arrivée d'un client qui n'a jamais payé disparaissait au trentième jour, juste quand la dernière marche
--     (l'abonnement) se bloquait. Elle dure désormais jusqu'à son issue : il paie (converti), ou un membre la CLÔT avec
--     son motif (abandonnée, suivie ailleurs) ; une arrivée close se rouvre.
--   - A05 : préparer une facture faisait disparaître sa période des prévisions. La facture préparée dit maintenant son
--     montant hors taxes à « Ce qui doit rentrer », qui la range dans sa propre colonne.

-- ── A10 : le motif aussi ─────────────────────────────────────────────────────────────────────────────────────────────
-- Une aide, pas une garantie : une suite de trente-deux caractères d'une clé (lettres, chiffres, + = _ -) est refusée.
create function plateforme.motif_sans_secret(p_motif text) returns void
language plpgsql immutable set search_path = pg_catalog, socle as $$
begin
  if coalesce(p_motif, '') ~ '[A-Za-z0-9+=_-]{32,}' then
    perform socle.refus('ce motif ressemble à la valeur d''un secret : il reste au journal, on n''y colle jamais une clé ; dis ce que tu as fait (« clé changée dans le coffre »)');
  end if;
end $$;
revoke execute on function plateforme.motif_sans_secret(text) from public;

create or replace function plateforme.console_noter_secret(p_nom text, p_role text, p_ou text, p_renouvele_le date, p_expire_le date, p_rotation integer,
  p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  perform plateforme.secret_textes_sains(p_nom, p_role, p_ou);
  if length(btrim(coalesce(p_nom, ''))) not between 3 and 80 then perform socle.refus('le nom d''un secret : de trois à quatre-vingts caractères'); end if;
  if length(btrim(coalesce(p_role, ''))) not between 3 and 200 or length(btrim(coalesce(p_ou, ''))) not between 3 and 200 then
    perform socle.refus('à quoi sert un secret, et où il vit : de trois à deux cents caractères chacun');
  end if;
  if p_renouvele_le is null or p_renouvele_le > (p_maintenant at time zone 'Africa/Tunis')::date then
    perform socle.refus('le jour où le secret a été renouvelé : aujourd''hui ou avant');
  end if;
  if p_expire_le is not null and p_expire_le < p_renouvele_le then perform socle.refus('un secret n''expire pas avant d''avoir été renouvelé'); end if;
  if p_rotation is not null and p_rotation not between 1 and 3650 then perform socle.refus('un rythme de renouvellement : d''un jour à dix ans'); end if;
  if exists (select 1 from plateforme.secret_suivi s where lower(btrim(s.nom)) = lower(btrim(p_nom)) and s.retire_le is null) then
    perform socle.refus('ce secret est déjà suivi : note son renouvellement sur sa ligne');
  end if;
  insert into plateforme.secret_suivi (nom, role, ou, renouvele_le, expire_le, rotation_jours, note_le, note_par)
    values (btrim(p_nom), btrim(p_role), btrim(p_ou), p_renouvele_le, p_expire_le, p_rotation, p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'service.secret_note', null, btrim(p_motif), null,
            jsonb_build_object('nom', btrim(p_nom), 'renouveleLe', p_renouvele_le, 'expireLe', p_expire_le, 'rotationJours', p_rotation));
  return v_id;
end $$;


create or replace function plateforme.console_secret_renouvele(p_id uuid, p_le date, p_expire_le date, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); s plateforme.secret_suivi;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  select * into s from plateforme.secret_suivi where id = p_id and retire_le is null for update;
  if not found then perform socle.refus('ce secret n''est pas suivi'); end if;
  if p_le is null or p_le > (p_maintenant at time zone 'Africa/Tunis')::date then
    perform socle.refus('le jour où le secret a été renouvelé : aujourd''hui ou avant');
  end if;
  if p_le < s.renouvele_le then perform socle.refus('un renouvellement vient après le précédent'); end if;
  if p_expire_le is not null and p_expire_le < p_le then perform socle.refus('un secret n''expire pas avant d''avoir été renouvelé'); end if;
  update plateforme.secret_suivi set renouvele_le = p_le, expire_le = p_expire_le where id = s.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'service.secret_renouvele', null, btrim(p_motif),
            jsonb_build_object('nom', s.nom, 'renouveleLe', s.renouvele_le, 'expireLe', s.expire_le),
            jsonb_build_object('nom', s.nom, 'renouveleLe', p_le, 'expireLe', p_expire_le));
end $$;


create or replace function plateforme.console_retirer_secret(p_id uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); s plateforme.secret_suivi;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  select * into s from plateforme.secret_suivi where id = p_id and retire_le is null for update;
  if not found then perform socle.refus('ce secret n''est pas suivi'); end if;
  update plateforme.secret_suivi set retire_le = p_maintenant, retire_par = socle.moi() where id = s.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'service.secret_retire', null, btrim(p_motif), jsonb_build_object('nom', s.nom), null);
end $$;



-- ── A06 : l'arrivée dure jusqu'à son issue ───────────────────────────────────────────────────────────────────────────
-- Une arrivée close : le client ne s'abonnera pas (il a abandonné, il est suivi ailleurs), dit par un membre avec son
-- motif. Une ligne par entreprise ; la rouvrir l'efface (le journal garde les deux gestes).
create table plateforme.arrivee_close (
  entreprise uuid primary key references socle.entreprise(id),
  close_le timestamptz not null,
  close_par uuid not null references socle.utilisateur(id),
  motif text not null check (length(btrim(motif)) between 3 and 500)
);
alter table plateforme.arrivee_close enable row level security;
alter table plateforme.arrivee_close force row level security;

-- Clore l'arrivée d'un client : la direction ou le support, avec le motif (ce qu'il a dit, à qui il est confié).
create function plateforme.console_clore_arrivee(p_entreprise uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  if length(btrim(coalesce(p_motif, ''))) not between 3 and 500 then
    perform socle.refus('pourquoi son arrivée se clôt : de trois à cinq cents caractères ; il reste au journal');
  end if;
  perform 1 from socle.entreprise where id = p_entreprise and not essai for update;
  if not found then perform socle.refus('cette entreprise n''existe pas'); end if;
  if exists (select 1 from plateforme.arrivee_close where entreprise = p_entreprise) then
    perform socle.refus('son arrivée est déjà close : rouvre-la d''abord si elle reprend');
  end if;
  insert into plateforme.arrivee_close (entreprise, close_le, close_par, motif) values (p_entreprise, p_maintenant, socle.moi(), btrim(p_motif));
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.arrivee_close', p_entreprise, btrim(p_motif), null, jsonb_build_object('closeLe', p_maintenant));
end $$;

-- La rouvrir : il revient, ou elle a été close par erreur.
create function plateforme.console_rouvrir_arrivee(p_entreprise uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); a plateforme.arrivee_close;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  delete from plateforme.arrivee_close where entreprise = p_entreprise returning * into a;
  if not found then perform socle.refus('son arrivée n''est pas close'); end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.arrivee_rouverte', p_entreprise, btrim(p_motif),
            jsonb_build_object('closeLe', a.close_le, 'motif', a.motif), null);
end $$;

revoke execute on function plateforme.console_clore_arrivee(uuid, text, timestamptz), plateforme.console_rouvrir_arrivee(uuid, text, timestamptz) from public;
grant execute on function plateforme.console_clore_arrivee(uuid, text, timestamptz), plateforme.console_rouvrir_arrivee(uuid, text, timestamptz) to skanfact_app;

-- La liste des clients dit en plus si son arrivée est close (la fonction de 0127, un champ de plus).
create or replace function plateforme.console_clients_en_plus(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_jour is null then perform socle.refus('le jour de la liste manque'); end if;
  return (select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
      'piecesMois', (select count(*) from ventes.piece p where p.entreprise = e.id and p.statut = 'emise'
                       and (p.emise_le at time zone e.fuseau)::date between date_trunc('month', p_jour)::date and p_jour),
      'prolonge', (select coalesce(sum((v.apres ->> 'jours')::int), 0) from plateforme.evenement_abonnement v
                    where v.entreprise = e.id and v.nature = 'essai_prolonge' and jsonb_typeof(v.apres -> 'jours') = 'number'),
      'essaiJours', (select (v.apres ->> 'essaiJusquAu')::date - (v.le at time zone e.fuseau)::date from plateforme.evenement_abonnement v
                      where v.entreprise = e.id and v.nature = 'essai_commence' and v.apres ->> 'essaiJusquAu' ~ '^\d{4}-\d{2}-\d{2}$'
                      order by v.le limit 1),
      'prolongeUneFois', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'essai_prolonge'),
      'moisOffertRecent', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'mois_offert'
                                    and v.le > (p_jour - 365)::timestamptz),
      -- 0127 : le jour (de son fuseau) de sa première facture émise — une note d'honoraires compte —, sa première
      -- utilisation réelle (serveur/console/arrivee.ts).
      'premiereFactureLe', (select (min(p.emise_le) at time zone e.fuseau)::date from ventes.piece p
                             where p.entreprise = e.id and p.type in ('facture', 'note_honoraires') and p.statut = 'emise'),
      -- 0137 : son arrivée close (l'audit 1.42.0 A06) : quand, par qui, pourquoi ; vide si elle ne l'est pas.
      'arriveeClose', (select jsonb_build_object('le', a.close_le, 'par', (select u.nom from socle.utilisateur u where u.id = a.close_par), 'motif', a.motif)
                         from plateforme.arrivee_close a where a.entreprise = e.id),
      'factures', case when exists (select 1 from plateforme.facture_abonnement f where f.entreprise = e.id and f.payee_le is null)
                       then plateforme.console_factures_abonnement(e.id) else '[]'::jsonb end)), '{}'::jsonb)
    from socle.entreprise e
   where not e.essai);
end $$;


-- ── A05 : une facture préparée dit son hors-taxes ────────────────────────────────────────────────────────────────────
-- La fonction de 0114, un champ de plus aux factures qui attendent d'être émises : le hors-taxes noté à leur préparation
-- (la règle de la facture, celle du renouvellement qu'elle remplace).
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
                    'prepareLe', f.prepare_le, 'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
                    'montantHt', f.montant_ht::text)
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
