// Exporter UNE entreprise, et la restaurer à l'identique (vision § 4.2, 01 R14, 06 § 4.4). La restauration est un
// outil d'exploitation : elle travaille avec un compte d'administration, jamais par le serveur web, et chaque
// restauration laisse sa trace dans la piste d'audit de l'entreprise. L'export a deux lecteurs, qui font le même fichier
// au caractère près (un test le vérifie) :
//   - l'exploitation, avec un compte d'administration (`exporter`) ;
//   - l'entreprise elle-même, son propriétaire ou un administrateur (« Télécharger toutes mes données », 03 « Export
//     complet », 0080), dans la transaction de sa requête, sous la sécurité par ligne (`exporterDans`, lecteur
//     « entreprise »). Elle y voit toutes ses lignes ; ce qu'elles désignent ailleurs (une personne, un appareil, le
//     cabinet) lui est rendu par une fonction de la base, pour les seuls identifiants désignés.
//
//   PG_ADMIN=… node base/entreprise.ts exporter <entreprise> <fichier>
//   PG_ADMIN=… node base/entreprise.ts restaurer <fichier>            dans une base où elle n'est pas
//   PG_ADMIN=… node base/entreprise.ts remettre <fichier> "<motif>" [--essayer]
//                                                                     par-dessus elle-même (exploitation/remettre-entreprise.sh)
//
// Le fichier, une ligne par élément :
//   - l'en-tête (le format, l'entreprise, les migrations de la base d'origine) ;
//   - pour chaque table, une ligne qui la nomme, puis ses lignes telles que PostgreSQL les écrit
//     en JSON. Elles vont de la base au fichier et du fichier à la base EN TEXTE : le serveur ne les
//     relit jamais en JavaScript, où un entier de 64 bits perdrait ses derniers chiffres ;
//   - la fin, avec l'empreinte de tout ce qui précède : un fichier coupé ou abîmé est refusé.
//
// Chaque table de la base a sa place dans CLASSEMENT ; l'export refuse une table qui n'en a pas (et
// un test tombe) : on décide, table par table, si elle part avec l'entreprise.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const FORMAT = 'skanfact-entreprise';
export const VERSION = 1;

// Où va chaque table.
//   entreprise : ses lignes sont celles de l'entreprise (`condition`, par défaut `entreprise = $1`) ;
//                `aussiReference` : les lignes d'ailleurs que l'entreprise désigne partent aussi,
//                comme une référence (un collaborateur du cabinet, un membre du groupe) ;
//   reference  : une chose partagée que l'entreprise désigne (une personne, un groupe, un cabinet,
//                un appareil) : seules les lignes désignées partent, avec les seules `colonnes`
//                dites (aucun secret), créées à la restauration si elles manquent, jamais écrasées ;
//   commune    : la même sur toute la plateforme (devises, règles communes) : jamais exportée ;
//   hors       : ne part jamais, avec sa raison.
export type Classe =
  | { classe: 'entreprise'; condition?: string; aussiReference?: true }
  | { classe: 'reference'; colonnes?: string[] }
  | { classe: 'commune' }
  | { classe: 'hors'; raison: string };

