-- La banque (brique 40, 29/09/2026 ; docs/cabinet.md, C19 à C21). Le Cabinet v10 importait le relevé
-- d'un compte bancaire dans le livre d'un dossier, puis rapprochait chaque ligne du relevé de la ligne
-- d'écriture qui lui répond. Ici, au serveur :
--   - un RELEVÉ : son compte (532…), sa banque, ses dates, ses deux soldes, le nom du fichier et son
--     empreinte (celle de ses octets : le même fichier ne s'importe pas deux fois) ; il se range dans
--     le livre d'une année, comme la v10 le rangeait ; il doit se BOUCLER (solde de début + mouvements
--     = solde de fin), sinon il manque des lignes et il se refuse ;
--   - ses LIGNES, montants au sens de la banque (positif : l'argent entre), en millimes ; une ligne
--     garde le jugement de l'automatique quand il n'a pas tranché (« probable », « à confirmer ») ;
--   - un RAPPROCHEMENT : une ligne du relevé et LA ligne d'écriture qui lui répond, sur le même compte.
--     Une ligne d'écriture ne répond que d'une ligne de relevé. Un brouillard peut être rapproché (le
--     comptable écrit depuis le relevé et valide ensuite, comme dans la v10) ; s'il change, ses lignes
--     renaissent et le rapprochement tombe avec elles : la ligne du relevé redevient « sans réponse »,
--     à l'écran, jamais un rapprochement vers une ligne qui n'existe plus.
-- Importer, rapprocher, retirer : qui saisit (le droit « saisie » de la v10).

create table compta.releve (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  annee int not null check (annee between 1900 and 2999),
  compte text not null check (compte ~ '^[0-9]{1,12}$'),
  banque text not null default '' check (length(banque) <= 60),
  du date not null,
  au date not null,
  solde_debut bigint not null,
  solde_fin bigint not null,
  fichier text not null default '' check (length(fichier) <= 200),
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  importe_par uuid references socle.utilisateur(id),
  importe_le timestamptz not null default now(),
  check (du <= au),
  unique (entreprise, empreinte)
);
alter table compta.releve enable row level security;
alter table compta.releve force row level security;
create policy visible on compta.releve using (entreprise in (select compta.mes_entreprises()));
grant select on compta.releve to skanfact_app;

create table compta.releve_ligne (
  id uuid primary key default socle.uuidv7(),
  releve uuid not null references compta.releve(id) on delete cascade,
  entreprise uuid not null references socle.entreprise(id),
  rang int not null check (rang >= 1),
  date_operation date not null,
  libelle text not null default '' check (length(libelle) <= 500),
  reference text not null default '' check (length(reference) <= 100),
  montant bigint not null,
  -- Le jugement de l'automatique quand il n'a pas tranché ; « aucun » sinon.
  niveau text not null default 'aucun' check (niveau in ('aucun', 'probable', 'a-confirmer')),
  unique (releve, rang)
);
create index releve_ligne_entreprise on compta.releve_ligne (entreprise);
alter table compta.releve_ligne enable row level security;
alter table compta.releve_ligne force row level security;
create policy visible on compta.releve_ligne using (entreprise in (select compta.mes_entreprises()));
grant select on compta.releve_ligne to skanfact_app;

create table compta.rapprochement (
  releve_ligne uuid primary key references compta.releve_ligne(id) on delete cascade,
  ligne uuid not null unique references compta.ligne(id) on delete cascade,
  entreprise uuid not null references socle.entreprise(id),
  niveau text not null check (niveau in ('certain', 'probable', 'a-confirmer')),
  auto boolean not null default false,
  pose_par uuid references socle.utilisateur(id),
  pose_le timestamptz not null default now()
);
alter table compta.rapprochement enable row level security;
alter table compta.rapprochement force row level security;
create policy visible on compta.rapprochement using (entreprise in (select compta.mes_entreprises()));
grant select on compta.rapprochement to skanfact_app;

-- `p_releve` : { compte, banque, fichier, empreinte, soldeDebut, soldeFin, lignes: [{ date, libelle,
-- reference, montant }] }, les montants en millimes (texte). Le doublon se juge AVANT le bouclage :
-- c'est une propriété du fichier (la v10, T-08).
create function compta.importer_releve(p_entreprise uuid, p_annee int, p_releve jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_id uuid; d record; v_debut bigint; v_fin bigint; v_somme bigint; v_n int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  select importe_le, du, au into d from compta.releve where entreprise = p_entreprise and empreinte = p_releve->>'empreinte';
  if found then
    perform socle.refus(format('ce fichier a déjà été importé le %s (%s → %s)',
      to_char(d.importe_le, 'DD/MM/YYYY'), to_char(d.du, 'DD/MM/YYYY'), to_char(d.au, 'DD/MM/YYYY')));
  end if;
  if coalesce(p_releve->>'compte', '') !~ '^[0-9]{1,12}$' then
    perform socle.refus('choisis le compte bancaire de ce relevé avant de l''importer : il ne se devine pas');
  end if;
  v_n := coalesce(jsonb_array_length(p_releve->'lignes'), 0);
  if v_n = 0 then perform socle.refus('ce relevé ne porte aucune ligne lisible'); end if;
  if v_n > 5000 then perform socle.refus('un relevé se borne à cinq mille lignes : importe-le en plusieurs fichiers'); end if;
  v_debut := (p_releve->>'soldeDebut')::bigint;
  v_fin := (p_releve->>'soldeFin')::bigint;
  select coalesce(sum((l->>'montant')::bigint), 0) into v_somme from jsonb_array_elements(p_releve->'lignes') l;
  if v_debut + v_somme <> v_fin then
    perform socle.refus(format('ce relevé ne se boucle pas : %s au départ, %s de mouvements, cela fait %s — et le relevé annonce %s. Il manque %s : il manque des lignes, ou le solde de fin n''est pas le bon',
      compta.en_texte(v_debut), compta.en_texte(v_somme), compta.en_texte(v_debut + v_somme), compta.en_texte(v_fin), compta.en_texte(abs(v_debut + v_somme - v_fin))));
  end if;
  insert into compta.releve (entreprise, annee, compte, banque, du, au, solde_debut, solde_fin, fichier, empreinte, importe_par)
  select p_entreprise, p_annee, p_releve->>'compte', coalesce(p_releve->>'banque', ''), min((l->>'date')::date), max((l->>'date')::date),
         v_debut, v_fin, coalesce(p_releve->>'fichier', ''), p_releve->>'empreinte', socle.moi()
    from jsonb_array_elements(p_releve->'lignes') l
  returning id into v_id;
  insert into compta.releve_ligne (releve, entreprise, rang, date_operation, libelle, reference, montant)
  select v_id, p_entreprise, t.rang, (t.l->>'date')::date, coalesce(t.l->>'libelle', ''), coalesce(t.l->>'reference', ''), (t.l->>'montant')::bigint
    from jsonb_array_elements(p_releve->'lignes') with ordinality t(l, rang);
  perform socle.tracer(p_entreprise, 'compta.releve.importer', 'releve', v_id, null,
    jsonb_build_object('compte', p_releve->>'compte', 'lignes', v_n, 'soldeDebut', v_debut, 'soldeFin', v_fin));
  return v_id;
end $$;

-- Retirer un relevé : ses lignes et ses rapprochements avec lui ; les écritures, jamais (elles ont été
-- décidées par un clic).
create function compta.retirer_releve(p_entreprise uuid, p_releve uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  delete from compta.releve where id = p_releve and entreprise = p_entreprise;
  if not found then perform socle.refus('ce relevé n''existe pas'); end if;
  perform socle.tracer(p_entreprise, 'compta.releve.retirer', 'releve', p_releve, null, null);
end $$;

-- Poser, défaire ou juger des lignes d'un relevé : `p_poses` = [{ ligne (du relevé), ecritureLigne
-- (la ligne d'écriture, ou null pour défaire), niveau, auto }]. Un jugement sans écriture (« probable »,
-- « à confirmer », « aucun ») se garde sur la ligne du relevé.
create function compta.rapprocher(p_entreprise uuid, p_releve uuid, p_poses jsonb) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare r record; p jsonb; v_ligne uuid; v_face uuid; v_niveau text; v_compte text; v_n int := 0;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  select compte into r from compta.releve where id = p_releve and entreprise = p_entreprise;
  if not found then perform socle.refus('ce relevé n''existe pas'); end if;
  for p in select * from jsonb_array_elements(p_poses) loop
    v_ligne := (p->>'ligne')::uuid;
    v_face := nullif(p->>'ecritureLigne', '')::uuid;
    v_niveau := coalesce(p->>'niveau', 'aucun');
    perform 1 from compta.releve_ligne where id = v_ligne and releve = p_releve;
    if not found then perform socle.refus('cette ligne de relevé n''existe pas'); end if;
    if v_face is null then
      if v_niveau not in ('aucun', 'probable', 'a-confirmer') then perform socle.refus('un jugement sans écriture en face est « probable », « à confirmer » ou « aucun »'); end if;
      delete from compta.rapprochement where releve_ligne = v_ligne;
      update compta.releve_ligne set niveau = v_niveau where id = v_ligne;
    else
      if v_niveau not in ('certain', 'probable', 'a-confirmer') then perform socle.refus('un rapprochement posé ne peut pas être « aucun » : c''est ce que veut dire le défaire'); end if;
      select l.compte into v_compte from compta.ligne l where l.id = v_face and l.entreprise = p_entreprise;
      if not found then perform socle.refus('cette écriture n''existe pas'); end if;
      if v_compte <> r.compte then perform socle.refus(format('cette ligne d''écriture ne touche pas le compte %s', r.compte)); end if;
      if exists (select 1 from compta.rapprochement where ligne = v_face and releve_ligne <> v_ligne) then
        perform socle.refus('cette ligne d''écriture répond déjà d''une autre ligne de relevé : défais ce rapprochement d''abord');
      end if;
      insert into compta.rapprochement (releve_ligne, ligne, entreprise, niveau, auto, pose_par)
      values (v_ligne, v_face, p_entreprise, v_niveau, coalesce((p->>'auto')::boolean, false), socle.moi())
      on conflict (releve_ligne) do update set ligne = excluded.ligne, niveau = excluded.niveau, auto = excluded.auto,
        pose_par = excluded.pose_par, pose_le = now();
      update compta.releve_ligne set niveau = 'aucun' where id = v_ligne;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform socle.tracer(p_entreprise, 'compta.releve.rapprocher', 'releve', p_releve, null, jsonb_build_object('lignes', v_n)); end if;
  return v_n;
end $$;

-- Tout défaire d'un relevé (après un automatique qui s'est trompé de compte) : combien.
create function compta.derapprocher(p_entreprise uuid, p_releve uuid) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_n int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  perform 1 from compta.releve where id = p_releve and entreprise = p_entreprise;
  if not found then perform socle.refus('ce relevé n''existe pas'); end if;
  delete from compta.rapprochement a using compta.releve_ligne l where a.releve_ligne = l.id and l.releve = p_releve;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform socle.tracer(p_entreprise, 'compta.releve.derapprocher', 'releve', p_releve, null, jsonb_build_object('lignes', v_n)); end if;
  return v_n;
end $$;

revoke execute on function compta.importer_releve(uuid, int, jsonb) from public;
revoke execute on function compta.retirer_releve(uuid, uuid) from public;
revoke execute on function compta.rapprocher(uuid, uuid, jsonb) from public;
revoke execute on function compta.derapprocher(uuid, uuid) from public;
grant execute on function compta.importer_releve(uuid, int, jsonb) to skanfact_app;
grant execute on function compta.retirer_releve(uuid, uuid) to skanfact_app;
grant execute on function compta.rapprocher(uuid, uuid, jsonb) to skanfact_app;
grant execute on function compta.derapprocher(uuid, uuid) to skanfact_app;

-- Les réglages du cabinet (C21) : ce que la banque apprend pour tous ses clients — l'association des
-- colonnes PAR BANQUE, et les mots retenus (un mot d'un libellé de relevé → le compte proposé). La
-- liste de leurs champs est fixée par le serveur (serveur/cabinet/routes.ts), jamais un fourre-tout.
-- Les lit et les écrit qui est du cabinet.
create table cabinet.reglages (
  cabinet uuid primary key references socle.organisation(id),
  contenu jsonb not null check (jsonb_typeof(contenu) = 'object' and socle.sans_virgule(contenu)),
  revision bigint not null default 1,
  modifie_par uuid references socle.utilisateur(id),
  modifie_le timestamptz not null default now()
);
alter table cabinet.reglages enable row level security;
alter table cabinet.reglages force row level security;
create policy visible on cabinet.reglages using (cabinet in (select socle.mes_organisations()));
grant select, insert, update on cabinet.reglages to skanfact_app;
