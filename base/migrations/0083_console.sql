-- La console de SkanFact, première partie (Console 1, 13/10/2026 ; skanfact docs/cadrage/10-console.md, 03 § 5, 06 § 3 ;
-- docs/console.md) : l'équipe SkanFact, sa connexion à part, le journal de ses gestes, et ce qu'elle lit des clients.
--
-- 1. L'équipe : un compte par personne (celui de l'application), un rôle (la direction, le support, la technique). Le
--    premier membre se pose par l'outil de l'exploitation (base/equipe.ts) ; ensuite, la direction ajoute, change et
--    retire. Un membre retiré ne s'efface pas : son nom reste sur ses gestes.
-- 2. Une connexion à part : ses défis et ses sessions vivent ici, jamais dans socle.session. Un jeton de la console
--    n'ouvre rien dans l'application, un jeton de l'application n'ouvre pas la console. Le code du téléphone (SMS ou
--    application) à CHAQUE connexion, jamais sur l'ordinateur d'un autre ; une heure sans geste, douze heures au plus.
-- 3. Chaque geste de la console laisse une ligne qu'on ne modifie ni n'efface : qui, quand, quoi, sur qui, pourquoi.
-- 4. Ce que la console lit d'un client passe par des fonctions qui vérifient d'abord la session de la console (posée par
--    le serveur pour la transaction : app.session_console) et le rôle. La liste est fermée (10 § 4) : jamais le contenu
--    d'un dossier, seulement des comptes qui ne révèlent rien.

-- ── 1. L'équipe ──────────────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.equipe (
  utilisateur uuid primary key references socle.utilisateur(id),
  role text not null check (role in ('direction', 'support', 'technique')),
  actif boolean not null default true,
  ajoute_le timestamptz not null default now(),
  retire_le timestamptz,
  check (actif = (retire_le is null))
);
alter table plateforme.equipe enable row level security;
alter table plateforme.equipe force row level security;

-- ── 2. La connexion à part ───────────────────────────────────────────────────────────────────────────────────────────
-- Le défi : le mot de passe est bon, il faut le code du téléphone.
create table plateforme.defi_console (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  appareil uuid not null references socle.appareil(id),
  methode text not null check (methode in ('sms', 'application')),
  -- Pour un SMS : l'empreinte du code envoyé. Pour une application : vide (le code se calcule).
  code_empreinte text,
  cree_le timestamptz not null,
  expire_le timestamptz not null,
  erreurs int not null default 0,
  envois int not null default 1,
  envoye_le timestamptz,
  resolu_le timestamptz
);
alter table plateforme.defi_console enable row level security;
alter table plateforme.defi_console force row level security;

-- La session : un jeton gardé en empreinte seulement.
create table plateforme.session_console (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  appareil uuid not null references socle.appareil(id),
  jeton_empreinte text not null unique,
  ouverte_le timestamptz not null,
  derniere_activite timestamptz not null,
  expire_le timestamptz not null,
  fermee_le timestamptz,
  ip inet
);
create index session_console_utilisateur on plateforme.session_console (utilisateur) where fermee_le is null;
alter table plateforme.session_console enable row level security;
alter table plateforme.session_console force row level security;

