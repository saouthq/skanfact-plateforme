-- 0133 : la documentation interne du support (1.41.0 ; la liste des fonctions qui manquent, 20 : « documentation
-- interne du support : procédures, notes privées et réponses validées » ; docs/console.md C57). Version légère :
--   - une NOTE PRIVÉE se pose sur une demande : l'équipe se passe ce qu'elle sait (ce qui a été essayé, à qui demander),
--     le client ne la voit JAMAIS (une table à part, que rien côté client ne lit) ; elle ne se modifie ni ne s'efface ;
--   - la DOCUMENTATION : des réponses (un texte prêt à envoyer, « {prenom} » y devient le prénom de la personne) et des
--     procédures (comment on fait). La direction et le support les écrivent ; une réponse ne s'offre dans le champ de
--     réponse qu'une fois VALIDÉE par la direction, et une modification la renvoie à valider ; la direction retire
--     ce qui ne vaut plus, avec son motif. Rien n'y nomme un client.
-- La direction et le support, jamais la technique (03 § 5 : elle ne lit aucune donnée de client) ; chaque geste au
-- journal, jamais le texte d'une note.

create table plateforme.note_demande (
  id uuid primary key default socle.uuidv7(),
  demande uuid not null references plateforme.demande_support(id),
  auteur uuid not null references socle.utilisateur(id),
  texte text not null check (length(btrim(texte)) between 3 and 2000),
  ecrite_le timestamptz not null
);
create index note_demande_demande on plateforme.note_demande (demande, ecrite_le);
alter table plateforme.note_demande enable row level security;
alter table plateforme.note_demande force row level security;

create table plateforme.doc_support (
  id uuid primary key default socle.uuidv7(),
  sorte text not null check (sorte in ('reponse', 'procedure')),
  titre text not null check (length(btrim(titre)) between 3 and 120),
  texte text not null check (length(btrim(texte)) between 10 and 8000),
  ecrite_le timestamptz not null,
  ecrite_par uuid not null references socle.utilisateur(id),
  validee_le timestamptz,
  validee_par uuid references socle.utilisateur(id),
  retiree_le timestamptz,
  retiree_par uuid references socle.utilisateur(id),
  check ((validee_le is null) = (validee_par is null)),
  check ((retiree_le is null) = (retiree_par is null))
);
-- Un titre, une fiche de sa sorte (sans la casse) tant qu'elle n'est pas retirée.
create unique index doc_support_titre on plateforme.doc_support (sorte, lower(btrim(titre))) where retiree_le is null;
alter table plateforme.doc_support enable row level security;
alter table plateforme.doc_support force row level security;

-- Les notes privées d'une demande, la plus ancienne d'abord.
create function plateforme.console_notes_demande(p_demande uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'texte', n.texte, 'le', n.ecrite_le,
      'auteur', (select u.nom from socle.utilisateur u where u.id = n.auteur)) order by n.ecrite_le, n.id), '[]'::jsonb)
    from plateforme.note_demande n where n.demande = p_demande);
end $$;

-- Poser une note privée sur une demande (ouverte ou close : ce qu'on a appris sert la suivante).
create function plateforme.console_noter_en_prive(p_demande uuid, p_texte text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); d plateforme.demande_support; v_id uuid;
begin
  select * into d from plateforme.demande_support where id = p_demande;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if length(btrim(coalesce(p_texte, ''))) not between 3 and 2000 then
    perform socle.refus('une note privée : de trois à deux mille caractères');
  end if;
  insert into plateforme.note_demande (demande, auteur, texte, ecrite_le) values (d.id, socle.moi(), btrim(p_texte), p_maintenant) returning id into v_id;
  -- Au journal : qu'une note a été posée, sur quelle demande ; jamais ce qu'elle dit.
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.note_privee', d.entreprise, 'note privée sur une demande', null, jsonb_build_object('demande', d.numero));
  return v_id;
end $$;

-- La documentation : toutes les fiches qui valent (les retirées n'y sont plus), les réponses d'abord, par titre.
create function plateforme.console_docs_support() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'sorte', f.sorte, 'titre', f.titre, 'texte', f.texte, 'ecriteLe', f.ecrite_le,
      'ecritePar', (select u.nom from socle.utilisateur u where u.id = f.ecrite_par),
      'valideeLe', f.validee_le, 'valideePar', (select u.nom from socle.utilisateur u where u.id = f.validee_par))
      order by f.sorte desc, lower(f.titre)), '[]'::jsonb)
    from plateforme.doc_support f where f.retiree_le is null);
end $$;

