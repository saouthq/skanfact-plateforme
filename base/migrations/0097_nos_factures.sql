-- Nos factures, première partie (14b, 14/10/2026 ; docs/abonnement.md B1–B4 ; skanfact docs/cadrage/10-console.md § 2.5,
-- 01 § 18 : « SkanFact est une entreprise de sa propre plateforme ; on n'écrit pas un second système de facturation »).
--
-- 1. L'entreprise SkanFact : une entreprise de la plateforme, désignée UNE fois par la direction, qui en est propriétaire
--    (le compte de la console est celui de l'application). Nos factures naissent dans son dossier : son moteur, sa
--    numérotation, sa TVA, sa facture électronique, sa comptabilité. Elle ne se facture pas à elle-même : son abonnement
--    passe « offert ». Une fois une facture préparée, elle ne se change plus (ses factures y vivent).
-- 2. Les factures d'abonnement : ce qui relie une pièce de son dossier à l'abonnement qu'elle paie (l'abonné, l'offre, la
--    période, le prix hors taxes du jour). La pièce elle-même (le numéro, les montants, les règlements) vit dans le
--    dossier et dans ventes : ici, seulement le lien.
-- 3. Payée, la facture paie l'abonnement. La base le CONSTATE elle-même, sur les pièces (net à payer − avoirs émis −
--    règlements, la règle de moteur/reglements.ts) : rien de ce qu'on lui passe n'est cru. Une fois par facture ; une
--    couverture qui va déjà au-delà ne bouge pas.

-- ── 1. L'entreprise SkanFact ─────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.editeur (
  seul boolean primary key default true check (seul),
  entreprise uuid not null references socle.entreprise(id),
  pose_le timestamptz not null default now(),
  pose_par uuid not null references socle.utilisateur(id)
);
alter table plateforme.editeur enable row level security;
alter table plateforme.editeur force row level security;

-- ── 2. Les factures d'abonnement ─────────────────────────────────────────────────────────────────────────────────────
create table plateforme.facture_abonnement (
  id uuid primary key default socle.uuidv7(),
  -- L'abonné : l'entreprise dont l'abonnement est payé.
  entreprise uuid not null references socle.entreprise(id),
  -- L'entreprise SkanFact, et la pièce de son dossier (sa clé) ; la fiche du client dans ce dossier (reprise ensuite).
  editeur uuid not null references socle.entreprise(id),
  piece_v10 text not null,
  client_v10 text not null,
  offre text not null check (offre in ('essentiel', 'complet')),
  periodicite text not null check (periodicite in ('annuel', 'mensuel')),
  -- La période que la facture paie : des jours de calendrier (01 R5). Elle fait foi.
  debut date not null,
  fin date not null check (fin >= debut),
  -- Hors taxes, en millimes : le prix du jour de la préparation (plateforme.prix).
  montant_ht bigint not null check (montant_ht > 0),
  prepare_le timestamptz not null default now(),
  prepare_par uuid not null references socle.utilisateur(id),
  -- Constatée payée (une fois), et l'événement qu'elle a posé sur l'abonnement (vide : la couverture allait déjà au-delà).
  payee_le timestamptz,
  evenement uuid references plateforme.evenement_abonnement(id),
  check (entreprise <> editeur),
  unique (editeur, piece_v10)
);
create index facture_abonnement_entreprise on plateforme.facture_abonnement (entreprise, debut desc);
alter table plateforme.facture_abonnement enable row level security;
alter table plateforme.facture_abonnement force row level security;

-- Le propriétaire de l'entreprise SkanFact est moi, et elle est désignée : sinon, rien ne se facture.
create function plateforme.editeur_de_mes_factures() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v uuid;
begin
  select d.entreprise into v from plateforme.editeur d;
  if v is null then perform socle.refus('l''entreprise SkanFact n''est pas désignée : la direction la désigne dans les Réglages, « Nos factures »'); end if;
  if not exists (select 1 from socle.membre m where m.entreprise = v and m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles)) then
    perform socle.refus('nos factures s''écrivent au nom du propriétaire de l''entreprise SkanFact : tu ne l''es pas');
  end if;
  return v;
