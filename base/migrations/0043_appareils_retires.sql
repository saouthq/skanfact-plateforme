-- Un appareil retiré (brique 74 ; docs/hors-ligne.md, H9). Quand une personne retire un de ses
-- appareils (perdu, volé, rendu), ses sessions se ferment (0002, revoquer_appareil) ; à sa reconnexion,
-- l'appareil doit l'APPRENDRE, pour effacer ce qu'il garde avant toute autre chose (04 § 7). Une
-- session simplement finie (12 heures sans rien faire) ne dit pas la même chose : ce que le poste garde
-- y reste, pour que la même personne le retrouve (H8).

-- Ce jeton est-il celui d'une session d'un appareil retiré ? Le serveur seul le demande, par
-- l'empreinte du jeton qu'on lui présente.
create function socle.jeton_d_un_appareil_retire(p_jeton_empreinte text) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (select 1 from socle.session s join socle.appareil a on a.id = s.appareil
                  where s.jeton_empreinte = p_jeton_empreinte and a.revoque_le is not null)
$$;
revoke execute on function socle.jeton_d_un_appareil_retire(text) from public;
grant execute on function socle.jeton_d_un_appareil_retire(text) to skanfact_app;
