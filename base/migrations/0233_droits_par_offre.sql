-- 0233 — Les droits par offre (pilotage depuis la console, point 8 ; Skander, 25/11/2026 : « quels modules chaque offre
-- ouvre, réglés depuis la console »).
--
-- Ce que chaque offre comprend est un contenu daté depuis 0105 : des nombres (caisses, établissements, salariés) et deux
-- modules (la paie, la comptabilité complète). Deux modules de plus s'y règlent désormais : le stock et la trésorerie
-- avec les affaires (le module « pilotage » de la console). Au départ, les deux offres les comprennent : rien ne change
-- chez personne tant que le titulaire de la console ne prépare pas autre chose, avec le même préavis qu'un prix.
--
-- Ce qui ne se règle PAS par offre, et pourquoi (docs/pilotage-console.md, point 8) : les achats (une offre ne ferme
-- jamais une case de déclaration : sans eux, la TVA récupérable disparaîtrait de la déclaration du client), les ventes et
-- les fiches (sans elles, il n'y a plus d'application). Un module fermé par l'offre ne cache rien : ce qui existe se lit,
-- s'imprime, s'exporte et se corrige ; seule la création attend (serveur/abonnement/offre.ts).
--
-- Les lignes « module » (la paie, la comptabilité complète, le stock, la trésorerie) se changent par le TITULAIRE de la
-- console seul ; les nombres, par la direction, comme avant.

alter table plateforme.contenu_offre drop constraint contenu_offre_quoi_check;
alter table plateforme.contenu_offre add constraint contenu_offre_quoi_check
  check (quoi in ('caisses', 'etablissements', 'salaries', 'paie', 'compta', 'stock', 'pilotage'));
alter table plateforme.contenu_offre drop constraint contenu_offre_check;
alter table plateforme.contenu_offre add constraint contenu_offre_check
  check (quoi not in ('paie', 'compta', 'stock', 'pilotage') or nombre in (0, 1));

-- Le contenu de départ des deux modules neufs : compris dans les deux offres, depuis toujours.
insert into plateforme.contenu_offre (offre, quoi, nombre, a_partir_du, motif) values
  ('essentiel', 'stock', 1, '2000-01-01', '1.388.78 : le contenu de départ (le stock dans toutes les offres, comme avant)'),
  ('essentiel', 'pilotage', 1, '2000-01-01', '1.388.78 : le contenu de départ (la trésorerie dans toutes les offres, comme avant)'),
  ('complet', 'stock', 1, '2000-01-01', '1.388.78 : le contenu de départ (le stock dans toutes les offres, comme avant)'),
  ('complet', 'pilotage', 1, '2000-01-01', '1.388.78 : le contenu de départ (la trésorerie dans toutes les offres, comme avant)');

