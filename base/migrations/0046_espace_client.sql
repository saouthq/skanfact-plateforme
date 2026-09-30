-- L'espace client (brique 77 ; docs/espace-client.md ; 14 § 2.1). Le client d'une entreprise (SON
-- client à elle) ouvre un lien et voit, sans rien installer, ses pièces émises et ce qu'il en doit.
-- Deux sortes de liens, secrets (la base n'en garde que l'empreinte), révocables et tracés : le lien
-- d'une PIÈCE (dans l'e-mail ou le WhatsApp qui l'envoie) et le lien du COMPTE (le relevé d'un client
-- régulier). Jamais un brouillon, jamais le client d'à côté : le lien porte un client, et la base ne
-- montre que SES factures et avoirs émis. Rien ne change par l'espace client. Le visiteur n'est pas
-- un utilisateur : il ne lit que par `ventes.espace`, jamais par les tables.

create table ventes.lien (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  -- Le client et la pièce tels que le dossier v10 les nomme (socle.tiers.ref_v10, ventes.piece.ref_v10).
  client_v10 text not null check (length(client_v10) between 1 and 200),
  -- Le lien d'une pièce : elle seule. Sans pièce : le compte (toutes ses pièces émises, et le relevé).
  piece_v10 text check (piece_v10 is null or length(piece_v10) between 1 and 200),
  jeton_empreinte text not null unique,
  cree_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null,
  revoque_le timestamptz,
  revoque_par uuid references socle.utilisateur(id),
  -- La dernière ouverture (« vue le … »), et combien de fois.
  vu_le timestamptz,
  vues integer not null default 0 check (vues >= 0),
  check ((revoque_le is null) = (revoque_par is null))
);
create index lien_client on ventes.lien (entreprise, client_v10, cree_le);
alter table ventes.lien enable row level security;
alter table ventes.lien force row level security;
create policy visible on ventes.lien using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update on ventes.lien to skanfact_app;

-- Ce que le lien montre (le serveur seul le demande, par l'empreinte du jeton présenté), et l'ouverture
-- notée. Rend null si le lien n'existe pas ou a été révoqué. Les montants partent en TEXTE (des entiers
-- dans l'unité de la devise) : le serveur les relit sans nombre à virgule.
create function ventes.espace(p_jeton_empreinte text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes as $$
declare l record;
begin
  select * into l from ventes.lien where jeton_empreinte = p_jeton_empreinte and revoque_le is null;
  if not found then return null; end if;
  update ventes.lien set vu_le = p_maintenant, vues = vues + 1 where id = l.id;
  return jsonb_build_object(
    'lien', case when l.piece_v10 is null then 'compte' else 'piece' end,
    'entreprise', (select d.contenu from socle.dossier_v10 d where d.entreprise = l.entreprise and d.collection = '_racine' and d.cle = 'company'),
    'client', (select d.contenu from socle.dossier_v10 d where d.entreprise = l.entreprise and d.collection = 'clients' and d.cle = l.client_v10),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.type, 'numero', p.numero_texte, 'date', p.date_piece, 'echeance', p.echeance,
        'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
        'avoirs', (select coalesce(jsonb_agg(a.net_a_payer::text), '[]') from ventes.piece a
                    where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'),
        'reglements', (select coalesce(jsonb_agg(r.montant::text), '[]') from ventes.reglement r
                        where r.entreprise = p.entreprise and r.piece = p.id),
        'document', d.contenu) order by p.date_piece desc, p.id desc)
        from ventes.piece p
        join socle.tiers t on t.id = p.tiers and t.ref_v10 = l.client_v10
        join socle.devise dv on dv.code = p.devise
        join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'documents' and d.cle = p.ref_v10
       where p.entreprise = l.entreprise and p.statut = 'emise' and p.type in ('facture', 'avoir')
         -- Un ticket de caisse se remet au comptoir : il n'est pas de l'espace client (docs/espace-client.md).
         and (d.contenu -> 'ticket') is distinct from 'true'::jsonb
         and (l.piece_v10 is null or p.ref_v10 = l.piece_v10)), '[]'::jsonb));
end $$;
revoke execute on function ventes.espace(text, timestamptz) from public;
grant execute on function ventes.espace(text, timestamptz) to skanfact_app;
