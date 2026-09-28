// Les dessins de la barre latérale, repris tels quels de la v10 (`ICONES` de src/renderer/app.js,
// branche beta) : une page = un dessin.
export const ICONES: Record<string, string> = {
  dashboard: '<path d="M3 12l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  devis: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
  factures: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  clients: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  modules: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
  // La porte de la v10 : découvrir avec un exemple, commencer avec son entreprise.
  decouvrir: '<path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z"/><path d="M9 4v13M15 7v13"/>',
  demarrer: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  // La sortie : la porte et sa flèche.
  sortir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
};

// Un dessin, inséré comme la v10 l'insère (le texte vient de ce fichier, jamais d'une donnée).
export function Icone({ id }: { id: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONES[id] ?? ICONES.modules ?? '' }} />;
}
