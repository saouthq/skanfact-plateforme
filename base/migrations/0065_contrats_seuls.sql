-- Les factures périodiques émises seules (brique 129 ; docs/api-situation.md, S7) : un contrat récurrent de la v10
-- (collection `recurring` du dossier) marqué `emettreSeul` voit ses factures émises PAR LE SERVEUR à leur date, sans
-- brouillon à relire (l'abonnement mensuel d'une boutique en ligne, d'abord). Émettre engage l'entreprise (un numéro
-- légal) : seuls le propriétaire et l'administrateur posent ou retirent ce choix, jusque dans la base.
create function socle.dossier_v10_contrat_seul() returns trigger
language plpgsql as $$
declare
  avant boolean;
  apres boolean;
begin
  if new.collection <> 'recurring' then return new; end if;
  apres := coalesce(new.contenu ->> 'emettreSeul', 'false') = 'true';
  avant := case when tg_op = 'UPDATE' and old.collection = 'recurring' then coalesce(old.contenu ->> 'emettreSeul', 'false') = 'true' else false end;
  if apres is distinct from avant and socle.moi() is not null
     and not (socle.mes_roles(new.entreprise) && array['proprietaire', 'administrateur']) then
    raise exception 'Une facture émise seule engage l''entreprise : ce choix se fait par le propriétaire ou un administrateur.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger dossier_v10_contrat_seul before insert or update on socle.dossier_v10
  for each row execute function socle.dossier_v10_contrat_seul();

-- Les contrats dont une facture est due au jour dit, dans toutes les entreprises (le serveur les émet ensuite au nom du
-- propriétaire, sous sa sécurité par ligne) : actifs, émis seuls, la prochaine date passée ou du jour. Un contrat
-- refusé aujourd'hui (son motif est noté sur le contrat) attend demain.
create function ventes.contrats_dus(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce(jsonb_agg(jsonb_build_object('entreprise', d.entreprise, 'cle', d.cle, 'proprietaire', m.utilisateur) order by d.entreprise, d.cle), '[]'::jsonb)
    from socle.dossier_v10 d
    join socle.membre m on m.entreprise = d.entreprise and m.actif and 'proprietaire' = any(m.roles)
   where d.collection = 'recurring'
     and d.contenu ->> 'emettreSeul' = 'true'
     and coalesce(d.contenu ->> 'active', 'true') <> 'false'
     -- Comparées en texte (AAAA-MM-JJ) : une date mal écrite dans un contrat ne fait jamais tomber le tour de tous.
     and d.contenu ->> 'nextDate' ~ '^\d{4}-\d{2}-\d{2}$'
     and d.contenu ->> 'nextDate' <= p_jour::text
     and coalesce(d.contenu -> 'refusServeur' ->> 'le', '') <> p_jour::text
$$;
revoke execute on function ventes.contrats_dus(date) from public;
grant execute on function ventes.contrats_dus(date) to skanfact_app;