-- ── 3. Le journal de la console ──────────────────────────────────────────────────────────────────────────────────────
create table plateforme.geste_console (
  id uuid primary key default socle.uuidv7(),
  le timestamptz not null default now(),
  -- Qui, et avec quel rôle. Vide : l'outil de l'exploitation, sur le serveur (le premier membre de l'équipe).
  qui uuid references socle.utilisateur(id),
  role text check (role in ('direction', 'support', 'technique')),
  geste text not null check (geste ~ '^[a-z_]+\.[a-z_-]+$'),
  -- Sur qui : une entreprise (son abonnement), un membre de l'équipe.
  entreprise uuid references socle.entreprise(id),
  membre uuid references socle.utilisateur(id),
  -- L'événement d'abonnement que le geste a posé (son histoire, vue par l'entreprise sans le motif).
  evenement uuid references plateforme.evenement_abonnement(id),
  motif text not null check (length(btrim(motif)) >= 3),
  avant jsonb,
  apres jsonb,
  check ((qui is null) = (role is null))
);
create index geste_console_le on plateforme.geste_console (le desc, id desc);
create index geste_console_entreprise on plateforme.geste_console (entreprise, le desc) where entreprise is not null;
alter table plateforme.geste_console enable row level security;
alter table plateforme.geste_console force row level security;

create function plateforme.geste_console_intouchable() returns trigger
language plpgsql as $$
begin
  raise exception 'un geste de la console ne se modifie pas et ne s''efface pas';
end $$;
create trigger geste_console_intouchable before update or delete on plateforme.geste_console
  for each row execute function plateforme.geste_console_intouchable();

-- ── 4. Se connecter à la console ─────────────────────────────────────────────────────────────────────────────────────
-- Le rôle d'un membre ACTIF de l'équipe, ou rien. Avant de savoir qui est « moi » (la connexion) : le serveur seul.
create function plateforme.role_dans_l_equipe(p_utilisateur uuid) returns text
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select e.role from plateforme.equipe e where e.utilisateur = p_utilisateur and e.actif
$$;

-- Ouvrir un défi : pour un membre actif, sur un de SES appareils non retirés ; sinon rien.
create function plateforme.ouvrir_defi_console(p_utilisateur uuid, p_appareil uuid, p_methode text, p_code_empreinte text,
                                                p_maintenant timestamptz, p_duree interval) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v uuid;
begin
  if plateforme.role_dans_l_equipe(p_utilisateur) is null
     or not exists (select 1 from socle.appareil a where a.id = p_appareil and a.utilisateur = p_utilisateur and a.revoque_le is null) then
    return null;
  end if;
  insert into plateforme.defi_console (utilisateur, appareil, methode, code_empreinte, cree_le, expire_le, envoye_le)
    values (p_utilisateur, p_appareil, p_methode, p_code_empreinte, p_maintenant, p_maintenant + p_duree,
            case when p_methode = 'sms' then p_maintenant end)
    returning id into v;
  return v;
end $$;

-- Lire un défi encore ouvert, d'un membre encore actif (le serveur vérifie le code avec ce qu'il rend).
create function plateforme.lire_defi_console(p_defi uuid, p_maintenant timestamptz)
returns table (utilisateur uuid, appareil uuid, methode text, code_empreinte text, code_secret text, erreurs int, email text)
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select d.utilisateur, d.appareil, d.methode, d.code_empreinte, u.code_secret, d.erreurs, u.email
    from plateforme.defi_console d join socle.utilisateur u on u.id = d.utilisateur
   where d.id = p_defi and d.resolu_le is null and d.expire_le > p_maintenant and d.erreurs < 5
     and plateforme.role_dans_l_equipe(d.utilisateur) is not null
$$;

create function plateforme.defi_console_erreur(p_defi uuid) returns void
language sql volatile security definer set search_path = pg_catalog, plateforme as $$
  update plateforme.defi_console set erreurs = erreurs + 1 where id = p_defi
$$;

-- « Renvoyer le code » par SMS : un nouveau code remplace l'ancien, cinq envois au plus par défi, pas deux en moins de
-- trente secondes. Rend le numéro où l'envoyer, ou rien.
create function plateforme.renvoyer_defi_console(p_defi uuid, p_code_empreinte text, p_maintenant timestamptz, p_duree interval) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_utilisateur uuid;
begin
  update plateforme.defi_console d
     set code_empreinte = p_code_empreinte, envois = d.envois + 1, envoye_le = p_maintenant, expire_le = p_maintenant + p_duree
   where d.id = p_defi and d.methode = 'sms' and d.resolu_le is null and d.expire_le > p_maintenant and d.erreurs < 5
     and d.envois < 5 and (d.envoye_le is null or d.envoye_le <= p_maintenant - interval '30 seconds')
     and plateforme.role_dans_l_equipe(d.utilisateur) is not null
   returning d.utilisateur into v_utilisateur;
  if v_utilisateur is null then return null; end if;
  return (select u.telephone from socle.utilisateur u where u.id = v_utilisateur);
end $$;

-- Le défi réussi : il se ferme (un code ne sert qu'une fois), l'appareil est reconnu 30 jours (comme dans
-- l'application), et la session de la console s'ouvre : une heure sans geste, douze heures au plus.
create function plateforme.conclure_defi_console(p_defi uuid, p_jeton_empreinte text, p_maintenant timestamptz, p_ip inet) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare d record; v_session uuid;
begin
  update plateforme.defi_console set resolu_le = p_maintenant
   where id = p_defi and resolu_le is null and expire_le > p_maintenant
   returning * into d;
  if not found or plateforme.role_dans_l_equipe(d.utilisateur) is null then
    raise exception 'ce code n''est plus valable : recommence la connexion' using errcode = '42501';
  end if;
  update socle.appareil set reconnu_jusqu_au = p_maintenant + interval '30 days', dernier_vu = p_maintenant
   where id = d.appareil and utilisateur = d.utilisateur and revoque_le is null;
  insert into plateforme.session_console (utilisateur, appareil, jeton_empreinte, ouverte_le, derniere_activite, expire_le, ip)
    values (d.utilisateur, d.appareil, p_jeton_empreinte, p_maintenant, p_maintenant, p_maintenant + interval '12 hours', p_ip)
    returning id into v_session;
  return v_session;
end $$;

-- Qui est derrière ce jeton de la console ? La session doit être ouverte, active depuis moins d'une heure, dans ses douze
-- heures ; son appareil ne doit pas être retiré, et la personne doit être encore dans l'équipe. Chaque lecture repousse
-- l'inaction.
create function plateforme.qui_est_console(p_jeton_empreinte text, p_maintenant timestamptz)
returns table (utilisateur uuid, session uuid, appareil uuid, role text)
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  return query
  update plateforme.session_console s set derniere_activite = p_maintenant
    from plateforme.equipe e
   where e.utilisateur = s.utilisateur and e.actif
     and s.jeton_empreinte = p_jeton_empreinte and s.fermee_le is null
     and s.expire_le > p_maintenant and s.derniere_activite + interval '1 hour' > p_maintenant
     and not exists (select 1 from socle.appareil a where a.id = s.appareil and a.revoque_le is not null)
  returning s.utilisateur, s.id, s.appareil, e.role;
end $$;

-- ── 5. La garde de chaque fonction de la console ─────────────────────────────────────────────────────────────────────
-- Mon rôle dans la console : celui d'un membre actif de l'équipe, dans une session de la console ouverte, à lui, que le
-- serveur a posée pour cette transaction. Sinon rien, et chaque fonction ci-dessous refuse : une transaction de
-- l'application (sa session à elle) n'ouvre rien ici, même au nom d'un membre de l'équipe.
create function plateforme.mon_role_console() returns text
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select e.role from plateforme.equipe e
    join plateforme.session_console s on s.utilisateur = e.utilisateur
   where e.utilisateur = socle.moi() and e.actif
     and s.id = nullif(current_setting('app.session_console', true), '')::uuid
     and s.fermee_le is null
$$;

create function plateforme.exiger_role_console(p_roles text[]) returns text
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v text := plateforme.mon_role_console();
begin
  if v is null then perform socle.refus('la console demande une session de la console : connecte-toi à la console'); end if;
  if not (v = any(p_roles)) then perform socle.refus('ton rôle dans l''équipe SkanFact ne permet pas ce geste'); end if;
  return v;
end $$;

-- Se déconnecter : la session de cette transaction, la sienne seulement.
create function plateforme.fermer_ma_session_console(p_maintenant timestamptz) returns void
language sql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
  update plateforme.session_console set fermee_le = p_maintenant
   where id = nullif(current_setting('app.session_console', true), '')::uuid and utilisateur = socle.moi() and fermee_le is null
$$;

-- Qui je suis dans la console (l'en-tête, le menu selon le rôle).
create function plateforme.console_moi() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']);
begin
  return (select jsonb_build_object('utilisateur', u.id, 'nom', u.nom, 'email', u.email, 'role', v_role)
            from socle.utilisateur u where u.id = socle.moi());
end $$;

-- ── 6. Ce que la console lit des clients (10 § 4 : la liste fermée) ──────────────────────────────────────────────────
-- La ligne d'un abonnement telle que la console la lit, la renvoie, et que la base compare avant d'écrire (01 R15).
create function plateforme.ligne_abonnement(a plateforme.abonnement) returns jsonb
language sql immutable set search_path = pg_catalog, plateforme as $$
  select case when a.entreprise is null then null else jsonb_build_object(
    'essai_jusqu_au', a.essai_jusqu_au, 'paye_jusqu_au', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilie_le', a.resilie_le, 'suspendu_le', a.suspendu_le, 'offert', a.offert) end
$$;

-- Les entreprises des clients, une ligne chacune : qui elles sont, leur abonnement (les faits ; l'état se déduit au
-- serveur, du jour de Tunis), leur propriétaire, des comptes. Ni les entreprises d'exemple des personnes (le bac à
-- sable), ni rien de ce qu'elles contiennent.
create function plateforme.console_entreprises() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal, 'active', e.active,
      'creeLe', (e.cree_le at time zone e.fuseau)::date,
      'organisation', jsonb_build_object('id', o.id, 'type', o.type, 'nom', o.nom),
      'tenuePar', (select c.nom from socle.organisation c where c.id = e.tenue_par),
      'faits', jsonb_build_object('connu', a.entreprise is not null, 'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au,
        'offre', a.offre, 'periodicite', a.periodicite, 'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le,
        'offert', coalesce(a.offert, false), 'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null),
      'proprietaire', (select jsonb_build_object('nom', u.nom, 'email', u.email) from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                        where m.entreprise = e.id and m.actif and 'proprietaire' = any(m.roles) order by m.depuis limit 1),
      'membres', (select count(*) from socle.membre m where m.entreprise = e.id and m.actif),
      'derniereActivite', (select max(s.derniere_activite) from socle.session s
                            where s.utilisateur in (select m.utilisateur from socle.membre m where m.entreprise = e.id and m.actif)),
      'pieces', (select count(*) from socle.dossier_v10 d where d.entreprise = e.id and d.collection in ('documents', 'purchases'))
    ) order by e.cree_le desc, e.id), '[]'::jsonb)
    from socle.entreprise e join socle.organisation o on o.id = e.organisation
    left join plateforme.abonnement a on a.entreprise = e.id
   where not e.essai);
end $$;

-- La fiche d'UNE entreprise : qui elle est, son abonnement et son histoire (motifs compris : ce sont les notes de
-- SkanFact), ses membres (nom, adresse, rôles, dernière connexion), des comptes, et ce que la console a fait pour elle.
create function plateforme.console_entreprise(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_fuseau text;
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  select e.fuseau into v_fuseau from socle.entreprise e where e.id = p_entreprise and not e.essai;
  if v_fuseau is null then return null; end if;
  return (select jsonb_build_object(
      'id', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal, 'formeJuridique', e.forme_juridique,
      'active', e.active, 'devise', e.devise_base, 'creeLe', (e.cree_le at time zone e.fuseau)::date,
      'organisation', jsonb_build_object('id', o.id, 'type', o.type, 'nom', o.nom),
      'tenuePar', (select c.nom from socle.organisation c where c.id = e.tenue_par),
      'faits', jsonb_build_object('connu', a.entreprise is not null, 'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au,
        'offre', a.offre, 'periodicite', a.periodicite, 'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le,
        'offert', coalesce(a.offert, false), 'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null),
      'ligne', plateforme.ligne_abonnement(a),
      'membres', (select coalesce(jsonb_agg(jsonb_build_object('nom', u.nom, 'email', u.email, 'roles', m.roles, 'depuis', m.depuis,
                     'derniereConnexion', (select max(s.derniere_activite) from socle.session s where s.utilisateur = u.id))
                     order by ('proprietaire' = any(m.roles)) desc, u.nom), '[]'::jsonb)
                    from socle.membre m join socle.utilisateur u on u.id = m.utilisateur where m.entreprise = e.id and m.actif),
      'comptes', jsonb_build_object(
        'etablissements', (select count(*) from socle.etablissement t where t.entreprise = e.id and t.actif),
        'caisses', (select count(*) from caisse.caisse k where k.entreprise = e.id and k.active),
        'salaries', (select count(*) from paie.salarie s where s.entreprise = e.id and s.date_sortie is null),
        'piecesCreees', (select count(*) from socle.dossier_v10 d where d.entreprise = e.id and d.collection in ('documents', 'purchases')),
        -- Les pièces émises, mois par mois, sur les douze derniers mois (jour de l'entreprise).
        'piecesEmises', (select coalesce(jsonb_agg(jsonb_build_object('mois', x.mois, 'n', x.n) order by x.mois), '[]'::jsonb) from (
            select to_char(p.emise_le at time zone e.fuseau, 'YYYY-MM') mois, count(*) n from ventes.piece p
             where p.entreprise = e.id and p.statut = 'emise' and p.emise_le > now() - interval '12 months'
             group by 1) x)),
      'prolongeDejaUneFois', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'essai_prolonge'),
      'evenements', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'le', v.le, 'nature', v.nature, 'par', v.par, 'motif', v.motif,
                        'avant', v.avant, 'apres', v.apres,
                        'qui', (select jsonb_build_object('nom', u.nom, 'role', g.role) from plateforme.geste_console g
                                  join socle.utilisateur u on u.id = g.qui where g.evenement = v.id))
                        order by v.le desc, v.id desc), '[]'::jsonb)
                       from plateforme.evenement_abonnement v where v.entreprise = e.id))
    from socle.entreprise e join socle.organisation o on o.id = e.organisation
    left join plateforme.abonnement a on a.entreprise = e.id
   where e.id = p_entreprise);
