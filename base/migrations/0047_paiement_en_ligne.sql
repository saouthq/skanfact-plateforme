-- Le paiement en ligne (brique 78 ; docs/paiement-en-ligne.md ; 14 § 2.2). L'entreprise branche SON
-- compte chez le prestataire (Konnect au lancement) : l'argent va directement chez elle, SkanFact ne le
-- touche jamais. Depuis l'espace client, son client paie le reste à payer d'une facture. Le paiement se
-- prouve auprès du prestataire, avec la clé de l'entreprise : jamais sur la page de retour, jamais sur
-- l'avis du prestataire (il n'est pas signé : n'importe qui peut l'appeler, il ne vaut que comme
-- « va regarder »). Prouvé, le règlement s'enregistre tout seul sur le compte de trésorerie du
-- prestataire.

-- 1. Ce qu'un lien montre : UNE définition, pour l'espace (ventes.espace) et pour le paiement. Elle
--    remplace celle que 0046 portait dans ventes.espace.
create function ventes.lien_valable(p_jeton_empreinte text) returns ventes.lien
language sql stable security definer set search_path = pg_catalog, ventes as $$
  select * from ventes.lien where jeton_empreinte = p_jeton_empreinte and revoque_le is null
$$;
revoke execute on function ventes.lien_valable(text) from public;

