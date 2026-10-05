// @ts-check
// La virgule est la décimale dans tous les champs de nombre, quelle que soit la langue du navigateur.
//
// La v10 l'avait appris à ses dépens (10.12.0, H-E28) : un champ `type=number` lit ce qu'on y tape dans
// la langue du NAVIGATEUR, pas dans celle de la page ; réglé en anglais (ou en arabe), « 38,475 » tapé
// dans un prix devenait 38 475, et « 2,5 » dans une quantité devenait 25 : la virgule avalée comme un
// séparateur de milliers, sans un mot, et une facture mille fois trop chère. L'application de bureau
// l'avait réglé en imposant le français à tout le programme (`--lang=fr-FR`, src/main.js de la v10) ;
// dans un navigateur, la page ne choisit pas sa langue. Retrouvé le 05/10/2026 sur le serveur d'essai,
// en tapant un prix au clavier comme un commerçant (docs/pont-v10.md, « La virgule des champs de nombre »).
//
// Ce qu'on tape ou colle dans un champ de nombre passe donc d'abord par ici : la (dernière) virgule est
// la décimale et devient un point, le seul séparateur que tous les navigateurs lisent pareil dans toutes
// les langues ; les points et virgules d'avant elle séparaient les milliers (« 1.250,500 ») et s'en vont.
// Le point tapé sans virgule reste tel quel : « 1.250 », comme sur une étiquette de prix, est un dinar
// deux cent cinquante. Ce fichier ne touche à aucun écran de la v10 : il corrige la frappe avant que le
// navigateur ne la lise.
(function () {
  'use strict';
  document.addEventListener('beforeinput', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
    // Dans un champ de saisie, ce qui est tapé ou collé arrive dans `data`.
    const texte = e.data || '';
    const i = texte.lastIndexOf(',');
    if (i < 0) return;
    e.preventDefault();
    // Le navigateur écrit le texte corrigé à la place du curseur, comme s'il avait été tapé : l'écran le lit
    // par ses événements habituels.
    document.execCommand('insertText', false, texte.slice(0, i).replace(/[.,]/g, '') + '.' + texte.slice(i + 1));
  }, true);
})();
