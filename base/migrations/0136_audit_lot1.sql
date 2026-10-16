-- 0136 : l'audit de la console 1.42.0, lot 1 (1.44.0 ; docs/console.md C60).
--   - A01 : deux périodes payées d'avance. Un seul changement attend son premier jour (a_venir_*) ; la seconde période
--     payée d'avance déplaçait ce changement au PREMIER des deux jours avec l'offre de la plus tardive : un client Complet
--     qui payait novembre en Complet puis décembre en Essentiel passait en Essentiel dès le 1er novembre. Désormais la
--     règle de secondChangement (serveur/abonnement/etat.ts) : ce qui attend sans rien changer se déplace au jour de la
--     nouvelle ; deux changements différents se refusent avant tout argent (la facture ne se prépare pas, le paiement ne se
--     note pas) ; une facture déjà préparée qui arrive quand même laisse le premier attendre seul, et le dit.

-- ── A01 : payée par sa facture ──────────────────────────────────────────────────────────────────────────────────────
create or replace function plateforme.abonnement_paye_par_facture(p_editeur uuid, p_piece_v10 text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_f plateforme.facture_abonnement;
  v_p ventes.piece;
  v_avoirs bigint;
  v_reglements bigint;
  v_ligne plateforme.abonnement;
  v_avant jsonb;
  v_evenement uuid;
  v_jour date := (now() at time zone 'Africa/Tunis')::date;
  v_change boolean;
  v_second text := 'libre';
begin
  select * into v_f from plateforme.facture_abonnement f where f.editeur = p_editeur and f.piece_v10 = p_piece_v10 for update;
  if not found or v_f.payee_le is not null then return null; end if;
  select * into v_p from ventes.piece p where p.entreprise = p_editeur and p.ref_v10 = p_piece_v10 and p.type = 'facture' and p.statut = 'emise';
  if not found then return null; end if;
  select coalesce(sum(a.net_a_payer), 0) into v_avoirs from ventes.piece a where a.entreprise = v_p.entreprise and a.corrige = v_p.id and a.statut = 'emise';
  select coalesce(sum(r.montant), 0) into v_reglements from ventes.reglement r where r.entreprise = v_p.entreprise and r.piece = v_p.id;
  if v_p.net_a_payer <= 0 or v_avoirs >= v_p.net_a_payer or v_p.net_a_payer - v_avoirs - v_reglements > 0 then return null; end if;
  update plateforme.facture_abonnement set payee_le = now() where id = v_f.id;
  -- Ce qui attendait son jour, s'il est venu, d'abord.
  perform plateforme.basculer_abonnement(v_f.entreprise, v_jour);
  select * into v_ligne from plateforme.abonnement a where a.entreprise = v_f.entreprise for update;
  if not found or (v_ligne.paye_jusqu_au is not null and v_ligne.paye_jusqu_au >= v_f.fin) then return null; end if;
  v_avant := plateforme.ligne_abonnement(v_ligne);
  -- Une autre période payée d'avance attend déjà son premier jour (l'audit 1.42.0, A01) : la même règle que le serveur
  -- (serveur/abonnement/etat.ts, secondChangement). Ce qui attend ne change rien : la nouvelle attend SON premier jour ;
  -- la nouvelle change la même chose, sans module de plus : rien ne bouge ; deux changements différents : la préparation
  -- de la facture le refuse, et s'il arrive quand même (une facture préparée avant), le premier attend seul — la période
  -- plus tardive garde ce qu'il donne, jamais moins — et l'histoire le dit (« à régler »).
  if v_f.debut > v_jour and v_ligne.offre is not null and v_ligne.a_venir_le is not null and v_ligne.a_venir_le < v_f.debut then
    v_change := v_ligne.a_venir_offre is distinct from v_ligne.offre or v_ligne.a_venir_periodicite is distinct from v_ligne.periodicite
                or cardinality(v_ligne.a_venir_retraits) > 0;
    v_second := case when not v_change then 'deplacer'
                     when v_f.offre = v_ligne.a_venir_offre and v_f.periodicite = v_ligne.a_venir_periodicite and cardinality(v_ligne.modules_a_retirer) = 0 then 'garder'
                     else 'conflit' end;
  end if;
  if v_second = 'conflit' then
    update plateforme.abonnement set paye_jusqu_au = v_f.fin, resilie_le = null, modifie_le = now()
     where entreprise = v_f.entreprise returning * into v_ligne;
  elsif v_f.debut > v_jour and v_ligne.offre is not null then
    -- Payée en avance : la période payée qui court va au bout avec ce qu'elle avait ; ce que la nouvelle change attend
    -- son premier jour. (Un premier paiement pendant l'essai n'a rien de payé à protéger : il s'applique tout de suite.)
    update plateforme.abonnement set paye_jusqu_au = v_f.fin, resilie_le = null,
           a_venir_le = case when v_second = 'garder' then a_venir_le else v_f.debut end, a_venir_offre = v_f.offre, a_venir_periodicite = v_f.periodicite,
           a_venir_retraits = array(select distinct m from unnest(a_venir_retraits || modules_a_retirer) m order by m), modules_a_retirer = '{}',
           suivante_offre = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_offre end,
           suivante_periodicite = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_periodicite end,
           suivante_a_partir_du = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_a_partir_du end,
           modifie_le = now()
     where entreprise = v_f.entreprise returning * into v_ligne;
  else
    update plateforme.abonnement set paye_jusqu_au = v_f.fin, offre = v_f.offre, periodicite = v_f.periodicite, resilie_le = null,
           modules = array(select m from unnest(modules) m where not (m = any(modules_a_retirer)) order by m), modules_a_retirer = '{}',
           suivante_offre = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_offre end,
           suivante_periodicite = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_periodicite end,
           suivante_a_partir_du = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_a_partir_du end,
           modifie_le = now()
     where entreprise = v_f.entreprise returning * into v_ligne;
  end if;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (v_f.entreprise, 'paye', 'systeme', 'facture ' || v_p.numero_texte || ' réglée', v_avant,
            plateforme.ligne_abonnement(v_ligne) || jsonb_build_object('debut', v_f.debut, 'fin', v_f.fin, 'facture', v_p.numero_texte)
            || case when v_f.mois_offert then jsonb_build_object('moisOffert', true) else '{}'::jsonb end
            || case when v_second = 'conflit' then jsonb_build_object('aRegler', 'deux_changements', 'offrePayee', v_f.offre, 'periodicitePayee', v_f.periodicite) else '{}'::jsonb end)
    returning id into v_evenement;
  update plateforme.facture_abonnement set evenement = v_evenement where id = v_f.id;
  return v_evenement;
end $$;

-- ── A03 : la validation et la reprise d'une fiche portent sur la version lue ─────────────────────────────────────────
-- La direction validait la fiche telle qu'elle était au moment du clic, pas celle qu'elle avait lue : un texte repris
-- entre-temps par le support partait validé sans relecture ; et deux reprises successives s'écrasaient. Désormais
-- chacune donne l'instant de la version qu'elle a lue (`ecrite_le`, rendu par console_docs_support) : une version qui a
-- changé depuis est refusée, et rien ne s'écrit. Chaque validation garde aussi le texte qu'elle a validé (doc_support_validee),
-- et le journal son empreinte.
create table plateforme.doc_support_validee (
  id uuid primary key default socle.uuidv7(),
  doc uuid not null references plateforme.doc_support(id),
  titre text not null,
  texte text not null,
  validee_le timestamptz not null,
  validee_par uuid not null references socle.utilisateur(id)
);
create index doc_support_validee_doc on plateforme.doc_support_validee (doc, validee_le desc);
alter table plateforme.doc_support_validee enable row level security;
alter table plateforme.doc_support_validee force row level security;

drop function plateforme.console_ecrire_doc(uuid, text, text, text, timestamptz);
create function plateforme.console_ecrire_doc(p_id uuid, p_sorte text, p_titre text, p_texte text, p_lue timestamptz, p_maintenant timestamptz) returns uuid
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
  if p_lue is null or f.ecrite_le <> p_lue then
    perform socle.refus('cette fiche a été reprise depuis que tu l''as ouverte : relis-la, puis refais ta reprise (rien n''est écrit)');
  end if;
  if f.titre = btrim(p_titre) and f.texte = btrim(p_texte) then return f.id; end if;
  update plateforme.doc_support set titre = btrim(p_titre), texte = btrim(p_texte), ecrite_le = p_maintenant, ecrite_par = socle.moi(),
    validee_le = null, validee_par = null where id = f.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.doc_reprise', null, 'documentation du support',
            jsonb_build_object('titre', f.titre, 'validee', f.validee_le is not null), jsonb_build_object('titre', btrim(p_titre), 'validee', false));
  return f.id;
