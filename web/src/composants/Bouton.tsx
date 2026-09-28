// Les boutons de la v10 : `.btn`, le principal en `.btn-primary` (un seul par écran : l'étape
// suivante), le discret en `.btn-ghost`, le petit en `.btn-sm`. Un bouton occupé ne part pas deux fois.
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode; principal?: boolean; discret?: boolean; petit?: boolean; danger?: boolean; occupe?: boolean;
  type?: 'submit' | 'button'; onClick?: () => void; id?: string; classe?: string; titre?: string;
};

export function Bouton({ children, principal, discret, petit, danger, occupe = false, type = 'button', onClick, id, classe, titre }: Props) {
  const c = ['btn', principal ? 'btn-primary' : '', discret ? 'btn-ghost' : '', petit ? 'btn-sm' : '', danger ? 'btn-danger' : '', classe ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={c} onClick={onClick} disabled={occupe} aria-busy={occupe || undefined} {...(id ? { id } : {})} {...(titre ? { title: titre } : {})}>
      {children}
    </button>
  );
}
