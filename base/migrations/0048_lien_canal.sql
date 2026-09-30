-- Les envois (brique 79 ; docs/espace-client.md, E7). Un navigateur ne joint pas de fichier : l'e-mail et le
-- WhatsApp d'une facture ou d'un avoir émis portent le LIEN de la pièce, créé à l'envoi. Le lien note par où
-- il est parti (« Lien pour le client… » le dit, pour savoir lequel retirer) ; un lien donné à copier n'en a
-- pas.
alter table ventes.lien add column canal text check (canal is null or canal in ('email', 'whatsapp'));
