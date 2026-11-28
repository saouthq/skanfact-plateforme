-- (1.390.11, issue 9, CABDECLARER-7) Lettrer les lignes d'UN client. Une écriture d'à-nouveaux reprend chaque client sur
-- sa propre ligne d'une même pièce (0210) : le lettrage additionnait toutes les lignes du compte des écritures cochées,
-- donc l'à-nouveau de l'Hôtel (2 558) et son virement (− 2 558) « ne se soldaient pas : il reste 1 161 » — le reste
-- étant l'à-nouveau du Café, sur la même pièce. L'écran disait « elles se soldent » (il compte par client) et le
-- serveur refusait. L'écran désigne les LIGNES de ce client (p_lignes) : c'est lui qui range une ligne sous un client (son
-- identifiant, celui de l'écriture, ou son nom), et une seconde règle ici divergerait de la sienne. Seules ces lignes du
-- compte entrent dans la somme, le contrôle « déjà lettrée » et la lettre posée. Sans lignes désignées, rien ne change.

drop function compta.lettrer(uuid, text, uuid[], text);

create function compta.lettrer(p_entreprise uuid, p_compte text, p_ecritures uuid[], p_lettre text,
  p_lignes uuid[] default null) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int; solde bigint; v_lettre text := upper(nullif(btrim(p_lettre), '')); v_rang bigint; v_id uuid;
begin
  perform compta.exiger(p_entreprise, 'compta.lettrage.poser');
  -- Deux lettrages de la même entreprise, au même instant, passent l'un après l'autre : le second voit
  -- la lettre prise et les lignes déjà lettrées (sa phrase), jamais une erreur de doublon.
  perform pg_advisory_xact_lock(hashtextextended('compta.lettrage:' || p_entreprise::text, 0));
  if coalesce(p_compte, '') !~ '^[0-9]{1,12}$' then perform socle.refus('le compte à lettrer doit être un numéro'); end if;
  select count(distinct i) into n from unnest(p_ecritures) i;
  if n < 2 then perform socle.refus('le lettrage relie au moins deux écritures : une facture et son règlement'); end if;
  if exists (select 1 from unnest(p_ecritures) i where not exists (select 1 from compta.ecriture e where e.id = i and e.entreprise = p_entreprise)) then
    perform socle.refus('une des écritures à lettrer n''existe pas');
  end if;
  if exists (select 1 from compta.ecriture e where e.id = any (p_ecritures) and e.statut <> 'validee') then
    perform socle.refus('on lettre des écritures validées : un brouillard peut encore changer');
  end if;
  if not exists (select 1 from compta.ligne l where l.ecriture = any (p_ecritures) and l.compte = p_compte and (p_lignes is null or l.id = any (p_lignes))) then
    perform socle.refus(format('aucune de ces écritures ne touche le compte %s', p_compte));
  end if;
  if exists (select 1 from compta.ligne l join compta.ligne_lettree t on t.ligne = l.id where l.ecriture = any (p_ecritures) and l.compte = p_compte and (p_lignes is null or l.id = any (p_lignes))) then
    perform socle.refus('une de ces lignes est déjà lettrée : délettre-la d''abord');
  end if;
  select sum(l.debit - l.credit) into solde from compta.ligne l where l.ecriture = any (p_ecritures) and l.compte = p_compte and (p_lignes is null or l.id = any (p_lignes));
  if solde <> 0 then perform socle.refus(format('ces écritures ne se soldent pas : il reste %s', compta.en_texte(solde))); end if;
  if v_lettre is not null then
    if v_lettre !~ '^[A-Z]{1,5}$' then perform socle.refus('une lettre s''écrit de une à cinq lettres, de A à Z'); end if;
    if exists (select 1 from compta.lettrage g where g.entreprise = p_entreprise and g.lettre = v_lettre) then
      perform socle.refus(format('la lettre %s est déjà prise', v_lettre));
    end if;
  else
    select coalesce(max(g.rang), 0) + 1 into v_rang from compta.lettrage g where g.entreprise = p_entreprise;
    loop
      v_lettre := compta.lettre_de(v_rang);
      exit when not exists (select 1 from compta.lettrage g where g.entreprise = p_entreprise and g.lettre = v_lettre);
      v_rang := v_rang + 1;
    end loop;
  end if;
  insert into compta.lettrage (entreprise, compte, lettre, rang, cree_par) values (p_entreprise, p_compte, v_lettre, v_rang, socle.moi())
  returning id into v_id;
  insert into compta.ligne_lettree (ligne, lettrage, entreprise)
  select l.id, v_id, p_entreprise from compta.ligne l where l.ecriture = any (p_ecritures) and l.compte = p_compte and (p_lignes is null or l.id = any (p_lignes));
  perform socle.tracer(p_entreprise, 'compta.lettrage.poser', 'lettrage', v_id, null,
    jsonb_build_object('lettre', v_lettre, 'compte', p_compte, 'ecritures', to_jsonb(p_ecritures)));
  return v_lettre;
end $$;

revoke execute on function compta.lettrer(uuid, text, uuid[], text, uuid[]) from public;
grant execute on function compta.lettrer(uuid, text, uuid[], text, uuid[]) to skanfact_app;
