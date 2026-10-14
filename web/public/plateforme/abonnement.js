// @ts-check
// L'abonnement de l'entreprise (lot « les fonctions qui manquent », 12/10/2026 ; migration 0082, docs/abonnement.md ;
// skanfact docs/cadrage/07-offres-et-prix.md). Le serveur DÉDUIT l'état (essai, actif, en retard, lecture seule) ; cette
// page ne fait que le dire, à trois endroits de la v10 qui existaient pour sa licence :
//   - la pastille du bas de la barre (`licenceBanner`), calme pendant l'essai, orange la dernière semaine, rouge quand
//     l'échéance est passée (8.0.1 : une échéance qui ferme quelque chose se voit dès le premier jour) ;
//   - la carte de l'essai, sur l'accueil (`carteEssai`) ;
//   - la porte de création (`licenceBlock`), sur chaque point de création de la v10 : en lecture seule, la création est
//     refusée AVANT le geste, en le disant. Lire, imprimer, exporter, corriger : toujours (6.4.0, jamais de données en
//     otage).
// Et l'onglet « Ton abonnement » des Paramètres, pour qui le gère (le propriétaire, un administrateur) : l'état, les
// offres et leurs prix (ceux du jour, lus au serveur), ce qui se passe à l'échéance, l'histoire de l'abonnement, et ses
// factures (14b ; docs/abonnement.md B5) : celles que l'entreprise SkanFact lui a émises, chacune telle qu'elle
// s'imprime, et « Payer en ligne » pour celle qui doit encore.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);

  /** @typedef {{ aujourdhui?: string, etat: 'essai' | 'actif' | 'en_retard' | 'lecture_seule' | 'hors', jusquAu?: string, jours?: number,
   *   offre?: string, periodicite?: string, resilie?: boolean, echeance?: string, lectureSeuleLe?: string, apresEssai?: boolean,
   *   depuis?: string, raison?: string, fermes?: string[] }} Etat */

  /** @param {unknown} v */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c] || c);
  // Un jour de calendrier tel qu'on le lit : 19/11/2026.
  /** @param {string | undefined} j */
  const jour = (j) => (j && /^\d{4}-\d{2}-\d{2}$/.test(j) ? `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}` : '');
  /** @param {number} n @param {string} un @param {string} [plusieurs] */
  const pl = (n, un, plusieurs) => `${n}\u00a0${n > 1 ? (plusieurs || `${un}s`) : un}`;
  // Un montant du serveur (« 390.000 ») : 390 DT ; 39,500 DT s'il a des millimes.
  /** @param {string} t */
  function montant(t) {
    const [e = '0', d = ''] = String(t).split('.');
    const entier = e.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
    return `${entier}${/^0*$/.test(d) ? '' : `,${d.padEnd(3, '0')}`}\u00a0DT`;
  }

  // Les factures de l'abonnement (14b ; docs/abonnement.md B5) : la pièce telle que SkanFact l'imprime, par le gabarit de
  // la v10 (`SkanCore`, chargé avec l'application), comme l'espace client la montre à tout client.
  /** @returns {any} */
  const core = () => /** @type {any} */ (window).SkanCore;
  // Les nombres non entiers d'une pièce arrivent en texte exact ({ "~n": "39.5" }), comme le dossier les garde.
  /** @param {unknown} v @returns {any} */
  function decoder(v) {
    if (Array.isArray(v)) return v.map(decoder);
    if (v && typeof v === 'object') {
      const cles = Object.keys(v);
      if (cles.length === 1 && cles[0] === '~n') return Number(/** @type {any} */ (v)['~n']);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoder(x)]));
    }
    return v;
  }
  // Un montant de pièce, comme la pièce l'écrit (« 47,410 DT ») : la même fonction que la facture imprimée.
  /** @param {string | null} x @param {string} d */
  const somme = (x, d) => core().money(Number(x), d === 'TND' ? 'DT' : d);
  const ETATS_FACTURE = /** @type {Record<string, string>} */ ({ a_payer: 'À payer', en_retard: 'En retard', partielle: 'Payée en partie', payee: 'Payée', annulee: 'Annulée' });
  const DOIT = ['a_payer', 'en_retard', 'partielle'];

  // Ce que chaque offre contient (skanfact docs/cadrage/07-offres-et-prix.md) : une phrase par ligne, comme on lit une
  // offre — pas un paragraphe qu'on ne relit pas.
  const OFFRES = /** @type {Record<string, { nom: string, pour: string, inclus: string[] }>} */ ({
    essentiel: { nom: 'Essentiel', pour: 'Tout ce qu\'il faut pour vendre, encaisser et déclarer.', inclus: [
      'Devis, factures, avoirs, clients et catalogue', 'Achats, fournisseurs et stock', 'Une caisse au comptoir', 'La banque et la trésorerie',
      'La facture électronique, la retenue à la source et la déclaration du mois', 'L\'espace client et le paiement en ligne',
      'Ton comptable dans les mêmes données', 'Des utilisateurs sans limite, un établissement'] },
    complet: { nom: 'Complet', pour: 'Pour une entreprise qui paie des salariés et tient sa comptabilité.', inclus: [
      'Tout Essentiel', 'La paie, jusqu\'à vingt salariés', 'La comptabilité complète', 'Deux caisses', 'Des utilisateurs sans limite, deux établissements'] },
  });
  // Ce qui s'ajoute à l'offre (14c ; skanfact docs/cadrage/07-offres-et-prix.md, « Au-delà de l'offre ») : ce que chaque
  // ligne compte, et ce que chaque offre en comprend déjà. Les prix sont ceux du jour, lus au serveur ; une ligne sans
  // prix ne s'affiche pas.
  // `compte` : ce que l'entreprise en utilise (0100, plateforme.comptes_de_l_entreprise), et comment le dire.
  const EN_PLUS = /** @type {{ option: string, nom: string, compris: string, compte?: string, mot?: [string, string], feminin?: boolean }[]} */ ([
    { option: 'caisse', nom: 'Une caisse de plus', compris: 'Essentiel en comprend une ; Complet, deux.', compte: 'caisses', mot: ['caisse', 'caisses'], feminin: true },
    { option: 'etablissement', nom: 'Un établissement de plus', compris: 'Essentiel en comprend un ; Complet, deux.', compte: 'etablissements', mot: ['établissement', 'établissements'] },
    { option: 'salarie', nom: 'Un salarié de plus', compris: 'La paie en comprend dix sur Essentiel, vingt sur Complet.', compte: 'salaries', mot: ['salarié', 'salariés'] },
    { option: 'module_paie', nom: 'La paie, seule', compris: 'Sur Essentiel ; Complet la contient.' },
    { option: 'module_compta', nom: 'La comptabilité complète, seule', compris: 'Sur Essentiel ; Complet la contient.' },
  ]);
  /** @param {string | undefined} o */
  const nomOffre = (o) => (o && OFFRES[o] ? OFFRES[o].nom : 'Abonnement');

  // Sur la carte Essentiel (14c) : ce qui reste dans Complet, sauf ce qui a été acheté seul.
  /** @param {unknown} modules */
  function ceQuiResteDansComplet(modules) {
    const achetes = Array.isArray(modules) ? modules : [];
    const paie = achetes.includes('paie'), compta = achetes.includes('compta');
    if (paie && compta) return 'La paie et la comptabilité complète sont achetées en plus d\'Essentiel.';
    if (paie) return 'La paie est achetée en plus d\'Essentiel. La comptabilité complète est dans Complet : ce qui existe se lit, mais rien de nouveau ne s\'y crée.';
    if (compta) return 'La comptabilité complète est achetée en plus d\'Essentiel. La paie est dans Complet : ce qui existe se lit, mais rien de nouveau ne s\'y crée.';
    return 'La paie et la comptabilité complète sont dans Complet : ce qui existe se lit, mais rien de nouveau ne s\'y crée.';
  }

  // Pourquoi l'entreprise est en lecture seule, en une phrase.
  /** @param {Etat} e */
  const pourquoi = (e) => ({
    essai_termine: 'L\'essai est terminé.', non_renouvele: 'L\'abonnement n\'a pas été renouvelé.',
    resilie: 'L\'abonnement a été résilié.', suspendu: 'SkanFact a suspendu l\'abonnement : écris-nous à contact@skanfact.tn.',
  })[e.raison || ''] || '';

  // Ce que la v10 attend de sa licence (sa pastille, sa carte d'essai, sa porte de création), tiré de l'état.
  /** @param {Etat | null} e */
  function licence(e) {
    // Ce que l'offre ne contient pas (14c ; serveur/abonnement/offre.ts, qui refuse lui-même) : la paie (le module « paie »
    // de la v10) et la comptabilité complète (le module « immos », et l'option « compta » : le grand livre, la balance, les
    // états financiers). Les portes de la v10 retiennent la création AVANT le geste, et disent ce qui reste ouvert.
    const fermes = e && Array.isArray(e.fermes) ? e.fermes : [];
    const reserves = [...(fermes.includes('paie') ? ['paie'] : []), ...(fermes.includes('compta') ? ['immos'] : [])];
    const base = { state: 'libre', locked: false, label: '', detail: '', offre: 'entreprise', offreLabel: e && e.offre ? nomOffre(e.offre) : '',
      reserves, options: fermes.includes('compta') ? [] : ['compta'], editeur: false };
    if (!e || e.etat === 'hors') return base;
    if (e.etat === 'essai') return { ...base, state: 'essai', daysLeft: e.jours, label: 'Essai gratuit', detail: `L'essai court jusqu'au ${jour(e.jusquAu)}, tout ouvert.` };
    if (e.etat === 'actif') return { ...base, state: 'active', daysLeft: e.jours, label: `${nomOffre(e.offre)} jusqu'au ${jour(e.jusquAu)}`, detail: e.resilie ? 'Résilié : il s\'arrête à cette date.' : '' };
    if (e.etat === 'en_retard') {
      return { ...base, state: e.apresEssai ? 'finessai' : 'retard', daysLeft: e.jours, label: e.apresEssai ? 'Ton essai est terminé' : 'Ton abonnement est échu',
        detail: `Tout marche encore jusqu'au ${jour(e.lectureSeuleLe ? plusJours(e.lectureSeuleLe, -1) : '')} ; ensuite, la lecture seule.` };
    }
    return { ...base, state: e.raison === 'essai_termine' ? 'finessai' : 'expiree', locked: true, label: `Lecture seule depuis le ${jour(e.depuis)}`, detail: pourquoi(e) };
  }
  /** @param {string} j @param {number} n */
  function plusJours(j, n) {
    const d = new Date(Date.UTC(Number(j.slice(0, 4)), Number(j.slice(5, 7)) - 1, Number(j.slice(8, 10)) + n));
    return d.toISOString().slice(0, 10);
  }
  /** @param {string} de @param {string} a */
  const joursEntre = (de, a) => Math.round((Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)))
    - Date.UTC(Number(de.slice(0, 4)), Number(de.slice(5, 7)) - 1, Number(de.slice(8, 10)))) / 86_400_000);
  // Les relances dites en mots, de la plus lointaine à la plus proche : « 15 jours et 7 jours avant l'échéance, puis la
  // veille », sans jamais un nombre écrit ici (0104 : ce sont des règles que SkanFact règle).
  /** @param {string[]} m */
  const enumerer = (m) => (m.length > 1 ? `${m.slice(0, -1).join(', ')} et ${m[m.length - 1]}` : (m[0] || ''));
  /** @param {number[]} r */
  const relancesEnMots = (r) => {
    const avant = r.filter((n) => n !== 1).map((n) => pl(n, 'jour'));
    const debut = avant.length ? `${enumerer(avant)} avant l'échéance` : '';
    return r.includes(1) ? (debut ? `${debut}, puis la veille` : 'la veille de l\'échéance') : debut;
  };

  // La pastille de la barre : rien quand il n'y a rien à dire (pas d'échéance, ou une échéance lointaine payée).
  /** @param {Etat | null} e @returns {{ show: boolean, ton: string, texte: string }} */
  function pastille(e) {
    const rien = { show: false, ton: '', texte: '' };
    if (!e || e.etat === 'hors') return rien;
    const j = Number(e.jours);
    if (e.etat === 'essai') {
      if (j > 7) return { show: true, ton: 'calme', texte: `Essai — ${pl(j, 'jour')}` };
      return { show: true, ton: 'attire', texte: j <= 0 ? 'Essai — dernier jour' : `Essai — ${pl(j, 'jour')} avant la fin` };
    }
    if (e.etat === 'actif') {
      if (j > 15) return rien;
      return { show: true, ton: 'attire', texte: e.resilie ? `Abonnement résilié — il s'arrête le ${jour(e.jusquAu)}` : `${nomOffre(e.offre)} jusqu'au ${jour(e.jusquAu)} — pense à le renouveler` };
    }
    if (e.etat === 'en_retard') return { show: true, ton: 'alerte', texte: `${e.apresEssai ? 'Essai terminé' : 'Abonnement échu'} — lecture seule le ${jour(e.lectureSeuleLe)}` };
    return { show: true, ton: 'alerte', texte: 'Lecture seule — voir l\'abonnement' };
  }

  // L'état en tête de l'onglet : une pastille, un titre, ce qu'il veut dire, et la jauge des jours quand ils comptent.
  // `regles` : la durée de son essai et ses relances (0104), quand on les connaît.
  /** @param {Etat} e @param {{ essai?: number | null, relances?: number[] }} [regles] @returns {{ ton: string, pastille: string, titre: string, texte: string, jauge: { texte: string, part: number } | null }} */
  function etatEnClair(e, regles = {}) {
    if (e.etat === 'hors') {
      return { ton: 'calme', pastille: 'Sans échéance', titre: 'Rien ne s\'arrête ici', jauge: null, texte: ({ bac_a_sable: 'C\'est une entreprise d\'essai : elle ne s\'arrête jamais, et rien n\'y est facturé.',
        tenu_par_cabinet: 'Ton cabinet tient ce dossier : c\'est lui qui le paie.', offert: 'SkanFact t\'offre cet abonnement : il ne s\'arrête pas.',
        inconnu: 'Cette entreprise n\'a pas encore d\'abonnement : rien ne s\'y ferme.' })[e.raison || ''] || '' };
    }
    if (e.etat === 'essai') {
      const j = Number(e.jours);
      return { ton: j <= 7 ? 'attire' : 'calme', pastille: 'Essai gratuit', titre: j <= 0 ? 'Dernier jour de ton essai' : `Encore ${pl(j, 'jour')} d'essai`,
        texte: `Jusqu'au ${jour(e.jusquAu)}, tout est ouvert, sans carte. Ce que tu crées pendant l'essai reste quand tu t'abonnes : rien à ressaisir.`,
        // La part de l'essai qui reste : sur sa durée (celle de sa création), ou plus s'il a été prolongé ; sans elle, la
        // jauge ne dit que les jours qui restent.
        jauge: (() => {
          const sur = regles.essai ? Math.max(regles.essai, j) : null;
          return { texte: j <= 0 ? 'Dernier jour' : sur ? `${pl(j, 'jour')} sur ${sur}` : pl(j, 'jour'), part: sur ? Math.max(0, Math.min(1, j / sur)) : 1 };
        })() };
    }
    if (e.etat === 'actif') {
      const j = Number(e.jours);
      return { ton: j <= 15 ? 'attire' : 'calme', pastille: e.resilie ? 'Résilié' : `${nomOffre(e.offre)} · ${e.periodicite === 'mensuel' ? 'au mois' : 'à l\'année'}`,
        titre: `Payé jusqu'au ${jour(e.jusquAu)}`, jauge: null,
        texte: e.resilie ? 'Tu as résilié : l\'abonnement s\'arrête à cette date, puis l\'entreprise passe en lecture seule.'
          : j <= 0 ? 'C\'est le dernier jour de la période payée.'
            : `Encore ${pl(j, 'jour')}.${regles.relances && regles.relances.length ? ` Un rappel part par e-mail ${relancesEnMots(regles.relances.slice(0, 1))}.` : ''}` };
    }
    if (e.etat === 'en_retard') {
      const j = Number(e.jours);
      return { ton: 'alerte', pastille: 'À régler', titre: e.apresEssai ? `L'essai est terminé depuis le ${jour(plusJours(String(e.echeance), 1))}` : `L'abonnement est échu depuis le ${jour(plusJours(String(e.echeance), 1))}`,
        texte: `Tout marche encore jusqu'au ${jour(plusJours(String(e.lectureSeuleLe), -1))}. Le ${jour(e.lectureSeuleLe)}, l'entreprise passe en lecture seule : tout se lit, s'imprime et s'exporte, mais rien de nouveau ne se crée.`,
        // La grâce de cette échéance : du lendemain de l'échéance à la veille de la lecture seule.
        jauge: { texte: `${pl(j, 'jour')} de grâce`, part: Math.max(0, Math.min(1, j / Math.max(1, joursEntre(String(e.echeance), String(e.lectureSeuleLe)) - 1))) } };
    }
    return { ton: 'alerte', pastille: 'Lecture seule', titre: `En lecture seule depuis le ${jour(e.depuis)}`, jauge: null,
      texte: `${pourquoi(e)} Tout se lit, s'imprime et s'exporte ; tes données restent à toi. Pour créer de nouveau, abonne-toi : tout se rouvre aussitôt, tel que tu l'as laissé.` };
  }

  // Quand commence la période qu'on paie : la même règle que le serveur (prochainePeriode, serveur/abonnement/etat.ts).
  /** @param {Etat} e */
  function quandCommence(e) {
    if (e.etat === 'essai') return 'L\'abonnement commence à la fin de ton essai : les jours d\'essai qui restent ne se perdent pas.';
    if (e.etat === 'actif') return 'La nouvelle période prend la suite de celle qui est payée : aucun jour ne se perd.';
    if (e.etat === 'en_retard') return `Réglé avant le ${jour(e.lectureSeuleLe)}, l'abonnement prend la suite de l'échéance, sans interruption.`;
    return 'L\'abonnement commence le jour du paiement, et tout se rouvre aussitôt.';
  }

  const NATURES = /** @type {Record<string, string>} */ ({
    essai_commence: 'Essai commencé', essai_prolonge: 'Essai prolongé', paye: 'Paiement reçu', resilie: 'Résilié', resiliation_annulee: 'Résiliation annulée',
    suspendu: 'Suspendu par SkanFact', repris: 'Repris', offert: 'Offert par SkanFact', offert_retire: 'Ce n\'est plus offert',
    module_ouvert: 'Module acheté', module_ferme: 'Module retiré',
  });
  // Les modules achetés seuls sur Essentiel (14c), comme on les nomme.
  const NOMS_MODULES = /** @type {Record<string, string>} */ ({ paie: 'la paie', compta: 'la comptabilité complète' });
  // Ce qu'un événement a changé, en quelques mots (jamais le motif : c'est une note de SkanFact).
  /** @param {{ nature: string, apres: any }} v */
  function apresEnClair(v) {
    const a = v.apres || {};
    if ((v.nature === 'essai_commence' || v.nature === 'essai_prolonge') && (a.essaiJusquAu || a.essai_jusqu_au)) return `jusqu'au ${jour(a.essaiJusquAu || a.essai_jusqu_au)}`;
    // Payé par une facture de SkanFact (14b) : elle se nomme, on la retrouve dans « Tes factures ».
    if (v.nature === 'paye' && a.paye_jusqu_au) return `${nomOffre(a.offre)}, jusqu'au ${jour(a.paye_jusqu_au)}${a.facture ? `, facture ${a.facture}` : ''}`;
    if ((v.nature === 'module_ouvert' || v.nature === 'module_ferme') && NOMS_MODULES[a.module]) return NOMS_MODULES[a.module];
    return '';
  }

  /**
   * @typedef {{ appel: (methode: string, chemin: string, corps?: unknown) => Promise<any> }} Outils
   * @typedef {{ type: 'facture' | 'avoir', numero: string, date: string, echeance: string | null, devise: string, net: string,
   *   paye: string | null, credite: string | null, reste: string | null, statut: string | null, payable: boolean, document: any,
   *   periode: { debut: string, fin: string, offre: string, periodicite: string } | null }} PieceAbo
   * @typedef {{ entreprise: any, client: any, pieces: PieceAbo[] }} FacturesAbo
   */
  // Les dessins de l'onglet, au trait (la DA de l'entrée) : une enveloppe, une coche.
  const ICONE_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7.5l8 6 8-6"/></svg>';
  const ICONE_COCHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';

  /** @param {FacturesAbo} fa @param {PieceAbo} p */
  const titreDe = (fa, p) => `${core().titreDePiece(p.document, fa.entreprise)} ${p.numero}`;
  // Un numéro de pièce ne se coupe pas à son tiret (au téléphone, « FAC-2026- » puis « 003 » ne se lit plus).
  /** @param {string} n */
  const num = (n) => `<span class="abo-num">${esc(n)}</span>`;
  // Ce qu'une facture a déjà reçu : ses paiements, et ce que ses avoirs en ont retiré (de quoi relire le reste).
  /** @param {PieceAbo} p */
  const recu = (p) => [Number(p.paye) > 0 ? `payé ${somme(p.paye, p.devise)}` : '', Number(p.credite) > 0 ? `avoirs ${somme(p.credite, p.devise)}` : ''].filter(Boolean).join(' · ');
  // Sous le montant, ce qui reste à savoir pour cette pièce (l'état, lui, est dans sa pastille : il ne se redit pas). En
  // HTML, déjà échappé.
  /** @param {PieceAbo} p */
  function ouEnEst(p) {
    if (p.type === 'avoir') return p.document && p.document.creditOfNumber ? `corrige la facture ${num(String(p.document.creditOfNumber))}` : '';
    if (p.statut === 'a_payer') return p.echeance ? esc(`à régler au plus tard le ${jour(p.echeance)}`) : '';
    if (p.statut === 'en_retard') return esc(`échue le ${jour(p.echeance || '')} · reste ${somme(p.reste, p.devise)}`);
    if (p.statut === 'partielle') return esc(`reste ${somme(p.reste, p.devise)} · ${recu(p)}`);
    return '';
  }

  // « Tes factures » : celles que l'entreprise SkanFact a émises pour l'abonnement, la plus récente d'abord ; « Voir » sur
  // chacune, « Payer en ligne » sur celle qui doit encore — le vert sur la plus ancienne, l'étape suivante (un seul vert).
  // Sans paiement en ligne, une facture qui doit encore dit comment la régler : ses coordonnées sont sur la facture.
  /** @param {FacturesAbo} fa */
  function sesFactures(fa) {
    const aPayer = fa.pieces.filter((p) => p.payable);
    const verte = aPayer[aPayer.length - 1];
    const lignes = fa.pieces.map((p, i) => {
      const periode = p.periode ? `${nomOffre(p.periode.offre)} ${p.periode.periodicite === 'mensuel' ? 'au mois' : 'à l\'année'} · du ${jour(p.periode.debut)} au ${jour(p.periode.fin)}` : '';
      const doit = !!p.statut && DOIT.includes(p.statut);
      return `<li class="abo-facture${doit ? ' doit' : ''}" data-numero="${esc(p.numero)}">
        <div class="abo-fa-quoi"><b>${esc(core().titreDePiece(p.document, fa.entreprise))} ${num(p.numero)}</b><span>${esc(periode)}</span></div>
        <div class="abo-fa-montant"><b>${esc(somme(p.net, p.devise))}</b>${ouEnEst(p) ? `<span>${ouEnEst(p)}</span>` : ''}</div>
        ${p.statut ? `<span class="abo-fa-etat ${esc(p.statut)}">${esc(ETATS_FACTURE[p.statut] || '')}</span>` : '<span class="abo-fa-etat avoir">Avoir</span>'}
        <div class="abo-fa-gestes">
          ${p.payable ? `<button type="button" class="btn btn-sm${p === verte ? ' btn-primary' : ''}" data-payer="${i}">Payer ${esc(somme(p.reste, p.devise))} en ligne</button>` : ''}
          <button type="button" class="btn btn-sm" data-voir="${i}">Voir</button>
        </div>
        ${doit && !p.payable ? '<p class="abo-fa-aide">Règle-la par virement ou par chèque : les coordonnées de SkanFact sont sur la facture.</p>' : ''}
      </li>`;
    }).join('');
    return `<div class="abo-section" id="abo-factures">
      <div class="abo-section-tete"><h3>Tes factures</h3><p>Les factures de SkanFact pour ton abonnement, telles qu'elles s'impriment.${aPayer.length ? ' Tu les règles ici, en ligne : ton abonnement suit dès que le paiement est confirmé.' : ''}</p></div>
      <ul class="abo-factures">${lignes}</ul>
      <p class="small abo-refus" role="alert" hidden></p>
    </div>`;
  }

  // « Payer en ligne » : le serveur ouvre le paiement chez le prestataire de l'entreprise SkanFact, pour le RESTE (le
  // chiffre du serveur : le navigateur ne décide d'aucun montant) ; on y paie, puis la page de retour de l'espace client
  // dit ce que le prestataire a confirmé, et ramène ici (« Ton abonnement » de CETTE entreprise, jamais un espace client
  // ouvert avant dans l'onglet).
  /** @param {Outils} o @param {PieceAbo} p @param {HTMLButtonElement} b @param {HTMLElement} refus */
  async function payer(o, p, b, refus) {
    /** @param {string} texte */
    const dire = (texte) => { refus.textContent = texte; refus.hidden = false; b.disabled = false; };
    b.disabled = true;
    refus.hidden = true;
    /** @type {any} */
    let r;
    try { r = await o.appel('POST', '/abonnement/payer', { numero: p.numero }); } catch (x) { dire(x instanceof Error ? x.message : String(x)); return; }
    if (!r || typeof r.adresse !== 'string') { dire('Le paiement en ligne ne répond pas : réessaie dans un instant.'); return; }
    try {
      sessionStorage.setItem('skanfact.abonnement.retour', new URLSearchParams(location.search).get('e') || '');
      sessionStorage.removeItem('skanfact.espace');
    } catch { /* sans stockage, la page de retour propose de la fermer */ }
    location.assign(r.adresse);
  }

  // « Imprimer ou enregistrer en PDF » : une page à part, mise en page comme la v10 le fait pour son PDF. La pièce
  // n'exécute rien (« sandbox ») : elle s'affiche, et s'imprime (« allow-modals »).
  /** @param {FacturesAbo} fa @param {PieceAbo} p @param {string | undefined} tampon */
  function imprimer(fa, p, tampon) {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin allow-modals');
    f.className = 'abo-impression';
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px';
    f.onload = () => {
      const d = f.contentDocument;
      if (d) { try { core().fitToPage(d); core().paginate(d); } catch { /* la page s'imprime telle quelle */ } }
      if (f.contentWindow) f.contentWindow.print();
      setTimeout(() => f.remove(), 60_000);
    };
    f.srcdoc = core().documentHtml(p.document, fa.client, fa.entreprise, { stampText: tampon });
    document.body.appendChild(f);
  }

  // Une pièce, telle que SkanFact l'imprime, à la place de l'onglet ; « ← Ton abonnement » y ramène (relu au serveur).
  // Le vert : « Payer en ligne » si elle doit encore et se règle en ligne, sinon « Imprimer ».
  /** @param {HTMLElement} el @param {Outils} o @param {FacturesAbo} fa @param {PieceAbo} p */
  function voir(el, o, fa, p) {
    const tampon = p.statut === 'payee' ? 'Payée' : p.statut === 'annulee' ? 'Annulée' : undefined;
    const reste = p.reste === null ? '' : Number(p.reste) > 0 ? `Reste à payer : <b>${esc(somme(p.reste, p.devise))}</b>` : 'Rien à payer sur cette facture';
    el.innerHTML = `<div class="abo abo-vue-piece">
      <div class="abo-piece-barre">
        <button type="button" class="btn btn-sm" id="abo-retour">← Ton abonnement</button>
        <span class="abo-piece-reste">${reste}${recu(p) ? `<span class="muted"> · ${esc(recu(p))}</span>` : ''}</span>
        <span class="abo-piece-gestes">${p.payable ? `<button type="button" class="btn btn-primary" id="abo-payer-piece">Payer ${esc(somme(p.reste, p.devise))} en ligne</button>` : ''}<button type="button" class="btn${p.payable ? '' : ' btn-primary'}" id="abo-imprimer">Imprimer ou enregistrer en PDF</button></span>
      </div>
      <p class="small abo-refus" role="alert" hidden></p>
      <iframe class="abo-piece" sandbox="allow-same-origin" title="${esc(titreDe(fa, p))}"></iframe>
    </div>`;
    const cadre = /** @type {HTMLIFrameElement} */ (el.querySelector('iframe.abo-piece'));
    const zoom = Math.max(0.3, Math.min(1, Math.floor((cadre.clientWidth - 2) / 794 * 100) / 100));
    cadre.srcdoc = core().documentHtml(p.document, fa.client, fa.entreprise, { preview: true, stampText: tampon, zoom });
    /** @type {HTMLElement} */ (el.querySelector('#abo-retour')).onclick = () => { void dessiner(el, o); };
    /** @type {HTMLElement} */ (el.querySelector('#abo-imprimer')).onclick = () => imprimer(fa, p, tampon);
    const bp = /** @type {HTMLButtonElement | null} */ (el.querySelector('#abo-payer-piece'));
    if (bp) bp.onclick = () => { void payer(o, p, bp, /** @type {HTMLElement} */ (el.querySelector('.abo-refus'))); };
    // Le haut de la facture, sous la barre de l'écran (au téléphone, elle reste en haut : la marge la laisse voir).
    /** @type {HTMLElement} */ (el.querySelector('.abo-vue-piece')).scrollIntoView({ block: 'start' });
  }

  /** @param {HTMLElement} el @param {Outils} o */
  async function dessiner(el, o) {
    /** @type {{ aujourdhui: string, etat: Etat, prix: { offre: string, periodicite: string, montantHt: string }[], options?: { option: string, periodicite: string, montantHt: string }[], aVenir?: { quoi: string, periodicite: string, aPartirDu: string, montantHt: string }[], compte?: { offre: string, comptes: Record<string, number>, inclus: Record<string, number | null> } | null, historique: { le: string, nature: string, apres: any }[], factures: FacturesAbo | null, enLigne?: boolean, modules?: string[], regles?: { essai?: number | null, grace?: number | null, relances?: number[] } }} */
    let a;
    try { a = await o.appel('GET', '/abonnement'); } catch (x) {
      el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p><button type="button" class="btn btn-sm" id="abo-relire">Réessayer</button>`;
      /** @type {HTMLElement} */ (el.querySelector('#abo-relire')).onclick = () => { void dessiner(el, o); };
      return;
    }
    const regles = a.regles || {};
    const c = etatEnClair(a.etat, regles);
    /** @param {string} offre @param {string} periodicite */
    const prixDe = (offre, periodicite) => (a.prix.find((p) => p.offre === offre && p.periodicite === periodicite) || {}).montantHt;
    // Les prix à venir (0103) : chacun se dit sous le prix d'aujourd'hui dès qu'il est préparé, à l'année puis au mois.
    /** @param {string} quoi */
    const annonces = (quoi) => ['annuel', 'mensuel'].flatMap((p) => (a.aVenir || []).filter((v) => v.quoi === quoi && v.periodicite === p)
      .map((v) => `À partir du ${jour(v.aPartirDu)} : ${montant(v.montantHt)} HT ${p === 'annuel' ? 'par an' : 'par mois'}.`));
    // Chaque carte a les mêmes lignes, dans le même ordre, même vides : la grille les aligne d'une carte à l'autre
    // (abonnement.css). Quand une offre annonce un nouveau prix, l'autre dit à la même place que le sien ne change pas.
    const avecAnnonces = ['essentiel', 'complet'].some((k) => annonces(k).length > 0);
    const offres = ['essentiel', 'complet'].map((k) => {
      const o = OFFRES[k];
      if (!o) return '';
      const an = prixDe(k, 'annuel'), mois = prixDe(k, 'mensuel');
      const courante = a.etat.etat === 'actif' && a.etat.offre === k;
      const aVenir = annonces(k);
      return `<article class="abo-offre${courante ? ' courante' : ''}" data-offre="${k}">
        <header class="abo-offre-tete"><h4>${esc(o.nom)}</h4>${courante ? '<span class="abo-badge">Ton offre</span>' : ''}</header>
        <p class="abo-pour">${esc(o.pour)}</p>
        <p class="abo-prix">${an ? `<b>${esc(montant(an).replace(/\u00a0DT$/, ''))}</b><span>DT HT par an</span>` : ''}</p>
        <p class="abo-mois">${mois ? `ou ${esc(montant(mois))} HT par mois` : ''}</p>
        ${avecAnnonces ? `<div class="abo-avenir-bloc">${aVenir.length ? aVenir.map((t) => `<p class="abo-avenir">${esc(t)}</p>`).join('')
          : '<p class="abo-avenir-rien">Aucun nouveau prix annoncé.</p>'}</div>` : ''}
        <div class="abo-offre-corps"><ul class="abo-inclus">${o.inclus.map((i) => `<li>${ICONE_COCHE}<span>${esc(i)}</span></li>`).join('')}</ul>
        ${courante && k === 'essentiel' ? `<p class="abo-pas">${esc(ceQuiResteDansComplet(a.modules))}</p>` : ''}</div>
      </article>`;
    }).join('');
    /** @param {string} option @param {string} periodicite */
    const prixOption = (option, periodicite) => ((a.options || []).find((p) => p.option === option && p.periodicite === periodicite) || {}).montantHt;
    // Chez l'entreprise, aujourd'hui (14c ; 0100) : ce qu'elle utilise sur ce que son offre comprend, compté par la
    // fonction que la facture lit ; un module acheté seul le dit. Rien pendant l'essai ou un abonnement offert.
    /** @param {typeof EN_PLUS[number]} l @returns {{ texte: string, plus: boolean }} */
    const aujourdhui = (l) => {
      const module = l.option === 'module_paie' ? 'paie' : l.option === 'module_compta' ? 'compta' : null;
      if (module) return { texte: (a.modules || []).includes(module) && a.compte ? 'Achetée pour ton abonnement.' : '', plus: false };
      const c = a.compte;
      if (!c || !l.compte || !l.mot) return { texte: '', plus: false };
      const n = Number(c.comptes[l.compte] || 0), inclus = c.inclus[l.compte];
      if (inclus === null || inclus === undefined) return { texte: '', plus: false };
      return n > inclus ? { texte: `Aujourd'hui : ${pl(n, l.mot[0], l.mot[1])}, ${n - inclus} de plus que ton offre.`, plus: true }
        : { texte: `Aujourd'hui : ${pl(n, l.mot[0], l.mot[1])} sur ${inclus} compris${l.feminin ? (inclus > 1 ? 'es' : 'e') : ''}.`, plus: false };
    };
    const enPlus = EN_PLUS.map((l) => {
      const an = prixOption(l.option, 'annuel'), mois = prixOption(l.option, 'mensuel');
      if (!an && !mois) return '';
      const auj = aujourdhui(l);
      return `<li data-option="${l.option}"><span class="abo-plus-quoi"><b>${esc(l.nom)}</b><span>${esc(l.compris)}</span>${auj.texte ? `<span class="abo-plus-auj${auj.plus ? ' en-plus' : ''}">${esc(auj.texte)}</span>` : ''}</span>
        <span class="abo-plus-prix">${an ? `<b>${esc(montant(an))} HT par an</b>` : ''}${mois ? `<span>${an ? 'ou ' : ''}${esc(montant(mois))} HT par mois</span>` : ''}${annonces(l.option).map((t) => `<span class="abo-plus-avenir">${esc(t)}</span>`).join('')}</span></li>`;
    }).join('');
    const histoire = a.historique.map((v) => `<li><span class="abo-quand">${esc(jour(String(v.le).slice(0, 10)))}</span><span>${esc(NATURES[v.nature] || v.nature)}${apresEnClair(v) ? ` <span class="muted">(${esc(apresEnClair(v))})</span>` : ''}</span></li>`).join('');
    const sujet = encodeURIComponent(a.etat.etat === 'actif' ? 'Mon abonnement SkanFact' : 'M\'abonner à SkanFact');
    // Les factures, lues comme la pièce les imprime : la fiche de l'entreprise SkanFact complétée de ses valeurs par défaut
    // par la même fonction que la v10 (`migrateData`), comme l'espace client.
    /** @type {FacturesAbo | null} */
    const fa = a.factures ? { entreprise: core().migrateData({ company: decoder(a.factures.entreprise) }).company, client: decoder(a.factures.client),
      pieces: a.factures.pieces.map((p) => ({ ...p, document: decoder(p.document) })) } : null;
    // Une facture qui doit encore passe juste sous l'état : c'est ce qu'il y a à faire. Sinon, elles se lisent plus bas.
    const aFaire = !!fa && fa.pieces.some((p) => !!p.statut && DOIT.includes(p.statut));
    const factures = fa ? sesFactures(fa) : '';
    const reglement = a.enLigne ? 'Ta facture arrive ici, dans « Tes factures » : tu la règles en ligne, ou par virement ou par chèque.'
      : 'Ta facture arrive ici, dans « Tes factures » : tu la règles par virement ou par chèque.';
    el.innerHTML = `<div class="abo">
      <section class="abo-tete ${c.ton}" id="abo-etat">
        <div class="abo-tete-txt">
          <span class="abo-pastille">${esc(c.pastille)}</span>
          <h3>${esc(c.titre)}</h3>
          <p>${esc(c.texte)}</p>
        </div>
        ${c.jauge ? `<div class="abo-jauge"><span class="abo-jauge-txt">${esc(c.jauge.texte)}</span><span class="abo-barre" aria-hidden="true"><i style="width:${Math.round(c.jauge.part * 100)}%"></i></span></div>` : ''}
      </section>
      ${aFaire ? factures : ''}
      ${a.etat.etat === 'hors' ? '' : `<div class="abo-section">
        <div class="abo-section-tete"><h3>Les offres</h3><p>Un prix par entreprise, jamais par utilisateur. Hors taxes : la TVA s'ajoute.${(a.aVenir || []).length ? ' Un nouveau prix vaut pour les périodes qui commencent à sa date : celle qui court garde le sien.' : ''}</p></div>
        <div class="abo-offres${avecAnnonces ? ' avec-avenir' : ''}">${offres}</div>
        ${enPlus ? `<div class="abo-plus" id="abo-plus">
          <div class="abo-plus-tete"><h4>Au-delà de ce que l'offre comprend</h4>
            <p>Compté le jour où ta facture se prépare, pour la période qu'elle paie. Un salarié compte tant qu'il n'est pas sorti ; ton équipe, elle, n'a pas de limite.</p></div>
          <ul class="abo-plus-liste">${enPlus}</ul>
        </div>` : ''}
      </div>
      <section class="abo-payer" id="abo-payer">
        <span class="abo-payer-ico">${ICONE_MAIL}</span>
        <div class="abo-payer-txt">
          <h4>${a.etat.etat === 'actif' ? 'Renouveler ou changer d\'offre' : 'T\'abonner'}</h4>
          <p>Écris-nous à <a href="mailto:contact@skanfact.tn?subject=${sujet}">contact@skanfact.tn</a> en disant l'offre choisie (Essentiel ou Complet, à l'année ou au mois). ${esc(reglement)} ${esc(quandCommence(a.etat))}</p>
        </div>
      </section>
      <div class="abo-section">
        <div class="abo-section-tete"><h3>À l'échéance</h3><p>Tes données restent à toi : tu peux tout télécharger à tout moment (Données et sécurité).</p></div>
        <ol class="abo-etapes">
          ${regles.relances && regles.relances.length ? `<li><b>Les rappels</b><span>Un e-mail ${esc(relancesEnMots(regles.relances))}.</span></li>` : ''}
          ${typeof regles.grace === 'number' ? (regles.grace > 0
            ? `<li><b>${esc(pl(regles.grace, 'jour'))} de grâce</b><span>Après l'échéance, tout marche encore.</span></li>`
            : '<li><b>Pas de grâce</b><span>La lecture seule commence dès le lendemain de l\'échéance.</span></li>') : ''}
          <li><b>La lecture seule</b><span>Tout se lit, s'imprime et s'exporte ; rien de nouveau ne se crée.</span></li>
        </ol>
      </div>`}
      ${fa && !aFaire ? factures : ''}
      ${histoire ? `<div class="abo-section"><div class="abo-section-tete"><h3>L'histoire de l'abonnement</h3></div><ul class="abo-histoire">${histoire}</ul></div>` : ''}
    </div>`;
    if (!fa) return;
    const refus = /** @type {HTMLElement} */ (el.querySelector('#abo-factures .abo-refus'));
    el.querySelectorAll('#abo-factures [data-voir]').forEach((b) => {
      /** @type {HTMLElement} */ (b).onclick = () => { const p = fa.pieces[Number(/** @type {HTMLElement} */ (b).dataset.voir)]; if (p) voir(el, o, fa, p); };
    });
    el.querySelectorAll('#abo-factures [data-payer]').forEach((b) => {
      const bouton = /** @type {HTMLButtonElement} */ (b);
      bouton.onclick = () => { const p = fa.pieces[Number(bouton.dataset.payer)]; if (p) void payer(o, p, bouton, refus); };
    });
  }

  w.SkanAbonnement = { licence, pastille, dessiner, etatEnClair, montant, OFFRES };
})();
