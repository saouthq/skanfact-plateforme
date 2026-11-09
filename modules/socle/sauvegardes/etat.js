// @ts-check
// Ce que la veille du serveur a vu des copies (lot Fonctions 3, 0161 ; 1.333.0 pour le Cabinet, 0207), dit tel quel : une
// copie échouée, une copie hors de la machine pas encore en place, une surveillance muette se disent. Une seule façon de le
// dire, pour l'entreprise (Paramètres › Données et sécurité › Tes sauvegardes) et pour le cabinet (Réglages › Données et
// sécurité › Tes données) : ce sont les mêmes copies, celles du serveur qui garde les livres de tous.
(function () {
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const HEURE_DE_TUNIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  /** @param {string} iso */
  const quand = (iso) => {
    /** @type {Record<string, string>} */ const p = {};
    for (const x of HEURE_DE_TUNIS.formatToParts(new Date(iso))) p[x.type] = x.value;
    return `${p.day}/${p.month}/${p.year} à ${Number(p.hour)} h ${p.minute}`;
  };
  /** @param {string} jour */
  const date = (jour) => String(jour).split('-').reverse().join('/');

  /** La phrase du calendrier, puis la liste de ce que la veille a vu. @param {any} s */
  function etat(s) {
    /** @type {string[]} */ const lignes = [];
    if (!s.veille) lignes.push('<li data-sv="veille">La surveillance du serveur n\'a encore rien relevé : rien ne dit encore l\'état des copies.</li>');
    else if (!s.veille.recente) lignes.push(`<li data-sv="veille"><b>Ces informations datent du ${esc(quand(s.veille.minute))}</b> : la surveillance du serveur ne s'est pas manifestée depuis.</li>`);
    if (!s.nuit) lignes.push('<li data-sv="nuit">Copie de la nuit : pas encore faite sur ce serveur.</li>');
    else if (s.nuit.sauvegarde && s.nuit.sauvegarde.ok) lignes.push(`<li data-sv="nuit">Dernière copie de la nuit : le ${esc(quand(s.nuit.sauvegarde.le))}, réussie.</li>`);
    else lignes.push(`<li data-sv="nuit"><b>La copie de la nuit du ${esc(date(s.nuit.jour))} a échoué.</b> ${s.reussie ? `La dernière réussie : le ${esc(quand(s.reussie.le))}.` : 'Aucune n\'a encore réussi sur ce serveur.'}</li>`);
    if (s.archivage && !s.archivage.enMarche) lignes.push('<li data-sv="archivage"><b>L\'archivage à la minute ne tourne pas</b> : on revient seulement à une nuit, pas à une minute précise.</li>');
    // Sans relevé de la veille, rien ne dit l'état de la copie hors de la machine : la ligne de la veille le dit déjà.
    if (!s.veille) { /* rien à affirmer */ } else if (!s.horsMachine || !s.horsMachine.regle) lignes.push('<li data-sv="hors">Copie hors de la machine : pas encore en place sur ce serveur. Les copies restent sur la machine qui fait tourner SkanFact.</li>');
    else if (s.horsMachine.attenteDepuis) lignes.push(`<li data-sv="hors">Copie hors de la machine : en attente depuis le ${esc(quand(s.horsMachine.attenteDepuis))}.</li>`);
    else lignes.push('<li data-sv="hors">Copie hors de la machine : à jour.</li>');
    if (!s.exercice) lignes.push('<li data-sv="essai">Essai de restauration : pas encore fait sur ce serveur.</li>');
    else lignes.push(`<li data-sv="essai">Dernier essai de restauration : le ${esc(date(s.exercice.jour))}, ${s.exercice.ok ? 'réussi' : '<b>échoué</b>'}.</li>`);
    const archive = !s.archivage || s.archivage.enMarche;
    /** @param {string} hm */
    const heure = (hm) => `${Number(hm.slice(0, 2))} h ${hm.slice(3, 5)}`;
    const jourDuMois = s.calendrier.exercice.jourDuMois === 1 ? '1er' : String(s.calendrier.exercice.jourDuMois);
    return `<p class="small muted mb">Chaque nuit à ${esc(heure(s.calendrier.sauvegarde))} (heure de Tunis), SkanFact copie toutes les données ; il garde les ${esc(s.garde.nuits)} dernières nuits${archive ? `, et de quoi revenir à n'importe quelle minute des ${esc(s.garde.jours)} derniers jours` : ''}. Le ${esc(jourDuMois)} de chaque mois, une copie est remise en place à côté, pour vérifier qu'elle se relit.</p>
      <ul class="small sv-etat" id="sv-etat">${lignes.join('')}</ul>`;
  }

  /** @type {any} */ (window).SkanSauvegardes = { etat, quand, date };
})();