-- Les pièces du lien : les factures et avoirs ÉMIS de son client (jamais un brouillon, jamais le client
-- d'à côté, jamais un ticket de caisse), ou la seule pièce du lien d'une pièce. Les montants partent en
-- TEXTE (des entiers dans l'unité de la devise) : le serveur les relit sans nombre à virgule.
create function ventes.pieces_du_lien(p_lien uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'type', p.type, 'numero', p.numero_texte, 'date', p.date_piece, 'echeance', p.echeance,
      'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
      'avoirs', (select coalesce(jsonb_agg(a.net_a_payer::text), '[]') from ventes.piece a
                  where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'),
      'reglements', (select coalesce(jsonb_agg(r.montant::text), '[]') from ventes.reglement r
                      where r.entreprise = p.entreprise and r.piece = p.id),
      'document', d.contenu) order by p.date_piece desc, p.id desc), '[]'::jsonb)
    from ventes.lien l
    join ventes.piece p on p.entreprise = l.entreprise
    join socle.tiers t on t.id = p.tiers and t.ref_v10 = l.client_v10
    join socle.devise dv on dv.code = p.devise
    join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'documents' and d.cle = p.ref_v10
   where l.id = p_lien and p.statut = 'emise' and p.type in ('facture', 'avoir')
     -- Un ticket de caisse se remet au comptoir : il n'est pas de l'espace client (docs/espace-client.md).
     and (d.contenu -> 'ticket') is distinct from 'true'::jsonb
     and (l.piece_v10 is null or p.ref_v10 = l.piece_v10)
$$;
revoke execute on function ventes.pieces_du_lien(uuid) from public;

-- 2. Le prestataire de chaque entreprise. La clé de son API est scellée par le coffre du serveur
--    (serveur/coffre.ts, une clé que la base n'a pas) ; et le compte du serveur ne peut même pas la
--    lire : seules les fonctions du paiement la reçoivent. Aucun écran ne la relit.
create table ventes.prestataire (
  entreprise uuid primary key references socle.entreprise(id),
  prestataire text not null check (prestataire in ('konnect')),
  portefeuille text not null check (length(portefeuille) between 1 and 100),
  cle_scellee text not null,
  -- Ses derniers caractères, pour la reconnaître (« …b3f2 »).
  cle_fin text not null check (length(cle_fin) between 1 and 8),
  -- Le compte de trésorerie du prestataire dans le dossier (collection « accounts »).
  compte_v10 text not null check (length(compte_v10) between 1 and 200),
  pose_le timestamptz not null,
  pose_par uuid not null references socle.utilisateur(id),
  -- Le dernier refus du prestataire (une clé fausse se voit ici, pas chez le client seulement) : une
  -- phrase du catalogue et ses valeurs ({cle, valeurs}), dite dans la langue de qui la lit.
  dernier_refus jsonb,
  dernier_refus_le timestamptz
);
alter table ventes.prestataire enable row level security;
alter table ventes.prestataire force row level security;
create policy visible on ventes.prestataire using (entreprise in (select socle.mes_entreprises()));
grant select (entreprise, prestataire, portefeuille, cle_fin, compte_v10, pose_le, pose_par, dernier_refus, dernier_refus_le)
  on ventes.prestataire to skanfact_app;
grant insert, update, delete on ventes.prestataire to skanfact_app;

-- 3. Chaque paiement demandé depuis l'espace client, et ce qu'il est devenu.
create table ventes.paiement_en_ligne (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  piece uuid not null references ventes.piece(id),
  prestataire text not null check (prestataire in ('konnect')),
  montant bigint not null check (montant > 0),
  devise text not null references socle.devise(code),
  -- L'empreinte du secret que porte l'adresse de retour (et elle seule).
  retour_empreinte text not null,
  cree_le timestamptz not null,
  -- Ce que le prestataire a rendu : sa référence, et l'adresse où l'on paie.
  ref text unique,
  adresse text,
  statut text not null default 'initie' check (statut in ('initie', 'encaisse', 'echoue')),
  -- Le prestataire a dit « encaissé », pour cette commande et ce montant.
  prouve_le timestamptz,
  encaisse_le timestamptz,
  -- Le paiement ajouté à la pièce du dossier (son identifiant v10).
  reglement_v10 text,
  -- Pourquoi il a échoué, ou pourquoi il attend d'être enregistré ({cle, valeurs}, comme ci-dessus).
  motif jsonb,
  check ((statut = 'encaisse') = (encaisse_le is not null and reglement_v10 is not null and prouve_le is not null))
);
create index paiement_en_ligne_piece on ventes.paiement_en_ligne (entreprise, piece, cree_le);
alter table ventes.paiement_en_ligne enable row level security;
alter table ventes.paiement_en_ligne force row level security;
create policy visible on ventes.paiement_en_ligne using (entreprise in (select socle.mes_entreprises()));
grant select, update on ventes.paiement_en_ligne to skanfact_app;

-- 4. L'espace : la même vue qu'en 0046, les pièces par leur définition unique, et si l'entreprise
--    accepte le paiement en ligne.
create or replace function ventes.espace(p_jeton_empreinte text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes as $$
declare l ventes.lien;
begin
  l := ventes.lien_valable(p_jeton_empreinte);
  if l.id is null then return null; end if;
  update ventes.lien set vu_le = p_maintenant, vues = vues + 1 where id = l.id;
  return jsonb_build_object(
    'lien', case when l.piece_v10 is null then 'compte' else 'piece' end,
    'entreprise', (select d.contenu from socle.dossier_v10 d where d.entreprise = l.entreprise and d.collection = '_racine' and d.cle = 'company'),
    'client', (select d.contenu from socle.dossier_v10 d where d.entreprise = l.entreprise and d.collection = 'clients' and d.cle = l.client_v10),
    'paiement', exists (select 1 from ventes.prestataire pr where pr.entreprise = l.entreprise),
    'pieces', ventes.pieces_du_lien(l.id));
end $$;

-- 5. Payer une facture du lien. D'abord ce qu'il faut au serveur pour en calculer le reste (la même
--    fonction que partout) et le prestataire de l'entreprise ; rien ne s'écrit.
create function ventes.espace_a_payer(p_jeton_empreinte text, p_numero text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes as $$
declare l ventes.lien; p jsonb; v_portefeuille text; v_cle text;
begin
  l := ventes.lien_valable(p_jeton_empreinte);
  if l.id is null then return null; end if;
  select x into p from jsonb_array_elements(ventes.pieces_du_lien(l.id)) x
   where x ->> 'type' = 'facture' and x ->> 'numero' = p_numero;
  if p is null then return null; end if;
  select portefeuille, cle_scellee into v_portefeuille, v_cle from ventes.prestataire where entreprise = l.entreprise;
  return jsonb_build_object('entreprise', l.entreprise, 'piece', p - 'document',
    'prestataire', case when v_portefeuille is null then null else jsonb_build_object('portefeuille', v_portefeuille, 'cle_scellee', v_cle) end);
end $$;
revoke execute on function ventes.espace_a_payer(text, text) from public;
grant execute on function ventes.espace_a_payer(text, text) to skanfact_app;

-- Puis la demande, notée AVANT d'aller chez le prestataire (sa commande porte notre identifiant). Une
-- demande identique encore ouverte (même facture, même montant, moins de 25 minutes : le prestataire
-- garde son adresse 30 minutes) est rendue telle quelle : deux clics ne font pas deux paiements.
create function ventes.paiement_demander(p_jeton_empreinte text, p_numero text, p_montant bigint, p_retour_empreinte text, p_maintenant timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes as $$
declare a jsonb; v_entreprise uuid; v_piece uuid; v_ouvert uuid; v_adresse text; v_id uuid;
begin
  a := ventes.espace_a_payer(p_jeton_empreinte, p_numero);
  if a is null then return null; end if;
  v_entreprise := (a ->> 'entreprise')::uuid;
  v_piece := (a -> 'piece' ->> 'id')::uuid;
  select x.id, x.adresse into v_ouvert, v_adresse from ventes.paiement_en_ligne x
   where x.entreprise = v_entreprise and x.piece = v_piece and x.statut = 'initie' and x.montant = p_montant
     and x.adresse is not null and x.cree_le > p_maintenant - interval '25 minutes'
   order by x.cree_le desc limit 1;
  if v_ouvert is not null then return jsonb_build_object('id', v_ouvert, 'adresse', v_adresse); end if;
  insert into ventes.paiement_en_ligne (entreprise, piece, prestataire, montant, devise, retour_empreinte, cree_le)
  values (v_entreprise, v_piece, 'konnect', p_montant, a -> 'piece' ->> 'devise', p_retour_empreinte, p_maintenant)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'entreprise', v_entreprise, 'devise', a -> 'piece' ->> 'devise',
    'portefeuille', a -> 'prestataire' ->> 'portefeuille', 'cle_scellee', a -> 'prestataire' ->> 'cle_scellee');
end $$;
revoke execute on function ventes.paiement_demander(text, text, bigint, text, timestamptz) from public;
grant execute on function ventes.paiement_demander(text, text, bigint, text, timestamptz) to skanfact_app;

-- Ce que le prestataire a rendu : sa référence et l'adresse où l'on paie ; ou son refus, noté sur la
-- demande ET chez l'entreprise (elle le voit dans ses réglages : une clé fausse ne se découvre pas
-- seulement chez le client).
create function ventes.paiement_initie(p_id uuid, p_ref text, p_adresse text) returns void
language sql volatile security definer set search_path = pg_catalog, ventes as $$
  update ventes.paiement_en_ligne set ref = p_ref, adresse = p_adresse where id = p_id and statut = 'initie' and ref is null
$$;
revoke execute on function ventes.paiement_initie(uuid, text, text) from public;
grant execute on function ventes.paiement_initie(uuid, text, text) to skanfact_app;

create function ventes.paiement_refuse(p_id uuid, p_motif jsonb, p_maintenant timestamptz) returns void
language sql volatile security definer set search_path = pg_catalog, ventes as $$
  update ventes.paiement_en_ligne set statut = 'echoue', motif = p_motif where id = p_id and statut = 'initie';
  update ventes.prestataire pr set dernier_refus = p_motif, dernier_refus_le = p_maintenant
    from ventes.paiement_en_ligne x where x.id = p_id and pr.entreprise = x.entreprise;
$$;
revoke execute on function ventes.paiement_refuse(uuid, jsonb, timestamptz) from public;
grant execute on function ventes.paiement_refuse(uuid, jsonb, timestamptz) to skanfact_app;

-- 6. Vérifier une demande auprès du prestataire (par notre identifiant, ou par sa référence) : ce qu'il
--    faut pour poser la question, et au nom de qui le règlement s'enregistre (le propriétaire de
--    l'entreprise : le règlement est à son nom, par le paiement en ligne, et la trace le dit).
create function ventes.paiement_a_verifier(p_id uuid, p_ref text) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes as $$
  select jsonb_build_object('id', x.id, 'entreprise', x.entreprise, 'piece', x.piece, 'piece_v10', p.ref_v10, 'numero', p.numero_texte,
      'montant', x.montant::text, 'devise', x.devise, 'decimales', dv.decimales, 'statut', x.statut, 'ref', x.ref,
      'retour_empreinte', x.retour_empreinte, 'portefeuille', pr.portefeuille, 'cle_scellee', pr.cle_scellee, 'compte_v10', pr.compte_v10,
      'proprietaire', (select m.utilisateur from socle.membre m where m.entreprise = x.entreprise and m.actif and 'proprietaire' = any(m.roles)))
    from ventes.paiement_en_ligne x
    join ventes.piece p on p.id = x.piece
    join socle.devise dv on dv.code = x.devise
    left join ventes.prestataire pr on pr.entreprise = x.entreprise
   where (p_id is not null and x.id = p_id) or (p_ref is not null and x.ref = p_ref)
$$;
revoke execute on function ventes.paiement_a_verifier(uuid, text) from public;
grant execute on function ventes.paiement_a_verifier(uuid, text) to skanfact_app;

-- Les demandes à redemander au prestataire (le filet du serveur) : ouvertes chez lui, pas encore
-- enregistrées, de plus de deux minutes (le client a eu le temps de payer) et de moins d'un jour.
create function ventes.paiements_a_revoir(p_maintenant timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, ventes as $$
  select coalesce(jsonb_agg(x.id order by x.cree_le), '[]'::jsonb) from (
    select id, cree_le from ventes.paiement_en_ligne
     where statut = 'initie' and ref is not null
       and cree_le between p_maintenant - interval '1 day' and p_maintenant - interval '2 minutes'
     order by cree_le limit 100) x
$$;
revoke execute on function ventes.paiements_a_revoir(timestamptz) from public;
grant execute on function ventes.paiements_a_revoir(timestamptz) to skanfact_app;

-- Le prestataire dit que la demande n'aboutira pas (refusée, expirée), ou qu'elle ne correspond pas à ce
-- qui a été demandé (une autre commande, un autre montant) : elle échoue, et on dit pourquoi.
create function ventes.paiement_echoue(p_id uuid, p_motif jsonb) returns void
language sql volatile security definer set search_path = pg_catalog, ventes as $$
  update ventes.paiement_en_ligne set statut = 'echoue', motif = p_motif where id = p_id and statut = 'initie'
$$;
revoke execute on function ventes.paiement_echoue(uuid, jsonb) from public;
grant execute on function ventes.paiement_echoue(uuid, jsonb) to skanfact_app;
