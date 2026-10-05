// Le passage entre la page et l'agent local (brique 137 ; docs/bureau.md, B2). Ce qu'il donne est déclaré ici, et
// rien d'autre : imprimer un ticket, ouvrir le tiroir, lire et régler l'imprimante. Le processus principal refuse
// chaque geste qui ne vient pas de la page de SkanFact (son origine exacte) : c'est là que se tient la garde, pas dans
// la page, qu'un script étranger pourrait tromper.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skanfactBureau', Object.freeze({
  imprimerTicket: (html, largeur, options) => ipcRenderer.invoke('bureau:imprimer', { html, largeur, tiroir: Boolean(options && options.tiroir) }),
  ouvrirTiroir: () => ipcRenderer.invoke('bureau:tiroir'),
  imprimante: () => ipcRenderer.invoke('bureau:imprimante'),
  reglerImprimante: (r) => ipcRenderer.invoke('bureau:regler-imprimante', r),
}));
