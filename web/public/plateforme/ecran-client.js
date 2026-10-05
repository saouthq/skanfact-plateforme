// @ts-check
// L'écran tourné vers le client (la caisse tactile, 05/10/2026 ; docs/caisse.md, « La caisse tactile »). La caisse du
// même poste lui dit ce qu'elle montre, par un canal du navigateur propre à l'entreprise (« ?e= ») : le ticket en cours,
// ce qu'il reste à payer, la monnaie. Il ne lit rien au serveur, ne garde rien, et n'a aucun geste : on le regarde.
(() => {
  const e = new URLSearchParams(location.search).get('e') || '';
  /** @param {string} id */
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  /** @param {unknown} v */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
  const OK = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
  /** @typedef {{ etat: string, societe?: string, pied?: string, lignes?: { nom: string, qte: string, total: string }[], remise?: string, total?: string, recu?: string, rendu?: string, numero?: string }} Etat */
  /** @param {Etat} m */
  const dessiner = (m) => {
    $('ec-societe').textContent = m.societe || 'SkanFact';
    $('ec-pied').textContent = m.pied || 'Merci de votre visite.';
    $('ec-etat').textContent = m.etat === 'vente' ? 'Votre ticket' : m.etat === 'paiement' ? 'Paiement' : '';
    const lignes = m.lignes || [];
    const corps = $('ec-corps');
    if (m.etat === 'merci') {
      corps.innerHTML = `<div class="centre"><span class="ok">${OK}</span><span class="grand">Merci, à bientôt !</span>
        ${m.rendu ? `<span class="moyen">Votre monnaie</span><span class="montant">${esc(m.rendu)}</span>` : ''}
        <span class="moyen">${m.recu ? `Reçu ${esc(m.recu)} · ` : ''}payé ${esc(m.total)}${m.numero ? ` · ticket ${esc(m.numero)}` : ''}</span></div>`;
      return;
    }
    if (!lignes.length) {
      corps.innerHTML = `<div class="centre"><span class="grand">Bienvenue</span><span class="moyen">${esc(m.societe || '')}</span></div>`;
      return;
    }
    // Les dernières lignes, la plus récente en bas : un long ticket défile comme sur un rouleau.
    const vues = lignes.slice(-8);
    const paiement = m.etat === 'paiement';
    corps.innerHTML = `<div class="lignes">${vues.map((l) => `<div class="ligne"><span class="q">${esc(l.qte)} ×</span><span class="n">${esc(l.nom)}</span><span class="t">${esc(l.total)}</span></div>`).join('')}
        ${m.remise ? `<div class="ligne remise"><span class="q"></span><span class="n">Remise</span><span class="t">${esc(m.remise)}</span></div>` : ''}</div>
      <div class="total"><span>${paiement ? 'À payer' : 'Total'}</span><b>${esc(m.total)}</b>
        ${paiement && m.recu ? `<small>Reçu ${esc(m.recu)}</small>` : ''}${paiement && m.rendu ? `<small>Votre monnaie ${esc(m.rendu)}</small>` : ''}
        ${!paiement ? `<small>${lignes.length} ligne${lignes.length > 1 ? 's' : ''}</small>` : ''}</div>`;
  };
  dessiner({ etat: 'repos' });
  if (typeof BroadcastChannel === 'undefined') return;
  const canal = new BroadcastChannel(`skanfact-ecran-client:${e}`);
  canal.onmessage = (m) => { if (m.data && m.data.etat) dessiner(m.data); };
  // À l'ouverture, demander à la caisse ce qu'elle montre.
  canal.postMessage({ demande: true });
})();
