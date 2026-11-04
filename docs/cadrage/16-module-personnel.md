# 16 — Le module Personnel

*Proposé le 03/11/2026, **validé par Skander le même jour** (« Je suis d'accord avec tout ce que tu m'as dit ») : les huit décisions de l'En bref sont prises
selon la recommandation de Claude, et les lignes « proposé » du § 14 deviennent des décisions. Point de départ (Skander, 03/11/2026 : « je suis d'accord avec ton
cadrage . faut le faire go ») : la Paie devient un module plus complet, **Personnel** ; tout ce qui touche à une personne
employée y passe (contrat, avenant, salaire, paiement, documents, départ), et le **planning de la semaine** est au
lancement. Ce document suit `02-modules.md` (les modules, leurs portes, le sens des dépendances), `03-droits.md`,
`04-hors-ligne-et-synchro.md`, `05-obligations-legales.md`, `07-offres-et-prix.md` et `14-fonctions-et-integrations.md` ;
il s'appuie sur la paie déjà construite (`docs/paie.md`) et sur la maquette `docs/maquettes/paie-v2.html` (deuxième passe
du 03/11/2026, « Aujourd'hui, Le mois, L'équipe », **à compléter**, fait le 04/11/2026, § 2.2 : Skander, 03/11/2026, « on va encore améliorer la
maquette, afin d'être sûr qu'on a rien oublié »). Il a été écrit après cinq recherches (ce que la paie fait, ses liens
avec le reste, le cadrage, la loi tunisienne, les concurrents), puis relu sous quatre angles (rien d'oublié de
l'existant, cohérence avec le cadrage, justesse de la loi, simplicité pour un gérant), corrigé, et vérifié une seconde
fois (chaque constat suivi, une relecture à froid, chaque défaut annoncé confronté au code).*

## En bref (pour Skander)

- **Personnel remplace Paie.** C'est le module de la vie de tes salariés, pas seulement de leurs bulletins. Il se range
  selon cette vie : **le jour** (qui est là, qui travaille quand, les demandes), **le mois** (pointer, bulletins, payer,
  déclarer), **les personnes** (le dossier de chacun, de l'embauche au départ), **l'année** (congés acquis, déclaration
  annuelle, ce que le personnel coûte). À l'écran : trois onglets, **Aujourd'hui, Le mois, L'équipe**, comme la maquette.
- **Ce qui existe déjà est gardé** : la paie tunisienne (bulletins, CNSS, déclarations, cabinet qui vérifie ou tient la
  paie), le pointage, les congés, les avances, les 13 documents, et les douze gestes du menu ⋯. On ne refait pas le
  calcul, on refait l'usage. **Aucune fonction d'aujourd'hui ne disparaît** (§ 2.2).
- **Ce qui s'ajoute au lancement** : le **planning de la semaine** (facultatif), le **dossier complet** du salarié, les
  **échéances à ne pas oublier** (fin d'essai, fin de CDD, visite médicale, titre de séjour…), le **matériel confié**,
  des **listes de tâches** pour l'arrivée et le départ, le salarié **payé à l'heure ou à la journée**, et un droit
  **« Pointer »** pour un chef d'équipe qui ne voit aucun salaire.
- **Ce que je propose pour la vague 1, avec la restauration** : les pourboires, les repas du personnel, les extras, un
  planning tiré des réservations, et l'**espace des salariés** (tu l'as mis au plan le 03/11 sans dire quand). **Plus
  tard** : les notes de frais (vague 3), le pointage par QR code, la signature électronique des documents, la procédure
  disciplinaire. **Pas prévu pour nos cibles** : recrutement, évaluations et retours à 360°, enquêtes, organigramme.
- **La loi a bougé.** La loi 2025-9 fait du CDI la règle (un CDD seulement dans trois cas) et plafonne l'essai ; la loi
  2024-44 change la maternité et la paternité ; le SMIG est fixé pour 2026 à 2028. Plusieurs valeurs par défaut de la
  paie actuelle semblent fausses (la maladie payée, le congé de 18 jours, l'indemnité de licenciement). **Tout reste À
  VÉRIFIER avec un comptable et un juriste** ; aucune règle **du droit du travail** (contrats, congés, maladie, SMIG,
  mentions du bulletin) n'entre dans le calcul avant leur réponse, et d'ici là elle **avertit, elle ne bloque pas**. Les
  **barèmes** (impôt, CNSS, CSS…) suivent une autre règle, urgente : chacun est daté, un bulletin prend le barème de son
  mois, et un barème qu'aucun texte ne fixe pour une année n'est pas appliqué (§ 3.7).
- **On a trouvé des défauts qui faussent l'argent ou font perdre des données** (§ 10.1). Trois exemples. Un salaire
  payé en espèces depuis la caisse compte deux fois. Une journée pointée peut disparaître sans un mot quand deux
  personnes enregistrent en même temps. Et la paie n'a pas de barème daté, alors que la contribution sociale de
  solidarité (CSS) de 0,5 % ne vaut que pour 2026 : le 1er janvier 2027 est dans huit semaines, et si la loi de finances
  2027 ne la reconduit pas, **les bulletins de janvier la retiendraient encore** (À VÉRIFIER). Ils se réparent **en
  premier**.
- **Le prix ne change pas** dans ce document : il se discute avec toi d'abord (§ 9).
- **Personnel est le premier module à sortir des gros fichiers**, dans son propre dossier (règle du 03/11/2026 ; le plan
  viendra dans le `17`, à écrire et à valider avant).

**Ce que tu as décidé le 03/11/2026** (chaque fois selon la recommandation entre parenthèses ; le reste du document suit
ces choix) :

1. **Chiffrer la CIN et le RIB de chaque salarié, que nos serveurs gardent déjà en clair** dans le dossier de
   l'entreprise (seule la fiche de paie du serveur ne les a pas, décision du 29/09/2026 prise par délégation). Lisibles
   par toi, l'administrateur, le rôle Personnel et, pour la CIN seulement, le cabinet qui a le mandat Paie (il en a
   besoin pour la déclaration annuelle) ; chaque lecture tracée. (Oui : on ne peut pas s'en passer, sans eux pas d'ordre
   de virement ni de déclaration annuelle, mais ils ne doivent plus rester en clair.) § 8.
2. **La paie reste en ligne** : bulletins, paiement et déclarations attendent le réseau ; noter la journée, noter une
   demande et donner une avance en espèces depuis la caisse marchent sans réseau. Cela retire la ligne « bulletin en
   brouillon sans réseau » du `04`. (Oui : les montants viennent du serveur.) § 7.
3. **Quand un bulletin ne se modifie plus** : au **paiement ou à la remise**, ou dès que tu le **valides** (ce que dit
   la maquette). (Au paiement ou à la remise ; avant, « validé » veut dire « relu », et la maquette change sa phrase,
   ce qu'elle fait depuis le 04/11/2026. Annuler un paiement, par exemple un virement rejeté, reste possible sans rouvrir le bulletin. Une erreur se corrige
   ensuite sur le bulletin suivant, jamais en réécrivant le bulletin payé : cela remplace le « bulletin rectificatif »
   d'une règle du `01`.) § 8.
4. **Ce qui bloque les bulletins** : ce qui change un montant (une journée pas validée, une absence sans motif) et,
   **après la réponse du comptable ou du juriste**, une règle de droit du § 6 (un salaire sous le SMIG, une mention
   obligatoire qui manque). Un certificat médical en retard ne retient pas la paie de toute l'équipe. (Oui.) § 3.7.
5. **Les bulletins ne partent pas par e-mail** au lancement : SkanFact prépare le PDF, tu le remets ou l'envoies
   toi-même ; plus tard, un lien vers l'espace des salariés, jamais un bulletin joint. (Oui : un salaire nominatif ne
   sort pas par un service d'e-mail sans liste comptée et décidée.) § 3.8.
6. **L'espace des salariés en vague 1.** (Oui, avec la restauration.) § 3.6.
7. **Qui décide d'une demande** (congé, avance) : le gérant, comme l'écrit le `14`, et aussi le rôle Personnel ? (Les
   deux : le rôle Personnel a déjà les congés et les avances dans ses droits.) § 3.6.
8. **Les quatre questions de prix du § 9** : à discuter ensemble ; je donne mon avis sur chacune, sans changer aucun prix.

---

## 1. Ce qu'est le module, pour qui, et ce qui n'y entre pas

**Pour qui.** Le gérant d'un commerce, d'un restaurant, d'un atelier ou d'une société de services de **3 à 40 salariés**
(choisi pour ce document ; le `13` vise plus largement les employeurs affiliés à la CNSS), qui pointe le soir, paie à
la fin du mois et a souvent un cabinet. Et, dans les mêmes données, le **cabinet** qui vérifie ou tient la paie (`02`
§ 8), et le **chef d'équipe** qui pointe son équipe.

**Ce qui y passe.** Une personne employée, toute sa vie dans l'entreprise : son dossier, ses contrats et avenants, ses
horaires et son planning, ses présences, ses congés et absences, ses demandes, son salaire et ses changements, ses primes
et retenues, ses bulletins, leur paiement et leur remise, les déclarations qui la concernent, les documents qu'on lui
fait, le matériel qu'on lui confie, son départ. Un seul module, une seule fiche par personne (proposé : c'est le
contraire d'Odoo, qui coupe la même chose en une douzaine d'applications).

**Ce qui n'y passe pas, et pourquoi.**

| Ce qui | Où ça vit | Comment Personnel s'y relie |
|---|---|---|
| Les comptes en banque, la caisse, la prévision | Trésorerie | Personnel **appelle** la Trésorerie pour écrire le mouvement d'un salaire payé ou d'une avance (`02` § 4.3), **sauf ce qui est payé depuis la caisse** : là, Personnel appelle seulement la sortie de caisse, et c'est la Caisse qui écrit le mouvement. Un paiement n'écrit jamais deux mouvements ; un test le prouve. Personnel **remplit** aussi le point « sorties prévues » que la Trésorerie déclare (§ 4) |
| Les écritures comptables | Le moteur d'écritures du socle | Personnel **passe lui-même** ses écritures en appelant le moteur du socle, dans la même opération que le geste, comme toute pièce (`02` § 4.1, `01` § 14) : le journal PAIE en totaux du mois, sans nom de salarié, **sauf les avances et les saisies sur salaire, écrites une par une au nom du salarié** pour être lettrées au compte 425 (`03` § 2.1). La Comptabilité complète n'est pas nécessaire : un client en Essentiel avec la paie a ses écritures (`02` § 8) |
| La déclaration du mois (TVA et retenues) | Déclarations | Personnel **remplit** le point « salaires du mois » que les Déclarations déclarent ; sans Personnel, les salaires se saisissent en total (`02` M4) |
| Le coût d'une heure, la masse salariale | Pilotage (marges, statistiques), puis Projets (vague 3) | Personnel **remplit** les points « charges du mois » et « coût d'une heure » que le Pilotage déclare ; les Projets, placés dessous, l'appellent directement |
| Les utilisateurs qui se connectent | Le socle (l'équipe) | Un salarié **peut** être relié à un membre (un caissier, un chef d'équipe) ; ce n'est jamais obligatoire (§ 5.3) |

**Le mot.** « Personnel » dans les menus et les textes ; les codes techniques gardent `paie` (`paie.*`, le journal
`PAIE`, les tables `paie.salarie` et `paie.bulletin`, le module `paie` de l'abonnement, l'API `/v1/paie/…`) : renommer un
code est un changement de version qui se prévient (`02` § 4), sans rien apporter à l'utilisateur (proposé). Le rôle
« Paie » devient « Personnel » à l'écran (§ 5).

---

## 2. Les quatre temps, et les écrans

| Temps | L'onglet | Ce qu'on y fait | Qui |
|---|---|---|---|
| **Le jour** | **Aujourd'hui** | Qui est là (la journée, ce qui change), qui travaille cette semaine (le planning), les demandes à répondre, ce qu'il ne faut pas oublier (les échéances) | Le gérant chaque soir, le chef d'équipe pour la sienne |
| **Le mois** | **Le mois** | Quatre étapes cliquables : pointer, bulletins, payer (et remettre), déclarer ; le mois à finir d'abord (octobre avant novembre) | Le gérant, le cabinet |
| **Les personnes** | **L'équipe** | La liste, la fiche de chacun (dossier, contrat, carrière, présences, documents, matériel, bulletins, congés, avances), embaucher, un départ | Le gérant |
| **L'année** | Un bouton **« Toute l'année »** dans Le mois (une seule place) | Le coût du personnel mois par mois, les congés acquis et pris, la fin d'année, la déclaration annuelle d'employeur | Le gérant, le cabinet |

**Les règles d'écran** (celles de la maquette) : un seul bouton vert, l'étape suivante calculée selon le jour ; tout le
monde est là par défaut, on ne note que ce qui change, c'est enregistré tout de suite ; chaque choix dit son effet sur le
bulletin, au millime, **calculé par le moteur** ; un congé accepté arrive tout seul sur ses jours ; les rappels arrivent
**avant** la date, avec « Plus tard » ; à 27 salariés, recherche et équipes repliées ; au téléphone, une ligne par
salarié et de gros boutons.

### 2.1 La première fois

Avant la première paie, le gérant répond à **quatre questions au plus** : qui sont tes salariés (nom, poste, salaire,
contrat) ; quand tu paies (le dernier jour du mois, proposé) ; qui pointe (toi, un chef d'équipe, la pointeuse) ; qui
fait la paie (toi, ton comptable, ou les deux). Embaucher se fait en **trois questions** (qui, son contrat, ce que ça
coûte) ; la CIN, le n° CNSS, le RIB et l'adresse sont rappelés avant la première paie. Tout le reste (convention, échelon,
majorations, fériés, semaine type) garde une valeur **qui ne fait rien** et se règle plus tard dans ⋯ › Les réglages ;
la maladie reste payée comme aujourd'hui tant que le comptable n'a pas répondu (§ 3.5). La convention collective se propose d'après le métier de l'entreprise, et le comptable la
confirme (À VÉRIFIER). C'est la réponse des « 4 questions » du pointage (1.259.0), étendue à tout le module.

### 2.2 Ce que devient ce qui existe aujourd'hui

**Le menu ⋯ garde tous les gestes d'aujourd'hui** (`app.js`, menu de la paie) : *Ce mois* (journal de paie, ordre de
virement, les primes et retenues du mois avec « Coller depuis un tableur ») ; *Les salariés* (registre du personnel, un
document, importer) ; *Calculer* (combien coûte une embauche, augmenter les salaires en lot, une saisie sur salaire
reçue, un départ) ; *Réglages* (les réglages de la paie, qui fait ma paie). « Qui pointe » vit dans les quatre questions
du pointage, et l'historique dans la fiche du salarié : ils gardent leur place.

**Les sous-vues d'aujourd'hui** trouvent une place : « Par salarié » (le mois en calendrier, la source de chaque code, la
semaine heure par heure des badges) va dans la fiche, onglet **Présences** ; « Congés et absences » (le calendrier du
mois, l'année, ce que chaque absence fait au bulletin) va dans le **planning** et dans **« Toute l'année »** ; « Avances
et prêts » (tout ce qui est en cours) devient un **filtre de L'équipe**.

**La maquette se complète avant le lot P2** : le titre devient « Personnel » ; le menu ⋯ porte la liste ci-dessus ; la
phrase sur l'espace des salariés dit qu'il est au plan ; l'année n'a qu'une place ; l'effet en DT d'une absence suit le
moteur (§ 3.4) ; et les pièces nouvelles du lancement (planning, dossier complet, échéances, matériel, listes de tâches,
droit « Pointer », salarié à l'heure) **se dessinent d'abord** (règle des écrans, `CLAUDE.md`), dans la suite de
`paie-v2.html`.

*Fait le 04/11/2026 (avant le lot P2, maquette republiée)* : le titre « Personnel » (barre, chemin, page) ; le menu ⋯ en
quatre groupes, avec la phrase qui dit où sont l'historique, l'année et « qui pointe » ; l'espace des salariés au plan
(vague 1, avec la restauration) ; « Toute l'année » dans Le mois (le coût mois par mois, les congés qui restent, la fin
d'année, À VÉRIFIER) ; un jour vaut le brut ÷ 26 et une heure le brut ÷ 208, comme le moteur (l'exemple d'Ahmed passe
de − 69,065 à − 55,784 DT). Deux décisions de l'En bref y sont aussi : un bulletin **validé se corrige encore jusqu'au
paiement**, payé il ne se modifie plus (décision 3) ; **rien ne part par e-mail** au lancement, chacun a son bulletin
en PDF que le gérant remet (décision 5 : « Les envoyer par e-mail » devient « Les PDF à remettre », et l'attestation
n'a plus de bouton d'envoi). Les pièces nouvelles se dessinent **avant leur propre lot**, pas avant P2, qui ne les
touche pas : le droit « Pointer » avant P3, le planning avant P4, le dossier complet, les échéances, le matériel, les
listes de tâches et le salarié à l'heure avant P5 (§ 10.2).

*Complétée encore le même jour, avec le cabinet* (Skander : « améliore et rajoute ce qu'il manque, vérifie aussi avec
cabinet ») :
- **Les trois façons de faire la paie** de l'application (« Qui fait ta paie ? », 1.226.0) changent les quatre étapes du
  mois : faite seul ; faite par le gérant et **vérifiée** par le comptable, qui propose une correction (ici, la majoration
  des heures sup de Karim, À VÉRIFIER) que le gérant accepte ou refuse ; **tenue** par le comptable : valider le pointage
  le lui envoie, il établit les bulletins et les envoie pour accord, le gérant donne son **bon à payer**, le comptable
  valide, le gérant paie, le comptable dépose. La déclaration de novembre ne se dit « déposée » qu'à partir du 01/12.
- **Le même mois, vu du Cabinet** (le parcours de 1.235.0, ses cinq vues, son seul bouton principal) : ce que l'un fait,
  l'autre le voit, et « déposée » est une seule mention pour les deux (§ 3.9). Le cabinet voit le pointage **validé**,
  jamais une journée en cours, n'écrit rien sans l'accord du client et n'a pas le geste « payer » (§ 5.2).
- **Le chef d'équipe** (droit « Pointer », P3) est dessiné : sa journée, sans aucun montant ; une journée qu'il valide
  compte ; ce qu'il note arrive dans les demandes du gérant.
- **Corrigé** : un certificat médical en retard ne retient plus les bulletins (décision 4 : il va dans « À ne pas
  oublier ») ; plusieurs journées oubliées font une ligne, validées d'un geste (§ 3.4) ; la demi-journée d'absence ;
  l'effet d'un jour disait encore « un jour sur 21 ».
- **Ajouté** : dans la fiche, les présences (d'où vient chaque case), les congés et avances, l'historique (le menu ⋯ le
  promettait) ; les filtres de L'équipe (« Avances et prêts » devient un filtre, avec « Partis ») ; le salaire revenu sur
  le compte (« Repayer ») ; les quatre questions de la première fois (§ 2.1) ; dans « Toute l'année », les absences et ce
  qu'elles ont fait aux bulletins, et le coût face aux ventes (§ 3.14).

---

## 3. Ce qu'il fait

*Pour chaque fonction : ce qui existe déjà (avec sa référence), ce qui change, et quand. « Lancement » veut dire avant
l'ouverture publique ; « Vague 1 » arrive avec la restauration (`14` § 3.1). **Deux règles valent pour tout ce §** :*
*1. chaque seuil ou délai de droit cité ici (10 h, 60 h, repos de 10 h, 48 heures pour un certificat, 3 jours pour un
accident, 15 jours de prévenance, 60 ans, un dixième, 20 et 40 salariés…) est une **règle datée avec sa source**, jamais
une constante du code ; les tests utilisent des codes `essai.*` ; une règle absente n'avertit ni ne bloque ;*
*2. une règle de droit entre **après la réponse du comptable ou du juriste** (lot P7) ; si la réponse n'est pas là à
l'ouverture, elle reste un rappel ou un avertissement, elle ne bloque rien.*

### 3.1 Le dossier du salarié

| Fonction | Aujourd'hui | Ce qui change | Quand |
|---|---|---|---|
| Identité, famille, contrat, salaire, paiement, contact, équipe, badge | Fait (`employeeForm`, `docs/paie.md` 1.225.0, 1.256.0) | Ajouter, **facultatifs et demandés seulement quand ils servent** : la **nationalité** (tunisienne par défaut), et pour un étranger le **visa du contrat** et la **carte de séjour** avec leurs fins (Code art. 258-2, 259 : À VÉRIFIER) ; l'**établissement** ; au contrat, le **régime horaire** (48 h, 40 h ou autre ; pour un temps partiel, sa part de la durée normale, à partir du champ « Heures par semaine » qui existe déjà mais qu'aucun calcul ne lit : Code art. 79, 94-2 à 94-13, À VÉRIFIER), le **mode de paie** (au mois, à l'heure, à la journée), la **convention collective** et la **catégorie ou l'échelon** | Lancement |
| Embaucher | Fait (fiche complète, simulation « combien coûte une embauche ») | **En trois questions** (qui, son contrat, ce que ça coûte) ; la simulation devient la 3e ; le reste est rappelé avant la première paie | Lancement |
| Contrôles à la saisie (CNSS, RIB, doublons, net estimé, brut à partir du net) | Fait | — | — |
| Pièces du salarié (CIN, contrat signé, diplômes, certificats) | Fait en partie (onglet Documents, 1.249.0) | Un **dossier rangé par sorte de pièce**, avec ce qui manque ; durée de conservation : § 8 ; le diagnostic médical n'est **jamais** saisi (loi 2004-63 art. 62 à 64) | Lancement |
| Historique de carrière (postes, salaires datés, avenants, renouvellements) | Fait, déduit des faits (`histo`) | Le montrer comme une **carrière** lisible dans la fiche | Lancement |
| Champs personnalisés | Prévu (`02` § 5) | — | Lancement |

### 3.2 Les contrats et le cycle de vie

| Fonction | Aujourd'hui | Ce qui change | Quand |
|---|---|---|---|
| CDI, CDD, saisonnier, CIVP, SIVP, Karama, stage | Fait (`CONTRACT_TYPES`) | **Loi 2025-9** (Rapporté, À VÉRIFIER) : un CDD exige son **motif**, choisi parmi trois (surcroît extraordinaire de travail ; remplacement d'un salarié permanent dont le contrat est suspendu, avec son nom ; travail saisonnier ou par usage) ; sans motif, l'écran dit « ce contrat serait un CDI » et propose « En faire un CDI ». Le renouvellement ne propose plus « un an » d'avance. Le lendemain d'un CDD fini, si le travail continue, alerte « ce contrat est devenu un CDI » (Code art. 17). Rappel : le congé d'un CDD finit au moins une semaine avant son terme (Code art. 132). Ajouter l'**apprenti** (son contrat, ses cotisations : À VÉRIFIER) | Lancement, après réponse (P7) |
| **Payé à l'heure ou à la journée** | Rien : tout part d'un salaire du mois (`compta.js`, salaire horaire = brut ÷ heures du mois) | Le salaire se dit « par mois », « par heure » ou « par jour ». À l'heure ou à la journée, le pointage donne les heures ou les jours, et le bulletin les multiplie ; payé au moins chaque semaine (§ 3.8). Le SMIG à l'heure et les règles : À VÉRIFIER. Les extras de la restauration (§ 3.15) s'en servent | Lancement |
| Période d'essai | Fait (fin d'essai dans « À traiter », confirmer ou y mettre fin) | Essai **6 mois au plus, renouvelable une fois**, **15 jours de prévenance**, **pas d'essai dans un CDD** (loi 2025-9, Rapporté, À VÉRIFIER) ; le rappel arrive avant la prévenance | Lancement, après réponse (P7) |
| Contrats aidés (CIVP, Karama…) | Régime vide par défaut (`regimeDuContrat`) | Dates, organisme, n° de convention, **compteurs de durée** (CIVP : 12 mois par entreprise, 24 en tout, décision de l'ANETI du 01/10/2025, Rapporté, À VÉRIFIER) | Lancement, après réponse (P7) |
| **Les salariés mineurs** | Rien (la date de naissance existe) | La date de naissance déclenche les règles : embauche refusée sous 16 ans (sauf formation dès 14 ans) ; sous 18 ans, examen médical d'aptitude avant l'embauche, aucune heure sup proposée, avertissement sur un poste de nuit, inscription au registre des moins de 18 ans (Code art. 53, 53-2, 59, 61, 63-2, 65 à 67, lu dans l'édition 2010, À VÉRIFIER) | Lancement, après réponse (P7) |
| Changer le salaire, augmentation en lot, rappel | Fait (1.256.0) | La hausse légale se propose d'elle-même **seulement pour une année dont le texte est posé en règle datée** : le SMIG de 2026, 2027 et 2028 (décret n° 67 du 30/04/2026), le +5 % des conventions sectorielles (décret n° 68), les montants par catégorie d'un secteur sans convention (Rapporté, À VÉRIFIER). Pour 2029, ou pour une convention sans règle, rien n'est proposé. Un décret publié en avril avec effet au 1er janvier donne un rappel sur un bulletin suivant ; un bulletin payé n'est jamais réécrit | Lancement, après réponse (P7) |
| Avenant, renouvellement de CDD | Fait (projet de document) | — | — |
| Départ (motif, préavis, ancienneté, solde de tout compte, certificat) | Fait (1.241.0, 1.256.0) | Préavis d'**un mois** pour un CDI, par lettre recommandée (Code art. 14 bis). **L'indemnité de licenciement** : un jour de salaire par mois de service effectif, au plus 3 mois de salaire (Code art. 22). Elle n'est due que pour un CDI, après l'essai, et pas en cas de faute grave. Elle se calcule sur le salaire au moment du licenciement, avantages compris, sans les remboursements de frais ; la convention cadre (art. 18) demande au moins la moyenne des 12 derniers mois. L'indemnité des congés non pris est due sauf faute lourde (Code art. 120). Un licenciement économique passe d'abord par l'inspection, sinon il est abusif (Code art. 21 à 21-13). Une démission demande sa lettre ; une salariée enceinte peut partir sans préavis ni indemnité (Code art. 18, convention cadre art. 20). La lettre de licenciement exige sa cause. Un licenciement pendant une maladie déclenche un **avertissement** avant le geste (le Code ne le permet que pour une maladie grave ou prolongée qui oblige à remplacer le salarié, art. 20) ; pendant la grossesse, la maternité ou la paternité, l'avertissement dit que la loi 2024-44 interdit sanction et licenciement (Rapporté). Bloquer ou avertir : question au juriste (§ 11). **Tout À VÉRIFIER** ; Code lu dans l'édition 2010 (§ 6) | Lancement, après réponse (P7) |
| **Listes de tâches de l'arrivée et du départ** | Arrivée en partie (« Son arrivée », 62 jours) | Une liste par personne, chaque tâche reliée au geste qui la fait : à l'arrivée, déclaration CNSS, contrat signé, accès à la caisse, tenue remise, visite d'embauche ; au départ, **accès retirés** (caisse, application), matériel repris, solde, certificat | Lancement |

### 3.3 Le planning de la semaine (nouveau)

| Fonction | Ce qu'il fait | Quand |
|---|---|---|
| **Facultatif** | Sans planning, les horaires de l'équipe font foi, comme aujourd'hui : un atelier aux horaires fixes ne le remplit jamais | Lancement |
| Qui travaille quand | Une semaine par équipe, un créneau par personne (matin, soir, coupure), à partir des horaires d'équipe déjà réglés (1.257.0) ; une semaine type qu'on recopie | Lancement |
| Le prévu face au réel | Quand il existe, le planning devient « ce qui est attendu » du pointage : un salarié qui n'est pas prévu n'est pas absent. Les écarts (venu sans être prévu, prévu et pas venu) **se voient dans la journée** et se règlent par le pointage ; ils n'entrent dans « À régler » que s'ils changent un bulletin (proposé) | Lancement |
| Le minimum par équipe | Déjà vérifié avant d'accepter un congé (1.257.0) ; le planning le vérifie aussi, et propose qui peut remplacer | Lancement |
| Les congés et les absences | Ils s'affichent d'eux-mêmes dans le planning (chez Odoo, il faut un module de plus) | Lancement |
| Deux établissements (deux boutiques, un café et son labo) | Chaque salarié a son établissement (le `01` le prévoit) ; « Aujourd'hui », le planning et le droit « Pointer » se filtrent par établissement ; un salarié qui travaille dans les deux garde un établissement principal. Un numéro d'employeur CNSS par établissement : À VÉRIFIER | Lancement |
| Le publier à l'équipe | Au lancement : **l'imprimer** et **le partager en image** (le gérant l'envoie lui-même, par exemple sur WhatsApp) ; plus tard, dans l'espace des salariés. Aucun envoi automatique vers un tiers sans liste comptée et décidée (`CLAUDE.md`, sécurité). Changer les heures d'une équipe dans le planning, est-ce modifier l'horaire, qui demande un envoi à l'inspection (Code art. 85) ? À VÉRIFIER ; d'ici là, le planning avertit quand une semaine sort de l'horaire déclaré | Lancement, puis avec l'espace des salariés |
| Tiré des réservations | Le nombre de couverts prévus propose le nombre de personnes au service : Personnel déclare le point « couverts prévus par service », que les Réservations remplissent ; sans elles, le point reste vide et le planning le dit | Vague 1 (proposé, avec Réservations) |
| Le contrôle de la loi | Plus de 10 h par jour, plus de 60 h par semaine, repos de 10 h, repos hebdomadaire (Code art. 79, 83, 89, 93, 95, lu dans l'édition 2010, À VÉRIFIER) : des **avertissements**, jamais des blocages | Lancement |

### 3.4 Les présences (le pointage)

Fait en 1.257.0 à 1.259.0 (la journée, le mois en relecture, « À régler », une seule validation, la pointeuse, les
anomalies, les équipes, les fériés, la nuit, les retards). Ce qui change :

- **L'écran de la maquette** : quatre choix (là, absent, congé, malade) ; le retard et les heures sup **s'ajoutent** à
  « là » ; la **demi-journée** (la moitié non payée, qui existe aujourd'hui) reste, en précision d'« Absent » (« toute la
  journée » ou « une demi-journée ») ; Férié et Repos restent dans la case de la grille ; l'effet en DT sur la ligne, la
  semaine pour revenir sur un jour, le clavier, la recherche à 27 (Lancement).
- **Une absence dit son motif** : sans solde (un jour retenu) ; justifiée et payée (**nouveau** : aujourd'hui « Absent »
  veut toujours dire « non payé » ; quelles absences sont payées : À VÉRIFIER avec le comptable et la convention) ; ou
  « je ne sais pas encore », qui la met dans « À régler » (Lancement).
- **L'effet en DT est celui du moteur.** Aujourd'hui, un jour vaut brut ÷ jours du mois complet (26 par défaut,
  `compta.js`) ; la maquette montrait brut ÷ 21 : elle suit le moteur depuis le 04/11/2026. Il existe aussi **deux règles** pour les jours de travail
  (les congés comptent ceux de l'entreprise, le pointage ceux de l'équipe) : une seule fonction, « les jours de travail
  de ce salarié », servira aux deux (§ 10.1). Le bon diviseur : À VÉRIFIER (Lancement).
- **Les journées oubliées font une seule ligne** dans « À régler » (« 12 journées pas validées »), et « Les relire et les
  valider » les valide d'un geste après les avoir montrées, comme en 1.259.0 (Lancement).
- **Les majorations des heures sup** (Code art. 90, lu dans l'édition 2010 : en régime de 48 h, +75 % ; en régime de
  moins de 48 h, +25 % jusqu'à la 48e heure puis +50 % au-delà ; à temps partiel, +50 % ; base : le salaire horaire de
  base) deviennent des règles **datées avec leur source**, qu'une convention plus favorable remplace. À temps partiel, une
  heure sup demande l'accord du salarié et ne dépasse pas le tiers de la durée du contrat (art. 94-2 à 94-13). **À
  VÉRIFIER** avec le comptable avant de les poser par défaut (Lancement, après réponse).
- **Les jours fériés par convention**, chacun payé ou non, et la majoration d'un férié travaillé : À VÉRIFIER. Le
  réglage existe au lancement, vide par défaut (rien n'est majoré) ; les valeurs par convention entrent après la réponse
  du comptable (Lancement, après réponse, P7).
- **Le pointage par QR code** qui change toutes les 2 minutes (Skander, 02/11/2026, `14` § 3.6) : plus tard, vague à
  fixer. **Proposition** : ni la position du téléphone ni le visage (données sensibles, INPDP : À VÉRIFIER).

### 3.5 Les congés et les absences

| Fonction | Aujourd'hui | Ce qui change | Quand |
|---|---|---|---|
| Natures, calendrier, soldes, demandes, solde trop court | Fait (1.226.0, 1.256.0) | **Le droit au congé** (Code art. 112 à 116, lu dans l'édition 2010, À VÉRIFIER) : 1 jour par mois de travail effectif, au plus 15 jours dont 12 ouvrables ; moins de 18 ans au 31/12, 2 jours par mois, au plus 24 ouvrables ; de 18 à 20 ans, 1,5 jour par mois, au plus 18 ouvrables. Un mois de travail effectif vaut 26 jours ouvrables ; les congés payés, la maternité et l'accident du travail (jusqu'à un an) comptent comme travail. L'ancienneté ajoute 1 jour ouvrable par tranche de 5 ans chez le même employeur, au plus 18 jours ouvrables. **Les 18 jours ouvrables de la paie actuelle seraient ce plafond, pas le droit d'un nouveau salarié** : question au comptable. Un jour férié ne se décompte pas d'un congé, une maladie l'interrompt (art. 118) | Lancement, après réponse (P7) |
| Maladie | Payée par défaut | Le Code dit que la maladie **suspend** le contrat (art. 20) ; la CNSS paie à partir du 6e jour (Rapporté, § 6). Proposition : **non payée par défaut**, avec un réglage « maintien de salaire » par convention (la valeur par défaut est celle qui ne fait rien). Certificat sous 48 heures : un rappel, qui ne bloque pas les bulletins (§ 3.7). **À VÉRIFIER** | Lancement, après réponse (P7) |
| Maternité, paternité | Une nature « maternité » | **Loi 2024-44** (Rapporté, À VÉRIFIER) : maternité de 15 jours avant la naissance puis 3 mois ; 4 mois pour une naissance multiple, un enfant prématuré, handicapé ou atteint de malformation ; 1 mois pour un enfant mort-né. Paternité de 7 jours, 10 dans les cas particuliers. La protection (ni sanction ni licenciement) s'affiche sur la fiche. Rappel de la demande à la CNSS dans le mois qui suit la naissance. Repos d'allaitement : durée incertaine (un an selon le Code, neuf mois selon une partie de la presse). Qui complète le salaire : À VÉRIFIER | Lancement, après réponse (P7) |
| Congés de famille (naissance, mariage, décès…) | Une nature « autorisation » | Les durées de la convention cadre (art. 31 ; la convention du secteur peut en donner d'autres : À VÉRIFIER) en natures payées, avec le justificatif | Lancement, après réponse (P7) |
| Report des congés | Lu, jamais écrit (`leaveCarry`) | Le report s'écrit à la fin de l'année. Les limites du Code (le congé se prend dans l'année qui suit, ou dans les 6 mois pour un congé court, art. 124 ; aucun geste « racheter les congés » pendant le contrat, art. 131 ; tout À VÉRIFIER) entrent après la réponse du juriste ; d'ici là, le report s'écrit sans limite, et un dépassement avertit | Lancement (lot P5, après la sortie des gros fichiers) ; les limites après réponse (P7) |
| Ordre des départs en congé | Rien | Document à afficher 15 jours avant (Code art. 117, À VÉRIFIER), rappel | Lancement |

### 3.6 Les demandes

- **Au lancement** : quand le gérant décide sur-le-champ, il fait directement le geste (« Une absence prévue », « Une
  avance ») ; « **Noter une demande** » sert quand il veut réfléchir, ou quand c'est un chef d'équipe qui la reçoit. La
  demande attend la réponse dans « Les demandes », avec qui l'a notée. **Qui décide** : le gérant (écrit au `14` § 3.6
  le 03/11/2026 ; le journal ne le porte pas comme une décision de Skander : **à confirmer**, décision 7 de l'En bref).
  Proposition : le rôle Personnel décide aussi, puisque le `03` § 2.1 lui donne déjà les congés et les avances.
- **Plus tard : l'espace des salariés** (au plan, Skander, 03/11/2026 ; la vague reste à fixer ; **proposition : la
  vague 1**, avec la restauration). Depuis son téléphone, le salarié demande un congé, une avance ou une attestation,
  voit son planning, ses bulletins, ses jours de congé qui restent. Proposition : commencer par un **lien personnel sans
  compte**, puis de vrais comptes. Avis de Claude sur la protection : le lien montre le planning et les congés qui
  restent ; un bulletin demande en plus un code reçu par SMS ou par e-mail, comme un appareil inconnu (`03` § 6). À
  décider ; INPDP : À VÉRIFIER.

### 3.7 La paie du mois

Fait (1.222.0 à 1.259.0) : bulletins calculés au millime, contrôles du mois, primes et retenues du mois (collées d'un
tableur), régularisations, avances retenues, saisies, trois modes avec le cabinet (seul, vérifiée, tenue : bon à payer,
correction proposée et acceptée). Ce qui change :

- **Les bulletins dès le 25** : les jours qui restent sont comptés présents, **le bulletin le dit** (« comptés présents
  jusqu'au 30 »), ce qui change se régularise sur le mois suivant (Skander, 03/11/2026). **Proposé** : sauf pour un
  salarié qui part dans le mois (un CDD qui finit le 30, une démission le 28) ; son bulletin attend son dernier jour, il
  n'est jamais compté présent après sa sortie, et ce qui change va dans son solde de tout compte (Lancement).
- **Ce qui bloque les bulletins** : ce qui change un montant (une journée pas validée, une absence sans motif, une
  sortie que la pointeuse n'a pas reçue) et, après la réponse du comptable ou du juriste, une règle de droit du § 6 (le
  SMIG, une mention obligatoire). Un certificat médical en retard **avertit** sans bloquer : il reste dans « À ne pas
  oublier » du salarié, et le bulletin part (proposé, décision 4 de l'En bref) (Lancement).
- **Les barèmes datés** : aujourd'hui, un barème par entreprise, que chaque bulletin fige, sans date (`docs/paie.md`).
  Chaque barème (impôt sur le revenu, CNSS, CSS, TFP, FOPROLOS, accident du travail) devient une **règle datée**, avec sa
  source et, s'il en a une, sa date de fin ; le serveur refuse un bulletin dont le barème n'est pas celui de son mois,
  avec le geste qui débloque (« Recalculer avec les taux du mois ») (§ 10.1, urgent).
- **La CSS** : 0,5 % **pour 2026 seulement**, exonérée jusqu'à 5 000 DT de revenu net imposable (loi de finances 2026
  art. 87 ; Rapporté, À VÉRIFIER). Le moteur l'applique aujourd'hui à tous : question au comptable. Pour 2027, si aucune
  règle n'est posée, le moteur n'en retient aucune et le bulletin le dit ; avant le premier bulletin de janvier, le
  contrôle du mois affiche « Barèmes de 2027 pas encore relus » tant que la loi de finances 2027 n'a pas été lue (`05`).
- **Les mentions obligatoires** du bulletin (Code art. 143 : n° CNSS de l'employeur et du salarié, heures ou jours,
  heures majorées à part, date de paiement…) : un contrôle « mention manquante » avant d'établir, avec le champ à remplir
  (Lancement, après réponse).
- **Le SMIG**, contrôlé contre celui **du régime du contrat** (48 h ou 40 h ; au prorata pour un temps partiel), sur la
  seule part payée en espèces (les avantages en nature ne comptent pas, Code art. 139), et contre la grille de la
  convention quand elle est réglée (décret n° 67 du 30/04/2026 ; Rapporté, À VÉRIFIER). **Avant la réponse du comptable :
  un avertissement** lu avant d'établir. **Après : bloquant**, avec le geste qui débloque. Sans régime saisi, il ne bloque
  pas : il demande le régime. Un stage, un apprenti et un contrat aidé (CIVP, SIVP, Karama) ne sont contrôlés contre le
  SMIG que si leur règle le dit : tant qu'elle n'est pas posée, datée et sourcée, ils ne déclenchent ni avertissement ni
  blocage (À VÉRIFIER avec l'ANETI et le comptable) (Lancement).
- **Le pointage validé nourrit le bulletin** : aujourd'hui le bulletin relit le pointage vivant, pas la version validée
  (Lancement).

### 3.8 Payer et remettre

Fait (1.74.0, 1.247.0) : ordre de virement, RIB contrôlé, espèces contre reçu, virement revenu lu sur le relevé, annuler
un paiement. Ce qui change :

- **Le jour de paie se règle selon le mode de paie du salarié** : un mensuel est payé au moins une fois par mois (« le
  dernier jour du mois », « le N du mois suivant ») ; un salarié payé à l'heure ou à la journée, au moins une fois par
  semaine (Code art. 140, À VÉRIFIER). Jamais un jour de repos ; la veille si le jour n'est pas ouvrable (art. 142, À
  VÉRIFIER). La trésorerie prévoit les salaires à ces jours-là (Lancement).
- **Trois façons de payer** : par virement, par chèque (son numéro sur le reçu), en espèces contre un reçu signé (le
  chèque est nouveau pour un salaire). Aujourd'hui, un salarié payé par virement sans RIB est déjà signalé (« RIB à
  demander », « RIB à renseigner ») et reste hors de l'ordre de virement. Un plafond légal des paiements en espèces : À
  VÉRIFIER (Lancement).
- **Payer depuis la caisse** passe par une sortie de caisse que le rapport de fin de journée de la caisse (le « Z »)
  connaît. Cette sortie **n'existe pas encore** dans la Caisse : elle est à créer (défaut critique, § 10.1) (Lancement).
- **L'avance du soir** : à 23 h, le caissier donne 50 DT du tiroir à un serveur. Depuis la caisse, il fait la sortie
  « Avance à un salarié » (le nom et le montant, jamais le salaire), même sans réseau (§ 7) ; elle arrive dans « Les
  demandes » du gérant comme « avance déjà donnée, à retenir sur la paie de … » (Lancement).
- **La retenue d'une avance** : la fenêtre propose d'elle-même le nombre de mois qui reste sous **un dixième du salaire
  dû** par mois (Code art. 150 ; « 350 DT : retenue en 5 mois, environ 70 DT par mois »). Tant que le juriste n'a pas
  répondu, le gérant peut aller plus vite, avec un avertissement qu'il lit avant le geste ; ensuite, la règle suit sa
  réponse (une retenue plus rapide demandée par écrit par le salarié est-elle permise ? sinon le geste bloque, avec le
  bouton « Étaler la retenue », § 11). Le dixième, et le salaire sur lequel il se compte (brut ou net, avec les primes
  fixes) : À VÉRIFIER. Aujourd'hui la paie avertit à 30 % du net, calculé sans les
  primes fixes (Lancement, après réponse).
- **Remettre** : aujourd'hui SkanFact prépare le PDF et le gérant le remet ou l'envoie lui-même. La maquette promettait
  « Les envoyer par e-mail » (retiré le 04/11/2026) : proposition (décision 5 de l'En bref), au lancement on garde « préparer le PDF » ; avec
  l'espace des salariés, l'e-mail ne porte qu'un lien, jamais le bulletin joint ; la liste de ce qui part est comptée et
  décidée. Un accusé du salarié (signature, reçu) ; la valeur d'un **livre de paie électronique** et de la signature du
  salarié (Code art. 144) : À VÉRIFIER (Lancement).

### 3.9 Les déclarations

Fait : déclaration du mois (part paie), CNSS du trimestre (fichier DS, état récapitulatif), déclaration annuelle
d'employeur, « déposée et payée ». SkanFact prépare, l'entreprise ou le cabinet dépose. Ce qui change :

- **Les échéances par forme juridique et par mode de dépôt** : le 15 pour une personne physique, le 20 pour une personne
  morale qui télédéclare, le 28 pour une personne morale qui ne télédéclare pas, reportées au jour ouvrable suivant
  (calendrier de la direction des impôts 2026, Rapporté, À VÉRIFIER ; le `05` § 3.4 pose la question, ceci est une
  réponse à vérifier) (Lancement).
- **Une seule vérité « déposée »** partagée avec le cabinet (aujourd'hui le classeur du cabinet et le dossier du client
  disent deux choses) (Lancement).
- **Commencer en cours d'année** : un client qui arrive en novembre saisit, pour chaque salarié, ce que l'année a déjà
  payé (brut, imposable, impôt retenu, CNSS), à la main ou depuis un tableur. Sans cela, la déclaration annuelle et le
  certificat de retenue ne couvrent que novembre et décembre. Le calcul de l'impôt avec ces montants : À VÉRIFIER
  (Lancement).
- **Le dépôt** : e-jibaya ne recevrait que de la saisie (Rapporté, À VÉRIFIER, `05` § 3.4), et un dépôt automatique à
  la CNSS est À VÉRIFIER (`05` § 3.6) ; on déposera directement le jour où l'administration l'ouvre (vision § 1).

### 3.10 Les documents, les registres, l'inspection

- Fait : 13 documents en aperçu A4 ; les **8 documents du personnel** (contrat, avenant, attestation de travail,
  certificat de travail, attestation de salaire, attestation annuelle, fin d'essai, solde de tout compte) sont numérotés
  AAAA-NNN ; le bulletin, le journal, l'ordre de virement, le reçu et l'état CNSS ne le sont pas ; le registre du
  personnel, le journal de paie.
- Ce qui change (Lancement) : le **numéro naît au serveur** (aujourd'hui dans le poste, deux postes peuvent sortir le
  même) ; **lettre d'embauche**, **lettre de confirmation** après l'essai, **lettre de préavis** ; **registre des
  congés**, **registre des moins de 18 ans**, **registre du temps partiel** quand l'effectif en compte ; **horaire et
  équipes à afficher**, datés et signés, avec la date d'envoi du double à l'inspection avant toute modification (Code
  art. 85 et 86) ; **tableau des dérogations**, affiché jusqu'au 15 janvier suivant (art. 87) ; **déclaration du jour de
  repos** à l'inspection (art. 95 et 96) ; **avis de la convention** ; un geste **« Préparer une visite de
  l'inspection »** qui réunit le livre de paie, les registres et les affichages (Code art. 174). Tous ces articles : lus
  dans l'édition 2010, À VÉRIFIER. Un registre du personnel **obligatoire** n'est trouvé dans aucun article lu : À
  VÉRIFIER.
- La phrase du solde de tout compte ne promet pas d'effet libératoire (Code art. 145, À VÉRIFIER).
- **Plus tard** : la signature électronique des documents (DigiGo existe pour les factures ; sa valeur pour un contrat de
  travail est À VÉRIFIER).

### 3.11 Les échéances à ne pas oublier (nouveau)

Une seule liste « À ne pas oublier », par personne et pour l'entreprise, chaque ligne avec son geste et un « Plus tard »,
faite par **une seule fonction** qui donne aussi son compteur. Elle reprend tout ce que « À traiter » signale
aujourd'hui (`paieATraiter`) : **RIB ou n° CNSS à demander**, **même RIB ou même n° CNSS** qu'un autre salarié, fin
d'essai (avec la prévenance), fin de CDD dans les 60 jours, demande de congé, certificat d'arrêt manquant, **retenue
de saisie à verser** au créancier ; les **déclarations dues ou en retard** (mois, trimestre CNSS, déclaration annuelle),
y compris celles des mois d'avant. Elle y ajoute : la requalification d'un CDD (« ce contrat est devenu un CDI »,
§ 3.2) ; compteurs des contrats aidés ; **visite médicale** à l'embauche et
périodique, et l'examen d'aptitude d'un mineur (groupement de médecine du travail ; Code art. 61 : À VÉRIFIER) ; **titre
de séjour et visa** d'un étranger ; **permis** d'un chauffeur ; déclaration d'un **accident du travail** dans les 3
jours, même si le salarié continue de travailler (loi 94-28 ; organisme et formulaire À VÉRIFIER), par un geste
« Déclarer un accident du travail » qui ne garde que la date et la nature ; départ à la retraite (l'âge selon le régime,
60 ans au régime général : Rapporté, À VÉRIFIER) ; **seuils d'effectif**, où les temps partiels comptent comme des temps
pleins (art. 94-8) : délégué du personnel de 20 à 39 permanents, avec ses heures de délégation payées ; commission
paritaire dès 20 selon la convention cadre (art. 39) ; commission consultative dès 40 (Code art. 157, 163 ; tout À
VÉRIFIER). Lancement.

### 3.12 Le matériel confié (nouveau)

Ce qu'on remet à un salarié (clés, tenues, téléphone, tablette de caisse, véhicule), quand, et s'il est rendu ; au départ,
la liste de ce qui reste à reprendre. **Aucune retenue n'est proposée** pour du matériel non rendu : le Code interdit la
compensation sur le salaire, sauf pour les outils et les matières (art. 149 à 151, lu dans l'édition 2010) ; une tenue,
un téléphone ou une clé en font-ils partie, et combien retenir ? À VÉRIFIER avec le juriste. Lancement.

### 3.13 Avances, prêts, saisies sur salaire

Fait (1.71.0, 1.230.0, 1.256.0). Ce qui change : la retenue d'une avance (§ 3.8) ; la quotité saisissable (Code de
procédure civile et commerciale, art. 354 : À VÉRIFIER) entre après la réponse du juriste (P7), et d'ici là la retenue
reste celle que le gérant saisit, comme aujourd'hui ; les versements de saisie passent dans les livres du serveur
(défaut critique, § 10.1). Lancement ; la quotité après réponse (P7).

### 3.14 L'année

Fait (1.254.0) : coût par mois, par équipe ou par poste, « la fin de l'année ». Ce qui change : la **masse salariale
face aux ventes**, du mois, par établissement et, pour un restaurant, du service (la caisse est dans la même base : aucun
branchement à acheter, au contraire de Combo ou Skello) ; la date de la déclaration annuelle d'employeur, à trancher avec
le comptable (§ 11) : le calendrier des échéances dit le 30/04, la carte « La fin de l'année » dit février, et la source ne cite le 30/04
que pour les employeurs au forfait (Rapporté, À VÉRIFIER). Lancement.

### 3.15 La restauration (vague 1, proposé, avec la reprise de Slate)

Rien de ceci n'est écrit au cadrage aujourd'hui (`15`) ; à poser maintenant pour la vague 1 :
- **Les pourboires** : la collecte sur le ticket ou la carte, la cagnotte, la répartition ; leur traitement social et
  fiscal : À VÉRIFIER. Personnel écoute les événements de la Caisse (`ticket.encaisse`, `session_caisse.fermee`), qu'il
  a le droit d'écouter puisque la Caisse est placée au-dessus de lui (`02` § 4.1).
- **Les repas du personnel** : la sortie de stock au coût (Personnel appelle `sortir` du Stock) ; un avantage en nature
  sur le bulletin : À VÉRIFIER.
- **Les extras et journaliers**, souvent payés le soir en espèces, **sont, d'après la recherche, des salariés** :
  déclarés à la CNSS dès le premier jour, sans qu'on puisse y renoncer (loi 60-30, Rapporté) ; un bulletin avec les
  mentions de l'art. 143 ; payés au moins chaque semaine (art. 140). **Tout À VÉRIFIER** (Code lu dans l'édition de
  2010). Leur fiche est courte et ils
  sont payés par une sortie de caisse, mais avec leur n° CNSS, leur contrat (un CDD pour surcroît d'activité ou
  saisonnier, avec son motif) et leur bulletin ; ils utilisent le salaire « par jour » du § 3.2. À VÉRIFIER : la forme du
  contrat d'un jour, et le cas d'un extra fourni par une autre société (la loi 2025-9 interdit la sous-traitance de
  main-d'œuvre).
- **Le serveur de la caisse relié au salarié** (§ 5.3) : la caisse par serveur ; le pointage depuis la caisse passe par
  un **emplacement d'écran** que la Caisse réserve et où Personnel pose son geste « pointer » ; la Caisse n'appelle jamais
  Personnel (`02` § 4.2).
- **Le planning tiré des réservations** (§ 3.3).

### 3.16 Plus tard, et pas prévu

| Fonction | Quand | Pourquoi |
|---|---|---|
| Espace des salariés | Vague 1 (proposé ; la vague reste à fixer, `14` § 3.6) | § 3.6 |
| Notes de frais (le salarié photographie, un responsable accepte, le remboursement suit) | Vague 3 (`14` § 3.6) | **Proposition** : elles vivent dans Personnel (c'est une personne qui les fait), le remboursement passe par la Trésorerie et la charge par une fonction publique des Achats (le `02` les met aujourd'hui dans les Achats : à décider) |
| Sanctions et procédure disciplinaire (degrés, conseil de discipline, convocation, procès-verbal, décision écrite) | Plus tard (vague à fixer) | Un licenciement qui ne respecte pas la procédure est abusif (Code) ; la procédure sous 20 salariés et la version en vigueur de la convention cadre (art. 37 à 39) sont À VÉRIFIER. D'ici là, une mise à pied passe au bulletin comme une absence non payée |
| Pointage par QR code | Vague à fixer (`14` § 3.6) | Après la refonte ; sans position ni photo (proposé, § 3.4) ; INPDP : À VÉRIFIER |
| Signature électronique des documents | Plus tard | Valeur légale À VÉRIFIER |
| Véhicules (flotte) | Avec la livraison (vague 2), si on la demande | Accessoire pour nos cibles |
| Recrutement, évaluations et retours à 360°, enquêtes, organigramme | Pas prévu pour nos cibles | Aucun concurrent tunisien relevé ne le fait, et aucun client ne l'a demandé (à vérifier aux entretiens) ; c'est le piège d'Odoo (une douzaine d'applications RH). On le rouvre si plusieurs clients le demandent |

---

## 4. Les liens avec le reste de SkanFact

**En clair.** Chaque partie de SkanFact ne parle aux autres que par un guichet qu'elle annonce, jamais en fouillant
dans leurs tiroirs (`02` § 4). Il y a trois sortes de guichets : **prévenir** (« des salariés viennent d'être payés » :
un *événement*) ; **rendre un service** (« écris ce mouvement en banque » : une *fonction publique*, et « je déclare une
case, remplis-la si tu sais » : un *point* qu'un autre module remplit) ; **réserver une place à l'écran** (une ligne sur
l'accueil : un *emplacement*). Les noms entre accents graves sont pour Claude.

**Le sens des dépendances** (`02` § 2). Personnel est placé **sous** Ventes, Achats, Trésorerie, Déclarations, Pilotage,
Stock et Caisse : il appelle leurs fonctions et écoute leurs événements. Eux ne l'appellent ni ne l'écoutent : s'ils ont
besoin d'un chiffre, ils **déclarent un point que Personnel remplit** ; Personnel fermé, le point reste vide et l'écran le
dit, jamais un chiffre inventé. Les modules placés dessous (Comptabilité complète, Cabinet, Réservations, Projets,
Intégrations) peuvent l'appeler et l'écouter. Le socle ne connaît aucun module : il réserve des emplacements et déclare
des points. Aucun module ne lit les données du Personnel en direct (règle du 03/11/2026, `CLAUDE.md`).

| Endroit | Ce qui passe | La porte | Défaut d'aujourd'hui à réparer |
|---|---|---|---|
| **Accueil, « À faire »** (socle) | Bulletins à préparer (dès le 25), à payer, à approuver ; demandes ; déclarations ; échéances | **Emplacements d'écran** (une ligne dans « À faire », une carte sur l'accueil, `02` § 4.2), remplis par Personnel avec **la même fonction** que ses propres compteurs | Ne cherche les bulletins manquants que pour le mois précédent ; compte des bulletins que le cabinet n'a pas encore envoyés ; ses liens visent les vues d'aujourd'hui, à refaire avec les trois onglets (lot P2) ; un salaire payé en double se repère au mois du paiement (un salaire d'octobre payé le 2 novembre lui échappe) |
| **Écritures** (moteur du socle) | Le journal PAIE en totaux du mois ; les avances et les saisies une par une, au nom du salarié (compte 425, `03` § 2.1) ; le paiement ; la CNSS payée ; les versements de saisie | Personnel **appelle le moteur d'écritures** dans la même opération que le geste ; aucun événement (`02` § 4.1) | **Deux comptabilités de la même paie** : l'écran de l'entreprise recalcule à chaque affichage son propre journal (une écriture par bulletin, au nom du salarié) ; le serveur écrit les totaux du mois. Proposition : l'écran lit les livres du serveur, et seul le serveur écrit la paie. **Les livres du serveur n'ont ni les déclarations payées ni les versements de saisie**, et ils écrivent les avances en un total par jour au lieu d'une par une (découpage À VÉRIFIER avec un comptable, comme le dit le `03`) ; le test « deux chemins » compare à la v10 figée |
| **Trésorerie** (au-dessus) | Salaires payés, avances versées, CNSS du trimestre payée, versements de saisie ; la prévision au **jour de paie**. La déclaration du mois (sa part paie comprise) est payée et écrite **une seule fois, par les Déclarations** : Personnel n'en écrit aucun mouvement | Personnel **appelle** `enregistrerMouvement(…)` (`02` § 4.3), sauf ce qui est payé depuis la caisse (ligne Caisse) ; la prévision : point « sorties prévues » déclaré par la Trésorerie, rempli par Personnel (les montants, sans nom) | Calculé à l'écran sur les bulletins, que la comptabilité interne et la lecture ne voient pas : leurs soldes sont faux ; prévision datée en dur à la fin du mois ; la part paie de la déclaration comptée deux fois quand elle a été payée à part ; ni la CNSS ni l'impôt des mois sans bulletins ne sont prévus |
| **Banque** (Trésorerie) | Le virement de salaire rapproché ; le virement revenu | La Trésorerie **annonce** le rapprochement et le virement revenu (événement) ; Personnel l'écoute et marque le bulletin | Pointer un relevé écrit dans les bulletins ; deux lignes que rien n'explique après un rejet (à voir à l'écran) ; côté entreprise, aucun virement revenu n'est repéré sur le relevé (le gérant annule le paiement à la main) ; au Cabinet, seul le relevé de l'année ouverte est lu ; un salaire payé à nouveau n'est pas marqué « repayé » |
| **Caisse** (au-dessus) | Un salaire, une avance ou un extra payés en espèces ; l'avance du soir | Personnel **appelle** la sortie de caisse que la Caisse offrira, et c'est elle qui écrit le mouvement ; pour l'avance du soir, la Caisse réserve un **emplacement** (« Avance à un salarié ») que Personnel remplit | **Double sortie** : le Z croit qu'il manque de l'argent dans le tiroir et le range en perte (compte 658, charges diverses). **La Caisse n'a aucune sortie de caisse** : elle est à créer avant que Personnel l'appelle |
| **Stock** (au-dessus, vague 1) | Les repas du personnel | Personnel **appelle** `sortir(…)` | — |
| **Déclarations** (au-dessus) | Les salaires du mois pour la déclaration mensuelle ; les échéances sociales du calendrier fiscal et leur état « déposée et payée » | Points « salaires du mois » et « échéances sociales », déclarés par les Déclarations, remplis par Personnel ; sans Personnel (Essentiel sans la paie, ou une paie faite ailleurs), la déclaration ouvre la saisie en total (`02` M4) | Aucune porte n'existe aujourd'hui ; « Retirer déposée » (calendrier fiscal) et « Retirer la mention » (Paie › Déclarations) **effacent le paiement**, et la question posée avant ne le dit pas ; « marquer déposée » depuis la compta n'enregistre aucun paiement ; le cabinet et le client ont deux vérités |
| **Pilotage : marges, statistiques** (au-dessus) | La masse salariale sans nom, face aux ventes ; le coût d'une heure d'un salarié | Points « charges du mois » (`02` § 4.3) et « coût d'une heure », déclarés par le Pilotage, remplis par Personnel | La route serveur `/paie/masse` existe, aucun écran ne l'appelle ; « Aucun salarié » et un résultat à zéro pour qui ne voit pas la paie ; sans bulletin du mois, le coût d'une heure oublie les primes fixes ; les heures d'affaire ne sont pas confrontées au pointage |
| **Clôture** (socle) | La date jusqu'à laquelle rien ne bouge | Le socle refuse tout geste daté avant (`02` § 4.1, `mois.cloture`) : bulletins, congés, pointage. **Sauf un fait d'argent** (une avance donnée, un salaire payé en espèces depuis la caisse) arrivé après la fermeture : il est accepté, garde sa vraie date, et son écriture passe dans le premier mois ouvert (`04` § 5.1 et § 6) | Pour la paie, seul l'écran la garde : le serveur accepte un bulletin, un congé, une avance ou un pointage daté dans un mois clos ; seuls ses livres tiennent (l'écriture validée ne change pas, la différence passe au premier jour ouvert) |
| **Messagerie avec le cabinet** (socle) | La demande de correction d'un bulletin, la correction d'un bulletin payé (sur le bulletin suivant, § 8), « Écrire à mon comptable », l'envoi pour accord | Personnel **appelle** `notifier(…)` du socle avec le bulletin en lien ; l'avis ne porte aucun montant | Le client n'est prévenu d'un envoi pour accord par aucun avis ni e-mail : il le découvre en ouvrant l'accueil ou la page Paie (une pastille dans la barre : à voir à l'écran) |
| **Recherche Ctrl K, bouton Créer, Aide** (socle) | Les gestes et les salariés | Emplacements (entrée de palette, article d'aide), **selon le rôle et l'offre** | Proposés sans tenir compte du rôle ni de l'offre ; « Pointage » ouvre le mois au lieu de la journée |
| **Barre** (socle) | Personnel dans « Au quotidien » quand un salarié est en poste | Le module déclare sa page ; sa place dans le menu viendra du `17` (à écrire et à valider avant P1) | La barre ne connaît pas le rôle Paie |
| **Abonnement** (socle) | Le nombre de salariés comptés | Point « salariés comptés » déclaré par le socle, rempli par Personnel avec **une seule définition** | Trois définitions différentes (l'offre, la console, l'écran) |
| **API** (socle, `02` M8) | Lire bulletins, CNSS et masse (existe) ; proposé au lancement : noter une journée et recevoir les badges d'une pointeuse ; congés et avances en écriture : à décider | Gestes déclarés, sensibles et tracés ; aucun salaire nominatif sans geste sensible | Aucune écriture de la paie n'est ouverte aux clés |
| **Export, import, visites** | Ce que garde le module ; l'import des salariés ; les visites guidées | Le module dit ce que l'export de l'entreprise (socle) emporte, et apporte son import et ses visites (`02` M6) | L'import oublie la sortie, l'équipe, les congés restants, les avances en cours ; les visites visent des onglets disparus |
| **Cabinet** (dessous) | La paie du dossier, le pointage **validé**, les déclarations du client | Le Cabinet appelle les fonctions de Personnel et écoute ses événements | Ne reçoit ni les déclarations ni le pointage validé ; « pointé » compté sans regarder la validation ; « La paie de tous mes dossiers » compte les bulletins, pas les montants ; les PDF des bulletins déposés au classeur se lisent par **tout membre du cabinet qui voit le dossier**, quel que soit son rôle (un collaborateur « saisie » compris) : ils doivent être réservés au rôle Paie du cabinet et au mandat Paie |
| **Réservations** (dessous, vague 1) | L'agenda d'une personne ; les couverts prévus pour le planning | Les Réservations lisent l'agenda par une fonction de Personnel ; elles remplissent le point « couverts prévus » que Personnel déclare | — |
| **Projets** (dessous, vague 3) | Le coût d'une heure ; les heures d'un chantier confrontées au pointage | Les Projets appellent `paie.coutHoraire(salarie, mois)` | — |
| **Intégrations** (dessous) | Ce qui arrive dans la paie | Événements, dont `bulletin.remis` (`02` § 4.1), gardé | — |

---

## 5. Les droits

### 5.1 Les rôles

| Rôle | Ce qu'il voit et fait | Nouveau ? |
|---|---|---|
| Propriétaire, Administrateur | Tout, dont décider d'un congé, d'une avance, d'un départ | — |
| **Personnel** (aujourd'hui « Paie ») | Les salariés, les salaires, les bulletins, les déclarations ; décide des demandes (proposé, § 3.6) | Renommé à l'écran |
| **Pointer** (chef d'équipe) | L'onglet **Aujourd'hui**, pour ses seules équipes : qui est là, le planning, noter une demande. Il note la journée de son équipe et la valide ; une journée qu'il a validée compte comme validée : le gérant n'a pas à la valider une seconde fois. Pour une absence, il dit « absent » et peut joindre un justificatif, mais il ne choisit ni « sans solde » ni « payée » : la question reste « je ne sais pas encore » pour le gérant ou le rôle Personnel. Il note une demande d'avance **sans montant**, que le rôle Personnel complète. Il ne voit ni Le mois ni L'équipe, ni les rappels de déclaration, ni les pièces de santé. **Ni salaires, ni bulletins, ni montants** : le serveur et la base ne lui en rendent aucun, son poste n'en reçoit aucun (`04` § 2), l'effet en DT n'est pas calculé pour lui ; un test le prouve, comme pour le commercial (`04` § 2 et § 9.3). Il apporte une **limite nouvelle**, les équipes, en plus des établissements du `03` § 2 : le propriétaire choisit sur le membre les équipes qu'il pointe | **Nouveau** |
| Comptabilité interne, Lecture | La **masse salariale sans nom** (déjà décidé, `03` § 2.1), par les points du § 4, jamais les bulletins | — |
| Commercial, Caissier, Serveur, Magasinier | Rien du Personnel. Le caissier fait, depuis la caisse, la sortie « Avance à un salarié » (le nom et le montant, jamais le salaire, § 3.8). Le serveur ou le caissier relié à un salarié pointera depuis la caisse (vague 1, proposé) | — |

**Le salarié de l'espace des salariés n'est pas un rôle** : comme le visiteur de l'espace client (`03` § 4.2), il ne voit
que ce qui le concerne (son planning, ses bulletins, ses congés, ses demandes).

### 5.2 Les règles

- Les données du Personnel restent **sensibles** (`03` D10) : chaque lecture d'une fiche ou d'un bulletin **sera**
  tracée. Aujourd'hui, seules les lectures par l'API et par le cabinet le sont : l'écran de l'entreprise lit les salariés
  et les bulletins avec tout le dossier, sans trace (lot P3). Le code sur le téléphone est **recommandé, jamais imposé**, dans une entreprise, quel que soit le rôle (Skander,
  09/10/2026, `03` § 6) ; il reste obligatoire pour les comptables du cabinet.
- **Les pièces de santé** (certificat d'arrêt, visite médicale, accident du travail) ne se lisent que par le rôle
  Personnel et la direction ; le rôle Pointer voit « malade » sur la journée, jamais la pièce ; le cabinet ne la voit
  qu'avec le mandat Paie. Chaque lecture est tracée, et la pièce se garde le minimum nécessaire (loi 2004-63 art. 62 à
  64). Le rôle Personnel compte-t-il parmi les « personnes tenues au secret » de la loi ? À VÉRIFIER (INPDP).
- **Une cotisation syndicale** retenue sur le bulletin révèle une adhésion : c'est une rubrique marquée sensible, avec
  l'accord écrit du salarié en pièce jointe (loi 2004-63 art. 14 et 15, À VÉRIFIER). L'import de la pointeuse ne garde
  ni empreinte ni gabarit (À VÉRIFIER, INPDP).
- **Chaque partie a sa règle** : aujourd'hui cinq parties n'en ont aucune (`joursValides`, `pointageVersions`,
  `pointageOuverts`, `badgeImports`, `projectTime`), et sont donc réservées au propriétaire et à l'administrateur. Le
  rôle Paie ne peut ni valider une journée ni valider le mois (son geste reste sur son poste), et l'écran ne le prévient
  pas ; surtout, il ne voit pas ce que le gérant a validé : pour lui aucun mois n'est verrouillé, il peut changer le
  pointage d'un mois validé, et le bulletin suivant le reprend. Chacune reçoit sa règle (§ 10.1). *Fait le 03/11/2026
  (1.266.6) : le pointage validé suit la paie, les heures d'une affaire suivent l'affaire.*
- **Les gestes sont déclarés** un par un (établir, valider, payer, remettre, noter un congé, accepter une demande,
  pointer, publier le planning…), chacun avec son texte (`CLAUDE.md`, « Un geste ») ; aujourd'hui cinq existent, tous de
  lecture sauf `paie.dossier.modifier`.
- Le cabinet garde son mandat « Paie », **décoché par défaut** (`03` § 3.4) ; il n'écrit jamais sans l'accord du client
  (correction proposée, bon à payer) ; il n'a pas le geste « payer les salaires ».

### 5.3 Le salarié et le membre

Un **membre** se connecte ; un **salarié** est payé. Ce ne sont pas les mêmes personnes : le comptable du cabinet est un
membre sans être salarié, un ouvrier est salarié sans se connecter. Mais un caissier, un serveur ou un chef d'équipe sont
les deux. **Proposition** : un lien **facultatif** du salarié vers un membre, posé par le propriétaire ; il sert au chef
d'équipe (avec ses équipes, § 5.1), à la caisse par serveur, au pointage depuis la caisse, à l'espace des salariés, et
au départ (retirer l'accès au même geste que le solde). Le `01` reçoit ce lien (aujourd'hui, ses § 4 et § 12 ne relient
pas un membre à un salarié).

---

## 6. Le droit du travail tunisien que le module porte

*Résumé de la recherche du 03/11/2026. « Lu » : texte lu en entier ; « Rapporté » : sources secondaires qui concordent.
**« Lu » ne veut pas dire « en vigueur »** : le Code du travail lu est l'édition de 2010, sans aucune modification
postérieure (le décret-loi 2011-51 n'a pas été lu), et la version lue de la convention collective cadre date d'avant
2011. **Rien de ceci n'est un avis juridique ; tout est À VÉRIFIER** avant d'entrer dans le calcul. La règle de la maison
tient : un taux ou une règle de droit est un réglage **daté, avec sa source**, et la valeur par défaut d'une règle
inconnue est celle qui ne fait rien. Le `05` reçoit un paragraphe « Le droit du travail » (il n'en a aucun
aujourd'hui).*

| Sujet | Ce que semble dire la loi | État | Ce que la paie fait aujourd'hui |
|---|---|---|---|
| Le CDD | Seulement dans trois cas ; sinon requalifié en CDI (loi 2025-9, JORT n° 61 du 23/05/2025) | Rapporté | Un CDD sans motif obligatoire ; « un an » proposé au renouvellement |
| L'essai | 6 mois au plus, renouvelable une fois, 15 jours de prévenance, pas dans un CDD (loi 2025-9) | Rapporté | Une fin d'essai, sans plafond ni prévenance |
| Maternité, paternité | 15 jours + 3 mois (4 ou 1 selon les cas) ; paternité 7 jours, 10 dans les cas particuliers (loi 2024-44) | Rapporté | Une nature « maternité » sans durée |
| SMIG | 554,736 DT (48 h) et 470,251 DT (40 h) en 2026, puis 2027 et 2028 fixés d'avance (décret n° 67 du 30/04/2026) | Rapporté | Pas contrôlé ; un champ « Heures par semaine » (temps partiel) existe sur la fiche, mais aucun calcul ne le lit ; pas de régime 48 h ou 40 h |
| Heures sup | +75 % (régime de 48 h) ; +25 % jusqu'à la 48e heure puis +50 % au-delà (régime de moins de 48 h) ; +50 % (temps partiel) (Code art. 90) | Lu (2010) | Aucune majoration par défaut |
| Congé annuel | 1 jour par mois de travail effectif, au plus 15 jours dont 12 ouvrables ; plus pour les jeunes ; +1 jour ouvrable par tranche de 5 ans, au plus 18 ouvrables (Code art. 112 à 116) | Lu (2010) | **18 jours ouvrables** par défaut |
| Maladie | Suspend le contrat (Code art. 20) ; la CNSS paie à partir du 6e jour, aux 2/3 du salaire journalier moyen, au plus 2 fois le SMIG, 180 jours par an | Lu (2010) pour la règle ; Rapporté (CLEISS) pour la CNSS | **Payée** par défaut |
| Préavis | Un mois pour un CDI (Code art. 14 bis) | Lu (2010) | Vide par défaut |
| Indemnité de licenciement | 1 jour de salaire par mois de service effectif, au plus 3 mois de salaire, CDI après l'essai, hors faute grave (Code art. 22) | Lu (2010) | **Jours × années**, sans plafond |
| Retenue d'une avance | Au plus 1/10 du salaire dû (Code art. 150) | Lu (2010) | Avertit à 30 % du net |
| CSS | 0,5 % en 2026 seulement, exonérée jusqu'à 5 000 DT de revenu net imposable (LF 2026 art. 87) | Rapporté | Appliquée à tous, sans date de fin |
| Bulletin | Neuf mentions obligatoires (Code art. 143) | Lu (2010) | Pas contrôlées |
| Livre de paie | Signé par le salarié à chaque paie, sans blanc ni rature (Code art. 144) | Lu (2010) | Journal de paie, sans accusé |
| Mineurs | 16 ans au moins ; sous 18 ans, examen d'aptitude, pas d'heures sup, nuit limitée (Code art. 53 à 67) | Lu (2010) | Rien |
| Extras | Déclarés à la CNSS dès le premier jour, sans renonciation possible (loi 60-30) | Rapporté | Pas de fiche à la journée |
| Données des salariés | L'employeur est dispensé de déclaration pour la situation professionnelle (loi 2004-63 art. 16) ; la santé et l'adhésion syndicale restent protégées ; trace des accès ; **destruction en fin de délai** (art. 45) | Lu | Lectures tracées pour l'API et le cabinet seulement, pas pour l'écran de l'entreprise (§ 5.2) ; la CIN et le RIB gardés en clair dans le dossier (§ 8) ; et le `01` dit qu'un salarié « ne s'efface jamais » : **à concilier** (§ 8) |

**Ce qui bloque, et ce qui avertit** (proposition ; chaque règle **après la réponse** du comptable ou du juriste ; avant,
tout avertit). *Bloque*, en disant ce qui manque et le geste qui débloque : un salaire sous le SMIG du régime ou sous la
grille ; un CDD sans motif (choisir le motif, ou « En faire un CDI ») ; un essai dans un CDD ; un second renouvellement
d'essai ; une mention de l'art. 143 manquante (la remplir) ; une embauche sous 16 ans. *Avertit avant le geste, sans
bloquer* : une retenue d'avance de plus d'un dixième (§ 3.8 ; bloquer ou avertir après la réponse : question au
juriste) ; plus de 10 h par jour ou de 60 h par semaine, une pause
ou un repos de 10 h manquant, le repos hebdomadaire, la nuit d'un mineur ; un licenciement pendant une maladie, une
grossesse ou un congé de naissance ; un certificat médical en retard.

**Ce qu'on fait de ces écarts** : une liste de questions au comptable et au juriste (§ 11) ; **rien ne change dans le
moteur avant leur réponse** ; ensuite chaque règle entre datée, avec sa source, et un test qui la prouve.

---

## 7. Le hors-ligne

*Proposition, à valider par Skander (décision 2 de l'En bref). La liste du `04` § 1 fait foi ; elle promet aujourd'hui
« bulletin de paie en brouillon » sans réseau, alors que la plateforme fait « la paie reste en ligne, et le dit »
(`docs/paie.md`, `docs/hors-ligne.md`). Ce paragraphe retire cette ligne du `04` § 1 et lui donne celles-ci.*

| Geste | Sans réseau | Pourquoi |
|---|---|---|
| Noter la journée (qui est là, retard, heures sup) | **Oui** : noté sur le poste, envoyé au retour. Si la journée ou le mois a été validé entre-temps, le geste va dans « À reprendre », avec le bouton « Rouvrir la journée » (`04` § 5.2) ; si le bulletin du mois est déjà payé ou remis, « À reprendre » propose « Régulariser sur le mois suivant » (ou sur le solde, si le salarié est parti), comme toute erreur sur un bulletin payé (§ 8). Rien ne se perd en silence | **Aujourd'hui ce n'est pas tenu** (§ 10.1) : le pointage d'un salarié est rangé en un seul bloc pour tout le mois. Dès que deux personnes enregistrent en même temps (même sur une autre pièce, en ligne comme au retour du réseau), le poste reprend le bloc du serveur et perd le sien en entier, sans un mot. Avant de promettre ce geste, chaque journée devient une ligne à part, datée, que le serveur sait rassembler ; un test le prouve (deux postes notent le même mois sans réseau, et un poste note une journée pendant qu'un autre change un client : rien ne se perd) |
| Donner une avance en espèces, le soir, depuis la caisse | **Oui** : c'est une sortie de caisse, notée sur le poste, qui part au retour | L'argent est sorti du tiroir : c'est un fait, jamais refusé (`04` § 5.1). Le poste de caisse doit connaître le **nom** des salariés de son établissement, jamais un salaire ni un RIB (le `04` § 2 change, § 12) |
| Voir le planning de la semaine | Oui, en lecture | — |
| Noter une demande | Oui, envoyée au retour | Comme un brouillon : elle peut aller dans « À reprendre » (`04` § 5.1) |
| Valider la journée, le mois ; publier le planning | Attend le réseau | Une validation fige ; elle passe par le serveur |
| Bulletins, payer, remettre, déclarer | Attend le réseau, et le dit avant le geste | Le serveur fait foi (montants, numéros) |

---

## 8. Les données

Le `01` § 12 décrit « la paie » avec six objets ; la plateforme en a beaucoup plus (inventaire du 03/11/2026). Il reçoit
(à sa revalidation) : le pointage, **un fait par salarié et par jour**, et sa validation, **gardée au serveur sans limite
de nombre** (coupée aux 400 dernières jusqu'à 1.266.6) ; les équipes et horaires ; le **planning** ; les demandes ;
les prêts ; les saisies ; les documents faits et leurs numéros ; les **pièces du dossier** ; les **échéances** et les
rappels remis à plus tard (par qui, jusqu'à quand) ; le **matériel confié** ; les **listes de tâches** ; les avenants et
renouvellements ; les régularisations ; les déclarations déposées et payées ; les **cumuls de l'année** repris d'un autre
outil (§ 3.9) ; le lien facultatif vers un membre, et sur le `membre` les **équipes** qu'il pointe (`01` § 4). Au
**contrat** : le motif du CDD et le salarié remplacé, la fin d'essai et son renouvellement, le régime horaire (et la part
d'un temps partiel), le mode de paie (au mois, à l'heure, à la journée), la convention collective, la catégorie et
l'échelon. À l'**entreprise** : la convention collective, le groupement de médecine du travail et son n° d'adhésion,
l'horaire et le jour de repos déclarés à l'inspection. Au `01` § 24 : la forme posée dès maintenant de l'espace des
salariés et des tables de la vague 1 (pourboires, repas, extras ; `note_frais` et `temps_passe` visent le salarié ou le
membre relié) (règle du `14` : les tables des vagues ont leur forme posée tôt).

**Trois questions à trancher** (les deux premières sont des décisions de Skander, la troisième passe par un juriste) :

1. **Quand un bulletin ne se modifie-t-il plus ?** (Décision 3 de l'En bref.) Le cadrage dit « remis → scellé, corrigé
   par un bulletin rectificatif » (`01` R6 et § 12) ; la plateforme le laisse modifier jusqu'à la clôture (gardée
   aujourd'hui par l'écran seulement, § 10.1), même payé (avec un avertissement), sauf s'il est validé par le cabinet
   (`valideLe`), que l'écran refuse ; elle régularise un bulletin payé sur un mois suivant (1.230.0) ; le serveur n'en
   refuse aucun et ne scelle rien ; la maquette ajoute que le **gérant** aussi valide les bulletins, et l'écran dit « ils
   ne se modifient plus ». **Proposition** : un bulletin **payé ou remis** est scellé dans le journal inaltérable (chaîne
   d'empreintes) ; avant, il se corrige, et la phrase de la maquette devient « validés : ils se corrigent encore jusqu'au
   paiement » (fait le 04/11/2026). **Le paiement est un fait à part du bulletin** : « Annuler un paiement » (une erreur de saisie, un
   virement rejeté) écrit un fait de plus, « paiement annulé », sans rouvrir le bulletin ; le bulletin redevient « à
   payer », et le nouveau paiement s'y ajoute. Pour sceller à la remise, le serveur doit d'abord la connaître : `paie.bulletin` reçoit les faits datés du
   circuit (bon à payer, validé, remis, correction proposée et acceptée), et la porte reçoit leurs gestes (lot P3). Une
   erreur trouvée sur un bulletin payé se corrige sur le mois suivant ; si le salarié est parti, sur son solde ; s'il ne
   peut pas attendre, par un complément payé tout de suite et repris sur le bulletin suivant (sa forme : À VÉRIFIER avec
   le comptable). Pour la paie, cela **remplace le « bulletin rectificatif »** de la règle R6 du `01` : le bulletin
   scellé ne change jamais ; sa correction est une ligne datée du bulletin suivant (ou du solde, ou du complément), qui
   renvoie au bulletin corrigé.
2. **La CIN et le RIB du salarié** (décision 1 de l'En bref). La décision D6 de la paie par le serveur (brique 31,
   journal du 29/09/2026, prise par délégation) dit que la **fiche de paie du serveur** (`paie.salarie`) ne les garde
   pas. Mais ils sont **déjà sur le serveur, en clair**, dans le dossier de l'entreprise (`socle.dossier_v10`), et le
   cabinet les reçoit ; le paiement contrôle le RIB et la déclaration annuelle demande la CIN. **Proposition** : les
   chiffrer là où ils sont, lisibles par ceux qui voient la fiche d'un salarié (propriétaire, administrateur, rôle
   Personnel : `03` § 2.1) et, pour la CIN seulement, par le cabinet qui a le mandat Paie (la déclaration annuelle) ;
   chaque lecture tracée ; jamais par Pointer, la comptabilité interne ni la lecture.
3. **Combien de temps garder les données d'un salarié parti ?** Bulletins, journal et déclarations : 10 ans (Code de
   commerce, Rapporté, À VÉRIFIER, `05` § 3.8) ; contrat, avenants et documents de sortie : au moins un an après la fin
   pour les actions du travail (Code art. 147, 148, À VÉRIFIER), **et plus longtemps pour la retraite et la CNSS** (durée
   À VÉRIFIER avec la CNSS) ; sanctions, quand elles seront notées : effacées au bout de 2 ans (1er degré) ou de 5 ans
   (2e degré) si aucune nouvelle sanction n'a été prononcée (convention cadre art. 37, À VÉRIFIER) ; certificats
   médicaux : le minimum nécessaire. **Proposition** : après ces durées, l'anonymisation, et aucune anonymisation du
   contrat ni des preuves d'emploi avant la réponse de la CNSS ; qu'elle vaille « destruction » au sens de la loi
   2004-63 art. 45 est À VÉRIFIER avec l'INPDP (le `01` § 21, point 9, laisse la question ouverte).

---

## 9. Le prix

**Rien ne change dans ce document** : un prix se discute avec Skander d'abord, et passe ensuite par la console avec
30 jours de préavis (`07`). Aujourd'hui : Complet (690 DT par an) comprend la paie **jusqu'à 20 salariés**, puis 12 DT par
salarié et par an ; la Paie prise seule sur Essentiel coûte **+ 150 DT par an jusqu'à 10 salariés**, puis 12 DT par
salarié et par an. Les utilisateurs sont illimités (les caissiers et les serveurs ne comptent pas comme utilisateurs ;
s'ils sont salariés, ils comptent comme salariés).

**Les questions à discuter** (aucune réponse dans ce document ; l'avis de Claude, sans changer aucun prix) :

1. **Un module plus riche** (planning, dossier, échéances, matériel) garde-t-il le même prix ? *Avis : oui au lancement.*
   Pour 20 salariés, SkanFact coûte de 660 à 690 DT par an, contre 790 DT chez Hesabi Pro (paie et CNSS, sans RH
   documentée) et de 3 240 à 25 000 DT chez les outils qui ont la RH (Swifto, Odoo, Combo, PayFit…, relevés du
   03/11/2026, leur affirmation) ; la RH ne doit pas devenir une ligne par salarié de plus.
2. **Qui est compté** : aujourd'hui, l'offre compte chaque fiche de salarié pas encore sortie, avec ou sans bulletin (la
   console et l'écran comptent autrement, § 4). Faut-il ne compter que ceux qui ont un bulletin dans SkanFact ce mois-là,
   ou aussi ceux qui ne font que pointer ou être au planning (un extra, un salarié dont le cabinet fait la paie
   ailleurs) ? *Avis : ceux qui ont un bulletin dans SkanFact ce mois-là ; c'est un changement de définition, à décider
   avec toi.* Une seule définition sera écrite (§ 4).
3. **Essentiel avec un cabinet qui tient la paie** : la règle validée du `02` § 8 dit que le client voit ses bulletins en
   lecture, sans rien créer ; il ne peut donc saisir ni un congé ni une avance, alors que c'est lui qui les connaît. Le
   laisser les saisir change ce que l'offre ouvre. *Avis : oui, dans Essentiel, puisque c'est le cabinet qui fait la paie
   et que le client ne fait que lui donner les faits.* À décider avant tout code.
   **Décidé le 04/11/2026** (Skander : « je suis d'accord avec les trois chose a decider ») : en Essentiel, quand un
   cabinet tient la paie (un mandat actif qui couvre la paie, et « Le cabinet fait la paie » choisi pour ce mois), le client
   saisit ses **congés et ses avances**, rien d'autre (ni salarié, ni bulletin, ni pointage). Le serveur le tient
   (`serveur/abonnement/offre.ts`, `FAITS_DU_CLIENT`) ; un envoi qui mêle un congé et un bulletin est refusé en entier.
   *Reste à décider* : le pointage, qui nourrit les bulletins du cabinet, reste fermé en Essentiel (rapport du 04/11).
4. **Les obligations de l'employeur dans un module payant** : Personnel porte des obligations (registres, affichages,
   mentions du bulletin, état CNSS, déclaration annuelle ; lesquelles sont obligatoires : À VÉRIFIER). En Essentiel,
   sans Personnel ni cabinet, personne ne les produit. Le principe 2 du `07` (« aucune obligation légale n'est vendue en
   option ») et la règle M4 du `02` le permettent-ils ? *Avis : la règle M4 porte sur les cases de déclaration, que la
   saisie en total tient déjà ; pour le reste, une entreprise qui a des salariés sans paie dans SkanFact fait sa paie
   ailleurs, et ces obligations y vivent. À confirmer ensemble.*

---

## 10. Comment il se construit

### 10.1 D'abord, réparer ce qui fausse l'argent ou perd des données

Trouvé en lisant le code les 03/11/2026 (recherche et relectures) ; chacun se reproduit d'abord, puis se répare avec son
test. Ce sont les **corrections urgentes** que la règle du 03/11/2026 permet de faire dans les gros fichiers, chacune
notée pour la sortie du module (`CLAUDE.md`, « Le code : un dossier par module »).

1. **Les barèmes de la paie ne sont pas datés**, et la CSS de 0,5 % ne vaut que pour 2026 : un bulletin de janvier 2027
   la retiendrait encore (§ 3.7). Le serveur, lui, accepte le barème que le poste lui envoie sans le comparer aux
   réglages du jour (`docs/paie.md`) : un onglet ouvert avant une loi de finances établit des bulletins aux anciens
   taux. **Le plus urgent : avant le premier bulletin de janvier 2027.**
   *Fait en partie le 03/11/2026 (1.266.3) : la CSS porte sa date de fin (31/12/2026), lue par l'écran, le Cabinet,
   l'exemple et le serveur (qui refuse un bulletin de 2027 qui la retient) ; la page et la fenêtre « Établir » disent
   « Barèmes de 2027 pas encore relus ». Reste : comparer tout le barème aux règles du mois (« Recalculer avec les taux
   du mois ») ; les estimations sans mois (fiche, coût d'une heure, trésorerie) gardent la CSS ; deux tests web
   (`parcours`, `recette-alpha`) attendent un net de 2026 sur le mois en cours et tomberont en décembre ; à sortir avec le
   Personnel (A1).*
2. Une **journée pointée peut disparaître** sans un mot : le pointage, les journées validées et les versions du mois ne
   sont pas dans la fusion. Dès qu'un enregistrement est refusé pour un conflit, même sur une autre pièce (un client
   changé par un collègue), en ligne ou au retour du réseau, le poste reprend tout le pointage du serveur et perd le sien
   (§ 7).
   *Réparé le 03/11/2026 (1.266.4) : le pointage se fusionne case par case (`fusionnerPointage`, core.js), avec ce que la
   page avait du serveur pour distinguer une case effacée d'une case jamais posée ; une même case changée des deux côtés
   garde la version du serveur et l'autre est mise de côté et dite (comme une pièce) ; les journées validées gardent le
   geste le plus récent (à l'horloge des postes, À VÉRIFIER) ; un pointage par salarié et par mois sous un identifiant
   qui en découle (`idPointage`, compta.js). Reste : d'autres listes ne sont pas non plus dans la fusion (listes de prix,
   commandes fournisseur, réceptions, dépôts, clôtures, échéances fiscales), à réparer à part ; à sortir avec le
   Personnel (A1).*
3. Les livres du serveur n'ont **ni les déclarations sociales payées ni les versements de saisie**
   (`serveur/compta/paie.ts`), et ils écrivent les avances en un total par jour au lieu d'une par une (`03` § 2.1) ; le
   test qui devait le voir compare à la v10 figée ; l'écran calcule en plus, à chaque affichage, sa propre comptabilité
   de la paie, une écriture par bulletin (§ 4).
   *Réparé en partie le 03/11/2026 (1.266.6, migration 0188) : les déclarations payées (une par pièce, aux comptes de
   l'écran) et les versements de saisie (un par un, sans nom) entrent dans les livres du serveur, et un test les compare
   à l'écran de la plateforme, plus à la v10 figée (`docs/ecritures.md`, D8). Les avances une par une ne changent pas :
   D8 contre le `03` § 2.1, À DÉCIDER avec un comptable. Une déclaration payée avant la correction n'entre qu'à la
   prochaine réécriture de son mois (un rattrapage : À DÉCIDER). À sortir avec le Personnel (A1).*
4. Les rôles qui ne voient pas la paie (comptabilité interne, lecture) calculent **une trésorerie, une prévision, un
   résultat et des marges faux** sans le savoir ; la prévision compte deux fois la part paie de la déclaration quand elle
   a été payée à part, et elle ne prévoit ni la CNSS ni l'impôt des mois dont les bulletins ne sont pas encore faits.
   *La prévision : réparée le 03/11/2026 (1.266.7) : la part paie payée à part (`dm-…`) ne sort plus une seconde fois ; un
   mois à venir sans bulletins prévoit sa part paie (le 28) et sa CNSS (au trimestre), estimées sur les fiches, au millime
   des bulletins qu'on établira. Un mois passé dont les bulletins sont en retard n'est estimé nulle part (À DÉCIDER).
   *Les rôles sans la paie : en partie le 03/11/2026 (1.266.7, option A) : le serveur dit `paieCachee` (un oui ou un non,
   jamais un nom ni un montant) à qui a la masse salariale sans la paie, dès que l'entreprise en a une ; la trésorerie, la
   comptabilité, les marges et l'affaire disent « Sans la paie » ; le relevé importé dit de ne pas créer un salaire ; le FEC
   ne s'écrit pas sans la paie (choix par défaut, À VÉRIFIER). Aucun montant ne change encore : les chiffres justes (la
   masse salariale dans le résultat, des totaux sans nom dans la trésorerie) sont les options A2 et B, À DÉCIDER. À sortir
   avec le Personnel (A1).*
5. Un salaire ou une avance payés **en espèces depuis la caisse comptent deux fois** (le Z en fait un manque).
   *Réparé le 03/11/2026 (1.266.7, option 1, migration 0189) : la Paie note dans la session ouverte ce qu'elle paie du
   tiroir (`serveur/caisse/sortie.ts`, la porte de la Caisse ; sans un nom) et le Z le retire de l'attendu, en une ligne
   « Payé du tiroir pour la paie ». « Le compte du tiroir est le tiroir » et ce total montré au caissier : À DÉCIDER. Le
   geste du comptoir « Avance à un salarié » (§ 3.8) reste au Lancement ; un paiement noté après le Z et les autres
   sorties du compte de caisse restent faux (`docs/caisse.md`). À sortir avec le Personnel et la Caisse (A1).*
6. « Retirer déposée » **efface aussi le paiement** de la déclaration, à deux endroits : le calendrier fiscal (Compta) et
   « Retirer la mention » dans Paie › Déclarations ; la question posée avant ne dit pas que l'argent sorti et son
   écriture partent avec.
   *Réparé le 03/11/2026 (1.266.5) : une seule porte (`retirerDeclarationSociale`, app.js, appelée aussi par le calendrier
   fiscal) dit ce qui part (montant, date, compte, référence), demande, et offre « Annuler » ; un paiement pointé sur un
   relevé ou daté d'un mois clos ne se retire pas. « Déposée » et « payée » restent un seul fait (les séparer : P6, À
   VÉRIFIER avec un comptable) ; à sortir avec le Personnel (A1).*
7. Une **période close** ne protège la paie qu'à l'écran : le serveur accepte un bulletin, un congé, une avance ou un
   pointage daté dans un mois clos (il ne lit pas la date de clôture) ; seuls ses livres tiennent.
   *Réparé le 03/11/2026 (1.266.6) : `garderLaCloture` (serveur/v10/paie.ts) refuse, avant toute écriture, un bulletin, un
   congé, une avance ou un pointage qu'un envoi crée, change ou retire dans la période close, et le refus nomme la partie
   et le jour ; un fait d'argent arrivé après (une avance nouvelle, un salaire payé qui ne l'était pas) passe à sa vraie
   date (04 § 5.1). À l'écran, les gestes qui n'avertissaient pas le font avant (une demande de congé, l'import des badges),
   et un bulletin d'un mois clos se tient comme un bulletin payé (primes du mois, augmentation, renouvellement d'un CDD :
   le rappel va au premier mois ouvert). Restent sans garde au serveur : les ventes, les achats, la trésorerie, les
   versements de saisie, les déclarations payées et `joursValides` ; le Cabinet ne lit pas encore `closedUntil` (À VÉRIFIER).
   Les deux clôtures (`closedUntil` et `compta.cloture`) restent distinctes : en faire une seule est une décision du socle.
   À sortir avec le Personnel (A1).*
8. Cinq parties sans règle de droits : le rôle Paie **ne peut pas valider** une journée ni un mois, **et il ne voit pas ce
   que le gérant a validé** : pour lui aucun mois n'est verrouillé, il peut changer le pointage d'un mois validé, et le
   bulletin le reprend (§ 5.2).
   *Réparé le 03/11/2026 (1.266.6) : `joursValides`, `pointageVersions`, `pointageOuverts` et `badgeImports` suivent la
   paie (P, A, Pa lisent et écrivent) ; `projectTime` suit les affaires (ventes : P, A, C écrivent, I et L lisent ; choix
   par défaut, À VÉRIFIER avec Skander : la page Affaire, elle, ne s'ouvre qu'à P, A, I, L). Les règles ont une empreinte
   dans le profil de la relecture : une copie gardée sous d'autres règles repart en entier, et la paie reçoit ce que le
   gérant avait validé avant. Les gestes dédiés (« valider le pointage ») viennent avec P3.*
9. Les journées validées sont **coupées aux 400 dernières** : les plus anciennes redeviennent « non validées »
   (`app.js`, `validerJour`).
   *Réparé le 03/11/2026 (1.266.6) : `validerJour` ne coupe plus la liste ; `pointageVersions` et `pointageOuverts` ne
   coupaient pas ; à sortir avec le Personnel (A1).*
10. Sans bulletin du mois, le coût d'une heure, le contrôle d'une avance **et le salaire prévu de la trésorerie** oublient
    les primes fixes ; et un salarié d'une équipe aux autres jours de travail a deux chiffres (congés et pointage
    comptent ses jours par deux règles) : la correction urgente se limite au montant faux.
    *Réparé le 03/11/2026 (1.266.7) : le salaire prévu, le coût d'une heure (`coutHoraire`) et le contrôle d'une avance
    prennent la fiche avec ses primes (`saisieDeLaFiche`), à l'entreprise comme au Cabinet. Les deux règles des jours
    restent : la fonction unique vient avec le dossier du module (§ 3.4).*
11. « Un départ… » du menu ⋯ **appelle la mauvaise fonction** et échoue. *Réparé le 03/11/2026 (1.266.2) : la fenêtre de
    l'heure de sortie du pointage s'appelle `heureSortieFenetre` ; chacune part avec sa partie à la sortie (A1).*
12. Les PDF des bulletins déposés au classeur du cabinet se lisent par **tout membre du cabinet** qui voit le dossier,
    quel que soit son rôle (§ 4).
    *Réparé le 03/11/2026 (1.266.6, migration 0187) : un document du classeur porte la marque `paie` (« Les envoyer » la
    pose ; les bulletins déjà rangés la reçoivent) et suit alors la règle des bulletins (`paie.mes_entreprises`) : au
    cabinet, le rôle Paie et l'associé sous un mandat qui comprend la paie ; chez le client (« Mon comptable »), qui lit la
    paie, plus la comptabilité interne. Un dépôt refusé n'écrit plus rien. Restent ouverts (À DÉCIDER) : les exports ZIP du
    classeur emportent les bulletins de qui les fait, et l'envoi d'un bulletin à la lecture par l'IA. À sortir avec le
    Personnel (A1).*
13. La CIN et le RIB des salariés sont gardés **en clair** dans le dossier de l'entreprise, sur le serveur (§ 8,
    décision 1 de l'En bref).
    *Fait en partie le 03/11/2026 (1.266.7, lot A : ce que reçoivent ceux qui n'y ont pas droit ; `serveur/paie/identite.ts`) :
    le cabinet lit la CIN, et le RIB masqué à ses 4 derniers chiffres (ce que son écran montrait déjà) ; ce qu'il renvoie
    d'un salarié garde le RIB du client (sans quoi chaque enregistrement du cabinet l'effaçait). Un défaut de plus, trouvé
    en chemin : la fusion de la v10 garde la version écartée d'une fiche **entière** (`conflictArchive`), partie technique
    que reçoivent le commercial, la caisse, la lecture et le support ; une fiche de salarié n'y garde plus ni CIN ni RIB, à
    l'écriture et à la lecture (les archives d'avant). La lecture d'une CIN ou d'un RIB en clair par l'entreprise se trace,
    une fois par réponse, comme celle du cabinet. **Reste** : le scellement au repos (lot B), qui attend la décision de la
    clé (garder `SKANFACT_COFFRE` ou une clé à part ; dans les deux cas, perdre la clé perd toutes les CIN et tous les
    RIB) ; **le même défaut voisin** : ces archives gardent aussi les noms des salariés, leurs bulletins, congés et avances,
    lisibles par qui ne voit pas la paie (À DÉCIDER : n'y garder que l'identifiant, au risque qu'un poste qui renvoie la
    liste efface ce qui était gardé) ; la copie du poste sans réseau, la photo d'une CIN jointe, un RIB dans la messagerie.
    À sortir avec le Personnel (A1).*

*Ne sont pas des réparations, et viennent après la sortie des gros fichiers :* le report des congés (`leaveCarry`, jamais
écrit : une fonction prévue, § 3.5) ; la fonction unique « les jours de travail de ce salarié » (§ 3.4), écrite dans le
dossier du module ; la civilité d'une salariée (`civilite` lu, `gender` écrit : elle reste au masculin) ; la saisie des
congés par un client en Essentiel dont le cabinet tient la paie (une question d'offre, § 9).

### 10.2 Puis les lots

| Lot | Ce qu'il fait | Ce qui le prouve |
|---|---|---|
| **P0** | Les corrections urgentes du § 10.1, dans les gros fichiers, chacune notée pour la sortie | Chaque défaut reproduit puis corrigé, avec son test ; la batterie complète |
| **P1** | **Sortir le Personnel des gros fichiers** dans son dossier, avec sa porte, **sans rien changer à l'écran** : sa part de `app.js`, `core.js`, `compta.js`, `guide.js` (ses aides « i »), `visites.js`, et du Cabinet (`v10/cabinet/app.js`). Le moteur de paie sort **en un seul endroit**, chargé par l'entreprise **et** par le Cabinet. Le plan, le `17`, doit exister et être validé avant | Les mêmes écrans avant et après ; les parcours de paie de l'entreprise et du Cabinet passent avant et après ; toutes les preuves suivent le code |
| **P2** | Les écrans du quotidien, après la mise à jour de la maquette (§ 2.2) : Aujourd'hui, Le mois (étapes cliquables, bulletins dès le 25), L'équipe, la première fois | Les parcours de la maquette, à la souris et au téléphone, avec des **temps écrits d'avance** : un café de 8 salariés où rien n'a changé, la journée validée en 2 gestes, en moins de 15 secondes ; avec deux changements (un absent, un retard), moins d'une minute ; à 27 salariés, moins de deux minutes |
| **P3** | Les droits : le rôle Pointer (et sa limite par équipe), les règles des parties, les gestes déclarés, les faits du circuit d'un bulletin, le lien salarié et membre | Les tests de droits (le poste d'un chef d'équipe ne reçoit aucun montant) ; un chef d'équipe à la souris |
| **P4** | Le planning de la semaine | Maquette d'abord ; prévu face au réel dans la journée |
| **P5** | Le dossier complet, les échéances, le matériel, les listes de tâches, le salarié à l'heure, le report des congés, la reprise des cumuls de l'année | Maquette d'abord |
| **P6** | Les portes vers le reste (§ 4) : jour de paie, sortie de caisse, salariés comptés, une seule vérité « déposée », la messagerie, l'API de la pointeuse | Les tests « deux chemins » entre le module et les écritures, la trésorerie, l'abonnement ; le test du sens des dépendances (`02` § 2) |
| **P7** | La loi : contrats (2025-9), mineurs, congés et leur report, maladie, préavis, indemnités, SMIG, mentions, majorations, fériés payés et leur majoration, quotité saisissable, retenue d'une avance — **après la réponse du comptable et du juriste** | Chaque règle datée, sourcée, prouvée par un test |
| **Vague 1** (proposé) | Espace des salariés, pourboires, repas, extras, planning tiré des réservations | Avec la reprise de Slate |

*P2 commencé le 04/11/2026 (1.267.0, morceau A sur quatre)* : les trois onglets (« Aujourd'hui », « Le mois »,
« L'équipe ») ; « Aujourd'hui » en deux colonnes, comme la maquette (la journée et quatre gestes à gauche ; les demandes
et « À ne pas oublier », l'ancien « À traiter », à droite) ; « Le mois » en quatre étapes qu'on clique (Pointer, Bulletins,
Payer, Déclarer), qui s'ouvre sur celle en cours ; « Payer » est une étape à elle (par virement, en espèces, puis
remettre chaque bulletin) ; **un seul bouton vert**, calculé selon le jour : le mois d'avant pas fini (son bandeau),
puis le mois en cours dès que ses bulletins existent, ou à partir du 25 pour les établir, sinon « Valider la journée ».
La bande des douze mois reste sur « Le mois » (elle se simplifie au morceau C) ; l'année y est « Toute l'année ».
*B, C et D le même jour (1.267.0, Skander : « enchaîne toute la paie et teste à la fin »)* : la journée de la maquette
(quatre choix d'un clic, « + Retard » et « + H. sup » qui s'ajoutent à « Là », l'effet en DT sous la ligne, le congé prévu,
le clavier, la recherche dès 12 salariés) ; le mois (ce qui change un montant retient les bulletins tant que le pointage
n'est pas validé, avec « Régler d'abord » ; les bulletins du mois en cours à partir du 25, jamais un mois à venir ;
« Plus tard » remet un rappel à lundi) ; le téléphone (la feuille à gros boutons, « Valider la journée » sous le pouce, les
demandes au pouce). **Restent, à décider ou à faire** : « Pourquoi ? » d'une absence (un champ de plus dans le pointage,
ou un congé saisi), « comptés présents jusqu'au 30 » écrit sur le bulletin lui-même (aujourd'hui dans la question
d'« Établir »), les étapes du mois selon la façon de faire la paie avec le cabinet, et la revue complète à la souris.
`docs/paie.md`, « La paie refaite, morceaux B à D ».

**Pourquoi P0 passe avant P1** : on ne déménage pas un code qui fausse l'argent sans d'abord le prouver juste, et la
règle du 03/11/2026 l'autorise pour une correction urgente. **Pourquoi P1 passe avant P2** : on ne refait pas un écran
dans un fichier qu'on va quitter (même règle).

---

## 11. À VÉRIFIER, et avec qui

- **Le comptable** : la CSS en 2027 (reconduite ou non) et le seuil de 5 000 DT de 2026 ; le maintien du salaire en
  maladie et le complément de paternité ; le congé annuel (1 jour par mois, ou 18 jours ouvrables pour tous) ; les
  absences justifiées payées ; le diviseur d'une journée (26 ou les jours ouvrés du mois) ; les fériés payés par
  convention et le 13e mois ; les majorations d'heures sup à poser par défaut ; la date de la déclaration annuelle
  d'employeur par régime ; le certificat de retenue du salarié (déposé sur TEJ, la plateforme des impôts ?) ; la base du
  dixième d'une avance (brut ou net) ; le complément payé tout de suite après une erreur ; la reprise des cumuls de
  l'année ; l'avantage en nature des repas ; les pourboires ; le cumul du congé de naissance (2 jours, convention cadre
  art. 31) et de la paternité (7 jours).
- **Le juriste en droit social** : parmi les articles que le module porte (14 bis, 17, 18, 20, 21, 22, 53 à 67, 79 à 96,
  112 à 132, 139 à 151, 174), lesquels ont été modifiés depuis 2010 (décret-loi 2011-51 et suivants) ; la version en
  vigueur de la convention cadre ; le texte final de la loi 2025-9 (durée et renouvellements d'un CDD, essai des cadres,
  CDD signés avant le 23/05/2025, sous-traitance de main-d'œuvre et extras fournis par une autre société) ; le contrat
  d'un jour ; le contrat d'apprentissage ; bloquer ou avertir un licenciement pendant une maladie ou une maternité ; la
  procédure disciplinaire sous 20 salariés ; le préavis (Code et convention) ; la valeur d'un livre de paie électronique
  et de la signature du salarié ; la quotité insaisissable ; la retenue pour matériel non rendu ; une retenue d'avance
  plus rapide que le dixième de l'art. 150, quand le salarié la demande par écrit ; la signature électronique d'un
  contrat de travail ; si changer le planning modifie l'horaire déclaré ; un plafond des salaires payés en espèces ; si
  les art. 66 et 111 du Code (travail de nuit et jours fériés des femmes) sont encore en vigueur (d'ici la réponse, le
  module n'en tire aucune règle).
- **La CNSS** : depuis quand valent les cotisations de 9,68 % (part du salarié) et de 17,07 % (part de l'employeur),
  les taux livrés dans la paie (`docs/paie.md`) ; le délai d'immatriculation ; la déclaration des extras dès le
  premier jour ; la déclaration d'un accident du travail (organisme, formulaire) ; les indemnités de maternité et de
  paternité ; un numéro d'employeur par établissement ; combien de temps garder le contrat et les preuves d'emploi pour la
  retraite ; le remboursement de l'indemnité de congé des moins de 21 ans (Code art. 121).
- **L'ANETI** : les conditions en vigueur du CIVP, de Karama ; ce que touchent un stagiaire CIVP, un SIVP, un Karama et
  un apprenti, et si le SMIG s'y applique ; la LF 2026 art. 13 (cotisation patronale des diplômés).
- **L'INPDP** : l'art. 16 pour nos clients employeurs ; le rôle Personnel et les pièces de santé ; l'adhésion syndicale
  sur le bulletin ; l'anonymisation comme destruction ; la pointeuse (sans empreinte) et le QR code ; l'espace des
  salariés et sa protection.
- **L'inspection du travail** : un registre du personnel obligatoire ? le règlement intérieur ; les amendes en vigueur.

Ces questions entrent au `05` § 6, avec leurs interlocuteurs ; c'est le père de Skander qui mène les démarches.

---

## 12. Ce que ce document change ailleurs (à sa validation)

- `01` § 12 (les objets du § 8, les champs du contrat et de l'entreprise) ; `01` R6 et § 12, ligne `bulletin` : « remis
  → scellé, corrigé par un bulletin rectificatif » devient « payé ou remis → scellé ; corrigé sur le bulletin suivant,
  sur le solde ou par un complément » (décision 3) ; `01` § 4 (le lien salarié et membre, les équipes du membre) ; `01`
  § 24 (les tables de la vague 1).
- `02` : la ligne « Paie » devient « Personnel », son contenu, ses portes (§ 4), la place des notes de frais ; sa colonne
  « Dépend de » devient « Trésorerie, Caisse, Stock, Déclarations, Pilotage » ; la ligne du prix y reprend le palier de
  10 salariés ; le tableau des événements et des fournisseurs reçoit ceux du § 4.
- `03` : le rôle Pointer et sa limite par équipe (§ 2), les gestes, le nom du rôle, les pièces de santé ; le rôle Paie du
  cabinet pour les bulletins du classeur.
- `04` § 1 : la ligne « bulletin en brouillon » remplacée par celles du § 7, et « bulletin scellé à la remise » devient
  « scellé au paiement ou à la remise » ; `04` § 2 : le poste de caisse garde le nom des salariés de son établissement.
- `05` : un paragraphe « Le droit du travail », les questions du § 11.
- `09` : la paie n'est plus à l'étape 3, elle est faite ; les lots du § 10 ; ce que gagnent le lancement et la vague 1,
  et l'effet sur les 25 mois, à mesurer.
- `14` § 3.6 : renvoie ici ; le planning au lancement (Skander, 03/11/2026) ; « c'est le gérant qui décide » devient « à
  confirmer » (décision 7). `14` § 2.6 : « noter la journée » et l'espace des salariés passent dans « pensés pour le
  téléphone » ; le reste de la paie reste « pensé pour l'ordinateur ».
- `15` : la restauration et le personnel (§ 3.15).
- `17` : la place de Personnel dans le menu et l'ordre de sortie.
- `docs/maquettes/paie-v2.html` : les mises à jour du § 2.2 (faites le 04/11/2026).
- `README.md` : le document 16 et son entrée au journal.

---

## 13. Sources

Dans le dépôt : `docs/paie.md`, `docs/hors-ligne.md` ; `docs/etudes/paie-concurrents.md`, `ETUDE-HESABI.md`,
`ETUDE-MARCHE.md` ; les documents du cadrage cités ; le code de `web/public/v10/` (`app.js`, `core.js`, `compta.js`,
`guide.js`, `visites.js`, `cabinet/app.js`), `web/public/plateforme/pont.js`, `serveur/paie/`, `serveur/v10/`,
`serveur/compta/paie.ts`, `serveur/caisse/routes.ts`, lus le 03/11/2026 à la révision `68b5779`.

Textes lus : [Code du travail, édition 2010](https://a-mla.org/sites/default/files/amla-import/Microsoft%20Word%20-%20Ctrav.doc_0.pdf) ;
[convention collective cadre](https://www.alphatunisie-ac.com/files/7893005069.pdf) (version d'avant 2011) ;
[loi organique 2004-63](https://legislation-securite.tn/wp-content/uploads/sites/5/2023/11/Loi-n%C2%B0-2004-63-du-27-Juillet-2004-Fr.pdf).

Textes rapportés : loi 2025-9 ([RDCTSS](https://journals.openedition.org/rdctss/11124),
[DLA Piper](https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2025/New-legislation-overhauling-Tunisias-employment-framework)) ;
loi 2024-44 ([WMC](https://www.webmanagercenter.com/2024/08/13/528908/reforme-des-conges-parentaux-en-tunisie-ce-que-prevoit-la-nouvelle-loi-de-2024/)) ;
SMIG 2026 ([WMC](https://www.webmanagercenter.com/2026/04/30/565875/hausse-du-smig-2026-bonne-nouvelle-sociale-ou-illusion-salariale-en-tunisie/)) ;
CSS 2026 ([La Presse](https://www.lapresse.tn/2026/01/14/contribution-sociale-de-solidarite-nouvelles-modalites-confirmees-pour-lannee-2026/)) ;
CIVP ([Tunisie Numérique](https://www.tunisienumerique.com/emploi-arret-a-partir-du-1er-octobre-2025-de-la-prolongation-des-contrats-civp/)) ;
CNSS ([CLEISS](https://www.cleiss.fr/docs/regimes/regime_tunisie_salaries.html)) ;
calendrier de la direction des impôts ([avril 2026](https://fr.allafrica.com/stories/202604040038.html)).

Concurrents (relevés le 03/11/2026 ; ce qu'on en dit est leur affirmation) : [Odoo, prix](https://www.odoo.com/pricing-plan),
[Odoo, RH](https://www.odoo.com/documentation/19.0/applications/hr.html) ; [Hesabi, tarifs](https://hesabi.tn/tarifs) ;
[Swifto RH](https://www.swifto.io/pages/fonctionnalites/rh.html) ; [TASSARUF](https://www.tassaruf.com/logiciel-gestion-paie-tunisie.html) ;
[PayFit](https://payfit.com/offre-starter) ; [Factorial](https://factorial.fr/tarifs) ;
[Combo, restauration](https://combohr.com/fr/secteur/restauration-traditionnelle) ;
[Skello, restauration](https://www.skello.io/industries/hotellerie-et-restauration) ;
[Kolonell, Tunis](https://kolonell.com/fr/blog/portail-rh-self-service-conges-notes-frais-tunis-2026).

---

## 14. Décisions de ce document

*Le 03/11/2026, Skander a validé le document entier (« Je suis d'accord avec tout ce que tu m'as dit ») : chaque ligne « proposé » ci-dessous est décidée,
ainsi que les huit décisions de l'En bref et les avis de Claude sur les quatre questions de prix du § 9. Ce qui est À
VÉRIFIER (le droit, les taux) le reste : aucune règle de droit n'entre avant la réponse du comptable ou du juriste.*

| Date | Décision |
|---|---|
| 03/11/2026 (**Skander** : « je suis d'accord avec ton cadrage . faut le faire go ») | La Paie devient **Personnel** : tout ce qui touche à une personne employée y passe (contrat, avenant, salaire, paiement, documents, départ) |
| 03/11/2026 (**Skander**, même phrase) | Le **planning de la semaine** est au lancement |
| 03/11/2026 (**Skander** : « je suis d'accord alors de tout sortir , il faut faire ce qu'on a deja fait la refonte et paie aussi ») | Tout sort des gros fichiers, Personnel le premier, dans son dossier (`17`) |
| 03/11/2026 (**Skander**, déjà au journal) | Les bulletins se préparent dès le 25 ; l'espace des salariés est au plan |
| 03/11/2026 (proposé) | Un seul module, une seule fiche par personne (pas une douzaine d'applications comme Odoo) |
| 03/11/2026 (proposé) | Quatre temps et trois onglets (Aujourd'hui, Le mois, L'équipe), une première fois en quatre questions, aucun geste d'aujourd'hui perdu (§ 2) |
| 03/11/2026 (proposé) | Au lancement aussi : le dossier complet, les échéances à ne pas oublier, le matériel confié, les listes de tâches, le salarié à l'heure ou à la journée, le rôle **Pointer** |
| 03/11/2026 (proposé) | En vague 1 avec la restauration : espace des salariés (la vague que le `14` laissait à fixer), pourboires, repas du personnel, extras déclarés, planning tiré des réservations |
| 03/11/2026 (proposé) | Les notes de frais (vague 3) vivent dans Personnel ; la procédure disciplinaire plus tard ; pas prévu : recrutement, évaluations et retours à 360°, enquêtes, organigramme |
| 03/11/2026 (proposé) | Les codes techniques gardent `paie` ; seuls les libellés deviennent « Personnel » |
| 03/11/2026 (proposé) | Les liens du § 4 suivent le sens des dépendances du `02` ; Personnel passe lui-même ses écritures par le moteur du socle, en totaux du mois |
| 03/11/2026 (proposé) | Un lien facultatif du salarié vers un membre ; le rôle Pointer limité par équipe, sans aucun montant |
| 03/11/2026 (proposé) | Le hors-ligne du § 7 (décision 2 de l'En bref) |
| 03/11/2026 (proposé) | Un bulletin payé ou remis est scellé, et corrigé ensuite sur le bulletin suivant (décision 3) ; la CIN et le RIB, déjà gardés en clair au serveur, chiffrés (décision 1) ; l'anonymisation après les durées de conservation (À VÉRIFIER) |
| 03/11/2026 (proposé) | Le gérant et le rôle Personnel décident des demandes (décision 7) |
| 03/11/2026 (proposé) | Seul ce qui change un montant bloque les bulletins (décision 4) ; les bulletins ne partent pas par e-mail au lancement (décision 5) |
| 03/11/2026 (proposé) | Les corrections urgentes du § 10.1 passent **avant** tout le reste ; aucune règle de droit ne change avant la réponse du comptable et du juriste, et d'ici là une règle nouvelle avertit sans bloquer |
| 03/11/2026 | Le prix ne change pas ici ; les quatre questions du § 9 se discutent avec Skander |
| 04/11/2026 (**Skander** : « je suis d'accord avec les trois chose a decider, on va le faire le prochain lot ») | Essentiel avec un cabinet qui tient la paie : le client saisit ses congés et ses avances (§ 9, question 3), le serveur le tient |
| 04/11/2026 (**Skander**, même phrase) | Paie vérifiée : payer avant la vérification du cabinet reste permis ; la fenêtre « Payer les salaires » le dit **avant** le geste (« Tu peux payer quand même. S'il trouve une erreur, elle se corrige sur le bulletin suivant. ») |
| 04/11/2026 (**Skander**, même phrase) | Les trois façons de faire la paie (seul, vérifiée, tenue) passent dans les nouveaux écrans **avant** le menu des six familles ; ensuite l'ordre du `17` reprend |
| 04/11/2026 (**Skander** : « es ce que t'as pensé au personne qui n'ont pas un comptable sur skanfact […] et pareil pour cabinet aussi, les entreprises (hors skanfact) aussi y'en aura beaucoup ») | Sans comptable sur SkanFact, rien ne parle d'un cabinet. L'entreprise qui **a quitté** son cabinet refait sa paie seule : le serveur le dit (`cabinetQuitte`), ses anciens bulletins ne la gardent plus « tenue ». Au Cabinet, un dossier **hors SkanFact** se tient de bout en bout : le cabinet note lui-même les salaires payés, après la validation (1.270.0, `docs/paie.md`) |