end $$;

-- Le journal de la console, du plus récent au plus ancien, par pages (curseur « instant|id » : plusieurs gestes d'une même
-- transaction ont le même instant). Filtré par personne de l'équipe, par entreprise. La direction seule.
create function plateforme.console_journal(p_qui uuid, p_entreprise uuid, p_avant_le timestamptz, p_avant_id uuid, p_limite int) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'le', g.le, 'curseur', g.le::text, 'role', g.role, 'geste', g.geste, 'motif', g.motif, 'avant', g.avant, 'apres', g.apres,
      'qui', (select jsonb_build_object('id', u.id, 'nom', u.nom) from socle.utilisateur u where u.id = g.qui),
      'entreprise', (select jsonb_build_object('id', e.id, 'raisonSociale', e.raison_sociale) from socle.entreprise e where e.id = g.entreprise),
      'membre', (select jsonb_build_object('id', u.id, 'nom', u.nom) from socle.utilisateur u where u.id = g.membre)
    ) order by g.le desc, g.id desc), '[]'::jsonb)
    from (select * from plateforme.geste_console g
           where (p_qui is null or g.qui = p_qui) and (p_entreprise is null or g.entreprise = p_entreprise)
             and (g.le, g.id) < (coalesce(p_avant_le, 'infinity'), coalesce(p_avant_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
           order by g.le desc, g.id desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) g);
end $$;

-- L'équipe, pour la direction : chaque membre, son rôle, son code du téléphone (la console l'exige), sa dernière
-- connexion à la console et les appareils où elle est ouverte.
create function plateforme.console_equipe(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'utilisateur', u.id, 'nom', u.nom, 'email', u.email, 'role', q.role, 'actif', q.actif, 'ajouteLe', q.ajoute_le, 'retireLe', q.retire_le,
      'code', case when u.code_methode in ('sms', 'application') then u.code_methode end,
      'moi', u.id = socle.moi(),
      'derniereConnexion', (select max(s.derniere_activite) from plateforme.session_console s where s.utilisateur = u.id),
      'appareils', (select coalesce(jsonb_agg(distinct jsonb_build_object('nom', a.nom, 'type', a.type)), '[]'::jsonb)
                      from plateforme.session_console s join socle.appareil a on a.id = s.appareil
                     where s.utilisateur = u.id and s.fermee_le is null and s.expire_le > p_maintenant
                       and s.derniere_activite + interval '1 hour' > p_maintenant and a.revoque_le is null)
    ) order by q.actif desc, case q.role when 'direction' then 0 when 'support' then 1 else 2 end, u.nom), '[]'::jsonb)
    from plateforme.equipe q join socle.utilisateur u on u.id = q.utilisateur);
