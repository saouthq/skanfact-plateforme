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
// offres et leurs prix (ceux du jour, lus au serveur), ce qui se passe à l'échéance, et l'histoire de l'abonnement.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);

  /** @typedef {{ aujourdhui?: string, etat: 'essai' | 'actif' | 'en_retard' | 'lecture_seule' | 'hors', jusquAu?: string, jours?: number,
   *   offre?: string, periodicite?: string, resilie?: boolean, echeance?: string, lectureSeuleLe?: string, apresEssai?: boolean,
   *   depuis?: string, raison?: string }} Etat */

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

  // Ce que chaque offre contient (skanfact docs/cadrage/07-offres-et-prix.md) : une phrase par ligne, comme on lit une
  // offre — pas un paragraphe qu'on ne relit pas.
  const OFFRES = /** @type {Record<string, { nom: string, pour: string, inclus: string[] }>} */ ({
    essentiel: { nom: 'Essentiel', pour: 'Tout ce qu\'il faut pour vendre, encaisser et déclarer.', inclus: [
      'Devis, factures, avoirs, clients et catalogue', 'Achats, fournisseurs et stock', 'Une caisse au comptoir', 'La banque et la trésorerie',
      'La facture électronique, la retenue à la source et la déclaration du mois', 'L\'espace client et le paiement en ligne',
      'Ton comptable dans les mêmes données', 'Trois utilisateurs, un établissement'] },
    complet: { nom: 'Complet', pour: 'Pour une entreprise qui paie des salariés et tient sa comptabilité.', inclus: [
      'Tout Essentiel', 'La paie, jusqu\'à vingt salariés', 'La comptabilité complète', 'Deux caisses', 'Des utilisateurs sans limite, deux établissements'] },
  });
  /** @param {string | undefined} o */
  const nomOffre = (o) => (o && OFFRES[o] ? OFFRES[o].nom : 'Abonnement');

  // Pourquoi l'entreprise est en lecture seule, en une phrase.
  /** @param {Etat} e */
  const pourquoi = (e) => ({
    essai_termine: 'L\'essai est terminé.', non_renouvele: 'L\'abonnement n\'a pas été renouvelé.',
    resilie: 'L\'abonnement a été résilié.', suspendu: 'SkanFact a suspendu l\'abonnement : écris-nous à contact@skanfact.tn.',
  })[e.raison || ''] || '';

  // Ce que la v10 attend de sa licence (sa pastille, sa carte d'essai, sa porte de création), tiré de l'état.
  /** @param {Etat | null} e */
  function licence(e) {
    // Rien n'est réservé à une offre pour l'instant (`reserves` vide, l'option de comptabilité incluse) : ce qui distingue
    // Essentiel de Complet viendra avec ses refus au serveur. La lecture seule, seule, ferme la création.
    const base = { state: 'libre', locked: false, label: '', detail: '', offre: 'entreprise', reserves: [], options: ['compta'], editeur: false };
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
  /** @param {Etat} e @returns {{ ton: string, pastille: string, titre: string, texte: string, jauge: { texte: string, part: number } | null }} */
  function etatEnClair(e) {
    if (e.etat === 'hors') {
      return { ton: 'calme', pastille: 'Sans échéance', titre: 'Rien ne s\'arrête ici', jauge: null, texte: ({ bac_a_sable: 'C\'est une entreprise d\'essai : elle ne s\'arrête jamais, et rien n\'y est facturé.',
        tenu_par_cabinet: 'Ton cabinet tient ce dossier : c\'est lui qui le paie.', offert: 'SkanFact t\'offre cet abonnement : il ne s\'arrête pas.',
        inconnu: 'Cette entreprise n\'a pas encore d\'abonnement : rien ne s\'y ferme.' })[e.raison || ''] || '' };
    }
    if (e.etat === 'essai') {
      const j = Number(e.jours);
      return { ton: j <= 7 ? 'attire' : 'calme', pastille: 'Essai gratuit', titre: j <= 0 ? 'Dernier jour de ton essai' : `Encore ${pl(j, 'jour')} d'essai`,
        texte: `Jusqu'au ${jour(e.jusquAu)}, tout est ouvert, sans carte. Ce que tu crées pendant l'essai reste quand tu t'abonnes : rien à ressaisir.`,
        // La part de l'essai qui reste : trente jours, ou plus s'il a été prolongé.
        jauge: { texte: j <= 0 ? 'Dernier jour' : `${pl(j, 'jour')} sur ${Math.max(30, j)}`, part: Math.max(0, Math.min(1, j / Math.max(30, j))) } };
    }
    if (e.etat === 'actif') {
      const j = Number(e.jours);
      return { ton: j <= 15 ? 'attire' : 'calme', pastille: e.resilie ? 'Résilié' : `${nomOffre(e.offre)} · ${e.periodicite === 'mensuel' ? 'au mois' : 'à l\'année'}`,
        titre: `Payé jusqu'au ${jour(e.jusquAu)}`, jauge: null,
        texte: e.resilie ? 'Tu as résilié : l\'abonnement s\'arrête à cette date, puis l\'entreprise passe en lecture seule.'
          : j <= 0 ? 'C\'est le dernier jour de la période payée.' : `Encore ${pl(j, 'jour')}. Un rappel part par e-mail quinze jours avant l'échéance.` };
    }
    if (e.etat === 'en_retard') {
      const j = Number(e.jours);
      return { ton: 'alerte', pastille: 'À régler', titre: e.apresEssai ? `L'essai est terminé depuis le ${jour(plusJours(String(e.echeance), 1))}` : `L'abonnement est échu depuis le ${jour(plusJours(String(e.echeance), 1))}`,
        texte: `Tout marche encore jusqu'au ${jour(plusJours(String(e.lectureSeuleLe), -1))}. Le ${jour(e.lectureSeuleLe)}, l'entreprise passe en lecture seule : tout se lit, s'imprime et s'exporte, mais rien de nouveau ne se crée.`,
        jauge: { texte: `${pl(j, 'jour')} de grâce`, part: Math.max(0, Math.min(1, j / 7)) } };
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
  });
  // Ce qu'un événement a changé, en quelques mots (jamais le motif : c'est une note de SkanFact).
  /** @param {{ nature: string, apres: any }} v */
  function apresEnClair(v) {
    const a = v.apres || {};
    if ((v.nature === 'essai_commence' || v.nature === 'essai_prolonge') && (a.essaiJusquAu || a.essai_jusqu_au)) return `jusqu'au ${jour(a.essaiJusquAu || a.essai_jusqu_au)}`;
    if (v.nature === 'paye' && a.paye_jusqu_au) return `${nomOffre(a.offre)}, jusqu'au ${jour(a.paye_jusqu_au)}`;
    return '';
  }

  /**
   * @typedef {{ appel: (methode: string, chemin: string, corps?: unknown) => Promise<any> }} Outils
   */
  // Les dessins de l'onglet, au trait (la DA de l'entrée) : une enveloppe, une coche.
  const ICONE_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7.5l8 6 8-6"/></svg>';
  const ICONE_COCHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
  /** @param {HTMLElement} el @param {Outils} o */
  async function dessiner(el, o) {
    /** @type {{ aujourdhui: string, etat: Etat, prix: { offre: string, periodicite: string, montantHt: string }[], historique: { le: string, nature: string, apres: any }[] }} */
    let a;
    try { a = await o.appel('GET', '/abonnement'); } catch (x) {
      el.innerHTML = `<p class="small" role="alert">${esc(x instanceof Error ? x.message : x)}</p><button type="button" class="btn btn-sm" id="abo-relire">Réessayer</button>`;
      /** @type {HTMLElement} */ (el.querySelector('#abo-relire')).onclick = () => { void dessiner(el, o); };
      return;
    }
    const c = etatEnClair(a.etat);
    /** @param {string} offre @param {string} periodicite */
    const prixDe = (offre, periodicite) => (a.prix.find((p) => p.offre === offre && p.periodicite === periodicite) || {}).montantHt;
    const offres = ['essentiel', 'complet'].map((k) => {
      const o = OFFRES[k];
      if (!o) return '';
      const an = prixDe(k, 'annuel'), mois = prixDe(k, 'mensuel');
      const courante = a.etat.etat === 'actif' && a.etat.offre === k;
      return `<article class="abo-offre${courante ? ' courante' : ''}" data-offre="${k}">
        <header class="abo-offre-tete"><h4>${esc(o.nom)}</h4>${courante ? '<span class="abo-badge">Ton offre</span>' : ''}</header>
        <p class="abo-pour">${esc(o.pour)}</p>
        ${an ? `<p class="abo-prix"><b>${esc(montant(an).replace(/\u00a0DT$/, ''))}</b><span>DT HT par an</span></p>` : ''}
        ${mois ? `<p class="abo-mois">ou ${esc(montant(mois))} HT par mois</p>` : ''}
        <ul class="abo-inclus">${o.inclus.map((i) => `<li>${ICONE_COCHE}<span>${esc(i)}</span></li>`).join('')}</ul>
      </article>`;
    }).join('');
    const histoire = a.historique.map((v) => `<li><span class="abo-quand">${esc(jour(String(v.le).slice(0, 10)))}</span><span>${esc(NATURES[v.nature] || v.nature)}${apresEnClair(v) ? ` <span class="muted">(${esc(apresEnClair(v))})</span>` : ''}</span></li>`).join('');
    const sujet = encodeURIComponent(a.etat.etat === 'actif' ? 'Mon abonnement SkanFact' : 'M\'abonner à SkanFact');
    el.innerHTML = `<div class="abo">
      <section class="abo-tete ${c.ton}" id="abo-etat">
        <div class="abo-tete-txt">
          <span class="abo-pastille">${esc(c.pastille)}</span>
          <h3>${esc(c.titre)}</h3>
          <p>${esc(c.texte)}</p>
        </div>
        ${c.jauge ? `<div class="abo-jauge"><span class="abo-jauge-txt">${esc(c.jauge.texte)}</span><span class="abo-barre" aria-hidden="true"><i style="width:${Math.round(c.jauge.part * 100)}%"></i></span></div>` : ''}
      </section>
      ${a.etat.etat === 'hors' ? '' : `<div class="abo-section">
        <div class="abo-section-tete"><h3>Les offres</h3><p>Un prix par entreprise, jamais par utilisateur. Hors taxes : la TVA s'ajoute.</p></div>
        <div class="abo-offres">${offres}</div>
      </div>
      <section class="abo-payer" id="abo-payer">
        <span class="abo-payer-ico">${ICONE_MAIL}</span>
        <div class="abo-payer-txt">
          <h4>${a.etat.etat === 'actif' ? 'Renouveler ou changer d\'offre' : 'T\'abonner'}</h4>
          <p>Écris-nous à <a href="mailto:contact@skanfact.tn?subject=${sujet}">contact@skanfact.tn</a> en disant l'offre choisie (Essentiel ou Complet, à l'année ou au mois). Tu reçois la facture, et tu la règles par virement ou par chèque. ${esc(quandCommence(a.etat))}</p>
        </div>
      </section>
      <div class="abo-section">
        <div class="abo-section-tete"><h3>À l'échéance</h3><p>Tes données restent à toi : tu peux tout télécharger à tout moment (Données et sécurité).</p></div>
        <ol class="abo-etapes">
          <li><b>Les rappels</b><span>Un e-mail quinze jours, sept jours et la veille de l'échéance.</span></li>
          <li><b>Sept jours de grâce</b><span>Après l'échéance, tout marche encore.</span></li>
          <li><b>La lecture seule</b><span>Tout se lit, s'imprime et s'exporte ; rien de nouveau ne se crée.</span></li>
        </ol>
      </div>`}
      ${histoire ? `<div class="abo-section"><div class="abo-section-tete"><h3>L'histoire de l'abonnement</h3></div><ul class="abo-histoire">${histoire}</ul></div>` : ''}
    </div>`;
  }

  w.SkanAbonnement = { licence, pastille, dessiner, etatEnClair, montant, OFFRES };
})();
