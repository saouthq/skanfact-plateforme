// @ts-check
// « Tes premiers pas » de la plateforme (lot onboarding ; maquette « Tes premiers pas » validée par Skander le
// 09/10/2026 ; docs/entree.md). Dans l'ordre où ils servent : ton compte, ton entreprise, ton activité (les trois que la
// porte et l'assistant viennent de faire), ton RIB quand on te paie par virement, la protection de ton compte, ton
// premier client, ton premier devis ; puis, facultatifs, ta facture à ton image et ton comptable.
//
// Ils remplacent ceux de la v10 (`C.firstSteps`) sur la plateforme, et gardent leur forme : la v10 les lit partout de la
// même façon (l'accueil, la jauge de fin de visite, « Me guider »), et un compteur se calcule avec la liste qu'il
// annonce. Ce qui vit sur le serveur (l'adresse vérifiée, le code du téléphone, le mandat confié à un cabinet) arrive
// par le point de contact (`etatDuDemarrage`) ; tant qu'il n'est pas lu, rien ne se dit fait ni à faire de travers : le
// compte compte comme fait, le code comme à faire.
(function () {
  'use strict';

  /** @param {unknown} v */
  const txt = (v) => String(v == null ? '' : v).trim();

  /**
   * Une étape, sous la forme que la v10 lit (`C.firstSteps`) ; `badge`, `reco`, `recommande` et `attente` sont de la
   * plateforme.
   * @typedef {{ id: string, titre: string, fait: boolean, action: string | null, quoi: string, badge?: string,
   *   reco?: boolean, recommande?: boolean, facultatif?: boolean, attente?: string }} Etape
   */

  /**
   * Les premiers pas d'une entreprise, et ce qu'en tire la v10 : combien sont faits, s'ils occupent encore l'accueil
   * (`demarrage`), et l'étape suivante (la première à faire qui n'est pas facultative).
   * @param {any} C le moteur de la v10
   * @param {any} data le dossier
   * @param {any} co la fiche de l'entreprise
   * @param {{ compte?: { adresseVerifiee: boolean, courriel: boolean, codeActif: boolean } | null, mandat?: string | null }} [etat]
   */
  function etapes(C, data, co, etat) {
    const d = data || {};
    const c = co || {};
    const e = etat || {};
    const compte = e.compte || null;
    const docs = d.documents || [];

    // 1. Ton compte : fait dès qu'il existe ; son adresse se vérifie quand le serveur sait envoyer un e-mail.
    const verifiee = !!(compte && compte.adresseVerifiee);
    const aVerifier = !!(compte && compte.courriel && !compte.adresseVerifiee);
    /** @type {Etape[]} */
    const lesEtapes = [
      aVerifier
        ? { id: 'compte', titre: 'Vérifie ton adresse e-mail', fait: false, action: 'adresse',
          quoi: 'Un code part à ton adresse : il prouve qu\'elle est à toi, et c\'est elle qui te rend ton compte si tu oublies ton mot de passe.' }
        : { id: 'compte', titre: verifiee ? 'Ton compte et ton adresse vérifiée' : 'Ton compte', fait: true, action: null, quoi: '' },
    ];

    // 2. Ton entreprise et où te joindre : ce qui s'imprime en haut de chaque facture.
    const mf = txt(c.matricule);
    const manque = [];
    if (!txt(c.name)) manque.push('ta raison sociale');
    if (!mf) manque.push('ton matricule fiscal');
    else if (!C.matriculeBienForme(mf)) manque.push('un matricule fiscal valide (1234567A/A/M/000)');
    if (![c.address, c.phone, c.email].some((x) => txt(x))) manque.push('où te joindre (une adresse, un téléphone ou un e-mail)');
    const mfManque = !mf || !C.matriculeBienForme(mf);
    lesEtapes.push({ id: 'societe', titre: 'Ton entreprise et où te joindre', fait: !manque.length, action: 'societe',
      quoi: !manque.length ? '' : `Il manque ${C.liste(manque)} : ${mfManque ? 'une facture sans matricule fiscal n\'est pas conforme.' : 'tes clients le lisent sous ton nom, sur chaque facture.'}` });

    // 3. Ton activité, ta TVA et ton menu : l'assistant les a demandés ; un métier laissé « Plus tard » se choisit ici.
    const activite = !!c.setupDone && !!txt(c.activity);
    lesEtapes.push({ id: 'activite', titre: 'Ton activité, ta TVA et ton menu', fait: activite, action: 'assistant',
      quoi: activite ? '' : 'Ton métier prépare ton catalogue et le nom de tes factures ; ta TVA décide de leurs colonnes. Deux minutes.' });

    // 4. Ton RIB, seulement quand on attend un virement (un commerce ou un salon encaissent sur place : `ribAttendu`).
    if (C.ribAttendu(c)) {
      const rib = txt(c.rib);
      const bon = !!rib && C.verifRib(rib).ok;
      lesEtapes.push({ id: 'rib', titre: 'Ton RIB, pour être payé par virement', fait: bon, action: 'rib',
        quoi: bon ? '' : rib ? `Ton RIB n'est pas valide (${C.verifRib(rib).court}) : corrige-le, il s'imprime sous chaque facture.`
          : 'Il s\'imprime sous chaque facture. Sans lui, un client qui veut payer par virement doit te le demander.' });
    }

    // 5. Protège ton compte : recommandé, jamais imposé (le code n'est exigé que d'un comptable de cabinet). Il ne retient
    // pas le panneau à l'accueil.
    const code = !!(compte && compte.codeActif);
    lesEtapes.push({ id: 'code', titre: 'Protège ton compte', fait: code, action: 'code', badge: 'Recommandé', reco: true, recommande: true,
      quoi: code ? '' : 'Un code sur ton téléphone en plus du mot de passe : même avec ton mot de passe, personne n\'entre sans lui. Deux minutes.' });

    // 6. et 7. Ton premier client, ton premier devis (ou ta première facture : qui facture sans devis a commencé aussi).
    lesEtapes.push({ id: 'client', titre: 'Ton premier client', fait: (d.clients || []).length > 0, action: 'client',
      quoi: 'Son adresse et son matricule se reporteront tout seuls sur tes devis et tes factures.' });
    const unDevis = docs.some((/** @type {any} */ x) => x.type === 'devis');
    const uneFacture = docs.some((/** @type {any} */ x) => x.type === 'facture');
    lesEtapes.push({ id: 'devis', titre: !unDevis && uneFacture ? 'Ta première facture' : 'Ton premier devis', fait: unDevis || uneFacture, action: 'devis',
      quoi: 'Un devis annonce un prix avant de travailler. Il se transforme en facture en un clic.' });

    // 8. et 9. Facultatifs : ta facture à ton image, ton comptable (son cabinet, par le mandat ; proposé, ta part est faite,
    // et ce qui reste se dit : une étape faite cache son explication, pas ce qu'elle attend encore).
    lesEtapes.push({ id: 'marque', titre: 'Ta facture à ton image', fait: !!C.marquePersonnalisee(c), action: 'marque', facultatif: true, badge: 'Facultatif',
      quoi: 'Ton logo et ta couleur, vus sur une vraie facture avant d\'enregistrer.' });
    const mandat = txt(e.mandat);
    lesEtapes.push({ id: 'comptable', titre: 'Invite ton comptable', fait: mandat === 'actif' || mandat === 'propose', action: 'mandat', facultatif: true, badge: 'Facultatif',
      quoi: 'Il voit tes pièces, prépare tes déclarations et te pose ses questions ici, en face de la pièce.',
      attente: mandat === 'propose' ? 'Ta proposition attend que ton cabinet l\'accepte.' : '' });

    const faits = lesEtapes.filter((x) => x.fait).length;
    // Le panneau occupe l'accueil tant qu'une étape du métier attend ; ni une facultative, ni le code recommandé ne le
    // retiennent (un panneau qui ne partirait jamais serait celui qu'on apprend à ne plus lire). Jamais dans l'entreprise
    // d'essai : l'exemple a déjà tout, et y proposer « ton premier client » mentirait.
    const exemple = !!C.estDemo(d);
    const demarrage = !exemple && lesEtapes.some((x) => !x.fait && !x.facultatif && !x.recommande);
    const suivante = exemple ? null : lesEtapes.find((x) => !x.fait && !x.facultatif) || null;
    return { etapes: lesEtapes, faits, total: lesEtapes.length, fini: faits === lesEtapes.length, demarrage, suivante };
  }

  /** @type {any} */ (window).SkanPremiersPas = { etapes };
})();