end $$;

-- Ce que la console lit : l'entreprise désignée (et si j'en suis propriétaire), et celles que je pourrais désigner.
create function plateforme.console_editeur() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return jsonb_build_object(
    'editeur', (select jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal,
                  'poseLe', d.pose_le, 'posePar', (select u.nom from socle.utilisateur u where u.id = d.pose_par),
                  'proprietaire', exists (select 1 from socle.membre m where m.entreprise = e.id and m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles)),
                  'factures', (select count(*) from plateforme.facture_abonnement f where f.editeur = e.id))
                  from plateforme.editeur d join socle.entreprise e on e.id = d.entreprise),
    'possibles', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal)
                    order by e.raison_sociale, e.id), '[]'::jsonb)
                    from socle.membre m join socle.entreprise e on e.id = m.entreprise
                   where m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles) and not e.essai and e.active));
end $$;

-- Désigner l'entreprise SkanFact (la direction, qui en est propriétaire). Son abonnement passe « offert ».
create function plateforme.console_poser_editeur(p_entreprise uuid, p_motif text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_nom text;
  v_avant uuid;
  v_ligne plateforme.abonnement;
  v_evenement uuid;
  v_geste uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select e.raison_sociale into v_nom from socle.entreprise e
   where e.id = p_entreprise and not e.essai and e.active
     and exists (select 1 from socle.membre m where m.entreprise = e.id and m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles));
  if v_nom is null then perform socle.refus('nos factures naissent dans une entreprise dont tu es propriétaire : ce n''est pas le cas de celle-ci'); end if;
  select d.entreprise into v_avant from plateforme.editeur d for update;
  if v_avant = p_entreprise then perform socle.refus('c''est déjà l''entreprise de nos factures'); end if;
  if v_avant is not null and exists (select 1 from plateforme.facture_abonnement f where f.editeur = v_avant) then
    perform socle.refus('des factures sont déjà préparées dans l''entreprise SkanFact désignée : elles y vivent, et elle ne se change plus');
  end if;
  insert into plateforme.editeur (seul, entreprise, pose_par) values (true, p_entreprise, socle.moi())
    on conflict (seul) do update set entreprise = excluded.entreprise, pose_le = now(), pose_par = excluded.pose_par;
  -- Elle ne se facture pas à elle-même.
  select * into v_ligne from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  if found and not v_ligne.offert then
    update plateforme.abonnement set offert = true, modifie_le = now() where entreprise = p_entreprise;
    insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
      values (p_entreprise, 'offert', 'exploitation', 'l''entreprise de SkanFact : elle ne se facture pas à elle-même',
              plateforme.ligne_abonnement(v_ligne), plateforme.ligne_abonnement(v_ligne) || jsonb_build_object('offert', true))
      returning id into v_evenement;
  end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, evenement, motif, avant, apres)
    values (socle.moi(), v_role, 'factures.editeur', p_entreprise, v_evenement, btrim(p_motif),
            case when v_avant is null then null else jsonb_build_object('entreprise', v_avant,
              'raisonSociale', (select e.raison_sociale from socle.entreprise e where e.id = v_avant)) end,
            jsonb_build_object('entreprise', p_entreprise, 'raisonSociale', v_nom))
    returning id into v_geste;
  return v_geste;
end $$;