export const CLASSEMENT: Record<string, Classe> = {
  'socle.entreprise': { classe: 'entreprise', condition: 'id = $1' },
  'socle.etablissement': { classe: 'entreprise' },
  'socle.membre': { classe: 'entreprise', aussiReference: true },
  'socle.mandat': { classe: 'entreprise' },
  'socle.mandat_affectation': { classe: 'entreprise', condition: 'mandat in (select id from socle.mandat where entreprise = $1)' },
  'socle.invitation': { classe: 'entreprise' },
  'socle.transfert_propriete': { classe: 'entreprise' },
  'socle.audit': { classe: 'entreprise' },
  'socle.regle_entreprise': { classe: 'entreprise' },
  'socle.serie': { classe: 'entreprise' },
  'socle.compteur': { classe: 'entreprise' },
  'socle.chaine': { classe: 'entreprise' },
  'socle.maillon': { classe: 'entreprise' },
  'socle.tiers': { classe: 'entreprise' },
  'ventes.piece': { classe: 'entreprise' },
  'ventes.ligne': { classe: 'entreprise' },
  // Les règlements d'une facture (0012) : ils partent avec elle.
  'ventes.reglement': { classe: 'entreprise' },
  // Les achats (0013) : la pièce du fournisseur, ses lignes, ses règlements.
  'achats.piece': { classe: 'entreprise' },
  'achats.ligne': { classe: 'entreprise' },
  'achats.reglement': { classe: 'entreprise' },
  // La paie (0014) : les salariés et leurs bulletins, chacun avec le barème qui l'a calculé.
  'paie.salarie': { classe: 'entreprise' },
  'paie.bulletin': { classe: 'entreprise' },
  // Les écritures (0015) : le brouillard et ce qui sera validé ; elles partent avec l'entreprise.
  'compta.ecriture': { classe: 'entreprise' },
  'compta.ligne': { classe: 'entreprise' },
  'compta.cloture': { classe: 'entreprise' },
  // La fiche d'un dossier au cabinet appartient au CABINET (ses notes sur son client) : elle ne part
  // pas avec l'entreprise.
  'cabinet.fiche': { classe: 'hors', raison: 'les notes du cabinet sur son client appartiennent au cabinet' },
  'cabinet.reglages': { classe: 'hors', raison: 'les réglages du cabinet (banques, mots retenus) valent pour tous ses clients' },
  'compta.compteur': { classe: 'entreprise' },
  'compta.lettrage': { classe: 'entreprise' },
  'compta.ligne_lettree': { classe: 'entreprise' },
  'compta.exercice': { classe: 'entreprise' },
  'compta.releve': { classe: 'entreprise' },
  'compta.releve_ligne': { classe: 'entreprise' },
  'compta.rapprochement': { classe: 'entreprise' },
  'compta.declaration': { classe: 'entreprise' },
  'compta.annuel': { classe: 'entreprise' },
  'compta.immobilisation': { classe: 'entreprise' },
  'compta.immobilisation_ecriture': { classe: 'entreprise' },
  'compta.inventaire': { classe: 'entreprise' },
  // Les questions du cabinet au client (0028) : elles se lisent dans ses livres, en face de ses pièces. Une question que
  // le cabinet n'a pas encore envoyée est son brouillon : elle reste avec sa révision (0080, comme ce que le client lit).
  'compta.question': { classe: 'entreprise', condition: 'entreprise = $1 and (cardinality(envois) > 0 or cabinet is null)' },
  // Les réouvertures d'un exercice clos (0029) : quand, qui, pourquoi.
  'compta.reouverture': { classe: 'entreprise' },
  // La messagerie avec le cabinet (0078) : le fil appartient à l'entreprise, ses messages et leurs fichiers aussi.
  'messagerie.fil': { classe: 'entreprise' },
  'messagerie.message': { classe: 'entreprise' },
  // Un fichier jamais joint à un message est un dépôt en cours, que seul son auteur lit (0078) : il ne fait pas encore
  // partie du fil, et ne part pas (0080).
  'messagerie.fichier': { classe: 'entreprise', condition: 'entreprise = $1 and id in (select m.fichier from messagerie.message m where m.entreprise = $1 and m.fichier is not null)' },
  // L'alerte par e-mail est un réglage de chaque personne (cochée par défaut) : restaurée, l'entreprise la rend cochée.
  'messagerie.alerte': { classe: 'hors', raison: 'un réglage de chaque personne, coché par défaut' },
  // La révision d'un dossier (0028) : le dossier de travail du CABINET ; elle ne part pas avec l'entreprise.
  'cabinet.revision': { classe: 'hors', raison: 'le dossier de révision appartient au cabinet qui révise' },
  // Le dossier v10 de l'entreprise (0011) : ce que son interface tient, objet par objet.
  'socle.dossier_v10': { classe: 'entreprise' },
  // Les traces de ce qui a été retiré du dossier (0059) : elles servent la relecture par différence des postes ; un poste
  // d'une entreprise restaurée relit tout.
  'socle.instance': { classe: 'hors', raison: 'l\'identité de la base, propre à chaque base' },
  // L'abonnement (0082, docs/abonnement.md) : le compte de l'entreprise CHEZ SkanFact. Une remise ou une restauration ne le
  // fait jamais revenir en arrière (un paiement d'après la minute remise resterait payé), et il ne part pas avec ses données.
  'plateforme.abonnement': { classe: 'hors', raison: 'le compte de l\'entreprise chez SkanFact (essai, échéances, paiements) : une remise ne le fait jamais revenir en arrière' },
  'plateforme.evenement_abonnement': { classe: 'hors', raison: 'l\'histoire de l\'abonnement chez SkanFact, avec les notes de SkanFact' },
  'plateforme.relance_abonnement': { classe: 'hors', raison: 'les relances déjà parties : une remise ne les fait pas repartir' },
  'plateforme.prix': { classe: 'hors', raison: 'la grille de SkanFact, commune à toutes les entreprises' },
  'plateforme.prix_option': { classe: 'hors', raison: 'les prix de ce qui s\'ajoute à une offre (14c) : la grille de SkanFact, commune à toutes les entreprises' },
  'plateforme.regle_abonnement': { classe: 'hors', raison: 'les règles de l\'abonnement (le préavis d\'un nouveau prix, 0103) : celles de SkanFact, communes à toutes les entreprises' },
  // La console (0083, docs/console.md) : l'équipe SkanFact, sa connexion et son journal. Rien de cela n'est à l'entreprise.
  'plateforme.equipe': { classe: 'hors', raison: 'l\'équipe de SkanFact, commune à la plateforme' },
  'plateforme.defi_console': { classe: 'hors', raison: 'un secret de connexion ne quitte jamais la plateforme' },
  'plateforme.session_console': { classe: 'hors', raison: 'une session ouverte est une clé de connexion' },
  'plateforme.geste_console': { classe: 'hors', raison: 'le journal de la console de SkanFact, avec ses notes : une remise ne le fait jamais revenir en arrière' },
  // Le service (0085, docs/console.md C12) : ce que le serveur mesure de lui-même et ce que sa veille voit. Des comptes
  // de requêtes de toutes les entreprises mêlées, jamais une donnée de l'une d'elles.
  'plateforme.service_minute': { classe: 'hors', raison: 'les requêtes du serveur, minute par minute, toutes entreprises mêlées : des mesures de la plateforme' },
  'plateforme.service_heure': { classe: 'hors', raison: 'les requêtes du serveur, heure par heure, toutes entreprises mêlées : des mesures de la plateforme' },
  'plateforme.service_route': { classe: 'hors', raison: 'les routes appelées chaque jour, par leur modèle et sans aucune valeur : des mesures de la plateforme' },
  'plateforme.service_releve': { classe: 'hors', raison: 'ce que la veille du serveur relève chaque minute (la machine, ses disques, ses copies) : l\'état de la plateforme' },
  'plateforme.service_alerte': { classe: 'hors', raison: 'les alertes de la veille du serveur : l\'histoire de la plateforme, qu\'une remise ne fait jamais revenir en arrière' },
  'plateforme.service_nuit': { classe: 'hors', raison: 'les sauvegardes de chaque nuit, de toute la base : l\'histoire de la plateforme' },
  // Les alertes (0086, docs/console.md C13) : ce que la veille a envoyé, ses sourdines, les essais demandés par la console.
  'plateforme.service_envoi': { classe: 'hors', raison: 'les messages de la veille à l\'équipe SkanFact (e-mail, SMS) : l\'histoire de la plateforme' },
  'plateforme.service_sourdine': { classe: 'hors', raison: 'les sourdines posées par l\'équipe SkanFact sur les règles de la veille, avec leur motif' },
  'plateforme.service_demande': { classe: 'hors', raison: 'les alertes d\'essai demandées depuis la console de SkanFact' },
  'plateforme.service_incident': { classe: 'hors', raison: 'les incidents du service, toutes entreprises mêlées, et leur compte rendu : l\'histoire de la plateforme' },
  'plateforme.service_incident_point': { classe: 'hors', raison: 'les points d\'un incident du service, écrits par l\'équipe SkanFact' },
  'plateforme.service_suite': { classe: 'hors', raison: 'les suites promises par le compte rendu d\'un incident du service, confiées à l\'équipe SkanFact' },
  'plateforme.service_consigne': { classe: 'hors', raison: 'les consignes données au suiveur des versions (geler, retenir, revenir) : l\'exploitation de la plateforme' },
  'plateforme.service_tour': { classe: 'hors', raison: 'le dernier passage de chaque tour du serveur (facteur, postier, relances) : l\'état de la plateforme' },
  'plateforme.service_maintenance': { classe: 'hors', raison: 'les maintenances annoncées sur la page d\'état : l\'histoire de la plateforme' },
  // Les réglages (0093, docs/console.md C28) : la relecture d'une règle commune par un comptable, et le message affiché en
  // haut de l'application de tous les clients. Communs à la plateforme, à aucune entreprise.
  'plateforme.relecture_regle': { classe: 'hors', raison: 'la relecture d\'une règle commune par un comptable : le registre de la plateforme, commun à toutes les entreprises' },
  'plateforme.message_clients': { classe: 'hors', raison: 'le message affiché à tous les clients, écrit par l\'équipe SkanFact : commun à la plateforme' },
  'plateforme.demande_support': { classe: 'hors', raison: 'les demandes au support de SkanFact : la relation avec SkanFact, comme l\'abonnement ; chaque personne relit les siennes dans l\'application, et une remise ne les fait jamais revenir en arrière' },
  'plateforme.message_support': { classe: 'hors', raison: 'les échanges avec le support de SkanFact, avec les réponses de son équipe : la relation avec SkanFact, comme l\'abonnement' },
  'plateforme.acces_support': { classe: 'hors', raison: 'les accès accordés au support de SkanFact : la relation avec SkanFact ; une remise ne fait jamais revenir un accès, ni n\'efface sa trace' },
  'plateforme.lecture_support': { classe: 'hors', raison: 'les pages lues par le support pendant un accès : la trace que l\'entreprise relit, qu\'une remise ne touche pas' },
  'plateforme.editeur': { classe: 'hors', raison: 'l\'entreprise de SkanFact où naissent nos factures : un réglage de la plateforme, commun à toutes' },
  'plateforme.facture_abonnement': { classe: 'hors', raison: 'le lien entre une facture de SkanFact et l\'abonnement qu\'elle paie : la relation avec SkanFact, comme l\'abonnement ; la pièce elle-même est dans le dossier de SkanFact' },
  'socle.dossier_v10_retire': { classe: 'hors', raison: 'les traces de retrait servent la relecture des postes ; après une restauration, un poste relit tout' },
  // Ce qu'un appareil retiré a remis (0044) : à l'entreprise, décidé ou non.
  'socle.quarantaine': { classe: 'entreprise' },
  'ventes.lien': { classe: 'hors', raison: 'un lien de l\'espace client est une clé d\'accès : il ne quitte jamais la plateforme, on en redonne un' },
  'ventes.prestataire': { classe: 'hors', raison: 'la clé du prestataire de paiement est scellée par le coffre de CE serveur : elle se repose après une restauration' },
  'ventes.paiement_en_ligne': { classe: 'entreprise' },
  'ventes.efacture': { classe: 'entreprise' },
  // Qui signe (brique 81) : une personne de l'entreprise, avec son certificat chez TunTrust.
  'ventes.signataire': { classe: 'entreprise' },
  'ventes.signature_demande': { classe: 'entreprise' },
  'ventes.efacture_signee': { classe: 'entreprise' },
  // L'envoi à la TTN (brique 82) : le mot de passe El Fatoora est scellé par le coffre de CE serveur.
  'ventes.ttn_compte': { classe: 'hors', raison: 'le mot de passe El Fatoora est scellé par le coffre de CE serveur : il se repose après une restauration' },
  'ventes.envoi_ttn': { classe: 'entreprise' },
  // Les demandes d'accord d'un responsable (brique 98) : leur trace part avec l'entreprise.
  'ventes.accord': { classe: 'entreprise' },
  // La caisse, ses sessions (leur Z) et ses tickets (brique 116) : des faits de l'entreprise.
  'caisse.caisse': { classe: 'entreprise' },
  'caisse.session': { classe: 'entreprise' },
  'caisse.ticket': { classe: 'entreprise' },
  // Les alertes de caisse (brique 120) : ce que le serveur a constaté sur les tickets d'un poste, sans rien corriger.
  'caisse.alerte': { classe: 'entreprise' },
  // Les codes de caisse (brique 123) : une empreinte de secret personnel, comme un mot de passe ; chacun repose le sien.
  // Les retours à la caisse (brique 124) : des faits de l'entreprise ; les codes de responsable, des secrets personnels.
  'caisse.retour': { classe: 'entreprise' },
  'caisse.code_responsable': { classe: 'hors', raison: 'un code de responsable est un secret personnel, gardé en empreinte : chaque responsable repose le sien après une restauration' },
  'caisse.code': { classe: 'hors', raison: 'un code de caisse est un secret personnel, gardé en empreinte : chaque caissier repose le sien après une restauration' },
  // Le code d'un cabinet n'est pas repris : unique sur la plateforme, il reste à son cabinet.
  'socle.organisation': { classe: 'reference', colonnes: ['id', 'type', 'nom', 'cree_le'] },
  // Jamais l'empreinte du mot de passe ni le téléphone vérifié : une personne recréée se reconnecte
  // par « mot de passe oublié ».
  'socle.utilisateur': { classe: 'reference', colonnes: ['id', 'email', 'nom', 'langue', 'cree_le'] },
  // Un appareil désigné par la trace, sans sa clé ni sa reconnaissance : recréé, il n'est pas
  // « reconnu » et redemande le code.
  'socle.appareil': { classe: 'reference', colonnes: ['id', 'utilisateur', 'nom', 'type', 'premier_vu', 'revoque_le'] },
  'socle.cle_api': { classe: 'hors', raison: 'une clé d\'accès ne quitte jamais la plateforme : on en recrée une' },
  'socle.autorisation_partenaire': { classe: 'hors', raison: 'une autorisation de partenaire mène à une clé, qui ne quitte jamais la plateforme : on reconnecte la boutique' },
  'socle.abonnement_avis': { classe: 'hors', raison: 'un abonnement porte un secret de signature, qui ne quitte jamais la plateforme : on le recrée' },
  'socle.avis': { classe: 'hors', raison: 'un avis déjà livré ne se renvoie pas ; ceux qui attendaient partent avec leur abonnement' },
  'socle.devise': { classe: 'commune' },
  'socle.regle_fiscale': { classe: 'commune' },
  'socle.migration': { classe: 'hors', raison: 'l\'en-tête du fichier porte la liste des migrations' },
  'socle.session': { classe: 'hors', raison: 'une session ouverte est une clé de connexion' },
  'socle.code_secours': { classe: 'hors', raison: 'un secret de connexion ne quitte jamais la plateforme' },
  'socle.defi_connexion': { classe: 'hors', raison: 'un secret de connexion ne quitte jamais la plateforme' },
  'socle.tentative': { classe: 'hors', raison: 'le journal technique des connexions n\'appartient pas à l\'entreprise' },
  'socle.sms_envoye': { classe: 'hors', raison: 'le compte des SMS envoyés à une personne (sa limite par heure et par jour) n\'appartient pas à l\'entreprise' },
  'socle.reinitialisation': { classe: 'hors', raison: 'un lien de mot de passe oublié est un secret de connexion' },
  'socle.changement_adresse': { classe: 'hors', raison: 'un changement d\'adresse en cours porte un code de connexion, qui est un secret' },
  'socle.file_appareil': { classe: 'hors', raison: 'l\'ordre des gestes d\'un appareil appartient à l\'appareil' },
  // À REVOIR avec la file (étape 2) : les gestes « À reprendre » encore ouverts sont comptés dans
  // l'en-tête et annoncés, mais pas restaurés.
  'socle.operation': { classe: 'hors', raison: 'l\'effet d\'un geste accepté est dans les tables de l\'entreprise et sa trace dans l\'audit' },
};

