// Logique métier partagée (calculs, numérotation, montants en lettres, template PDF, journal des ventes).
// Fonctionne dans le navigateur (window.SkanCore) et dans Node (module.exports) pour les tests.
//
// Depuis la 9.1.0, tout ce qui travaille sur des LIGNES d'écriture (et non sur `data`) vit dans
// `compta.js`, partagé avec l'application du cabinet : core.js le charge et en réexporte ce que ses
// appelants connaissaient déjà. Dans le navigateur, `compta.js` se charge donc AVANT core.js — un
// test relit les deux `index.html` et l'exige.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./compta'));
  else root.SkanCore = factory(root.SkanCompta);
})(typeof self !== 'undefined' ? self : this, function (Compta) {

  const VAT_RATES = [0, 7, 13, 19];
  // Taux de retenue à la source rencontrés en Tunisie. Ce sont des PROPOSITIONS, jamais une règle :
  // le taux applicable dépend de la nature de la prestation, du régime du client et de la loi de
  // finances de l'année — À VÉRIFIER avec le comptable. La liste a commencé à 1,5 % et un vrai
  // utilisateur s'est retrouvé bloqué parce que son client retient 1 % (8.3.0) : depuis, un taux
  // absent de la liste se saisit librement (« Autre taux… ») et rejoint les propositions, comme
  // pour les unités de ligne. Aucun calcul ne lit cette liste — elle ne remplit qu'un menu.
  const WITHHOLDING_RATES = [0, 0.5, 1, 1.5, 2.5, 3, 5, 10, 15, 20, 25];
  const PAYMENT_METHODS = [['virement', 'Virement'], ['cheque', 'Chèque'], ['especes', 'Espèces'], ['traite', 'Traite'], ['carte', 'Carte'], ['en_ligne', 'Paiement en ligne'], ['autre', 'Autre']];
  const PREFIX = { devis: 'DEV', facture: 'FAC', avoir: 'AVO', proforma: 'PRO', commande: 'BC', livraison: 'BL', contrat: 'CTR', ticket: 'TIC' };
  const TITLES = { devis: 'Devis', facture: 'Facture', avoir: 'Avoir', proforma: 'Facture proforma', commande: 'Bon de commande', livraison: 'Bon de livraison', contrat: 'Contrat de prestation' };
  // Les quatre types ajoutés en 2.6.0. Aucun n'a de valeur comptable : ils n'entrent ni dans le journal
  // des ventes, ni dans la TVA, ni dans le chiffre d'affaires. Seules la facture et l'avoir comptent.
  const EXTRA_TYPES = ['proforma', 'commande', 'livraison', 'contrat'];
  const SALES_TYPES = ['facture', 'avoir'];

  // Réglages d'une entreprise. Volontairement vides : SkanFact ne présuppose aucune société,
  // l'assistant de première utilisation les remplit. Voir onboarding dans app.js.
  const DEFAULT_COMPANY = {
    name: '',
    matricule: '',
    rc: '',
    cnss: '',                // matricule CNSS employeur (v6)
    capital: '',
    managerName: '',     // le gérant qui signe les documents du personnel (attestation, certificat)
    address: '',
    phone: '',
    email: '',
    website: '',
    rib: '',
    bank: '',
    logo: '',
    footer: '',           // vide : la ligne légale est composée à partir du nom et du matricule
    stampFee: 1.0,        // timbre fiscal (DT) par facture — À VÉRIFIER avec le comptable
    quoteValidityDays: 30,
    paymentTermsDays: 30,
    defaultWithholdingRate: 0,
    // Le MOYEN de paiement, pas son délai (10.12.0, H-E23) : la phrase disait « à réception de la
    // facture » pendant que la même facture imprime « À régler avant le … » à `paymentTermsDays`
    // jours. Deux délais sur une pièce légale, et c'était NOTRE défaut. Le délai s'imprime tout seul.
    paymentTerms: 'Paiement par virement bancaire.',
    quoteTerms: 'Pour accepter ce devis, retournez-le daté et signé avec la mention « Bon pour accord ».',
    paymentTermsEn: 'Payment by bank transfer.',
    quoteTermsEn: 'To accept this quote, please return it dated and signed with the mention "Approved".',
    currency: 'DT',
    defaultLang: 'fr',
    stampImage: '',       // cachet / signature (data URL) sur les documents
    theme: 'light',       // light | dark | auto
    tagline: '',
    accountantEmail: '',
    activity: '',         // secteur choisi à la première utilisation (voir ACTIVITIES)
    // Régime fiscal (7.22.0) : voir REGIMES. **Vide vaut « réel »**, donc assujetti à la TVA — une
    // installation antérieure n'a pas ce réglage et ne doit rien voir changer sur ses documents.
    taxRegime: '',
    primaryColor: '#1b2430',
    accentColor: '#0f9d8f',
    revenueTarget: 0,     // objectif de chiffre d'affaires HT pour l'année (0 = pas d'objectif)
    dormantDays: 180,     // au-delà, un client est considéré comme endormi dans les statistiques
    setupDone: false,     // l'assistant de première utilisation a été mené jusqu'au bout
    // Le taux de TVA des nouvelles lignes (7.1.0). Il valait 19 % en dur partout, y compris pour un
    // métier que l'assistant sait exonéré : quelqu'un qui choisissait « Santé et paramédical » (TVA
    // 0 %) obtenait un catalogue à 0 % et, dès qu'il tapait une ligne à la main, du 19 %. Vide = 19 %.
    defaultVatRate: '',
    // Les modules affichés dans la barre latérale (7.0.0). `null` = aucun choix enregistré, donc
    // toute l'application, comme avant : une installation existante ne perd rien à la mise à jour.
    // Un module absent de cette liste mais qui contient des données se montre quand même (moduleOn).
    modules: null
  };

  // ---------- le régime fiscal (7.22.0) ----------
  //
  // Ce qui décide de la TVA, c'est le RÉGIME de l'entreprise, pas son métier. Jusqu'ici chaque
  // secteur portait une colonne `vat` : un taux deviné à partir de l'activité. C'était faux dans les
  // deux sens — un kinésithérapeute au réel facture de la TVA, un informaticien au forfaitaire n'en
  // facture pas — et ça se voyait sur la pièce officielle, pas dans une console.
  //
  // La colonne a donc disparu des métiers, et la question est posée une fois, en clair.
  // `tva: false` ne se contente pas de mettre les taux à zéro : la colonne TVA quitte le document,
  // et la mention légale qui la remplace s'imprime à sa place — une facture sans TVA et sans mention
  // n'est pas une facture allégée, c'est une facture incomplète.
  //
  // Les mentions sont celles de l'usage tunisien — **À VÉRIFIER avec ton comptable** : elles
  // dépendent de la forme juridique et de l'article invoqué, et l'application le dit à l'écran.
  const REGIMES = [
    {
      id: 'reel', label: 'Réel — assujetti à la TVA', court: 'Assujetti TVA', tva: true, mention: '',
      aide: 'Tu factures la TVA à tes clients, tu la déclares chaque mois et tu déduis celle de tes achats. C\'est le régime le plus courant dès qu\'on dépasse les seuils.'
    },
    {
      id: 'forfaitaire', label: 'Forfaitaire — non assujetti à la TVA', court: 'Forfaitaire', tva: false,
      mention: 'TVA non applicable — régime forfaitaire', mentionEn: 'VAT not applicable — flat-rate tax regime',
      aide: 'Tu ne factures pas de TVA et tu ne la déduis pas. Tes factures portent la mention « TVA non applicable » et ne montrent aucune colonne TVA.'
    },
    {
      id: 'exonere', label: 'Exonéré de TVA', court: 'Exonéré', tva: false,
      mention: 'TVA non applicable — activité exonérée', mentionEn: 'VAT not applicable — VAT-exempt activity',
      aide: 'Ton activité est exonérée de TVA. Tu ne la factures pas, et la mention d\'exonération remplace la colonne TVA sur tes documents.'
    }
  ];

  // Le régime d'une entreprise. **Vide vaut « réel »** : une installation qui existait avant la
  // 7.22.0 n'a pas ce réglage, et elle ne doit rien voir changer sur ses documents.
  function regimeOf(company) {
    const id = ((company || {}).taxRegime || '').trim();
    return REGIMES.find(r => r.id === id) || REGIMES[0];
  }
  // Le régime que le métier rend probable. Il ne s'impose jamais : c'est l'assistant qui le
  // présélectionne, et un choix fait à la main ne se fait plus écraser (même règle que la durée
  // d'amortissement proposée par la famille d'un bien, 3.5.0).
  //
  // Pourquoi il existe : avant la 7.22.0, `ACTIVITIES` portait un taux de TVA, et « Santé et
  // paramédical » valait 0 %. En remplaçant ce taux par un régime fiscal, cette connaissance-là a
  // disparu — et l'application proposait 19 % à un kinésithérapeute qui venait de déclarer son
  // métier à l'écran précédent. Retirer un mécanisme n'autorise pas à perdre ce qu'il savait.
  function regimeSuggere(activityId) {
    const a = ACTIVITIES.find(x => x.id === String(activityId || '').trim());
    return (a && a.regime) || '';
  }
  // La TFP PROPOSÉE pour un métier (9.1.1). Elle rend `null` pour tous, et c'est voulu : la colonne
  // `tfp` d'ACTIVITIES est vide tant que le comptable n'a pas dit quels métiers relèvent du taux
  // réduit des industries manufacturières. Un chiffre écrit ici sans lui serait une règle de droit
  // gravée dans le code — et il partirait sur les bulletins de quelqu'un.
  //
  // Un test exige que RIEN n'y figure : si on ajoute un `tfp:` sans retirer sa garde, il tombe.
  // C'est ce qui empêche d'inventer ce chiffre en passant.
  function tfpSuggere(activityId) {
    const a = ACTIVITIES.find(x => x.id === String(activityId || '').trim());
    const n = a && a.tfp;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }
  // La seule question à poser au reste du code : cette entreprise facture-t-elle de la TVA ?
  function assujettiTVA(company) { return regimeOf(company).tva !== false; }
  // La mention qui REMPLACE la colonne TVA. Vide pour un assujetti : il a la colonne.
  // La mention se dit dans la langue de la pièce (10.14.1, MR-10) : « TVA non applicable » au milieu d'une
  // facture anglaise est une ligne que le client ne lit pas. Libellé anglais À VÉRIFIER avec le comptable.
  function mentionTVA(company, lang) { const r = regimeOf(company); return (lang === 'en' ? r.mentionEn : r.mention) || r.mention || ''; }
  // Le régime de TVA d'une pièce ÉMISE est celui du jour de son émission (10.14.1, MR-06) : il décide de
  // sa colonne TVA et de sa mention légale, et une pièce émise ne se réécrit pas (règle 7.1.x). Sans ça,
  // une facture émise au forfait réimprimée après le passage au réel perdait sa mention et gagnait une
  // colonne « TVA 0 % ». Un brouillon suit le régime du jour.
  function regimePourPiece(doc, company) {
    const d = doc || {};
    return d.regimeTva && d.status && d.status !== 'brouillon' ? { ...(company || {}), taxRegime: d.regimeTva } : (company || {});
  }

  // Secteurs proposés au premier démarrage : ils préremplissent le catalogue et le slogan.
  // Rien n'est imposé, tout se modifie ensuite.
  //
  // `honoraires: true` — profession libérale réglementée : sa facture s'appelle une **note
  //   d'honoraires**. C'est le nom que le client attend et que le comptable classe ; le type de la
  //   pièce, sa numérotation (FAC-) et sa valeur comptable ne changent pas d'un iota.
  // `comptant: true`  — on est payé sur place, en espèces ou par carte. Le RIB n'est alors pas
  //   réclamé comme un manque : on ne reproche pas à un restaurant de ne pas publier son RIB.
  // Plus de colonne `vat` : voir REGIMES ci-dessus.
  const ACTIVITIES = [
    {
      id: 'informatique', label: 'Informatique et cybersécurité', tagline: 'Cybersécurité · Infrastructure · Services informatiques',
      catalog: [
        ['Audit de sécurité réseau', 'Cartographie, scan de vulnérabilités, rapport et plan d\'action', 1200, 'forfait'],
        ['Maintenance et supervision', 'Surveillance des équipements, mises à jour, intervention sous 24 h', 250, 'mois'],
        ['Installation poste de travail', 'Préparation, sécurisation et mise en réseau d\'un poste', 120, 'u'],
        ['Sauvegarde externalisée', 'Sauvegarde chiffrée automatique avec vérification mensuelle', 90, 'mois'],
        ['Déplacement', 'Frais de déplacement', 60, 'u']
      ]
    },
    {
      id: 'batiment', label: 'Bâtiment et travaux', tagline: 'Construction · Rénovation · Second œuvre',
      catalog: [
        ['Main-d\'œuvre', 'Heure de travail sur chantier', 25, 'h'],
        ['Déplacement et installation de chantier', '', 150, 'forfait'],
        ['Fourniture de matériaux', 'Refacturation des matériaux, sur justificatifs', 0, 'lot'],
        ['Évacuation des gravats', '', 200, 'forfait']
      ]
    },
    {
      id: 'conseil', label: 'Conseil, formation et services', tagline: 'Conseil · Accompagnement · Formation',
      catalog: [
        ['Journée de conseil', 'Intervention sur site ou à distance', 600, 'jour'],
        ['Formation', 'Session pour un groupe, support fourni', 150, 'h'],
        ['Rédaction de livrable', 'Rapport, procédure, cahier des charges', 400, 'forfait'],
        ['Suivi mensuel', 'Point régulier et disponibilité par email', 300, 'mois']
      ]
    },
    {
      id: 'commerce', label: 'Commerce et vente de produits', tagline: '', comptant: true,
      catalog: [
        ['Produit', 'Désignation du produit vendu', 0, 'u'],
        ['Livraison', 'Frais de livraison', 15, 'u'],
        ['Installation / mise en service', '', 80, 'u']
      ]
    },
    {
      // `regime` est une PROPOSITION, pas une règle : l'assistant la présélectionne et l'utilisateur
      // reste libre d'en choisir une autre. Les actes médicaux et paramédicaux sont exonérés de TVA
      // en Tunisie — À VÉRIFIER avec le comptable, comme tout le reste de la fiscalité ici.
      id: 'sante', label: 'Santé et paramédical', tagline: '', honoraires: true, comptant: true, regime: 'exonere',
      catalog: [
        ['Consultation', '', 50, 'séance'],
        ['Séance de suivi', '', 40, 'séance'],
        ['Déplacement à domicile', '', 20, 'u']
      ]
    },
    {
      id: 'artisanat', label: 'Artisanat et création', tagline: 'Fait main · Sur mesure',
      catalog: [
        ['Pièce sur mesure', 'Création personnalisée', 0, 'u'],
        ['Main-d\'œuvre', 'Heure de travail en atelier', 20, 'h'],
        ['Matières premières', '', 0, 'lot']
      ]
    },
    {
      id: 'restauration', label: 'Restauration, café et traiteur', tagline: 'Cuisine · Service · Traiteur', comptant: true,
      catalog: [
        ['Menu du jour', 'Entrée, plat, dessert', 18, 'couvert'],
        ['Prestation traiteur', 'Sur devis, selon le nombre de convives', 35, 'couvert'],
        ['Location de salle', 'Demi-journée, mise en place comprise', 400, 'forfait'],
        ['Service et personnel', 'Serveur mis à disposition', 25, 'h']
      ]
    },
    {
      id: 'transport', label: 'Transport et logistique', tagline: 'Transport · Livraison · Stockage',
      catalog: [
        ['Course urbaine', 'Enlèvement et livraison dans le Grand Tunis', 25, 'course'],
        ['Transport longue distance', 'Facturé au kilomètre parcouru', 1.2, 'km'],
        ['Manutention', 'Chargement et déchargement', 20, 'h'],
        ['Stockage', 'Entreposage en dépôt', 8, 'm²']
      ]
    },
    {
      id: 'immobilier', label: 'Immobilier et gestion locative', tagline: 'Transaction · Gestion · Syndic',
      catalog: [
        ['Commission de transaction', 'Pourcentage du prix de vente, selon mandat', 0, 'forfait'],
        ['Gestion locative', 'Gestion mensuelle d\'un bien loué', 80, 'mois'],
        ['État des lieux', 'Entrée ou sortie, avec rapport photographique', 120, 'u'],
        ['Syndic de copropriété', 'Par lot et par mois', 15, 'mois']
      ]
    },
    {
      id: 'juridique', label: 'Professions juridiques', tagline: 'Conseil · Rédaction · Représentation', honoraires: true,
      catalog: [
        ['Consultation juridique', 'Rendez-vous au cabinet ou à distance', 150, 'h'],
        ['Rédaction d\'acte', 'Contrat, statuts, bail', 500, 'forfait'],
        ['Représentation en justice', 'Honoraires de plaidoirie, hors frais et débours', 0, 'forfait'],
        ['Frais et débours', 'Avancés pour le compte du client, sur justificatifs', 0, 'lot']
      ]
    },
    {
      id: 'comptabilite', label: 'Comptabilité et expertise', tagline: 'Tenue · Fiscalité · Conseil', honoraires: true,
      catalog: [
        ['Tenue de comptabilité', 'Saisie, lettrage et déclarations mensuelles', 350, 'mois'],
        ['Bilan annuel', 'États financiers et liasse fiscale', 1500, 'forfait'],
        ['Établissement des bulletins de paie', 'Par bulletin et par mois', 15, 'bulletin'],
        ['Assistance à contrôle fiscal', '', 200, 'h']
      ]
    },
    {
      id: 'architecture', label: 'Architecture et ingénierie', tagline: 'Conception · Études · Suivi de chantier', honoraires: true,
      catalog: [
        ['Esquisse et avant-projet', '', 2000, 'forfait'],
        ['Dossier de permis de bâtir', 'Pièces graphiques et écrites', 3500, 'forfait'],
        ['Suivi de chantier', 'Visite hebdomadaire et compte rendu', 500, 'mois'],
        ['Métré et étude technique', '', 120, 'h']
      ]
    },
    {
      id: 'communication', label: 'Communication, design et audiovisuel', tagline: 'Identité · Web · Image',
      catalog: [
        ['Identité visuelle', 'Logo, charte graphique et déclinaisons', 1800, 'forfait'],
        ['Site internet vitrine', 'Conception, intégration et mise en ligne', 3000, 'forfait'],
        ['Journée de tournage ou de prise de vue', 'Matériel et opérateur compris', 700, 'jour'],
        ['Gestion des réseaux sociaux', 'Publications et modération', 450, 'mois']
      ]
    },
    {
      id: 'beaute', label: 'Beauté et bien-être', tagline: 'Soins · Coiffure · Bien-être', comptant: true,
      catalog: [
        ['Coupe et coiffage', '', 35, 'séance'],
        ['Soin du visage', '', 60, 'séance'],
        ['Massage', 'Séance d\'une heure', 70, 'séance'],
        ['Forfait mariée', 'Essai, coiffure et maquillage le jour J', 350, 'forfait']
      ]
    },
    {
      id: 'automobile', label: 'Automobile et mécanique', tagline: 'Entretien · Réparation · Carrosserie', comptant: true,
      catalog: [
        ['Main-d\'œuvre atelier', 'Heure de travail', 35, 'h'],
        ['Vidange et filtres', 'Huile et filtres compris', 120, 'forfait'],
        ['Diagnostic électronique', '', 60, 'u'],
        ['Pièces détachées', 'Refacturation des pièces, sur justificatifs', 0, 'lot']
      ]
    },
    { id: 'autre', label: 'Autre activité', tagline: '', catalog: [] }
  ];

  // Une facture de profession libérale s'appelle une NOTE D'HONORAIRES. Ce n'est pas un type de
  // pièce en plus : même préfixe, même numérotation, même valeur comptable, même verrouillage à
  // l'émission. C'est le nom qu'attend le client et sous lequel le comptable la classe.
  // Le libellé se DÉDUIT du métier à l'affichage, il n'est pas figé sur la pièce : ce n'est pas un
  // montant, et changer de métier ne doit pas laisser derrière soi des pièces à deux noms.
  function estLiberal(company) {
    const a = ACTIVITIES.find(x => x.id === ((company || {}).activity || '').trim());
    return !!(a && a.honoraires);
  }
  function docLabel(type, company, lang) {
    if (type === 'facture' && estLiberal(company)) return lang === 'en' ? 'Fee note' : 'Note d\'honoraires';
    return TITLES[type] || 'Document';
  }

  // Le RIB n'est réclamé que si on attend un virement. Un restaurant, un salon de coiffure ou un
  // commerce sont payés sur place : leur reprocher un RIB manquant, c'est afficher « ta fiche est
  // incomplète » à quelqu'un qui n'a rien à corriger — et les avertissements qu'on ne peut pas
  // satisfaire, on cesse de les lire. Métier inconnu = on le réclame, comme avant.
  function ribAttendu(company) {
    const a = ACTIVITIES.find(x => x.id === ((company || {}).activity || '').trim());
    return !(a && a.comptant);
  }

  // ---------- les modules et la barre latérale (7.0.0) ----------
  //
  // Pourquoi cette liste existe : la barre latérale vivait en dur dans index.html, 19 liens écrits à
  // la main, et `setWindowTitle` relisait le TEXTE du lien pour composer le titre de la fenêtre. À
  // dix-neuf entrées elle ne tenait plus sur aucun écran : à 1440×900 « Paramètres » et « Aide »
  // étaient hors champ, et « Aide » l'était même à 1680×1050. Quelqu'un qui se perd cherche le bouton
  // Aide ; il était sous le plancher.
  //
  // On ne retire aucune fonction : on les présente dans l'ordre. Un module que l'utilisateur n'a pas
  // demandé reste atteignable par la palette, par son adresse et par la page « Tous les modules ».
  //
  // `toujours: true` = le cœur du métier, jamais masquable.
  // `compte(data)`   = ce que le module contient. C'est LE garde-fou : un module qui contient quelque
  //                    chose se montre tout seul, quoi qu'en dise le réglage. On ne cache jamais le
  //                    travail de quelqu'un — surtout pas celui qu'il a saisi avant de changer d'avis.
  const MODULES = [
    { id: 'ventes', label: 'Devis et factures', toujours: true,
      quoi: 'Proposer un prix, facturer, se faire payer.',
      pages: ['devis', 'factures', 'relances'] },
    { id: 'fichiers', label: 'Clients et catalogue', toujours: true,
      quoi: 'Les gens à qui tu vends et ce que tu vends.',
      pages: ['clients', 'catalogue'] },
    { id: 'caisse', label: 'Caisse',
      quoi: 'Vendre au comptoir : scanner ou choisir un article, encaisser, imprimer un ticket de 80 mm.',
      pages: ['caisse'],
      compte: d => (d.documents || []).filter(estTicket).length },
    { id: 'pieces', label: 'Proforma, bons et contrats',
      quoi: 'Les pièces qui entourent la facture : proforma, bon de commande, bon de livraison, contrat à signer, et la facturation qui se répète toute seule.',
      pages: ['autres', 'contrats'],
      compte: d => (d.documents || []).filter(x => EXTRA_TYPES.includes(x.type)).length + (d.recurring || []).length },
    { id: 'achats', label: 'Achats et fournisseurs',
      quoi: "Ce que tu dépenses, et la TVA que tu récupères dessus.",
      pages: ['achats', 'fournisseurs'],
      compte: d => (d.purchases || []).length + (d.suppliers || []).length },
    { id: 'stock', label: 'Stock et garanties',
      quoi: 'Ce qui dort sur l\'étagère, et le matériel installé chez tes clients.',
      pages: ['stock', 'garanties'],
      compte: d => (d.stockAdjustments || []).length + (d.serials || []).length
        + (d.catalog || []).filter(c => c.tracked).length },
    { id: 'immos', label: 'Immobilisations',
      quoi: 'Ce que tu gardes : matériel, véhicule, mobilier — et ce que ça coûte chaque année.',
      pages: ['immos'],
      compte: d => (d.assets || []).length },
    { id: 'paie', label: 'Salariés et paie',
      quoi: 'Bulletins, congés, avances et déclarations sociales.',
      pages: ['paie'],
      compte: d => (d.employees || []).length + (d.payslips || []).length },
    { id: 'pilotage', label: 'Trésorerie, marges, statistiques',
      quoi: "Est-ce que tu as de quoi payer le mois prochain, et est-ce que tu gagnes de l'argent ?",
      pages: ['tresorerie', 'marges', 'stats'],
      compte: d => (d.accounts || []).length + (d.movements || []).length + (d.projects || []).length },
    { id: 'compta', label: 'Comptabilité', toujours: true,
      quoi: 'Ce que tu donnes à ton comptable : journaux, TVA, écritures, clôtures, paquet mensuel.',
      pages: ['compta'],
      // Les écrans de 8.8.0 → 9.0.0 (grand livre, balance, états financiers, livre-journal, OD,
      // lettrage) sont un SOUS-MODULE, pas un second module : `compta` existe depuis longtemps et
      // porte les journaux, la TVA, les clôtures et le paquet du comptable — tout ce qu'une PME
      // doit pouvoir faire sans rien payer de plus.
      //
      // Décision du 15/09/2026 (`DIRECTION.md`) : l'app entreprise s'arrête à la gestion, et cette
      // comptabilité-là devient une OPTION payante, masquée par défaut. Masquer, pas supprimer :
      // le moteur continue d'écrire le paquet du comptable, qui reste libre.
      sousModules: [{
        id: 'compta.livres',
        label: 'Grand livre, balance, états financiers',
        option: 'compta',
        defaut: false,
        onglets: ['grandlivre', 'balance', 'etats'],
        quoi: 'Grand livre, balance, livre-journal, états financiers. Dans l\'offre Complet, et pendant l\'essai. Tes écritures, ta TVA, tes clôtures et le paquet de ton comptable restent disponibles sans eux.'
      }] }
  ];

  // Les pages, dans l'ordre de la barre latérale. `titre` sert à la fois au lien, au titre de la
  // fenêtre et à la palette — une seule source, sinon les trois divergent (et ils divergeaient).
  //
  // `famille` est l'intertitre affiché. Elle ne suit PAS le découpage en modules : un intertitre par
  // module en ferait huit, et huit intertitres coûtent 250 px de barre — on aurait remplacé un
  // débordement par un autre. Les modules décident de ce qui s'affiche, les familles de comment
  // c'est rangé. « Fichiers » a disparu : personne ne cherche un client dans « Fichiers ».
  const PAGES = [
    { id: 'dashboard', titre: 'Accueil', module: null, hash: '#/dashboard' },
    { id: 'devis', titre: 'Devis', module: 'ventes', famille: 'Vendre',
      quoi: 'Proposer un prix à un client, avant de travailler.' },
    { id: 'factures', titre: 'Factures', module: 'ventes', famille: 'Vendre', vueNom: 'Les factures',
      quoi: 'Réclamer l\'argent du travail fait : la pièce officielle, numérotée et définitive.' },
    // (1.269.0 ; Skander, 04/11/2026 : 17 § 1) Une « vue » d'une page (`vueDe`, la même que sa fiche) quitte les volets du
    // menu : elle s'ouvre par la bande des vues de sa page. Son adresse, la palette et « Au quotidien » y mènent toujours.
    { id: 'relances', titre: 'Relances', module: 'ventes', famille: 'Vendre', vueDe: 'factures', vueNom: 'En retard',
      quoi: 'Les factures en retard de paiement, et le message à envoyer pour chacune.' },
    { id: 'caisse', titre: 'Caisse', module: 'caisse', famille: 'Vendre',
      quoi: 'Vendre au comptoir : le panier, l\'encaissement, le ticket, et le bilan de la journée.' },
    { id: 'clients', titre: 'Clients', module: 'fichiers', famille: 'Vendre',
      quoi: 'Les gens et les entreprises à qui tu vends : coordonnées, historique, ce qu\'ils te doivent.' },
    { id: 'catalogue', titre: 'Catalogue', module: 'fichiers', famille: 'Articles et stock',
      quoi: 'Ce que tu vends, avec son prix : pour insérer une ligne dans un devis sans la retaper.' },
    // Les prix par client ou par catégorie de clients, avec leurs dates (plateforme, brique 93).
    { id: 'listesprix', titre: 'Listes de prix', module: 'fichiers', famille: 'Articles et stock',
      quoi: 'Des prix à part pour un client ou une catégorie de clients (revendeurs, chantiers…), à partir d\'une date.' },
    // « Contrats » menait aux contrats RÉCURRENTS (les périodicités qui fabriquent des factures) ;
    // le contrat que le client signe est un onglet d'« Autres documents ». Quelqu'un qui veut
    // rédiger un contrat cliquait donc « Contrats », tombait sur des jours de facturation, et
    // concluait que SkanFact n'en fait pas. Deux libellés, et le mot « contrat » retrouve son sens.
    // `quoi` sur la PAGE : les entrées d'un même module partageaient l'infobulle du module, donc
    // trois pages de la famille « Piloter » affichaient au survol exactement la même phrase.
    { id: 'autres', titre: 'Autres pièces', module: 'pieces', famille: 'Vendre', vueNom: 'Proforma, bons et contrats',
      quoi: 'Proforma, bon de commande, bon de livraison, le contrat que ton client signe, et ce qui se facture tout seul chaque mois.' },
    { id: 'contrats', titre: 'Facturation récurrente', module: 'pieces', famille: 'Vendre', vueDe: 'autres', vueNom: 'Facturation récurrente',
      quoi: 'Les factures qui se répètent toutes seules : abonnement, maintenance, forfait mensuel.' },
    { id: 'achats', titre: 'Achats', module: 'achats', famille: 'Acheter',
      quoi: 'Ce que tu dépenses, pièce par pièce, et la TVA que tu récupères dessus.' },
    // Ce qu'on commande à ses fournisseurs, et ce qu'on en reçoit (plateforme, brique 87).
    { id: 'commandesf', titre: 'Commandes fournisseurs', module: 'achats', famille: 'Acheter',
      quoi: 'Ce que tu commandes à tes fournisseurs, et ce que tu en as reçu : le reste à recevoir, ligne par ligne.' },
    { id: 'fournisseurs', titre: 'Fournisseurs', module: 'achats', famille: 'Acheter',
      quoi: 'Les gens à qui tu achètes, et ce que tu leur dois encore.' },
    { id: 'stock', titre: 'Stock', module: 'stock', famille: 'Articles et stock' },
    { id: 'garanties', titre: 'Garanties', module: 'stock', horsMenu: true },
    { id: 'immos', titre: 'Immobilisations', module: 'immos', famille: 'Argent', vueDe: 'compta', vueNom: 'Immobilisations' },
    { id: 'tresorerie', titre: 'Trésorerie', module: 'pilotage', famille: 'Argent',
      quoi: 'Ce que tu as vraiment en caisse et en banque, et si ça tiendra le mois prochain.' },
    { id: 'marges', titre: 'Marges', module: 'pilotage', famille: 'Piloter',
      quoi: 'Ce que chaque client et chaque prestation te rapporte vraiment, une fois les achats déduits.' },
    { id: 'stats', titre: 'Statistiques', module: 'pilotage', famille: 'Piloter',
      quoi: 'Ton chiffre d\'affaires dans le temps, comparé à l\'an dernier : ce qui monte, ce qui baisse.' },
    { id: 'paie', titre: 'Paie', module: 'paie', famille: 'Personnel' },
    { id: 'compta', titre: 'Comptabilité', module: 'compta', famille: 'Argent', vueNom: 'Livres et déclarations' },
    { id: 'modules', titre: 'Tous les modules', module: null, horsMenu: true },
    // La page de l'ÉDITEUR de SkanFact (7.33.0) : les licences qu'il a émises. Hors menu ici parce
    // que sa présence dépend du POSTE (la clé privée existe-t-elle sur cet ordinateur ?), que la
    // barre ajoute elle-même quand c'est le cas — jamais d'un réglage du dossier.
    { id: 'licences', titre: 'Licences', module: null, horsMenu: true,
      quoi: 'Les licences SkanFact que tu as émises : à qui, quelle offre, jusqu\'à quand.' },
    // (plateforme, lot messagerie) Le fil avec le cabinet : hors du menu des modules, le pied de la barre la montre quand
    // un cabinet tient le dossier (plateforme/messagerie.js).
    { id: 'comptable', titre: 'Mon comptable', module: null, horsMenu: true,
      quoi: 'Tes échanges avec ton cabinet comptable : ses messages, ses questions, les pièces qu\'il te demande.' },
    // (plateforme, Support S1) Les demandes au support de SkanFact et leurs réponses : l'Aide y mène.
    { id: 'support', titre: 'Tes demandes au support', module: null, horsMenu: true,
      quoi: 'Tes demandes à l\'équipe SkanFact et ses réponses : y répondre, dire que c\'est réglé.' },
    { id: 'parametres', titre: 'Paramètres', module: null, pied: true },
    { id: 'aide', titre: 'Aide', module: null, pied: true }
  ];

  // ---------- le canal de mise à jour (7.25.0) ----------
  //
  // Une version de test porte un suffixe : `7.26.0-beta.1`. C'est le NUMÉRO qui dit ce qu'elle est,
  // rien d'autre — pas un drapeau posé à la construction, pas un réglage du dépôt, pas une case
  // cochée quelque part. Un drapeau s'oublie ; un numéro de version, non : il est écrit dans le
  // paquet, dans la release, dans l'écran des mises à jour et dans le nom du fichier téléchargé.
  //
  // electron-builder applique exactement la même règle : un numéro avec `-beta.1` produit
  // `beta.yml` / `beta-mac.yml` au lieu de `latest.yml`. Les deux moitiés du système lisent donc la
  // même source de vérité, et il n'y a aucun moyen de les désaccorder.
  function canalDe(version) {
    const m = /^\d+\.\d+\.\d+-([A-Za-z][A-Za-z0-9]*)/.exec(String(version || '').trim());
    return m ? m[1].toLowerCase() : 'latest';
  }
  function estBeta(version) { return canalDe(version) !== 'latest'; }

  // ---------- la pastille de licence (8.0.1) ----------
  //
  // Jusqu'à la 8.0.1, la pastille de la barre de gauche n'apparaissait qu'à SEPT jours de la fin de
  // l'essai. Pendant vingt-trois jours, une installation neuve n'affichait donc nulle part qu'elle
  // était en essai — ni même que SkanFact se paie : l'assistant se passe, et le panneau Paramètres →
  // L'application → Licence, personne ne l'ouvre sans raison. On l'apprenait le trente-et-unième
  // jour, en étant bloqué. Un essai dont personne ne sait qu'il court n'est pas un essai, c'est une
  // surprise — et c'est très exactement ce que tout le reste de l'application s'interdit.
  //
  // L'autre travers serait le nagware : un bandeau qui crie « 28 jours restants » tous les matins
  // cesse d'être lu, et emmène avec lui les messages qui comptent. D'où TROIS tons, et pas deux :
  //   calme  — l'essai court, on informe (gris discret, à côté du numéro de version) ;
  //   attire — il reste sept jours d'essai, ou quatorze sur une licence payante : il faut agir ;
  //   alerte — la création est bloquée.
  //
  // Pure et testée sans Electron : c'est la règle qui se teste, pas la forme du renderer.
  function pastilleLicence(lic, chemin) {
    const l = lic || {};
    const j = l.daysLeft;
    if (l.locked) return { show: true, ton: 'alerte', texte: (l.label || 'Licence requise') + ' — voir ' + (chemin || 'Paramètres → L\'application → Licence') };
    if (l.state === 'essai' && j != null) {
      const reste = `Essai — ${j} jour${j === 1 ? '' : 's'}`;
      return j <= 7
        ? { show: true, ton: 'attire', texte: reste + (j === 0 ? ' : dernier jour' : ' avant la fin') }
        : { show: true, ton: 'calme', texte: reste };
    }
    // Une licence payante qui se termine se dit ici aussi : sans ça, un client verrouillé un matin
    // n'aurait été prévenu nulle part ailleurs que dans un panneau qu'il n'ouvre jamais.
    if (l.state === 'active' && j != null && j <= 14) {
      return { show: true, ton: 'attire', texte: (l.label || '') + ' — pense à la renouveler' };
    }
    return { show: false, ton: '', texte: '' };
  }

  // ---------- l'empreinte d'un cabinet (8.1.0) ----------
  //
  // Une empreinte est le condensé SHA-256 de la clé publique du cabinet, réduit à vingt caractères
  // HEXADÉCIMAUX et groupé par quatre (`src/zip.js`, `keyFingerprint`) — assez court pour être dicté
  // au téléphone. Et c'est exactement pour ça qu'elle se trompe : elle arrive chez l'éditeur recopiée
  // d'un message, d'un appel ou d'une capture.
  //
  // Ce qu'on PEUT vérifier ici : la forme. Une empreinte mal recopiée ne désigne aucun cabinet, donc
  // la preuve du parrainage ne vaut rien et la remise n'est rattachable à personne — et ça ne se voit
  // jamais, parce que rien ne plante.
  // Ce qu'on ne peut PAS vérifier : qu'elle appartienne à un vrai cabinet. Il faudrait sa clé
  // publique, que l'éditeur n'a pas. L'écran doit le dire au lieu d'afficher un vert rassurant.
  //
  // La saisie est tolérante (minuscules, espaces, tirets absents ou en trop) mais la validation ne
  // l'est pas : on retire les SÉPARATEURS, puis on exige vingt caractères hexadécimaux. Retirer tout
  // ce qui n'est pas hexadécimal laisserait passer un « G » tapé à la place d'un « 6 » en décalant
  // tout le reste — la faute deviendrait invisible au lieu d'être signalée.
  function empreinteCabinet(txt) {
    const brut = String(txt == null ? '' : txt).trim();
    if (!brut) return { ok: false, valeur: '', raison: 'vide' };
    const nu = brut.replace(/[\s.:_-]/g, '').toUpperCase();
    if (!/^[0-9A-F]*$/.test(nu)) return { ok: false, valeur: brut, raison: 'caracteres' };
    if (nu.length !== 20) return { ok: false, valeur: brut, raison: nu.length < 20 ? 'courte' : 'longue', longueur: nu.length };
    return { ok: true, valeur: nu.match(/.{4}/g).join('-'), raison: '' };
  }

  // Les licences déjà émises qui portent cette empreinte : c'est la seule corroboration disponible
  // hors ligne. Un cabinet qui a déjà parrainé quelqu'un est un cabinet dont l'empreinte a déjà été
  // recopiée juste au moins une fois.
  function licencesDuCabinet(licences, empreinte, sauf) {
    const e = empreinteCabinet(empreinte);
    if (!e.ok) return [];
    // La licence du cabinet LUI-MÊME (9.4.0) porte aussi son empreinte — comme sujet, pas comme
    // parrainage. Elle ne compte pas parmi « les clients qu'il a amenés ».
    return (licences || []).filter(l => l && l.id !== sauf && l.type !== 'cabinet' && empreinteCabinet(l.cabinet).valeur === e.valeur);
  }

  // ---------- tout effacer (7.0.0) ----------
  //
  // « Tout effacer » vidait sept listes sur trente, parce qu'elle était écrite à la main et qu'aucun
  // des treize modules ajoutés depuis n'y a été ajouté. Après avoir chargé le jeu d'exemple puis
  // cliqué « Tout effacer », il restait donc de faux fournisseurs, de faux salariés avec de faux
  // numéros CIN, de faux bulletins, de faux comptes bancaires et de faux amortissements.
  //
  // La liste ne s'écrit plus : elle se DÉDUIT de DEFAULT_DATA. Un module ajouté demain est vidé sans
  // que personne y pense, et un test vérifie qu'aucune clé n'y échappe.
  //
  // `garderSociete` : la fiche société (nom, logo, cachet, RIB, réglages) n'est pas une donnée de
  // travail, c'est l'identité de l'entreprise — on ne la jette pas en effaçant des factures. Sauf
  // si elle vient du jeu d'exemple : garder « DÉMO — Société de services SUARL » et son faux RIB,
  // c'est envoyer la première vraie facture avec un matricule inventé et un compte qui n'existe pas.
  const GARDE_A_LA_RACINE = ['version', 'company'];
  function wipeData(data, opts) {
    const o = opts || {};
    const out = data;
    Object.keys(DEFAULT_DATA).forEach(k => {
      if (GARDE_A_LA_RACINE.includes(k)) return;
      const vide = DEFAULT_DATA[k];
      out[k] = Array.isArray(vide) ? [] : (vide && typeof vide === 'object') ? {} : vide;
    });
    if (!o.garderSociete) out.company = { ...DEFAULT_COMPANY, ...(o.company || {}) };
    else if (out.company) { rendreLesEmprunts(out.company); delete out.company.demo; }
    return out;
  }

  // Les champs que le jeu d'exemple a PRÊTÉS à une fiche société qui en avait déjà une.
  //
  // L'assistant invite explicitement à laisser le matricule fiscal et le RIB vides (« si tu ne l'as
  // pas encore, laisse vide »). L'exemple les remplissait alors avec les siens ; comme la raison
  // sociale, elle, était renseignée, la fiche n'était pas considérée comme empruntée et plus rien
  // ne les enlevait. Les trois contrôles de conformité — `companyGaps`, « Tes premiers pas »,
  // l'avertissement d'émission — ne regardent que la PRÉSENCE d'une valeur : ils annonçaient donc
  // en vert « tes documents sont en règle » sur un matricule fiscal inventé.
  function rendreLesEmprunts(company) {
    if (!company) return company;
    (company.demoFields || []).forEach(k => { company[k] = DEFAULT_COMPANY[k] !== undefined ? DEFAULT_COMPANY[k] : ''; });
    delete company.demoFields;
    return company;
  }

  // Le jeu d'exemple se reconnaît : sans ça, on ne peut ni le signaler à l'écran, ni proposer d'en
  // sortir, ni empêcher sa fausse identité de servir à une vraie facture.
  const estDemo = data => !!(data && data.demo);

  // Un jeu d'exemple est RELATIF à aujourd'hui, et il est enrichi de version en version. Personne ne
  // pense à l'effacer puis à le recharger : la décision se prend donc toute seule, et elle vit ici,
  // pure et testable, plutôt que dans la séquence de démarrage où rien ne peut la vérifier.
  //
  // Rend le MOTIF ('version' ou 'mois') ou une chaîne vide s'il n'y a rien à refaire. Ce n'est pas
  // elle qui sait s'il existe un exemple : l'appelant le sait, et lui seul.
  //
  // Le corps est identique à `exemplePerime` de src/cabinet/cabcore.js — les deux applications
  // doivent décider pareil, et aucune ne peut charger le module de l'autre. Un test compare les deux
  // corps caractère par caractère, comme pour `round3` et `pastille`.
  function exemplePerime(repere, version, mois) {
    if (!version) return '';
    const r = (repere && typeof repere === 'object') ? repere : {};
    if (!r.version || r.version !== version) return 'version';
    if (r.mois !== mois) return 'mois';
    return '';
  }

  // 10.14.0 — un mot de passe à confirmer : le verdict, ET la case qu'il faut montrer. « Les deux
  // mots de passe ne sont pas les mêmes » sur une confirmation VIDE disait faux : vu à la souris sur
  // le premier écran du Cabinet, la confirmation avait été tapée sur le bouton « Afficher », où Tab
  // pose le curseur, et le refus ne montrait aucune case. Une confirmation vide se NOMME, une
  // confirmation fausse aussi — et c'est elle qu'on refait, jamais le mot de passe qu'on vient de
  // choisir. `min` vient de l'appelant : c'est la seule chose que les deux applications ne partagent
  // pas (six caractères ici, huit pour le Cabinet, qui chiffre la comptabilité de soixante clients).
  //
  // Le corps est identique à `verdictMotDePasse` de src/cabinet/cabcore.js : les deux applications
  // refusent avec les mêmes mots, et un test compare les deux corps (comme `exemplePerime`).
  function verdictMotDePasse(motDePasse, confirmation, min) {
    const a = String(motDePasse || ''), b = String(confirmation || '');
    if (a.length < min) return { ok: false, champ: 'motDePasse', message: `Mot de passe : ${min} caractères au minimum.` };
    if (!b) return { ok: false, champ: 'confirmation', message: 'Retape le mot de passe dans la case de confirmation.' };
    if (a !== b) return { ok: false, champ: 'confirmation', message: 'La confirmation ne correspond pas au mot de passe : retape-la.' };
    return { ok: true, champ: '', message: '' };
  }

  // Le taux de TVA d'une ligne neuve. Il se règle dans Paramètres et l'assistant le pose à partir du
  // métier déclaré. `''`, `null` ou `undefined` = 19 % ; `0` est une valeur légitime (exonération),
  // d'où le test explicite plutôt qu'un `||`.
  function defaultVat(company) {
    // Une entreprise qui ne facture pas de TVA ne peut pas faire naître une ligne à 19 %. Le régime
    // tranche AVANT le réglage : sinon un forfaitaire qui change de régime après coup garderait un
    // « TVA des nouvelles lignes : 19 % » oublié dans ses réglages, et la première ligne tapée à la
    // main remettrait de la TVA sur une facture qui n'a pas le droit d'en porter.
    if (!assujettiTVA(company)) return 0;
    const v = (company || {}).defaultVatRate;
    if (v === '' || v === null || v === undefined) return 19;
    const n = Number(v);
    return VAT_RATES.includes(n) ? n : 19;
  }
  // Le seuil en dessous duquel une retenue à la source mérite une question (9.1.1). Il vaut **0**
  // tant que personne ne l'a réglé, et 0 veut dire « aucun seuil » : la valeur par défaut d'une
  // règle qu'on ne connaît pas est celle qui ne fait rien. Écrire 1 000 DT ici — le chiffre que
  // deux relectures extérieures proposaient — reviendrait à graver dans le code une règle de droit
  // que personne n'a confirmée, et à faire crier l'application sur des factures justes.
  //
  // Un seuil NÉGATIF est ignoré : c'est le seul cas que la garde protège vraiment, parce que
  // `Number('') === 0` rend l'assertion évidente inutile (leçon de la 8.3.0).
  function seuilRetenue(company) {
    const n = Number((company || {}).withholdingThreshold);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Une facture qui porte une retenue sous le seuil réglé (9.1.1). Le seuil est dans la devise de la
  // SOCIÉTÉ : la comparaison se fait sur le TTC CONVERTI (10.14.1, M-09 / DEV-11). Elle comparait le
  // TTC natif — une facture de 300 € (1 020 DT) passait « sous un seuil de 1 000 DT », et une de
  // 3 000 € ne l'était jamais sur un seuil en dinars. Sans taux saisi on ne compare rien : la pièce
  // ne peut pas être émise de toute façon (`missingRate`), et une comparaison à 1 pour 1 mentirait.
  function sousSeuilRetenue(doc, company) {
    const seuil = seuilRetenue(company);
    if (!(seuil > 0) || !doc || doc.type !== 'facture' || missingRate(doc, company)) return null;
    const t = computeTotals(doc, company);
    // (1.155.0) Sous le seuil de la règle `retenue.seuil`, le calcul retire déjà la retenue : rien à demander.
    if (!(t.withholdingRate > 0) || t.sousLeSeuil) return null;
    const ttcBase = toBase(doc, t.totalTTC, company);
    return ttcBase < seuil ? { seuil, ttc: t.totalTTC, ttcBase, taux: t.withholdingRate } : null;
  }

  // Une ligne de document neuve, avec le bon taux. Il y avait huit `vatRate: 19` écrits à la main.
  const newLine = (company, extra) => {
    const l = { label: '', description: '', qty: 1, unit: '', unitPrice: 0, vatRate: defaultVat(company), ...(extra || {}) };
    l.vatRate = tauxPourRegime(company, l.vatRate);
    return l;
  };
  // Le taux d'une ligne qui NAÎT d'un article du catalogue (10.14.0). Le catalogue garde le taux
  // d'avant un changement de régime : un forfaitaire qui ajoutait un article à 19 % facturait de la
  // TVA qu'il n'a pas le droit de facturer — c'est la règle de `defaultVat`, que le catalogue
  // contournait. Une ligne déjà écrite garde le sien (7.22.0).
  function tauxPourRegime(company, rate) {
    return assujettiTVA(company || {}) ? rate : 0;
  }
  // La TVA d'un ACHAT n'est récupérable que pour un assujetti (10.14.0). Un forfaitaire ou un exonéré
  // paie la TVA de ses fournisseurs et ne la déduit jamais : elle fait partie du coût. SkanFact la
  // déduisait quand même — 4366 débité, charge au HT, résultat trop beau de toute la TVA payée. La
  // pièce retient sa règle (`tvaRecuperable`, posée à la création et figée par la migration) : un
  // changement de régime ne réécrit pas les achats déjà déclarés (la règle 7.1.x des pièces).
  function tvaRecuperable(purchase, company) {
    const v = (purchase || {}).tvaRecuperable;
    return typeof v === 'boolean' ? v : assujettiTVA(company || {});
  }
  // La TVA d'une LIGNE d'achat entre-t-elle dans son coût ? Oui si la ligne est marquée non
  // déductible, ET si la pièce entière ne récupère pas la TVA. Le stock et le montant d'un bien
  // lisaient la case de la ligne seule : l'achat d'un forfaitaire entrait au 607 TVA comprise et
  // au stock hors TVA — deux valeurs pour la même marchandise.
  function tvaNonDeductible(line, purchase, company) {
    return (line || {}).deductible === false || !tvaRecuperable(purchase, company);
  }
  // Le taux d'une ligne d'ACHAT tirée du catalogue (10.14.0). Chez une entreprise qui ne facture pas
  // de TVA, le catalogue porte le taux FORCÉ de ses ventes (0 %) — pas celui de son fournisseur, qui
  // lui facture la TVA quand même. Recopier ce 0 sur l'achat oubliait la TVA payée : le coût de
  // l'article sortait hors taxe, alors qu'au forfait il la comprend. On propose le taux ordinaire,
  // celui qu'une ligne d'achat vide propose déjà ; la ligne reste modifiable, et c'est le taux écrit
  // par le fournisseur qui fait foi.
  function tauxAchatArticle(item, company) {
    const r = Number((item || {}).vatRate) || 0;
    if (r > 0 || assujettiTVA(company || {})) return r;
    return defaultVat({ ...(company || {}), taxRegime: 'reel' }) || defaultVat({ taxRegime: 'reel' });
  }
  // Les articles du catalogue à 0 % chez une entreprise qui facture la TVA (10.14.0). Tant qu'elle
  // était au forfait, chaque article naissait à 0 % — c'était le taux de ses ventes. Le jour où elle
  // passe au réel, ces articles faisaient naître des lignes sans TVA : la TVA collectée manquait sur
  // chaque facture tirée du catalogue, donc sur la déclaration, sans un mot. Un article à 0 % peut
  // aussi être vraiment exonéré : on le SIGNALE, avec le geste qui le corrige, on ne le change pas.
  // Rien à dire quand le taux des nouvelles lignes est lui-même 0 : il n'y a pas de taux à proposer.
  function articlesSansTva(data, company) {
    if (!assujettiTVA(company || {}) || !(defaultVat(company) > 0)) return [];
    return ((data || {}).catalog || []).filter(it => !(Number(it.vatRate) > 0));
  }
  // 10.14.1 (MR-02) — le jumeau d'`articlesSansTva` pour ce qui FABRIQUE des factures. Un contrat
  // récurrent ou un modèle né au forfait porte des lignes à 0 % : après le passage au réel, chaque
  // facture qu'il engendrait sortait sans la TVA due — 250 HT, 0 de TVA, tous les mois — et rien ne le
  // disait. Une ligne sans libellé ou de déduction d'acompte ne compte pas : elle ne facture rien.
  const ligneFactureeSansTva = l => !l.noDiscount && String(l.label || '').trim() && !(Number(l.vatRate) > 0);
  function sourcesSansTva(data, company) {
    if (!assujettiTVA(company || {}) || !(defaultVat(company) > 0)) return { contrats: [], modeles: [] };
    const aZero = x => (x.lines || []).some(ligneFactureeSansTva);
    return {
      contrats: ((data || {}).recurring || []).filter(r => r.active !== false && aZero(r)),
      modeles: ((data || {}).templates || []).filter(aZero)
    };
  }
  // Une facture dont AUCUNE ligne ne porte de TVA, chez une entreprise qui en facture par défaut : c'est
  // presque toujours une pièce tirée d'un devis, d'un contrat ou d'un modèle nés sous un autre régime.
  // Une ligne exonérée au milieu de lignes taxées ne dit rien (c'est légitime) ; une entreprise dont le
  // taux par défaut est 0 % vend sans TVA par choix, et n'est jamais avertie. Un avoir suit la facture
  // qu'il corrige : une facture exonérée donne un avoir exonéré, et le lui reprocher serait faux.
  function factureSansTvaSuspecte(doc, company) {
    if (!doc || doc.type !== 'facture') return false;
    if (!assujettiTVA(company || {}) || !(defaultVat(company) > 0)) return false;
    const facturees = (doc.lines || []).filter(l => !l.noDiscount && String(l.label || '').trim() && Number(l.qty) * Number(l.unitPrice) !== 0);
    return facturees.length > 0 && facturees.every(l => !(Number(l.vatRate) > 0));
  }
  // Les achats qui ne suivent pas le régime du jour et qu'on peut encore corriger (10.14.0) : figer la
  // règle protège une pièce déjà déclarée, mais quelqu'un qui avait laissé « réel » par erreur doit
  // pouvoir remettre ses achats d'aplomb. Jamais dans un mois clôturé (6.0.0). Un avoir ou un acompte
  // rattaché suit SA pièce : il n'est corrigé que si elle l'est. `tva` : la TVA déductible qui change.
  function achatsHorsRegime(data, company) {
    const cible = assujettiTVA(company || {});
    const tous = (data.purchases || []).filter(p => tvaRecuperable(p, company) !== cible && !isClosedDate(data, p.date));
    const candidats = new Set(tous.map(p => p.id));
    const byId = new Map((data.purchases || []).map(p => [p.id, p]));
    const pieces = tous.filter(p => !(p.achatLie && byId.has(p.achatLie)) || candidats.has(p.achatLie));
    // La TVA qui change se lit par la MÊME fonction que la déclaration, avant et après : additionner
    // les pièces une à une comptait un avoir dans le mauvais sens et la TVA qu'un acompte avait déjà
    // déduite — l'annonce disait 2 955 DT quand la déclaration bougeait de 2 720.
    if (!pieces.length) return { pieces, tva: 0, cible };
    const dates = pieces.map(p => String(p.date || '')).filter(Boolean).sort();
    const per = { from: dates[0] || '2000-01-01', to: dates[dates.length - 1] || '2999-12-31' };
    const ids = new Set(pieces.map(p => p.id));
    const apres = { ...data, purchases: (data.purchases || []).map(p => ids.has(p.id) ? { ...p, tvaRecuperable: cible } : p) };
    const tva = round3(Math.abs(vatReturn(apres, company, per).deductible - vatReturn(data, company, per).deductible));
    return { pieces, tva, cible };
  }

  const moduleById = id => MODULES.find(m => m.id === id) || null;
  const pageById = id => PAGES.find(p => p.id === id) || null;
  const pageTitle = id => { const p = pageById(id); return p ? p.titre : ''; };

  // Ce que le module contient aujourd'hui. Un module sans compteur (le cœur) n'a pas à se justifier.
  function moduleCount(data, id) {
    const m = moduleById(id);
    if (!m || !m.compte) return 0;
    try { return Number(m.compte(data || {})) || 0; } catch (_) { return 0; }
  }

  // Un module est actif s'il est choisi. C'est le choix enregistré qui fait foi, et rien d'autre.
  //
  // Jusqu'à la 7.12.0, un module qui CONTENAIT quelque chose s'allumait aussi tout seul, au nom de
  // « on ne masque jamais ce que quelqu'un a saisi ». L'intention était juste, la mécanique était un
  // piège : sur la page « Tous les modules », décocher une case retirait le module de la liste, puis
  // le re-calcul le rallumait aussitôt (il est plein), la ligne se redessinait en cadenas — et la
  // case à cocher disparaissait sous le doigt. Le module restait donc dans le menu ET ne pouvait
  // plus être recoché. Un réglage qui accepte un clic, ne fait rien de visible, et se retire ensuite
  // la possibilité de revenir en arrière est pire que pas de réglage du tout.
  //
  // Ce que la règle protégeait vraiment — « je masque Stock, je commence à m'en servir ailleurs, et
  // la page a disparu » — est repris par `modulesRevenus` : un module masqué dans lequel on vient
  // d'enregistrer quelque chose revient dans le menu, et l'application le DIT. C'est un événement,
  // pas un état : c'est ce qui fait la différence entre un filet et un piège.
  function moduleOn(data, id) {
    const m = moduleById(id);
    if (!m) return false;
    if (m.toujours) return true;
    const choisis = ((data || {}).company || {}).modules;
    // Absent = toute l'application, comme avant : une installation existante ne perd rien.
    if (!Array.isArray(choisis)) return true;
    return choisis.includes(id);
  }

  // Un SOUS-module est-il allumé ? Contrairement à un module, il est **décoché par défaut** : on ne
  // fait pas apparaître une option payante chez quelqu'un qui ne l'a pas demandée. `null` (aucun
  // choix enregistré) vaut donc `defaut`, pas « tout ».
  //
  // Et il ne juge QUE l'affichage : c'est `optionBlock`, côté interface, qui parle de la licence.
  // Mélanger les deux ferait disparaître la case le jour où l'option manque — c'est-à-dire un
  // réglage qui se retire la possibilité de revenir en arrière (le piège de la 7.12.0).
  function sousModuleOn(data, id) {
    const sm = sousModuleById(id);
    if (!sm) return false;
    const choisis = ((data || {}).company || {}).modules;
    if (!Array.isArray(choisis)) return !!sm.defaut;
    return choisis.includes(id);
  }
  function sousModuleById(id) {
    for (const m of MODULES) for (const sm of (m.sousModules || [])) if (sm.id === id) return sm;
    return null;
  }
  const sousModules = () => MODULES.flatMap(m => (m.sousModules || []).map(sm => ({ ...sm, module: m.id })));
  // Le nom d'une option, tel qu'il s'écrit à l'écran et sur une facture de licence. Il vit ICI, à
  // côté du sous-module qui la porte, et pas dans `licence.js` : le renderer ne charge pas
  // `licence.js`, et une seconde table ailleurs finirait par dire autre chose.
  const OPTION_LABELS = { compta: 'Comptabilité' };

  // Pourquoi ce module est visible — ou ne l'est pas : 'coeur', 'choisi', 'tout' (aucun choix
  // enregistré) ou 'masque'.
  function moduleWhy(data, id) {
    const m = moduleById(id);
    if (!m) return '';
    if (m.toujours) return 'coeur';
    const choisis = ((data || {}).company || {}).modules;
    if (!Array.isArray(choisis)) return 'tout';
    return choisis.includes(id) ? 'choisi' : 'masque';
  }

  // Les compteurs de tous les modules, pour servir de référence au prochain enregistrement.
  function moduleCounts(data) {
    const o = {};
    MODULES.forEach(m => { o[m.id] = moduleCount(data, m.id); });
    return o;
  }

  // Les modules masqués dans lesquels quelque chose vient d'être enregistré. On compare aux
  // compteurs de référence (ceux du dernier enregistrement) : masquer un module plein ne le rallume
  // donc pas, alors qu'y ajouter une ligne le ramène.
  function modulesRevenus(data, avant) {
    const choisis = ((data || {}).company || {}).modules;
    if (!Array.isArray(choisis)) return [];
    return MODULES.filter(m => !m.toujours && !choisis.includes(m.id)
      && moduleCount(data, m.id) > (Number((avant || {})[m.id]) || 0)).map(m => m.id);
  }

  // Les pages de la barre latérale, dans l'ordre, groupées par module. `pied` sort du compte : ces
  // deux-là (Paramètres, Aide) vivent dans le pied de la barre, qui ne défile jamais.
  function navPages(data) {
    return PAGES.filter(p => !p.horsMenu && !p.pied && (!p.module || moduleOn(data, p.module)));
  }

  // Une famille de la barre est-elle ouverte ? (10.13.0) — pure, pour que la règle se teste sans
  // écran. `etat` est ce que l'utilisateur a choisi en cliquant les intertitres ; `active` la famille
  // de la page ouverte ; `repliIci` la famille qu'il a repliée alors qu'il était DANS cette page.
  //   - un choix de l'utilisateur fait foi ;
  //   - sans choix, « Vendre » est ouverte (le geste de tous les jours), les autres repliées ;
  //   - la famille de la page ouverte s'ouvre le temps d'y être, SANS toucher au choix — sauf si
  //     l'utilisateur vient de la replier sur cette page même.
  const FAMILLES_OUVERTES_AU_DEBUT = ['Vendre'];
  // (1.269.0 ; 17 § 1) Les six familles du menu, dans leur ordre : « Tout le reste » les range ainsi, quel que soit
  // l'ordre des pages (le Catalogue vient avant les Achats dans la liste, mais Acheter passe avant Articles et stock).
  const FAMILLES_DU_MENU = ['Vendre', 'Acheter', 'Articles et stock', 'Personnel', 'Argent', 'Piloter'];
  // Les vues d'une page (elle comprise, en tête) que le module de chacune ouvre : la bande en haut de la page.
  function vuesDePage(data, id) {
    const p = PAGES.find(x => x.id === id);
    if (!p) return [];
    const parent = p.vueDe ? PAGES.find(x => x.id === p.vueDe) : p;
    if (!parent) return [];
    const l = [parent, ...PAGES.filter(x => x.vueDe === parent.id)].filter(x => !x.module || moduleOn(data, x.module));
    return l.length > 1 ? l : [];
  }
  function familleNavOuverte(famille, etat, active, repliIci) {
    const choisi = etat && Object.prototype.hasOwnProperty.call(etat, famille) ? !!etat[famille] : FAMILLES_OUVERTES_AU_DEBUT.includes(famille);
    if (choisi) return true;
    return !!active && famille === active && repliIci !== famille;
  }

  // Ce que l'assistant de première utilisation allume selon le métier déclaré. Rien n'est imposé :
  // l'écran « Qu'est-ce que tu fais ? » propose ces cases cochées, et l'utilisateur décoche.
  // Un métier absent de cette table n'allume que les trois modules `toujours` : l'application reste
  // utilisable, mais elle ne propose rien. Les neuf métiers ajoutés en 7.22.0 ont donc chacun leur
  // ligne — sinon un garagiste ou un restaurateur découvrirait Achats et Stock par hasard, six mois
  // plus tard, alors que ce sont les deux modules de son quotidien.
  const MODULES_PAR_ACTIVITE = {
    commerce: ['achats', 'stock', 'pilotage', 'caisse'],
    artisanat: ['achats', 'stock', 'pieces'],
    batiment: ['achats', 'pieces', 'pilotage'],
    informatique: ['achats', 'pieces'],
    conseil: ['pieces'],
    sante: ['achats'],
    restauration: ['achats', 'stock', 'paie', 'caisse'], // matières premières, du personnel, et le comptoir
    transport: ['achats', 'immos', 'pilotage'],         // les véhicules sont des immobilisations
    immobilier: ['pieces', 'pilotage'],
    juridique: ['pieces'],
    comptabilite: ['pieces'],
    architecture: ['pieces', 'pilotage'],               // le suivi se fait par affaire
    communication: ['pieces', 'pilotage'],
    beaute: ['achats', 'stock', 'caisse'],              // produits revendus au comptoir, et consommables
    automobile: ['achats', 'stock', 'pieces'],          // pièces détachées : du stock, et des devis
    autre: []
  };
  const modulesSuggeres = activity => ['ventes', 'fichiers', 'compta']
    .concat(MODULES_PAR_ACTIVITE[activity] || []);

  const DEFAULT_DATA = {
    version: 6,
    company: DEFAULT_COMPANY,
    clients: [],
    catalog: [],
    documents: [],
    recurring: [],   // contrats récurrents
    templates: [],   // modèles de documents
    snippets: [],    // textes prédéfinis
    suppliers: [],   // fournisseurs (v4)
    purchases: [],   // factures d'achat et dépenses (v4)
    expenseCategories: [],   // catégories ajoutées par l'utilisateur, en plus de DEFAULT_EXPENSE_CATEGORIES
    fiscalDeadlines: [],     // échéances fiscales activées/modifiées par l'utilisateur (v4)
    assets: [],              // immobilisations amortissables (3.5.0)
    stockAdjustments: [],    // mouvements de stock saisis à la main : départ, casse, inventaire (v5)
    serials: [],             // unités suivies par numéro de série (v5)
    employees: [],           // salariés (v6)
    payslips: [],            // bulletins de paie (v6)
    payrollSettings: {},     // barèmes CNSS/IRPP modifiés par l'utilisateur (v6)
    leaves: [],              // congés et absences (v6)
    advances: [],            // avances sur salaire (v6)
    socialFilings: [],       // déclarations sociales marquées déposées (v6)
    fiscalFilings: [],       // échéances fiscales marquées déposées (7.21.0)
    vatCarryIn: {},          // crédit de TVA venu de l'année précédente, par année : { '2026': 1234 }
    projects: [],            // affaires : relient ventes et achats pour une marge exacte (v4)
    fixedCategories: [],     // catégories de charges considérées comme fixes (vide = valeurs par défaut)
    accounts: [],            // comptes de trésorerie : banque, caisse… (v4)
    movements: [],           // mouvements libres : salaires, impôts, apports — ce qui n'a ni facture ni achat
    auxiliaires: false,      // comptes auxiliaires par tiers (411001, 401001…) dans les écritures (8.8.0)
    ecrituresOD: [],         // opérations diverses saisies à la main : { id, date, piece, label, lignes:[{compte,label,debit,credit}] } (8.9.0)
    licences: [],            // licences SkanFact ÉMISES par l'éditeur depuis ce dossier (7.33.0) — vide chez un client
    pontImporte: '',         // jour où l'historique des licences est parti vers la console (8.7.0) — vide chez un client
    exportConsole: '',       // jour du dernier export de la base de la console (10.4.0) — vide chez un client
    deleted: [],             // pièces supprimées, pour qu'elles ne reviennent pas d'un autre poste (v4)
    conflictArchive: [],     // versions écartées lors d'une fusion : rien n'est détruit sans trace
    closedUntil: '',         // dernier jour clôturé : rien de daté avant ne bouge plus (6.0.0)
    closureLog: [],          // chaque clôture et chaque réouverture, avec son motif (6.0.0)
    clotures: [],            // les clôtures d'exercice reçues du cabinet (9.8.0) : à-nouveaux officiels
    // Les questions reçues du cabinet (9.10.0). Elles ne touchent AUCUN chiffre : elles s'affichent
    // en face de la pièce qu'elles visent, on y répond, et la réponse repart dans le paquet suivant.
    questionsCabinet: [],
    // La signature du cabinet, retenue au premier envoi signé (10.13.0) : { empreinte, depuis }.
    // Les envois suivants lui sont comparés (`verdictEnvoiCabinet`). `null` tant qu'aucun n'est arrivé.
    cabinetSignature: null,
    packs: [],               // paquets mensuels construits pour le cabinet (6.1.0)
    demo: false,             // ces données viennent du jeu d'exemple (7.0.0) — l'app le dit à l'écran
    // De quelle version sort l'exemple chargé, et sur quel mois il a été bâti — `{ version, mois }`.
    // Le jeu d'exemple est RELATIF à aujourd'hui : chargé en septembre et regardé en décembre, il
    // montre des relances qui n'ont plus de sens. Ces deux repères le font se REFAIRE tout seul
    // (9.4.2, `exemplePerime`). `null` hors exemple — même forme que dans l'app du cabinet.
    exemple: null,
    counters: {}
  };

  // Statuts enregistrés. Pour une facture, « payée » / « partielle » / « retard » sont DÉDUITS des paiements
  // et des avoirs (effectiveStatus), jamais saisis à la main.
  const STATUSES = {
    devis: ['brouillon', 'envoyé', 'accepté', 'refusé'],
    facture: ['brouillon', 'envoyée', 'annulée'],
    avoir: ['brouillon', 'émis'],
    proforma: ['brouillon', 'envoyée', 'annulée'],
    commande: ['brouillon', 'reçue', 'livrée', 'annulée'],
    livraison: ['brouillon', 'émis', 'signé', 'annulé'],
    contrat: ['brouillon', 'envoyé', 'signé', 'terminé', 'annulé']
  };
  // 10.12.0 — le statut que prend une pièce quand on l'ENVOIE. Seul le devis passait à « envoyé » :
  // une proforma envoyée par email partait avec un PDF tamponné « BROUILLON », et restait brouillon —
  // la pièce qu'une banque ou une administration demande pour un dossier. La facture et l'avoir n'y
  // sont pas : ils s'ÉMETTENT, et l'émission a son propre geste et son numéro.
  const STATUT_ENVOI = { devis: 'envoyé', proforma: 'envoyée', commande: 'reçue', livraison: 'émis', contrat: 'envoyé' };
  const DISPLAY_STATUSES = {
    devis: ['brouillon', 'envoyé', 'expiré', 'accepté', 'refusé'],
    facture: ['brouillon', 'envoyée', 'partielle', 'retard', 'payée', 'annulée'],
    avoir: STATUSES.avoir,
    proforma: STATUSES.proforma, commande: ['brouillon', 'reçue', 'partielle', 'livrée', 'annulée'], livraison: STATUSES.livraison, contrat: STATUSES.contrat
  };
  const STATUS_LABELS = { partielle: 'partiellement payée', retard: 'en retard', expiré: 'expiré' };

  // Les filtres de liste qui ne sont PAS un statut (7.15.0). La liste des factures proposait déjà
  // « Émis » dans son menu de statuts, et le filtrage comparait `effectiveStatus(d) === 'émis'` :
  // aucune facture ne porte ce statut — mais les AVOIRS, si. Choisir « Émis » sur une liste de
  // factures rendait donc deux avoirs sur vingt-cinq pièces. Une liste vide se remarque ; une liste
  // fausse, non. Un filtre qui regroupe plusieurs statuts doit être une FONCTION, pas une chaîne
  // comparée à un statut.
  const DOC_FILTRES = {
    'émis': st => st !== 'brouillon' && st !== 'annulée',
    'à encaisser': st => st === 'envoyée' || st === 'partielle' || st === 'retard'
  };
  // Vrai si la pièce (dont le statut effectif est `st`) passe le filtre `choix`.
  function docFiltre(choix, st) {
    if (!choix) return true;
    const f = DOC_FILTRES[choix];
    return f ? f(st) : st === choix;
  }

  // ---------- utilitaires ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function round3(n) { const x = Number(n) || 0, r = Math.round(Math.abs(x) * 1000 * (1 + 4 * Number.EPSILON)) / 1000; return x < 0 && r ? -r : r; }

  const CURRENCIES = ['DT', 'EUR', 'USD', 'GBP', 'CHF', 'MAD', 'DZD'];
  // Le NOM de chaque devise, à côté de son code (10.14.0, A2) : « MAD » et « DZD » ne disent rien à
  // qui n'a jamais facturé au Maroc ou en Algérie, et une devise choisie par erreur fausse toute la
  // pièce (7.0.1). Le code reste en tête : c'est lui que la pièce imprime.
  const DEVISES_NOMS = { DT: 'dinar tunisien', EUR: 'euro', USD: 'dollar américain', GBP: 'livre sterling',
    CHF: 'franc suisse', MAD: 'dirham marocain', DZD: 'dinar algérien' };
  function libelleDevise(c) { const n = DEVISES_NOMS[c]; return n ? `${c} — ${n}` : String(c || ''); }
  // La devise de l'entreprise se réglait dans un champ de TEXTE LIBRE, alors que l'éditeur de
  // document et la fiche client n'offrent que ces sept codes depuis la 2.4.0. On pouvait donc y
  // écrire « Dinar », « TND », « dt » ou n'importe quoi — et le nombre de décimales, lui, ne
  // reconnaît que 'DT' et 'TND' : tout le reste passait à deux décimales sur des montants en
  // dinars, silencieusement, sur toutes les pièces à venir. Le champ est devenu une liste ; cette
  // fonction rattrape ce qui a déjà été enregistré, plutôt que de le remettre d'office à 'DT'.
  function normCurrency(c) {
    const v = String(c == null ? '' : c).trim().toUpperCase();
    if (!v) return 'DT';
    if (v === 'TND' || v === 'DINAR' || v === 'DTN' || v === 'TN') return 'DT';
    if (v === '€' || v === 'EURO' || v === 'EUROS') return 'EUR';
    if (v === '$' || v === 'DOLLAR') return 'USD';
    return CURRENCIES.includes(v) ? v : 'DT';
  }
  function decimalsFor(currency) { return !currency || currency === 'DT' || currency === 'TND' ? 3 : 2; }
  // L'arrondi d'une devise : trois décimales pour le dinar, deux pour les autres (la règle de `money`).
  // Même correction décimale que `round3` : 100,35 × 19 % vaut 19,0664999… en virgule flottante.
  function arrondiDevise(currency) {
    if (decimalsFor(currency) === 3) return round3;
    return n => { const x = Number(n) || 0, r = Math.round(Math.abs(x) * 100 * (1 + 4 * Number.EPSILON)) / 100; return x < 0 && r ? -r : r; };
  }
  function money(n, currency, decimals, lang) {
    // Un seul arrondi, à la précision de la devise : arrondir au millime PUIS au centime ferait
    // 2,67465 → 2,675 → 2,68 au lieu de 2,67 (le double arrondi).
    const v = Number(n) || 0;
    const neg = v < 0;
    const dec = decimals != null ? decimals : decimalsFor(currency);
    const en = lang === 'en';
    // Espaces INSÉCABLES (10.12.0) : entre les milliers, avant la devise, après le signe. Une espace
    // ordinaire laissait le navigateur couper un montant en fin de ligne — « 4 » d'un côté, « 530,188
    // DT » de l'autre, dans la phrase qui annonce le solde d'un acompte. Un montant se lit d'un bloc.
    // Arrondi à la précision de la devise AVANT `toFixed` (10.14.1, M-07) : 190,095 € vaut en machine
    // 190,09499…, et `toFixed(2)` l'écrivait « 190,09 » pendant que le total, arrondi par
    // `arrondiDevise`, disait 190,10. Le même epsilon que `arrondiDevise` : un chiffre, une règle.
    const p = 10 ** dec, a = Math.round(Math.abs(v) * p * (1 + 4 * Number.EPSILON)) / p;
    const s = a.toFixed(dec).replace('.', en ? '.' : ',').replace(/\B(?=(\d{3})+(?!\d))/g, en ? ',' : '\u00a0');
    const out = (neg && a ? '−\u00a0' : '') + s;
    return currency ? `${out}\u00a0${currency}` : out;
  }
  // Montant d'un document ramené à la devise de la société (taux saisi sur le document : 1 devise = x DT)
  // Le taux d'un document : « 1 devise = x DT ». Vaut 1 quand le document est dans la devise de
  // l'entreprise — c'est-à-dire dans la quasi-totalité des cas.
  function rateOf(doc, company) {
    const cur = (doc || {}).currency || (company || {}).currency;
    if (!cur || cur === (company || {}).currency) return 1;
    const r = Number((doc || {}).exchangeRate);
    return r > 0 ? r : 1;      // le repli existe pour ne rien faire planter ; `missingRate` le signale
  }

  // Un montant d'une pièce, exprimé dans la devise d'une AUTRE (10.14.0). Un avoir rattaché diminue
  // sa facture dans la devise de la FACTURE : resté en dinars sur une facture en euros (le geste
  // « Nouvel avoir », qui part en dinars), il en retranchait 300 € pour 300 DT — la facture
  // annonçait 200 € de reste pendant que le 411 portait l'équivalent de 410. Même devise : le
  // montant tel quel, un avoir de 300 € efface 300 € quel que soit son taux (l'écart de taux est une
  // différence de change, que le journal écrit) ; autre devise : par la devise de la société, et
  // aux décimales de la devise de la CIBLE (10.14.1) — 300 DT sur une facture en euros valent
  // 89,55 €, jamais 89,552 : une fraction de centime n'existe sur aucune pièce, et le reste qu'elle
  // laissait (410,448 €) ne se soldait par aucun virement. Le millime perdu par cet arrondi passe au
  // change, par `ecartDeTauxEntre`, pour que le compte du tiers tombe sur le même reste.
  function montantDansDeviseDe(piece, montant, cible, company) {
    const dev = x => normCurrency((x && x.currency) || (company && company.currency));
    if (dev(piece) === dev(cible)) return round3(montant);
    return arrondiDevise(dev(cible))(toBase(piece, montant, company) / rateOf(cible, company));
  }

  // Un prix ou un coût du CATALOGUE — tenu dans la devise de la société — posé sur une pièce d'une
  // AUTRE devise (10.14.1). Il était recopié tel quel : une prestation à 150 DT devenait une ligne à
  // 150 € sur une facture en euros (trois fois et demie trop chère), et son coût de revient en dinars
  // se comparait à un prix en euros dans la marge. Converti au taux de la pièce, arrondi à la devise
  // de la pièce. Sans taux saisi, la conversion est impossible : `null`, et l'écran le dit au lieu de
  // poser un chiffre faux. Un champ vide reste vide.
  // Les listes de prix (plateforme, brique 93 ; 01 § 5 `liste_prix`). Celles qui valent pour ce client à cette
  // date : d'abord celles qui le nomment, puis celles de sa catégorie ; à égalité, la plus récente.
  const normCategorie = s => String(s || '').trim().toLowerCase();
  function listesPrixApplicables(data, clientId, dateIso) {
    const d = dateIso || today();
    const c = (data.clients || []).find(x => x.id === clientId);
    const cat = normCategorie(c && c.categorieTarif);
    const nomme = l => Array.isArray(l.clientIds) && l.clientIds.includes(clientId);
    return (data.priceLists || [])
      .filter(l => (!l.depuis || l.depuis <= d) && (!l.jusquau || d <= l.jusquau) && (nomme(l) || (cat && normCategorie(l.categorie) === cat)))
      .sort((a, b) => (nomme(b) ? 1 : 0) - (nomme(a) ? 1 : 0) || String(b.depuis || '').localeCompare(String(a.depuis || '')));
  }
  // Le prix d'un article pour ce client, à cette date et cette quantité, en dinars, et d'où il vient.
  function prixArticlePour(data, item, clientId, dateIso, qty) {
    for (const l of listesPrixApplicables(data, clientId, dateIso)) {
      const x = (l.lignes || []).find(y => y.itemId === (item && item.id) && Number(y.prix) > 0);
      if (x) return { prix: Number(x.prix), source: 'liste', liste: l.nom || '' };
    }
    const p = prixCataloguePourQuantite(item, qty);
    return { prix: p, source: p !== (Number(item && item.unitPrice) || 0) ? 'palier' : 'article', liste: '' };
  }
  // Le prix par quantité (plateforme, brique 92) : le palier le plus haut que la quantité atteint ; sous le premier,
  // le prix de l'article. Un palier sans quantité ou sans prix positifs ne compte pas.
  function prixCataloguePourQuantite(item, qty) {
    const q = Number(qty) || 0;
    const p = (Array.isArray(item && item.paliers) ? item.paliers : [])
      .filter(x => Number(x.min) > 0 && Number(x.prix) > 0 && q >= Number(x.min))
      .sort((a, b) => Number(b.min) - Number(a.min))[0];
    return p ? Number(p.prix) : (Number(item && item.unitPrice) || 0);
  }
  // Les paliers tels qu'on les tape : « 10 : 20,500 ; 100 : 19 ». Rend { paliers } triés, ou { erreur } qui dit
  // ce qui ne va pas (le palier qui ne se lit pas, la quantité en double).
  function lirePaliers(texte) {
    const morceaux = String(texte || '').split(/[;\n]+/).map(x => x.trim()).filter(Boolean);
    const paliers = [];
    for (const m of morceaux) {
      const r = /^(\d+(?:[.,]\d+)?)\s*[:=]\s*(\d+(?:[.,]\d+)?)$/.exec(m.replace(/\s+(?=\d{3}\b)/g, ''));
      if (!r) return { erreur: `« ${m} » ne se lit pas : écris la quantité, deux-points, puis le prix (par exemple « 10 : 20,500 »).` };
      const min = Number(r[1].replace(',', '.')), prix = round3(Number(r[2].replace(',', '.')));
      if (!(min > 0) || !(prix > 0)) return { erreur: `« ${m} » : la quantité et le prix doivent être plus grands que zéro.` };
      if (paliers.some(p => p.min === min)) return { erreur: `La quantité ${String(min).replace('.', ',')} a deux prix : garde-en un seul.` };
      paliers.push({ min, prix });
    }
    return { paliers: paliers.sort((a, b) => a.min - b.min) };
  }
  function paliersEnTexte(paliers) {
    return (Array.isArray(paliers) ? paliers : []).map(p => `${String(p.min).replace('.', ',')} : ${String(p.prix).replace('.', ',')}`).join(' ; ');
  }
  function prixDuCatalogue(montant, doc, company) {
    if (montant === '' || montant == null) return montant;
    const n = Number(montant); if (!Number.isFinite(n)) return montant;
    const co = company || {};
    const cur = normCurrency((doc && doc.currency) || co.currency);
    if (cur === normCurrency(co.currency)) return n;
    if (missingRate(doc, co)) return null;
    return arrondiDevise(cur)(n / rateOf(doc, co));
  }

  // La remise que fait vraiment une pièce (plateforme, brique 104 ; 03 D11 « une remise ») : la remise globale, ou
  // plus quand le prix d'une ligne est baissé sous celui que SkanFact proposerait à ce client (sa liste de prix, le
  // palier de sa quantité, converti dans la devise de la pièce). La plus forte, en %, à deux décimales, et la ligne
  // qui la fait ('' : la remise globale). Une ligne sans article du catalogue, ou hors remise, ne compte pas.
  function remiseEffective(data, doc, company) {
    const globale = Number(doc && doc.discountRate) || 0;
    let plus = { taux: Math.round(globale * 100) / 100, ligne: '' };
    for (const l of (doc && doc.lines) || []) {
      const item = (data.catalog || []).find(x => x.id === l.itemId);
      if (!item || l.noDiscount) continue;
      const ref = Number(prixDuCatalogue(prixArticlePour(data, item, doc.clientId, doc.date, l.qty).prix, doc, company));
      if (!(ref > 0)) continue;
      const net = (Number(l.unitPrice) || 0) * (1 - globale / 100);
      const taux = Math.round((1 - net / ref) * 10000) / 100;
      if (taux > plus.taux) plus = { taux, ligne: String(l.label || item.label || '') };
    }
    return plus;
  }

  // L'ÉCART DE CHANGE (10.14.0). Un avoir, un avoir fournisseur ou un acompte rattaché à une pièce
  // de la MÊME devise étrangère, mais à un autre taux : le tiers doit (ou se voit devoir) ce qu'il
  // doit dans SA devise — la facture de 1 000 € moins l'avoir de 300 € — donc son compte se règle au
  // taux de la pièce qu'on diminue. La pièce, elle, garde ses propres comptes à son taux (le chiffre
  // d'affaires ou la charge qu'elle corrige). La différence est un gain ou une perte de change : sans
  // elle, le 411 gardait 15 DT sur une facture que le client ne doit plus, pendant que le lettrage,
  // le relevé et la fiche disaient zéro. Rend ce qu'il faut AJOUTER au débit du compte du tiers pour
  // le régler au taux de la cible, sur un montant `natif` de la pièce — c'est aussi l'effet sur le
  // résultat (positif : un gain). Deux devises DIFFÉRENTES (10.14.1 : un avoir en dinars sur une
  // facture en euros) : le tiers est diminué de la contre-valeur ARRONDIE à la devise de la cible
  // (`montantDansDeviseDe`), et le millime que cet arrondi fait perdre est lui aussi un écart — sans
  // lui, le 411 gardait −0,017 DT sur une facture que tous les écrans disaient soldée.
  function ecartDeTauxEntre(piece, cible, natif, company) {
    if (!piece || !cible || !natif) return 0;
    const dev = x => normCurrency(x.currency || company.currency);
    if (dev(piece) === dev(cible) && dev(piece) === normCurrency(company.currency)) return 0;
    return round3(toBase(cible, montantDansDeviseDe(piece, natif, cible, company), company) - toBase(piece, natif, company));
  }
  // Le total des écarts de change d'une période, par la MÊME règle que le journal : le résultat
  // simplifié ne peut pas dire un autre résultat que les états financiers.
  function ecartsDeChange(data, company, period) {
    const from = period && period.from, to = period && period.to;
    const docs = new Map((data.documents || []).map(d => [d.id, d]));
    const achats = new Map((data.purchases || []).map(p => [p.id, p]));
    let total = 0;
    (data.documents || []).forEach(av => {
      if (av.type !== 'avoir' || !av.creditOf || av.status === 'brouillon' || !av.number || !inPeriod(av.date, from, to)) return;
      // Le BRUT que le 411 transfère (10.14.0) : la retenue subie naît à l'encaissement.
      const ta = computeTotals(av, company);
      total += ecartDeTauxEntre(av, docs.get(av.creditOf), -round3(ta.netToPay + ta.withholding), company);
    });
    (data.purchases || []).forEach(p => {
      if (!inPeriod(p.date, from, to)) return;
      // Le BRUT que le 401 transfère d'une pièce à l'autre (10.14.0) : la retenue naît au règlement.
      if (p.kind === 'avoir' && p.achatLie && achats.get(p.achatLie)) {
        total += ecartDeTauxEntre(p, achats.get(p.achatLie), imputationAchat(p, company).brut, company);
      } else if (p.kind !== 'avoir' && p.kind !== 'acompte') {
        piecesLieesAchat(data, p.id, 'acompte').forEach(a => { const ta = purchaseTotals(a, company); total += ecartDeTauxEntre(a, p, round3(ta.netToPay + ta.withholding), company); });
      }
    });
    // Les règlements à un autre taux que leur pièce (10.14.0), à la date du règlement : recevoir plus
    // de dinars est un gain, en payer plus une perte — un avoir remboursé à l'inverse.
    (data.documents || []).forEach(d => {
      if (d.type !== 'facture') return;
      (d.payments || []).forEach(p => { if (inPeriod(p.date, from, to)) total += ecartDuReglement(d, p, company); });
    });
    // L'écart de CONVERSION d'une pièce en devise (10.14.1) : ce que l'écriture de vente pose au
    // change, par la MÊME fonction qui l'écrit (le journal des ventes), jamais recalculé à côté.
    if ((data.documents || []).some(d => d.currency && d.currency !== company.currency)) {
      salesJournal(data, company, { from, to }).forEach(r => { total += r.ecartConversion || 0; });
    }
    (data.purchases || []).forEach(pu => {
      const sens = pu.kind === 'avoir' ? -1 : 1;
      (pu.payments || []).forEach(p => { if (inPeriod(p.date, from, to)) total -= sens * ecartDuReglement(pu, p, company); });
    });
    return round3(total);
  }

  // Un document en devise étrangère SANS taux de change saisi. Le repli à 1 de `rateOf` évite un
  // écran cassé, mais il fait compter 1 EUR = 1 DT : le journal des ventes, la TVA à déclarer, le
  // chiffre d'affaires et le tableau de bord deviennent faux **en silence**, d'un facteur trois.
  // Rien à l'écran ne le montrait. Cette fonction existe pour que l'application le dise.
  function missingRate(doc, company) {
    const cur = (doc || {}).currency || (company || {}).currency;
    if (!cur || cur === (company || {}).currency) return false;
    return !(Number((doc || {}).exchangeRate) > 0);
  }

  function toBase(doc, amount, company) {
    const cur = doc.currency || company.currency;
    if (!cur || cur === company.currency) return round3(amount);
    return round3(amount * rateOf(doc, company));
  }

  // Le RÈGLEMENT d'une pièce en devise (10.14.0). Une facture de 1 000 € émise à 3,300 se règle un
  // mois plus tard à 3,400 : la banque reçoit 3 400 DT, pas 3 300. SkanFact convertissait le
  // règlement au taux de la FACTURE — le solde bancaire de la page ne retombait jamais sur le relevé
  // réel, et l'écart de change n'existait nulle part. Un règlement porte son taux du jour
  // (`exchangeRate`, par défaut celui de la pièce) : la banque bouge de ce qu'elle a vraiment reçu ou
  // payé, le client ou le fournisseur se solde au taux de SA pièce, et la différence est un gain (755)
  // ou une perte (655) de change — la règle des avoirs à un autre taux, appliquée au règlement.
  function tauxDuReglement(piece, p, company) {
    const cur = (piece || {}).currency || (company || {}).currency;
    if (!cur || cur === (company || {}).currency) return 1;
    const r = Number((p || {}).exchangeRate);
    return r > 0 ? r : rateOf(piece, company);
  }
  // Ce que la banque a vraiment reçu ou payé, en devise de la société.
  function montantRegle(piece, p, company) {
    const a = Number((p || {}).amount) || 0;
    const cur = (piece || {}).currency || (company || {}).currency;
    if (!cur || cur === (company || {}).currency) return round3(a);
    return round3(a * tauxDuReglement(piece, p, company));
  }
  // L'écart entre ce que la banque a bougé et ce que le tiers voit soldé (au taux de la pièce).
  function ecartDuReglement(piece, p, company) {
    return round3(montantRegle(piece, p, company) - toBase(piece, Number((p || {}).amount) || 0, company));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // ---------- dates : une règle, une seule ----------
  // Une date de l'application est un JOUR DU CALENDRIER (« 2026-09-12 »), jamais un instant. Toute
  // l'arithmétique se fait donc en UTC pur, sur la chaîne, sans jamais passer par l'heure locale.
  // L'ancienne version construisait la date en heure LOCALE puis la relisait en UTC : à minuit à
  // Tunis (UTC+1) il est encore 23 h la veille en UTC, et `addDays(d, 1)` renvoyait… `d`. Sur une
  // machine réglée en UTC, rien ne se voyait ; sur le Mac de l'utilisateur, une échéance à 30 jours
  // tombait un jour trop tôt et la boucle de `workingDays` ne finissait jamais — l'app entière gelait.
  // `today()` est l'exception qui confirme la règle : c'est le jour LOCAL, celui du calendrier de
  // l'utilisateur, pas le jour UTC (qui, le soir, est déjà demain à l'est et encore hier à l'ouest).
  function isoDay(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(iso, days) {
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return '';
    d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
    return isoDay(d);
  }
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }   // month 1-12
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nl2br(s) { return escapeHtml(s).replace(/\n/g, '<br>'); }

  // Le capital social s'écrit comme les autres montants de la pièce (rapport QA, 10.12.0) : « 10000 »
  // tapé nu sortait « Capital 10000 » en pied de chaque document, là où tout le reste s'écrit
  // « 2 262,000 DT ». Seul un nombre NU (chiffres et espaces) se met en forme : un texte déjà écrit
  // (« 1 000 DT », « 10.000 dinars ») est celui de l'utilisateur et reste tel quel — et « 10.000 »
  // se lit dix mille ou dix selon qui l'écrit, donc on ne le devine pas.
  function capitalAffiche(capital, currency, lang) {
    const s = String(capital == null ? '' : capital).trim();
    if (!/^\d[\d\s]*$/.test(s)) return s;
    const n = Number(s.replace(/\s/g, ''));
    return n > 0 ? money(n, normCurrency(currency), 0, lang) : s;
  }

  // Le pluriel. Il vivait dans les DEUX renderers et manquait ici, alors que core.js écrit lui aussi
  // des phrases qu'on lit à l'écran : les lignes de « À faire », la liste de ce qui manque au
  // paquet du comptable, les bulletins. « 1 facture(s) en brouillon » paraît bâclé où qu'il soit
  // écrit. `plur` sert aux pluriels irréguliers ; `sAccord` accorde ce qui SUIT le nom.
  const plFr = (n, un, plur) => `${Math.abs(n) >= 1000 ? Number(n).toLocaleString('fr-FR') : n} ${Math.abs(n) > 1 ? (plur || un + 's') : un}`;
  const sAccord = n => (Number(n) > 1 ? 's' : '');

  // La ponctuation double à la française (10.14.0) : « ? », « ! », « ; », « : » et l'intérieur des
  // guillemets prennent une espace FINE INSÉCABLE. Avec une espace ordinaire, le navigateur coupe
  // juste avant : dans le bandeau d'une question du comptable, le « ? » commençait la ligne, tout
  // seul. Le texte d'une question est tapé DANS LE CABINET, avec des espaces ordinaires : c'est donc
  // ici, à l'affichage, qu'il se corrige — jamais dans la donnée, qui repart telle quelle. Jumelle
  // de `typo` (visite.js) et de `typographie()` du Cabinet (9.4.2) ; un test compare les corps.
  const typoFr = t => String(t == null ? '' : t).replace(/ ([?!;:»%])/g, '\u202f$1').replace(/« /g, '«\u202f');

  // Un délai en jours réglé par l'utilisateur (10.12.0). ZÉRO est un délai — « à réception » —, et
  // `Number(x) || 30` le changeait en trente jours : une entreprise réglée « paiement à réception »
  // recevait des factures « À régler avant le » un mois plus tard. C'est le piège de la 7.16.0
  // (`limit || 20` rend le « tout » impossible à demander). Seule une valeur ABSENTE ou illisible
  // prend le défaut.
  function delaiJours(v, defaut) {
    if (v === '' || v == null) return defaut;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : defaut;
  }

  // Une recherche TAPÉE (10.12.0) : insensible aux accents et aux majuscules, et mot par mot.
  // « hotel » ne trouvait pas « Hôtel Dar El Marsa SARL », ni « cafe » le « Café des Arts », ni
  // « delai » le réglage « Délai de paiement » — dans les quinze recherches de l'application, la
  // palette Ctrl K et l'Aide comprises. Le Cabinet plie les accents depuis la 6.8.0 : le jumeau
  // manquant (7.3.0), sur le geste qu'on fait le plus. Mot par mot : « marsa hotel » trouve aussi.
  // Les ligatures aussi (10.14.0) : « œ » n'est pas un « o » accentué, la décomposition ne le touche
  // pas — et un clavier AZERTY ne le tape pas. « main d'oeuvre » ne trouvait donc jamais la
  // prestation « Main-d'œuvre » que l'assistant pose pour trois métiers, et l'import d'un tableur qui
  // écrit « oeuvre » créait un doublon à côté de l'exemple.
  const plier = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\u0153/g, 'oe').replace(/\u00e6/g, 'ae');
  function correspondRecherche(texte, q) {
    const mots = plier(q).split(/\s+/).filter(Boolean);
    if (!mots.length) return true;
    const t = plier(texte);
    return mots.every(m => t.includes(m));
  }

  // Le RANG d'un résultat de recherche (10.14.0), jugé sur le NOM de ce qu'on ouvre — jamais sur le
  // texte où l'on a cherché (l'objet d'une pièce, le client d'une facture, le corps d'un article).
  // La palette Ctrl K coupait à douze AVANT de classer : sur l'exemple de cinq ans, « audit » ne
  // rendait que douze factures dont l'objet parle d'audit, et jamais la prestation « Audit de
  // sécurité réseau », rangée après elles. Un extrait coupé avant d'être classé montre ce qui est
  // arrivé en premier, pas ce qu'on cherchait. 3 : le nom commence par la recherche ; 2 : chaque mot
  // commence un mot du nom ; 1 : le nom contient chaque mot ; 0 : trouvé ailleurs que dans le nom.
  // Les mots se découpent sur `\p{L}\p{N}` et pas sur `[a-z]` : une raison sociale en arabe a des
  // mots elle aussi (règle 6.8.1).
  function rangRecherche(nom, q) {
    const n = plier(nom), requete = plier(q).trim();
    if (!requete) return 0;
    if (n.startsWith(requete)) return 3;
    const mots = requete.split(/\s+/).filter(Boolean);
    const debuts = n.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (mots.every(m => debuts.some(d => d.startsWith(m)))) return 2;
    if (mots.every(m => n.includes(m))) return 1;
    return 0;
  }

  // La liste d'une recherche, dans l'ordre où elle s'affiche (10.14.0) : on garde ce qui contient
  // chaque mot, on CLASSE par `rangRecherche`, à rang égal l'ordre d'arrivée. Chaque élément porte
  // `main` (le nom qu'on lit), `text` (où l'on cherche) et `piece` pour une pièce. Les pièces se
  // comptent par centaines sur cinq ans, et leur numéro commence comme la page qu'on cherche
  // (« fac » → FAC-2026-…) : au-delà des `plafondPieces` premières, elles passent APRÈS tout le reste.
  // Elles ne poussent plus une page, un client ou une prestation hors des premières lignes, et elles
  // remplissent encore la liste quand rien d'autre ne répond (« 2026 »). `texte` permet à l'appelant
  // de garder son texte déjà plié d'une frappe à l'autre.
  function classerRecherche(elements, q, opts = {}) {
    const requete = plier(q).trim();
    if (!requete) return [];
    const mots = requete.split(/\s+/).filter(Boolean);
    const texte = opts.texte || (x => plier(x.text));
    const plafond = opts.plafondPieces == null ? 6 : opts.plafondPieces;
    const classes = (elements || []).map((x, i) => ({ x, i }))
      .filter(o => { const t = texte(o.x); return mots.every(m => t.includes(m)); })
      .map(o => ({ ...o, r: rangRecherche(o.x.main, requete) }))
      .sort((a, b) => b.r - a.r || a.i - b.i);
    const tete = [], reste = [];
    let pieces = 0;
    classes.forEach(({ x }) => {
      if (x.piece && pieces >= plafond) reste.push(x);
      else { if (x.piece) pieces++; tete.push(x); }
    });
    return tete.concat(reste);
  }

  // 10.14.0 — une facture qu'on vient d'émettre se disait « envoyée », avant tout envoi : c'est le
  // nom de la VALEUR depuis la 1.4.0 (elle reste, les données ne bougent pas), pas un mot pour
  // quelqu'un qui n'a rien envoyé. Une facture se dit « émise ». Une proforma, elle, garde
  // « envoyée » : c'est le geste d'envoi qui la pose (STATUT_ENVOI). Sans type, c'est une facture
  // — le journal des ventes et les listes de factures n'en passent pas.
  function statusLabel(s, type) {
    if (s === 'envoyée' && type !== 'proforma') return 'émise';
    if (s === 'partielle' && type === 'commande') return 'livrée en partie';
    return STATUS_LABELS[s] || s;
  }

  // ---------- numérotation ----------
  // Format : DEV-2026-001 / FAC-2026-001 / AVO-2026-001, compteur par type et par année.
  // Devis : numéro au premier enregistrement. Factures et avoirs : numéro à l'ÉMISSION seulement
  // (un brouillon n'a pas de numéro), pour une numérotation continue sans trou.

  function nextNumber(data, type, dateIso) {
    const year = (dateIso || today()).slice(0, 4);
    const key = `${type}-${year}`;
    const prefix = PREFIX[type] || 'DOC';
    // On repart du max existant pour éviter un doublon si le compteur est incohérent. La SÉRIE décide
    // (10.15.0) : un ticket de caisse est une facture, mais il a sa numérotation à lui.
    const existing = data.documents
      .filter(d => serieDe(d) === type && d.number && d.number.startsWith(`${prefix}-${year}-`))
      .map(d => parseInt(d.number.split('-')[2], 10) || 0);
    const fromDocs = existing.length ? Math.max(...existing) : 0;
    const fromCounter = data.counters[key] || 0;
    const seq = Math.max(fromDocs, fromCounter) + 1;
    data.counters[key] = seq;
    return `${prefix}-${year}-${String(seq).padStart(3, '0')}`;
  }

  // ---------- la numérotation continue (10.14.0) ----------
  //
  // Quelqu'un qui facturait déjà — dans un autre logiciel, sur un carnet — arrive dans SkanFact en
  // cours d'année : sa première facture ici doit porter le numéro qui SUIT sa dernière, pas FAC-…-001.
  // Une numérotation d'une année est continue (À VÉRIFIER avec le comptable) : repartir à 001 en
  // septembre donne deux factures « 001 » la même année, l'une chez l'ancien logiciel, l'autre ici.
  //
  // On règle la DERNIÈRE pièce émise ailleurs (c'est le numéro qu'on a sous les yeux, sur son dernier
  // papier) ; `nextNumber` en fait la suivante, puisqu'il repart de max(pièces, compteur).
  const TYPES_NUMEROTES = ['facture', 'avoir', 'devis'];
  function etatNumerotation(data, type, annee) {
    const d = data || {};
    const year = String(annee || today().slice(0, 4));
    const prefix = PREFIX[type] || 'DOC';
    const numeros = (d.documents || [])
      .filter(x => serieDe(x) === type && x.number && x.number.startsWith(`${prefix}-${year}-`))
      .map(x => parseInt(x.number.split('-')[2], 10) || 0);
    const derniereIci = numeros.length ? Math.max(...numeros) : 0;
    const compteur = Number((d.counters || {})[`${type}-${year}`]) || 0;
    const derniere = Math.max(derniereIci, compteur);
    const numero = n => `${prefix}-${year}-${String(n).padStart(3, '0')}`;
    return {
      type, annee: year, prefix,
      piecesIci: numeros.length,          // pièces de ce type et de cette année déjà numérotées DANS SkanFact
      derniereIci,                        // la plus haute d'entre elles (0 : aucune)
      derniere,                           // la dernière prise, ici ou ailleurs (celle que suit la prochaine)
      prochaine: numero(derniere + 1),
      derniereNumero: derniere ? numero(derniere) : '',
      // Une facture et un avoir ont une valeur légale : leur suite ne se touche plus une fois qu'une
      // pièce de l'année est numérotée ici — la changer laisserait un trou dans une série continue.
      verrouillee: SALES_TYPES.includes(type) && numeros.length > 0
    };
  }
  // Poser la dernière pièce émise AILLEURS. Rend { ok, motif } ; n'écrit rien quand il refuse.
  function poserNumerotation(data, type, annee, derniere) {
    const e = etatNumerotation(data, type, annee);
    const brut = String(derniere == null ? '' : derniere).trim();
    const n = brut === '' ? 0 : Number(brut);
    if (!Number.isInteger(n) || n < 0 || n > 99999) {
      return { ok: false, motif: 'Le numéro de ta dernière pièce est un nombre entier : 47 pour ' + `${e.prefix}-${e.annee}-047. Laisse vide si tu n'en as émis aucune.` };
    }
    if (n === e.derniere) return { ok: true, change: false, etat: e };
    if (e.verrouillee) {
      const quoi = type === 'avoir' ? `Tes avoirs de ${e.annee} sont déjà numérotés` : `Tes factures de ${e.annee} sont déjà numérotées`;
      return { ok: false, motif: `${quoi} dans SkanFact (jusqu'à ${e.prefix}-${e.annee}-${String(e.derniereIci).padStart(3, '0')}) : changer la suite laisserait un trou dans une série qui doit être continue.` };
    }
    if (n < e.derniereIci) {
      return { ok: false, motif: `${e.prefix}-${e.annee}-${String(e.derniereIci).padStart(3, '0')} existe déjà dans SkanFact : la dernière pièce ne peut pas être plus ancienne.` };
    }
    if (!data.counters || typeof data.counters !== 'object') data.counters = {};
    data.counters[`${type}-${e.annee}`] = n;
    return { ok: true, change: true, etat: etatNumerotation(data, type, annee) };
  }
  // La TOUTE première pièce d'un type légal : aucune n'a encore de numéro, et aucune suite n'a été
  // posée pour l'année. C'est le moment où l'on demande « tu facturais déjà ? » — pas avant, où la
  // question serait abstraite, ni après, où la suite ne se touche plus.
  function premiereNumerotation(data, type, annee) {
    if (!SALES_TYPES.includes(type)) return false;
    const e = etatNumerotation(data, type, annee);
    return !(data.documents || []).some(x => x.type === type && x.number) && !e.derniere;
  }

  function isLocked(doc) { return (doc.type === 'facture' || doc.type === 'avoir') && doc.status !== 'brouillon'; }
  function isIssued(doc) { return doc.status !== 'brouillon'; }

  // ---------- calculs ----------

  // (1.155.0) Une ligne de titre : elle nomme une section de la pièce et porte son sous-total, sans rien compter.
  const estTitre = l => !!l && l.kind === 'titre';
  // Le sous-total HT de chaque section : les lignes qui suivent un titre, jusqu'au titre suivant. Clé : l'index du
  // titre dans `doc.lines`. Les montants sont ceux de `computeTotals` (la remise de la ligne déduite, pas la globale).
  function sousTotauxDeSections(doc, company) {
    const t = computeTotals(doc, company);
    const out = {};
    let titre = -1;
    t.lines.forEach((l, i) => {
      if (l.titre) { titre = i; out[i] = 0; return; }
      if (titre >= 0) out[titre] = round3(out[titre] + l.ht);
    });
    return out;
  }
  function computeTotals(doc, company) {
    // 10.14.1 — une pièce se calcule aux décimales de SA devise : au millime pour le dinar, au
    // centime pour l'euro ou le dollar. Calculée au millime, une facture en euros imprimait
    // « 938,01 EUR » pour un net interne de 938,014 : payée du montant imprimé, elle restait
    // « partielle » et en retard pour 0,004 €, et la facture imprimée ne s'additionnait pas
    // (HT + TVA + timbre ≠ net). Le PDF a toujours dit le vrai montant ; le calcul le rejoint.
    const rd = arrondiDevise(doc.currency || (company || {}).currency);
    // (plateforme, lot caisse 3) Au comptoir, le prix d'étiquette fait foi : une pièce « prix TTC » (le ticket, et l'avoir
    // de son retour) a pour ligne la quantité × le prix unitaire TTC (le HT × (1 + taux), arrondi comme il s'affiche) ;
    // la remise porte sur le TTC ; par taux, la TVA s'extrait du TTC et le HT en est la différence. La même règle que le
    // serveur (calculerPieceTtc). À VÉRIFIER avec un comptable : la TVA d'un ticket extraite du TTC.
    const prixTtc = doc.prixTtc === true;
    // (1.155.0, maquette de la facture) Une ligne de TITRE (`kind: 'titre'`) range les lignes en sections : elle ne
    // compte pour rien (elle reste dans `lines`, à zéro, pour que l'index d'une ligne soit le même partout) ; son
    // sous-total se lit avec `sousTotauxDeSections`. La remise d'une ligne (`discount`, en %) se retire de son montant
    // arrondi (`brut`) avant la remise globale, comme le serveur (moteur/piece.ts).
    const lines = (doc.lines || []).map(l => {
      if (estTitre(l)) return { ...l, titre: true, qty: 0, unitPrice: 0, vatRate: 0, brut: 0, ht: 0, vat: 0, ttc: 0, noDiscount: true };
      const qty = Number(l.qty) || 0;
      const unit = Number(l.unitPrice) || 0;
      const rate = Number(l.vatRate) || 0;
      const rl = Number(l.discount) || 0;
      if (prixTtc) {
        const brut = rd(qty * rd(unit * (1 + rate / 100)));
        const ttc = rd(brut - rd(brut * rl / 100));
        const vat = rd(ttc * rate / (100 + rate));
        return { ...l, qty, unitPrice: unit, vatRate: rate, brut, ht: rd(ttc - vat), vat, ttc, noDiscount: !!l.noDiscount };
      }
      const brut = rd(qty * unit);
      const ht = rd(brut - rd(brut * rl / 100));
      const vat = rd(ht * rate / 100);
      return { ...l, qty, unitPrice: unit, vatRate: rate, brut, ht, vat, ttc: rd(ht + vat), noDiscount: !!l.noDiscount };
    });
    // Une pièce « prix TTC » : le HT avant remise s'extrait par taux, comme le net (ligne à ligne, l'arrondi inventait une
    // remise d'un millime sur un ticket sans remise, vu sur l'écran du client le 06/10/2026).
    const brutParTaux = {};
    if (prixTtc) lines.forEach(l => { if (!l.titre) brutParTaux[l.vatRate] = rd((brutParTaux[l.vatRate] || 0) + l.ttc); });
    const totalHT = prixTtc ? rd(Object.keys(brutParTaux).reduce((s, k) => s + brutParTaux[k] - rd(brutParTaux[k] * Number(k) / (100 + Number(k))), 0))
      : rd(lines.reduce((s, l) => s + l.ht, 0));
    const discountRate = Number(doc.discountRate) || 0;
    // La remise globale ne porte pas sur les lignes « noDiscount » (déduction d'un acompte déjà facturé).
    const discountable = rd(lines.filter(l => !l.noDiscount).reduce((s, l) => s + (prixTtc ? l.ttc : l.ht), 0));
    const remiseCalculee = rd(discountable * discountRate / 100);
    // TVA par taux, appliquée après remise globale (remise répartie proportionnellement)
    const factor = discountable > 0 ? (discountable - remiseCalculee) / discountable : 1;
    const vatByRate = {};
    let fodec = 0;
    // (plateforme, 1.275.0, audit du 04/11/2026, G04) La règle de calcul de la pièce (`calcul`, gardée avec elle, la même
    // que le serveur : moteur/piece.ts, `repartir`). Absente : celle de la v10 (la remise arrondie ligne à ligne, la TVA
    // d'un taux arrondie à chaque ligne ajoutée), pour qu'une pièce d'avant se relise au millime où elle a été émise. 2 :
    // la remise répartie exactement par les cumuls (aucun reliquat : la somme des bases remisées est le HT net) et la TVA
    // d'un taux sur sa base entière. À VÉRIFIER avec un comptable : la règle d'arrondi de la TVA sur une facture.
    const regle2 = doc.calcul === 2;
    let cumul = 0, avant = 0;
    const partRepartie = m => { cumul = rd(cumul + m); const fin = rd(cumul * (discountable - remiseCalculee) / discountable); const p = rd(fin - avant); avant = fin; return p; };
    if (prixTtc) {
      const ttcParTaux = {};
      // Une seule division (comme le serveur) : un facteur en virgule flottante perdait un millime sur des millions.
      lines.forEach(l => { if (l.titre) return; ttcParTaux[l.vatRate] = rd((ttcParTaux[l.vatRate] || 0) + rd(l.noDiscount || discountable <= 0 ? l.ttc : regle2 ? partRepartie(l.ttc) : l.ttc * (discountable - remiseCalculee) / discountable)); });
      Object.keys(ttcParTaux).forEach(k => {
        const rate = Number(k), vat = rd(ttcParTaux[k] * rate / (100 + rate));
        vatByRate[k] = { base: rd(ttcParTaux[k] - vat), vat };
      });
    } else {
      // (1.155.0) La FODEC d'une ligne qui la porte (`fodec`) : le taux de la pièce (`fodecRate`, en %, lu à la règle
      // `fodec.taux` du serveur et gelé à l'émission) sur sa base remisée, arrondi à la ligne, ajouté à la base de son
      // taux de TVA. La même règle que le serveur (moteur/piece.ts). Une pièce « prix TTC » n'en porte jamais.
      // À VÉRIFIER avec un comptable : l'assiette et l'entrée dans la base de la TVA.
      const tauxFodec = Number(doc.fodecRate) || 0;
      lines.forEach(l => {
        if (l.titre) return;
        const remisee = rd(l.noDiscount || discountable <= 0 ? l.ht : regle2 ? partRepartie(l.ht) : l.ht * factor);
        const f = l.fodec === true && tauxFodec ? rd(remisee * tauxFodec / 100) : 0;
        if (f) fodec = rd(fodec + f);
        const base = rd(remisee + f);
        vatByRate[l.vatRate] = vatByRate[l.vatRate] || { base: 0, vat: 0 };
        vatByRate[l.vatRate].base = rd(vatByRate[l.vatRate].base + base);
        if (!regle2) vatByRate[l.vatRate].vat = rd(vatByRate[l.vatRate].vat + base * l.vatRate / 100);
        if (f) vatByRate[l.vatRate].fodec = rd((vatByRate[l.vatRate].fodec || 0) + f);
      });
      if (regle2) Object.keys(vatByRate).forEach(k => { vatByRate[k].vat = rd(vatByRate[k].base * Number(k) / 100); });
    }
    const netHT = prixTtc ? rd(Object.values(vatByRate).reduce((s, v) => s + v.base, 0)) : rd(totalHT - remiseCalculee);
    const discount = prixTtc ? rd(totalHT - netHT) : remiseCalculee;
    const totalVAT = rd(Object.values(vatByRate).reduce((s, v) => s + v.vat, 0));
    // Timbre : d'office sur la facture, jamais sur un devis ou un bon. Sur l'avoir et la proforma il se
    // demande explicitement — une proforma n'est pas une facture, elle ne déclenche pas le droit de timbre.
    // À VÉRIFIER avec le comptable.
    // (1.155.0) Une vente à l'exportation (`export`) ne paie pas le timbre (note commune du ministère ; À VÉRIFIER pour
    // une prestation de services rendue à l'étranger).
    const stampApplies = !doc.export && ((doc.type === 'facture' && doc.applyStamp !== false)
      || ((doc.type === 'avoir' || doc.type === 'proforma') && doc.applyStamp === true));
    // Le timbre est un montant en DINARS fixé par l'État — pas un nombre sans unité. Sur une facture
    // en euros, l'ajouter tel quel ajoutait « 1 euro », soit 3,4 fois le timbre dû. Il se convertit
    // dans la devise du document, comme n'importe quel montant.
    // `exchangeRate` se lit « 1 devise = x DT » : un dinar vaut donc 1/x devise.
    // Le montant du timbre est GELÉ sur la pièce au moment de l'émission (7.1.1). Avant, il était
    // relu dans les réglages à chaque affichage : le jour où l'État change le timbre — et où
    // l'utilisateur met son réglage à jour — le total de TOUTES les factures déjà émises, envoyées
    // et déclarées changeait avec lui. Le PDF chez le client disait 1 191, l'application disait
    // 1 192, et le journal des ventes suivait l'application.
    // C'est la règle de la 5.0.0 sur les bulletins de paie (`slip.computed`), qui n'avait jamais été
    // appliquée aux factures. Un brouillon, lui, suit le réglage courant : il n'est encore rien.
    const timbreDu = doc.stampFee === undefined || doc.stampFee === null || doc.stampFee === ''
      ? (company.stampFee || 0) : Number(doc.stampFee) || 0;
    const stamp = stampApplies ? rd(timbreDu / rateOf(doc, company)) : 0;
    const totalTTC = rd(netHT + fodec + totalVAT + stamp);
    // Retenue à la source (factures / avoirs) : calculée sur le TTC hors timbre. À VÉRIFIER avec le comptable.
    // La retenue à la source ne se pratique que sur ce qui est réellement payé : facture, avoir, proforma.
    const withholdingRate = ['facture', 'avoir', 'proforma'].includes(doc.type) ? (Number(doc.withholdingRate) || 0) : 0;
    // (1.155.0) Sous le seuil (en dinars, lu au serveur : la règle `retenue.seuil`), une pièce
    // ne porte pas de retenue : elle naîtra au paiement si le client en règle plusieurs pour ce montant. Comparé en
    // dinars, au millime, comme le serveur. Sans seuil connu, rien ne change.
    // Le seuil est gardé SUR la pièce (`seuilRetenue`, posé par l'écran au brouillon, scellé à l'émission) : une loi qui
    // le change ne réécrit pas une facture déjà faite. Une pièce d'avant n'en a pas : celui de l'entreprise, sinon aucun.
    const seuil = doc.seuilRetenue != null && doc.seuilRetenue !== '' ? Number(doc.seuilRetenue) || 0 : Number((company || {}).seuilRetenue) || 0;
    // La retenue et son seuil portent sur le TTC hors timbre, FODEC comprise (comme le serveur).
    const horsTimbre = rd(netHT + fodec + totalVAT);
    const sousLeSeuil = seuil > 0 && round3(horsTimbre * rateOf(doc, company)) < seuil;
    const withholding = sousLeSeuil ? 0 : rd(horsTimbre * withholdingRate / 100);
    const netToPay = rd(totalTTC - withholding);
    // Le timbre en DINARS, tel que la loi le fixe : c'est lui qui se déclare et qui va au 4368. Converti
    // aller-retour par la devise (1 / 3,35 = 0,30 € ; 0,30 × 3,35 = 1,005), il était déclaré 1,002 DT.
    const stampBase = stampApplies ? round3(timbreDu) : 0;
    return { lines, totalHT, discountRate, discount, netHT, vatByRate, totalVAT, fodec, stamp, stampBase, totalTTC, withholdingRate, withholding, netToPay, sousLeSeuil };
  }

  // ---------- le lot de calcul (10.14.0, saturation) ----------
  // Avec huit mille pièces, l'application gelait douze secondes à CHAQUE page, et le chien de garde
  // la rechargeait : le statut d'une facture relisait toutes les pièces pour trouver ses avoirs, et
  // le stock d'un article relisait tous les achats et toutes les ventes — pour chaque facture, pour
  // chaque article. Des boucles dans des boucles, invisibles sur l'exemple (quatre cents pièces).
  // Le remède n'est pas un cache qu'on invalide (une donnée modifiée en place ne prévient personne),
  // c'est un LOT : pendant un calcul qui ne modifie rien — un dessin, « À faire », un journal —, les
  // index se construisent une fois ; à la sortie du lot, ils disparaissent. Hors lot, chaque fonction
  // relit tout, exactement comme avant : un appel isolé ne peut jamais lire un index périmé.
  // Un comparateur construit UNE fois : `localeCompare(b, undefined, options)` en construit un à
  // chaque appel, et un tri de quatorze mille écritures en faisait deux cent mille (10.14.0).
  const TRI_NUMERIQUE = new Intl.Collator(undefined, { numeric: true });
  const TRI_FR = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  let lot = null;
  function enLot(fn) {
    if (lot) return fn();
    lot = new Map();
    try { return fn(); } finally { lot = null; }
  }
  function duLot(data, cle, calc) {
    if (!lot || !data || typeof data !== 'object') return calc();
    let parData = lot.get(data);
    if (!parData) lot.set(data, parData = new Map());
    if (!parData.has(cle)) parData.set(cle, calc());
    return parData.get(cle);
  }

  // Avoirs émis rattachés à une facture
  function creditsFor(data, invoiceId) {
    if (lot && invoiceId) {
      const idx = duLot(data, 'avoirs', () => {
        const m = new Map();
        (data.documents || []).forEach(d => {
          if (d.type !== 'avoir' || !d.creditOf || d.status === 'brouillon') return;
          if (!m.has(d.creditOf)) m.set(d.creditOf, []);
          m.get(d.creditOf).push(d);
        });
        return m;
      });
      return (idx.get(invoiceId) || []).slice();
    }
    return (data.documents || []).filter(d => d.type === 'avoir' && d.creditOf === invoiceId && d.status !== 'brouillon');
  }

  // Le remboursement d'un trop-perçu (10.14.0). Un avoir émis sur une facture déjà payée, ou un
  // paiement plus fort que la facture, laisse de l'argent au CLIENT ; le rendre est une SORTIE, et
  // elle s'enregistre sur la facture même, comme un règlement de montant NÉGATIF. Le signe fait
  // tout le reste sans qu'aucun agrégateur ait à s'en souvenir (la leçon de la 10.2.0) : le reste à
  // payer remonte à zéro, la trésorerie voit une sortie, et l'écriture change de colonne toute
  // seule (D client / C banque, règle 6.3.0). Seuls les lecteurs de DATES doivent le connaître :
  // rendre de l'argent n'est pas « le jour où le client a fini de payer ».
  function estRemboursement(p) { return (Number(p && p.amount) || 0) < 0; }
  function dateDernierReglement(inv) {
    const dates = ((inv && inv.payments) || []).filter(p => !estRemboursement(p)).map(p => p.date).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : '';
  }

  // Situation d'une facture : total, avoirs, paiements, reste à payer.
  function invoiceBalance(doc, data, company) {
    const totals = computeTotals(doc, company);
    const credits = creditsFor(data, doc.id);
    const credited = round3(credits.reduce((s, a) => s + montantDansDeviseDe(a, computeTotals(a, company).netToPay, doc, company), 0));
    const paid = round3((doc.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    // Une facture marquée ANNULÉE ne doit plus rien (10.14.0). Le relevé, l'âge des impayés, le
    // lettrage et les écritures l'écartaient tous ; sa propre page, elle, affichait « Reste à payer
    // 633,370 DT » en orange — la seule des cinq à dire le contraire. Elle ne se marque annulée que
    // sans paiement ni avoir, donc il n'y a rien d'autre à solder.
    const annulee = doc.status === 'annulée';
    // Le reste se lit aux décimales de la DEVISE de la pièce (10.14.1) : un règlement saisi au
    // millime avant la 10.14.1 (« 938,014 € ») sur une facture qui vaut 938,01 € ne laisse ni un
    // reste ni un trop-perçu de 0,004 € — une fraction de centime n'existe pas sur un virement.
    const remaining = annulee ? 0 : arrondiDevise(doc.currency || (company || {}).currency)(totals.netToPay - credited - paid);
    return { totals, credits, credited, paid, remaining, annulee };
  }

  // Le titre d'une question (10.14.0). Les quatre-vingt-sept questions de l'app entreprise
  // s'intitulaient toutes « Confirmation », ce qui ne dit pas ce qu'on confirme : on lit le corps
  // pour savoir si l'on supprime un paiement ou si l'on quitte l'exemple. Le Cabinet donne un titre
  // à chacune depuis toujours (le jumeau, 7.3.0). Ici le titre se DÉDUIT, dans cet ordre :
  //   1. la question par laquelle le message commence (« Supprimer le paiement de 50 DT ? ») — elle
  //      devient le titre et quitte le corps, pour ne pas se lire deux fois ;
  //   2. sinon le geste du bouton, quand il en nomme un (« Marquer annulée ? ») ;
  //   3. sinon « Avant de continuer » — un « … quand même » est un avertissement, pas un geste.
  // Une question trop longue pour un titre reste dans le corps : un titre de trois lignes ne se lit
  // plus comme un titre.
  const GESTES_GENERIQUES = /^(confirmer|continuer|ok|oui|valider)$|quand même/i;
  // Le bouton d'une question dit le GESTE, jamais « Confirmer » (10.14.0) : « Supprimer ce
  // mouvement ? » au-dessus de « Confirmer » fait relire la question pour savoir ce que le clic
  // fera. Quand l'appelant ne nomme pas le bouton, il prend le verbe par lequel la question
  // commence — un infinitif, jamais « Annuler » (le bouton d'à côté s'appelle déjà ainsi) ni un
  // mot qui en a seulement la terminaison (« Votre », « Autre »).
  const PAS_UN_GESTE = /^(annuler|votre|notre|autre|entre|contre|titre|cette|lettre|ordre|nombre|membre)$/i;
  function gesteQuestion(titre) {
    const m = /^([A-ZÉÈÀÂÎÔÛa-zéèàâîôûç][a-zéèêëàâîïôûç-]{2,}(?:er|ir|oir|re))(?=[\s?,.]|$)/.exec(String(titre || '').trim());
    if (!m || PAS_UN_GESTE.test(m[1]) || GESTES_GENERIQUES.test(m[1])) return '';
    return m[1].charAt(0).toUpperCase() + m[1].slice(1);
  }
  function titreQuestion(msg, okLabel) {
    const texte = String(msg == null ? '' : msg);
    // La PREMIÈRE phrase seulement : « La date est dans le futur. Enregistrer quand même ? » n'est
    // pas un titre, c'est un avertissement qui finit par une question.
    const m = /^([^?.!\n]{3,90}\?)[ \t]*\n?/.exec(texte);
    if (m) return { titre: m[1].trim(), corps: texte.slice(m[0].length).trim() };
    const geste = String(okLabel || '').trim().replace(/[….]+$/, '');
    if (geste && !GESTES_GENERIQUES.test(geste)) return { titre: geste + ' ?', corps: texte };
    return { titre: 'Avant de continuer', corps: texte };
  }

  // Deux délais sur la même facture (10.12.0, H-E23) : les conditions de paiement disent « à
  // réception » pendant que la pièce imprime « À régler avant le … ». En cas de retard, c'est le
  // client qui choisit lequel lire. Rend la phrase qui contredit l'échéance, ou ''. Une échéance le
  // jour même ne contredit rien. On ne réécrit JAMAIS la phrase de l'utilisateur : on la montre.
  function delaisContradictoires(company, doc) {
    if (!doc || doc.type !== 'facture' || !doc.date || !doc.dueDate || doc.dueDate <= doc.date) return '';
    const phrase = String(((doc.lang === 'en' ? (company || {}).paymentTermsEn : (company || {}).paymentTerms) || '')).trim();
    return /r[ée]ception|receipt/i.test(phrase) ? phrase : '';
  }

  // Pourquoi une facture émise ne se déverrouille plus (10.12.0). Le bandeau disait « déjà payée en
  // partie » sur une facture entièrement payée — la règle confondait « un paiement existe » et
  // « elle est soldée » —, et sa bulle disait « soldée » sur une facture payée à moitié. Trois
  // causes, trois phrases, et c'est la MÊME fonction qui les écrit toutes les deux. Une quatrième :
  // une facture que ses avoirs couvrent EN ENTIER n'a plus rien à corriger (`annulee`) — le bandeau
  // proposait encore « Corriger par un avoir… » en bouton principal, c'est-à-dire un avoir de trop.
  function motifVerrou(bal) {
    if (!bal) return { court: '', long: '', annulee: false };
    const net = bal.totals ? bal.totals.netToPay : 0;
    if ((bal.credits || []).length && net > 0 && bal.credited >= net - 0.0005) return { court: 'annulée par un avoir', long: 'Ses avoirs l\'annulent en entier : les pièces restent toutes dans la numérotation, et il n\'y a plus rien à corriger.', annulee: true };
    if ((bal.credits || []).length) return { court: 'un avoir existe', long: 'Un avoir corrige déjà cette facture : on ne rouvre pas une pièce qu\'une autre pièce corrige.' };
    if (bal.paid > 0 && bal.remaining <= 0.0005) return { court: 'entièrement payée', long: 'Cette facture est entièrement payée : rouvrir une pièce réglée changerait ce que le client a payé.' };
    if (bal.paid > 0) return { court: 'déjà payée en partie', long: 'Un paiement y est déjà enregistré : rouvrir la pièce changerait ce qu\'il règle.' };
    return { court: '', long: '' };
  }

  // Statut affiché. Facture : déduit des paiements et des avoirs. Devis : « expiré » quand la date de
  // validité est passée sans réponse du client (le statut enregistré, lui, reste « envoyé »).
  function effectiveStatus(doc, data, company, todayIso) {
    if (doc.type === 'devis') {
      return doc.status === 'envoyé' && doc.dueDate && doc.dueDate < (todayIso || today()) ? 'expiré' : doc.status;
    }
    // Une commande reçue se dit livrée, en partie ou en tout, par ses bons (brique 86). « Livrée » choisie
    // à la main reste le geste qui clôt une commande dont le reste ne partira pas.
    if (doc.type === 'commande') {
      if (doc.status !== 'reçue' || !data) return doc.status;
      const s = suiviCommande(data, doc);
      return s.livree ? 'livrée' : s.partielle ? 'partielle' : 'reçue';
    }
    if (doc.type !== 'facture') return doc.status;
    if (doc.status === 'brouillon' || doc.status === 'annulée') return doc.status;
    const b = invoiceBalance(doc, data, company);
    if (b.remaining <= 0.0005) {
      return b.totals.netToPay > 0 && b.credited >= b.totals.netToPay - 0.0005 ? 'annulée' : 'payée';
    }
    // (1.308.0) Un avoir diminue ce qui est dû ; il n'est pas un paiement : la facture qu'il réduit sans que rien ne soit reçu
    // reste à payer, ou en retard le lendemain de son échéance (le café qui rend une chaise n'a rien « payé en partie »).
    if (b.paid > 0) return 'partielle';
    if (doc.dueDate && doc.dueDate < (todayIso || today())) return 'retard';
    return 'envoyée';
  }

  // ---------- acompte / solde ----------

  // Lignes d'une facture d'acompte : un pourcentage du devis, une ligne par taux de TVA (base après remise).
  // 10.14.1 (DEV-16) — une part d'un devis est un MONTANT, pas un prix unitaire : elle s'arrondit aux
  // décimales de la devise du devis, comme la pièce qui la portera (`computeTotals`). Au millime, 17 %
  // d'un devis de 333,33 € donnaient une ligne à 56,666 € — un prix qu'aucun client ne peut payer,
  // affiché tel quel dans la grille de la facture d'acompte pendant que le PDF écrivait 56,67.
  function depositLines(quote, percent, company) {
    const t = computeTotals(quote, company);
    const pct = Number(percent) || 0;
    const rd = arrondiDevise(quote.currency || (company || {}).currency);
    return Object.keys(t.vatByRate).sort((a, b) => a - b).map(rate => ({
      label: `Acompte de ${String(pct).replace('.', ',')} % sur le devis ${quote.number}`,
      description: quote.subject || '',
      qty: 1, unit: '', unitPrice: rd(t.vatByRate[rate].base * pct / 100), vatRate: Number(rate), noDiscount: true
    }));
  }

  // Un acompte demandé en MONTANT fait ce montant (10.14.1, ACP-01). La fenêtre convertissait le
  // montant tapé en pourcentage, arrondi au millième, puis appliquait ce pourcentage aux bases du
  // devis : « 500 DT » faisait 500,002 TTC — la facture annoncée au client au téléphone ne tombait
  // pas juste. Ici les bases se répartissent entre les taux du devis au prorata, puis la plus forte
  // s'ajuste d'une unité de la devise (le millime, le centime) jusqu'à ce que HT + TVA, calculés
  // comme la facture les calculera, fassent le montant. Quand ce montant est inatteignable — une TVA
  // arrondie saute parfois une unité —, c'est le plus proche, et à égalité le plus bas : on ne
  // demande jamais au client plus que ce qu'on lui a dit. Le timbre vient en plus, comme pour un
  // acompte en pourcentage (7.19.0) : c'est le droit de la facture, pas une part du devis.
  function depositLinesMontant(quote, montant, company) {
    const cur = quote.currency || (company || {}).currency;
    const rd = arrondiDevise(cur);
    const pas = decimalsFor(cur) === 3 ? 0.001 : 0.01;
    const t = computeTotals(quote, company);
    const taux = Object.keys(t.vatByRate).map(Number).sort((a, b) => a - b);
    const ttcDevis = rd(taux.reduce((s, r) => s + t.vatByRate[r].base + t.vatByRate[r].vat, 0));
    const vise = rd(Number(montant) || 0);
    if (!(vise > 0) || !(ttcDevis > 0) || !taux.length) return [];
    const f = vise / ttcDevis;
    const bases = taux.map(r => rd(t.vatByRate[r].base * f));
    const ttcDe = bs => rd(bs.reduce((s, b, i) => s + b + rd(b * taux[i] / 100), 0));
    // Une seule base bouge, de quelques unités : celle qui fait tomber juste, et d'abord la plus forte
    // (une unité y pèse le moins, en proportion). À 19 %, une unité de base fait parfois deux unités
    // de TTC ; une autre base, à un autre taux, rattrape souvent l'unité que celle-là saute.
    const k = bases.reduce((m, b, i) => (Math.abs(b) > Math.abs(bases[m]) ? i : m), 0);
    const ordre = [k, ...bases.map((_, i) => i).filter(i => i !== k)];
    let meilleur = null;
    for (const i of ordre) {
      for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 8, -8, 10, -10, 12, -12]) {
        const essai = bases.slice(); essai[i] = rd(essai[i] + d * pas);
        if (essai[i] < 0) continue;
        const ecart = rd(ttcDe(essai) - vise);
        const mieux = !meilleur || Math.abs(ecart) < Math.abs(meilleur.ecart) - 1e-9
          || (Math.abs(Math.abs(ecart) - Math.abs(meilleur.ecart)) < 1e-9 && ecart < meilleur.ecart - 1e-9);
        if (mieux) meilleur = { essai, ecart };
      }
      if (meilleur && Math.abs(meilleur.ecart) < 1e-9) break;
    }
    return taux.map((rate, i) => ({
      label: `Acompte de ${money(vise, cur)} TTC sur le devis ${quote.number}`,
      description: quote.subject || '',
      qty: 1, unit: '', unitPrice: meilleur.essai[i], vatRate: rate, noDiscount: true
    }));
  }

  // Ce qu'un acompte demande, dit comme il a été demandé : « 500,000 DT TTC » quand on a tapé un
  // montant, « 30 % » quand on a tapé un pourcentage (ACP-01). Le pourcentage d'un acompte en montant
  // est exact mais illisible (13,514 %) : le montant est ce qu'on a annoncé au client.
  function acompteDit(dep, cur) {
    if (dep && Number(dep.montant) > 0) return money(Number(dep.montant), cur) + ' TTC';
    return `${String((dep && dep.percent) || 0).replace('.', ',')} %`;
  }

  // Lignes d'une facture de solde : les lignes du devis, moins les acomptes déjà facturés (émis).
  // La déduction reprend le HT de la ligne d'acompte tel que SA facture l'a compté — aux décimales de
  // sa devise (DEV-16) : un acompte en euros né avant la 10.14.1 porte encore 56,666, et sa facture a
  // compté 56,67.
  function settlementLines(quote, depositInvoices) {
    const lines = (quote.lines || []).map(l => ({ ...l }));
    (depositInvoices || []).forEach(inv => {
      const rd = arrondiDevise(inv.currency || quote.currency);
      (inv.lines || []).forEach(l => lines.push({
        label: `Acompte déjà facturé (${inv.number})`, description: '', qty: 1, unit: '',
        unitPrice: -rd((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)), vatRate: Number(l.vatRate) || 0, noDiscount: true
      }));
    });
    return lines;
  }

  // ---------- journal des ventes, TVA, encaissements ----------

  function inPeriod(iso, from, to) { return (!from || iso >= from) && (!to || iso <= to); }

  function salesJournal(data, company, period) {
    period = period || {};
    const docs = (data.documents || [])
      .filter(d => (d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon' && d.number && inPeriod(d.date, period.from, period.to))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || TRI_NUMERIQUE.compare((a.number || ''), b.number || ''));
    const noms = new Map(); (data.clients || []).forEach(c => { if (!noms.has(c.id)) noms.set(c.id, c.name || ''); });
    const clientName = id => noms.get(id) || '';
    return docs.map(d => {
      const t = computeTotals(d, company);
      const cancelled = d.type === 'facture' && d.status === 'annulée';
      const rate = (d.currency && d.currency !== company.currency) ? (Number(d.exchangeRate) || 1) : 1;
      const sign = (cancelled ? 0 : (d.type === 'avoir' ? -1 : 1)) * rate;
      const status = d.type === 'facture' ? effectiveStatus(d, data, company, period.today) : d.status;
      const bal = d.type === 'facture' ? invoiceBalance(d, data, company) : null;
      const vatByRate = {};
      // (1.155.0) La FODEC est dans la base de la TVA de son taux : elle en sort, le chiffre d'affaires reste le net HT.
      VAT_RATES.forEach(r => { const v = t.vatByRate[r]; vatByRate[r] = { base: round3((v ? v.base - (v.fodec || 0) : 0) * sign), vat: round3((v ? v.vat : 0) * sign) }; });
      const fodec = round3(Object.values(t.vatByRate).reduce((a, v) => a + round3((v.fodec || 0) * sign), 0));
      // 10.14.1 — le timbre se déclare en dinars, tel que la loi le fixe : reconverti depuis la
      // devise, il valait 1,002 DT sur une facture en euros à 3,35 (0,299 € × 3,35). Et la pièce se
      // referme au millime : ttc = bases + TVA + timbre + écart de conversion.
      //  - en dinars, le seul écart possible vient d'une remise répartie entre deux taux : il va dans
      //    la plus grosse base (le chiffre d'affaires reste le net HT de la pièce) ;
      //  - en devise, la pièce se convertit composante par composante, et le timbre payé en devise
      //    (0,29 €) ne vaut pas exactement le dinar dû : l'écart est un écart de CONVERSION, il va au
      //    change (655 / 755) — jamais dans le chiffre d'affaires ni sur le timbre.
      // Avant, le moteur « absorbait » cet écart sur la dernière ligne de l'écriture (le timbre), et
      // parfois dans la colonne d'en face : une ligne à deux colonnes que le Cabinet refusait.
      const typeSign = cancelled ? 0 : (d.type === 'avoir' ? -1 : 1);
      const timbre = round3((t.stampBase || 0) * typeSign);
      const ttc = round3(t.totalTTC * sign);
      const tva = round3(VAT_RATES.reduce((a, r) => a + vatByRate[r].vat, 0));
      const somme = round3(VAT_RATES.reduce((a, r) => a + vatByRate[r].base, 0));
      const ecart = round3(ttc - somme - tva - timbre - fodec);
      let ecartConversion = 0;
      if (ecart && rate === 1) {
        const r0 = VAT_RATES.reduce((m, r) => Math.abs(vatByRate[r].base) > Math.abs(vatByRate[m].base) ? r : m, VAT_RATES[0]);
        vatByRate[r0].base = round3(vatByRate[r0].base + ecart);
      } else ecartConversion = ecart;
      return {
        id: d.id, date: d.date, number: d.number, type: d.type, typeLabel: estTicket(d) ? 'Ticket' : TITLES[d.type], client: clientName(d.clientId) || (estTicket(d) || estRetourDeTicket(d, data) ? CLIENT_COMPTOIR : ''), clientId: d.clientId || '', subject: d.subject || '',
        ht: round3(VAT_RATES.reduce((a, r) => a + vatByRate[r].base, 0)), vatByRate, tva, timbre, fodec, ttc, ecartConversion,
        rs: round3(t.withholding * sign), net: round3(t.netToPay * sign), status, statusLabel: statusLabel(status),
        paid: bal ? round3(bal.paid * rate) : 0, remaining: bal ? round3(bal.remaining * rate) : 0, currency: d.currency || company.currency, rate,
        withholdingCertificate: !!d.withholdingCertificate, creditOfNumber: d.creditOfNumber || ''
      };
    });
  }

  function vatSummary(rows) {
    const byRate = {};
    VAT_RATES.forEach(r => { byRate[r] = { base: 0, vat: 0 }; });
    const sum = { ht: 0, tva: 0, timbre: 0, ttc: 0, rs: 0, net: 0 };
    rows.forEach(r => {
      VAT_RATES.forEach(rate => { byRate[rate].base = round3(byRate[rate].base + r.vatByRate[rate].base); byRate[rate].vat = round3(byRate[rate].vat + r.vatByRate[rate].vat); });
      Object.keys(sum).forEach(k => { sum[k] = round3(sum[k] + r[k]); });
    });
    return { byRate, ...sum, count: rows.length };
  }

  function paymentsJournal(data, company, period) {
    period = period || {};
    const clientName = id => ((data.clients || []).find(c => c.id === id) || {}).name || '';
    const rows = [];
    (data.documents || []).filter(d => d.type === 'facture').forEach(d => {
      const pays = (d.payments || []).map((p, i) => ({ p, i })).filter(x => inPeriod(x.p.date, period.from, period.to));
      if (!pays.length) return;
      // La retenue que le client garde sur CET encaissement (10.14.0) : elle naît au paiement, en
      // dinars au taux de la facture — celui auquel le 411 porte le brut.
      const rs = Number(d.withholdingRate) > 0 ? retenueSubie(d, data, company) : null;
      pays.forEach(({ p, i }) => {
        const m = PAYMENT_METHODS.find(x => x[0] === p.method);
        rows.push({ id: p.id, date: p.date, number: d.number, client: clientName(d.clientId) || (estTicket(d) ? CLIENT_COMPTOIR : ''), clientId: d.clientId || '', amount: montantRegle(d, p, company), amountTiers: toBase(d, Number(p.amount) || 0, company), rs: rs ? round3(toBase(d, rs.parts[cleReglement(p, i)] || 0, company)) : 0, remboursement: estRemboursement(p), method: m ? m[1] : (p.method || ''), reference: p.reference || '', note: p.note || '', docId: d.id, currency: d.currency || company.currency, accountId: p.accountId || '' });
      });
    });
    return rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // CSV lisible par Excel en français : séparateur « ; », virgule décimale, BOM UTF-8.
  //
  // Les colonnes `money` et `date` sortent par leur propre branche et ne passent jamais par la
  // parade à l'injection de formule (9.1.1) : ce sont des chiffres que NOUS fabriquons, et un
  // montant négatif doit rester `-12,500`. Tout le reste est du texte venu de quelqu'un — un
  // libellé de ligne, un nom de client, un téléphone, une note — et c'est là qu'elle sert.
  function toCsv(rows, columns) {
    const cell = (v, type) => {
      if (type === 'money') return round3(v).toFixed(3).replace('.', ',');
      if (type === 'date') return fmtDate(v);
      let texte = String(v == null ? '' : v);
      if (Compta.csvDangereux(texte)) texte = '\'' + texte;
      return /[;"\n\r]/.test(texte) ? '"' + texte.replace(/"/g, '""') + '"' : texte;
    };
    const head = columns.map(c => cell(c.label)).join(';');
    const body = rows.map(r => columns.map(c => cell(typeof c.get === 'function' ? c.get(r) : r[c.key], c.type)).join(';'));
    return '﻿' + [head].concat(body).join('\r\n') + '\r\n';
  }

  // ---------- migration des données ----------

  function migrateData(d) {
    const base = JSON.parse(JSON.stringify(DEFAULT_DATA));
    if (!d || typeof d !== 'object') return base;
    const data = {
      ...base, ...d,
      company: { ...base.company, ...(d.company || {}) },
      clients: Array.isArray(d.clients) ? d.clients : [], catalog: Array.isArray(d.catalog) ? d.catalog : [],
      documents: Array.isArray(d.documents) ? d.documents : [], counters: d.counters || {}
    };
    // La devise de l'entreprise a longtemps été un champ libre : « TND », « dinar » ou une faute de
    // frappe s'y sont enregistrés, et le nombre de décimales en dépend. On la ramène dans la liste.
    data.company.currency = normCurrency(data.company.currency);
    data.documents.forEach(doc => {
      if (!Array.isArray(doc.payments)) doc.payments = [];
      doc.withholdingRate = Number(doc.withholdingRate) || 0;
      // Avant la 1.4 : « payée » était un statut saisi. On le convertit en paiement pour garder l'historique.
      if (doc.type === 'facture' && doc.status === 'payée') {
        const t = computeTotals(doc, data.company);
        const paid = doc.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const rest = round3(t.netToPay - paid);
        if (rest > 0) doc.payments.push({ id: uid(), date: doc.paidDate || doc.dueDate || doc.date, amount: rest, method: 'autre', reference: '', note: 'Paiement enregistré avant la version 1.4' });
        doc.status = 'envoyée';
      }
    });
    if (!Array.isArray(data.recurring)) data.recurring = [];
    if (!Array.isArray(data.templates)) data.templates = [];
    if (!Array.isArray(data.snippets)) data.snippets = [];
    // Version 4 : achats. Rien à convertir dans l'existant — les trois listes sont simplement créées
    // vides si elles manquent, et un fichier v4 relu par une version antérieure les ignorerait sans casse.
    if (!Array.isArray(data.suppliers)) data.suppliers = [];
    if (!Array.isArray(data.purchases)) data.purchases = [];
    if (!Array.isArray(data.expenseCategories)) data.expenseCategories = [];
    if (!Array.isArray(data.fiscalDeadlines)) data.fiscalDeadlines = [];   // échéances fiscales personnalisées
    if (!data.vatCarryIn || typeof data.vatCarryIn !== 'object') data.vatCarryIn = {};  // crédit de TVA reporté par année
    // Partage à deux (3.2.0) : suppressions mémorisées et versions écartées lors d'une fusion.
    if (!Array.isArray(data.projects)) data.projects = [];
    if (!Array.isArray(data.assets)) data.assets = [];
    // Version 5 : stock. Rien à convertir — les articles existants ne sont pas suivis tant que la case
    // « Suivi en stock » n'est pas cochée, et la liste d'ajustements naît vide.
    if (!Array.isArray(data.stockAdjustments)) data.stockAdjustments = [];
    if (!Array.isArray(data.serials)) data.serials = [];
    // Version 6 : la paie. Rien à convertir — les trois listes naissent vides et les barèmes livrés
    // ne sont qu'un point de départ, que l'utilisateur ajuste avec son comptable.
    if (!Array.isArray(data.employees)) data.employees = [];
    if (!Array.isArray(data.payslips)) data.payslips = [];
    if (!data.payrollSettings || typeof data.payrollSettings !== 'object') data.payrollSettings = {};
    if (!Array.isArray(data.leaves)) data.leaves = [];
    if (!Array.isArray(data.advances)) data.advances = [];
    if (!Array.isArray(data.socialFilings)) data.socialFilings = [];
    if (!Array.isArray(data.fiscalFilings)) data.fiscalFilings = [];
    // 6.0.0 : clôture de période. Rien à convertir — un dossier existant n'a simplement rien de
    // clôturé, et l'utilisateur clôture quand il veut.
    if (typeof data.closedUntil !== 'string') data.closedUntil = '';
    if (!Array.isArray(data.closureLog)) data.closureLog = [];
    if (!Array.isArray(data.clotures)) data.clotures = [];
    // 9.10.0 : les questions du cabinet. Absentes de cette liste, elles seraient jetées au prochain
    // chargement et le comptable n'aurait jamais de réponse — sans un mot (défaut `matricule`, 6.8.0).
    if (!Array.isArray(data.questionsCabinet)) data.questionsCabinet = [];
    // 10.13.0 : la signature retenue du cabinet. Une forme qu'on ne reconnaît pas ne se garde pas —
    // une empreinte vide retenue ferait refuser tous les envois signés, sans raison lisible.
    if (!data.cabinetSignature || typeof data.cabinetSignature !== 'object' || !String(data.cabinetSignature.empreinte || '').trim()) data.cabinetSignature = null;
    if (!Array.isArray(data.packs)) data.packs = [];   // 6.1.0 : historique des envois au cabinet
    if (!Array.isArray(data.licences)) data.licences = [];   // 7.33.0 : licences émises par l'éditeur
    if (!Array.isArray(data.ecrituresOD)) data.ecrituresOD = [];   // 8.9.0 : opérations diverses
    data.catalog.forEach(c => {
      c.tracked = c.tracked === true;
      c.minStock = Number(c.minStock) || 0;
      c.initialQty = Number(c.initialQty) || 0;
      c.initialCost = Number(c.initialCost) || 0;
      c.serialized = c.serialized === true;
      c.warrantyMonths = Number(c.warrantyMonths) || 0;
    });
    if (!Array.isArray(data.fixedCategories)) data.fixedCategories = [];
    if (!Array.isArray(data.accounts)) data.accounts = [];
    if (!Array.isArray(data.movements)) data.movements = [];
    if (!Array.isArray(data.deleted)) data.deleted = [];
    if (!Array.isArray(data.conflictArchive)) data.conflictArchive = [];
    data.purchases.forEach(p => {
      if (!Array.isArray(p.payments)) p.payments = [];
      if (!Array.isArray(p.lines)) p.lines = [];
      if (!PURCHASE_KINDS.some(k => k[0] === p.kind)) p.kind = 'facture';
      // 10.2.0 : le rattachement d'un avoir ou d'un acompte à la facture qu'il concerne. Absent de
      // cette liste, le champ serait jeté au prochain chargement et l'imputation disparaîtrait en
      // silence — le 409 resterait débiteur pour toujours (défaut `matricule`, 6.8.0).
      p.achatLie = PURCHASE_LIES.includes(p.kind) ? String(p.achatLie || '') : '';
      p.withholdingRate = Number(p.withholdingRate) || 0;
      p.fees = Number(p.fees) || 0;
      // La TVA récupérable se FIGE sur la pièce (10.14.0) : un achat d'avant la règle prend le régime
      // du jour une fois, puis ne bouge plus quand le régime change.
      if (typeof p.tvaRecuperable !== 'boolean') p.tvaRecuperable = assujettiTVA(data.company || {});
      // La devise d'un achat (10.1.0). Un achat d'avant n'en portait pas : on lui pose celle de la
      // société avec un taux de 1, donc ses chiffres ne bougent pas d'un millime. Le faire ici et
      // pas à la lecture évite qu'un achat sans devise traverse un écran qui, lui, en attendrait
      // une — un champ absent de cette liste est jeté au prochain chargement (défaut `matricule`
      // de la 6.8.0), et un champ jamais posé se réinvente.
      if (!p.currency) p.currency = (data.company || {}).currency || 'TND';
      if (p.currency === ((data.company || {}).currency || 'TND')) p.exchangeRate = 1;
      else p.exchangeRate = Number(p.exchangeRate) > 0 ? Number(p.exchangeRate) : '';
    });
    // Geler le timbre des pièces DÉJÀ émises sur la valeur en vigueur aujourd'hui. Sans ça, elles
    // resteraient à la merci du prochain changement de réglage — c'est-à-dire dans l'état qu'on
    // vient de corriger. On ne touche ni aux brouillons ni à celles qui ont déjà leur montant.
    const timbreCourant = Number((data.company || {}).stampFee);
    if (timbreCourant >= 0) {
      data.documents.forEach(x => {
        const emise = x.status && x.status !== 'brouillon';
        const porteUnTimbre = (x.type === 'facture' && x.applyStamp !== false)
          || ((x.type === 'avoir' || x.type === 'proforma') && x.applyStamp === true);
        if (emise && porteUnTimbre && (x.stampFee === undefined || x.stampFee === null || x.stampFee === '')) {
          x.stampFee = timbreCourant;
        }
      });
    }
    // Le régime de TVA des pièces DÉJÀ émises se fige sur celui d'aujourd'hui (10.14.1, MR-06) : la
    // même parade que le timbre ci-dessus — la meilleure réponse qu'on ait sur le passé, et la seule
    // qui empêche le prochain changement de régime de réécrire leur mention.
    const regimeCourant = regimeOf(data.company || {}).id;
    data.documents.forEach(x => {
      if ((x.type === 'facture' || x.type === 'avoir') && x.status && x.status !== 'brouillon' && !x.regimeTva) x.regimeTva = regimeCourant;
    });
    data.version = 6;
    return data;
  }

  // ---------- récurrences (contrats) ----------

  const PERIODS = [['month', 'Chaque mois'], ['quarter', 'Chaque trimestre'], ['year', 'Chaque année']];
  const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  function monthLabel(iso) { const [y, m] = (iso || today()).split('-'); return `${MONTHS_FR[Number(m) - 1]} ${y}`; }
  // « de » devant un nom, élidé devant une voyelle : « d'août », « d'octobre », « de mars ». Jumelle
  // exacte de `de` du Cabinet (cabcore.js) : un test compare les deux corps.
  function deLibelle(label) { return (/^[aeiouéèê]/i.test(label) ? 'd\'' : 'de ') + label; }

  // Ajoute n mois en gardant le jour demandé (31 → dernier jour du mois si besoin).
  function addMonths(iso, n, day) {
    const [y, m] = iso.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    const ny = Math.floor(total / 12), nm = total % 12;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    const d = Math.min(Math.max(1, Number(day) || Number(iso.slice(8, 10))), last);
    return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function nextRecurrenceDate(fromIso, every, day) {
    const months = every === 'year' ? 12 : every === 'quarter' ? 3 : 1;
    return addMonths(fromIso, months, day);
  }

  function dueRecurrences(data, todayIso) {
    const t = todayIso || today();
    // (plateforme, brique 129) Un contrat émis seul ne propose pas de brouillon : le serveur émet sa facture à sa date.
    return (data.recurring || []).filter(r => r.active !== false && !r.emettreSeul && r.nextDate && r.nextDate <= t && !contratTermine(r));
  }

  // (plateforme 1.315.0) Les factures qu'un contrat dû prépare d'un coup : une par période échue, douze au plus, jusqu'à sa
  // fin (la règle de « Générer les brouillons »). « Générer 2 brouillons ? » en créait cinq : la question comptait les contrats.
  function periodesDues(rec, todayIso) {
    const t = todayIso || today();
    let d = rec && rec.nextDate, n = 0;
    while (d && d <= t && !(rec.endDate && d > rec.endDate) && n < 12) { n++; d = nextRecurrenceDate(d, rec.every, rec.day); }
    return n;
  }

  // (1.290.0) Un contrat peut avoir une fin (un entretien de douze mois, un bail) : passé sa dernière échéance, il ne
  // produit plus rien. Sans fin, il court toujours. La liste, la fiche, le tour du serveur et la génération lisent CETTE
  // règle : l'échéance suivante est après la fin.
  function contratTermine(r) {
    return !!(r && r.endDate && r.nextDate && r.nextDate > r.endDate);
  }

  // Reprise d'un contrat suspendu : première échéance à partir d'aujourd'hui (les mois suspendus ne sont pas facturés).
  function catchUpRecurrence(nextDate, every, day, todayIso) {
    const t = todayIso || today();
    let d = nextDate || t, guard = 0;
    while (d < t && ++guard < 240) d = nextRecurrenceDate(d, every, day);
    return d;
  }

  // Remplace {client}, {mois}, {numero}… dans un gabarit.
  function fillTemplate(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
  }

  // Brouillon de facture généré par un contrat pour une date donnée (l'app ajoute id/numéro/dates de création).
  // `client` (10.12.0) : l'exonération de timbre du client (9.1.1) se reprend ICI aussi. Les deux
  // autres chemins de création la copiaient (le choix du client dans l'éditeur, la facture tirée
  // d'un devis — E-02) ; un contrat posait `applyStamp: true` en dur, et chaque facture mensuelle
  // d'un client exonéré portait un timbre — le troisième jumeau, trouvé en écrivant la bulle du
  // formulaire de contrat qui promettait le contraire.
  // (plateforme 1.315.0) `periodeIso` : l'échéance que la facture couvre, quand elle se prépare plus tard (une période en
  // retard) ; la facture se date du jour où on la fait (`dateIso`), jamais dans un mois passé, et son objet dit la période.
  function buildRecurringInvoice(rec, dateIso, company, client, periodeIso) {
    const per = periodeIso || dateIso;
    const vars = { mois: monthLabel(per), annee: per.slice(0, 4) };
    return {
      type: 'facture', number: '', status: 'brouillon', date: dateIso, dueDate: addDays(dateIso, delaiJours(company.paymentTermsDays, 30)), periode: per,
      clientId: rec.clientId, subject: fillTemplate(rec.subject, vars), reference: rec.reference || '',
      lines: (rec.lines || []).map(l => ({ ...l, label: fillTemplate(l.label, vars), description: fillTemplate(l.description || '', vars) })),
      discountRate: rec.discountRate || 0, applyStamp: !(client && client.stampExempt), notes: fillTemplate(rec.notes || '', vars), payments: [],
      withholdingRate: Number(rec.withholdingRate) || 0, recurringId: rec.id, lang: rec.lang || company.defaultLang || 'fr', currency: rec.currency || company.currency, exchangeRate: rec.exchangeRate || ''
    };
  }

  // ---------- tableau de bord ----------

  function monthKeys(todayIso, n) {
    const [y, m] = (todayIso || today()).split('-').map(Number);
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const total = y * 12 + (m - 1) - i; out.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`); }
    return out;
  }

  // CA HT facturé (avoirs déduits) et encaissements par mois, sur les n derniers mois, en devise société.
  function monthlySeries(data, company, todayIso, n) {
    const keys = monthKeys(todayIso, n || 12);
    const series = keys.map(k => ({ month: k, label: MONTHS_SHORT[Number(k.slice(5, 7)) - 1] + (k.endsWith('-01') || k === keys[0] ? ' ' + k.slice(2, 4) : ''), invoiced: 0, collected: 0 }));
    const byKey = Object.fromEntries(series.map(x => [x.month, x]));
    (data.documents || []).forEach(d => {
      if (d.type === 'facture' || d.type === 'avoir') {
        if (d.status !== 'brouillon' && d.status !== 'annulée' && byKey[(d.date || '').slice(0, 7)]) {
          byKey[d.date.slice(0, 7)].invoiced = round3(byKey[d.date.slice(0, 7)].invoiced + (d.type === 'avoir' ? -1 : 1) * toBase(d, computeTotals(d, company).netHT, company));
        }
        if (d.type === 'facture') (d.payments || []).forEach(p => { const k = (p.date || '').slice(0, 7); if (byKey[k]) byKey[k].collected = round3(byKey[k].collected + montantRegle(d, p, company)); });
      }
    });
    return series;
  }

  function topClients(data, company, fromIso, toIso, limit) {
    const totals = {};
    (data.documents || []).filter(d => (d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon' && d.status !== 'annulée' && inPeriod(d.date, fromIso, toIso))
      .forEach(d => { totals[d.clientId] = round3((totals[d.clientId] || 0) + (d.type === 'avoir' ? -1 : 1) * toBase(d, computeTotals(d, company).netHT, company)); });
    // Les tickets sans client se rangent sous « Vente au comptoir » (10.15.0), jamais sous « — ».
    const name = id => id ? ((data.clients || []).find(c => c.id === id) || {}).name || '—' : CLIENT_COMPTOIR;
    return Object.keys(totals).map(id => ({ clientId: id, name: name(id), ht: totals[id] })).sort((a, b) => b.ht - a.ht).slice(0, limit || 5);
  }

  // Devis émis sur la période : acceptés / refusés / en attente, taux de conversion (acceptés / décidés)
  function quoteStats(data, fromIso, toIso, todayIso) {
    const q = (data.documents || []).filter(d => d.type === 'devis' && d.status !== 'brouillon' && inPeriod(d.date, fromIso, toIso));
    const accepted = q.filter(d => d.status === 'accepté').length, refused = q.filter(d => d.status === 'refusé').length;
    const decided = accepted + refused;
    const expired = q.filter(d => effectiveStatus(d, data, null, todayIso) === 'expiré').length;
    return { total: q.length, accepted, refused, expired, pending: q.length - decided, rate: decided ? Math.round(accepted / decided * 100) : null };
  }

  // Chiffres d'un client : facturé HT, encaissé, reste à payer, délai moyen, dates du premier et du dernier document.
  function clientSummary(data, company, clientId) {
    // Dans un lot, les pièces se rangent par client une fois (10.14.0) : la liste des clients
    // relisait les huit mille pièces pour chacun des mille cinq cents clients.
    const docs = lot
      ? (duLot(data, 'piecesParClient', () => {
        const m = new Map();
        (data.documents || []).forEach(d => { if (!m.has(d.clientId)) m.set(d.clientId, []); m.get(d.clientId).push(d); });
        return m;
      }).get(clientId) || []).slice()
      : (data.documents || []).filter(d => d.clientId === clientId);
    const issued = docs.filter(d => (d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon' && d.status !== 'annulée');
    const ht = round3(issued.reduce((s, d) => s + (d.type === 'avoir' ? -1 : 1) * toBase(d, computeTotals(d, company).netHT, company), 0));
    const invoices = docs.filter(d => d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée');
    const paid = round3(invoices.reduce((s, d) => s + toBase(d, (d.payments || []).reduce((x, p) => x + (Number(p.amount) || 0), 0), company), 0));
    const due = round3(invoices.reduce((s, d) => s + Math.max(0, toBase(d, invoiceBalance(d, data, company).remaining, company)), 0));
    // Ce qu'on DOIT à ce client (10.14.0) : les trop-perçus de ses factures et ses avoirs libres. Le
    // « reste à payer » de sa fiche ne les retranchait pas — 1 012,500 DT affichés quand il nous doit
    // 505,560 net. Le calcul est celui du relevé (`releveClient`), à la même règle près : un avoir
    // rattaché est déjà dans le reste de sa facture.
    const aRendre = round3(invoices.reduce((s, d) => s + Math.max(0, -toBase(d, invoiceBalance(d, data, company).remaining, company)), 0)
      + issued.filter(d => d.type === 'avoir' && !d.creditOf).reduce((s, d) => s + Math.max(0, toBase(d, computeTotals(d, company).netToPay, company)), 0));
    // La retenue que ce client gardera encore pour l'État en payant (10.14.0) : son compte 411 la
    // porte jusqu'à l'encaissement, la fiche la dit à côté du net qu'il versera — le miroir de
    // `supplierSummary.rsAOperer`.
    const rsASubir = round3(issued.reduce((s, d) => s + retenueASubir(d, data, company), 0));
    const dates = docs.map(d => d.date).filter(Boolean).sort();
    const quotes = docs.filter(d => d.type === 'devis');
    const accepted = quotes.filter(d => d.status === 'accepté').length;
    const decided = accepted + quotes.filter(d => d.status === 'refusé').length;
    // Délai moyen de paiement de ce client : on raisonne sur l'ensemble des données (les avoirs comptent)
    const delays = [];
    invoices.forEach(d => {
      if (effectiveStatus(d, data, company, '9999-12-31') !== 'payée' || !(d.payments || []).length) return;
      const last = dateDernierReglement(d);
      if (last && d.date) delays.push(delaiConstate(d.date, last));
    });
    return {
      docs, ht, paid, due, aRendre, net: round3(due - aRendre), rsASubir, count: docs.length, invoiceCount: invoices.length, quoteCount: quotes.length,
      first: dates[0] || '', last: dates[dates.length - 1] || '',
      conversion: decided ? Math.round(accepted / decided * 100) : null,
      delay: delays.length ? Math.round(delays.reduce((s, x) => s + x, 0) / delays.length) : null
    };
  }

  // Un délai CONSTATÉ ne descend pas sous zéro : une facture réglée avant sa date (un acompte encaissé
  // sur place, une facture datée d'après coup) ou un devis dont la facture précède la date (un devis
  // antidaté) ont été payés ou acceptés « tout de suite ». Rendre −3 faisait écrire « délai moyen :
  // −3 jours » à l'écran (rapport QA, 10.12.0) — un chiffre qu'aucune entreprise ne sait lire.
  function delaiConstate(de, a) { return Math.max(0, daysBetween(de, a)); }

  // Délai moyen (jours) entre la date de facture et le dernier paiement, sur les factures soldées de la période
  function avgPaymentDelay(data, company, fromIso, toIso) {
    const delays = [];
    (data.documents || []).filter(d => d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée' && inPeriod(d.date, fromIso, toIso)).forEach(d => {
      if (effectiveStatus(d, data, company, '9999-12-31') !== 'payée' || !(d.payments || []).length) return;
      const last = dateDernierReglement(d);
      if (last && d.date) delays.push(delaiConstate(d.date, last));
    });
    return delays.length ? Math.round(delays.reduce((s, x) => s + x, 0) / delays.length) : null;
  }

  // ---------- achats, fournisseurs et dépenses (3.0.0, données v4) ----------
  // Symétrique des ventes, mais on ne maîtrise ni la numérotation (c'est celle du fournisseur)
  // ni la date (c'est celle de sa facture) : rien n'est verrouillé, tout reste modifiable.
  // 10.2.0 : l'avoir fournisseur et l'acompte versé. Les deux manquaient, et les deux se ressaisissaient
  // à la main — un avoir en tapant des montants négatifs (ce qu'aucune comptabilité n'accepte, règle
  // 6.3.0), un acompte en ne le saisissant pas du tout jusqu'à la facture finale.
  // Le troisième élément est le pluriel, écrit en entier : le filtre des Achats ajoutait un « s » au
  // bout et affichait « Facture d'achats », « Acompte versés » (rapport QA, 10.12.0).
  const PURCHASE_KINDS = [
    ['facture', 'Facture d\'achat', 'Factures d\'achat'], ['depense', 'Dépense', 'Dépenses'],
    ['avoir', 'Avoir fournisseur', 'Avoirs fournisseurs'], ['acompte', 'Acompte versé', 'Acomptes versés']
  ];
  // Les pièces qui se RATTACHENT à une facture d'achat. Un avoir la diminue, un acompte l'a déjà
  // payée en partie : dans les deux cas le montant se saisit POSITIF et c'est le sens de la pièce
  // qui décide de la colonne (règle 6.3.0).
  const PURCHASE_LIES = ['avoir', 'acompte'];
  // Destination d'une ligne d'achat. C'est ce choix qui alimentera le stock (4.0.0) et les
  // immobilisations (3.4.0) : il est posé dès maintenant pour ne pas avoir à ressaisir l'historique.
  const LINE_DESTINATIONS = [
    ['charge', 'Charge', 'Consommé tout de suite : fournitures, loyer, carburant, sous-traitance'],
    ['stock', 'Stock', 'Marchandise achetée pour être revendue — sortira du stock à la vente'],
    ['immobilisation', 'Immobilisation', 'Matériel qui reste dans l\'entreprise plus d\'un an : ordinateur, climatiseur, véhicule']
  ];
  // Catégories de charges de départ. Modifiables et extensibles par l'utilisateur (data.expenseCategories).
  // Le rattachement comptable exact relève du plan comptable tunisien — À VÉRIFIER avec le comptable.
  const DEFAULT_EXPENSE_CATEGORIES = [
    // (plateforme, lot achats) La catégorie d'une boulangerie, d'un restaurant, d'un atelier. Une catégorie classe la dépense ;
    // elle ne choisit aucun compte (le rattachement comptable : À VÉRIFIER avec ton comptable).
    'Achats de marchandises', 'Achats de matières premières', 'Sous-traitance', 'Fournitures de bureau', 'Petit équipement',
    'Loyer et charges locatives', 'Électricité, eau, gaz', 'Téléphone et internet',
    'Carburant et déplacements', 'Entretien et réparations', 'Assurances',
    'Honoraires (comptable, avocat)', 'Publicité et communication', 'Frais bancaires',
    'Impôts et taxes', 'Formation', 'Divers'
  ];
  const PURCHASE_STATUSES = ['à payer', 'partiel', 'retard', 'payée', 'à imputer', 'imputé', 'remboursé'];

  function expenseCategories(data) {
    const extra = (data && Array.isArray(data.expenseCategories) ? data.expenseCategories : [])
      .map(x => String(x || '').trim()).filter(Boolean);
    return Array.from(new Set(DEFAULT_EXPENSE_CATEGORIES.concat(extra)));
  }

  // Totaux d'un achat. Même moteur que les ventes, deux différences : pas de remise globale (elle est
  // déjà dans le prix du fournisseur) et la TVA peut être non déductible ligne par ligne.
  function purchaseTotals(purchase, company) {
    // Aux décimales de la devise de la pièce (10.14.1), comme une facture de vente : une facture
    // fournisseur en euros se lit et se paie au centime.
    const rd = arrondiDevise(purchase.currency || (company || {}).currency);
    const recuperable = tvaRecuperable(purchase, company);
    const lines = (purchase.lines || []).map(l => {
      const qty = Number(l.qty) || 0;
      const unit = Number(l.unitPrice) || 0;
      const rate = Number(l.vatRate) || 0;
      const ht = rd(qty * unit);
      const vat = rd(ht * rate / 100);
      return {
        ...l, qty, unitPrice: unit, vatRate: rate, ht, vat, ttc: rd(ht + vat),
        destination: LINE_DESTINATIONS.some(d => d[0] === l.destination) ? l.destination : 'charge',
        // TVA non déductible : voiture de tourisme, cadeaux, réception… À VÉRIFIER avec le comptable.
        // Et jamais pour une entreprise qui ne récupère pas la TVA (10.14.0).
        deductible: recuperable && l.deductible !== false
      };
    });
    const totalHT = rd(lines.reduce((s, l) => s + l.ht, 0));
    const vatByRate = {};
    lines.forEach(l => {
      const k = l.vatRate;
      vatByRate[k] = vatByRate[k] || { base: 0, vat: 0, deductible: 0 };
      vatByRate[k].base = rd(vatByRate[k].base + l.ht);
      vatByRate[k].vat = rd(vatByRate[k].vat + l.vat);
      if (l.deductible) vatByRate[k].deductible = rd(vatByRate[k].deductible + l.vat);
    });
    const totalVAT = rd(lines.reduce((s, l) => s + l.vat, 0));
    const deductibleVAT = rd(lines.filter(l => l.deductible).reduce((s, l) => s + l.vat, 0));
    const fees = rd(Number(purchase.fees) || 0);          // timbre du fournisseur, frais de port…
    const totalTTC = rd(totalHT + totalVAT + fees);
    // Retenue à la source que TU opères en payant un prestataire : tu la retiens et tu la reverses.
    // Qui doit retenir et à quel taux : À VÉRIFIER avec le comptable.
    const withholdingRate = Number(purchase.withholdingRate) || 0;
    const withholding = rd((totalHT + totalVAT) * withholdingRate / 100);
    const netToPay = rd(totalTTC - withholding);
    const byDestination = {};
    LINE_DESTINATIONS.forEach(([k]) => { byDestination[k] = 0; });
    lines.forEach(l => { byDestination[l.destination] = rd(byDestination[l.destination] + l.ht); });
    // La TVA NON DÉDUCTIBLE fait partie du coût de ce qu'elle a payé (10.14.0). Une voiture de
    // tourisme — le cas même que cite la case — vaut son prix TTC au bilan, et s'amortit TTC ; une
    // dépense de réception coûte TTC. Jusqu'ici l'écriture passait toute TVA non déductible en
    // charge (606), même sur un bien immobilisé, et le résultat simplifié l'oubliait tout à fait.
    // `byDestination` reste le HT (c'est ce que l'écran de la pièce affiche) ; `cout` est ce que
    // chaque destination COÛTE, et c'est lui que lisent l'écriture, le résultat et la fiche du bien.
    const ndByDestination = {};
    LINE_DESTINATIONS.forEach(([k]) => { ndByDestination[k] = 0; });
    lines.forEach(l => { if (!l.deductible) ndByDestination[l.destination] = rd(ndByDestination[l.destination] + l.vat); });

    // LA DEVISE DE L'ACHAT (10.1.0). Une facture fournisseur venue de l'étranger — une licence
    // logicielle, du matériel — est libellée en euros ou en dollars. Jusqu'ici l'achat n'avait
    // AUCUNE devise : ses chiffres étaient pris pour des dinars, et la TVA déductible, la charge,
    // le résultat, le seuil de rentabilité, la trésorerie, les écritures et le paquet du comptable
    // comptaient 1 000 DT là où l'entreprise avait payé 3 400 DT. Rien à l'écran ne le montrait.
    // C'est exactement la faute de la 7.0.1 (le timbre en euros) et de la 7.16.0 (les cartes de
    // l'accueil), jamais portée du côté des achats.
    //
    // La règle du projet : « tout ce qui ADDITIONNE plusieurs pièces se convertit dans la devise de
    // base ». Les montants natifs restent en tête — c'est ce que l'écran de LA pièce affiche, et
    // c'est ce que le fournisseur a écrit sur sa facture — et `base` porte les mêmes montants
    // convertis, pour tout ce qui agrège. Deux noms différents : un agrégateur qui oublie de
    // convertir se lit, au lieu de passer inaperçu.
    //
    // Sur un achat sans devise (tous ceux d'avant la 10.1.0, que la migration met à la devise de la
    // société avec un taux de 1), `base` est identique aux montants natifs : aucun chiffre existant
    // ne bouge.
    // LE SENS DE LA PIÈCE (10.2.0). Un avoir fournisseur se saisit avec des montants POSITIFS — c'est
    // ce que le fournisseur a écrit sur son avoir — et son effet comptable est l'inverse d'une
    // facture. La règle apprise en 10.1.0 s'applique telle quelle : ce qui agrège lit `base`, donc
    // c'est `base` qui porte le signe. Les treize agrégateurs passés à `.base` deviennent justes
    // sans qu'aucun n'ait à se souvenir du sens — là où les ventes recopient
    // `type === 'avoir' ? -1 : 1` dans une quinzaine d'endroits, et où le premier qui l'oublie
    // fabrique un chiffre faux que rien ne montre.
    const sens = purchase.kind === 'avoir' ? -1 : 1;
    const conv = v => round3(sens * toBase(purchase, v, company || {}));
    const baseVatByRate = {};
    Object.keys(vatByRate).forEach(k => {
      baseVatByRate[k] = { base: conv(vatByRate[k].base), vat: conv(vatByRate[k].vat), deductible: conv(vatByRate[k].deductible) };
    });
    // UN ACOMPTE N'EST PAS UNE CHARGE (10.2.0). C'est de l'argent posé d'avance sur un fournisseur
    // qui n'a pas encore livré : une créance, pas une consommation. Plutôt que de demander à chaque
    // agrégateur de s'en souvenir — le défaut même que `base` existe pour éviter —, ses
    // destinations sont VIDES et le montant vit dans `base.avance`. Le résultat, le seuil de
    // rentabilité, la marge d'une affaire et le stock deviennent justes sans une ligne de plus, et
    // un agrégateur écrit demain le sera aussi. Seul `journalEntries` connaît `avance` : c'est lui
    // qui doit savoir dans quel compte la ranger.
    const estAvance = purchase.kind === 'acompte';
    const baseByDestination = {}, baseNd = {}, baseCout = {};
    Object.keys(byDestination).forEach(k => {
      baseByDestination[k] = estAvance ? 0 : conv(byDestination[k]);
      baseNd[k] = estAvance ? 0 : conv(ndByDestination[k]);
      baseCout[k] = round3(baseByDestination[k] + baseNd[k]);
    });
    const base = {
      totalHT: conv(totalHT), totalVAT: conv(totalVAT), deductibleVAT: conv(deductibleVAT),
      fees: estAvance ? 0 : conv(fees), totalTTC: conv(totalTTC), withholding: conv(withholding),
      netToPay: conv(netToPay), vatByRate: baseVatByRate, byDestination: baseByDestination,
      nonDeductibleParDestination: baseNd, cout: baseCout,
      avance: estAvance ? conv(round3(totalHT + fees)) : 0
    };
    return {
      lines, totalHT, vatByRate, totalVAT, deductibleVAT, fees, totalTTC, withholdingRate, withholding, netToPay, byDestination,
      nonDeductibleParDestination: ndByDestination,
      currency: purchase.currency || (company || {}).currency || '', rate: rateOf(purchase, company || {}), sens, base
    };
  }

  // Ce qu'un achat COÛTE, toutes destinations comprises : HT + TVA non déductible + frais, en
  // dinars et signé (un avoir en retire). Un acompte ne coûte rien — c'est une avance que sa facture
  // reprend en entier —, donc il vaut 0 : le compter avec sa facture faisait payer deux fois le
  // même chantier dans la marge d'une affaire (10.14.0).
  function coutAchat(t) {
    return round3(Object.keys(t.base.cout).reduce((s, k) => s + t.base.cout[k], 0) + t.base.fees);
  }

  // Les avoirs et les acomptes rattachés à une facture d'achat (10.2.0). Le symétrique de
  // `creditsFor` côté ventes. `achatLie` porte l'identifiant de la facture concernée ; tant qu'il
  // est vide, la pièce est LIBRE — un avoir qu'on n'a pas encore imputé, un acompte versé avant que
  // la facture n'arrive. C'est un état normal, pas une erreur : « À faire » le rappelle.
  function piecesLieesAchat(data, purchaseId, kind) {
    if (!purchaseId) return [];
    if (lot) {
      const idx = duLot(data, 'achatsLies', () => {
        const m = new Map();
        (data.purchases || []).forEach(p => { if (!p.achatLie) return; if (!m.has(p.achatLie)) m.set(p.achatLie, []); m.get(p.achatLie).push(p); });
        return m;
      });
      return (idx.get(purchaseId) || []).filter(p => !kind || p.kind === kind);
    }
    return (data.purchases || []).filter(p => p.achatLie === purchaseId && (!kind || p.kind === kind));
  }

  // Situation d'un achat : payé, reste dû. Le symétrique exact d'invoiceBalance.
  // `data` est FACULTATIF : sans lui, les pièces rattachées ne sont pas déduites — c'est ce que
  // veut l'écran d'une pièce isolée, et c'est ce qui garde compatibles les appels d'avant la 10.2.0.
  function purchaseBalance(purchase, company, data) {
    const totals = purchaseTotals(purchase, company);
    const paid = round3((purchase.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    // Un avoir imputé est CONSOMMÉ par la facture qu'il diminue : le compter une seconde fois comme
    // un crédit en attente chez le fournisseur ferait payer deux fois moins.
    // Un avoir IMPUTÉ est consommé par la facture qu'il diminue : il ne vaut plus rien tout seul, et
    // un règlement porté dessus — le fournisseur qui rembourse en plus d'avoir avoisé — serait le
    // compter deux fois. Un avoir LIBRE, lui, est un crédit qu'on détient : son reste est négatif,
    // et il revient à zéro le jour où le fournisseur le rembourse pour de bon.
    if (purchase.kind === 'avoir') {
      return { totals, paid, liees: [], impute: 0, remaining: purchase.achatLie ? 0 : arrondiDevise(purchase.currency || (company || {}).currency)(paid - totals.netToPay) };
    }
    const liees = data ? piecesLieesAchat(data, purchase.id) : [];
    // Un avoir et un acompte se déduisent de la même façon, et dans la MÊME devise : un fournisseur
    // avoise et encaisse dans la devise où il a facturé. L'éditeur le refuse autrement.
    // Un avoir déjà REMBOURSÉ (en tout ou en partie) ne déduit que ce qui n'a pas été rendu (10.14.0) :
    // l'argent reçu est entré en trésorerie et au 401, le déduire en plus de la facture la faisait
    // passer pour payée pendant que le compte du fournisseur la disait due.
    // Dans la devise de la FACTURE (10.14.0) : l'éditeur refuse une autre devise depuis la 10.2.0,
    // mais une pièce enregistrée avant ne se relit pas autrement.
    const impute = round3(liees.reduce((s, x) => {
      const n = purchaseTotals(x, company).netToPay;
      if (x.kind !== 'avoir') return s + montantDansDeviseDe(x, n, purchase, company);
      const rendu = round3((x.payments || []).reduce((t, y) => t + (Number(y.amount) || 0), 0));
      return s + montantDansDeviseDe(x, Math.max(0, round3(n - rendu)), purchase, company);
    }, 0));
    return { totals, paid, liees, impute, remaining: arrondiDevise(purchase.currency || (company || {}).currency)(totals.netToPay - paid - impute) };
  }

  // LA RETENUE À LA SOURCE S'OPÈRE AU RÈGLEMENT (10.14.0). Celui qui paie un prestataire retient une
  // part de ce qu'il lui VERSE, et la reverse à l'État le mois qui suit : tant qu'il n'a rien versé,
  // il n'a rien retenu. L'écriture de la facture la constatait, et la déclaration du mois de la
  // FACTURE la réclamait — y compris sur une facture jamais payée (32,130 DT « à reverser au fisc »
  // sur l'exemple), et dans la déclaration annuelle de l'année de la facture pendant que
  // l'attestation remise au fournisseur, datée du paiement, disait l'année suivante.
  // La retenue d'une pièce se répartit sur ses règlements au prorata de ce qu'ils versent, et le
  // règlement qui SOLDE la pièce prend le reste : la retenue entière, au millime. À VÉRIFIER avec le
  // comptable : le fait générateur (le paiement) et la constatation (le fournisseur est crédité du
  // brut à la facture, la retenue naît au règlement).
  //
  // Ce qu'une pièce RATTACHÉE couvre de la facture, en net (ce que la facture ne versera pas) et en
  // brut (ce que le 401 ne portera plus). Un acompte couvre son montant entier : sa retenue a été
  // opérée quand il a été versé. Un avoir couvre ce qui n'a pas été remboursé.
  function imputationAchat(x, company) {
    const t = purchaseTotals(x, company);
    if (x.kind !== 'avoir') return { net: t.netToPay, brut: round3(t.netToPay + t.withholding) };
    const rendu = round3((x.payments || []).reduce((s, y) => s + (Number(y.amount) || 0), 0));
    const net = Math.max(0, round3(t.netToPay - rendu));
    if (net <= 0.0005) return { net: 0, brut: 0 };
    return { net, brut: round3(t.netToPay + t.withholding - rendu - retenueDesReglements(x, company).operee) };
  }

  // Le moteur des DEUX côtés (10.14.0) : la retenue d'une pièce naît à chacun de ses règlements, au
  // prorata de ce qu'il verse, et le règlement qui SOLDE prend le reste — la retenue entière, au
  // millime. Une pièce rattachée (un avoir, un acompte) diminue ce qui est dû à SA date : posée après
  // un règlement, elle RÉGULARISE ce qui a déjà été retenu, le jour où elle existe. Recalculer la part
  // d'un règlement déjà passé réécrivait la retenue d'un mois déjà déclaré — un avoir émis en avril
  // changeait la déclaration de mars, sans un mot.
  //   `liees`     [{ key, date, net, brut }] — ce que chaque pièce rattachée couvre (date '' : dès
  //               l'origine, comme un acompte imputé à la facture même) ;
  //   `paiements` [{ key, date, amount }], dans la devise de la pièce.
  // Rend la part de chaque règlement (`parts`), la régularisation de chaque pièce rattachée
  // (`ajustements`), la retenue que la pièce doit encore porter (`due`) et celle déjà née (`operee`).
  // Rien n'est retenu tant que rien n'est versé : une pièce couverte sans aucun paiement ne porte rien.
  function retenueChrono(net, brut, liees, paiements) {
    const ev = (liees || []).map((x, i) => ({ ...x, lie: true, i }))
      .concat((paiements || []).map((x, i) => ({ ...x, lie: false, i })))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.lie === b.lie ? a.i - b.i : (a.lie ? -1 : 1)));
    let netDu = round3(net), brutDu = round3(brut), cum = 0, reconnu = 0;
    const parts = {}, ajustements = {};
    const cible = () => {
      const due = round3(brutDu - netDu);
      if (!due || cum <= 0.0005) return 0;
      return cum >= netDu - 0.0005 ? due : round3(due * cum / netDu);
    };
    ev.forEach(x => {
      if (x.lie) { netDu = round3(netDu - (Number(x.net) || 0)); brutDu = round3(brutDu - (Number(x.brut) || 0)); }
      else cum = round3(cum + (Number(x.amount) || 0));
      const c = cible(), d = round3(c - reconnu);
      reconnu = c;
      if (!x.lie) parts[x.key] = d;
      else if (d) ajustements[x.key] = round3((ajustements[x.key] || 0) + d);
    });
    return { parts, ajustements, due: round3(brutDu - netDu), operee: reconnu, netDu, brutDu };
  }
  const cleReglement = (y, i) => (y && y.id) || '#' + i;

  // La part de la retenue que chaque règlement opère (dans la devise de la pièce, signe de la pièce :
  // positive, un avoir compris — c'est le lecteur qui applique le sens). `due` est ce que les
  // règlements de CETTE pièce doivent opérer, `operee` ce qu'ils ont opéré, `ajustements` ce qu'un
  // avoir posé après un règlement a régularisé, à sa date.
  function retenueDesReglements(purchase, company, data) {
    const p = purchase || {};
    const t = purchaseTotals(p, company);
    const liees = (p.kind !== 'avoir' && p.kind !== 'acompte' && data) ? piecesLieesAchat(data, p.id).map(x => {
      const im = imputationAchat(x, company);
      // Un acompte est imputé par la facture même : il couvre dès l'origine. Un avoir, à sa date.
      return { key: x.id, date: x.kind === 'acompte' ? '' : (x.date || ''),
        net: montantDansDeviseDe(x, im.net, p, company), brut: montantDansDeviseDe(x, im.brut, p, company) };
    }) : [];
    return retenueChrono(t.netToPay, round3(t.netToPay + t.withholding), liees,
      (p.payments || []).map((y, i) => ({ key: cleReglement(y, i), date: y.date || '', amount: Number(y.amount) || 0 })));
  }

  // Les régularisations de retenue qu'un avoir fournisseur porte sur la facture qu'il diminue, datées
  // de l'avoir, en dinars au taux de la FACTURE (celui auquel le 401 et le 4352 la portent), au sens
  // d'une retenue opérée : négative quand l'avoir en diminue une déjà née. Une par avoir concerné.
  // Dans un LOT, la liste entière des régularisations se calcule UNE fois (10.14.1, AN-01) : la page
  // TVA la demande mois par mois, et chaque mois relisait toutes les pièces pour n'en garder qu'une
  // poignée. Le filtre de période s'applique ensuite, sur une copie.
  function regularisationsRetenueAchats(data, company, period) {
    const toutes = duLot(data, 'regul:achats', () => regularisationsRetenueAchatsCalcul(data, company));
    return toutes.filter(r => inPeriod(r.date, period && period.from, period && period.to)).map(r => ({ ...r }));
  }
  function regularisationsRetenueAchatsCalcul(data, company) {
    const out = [];
    const achats = new Map((data.purchases || []).map(x => [x.id, x]));
    (data.purchases || []).forEach(p => {
      if (p.kind === 'avoir' || p.kind === 'acompte') return;
      const rs = retenueDesReglements(p, company, data);
      Object.keys(rs.ajustements).forEach(k => {
        const av = achats.get(k);
        if (!av) return;
        out.push({ purchaseId: p.id, avoirId: av.id, date: av.date, number: p.number || '', avoirNumber: av.number || '',
          supplierId: p.supplierId || '', rs: round3(toBase(p, rs.ajustements[k], company)) });
      });
    });
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // LE MIROIR, CÔTÉ VENTES (10.14.0) : la retenue que ton CLIENT opère sur ce qu'il te verse. Elle
  // naît quand il paie, comme celle que tu opères sur tes fournisseurs — c'est ce jour-là qu'il la
  // garde, la déclare, et te remet l'attestation qui te permet de la déduire de ton impôt. L'écriture
  // de la facture la constatait comme une créance sur l'État dès l'émission, la page TVA la comptait
  // dans le mois de la FACTURE, et « À faire » réclamait l'attestation de factures que personne
  // n'avait encore réglées. Même moteur que les achats : au prorata de chaque encaissement, le
  // dernier prend le reste, un avoir posé après un encaissement régularise à sa date.
  function retenueSubie(doc, data, company) {
    const d = doc || {};
    if (d.type !== 'facture' || d.status === 'brouillon' || d.status === 'annulée') return retenueChrono(0, 0, [], []);
    const t = computeTotals(d, company);
    const liees = data ? creditsFor(data, d.id).map(a => {
      const ta = computeTotals(a, company);
      return { key: a.id, date: a.date || '', net: montantDansDeviseDe(a, ta.netToPay, d, company),
        brut: montantDansDeviseDe(a, round3(ta.netToPay + ta.withholding), d, company) };
    }) : [];
    return retenueChrono(t.netToPay, round3(t.netToPay + t.withholding), liees,
      (d.payments || []).map((y, i) => ({ key: cleReglement(y, i), date: y.date || '', amount: Number(y.amount) || 0 })));
  }

  // Ce que les encaissements à venir laisseront encore au client pour l'État, en dinars : l'écart
  // entre ce que le 411 porte (le brut, ce que la pièce vaut) et ce que le client versera (le net).
  // Un avoir LIBRE porte sa retenue en moins, comme un avoir fournisseur non imputé.
  // `natif` : dans la devise de la pièce (le relevé d'un client facturé en euros, 10.14.1).
  function retenueASubir(piece, data, company, natif) {
    const d = piece || {};
    const conv = x => natif ? round3(x) : toBase(d, x, company);
    if (d.status === 'brouillon' || d.status === 'annulée' || !d.number) return 0;
    if (d.type === 'avoir') return d.creditOf ? 0 : round3(-conv(computeTotals(d, company).withholding));
    if (d.type !== 'facture') return 0;
    const rs = retenueSubie(d, data, company);
    return round3(conv(round3(rs.due - rs.operee)));
  }

  // Les régularisations de retenue subie qu'un avoir de vente porte sur la facture qu'il corrige.
  function regularisationsRetenueVentes(data, company, period) {
    const toutes = duLot(data, 'regul:ventes', () => regularisationsRetenueVentesCalcul(data, company));
    return toutes.filter(r => inPeriod(r.date, period && period.from, period && period.to)).map(r => ({ ...r }));
  }
  function regularisationsRetenueVentesCalcul(data, company) {
    const out = [];
    const docs = new Map((data.documents || []).map(d => [d.id, d]));
    (data.documents || []).forEach(d => {
      if (d.type !== 'facture' || d.status === 'brouillon' || d.status === 'annulée' || !d.number) return;
      const rs = retenueSubie(d, data, company);
      Object.keys(rs.ajustements).forEach(k => {
        const av = docs.get(k);
        if (!av) return;
        out.push({ docId: d.id, avoirId: av.id, date: av.date, number: d.number, avoirNumber: av.number || '',
          clientId: d.clientId || '', rs: round3(toBase(d, rs.ajustements[k], company)) });
      });
    });
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // Les retenues nées dans une période, d'un côté : celles des règlements, plus les régularisations
  // des avoirs. UNE somme pour la page TVA, les cartes, et le paquet du comptable (6.8.1).
  function retenuesDeLaPeriode(data, company, period, cote) {
    const ventes = cote === 'ventes';
    const reglements = ventes ? paymentsJournal(data, company, period) : supplierPayments(data, company, period);
    const regul = ventes ? regularisationsRetenueVentes(data, company, period) : regularisationsRetenueAchats(data, company, period);
    const deReglements = round3(reglements.reduce((s, r) => s + (r.rs || 0), 0));
    const deRegul = round3(regul.reduce((s, r) => s + (r.rs || 0), 0));
    return { total: round3(deReglements + deRegul), reglements: deReglements, regularisations: deRegul, lignesRegul: regul };
  }

  // Les factures dont le client a DÉJÀ retenu quelque chose et dont l'attestation n'est pas arrivée
  // (10.14.0). Une facture pas encore payée n'a rien retenu : on ne réclame pas l'attestation du néant.
  // `amount` en dinars ; une seule définition pour « À faire », la page Comptabilité et le paquet.
  function attestationsARecevoir(data, company, period) {
    const out = [];
    (data.documents || []).forEach(d => {
      if (d.type !== 'facture' || d.withholdingCertificate || d.status === 'brouillon' || d.status === 'annulée' || !d.number) return;
      if (!(Number(d.withholdingRate) > 0) || !(d.payments || []).length) return;
      const rs = retenueSubie(d, data, company);
      if (rs.operee <= 0.0005) return;
      if (period && !(d.payments || []).some((y, i) => inPeriod(y.date, period.from, period.to) && (rs.parts[cleReglement(y, i)] || 0) > 0.0005)) return;
      out.push({ doc: d, id: d.id, number: d.number, clientId: d.clientId || '', date: d.date,
        native: rs.operee, amount: round3(toBase(d, rs.operee, company)), complete: rs.operee >= rs.due - 0.0005 });
    });
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // Ce que les règlements à venir retiendront encore pour l'État, en dinars et au sens de la pièce :
  // l'écart entre ce que le 401 porte (le brut) et ce qu'on versera au fournisseur (le net). Un avoir
  // IMPUTÉ n'a plus rien à lui : c'est la facture qu'il diminue qui le compte.
  function retenueAOperer(purchase, company, data) {
    const p = purchase || {};
    if (p.kind === 'avoir' && p.achatLie) return 0;
    const rs = retenueDesReglements(p, company, data);
    return round3((p.kind === 'avoir' ? -1 : 1) * toBase(p, round3(rs.due - rs.operee), company));
  }

  // Un règlement qui RAMÈNE de l'argent du fournisseur (10.14.0) : tout règlement porté par un avoir
  // (il le rembourse), et un règlement négatif sur une facture payée plus que son montant.
  function estRemboursementAchat(purchase, pay) {
    return !!purchase && !!pay && (purchase.kind === 'avoir' || (Number(pay.amount) || 0) < 0);
  }

  // Un avoir LIBRE que le fournisseur a remboursé en entier : il ne porte plus aucun crédit.
  function avoirRembourse(purchase, b) {
    return !!purchase && purchase.kind === 'avoir' && !purchase.achatLie && b.paid > 0.0005 && b.remaining >= -0.0005;
  }

  // Une pièce fournisseur à rattacher à sa facture (10.2.0) : un avoir qui porte encore un crédit, un
  // acompte sans facture. UNE règle pour la ligne de « À faire » et le filtre de la liste qu'elle
  // ouvre (6.8.1) — un avoir déjà remboursé n'a plus rien à déduire, le rattacher le compterait deux fois.
  function aRattacherAchat(purchase, company, data) {
    if (!purchase || !PURCHASE_LIES.includes(purchase.kind) || purchase.achatLie) return false;
    if (purchase.kind !== 'avoir') return true;
    return purchaseBalance(purchase, company, data).remaining < -0.0005;
  }

  // Statut déduit des paiements, jamais saisi — comme pour une facture de vente.
  // Une facture fournisseur saisie deux fois (7.16.0). Rien ne la signalait : elle entre alors deux
  // fois dans la TVA déductible, dans la charge, dans les écritures — sous le même numéro — et dans
  // le paquet du comptable. `duplicatePurchase` prévient déjà, mais c'est le cas où l'utilisateur
  // SAIT qu'il duplique ; le cas dangereux est la ressaisie de bonne foi trois semaines plus tard.
  // Pur et testable : on compare fournisseur + numéro, en ignorant la casse et les espaces.
  // Les factures déjà tirées d'un devis (7.16.0). La règle vivait enfouie dans `todoList` ; elle sert
  // aussi à l'éditeur, qui proposait « Facturer ce devis » à l'identique sur un devis DÉJÀ facturé —
  // un second clic fabriquait un second brouillon complet. Pire avec un acompte : l'acompte fait
  // passer le devis à « accepté », donc le seul bouton coloré proposait ensuite une facture de 100 %
  // pendant que l'action juste, « Facture de solde », dormait dans le menu « ▾ ».
  function facturesDuDevis(data, quoteId) {
    if (!quoteId) return [];
    if (lot) {
      const idx = duLot(data, 'facturesDuDevis', () => {
        const m = new Map();
        (data.documents || []).forEach(d => { if (d.type !== 'facture' || !d.fromQuoteId) return; if (!m.has(d.fromQuoteId)) m.set(d.fromQuoteId, []); m.get(d.fromQuoteId).push(d); });
        return m;
      });
      return (idx.get(quoteId) || []).slice();
    }
    return (data.documents || []).filter(d => d.type === 'facture' && d.fromQuoteId === quoteId);
  }

  // La référence d'un achat dans les ÉCRITURES (10.14.1, LET-01) : le numéro du fournisseur, sinon
  // « SN- » et sa date (« SN-20260914 », « SN-20260914-2 » pour le deuxième du même jour). Une dépense
  // sans numéro — le carburant, la papeterie — s'écrivait avec la pièce « (sans numéro) », son
  // règlement avec une pièce VIDE, et sa lettre de lettrage était son identifiant interne
  // (« muhp44v9q0rsl9 » dans la colonne Let. du livre-journal, dans le CSV du comptable et comme nom
  // de dossier dans le paquet). Deux dépenses du même jour portaient la même pièce : le 📎 de l'une se
  // posait sur l'autre au Cabinet. La référence est lisible, unique, et la même partout ; l'ordre
  // entre deux pièces du même jour suit leur identifiant, donc elle ne bouge pas d'un calcul à l'autre.
  function referencesSansNumeroCalcul(data) {
    const parJour = {};
    (data && data.purchases || []).forEach(p => {
      if (!p || String(p.number || '').trim()) return;
      (parJour[p.date || ''] = parJour[p.date || ''] || []).push(p);
    });
    const refs = {};
    Object.keys(parJour).forEach(jour => {
      const base = 'SN-' + (String(jour).replace(/-/g, '') || 'sans-date');
      parJour[jour].slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .forEach((p, i) => { refs[p.id] = i ? `${base}-${i + 1}` : base; });
    });
    return refs;
  }
  function referenceAchat(p, data) {
    if (!p) return '';
    const num = String(p.number || '').trim();
    if (num) return num;
    return duLot(data, 'refsSansNumero', () => referencesSansNumeroCalcul(data))[p.id] || 'SN';
  }

  function achatDoublon(data, achat) {
    if (!achat || achat.kind === 'depense') return null;       // une dépense n'a pas de numéro qui fasse foi
    const num = String(achat.number || '').trim().toLowerCase();
    if (!num || !achat.supplierId) return null;
    // Un avoir peut légitimement porter le même numéro qu'une facture chez certains fournisseurs :
    // ce sont deux séries différentes. On ne compare que des pièces de même nature (10.2.0).
    const kind = achat.kind || 'facture';
    return (data.purchases || []).find(x => x.id !== achat.id && x.supplierId === achat.supplierId
      && (x.kind || 'facture') === kind
      && String(x.number || '').trim().toLowerCase() === num) || null;
  }

  function purchaseStatus(purchase, company, todayIso, data) {
    const b = purchaseBalance(purchase, company, data);
    // Un avoir libre que le fournisseur a remboursé en entier n'a plus rien à imputer (10.14.0) : le
    // dire « à imputer » faisait chercher une facture où le déduire, c'est-à-dire le compter deux fois.
    if (purchase.kind === 'avoir') return purchase.achatLie ? 'imputé' : (avoirRembourse(purchase, b) ? 'remboursé' : 'à imputer');
    if (b.remaining <= 0.0005) return 'payée';
    if (b.paid > 0 || b.impute > 0) return 'partiel';
    if (purchase.dueDate && purchase.dueDate < (todayIso || today())) return 'retard';
    return 'à payer';
  }
  // (1.310.0) EN RETARD n'est pas un statut de plus : c'est un fait sur la pièce, échue et pas soldée. Une facture payée en
  // partie reste « partiel » (son statut), et elle est en retard quand même : la fiche du fournisseur, la liste des
  // fournisseurs et le filtre « En retard » la taisaient, pendant que « À payer » la comptait (`payablesList`). Une règle,
  // lue partout ; `reste` est celui de `purchaseBalance` (dans la devise de la pièce).
  function achatEnRetard(purchase, reste, todayIso) {
    return purchase.kind !== 'avoir' && reste > 0.0005 && !!purchase.dueDate && purchase.dueDate < (todayIso || today());
  }

  // Ce qu'on doit, par fournisseur et par échéance. Le pendant des relances, côté sortant.
  function payablesList(data, company, todayIso) {
    const t = todayIso || today();
    return (data.purchases || []).map(p => {
      // Un avoir n'est jamais une dette : il ne se règle pas, il s'impute. Rien à filtrer ici —
      // `purchaseBalance` rend déjà un reste nul ou négatif pour un avoir, et un garde-fou de plus
      // serait du code qu'aucun test ne peut faire tomber.
      const b = purchaseBalance(p, company, data);
      if (b.remaining <= 0.0005) return null;
      const late = p.dueDate && p.dueDate < t ? daysBetween(p.dueDate, t) : 0;
      return {
        id: p.id, supplierId: p.supplierId, number: p.number || '', date: p.date, dueDate: p.dueDate || '',
        subject: p.subject || '', remaining: toBase(p, b.remaining, company), total: b.totals.base.netToPay, late,
        currency: p.currency || company.currency, status: purchaseStatus(p, company, t, data)
      };
    }).filter(Boolean).sort((a, b) => (b.late - a.late) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  }
  // (1.312.0) Ce que l'entreprise DOIT, en un chiffre : les pièces qui restent à payer (`payablesList`), moins ce qu'un
  // fournisseur lui doit déjà (un avoir déduit d'aucune facture, un trop-payé), à hauteur de ce qu'on lui doit à lui. C'est
  // le net de son compte (`supplierSummary.remaining`), celui de la liste des fournisseurs, de sa fiche et du 401 chez le
  // comptable : l'accueil disait 7 105,249 DT là où la liste des fournisseurs disait 6 832,138 (un avoir de 273,111 DT).
  // Le crédit d'un fournisseur ne diminue jamais ce qu'on doit à un autre.
  function detteFournisseurs(data, company, todayIso) {
    const pieces = payablesList(data, company, todayIso);
    const parF = new Map();
    pieces.forEach(x => { if (x.supplierId) parF.set(x.supplierId, round3((parF.get(x.supplierId) || 0) + x.remaining)); });
    const avoirs = [];
    parF.forEach((du, id) => {
      const d = round3(Math.min(supplierSummary(data, company, id, todayIso).aRecuperer, du));
      if (d > 0.0005) avoirs.push({ supplierId: id, montant: d });
    });
    const brut = round3(pieces.reduce((a, x) => a + x.remaining, 0));
    const aDeduire = round3(avoirs.reduce((a, x) => a + x.montant, 0));
    const total = round3(brut - aDeduire);
    return { pieces, brut, aDeduire, avoirs, total, late: Math.min(total, round3(pieces.filter(x => x.late > 0).reduce((a, x) => a + x.remaining, 0))) };
  }

  // Journal des décaissements : un règlement fournisseur par ligne. Le symétrique de paymentsJournal.
  function supplierPayments(data, company, period) {
    const name = id => ((data.suppliers || []).find(s => s.id === id) || {}).name || '—';
    const out = [];
    (data.purchases || []).forEach(p => {
      const pays = (p.payments || []).filter(x => inPeriod(x.date, period && period.from, period && period.to));
      if (!pays.length) return;
      // La retenue que ce règlement opère (10.14.0) : elle naît au paiement, en dinars au taux de la
      // pièce — celui auquel le 401 porte le brut.
      const rs = retenueDesReglements(p, company, data);
      pays.forEach(x => {
        const m = PAYMENT_METHODS.find(k => k[0] === x.method);
        const rsNatif = rs.parts[x.id || '#' + (p.payments || []).indexOf(x)] || 0;
        out.push({
          id: x.id, purchaseId: p.id, date: x.date, number: p.number || '', piece: referenceAchat(p, data), supplier: name(p.supplierId), supplierId: p.supplierId || '',
          // Un règlement porté par un AVOIR est un remboursement : l'argent ENTRE (10.2.0). Le signe
          // suffit — `entrySet` change alors la colonne tout seul, et la trésorerie suit.
          amount: round3((p.kind === 'avoir' ? -1 : 1) * montantRegle(p, x, company)),
          amountTiers: round3((p.kind === 'avoir' ? -1 : 1) * toBase(p, Number(x.amount) || 0, company)), method: m ? m[1] : (x.method || ''),
          rs: round3((p.kind === 'avoir' ? -1 : 1) * toBase(p, rsNatif, company)),
          currency: p.currency || company.currency, reference: x.reference || '', note: x.note || '', accountId: x.accountId || ''
        });
      });
    });
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // La TVA déductible des acomptes imputés sur une facture d'achat : son total, et par taux. Même
  // règle que l'imputation du journal — une seule définition pour l'écriture et la déclaration.
  function acomptesDeduits(data, purchase, company) {
    const out = { total: 0, byRate: {} };
    if (!data || purchase.kind === 'avoir' || purchase.kind === 'acompte') return out;
    piecesLieesAchat(data, purchase.id, 'acompte').forEach(a => {
      const ta = purchaseTotals(a, company);
      out.total = round3(out.total + ta.base.deductibleVAT);
      Object.keys(ta.base.vatByRate || {}).forEach(r => { out.byRate[r] = round3((out.byRate[r] || 0) + (ta.base.vatByRate[r].deductible || 0)); });
    });
    return out;
  }

  // Journal des achats d'une période : une ligne par pièce, prête pour le CSV du comptable.
  function purchaseJournal(data, company, period) {
    const name = id => ((data.suppliers || []).find(s => s.id === id) || {}).name || '—';
    return (data.purchases || [])
      .filter(p => inPeriod(p.date, period && period.from, period && period.to))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0))
      .map(p => {
        const t = purchaseTotals(p, company);
        // La TVA d'un acompte rattaché a déjà été déduite le mois où l'acompte a été versé ; la
        // facture porte la TVA du montant ENTIER, acompte compris. L'écriture le sait depuis la
        // 10.2.0 (l'imputation recrédite le 4366) ; la déclaration, elle, la déduisait une seconde
        // fois. Ce qui reste déductible sur la facture est sa TVA MOINS celle des acomptes imputés.
        const deductibleAcompte = acomptesDeduits(data, p, company);
        return {
          // `piece` : la référence de l'achat dans les écritures — son numéro, ou « SN-AAAAMMJJ » quand
          // le fournisseur n'en a pas donné (10.14.1, LET-01). C'est elle qui nomme son dossier dans
          // le paquet : le journal des achats la porte pour que le comptable les rapproche.
          id: p.id, date: p.date, number: p.number || '', piece: referenceAchat(p, data), supplier: name(p.supplierId),
          kind: (PURCHASE_KINDS.find(k => k[0] === (p.kind || 'facture')) || PURCHASE_KINDS[0])[1], category: p.category || '',
          ht: t.base.totalHT, tva: t.base.totalVAT, deductible: round3(t.base.deductibleVAT - deductibleAcompte.total), deductibleAcompte: deductibleAcompte.total, fees: t.base.fees,
          ttc: t.base.totalTTC, rs: t.base.withholding, net: t.base.netToPay,
          currency: t.currency, rate: t.rate,
          status: purchaseStatus(p, company, '9999-12-31', data), subject: p.subject || ''
        };
      });
  }

  // Récapitulatif d'achats : totaux, TVA déductible, ventilation par catégorie et par destination.
  function purchaseSummary(rows) {
    const sum = k => round3(rows.reduce((s, r) => s + (r[k] || 0), 0));
    const byCategory = {};
    rows.forEach(r => { const k = r.category || 'Sans catégorie'; byCategory[k] = round3((byCategory[k] || 0) + r.ht); });
    return {
      count: rows.length, ht: sum('ht'), tva: sum('tva'), deductible: sum('deductible'),
      fees: sum('fees'), ttc: sum('ttc'), rs: sum('rs'), net: sum('net'),
      byCategory: Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a]).map(k => ({ label: k, ht: byCategory[k] }))
    };
  }

  // Chiffres d'un fournisseur, pour sa fiche.
  function supplierSummary(data, company, supplierId, todayIso) {
    const mine = lot
      ? (duLot(data, 'achatsParFournisseur', () => {
        const m = new Map();
        (data.purchases || []).forEach(p => { if (!m.has(p.supplierId)) m.set(p.supplierId, []); m.get(p.supplierId).push(p); });
        return m;
      }).get(supplierId) || []).slice()
      : (data.purchases || []).filter(p => p.supplierId === supplierId);
    let ht = 0, due = 0, aRecuperer = 0, late = 0, rsAOperer = 0;
    mine.forEach(p => {
      const b = purchaseBalance(p, company, data);
      // La retenue que les règlements à venir garderont pour l'État (10.14.0) : le compte du
      // fournisseur la porte jusqu'au paiement, la fiche la dit à côté du net à lui verser.
      rsAOperer = round3(rsAOperer + retenueAOperer(p, company, data));
      // Un acompte n'est pas un achat de plus : sa facture porte déjà le montant entier (10.14.0).
      if (p.kind !== 'acompte') ht = round3(ht + b.totals.base.totalHT);
      const reste = toBase(p, b.remaining, company);
      if (reste > 0.0005) {
        due = round3(due + reste);
        if (achatEnRetard(p, b.remaining, todayIso)) late = round3(late + reste);
      }
      // Ce qu'on DÉTIENT chez ce fournisseur : un avoir non imputé (10.2.0), et un trop-payé sur une
      // facture (10.14.0). Les deux sont des crédits de même nature — la fiche comptait le premier
      // et oubliait le second, et disait 450 là où son compte 401 dit 350. Le net est celui du
      // compte, la règle de la fiche client (`clientSummary.net`).
      else if (reste < -0.0005) aRecuperer = round3(aRecuperer - reste);
    });
    const dates = mine.map(p => p.date).filter(Boolean).sort();
    return { count: mine.length, ht, due, aRecuperer, remaining: round3(due - aRecuperer), rsAOperer, late, first: dates[0] || '', last: dates[dates.length - 1] || '' };
  }

  // Retenues à la source que tu as opérées et dont le fournisseur attend l'attestation. Une retenue
  // s'opère au RÈGLEMENT (10.14.0) : une facture pas encore payée n'a rien retenu, et l'attestation
  // porte ce que les règlements ont retenu — pas la retenue entière d'une facture payée à moitié.
  function withholdingsToIssue(data, company) {
    const name = id => ((data.suppliers || []).find(s => s.id === id) || {}).name || '—';
    return (data.purchases || [])
      .filter(p => !p.withholdingCertificate && (p.payments || []).length && Number(p.withholdingRate) > 0)
      .map(p => ({ p, t: purchaseTotals(p, company), op: retenueDesReglements(p, company, data).operee }))
      .filter(x => x.op > 0.0005)
      .map(x => ({ id: x.p.id, supplier: name(x.p.supplierId), number: x.p.number || '', date: x.p.date,
        amount: round3((x.p.kind === 'avoir' ? -1 : 1) * toBase(x.p, x.op, company)), rate: x.t.withholdingRate }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // ---------- attestations d'exonération de retenue à la source (10.15.0, H7) ----------
  // Un tiers qui détient une attestation d'exonération (ou de non-soumission) de la retenue à la
  // source la présente à qui le paie : tant qu'elle est valable, on ne lui retient rien. Deux côtés :
  //   • un FOURNISSEUR exonéré — l'achat propose 0 % tant que l'attestation couvre sa date ;
  //   • L'ENTREPRISE elle-même — ses factures portent la mention, pour que le client ne retienne rien.
  // Une attestation a une fin (`au`) : sans elle, on ne saurait jamais quand recommencer à retenir,
  // et c'est précisément l'oubli qu'un contrôle relève. Chacune se garde (`exonerationsRS[]`) : une
  // attestation expirée dit POURQUOI un achat de l'an dernier ne portait aucune retenue.
  // SkanFact ne décide jamais seul : il propose le taux et prévient d'un écart, sans rien réécrire —
  // un taux saisi sur une pièce reste celui de la pièce (règle 7.1.x). À VÉRIFIER avec le comptable :
  // la forme de l'attestation et ce qu'elle couvre (tous les paiements, ou certains seulement).
  const JOUR_ISO = /^\d{4}-\d{2}-\d{2}$/;
  function attestationsRS(tiers) {
    return ((tiers && tiers.exonerationsRS) || [])
      .filter(a => a && JOUR_ISO.test(a.au || '') && (!a.du || JOUR_ISO.test(a.du)))
      .slice().sort((a, b) => a.au.localeCompare(b.au) || (a.du || '').localeCompare(b.du || ''));
  }
  // L'attestation qui couvre ce jour, sinon null. Plusieurs peuvent se chevaucher (un renouvellement
  // reçu avant la fin du précédent) : on rend celle qui va le plus loin.
  function exonerationRS(tiers, iso) {
    if (!iso || !JOUR_ISO.test(iso)) return null;
    const l = attestationsRS(tiers).filter(a => (!a.du || a.du <= iso) && iso <= a.au);
    return l.length ? l[l.length - 1] : null;
  }
  function derniereAttestationRS(tiers) {
    const l = attestationsRS(tiers);
    return l.length ? l[l.length - 1] : null;
  }
  // Le taux à PROPOSER sur un achat de ce fournisseur daté de `iso` : 0 quand une attestation le
  // couvre, sinon celui de sa fiche. Un taux proposé, jamais imposé : la pièce garde le sien.
  function tauxRetenueFournisseur(sup, iso) {
    if (!sup) return 0;
    if (exonerationRS(sup, iso)) return 0;
    return Number(sup.withholdingRate) || 0;
  }
  // L'état d'une attestation vu d'un jour, pour une phrase et sa couleur : `valide`, `bientot`
  // (moins de 30 jours), `expiree`, ou null sans aucune attestation.
  function etatExonerationRS(tiers, today) {
    const d = derniereAttestationRS(tiers);
    if (!d) return null;
    const jour = today || today();
    const couvre = exonerationRS(tiers, jour);
    // Une attestation qui finit bientôt n'est plus à réclamer quand la SUIVANTE est déjà saisie : on
    // l'a reçue avant la fin de la première, c'est exactement ce qu'on voulait.
    if (couvre) return { etat: daysBetween(jour, couvre.au) <= 30 && d.au <= couvre.au ? 'bientot' : 'valide', attestation: couvre, jours: daysBetween(jour, couvre.au) };
    if (d.au < jour) return { etat: 'expiree', attestation: d, jours: -daysBetween(d.au, jour) };
    return { etat: 'future', attestation: d, jours: daysBetween(jour, d.du || d.au) };
  }
  // Les attestations à renouveler : celles qui finissent dans les 30 jours, et celles finies depuis
  // moins de 60 jours sans relève — au-delà, la réclamer ne sert plus à rien, l'écart est déjà dans
  // les pièces. Un fournisseur qui n'a plus aucun achat depuis un an ne réclame rien : on ne court
  // pas après l'attestation de quelqu'un chez qui on n'achète plus.
  function exonerationsAFaire(data, company, today) {
    const jour = today || today();
    const out = [];
    const juger = (tiers, qui) => {
      const e = etatExonerationRS(tiers, jour);
      if (!e) return;
      if (e.etat === 'bientot') out.push({ qui, id: tiers.id || '', nom: tiers.name || '', attestation: e.attestation, etat: 'bientot', au: e.attestation.au, jours: e.jours });
      else if (e.etat === 'expiree' && e.jours >= -60) out.push({ qui, id: tiers.id || '', nom: tiers.name || '', attestation: e.attestation, etat: 'expiree', au: e.attestation.au, jours: e.jours });
    };
    if (company) juger(company, 'entreprise');
    const unAn = addDays(jour, -365);
    (data.suppliers || []).forEach(s => {
      const actif = (data.purchases || []).some(p => p.supplierId === s.id && (p.date || '') >= unAn);
      if (actif) juger(s, 'fournisseur');
    });
    return out.sort((a, b) => a.au.localeCompare(b.au));
  }
  // Ce que l'écran d'un achat (ou d'un règlement, à sa date) dit de l'exonération du fournisseur :
  // `{ ton: 'ok' | 'warn', texte }`, ou null s'il n'y a rien à dire. Il ne change aucun taux — un taux
  // saisi reste celui de la pièce — il prévient d'un écart dans les DEUX sens : une retenue sur un
  // fournisseur exonéré, et une attestation expirée alors que la pièce ne retient plus rien.
  function noteExonerationRS(sup, iso, taux) {
    if (!sup || !iso) return null;
    const a = exonerationRS(sup, iso);
    const n = a && a.numero ? ` (attestation n°\u00a0${a.numero})` : '';
    if (a) {
      return Number(taux) > 0
        ? { ton: 'warn', texte: `Ce fournisseur est exonéré de retenue jusqu'au ${fmtDate(a.au)}${n} : vérifie ce taux, aucune retenue n'est à opérer.` }
        : { ton: 'ok', texte: `Aucune retenue : fournisseur exonéré jusqu'au ${fmtDate(a.au)}${n}.` };
    }
    const fiche = Number(sup.withholdingRate) || 0;
    const passee = attestationsRS(sup).filter(x => x.au < iso).pop();
    if (passee && fiche > 0 && !(Number(taux) > 0)) {
      return { ton: 'warn', texte: `L'attestation d'exonération de ce fournisseur a expiré le ${fmtDate(passee.au)} : sa retenue de ${String(fiche).replace('.', ',')} % s'applique de nouveau, sauf s'il t'en a remis une autre.` };
    }
    return null;
  }
  // Ce que les trois champs d'une fiche font de la liste (pur : la fiche fournisseur et celle de
  // l'entreprise l'appellent). La fiche montre la DERNIÈRE attestation :
  //   • un numéro neuf ajoute une attestation — l'ancienne reste, elle explique les pièces d'avant ;
  //   • le même numéro (ou aucun) corrige la dernière — une date mal tapée ne fait pas un doublon ;
  //   • les trois champs vidés retirent la dernière — c'est le seul geste pour défaire une saisie.
  // Rend `{ liste }`, ou le refus `{ champ, motif }` : une attestation sans fin n'en est pas une.
  function appliquerAttestationRS(liste, saisie) {
    const numero = String((saisie && saisie.numero) || '').trim();
    const du = (saisie && saisie.du) || '', au = (saisie && saisie.au) || '';
    const avant = Array.isArray(liste) ? liste.filter(Boolean) : [];
    const derniere = derniereAttestationRS({ exonerationsRS: avant });
    if (!numero && !du && !au) return { liste: derniere ? avant.filter(x => x !== derniere) : avant };
    if (!JOUR_ISO.test(au)) return { champ: 'au', motif: 'Donne la date de fin de validité de l\'attestation : sans elle, SkanFact ne saurait pas quand reprendre la retenue.' };
    if (du && !JOUR_ISO.test(du)) return { champ: 'du', motif: 'La date de début n\'est pas lisible.' };
    if (du && du > au) return { champ: 'du', motif: 'L\'attestation commence après sa fin : vérifie les deux dates.' };
    if (derniere && (!numero || !derniere.numero || derniere.numero === numero)) {
      return { liste: avant.map(x => x === derniere ? Object.assign({}, x, { numero: numero || x.numero || '', du, au }) : x) };
    }
    return { liste: avant.concat([{ id: uid(), numero, du, au }]) };
  }
  // La mention que porte une FACTURE de l'entreprise exonérée : seulement si l'attestation couvre la
  // date de la pièce ET que la pièce ne porte aucune retenue — une mention « exonéré » au-dessus d'une
  // ligne « Retenue à la source 1 % » serait une pièce qui se contredit (10.12.0, H-E23).
  function mentionExonerationRS(doc, company) {
    if (!doc || doc.type !== 'facture') return null;
    if (Number(doc.withholdingRate) > 0) return null;
    // Une pièce émise garde la mention de son émission (règle 7.1.x) : changer d'attestation ne
    // réécrit pas une facture déjà envoyée.
    if (doc.exonerationRS !== undefined) return doc.exonerationRS || null;
    // Une facture émise avant la 10.15.0 n'a rien figé : elle est partie sans mention, et une
    // attestation saisie aujourd'hui ne doit pas la lui ajouter après coup.
    if (doc.number && doc.status && doc.status !== 'brouillon') return null;
    const a = exonerationRS(company, doc.date);
    return a ? { numero: a.numero || '', au: a.au } : null;
  }

  // ---------- marges et rentabilité (3.4.0) ----------
  // Le chiffre d'affaires ne dit rien de la santé d'une entreprise : vendre 100 000 DT en achetant
  // pour 95 000 DT, c'est travailler pour rien. Ce bloc répond à « qu'est-ce qui me reste ? ».
  //
  // Le coût d'une vente vient de deux sources, dans cet ordre :
  //   1. le coût saisi sur la ligne du document (le plus précis) ;
  //   2. à défaut, le coût de revient de la prestation dans le catalogue.
  // Et pour une affaire, on ajoute les achats réellement rattachés — c'est là que le chiffre devient vrai.

  // Coût de revient d'une ligne de vente. `unitCost` sur la ligne l'emporte sur celui du catalogue :
  // le prix d'achat du jour est toujours plus juste que le prix de référence.
  // Le coût est dans la devise de la PIÈCE, comme son prix (10.14.1) : le coût du catalogue, tenu en
  // dinars, se convertit pour une pièce en euros — sinon 60 DT de coût se lisaient 60 € face à un
  // prix en euros, et la marge d'une vente à l'étranger plongeait sans raison.
  function lineCost(line, data, doc, company) {
    if (line.unitCost !== '' && line.unitCost != null && Number.isFinite(Number(line.unitCost))) {
      return round3((Number(line.unitCost) || 0) * (Number(line.qty) || 0));
    }
    const label = (line.label || '').trim().toLowerCase();
    const item = (data.catalog || []).find(c => (c.label || '').trim().toLowerCase() === label);
    if (item && Number(item.unitCost) > 0) {
      const cu = doc && company ? prixDuCatalogue(Number(item.unitCost), doc, company) : Number(item.unitCost);
      return cu == null ? 0 : round3(cu * (Number(line.qty) || 0));
    }
    return 0;
  }

  // Marge d'un document de vente. Les lignes de déduction d'acompte ne sont pas des ventes : elles
  // ne portent ni chiffre d'affaires ni coût.
  // Ce que la remise globale laisse d'une ligne remisable. La remise ne porte PAS sur les lignes
  // « noDiscount » (la déduction d'un acompte déjà facturé) : diviser le net par le total, déduction
  // comprise, appliquait la remise une seconde fois sur une facture de solde remisée — 160 DT de
  // chiffre d'affaires disparaissaient de la page Marges sur l'exemple (10.14.0). C'est la règle de
  // `computeTotals`, dite une fois.
  function facteurRemise(t) {
    const remisable = round3(t.lines.filter(l => !l.noDiscount).reduce((s, l) => s + l.ht, 0));
    return remisable > 0 ? (remisable - round3(t.totalHT - t.netHT)) / remisable : 1;
  }

  function documentMargin(doc, data, company) {
    const t = computeTotals(doc, company);
    const sign = doc.type === 'avoir' ? -1 : 1;
    let revenue = 0, cost = 0, known = 0, total = 0;
    const factor = facteurRemise(t);   // la remise globale ampute le prix, pas le coût
    t.lines.forEach(l => {
      if (l.noDiscount) return;
      total++;
      const c = lineCost(l, data, doc, company);
      if (c > 0) known++;
      revenue = round3(revenue + sign * round3(l.ht * factor));
      cost = round3(cost + sign * c);
    });
    const margin = round3(revenue - cost);
    return {
      revenue, cost, margin,
      rate: revenue !== 0 ? Math.round(margin / revenue * 1000) / 10 : null,
      // Combien de lignes ont un coût connu : sans ça, une marge de 100 % voudrait juste dire « on ne sait pas »
      lines: total, costed: known, complete: total > 0 && known === total
    };
  }

  // ---------- Le calculateur de prix (10.15.0, H6) ----------
  // Un prix de vente se DÉDUIT d'un coût et d'une règle que le commerçant choisit : un coefficient
  // (× 1,6), une marge sur le coût (+ 60 %), un taux de marque (la marge rapportée au prix de vente,
  // 37,5 % pour le même prix), ou un prix TTC qu'on vise en rayon. Aucune règle n'est écrite en dur
  // (5.0.0) : le calculateur applique celle qu'on lui donne, et `company.calculPrix` retient la
  // dernière. Le prix se calcule en UNITÉS MINIMALES entières (le millime, le centime) : un flottant
  // arrondi deux fois donne un TTC qui ne retombe pas sur le prix d'étiquette.
  const MODES_PRIX = [
    { id: 'coef', label: 'Coefficient', court: '×', aide: 'Prix HT = coût × coefficient. Un coefficient de 1,6 revient à une marge de 60 % sur le coût.' },
    { id: 'marge', label: 'Marge sur le coût (%)', court: '%', aide: 'Prix HT = coût + le pourcentage du coût. 60 % sur un coût de 100 donne 160.' },
    { id: 'marque', label: 'Taux de marque (%)', court: '%', aide: 'La marge rapportée au PRIX DE VENTE : 37,5 % de marque sur un coût de 100 donne 160, dont 60 de marge.' },
    { id: 'ttc', label: 'Prix TTC visé', court: 'TTC', aide: 'Le prix que le client paiera, TVA comprise : le calculateur en retire la TVA.' }
  ];
  const ARRONDIS_PRIX = [0, 0.1, 0.5, 1, 5, 10];
  function calculPrix(o) {
    o = o || {};
    const dec = o.decimales != null ? Number(o.decimales) : 3, u = Math.pow(10, dec);
    const vers = x => Math.round((Number(x) || 0) * u * (1 + 4 * Number.EPSILON));
    const coutU = vers(o.cout), fraisU = vers(o.frais), completU = coutU + fraisU;
    const tva = Math.max(0, Number(o.tva) || 0), t = 1 + tva / 100;
    const mode = MODES_PRIX.some(m => m.id === o.mode) ? o.mode : 'coef';
    const v = Number(String(o.valeur == null ? '' : o.valeur).replace(',', '.'));
    const pasU = Math.max(0, vers(o.arrondi));
    const refus = motif => ({ ok: false, motif, mode });
    if (coutU < 0 || fraisU < 0) return refus('Un coût se compte en positif.');
    if (!Number.isFinite(v) || v <= 0) {
      return refus(mode === 'ttc' ? 'Tape le prix TTC que tu vises.' : mode === 'coef' ? 'Tape un coefficient : 1,6 par exemple.' : 'Tape le pourcentage : 60 par exemple.');
    }
    if (mode !== 'ttc' && completU <= 0) return refus('Donne d\'abord le coût : le prix se calcule à partir de ce que la chose te coûte.');
    if (mode === 'marque' && v >= 100) return refus('Un taux de marque de 100 % ou plus voudrait dire un coût nul : la marge est une part du prix, elle ne peut pas en être la totalité.');
    // Le prix HT « brut », avant arrondi, en unités minimales (fraction permise).
    const brut = mode === 'coef' ? completU * v
      : mode === 'marge' ? completU * (1 + v / 100)
      : mode === 'marque' ? completU / (1 - v / 100)
      : (v * u) / t;
    // Le prix qu'on arrondit est celui que le client VOIT : TTC s'il y a de la TVA. Arrondir AU-DESSUS :
    // un arrondi ne rogne jamais la marge qu'on a demandée. Le HT se retrouve ensuite de sorte que
    // HT × (1 + TVA) retombe EXACTEMENT sur le prix d'étiquette, quand un tel HT existe.
    const pret = x => Math.ceil(x - 1e-6);
    let htU, ttcU, exact = true;
    const ttcDe = h => Math.round(h * t);
    if (pasU > 0 || mode === 'ttc') {
      let cible = mode === 'ttc' ? Math.round(v * u) : pret(brut * t);
      if (pasU > 0) cible = Math.ceil(cible / pasU - 1e-9) * pasU;
      // Si un HT h donne `cible` (round(h × t) = cible), alors |cible / t − h| < 0,5 / t < 0,5 : h est
      // forcément round(cible / t). Un seul essai suffit — vérifié sur 530 000 prix aux trois taux.
      htU = Math.round(cible / t);
      ttcU = ttcDe(htU);
      exact = ttcU === cible;
    } else {
      htU = pret(brut);
      ttcU = ttcDe(htU);
    }
    const ht = htU / u, ttc = ttcU / u, cout = completU / u;
    const margeU = htU - completU;
    return {
      ok: true, mode, decimales: dec,
      cout, frais: fraisU / u, coutComplet: cout,
      ht, ttc, tva, exact,
      marge: margeU / u,
      tauxMarge: completU > 0 ? Math.round(margeU / completU * 1000) / 10 : null,
      tauxMarque: htU > 0 ? Math.round(margeU / htU * 1000) / 10 : null,
      coef: completU > 0 ? Math.round(htU / completU * 1000) / 1000 : null,
      perte: completU > 0 && margeU < 0
    };
  }

  // Marge agrégée sur une période, par client ou par prestation.
  function marginBy(data, company, fromIso, toIso, dimension, limit) {
    const acc = {};
    // Une vente sans client (un ticket de caisse, et l'avoir qui le rembourse) est une vente au
    // comptoir : l'écarter faisait dire à la page Marges un autre chiffre d'affaires que les
    // Statistiques dès la première vente en caisse (10.15.0, trouvé par la vérité comptable).
    const COMPTOIR = '__comptoir__';
    const clientName = id => id === COMPTOIR ? CLIENT_COMPTOIR : ((data.clients || []).find(c => c.id === id) || {}).name || '—';
    issuedIn(data, fromIso, toIso).forEach(d => {
      const sign = d.type === 'avoir' ? -1 : 1;
      const clientKey = d.clientId || COMPTOIR;
      const t = computeTotals(d, company);
      const factor = facteurRemise(t);
      t.lines.forEach(l => {
        // Un acompte facturé, et sa déduction sur la facture de solde, SONT du chiffre d'affaires de
        // leur période : les ignorer faisait dire à la page Marges un autre chiffre d'affaires que
        // les Statistiques dès qu'un acompte et son solde tombaient dans deux périodes (10.14.0).
        // Ils n'ont pas de coût, et ils ne comptent pas comme des lignes « sans coût connu ».
        if (l.noDiscount) {
          const key = dimension === 'client' ? clientKey : '__acomptes__';
          if (!key) return;
          const a = acc[key] || (acc[key] = {
            key, label: dimension === 'client' ? clientName(clientKey) : 'Acomptes facturés (repris au solde)',
            revenue: 0, cost: 0, lines: 0, costed: 0
          });
          a.revenue = round3(a.revenue + sign * toBase(d, l.ht, company));
          return;
        }
        const key = dimension === 'client' ? clientKey : (l.label || '').trim().toLowerCase();
        if (!key) return;
        const a = acc[key] || (acc[key] = {
          key, label: dimension === 'client' ? clientName(clientKey) : (l.label || '').trim(),
          revenue: 0, cost: 0, lines: 0, costed: 0
        });
        const c = lineCost(l, data, d, company);
        a.revenue = round3(a.revenue + sign * toBase(d, round3(l.ht * factor), company));
        a.cost = round3(a.cost + sign * toBase(d, c, company));
        a.lines++; if (c > 0) a.costed++;
      });
    });
    // Un acompte et sa déduction dans la même période s'annulent : une ligne à zéro n'apprend rien.
    // La ligne des acomptes n'a pas de taux : son coût arrivera avec la facture de solde, et « 100 % »
    // serait une marge qu'elle n'a pas. Elle n'est pas non plus « sans coût connu » : elle n'a pas de
    // prestation, donc rien à chiffrer au catalogue.
    // (1.300.0, revue des Marges) Le taux d'un client se lit sur ses PRESTATIONS : un client qui n'a encore reçu qu'un
    // acompte (le chantier en cours de l'électricien) s'affichait à 100 % de marge, sans « ≈ » — un acompte n'a pas de coût
    // parce que son coût arrive avec le solde, pas parce qu'il n'en a pas. Sans prestation facturée, pas de taux.
    const rows = Object.values(acc).filter(a => a.lines > 0 || Math.abs(a.revenue) > 0.0005).map(a => ({
      ...a, margin: round3(a.revenue - a.cost), acomptes: a.key === '__acomptes__',
      rate: a.key !== '__acomptes__' && a.lines > 0 && a.revenue !== 0 ? Math.round((a.revenue - a.cost) / a.revenue * 1000) / 10 : null,
      complete: a.lines === 0 || a.costed === a.lines
    })).sort((x, y) => y.margin - x.margin);
    // `limit` à 0 veut dire « tout ». La page Marges calculait ses trois cartes — chiffre d'affaires,
    // marge totale, coût des ventes — sur un tableau DÉJÀ tronqué à vingt lignes, quel que soit le
    // nombre de clients : au 21e, la carte « Chiffre d'affaires » annonçait moins que la réalité.
    // Et le tri est par marge DÉCROISSANTE, donc ce qui tombait en premier, ce sont les lignes à
    // marge négative — exactement celles qu'on vient chercher. `limit || 20` ramenait 0 à 20, ce qui
    // rendait le « tout » impossible à demander : d'où le test explicite (7.16.0).
    return limit === 0 ? rows : rows.slice(0, limit || 20);
  }

  // ---------- affaires ----------
  // Une affaire relie des ventes et des achats. C'est le seul endroit où la marge est exacte :
  // on ne devine plus le coût, on l'a payé.
  const PROJECT_STATUSES = ['en cours', 'terminée', 'annulée'];

  // (1.263.0) L'affaire d'une LIGNE d'achat : la sienne si elle en a reçu une (« Répartir ses lignes »), sinon
  // celle de la pièce. Une ligne qui porte `projectId: ''` est sortie de toute affaire, même si la pièce en a une.
  const affaireDeLigne = (p, l) => (l && Object.prototype.hasOwnProperty.call(l, 'projectId') ? (l.projectId || '') : (p.projectId || ''));
  // Un achat compte dans une affaire dès qu'une de ses lignes y va.
  function achatDansAffaire(p, projectId) {
    if (!p || !projectId) return false;
    const lignes = p.lines || [];
    return lignes.length ? lignes.some(l => affaireDeLigne(p, l) === projectId) : p.projectId === projectId;
  }
  // Un achat dont les lignes vont à plusieurs affaires (ou en partie à aucune).
  function partageEntreAffaires(p) {
    const s = new Set((p.lines || []).map(l => affaireDeLigne(p, l)));
    return s.size > 1;
  }
  // Les affaires d'un achat, pour le dire sur sa ligne.
  function affairesDeLAchat(p) {
    return [...new Set((p.lines || []).map(l => affaireDeLigne(p, l)).concat(p.lines && p.lines.length ? [] : [p.projectId || '']))].filter(Boolean);
  }
  // Ce qu'un achat coûte À UNE AFFAIRE (1.263.0). Les mêmes morceaux que `coutAchat` — HT, TVA non déductible,
  // frais — pris ligne par ligne, les frais répartis au prorata du HT de chaque ligne. Les montants se convertissent
  // une fois par morceau, comme `purchaseTotals` : l'achat entier rattaché à une seule affaire, tout en charge,
  // donne EXACTEMENT `coutAchat` (deux chemins, un chiffre ; test « marges 1.263 »).
  //   - cout : ce qui se consomme sur l'affaire (charge, et le « stock » d'un article non suivi) ;
  //   - enStock : la marchandise d'un article suivi, entrée au stock ; elle compte quand elle en sort ;
  //   - immo : un bien immobilisé ; il s'amortit, il ne se consomme pas sur un chantier ;
  //   - part : la part de l'achat qui va à l'affaire (pour répartir ce qui a été payé).
  function coutAchatPourAffaire(p, company, data, projectId) {
    const out = { cout: 0, enStock: 0, immo: 0, part: 0 };
    if (!p || p.kind === 'acompte') return out;
    const t = purchaseTotals(p, company);
    const sacs = { cout: 0, enStock: 0, immo: 0 };
    let htAffaire = 0;
    const n = t.lines.length;
    t.lines.forEach(l => {
      if (affaireDeLigne(p, l) !== projectId) return;
      // Les frais (timbre, port) sont une charge : la page Stock valorise la marchandise sans eux.
      const frais = t.totalHT ? t.fees * l.ht / t.totalHT : (n ? t.fees / n : 0);
      const v = l.ht + (l.deductible ? 0 : l.vat);
      htAffaire += l.ht;
      sacs.cout += frais;
      if (l.destination === 'immobilisation') sacs.immo += v;
      else if (l.destination === 'stock' && articleSuivi(l, data)) sacs.enStock += v;
      else sacs.cout += v;
    });
    if (!n && p.projectId === projectId) sacs.cout += t.fees;
    const conv = v => round3(t.sens * toBase(p, round3(v), company));
    out.enStock = conv(sacs.enStock); out.immo = conv(sacs.immo);
    // L'achat entier va à l'affaire : ce qu'il coûte se lit sur `coutAchat`, au millime, et le reste se retranche.
    out.cout = partageEntreAffaires(p) ? conv(sacs.cout) : round3(coutAchat(t) - out.enStock - out.immo);
    out.part = t.totalHT ? htAffaire / t.totalHT : (n ? t.lines.filter(l => affaireDeLigne(p, l) === projectId).length / n : 1);
    return out;
  }
  function articleSuivi(l, data) { const c = itemOfLine(l, data); return !!(c && c.tracked); }

  // La valeur au coût moyen pondéré de chaque SORTIE de stock (1.263.0), par pièce (facture, bon de livraison,
  // avoir) et par mouvement noté à la main (la « matière utilisée ») : exactement ce que la page Stock retranche.
  // Une sortie vaut un coût positif ; un retour sur avoir, un coût négatif. Calculé une fois par lot.
  function sortiesValorisees(data) {
    const calc = () => {
      const parArticle = new Map();
      stockMovements(data, null).forEach(m => { if (!parArticle.has(m.itemId)) parArticle.set(m.itemId, []); parArticle.get(m.itemId).push(m); });
      const parPiece = new Map();
      parArticle.forEach(moves => runningStock(moves).rows.forEach(r => {
        if (!['vente', 'livraison', 'avoir', 'consommation'].includes(r.source)) return;
        const cle = r.manual ? r.id : r.docId;
        if (!cle) return;
        parPiece.set(cle, (parPiece.get(cle) || 0) - (Number(r.qty) || 0) * (Number(r.unitApplied) || 0));
      }));
      return parPiece;
    };
    return lot ? duLot(data, 'sortiesValorisees', calc) : calc();
  }
  // Ce que l'affaire a pris au stock : les sorties de ses ventes émises (le bon de livraison quand la facture en
  // vient : c'est lui qui sort la marchandise), et la matière utilisée notée pour elle.
  function clesStockDeLAffaire(data, projectId, sales) {
    const cles = new Set();
    (sales || []).forEach(d => {
      cles.add(d.id);
      if (d.fromDocType === 'livraison' && d.fromDocId) cles.add(d.fromDocId);
      (Array.isArray(d.bonsLivraison) ? d.bonsLivraison : []).forEach(b => b && b.id && cles.add(b.id));
    });
    (data.documents || []).forEach(d => { if (d.type === 'livraison' && d.projectId === projectId && d.status !== 'brouillon') cles.add(d.id); });
    (data.stockAdjustments || []).forEach(a => { if (a.projectId === projectId && a.source === 'consommation') cles.add(a.id); });
    return cles;
  }
  function ventesDeLAffaire(data, projectId) {
    return (data.documents || []).filter(d => d.projectId === projectId && (d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon' && d.status !== 'annulée');
  }
  // Les quantités sorties du stock pour l'affaire, article par article (pour ne proposer de sortir que ce qui reste).
  function quantitesSortiesPourAffaire(data, projectId) {
    const cles = clesStockDeLAffaire(data, projectId, ventesDeLAffaire(data, projectId));
    const q = new Map();
    stockMovements(data, null).forEach(m => {
      const cle = m.manual ? m.id : m.docId;
      if (!cle || !cles.has(cle) || !['vente', 'livraison', 'avoir', 'consommation'].includes(m.source)) return;
      q.set(m.itemId, round3((q.get(m.itemId) || 0) - (Number(m.qty) || 0)));
    });
    return q;
  }
  function coutStockPourAffaire(data, projectId, sales) {
    const v = sortiesValorisees(data);
    if (!v.size) return 0;
    const cles = clesStockDeLAffaire(data, projectId, sales);
    let s = 0;
    cles.forEach(k => { if (v.has(k)) s += v.get(k); });
    return round3(s);
  }

  // Le coût d'une heure d'un salarié, un mois donné (1.263.0) : son coût employeur du mois (brut et charges
  // patronales, la même fonction que le bulletin) divisé par les heures du mois du réglage de la paie (`heuresMois`,
  // celui qui paie les heures sup). Avec son bulletin du mois, c'est son coût réel ; sans bulletin, celui de son
  // salaire du contrat, et la fiche le dit « estimé ». Sans réglage d'heures ou sans salaire : inconnu, 0, et dit.
  // À VÉRIFIER avec le comptable : le coût horaire chargé qu'il retient pour tes devis.
  function coutHoraire(data, employeeId, year, month) {
    const s = payrollSettings(data);
    const emp = (data.employees || []).find(e => e.id === employeeId);
    // (1.274.0, audit G09) Les heures du mois de CE salarié : celles de son contrat s'il est à temps partiel.
    const heuresMois = Compta.heuresDuMoisDe(s, emp);
    if (!emp || !(heuresMois > 0)) return { coutMois: 0, heuresMois, estime: false, inconnu: true };
    const bulletins = (data.payslips || []).filter(p => p.employeeId === employeeId && Number(p.year) === Number(year) && Number(p.month) === Number(month));
    if (bulletins.length) {
      const coutMois = round3(bulletins.reduce((a, b) => a + (payslipView(b, data).c.employerCost || 0), 0));
      return { coutMois, heuresMois, estime: false, inconnu: !(coutMois > 0) };
    }
    const coutMois = round3(computePayslip(emp, saisieDeLaFiche(emp, s), s).employerCost || 0);
    return { coutMois, heuresMois, estime: true, inconnu: !(coutMois > 0) };
  }
  // Les heures notées sur une affaire, chacune avec son coût (1.263.0). `data.projectTime` :
  // { id, projectId, employeeId, date, hours, note }.
  function heuresDeLAffaire(data, projectId) {
    return (data.projectTime || []).filter(x => x && x.projectId === projectId).map(x => {
      const y = Number(String(x.date || '').slice(0, 4)), m = Number(String(x.date || '').slice(5, 7));
      const ch = coutHoraire(data, x.employeeId, y, m);
      const hours = round3(Number(x.hours) || 0);
      const emp = (data.employees || []).find(e => e.id === x.employeeId) || {};
      return { ...x, hours, employeeName: emp.name || '—', taux: ch.heuresMois > 0 ? round3(ch.coutMois / ch.heuresMois) : 0,
        cout: ch.heuresMois > 0 ? round3(hours * ch.coutMois / ch.heuresMois) : 0, estime: ch.estime, inconnu: ch.inconnu };
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function projectMargin(data, company, projectId) {
    const sales = (data.documents || []).filter(d => d.projectId === projectId
      && (d.type === 'facture' || d.type === 'avoir') && d.status !== 'brouillon' && d.status !== 'annulée');
    const buys = (data.purchases || []).filter(p => achatDansAffaire(p, projectId));
    let revenue = 0, invoiced = 0, collected = 0;
    sales.forEach(d => {
      const sign = d.type === 'avoir' ? -1 : 1;
      const t = computeTotals(d, company);
      revenue = round3(revenue + sign * toBase(d, t.netHT, company));
      invoiced = round3(invoiced + sign * toBase(d, t.netToPay, company));
      // L'encaissé est l'argent REÇU (10.14.0) : les règlements de la facture, un remboursement de
      // trop-perçu en moins. « Montant − reste » y ajoutait les avoirs, qui diminuent le reste sans
      // qu'un dinar n'entre : 2 040 annoncés pour 1 700 reçus, et le « rapporté en caisse » avec.
      if (d.type === 'facture') {
        collected = round3(collected + (d.payments || []).reduce((s, p) => s + montantRegle(d, p, company), 0));
      }
    });
    // (1.263.0, revue métier du 03/11 : « mets-toi à la place d'une entreprise ») Le coût d'une affaire a trois
    // morceaux, chacun compté une seule fois :
    //   - les ACHATS rattachés, ligne par ligne (une ligne peut aller à une autre affaire) ; la part partie au
    //     stock suivi n'y est pas — elle compte quand elle SORT — ni la part immobilisée, qui s'amortit ;
    //   - la MARCHANDISE SORTIE du stock pour l'affaire, au coût moyen pondéré de la page Stock. Avant, un article
    //     en stock facturé sur un chantier ne coûtait rien : 100 % de marge ;
    //   - la MAIN D'ŒUVRE : les heures notées sur l'affaire, au coût employeur de l'heure du salarié ce mois-là.
    let achats = 0, paid = 0, enStock = 0, immo = 0;
    buys.forEach(p => {
      const part = coutAchatPourAffaire(p, company, data, projectId);
      achats = round3(achats + part.cout);
      enStock = round3(enStock + part.enStock);
      immo = round3(immo + part.immo);
      // Un avoir remboursé RAPPORTE de l'argent (10.14.0) : son « réglé » vient en moins. Un achat partagé entre
      // deux affaires ne se paie qu'une fois : chacune porte la part de ce qui a été réglé.
      const regle = (p.kind === 'avoir' ? -1 : 1) * (p.payments || []).reduce((s, x) => s + montantRegle(p, x, company), 0);
      paid = round3(paid + (partageEntreAffaires(p) ? regle * part.part : regle));
    });
    const stockSorti = coutStockPourAffaire(data, projectId, sales);
    const heures = heuresDeLAffaire(data, projectId);
    const hours = round3(heures.reduce((s, x) => s + x.hours, 0));
    const mainOeuvre = round3(heures.reduce((s, x) => s + x.cout, 0));
    const cost = round3(achats + stockSorti + mainOeuvre);
    // Devis en cours : ce qui est proposé mais pas encore FACTURÉ, pour voir l'affaire en entier. Un
    // devis entièrement facturé comptait encore « en devis » à côté de ses propres factures : la fiche
    // annonçait 5 520 DT facturés PLUS 5 520 DT en devis pour un seul chantier (10.12.0, une
    // menuiserie). La règle est celle de `todoList` : une facture totale ou de solde, ÉMISE, ferme le
    // devis ; un acompte émis se retranche (en HT, comme le reste de la carte).
    const quotes = (data.documents || []).filter(d => d.projectId === projectId && d.type === 'devis' && d.status !== 'brouillon');
    const tirees = (data.documents || []).filter(d => d.type === 'facture' && d.fromQuoteId && d.status !== 'brouillon' && d.status !== 'annulée');
    const fermes = new Set(tirees.filter(d => !d.deposit).map(d => d.fromQuoteId));
    const pending = round3(quotes.filter(q => q.status !== 'refusé' && !fermes.has(q.id)).reduce((s, q) => {
      const acomptes = tirees.filter(d => d.deposit && d.fromQuoteId === q.id).reduce((a, d) => a + toBase(d, computeTotals(d, company).netHT, company), 0);
      return s + Math.max(0, toBase(q, computeTotals(q, company).netHT, company) - acomptes);
    }, 0));
    // (1.263.0) Le PRÉVU : ce que ses devis non refusés annonçaient, vendu et coûté (le coût de chaque ligne de
    // devis, ou celui de la prestation au catalogue). Sans devis, il n'y a pas de prévu : `null`, jamais zéro.
    const prevus = quotes.filter(q => q.status !== 'refusé');
    let planned = null;
    if (prevus.length) {
      let pr = 0, pc = 0, lignes = 0, chiffrees = 0;
      prevus.forEach(q => {
        const m = documentMargin(q, data, company);
        pr = round3(pr + toBase(q, m.revenue, company));
        pc = round3(pc + toBase(q, m.cost, company));
        lignes += m.lines; chiffrees += m.costed;
      });
      planned = { revenue: pr, cost: pc, margin: round3(pr - pc), rate: pr !== 0 ? Math.round((pr - pc) / pr * 1000) / 10 : null,
        complete: lignes > 0 && chiffrees === lignes, quotes: prevus.length };
    }
    const margin = round3(revenue - cost);
    return {
      revenue, cost, margin, invoiced, collected, paid, pending,
      rate: revenue !== 0 ? Math.round(margin / revenue * 1000) / 10 : null,
      cash: round3(collected - paid),          // ce que l'affaire a réellement rapporté en caisse
      // `enStockReste` : ce qui, de la marchandise achetée pour l'affaire, n'en est pas encore sorti (en valeur).
      achats, stockSorti, mainOeuvre, hours, enStock, enStockReste: round3(Math.max(0, enStock - stockSorti)), immo, planned,
      laborEstimated: heures.some(x => x.estime), laborUnknown: heures.some(x => x.inconnu),
      salesCount: sales.length, buysCount: buys.length, quotesCount: quotes.length, timeCount: heures.length,
      sales, buys, quotes, heures
    };
  }

  // (1.263.0) Le relevé d'une affaire en PDF : pour le client, le banquier, l'associé. Les chiffres sont ceux de la
  // fiche (`projectMargin`), jamais recalculés à part ; le prévu est celui de ses devis.
  function affaireHtml(data, company, projectId) {
    const co = company || {};
    const p = (data.projects || []).find(x => x.id === projectId) || {};
    const m = projectMargin(data, co, projectId);
    const dec = decimalsFor(co.currency || 'DT');
    const fmt = n => money(n, null, dec, 'fr');
    const ink = co.primaryColor || '#1b2430';
    const accent = co.accentColor || '#0f9d8f';
    const cl = (data.clients || []).find(c => c.id === p.clientId);
    const e = escapeHtml;
    const pct = r => r == null ? '—' : `${String(r).replace('.', ',')} %`;
    const ligne = (l, prevu, reel, cls) => `<tr class="${cls || ''}"><td>${l}</td><td class="n">${prevu == null ? '—' : fmt(prevu)}</td><td class="n">${fmt(reel)}</td></tr>`;
    const ventes = m.sales.map(d => {
      const t = computeTotals(d, co), s = d.type === 'avoir' ? -1 : 1;
      return `<tr><td>${e(fmtDate(d.date))}</td><td>${d.type === 'avoir' ? 'Avoir' : 'Facture'} ${e(d.number || '')}</td><td class="n">${fmt(s * toBase(d, t.netHT, co))}</td></tr>`;
    }).join('');
    const achats = m.buys.map(b => {
      const x = coutAchatPourAffaire(b, co, data, projectId);
      const sup = (data.suppliers || []).find(s => s.id === b.supplierId);
      return `<tr><td>${e(fmtDate(b.date))}</td><td>${e((sup && sup.name) || '')} ${e(b.number || '')}${partageEntreAffaires(b) ? ' <i>(en partie)</i>' : ''}</td><td class="n">${fmt(x.cout)}</td></tr>`;
    }).join('');
    const heures = m.heures.map(x => `<tr><td>${e(fmtDate(x.date))}</td><td>${e(x.employeeName)} · ${String(x.hours).replace('.', ',')} h${x.estime ? ' <i>(estimé)</i>' : ''}</td><td class="n">${fmt(x.cout)}</td></tr>`).join('');
    const bloc = (titre, corps, total) => corps ? `<h2>${titre}</h2><table><tbody>${corps}</tbody><tfoot><tr class="tot"><td colspan="2">Total</td><td class="n">${fmt(total)}</td></tr></tfoot></table>` : '';
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>Affaire ${e(p.name || '')}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: ${ink}; font-size: 9pt; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 14mm 13mm; background: #fff; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding-bottom: 8px; border-bottom: 2px solid ${accent}; }
  .co-name { font-size: 12pt; font-weight: 700; }
  .co-sub { font-size: 8pt; color: #6a7480; line-height: 1.5; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 15pt; color: ${accent}; }
  .title .per { font-size: 10pt; font-weight: 600; margin-top: 2px; }
  h2 { font-size: 10pt; margin: 16px 0 4px; color: ${accent}; text-transform: uppercase; letter-spacing: .3px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .3px; color: ${accent}; border-bottom: 1px solid ${ink}; padding: 4px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  td { padding: 4px; border-bottom: 1px solid #e6e9ee; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.tot td { border-top: 1.5px solid ${ink}; border-bottom: none; font-weight: 700; }
  tr.sous td { color: #6a7480; }
  .note { margin-top: 14px; font-size: 7.5pt; color: #6a7480; }
</style></head>
<body><div class="page">
  <div class="head">
    <div><div class="co-name">${e(co.name || '')}</div><div class="co-sub">${e(co.address || '').replace(/\n/g, '<br>')}</div></div>
    <div class="title"><h1>Affaire</h1><div class="per">${e(p.name || '')}</div><div class="co-sub">${cl ? e(cl.name) + ' · ' : ''}${e(p.status || '')}${p.startDate ? ' · depuis le ' + e(fmtDate(p.startDate)) : ''}</div></div>
  </div>
  <h2>La marge</h2>
  <table><thead><tr><th></th><th>Prévu (devis)</th><th>Réel</th></tr></thead><tbody>
    ${ligne('Vendu HT', m.planned ? m.planned.revenue : null, m.revenue)}
    ${ligne('Coût', m.planned ? m.planned.cost : null, m.cost)}
    ${ligne('dont achats', null, m.achats, 'sous')}
    ${ligne('dont marchandise sortie du stock', null, m.stockSorti, 'sous')}
    ${ligne(`dont main d'œuvre (${String(m.hours).replace('.', ',')} h)`, null, m.mainOeuvre, 'sous')}
    <tr class="tot"><td>Marge</td><td class="n">${m.planned ? fmt(m.planned.margin) + ' · ' + pct(m.planned.rate) : '—'}</td><td class="n">${fmt(m.margin)} · ${pct(m.rate)}</td></tr>
  </tbody></table>
  ${bloc('Les ventes (HT)', ventes, m.revenue)}
  ${bloc('Les achats (ce qu’ils coûtent à l’affaire)', achats, m.achats)}
  ${bloc('Les heures', heures, m.mainOeuvre)}
  <p class="note">Encaissé : ${fmt(m.collected)} · payé aux fournisseurs : ${fmt(m.paid)} · en caisse : ${fmt(m.cash)}.${m.enStockReste ? ` Acheté pour l'affaire et encore au stock : ${fmt(m.enStockReste)} (compte quand il sort).` : ''}${m.immo ? ` Matériel immobilisé, hors marge : ${fmt(m.immo)}.` : ''}${m.laborEstimated ? ' Une partie des heures est estimée sur le salaire du contrat, faute de bulletin du mois.' : ''} Montants en ${e(co.currency || 'DT')}, établis le ${e(fmtDate(today()))}.</p>
</div></body></html>`;
  }

  // (1.264.0) Où en est le chantier : les quatre étapes de son argent — devisé, facturé, encaissé, payé aux fournisseurs —
  // chacune avec ce qui reste, et la première qui n'est pas finie, qui porte le geste suivant. Tout vient des pièces de
  // l'affaire : les montants de `projectMargin` (HT pour le vendu, TTC pour ce qui se paie), les restes de chaque pièce par
  // `invoiceBalance` et `purchaseBalance` — ceux de la liste des factures et des achats, jamais recalculés à part.
  function suiviAffaire(data, company, projectId, todayIso) {
    const t = todayIso || today();
    const m = projectMargin(data, company, projectId);
    const quotes = m.quotes.filter(q => q.status !== 'refusé');
    const tirees = (data.documents || []).filter(d => d.type === 'facture' && d.fromQuoteId && d.status !== 'brouillon' && d.status !== 'annulée');
    const fermes = new Set(tirees.filter(d => !d.deposit).map(d => d.fromQuoteId));
    const ouverts = quotes.filter(q => !fermes.has(q.id)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const factures = m.sales.filter(d => d.type === 'facture');
    let aEncaisser = 0;
    factures.forEach(d => { const r = toBase(d, invoiceBalance(d, data, company).remaining, company); if (r > 0.0005) aEncaisser = round3(aEncaisser + r); });
    const ids = new Set(factures.map(d => d.id));
    const retards = overdueInvoices(data, company, t).filter(x => ids.has(x.doc.id)).sort((a, b) => b.daysLate - a.daysLate);
    const dues = [];
    let aPayer = 0;
    m.buys.forEach(b => {
      if (b.kind === 'avoir' || b.kind === 'acompte') return;
      const part = partageEntreAffaires(b) ? coutAchatPourAffaire(b, company, data, projectId).part : 1;
      const r = round3(toBase(b, purchaseBalance(b, company, data).remaining, company) * part);
      if (r > 0.0005) { aPayer = round3(aPayer + r); dues.push({ achat: b, reste: r }); }
    });
    dues.sort((a, b) => (a.achat.dueDate || a.achat.date || '').localeCompare(b.achat.dueDate || b.achat.date || ''));
    const devise = quotes.length > 0 || m.salesCount > 0;
    const facture = m.revenue > 0.0005 && m.pending <= 0.0005;
    const encaisse = m.invoiced > 0.0005 && aEncaisser <= 0.0005;
    const paye = aPayer <= 0.0005;
    const etapes = [
      { k: 'devis', fait: devise, montant: m.planned ? m.planned.revenue : 0, nb: quotes.length },
      { k: 'facture', fait: facture, partiel: m.revenue > 0.0005 && !facture, montant: m.revenue, reste: m.pending, devisOuvert: ouverts[0] || null, nb: m.salesCount },
      { k: 'encaisse', fait: encaisse, partiel: m.collected > 0.0005 && !encaisse, montant: m.collected, sur: m.invoiced, reste: aEncaisser,
        retards: retards.length, retardMax: retards.length ? retards[0].daysLate : 0, aRelancer: retards[0] ? retards[0].doc : null },
      { k: 'paye', fait: paye && m.buysCount > 0, rien: m.buysCount === 0, montant: m.paid, reste: aPayer, achatDu: dues[0] ? dues[0].achat : null, nbDus: dues.length }
    ];
    // L'étape en cours : la première qui n'est pas faite (un chantier sans achat n'a rien à payer).
    const ici = etapes.find(e => !e.fait && !(e.k === 'paye' && e.rien));
    return { etapes, ici: ici ? ici.k : null, solde: !ici && encaisse, aEncaisser, aPayer, m };
  }

  // (1.300.0, revue des Marges : un électricien et ses trois chantiers) Un chantier EN COURS se lit à l'avancement : ses
  // achats et ses heures arrivent avant ses factures, et sa marge « à ce jour » est négative alors qu'il suit son devis —
  // la liste le peignait en rouge et la fiche disait « Cette affaire perd de l'argent » à mi-chantier. L'avancement est le
  // coût engagé rapporté au coût prévu de ses devis (au plus 100 %) ; les travaux faits valent ce pourcentage du vendu
  // prévu, et ce qui en dépasse le facturé reste à facturer (négatif : facturé d'avance). La marge attendue est le vendu
  // prévu moins le plus grand du coût prévu et du coût déjà engagé : elle n'est négative que si le chantier va vraiment
  // perdre de l'argent. Sans devis chiffré (aucun coût prévu), rien ne se calcule : null, jamais un pourcentage inventé.
  // À VÉRIFIER avec le comptable : c'est la méthode à l'avancement (NC 9, contrats de construction) ; il peut en retenir
  // une autre.
  function avancementAffaire(m) {
    const pr = m && m.planned;
    if (!pr || !(pr.cost > 0)) return null;
    const avancement = Math.min(1, m.cost / pr.cost);
    const faits = round3(avancement * pr.revenue);
    const attendue = round3(pr.revenue - Math.max(pr.cost, m.cost));
    return { avancement, pourcent: Math.round(avancement * 1000) / 10, faits, ecart: round3(faits - m.revenue), attendue,
      taux: pr.revenue ? Math.round(attendue / pr.revenue * 1000) / 10 : null, prevuVendu: pr.revenue, prevuCout: pr.cost };
  }

  function projectList(data, company) {
    return (data.projects || []).map(p => {
      const m = projectMargin(data, company, p.id);
      return { ...p, ...m, av: p.status === 'en cours' ? avancementAffaire(m) : null };
    }).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  }

  // ---------- l'état des chantiers à une date (1.300.0) ----------
  // Ce que le comptable demande à la clôture pour chaque chantier qui n'est pas fini : ce qu'il a coûté jusque-là, ce qui
  // en a été facturé, et où il en est (À VÉRIFIER avec lui : la méthode et les comptes). Les chiffres sont ceux de la fiche
  // de l'affaire (`projectMargin`, `avancementAffaire`), calculés sur les seules pièces datées au plus tard ce jour : une
  // facture de janvier ne compte pas dans l'état au 31 décembre, ni les achats ou les heures d'après.
  function piecesAu(data, au) {
    const avant = x => !(x && x.date) || x.date <= au;
    return { ...data, documents: (data.documents || []).filter(avant), purchases: (data.purchases || []).filter(avant),
      projectTime: (data.projectTime || []).filter(avant), stockAdjustments: (data.stockAdjustments || []).filter(avant) };
  }
  // Chaque affaire commencée au plus tard ce jour, pas annulée, qui a une pièce ou une heure avant la date. Elle est finie à
  // la date si elle est « terminée » et que sa fin (quand elle est dite) n'est pas après ; sinon elle est en cours, et la
  // perte attendue à la fin (la marge attendue quand elle est négative) se provisionne (À VÉRIFIER).
  function etatDesChantiers(data, company, au) {
    const vue = piecesAu(data, au);
    const chantiers = [];
    (data.projects || []).forEach(p => {
      if (p.status === 'annulée' || (p.startDate && p.startDate > au)) return;
      const m = projectMargin(vue, company, p.id);
      if (!m.salesCount && !m.buysCount && !m.timeCount && !m.stockSorti) return;
      const fini = p.status === 'terminée' && (!p.endDate || p.endDate <= au);
      const av = fini ? null : avancementAffaire(m);
      chantiers.push({ id: p.id, name: p.name || '', clientId: p.clientId || '', fini, endDate: p.endDate || '',
        vendu: m.revenue, cout: m.cost, marge: m.margin, av, perte: av ? round3(Math.min(0, av.attendue)) : 0, laborEstimated: m.laborEstimated });
    });
    chantiers.sort((a, b) => Number(a.fini) - Number(b.fini) || a.name.localeCompare(b.name, 'fr'));
    const enCours = chantiers.filter(c => !c.fini);
    const somme = f => round3(enCours.reduce((s, c) => s + f(c), 0));
    return { au, chantiers, enCours: enCours.length, finis: chantiers.length - enCours.length,
      resteAFacturer: somme(c => (c.av && c.av.ecart > 0 ? c.av.ecart : 0)), factureDAvance: somme(c => (c.av && c.av.ecart < 0 ? -c.av.ecart : 0)),
      pertes: somme(c => c.perte), sansDevis: enCours.filter(c => !c.av).length };
  }

  // Les pièces d'un contrat récurrent (10.14.1). Une facture générée porte `recurringId` ; l'avoir
  // qui la corrige, non (`creditDraftFrom` ne le recopie pas) : il se retrouve par la facture qu'il
  // vise. Sans lui, la fiche du contrat disait « facturé, avoirs déduits » sans en déduire aucun.
  function piecesDuContrat(data, recurringId) {
    const docs = (data && data.documents) || [];
    const factures = docs.filter(d => d.type === 'facture' && d.recurringId === recurringId);
    const ids = new Set(factures.map(d => d.id));
    const avoirs = docs.filter(d => d.type === 'avoir' && d.creditOf && ids.has(d.creditOf) && d.status !== 'brouillon');
    return { factures, avoirs };
  }
  // Ce que la fiche d'un contrat annonce (10.14.1). Elle soustrayait un encaissé TTC (paiements ET
  // avoirs, au taux de la pièce) d'un facturé HT : une facture de 1 000 HT payée en entier laissait
  // « − 191 restant ». Trois chiffres, chacun dans SON unité, et aucun ne se déduit des autres :
  //   - facturé : le hors taxes des factures émises, avoirs déduits (en devise de la société) ;
  //   - encaissé : ce qui est arrivé à la banque, comme la Trésorerie le lit (`montantRegle`, taux du
  //     jour du règlement), remboursements déduits ;
  //   - restant : le reste dû de chaque facture (TTC, avoirs et retenue déduits), au taux de la pièce ;
  //     un trop-perçu se compte à part, il ne se retranche pas du reste d'une autre facture.
  function contratSuivi(data, company, recurringId) {
    const { factures, avoirs } = piecesDuContrat(data, recurringId);
    const emises = factures.filter(d => d.status !== 'brouillon' && d.status !== 'annulée');
    const ht = d => toBase(d, computeTotals(d, company).netHT, company);
    const facture = round3(emises.reduce((s, d) => s + ht(d), 0) - avoirs.reduce((s, a) => s + ht(a), 0));
    const encaisse = round3(emises.reduce((s, d) => s + (d.payments || []).reduce((t, p) => t + montantRegle(d, p, company), 0), 0));
    let restant = 0, tropPercu = 0;
    emises.forEach(d => {
      const r = toBase(d, invoiceBalance(d, data, company).remaining, company);
      if (r > 0) restant += r; else tropPercu -= r;
    });
    return {
      facture, encaisse, restant: round3(restant), tropPercu: round3(tropPercu),
      emises: emises.length, brouillons: factures.filter(d => d.status === 'brouillon').length, avoirs: avoirs.length
    };
  }

  // Rentabilité d'un contrat récurrent : ce qu'il a rapporté depuis le début, contre ce qu'il a coûté.
  // Les avoirs sur ses factures s'en retranchent (10.14.1) — `documentMargin` les compte en négatif.
  function recurringProfitability(data, company, recurringId) {
    const rec = (data.recurring || []).find(r => r.id === recurringId);
    const invoices = (data.documents || []).filter(d => d.recurringId === recurringId
      && d.status !== 'brouillon' && d.status !== 'annulée');
    let revenue = 0, cost = 0;
    piecesDuContrat(data, recurringId).avoirs.forEach(a => {
      const m = documentMargin(a, data, company);
      revenue = round3(revenue + toBase(a, m.revenue, company));
      cost = round3(cost + toBase(a, m.cost, company));
    });
    invoices.forEach(d => {
      const m = documentMargin(d, data, company);
      revenue = round3(revenue + toBase(d, m.revenue, company));
      cost = round3(cost + toBase(d, m.cost, company));
    });
    // Les achats rattachés au même client ET à la même affaire, s'il y en a une.
    const linked = (data.purchases || []).filter(p => rec && p.projectId && p.projectId === rec.projectId);
    linked.forEach(p => { cost = round3(cost + coutAchat(purchaseTotals(p, company))); });
    const margin = round3(revenue - cost);
    const dates = invoices.map(d => d.date).filter(Boolean).sort();
    const months = dates.length ? Math.max(1, Math.round(daysBetween(dates[0], dates[dates.length - 1]) / 30) + 1) : 0;
    return {
      revenue, cost, margin, rate: revenue !== 0 ? Math.round(margin / revenue * 1000) / 10 : null,
      count: invoices.length, months, perMonth: months ? round3(margin / months) : 0, first: dates[0] || '', last: dates[dates.length - 1] || ''
    };
  }

  // ---------- charges fixes et seuil de rentabilité ----------
  // Une charge fixe tombe que tu vendes ou non : loyer, assurance, abonnement, salaires.
  // Une charge variable suit les ventes : marchandises, sous-traitance, carburant.
  // Le classement est modifiable — À VÉRIFIER avec ton comptable, il dépend de ton activité.
  const DEFAULT_FIXED_CATEGORIES = [
    'Loyer et charges locatives', 'Assurances', 'Téléphone et internet', 'Honoraires (comptable, avocat)',
    'Frais bancaires', 'Électricité, eau, gaz', 'Formation'
  ];
  function isFixedCategory(data, category) {
    const custom = (data && data.fixedCategories);
    const list = Array.isArray(custom) && custom.length ? custom : DEFAULT_FIXED_CATEGORIES;
    return list.includes(category);
  }

  // Seuil de rentabilité : le chiffre d'affaires minimum pour couvrir les charges fixes.
  // Formule : charges fixes ÷ taux de marge sur coûts variables. Si le taux est nul ou négatif,
  // aucun volume ne suffit — et c'est une information, pas une erreur.
  // Le seuil se construit sur les MÊMES morceaux que le résultat simplifié (10.14.0), et son
  // « Résultat » est celui de l'onglet TVA : deux résultats pour la même année, c'est un de trop.
  // Avant, il comptait ses propres mouvements — une échéance d'emprunt ENTIÈRE en charge fixe (son
  // capital est un remboursement de dette, pas une charge), un salaire payé par un mouvement ET le
  // bulletin du même salaire — et oubliait les écritures diverses, les intérêts passés au 651 et la
  // marchandise d'un article non suivi. Chaque morceau est rangé fixe ou variable ; la cession d'un
  // bien (sa valeur au 675, son prix au 775) n'est ni l'un ni l'autre : elle ne se répète pas, elle
  // entre dans le résultat sans déplacer le seuil.
  function breakEven(data, company, period) {
    const r = simpleResult(data, company, period);
    const revenue = r.produits;
    let fixedAchats = 0, variableAchats = 0;
    (data.purchases || []).filter(p => inPeriod(p.date, period && period.from, period && period.to)).forEach(p => {
      const t = purchaseTotals(p, company);
      // Le stock et les immobilisations ne sont pas des charges de la période.
      const charge = round3(t.base.cout.charge + t.base.fees);
      if (isFixedCategory(data, p.category)) fixedAchats = round3(fixedAchats + charge);
      else variableAchats = round3(variableAchats + charge);
    });
    const acc = chartAccounts(data);
    const exceptionnel = round3(journalEntries(data, company, period, { sections: ['tresorerie', 'od', 'amortissements'] })
      .filter(e => e.account === acc.vncCedee || e.account === acc.produitsCession)
      .reduce((s, e) => s + e.debit - e.credit, 0));
    // Frais bancaires, salaires payés sans bulletin, intérêts, écritures diverses : ils tombent que tu
    // vendes ou non.
    const autres = round3(r.autres - exceptionnel);
    // Le coût des marchandises vendues est LA charge variable par excellence : pas de vente, pas de
    // coût. La marchandise d'un article non suivi aussi.
    const cogs = r.cogs;
    const variable = round3(variableAchats + r.horsSuivi + cogs);
    // La dotation est une charge fixe (3.5.0), les salaires aussi — et ce sont les plus lourds.
    const depreciation = r.depreciation, payroll = r.payroll;
    const fixed = round3(fixedAchats + depreciation + payroll + autres);
    const marginOnVariable = round3(revenue - variable);
    const rate = revenue > 0 ? marginOnVariable / revenue : 0;
    const point = rate > 0 ? round3(fixed / rate) : null;
    return {
      revenue, fixed, variable, cogs, depreciation, payroll, autres, exceptionnel, change: r.change, marginOnVariable,
      rate: revenue > 0 ? Math.round(rate * 1000) / 10 : null,
      breakEven: point,
      // Là où tu en es par rapport au seuil : négatif = il manque du chiffre d'affaires.
      gap: point == null ? null : round3(revenue - point),
      // L'écart de change (10.14.0) ne tombe ni avec les ventes ni avec le temps : il vient après,
      // comme une plus-value de cession.
      result: round3(marginOnVariable - fixed - exceptionnel + r.change),
      reached: point != null && revenue >= point
    };
  }

  // (1.263.0) L'année MOIS PAR MOIS : pour chaque mois, le chiffre d'affaires, la marge sur coûts variables, les
  // charges fixes et le résultat, par la MÊME fonction que le seuil de l'année (`breakEven` sur le mois). La somme des
  // douze résultats est le résultat de l'année (deux chemins, un chiffre : test « marges 1.263 ») ; `ecart` le dit si
  // un jour ce n'était plus vrai. « Rentable depuis » : le mois où le cumul des résultats repasse au-dessus de zéro
  // pour ne plus redescendre, sur les mois déjà commencés.
  function margeMoisParMois(data, company, year, todayIso) {
    const y = Number(year), t = todayIso || today();
    const pad = n => String(n).padStart(2, '0');
    const annee = breakEven(data, company, { from: `${y}-01-01`, to: `${y}-12-31` });
    let cumul = 0;
    const mois = [];
    for (let m = 1; m <= 12; m++) {
      const from = `${y}-${pad(m)}-01`, to = addDays(from, daysInMonth(y, m) - 1);
      const b = breakEven(data, company, { from, to });
      cumul = round3(cumul + b.result);
      mois.push({ mois: m, from, to, label: MONTHS_FR[m - 1], commence: from <= t,
        revenue: b.revenue, marginOnVariable: b.marginOnVariable, fixed: round3(b.fixed + b.exceptionnel - b.change), result: b.result, cumul });
    }
    const commences = mois.filter(x => x.commence);
    let depuis = null;
    if (commences.length && commences[commences.length - 1].cumul >= 0) {
      for (let i = commences.length - 1; i >= 0; i--) {
        if (commences[i].cumul < 0) break;
        depuis = commences[i];
      }
    }
    const somme = round3(mois.reduce((s, x) => s + x.result, 0));
    return { mois, annee, depuis, ecart: round3(somme - annee.result), dernierCumul: commences.length ? commences[commences.length - 1].cumul : 0 };
  }

  // ---------- stock (4.0.0) ----------
  // Aucune saisie en double, comme pour la trésorerie : les mouvements de stock sont DÉDUITS de ce qui
  // existe déjà. Une ligne d'achat en destination « stock » fait une entrée ; une ligne de facture ou de
  // bon de livraison fait une sortie. On n'ajoute à la main que ce qui n'existe nulle part ailleurs :
  // le stock de départ, et les ajustements (casse, perte, inventaire).
  //
  // Valorisation au COÛT MOYEN PONDÉRÉ : à chaque entrée, le coût unitaire moyen est recalculé sur
  // l'ensemble du stock. C'est la méthode la plus simple à tenir et la plus courante.
  // À VÉRIFIER avec le comptable : la méthode de valorisation retenue pour tes comptes annuels.

  const MOVE_SOURCES = [
    ['achat', 'Achat'], ['reception', 'Réception'], ['transfert', 'Transfert entre dépôts'], ['vente', 'Vente'], ['livraison', 'Bon de livraison'],
    ['avoir', 'Retour sur avoir'], ['depart', 'Stock de départ'],
    ['inventaire', 'Inventaire'], ['casse', 'Casse ou perte'],
    ['consommation', 'Matière utilisée'], ['ajustement', 'Ajustement']
  ];
  // 10.12.0 — une casse ou de la matière utilisée ne peut que SORTIR du stock. Jusque-là la quantité
  // se tapait signée (« -2 pour une sortie ») : un menuisier qui notait les 10 planches posées sur un
  // chantier tapait « 10 », et son stock GAGNAIT 10 planches, valorisées, sans un mot. Pour ces deux
  // natures on saisit la quantité sortie, toujours positive, et c'est cette fonction qui la signe ;
  // l'inventaire et l'ajustement restent signés, parce qu'ils vont dans les deux sens.
  const SOURCES_SORTIE = ['casse', 'consommation'];
  function qteMouvement(source, saisie) {
    const q = Number(saisie) || 0;
    if (!q) return 0;
    return SOURCES_SORTIE.includes(source) ? -Math.abs(q) : q;
  }
  // Les seuls mouvements qui ne sont PAS une charge de la période : l'achat (c'est de l'argent devenu
  // stock) et le stock de départ (ce qu'on avait avant de commencer à compter).
  const SOURCES_HORS_CHARGE = ['achat', 'reception', 'depart'];
  const moveSourceLabel = k => (MOVE_SOURCES.find(m => m[0] === k) || [, k])[1];

  // Les articles du catalogue suivis en stock.
  function trackedItems(data) {
    return (data.catalog || []).filter(c => c.tracked);
  }

  // Retrouver l'article d'une ligne : par identifiant si la ligne en porte un (lignes posées depuis le
  // catalogue), sinon par libellé — même règle que `lineCost`, pour que l'historique reste lisible.
  function itemOfLine(line, data) {
    if (lot) {
      const idx = duLot(data, 'catalogue', () => {
        const parId = new Map(), parLibelle = new Map();
        (data.catalog || []).forEach(c => {
          if (!parId.has(c.id)) parId.set(c.id, c);
          const l = (c.label || '').trim().toLowerCase();
          if (!parLibelle.has(l)) parLibelle.set(l, c);
        });
        return { parId, parLibelle };
      });
      if (line.itemId && idx.parId.has(line.itemId)) return idx.parId.get(line.itemId);
      const label = (line.label || '').trim().toLowerCase();
      return label ? idx.parLibelle.get(label) || null : null;
    }
    if (line.itemId) {
      const byId = (data.catalog || []).find(c => c.id === line.itemId);
      if (byId) return byId;
    }
    const label = (line.label || '').trim().toLowerCase();
    if (!label) return null;
    return (data.catalog || []).find(c => (c.label || '').trim().toLowerCase() === label) || null;
  }

  // Tous les mouvements d'un article, dans l'ordre chronologique, déduits des pièces existantes.
  // `itemId` restreint à un article ; sans lui, tout le stock.
  function stockMovements(data, itemId, toIso) {
    // Dans un lot, les mouvements de TOUS les articles se calculent une fois, puis se rangent par
    // article : l'ordre d'un article est la sous-suite de l'ordre total (le tri est un ordre total).
    if (lot && itemId) {
      const parArticle = duLot(data, 'stock@' + (toIso || ''), () => {
        const m = new Map();
        stockMovements(data, null, toIso).forEach(x => {
          if (!m.has(x.itemId)) m.set(x.itemId, []);
          m.get(x.itemId).push(x);
        });
        return m;
      });
      return (parArticle.get(itemId) || []).map(x => ({ ...x }));
    }
    const out = [];
    const keep = c => c && c.tracked && (!itemId || c.id === itemId);
    const limit = toIso || null;

    (data.catalog || []).forEach(c => {
      if (!keep(c)) return;
      const qty = Number(c.initialQty) || 0;
      if (!qty) return;
      const date = c.initialDate || '1970-01-01';
      if (limit && date > limit) return;
      out.push({ id: `init-${c.id}`, date, itemId: c.id, label: c.label, qty, unitCost: Number(c.initialCost) || 0,
        source: 'depart', ref: '', docId: '', note: '', rang: 0, ts: 0 });
    });

    (data.purchases || []).forEach(p => {
      // Un acompte versé n'est pas de la marchandise : c'est de l'argent posé d'avance (10.2.0).
      // Un avoir fournisseur, si : la marchandise RESSORT du stock, elle retourne chez lui.
      if (p.kind === 'acompte') return;
      const sens = p.kind === 'avoir' ? -1 : 1;
      (p.lines || []).forEach((l, i) => {
        if (l.destination !== 'stock') return;
        // Une ligne saisie depuis une réception (brique 87) : la marchandise est entrée par la réception.
        if (l.recue) return;
        const c = itemOfLine(l, data);
        if (!keep(c)) return;
        if (limit && p.date > limit) return;
        const qty = sens * (Number(l.qty) || 0);
        if (!qty) return;
        // Le coût d'entrée est en DEVISE DE BASE (10.1.0) : le coût moyen pondéré mélange des
        // entrées de plusieurs achats, et le stock se valorise au bilan en dinars. Un composant
        // payé 120 € entrait à 120 DT, donc la valeur du stock, le coût des ventes et la marge
        // étaient faux ensemble et dans le même sens.
        out.push({ id: `buy-${p.id}-${i}`, date: p.date, itemId: c.id, label: c.label, qty,
          // TVA non déductible comprise : c'est ce que la marchandise a coûté, et ce que l'écriture
          // porte au 607 (10.14.0).
          unitCost: toBase(p, (Number(l.unitPrice) || 0) * (tvaNonDeductible(l, p, data.company) ? 1 + (Number(l.vatRate) || 0) / 100 : 1), data.company || {}),
          source: 'achat', ref: p.number || '', docId: p.id, note: '', rang: 1, ts: Number(p.createdAt) || 0 });
      });
    });

    // Entrées : les réceptions VALIDÉES d'une commande fournisseur (brique 87), au prix de la commande,
    // ramené dans la devise de l'entreprise. Une réception en brouillon n'a rien reçu.
    (data.receptions || []).forEach(r => {
      if (r.status !== 'validée') return;
      if (limit && r.date > limit) return;
      (r.lines || []).forEach((l, i) => {
        const c = itemOfLine(l, data);
        if (!keep(c)) return;
        const qty = Number(l.qty) || 0;
        if (!qty) return;
        out.push({ id: `rec-${r.id}-${i}`, date: r.date, itemId: c.id, label: c.label, qty,
          unitCost: toBase(r, Number(l.unitPrice) || 0, data.company || {}),
          source: 'reception', ref: r.number || '', docId: r.id, note: '', rang: 1, ts: Number(r.validatedTs || r.createdAt) || 0 });
      });
    });

    // Sorties : factures émises et bons de livraison. Un devis, une proforma ou un bon de commande ne
    // sortent rien — rien n'a encore quitté l'entrepôt.
    (data.documents || []).forEach(d => {
      const isSale = d.type === 'facture' && d.status !== 'brouillon' && d.status !== 'annulée';
      const isDelivery = d.type === 'livraison' && d.status !== 'brouillon';
      const isReturn = d.type === 'avoir' && d.status !== 'brouillon';
      if (!isSale && !isDelivery && !isReturn) return;
      if (limit && d.date > limit) return;
      // Une facture tirée d'un bon de livraison sortirait le stock une seconde fois : c'est le bon de
      // livraison qui fait foi, la facture ne fait que le suivre. (1.316.0) Ligne par ligne (`sortieAuBon`) : une ligne
      // ajoutée sur cette facture sort le stock comme toute vente.
      (d.lines || []).forEach((l, i) => {
        if (l.noDiscount) return;              // ligne d'acompte ou de déduction : aucune marchandise
        if (isSale && sortieAuBon(d, l)) return;
        // Un kit (brique 96) : ce sont ses composants qui sortent (ou rentrent, sur un avoir), chacun à sa
        // quantité par kit ; la ligne d'un article ordinaire est son propre et unique composant.
        const art = itemOfLine(l, data);
        const parts = estKit(art) ? composantsDe(data, art).map(k => ({ c: k.item, par: k.qty, kit: art.label })) : [{ c: art, par: 1, kit: '' }];
        parts.forEach(({ c, par, kit }, j) => {
          if (!keep(c)) return;
          const qty = par === 1 ? Number(l.qty) || 0 : round3((Number(l.qty) || 0) * par);
          if (!qty) return;
          out.push({ id: kit ? `doc-${d.id}-${i}-${j}` : `doc-${d.id}-${i}`, date: d.date, itemId: c.id, label: c.label,
            qty: isReturn ? qty : -qty, unitCost: null,
            source: isReturn ? 'avoir' : (isDelivery ? 'livraison' : 'vente'),
            ref: d.number || '', docId: d.id, note: kit ? `kit « ${kit} »` : '', rang: 1,
            // La marchandise sort à l'ÉMISSION : c'est l'instant qui compte, pas celui du brouillon.
            ts: Number(d.issuedTs || d.createdAt) || 0 });
        });
      });
    });

    (data.stockAdjustments || []).forEach(a => {
      const c = (data.catalog || []).find(x => x.id === a.itemId);
      if (!keep(c)) return;
      if (limit && a.date > limit) return;
      out.push({ id: a.id, date: a.date, itemId: a.itemId, label: c.label, qty: Number(a.qty) || 0,
        unitCost: a.unitCost === '' || a.unitCost == null ? null : Number(a.unitCost),
        source: a.source || 'ajustement', ref: a.reference || '', docId: '', note: a.note || '', manual: true,
        rang: a.source === 'depart' ? 0 : 1, ts: Number(a.createdAt) || 0 });
    });

    // Le dépôt de chaque mouvement (plateforme, brique 94) : celui de sa pièce, de sa réception ou de son
    // ajustement ; le stock de départ, celui de l'article ; sinon le dépôt principal.
    const depotDe = new Map();
    [data.purchases, data.receptions, data.documents, data.stockAdjustments].forEach(l => (l || []).forEach(x => { if (x && x.id && x.depotId) depotDe.set(x.id, x.depotId); }));
    out.forEach(m => {
      const art = m.source === 'depart' && !m.manual ? (data.catalog || []).find(c => c.id === m.itemId) : null;
      m.depotId = (art ? art.depotInitial : depotDe.get(m.docId || m.id)) || DEPOT_PRINCIPAL;
    });

    // L'ORDRE d'une même journée (rapport QA E-10). Les mouvements du même jour se triaient par
    // IDENTIFIANT — « buy- » < « doc- » < « init- » — donc Achat → Vente → Stock de départ : un stock de
    // départ de 5 à 700, une vente de 2 puis un achat de 3 à 800, saisis dans cet ordre, sortaient la
    // vente au coût de l'achat qui la SUIT (800) et valorisaient le stock à 4 300 au lieu de 4 500.
    // Le coût moyen pondéré dépend de l'ordre des gestes : le stock de départ passe toujours en tête
    // de son jour, puis chaque mouvement à l'instant où il a eu lieu (création d'un achat ou d'un
    // mouvement, émission d'une facture). Sans instant connu (données anciennes), les entrées passent
    // avant les sorties : une sortie ne se valorise pas sur une marchandise qui n'est pas encore là.
    // (Le lot de chaque mouvement, plateforme brique 97 : celui de sa ligne ; la péremption, celle que
    // l'entrée du lot a dite.)
    if ((data.catalog || []).some(c => c.parLot)) {
      const lotDe = new Map();
      (data.purchases || []).forEach(p => (p.lines || []).forEach((l, i) => { if (l.lot) lotDe.set(`buy-${p.id}-${i}`, l); }));
      (data.receptions || []).forEach(r => (r.lines || []).forEach((l, i) => { if (l.lot) lotDe.set(`rec-${r.id}-${i}`, l); }));
      (data.documents || []).forEach(d => (d.lines || []).forEach((l, i) => { if (l.lot) lotDe.set(`doc-${d.id}-${i}`, l); }));
      (data.stockAdjustments || []).forEach(a => { if (a.lot) lotDe.set(a.id, a); });
      (data.catalog || []).forEach(c => { if (c.initialLot) lotDe.set(`init-${c.id}`, { lot: c.initialLot, peremption: c.initialPeremption }); });
      const peremptionDe = new Map();
      out.forEach(m => {
        const l = lotDe.get(m.id);
        m.lot = l ? String(l.lot).trim() : '';
        if (m.lot && m.qty > 0 && l.peremption) peremptionDe.set(`${m.itemId}|${m.lot}`, String(l.peremption));
      });
      out.forEach(m => {
        m.peremption = m.lot ? peremptionDe.get(`${m.itemId}|${m.lot}`) || '' : '';
        if (m.lot) m.note = [m.note, `lot ${m.lot}`].filter(Boolean).join(' · ');
      });
    }
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || '')
      || (a.rang - b.rang) || (a.ts - b.ts) || ((b.qty > 0) - (a.qty > 0)) || String(a.id).localeCompare(String(b.id)));
  }

  // ---------- les dépôts (plateforme, brique 94 ; 14 § 3.2) ----------
  const DEPOT_PRINCIPAL = 'principal';
  function depotsDe(data) {
    return [{ id: DEPOT_PRINCIPAL, nom: String((data && data.depotPrincipalNom) || '').trim() || 'Dépôt principal' },
      ...((data && data.depots) || []).filter(d => d && d.id && d.id !== DEPOT_PRINCIPAL)];
  }
  function nomDepot(data, id) { return (depotsDe(data).find(d => d.id === (id || DEPOT_PRINCIPAL)) || { nom: 'Dépôt inconnu' }).nom; }
  // Ce qu'il y a d'un article dans chaque dépôt, à une date : la somme de ses mouvements, dépôt par dépôt.
  function stockParDepot(data, itemId, toIso) {
    const q = new Map(depotsDe(data).map(d => [d.id, 0]));
    stockMovements(data, itemId, toIso).forEach(m => q.set(m.depotId, round3((q.get(m.depotId) || 0) + (Number(m.qty) || 0))));
    return depotsDe(data).map(d => ({ depotId: d.id, nom: d.nom, qty: q.get(d.id) || 0 }))
      .concat([...q.keys()].filter(k => !depotsDe(data).some(d => d.id === k)).map(k => ({ depotId: k, nom: 'Dépôt inconnu', qty: q.get(k) })));
  }
  // Un transfert : deux ajustements, la sortie d'un dépôt et l'entrée dans l'autre, sans coût imposé (la quantité
  // totale et le coût moyen ne bougent pas). On ne transfère pas ce que le dépôt n'a pas : { erreur } le dit.
  function transfertStock(data, t) {
    const qty = round3(Number(t && t.qty) || 0);
    if (!(qty > 0)) return { erreur: 'Saisis la quantité à transférer.' };
    if (!t.de || !t.vers || t.de === t.vers) return { erreur: 'Choisis deux dépôts différents : celui d\'où la marchandise part, et celui où elle arrive.' };
    const dispo = (stockParDepot(data, t.itemId, t.date).find(x => x.depotId === t.de) || { qty: 0 }).qty;
    if (qty > dispo + 0.0005) return { erreur: `${nomDepot(data, t.de)} n'en a que ${String(dispo).replace('.', ',')} le ${fmtDate(t.date)} : on ne transfère pas ce qui n'y est pas.` };
    const commun = { date: t.date, itemId: t.itemId, unitCost: '', source: 'transfert', reference: '', createdAt: t.createdAt || Date.now(), transfertId: t.id };
    return { ajustements: [
      { ...commun, id: `${t.id}-sortie`, qty: -qty, depotId: t.de, note: `vers ${nomDepot(data, t.vers)}${t.note ? ' · ' + t.note : ''}` },
      // L'entrée passe un instant APRÈS la sortie : sinon l'historique montrerait un stock total gonflé.
      { ...commun, id: `${t.id}-entree`, qty, depotId: t.vers, createdAt: commun.createdAt + 1, note: `depuis ${nomDepot(data, t.de)}${t.note ? ' · ' + t.note : ''}` },
    ] };
  }

  // Déroule les mouvements d'un article et tient le coût moyen pondéré à jour.
  // Une sortie sort au CMP du moment ; une entrée le recalcule.
  function runningStock(moves) {
    let qty = 0, value = 0, cmp = 0;
    const rows = moves.map(m => {
      const q = Number(m.qty) || 0;
      // Le coût qui a SERVI à valoriser le mouvement (10.14.0) : il se lit sur la ligne, et c'est lui
      // qu'on retranche. Pris APRÈS la mise à jour, un retour client affichait le nouveau coût moyen
      // et non celui auquel il était rentré.
      const unit = m.unitCost == null ? cmp : Number(m.unitCost) || 0;
      if (q > 0) {
        // Une entrée sans coût connu (retour sur avoir, ajustement) rentre au CMP courant.
        const avant = qty;
        qty = round3(qty + q);
        if (avant >= 0) {
          value = round3(value + q * unit);
          cmp = qty > 0 ? round3(value / qty) : 0;
        } else if (qty > 0) {
          // L'entrée comble d'abord un manque (10.14.0) : les pièces vendues sans avoir été achetées
          // sont sorties, et ce qui RESTE vaut le prix de cette entrée. Ajoutée à la valeur négative
          // du manque, elle laissait 100 DT de stock pour zéro pièce, ou gonflait le coût moyen.
          value = round3(qty * unit);
          cmp = unit;
        } else {
          // Toujours en manque : valorisé au dernier coût connu, et rien du tout à zéro.
          value = qty < 0 ? round3(qty * (cmp || unit)) : 0;
        }
      } else {
        qty = round3(qty + q);
        value = round3(value + q * unit);
        // Un stock retombé à zéro (ou négatif) ne garde aucune valeur : sinon le CMP dérive.
        if (qty <= 0) { value = qty < 0 ? round3(qty * cmp) : 0; }
      }
      return { ...m, unitApplied: unit, qtyAfter: qty, valueAfter: value, cmpAfter: cmp };
    });
    return { rows, qty, value, cmp };
  }

  // ---------- les lots (plateforme, brique 97) ----------
  // Le stock d'un article lot par lot, à une date : les lots qui périment le plus tôt d'abord, « sans lot » à la fin.
  function stockParLot(data, itemId, toIso) {
    const q = new Map();
    stockMovements(data, itemId, toIso).forEach(m => {
      const k = m.lot || '';
      const x = q.get(k) || { lot: k, peremption: '', qty: 0 };
      x.qty = round3(x.qty + (Number(m.qty) || 0));
      if (m.peremption && !x.peremption) x.peremption = m.peremption;
      q.set(k, x);
    });
    return [...q.values()].filter(x => x.qty !== 0)
      .sort((a, b) => (!a.lot) - (!b.lot) || (a.peremption || '9999').localeCompare(b.peremption || '9999') || a.lot.localeCompare(b.lot));
  }
  // Le lot à vendre d'abord : celui qui périme le plus tôt sans être périmé (et qui en a).
  function lotConseille(data, itemId, todayIso) {
    const t = todayIso || today();
    return stockParLot(data, itemId, t).find(x => x.lot && x.qty > 0 && (!x.peremption || x.peremption >= t)) || null;
  }
  // Les lots encore en stock qui périment dans `jours` jours (ou le sont déjà).
  function lotsAPerimer(data, todayIso, jours) {
    const t = todayIso || today(), limite = addDays(t, jours == null ? 30 : jours);
    return (data.catalog || []).filter(c => c.tracked && c.parLot).flatMap(c => stockParLot(data, c.id, t)
      .filter(x => x.lot && x.qty > 0 && x.peremption && x.peremption <= limite)
      .map(x => ({ itemId: c.id, label: c.label, unit: c.unit || '', lot: x.lot, peremption: x.peremption, qty: x.qty, perime: x.peremption < t })))
      .sort((a, b) => a.peremption.localeCompare(b.peremption));
  }
  // Ce qu'une pièce de vente doit dire de ses lots avant d'être émise : une ligne sans lot, un lot périmé à la
  // date de la pièce, un lot qui n'en a pas assez.
  function lotsDeLaPiece(doc, data) {
    const out = [];
    (doc.lines || []).forEach(l => {
      if (l.noDiscount) return;
      const c = itemOfLine(l, data);
      const qty = Number(l.qty) || 0;
      if (!c || !c.tracked || !c.parLot || qty <= 0) return;
      if (!l.lot) { out.push({ genre: 'sans', label: c.label, conseil: lotConseille(data, c.id, doc.date) }); return; }
      const x = stockParLot(data, c.id).find(y => y.lot === l.lot) || { qty: 0, peremption: '' };
      if (x.peremption && doc.date && x.peremption < doc.date) out.push({ genre: 'perime', label: c.label, lot: l.lot, peremption: x.peremption });
      if (doc.type !== 'avoir' && x.qty < qty) out.push({ genre: 'court', label: c.label, lot: l.lot, have: x.qty, need: qty });
    });
    return out;
  }

  // L'état d'un article à une date : quantité, valeur, coût moyen, et le signal qui compte — le négatif.
  function stockOf(data, itemId, toIso) {
    const item = (data.catalog || []).find(c => c.id === itemId) || {};
    const r = runningStock(stockMovements(data, itemId, toIso));
    const min = Number(item.minStock) || 0;
    return {
      itemId, label: item.label || '', unit: item.unit || '', location: item.location || '',
      qty: r.qty, value: r.value, cmp: r.cmp, minStock: min, moves: r.rows,
      negative: r.qty < 0,                       // on a vendu ce qu'on n'avait pas : erreur de saisie ou oubli d'achat
      low: r.qty >= 0 && min > 0 && r.qty <= min,
      unitPrice: Number(item.unitPrice) || 0
    };
  }

  function stockList(data, toIso) {
    return trackedItems(data).map(c => stockOf(data, c.id, toIso))
      .sort((a, b) => (a.label || '').localeCompare(b.label || '', 'fr'));
  }

  function stockTotals(data, toIso) {
    const rows = stockList(data, toIso);
    return {
      count: rows.length,
      value: round3(rows.reduce((s, r) => s + Math.max(0, r.value), 0)),
      low: rows.filter(r => r.low).length,
      negative: rows.filter(r => r.negative).length,
      rows
    };
  }

  // Le journal des mouvements, tous articles confondus, avec le stock de l'article après chaque ligne.
  function stockJournal(data, period) {
    const byItem = {};
    trackedItems(data).forEach(c => { byItem[c.id] = runningStock(stockMovements(data, c.id)).rows; });
    const all = [];
    // (plateforme, lot débutant) À date égale, l'ordre du calcul (celui de « Stock après ») : un tri par identifiant
    // rangeait le stock de départ au-dessus des ventes, et la colonne lisait 10, 18, 16, 20, 15.
    const rang = new Map();
    Object.keys(byItem).forEach(id => byItem[id].forEach((r, i) => { all.push(r); rang.set(r, i); }));
    return all.filter(r => inPeriod(r.date, period && period.from, period && period.to))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (rang.get(b) - rang.get(a)) || String(b.id).localeCompare(String(a.id)));
  }

  // Ce qu'un inventaire physique révèle : l'écart entre ce que dit l'application et ce qu'on a compté.
  // `counts` = { itemId: quantité comptée }. On ne modifie rien ici : on décrit, l'appelant décide.
  function inventoryDiff(data, counts, dateIso) {
    const d = dateIso || today();
    return trackedItems(data).map(c => {
      const s = stockOf(data, c.id, d);
      const raw = counts && counts[c.id];
      const counted = raw === '' || raw == null ? null : Number(raw);
      const gap = counted == null ? null : round3(counted - s.qty);
      return {
        itemId: c.id, label: c.label, unit: c.unit || '', book: s.qty, counted, gap,
        cmp: s.cmp, value: gap == null ? 0 : round3(gap * s.cmp)
      };
    }).sort((a, b) => (a.label || '').localeCompare(b.label || '', 'fr'));
  }

  // Ce qui manque ou ce qui cloche, trié par gravité : d'abord l'impossible, ensuite le bientôt épuisé.
  function stockAlerts(data, toIso) {
    const rows = stockList(data, toIso);
    const neg = rows.filter(r => r.negative).map(r => ({ ...r, kind: 'negatif' }));
    const low = rows.filter(r => r.low).map(r => ({ ...r, kind: r.qty === 0 ? 'rupture' : 'bas' }));
    return neg.concat(low.sort((a, b) => a.qty - b.qty)).map(r => r.kind === 'negatif' ? r : { ...r, aCommander: quantiteACommander(data, r), enCommande: commandesEnCoursDeLArticle(data, r.itemId) });
  }
  // (1.284.0, revue du Stock S2) Ce qu'il faut commander pour un article sous son seuil : jusqu'au « stock à atteindre »
  // de l'article s'il en a un (au-dessus du seuil), sinon jusqu'au seuil — la règle d'avant, quand rien n'est réglé.
  function quantiteACommander(data, r) {
    const it = (data.catalog || []).find(c => c.id === r.itemId) || {};
    const cible = Math.max(Number(it.stockCible) || 0, Math.max(Number(r.minStock) || 0, 1));
    // Ce qui est déjà commandé et pas encore reçu viendra : on ne le recommande pas (1.284.2).
    const enCommande = commandesEnCoursDeLArticle(data, r.itemId).reduce((a, x) => a + x.reste, 0);
    return round3(Math.max(0, cible - (Number(r.qty) || 0) - enCommande));
  }
  // (1.284.0, revue du Stock S1) D'où vient un article : le fournisseur de son dernier achat ou de sa dernière réception,
  // son coût d'entrée (en devise de base) et sa date. Rien d'acheté encore : null — l'écran demande le fournisseur.
  function fournisseurDeLArticle(data, itemId, toIso) {
    const entrees = stockMovements(data, itemId, toIso).filter(m => (m.source === 'achat' || m.source === 'reception') && m.qty > 0)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (Number(b.ts) || 0) - (Number(a.ts) || 0));
    for (const m of entrees) {
      const pieces = (m.source === 'achat' ? data.purchases : data.receptions) || [];
      const p = pieces.find(x => x.id === m.docId);
      if (!p || !p.supplierId) continue;
      // Le prix du bon suivant est le prix HT de la ligne quand la pièce est dans la devise de l'entreprise ; sinon le coût
      // d'entrée ramené en dinars (le mouvement compte aussi la TVA non déductible : ce n'est pas un prix d'achat).
      const base = (data.company && data.company.currency) || 'DT';
      const l = (p.lines || []).find(x => x.itemId === itemId);
      const prix = (!p.currency || p.currency === base) && l && Number(l.unitPrice) > 0 ? round3(Number(l.unitPrice)) : m.unitCost;
      return { supplierId: p.supplierId, unitCost: prix, date: m.date, docId: m.docId, source: m.source, ref: m.ref || '' };
    }
    return null;
  }

  // Le coût des marchandises vendues sur une période : les sorties de stock, valorisées au coût moyen
  // du moment. C'est LUI la charge de la période, pas l'achat — acheter de la marchandise ne coûte rien
  // tant qu'elle est sur l'étagère, et la vendre coûte ce qu'elle a coûté. C'est la « variation de stock »
  // que le résultat simplifié annonçait comme manquante jusqu'ici.
  //
  // TOUTE sortie qui n'est pas un achat ni le stock de départ coûte ce qu'elle a coûté : la vente, mais
  // aussi la casse, l'écart d'inventaire et la matière utilisée sur un chantier. Jusqu'en 10.12.0 seules
  // les ventes comptaient : une menuiserie qui achète des planches et les transforme en portes ne voyait
  // jamais son bois en charge — son résultat était gonflé de tout ce qu'elle avait consommé. Et un retour
  // sur avoir rend son coût : sans ça, la marchandise revenue en rayon restait comptée comme vendue.
  // (La comptabilité, elle, passe les achats au 607 et l'inventaire du 31 décembre au 603 —
  // `inventaireComptable` — : ce chiffre sert aux vues de gestion, mois par mois.)
  // Le coût des sorties est ce que le bilan retranche (10.14.0) : le stock à l'ouverture, plus ce qui
  // est ENTRÉ par un achat (un retour au fournisseur en moins) ou par un stock de départ, moins le
  // stock à la clôture — les deux stocks tels que `stockTotals` les donne, donc tels que le 37 les
  // porte. Additionner les sorties ligne à ligne donnait le même chiffre dans le cas simple, et un
  // autre dès qu'un article repartait de zéro avec un reste d'arrondi, qu'un retour client rentrait
  // au coût moyen, ou qu'un stock négatif (compté zéro au bilan) était comblé : le résultat simplifié
  // et les états financiers ne disaient plus le même résultat. Douze mois font l'année par
  // construction.
  function costOfGoodsSold(data, period) {
    const from = period && period.from, to = (period && period.to) || '9999-12-31';
    const ouverture = from ? stockTotals(data, addDays(from, -1)).value : 0;
    const entrees = stockJournal(data, period)
      .filter(m => SOURCES_HORS_CHARGE.includes(m.source))
      .reduce((s, m) => s + (Number(m.qty) || 0) * (Number(m.unitApplied) || 0), 0);
    return round3(ouverture + entrees - stockTotals(data, to).value);
  }

  // L'INVENTAIRE COMPTABLE (10.14.0). L'écriture passe les achats de marchandises au 607 — c'est
  // l'inventaire INTERMITTENT, celui du système comptable tunisien — et ne passait JAMAIS
  // l'inventaire : le bilan n'avait aucun stock, et le résultat des états financiers comptait toute
  // marchandise achetée comme consommée, même restée sur l'étagère. Le commentaire de
  // `costOfGoodsSold` affirmait pourtant « l'inventaire au 603 ». Ce que cette fonction rend :
  //   - `departs` : le stock de départ saisi sur les articles, qui existait AVANT les premiers achats
  //     enregistrés. Il entre au bilan en ouverture (37 contre le report à nouveau), comme le solde
  //     de départ d'un compte bancaire — jamais au résultat, qu'il n'a pas traversé ;
  //   - `variations` : au 31 décembre de chaque exercice TERMINÉ, l'écart entre la valeur du stock
  //     et ce que le 37 porte, au 603 (le stock augmente : une charge en moins). Après elle, le 37
  //     vaut exactement la valeur du stock du 31 décembre, et 607 + 603 = le coût des sorties.
  // La valeur est celle de `stockTotals` (coût moyen pondéré, un article négatif compté à zéro) :
  // un seul chiffre du stock pour la page Stock, le bilan et le résultat.
  // Un stock de départ sans date (données anciennes : `1970-01-01`) prend la date de la première
  // pièce de l'entreprise — un « stock au 1er janvier 1970 » dans le livre serait faux.
  function inventaireComptable(data, todayIso) {
    const t = todayIso || today();
    const calcul = () => {
      const moves = stockMovements(data, null);
      if (!moves.length) return { departs: [], variations: [] };
      const dates = [];
      const noter = d => { if (d && /^\d{4}-\d{2}-\d{2}/.test(d) && d > '1970-01-01') dates.push(d.slice(0, 10)); };
      (data.documents || []).forEach(d => noter(d.date)); (data.purchases || []).forEach(p => noter(p.date));
      (data.movements || []).forEach(m => noter(m.date)); moves.forEach(m => noter(m.date));
      const premiere = dates.sort()[0] || t;
      const parArticle = new Map();
      moves.forEach(m => { if (!parArticle.has(m.itemId)) parArticle.set(m.itemId, []); parArticle.get(m.itemId).push(m); });
      const rangees = [...parArticle.values()].map(liste => runningStock(liste).rows);
      const departsParDate = {};
      rangees.forEach(rows => rows.filter(r => r.source === 'depart').forEach(r => {
        const d = r.date && r.date > '1970-01-01' ? r.date : premiere;
        departsParDate[d] = round3((departsParDate[d] || 0) + (Number(r.qty) || 0) * (Number(r.unitApplied) || 0));
      }));
      const departs = Object.keys(departsParDate).sort().filter(d => departsParDate[d]).map(d => ({ date: d, montant: departsParDate[d] }));
      const valeurAu = ye => round3(rangees.reduce((s2, rows) => {
        let v = 0;
        for (const r of rows) { if (r.date > ye) break; v = r.valueAfter; }
        return s2 + Math.max(0, v);
      }, 0));
      const annees = [premiere].concat(departs.map(x => x.date)).map(d => Number(d.slice(0, 4)));
      const premiereAnnee = Math.min(...annees);
      const variations = [];
      let solde = 0;
      for (let y = premiereAnnee; `${y}-12-31` < t; y++) {
        solde = round3(solde + departs.filter(x => Number(x.date.slice(0, 4)) === y).reduce((s2, x) => s2 + x.montant, 0));
        const fin = valeurAu(`${y}-12-31`);
        const montant = round3(fin - solde);
        if (montant) variations.push({ annee: y, date: `${y}-12-31`, montant, valeur: fin });
        solde = fin;
      }
      return { departs, variations };
    };
    return lot ? duLot(data, 'inventaire@' + t, calcul) : calcul();
  }

  // Ce qu'un document sortirait du stock : appelé avant d'émettre une facture ou un bon de livraison,
  // pour prévenir quand on s'apprête à vendre ce qu'on n'a pas.
  // ---------- les kits (plateforme, brique 96 ; 02 : « recettes et kits ») ----------
  // Un kit est un article NON suivi qui porte ses composants ([{ itemId, qty }], des articles suivis) : le
  // vendre sort ses composants. Il n'a pas de stock à lui ; il en reste ce que ses composants permettent.
  function estKit(c) { return !!c && !c.tracked && Array.isArray(c.composants) && c.composants.length > 0; }
  function composantsDe(data, kit) {
    return ((kit && kit.composants) || []).map(k => ({ item: (data.catalog || []).find(x => x.id === k.itemId), qty: Number(k.qty) || 0 }))
      .filter(k => k.item && k.item.tracked && k.qty > 0);
  }
  // Les lignes d'une pièce vues par le stock : la ligne d'un kit devient celles de ses composants.
  function lignesDeStock(lines, data) {
    return (lines || []).flatMap(l => {
      const c = l && !l.noDiscount ? itemOfLine(l, data) : null;
      if (!estKit(c)) return [l];
      return composantsDe(data, c).map(k => ({ itemId: k.item.id, label: k.item.label, qty: round3((Number(l.qty) || 0) * k.qty), kit: c.label }));
    });
  }
  function kitsPossibles(data, kit, toIso) {
    const ks = composantsDe(data, kit);
    if (!ks.length) return 0;
    return Math.max(0, Math.min(...ks.map(k => Math.floor(round3(stockOf(data, k.item.id, toIso).qty / k.qty) + 1e-9))));
  }
  // Ce que coûtent aujourd'hui les composants d'un kit : chacun à son coût moyen (à défaut, son coût de revient).
  function coutDuKit(data, kit) {
    return round3(composantsDe(data, kit).reduce((a, k) => a + k.qty * (stockOf(data, k.item.id).cmp || Number(k.item.unitCost) || 0), 0));
  }

  // (1.316.0) La ligne d'une facture qui a quitté l'entrepôt avec son bon de livraison (`fromBon`) ; une facture d'avant,
  // tirée d'un bon sans marquer ses lignes, reste entière au bon, comme avant.
  function sortieAuBon(d, l) {
    if (!d || d.type !== 'facture' || !l) return false;
    if (l.fromBon) return true;
    return d.fromDocType === 'livraison' && !(d.lines || []).some(x => x && x.fromBon);
  }
  function stockImpact(doc, data) {
    const out = [];
    lignesDeStock((doc.lines || []).filter(l => !sortieAuBon(doc, l)), data).forEach(l => {
      if (l.noDiscount) return;
      const c = itemOfLine(l, data);
      if (!c || !c.tracked) return;
      const qty = Number(l.qty) || 0;
      if (qty <= 0) return;
      // Le stock actuel ne compte pas ce document tant qu'il n'est pas émis.
      const s = stockOf(data, c.id);
      // Avec plusieurs dépôts (brique 95), c'est le dépôt de la pièce qui doit l'avoir ; `total` dit si
      // les autres en ont assez, pour proposer un transfert plutôt qu'un achat oublié.
      const depot = depotsDe(data).length > 1 ? (doc.depotId || DEPOT_PRINCIPAL) : '';
      const have = depot ? (stockParDepot(data, c.id).find(x => x.depotId === depot) || { qty: 0 }).qty : s.qty;
      const after = round3(have - qty);
      if (after < 0) out.push({ itemId: c.id, label: c.label, unit: c.unit || '', have, need: qty, after, depot: depot ? nomDepot(data, depot) : '', total: s.qty });
    });
    return out;
  }

