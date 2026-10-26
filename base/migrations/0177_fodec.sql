-- La FODEC (1.155.0 ; maquette de la facture, docs/maquettes/facture.html, « FODEC ») : due par les industriels sur
-- les produits qu'ils fabriquent. Une ligne la porte (`fodec`) ; son taux est une règle datée (`fodec.taux`, lue à la
-- date de la pièce, base/regles-communes.json), jamais un chiffre écrit ici. Le montant scellé d'une pièce émise vit
-- dans `fodec` : nul pour une pièce sans FODEC, donc rien ne change pour les pièces d'avant (ni leurs montants, ni leur
-- empreinte : serveur/ventes/pieces.ts ne scelle la FODEC que quand elle existe). À VÉRIFIER avec un comptable.
alter table ventes.ligne add column fodec boolean not null default false;
alter table ventes.piece add column fodec bigint check (fodec is null or fodec >= 0);
