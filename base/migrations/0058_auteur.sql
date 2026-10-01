-- Supprimer un brouillon : les siens (brique 117 ; 03 § 1, « Supprimer un brouillon (jamais une pièce émise) : P, A ;
-- C, M, I, Pa : les siens » ; docs/droits-dossier.md). Chaque objet du dossier retient qui l'a créé ; une pièce de
-- vente, une commande fournisseur ou une réception ne se supprime que par son auteur, le propriétaire ou un
-- administrateur. Un objet d'avant cette brique n'a pas d'auteur connu : seul un responsable le supprime (la valeur
-- par défaut qui ne donne rien de plus).
alter table socle.dossier_v10 add column cree_par uuid references socle.utilisateur(id);

create function socle.dossier_v10_supprimer_le_sien() returns trigger
language plpgsql as $$
begin
  -- Sans personne connectée (une restauration, le serveur lui-même), la règle ne s'applique pas ici.
  if socle.moi() is null then return old; end if;
  if old.collection in ('documents', 'supplierOrders', 'receptions')
     and old.cree_par is distinct from socle.moi()
     and not (socle.mes_roles(old.entreprise) && array['proprietaire', 'administrateur']) then
    raise exception 'Un brouillon se supprime par son auteur, le propriétaire ou un administrateur.' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger dossier_v10_supprimer_le_sien before delete on socle.dossier_v10
  for each row execute function socle.dossier_v10_supprimer_le_sien();
