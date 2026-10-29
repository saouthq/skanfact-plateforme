-- Une pièce reçue garde POURQUOI elle a été classée (29/10/2026 ; maquette « Pièces reçues » du Cabinet,
-- docs/maquettes/cabinet/pieces-recues.html : « Classer sans saisir ▾ » — rien à saisir, déjà saisie, en double,
-- illisible ; et les gestes du panneau : saisie, vérifiée, rapprochée). L'onglet « Classées » le dit, pour que
-- l'équipe sache ce qui a été fait de chaque fichier. La raison naît avec le classement et s'efface quand on le défait.
-- « client » : le dossier n'a pas confié la saisie de ses achats au cabinet, le client la saisit lui-même.
-- La note (300 caractères au plus) dit ce qu'on a demandé au client quand la pièce était illisible.

alter table messagerie.message
  add column classee_raison text,
  add column classee_note text,
  add constraint message_classee_raison check (classee_raison is null
    or (classee_le is not null and classee_raison in ('saisie', 'verifiee', 'rien', 'double', 'illisible', 'banque', 'client'))),
  add constraint message_classee_note check (classee_note is null or (classee_le is not null and length(classee_note) <= 300));

-- Un seul chemin pour classer : l'ancienne forme (0175) laisse la place à celle qui porte la raison.
drop function messagerie.classer_piece(uuid, uuid, boolean);

create function messagerie.classer_piece(p_entreprise uuid, p_message uuid, p_classee boolean, p_raison text, p_note text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  v_cabinet := messagerie.exiger(p_entreprise, 'cabinet');
  if not p_classee and (p_raison is not null or p_note is not null) then
    perform socle.refus('une pièce qu''on remet à classer n''a pas de raison');
  end if;
  update messagerie.message
     set classee_le = case when p_classee then clock_timestamp() end, classee_par = case when p_classee then socle.moi() end,
         classee_raison = case when p_classee then p_raison end, classee_note = case when p_classee then nullif(btrim(p_note), '') end
   where id = p_message and entreprise = p_entreprise and cabinet = v_cabinet and cote = 'entreprise' and fichier is not null
     and (classee_le is null) = p_classee;
  if not found and p_classee then
    perform socle.refus('cette pièce n''est pas à classer');
  elsif not found then
    perform socle.refus('cette pièce n''est pas classée');
  end if;
  perform socle.tracer(p_entreprise, case when p_classee then 'messagerie.classer' else 'messagerie.declasser' end, 'message', p_message,
    null, case when p_raison is null then null else jsonb_build_object('raison', p_raison) end);
end $$;
revoke all on function messagerie.classer_piece(uuid, uuid, boolean, text, text) from public;
grant execute on function messagerie.classer_piece(uuid, uuid, boolean, text, text) to skanfact_app;