end $$;

drop function plateforme.console_valider_doc(uuid, timestamptz);
create function plateforme.console_valider_doc(p_id uuid, p_lue timestamptz, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); f plateforme.doc_support;
begin
  select * into f from plateforme.doc_support where id = p_id and retiree_le is null for update;
  if not found then perform socle.refus('cette fiche n''existe pas ou a été retirée'); end if;
  if p_lue is null or f.ecrite_le <> p_lue then
    perform socle.refus('cette fiche a été reprise depuis que tu l''as lue : relis-la avant de la valider (rien n''est validé)');
  end if;
  if f.validee_le is not null then perform socle.refus('cette fiche est déjà validée'); end if;
  update plateforme.doc_support set validee_le = p_maintenant, validee_par = socle.moi() where id = f.id;
  insert into plateforme.doc_support_validee (doc, titre, texte, validee_le, validee_par) values (f.id, f.titre, f.texte, p_maintenant, socle.moi());
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.doc_validee', null, 'documentation du support', null,
            jsonb_build_object('sorte', f.sorte, 'titre', f.titre, 'empreinte', encode(sha256(convert_to(f.texte, 'UTF8')), 'hex')));
end $$;

revoke execute on function plateforme.console_ecrire_doc(uuid, text, text, text, timestamptz, timestamptz),
  plateforme.console_valider_doc(uuid, timestamptz, timestamptz) from public;