create function plateforme.doc_textes_sains(p_sorte text, p_titre text, p_texte text) returns void
language plpgsql immutable set search_path = pg_catalog, socle as $$
begin
  if p_sorte is null or p_sorte not in ('reponse', 'procedure') then perform socle.refus('une fiche est une réponse ou une procédure'); end if;
  if length(btrim(coalesce(p_titre, ''))) not between 3 and 120 then perform socle.refus('le titre d''une fiche : de trois à cent vingt caractères'); end if;
  if length(btrim(coalesce(p_texte, ''))) not between 10 and 8000 then perform socle.refus('le texte d''une fiche : de dix à huit mille caractères'); end if;
end $$;

-- Écrire une fiche (p_id nul) ou la reprendre. Reprise, une réponse validée revient à valider : la direction relit le
-- texte qui partira chez les clients.
create function plateforme.console_ecrire_doc(p_id uuid, p_sorte text, p_titre text, p_texte text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); f plateforme.doc_support; v_id uuid;
begin
  perform plateforme.doc_textes_sains(p_sorte, p_titre, p_texte);
  if exists (select 1 from plateforme.doc_support x where x.sorte = p_sorte and lower(btrim(x.titre)) = lower(btrim(p_titre))
              and x.retiree_le is null and x.id is distinct from p_id) then
    perform socle.refus('une fiche de ce titre existe déjà : reprends-la');
  end if;
  if p_id is null then
    insert into plateforme.doc_support (sorte, titre, texte, ecrite_le, ecrite_par) values (p_sorte, btrim(p_titre), btrim(p_texte), p_maintenant, socle.moi())
      returning id into v_id;
    insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
      values (socle.moi(), v_role, 'support.doc_ecrite', null, 'documentation du support', null, jsonb_build_object('sorte', p_sorte, 'titre', btrim(p_titre)));
    return v_id;
  end if;
  select * into f from plateforme.doc_support where id = p_id and retiree_le is null for update;
  if not found then perform socle.refus('cette fiche n''existe pas ou a été retirée'); end if;
  if f.sorte <> p_sorte then perform socle.refus('une fiche garde sa sorte : écris-en une autre'); end if;
  if f.titre = btrim(p_titre) and f.texte = btrim(p_texte) then return f.id; end if;
  update plateforme.doc_support set titre = btrim(p_titre), texte = btrim(p_texte), ecrite_le = p_maintenant, ecrite_par = socle.moi(),
    validee_le = null, validee_par = null where id = f.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.doc_reprise', null, 'documentation du support',
            jsonb_build_object('titre', f.titre, 'validee', f.validee_le is not null), jsonb_build_object('titre', btrim(p_titre), 'validee', false));
  return f.id;
end $$;

-- Valider une fiche : la direction seule ; une fiche déjà validée ne se revalide pas.
create function plateforme.console_valider_doc(p_id uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); f plateforme.doc_support;
begin
  select * into f from plateforme.doc_support where id = p_id and retiree_le is null for update;
  if not found then perform socle.refus('cette fiche n''existe pas ou a été retirée'); end if;
  if f.validee_le is not null then perform socle.refus('cette fiche est déjà validée'); end if;
  update plateforme.doc_support set validee_le = p_maintenant, validee_par = socle.moi() where id = f.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.doc_validee', null, 'documentation du support', null, jsonb_build_object('sorte', f.sorte, 'titre', f.titre));
end $$;

-- Retirer une fiche qui ne vaut plus : la direction seule, avec son motif ; la ligne reste.
create function plateforme.console_retirer_doc(p_id uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); f plateforme.doc_support;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select * into f from plateforme.doc_support where id = p_id and retiree_le is null for update;
  if not found then perform socle.refus('cette fiche n''existe pas ou a été retirée'); end if;
  update plateforme.doc_support set retiree_le = p_maintenant, retiree_par = socle.moi() where id = f.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.doc_retiree', null, btrim(p_motif), jsonb_build_object('sorte', f.sorte, 'titre', f.titre), null);
end $$;

revoke execute on function plateforme.console_notes_demande(uuid), plateforme.console_noter_en_prive(uuid, text, timestamptz),
  plateforme.console_docs_support(), plateforme.doc_textes_sains(text, text, text),
  plateforme.console_ecrire_doc(uuid, text, text, text, timestamptz), plateforme.console_valider_doc(uuid, timestamptz),
  plateforme.console_retirer_doc(uuid, text, timestamptz) from public;
grant execute on function plateforme.console_notes_demande(uuid), plateforme.console_noter_en_prive(uuid, text, timestamptz),
  plateforme.console_docs_support(), plateforme.console_ecrire_doc(uuid, text, text, text, timestamptz),
  plateforme.console_valider_doc(uuid, timestamptz), plateforme.console_retirer_doc(uuid, text, timestamptz) to skanfact_app;
