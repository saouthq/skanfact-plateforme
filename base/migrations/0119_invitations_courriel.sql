-- 0119 : l'invitation part aussi par e-mail (1.26.0 ; docs/console.md C42 ; décidé par Skander le 15/10/2026 : « fait ta
-- recommandation »). Comme Claude, Slack ou Notion : SkanFact envoie lui-même l'invitation, par son relais d'e-mails, et
-- « Copier le lien » reste en secours. Ce qui part chez le relais, compté : l'adresse invitée, le nom de qui invite, où
-- (l'entreprise, le cabinet, l'équipe SkanFact), le rôle, le lien et le jour où il cesse de valoir. Rien d'autre.
--
-- Pour l'équipe SkanFact, le serveur relit l'invitation qu'il vient d'écrire (ou de renvoyer) : à qui, quel rôle, qui
-- invite. Pour la direction seule, comme le geste.
create function plateforme.console_invitation_pour_courriel(p_invitation uuid)
returns table (email text, role text, invite_par text)
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return query select i.email, i.role, u.nom from plateforme.invitation_console i join socle.utilisateur u on u.id = i.invite_par
    where i.id = p_invitation and i.acceptee_le is null and i.annulee_le is null;
end $$;

revoke execute on function plateforme.console_invitation_pour_courriel(uuid) from public;
grant execute on function plateforme.console_invitation_pour_courriel(uuid) to skanfact_app;
