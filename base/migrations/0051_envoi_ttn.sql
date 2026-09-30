-- L'envoi à la TTN (brique 82 ; docs/facture-electronique.md ; 05 § 3.1 et 3.8). Le serveur dépose chaque
-- pièce signée sur la plateforme El Fatoora de Tunisie TradeNet, avec le compte de l'entreprise, puis relit
-- ce qu'elle en a fait : acceptée (sa référence, son code QR, et la facture validée, qui fait foi), ou
-- refusée (pourquoi). Jamais deux fois : avant chaque dépôt, le serveur demande à la TTN si elle a déjà la
-- pièce, et un seul tour à la fois travaille sur une pièce (le bail).

-- 1. Le compte El Fatoora de l'entreprise : son identifiant, et son mot de passe scellé par le coffre du
--    serveur (serveur/coffre.ts). Le compte du serveur ne peut même pas le lire : seule la fonction de
--    l'envoi le reçoit. Aucun écran ne le relit.
create table ventes.ttn_compte (
  entreprise uuid primary key references socle.entreprise(id),
  identifiant text not null check (length(identifiant) between 1 and 100),
  mot_de_passe_scelle text not null,
  pose_le timestamptz not null,
  pose_par uuid not null references socle.utilisateur(id),
  -- Le dernier refus du compte par la TTN (un mot de passe changé chez elle) : {cle, valeurs}.
  dernier_refus jsonb,
  dernier_refus_le timestamptz
);
alter table ventes.ttn_compte enable row level security;
alter table ventes.ttn_compte force row level security;
create policy visible on ventes.ttn_compte using (entreprise in (select socle.mes_entreprises()));
grant select (entreprise, identifiant, pose_le, pose_par, dernier_refus, dernier_refus_le) on ventes.ttn_compte to skanfact_app;
grant insert, update, delete on ventes.ttn_compte to skanfact_app;

-- 2. L'envoi de chaque pièce signée : une ligne par pièce (jamais deux), et où il en est.
--      a_envoyer → deposee (la TTN l'a reçue) → acceptee | refusee
create table ventes.envoi_ttn (
  piece uuid primary key references ventes.efacture_signee(piece),
  entreprise uuid not null references socle.entreprise(id),
  statut text not null default 'a_envoyer' check (statut in ('a_envoyer', 'deposee', 'acceptee', 'refusee')),
  essais integer not null default 0 check (essais >= 0),
  prochain_essai timestamptz not null,
  -- Le bail : le tour qui travaille sur la pièce, jusqu'à cette heure-là ; aucun autre n'y touche.
  bail timestamptz,
  depose_le timestamptz,
  -- Ce que rend la TTN : l'identifiant du dépôt, sa référence, le contenu du code QR, et la facture
  -- validée (celle qui fait foi, gardée dix ans).
  id_ttn text,
  reference text,
  qr text,
  xml_valide text,
  accepte_le timestamptz,
  -- Le dernier refus, ou ce qui retient la pièce (un compte absent, une panne) : {cle, valeurs}.
  motif jsonb,
  cree_le timestamptz not null,
  cree_par uuid not null references socle.utilisateur(id),
  check ((statut = 'acceptee') = (reference is not null and xml_valide is not null and accepte_le is not null))
);
create index envoi_ttn_entreprise on ventes.envoi_ttn (entreprise, cree_le);
create index envoi_ttn_du on ventes.envoi_ttn (prochain_essai) where statut in ('a_envoyer', 'deposee');
alter table ventes.envoi_ttn enable row level security;
alter table ventes.envoi_ttn force row level security;
create policy visible on ventes.envoi_ttn using (entreprise in (select socle.mes_entreprises()));
grant select, insert, update on ventes.envoi_ttn to skanfact_app;

-- Une pièce acceptée par la TTN ne change plus : sa référence et sa facture validée sont définitives.
create function ventes.envoi_ttn_fige() returns trigger
language plpgsql as $$
begin
  if old.statut = 'acceptee' then perform socle.refus('une pièce acceptée par la TTN ne change plus'); end if;
  return new;
end $$;
create trigger envoi_ttn_fige before update on ventes.envoi_ttn for each row execute function ventes.envoi_ttn_fige();

-- 3. Le facteur (un tour du serveur, sans identité) : les envois dus, et au nom de qui les traiter (le
--    propriétaire de l'entreprise : l'envoi est à son nom, et la trace le dit).
create function ventes.envois_ttn_dus(p_maintenant timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes as $$
  select coalesce(jsonb_agg(jsonb_build_object('piece', x.piece, 'entreprise', x.entreprise,
      'proprietaire', (select m.utilisateur from socle.membre m where m.entreprise = x.entreprise and m.actif and 'proprietaire' = any(m.roles)))
      order by x.prochain_essai), '[]'::jsonb)
    from (select piece, entreprise, prochain_essai from ventes.envoi_ttn
           where statut in ('a_envoyer', 'deposee') and prochain_essai <= p_maintenant and (bail is null or bail < p_maintenant)
           order by prochain_essai limit 50) x
$$;
revoke execute on function ventes.envois_ttn_dus(timestamptz) from public;
grant execute on function ventes.envois_ttn_dus(timestamptz) to skanfact_app;

-- Le compte de l'entreprise, mot de passe scellé compris : pour l'envoi seulement, et à un membre de
-- l'entreprise seulement.
create function ventes.ttn_compte_scelle(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes as $$
  select jsonb_build_object('identifiant', c.identifiant, 'mot_de_passe_scelle', c.mot_de_passe_scelle)
    from ventes.ttn_compte c
   where c.entreprise = p_entreprise and p_entreprise in (select socle.mes_entreprises())
$$;
revoke execute on function ventes.ttn_compte_scelle(uuid) from public;
grant execute on function ventes.ttn_compte_scelle(uuid) to skanfact_app;
