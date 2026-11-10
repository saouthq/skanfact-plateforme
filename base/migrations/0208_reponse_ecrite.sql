-- 0208 — Répondre par écrit à une pièce demandée (1.344.0 ; docs/revue-modules.md, la Paie du Cabinet).
--
-- La Paie du Cabinet demande au client le n° CNSS d'un salarié qui n'en a pas : un numéro, pas une pièce. La demande ne
-- se réglait qu'avec un fichier ou une pièce du dossier (0167) — le client devait photographier un numéro qu'il pouvait
-- écrire, ou l'écrire dans un message pendant que la demande restait « à envoyer » et se relançait par e-mail. Une
-- réponse ÉCRITE règle désormais la demande comme un fichier — choisie EXPRÈS (`ecrite`, le choix « Je l'écris » de la
-- fenêtre) et non vide : un « la voilà » tapé sans joindre le fichier reste refusé, sinon la demande se fermerait sur rien.
-- Le reste ne change pas depuis 0168.

create or replace function messagerie.ecrire(p_entreprise uuid, p_cote text, p_message jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare
  v_cabinet uuid; v_id uuid; v_texte text; v_demande text; v_fichier uuid; v_repond uuid; v_nom text;
  v_genre text; v_piece text; v_libelle text; v_pour date; f record;
begin
  v_cabinet := messagerie.exiger(p_entreprise, p_cote);
  v_texte := trim(coalesce(p_message->>'texte', ''));
  v_demande := nullif(trim(coalesce(p_message->>'demande', '')), '');
  v_fichier := nullif(p_message->>'fichier', '')::uuid;
  v_repond := nullif(p_message->>'repondA', '')::uuid;
  if coalesce(p_message->>'pour', '') !~ '^(\d{4}-\d{2}-\d{2})?$' then perform socle.refus('une date « pour le » s''écrit en jour, mois et année'); end if;
  v_pour := nullif(p_message->>'pour', '')::date;
  if v_demande is not null and p_cote <> 'cabinet' then perform socle.refus('seul le cabinet demande une pièce'); end if;
  if v_pour is not null and v_demande is null then perform socle.refus('une date « pour le » va avec une pièce demandée'); end if;
  if v_pour < (clock_timestamp() at time zone 'Africa/Tunis')::date then
    perform socle.refus('une pièce se demande pour aujourd''hui ou plus tard');
  end if;
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
  -- La pièce demandée, envoyée en réponse (un fichier, la pièce du dossier qui l'est, ou — 0208 — ce qu'elle demande,
  -- écrit) : la demande est reçue.
  if v_repond is not null then
    if p_cote <> 'entreprise' or (v_fichier is null and v_genre is null
        and not (coalesce((p_message->>'ecrite')::boolean, false) and length(v_texte) > 0)) then
      perform socle.refus('on répond à une pièce demandée en l''envoyant');
    end if;
    update messagerie.message set demande_recue_le = clock_timestamp(), demande_recue_par = socle.moi()
     where id = v_repond and entreprise = p_entreprise and cabinet = v_cabinet and demande is not null and demande_recue_le is null;
    if not found then perform socle.refus('cette pièce demandée n''attend plus rien'); end if;
  end if;
  select nom into v_nom from socle.utilisateur where id = socle.moi();
  insert into messagerie.fil (entreprise, cabinet) values (p_entreprise, v_cabinet) on conflict do nothing;
  insert into messagerie.message (entreprise, cabinet, cote, auteur, auteur_nom, texte, piece_genre, piece_id, piece_libelle, demande, demande_pour, fichier, repond_a)
  values (p_entreprise, v_cabinet, p_cote, socle.moi(), v_nom, v_texte, v_genre, nullif(v_piece, ''), nullif(v_libelle, ''), v_demande, v_pour, v_fichier, v_repond)
  returning id into v_id;
  perform messagerie.marquer_lu(p_entreprise, v_cabinet, p_cote);
  perform socle.tracer(p_entreprise, 'messagerie.ecrire', 'message', v_id, null, jsonb_build_object('cote', p_cote,
    'piece', case when v_genre is null then null else v_genre || ':' || v_piece end, 'demande', v_demande, 'pour', v_pour, 'fichier', v_fichier));
  return v_id;
end $$;
