-- Les pièces jointes (lot Fonctions 3, 21/10/2026 ; docs/pieces-jointes.md ; cadrage 01 § 20 : `fichier`,
-- `piece_jointe`). Le devis signé scanné, la photo d'une facture d'achat, le justificatif d'un mouvement de banque : dans
-- la v10, une copie à côté du fichier de données, jamais dans les sauvegardes quotidiennes. Ici, dans la base de
-- l'entreprise : gardés avec elle (sauvegardes, copie hors de la machine, export et restauration d'UNE entreprise).
--
-- Une photo (JPEG, PNG, WebP) ou un PDF, dix mégaoctets au plus, reconnu à ses premiers octets par le serveur (jamais à
-- son nom), comme les fichiers de la messagerie (0078). La pièce du dossier v10 garde sa fiche (`attachments` : nom,
-- identifiant, taille, date) ; ce tableau garde le fichier.
--
-- Gardé dix ans (les pièces justificatives, 05 § 3.8 : À VÉRIFIER), et jamais réécrit : aucune mise à jour. Qui l'a déposé
-- le retire dans les vingt-quatre heures (une erreur de fichier se corrige le jour même) ; après, « Retirer » le détache
-- de sa pièce et la copie reste jusqu'à sa date.

create table socle.piece_jointe (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  nom text not null check (length(nom) between 1 and 200),
  type text not null check (type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  taille int not null check (taille between 1 and 10485760),
  contenu bytea not null,
  empreinte text not null check (empreinte ~ '^[0-9a-f]{64}$'),
  depose_par uuid not null references socle.utilisateur(id),
  depose_le timestamptz not null default now(),
  conserver_jusqu_au date not null default ((now() at time zone 'Africa/Tunis')::date + interval '10 years')::date,
  check (octet_length(contenu) = taille),
  check (conserver_jusqu_au >= (depose_le at time zone 'Africa/Tunis')::date + interval '10 years')
);
create index piece_jointe_entreprise on socle.piece_jointe (entreprise, depose_le);

-- Qui voit l'entreprise en entier (pas seulement par son cabinet, 0035 : les pièces ne lui sont pas ouvertes) lit ses
-- pièces jointes et en dépose ; seul qui l'a déposée retire la sienne, le jour même.
alter table socle.piece_jointe enable row level security;
alter table socle.piece_jointe force row level security;
create policy lire on socle.piece_jointe for select using (entreprise in (select socle.mes_entreprises_entieres()));
create policy deposer on socle.piece_jointe for insert with check (entreprise in (select socle.mes_entreprises_entieres()) and depose_par = socle.moi());
create policy retirer on socle.piece_jointe for delete using (entreprise in (select socle.mes_entreprises_entieres()) and depose_par = socle.moi()
  and depose_le > now() - interval '24 hours');
grant select, insert, delete on socle.piece_jointe to skanfact_app;
