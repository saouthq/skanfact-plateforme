-- L'exercice et sa balance d'ouverture (brique 39, 29/09/2026 ; docs/cabinet.md, C16 et C17). Un
-- cabinet qui reprend un client tenu ailleurs pose, au premier jour de l'exercice, ce que ses comptes
-- portaient : la balance d'ouverture. Le Cabinet v10 le faisait en « commençant le livre » d'un
-- dossier ; ici, l'exercice s'OUVRE sur le serveur :
--   - son année, son premier jour (le 1er janvier, ou plus tard pour un premier exercice) et son
--     dernier (le 31 décembre : la v10 ne tient que des exercices civils — À VÉRIFIER pour un client
--     dont l'exercice est décalé) ;
--   - sa balance d'ouverture, s'il en a une : UNE écriture du journal AN, pièce « OUVERTURE », datée
--     du premier jour, qui doit s'équilibrer ; posée ET validée d'un geste, dans la même transaction
--     que l'exercice (comme la v10) — ou rien. Elle est saisie par le comptable : fausse, elle se
--     contre-passe, et la bonne se saisit au journal AN.
-- Un exercice s'ouvre une fois. L'ouvrir revient à qui valide (la balance d'ouverture est validée) :
-- avec un mandat de comptabilité, le cabinet (C8).

create table compta.exercice (
  entreprise uuid not null references socle.entreprise(id),
  annee int not null check (annee between 1900 and 2999),
  du date not null,
  au date not null,
  ouverture uuid references compta.ecriture(id),
  ouvert_par uuid references socle.utilisateur(id),
  ouvert_le timestamptz not null default now(),
  primary key (entreprise, annee),
  check (au = make_date(annee, 12, 31) and du >= make_date(annee, 1, 1) and du <= au)
);
alter table compta.exercice enable row level security;
alter table compta.exercice force row level security;
create policy visible on compta.exercice using (entreprise in (select compta.mes_entreprises()));
grant select on compta.exercice to skanfact_app;

-- `p_lignes` : [{ compte, libelle, debit, credit }], les montants en millimes (texte), comme la saisie.
-- Sans ligne (un client qui démarre), l'exercice s'ouvre sans balance d'ouverture.
create function compta.ouvrir_exercice(p_entreprise uuid, p_annee int, p_du date, p_lignes jsonb)
returns table (r_du date, r_au date, r_ouverture uuid, r_numero text)
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_au date; v_id uuid; v record;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if p_annee is null or p_annee < 1900 or p_annee > 2999 then perform socle.refus('une année s''écrit sur quatre chiffres'); end if;
  v_au := make_date(p_annee, 12, 31);
  if p_du is null or p_du < make_date(p_annee, 1, 1) then
    perform socle.refus(format('l''exercice %s ne peut pas commencer avant le 01/01/%s : un premier exercice de plus de douze mois se reprend en deux, l''un par année', p_annee, p_annee));
  end if;
  if p_du > v_au then perform socle.refus(format('l''exercice %s finit le 31/12/%s : il ne peut pas commencer après', p_annee, p_annee)); end if;
  -- L'exercice se réserve d'abord : deux ouvertures au même instant, la seconde lit sa phrase.
  insert into compta.exercice (entreprise, annee, du, au, ouvert_par) values (p_entreprise, p_annee, p_du, v_au, socle.moi())
  on conflict (entreprise, annee) do nothing;
  if not found then
    perform socle.refus(format('l''exercice %s est déjà ouvert : une balance d''ouverture fausse se contre-passe, puis la bonne se saisit au journal AN', p_annee));
  end if;
  if coalesce(jsonb_array_length(p_lignes), 0) > 0 then
    v_id := socle.uuidv7();
    perform compta.poser_saisie(p_entreprise, v_id, jsonb_build_object('date', p_du, 'journal', 'AN', 'piece', 'OUVERTURE',
      'libelle', 'Balance d''ouverture', 'lignes', p_lignes), true);
    select * into v from compta.valider_ecritures(p_entreprise, array[v_id]);
    if v.r_motif is not null then perform socle.refus(format('la balance d''ouverture ne se valide pas : %s', v.r_motif)); end if;
    update compta.exercice set ouverture = v_id where entreprise = p_entreprise and annee = p_annee;
    r_numero := v.r_numero;
  end if;
  perform socle.tracer(p_entreprise, 'compta.exercice.ouvrir', 'exercice', v_id, null,
    jsonb_build_object('annee', p_annee, 'du', p_du, 'au', v_au, 'ouverture', v_id));
  r_du := p_du; r_au := v_au; r_ouverture := v_id;
  return next;
end $$;
revoke execute on function compta.ouvrir_exercice(uuid, int, date, jsonb) from public;
grant execute on function compta.ouvrir_exercice(uuid, int, date, jsonb) to skanfact_app;

-- Les à-nouveaux ne sont l'activité d'aucun mois (C14) : la balance d'ouverture est datée du premier
-- jour de l'exercice, mais elle dit ce que les comptes portaient AVANT lui. Le tableau du portefeuille
-- (0021) compte donc les mois hors journal AN : sans quoi janvier serait « écrit » par la seule balance
-- d'ouverture, et un client dont les pièces de janvier manquent ne serait jamais relancé pour janvier.
create or replace function compta.mois_du_portefeuille(p_cabinet uuid, p_depuis date)
returns table (entreprise uuid, mois text, ecritures bigint, brouillards bigint, ca bigint, dernier timestamptz)
language sql stable security invoker set search_path = pg_catalog, socle, compta as $$
  select e.entreprise, to_char(e.date_ecriture, 'YYYY-MM'), count(*), count(*) filter (where e.statut = 'brouillard'),
         coalesce(sum(v.ca), 0)::bigint, max(greatest(e.cree_le, e.validee_le))
    from compta.ecriture e
    left join lateral (select sum(l.credit - l.debit) ca from compta.ligne l where l.ecriture = e.id and l.compte like '70%') v on true
   where e.entreprise in (select p.entreprise from socle.portefeuille(p_cabinet) p where p.statut = 'actif')
     and e.date_ecriture >= p_depuis
     and e.journal <> 'AN'
   group by e.entreprise, to_char(e.date_ecriture, 'YYYY-MM')
$$;