end $$;

-- ── 7. Les gestes de la console ──────────────────────────────────────────────────────────────────────────────────────
-- Un geste sur l'abonnement d'une entreprise (10 § 2.4). Le serveur calcule la ligne d'après (la règle du geste vit en
-- un seul endroit, serveur/abonnement/gestes.ts, que l'outil de l'exploitation emploie aussi) ; la base vérifie le rôle,
-- que la ligne n'a pas changé depuis la lecture, et ce que le support a le droit de faire : prolonger un essai de 7 à 30
-- jours, une fois par entreprise. Le reste est à la direction. L'événement et la ligne du journal naissent ensemble.
create function plateforme.console_poser_abonnement(p_entreprise uuid, p_geste text, p_motif text, p_avant jsonb, p_apres jsonb,
                                                     p_details jsonb, p_jour date) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_nature text;
  v_ligne plateforme.abonnement;
  v_avant jsonb;
  v_jours int;
  v_evenement uuid;
  v_geste uuid;
begin
  v_nature := case p_geste when 'prolonger' then 'essai_prolonge' when 'payer' then 'paye' when 'resilier' then 'resilie'
    when 'annuler-resiliation' then 'resiliation_annulee' when 'suspendre' then 'suspendu' when 'reprendre' then 'repris'
    when 'offrir' then 'offert' when 'retirer-offert' then 'offert_retire' end;
  if v_nature is null then perform socle.refus('ce geste n''existe pas dans la console'); end if;
  if v_role = 'support' and p_geste <> 'prolonger' then perform socle.refus('ton rôle dans l''équipe SkanFact ne permet pas ce geste'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste sur un abonnement demande son motif (trois caractères au moins) : il reste dans son histoire');
  end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;

  select * into v_ligne from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  v_avant := case when found then plateforme.ligne_abonnement(v_ligne) end;
  -- Changé depuis que la console l'a lu : on n'écrase pas (01 R15).
  if v_avant is distinct from p_avant then
    raise exception 'cet abonnement a changé depuis que tu l''as ouvert : relis-le avant de refaire le geste' using errcode = 'SK409';
  end if;

  if v_role = 'support' then
    if v_avant is null or (p_apres - 'essai_jusqu_au') is distinct from (v_avant - 'essai_jusqu_au') then
      perform socle.refus('le support prolonge un essai, rien d''autre : le reste se demande à la direction');
    end if;
    v_jours := (p_apres->>'essai_jusqu_au')::date - greatest((v_avant->>'essai_jusqu_au')::date, p_jour);
    if v_jours is null or v_jours not between 7 and 30 then
      perform socle.refus('le support prolonge un essai de 7 à 30 jours : au-delà, la direction');
    end if;
    if exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = p_entreprise and v.nature = 'essai_prolonge') then
      perform socle.refus('cet essai a déjà été prolongé une fois : une nouvelle prolongation se demande à la direction');
    end if;
  end if;

  if v_avant is null then
    insert into plateforme.abonnement (entreprise, essai_jusqu_au) values (p_entreprise, (p_apres->>'essai_jusqu_au')::date);
  end if;
  update plateforme.abonnement set essai_jusqu_au = (p_apres->>'essai_jusqu_au')::date, paye_jusqu_au = (p_apres->>'paye_jusqu_au')::date,
      offre = p_apres->>'offre', periodicite = p_apres->>'periodicite', resilie_le = (p_apres->>'resilie_le')::date,
      suspendu_le = (p_apres->>'suspendu_le')::date, offert = coalesce((p_apres->>'offert')::boolean, false), modifie_le = now()
   where entreprise = p_entreprise;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (p_entreprise, case when v_avant is null then 'essai_commence' else v_nature end, 'exploitation', btrim(p_motif), v_avant,
            p_apres || coalesce(p_details, '{}'::jsonb))
    returning id into v_evenement;
  insert into plateforme.geste_console (qui, role, geste, entreprise, evenement, motif, avant, apres)
    values (socle.moi(), v_role, 'abonnement.' || p_geste, p_entreprise, v_evenement, btrim(p_motif), v_avant, p_apres || coalesce(p_details, '{}'::jsonb))
    returning id into v_geste;
  return v_geste;