grant execute on function plateforme.console_ecrire_doc(uuid, text, text, text, timestamptz, timestamptz),
  plateforme.console_valider_doc(uuid, timestamptz, timestamptz) to skanfact_app;

-- ── A07 : la commande d'une réponse ne se réutilise pas pour un autre texte ─────────────────────────────────────────
-- Après une coupure, l'écran renvoie la réponse avec la même commande (0124, C09) : la base rendait la réponse déjà là
-- sans regarder son texte. Un texte modifié entre-temps partait pour « envoyé » alors qu'il ne l'était pas.
create or replace function plateforme.console_repondre_demande(p_demande uuid, p_texte text, p_article text, p_maintenant timestamptz, p_commande uuid default null)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v plateforme.demande_support; v_id uuid; v_texte text := btrim(coalesce(p_texte, '')); v_deja text; v_article text;
begin
  if length(v_texte) < 3 or length(v_texte) > 4000 then perform socle.refus('une réponse : de trois à quatre mille caractères'); end if;
  if p_article is not null and p_article !~ '^[a-z][a-z0-9_-]{0,39}$' then perform socle.refus('cet article de l''Aide n''existe pas'); end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  -- La même commande, déjà passée (un renvoi après une coupure, deux envois au même moment : la demande verrouillée les
  -- range l'un après l'autre) : la réponse est déjà là, on la rend.
  if p_commande is not null then
    select m.id, m.texte, m.article into v_id, v_deja, v_article from plateforme.message_support m where m.demande = p_demande and m.commande = p_commande;
    -- (l'audit 1.42.0, A07) La même commande avec un AUTRE texte : la première réponse est partie, la modification non.
    -- On ne la rend pas comme si c'était elle (l'écran viderait le champ et dirait « envoyée ») : on refuse.
    if v_id is not null and (v_deja is distinct from v_texte or v_article is distinct from p_article) then
      perform socle.refus('cette réponse est déjà partie avec un autre texte : relis la conversation, ta modification n''est pas envoyée');
    end if;
    if v_id is not null then return v_id; end if;
  end if;
  if v.close_le is not null then perform socle.refus('cette demande est close : rouvre-la pour y répondre'); end if;
  insert into plateforme.message_support (demande, cote, auteur, texte, article, ecrit_le, commande)
    values (p_demande, 'equipe', socle.moi(), v_texte, p_article, p_maintenant, p_commande)
    returning id into v_id;
  update plateforme.demande_support set suivie_par = coalesce(suivie_par, socle.moi()) where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.repondre', v.entreprise, v.sujet, null,
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'article', p_article));
  return v_id;
end $$;

-- Ce que la console a déjà envoyé sous cette commande, sur cette demande : son texte et son article (rien, sinon).
create function plateforme.reponse_de_la_commande(p_demande uuid, p_commande uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_commande is null then return null; end if;
  return (select jsonb_build_object('texte', m.texte, 'article', m.article) from plateforme.message_support m where m.demande = p_demande and m.commande = p_commande);
end $$;
revoke execute on function plateforme.reponse_de_la_commande(uuid, uuid) from public;
grant execute on function plateforme.reponse_de_la_commande(uuid, uuid) to skanfact_app;
