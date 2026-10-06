-- Le devis par son lien (lot du 06/10/2026 ; docs/espace-client.md, E9). Un devis envoyé par WhatsApp disait
-- « ci-joint » sans rien de joint : au téléphone, il n'y a pas de PDF à glisser. Il part maintenant avec son
-- lien, comme une facture. Un devis ne vit que dans le dossier v10 (il n'est pas une pièce légale : ni numéro du
-- serveur, ni sceau) ; le client le voit donc tel qu'il est AUJOURD'HUI, jamais en brouillon, jamais celui d'un
-- autre client, jamais supprimé. Il ne compte pas dans ce que le client doit : il part à part des factures.

-- Les devis du lien : le seul devis d'un lien de pièce ; tous les devis envoyés (ni brouillons, ni supprimés) du
-- client pour un lien de compte. Le plus récent d'abord.
create function ventes.devis_du_lien(p_lien uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.cle, 'numero', d.contenu ->> 'number', 'document', d.contenu)
      order by d.contenu ->> 'date' desc, d.cle desc), '[]'::jsonb)
    from ventes.lien l
    join socle.dossier_v10 d on d.entreprise = l.entreprise and d.collection = 'documents'
   where l.id = p_lien
     and d.contenu ->> 'type' = 'devis'
     and d.contenu ->> 'clientId' = l.client_v10
     and coalesce(d.contenu ->> 'status', 'brouillon') <> 'brouillon'
     and (l.piece_v10 is null or d.cle = l.piece_v10)
$$;
revoke execute on function ventes.devis_du_lien(uuid) from public;

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
    'pieces', ventes.pieces_du_lien(l.id),
    'devis', ventes.devis_du_lien(l.id));
end $$;
