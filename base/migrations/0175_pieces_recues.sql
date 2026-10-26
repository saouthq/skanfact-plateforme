-- « Pièces reçues » du Cabinet (1.152.0 ; maquette « Barre v3 », lot 1 b, appliquée le 26/10/2026 ; Skander : « pour ce
-- qui n'existe pas dans le crm alors développe-le »). Les fichiers que les clients envoient à leur cabinet par la
-- messagerie arrivent dans une seule boîte, tous dossiers confondus ; le cabinet les CLASSE (il les a saisis, rangés,
-- ou n'en a pas besoin) et la boîte se vide. Classer ne touche ni au fichier, ni au message, ni aux livres : c'est
-- l'état de travail du cabinet sur ce fichier, qu'il peut défaire.
--
-- Seul le cabinet qui lit le fil (messagerie.exiger, côté cabinet) classe, et seulement un fichier que le client a
-- envoyé. La lecture passe par la règle du fil (mes_fils) : rien de neuf ne sort.

alter table messagerie.message
  add column classee_le timestamptz,
  add column classee_par uuid references socle.utilisateur(id),
  add constraint message_classee_paire check ((classee_le is null) = (classee_par is null)),
  add constraint message_classee_fichier check (classee_le is null or (fichier is not null and cote = 'entreprise'));

create function messagerie.classer_piece(p_entreprise uuid, p_message uuid, p_classee boolean) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  update messagerie.message
     set classee_le = case when p_classee then clock_timestamp() end, classee_par = case when p_classee then socle.moi() end
   where id = p_message and entreprise = p_entreprise and cabinet = v_cabinet and cote = 'entreprise' and fichier is not null
     and (classee_le is null) = p_classee;
  if not found and p_classee then
    perform socle.refus('cette pièce n''est pas à classer');
  elsif not found then
    perform socle.refus('cette pièce n''est pas classée');
  end if;
  perform socle.tracer(p_entreprise, case when p_classee then 'messagerie.classer' else 'messagerie.declasser' end, 'message', p_message, null, null);
end $$;
revoke all on function messagerie.classer_piece(uuid, uuid, boolean) from public;
grant execute on function messagerie.classer_piece(uuid, uuid, boolean) to skanfact_app;

-- La boîte se lit par les fichiers du client, les plus récents d'abord : un index sur ce que la lecture cherche.
create index message_pieces_recues on messagerie.message (cabinet, ecrit_le desc) where fichier is not null and cote = 'entreprise';