-- La facture préparée : le serveur vient d'écrire la fiche du client et le brouillon dans le dossier de l'entreprise
-- SkanFact (dans la même transaction, au nom de la personne) ; la base vérifie qu'ils y sont, que le prix est celui du
-- jour, et note le lien et le geste. Une facture déjà payée ne se refait pas.
create function plateforme.console_noter_facture(p_entreprise uuid, p_piece_v10 text, p_client_v10 text, p_offre text, p_periodicite text,
                                                 p_debut date, p_fin date, p_montant_ht bigint, p_motif text, p_jour date) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_editeur uuid := plateforme.editeur_de_mes_factures();
  v_prix bigint;
  v_f plateforme.facture_abonnement;
  v_geste uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_entreprise = v_editeur then perform socle.refus('l''entreprise SkanFact ne se facture pas à elle-même'); end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;
  select x.montant_ht into v_prix from plateforme.prix x
   where x.offre = p_offre and x.periodicite = p_periodicite and x.a_partir_du <= p_jour order by x.a_partir_du desc limit 1;
  if v_prix is null or v_prix <> p_montant_ht then perform socle.refus('le prix n''est pas celui du jour : relis-le avant de préparer la facture'); end if;
  if not exists (select 1 from socle.dossier_v10 d where d.entreprise = v_editeur and d.collection = 'documents' and d.cle = p_piece_v10)
     or not exists (select 1 from socle.dossier_v10 d where d.entreprise = v_editeur and d.collection = 'clients' and d.cle = p_client_v10) then
    raise exception 'la facture préparée manque au dossier de l''entreprise SkanFact : %', p_piece_v10;
  end if;
  select * into v_f from plateforme.facture_abonnement f where f.editeur = v_editeur and f.piece_v10 = p_piece_v10 for update;
  if found and (v_f.entreprise <> p_entreprise or v_f.payee_le is not null) then
    perform socle.refus('cette facture est déjà payée : elle ne se refait pas');
  end if;
  insert into plateforme.facture_abonnement (entreprise, editeur, piece_v10, client_v10, offre, periodicite, debut, fin, montant_ht, prepare_par)
    values (p_entreprise, v_editeur, p_piece_v10, p_client_v10, p_offre, p_periodicite, p_debut, p_fin, p_montant_ht, socle.moi())
    on conflict (editeur, piece_v10) do update set client_v10 = excluded.client_v10, offre = excluded.offre, periodicite = excluded.periodicite,
      debut = excluded.debut, fin = excluded.fin, montant_ht = excluded.montant_ht, prepare_le = now(), prepare_par = excluded.prepare_par;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'factures.preparer', p_entreprise, btrim(p_motif), null,
            -- « facturée », jamais « payée » : préparer n'encaisse rien ; le montant en dinars, comme l'écran l'écrit.
            jsonb_build_object('offre', p_offre, 'periodicite', p_periodicite, 'factureDu', p_debut, 'factureAu', p_fin,
              'montantHt', (p_montant_ht::numeric / 1000)::numeric(16, 3)::text))
    returning id into v_geste;
  return v_geste;
end $$;

-- Les factures d'abonnement d'une entreprise, telles que la console les montre : le lien, et la pièce de l'entreprise
-- SkanFact (brouillon tant qu'elle n'est pas au serveur ; ses montants en entiers, en texte).
create function plateforme.console_factures_abonnement(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'editeur', f.editeur, 'piece', f.piece_v10, 'client', f.client_v10, 'offre', f.offre, 'periodicite', f.periodicite,
      'debut', f.debut, 'fin', f.fin, 'montantHt', f.montant_ht::text, 'prepareLe', f.prepare_le,
      'preparePar', (select u.nom from socle.utilisateur u where u.id = f.prepare_par), 'payeeLe', f.payee_le,
      'dansLeDossier', d.cle is not null,
      'numero', p.numero_texte, 'emise', p.statut = 'emise', 'echeance', coalesce(p.echeance::text, d.contenu ->> 'dueDate'),
      'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
      'avoirs', case when p.id is null then '[]'::jsonb else (select coalesce(jsonb_agg(a.net_a_payer::text), '[]') from ventes.piece a
                  where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise') end,
      'reglements', case when p.id is null then '[]'::jsonb else (select coalesce(jsonb_agg(r.montant::text), '[]') from ventes.reglement r
                      where r.entreprise = p.entreprise and r.piece = p.id) end)
      order by f.debut desc, f.prepare_le desc), '[]'::jsonb)
    from plateforme.facture_abonnement f
    left join socle.dossier_v10 d on d.entreprise = f.editeur and d.collection = 'documents' and d.cle = f.piece_v10
    left join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
    left join socle.devise dv on dv.code = p.devise
   where f.entreprise = p_entreprise);
