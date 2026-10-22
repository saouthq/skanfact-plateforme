-- 0167 — La messagerie après sa revue (1.115.0 ; docs/revue-messagerie.md, demandée par Skander le 22/10/2026).
--
-- 1. Répondre à une pièce demandée avec une pièce DÉJÀ dans le dossier. « La facture STEG d'août » était saisie dans les
--    achats (F-8841) : le client devait renvoyer un fichier. Une réponse à une demande porte maintenant un fichier OU la
--    pièce du dossier qu'elle désigne (une facture, un avoir, un devis ou un achat) ; le reste de `messagerie.ecrire` ne
--    change pas.
-- 2. Qui a posé une question de la révision, qui y a répondu : leur nom, lu par les deux côtés du fil. L'entreprise ne
--    voit pas la fiche d'un membre du cabinet (sécurité par ligne de `socle.utilisateur`) : la question se disait posée
--    par « Ton cabinet », quand le message d'à côté était signé « Sonia Ben Youssef ». Les noms seuls, et seulement pour
--    les questions d'un fil que la personne lit (`messagerie.mes_fils`), ou, côté entreprise, de son cabinet.
-- 3. Un message qui ne porte qu'une pièce du dossier (sans un mot) s'enregistre : la table exigeait un texte, un fichier
--    ou une demande, et la pièce envoyée seule en réponse tombait en panne (vu par le parcours de la 1.115.0).

alter table messagerie.message drop constraint message_check,
  add constraint message_porte_quelque_chose check (length(texte) > 0 or fichier is not null or demande is not null or piece_genre is not null);

create or replace function messagerie.ecrire(p_entreprise uuid, p_cote text, p_message jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare
  v_cabinet uuid; v_id uuid; v_texte text; v_demande text; v_fichier uuid; v_repond uuid; v_nom text;
  v_genre text; v_piece text; v_libelle text; f record;
begin
  v_cabinet := messagerie.exiger(p_entreprise, p_cote);
  v_texte := trim(coalesce(p_message->>'texte', ''));
  v_demande := nullif(trim(coalesce(p_message->>'demande', '')), '');
  v_fichier := nullif(p_message->>'fichier', '')::uuid;
  v_repond := nullif(p_message->>'repondA', '')::uuid;
  if v_demande is not null and p_cote <> 'cabinet' then perform socle.refus('seul le cabinet demande une pièce'); end if;
  if length(v_texte) = 0 and v_fichier is null and v_demande is null and jsonb_typeof(p_message->'piece') is distinct from 'object' then
    perform socle.refus('un message vide n''apprend rien');
  end if;
  if length(v_texte) > 4000 then perform socle.refus('un message tient en 4 000 caractères'); end if;
  if v_demande is not null and length(v_demande) > 300 then perform socle.refus('une pièce demandée se nomme en 300 caractères'); end if;
  if jsonb_typeof(p_message->'piece') = 'object' then
    v_genre := p_message->'piece'->>'genre';
    v_piece := trim(coalesce(p_message->'piece'->>'id', ''));
    v_libelle := trim(coalesce(p_message->'piece'->>'libelle', ''));
    if coalesce(v_genre, '') not in ('facture', 'avoir', 'devis', 'achat') or length(v_piece) not between 1 and 100
       or length(v_libelle) not between 1 and 300 then
      perform socle.refus('cette pièce ne se reconnaît pas : une facture, un avoir, un devis ou un achat, avec son libellé');
    end if;
  end if;
  if v_fichier is not null then
    select * into f from messagerie.fichier x where x.id = v_fichier and x.entreprise = p_entreprise and x.cabinet = v_cabinet for update;
    if not found or f.depose_par <> socle.moi() then perform socle.refus('ce fichier n''est pas là : dépose-le d''abord'); end if;
    if exists (select 1 from messagerie.message m where m.fichier = v_fichier) then perform socle.refus('ce fichier est déjà joint à un message'); end if;
  end if;
  -- La pièce demandée, envoyée en réponse (un fichier, ou la pièce du dossier qui l'est) : la demande est reçue.
  if v_repond is not null then
    if p_cote <> 'entreprise' or (v_fichier is null and v_genre is null) then perform socle.refus('on répond à une pièce demandée en l''envoyant'); end if;
    update messagerie.message set demande_recue_le = clock_timestamp(), demande_recue_par = socle.moi()
     where id = v_repond and entreprise = p_entreprise and cabinet = v_cabinet and demande is not null and demande_recue_le is null;
    if not found then perform socle.refus('cette pièce demandée n''attend plus rien'); end if;
  end if;
  select nom into v_nom from socle.utilisateur where id = socle.moi();
  insert into messagerie.fil (entreprise, cabinet) values (p_entreprise, v_cabinet) on conflict do nothing;
  insert into messagerie.message (entreprise, cabinet, cote, auteur, auteur_nom, texte, piece_genre, piece_id, piece_libelle, demande, fichier, repond_a)
  values (p_entreprise, v_cabinet, p_cote, socle.moi(), v_nom, v_texte, v_genre, nullif(v_piece, ''), nullif(v_libelle, ''), v_demande, v_fichier, v_repond)
  returning id into v_id;
  perform messagerie.marquer_lu(p_entreprise, v_cabinet, p_cote);
  perform socle.tracer(p_entreprise, 'messagerie.ecrire', 'message', v_id, null, jsonb_build_object('cote', p_cote,
    'piece', case when v_genre is null then null else v_genre || ':' || v_piece end, 'demande', v_demande, 'fichier', v_fichier));
  return v_id;
end $$;

-- Les noms de qui a posé et de qui a répondu aux questions envoyées d'un fil que je lis.
create function messagerie.noms_des_questions(p_entreprise uuid, p_cabinet uuid)
returns table (question uuid, pose_nom text, repondu_nom text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select q.id, pu.nom, ru.nom
    from compta.question q
    left join socle.utilisateur pu on pu.id = q.pose_par
    left join socle.utilisateur ru on ru.id = q.repondu_par
   where q.entreprise = p_entreprise and q.cabinet = p_cabinet and cardinality(q.envois) > 0
     -- Un fil que je lis ; ou, côté entreprise, le cabinet qui tient (ou a tenu) le dossier : une question peut arriver
     -- avant le premier message, et le fil ne naît qu'avec lui.
     and (exists (select 1 from messagerie.mes_fils() f where f.entreprise = p_entreprise and f.cabinet = p_cabinet)
       or (messagerie.cote_entreprise(p_entreprise) and exists (select 1 from socle.mandat d where d.entreprise = p_entreprise and d.cabinet = p_cabinet)))
$$;
revoke execute on function messagerie.noms_des_questions(uuid, uuid) from public;
grant execute on function messagerie.noms_des_questions(uuid, uuid) to skanfact_app;
