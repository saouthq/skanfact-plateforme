-- 0234 — La console limitée à des adresses (pilotage depuis la console, point 9 ; Skander, 25/11/2026 : « la console ne
-- s'ouvre que depuis les connexions du titulaire »).
--
-- Le titulaire de la console pose la liste des adresses (ou des plages) d'où la console s'ouvre : chez lui, au bureau.
-- Tant que la liste est vide, la console s'ouvre de partout (avec le mot de passe et le code, comme avant) : rien ne
-- change pour personne le jour de la mise à jour. Dès qu'elle porte une adresse, une connexion à la console et chaque
-- appel d'une session déjà ouverte depuis une autre adresse sont refusés ; l'application des clients n'est pas touchée.
--
-- Ne jamais se fermer la porte : la première adresse posée doit contenir celle d'où l'on parle, et on ne retire pas
-- l'adresse qui nous laisse entrer tant qu'aucune autre ne le fait. Si toutes les connexions du titulaire changent (une
-- box changée, un fournisseur d'accès qui attribue une autre adresse), la commande du serveur la rouvre :
-- `node base/equipe.ts adresses-ouvrir "<motif>"` (PG_ADMIN), qui vide la liste et laisse une ligne au journal.

create table plateforme.adresse_console (
  id bigint generated always as identity primary key,
  plage cidr not null unique check (masklen(plage) > 0),
  nom text not null check (length(btrim(nom)) between 1 and 60),
  motif text not null,
  le timestamptz not null,
  par uuid references socle.utilisateur(id)
);
alter table plateforme.adresse_console enable row level security;
alter table plateforme.adresse_console force row level security;

-- Une adresse lue de la requête : une adresse, ou rien (jamais une erreur).
create function plateforme.inet_ou_rien(p text) returns inet
language plpgsql immutable set search_path = pg_catalog as $$
begin return p::inet; exception when others then return null; end $$;

-- Une plage telle qu'on la lit : une adresse seule sans son « /32 » (ou « /128 »), une plage avec sa longueur.
create function plateforme.plage_lisible(p cidr) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when family(p) = 4 and masklen(p) = 32 or family(p) = 6 and masklen(p) = 128 then host(p) else p::text end
$$;

-- Ce que le serveur lit à chaque appel de la console, sans session : cette adresse peut-elle ouvrir la console ? Une liste
-- vide laisse tout passer ; une adresse illisible ne passe pas une liste qui existe.
create function plateforme.adresse_console_permise(p_ip text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, plateforme as $$
declare v_ip inet := plateforme.inet_ou_rien(p_ip);
begin
  if not exists (select 1 from plateforme.adresse_console) then return true; end if;
  return v_ip is not null and exists (select 1 from plateforme.adresse_console a where a.plage >>= v_ip);
end $$;

-- Poser une adresse (ou une plage). p_ici : l'adresse d'où parle le titulaire, que le serveur lit.
create function plateforme.console_ajouter_adresse(p_plage text, p_nom text, p_motif text, p_ici text, p_maintenant timestamptz) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_plage cidr;
  v_ici inet;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.adresse_console'));
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console choisit les adresses d''où elle s''ouvre');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  if length(btrim(coalesce(p_nom, ''))) < 1 or length(btrim(p_nom)) > 60 then
    perform socle.refus('une adresse se nomme (« Maison », « Bureau ») : soixante caractères au plus');
  end if;
  -- Lue comme une adresse (inet), pas comme une plage (cidr) : une adresse s'écrit en entier (« 197.15.20 », que cidr
  -- abrégerait, est refusée), et une plage écrite depuis une de ses adresses (197.15.20.4/24) se ramène à son début.
  begin
    v_plage := network(btrim(coalesce(p_plage, ''))::inet);
  exception when others then
    perform socle.refus('cette adresse ne se lit pas : écris-la comme 197.15.20.4, ou une plage comme 197.15.20.0/24');
  end;
  if masklen(v_plage) = 0 then perform socle.refus('cette plage contient tout internet : vide plutôt la liste'); end if;
  if exists (select 1 from plateforme.adresse_console a where a.plage = v_plage) then
    perform socle.refus('cette adresse est déjà dans la liste');
  end if;
  if (select count(*) from plateforme.adresse_console) >= 20 then
    perform socle.refus('vingt adresses au plus : retire celles qui ne servent plus');
  end if;
  v_ici := plateforme.inet_ou_rien(p_ici);
  -- La première adresse doit laisser entrer celle d'où l'on parle : sinon la console se fermerait au prochain appel.
  if not exists (select 1 from plateforme.adresse_console) and (v_ici is null or not v_plage >>= v_ici) then
    perform socle.refus(format('ton adresse d''aujourd''hui (%s) n''est pas dans cette plage : la console se fermerait pour toi. Pose d''abord ton adresse',
                               coalesce(host(v_ici), 'inconnue')));
  end if;
  insert into plateforme.adresse_console (plage, nom, motif, le, par)
    values (v_plage, btrim(p_nom), btrim(p_motif), p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'console.adresse_ajoutee', btrim(p_motif), null,
            jsonb_build_object('plage', plateforme.plage_lisible(v_plage), 'nom', btrim(p_nom)));
  return v_id;
end $$;

-- Retirer une adresse. Celle qui laisse entrer le titulaire ne se retire pas tant qu'aucune autre ne le fait (vider la
-- liste reste possible : la console s'ouvre alors de partout).
create function plateforme.console_retirer_adresse(p_id bigint, p_motif text, p_ici text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_ligne plateforme.adresse_console;
  v_ici inet;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.adresse_console'));
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console choisit les adresses d''où elle s''ouvre');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  select * into v_ligne from plateforme.adresse_console where id = p_id;
  if v_ligne.id is null then perform socle.refus('cette adresse n''est plus dans la liste : relis la page'); end if;
  v_ici := plateforme.inet_ou_rien(p_ici);
  if exists (select 1 from plateforme.adresse_console a where a.id <> p_id)
     and not exists (select 1 from plateforme.adresse_console a where a.id <> p_id and v_ici is not null and a.plage >>= v_ici) then
    perform socle.refus(format('sans cette adresse, la console ne s''ouvrirait plus depuis la tienne (%s) : ajoute d''abord celle d''où tu travailles, ou retire les autres',
                               coalesce(host(v_ici), 'inconnue')));
  end if;
  delete from plateforme.adresse_console where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'console.adresse_retiree', btrim(p_motif),
            jsonb_build_object('plage', plateforme.plage_lisible(v_ligne.plage), 'nom', v_ligne.nom), null);
end $$;

-- La console : la liste, l'adresse d'où l'on parle et si elle passe, les vingt derniers gestes.
create function plateforme.console_adresses_console(p_ici text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']);
begin
  return jsonb_build_object(
    'titulaire', plateforme.suis_titulaire_console(),
    'nomTitulaire', (select u.nom from socle.utilisateur u where u.id = plateforme.titulaire_console()),
    'ici', p_ici,
    'iciPermise', plateforme.adresse_console_permise(p_ici),
    'adresses', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'plage', plateforme.plage_lisible(a.plage),
        'nom', a.nom, 'motif', a.motif, 'le', a.le, 'par', (select u.nom from socle.utilisateur u where u.id = a.par),
        'contientIci', coalesce(a.plage >>= plateforme.inet_ou_rien(p_ici), false)) order by a.le, a.id)
      from plateforme.adresse_console a), '[]'::jsonb),
    'historique', coalesce((select jsonb_agg(h order by h.le desc, h.id desc) from (
      select g.id, g.le, g.geste, g.motif, g.avant, g.apres, u.nom par
        from plateforme.geste_console g left join socle.utilisateur u on u.id = g.qui
       where g.geste in ('console.adresse_ajoutee', 'console.adresse_retiree', 'console.adresses_ouvertes')
       order by g.le desc, g.id desc limit 20) h), '[]'::jsonb));
end $$;

revoke execute on function plateforme.inet_ou_rien(text), plateforme.plage_lisible(cidr), plateforme.adresse_console_permise(text), plateforme.console_ajouter_adresse(text, text, text, text, timestamptz),
  plateforme.console_retirer_adresse(bigint, text, text, timestamptz), plateforme.console_adresses_console(text) from public;
grant execute on function plateforme.inet_ou_rien(text), plateforme.plage_lisible(cidr), plateforme.adresse_console_permise(text), plateforme.console_ajouter_adresse(text, text, text, text, timestamptz),
  plateforme.console_retirer_adresse(bigint, text, text, timestamptz), plateforme.console_adresses_console(text) to skanfact_app;
