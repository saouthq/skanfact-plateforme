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
  // Le jour de Tunis d'un instant (un instant n'est pas un jour : passé 23 h en UTC, c'est déjà le lendemain à Tunis).
  /** @param {string} instant */
  const jourDeTunis = (instant) => {
    const d = new Date(instant);
    if (Number.isNaN(d.getTime())) return jour(String(instant).slice(0, 10));
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
    return jour(`${p.year}-${p.month}-${p.day}`);
  };
  /** @param {number} n @param {string} un @param {string} [plusieurs] */
  const pl = (n, un, plusieurs) => `${n}\u00a0${n > 1 ? (plusieurs || `${un}s`) : un}`;
  // Un montant du serveur (« 390.000 ») : 390 DT ; 39,500 DT s'il a des millimes, ou si un montant voisin en a
  // (`millimes`) : « 12 DT par an ou 1,200 DT par mois » se lisait « mille deux cents » (recette du 20/10/2026).
  /** @param {string} t @param {boolean} [millimes] */
  function montant(t, millimes = false) {
    const [e = '0', d = ''] = String(t).split('.');
    const entier = e.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
    return `${entier}${/^0*$/.test(d) && !millimes ? '' : `,${d.padEnd(3, '0')}`}\u00a0DT`;
  }
  // Deux prix lus côte à côte (par an, par mois) s'écrivent de la même façon : avec leurs millimes dès que l'un en a.
  /** @param {...(string | undefined)} prix */
  const avecMillimes = (...prix) => prix.some((x) => x && !/^0*$/.test(String(x).split('.')[1] || ''));

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
  // offre — pas un paragraphe qu'on ne relit pas. Les fonctions sont celles de l'application ; les nombres (caisses,
  // établissements, salariés) et les modules (la paie, la comptabilité complète) viennent du serveur, que la direction
  // règle dans la console (0105) : aucun nombre n'est écrit ici.
  /** @typedef {{ caisses?: number | null, etablissements?: number | null, salaries?: number | null, paie?: number | null, compta?: number | null }} Contenu */
  const OFFRES = /** @type {Record<string, { nom: string, pour: string, de: string }>} */ ({
    essentiel: { nom: 'Essentiel', pour: 'Tout ce qu\'il faut pour vendre, encaisser et déclarer.', de: 'd\'Essentiel' },
    complet: { nom: 'Complet', pour: 'Pour une entreprise qui paie des salariés et tient sa comptabilité.', de: 'de Complet' },
  });
  const MOTS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze',
    'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf', 'vingt'];
  // Un nombre comme on l'écrit dans une phrase : en lettres jusqu'à vingt (« une caisse », « deux établissements »), en
  // chiffres au-delà.
  /** @param {number} n @param {boolean} [feminin] */
  const enMots = (n, feminin) => (n === 1 && feminin ? 'une' : MOTS[n] || String(n));
  /** @param {string} t */
  const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  /** @param {number} n @param {string} un @param {string} plusieurs @param {boolean} [feminin] */
  const compte = (n, un, plusieurs, feminin) => `${enMots(n, feminin)} ${n > 1 ? plusieurs : un}`;
  /** @param {unknown} v @returns {number | null} */
  const nombreDe = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  const MODULES = /** @type {Record<string, string>} */ ({ paie: 'la paie', compta: 'la comptabilité complète' });
  /** @param {string[]} ms */
  const enListe = (ms) => ms.map((m) => MODULES[m] || m).join(' et ');

  // Les lignes d'une carte : les fonctions de l'offre, puis ce qu'elle compte. Un nombre inconnu ne se dit pas.
  /** @param {string} k @param {Contenu} c */
  function inclusDe(k, c) {
    const caisses = nombreDe(c.caisses), etab = nombreDe(c.etablissements), salaries = nombreDe(c.salaries);
    const paie = c.paie === 1 ? `La paie${salaries !== null ? `, jusqu'à ${compte(salaries, 'salarié', 'salariés')}` : ''}` : '';
    const compta = c.compta === 1 ? 'La comptabilité complète' : '';
    const lesCaisses = caisses === null ? '' : caisses === 0 ? 'Pas de caisse au comptoir' : majuscule(`${compte(caisses, 'caisse', 'caisses', true)} au comptoir`);
    const equipe = `Des utilisateurs sans limite${etab === null ? '' : `, ${etab === 0 ? 'sans établissement' : compte(etab, 'établissement', 'établissements')}`}`;
    if (k === 'complet') return ['Tout Essentiel', paie, compta, lesCaisses, equipe].filter(Boolean);
    return ['Devis, factures, avoirs, clients et catalogue', 'Achats, fournisseurs et stock', lesCaisses, 'La banque et la trésorerie',
      'La facture électronique, la retenue à la source et la déclaration du mois', 'L\'espace client et le paiement en ligne',
      'Ton comptable dans les mêmes données', paie, compta, equipe].filter(Boolean);
  }

  // Ce qui changera à une date (0105), comme on l'annonce sous le prix : « À partir du 01/12/2026 : trois caisses
  // comprises. »
  /** @param {{ quoi: string, nombre: number, aPartirDu: string }} v */
  function changementEnClair(v) {
    const n = v.nombre;
    const quoi = v.quoi === 'caisses' ? (n === 0 ? 'plus aucune caisse comprise' : `${compte(n, 'caisse', 'caisses', true)} comprise${n > 1 ? 's' : ''}`)
      : v.quoi === 'etablissements' ? (n === 0 ? 'plus aucun établissement compris' : `${compte(n, 'établissement', 'établissements')} compris`)
        : v.quoi === 'salaries' ? `la paie compte jusqu'à ${compte(n, 'salarié', 'salariés')}`
          : MODULES[v.quoi] ? (n === 1 ? `${MODULES[v.quoi]} comprise` : `${MODULES[v.quoi]} n'est plus comprise : elle s'achète seule`) : '';
    return quoi ? `À partir du ${jour(v.aPartirDu)} : ${quoi}.` : '';
  }

  // Ce qui s'ajoute à l'offre (14c ; skanfact docs/cadrage/07-offres-et-prix.md, « Au-delà de l'offre ») : ce que chaque
  // ligne compte, et ce que chaque offre en comprend déjà (le contenu du jour). Les prix sont ceux du jour, lus au
  // serveur ; une ligne sans prix ne s'affiche pas, ni un module que les deux offres contiennent.
  // `compte` : ce que l'entreprise en utilise (0100, plateforme.comptes_de_l_entreprise), et comment le dire.
  /** @typedef {{ essentiel?: Contenu, complet?: Contenu }} Contenus */
  const EN_PLUS = /** @type {{ option: string, nom: string, compris: (c: Contenus) => string, compte?: string, mot?: [string, string], feminin?: boolean }[]} */ ([
    { option: 'caisse', nom: 'Une caisse de plus', compris: (c) => comprend(c, 'caisses', true), compte: 'caisses', mot: ['caisse', 'caisses'], feminin: true },
    { option: 'etablissement', nom: 'Un établissement de plus', compris: (c) => comprend(c, 'etablissements'), compte: 'etablissements', mot: ['établissement', 'établissements'] },
    { option: 'salarie', nom: 'Un salarié de plus dans la paie', compris: (c) => {
      const e = nombreDe(c.essentiel?.salaries), x = nombreDe(c.complet?.salaries);
      return e === null || x === null ? '' : `La paie en comprend ${enMots(e)} sur Essentiel, ${enMots(x)} sur Complet.`;
    }, compte: 'salaries', mot: ['salarié', 'salariés'] },
    { option: 'module_paie', nom: 'La paie, seule', compris: (c) => seule(c, 'paie') },
    { option: 'module_compta', nom: 'La comptabilité complète, seule', compris: (c) => seule(c, 'compta') },
  ]);
  /** @param {Contenus} c @param {'caisses' | 'etablissements'} quoi @param {boolean} [feminin] */
  function comprend(c, quoi, feminin) {
    const e = nombreDe(c.essentiel?.[quoi]), x = nombreDe(c.complet?.[quoi]);
    if (e === null || x === null) return '';
    const aucun = feminin ? 'aucune' : 'aucun';
    return `Essentiel ${e === 0 ? `n'en comprend ${aucun}` : `en comprend ${enMots(e, feminin)}`} ; Complet, ${x === 0 ? aucun : enMots(x, feminin)}.`;
  }
  // Un module acheté seul : sur l'offre qui ne le contient pas. Vide quand les deux le contiennent (la ligne se tait).
  /** @param {Contenus} c @param {'paie' | 'compta'} m */
  function seule(c, m) {
    const e = c.essentiel?.[m], x = c.complet?.[m];
    if (e === 1 && x === 1) return '';
    if (e === 0 && x === 1) return 'Sur Essentiel ; Complet la contient.';
    if (e === 1 && x === 0) return 'Sur Complet ; Essentiel la contient.';
    return e === 0 && x === 0 ? 'Sur Essentiel comme sur Complet : aucune offre ne la contient.' : '';
  }
  /** @param {string | undefined} o */
  const nomOffre = (o) => (o && OFFRES[o] ? OFFRES[o].nom : 'Abonnement');

  // Sur la carte de son offre (14c) : les modules achetés en plus, et ceux qu'elle ne contient pas (`fermes`, la même
  // fonction que la porte du serveur) — ce qui existe s'y lit, rien de nouveau ne s'y crée.
  /** @param {string} k @param {Contenus} contenus @param {unknown} modules @param {unknown} fermes */
  function ceQuiNEstPasDansLOffre(k, contenus, modules, fermes) {
    const o = OFFRES[k], autre = k === 'essentiel' ? 'complet' : 'essentiel';
    if (!o) return '';
    const ici = contenus[/** @type {'essentiel' | 'complet'} */ (k)] || {};
    const achetes = (Array.isArray(modules) ? modules : []).filter((m) => MODULES[m] && ici[/** @type {'paie' | 'compta'} */ (m)] === 0);
    const ferme = (Array.isArray(fermes) ? fermes : []).filter((m) => MODULES[m]);
    const phrases = [];
    if (achetes.length) phrases.push(`${majuscule(enListe(achetes))} ${achetes.length > 1 ? 'sont achetées' : 'est achetée'} en plus ${o.de}.`);
    if (ferme.length) {
      const la = contenus[/** @type {'essentiel' | 'complet'} */ (autre)] || {};
      const ailleurs = ferme.every((m) => la[/** @type {'paie' | 'compta'} */ (m)] === 1);
      const sujet = majuscule(enListe(ferme)), plus = ferme.length > 1;
      phrases.push(ailleurs ? `${sujet} ${plus ? 'sont' : 'est'} dans ${nomOffre(autre)} : ce qui existe se lit, mais rien de nouveau ne s'y crée.`
        : `${sujet} ${plus ? 'ne sont pas' : 'n\'est pas'} dans ${o.nom} : ce qui existe se lit, mais rien de nouveau ne s'y crée ; ${plus ? 'elles s\'achètent seules' : 'elle s\'achète seule'}.`);
    }
    return phrases.join(' ');
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
  // `regles` : la durée de son essai et ses relances (0104), quand on les connaît. `suite` (1.118.0 ; la revue du
  // 22/10/2026) : ce qui attend (une facture à régler, un choix dont la facture se prépare), si l'essai a été prolongé
  // (sa durée n'est plus celle de la règle), et les rappels déjà partis pour l'échéance qui vient.
  /** @typedef {{ aFaire?: 'payer' | 'attendre' | null, prolonge?: boolean, rappels?: { rang: string, le: string }[], periode?: { debut: string, offre: string, periodicite: string } | null }} Suite */
  /** @param {Etat} e @param {{ essai?: number | null, relances?: number[] }} [regles] @param {Suite} [suite] @returns {{ ton: string, pastille: string, titre: string, texte: string, jauge: { texte: string, part: number } | null }} */
  function etatEnClair(e, regles = {}, suite = {}) {
    if (e.etat === 'hors') {
      return { ton: 'calme', pastille: 'Sans échéance', titre: 'Rien ne s\'arrête ici', jauge: null, texte: ({ bac_a_sable: 'C\'est une entreprise d\'essai : elle ne s\'arrête jamais, et rien n\'y est facturé.',
        tenu_par_cabinet: 'Ton cabinet tient ce dossier : c\'est lui qui le paie.', offert: 'SkanFact t\'offre cet abonnement : il ne s\'arrête pas.',
        inconnu: 'Cette entreprise n\'a pas encore d\'abonnement : rien ne s\'y ferme.' })[e.raison || ''] || '' };
    }
    if (e.etat === 'essai') {
      const j = Number(e.jours);
      return { ton: j <= 7 ? 'attire' : 'calme', pastille: 'Essai gratuit', titre: j <= 0 ? 'Dernier jour de ton essai' : `Encore ${pl(j, 'jour')} d'essai`,
        // (1.121.0) L'offre choisie, l'état le dit (recette du 23/10/2026) : il répétait « Ce que tu crées… » comme si rien
        // n'était fait, la facture en attente plus bas.
        texte: `Jusqu'au ${jour(e.jusquAu)}, tout est ouvert, sans carte. ${suite.aFaire === 'payer' && suite.periode
          ? `Ensuite : ${nomOffre(suite.periode.offre)}, ${suite.periode.periodicite === 'mensuel' ? 'au mois' : 'à l\'année'}, dès le ${jour(suite.periode.debut)}. Ta facture t'attend juste en dessous : réglée d'ici là, rien ne s'arrête.`
          : suite.aFaire === 'attendre' ? 'Ta facture se prépare sur l\'offre que tu as choisie : un e-mail te prévient quand elle est prête.'
            : 'Ce que tu crées pendant l\'essai reste quand tu t\'abonnes : rien à ressaisir.'}`,
        // La part de l'essai qui reste : sur sa durée (celle de sa création), ou plus s'il a été prolongé ; sans elle, la
        // jauge ne dit que les jours qui restent.
        // Prolongé, l'essai ne dure plus « 30 jours » : la jauge dit les jours qui restent, sans un total faux (« 19 jours
        // sur 30 » d'un essai de 44 jours, revue du 22/10/2026).
        jauge: (() => {
          const sur = regles.essai && !suite.prolonge ? Math.max(regles.essai, j) : null;
          const part = sur ? Math.max(0, Math.min(1, j / sur)) : regles.essai ? Math.max(0, Math.min(1, j / Math.max(regles.essai, j))) : 1;
          return { texte: j <= 0 ? 'Dernier jour' : sur ? `${pl(j, 'jour')} sur ${sur}` : `${pl(j, 'jour')} ${j > 1 ? 'restants' : 'restant'}`, part };
        })() };
    }
    if (e.etat === 'actif') {
      const j = Number(e.jours);
      return { ton: j <= 15 ? 'attire' : 'calme', pastille: e.resilie ? 'Ne se renouvelle pas' : `${nomOffre(e.offre)} · ${e.periodicite === 'mensuel' ? 'au mois' : 'à l\'année'}`,
        titre: `Payé jusqu'au ${jour(e.jusquAu)}`, jauge: null,
        texte: e.resilie ? 'Il ne se renouvelle pas : l\'abonnement s\'arrête à cette date, puis l\'entreprise passe en lecture seule. Tu peux le reprendre jusque-là.'
          : j <= 0 ? 'C\'est le dernier jour de la période payée.'
            : `Encore ${pl(j, 'jour')}.${rappelEnClair(j, regles.relances || [], suite.rappels || [])}` };
    }
    if (e.etat === 'en_retard') {
      const j = Number(e.jours);
      // La grâce de cette échéance : du lendemain de l'échéance à la veille de la lecture seule.
      const grace = Math.max(1, joursEntre(String(e.echeance), String(e.lectureSeuleLe)) - 1);
      // « À régler » quand une facture attend son paiement ; sinon il n'y a rien à régler : il faut d'abord choisir.
      return { ton: 'alerte', pastille: suite.aFaire === 'payer' ? 'À régler' : e.apresEssai ? 'Essai terminé' : 'Abonnement échu',
        titre: e.apresEssai ? `L'essai est terminé depuis le ${jour(plusJours(String(e.echeance), 1))}` : `L'abonnement est échu depuis le ${jour(plusJours(String(e.echeance), 1))}`,
        texte: `Tout marche encore jusqu'au ${jour(plusJours(String(e.lectureSeuleLe), -1))}. Le ${jour(e.lectureSeuleLe)}, l'entreprise passe en lecture seule : tout se lit, s'imprime et s'exporte, mais rien de nouveau ne se crée.${pourRouvrir(suite, true)}`,
        jauge: { texte: `Encore ${pl(j, 'jour')} de grâce, sur ${grace}`, part: Math.max(0, Math.min(1, j / grace)) } };
    }
    // Suspendue par SkanFact, s'abonner ne la rouvre pas : il faut nous écrire (revue du 22/10/2026).
    if (e.raison === 'suspendu') {
      return { ton: 'alerte', pastille: 'Suspendu', titre: `En lecture seule depuis le ${jour(e.depuis)}`, jauge: null,
        texte: 'SkanFact a suspendu l\'abonnement. Tout se lit, s\'imprime et s\'exporte ; tes données restent à toi. Pour rouvrir l\'entreprise, écris-nous à contact@skanfact.tn.' };
    }
    return { ton: 'alerte', pastille: 'Lecture seule', titre: `En lecture seule depuis le ${jour(e.depuis)}`, jauge: null,
      texte: `${pourquoi(e)} Tout se lit, s'imprime et s'exporte ; tes données restent à toi.${pourRouvrir(suite, false)}` };
  }

  // Ce qui rouvre, dit tel que ça se passe : choisir son offre, régler sa facture, puis tout se rouvre (« abonne-toi :
  // tout se rouvre aussitôt » n'était pas vrai, revue du 22/10/2026). `grace` : rien n'est encore fermé.
  /** @param {Suite} suite @param {boolean} grace */
  function pourRouvrir(suite, grace) {
    if (grace) {
      if (suite.aFaire === 'payer') return ' Règle ta facture, juste en dessous, avant cette date : rien ne se fermera.';
      if (suite.aFaire === 'attendre') return ' Ta facture se prépare sur l\'offre que tu as choisie : un e-mail te prévient quand elle est prête. Réglée avant cette date, rien ne se ferme.';
      return ' Choisis ton offre : ta facture arrive ici, et réglée avant cette date, rien ne se ferme.';
    }
    if (suite.aFaire === 'payer') return ' Règle ta facture, juste en dessous : dès que le paiement est confirmé, tout se rouvre, tel que tu l\'as laissé.';
    if (suite.aFaire === 'attendre') return ' Ta facture se prépare sur l\'offre que tu as choisie : un e-mail te prévient quand elle est prête. Dès qu\'elle est réglée, tout se rouvre.';
    return ' Choisis ton offre : ta facture arrive ici, et dès qu\'elle est réglée, tout se rouvre, tel que tu l\'as laissé.';
  }

  // Le rappel de l'échéance qui vient, tel qu'il est : déjà parti (avec son jour), ou celui qui partira — jamais
  // « un rappel part 15 jours avant » quand il est parti il y a cinq jours (revue du 22/10/2026). `j` : les jours qui
  // restent ; `relances` : les jours de la règle (0104) ; `partis` : ceux déjà envoyés (0170).
  /** @param {number} j @param {number[]} relances @param {{ rang: string, le: string }[]} partis */
  function rappelEnClair(j, relances, partis) {
    const avant = partis.filter((p) => p.rang !== 'lecture_seule').map((p) => p.le).sort();
    const dernier = avant[avant.length - 1];
    const prochain = relances.filter((n) => n < j).sort((a, b) => b - a)[0];
    const suivant = prochain === undefined ? '' : prochain === 1 ? 'la veille de l\'échéance' : `${pl(prochain, 'jour')} avant l'échéance`;
    if (dernier) return ` Un rappel t'a été envoyé par e-mail le ${jour(dernier)}${suivant ? ` ; le prochain partira ${suivant}` : ''}.`;
    return suivant ? ` Un rappel partira par e-mail ${suivant}.` : '';
  }

  // Quand commence la période qu'on paie : la même règle que le serveur (prochainePeriode, serveur/abonnement/etat.ts).
  /** @param {Etat} e */
  function quandCommence(e) {
    if (e.etat === 'essai') return 'L\'abonnement commence à la fin de ton essai : les jours d\'essai qui restent ne se perdent pas.';
    if (e.etat === 'actif') return 'La nouvelle période prend la suite de celle qui est payée : aucun jour ne se perd.';
    if (e.etat === 'en_retard') return `Réglé avant le ${jour(e.lectureSeuleLe)}, l'abonnement prend la suite de l'échéance, sans interruption.`;
    return 'L\'abonnement commence le jour du paiement : tout se rouvre dès qu\'il est confirmé.';
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

  // La remise de sa prochaine période (0106 ; docs/abonnement.md C17) : laquelle, et pourquoi. Jamais le nom d'une autre
  // société (la base ne le rend pas) ; les prix des cartes restent ceux de la grille, avant la remise.
  /** @typedef {{ nature: 'groupe' | 'cabinet', taux: number, groupe: string | null, cabinet: string | null, jusquAu: string | null }} Remise */
  /** @param {Remise} r */
  function remiseEnClair(r) {
    const pourquoi = r.nature === 'groupe'
      ? `Remise de groupe${r.groupe ? ` (${r.groupe})` : ''} : la première société abonnée du groupe paie le prix normal, les suivantes ont la remise.`
      : `Ton entreprise est venue par son cabinet${r.cabinet ? `, ${r.cabinet}` : ''} : la remise vaut pour chaque période qui commence${r.jusquAu ? ` au plus tard le ${jour(r.jusquAu)}` : ' dans sa première année'}.`;
    return `<div class="abo-remise" id="abo-remise"><b>−${r.taux} % sur ta prochaine facture</b><span>${esc(pourquoi)}</span>
      <span>Elle porte sur tout le hors taxes de la facture, l'offre et ce qui s'ajoute. Les prix ci-dessous sont ceux d'avant la remise.</span></div>`;
  }

  // L'année contre douze mois (revue du 22/10/2026 : « deux mois offerts », que l'écran ne disait pas). Calculé sur les
  // prix du jour, en millimes : des mois entiers offerts se disent en mois, sinon l'économie se dit en dinars ; rien quand
  // l'année ne coûte pas moins.
  /** @param {string | undefined} an @param {string | undefined} mois */
  function aLAnnee(an, mois) {
    const enMillimes = (/** @type {string} */ t) => { const [e = '0', d = ''] = String(t).split('.'); return BigInt(e) * 1000n + BigInt((d + '000').slice(0, 3)); };
    if (!an || !mois) return '';
    const a = enMillimes(an), m = enMillimes(mois), economie = m * 12n - a;
    if (m <= 0n || economie <= 0n) return '';
    if (economie % m === 0n) { const n = Number(economie / m); return `À l'année, ${n === 1 ? 'un mois offert' : `${enMots(n)} mois offerts`}.`; }
    const t = `${economie / 1000n}.${String(economie % 1000n).padStart(3, '0')}`;
    return `À l'année, ${montant(t)} d'économie sur douze mois.`;
  }

  // Le choix d'une offre (1.84.0 ; 1.118.0 : un bouton par offre et par durée, dans sa carte). Le bouton ouvre le
  // récapitulatif (1.121.0 : le prix, la remise, le total à régler, ce qui se passe ensuite) avec « Annuler » et la
  // confirmation : rien ne part au premier clic. Envoyé, l'onglet se redessine et dit ce qui a été choisi. Un refus se dit
  // dans le récapitulatif.
  /** @typedef {{ prixDe: (offre: string, periodicite: string) => string | undefined, netDe: (offre: string, periodicite: string) => string | undefined, remise: Remise | null, etat: Etat, enLigne: boolean, auto: boolean }} InfosChoix */
  /** @param {HTMLElement} el @param {Outils} o @param {InfosChoix} infos */
  function brancherChoix(el, o, infos) {
    const offres = /** @type {HTMLElement | null} */ (el.querySelector('.abo-offres'));
    const tete = /** @type {HTMLElement | null} */ (el.querySelector('#abo-aller-offres'));
    if (tete && offres) tete.onclick = () => {
      /** @type {HTMLElement} */ (el.querySelector('#abo-offres')).scrollIntoView({ block: 'start', behavior: 'smooth' });
      /** @type {HTMLElement | null} */ (offres.querySelector('[data-choisir]'))?.focus({ preventScroll: true });
    };
    const re = /** @type {HTMLButtonElement | null} */ (el.querySelector('#abo-rechoisir'));
    if (re && offres) re.onclick = () => {
      offres.classList.remove('abo-replie'); re.disabled = true;
      /** @type {HTMLElement} */ (el.querySelector('#abo-offres')).scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    // Une seule confirmation ouverte à la fois ; pendant qu'elle l'est, son bouton est le seul vert de l'onglet.
    const fermer = () => {
      el.querySelectorAll('[data-choisir]').forEach((b) => b.removeAttribute('aria-pressed'));
      if (tete) tete.classList.add('btn-primary');
    };
    el.querySelectorAll('[data-choisir]').forEach((x) => {
      const b = /** @type {HTMLButtonElement} */ (x);
      b.onclick = () => {
        const [offre = '', periodicite = ''] = String(b.dataset.choisir).split(':');
        const ht = infos.prixDe(offre, periodicite);
        if (!ht) return;
        fermer();
        b.setAttribute('aria-pressed', 'true');
        if (tete) tete.classList.remove('btn-primary');
        const nom = (OFFRES[offre] || { nom: offre }).nom, dit = periodicite === 'annuel' ? 'à l\'année' : 'au mois';
        const par = periodicite === 'annuel' ? 'par an' : 'par mois';
        const actif = infos.etat.etat === 'actif';
        const ttc = infos.netDe(offre, periodicite);
        const d = dialogue(el, {
          titre: `${esc(nom)}, ${dit}`,
          corps: `<dl class="abo-recap">
              <div><dt>Abonnement ${esc(nom)}</dt><dd>${esc(montant(ht))} HT ${par}</dd></div>
              ${infos.remise ? `<div><dt>Remise de ${esc(String(infos.remise.taux))} %</dt><dd>déduite sur la facture</dd></div>` : ''}
              ${ttc ? `<div class="abo-recap-total"><dt>Total à régler${infos.remise ? ', avant la remise' : ''}<span>TVA et timbre fiscal compris</span></dt><dd>${esc(montant(ttc, true))} ${par}</dd></div>` : ''}
            </dl>
            <ul class="abo-suite">
              <li>${actif ? 'Pour la période qui suit celle qui est payée. ' : ''}${infos.auto ? 'Ta facture est faite tout de suite : elle arrive ici, dans « Tes factures », et un e-mail te la confirme.' : 'SkanFact prépare ta facture sur ce choix : elle arrive ici, dans « Tes factures », et un e-mail te prévient quand elle est prête.'}</li>
              <li>Rien n'est payé avant que tu la règles${infos.enLigne ? ', en ligne ou par virement' : ', par virement ou par chèque'}.</li>
              <li>${esc(quandCommence(infos.etat))}</li>
            </ul>`,
          gestes: `<button type="button" class="btn" data-annuler>Annuler</button><button type="button" class="btn btn-primary" data-confirmer>Je choisis ${esc(nom)}, ${dit}</button>`,
          fermee: () => { fermer(); b.focus(); },
        });
        const refus = /** @type {HTMLElement} */ (d.querySelector('.abo-refus'));
        const ok = /** @type {HTMLButtonElement} */ (d.querySelector('[data-confirmer]'));
        ok.onclick = async () => {
          ok.disabled = true; refus.hidden = true;
          try { await o.appel('POST', '/abonnement/choisir', { offre, periodicite }); } catch (e) {
            refus.textContent = e instanceof Error ? e.message : String(e); refus.hidden = false; ok.disabled = false; return;
          }
          d.close();
          await dessiner(el, o);
          /** @type {HTMLElement | null} */ (el.querySelector('#abo-payer'))?.scrollIntoView({ block: 'nearest' });
        };
      };
    });
  }

  // (1.121.0) Le récapitulatif d'un geste qui engage (choisir une offre, ouvrir un module), dans une fenêtre au-dessus de
  // l'onglet. Ouvert dans la carte de l'offre (recette du 23/10/2026), il poussait sa liste vers le bas et laissait un
  // trou dans la carte voisine ; le total à régler, TVA et timbre compris, n'y était pas redit. « Annuler », Échap ou un
  // clic à côté la referment sans rien faire.
  /** @param {HTMLElement} el @param {{ titre: string, corps: string, gestes: string, fermee: () => void }} d */
  function dialogue(el, d) {
    let dlg = /** @type {HTMLDialogElement | null} */ (el.querySelector('#abo-dialogue'));
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'abo-dialogue'; dlg.className = 'abo-dialogue'; el.appendChild(dlg); }
    const f = dlg;
    f.setAttribute('aria-labelledby', 'abo-dialogue-titre');
    f.innerHTML = `<h3 id="abo-dialogue-titre">${d.titre}</h3>${d.corps}<p class="small abo-refus" role="alert" hidden></p>
      <div class="abo-confirmer-gestes">${d.gestes}</div>`;
    f.onclose = () => d.fermee();
    f.onclick = (e) => { if (e.target === f) f.close(); };
    /** @type {HTMLElement} */ (f.querySelector('[data-annuler]')).onclick = () => f.close();
    if (!f.open) f.showModal();
    return f;
  }

  // « Ne pas renouveler » (1.119.0 ; 0171) : ce qui se passera, avant le geste ; « Garder mon abonnement »
  // referme sans rien faire. « Reprendre mon abonnement » : d'un clic, tant que la période court.
  /** @param {HTMLElement} el @param {Outils} o @param {Etat} etat */
  function brancherRenouvellement(el, o, etat) {
    /** @param {boolean} renouveler @param {HTMLButtonElement} b @param {HTMLElement | null} refus */
    const poser = async (renouveler, b, refus) => {
      b.disabled = true; if (refus) refus.hidden = true;
      try { await o.appel('POST', '/abonnement/renouvellement', { renouveler }); } catch (e) {
        if (refus) { refus.textContent = e instanceof Error ? e.message : String(e); refus.hidden = false; }
        b.disabled = false; return;
      }
      const ouverte = /** @type {HTMLDialogElement | null} */ (el.querySelector('#abo-dialogue'));
      if (ouverte && ouverte.open) ouverte.close();
      await dessiner(el, o);
    };
    const reprendre = /** @type {HTMLButtonElement | null} */ (el.querySelector('#abo-reprendre'));
    if (reprendre) reprendre.onclick = () => { void poser(true, reprendre, null); };
    const arreter = /** @type {HTMLButtonElement | null} */ (el.querySelector('#abo-arreter'));
    if (!arreter) return;
    // (1.121.0) Dans la même fenêtre que les autres gestes qui engagent : ouverte dans la page, elle poussait les offres.
    arreter.onclick = () => {
      const d = dialogue(el, {
        titre: 'Ne pas renouveler ton abonnement ?',
        corps: `<ul class="abo-suite">
            <li>Ton abonnement va jusqu'au <b>${esc(jour(etat.jusquAu))}</b>, puis l'entreprise passe en lecture seule.</li>
            <li>Tout se lira, s'imprimera et s'exportera ; rien de nouveau ne se créera.</li>
            <li>Tu pourras le reprendre d'un clic jusqu'à cette date.</li>
          </ul>`,
        gestes: '<button type="button" class="btn" data-arreter>Ne pas renouveler</button><button type="button" class="btn btn-primary" data-annuler>Garder mon abonnement</button>',
        fermee: () => arreter.focus(),
      });
      const ok = /** @type {HTMLButtonElement} */ (d.querySelector('[data-arreter]'));
      // Posé, la fenêtre se referme et l'onglet se redessine ; refusé, elle reste ouverte et dit pourquoi.
      ok.onclick = () => { void poser(false, ok, /** @type {HTMLElement} */ (d.querySelector('.abo-refus'))); };
    };
  }

  // Ouvrir la paie ou la comptabilité complète tout de suite (1.119.0 ; 0171) : la confirmation dit ce que la prochaine
  // facture rattrapera, lu au serveur (rien n'est compté ici), puis le geste.
  /** @param {HTMLElement} el @param {Outils} o */
  function brancherModules(el, o) {
    el.querySelectorAll('[data-module]').forEach((x) => {
      const b = /** @type {HTMLButtonElement} */ (x);
      b.onclick = async () => {
        const module = String(b.dataset.module);
        /** @type {any} */
        let ap;
        try { ap = await o.appel('POST', '/abonnement/module', { module, apercu: true }); } catch (e) {
          dialogue(el, { titre: 'Impossible pour l\'instant', corps: `<p class="abo-refus" role="alert">${esc(e instanceof Error ? e.message : e)}</p>`,
            gestes: '<button type="button" class="btn" data-annuler>Fermer</button>', fermee: () => b.focus() });
          return;
        }
        const nom = MODULES[module] || module;
        const par = ap.periodicite === 'annuel' ? 'par an' : 'par mois';
        const d = dialogue(el, {
          titre: `${esc(majuscule(nom))} s'ouvre aujourd'hui`,
          corps: `<dl class="abo-recap">
              <div><dt>Prix de ${esc(nom)}</dt><dd>${esc(montant(String(ap.prixHt), true))} HT ${par}</dd></div>
              ${Number(ap.jours) > 0 ? `<div class="abo-recap-total"><dt>Rattrapé sur ta prochaine facture<span>du ${esc(jour(ap.du))} au ${esc(jour(ap.au))}, ${esc(pl(Number(ap.jours), 'jour'))} sur ${esc(String(ap.sur))}</span></dt><dd>${esc(montant(String(ap.rattrapageHt), true))} HT</dd></div>` : ''}
            </dl>
            <ul class="abo-suite"><li>${Number(ap.jours) > 0
              ? 'Ensuite, chaque facture la compte, tant que tu la gardes.'
              : 'Rien à rattraper pour les jours qui restent : ta prochaine facture la compte, puis chaque période, tant que tu la gardes.'}</li></ul>`,
          gestes: `<button type="button" class="btn" data-annuler>Annuler</button><button type="button" class="btn btn-primary" data-ouvrir>Ouvrir ${esc(nom)}</button>`,
          fermee: () => b.focus(),
        });
        const ok = /** @type {HTMLButtonElement} */ (d.querySelector('[data-ouvrir]'));
        const refus = /** @type {HTMLElement} */ (d.querySelector('.abo-refus'));
        ok.onclick = async () => {
          ok.disabled = true; refus.hidden = true;
          try { await o.appel('POST', '/abonnement/module', { module }); } catch (e) {
            refus.textContent = e instanceof Error ? e.message : String(e); refus.hidden = false; ok.disabled = false; return;
          }
          d.close();
          await dessiner(el, o);
        };
      };
    });
  }

  /** @param {HTMLElement} el @param {Outils} o */
  async function dessiner(el, o) {
    /** @type {{ aujourdhui: string, etat: Etat, prix: { offre: string, periodicite: string, montantHt: string, net?: string | null }[], options?: { option: string, periodicite: string, montantHt: string }[], aVenir?: { quoi: string, periodicite: string, aPartirDu: string, montantHt: string }[], compte?: { offre: string, comptes: Record<string, number>, inclus: Record<string, number | null> } | null, historique: { le: string, nature: string, apres: any }[], factures: FacturesAbo | null, enLigne?: boolean, modules?: string[], regles?: { essai?: number | null, grace?: number | null, relances?: number[] }, contenu?: { duJour?: Contenus, aVenir?: { offre: string, quoi: string, nombre: number, aPartirDu: string }[] }, fermes?: string[], remise?: Remise | null, choix?: { offre: string, periodicite: string, le: string, par: string | null, refuse?: boolean } | null, peutChoisir?: boolean, auto?: boolean, prochaine?: { debut: string, offre: string, periodicite: string, montantHt: string, remise: number | null } | null, rappels?: { rang: string, le: string }[] }} */
    let a;
    try { a = await o.appel('GET', '/abonnement'); } catch (x) {
      el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p><button type="button" class="btn btn-sm" id="abo-relire">Réessayer</button>`;
      /** @type {HTMLElement} */ (el.querySelector('#abo-relire')).onclick = () => { void dessiner(el, o); };
      return;
    }
    const regles = a.regles || {};
    // Une facture qui doit encore passe juste sous l'état : c'est ce qu'il y a à faire (calculé ici, avant l'état, qui le dit).
    const aFaire = !!a.factures && a.factures.pieces.some((p) => !!p.statut && DOIT.includes(p.statut));
    const aRegler = a.factures ? a.factures.pieces.find((p) => !!p.statut && DOIT.includes(p.statut) && !!p.periode) : undefined;
    const c = etatEnClair(a.etat, regles, { aFaire: aFaire ? 'payer' : a.choix ? 'attendre' : null,
      prolonge: a.historique.some((v) => v.nature === 'essai_prolonge'), rappels: a.rappels || [], periode: aRegler ? aRegler.periode : null });
    // Choisir son offre ici (1.84.0, 0158 ; 1.118.0 : un bouton par offre) : qui peut payer l'abonnement, quand aucune
    // facture n'attend son paiement, et pour une entreprise qui a un abonnement que SkanFact n'a pas suspendu.
    const suspendue = a.etat.etat === 'lecture_seule' && a.etat.raison === 'suspendu';
    const resilie = a.etat.etat === 'actif' && !!a.etat.resilie;
    // Résilié pendant sa période payée, l'abonnement se reprend d'abord (1.119.0) : un choix n'y aurait pas de facture.
    const peutChoisirIci = !!a.peutChoisir && !aFaire && a.etat.etat !== 'hors' && !suspendue && !resilie;
    /** @param {string} offre @param {string} periodicite */
    const prixDe = (offre, periodicite) => (a.prix.find((p) => p.offre === offre && p.periodicite === periodicite) || {}).montantHt;
    // Ce que chaque offre comprend aujourd'hui, et ce qui changera (0105).
    const contenus = (a.contenu && a.contenu.duJour) || {};
    const changements = (a.contenu && a.contenu.aVenir) || [];
    // Les prix à venir (0103) : chacun se dit sous le prix d'aujourd'hui dès qu'il est préparé, à l'année puis au mois ;
    // sur la carte d'une offre, ensuite, ce qu'elle comprendra (0105), par date.
    /** @param {string} quoi */
    const annonces = (quoi) => ['annuel', 'mensuel'].flatMap((p) => (a.aVenir || []).filter((v) => v.quoi === quoi && v.periodicite === p)
      .map((v) => `À partir du ${jour(v.aPartirDu)} : ${montant(v.montantHt)} HT ${p === 'annuel' ? 'par an' : 'par mois'}.`))
      .concat(changements.filter((v) => v.offre === quoi).map(changementEnClair).filter(Boolean));
    // Chaque carte a les mêmes lignes, dans le même ordre, même vides : la grille les aligne d'une carte à l'autre
    // (abonnement.css). Quand une offre annonce un changement, l'autre dit à la même place que rien ne change pour elle.
    const avecAnnonces = ['essentiel', 'complet'].some((k) => annonces(k).length > 0);
    // Ce que la facture d'une offre coûtera, TVA et timbre compris (1.119.0) : calculé au serveur par le moteur de
    // l'entreprise SkanFact ; rien quand il ne le sait pas.
    /** @param {string} k */
    const ttcDe = (k) => {
      const net = (/** @type {string} */ p) => (a.prix.find((x) => x.offre === k && x.periodicite === p) || {}).net;
      const an = net('annuel'), mois = net('mensuel');
      if (!an && !mois) return '';
      return `TVA et timbre compris : ${[an ? `${montant(an, true)} par an` : '', mois ? `${an ? 'ou ' : ''}${montant(mois, true)} par mois` : ''].filter(Boolean).join(', ')}.`;
    };
    const offres = ['essentiel', 'complet'].map((k) => {
      const o = OFFRES[k];
      if (!o) return '';
      const an = prixDe(k, 'annuel'), mois = prixDe(k, 'mensuel');
      const mm = avecMillimes(an, mois);
      const courante = a.etat.etat === 'actif' && a.etat.offre === k;
      const aVenir = annonces(k);
      const pas = courante ? ceQuiNEstPasDansLOffre(k, contenus, a.modules, a.fermes) : '';
      // Les boutons de la carte : à l'année d'abord (ce qui coûte le moins), au mois ensuite. Pendant un abonnement payé,
      // le choix vaut pour la période suivante, et la carte de son offre dit « Renouveler ».
      const verbe = a.etat.etat === 'actif' ? (courante ? 'Renouveler' : `Passer à ${o.nom}`) : `Choisir ${o.nom}`;
      const gestes = peutChoisirIci ? [['annuel', an, 'à l\'année'], ['mensuel', mois, 'au mois']].filter((x) => !!x[1])
        .map(([p, , dit], i) => `<button type="button" class="btn${i ? ' abo-ou' : ''}" data-choisir="${k}:${p}">${i ? `ou ${esc(String(dit))}` : `${esc(verbe)} ${esc(String(dit))}`}</button>`).join('') : '';
      // Ouvrir tout de suite ce que son offre ne contient pas (1.119.0 ; 0171) : sur la carte de son offre, pendant une
      // période payée qui court et se renouvelle.
      const ouvrir = courante && !resilie && !aFaire && a.peutChoisir ? (a.fermes || []).filter((m) => m === 'paie' || m === 'compta')
        .map((m) => `<button type="button" class="btn btn-sm" data-module="${m}">Ouvrir ${esc(MODULES[m])} maintenant…</button>`).join('') : '';
      const boutons = gestes + ouvrir;
      return `<article class="abo-offre${courante ? ' courante' : ''}" data-offre="${k}">
        <header class="abo-offre-tete"><h4>${esc(o.nom)}</h4>${courante ? '<span class="abo-badge">Ton offre</span>' : ''}</header>
        <p class="abo-pour">${esc(o.pour)}</p>
        <p class="abo-prix">${an ? `<b>${esc(montant(an, mm).replace(/\u00a0DT$/, ''))}</b><span>DT HT par an</span>` : ''}</p>
        <p class="abo-mois">${mois ? `ou ${esc(montant(mois, mm))} HT par mois` : ''}</p>
        <p class="abo-annee">${esc(aLAnnee(an, mois))}</p>
        <p class="abo-ttc">${esc(ttcDe(k))}</p>
        ${avecAnnonces ? `<div class="abo-avenir-bloc">${aVenir.length ? aVenir.map((t) => `<p class="abo-avenir">${esc(t)}</p>`).join('')
          : '<p class="abo-avenir-rien">Aucun changement annoncé.</p>'}</div>` : ''}
        <div class="abo-offre-gestes">${boutons ? `<div class="abo-offre-boutons">${boutons}</div>` : ''}</div>
        <div class="abo-offre-corps"><ul class="abo-inclus">${inclusDe(k, contenus[/** @type {'essentiel' | 'complet'} */ (k)] || {}).map((i) => `<li>${ICONE_COCHE}<span>${esc(i)}</span></li>`).join('')}</ul>
        ${pas ? `<p class="abo-pas">${esc(pas)}</p>` : ''}</div>
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
      const mm = avecMillimes(an, mois);
      const compris = l.compris(contenus);
      // Un module que les deux offres contiennent ne s'achète pas seul : sa ligne se tait.
      if ((!an && !mois) || (!l.compte && !compris)) return '';
      const auj = aujourdhui(l);
      return `<li data-option="${l.option}"><span class="abo-plus-quoi"><b>${esc(l.nom)}</b>${compris ? `<span>${esc(compris)}</span>` : ''}${auj.texte ? `<span class="abo-plus-auj${auj.plus ? ' en-plus' : ''}">${esc(auj.texte)}</span>` : ''}</span>
        <span class="abo-plus-prix">${an ? `<b>${esc(montant(an, mm))} HT par an</b>` : ''}${mois ? `<span>${an ? 'ou ' : ''}${esc(montant(mois, mm))} HT par mois</span>` : ''}${annonces(l.option).map((t) => `<span class="abo-plus-avenir">${esc(t)}</span>`).join('')}</span></li>`;
    }).join('');
    const histoire = a.historique.map((v) => `<li><span class="abo-quand">${esc(jourDeTunis(String(v.le)))}</span><span>${esc(NATURES[v.nature] || v.nature)}${apresEnClair(v) ? ` <span class="muted">(${esc(apresEnClair(v))})</span>` : ''}</span></li>`).join('');
    const sujet = encodeURIComponent(a.etat.etat === 'actif' ? 'Mon abonnement SkanFact' : 'M\'abonner à SkanFact');
    // Les factures, lues comme la pièce les imprime : la fiche de l'entreprise SkanFact complétée de ses valeurs par défaut
    // par la même fonction que la v10 (`migrateData`), comme l'espace client.
    /** @type {FacturesAbo | null} */
    const fa = a.factures ? { entreprise: core().migrateData({ company: decoder(a.factures.entreprise) }).company, client: decoder(a.factures.client),
      pieces: a.factures.pieces.map((p) => ({ ...p, document: decoder(p.document) })) } : null;
    const factures = fa ? sesFactures(fa) : '';
    const contact = `<a href="mailto:contact@skanfact.tn?subject=${sujet}">contact@skanfact.tn</a>`;
    // « Tu as choisi… » (1.84.0) : l'état de son choix, juste sous l'état, tant que sa facture se prépare ; « Changer de
    // choix » rouvre les boutons des offres.
    const choisi = a.choix ? `<section class="abo-payer abo-choisi" id="abo-payer">
        <span class="abo-payer-ico">${ICONE_MAIL}</span>
        <div class="abo-payer-txt">
          <h4>Tu as choisi ${esc((OFFRES[a.choix.offre] || { nom: a.choix.offre }).nom)}, ${a.choix.periodicite === 'annuel' ? 'à l\'année' : 'au mois'}</h4>
          <p>Le ${esc(jourDeTunis(String(a.choix.le)))}${a.choix.par ? `, par ${esc(a.choix.par)}` : ''}. ${a.auto && !a.choix.refuse
            ? 'Ta facture se prépare : elle arrive ici, dans « Tes factures », dans un instant.'
            : 'SkanFact prépare ta facture sur ce choix : elle arrive ici, dans « Tes factures », et un e-mail te prévient quand elle est prête.'} ${a.enLigne ? 'Tu la règles en ligne, ou par virement ou par chèque.' : 'Tu la règles par virement ou par chèque.'} ${esc(quandCommence(a.etat))}</p>
          ${peutChoisirIci ? '<p><button type="button" class="btn btn-sm" id="abo-rechoisir">Changer de choix</button></p>' : ''}
        </div>
      </section>` : '';
    // Sous les offres, ce qui empêche de choisir : une facture qui attend son paiement, ou un rôle qui ne choisit pas.
    const pasDeChoix = a.etat.etat === 'hors' || suspendue ? ''
      : aFaire && a.peutChoisir ? `<p class="abo-note">Ta facture attend son paiement, juste au-dessus : règle-la d'abord. Pour changer d'offre ensuite, écris-nous à ${contact}.</p>`
        : !a.peutChoisir ? `<p class="abo-note">Ton offre se choisit par la propriétaire ou l'administratrice de l'entreprise. Une question ? ${contact}.</p>` : '';
    // Le bouton de l'état (revue du 22/10/2026 : l'état ne proposait rien, le choix était tout en bas) : choisir son offre
    // quand c'est l'étape suivante (il mène aux offres) ; nous écrire pour une entreprise suspendue. Rien pendant un
    // abonnement payé, ni quand une facture attend (elle est juste dessous, avec son bouton).
    const boutonTete = suspendue ? `<a class="btn abo-tete-btn" href="mailto:contact@skanfact.tn?subject=${sujet}">Écrire à SkanFact</a>`
      : peutChoisirIci && !a.choix && a.etat.etat !== 'actif' ? '<button type="button" class="btn btn-primary abo-tete-btn" id="abo-aller-offres">Choisir mon offre</button>'
        // « Ne pas renouveler » et le reprendre (1.119.0 ; 0171) : qui gère l'abonnement, pendant une période payée.
        : resilie && a.peutChoisir ? '<button type="button" class="btn btn-primary abo-tete-btn" id="abo-reprendre">Reprendre mon abonnement</button>'
          : a.etat.etat === 'actif' && a.peutChoisir && !aFaire ? '<button type="button" class="btn btn-sm abo-tete-btn abo-tete-discret" id="abo-arreter">Ne pas renouveler…</button>' : '';
    // La prochaine facture d'un abonnement payé qui se renouvelle (1.118.0) : son montant, par la règle de la facture,
    // et sa période. Elle arrive ici, et un e-mail le dit.
    const p = a.prochaine;
    const prochaine = p && a.etat.etat === 'actif' && !a.etat.resilie && !aFaire && !a.choix
      ? `Prochaine facture : ${montant(p.montantHt, true)} HT, pour la période qui commence le ${jour(p.debut)} (${nomOffre(p.offre)} ${p.periodicite === 'annuel' ? 'à l\'année' : 'au mois'}${p.remise ? `, remise de ${p.remise} % déduite` : ''}). Elle arrivera ici, et un e-mail te préviendra.` : '';
    el.innerHTML = `<div class="abo">
      <section class="abo-tete ${c.ton}" id="abo-etat">
        <div class="abo-tete-txt">
          <span class="abo-pastille">${esc(c.pastille)}</span>
          <h3>${esc(c.titre)}</h3>
          <p>${esc(c.texte)}</p>
          ${prochaine ? `<p class="abo-prochaine" id="abo-prochaine">${esc(prochaine)}</p>` : ''}
          ${boutonTete}
        </div>
        ${c.jauge ? `<div class="abo-jauge"><span class="abo-jauge-txt">${esc(c.jauge.texte)}</span><span class="abo-barre" aria-hidden="true"><i style="width:${Math.round(c.jauge.part * 100)}%"></i></span></div>` : ''}
      </section>
      ${choisi}
      ${aFaire ? factures : ''}
      ${a.etat.etat === 'hors' ? '' : `<div class="abo-section" id="abo-offres">
        <div class="abo-section-tete"><h3>Les offres</h3><p>Un prix par entreprise, jamais par utilisateur. Hors taxes : la TVA s'ajoute.${(a.aVenir || []).length || changements.length ? ' Un changement annoncé vaut pour les périodes qui commencent à sa date : celle qui court garde son prix et ce qu\'elle comprend.' : ''}</p></div>
        ${a.remise ? remiseEnClair(a.remise) : ''}
        <div class="abo-offres${avecAnnonces ? ' avec-avenir' : ''}${a.choix ? ' abo-replie' : ''}">${offres}</div>
        ${pasDeChoix}
        ${enPlus ? `<details class="abo-plus" id="abo-plus"${/class="abo-plus-auj en-plus"/.test(enPlus) ? ' open' : ''}>
          <summary class="abo-plus-tete"><h4>Ce qui peut s'ajouter à l'offre</h4>
            <p>Une caisse, un établissement ou un salarié de plus, un module acheté seul : compté le jour où ta facture se prépare, pour la période qu'elle paie. Ton équipe, elle, n'a pas de limite.</p></summary>
          <ul class="abo-plus-liste">${enPlus}</ul>
        </details>` : ''}
      </div>
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
    brancherChoix(el, o, { prixDe, netDe: (/** @type {string} */ k, /** @type {string} */ p) => (a.prix.find((x) => x.offre === k && x.periodicite === p) || {}).net || undefined, remise: a.remise || null, etat: a.etat, enLigne: !!a.enLigne, auto: !!a.auto });
    brancherRenouvellement(el, o, a.etat);
    brancherModules(el, o);
    // Le choix se facture seul (1.119.0) : l'onglet se relit jusqu'à ce que sa facture soit là (une minute au plus).
    if (a.auto && a.choix && !a.choix.refuse) {
      const essais = Number(el.dataset.attenteFacture || 0);
      if (essais < 20) {
        el.dataset.attenteFacture = String(essais + 1);
        setTimeout(() => { if (el.isConnected && el.querySelector('#abo-payer.abo-choisi')) void dessiner(el, o); }, 3000);
      }
    } else delete el.dataset.attenteFacture;
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

  // Le bandeau de l'accueil (1.118.0 ; revue du 22/10/2026 : en grâce ou en lecture seule, l'accueil ne disait rien,
  // seule une pastille en bas du menu le montrait). Il parle quand la pastille de la barre attire ou alerte (la même
  // fonction : les deux disent la même chose), avec un seul bouton — choisir son offre, régler sa facture, renouveler,
  // nous écrire pour une entreprise suspendue ; à qui ne gère pas l'abonnement, « Qui le règle ? ». `principal` : le
  // bouton est l'étape suivante de l'écran (la grâce et la lecture seule). `gere` : la personne règle l'abonnement.
  /** @param {(Etat & { aFaire?: 'payer' | 'attendre' | null }) | null} e @param {boolean} gere
   *  @returns {{ ton: string, titre: string, texte: string, bouton: string, principal: boolean, ecrire: boolean } | null} */
  function bandeau(e, gere) {
    const p = pastille(e);
    if (!e || !p.show || p.ton === 'calme') return null;
    const suspendue = e.etat === 'lecture_seule' && e.raison === 'suspendu';
    const aFaire = e.aFaire || null;
    const facture = aFaire === 'payer' ? ' Ta facture t\'attend dans « Ton abonnement ».'
      : aFaire === 'attendre' ? ' Ta facture se prépare sur l\'offre choisie : un e-mail te prévient quand elle est prête.' : '';
    let titre, texte;
    if (e.etat === 'essai') {
      titre = Number(e.jours) <= 0 ? 'Ton essai se termine aujourd\'hui' : `Ton essai se termine le ${jour(e.jusquAu)}`;
      texte = `${facture || ' Choisis ton offre pour continuer sans interruption.'} Tout ce que tu as créé reste.`;
    } else if (e.etat === 'actif') {
      titre = e.resilie ? `Ton abonnement s'arrête le ${jour(e.jusquAu)}` : `Ton abonnement se termine le ${jour(e.jusquAu)}`;
      texte = e.resilie ? ' Il ne se renouvelle pas : ensuite, l\'entreprise passe en lecture seule. Tes données restent à toi.'
        : facture || ' Renouvelle-le pour continuer sans interruption.';
    } else if (e.etat === 'en_retard') {
      titre = e.apresEssai ? 'Ton essai est terminé' : 'Ton abonnement est échu';
      texte = ` Tout marche encore jusqu'au ${jour(plusJours(String(e.lectureSeuleLe), -1))} ; le ${jour(e.lectureSeuleLe)}, l'entreprise passe en lecture seule.${facture || ' Choisis ton offre avant cette date.'}`;
    } else {
      titre = `Lecture seule depuis le ${jour(e.depuis)}`;
      texte = suspendue ? ' SkanFact a suspendu l\'abonnement : écris-nous pour rouvrir l\'entreprise. Tout se lit, s\'imprime et s\'exporte.'
        : ` ${pourquoi(e)} Tout se lit, s'imprime et s'exporte, mais rien de nouveau ne se crée.${facture || ' Choisis ton offre : dès que sa facture est réglée, tout se rouvre.'}`;
    }
    if (!gere) texte += ' C\'est le propriétaire de l\'entreprise, ou un administrateur, qui règle l\'abonnement.';
    const bouton = !gere ? 'Qui le règle ?' : suspendue ? 'Écrire à SkanFact' : aFaire === 'payer' ? 'Régler ma facture'
      : aFaire === 'attendre' || (e.etat === 'actif' && e.resilie) ? 'Voir mon abonnement' : e.etat === 'actif' ? 'Renouveler' : 'Choisir mon offre';
    return { ton: p.ton, titre, texte: texte.trim(), bouton, principal: e.etat === 'en_retard' || e.etat === 'lecture_seule', ecrire: gere && suspendue };
  }

  w.SkanAbonnement = { licence, pastille, bandeau, dessiner, etatEnClair, montant, OFFRES };
})();