end $$;

-- ── 3. Payée, la facture paie l'abonnement ───────────────────────────────────────────────────────────────────────────
-- Appelée par le serveur après chaque règlement d'une facture du dossier (dans la transaction de la personne qui l'a noté,
-- ou du paiement en ligne). Elle ne croit rien de ce qu'on lui passe : la pièce, ses avoirs et ses règlements se relisent
-- ici. Rend l'événement posé, ou rien.
create function plateforme.abonnement_paye_par_facture(p_editeur uuid, p_piece_v10 text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_f plateforme.facture_abonnement;
  v_p ventes.piece;
  v_avoirs bigint;
  v_reglements bigint;
  v_ligne plateforme.abonnement;
  v_avant jsonb;
  v_evenement uuid;
begin
  select * into v_f from plateforme.facture_abonnement f where f.editeur = p_editeur and f.piece_v10 = p_piece_v10 for update;
  if not found or v_f.payee_le is not null then return null; end if;
  select * into v_p from ventes.piece p where p.entreprise = p_editeur and p.ref_v10 = p_piece_v10 and p.type = 'facture' and p.statut = 'emise';
  if not found then return null; end if;
  select coalesce(sum(a.net_a_payer), 0) into v_avoirs from ventes.piece a where a.entreprise = v_p.entreprise and a.corrige = v_p.id and a.statut = 'emise';
  select coalesce(sum(r.montant), 0) into v_reglements from ventes.reglement r where r.entreprise = v_p.entreprise and r.piece = v_p.id;
  -- Une facture que ses avoirs couvrent est annulée, pas payée ; une facture qui doit encore attend.
  if v_p.net_a_payer <= 0 or v_avoirs >= v_p.net_a_payer or v_p.net_a_payer - v_avoirs - v_reglements > 0 then return null; end if;
  update plateforme.facture_abonnement set payee_le = now() where id = v_f.id;
  select * into v_ligne from plateforme.abonnement a where a.entreprise = v_f.entreprise for update;
  -- Sans abonnement (une restauration dans une autre base), ou déjà couvert au-delà : rien ne bouge.
  if not found or (v_ligne.paye_jusqu_au is not null and v_ligne.paye_jusqu_au >= v_f.fin) then return null; end if;
  v_avant := plateforme.ligne_abonnement(v_ligne);
  update plateforme.abonnement set paye_jusqu_au = v_f.fin, offre = v_f.offre, periodicite = v_f.periodicite, resilie_le = null, modifie_le = now()
   where entreprise = v_f.entreprise returning * into v_ligne;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (v_f.entreprise, 'paye', 'systeme', 'facture ' || v_p.numero_texte || ' réglée', v_avant,
            plateforme.ligne_abonnement(v_ligne) || jsonb_build_object('debut', v_f.debut, 'fin', v_f.fin, 'facture', v_p.numero_texte))
    returning id into v_evenement;
  update plateforme.facture_abonnement set evenement = v_evenement where id = v_f.id;
  return v_evenement;
end $$;

revoke execute on function plateforme.editeur_de_mes_factures(), plateforme.console_editeur(), plateforme.console_poser_editeur(uuid, text),
  plateforme.console_noter_facture(uuid, text, text, text, text, date, date, bigint, text, date), plateforme.console_factures_abonnement(uuid),
  plateforme.abonnement_paye_par_facture(uuid, text) from public;
grant execute on function plateforme.editeur_de_mes_factures(), plateforme.console_editeur(), plateforme.console_poser_editeur(uuid, text),
  plateforme.console_noter_facture(uuid, text, text, text, text, date, date, bigint, text, date), plateforme.console_factures_abonnement(uuid),
  plateforme.abonnement_paye_par_facture(uuid, text) to skanfact_app;
