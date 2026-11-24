-- 0225 — Les organisations de test, rangées à part dans la console.
--
-- La console de production porte les entreprises créées pour essayer la plateforme (« test vide », « Boulangerie
-- d'essai (fictive) »…) au milieu des vrais clients : elles gonflent « À décider », les relances et les comptes. Les
-- effacer toucherait une centaine de tables et ne se défait pas ; on les CLASSE : une organisation de test sort des listes
-- de la console, et se remet d'un geste. Rien ne s'écrit dans son dossier.
--
-- Règles :
--   - la direction seule, avec son motif (au journal de la console) ;
--   - refusé dès que l'entreprise a une pièce émise, un règlement ou une facture d'abonnement : une entreprise qui a
--     émis ou payé n'est plus un essai, et la sortir des listes cacherait un vrai client ;
--   - l'entreprise de SkanFact elle-même ne se classe jamais.

create table plateforme.organisation_test (
  entreprise uuid primary key references socle.entreprise(id) on delete cascade,
  motif text not null check (length(btrim(motif)) between 3 and 500),
  le timestamptz not null,
  par uuid not null references socle.utilisateur(id)
);
alter table plateforme.organisation_test enable row level security;
alter table plateforme.organisation_test force row level security;

create function plateforme.console_classer_test(p_entreprise uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_nom text;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  select raison_sociale into v_nom from socle.entreprise where id = p_entreprise for update;
  if not found then perform socle.refus('cette entreprise n''existe pas'); end if;
  if exists (select 1 from plateforme.facture_abonnement f where f.editeur = p_entreprise) then
    perform socle.refus('l''entreprise de SkanFact n''est pas une organisation de test');
  end if;
  if exists (select 1 from ventes.piece p where p.entreprise = p_entreprise and p.statut = 'emise')
     or exists (select 1 from ventes.reglement r where r.entreprise = p_entreprise)
     or exists (select 1 from plateforme.facture_abonnement f where f.entreprise = p_entreprise) then
    perform socle.refus('cette entreprise a émis une pièce, reçu un règlement ou une facture d''abonnement : ce n''est pas un essai, elle reste dans la liste');
  end if;
  if exists (select 1 from plateforme.organisation_test where entreprise = p_entreprise) then
    perform socle.refus('cette organisation est déjà rangée avec les organisations de test');
  end if;
  insert into plateforme.organisation_test (entreprise, motif, le, par) values (p_entreprise, btrim(p_motif), p_maintenant, socle.moi());
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.test_classee', p_entreprise, btrim(p_motif), null, jsonb_build_object('nom', v_nom));
end $$;

create function plateforme.console_declasser_test(p_entreprise uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  delete from plateforme.organisation_test where entreprise = p_entreprise;
  if not found then perform socle.refus('cette organisation n''est pas rangée avec les organisations de test'); end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.test_remise', p_entreprise, btrim(p_motif), null, null);
end $$;

-- La liste, pour la console : qui est rangé là, quand, par qui, pourquoi (direction et support la lisent).
create function plateforme.console_organisations_test() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.entreprise, 'nom', e.raison_sociale, 'motif', t.motif, 'le', t.le,
      'par', (select u.nom from socle.utilisateur u where u.id = t.par)) order by e.raison_sociale)
    from plateforme.organisation_test t join socle.entreprise e on e.id = t.entreprise), '[]'::jsonb);
end $$;

revoke execute on function plateforme.console_classer_test(uuid, text, timestamptz), plateforme.console_declasser_test(uuid, text, timestamptz),
  plateforme.console_organisations_test() from public;
grant execute on function plateforme.console_classer_test(uuid, text, timestamptz), plateforme.console_declasser_test(uuid, text, timestamptz),
  plateforme.console_organisations_test() to skanfact_app;
