-- (1.180.0, maquette « Messages » de Mon cabinet : « Imputer le virement ») La réponse du client à une question de la
-- révision dit enfin ce qu'était la ligne (« le virement du 14/09, c'est l'acompte de la Clinique ») : le cabinet sort le
-- montant du compte où il attendait (le compte d'attente, d'ordinaire) vers le compte que la réponse désigne, d'un geste,
-- au BROUILLARD (rien n'est validé : l'écriture se relit, se change ou s'efface comme toute saisie ; son numéro naît à la
-- validation). La question garde l'écriture d'imputation : une seconde imputation est refusée tant qu'elle existe (effacée
-- du brouillard, la question redevient imputable).
--
-- Le montant et son sens viennent du LIVRE, pas de l'écran : le solde de la ligne de la question sur son compte (débit
-- moins crédit, dans l'écriture d'où la question est née). Un solde créditeur (un virement reçu en attente) se solde par
-- un débit du compte d'attente et un crédit de la contrepartie ; un solde débiteur, l'inverse.
alter table compta.question add column imputee_par uuid references compta.ecriture(id) on delete set null;

create function compta.imputer_question(p_entreprise uuid, p_id uuid, p_imputation jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question; v_solde bigint; v_id uuid; v_contre text; v_libelle text; v_debit_attente text; v_credit_attente text;
begin
  -- La question du cabinet, verrouillée (deux imputations à la fois ne passent pas toutes les deux), et le geste de qui saisit.
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.saisir');
  if q.reponse is null then perform socle.refus('cette question attend la réponse du client : l''imputation vient après'); end if;
  if q.imputee_par is not null then perform socle.refus('cette question est déjà imputée : son écriture est au brouillard'); end if;
  if q.ecriture is null or q.compte = '' then perform socle.refus('cette question ne vient pas d''une ligne du livre : rien à imputer'); end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_solde from compta.ligne l
   where l.ecriture = q.ecriture and l.entreprise = p_entreprise and l.compte = q.compte;
  if v_solde = 0 then perform socle.refus('la ligne de cette question ne laisse rien sur son compte : rien à imputer'); end if;
  v_contre := btrim(coalesce(p_imputation->>'contrepartie', ''));
  if v_contre !~ '^[0-9]{1,12}$' then perform socle.refus('choisis le compte qui reçoit le montant : un numéro du plan'); end if;
  if v_contre = q.compte then perform socle.refus('le montant sort de ce compte : il va vers un autre'); end if;
  v_libelle := left(coalesce(nullif(btrim(p_imputation->>'libelle'), ''), 'Imputation : ' || q.reponse), 500);
  -- Le compte de la question se solde : créditeur, il est débité ; débiteur, il est crédité. La contrepartie, l'inverse.
  v_debit_attente := case when v_solde < 0 then (-v_solde)::text else '0' end;
  v_credit_attente := case when v_solde > 0 then v_solde::text else '0' end;
  v_id := compta.saisir(p_entreprise, jsonb_build_object(
    'date', p_imputation->>'date', 'journal', coalesce(nullif(p_imputation->>'journal', ''), 'OD'), 'piece', q.piece, 'libelle', v_libelle,
    'lignes', jsonb_build_array(
      jsonb_build_object('compte', q.compte, 'libelle', v_libelle, 'tiers', '', 'debit', v_debit_attente, 'credit', v_credit_attente),
      jsonb_build_object('compte', v_contre, 'libelle', v_libelle, 'tiers', '', 'debit', v_credit_attente, 'credit', v_debit_attente))));
  update compta.question set imputee_par = v_id where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.question.imputer', 'question', p_id, null,
    jsonb_build_object('ecriture', v_id, 'compte', q.compte, 'contrepartie', v_contre, 'montant', abs(v_solde)));
  return v_id;
end $$;
revoke execute on function compta.imputer_question(uuid, uuid, jsonb) from public;
grant execute on function compta.imputer_question(uuid, uuid, jsonb) to skanfact_app;