// Les liens que la base ne déclare pas en clé étrangère (la trace, découpée par mois, n'en porte
// pas) mais que l'export doit suivre : la personne et l'appareil qui ont fait chaque geste.
export const LIENS_SANS_CONTRAINTE: Lien[] = [
  { nom: 'audit → utilisateur', de: 'socle.audit', colonnes: ['utilisateur'], vers: 'socle.utilisateur', versColonnes: ['id'] },
  { nom: 'audit → appareil', de: 'socle.audit', colonnes: ['appareil'], vers: 'socle.appareil', versColonnes: ['id'] },
];

type Lien = { nom: string; de: string; colonnes: string[]; vers: string; versColonnes: string[] };
type Colonne = { nom: string; identite: boolean };
type Catalogue = { tables: string[]; colonnes: Map<string, Colonne[]>; cles: Map<string, string[]>; liens: Lien[] };

const q = (ident: string) => '"' + ident.replaceAll('"', '""') + '"';
const qt = (table: string) => table.split('.').map(q).join('.');

async function lireCatalogue(client: pg.ClientBase): Promise<Catalogue> {
  const t = await client.query<{ nom: string }>(`
    select n.nspname || '.' || c.relname as nom from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'public')
      and c.relkind in ('r', 'p') and not c.relispartition order by 1`);
  const c = await client.query<{ tbl: string; nom: string; identite: boolean }>(`
    select n.nspname || '.' || c.relname as tbl, a.attname::text as nom, a.attidentity <> '' as identite
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'public') and c.relkind in ('r', 'p')
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by 1, a.attnum`);
  const k = await client.query<{ tbl: string; cols: string[] }>(`
    select n.nspname || '.' || c.relname as tbl, array_agg(a.attname::text order by array_position(i.indkey, a.attnum)) as cols
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary group by 1`);
  const f = await client.query<{ nom: string; de: string; cols: string[]; vers: string; verscols: string[] }>(`
    select k.conname as nom, sn.nspname || '.' || s.relname as de, tn.nspname || '.' || t.relname as vers,
      (select array_agg(a.attname::text order by x.o) from unnest(k.conkey) with ordinality x(n, o) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.n) as cols,
      (select array_agg(a.attname::text order by x.o) from unnest(k.confkey) with ordinality x(n, o) join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.n) as verscols
    from pg_constraint k join pg_class s on s.oid = k.conrelid join pg_namespace sn on sn.oid = s.relnamespace
    join pg_class t on t.oid = k.confrelid join pg_namespace tn on tn.oid = t.relnamespace
    where k.contype = 'f' and not s.relispartition order by 1`);
  const colonnes = new Map<string, Colonne[]>();
  for (const r of c.rows) {
    if (!colonnes.has(r.tbl)) colonnes.set(r.tbl, []);
    colonnes.get(r.tbl)?.push({ nom: r.nom, identite: r.identite });
  }
  return {
    tables: t.rows.map((r) => r.nom),
    colonnes,
    cles: new Map(k.rows.map((r) => [r.tbl, r.cols])),
    liens: [...f.rows.map((r) => ({ nom: r.nom, de: r.de, colonnes: r.cols, vers: r.vers, versColonnes: r.verscols })), ...LIENS_SANS_CONTRAINTE],
  };
}

