// Un seul bouton principal par écran (règle du projet) ; les autres sont discrets. Au moins 44
// points de haut : un doigt doit pouvoir les toucher.
import type { ReactNode } from 'react';

type Props = { children: ReactNode; principal?: boolean; occupe?: boolean; type?: 'submit' | 'button'; onClick?: () => void };

export function Bouton({ children, principal = false, occupe = false, type = 'button', onClick }: Props) {
  const style = principal
    ? 'bg-accent text-white hover:bg-accent-fonce'
    : 'bg-transparent text-accent hover:bg-accent-pale';
  return (
    <button type={type} onClick={onClick} disabled={occupe} aria-busy={occupe || undefined}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${style}`}>
      {children}
    </button>
  );
}
