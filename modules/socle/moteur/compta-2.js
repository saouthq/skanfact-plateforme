  // ---------------------------------------------------------------- le fichier des écritures (H3)
  //
  // Le FEC (« fichier des écritures comptables ») est la norme française de l'article A.47 A-1 du
  // LPF : dix-huit colonnes, une ligne par ligne d'écriture, séparées par une tabulation. La
  // Tunisie ne l'exige pas (À VÉRIFIER avec le comptable) ; il est pourtant la langue commune des
  // logiciels comptables — Sage, EBP, Cegid et la plupart des outils de révision l'importent tels
  // quels. C'est ce qui fait sa valeur ici : un cabinet qui tient ses dossiers ailleurs reprend nos
  // écritures sans une ligne de ressaisie, et un contrôleur qui le demande l'obtient.
  //
  // UN constructeur pour les deux applications : il prend des LIGNES (le contrat de
  // `entreesDepuisCsv`), jamais `data` — la règle de découpage de la 9.1.0. Ce que chaque
  // application sait mieux que lui (le nom d'un compte, le code d'un tiers, la date de validation)
  // lui est prêté par l'appelant.
  //
  // Ce qu'il REFUSE, parce qu'un logiciel qui l'importe le refusera aussi (la règle du TEIF, 10.15.0 :
  // un fichier qu'un tiers refusera ne s'écrit pas) : une pièce en brouillard (le FEC ne porte que
  // des écritures validées), une pièce sans numéro, une pièce déséquilibrée. Chaque refus nomme sa
  // pièce.
  const FEC_COLONNES = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
    'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
    'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
  // Un champ du FEC ne contient ni tabulation ni retour à la ligne (ce sont ses séparateurs), et
  // une cellule qu'un tableur exécuterait reçoit son apostrophe (9.1.1 : le fichier peut s'ouvrir
  // dans Excel).
  const fecTexte = v => {
    const t = String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return csvDangereux(t) ? '\'' + t : t;
  };
  // AAAAMMJJ, sans séparateur. Une date illisible reste vide : le refus la nommera.
  const fecDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[1] + m[2] + m[3] : ''; };
  // La virgule décimale, aucun séparateur de milliers, et le nombre de décimales de la devise
  // (trois pour le dinar : le millime compte). Compté en unités entières — jamais `toFixed` sur un
  // flottant, qui arrondit 1,0005 vers le bas.
  function fecMontant(n, decimales) {
    const d = decimales == null ? 3 : decimales;
    const f = Math.pow(10, d);
    const u = Math.round(Math.abs(num(n)) * f + 1e-7);
    const ent = Math.floor(u / f), dec = String(u % f).padStart(d, '0');
    return (num(n) < 0 && u ? '-' : '') + ent + (d ? ',' + dec : '');
  }
  // Le nom que la norme donne au fichier : l'identifiant de l'entreprise, « FEC », la date de
  // clôture. En France, le SIREN ; ici le matricule fiscal compacté (À VÉRIFIER : aucune règle
  // tunisienne ne le fixe).
  const fecNom = (identifiant, fin) => `${String(identifiant || '').toUpperCase().replace(/[^0-9A-Z]/g, '') || 'SKANFACT'}FEC${fecDate(fin) || '00000000'}.txt`;

  function fichierFec(lignes, opts) {
    const o = opts || {};
    const nomJournal = o.nomJournal || (c => c);
    const nomCompte = o.nomCompte || (() => '');
    const aux = o.aux || (() => null);
    const validation = o.dateValidation || (p => p.date);
    const dec = o.decimales == null ? 3 : o.decimales;
    const j = journalDepuisLignes(lignes || []);
    const refus = [];
    j.pieces.forEach(p => {
      const nom = `${p.journal || '?'} ${p.piece || '(sans référence)'} du ${fmtJour(p.date)}`;
      if (p.lignes.some(l => l.statut === 'brouillard')) refus.push({ piece: nom, motif: 'encore en brouillard : le FEC ne porte que des écritures validées' });
      else if (!p.numero) refus.push({ piece: nom, motif: 'sans numéro d\'écriture' });
      else if (!p.equilibree) refus.push({ piece: nom, motif: `déséquilibrée (débit ${fmtMontant(p.debit)}, crédit ${fmtMontant(p.credit)})` });
      else if (!fecDate(p.date)) refus.push({ piece: nom, motif: 'sans date lisible' });
    });
    const nom = fecNom(o.identifiant, o.fin || (j.pieces.length ? j.pieces[j.pieces.length - 1].date : ''));
    if (refus.length || !j.pieces.length) {
      return { ok: false, refus, nom, pieces: j.pieces.length, lignes: 0, debit: j.debit, credit: j.credit,
        vide: !j.pieces.length };
    }
    // L'ordre de la norme est celui des numéros : c'est l'ordre dans lequel les écritures ont été
    // validées, et un contrôle le vérifie (aucun trou, aucun retour en arrière).
    const pieces = j.pieces.slice().sort((a, b) => a.numero - b.numero || a.date.localeCompare(b.date));
    const rangs = [FEC_COLONNES.join('\t')];
    pieces.forEach(p => {
      const valide = fecDate(validation(p)) || fecDate(p.date);
      p.lignes.forEach(l => {
        const a = aux(l) || null;
        rangs.push([
          fecTexte(p.journal), fecTexte(nomJournal(p.journal)), String(p.numero), fecDate(p.date),
          fecTexte(l.account), fecTexte(nomCompte(l.account, l)),
          fecTexte(a ? a.num : ''), fecTexte(a ? a.lib : ''),
          fecTexte(p.piece || String(p.numero)), fecDate(l.pieceDate || p.date),
          fecTexte(l.label || l.libellePiece || p.piece), fecMontant(l.debit, dec), fecMontant(l.credit, dec),
          fecTexte(l.lettre), l.lettre && l.dateLettre ? fecDate(l.dateLettre) : '', valide,
          '', ''
        ].join('\t'));
      });
    });
    return {
      ok: true, refus: [], nom, texte: rangs.join('\r\n') + '\r\n',
      pieces: pieces.length, lignes: rangs.length - 1, debit: j.debit, credit: j.credit,
      du: pieces.reduce((m, p) => (!m || p.date < m ? p.date : m), ''),
      au: pieces.reduce((m, p) => (p.date > m ? p.date : m), '')
    };
  }
  return {
    round3, fmtMontant, fmtJour, jourDeLInstant, fmtMois, deMois, cleDePiece, csvDangereux, nombreDepuisCsv, nombreStrict, dateDepuisCsv,
    ecritureValide, entreesDepuisCsv,
    entriesBalance, entriesByAccount,
    balanceDepuisLignes, grandLivreDepuisLignes, balanceAuxiliaireDepuisLignes, collectifsDeTiers, COMPTES_TIERS,
    journalDepuisLignes, centralisateurDepuisLignes,
    lettrageDepuisLignes,
    // Le livre (9.2.0)
    LIVRE_FORMAT, STATUTS_ECRITURE, NATURES_COMPTE, SOURCES_ECRITURE, JOURNAUX_PAR_DEFAUT,
    PLAN_COMPTABLE, libelleDuPlan, migrerLivre,
    natureDeCompte, livreVide, exerciceDeReprise, isValidLivre, livreVersionInconnue, assurerCompte,
    ajouterEcriture, validerEcriture, contrepasser, importerPaquet, piecesDepuisLignes,
    lettrer, delettrer, prochaineLettre, balanceOuverture, lignesDuLivre,
    planDepuisCsv, balanceDepuisCsv,
    // La saisie (9.3.0)
    premierDuMoisSuivant, ajouterMoisIso, sansAccents, soldeDeLignes, comptesQuiCorrespondent, comptesProposables, MOTS_COURANTS, motsCourantsDe,
    modifierEcriture, supprimerEcriture, analyserImportEcritures, appliquerImportEcritures, lireFichierTexte, texteDeClasseur, rangeesDeTexte, separateurCsv, validerLot, extourner, prevoirExtourne, chercherEcritures, ceQuePorte,
    guideValide, ecritureDepuisGuide, occurrencesAGenerer,
    correspondanceValide, compteCorrespondant, appliquerCorrespondance,
    // La banque (9.5.0)
    RELEVE_NIVEAUX, RELEVE_JOURS, AGING_BUCKETS,
    colonnesReleve, releveDepuisCsv, releveValide, releveDejaImporte, ajouterReleve, supprimerReleve,
    lignesBancaires, lignesARapprocher, candidatsDeLigne, remiseDeLigne, facesDuRapprochement, piecesOuvertes, retenueDeReglement, reponsesDeLigne, ecritureDeReglement, rapprocherAuto, rapprocherLigne, derapprocherReleve, suspens,
    compteDuLibelle, regleAdmet, motifDeLibelle, ecritureProposee, lettrageAuto,
    echeancierDepuisLignes, balanceAgeeDepuisLignes,
    // La déclaration mensuelle (9.6.0)
    COMPTES_FISCAUX, CASES_A_VERIFIER, mouvementCompte, declarationMensuelle, controlesDeclaration,
    ecritureDeclaration, MOTIF_RIEN_A_ECRIRE, ecritureComplementDeclaration, ecartDeclaration, phraseEcartDeclaration, LIBELLES_CASES_DECL, formulaireMensuel, RUBRIQUES_FORMULAIRE,
    poserDeclaration, pointerDeclaration, etatDuMois,
    // Les immobilisations et l'inventaire (9.7.0)
    IMMO_METHODES, COMPTES_IMMO, IMMO_A_VERIFIER,
    bienVersActif, planDegressif, planDuBien, cumulDuBien, vncDuBien,
    resultatCession, repriseSubvention, immoValide,
    ajouterImmobilisation, modifierImmobilisation, supprimerImmobilisation,
    etatImmobilisations, aReclamerImmobilisations, immobilisationsACreer, biensDuClient, bienDuClientPourLaLigne, ficheDuClient, ecrituresImmobilisations, noterEcritureImmo,
    inventaireValide, lignesInventaireDepuisTexte, totalInventaire, poserInventaire, variationDeStock, ecritureFacturesNonParvenues, ecritureProvisionCreance, ecritureProvisionGaranties,
    // La clôture d'exercice (9.8.0)
    GUIDES_INVENTAIRE, controlesCloture, soldesDepuisOuverture, soldesRepris,
    cloturerExercice, rouvrirExercice, noterDossierCloture, anouveauxDe, ecritureAnouveaux, extournesDe,
    FIGE_A_LA_CLOTURE, empreinteFigee, refusExerciceClos,
    biensAReprendre, salariesAReprendre, reporterBiens, reporterSalaries, ouvrirExerciceSuivant,
    anEnVigueur, livreSuivantVide, ecartAnouveaux, lignesComplementAnouveaux, poserComplementAnouveaux, etatExerciceSuivant, dateDuMiroir,
    etatsDepuisLignes, groupesDesEtats, sigDepuisLignes, dossierDeCloture, clotureValide,
    // Le fichier des écritures (H3)
    FEC_COLONNES, fichierFec, fecMontant, fecNom,
    // La liasse et l'annuel (10.0.0)
    LIASSE_ETATS, MODELE_LIASSE, RETRAITEMENTS,
    modeleLiasse, migrerModeleLiasse, rubriqueDuCompte, liasseDepuisLignes,
    retraitementValide, resultatFiscal, employeurAnnuel,
    // (plateforme) 1.73.0 — les salaires de l'année par salarié, et leurs écarts avec le livre.
    salairesDeLAnnee, COLONNES_SALAIRES_ANNEE, ecartsEmployeur,
    // La révision et les questions (9.10.0)
    CYCLES_REVISION, QUESTION_STATUTS, QUESTION_ATTENDUS, QUESTION_RELANCE,
    cycleDuCompte, libelleCycle, nomDuCompte,
    revisionVide, revisionDe, assurerRevision, feuilleMaitresse, dossierDeRevision,
    signerCompte, ajouterNoteRevue, leverNoteRevue,
    poserQuestionnaire, repondreQuestionnaire, controlesRevision, arreterRevision,
    questionValide, ajouterQuestion, modifierQuestion, supprimerQuestion, fermerQuestion,
    questionsAEnvoyer, questionsOuvertes, questionsARelancer, dossierDeQuestions,
    noterEnvoiQuestions, noterReponsesQuestions, posterReponsesDansLivres, questionsValides,
    fusionnerQuestionsRecues, questionsDeLaPiece, repondreQuestion, reponsesAEnvoyer, reponsesApres, questionsSansReponse,
    // Le cabinet à plusieurs (9.9.0)
    fusionnerLivres, empreinteEcriture,
    // La paie (10.3.0)
    CONTRACT_TYPES, contractLabel, REGIME_TAUX, regimeDuContrat, normaliserRegimes, libelleRegime, DEFAULT_PAYROLL, baremesPaie,
    irppAnnual, computePayslip, employerChargesOf, CSS_JUSQU_AU, cssPoseePour, baremesNonRelus,
    COMPTES_PAIE, MOIS_PAIE, moisPaie, TRIMESTRES_PAIE,
    salarieValide, normaliserSalarie, ajouterSalarie, retirerSalarie, salariesActifs,
    bulletinsDuMois, bulletinValide, saisiePaieValide, ajouterBulletin, supprimerBulletin, masseSalariale, virementsRevenus, moisEmployeur,
    // (plateforme) 1.64.0
    baremesDuBulletin,
    // (plateforme) 1.68.0
    primesDuMois,
    // (plateforme) 1.69.0 — le pointage, et ce qu'il compte.
    LEAVE_KINDS, leaveIsPaid,
    // (plateforme) 1.70.0 — les congés.
    leaveKindLabel, workingDays, leaveDaysInMonth, leavesOf, leaveBalance, congeRetenu,
    CODES_POINTAGE, CODES_REPOS, libellePointage, pointageEnregistre, pointageDuMois, poserPointage, poserHeuresSup, heuresSupDuJour, poserHeuresSupDuJour, poserRetard, equipeDe, joursReposDe, ferieDu, lireBadges, importerBadges, journeeBadges, anomaliesPointage, poserSortie, majorationsHs, heuresSupDuMois, retardsDuMois, heuresDeNuitDuMois, reprisePointage, pointageSurBulletin,
    // Ce que les modules posent eux-mêmes (compta-1.js, `ajoutsDesModules`).
    ...ajoutsDesModules,
    saisieDuMois, brutDuMois, employeAuMois, regulsDuMois, saisiesOf, saisiesDuMois,
    // (plateforme) 1.256.0 — net → brut, l'ancienneté, les variables du mois, l'indemnité de licenciement.
    brutPourNet, anneesAnciennete, trancheAnciennete, primeAncienneteDuMois, variablesDuMois, indemniteLicenciement,
    // (plateforme) 1.71.0 — les avances.
    advancesOf, advanceBalance, echeancesDuMois, avancesDeLAnnee,
    // (plateforme) 1.72.0 — les documents du personnel.
    HR_DOCS, hrDocLabel, CIVILITES, indemniteConges, lignesDuSolde,
    ecritureDePaie, noterEcriturePaie, cnssDuTrimestre, controlesPaie,
    fichierCnss, fichierCnssDuLivre, lireMatriculeCnss, identiteCnss, motifIdentiteCnss, FORMAT_CNSS,
    // La pièce équilibrée et l'amortissement (9.6.1)
    ajouterJoursIso, entrySet,
    DEFAULT_ASSET_CLASSES, assetClassLabel, assetClassYears, days360,
    assetSchedule, assetCumulated, assetYear, assetNBV, disposalResult, cappedCumulated
  };
});
