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
  let jeton = '';
  try { jeton = sessionStorage.getItem('skanfact.espace') || ''; } catch { /* sans lui, on propose de fermer la page */ }
  const revenir = jeton
    ? `<p><a class="bouton principal" href="/espace/#${encodeURIComponent(jeton)}">Revenir à ton espace</a></p>`
    : '<p>Tu peux fermer cette page, et rouvrir le lien que l\'entreprise t\'a donné.</p>';
  /** @param {string} titre @param {string} texte @param {string} suite */
  const dire = (titre, texte, suite) => {
    racine.innerHTML = `<section class="carte retour"><h1>${esc(titre)}</h1><p>${esc(texte)}</p>${suite}</section>`;
  };
  const devise = (/** @type {string} */ d) => (d === 'TND' ? 'DT' : d);

  /** @param {number} essai */
  async function verifier(essai) {
    let r;
    try {
      r = await fetch('/v1/espace/paiement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paiement, s: secret }) });
    } catch {
      dire('Le serveur ne répond pas.', 'Vérifie ta connexion, puis recharge cette page : ton paiement sera vérifié.', revenir);
      return;
    }
    const lu = await r.json().catch(() => ({}));
    if (!r.ok) { dire('Ce paiement est inconnu.', typeof lu.motif === 'string' ? lu.motif : 'Reviens à ton espace par le lien que l\'entreprise t\'a donné.', revenir); return; }
    const somme = C.money(Number(lu.montant), devise(lu.devise));
    if (lu.etat === 'encaisse') { dire('Paiement reçu', `${somme} pour la facture ${lu.numero}. Merci !`, revenir); return; }
    if (lu.etat === 'echoue') { dire('Paiement non accepté', `Ce paiement de ${somme} n'est pas enregistré : écris à l'entreprise.`, revenir); return; }
    if (echec) { dire('Paiement non abouti', `Le paiement de ${somme} n'a pas abouti : il n'est pas enregistré. Tu peux réessayer depuis ton espace.`, revenir); return; }
    // Le prestataire n'a pas encore confirmé : on redemande un moment, puis on dit ce qui se passera.
    if (essai < 10) {
      dire('Confirmation en cours…', `Le prestataire confirme ton paiement de ${somme} pour la facture ${lu.numero}.`, '');
      setTimeout(() => { void verifier(essai + 1); }, 2000);
      return;
    }
    dire('Confirmation en attente', `Le prestataire n'a pas encore confirmé ton paiement de ${somme}. S'il est confirmé, il s'enregistrera tout seul sur la facture.`, revenir);
  }

  if (!paiement || !secret) dire('Ce lien de retour est incomplet.', 'Reviens à ton espace par le lien que l\'entreprise t\'a donné.', revenir);
  else void verifier(0);
})();
