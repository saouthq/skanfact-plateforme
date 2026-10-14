// @ts-check
// L'accès du support de SkanFact au dossier (Support S2 ; docs/support.md ; serveur/support/acces.ts ; base 0096), dans
// l'application de l'entreprise. Deux côtés, deux objets :
//
//   - `SkanAcces`, chez le client : le propriétaire ou un administrateur voit la demande de l'équipe (qui, pourquoi), en
//     haut de chaque page ; il l'ACCORDE pour quelques heures, ou la refuse ; un accès qui court se voit de même, avec
//     sa fin, et se RETIRE d'un clic. Le panneau « Le support de SkanFact » (Paramètres › L'équipe) garde tout : les
//     demandes, les accès, et chaque page que le support a lue (« Qui a regardé mes données »).
//   - `SkanLecture`, chez le support : la même application, ouverte depuis la console en LECTURE (« ?support=… ») ; un
//     bandeau en haut de chaque page dit à qui est ce dossier, jusqu'à quand, et que rien ne s'enregistre ; un accès qui
//     ne court plus ferme la page sur sa raison.
//
// Les gestes passent par le point de contact (pont.js) ; la base refait chaque contrôle.
(function () {
  'use strict';
  const w = /** @type {any} */ (window);
  /** @param {unknown} x */
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const TZ = 'Africa/Tunis';
  const RELIRE_MS = 60_000;
  /** @param {string} iso */
  const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  /** @param {string | number} d */
  const jourCle = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
  // « 14:32 » aujourd'hui, « demain à 09:10 », sinon « le 15/10 à 09:10 ».
  /** @param {string} iso */
  function quand(iso) {
    const j = jourCle(iso), auj = jourCle(Date.now());
    if (j === auj) return `à ${heure(iso)}`;
    if (j === jourCle(Date.now() + 86_400_000)) return `demain à ${heure(iso)}`;
    if (j === jourCle(Date.now() - 86_400_000)) return `hier à ${heure(iso)}`;
    return `le ${j.slice(8, 10)}/${j.slice(5, 7)} à ${heure(iso)}`;
  }
  // La fin d'un accès : « jusqu'à 14:32 », « jusqu'à demain, 09:10 », « jusqu'au 15/10, 09:10 ».
  /** @param {string} iso */
  function jusqua(iso) {
    const j = jourCle(iso);
    if (j === jourCle(Date.now())) return `jusqu'à ${heure(iso)}`;
    if (j === jourCle(Date.now() + 86_400_000)) return `jusqu'à demain, ${heure(iso)}`;
    return `jusqu'au ${j.slice(8, 10)}/${j.slice(5, 7)}, ${heure(iso)}`;
  }
  // Ce qui reste : « 1 h 20 », « 12 min », « moins d'une minute ».
  /** @param {string} fin */
  function reste(fin) {
    const m = Math.floor((Date.parse(fin) - Date.now()) / 60_000);
    if (m < 1) return 'moins d\'une minute';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
  }
  /** @param {number} n */
  const duree = (n) => (n === 1 ? '1 heure' : `${n} heures`);
  const ref = (/** @type {number} */ n) => `S-${String(n).padStart(4, '0')}`;
  /** @param {unknown} x */
  const motif = (x) => (x instanceof Error ? x.message : String(x));
  // Une phrase : sa majuscule, et un seul point au bout (le serveur peut l'avoir déjà mis).
  /** @param {string} m */
  const phrase = (m) => { const t = m.trim().replace(/[.\s]+$/, ''); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : ''; };
  const CLE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3M16 7l3 3M14 9l2 2"/></svg>';
  const OEIL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Chez le client : la demande, l'accès qui court, le panneau.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  /** @type {{ acces: any[], durees: number[] } | null} */ let lu = null;
  // La personne ne décide pas de l'accès (ni propriétaire ni administrateur) : on ne redemande plus.
  let pasPourMoi = false;
  /** @type {ReturnType<typeof setInterval> | null} */ let minuterie = null;
  /** @type {{ toast?: (t: string, erreur?: boolean) => void, nomDePage?: (p: string) => string }} */ let options = {};
  const api = () => (w.skanfact && w.skanfact.accesSupport) || null;

  async function relire() {
    const a = api();
    if (!a || pasPourMoi) return;
    try {
      const r = await a.lire();
      lu = { acces: Array.isArray(r.acces) ? r.acces : [], durees: Array.isArray(r.durees) && r.durees.length ? r.durees : [2, 24, 48] };
    } catch (e) {
      if (/** @type {any} */ (e).statut === 403) { pasPourMoi = true; lu = null; }
      return;
    }
    poser(document.getElementById('view'));
    const p = document.querySelector('[data-acces-panneau]');
    if (p) dessinerPanneau(/** @type {HTMLElement} */ (p));
  }
  function demarrer() {
    if (minuterie || !api()) return;
    void relire();
    minuterie = setInterval(() => { if (document.visibilityState === 'visible') void relire(); }, RELIRE_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void relire(); });
  }

  /** @param {string} id @param {boolean} accorder @param {number | null} heures @param {HTMLElement | null} bouton */
  async function repondre(id, accorder, heures, bouton) {
    const a = api();
    if (!a) return;
    if (bouton) bouton.setAttribute('disabled', '');
    try {
      await a.repondre(id, accorder, heures);
      const t = options.toast;
      if (t) t(accorder ? `Accès accordé pour ${duree(Number(heures))}. Tu le retires quand tu veux : Paramètres › L'équipe.` : 'Demande refusée : l\'équipe SkanFact le voit, et ne lit rien.');
    } catch (e) {
      if (options.toast) options.toast(motif(e), true);
    } finally { if (bouton) bouton.removeAttribute('disabled'); }
    await relire();
  }
  /** @param {string} id @param {HTMLElement | null} bouton */
  async function retirer(id, bouton) {
    const a = api();
    if (!a) return;
    if (bouton) bouton.setAttribute('disabled', '');
    try {
      await a.retirer(id);
      if (options.toast) options.toast('Accès retiré : l\'équipe SkanFact ne lit plus ton dossier.');
    } catch (e) {
      if (options.toast) options.toast(motif(e), true);
    } finally { if (bouton) bouton.removeAttribute('disabled'); }
    await relire();
  }

  // Les boutons d'une demande : une durée par bouton (la plus courte d'abord, elle suffit souvent), puis « Refuser ».
  /** @param {any} a */
  const boutonsDemande = (a, petit = false) => `${(lu ? lu.durees : [2, 24, 48]).map((h, i) => `<button type="button" class="btn${i === 0 ? ' btn-primary' : ''}${petit ? ' btn-sm' : ''}" data-acces-accorder="${esc(a.id)}" data-heures="${h}">Accorder ${i === 0 ? `pour ${duree(h)}` : duree(h)}</button>`).join('')}
    <button type="button" class="btn${petit ? ' btn-sm' : ''}" data-acces-refuser="${esc(a.id)}">Refuser</button>`;
  /** @param {HTMLElement} racine */
  function brancher(racine) {
    racine.querySelectorAll('[data-acces-accorder]').forEach((n) => {
      const b = /** @type {HTMLElement} */ (n);
      b.onclick = () => { void repondre(String(b.dataset.accesAccorder), true, Number(b.dataset.heures), b); };
    });
    racine.querySelectorAll('[data-acces-refuser]').forEach((n) => {
      const b = /** @type {HTMLElement} */ (n);
      b.onclick = () => { void repondre(String(b.dataset.accesRefuser), false, null, b); };
    });
    racine.querySelectorAll('[data-acces-voir]').forEach((n) => {
      /** @type {HTMLElement} */ (n).onclick = () => { if (typeof w.__allerParametres === 'function') w.__allerParametres('equipe', 'p-acces-support'); };
    });
    racine.querySelectorAll('[data-acces-retirer]').forEach((n) => {
      const b = /** @type {HTMLElement} */ (n);
      b.onclick = () => { void retirer(String(b.dataset.accesRetirer), b); };
    });
  }

  // Le bandeau, en haut de chaque page : la demande qui attend (décider tout de suite), ou l'accès qui court (le voir,
  // le retirer). Rien quand il n'y a rien.
  /** @param {HTMLElement | null} view */
  function poser(view) {
    if (!view) return;
    const deja = /** @type {HTMLElement | null} */ (view.querySelector(':scope > .acc-bandeau'));
    const liste = lu ? lu.acces : [];
    const demande = liste.find((a) => a.etat === 'demande');
    const actif = liste.find((a) => a.etat === 'actif');
    const a = demande || actif;
    if (!a) { if (deja) deja.remove(); return; }
    const cle = `${a.id}:${a.etat}:${a.fin || ''}:${(lu ? lu.durees : []).join(',')}`;
    if (deja && deja.dataset.cle === cle) return;
    if (deja) deja.remove();
    const el = document.createElement('div');
    el.className = `banner acc-bandeau${demande ? ' acc-demande' : ' acc-actif'}`;
    el.setAttribute('role', demande ? 'alert' : 'status');
    el.dataset.cle = cle;
    const qui = esc(a.demandeur || 'L\'équipe');
    el.innerHTML = demande
      ? `<span class="acc-ic">${CLE}</span>
        <span class="acc-texte"><b>L'équipe SkanFact demande à lire ton dossier</b>
          <span>${qui}, du support : « ${esc(a.motif)} »${a.demande ? ` (ta demande ${esc(ref(a.demande.numero))})` : ''}.</span>
          <span class="acc-sous">En lecture seulement, pour le temps que tu choisis : chaque page qu'il ouvre est notée, et tu retires l'accès quand tu veux.</span></span>
        <span class="acc-gestes">${boutonsDemande(a, true)}</span>`
      : `<span class="acc-ic">${OEIL}</span>
        <span class="acc-texte"><b>${qui}, du support SkanFact, peut lire ton dossier ${esc(jusqua(a.fin))}</b>
          <span class="acc-sous">${a.lectures && a.lectures.length ? `${a.lectures.length === 1 ? 'Une page lue' : `${a.lectures.length} pages lues`} jusqu'ici.` : 'Aucune page lue pour l\'instant.'} En lecture seulement.</span></span>
        <span class="acc-gestes"><button type="button" class="btn btn-sm" data-acces-voir>Voir ce qu'il a lu</button><button type="button" class="btn btn-sm" data-acces-retirer="${esc(a.id)}">Retirer l'accès</button></span>`;
    brancher(el);
    view.insertBefore(el, view.firstChild);
  }

  // Le panneau « Le support de SkanFact » : la demande qui attend, l'accès qui court, et l'historique, chacun avec les
  // pages lues (« Qui a regardé mes données »).
  /** @param {any} a */
  function etatEnMots(a) {
    switch (a.etat) {
      case 'demande': return { cle: 'demande', texte: 'Attend ta réponse' };
      case 'actif': return { cle: 'actif', texte: `Accès en cours, ${jusqua(a.fin)}` };
      case 'echu': return { cle: 'fini', texte: `Fini ${a.fin ? quand(a.fin) : ''}`.trim() };
      case 'retire': return { cle: 'fini', texte: `Retiré ${a.retireLe ? quand(a.retireLe) : ''}${a.retirePar ? ` par ${a.retirePar}` : ''}`.trim() };
      case 'fini': return { cle: 'fini', texte: `Rendu par le support ${a.closLe ? quand(a.closLe) : ''}`.trim() };
      case 'refuse': return { cle: 'refuse', texte: `Refusé ${a.refuseLe ? quand(a.refuseLe) : ''}${a.refusePar ? ` par ${a.refusePar}` : ''}`.trim() };
      default: return { cle: 'fini', texte: '' };
    }
  }
  /** @param {HTMLElement} el */
  function dessinerPanneau(el) {
    if (!lu) { el.innerHTML = '<p class="small muted">Lecture…</p>'; return; }
    const nom = options.nomDePage || ((/** @type {string} */ p) => p);
    if (!lu.acces.length) {
      el.innerHTML = `<p class="small">Le support de SkanFact ne lit jamais ton dossier sans ton accord. Quand il en a besoin pour t'aider, il te le demande ici, avec son motif ; tu l'accordes pour quelques heures, en lecture seulement, ou tu refuses.</p>
        <p class="small muted">Aucune demande pour l'instant.</p>`;
      return;
    }
    const ligne = (/** @type {any} */ a) => {
      const e = etatEnMots(a);
      const lectures = Array.isArray(a.lectures) ? a.lectures : [];
      return `<li class="acc-l acc-l-${e.cle}">
        <span class="acc-l-haut"><b>${esc(a.demandeur || 'L\'équipe')}</b><span class="acc-etat acc-etat-${e.cle}">${esc(e.texte)}</span></span>
        <span class="acc-l-motif">« ${esc(a.motif)} » · demandé ${esc(quand(a.demandeLe))}${a.heures ? ` · accordé pour ${esc(duree(a.heures))}${a.accordePar ? ` par ${esc(a.accordePar)}` : ''}` : ''}</span>
        ${a.etat === 'demande' ? `<span class="acc-gestes">${boutonsDemande(a)}</span>` : ''}
        ${a.etat === 'actif' ? `<span class="acc-gestes"><button type="button" class="btn" data-acces-retirer="${esc(a.id)}">Retirer l'accès</button><span class="small muted">Il reste ${esc(reste(a.fin))}.</span></span>` : ''}
        ${a.etat !== 'demande' && a.etat !== 'refuse' ? `<details class="acc-lu"${a.etat === 'actif' ? ' open' : ''}><summary>${lectures.length ? `${lectures.length === 1 ? 'Une page lue' : `${lectures.length} pages lues`}` : 'Aucune page lue'}</summary>
          ${lectures.length ? `<ol>${lectures.map((/** @type {any} */ l) => `<li><span>${esc(nom(l.page))}</span><span class="small muted">${esc(quand(l.le))}</span></li>`).join('')}</ol>` : ''}</details>` : ''}
      </li>`;
    };
    el.innerHTML = `<p class="small">Le support ne lit ton dossier qu'avec ton accord, pour le temps que tu choisis, en lecture seulement (jamais la paie) ; chaque page qu'il ouvre est notée ici.</p>
      <ul class="acc-liste">${lu.acces.slice(0, 20).map(ligne).join('')}</ul>`;
    brancher(el);
  }
  /** @param {HTMLElement} el @param {{ toast?: (t: string, erreur?: boolean) => void, nomDePage?: (p: string) => string }} o */
  function panneau(el, o) {
    options = { ...options, ...o };
    el.setAttribute('data-acces-panneau', '');
    dessinerPanneau(el);
    void relire();
  }

  w.SkanAcces = {
    /** @param {HTMLElement | null} view @param {{ toast?: (t: string, erreur?: boolean) => void, nomDePage?: (p: string) => string }} [o] */
    poser: (view, o) => { if (o) options = { ...options, ...o }; demarrer(); poser(view); },
    panneau,
    relire,
  };

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // Chez le support : la lecture.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  let fermee = /** @type {string | null} */ (null);
  /** @param {string} m */
  function fermer(m) {
    if (fermee !== null) return;
    fermee = m;
    const l = w.skanfact && w.skanfact.lecture;
    const retour = l ? `/console/#/clients/${encodeURIComponent(l.entreprise)}?onglet=support` : '/console/';
    const el = document.createElement('div');
    el.className = 'lec-ferme';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'lec-ferme-titre');
    el.innerHTML = `<div class="lec-ferme-carte"><span class="acc-ic">${CLE}</span>
      <h2 id="lec-ferme-titre">La lecture de ce dossier est fermée</h2>
      <p>${esc(phrase(m))}</p>
      <p class="small muted">Rien n'a été écrit chez le client. Pour le relire, demande-lui un nouvel accès depuis la console.</p>
      <a class="btn btn-primary" href="${esc(retour)}">Revenir à la console</a></div>`;
    document.body.appendChild(el);
    // Ce que la page montrait ne reste pas derrière la fenêtre : l'accès ne court plus, le dossier ne se lit plus.
    const v = document.getElementById('view');
    if (v) {
      const vider = () => { if (v.firstChild) v.replaceChildren(); };
      vider();
      v.setAttribute('inert', '');
      // Le routeur de l'application peut encore dessiner une page après la fermeture (celle qu'on venait de demander, ou
      // la suivante) : ce qui s'y dessine s'efface aussi. Vu sur GitHub, sur une machine lente (1.6.0).
      new MutationObserver(vider).observe(v, { childList: true });
    }
    const lien = el.querySelector('a');
    if (lien) /** @type {HTMLElement} */ (lien).focus();
  }
  /** @param {HTMLElement | null} view */
  function poserLecture(view) {
    const l = w.skanfact && w.skanfact.lecture;
    if (!view || !l) return;
    const fin = l.fin();
    let el = /** @type {HTMLElement | null} */ (view.querySelector(':scope > .lec-bandeau'));
    if (!el) {
      el = document.createElement('div');
      el.className = 'banner lec-bandeau';
      el.setAttribute('role', 'status');
      view.insertBefore(el, view.firstChild);
    }
    // Le nom que la console montre (lu avec le dossier), sinon celui de la fiche société.
    const nomClient = String((l.nom && l.nom()) || (((w.__data) || {}).company || {}).name || 'ce client');
    el.innerHTML = `<span class="acc-ic">${OEIL}</span>
      <span class="acc-texte"><b>Lecture pour le support : le dossier de ${esc(nomClient)}</b>
        <span class="acc-sous">${fin ? `Accordé ${esc(jusqua(fin))} (il reste ${esc(reste(fin))}). ` : ''}Rien de ce que tu fais ici ne s'enregistre ; chaque page que tu ouvres est notée, et le client la voit.</span></span>
      <span class="acc-gestes"><a class="btn btn-sm" href="/console/#/clients/${encodeURIComponent(l.entreprise)}?onglet=support">Revenir à la console</a></span>`;
  }
  // La fin de l'accès ferme la page à l'heure dite, sans attendre une lecture.
  setInterval(() => {
    const l = w.skanfact && w.skanfact.lecture;
    if (!l || fermee !== null) return;
    const fin = l.fin();
    if (fin && Date.parse(fin) <= Date.now()) fermer('cet accès est fini : ses heures sont passées');
    else poserLecture(document.getElementById('view'));
  }, 30_000);
  w.SkanLecture = { poser: poserLecture, fermer };
})();
