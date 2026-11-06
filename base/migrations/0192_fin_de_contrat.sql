-- 1.290.0 : un contrat récurrent peut avoir une fin (`endDate`, un entretien de douze mois, un bail). Passé sa dernière
-- échéance (la prochaine date est après la fin), il ne produit plus rien : le tour des contrats émis seuls ne le relit
-- plus (il l'aurait relu, et réécrit, à chaque tour). La même règle que `contratTermine` du moteur et que le tour
-- (`serveur/v10/contrats.ts`). Une fin mal écrite ne fait rien (le contrat court) : la règle qui ne fait rien.
create or replace function ventes.contrats_dus(p_jour date) returns jsonb
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
     and not (coalesce(d.contenu ->> 'endDate', '') ~ '^\d{4}-\d{2}-\d{2}$' and d.contenu ->> 'nextDate' > d.contenu ->> 'endDate')
     and coalesce(d.contenu -> 'refusServeur' ->> 'le', '') <> p_jour::text
$$;
revoke execute on function ventes.contrats_dus(date) from public;
grant execute on function ventes.contrats_dus(date) to skanfact_app;