end $$;

-- L'équipe, par la direction : ajouter une personne qui a déjà son compte SkanFact (ou la reprendre), changer son rôle,
-- la retirer. Jamais sur soi-même ; l'équipe garde toujours une personne à la direction.
create function plateforme.console_ajouter_membre(p_email text, p_role text, p_motif text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_u uuid; v_avant jsonb;
begin
  if coalesce(p_role, '') not in ('direction', 'support', 'technique') then perform socle.refus('ce rôle n''existe pas dans l''équipe SkanFact'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  select u.id into v_u from socle.utilisateur u where lower(u.email) = lower(btrim(p_email));
  if v_u is null then
    perform socle.refus('aucun compte SkanFact n''a cette adresse : la personne crée d''abord son compte sur l''application');
  end if;
  select jsonb_build_object('role', e.role, 'actif', e.actif) into v_avant from plateforme.equipe e where e.utilisateur = v_u for update;
  if coalesce((v_avant->>'actif')::boolean, false) then
    perform socle.refus('cette personne fait déjà partie de l''équipe SkanFact : change son rôle dans la liste');
  end if;
  insert into plateforme.equipe (utilisateur, role) values (v_u, p_role)
    on conflict (utilisateur) do update set role = excluded.role, actif = true, ajoute_le = now(), retire_le = null;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.ajouter', v_u, btrim(p_motif), v_avant, jsonb_build_object('role', p_role, 'actif', true));
  return v_u;
end $$;

create function plateforme.console_changer_role(p_membre uuid, p_role text, p_motif text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_avant text;
begin
  if coalesce(p_role, '') not in ('direction', 'support', 'technique') then perform socle.refus('ce rôle n''existe pas dans l''équipe SkanFact'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  if p_membre = socle.moi() then perform socle.refus('personne ne change son propre rôle'); end if;
  select e.role into v_avant from plateforme.equipe e where e.utilisateur = p_membre and e.actif for update;
  if v_avant is null then perform socle.refus('membre introuvable'); end if;
  if v_avant = p_role then perform socle.refus('cette personne a déjà ce rôle'); end if;
  if v_avant = 'direction' and (select count(*) from plateforme.equipe e where e.role = 'direction' and e.actif) = 1 then
    perform socle.refus('l''équipe garde toujours une personne à la direction');
  end if;
  update plateforme.equipe set role = p_role where utilisateur = p_membre;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.role', p_membre, btrim(p_motif), jsonb_build_object('role', v_avant), jsonb_build_object('role', p_role));
end $$;

create function plateforme.console_retirer_membre(p_membre uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_avant text;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  if p_membre = socle.moi() then perform socle.refus('personne ne se retire soi-même de l''équipe SkanFact'); end if;
  select e.role into v_avant from plateforme.equipe e where e.utilisateur = p_membre and e.actif for update;
  if v_avant is null then perform socle.refus('membre introuvable'); end if;
  if v_avant = 'direction' and (select count(*) from plateforme.equipe e where e.role = 'direction' and e.actif) = 1 then
    perform socle.refus('l''équipe garde toujours une personne à la direction');
  end if;
  update plateforme.equipe set actif = false, retire_le = p_maintenant where utilisateur = p_membre;
  -- Ses sessions de la console tombent aussitôt.
  update plateforme.session_console set fermee_le = p_maintenant where utilisateur = p_membre and fermee_le is null;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.retirer', p_membre, btrim(p_motif), jsonb_build_object('role', v_avant, 'actif', true),
            jsonb_build_object('role', v_avant, 'actif', false));
end $$;

-- Tout ce qui précède se lance par le serveur seulement. La garde, les tables et la ligne d'abonnement : par les
-- fonctions elles-mêmes, jamais en direct.
revoke execute on function plateforme.role_dans_l_equipe(uuid), plateforme.ouvrir_defi_console(uuid, uuid, text, text, timestamptz, interval),
  plateforme.lire_defi_console(uuid, timestamptz), plateforme.defi_console_erreur(uuid), plateforme.renvoyer_defi_console(uuid, text, timestamptz, interval),
  plateforme.conclure_defi_console(uuid, text, timestamptz, inet), plateforme.qui_est_console(text, timestamptz),
  plateforme.mon_role_console(), plateforme.exiger_role_console(text[]), plateforme.fermer_ma_session_console(timestamptz),
  plateforme.console_moi(), plateforme.ligne_abonnement(plateforme.abonnement), plateforme.console_entreprises(),
  plateforme.console_entreprise(uuid), plateforme.console_journal(uuid, uuid, timestamptz, uuid, int), plateforme.console_equipe(timestamptz),
  plateforme.console_poser_abonnement(uuid, text, text, jsonb, jsonb, jsonb, date), plateforme.console_ajouter_membre(text, text, text),
  plateforme.console_changer_role(uuid, text, text), plateforme.console_retirer_membre(uuid, text, timestamptz),
  plateforme.geste_console_intouchable() from public;
grant execute on function plateforme.role_dans_l_equipe(uuid), plateforme.ouvrir_defi_console(uuid, uuid, text, text, timestamptz, interval),
  plateforme.lire_defi_console(uuid, timestamptz), plateforme.defi_console_erreur(uuid), plateforme.renvoyer_defi_console(uuid, text, timestamptz, interval),
  plateforme.conclure_defi_console(uuid, text, timestamptz, inet), plateforme.qui_est_console(text, timestamptz),
  plateforme.fermer_ma_session_console(timestamptz), plateforme.console_moi(), plateforme.console_entreprises(),
  plateforme.console_entreprise(uuid), plateforme.console_journal(uuid, uuid, timestamptz, uuid, int), plateforme.console_equipe(timestamptz),
  plateforme.console_poser_abonnement(uuid, text, text, jsonb, jsonb, jsonb, date), plateforme.console_ajouter_membre(text, text, text),
  plateforme.console_changer_role(uuid, text, text), plateforme.console_retirer_membre(uuid, text, timestamptz) to skanfact_app;
