-- 0101 — Ce qui s'ajoute à l'offre, dans les Réglages de la console (abonnement 14c, fin ; docs/console.md C28,
-- docs/abonnement.md « 14c »). Décidé par délégation le 14/10/2026.
--
-- La console lit les prix datés de ce qui s'ajoute à l'offre (plateforme.prix_option, 0099) comme ceux des offres : en
-- vigueur et à venir ; et les modules achetés seuls, abonnement par abonnement, que le serveur compte sur le même état
-- que la liste des clients (les abonnés d'aujourd'hui). La direction et le support lisent ; rien ne s'y écrit.
create function plateforme.console_ajouts(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object(
    'options', (select coalesce(jsonb_agg(jsonb_build_object('option', p.option, 'periodicite', p.periodicite, 'aPartirDu', p.a_partir_du,
                  'montantHt', p.montant_ht::text) order by p.option, p.periodicite, p.a_partir_du), '[]'::jsonb)
                  from plateforme.prix_option p),
    'modules', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', a.entreprise, 'modules', to_jsonb(a.modules)) order by a.entreprise), '[]'::jsonb)
                  from plateforme.abonnement a where cardinality(a.modules) > 0));
end $$;

revoke execute on function plateforme.console_ajouts(date) from public;
grant execute on function plateforme.console_ajouts(date) to skanfact_app;