// Les tables que CLASSEMENT ne range pas (une table nouvelle attend sa décision).
export async function tablesNonClassees(client: pg.ClientBase): Promise<string[]> {
  return (await lireCatalogue(client)).tables.filter((t) => !(t in CLASSEMENT));
}

// Qui lit la base pour l'export : l'exploitation (au-dessus de la sécurité par ligne), ou l'entreprise elle-même (sous
// elle, 0080).
export type Lecteur = 'exploitation' | 'entreprise';

// Ce que la sécurité par ligne cache à l'entreprise des lignes qu'elle désigne ailleurs, et la fonction de la base qui le
// lui rend (0080) : pour les identifiants demandés, parmi ceux qui la touchent, avec les seules colonnes de l'export
// (`colonnes` de CLASSEMENT ; un membre, toutes les siennes). Une table de référence nouvelle a sa fonction, sinon
// l'export de l'entreprise refuse (et un test tombe).
export const REFERENCES_PAR_FONCTION: Record<string, string> = {
  'socle.membre': 'socle.export_membres',
  'socle.organisation': 'socle.export_organisations',
  'socle.utilisateur': 'socle.export_utilisateurs',
  'socle.appareil': 'socle.export_appareils',
};

// Les parties de l'export : pour chaque table, les lignes de l'entreprise et/ou les références.
type Partie = { table: string; role: 'entreprise' | 'reference'; selection: string; colonnes: string[] };

