// Le cadre d'un écran : le nom de SkanFact, un titre, le contenu. La largeur suit l'écran : pensé
// d'abord pour un téléphone (14 § 2.6).
import type { ReactNode } from 'react';

export function Page({ titre, children, haut }: { titre: string; children: ReactNode; haut?: ReactNode }) {
  return (
    <div className="min-h-full px-4 py-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          {/* Le nom du produit ne se traduit pas. */}
          <span className="text-lg font-bold tracking-tight text-accent" data-donnee>SkanFact</span>
          {haut}
        </div>
        <main className="flex flex-col gap-5 rounded-2xl border border-trait bg-surface p-5 sm:p-7">
          <h1 className="text-2xl font-semibold text-balance">{titre}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}

// Un refus qui ne tient à aucun champ : ce qui est refusé et pourquoi, en tête du formulaire.
export function Refus({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return <p role="alert" className="rounded-lg bg-refus-fond px-3 py-2 text-sm text-refus">{texte}</p>;
}
