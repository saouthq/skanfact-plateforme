-- La clôture de l'exercice et sa réouverture (brique 45, 29/09/2026 ; docs/cabinet.md, C35). Le Cabinet
-- v10 marquait un exercice « clos » : plus rien n'y bougeait, et le rouvrir exigeait un motif, gardé
-- avec la date de la clôture qu'il défaisait. Sur la plateforme, les livres ont déjà leur période
-- close (0018 : validée jusqu'à un jour, plus rien ne s'y écrit, une pièce qui change s'écrit au
-- premier jour ouvert). Ici :
--   - clôturer l'exercice, c'est valider la période jusqu'à son dernier jour et le marquer clos (qui,
--     quand) ; il faut qu'il soit fini, et qu'aucune écriture ne reste au brouillard jusque-là (la
--     clôture ne valide rien en silence : valide-les ou supprime-les d'abord) ;
--   - le rouvrir exige un motif : la période close revient où elle était avant la clôture, et la
--     réouverture se garde (quand, qui, pourquoi, la clôture qu'elle défait) ; jamais si des jours
--     d'après l'exercice sont déjà validés (les rouvrir aussi n'est pas ce qu'on demande) ;
--   - une écriture validée ne bouge pas pour autant : elle se contre-passe.
-- Qui : qui valide ; au cabinet, l'associé seulement (la v10 : « supervision »).

alter table compta.exercice add column clos_le timestamptz, add column clos_par uuid references socle.utilisateur(id),
  add column jusqua_avant date;

create table compta.reouverture (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  annee int not null,
  clos_le timestamptz not null,
  clos_par uuid references socle.utilisateur(id),
  rouvert_le timestamptz not null default now(),
  rouvert_par uuid references socle.utilisateur(id),
  motif text not null check (length(motif) between 5 and 500),
  foreign key (entreprise, annee) references compta.exercice (entreprise, annee)
);
create index reouverture_exercice on compta.reouverture (entreprise, annee);
alter table compta.reouverture enable row level security;
alter table compta.reouverture force row level security;
create policy visible on compta.reouverture using (entreprise in (select compta.mes_entreprises()));
grant select on compta.reouverture to skanfact_app;

create function compta.exiger_cloture(p_entreprise uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if socle.perimetre_cabinet(p_entreprise) is not null and not ('supervision' = any(socle.mes_roles(p_entreprise))) then
    perform socle.refus('au cabinet, clôturer ou rouvrir un exercice revient à l''associé');
  end if;
end $$;

-- Clôturer l'exercice d'une année. Rend le dernier jour de la période close.
create function compta.cloturer_exercice(p_entreprise uuid, p_annee int) returns date
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.exercice; c date; n int; aujourdhui date := (now() at time zone 'Africa/Tunis')::date;
begin
  perform compta.exiger_cloture(p_entreprise);
  if p_annee is null or p_annee < 1900 or p_annee > 2999 then perform socle.refus('une année s''écrit sur quatre chiffres'); end if;
  -- Un exercice que le livre tient sans l'avoir ouvert (un client qui démarre) s'ouvre ici, au 1er janvier.
  insert into compta.exercice (entreprise, annee, du, au, ouvert_par) values (p_entreprise, p_annee, make_date(p_annee, 1, 1), make_date(p_annee, 12, 31), socle.moi())
  on conflict (entreprise, annee) do nothing;
  select * into x from compta.exercice where entreprise = p_entreprise and annee = p_annee for update;
  if x.clos_le is not null then
    perform socle.refus(format('l''exercice %s est déjà clos depuis le %s', p_annee, to_char(x.clos_le at time zone 'Africa/Tunis', 'DD/MM/YYYY')));
  end if;
  if x.au >= aujourdhui then
    perform socle.refus(format('l''exercice %s n''est pas fini : il se clôture à partir du %s', p_annee, to_char(x.au + 1, 'DD/MM/YYYY')));
  end if;
  select count(*) into n from compta.ecriture where entreprise = p_entreprise and statut = 'brouillard' and date_ecriture <= x.au;
  if n > 0 then
    perform socle.refus(format('il reste %s au brouillard jusqu''au %s : valide-les ou supprime-les, puis clôture',
      case when n = 1 then '1 écriture' else n || ' écritures' end, to_char(x.au, 'DD/MM/YYYY')));
  end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise for update;
  if c is null or c < x.au then perform compta.valider(p_entreprise, x.au); end if;
  update compta.exercice set clos_le = now(), clos_par = socle.moi(), jusqua_avant = c where entreprise = p_entreprise and annee = p_annee;
  perform socle.tracer(p_entreprise, 'compta.exercice.cloturer', 'exercice', null, null, jsonb_build_object('annee', p_annee, 'jusqua_avant', c));
  return greatest(coalesce(c, x.au), x.au);
end $$;

-- Rouvrir un exercice clos, avec son motif.
create function compta.rouvrir_exercice(p_entreprise uuid, p_annee int, p_motif text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.exercice; c date; v_motif text := btrim(coalesce(p_motif, ''));
begin
  perform compta.exiger_cloture(p_entreprise);
  select * into x from compta.exercice where entreprise = p_entreprise and annee = p_annee for update;
  if not found or x.clos_le is null then perform socle.refus('cet exercice n''est pas clos'); end if;
  if length(v_motif) < 5 then
    perform socle.refus('une réouverture demande un motif : c''est la seule trace qui expliquera pourquoi un chiffre a changé après coup');
  end if;
  if length(v_motif) > 500 then perform socle.refus('un motif se dit en cinq cents caractères au plus'); end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise for update;
  if c > x.au then
    perform socle.refus(format('la période est validée jusqu''au %s, après la fin de l''exercice %s : le rouvrir rouvrirait aussi ces jours-là', to_char(c, 'DD/MM/YYYY'), p_annee));
  end if;
  insert into compta.reouverture (entreprise, annee, clos_le, clos_par, rouvert_par, motif)
  values (p_entreprise, p_annee, x.clos_le, x.clos_par, socle.moi(), v_motif);
  -- La période close revient où elle était : rien de validé avant la clôture, rien de clos après.
  if x.jusqua_avant is null then delete from compta.cloture where entreprise = p_entreprise;
  else update compta.cloture set jusqua = x.jusqua_avant, par = socle.moi(), le = now() where entreprise = p_entreprise; end if;
  update compta.exercice set clos_le = null, clos_par = null, jusqua_avant = null where entreprise = p_entreprise and annee = p_annee;
  perform socle.tracer(p_entreprise, 'compta.exercice.rouvrir', 'exercice', null, jsonb_build_object('clos_le', x.clos_le),
    jsonb_build_object('annee', p_annee, 'motif', v_motif));
end $$;

revoke execute on function compta.exiger_cloture(uuid), compta.cloturer_exercice(uuid, int), compta.rouvrir_exercice(uuid, int, text) from public;
grant execute on function compta.cloturer_exercice(uuid, int), compta.rouvrir_exercice(uuid, int, text) to skanfact_app;
