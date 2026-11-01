-- Le cabinet lit QUI FAIT LA PAIE de son client (01/11/2026, 1.235.0 ; docs/revue-paie-cabinet.md, lot C1). L'entreprise
-- écrit son choix sur sa fiche (`_racine/company` : `paieMode` « tenue » par le cabinet, « seule » faite par elle et
-- vérifiée, « sans » seule ; `paieModeDes` le mois d'où il vaut, `paieModeAvant` le choix d'avant). Le cabinet ne lisait
-- pas la fiche (0035, 0148) : son écran ne savait ni s'il tient la paie, ni s'il doit attendre l'accord du client, ni s'il
-- ne fait que la vérifier. Il lit désormais CES TROIS CHAMPS, et le nom du gérant (`managerName`, celui que ses boutons
-- nomment : « Envoyer à Sarra pour accord »), sous un mandat de paie, et rien d'autre de la fiche : une
-- fonction plutôt qu'une règle de lecture sur la ligne entière (l'adresse, le RIB, les réglages de la fiche restent chez
-- le client).
create function socle.mode_de_paie(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle as $$
  select jsonb_build_object('paieMode', d.contenu->'paieMode', 'paieModeDes', d.contenu->'paieModeDes', 'paieModeAvant', d.contenu->'paieModeAvant', 'gerant', d.contenu->'managerName')
    from socle.dossier_v10 d
   where d.entreprise = p_entreprise and d.collection = '_racine' and d.cle = 'company'
     and (p_entreprise in (select socle.mes_entreprises_au_perimetre('paie'))
          or p_entreprise in (select socle.mes_entreprises_entieres()))
$$;
revoke execute on function socle.mode_de_paie(uuid) from public;
grant execute on function socle.mode_de_paie(uuid) to skanfact_app;
