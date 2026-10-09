-- Vérifier l'adresse de son compte sans en changer (lot onboarding, 09/10/2026 ; docs/entree.md).
--
-- Une adresse se prouvait par un code reçu à l'inscription, ou à la connexion d'un appareil inconnu (0076 § 3). Qui a le
-- code du téléphone n'en reçoit plus jamais par e-mail à la connexion : son adresse restait « À vérifier » pour
-- toujours, et Ton compte disait « elle se vérifie à ta prochaine connexion », ce qui était faux (vu en construisant
-- les premiers pas, dont la première ligne est « Ton compte et ton adresse vérifiée »). Ici, un code part à l'adresse du
-- compte ; tapé, il la prouve. Les limites sont celles d'un changement d'adresse, dont la demande emprunte la table :
-- quinze minutes, cinq erreurs, trois demandes par heure (les deux gestes comptés ensemble).

create function socle.demander_verification_adresse(p_empreinte text, p_maintenant timestamptz, p_duree interval) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid; u record;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  select email, adresse_verifiee_le into u from socle.utilisateur where id = socle.moi();
  if u.adresse_verifiee_le is not null then perform socle.refus('ton adresse est déjà vérifiée'); end if;
  if (select count(*) from socle.changement_adresse c where c.utilisateur = socle.moi() and c.cree_le > p_maintenant - interval '1 hour') >= 3 then
    perform socle.refus('trois demandes en une heure : attends un peu avant d''en refaire une');
  end if;
  insert into socle.changement_adresse (utilisateur, nouvelle, code_empreinte, cree_le, expire_le)
  values (socle.moi(), u.email, p_empreinte, p_maintenant, p_maintenant + p_duree) returning id into v;
  return v;
end $$;

-- Le code tapé : vrai si l'adresse est prouvée ; faux si le code ne va pas (une erreur de plus comptée ; à la cinquième,
-- la demande ne vaut plus). Une demande faite pour une adresse que le compte n'a plus (changée entre-temps) ne prouve
-- rien.
create function socle.confirmer_verification_adresse(p_demande uuid, p_empreinte text, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare c record;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  select d.* into c from socle.changement_adresse d join socle.utilisateur u on u.id = d.utilisateur
   where d.id = p_demande and d.utilisateur = socle.moi() and d.fait_le is null and d.expire_le > p_maintenant and d.erreurs < 5
     and lower(d.nouvelle) = lower(u.email);
  if not found then perform socle.refus('cette demande n''est plus valable : redemande un code'); end if;
  if c.code_empreinte <> p_empreinte then
    update socle.changement_adresse set erreurs = erreurs + 1 where id = p_demande;
    return false;
  end if;
  update socle.changement_adresse set fait_le = p_maintenant where id = p_demande;
  update socle.utilisateur set adresse_verifiee_le = coalesce(adresse_verifiee_le, p_maintenant) where id = socle.moi();
  perform socle.tracer(null, 'compte.adresse.verifier', 'utilisateur', socle.moi(), null, jsonb_build_object('email', c.nouvelle));
  return true;
end $$;

revoke execute on function socle.demander_verification_adresse(text, timestamptz, interval), socle.confirmer_verification_adresse(uuid, text, timestamptz) from public;
grant execute on function socle.demander_verification_adresse(text, timestamptz, interval), socle.confirmer_verification_adresse(uuid, text, timestamptz) to skanfact_app;
