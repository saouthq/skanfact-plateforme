-- 0222 — Le seuil de retenue des pièces émises avant la 1.379.6 (issue 15, V-1 ; docs/revue-modules.md § 1.387.88).
--
-- Avant la 1.379.6, une facture (ou un avoir) émise SOUS le seuil de retenue à la source : le serveur a scellé une retenue
-- nulle, mais la pièce du dossier ne gardait pas le seuil qu'il avait appliqué. L'écran recalculait alors une retenue
-- (le seuil de la société n'est écrit nulle part) : son net et son reste dû différaient de la pièce scellée, légale et
-- chaînée — celle que le Cabinet lit. On pose sur la pièce le seuil que le serveur avait appliqué : la règle en vigueur à
-- la date de la pièce, en dinars (la règle compte en millimes). L'écran retombe ainsi sur le chiffre scellé.
--
-- Ne touche jamais :
--   - une pièce dont la retenue scellée est > 0 (le serveur l'a retenue, l'écran la montre déjà) ;
--   - une pièce qui porte déjà un seuil (rejouable : rien ne bouge au second passage) ;
--   - une pièce sans règle à sa date (avant 2023 pour la règle commune) : le serveur y a scellé sa retenue ;
--   - une règle qui ne tombe pas sur un dinar entier (l'émission d'aujourd'hui ne la permettrait pas non plus).
-- La révision monte : un onglet resté ouvert relit la pièce au lieu de renvoyer l'ancienne (déclencheur de la 0059).
-- À VÉRIFIER avec le comptable : ces factures ont pu être imprimées avec une retenue (net réduit) ; si le client a
-- vraiment retenu ce montant, il se passe en retenue subie ; sinon, c'est un reste dû.
update socle.dossier_v10 d
   set contenu = jsonb_set(d.contenu, '{seuilRetenue}', to_jsonb((s.valeur #>> '{}')::bigint / 1000)),
       revision = d.revision + 1, modifie_le = now()
  from ventes.piece v
  cross join lateral socle.regle(v.entreprise, 'retenue.seuil', v.date_piece) s
 where d.entreprise = v.entreprise and d.collection = 'documents' and d.cle = v.ref_v10
   and v.statut = 'emise' and v.type in ('facture', 'avoir')
   and v.taux_retenue > 0 and v.retenue = 0
   and v.net_ht + coalesce(v.fodec, 0) + v.total_tva > 0
   and coalesce(d.contenu ->> 'seuilRetenue', '') = ''
   and (s.valeur #>> '{}') ~ '^[0-9]+$' and (s.valeur #>> '{}')::bigint > 0 and (s.valeur #>> '{}')::bigint % 1000 = 0;
