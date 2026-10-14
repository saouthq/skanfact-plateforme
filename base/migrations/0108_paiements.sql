-- Les paiements de nos factures, et les coûts du mois (docs/console.md C30 ; skanfact docs/cadrage/10-console.md § 2.2
-- « revenus du mois (encaissés, pas facturés), face aux coûts du mois (saisis à la main, d'après les factures reçues) » et
-- § 2.6 ; la maquette Paiements).
--
-- 1. Ce qui est encaissé : les règlements des factures d'abonnement, tels que le dossier de l'entreprise SkanFact les
--    garde (ventes.reglement) — Konnect (prouvé : la preuve redemandée au prestataire, 0047), un virement, un chèque, le
--    reste. La console ne les refait pas : un règlement se note dans l'application de SkanFact, sur sa facture (10 § 2.5).
--    Ici, la lecture : les règlements d'un mois, et les factures dont le solde n'est pas nul (qui doit encore, ou qui a
--    trop payé) ; le solde se calcule par la règle de toutes les factures (moteur/reglements.ts), au serveur.
-- 2. Les coûts du mois, saisis à la main par la direction, chacun d'après la facture reçue (qui reste dans le journal).
--    Toutes taxes comprises, en millimes de dinar : ce qu'on a payé, face à ce qu'on a reçu. Un coût ne se modifie pas :
--    il se retire (avec son motif) et se saisit de nouveau.

-- ── 1. Les paiements d'un mois ───────────────────────────────────────────────────────────────────────────────────────
-- La direction seule (l'écran Paiements, la tuile « encaissé ce mois » de l'accueil) : ce sont les comptes de SkanFact.
create function plateforme.console_paiements(p_mois date) returns jsonb
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
                    'debut', f.debut, 'fin', f.fin, 'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
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
                from plateforme.cout_du_mois c where c.mois = v_debut)
  );
end $$;

-- ── 2. Les coûts du mois ─────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.cout_du_mois (
  id uuid primary key default socle.uuidv7(),
  -- Le mois, par son premier jour.
  mois date not null check (extract(day from mois) = 1),
  libelle text not null check (length(btrim(libelle)) between 2 and 80),
  -- Toutes taxes comprises, en millimes de dinar ; un milliard de dinars au plus (une faute de frappe, sinon).
  montant bigint not null check (montant > 0 and montant <= 1000000000000),
  -- D'après quelle facture reçue (le fournisseur, son numéro) : c'est aussi le motif du geste au journal.
  d_apres text not null check (length(btrim(d_apres)) between 3 and 200),
  saisi_le timestamptz not null default now(),
  saisi_par uuid not null references socle.utilisateur(id),
  retire_le timestamptz,
  retire_par uuid references socle.utilisateur(id),
  check ((retire_le is null) = (retire_par is null))
);
create index cout_du_mois_mois on plateforme.cout_du_mois (mois, saisi_le);
alter table plateforme.cout_du_mois enable row level security;
alter table plateforme.cout_du_mois force row level security;

-- Un coût saisi ne se modifie pas et ne s'efface pas : il se retire, une fois (et le journal garde pourquoi).
create function plateforme.cout_du_mois_intouchable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.retire_le is null and new.retire_le is not null
     and (new.id, new.mois, new.libelle, new.montant, new.d_apres, new.saisi_le, new.saisi_par)
         is not distinct from (old.id, old.mois, old.libelle, old.montant, old.d_apres, old.saisi_le, old.saisi_par) then
    return new;
  end if;
  raise exception 'un coût saisi ne se modifie pas et ne s''efface pas : il se retire, puis se saisit de nouveau';
end $$;
create trigger cout_du_mois_intouchable before update or delete on plateforme.cout_du_mois
  for each row execute function plateforme.cout_du_mois_intouchable();

-- Saisir un coût : la direction, pour le mois en cours ou un mois passé.
create function plateforme.console_ajouter_cout(p_mois date, p_libelle text, p_montant bigint, p_d_apres text, p_jour date) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_id uuid;
begin
  if length(btrim(coalesce(p_d_apres, ''))) < 3 then
    perform socle.refus('un coût se saisit d''après la facture reçue : dis laquelle (trois caractères au moins), elle reste dans le journal');
  end if;
  if length(btrim(coalesce(p_d_apres, ''))) > 200 then perform socle.refus('la facture reçue se dit en deux cents caractères au plus'); end if;
  if length(btrim(coalesce(p_libelle, ''))) not between 2 and 80 then
    perform socle.refus('un coût se nomme en deux à quatre-vingts caractères');
  end if;
  if p_montant is null or p_montant <= 0 or p_montant > 1000000000000 then
    perform socle.refus('le montant d''un coût est positif, et d''un milliard de dinars au plus');
  end if;
  if p_mois is null or extract(day from p_mois) <> 1 or p_mois > date_trunc('month', p_jour)::date then
    perform socle.refus('un coût se saisit pour le mois en cours ou un mois passé');
  end if;
  insert into plateforme.cout_du_mois (mois, libelle, montant, d_apres, saisi_par)
    values (p_mois, btrim(p_libelle), p_montant, btrim(p_d_apres), socle.moi())
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'paiements.cout_ajoute', btrim(p_d_apres), null,
            jsonb_build_object('mois', to_char(p_mois, 'YYYY-MM'), 'libelle', btrim(p_libelle),
              'montant', (p_montant::numeric / 1000)::numeric(16, 3)::text));
  return v_id;
end $$;

-- Retirer un coût (saisi deux fois, mauvais montant, mauvais mois) : la direction, avec son motif.
create function plateforme.console_retirer_cout(p_id uuid, p_motif text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_c plateforme.cout_du_mois;
  v_geste uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select * into v_c from plateforme.cout_du_mois c where c.id = p_id for update;
  if not found then perform socle.refus('ce coût n''existe pas'); end if;
  if v_c.retire_le is not null then perform socle.refus('ce coût est déjà retiré'); end if;
  update plateforme.cout_du_mois set retire_le = now(), retire_par = socle.moi() where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'paiements.cout_retire', btrim(p_motif),
            jsonb_build_object('mois', to_char(v_c.mois, 'YYYY-MM'), 'libelle', v_c.libelle,
              'montant', (v_c.montant::numeric / 1000)::numeric(16, 3)::text), null)
    returning id into v_geste;
  return v_geste;
end $$;

revoke execute on function plateforme.console_paiements(date), plateforme.console_ajouter_cout(date, text, bigint, text, date),
  plateforme.console_retirer_cout(uuid, text) from public;
grant execute on function plateforme.console_paiements(date), plateforme.console_ajouter_cout(date, text, bigint, text, date),
  plateforme.console_retirer_cout(uuid, text) to skanfact_app;
