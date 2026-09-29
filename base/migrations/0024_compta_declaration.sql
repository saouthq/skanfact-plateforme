-- La déclaration du mois (brique 41, 29/09/2026 ; docs/cabinet.md, C22 à C24). Le Cabinet v10
-- préparait la déclaration mensuelle d'un dossier (TVA, timbre, retenues) en la DÉDUISANT de son livre
-- (compta.js, declarationMensuelle), l'enregistrait dans le livre, y posait deux pense-bêtes (déposée,
-- payée) et proposait l'écriture du mois au brouillard. Ici :
--   - le calcul reste celui de la v10, sur le livre du serveur (le moteur tourne dans le navigateur,
--     comme il tournait dans le processus principal de la v10) ;
--   - la déclaration PRÉPARÉE se garde au serveur : ses cases (un montant en millimes, ou rien quand la
--     case ne se sait pas), qui l'a préparée et quand. Une période n'en a qu'une : la refaire la
--     remplace, sauf une fois marquée déposée (dé-pointe-la d'abord) ;
--   - les deux pense-bêtes : déposée (le jour, une référence), payée (le jour). On ne paie pas ce qu'on
--     n'a pas déposé ; dé-pointer le dépôt dé-pointe le paiement avec lui ;
--   - l'écriture du mois entre au brouillard par la saisie (compta.saisir) et se lie à sa déclaration ;
--     supprimée ou contre-passée, le lien ne vaut plus (on peut la refaire). Un complément (une pièce
--     saisie après l'écriture du mois) entre au brouillard sans remplacer le lien.
-- SkanFact ne dépose rien et ne se connecte à aucune administration : « déposée » et « payée » ne
-- sont jamais un accusé de réception.
-- Qui peut : le propriétaire, l'administrateur, la comptabilité interne ; au cabinet, l'associé et le
-- collaborateur, si le mandat comprend les déclarations (03 § 3.1 et § 3.4). La déclaration se lit
-- dans les livres : il faut aussi les voir.

create table compta.declaration (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  type text not null default 'mensuelle' check (type in ('mensuelle')),
  periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- { tvaCollectee: 190000, irpp: null, … } : chaque case en millimes, ou null (elle ne se sait pas).
  cases jsonb not null check (jsonb_typeof(cases) = 'object' and socle.sans_virgule(cases)),
  preparee_par uuid references socle.utilisateur(id),
  preparee_le timestamptz not null default now(),
  deposee_le date,
  deposee_par uuid references socle.utilisateur(id),
  deposee_reference text not null default '' check (length(deposee_reference) <= 100),
  payee_le date,
  payee_par uuid references socle.utilisateur(id),
  ecriture uuid references compta.ecriture(id) on delete set null,
  check (payee_le is null or deposee_le is not null),
  unique (entreprise, type, periode)
);
alter table compta.declaration enable row level security;
alter table compta.declaration force row level security;
create policy visible on compta.declaration using (entreprise in (select compta.mes_entreprises()));
grant select on compta.declaration to skanfact_app;

-- Les cases d'une déclaration : la liste de la v10 (LIBELLES_CASES_DECL), jamais un fourre-tout.
create function compta.cases_declaration() returns text[]
language sql immutable as $$
  select array['tvaCollectee', 'tvaDeductible', 'creditReporte', 'netAPayer', 'creditAReporter', 'timbre', 'retenuesOperees',
               'retenuesSubies', 'irpp', 'aDecaisser', 'tfp', 'foprolos', 'tcl', 'acomptes']
$$;

create function compta.peut_declarer(p_entreprise uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p_entreprise in (select compta.mes_entreprises()) and case
    -- Par son cabinet : le mandat comprend les déclarations, et le rôle sur ce dossier le permet.
    when socle.perimetre_cabinet(p_entreprise) is not null then
      'declarations' = any(socle.perimetre_cabinet(p_entreprise)) and socle.mes_roles(p_entreprise) && array['supervision', 'revision']::text[]
    when socle.ma_cle() is not null then
      exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = p_entreprise and 'compta.declarations.preparer' = any (k.gestes))
    else socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
  end
$$;

create function compta.exiger_declarer(p_entreprise uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  if not compta.peut_declarer(p_entreprise) then perform socle.refus('ton rôle ne permet pas de préparer les déclarations de ce dossier'); end if;
end $$;

-- « 09/2026 » : le mois d'une période, comme la v10 l'écrit dans ses refus.
create function compta.mois_en_texte(p_periode text) returns text
language sql immutable as $$ select substr(p_periode, 6, 2) || '/' || substr(p_periode, 1, 4) $$;

-- Préparer (ou refaire) la déclaration d'une période : ses cases, en millimes.
create function compta.poser_declaration(p_entreprise uuid, p_periode text, p_cases jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare d compta.declaration; v_id uuid; k text; v jsonb;
begin
  perform compta.exiger_declarer(p_entreprise);
  if p_periode is null or p_periode !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then perform socle.refus('la période d''une déclaration mensuelle s''écrit AAAA-MM'); end if;
  if p_cases is null or jsonb_typeof(p_cases) <> 'object' then perform socle.refus('une déclaration porte ses cases'); end if;
  for k, v in select * from jsonb_each(p_cases) loop
    if not (k = any(compta.cases_declaration())) then perform socle.refus(format('la case « %s » n''est pas une case de la déclaration', k)); end if;
    if not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'number' and socle.sans_virgule(v))) then
      perform socle.refus(format('la case « %s » se donne en millimes, ou vide', k));
    end if;
  end loop;
  select * into d from compta.declaration where entreprise = p_entreprise and type = 'mensuelle' and periode = p_periode for update;
  if d.deposee_le is not null then
    perform socle.refus(format('la déclaration de %s est marquée déposée le %s : dé-pointe-la d''abord si tu veux la refaire — sinon deux chiffres différents auraient porté le même dépôt',
      compta.mois_en_texte(p_periode), to_char(d.deposee_le, 'DD/MM/YYYY')));
  end if;
  if d.id is not null then
    update compta.declaration set cases = p_cases, preparee_par = socle.moi(), preparee_le = now() where id = d.id;
    v_id := d.id;
  else
    insert into compta.declaration (entreprise, periode, cases, preparee_par) values (p_entreprise, p_periode, p_cases, socle.moi()) returning id into v_id;
  end if;
  perform socle.tracer(p_entreprise, case when d.id is not null then 'compta.declaration.refaire' else 'compta.declaration.preparer' end,
    'declaration', v_id, case when d.id is null then null else d.cases end, p_cases);
  return v_id;
end $$;

-- Pointer (p_le donné) ou dé-pointer (p_le null) le dépôt ou le paiement. Rend vrai quand le
-- paiement est tombé avec le dépôt (l'écran le dit).
create function compta.pointer_declaration(p_entreprise uuid, p_periode text, p_quoi text, p_le date, p_reference text)
returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare d compta.declaration; v_aussi boolean := false;
begin
  perform compta.exiger_declarer(p_entreprise);
  if p_quoi is null or p_quoi not in ('deposee', 'payee') then perform socle.refus('on ne pointe qu''un dépôt ou un paiement'); end if;
  select * into d from compta.declaration where entreprise = p_entreprise and type = 'mensuelle' and periode = p_periode for update;
  if not found then perform socle.refus('aucune déclaration préparée pour cette période'); end if;
  if p_quoi = 'payee' and p_le is not null and d.deposee_le is null then
    perform socle.refus('cette déclaration n''est pas marquée déposée : on ne paie pas ce qu''on n''a pas déposé');
  end if;
  if p_quoi = 'deposee' then
    v_aussi := p_le is null and d.payee_le is not null;
    update compta.declaration set deposee_le = p_le, deposee_par = case when p_le is null then null else socle.moi() end,
      deposee_reference = case when p_le is null then '' else coalesce(p_reference, '') end,
      payee_le = case when p_le is null then null else payee_le end, payee_par = case when p_le is null then null else payee_par end
     where id = d.id;
  else
    update compta.declaration set payee_le = p_le, payee_par = case when p_le is null then null else socle.moi() end where id = d.id;
  end if;
  perform socle.tracer(p_entreprise, 'compta.declaration.' || case when p_le is null then 'depointer' else 'pointer' end, 'declaration', d.id, null,
    jsonb_build_object('quoi', p_quoi, 'le', p_le, 'aussiPayee', v_aussi));
  return v_aussi;
end $$;

-- L'écriture d'une déclaration vaut tant qu'elle existe et n'est pas contre-passée.
create function compta.ecriture_vivante(p_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, compta as $$
  select p_id is not null and exists (select 1 from compta.ecriture e where e.id = p_id)
     and not exists (select 1 from compta.ecriture c where c.origine_type = 'contre_passation' and c.origine = p_id)
$$;

-- Écrire l'écriture du mois (ou son complément) au brouillard, par la saisie ; la lier à sa
-- déclaration. `p_ecriture` : ce que la saisie reçoit (compta.saisir), daté dans le mois déclaré.
create function compta.ecrire_declaration(p_entreprise uuid, p_periode text, p_ecriture jsonb, p_complement boolean) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare d compta.declaration; v_id uuid;
begin
  perform compta.exiger_declarer(p_entreprise);
  select * into d from compta.declaration where entreprise = p_entreprise and type = 'mensuelle' and periode = p_periode for update;
  if not found then perform socle.refus('prépare la déclaration avant d''en écrire l''écriture'); end if;
  if coalesce(p_ecriture->>'date', '') not like p_periode || '-%' then
    perform socle.refus(format('l''écriture de la déclaration de %s se date dans ce mois', compta.mois_en_texte(p_periode)));
  end if;
  if not coalesce(p_complement, false) and compta.ecriture_vivante(d.ecriture) then
    perform socle.refus('l''écriture de cette déclaration existe déjà dans le livre : la repasser compterait la TVA du mois deux fois');
  end if;
  v_id := compta.saisir(p_entreprise, p_ecriture);
  if not coalesce(p_complement, false) then update compta.declaration set ecriture = v_id where id = d.id; end if;
  return v_id;
end $$;

revoke execute on function compta.peut_declarer(uuid), compta.exiger_declarer(uuid), compta.ecriture_vivante(uuid),
  compta.poser_declaration(uuid, text, jsonb), compta.pointer_declaration(uuid, text, text, date, text),
  compta.ecrire_declaration(uuid, text, jsonb, boolean) from public;
grant execute on function compta.peut_declarer(uuid), compta.ecriture_vivante(uuid),
  compta.poser_declaration(uuid, text, jsonb), compta.pointer_declaration(uuid, text, text, date, text),
  compta.ecrire_declaration(uuid, text, jsonb, boolean) to skanfact_app;
