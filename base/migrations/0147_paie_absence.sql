-- Une absence se retire au taux du salaire du contrat (19/10/2026, 1.62.0 ; docs/paie.md, « L'absence du mois d'une
-- entrée »). Le mois d'une entrée ou d'une sortie, le brut de base du bulletin est déjà proratisé ; une absence sans solde
-- s'en retirait encore au prorata (650 × 2 / 26 au lieu de 1 300 × 2 / 26 : le salarié touchait 50 de trop). Le bulletin
-- garde le salaire d'un mois complet sur lequel l'absence s'est retirée, comme il garde son barème (une pièce garde ce qui
-- a servi à la calculer) ; vide, c'est le brut de base (les bulletins d'avant, et tous ceux d'un mois sans prorata).
alter table paie.bulletin add column brut_du_mois bigint check (brut_du_mois is null or brut_du_mois >= 0);
comment on column paie.bulletin.brut_du_mois is 'Le salaire d''un mois complet sur lequel l''absence s''est retirée, quand le brut de base est proratisé (une entrée, une sortie) ; vide : le brut de base.';