create or replace function plateforme.contenu_du_jour(p_offre text, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(jsonb_object_agg(q.quoi, (select c.nombre from plateforme.contenu_offre c
                                             where c.offre = p_offre and c.quoi = q.quoi and c.a_partir_du <= p_jour
                                             order by c.a_partir_du desc limit 1)), '{}'::jsonb)
    from unnest(array['caisses', 'etablissements', 'salaries', 'paie', 'compta', 'stock', 'pilotage']) q(quoi)
$$;

create or replace function plateforme.contenu_histoire() returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(jsonb_object_agg(o.offre, (
      select coalesce(jsonb_object_agg(m.quoi, (
          select coalesce(jsonb_agg(jsonb_build_object('aPartirDu', c.a_partir_du, 'jours', jsonb_build_array(c.nombre)) order by c.a_partir_du), '[]'::jsonb)
            from plateforme.contenu_offre c where c.offre = o.offre and c.quoi = m.quoi)), '{}'::jsonb)
        from unnest(array['paie', 'compta', 'stock', 'pilotage']) m(quoi))), '{}'::jsonb)
    from unnest(array['essentiel', 'complet']) o(offre)
$$;

create or replace function plateforme.console_preparer_contenu(p_offre text, p_quoi text, p_nombre integer, p_a_partir_du date, p_motif text,
                                                               p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_preavis integer := (plateforme.regle_du_jour('preavis_prix', p_jour))[1];
  v_module boolean := p_quoi in ('paie', 'compta', 'stock', 'pilotage');
  v_avant integer;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.contenu_offre'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('changer ce qu''une offre comprend demande son motif (trois caractères au moins)'); end if;
  if p_offre is null or p_offre not in ('essentiel', 'complet') then perform socle.refus('une offre est « essentiel » ou « complet »'); end if;
  if p_quoi is null or p_quoi not in ('caisses', 'etablissements', 'salaries', 'paie', 'compta', 'stock', 'pilotage') then
    perform socle.refus('une offre comprend des caisses, des établissements, des salariés, la paie, la comptabilité complète, le stock ou la trésorerie');
  end if;
  if v_module and not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console change les modules qu''une offre comprend');
  end if;
  if p_nombre is null or p_nombre < 0 or p_nombre > 1000 or (v_module and p_nombre not in (0, 1)) then
    perform socle.refus('ce que l''offre comprend est un nombre de 0 à 1000 ; un module, 1 (compris) ou 0 (non compris)');
  end if;
  if v_preavis is null then perform socle.refus('le préavis d''un nouveau prix n''est pas réglé : règle-le d''abord'); end if;
  if p_a_partir_du is null or p_a_partir_du < p_jour + v_preavis then
    perform socle.refus(format('un nouveau contenu commence au plus tôt le %s : c''est le préavis en vigueur', to_char(p_jour + v_preavis, 'DD/MM/YYYY')));
  end if;
  if exists (select 1 from plateforme.contenu_offre c where c.offre = p_offre and c.quoi = p_quoi and c.a_partir_du > p_jour) then
    perform socle.refus('un changement est déjà préparé pour cette ligne : retire-le avant d''en préparer un autre');
  end if;
  v_avant := (plateforme.contenu_du_jour(p_offre, p_jour)->>p_quoi)::int;
  if v_avant = p_nombre then perform socle.refus('c''est déjà ce que l''offre comprend : rien ne changerait'); end if;
  insert into plateforme.contenu_offre (offre, quoi, nombre, a_partir_du, motif, qui, le)
    values (p_offre, p_quoi, p_nombre, p_a_partir_du, btrim(p_motif), socle.moi(), p_maintenant);
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.contenu_prepare', btrim(p_motif),
            jsonb_build_object('offre', p_offre, 'quoi', p_quoi, 'nombre', v_avant),
            jsonb_build_object('offre', p_offre, 'quoi', p_quoi, 'nombre', p_nombre, 'aPartirDu', p_a_partir_du));
end $$;

-- Retirer un changement de module préparé : le titulaire seul, comme le préparer.
create or replace function plateforme.console_retirer_contenu(p_offre text, p_quoi text, p_a_partir_du date, p_motif text,
                                                              p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_nombre integer;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.contenu_offre'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('retirer un changement de contenu demande son motif (trois caractères au moins)'); end if;
  if p_quoi in ('paie', 'compta', 'stock', 'pilotage') and not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console change les modules qu''une offre comprend');
  end if;
  select c.nombre into v_nombre from plateforme.contenu_offre c where c.offre = p_offre and c.quoi = p_quoi and c.a_partir_du = p_a_partir_du;
  if v_nombre is null then perform socle.refus('ce changement n''existe pas, ou il a déjà été retiré : relis le contenu des offres'); end if;
  if p_a_partir_du <= p_jour then perform socle.refus('ce contenu est déjà en vigueur : il ne se retire plus ; prépare-en un nouveau'); end if;
  delete from plateforme.contenu_offre c where c.offre = p_offre and c.quoi = p_quoi and c.a_partir_du = p_a_partir_du;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.contenu_retire', btrim(p_motif),
            jsonb_build_object('offre', p_offre, 'quoi', p_quoi, 'nombre', v_nombre, 'aPartirDu', p_a_partir_du),
            jsonb_build_object('offre', p_offre, 'quoi', p_quoi, 'nombre', (plateforme.contenu_du_jour(p_offre, p_jour)->>p_quoi)::int));
end $$;