function parties(cat: Catalogue, lecteur: Lecteur): Partie[] {
  const res: Partie[] = [];
  const entreprise = new Map<string, string>();
  for (const [table, c] of Object.entries(CLASSEMENT)) {
    if (c.classe === 'entreprise') entreprise.set(table, `select * from ${qt(table)} where ${c.condition ?? 'entreprise = $1'}`);
  }
  // Les lignes de référence d'une table : celles que désigne une ligne exportée (entreprise ou
  // référence), et qui ne sont pas déjà parmi les lignes de l'entreprise.
  const references = new Map<string, string>();
  const enCours = new Set<string>();
  const selectionReference = (table: string): string => {
    const deja = references.get(table);
    if (deja) return deja;
    if (enCours.has(table)) throw new Error(`références en boucle autour de ${table}`);
    enCours.add(table);
    const sources: string[] = [];
    for (const l of cat.liens.filter((x) => x.vers === table && x.de !== table)) {
      const c = CLASSEMENT[l.de];
      const selections: string[] = [];
      if (c?.classe === 'entreprise') selections.push(entreprise.get(l.de) ?? '');
      if (c?.classe === 'reference' || (c?.classe === 'entreprise' && c.aussiReference)) selections.push(selectionReference(l.de));
      for (const s of selections) sources.push(`select ${l.colonnes.map(q).join(', ')} from (${s}) s`);
    }
    const cle = cat.cles.get(table) ?? [];
    const c = CLASSEMENT[table];
    let sel: string;
    if (lecteur === 'entreprise') {
      // Les identifiants désignés partent à la fonction, qui ne rend que ceux qui touchent l'entreprise.
      const fonction = REFERENCES_PAR_FONCTION[table];
      if (!fonction || cle.length !== 1) throw new Error(`${table} : aucune fonction ne rend ses références à l'entreprise (0080, REFERENCES_PAR_FONCTION)`);
      sel = `select * from ${fonction}($1, ${sources.length ? `array(${sources.join(' union ')})` : '\'{}\'::uuid[]'}) where true`;
    } else {
      sel = sources.length
        ? `select * from ${qt(table)} where (${cle.map(q).join(', ')}) in (${sources.join(' union ')})`
        : `select * from ${qt(table)} where false`;
    }
    // « is not true » et non « not (…) » : un membre du cabinet a une entreprise vide, et « not
    // (vide = X) » ne vaut ni vrai ni faux.
    if (c?.classe === 'entreprise') sel += ` and (${c.condition ?? 'entreprise = $1'}) is not true`;
    enCours.delete(table);
    references.set(table, sel);
    return sel;
  };
  for (const table of [...Object.keys(CLASSEMENT)].sort()) {
    const c = CLASSEMENT[table];
    const toutes = (cat.colonnes.get(table) ?? []).map((x) => x.nom);
    if (c?.classe === 'entreprise') {
      res.push({ table, role: 'entreprise', selection: entreprise.get(table) ?? '', colonnes: toutes });
      if (c.aussiReference) res.push({ table, role: 'reference', selection: selectionReference(table), colonnes: toutes });
    } else if (c?.classe === 'reference') {
      res.push({ table, role: 'reference', selection: selectionReference(table), colonnes: c.colonnes ?? toutes });
    }
  }
  return res;
}

export type EnTete = {
  format: string; version: number; entreprise: string; raisonSociale: string; exporteLe: string;
  migrations: { numero: number; empreinte: string }[]; aReprendre: number;
};
type LigneTable = { table: string; role: 'entreprise' | 'reference'; lignes: number };
type Fin = { fin: true; empreinte: string };

