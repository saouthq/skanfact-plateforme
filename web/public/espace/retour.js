// @ts-check
// Le retour d'un paiement en ligne (brique 78 ; docs/paiement-en-ligne.md ; 14 § 2.2). Le client revient
// de chez le prestataire ; cette page demande au serveur où en est SON paiement (la demande et son secret
// sont dans le fragment « # »). Le serveur le redemande au prestataire : la page ne décide de rien, et
// ce qu'elle dit, c'est ce que le prestataire a confirmé.
(function () {
  'use strict';
  /** @type {any} */ const C = /** @type {any} */ (window).SkanCore;
  const racine = /** @type {HTMLElement} */ (document.getElementById('retour'));
  const esc = (/** @type {unknown} */ x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fragment = location.hash.replace(/^#/, '');
  // Un prestataire qui ajoute sa référence à l'adresse ne coupe rien : on lit chaque nom jusqu'à « & » ou « ? ».
  const lire = (/** @type {string} */ nom) => { const m = new RegExp(`(?:^|[&?])${nom}=([^&?]*)`).exec(fragment); return m ? decodeURIComponent(m[1] ?? '') : ''; };
  const paiement = lire('paiement'), secret = lire('s'), echec = lire('echec') === '1';
  let jeton = '', abonnement = '';
  try {
    jeton = sessionStorage.getItem('skanfact.espace') || '';
    abonnement = sessionStorage.getItem('skanfact.abonnement.retour') || '';
  } catch { /* sans eux, on propose de fermer la page */ }
  // L'abonné de SkanFact, parti de « Ton abonnement » (14b ; docs/abonnement.md B5) : il y revient, dans son entreprise
  // (posée avant de partir ; l'application rouvre l'onglet en la lisant).
  // Un associé parti de « Ton abonnement » de son Cabinet (lot 3, 23/10/2026) : « c: » et le cabinet.
  const deLAbonnement = /^(c:)?[0-9a-f-]{36}$/.test(abonnement);
  const duCabinet = abonnement.startsWith('c:');
  const ici = deLAbonnement ? 'ton abonnement' : 'ton espace';
  const FLECHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const revenir = deLAbonnement
    ? `<a class="r-bouton" href="${duCabinet ? `/v10/cabinet/?c=${encodeURIComponent(abonnement.slice(2))}` : `/v10/?e=${encodeURIComponent(abonnement)}`}">Revenir à ton abonnement ${FLECHE}</a>`
    : jeton
      ? `<a class="r-bouton" href="/espace/#${encodeURIComponent(jeton)}">Revenir à ton espace ${FLECHE}</a>`
      : '<p>Tu peux fermer cette page, et rouvrir le lien que l\'entreprise t\'a donné.</p>';
  // Chaque état a son ton (ok : la menthe ; attente : l'ambre ; refus : le corail) et son icône, sans texte : le titre dit.
  const ICONES = {
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    attente: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
    refus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  };
  /** @typedef {{ montant: string, numero: string, etat: string }} Recu */
  /**
   * La carte : le haut sombre dit l'état ; dessous, le reçu (le montant, la facture, l'état) et la suite. Le pied « État lu
   * auprès du prestataire » ne vient qu'avec un reçu : sans réponse du serveur, rien n'a été lu.
   * @param {'ok' | 'attente' | 'refus'} ton @param {string} titre @param {string} texte @param {string} suite @param {Recu} [recu]
   */
  const dire = (ton, titre, texte, suite, recu) => {
    const corps = recu ? `<div class="r-montant"><span>Montant</span><b>${esc(recu.montant)}</b></div>
        <dl class="r-lignes">
          <div><dt>Facture</dt><dd>${esc(recu.numero)}</dd></div>
          <div><dt>Moyen</dt><dd>Paiement en ligne</dd></div>
          <div><dt>État</dt><dd><span class="r-pastille">${esc(recu.etat)}</span></dd></div>
        </dl>` : '';
    racine.innerHTML = `<section class="r-carte r-${ton}">
      <div class="r-tete"><span class="r-icone">${ICONES[ton]}</span><h1>${esc(titre)}</h1><p>${texte}</p></div>
      ${corps || suite ? `<div class="r-corps">${corps}${suite ? `<div class="r-suite">${suite}</div>` : ''}</div>` : ''}
    </section>${recu ? `
    <p class="r-pied"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>État lu auprès du prestataire de paiement · SkanFact</p>` : ''}`;
  };
  const devise = (/** @type {string} */ d) => (d === 'TND' ? 'DT' : d);

  /** @param {number} essai */
  async function verifier(essai) {
    let r;
    try {
      r = await fetch('/v1/espace/paiement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paiement, s: secret }) });
    } catch {
      dire('attente', 'Le serveur ne répond pas', 'Vérifie ta connexion, puis recharge cette page : ton paiement sera vérifié.', revenir);
      return;
    }
    const lu = await r.json().catch(() => ({}));
    if (!r.ok) { dire('refus', 'Paiement introuvable', esc(typeof lu.motif === 'string' ? lu.motif : 'SkanFact ne retrouve pas ce paiement : rien n\'a été enregistré.'), revenir); return; }
    const somme = C.money(Number(lu.montant), devise(lu.devise));
    // Un numéro ne se coupe pas en fin de ligne (« FAC- » puis « 2026-002 »).
    const num = `<span class="r-num">${esc(lu.numero)}</span>`;
    const recu = (/** @type {string} */ etat) => ({ montant: somme, numero: String(lu.numero ?? ''), etat });
    if (lu.etat === 'encaisse') {
      dire('ok', 'Paiement reçu', `Merci ! La facture ${num} est réglée.`,
        `${revenir}<p>${deLAbonnement ? 'Ton abonnement se met à jour tout seul : la facture y est marquée payée.' : 'La facture est marquée payée dans ton espace.'}</p>`, recu('Payée'));
      return;
    }
    if (lu.etat === 'echoue') { dire('refus', 'Paiement non accepté', `Ce paiement de <b>${esc(somme)}</b> n'est pas enregistré : écris à l'entreprise.`, revenir, recu('Refusé')); return; }
    if (echec) { dire('refus', 'Paiement non abouti', `Le paiement de <b>${esc(somme)}</b> n'a pas abouti : il n'est pas enregistré. Tu peux réessayer depuis ${esc(ici)}.`, revenir, recu('Non abouti')); return; }
    // Le prestataire n'a pas encore confirmé : on redemande un moment, puis on dit ce qui se passera.
    if (essai < 10) {
      dire('attente', 'Confirmation en cours…', `Le prestataire confirme ton paiement de <b>${esc(somme)}</b> pour la facture ${num}.`, '', recu('En cours'));
      setTimeout(() => { void verifier(essai + 1); }, 2000);
      return;
    }
    dire('attente', 'Confirmation en attente', `Le prestataire n'a pas encore confirmé ton paiement de <b>${esc(somme)}</b>. S'il est confirmé, il s'enregistrera tout seul sur la facture.`, revenir, recu('En attente'));
  }

  if (!paiement || !secret) dire('refus', 'Lien de retour incomplet', 'Il manque la référence du paiement : cette page ne peut pas le vérifier.', revenir);
  else void verifier(0);
})();