// L'export de l'exploitation, dans une photographie cohérente de la base (une seule transaction en lecture).
export async function exporter(client: pg.ClientBase, entreprise: string): Promise<string[]> {
  await client.query('begin isolation level repeatable read read only');
  try {
    const lignes = await exporterDans(client, entreprise, 'exploitation');
    await client.query('commit');
    return lignes;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

// L'export, dans la transaction ouverte par l'appelant : la photographie est celle de cette transaction (le serveur
// l'ouvre en « repeatable read » pour l'export de l'entreprise : la route le déclare).
export async function exporterDans(client: pg.ClientBase, entreprise: string, lecteur: Lecteur, maintenant = new Date()): Promise<string[]> {
  const cat = await lireCatalogue(client);
  const manquantes = cat.tables.filter((t) => !(t in CLASSEMENT));
  if (manquantes.length) throw new Error(`table non classée pour l'export : ${manquantes.join(', ')} (base/entreprise.ts, CLASSEMENT)`);
  const e = (await client.query('select raison_sociale from socle.entreprise where id = $1', [entreprise])).rows[0];
  if (!e) throw new Error(`entreprise introuvable : ${entreprise}`);
  const migrations = (lecteur === 'entreprise'
    ? await client.query('select numero, empreinte from socle.export_migrations($1)', [entreprise])
    : await client.query('select numero, empreinte from socle.migration order by numero')).rows;
  const aReprendre = (await client.query(`select count(*)::int n from socle.operation
    where entreprise = $1 and statut <> 'acceptee' and resolue_le is null`, [entreprise])).rows[0].n as number;
  const enTete: EnTete = {
    format: FORMAT, version: VERSION, entreprise, raisonSociale: e.raison_sociale, exporteLe: maintenant.toISOString(), migrations, aReprendre,
  };
  const lignes = [JSON.stringify(enTete)];
  for (const p of parties(cat, lecteur)) {
    const cle = cat.cles.get(p.table) ?? [];
    const ordre = cle.length ? cle.map((k) => `t.${q(k)}`).join(', ') : 't::text';
    // Toutes les colonnes : la ligne entière ; une référence : ses seules colonnes dites.
    const toutes = (cat.colonnes.get(p.table) ?? []).length === p.colonnes.length;
    const projection = toutes ? 'to_jsonb(t)' : `jsonb_build_object(${p.colonnes.map((k) => `'${k}', t.${q(k)}`).join(', ')})`;
    const texte = `select count(*)::int n, coalesce(jsonb_agg(${projection} order by ${ordre}), '[]')::text lignes from (${p.selection}) t`;
    const r = (await client.query(texte, parametres(texte, entreprise))).rows[0];
    const entete: LigneTable = { table: p.table, role: p.role, lignes: r.n };
    lignes.push(JSON.stringify(entete), r.lignes);
  }
  const fin: Fin = { fin: true, empreinte: empreinte(lignes) };
  lignes.push(JSON.stringify(fin));
  return lignes;
}

// Le nom du fichier que l'entreprise télécharge : « skanfact-<sa raison sociale>-<jour>.jsonl », sa raison sociale
// réduite à ses lettres et ses chiffres (toutes écritures), pour qu'un fichier rangé se reconnaisse.
export function nomDExport(raisonSociale: string, jour: string): string {
  const mot = raisonSociale.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `skanfact-${mot || 'entreprise'}-${jour}.jsonl`;
}

// Une requête reçoit l'entreprise seulement si elle la demande ($1).
const parametres = (texte: string, entreprise: string) => (texte.includes('$1') ? [entreprise] : []);

const empreinte = (lignes: string[]) => createHash('sha256').update(lignes.join('\n'), 'utf8').digest('hex');

export type Bilan = { entreprise: string; tables: { table: string; role: string; lignes: number }[]; aReprendre: number };

// Un fichier d'export relu : son empreinte d'abord (un fichier coupé ou abîmé est refusé), puis son format.
function lireFichier(lignes: string[]): { enTete: EnTete; empreinte: string } {
  const derniere = lignes.at(-1);
  const fin = derniere ? (JSON.parse(derniere) as Partial<Fin>) : {};
  if (fin.fin !== true || fin.empreinte !== empreinte(lignes.slice(0, -1))) {
    throw new Error('fichier d\'export coupé ou abîmé : son empreinte ne correspond pas');
  }
  const enTete = JSON.parse(lignes[0] ?? '{}') as EnTete;
  if (enTete.format !== FORMAT || enTete.version !== VERSION) throw new Error(`format inconnu : ${enTete.format} ${enTete.version}`);
  return { enTete, empreinte: fin.empreinte };
}

async function memesMigrations(client: pg.ClientBase, enTete: EnTete, geste: string): Promise<void> {
  const ici = (await client.query('select numero, empreinte from socle.migration order by numero')).rows;
  if (JSON.stringify(ici) !== JSON.stringify(enTete.migrations)) {
    throw new Error(`la base cible n'a pas les mêmes migrations que la base d'origine : mets-la au même niveau avant de ${geste}`);
  }
}

// Reposer les lignes du fichier, table par table (les règles du métier et les clés étrangères se taisent : la
// transaction a posé `session_replication_role = replica`).
//   - une ligne de l'entreprise est reposée telle quelle, et toutes doivent l'être ;
//   - `remplacer` (la remise) : une ligne de l'entreprise qui porte déjà la même clé est d'abord retirée (une ligne que
//     l'effacement par sa condition n'a pas vue, un fichier d'un message devenu dépôt…) : le fichier fait foi ;
//   - une référence (une personne, un cabinet, un appareil) n'est créée que si elle manque, jamais écrasée.
// (La piste d'audit, qu'une remise n'efface pas : ses lignes du fichier, déjà là et immuables, reviennent identiques.)
async function reposer(client: pg.ClientBase, cat: Catalogue, lignes: string[], remplacer: boolean): Promise<{ table: string; role: string; lignes: number; remplacees: number }[]> {
  const tables: { table: string; role: string; lignes: number; remplacees: number }[] = [];
  for (let i = 1; i + 1 < lignes.length - 1; i += 2) {
    const t = JSON.parse(lignes[i] ?? '') as LigneTable;
    const c = CLASSEMENT[t.table];
    if (!c || !cat.colonnes.has(t.table)) throw new Error(`table inconnue dans le fichier : ${t.table}`);
    const colonnes = (cat.colonnes.get(t.table) ?? []).filter((x) => t.role === 'entreprise' || c.classe !== 'reference' || !c.colonnes || c.colonnes.includes(x.nom));
    const liste = colonnes.map((x) => q(x.nom)).join(', ');
    const identite = colonnes.some((x) => x.identite) ? ' overriding system value' : '';
    let remplacees = 0;
    const cle = cat.cles.get(t.table) ?? [];
    if (remplacer && t.role === 'entreprise' && cle.length) {
      const cles = cle.map(q).join(', ');
      remplacees = (await client.query(`delete from ${qt(t.table)} where (${cles}) in
        (select ${cles} from jsonb_populate_recordset(null::${qt(t.table)}, $1::jsonb))`, [lignes[i + 1]])).rowCount ?? 0;
    }
    const r = await client.query(`insert into ${qt(t.table)} (${liste})${identite}
      select ${liste} from jsonb_populate_recordset(null::${qt(t.table)}, $1::jsonb)
      ${t.role === 'reference' ? 'on conflict do nothing' : ''}`, [lignes[i + 1]]);
    if (t.role === 'entreprise' && r.rowCount !== t.lignes) throw new Error(`${t.table} : ${t.lignes} lignes attendues, ${r.rowCount} reposées`);
    tables.push({ table: t.table, role: t.role, lignes: r.rowCount ?? 0, remplacees });
  }
  return tables;
}

// Chaque lien d'une ligne reposée mène à une ligne qui existe (les clés étrangères, et les liens de la trace). Une
// remise regarde aussi dans l'autre sens : ce qui, ailleurs, désigne une ligne de l'entreprise (le dossier de révision
// d'un cabinet, une ligne qu'une table hors de l'export garde) ne doit pas se retrouver désigner une ligne que la remise
// a fait disparaître.
async function verifierLiens(client: pg.ClientBase, cat: Catalogue, entreprise: string, geste: 'restauration' | 'remise'): Promise<void> {
  const egalites = (l: Lien) => l.colonnes.map((k, j) => `v.${q(l.versColonnes[j] ?? '')} = s.${q(k)}`).join(' and ');
  const remplies = (l: Lien) => l.colonnes.map((k) => `s.${q(k)} is not null`).join(' and ');
  for (const l of cat.liens) {
    const c = CLASSEMENT[l.de];
    if (c?.classe !== 'entreprise' && c?.classe !== 'reference') continue;
    const filtre = c.classe === 'entreprise' ? `(${c.condition ?? 'entreprise = $1'})` : 'true';
    const texte = `select count(*)::int n from ${qt(l.de)} s
      where ${filtre} and ${remplies(l)} and not exists (select 1 from ${qt(l.vers)} v where ${egalites(l)})`;
    const pendantes = (await client.query(texte, parametres(texte, entreprise))).rows[0].n as number;
    if (pendantes) throw new Error(`${pendantes} ligne(s) de ${l.de} désignent une ligne absente (${l.nom}) : ${geste} annulée`);
  }
  if (geste !== 'remise') return;
  for (const l of cat.liens) {
    if (CLASSEMENT[l.vers]?.classe !== 'entreprise') continue;
    const c = CLASSEMENT[l.de];
    // Les lignes de l'entreprise elle-même viennent d'être vérifiées ; restent, dans une table de l'entreprise, ses
    // lignes que l'export ne prend pas (le brouillon d'une question du cabinet), et, ailleurs, toutes.
    let filtre = 'true';
    if (c?.classe === 'entreprise') {
      if (!(cat.colonnes.get(l.de) ?? []).some((x) => x.nom === 'entreprise')) continue;
      filtre = `s.entreprise = $1 and not coalesce((${c.condition ?? 'entreprise = $1'}), false)`;
    }
    const texte = `select count(*)::int n from ${qt(l.de)} s
      where ${filtre} and ${remplies(l)} and not exists (select 1 from ${qt(l.vers)} v where ${egalites(l)})`;
    const pendantes = (await client.query(texte, parametres(texte, entreprise))).rows[0].n as number;
    if (pendantes) throw new Error(`${pendantes} ligne(s) de ${l.de} désignent une ligne que la remise ferait disparaître (${l.nom}) : remise annulée, rien n'a changé`);
  }
}

// La restauration, dans une base où l'entreprise n'est PAS. Tout ou rien : une seule transaction.
export async function restaurer(client: pg.ClientBase, lignes: string[]): Promise<Bilan> {
  const { enTete, empreinte: emp } = lireFichier(lignes);
  await client.query('begin');
  try {
    await memesMigrations(client, enTete, 'restaurer');
    if ((await client.query('select 1 from socle.entreprise where id = $1', [enTete.entreprise])).rowCount) {
      throw new Error('cette entreprise existe déjà dans la base cible : rien n\'est écrasé (pour la remettre par-dessus elle-même : remettre)');
    }
    // Les règles du métier (une facture émise ne se réécrit pas…) et les clés étrangères se taisent
    // le temps de reposer les lignes telles qu'elles étaient ; les clés sont contrôlées ensuite.
    await client.query('set local session_replication_role = replica');
    const cat = await lireCatalogue(client);
    const tables = await reposer(client, cat, lignes, false);
    await verifierLiens(client, cat, enTete.entreprise, 'restauration');
    await client.query(`insert into socle.audit (entreprise, geste, objet_type, objet_id, apres)
      values ($1, 'socle.entreprise.restaurer', 'entreprise', $1, $2)`,
    [enTete.entreprise, JSON.stringify({ exporteLe: enTete.exporteLe, empreinte: emp, aReprendre: enTete.aReprendre })]);
    await client.query('commit');
    return { entreprise: enTete.entreprise, tables: tables.map(({ table, role, lignes: n }) => ({ table, role, lignes: n })), aReprendre: enTete.aReprendre };
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

export type BilanRemise = {
  // `minute` : celle qu'on a voulu retrouver (heure de Tunis), quand le script la donne ; `exporteLe` n'est que l'heure où
  // le fichier a été fait (l'essai), jamais celle où l'entreprise revient.
  entreprise: string; motif: string; minute: string | null; exporteLe: string; essai: boolean; aReprendre: number;
  // Par table de l'entreprise : ses lignes juste avant la remise, et celles du fichier, reposées.
  tables: { table: string; role: string; avant: number; lignes: number }[];
  // Les numéros que portent aujourd'hui des pièces, et qu'aucune ne porte plus après la remise (une facture émise après
  // la minute du fichier) : leur série les redonnera. L'essai les nomme AVANT la remise.
  numerosRetires: string[];
};

// Les numéros des pièces d'une entreprise : ses pièces émises du serveur (une série légale), les pièces numérotées de
// son dossier v10.
async function numerosEmis(client: pg.ClientBase, entreprise: string): Promise<string[]> {
  return (await client.query(`select distinct n from (
      select numero_texte n from ventes.piece where entreprise = $1 and emise_le is not null
      union all select contenu->>'number' from socle.dossier_v10 where entreprise = $1 and collection = 'documents'
    ) x where coalesce(n, '') <> '' order by 1`, [entreprise])).rows.map((r) => String(r.n));
}

// La remise : UNE entreprise abîmée (une erreur de manipulation, un défaut), remise telle que le fichier la décrit, par-
// dessus elle-même, dans la base vive (06 § 4.4). Le fichier vient d'une restauration à la minute faite à côté
// (exploitation/remettre-entreprise.sh). Ses lignes remplacent les siennes, table par table ; rien ne bouge des autres
// entreprises ; sa piste d'audit est gardée entière, et dit la remise, son motif et ce qu'elle a retiré. Les postes de
// l'entreprise relisent tout leur dossier. `essayer` : tout se fait, puis s'annule, et le bilan dit ce qui changerait.
// `minute` : celle qu'on a voulu retrouver (« 2026-10-12 14:03 », heure de Tunis) ; elle entre dans la piste d'audit avec
// le motif — une remise qui ne dit pas à quelle minute elle a ramené l'entreprise ne se relit pas (06 § 4.4).
// Tout ou rien : une seule transaction.
export async function remettre(client: pg.ClientBase, lignes: string[], options: { motif: string; essayer?: boolean; minute?: string }): Promise<BilanRemise> {
  const motif = options.motif.trim();
  if (motif.length < 3) throw new Error('une remise demande son motif (trois caractères au moins) : il entre dans la piste d\'audit de l\'entreprise');
  const minute = options.minute ?? null;
  if (minute !== null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(minute)) throw new Error('la minute d\'une remise s\'écrit « 2026-10-12 14:03 », à l\'heure de Tunis');
  const { enTete, empreinte: emp } = lireFichier(lignes);
  const E = enTete.entreprise;
  await client.query('begin');
  try {
    await memesMigrations(client, enTete, 'remettre');
    if (!(await client.query('select 1 from socle.entreprise where id = $1', [E])).rowCount) {
      throw new Error('cette entreprise n\'est pas dans cette base : la remise ne vaut que par-dessus elle (pour la recréer : restaurer)');
    }
    await client.query('set local session_replication_role = replica');
    const cat = await lireCatalogue(client);
    const manquantes = cat.tables.filter((t) => !(t in CLASSEMENT));
    if (manquantes.length) throw new Error(`table non classée : ${manquantes.join(', ')} (base/entreprise.ts, CLASSEMENT) : la remise ne saurait pas si elle lui appartient`);
    // Ce que l'état d'aujourd'hui porte, et que la remise peut retirer : les objets du dossier, les numéros de pièces.
    const dossierAvant = (await client.query('select collection, cle from socle.dossier_v10 where entreprise = $1', [E])).rows as { collection: string; cle: string }[];
    const numerosAvant = await numerosEmis(client, E);
    // 1. Ses lignes d'aujourd'hui s'en vont, toutes tables de l'entreprise à la fois (une seule instruction : chaque
    //    condition se lit sur l'état d'avant, même celle qui regarde une autre table), sauf la piste d'audit.
    const aEffacer = Object.entries(CLASSEMENT).filter(([t, c]) => c.classe === 'entreprise' && t !== 'socle.audit' && cat.colonnes.has(t))
      .map(([t, c]) => ({ table: t, condition: c.classe === 'entreprise' ? (c.condition ?? 'entreprise = $1') : 'false' }));
    const effacer = `with ${aEffacer.map((x, i) => `e${i} as (delete from ${qt(x.table)} where ${x.condition} returning 1)`).join(', ')}
      select ${aEffacer.map((_, i) => `(select count(*)::int from e${i}) e${i}`).join(', ')}`;
    const effacees = (await client.query(effacer, [E])).rows[0] as Record<string, number>;
    const avant = new Map(aEffacer.map((x, i) => [x.table, effacees[`e${i}`] ?? 0]));
    avant.set('socle.audit', (await client.query('select count(*)::int n from socle.audit where entreprise = $1', [E])).rows[0].n as number);
    // 2. Celles du fichier reviennent.
    const reposees = await reposer(client, cat, lignes, true);
    // 3. Les postes de l'entreprise relisent tout : chaque objet du dossier porte la transaction de la remise, ce qui a
    //    disparu le dit, ce qui est revenu ne le dit plus (ce que font d'ordinaire les déclencheurs, tus ici).
    const disparus = (await client.query(`select x.collection, x.cle from unnest($2::text[], $3::text[]) x(collection, cle)
      where not exists (select 1 from socle.dossier_v10 d where d.entreprise = $1 and d.collection = x.collection and d.cle = x.cle)`,
    [E, dossierAvant.map((d) => d.collection), dossierAvant.map((d) => d.cle)])).rows as { collection: string; cle: string }[];
    await client.query(`insert into socle.dossier_v10_retire (entreprise, collection, cle, xid, retire_le)
      select $1, x.collection, x.cle, pg_current_xact_id(), now() from unnest($2::text[], $3::text[]) x(collection, cle)
      on conflict (entreprise, collection, cle) do update set xid = excluded.xid, retire_le = excluded.retire_le`,
    [E, disparus.map((d) => d.collection), disparus.map((d) => d.cle)]);
    await client.query(`delete from socle.dossier_v10_retire r where r.entreprise = $1
      and exists (select 1 from socle.dossier_v10 d where d.entreprise = r.entreprise and d.collection = r.collection and d.cle = r.cle)`, [E]);
    await client.query('update socle.dossier_v10 set xid = pg_current_xact_id() where entreprise = $1', [E]);
    // 4. Les liens, dans les deux sens.
    await verifierLiens(client, cat, E, 'remise');
    // 5. Les numéros qu'aucune pièce ne porte plus (une pièce disparue, une facture émise redevenue brouillon).
    const numerosApres = new Set(await numerosEmis(client, E));
    const numerosRetires = numerosAvant.filter((n) => !numerosApres.has(n));
    // La piste d'audit ne s'efface pas : ce qu'elle compte avant la remise, et après (celle du fichier y était déjà). Comptée
    // comme les autres, elle se disait deux fois plus longue avant (vu le 12/10/2026 sur le serveur d'essai).
    const auditApres = (await client.query('select count(*)::int n from socle.audit where entreprise = $1', [E])).rows[0].n as number;
    const tables = reposees.map((t) => (t.table === 'socle.audit'
      ? { table: t.table, role: t.role, avant: avant.get(t.table) ?? 0, lignes: auditApres }
      : { table: t.table, role: t.role, lignes: t.lignes, avant: t.role === 'entreprise' ? (avant.get(t.table) ?? 0) + t.remplacees : t.lignes }));
    const compte = (role: 'avant' | 'lignes') => Object.fromEntries(tables.filter((t) => t.role === 'entreprise' && t[role]).map((t) => [t.table, t[role]]));
    await client.query(`insert into socle.audit (entreprise, geste, objet_type, objet_id, avant, apres)
      values ($1, 'socle.entreprise.remettre', 'entreprise', $1, $2, $3)`,
    [E, JSON.stringify({ lignes: compte('avant') }), JSON.stringify({ motif, minute, exporteLe: enTete.exporteLe, empreinte: emp, lignes: compte('lignes'), numerosRetires })]);
    await client.query(options.essayer ? 'rollback' : 'commit');
    return { entreprise: E, motif, minute, exporteLe: enTete.exporteLe, essai: options.essayer === true, aReprendre: enTete.aReprendre, tables, numerosRetires };
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [geste, a, b, ...reste] = process.argv.slice(2);
  // Après le motif d'une remise : « --essayer », « --minute "AAAA-MM-JJ HH:MM" », dans n'importe quel ordre.
  const essayer = reste.includes('--essayer');
  const iMinute = reste.indexOf('--minute');
  const minute = iMinute >= 0 ? reste[iMinute + 1] : undefined;
  const optionsLues = reste.filter((x, k) => x !== '--essayer' && !(iMinute >= 0 && (k === iMinute || k === iMinute + 1))).length === 0 && (iMinute < 0 || minute !== undefined);
  const adresse = process.env.PG_ADMIN;
  if (!adresse || !((geste === 'exporter' && a && b) || (geste === 'restaurer' && a) || (geste === 'remettre' && a && b && optionsLues))) {
    console.error('PG_ADMIN=… node base/entreprise.ts exporter <entreprise> <fichier> | restaurer <fichier> | remettre <fichier> "<motif>" [--essayer] [--minute "AAAA-MM-JJ HH:MM"]');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: adresse });
  await client.connect();
  try {
    if (geste === 'exporter') {
      fs.writeFileSync(b ?? '', (await exporter(client, a)).join('\n') + '\n', { mode: 0o600 });
      console.log(`Exportée : ${b}`);
    } else if (geste === 'restaurer') {
      const bilan = await restaurer(client, fs.readFileSync(a, 'utf8').replace(/\n$/, '').split('\n'));
      for (const t of bilan.tables) console.log(`${t.table} (${t.role}) : ${t.lignes}`);
      if (bilan.aReprendre) console.log(`Attention : ${bilan.aReprendre} geste(s) « À reprendre » ouverts n'ont pas été repris.`);
    } else {
      const bilan = await remettre(client, fs.readFileSync(a, 'utf8').replace(/\n$/, '').split('\n'), { motif: b ?? '', essayer, ...(minute !== undefined ? { minute } : {}) });
      const changees = bilan.tables.filter((t) => t.role === 'entreprise' && t.avant !== t.lignes);
      // L'état visé est la minute demandée (heure de Tunis) ; sans elle, l'heure du fichier — pas celle où l'entreprise revient.
      const etat = bilan.minute ? `du ${bilan.minute} (heure de Tunis)` : `du fichier fait le ${bilan.exporteLe}`;
      console.log(bilan.essai ? `Essai de la remise à l'état ${etat} (rien n'a changé) :` : `Remise à l'état ${etat} faite :`);
      for (const t of changees) console.log(`  ${t.table} : ${t.avant} ligne(s) aujourd'hui, ${t.lignes} après la remise`);
      if (!changees.length) console.log('  aucune table ne change de nombre de lignes (des lignes peuvent changer de contenu)');
      if (bilan.numerosRetires.length) console.log(`Attention : ces numéros de pièces disparaissent, et leur série les redonnera : ${bilan.numerosRetires.join(', ')}`);
      if (bilan.aReprendre) console.log(`Attention : ${bilan.aReprendre} geste(s) « À reprendre » ouverts dans le fichier ne sont pas repris.`);
    }
  } catch (e) {
    console.error(`Refusé : ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
