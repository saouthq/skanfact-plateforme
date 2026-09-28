// Un champ : son libellé, son « i », et la place de son refus RÉSERVÉE (un refus qui apparaît ne
// pousse rien). Un champ refusé se montre : il prend le focus, et le refus dit pourquoi.
import { useEffect, useId, useRef } from 'react';
import { Aide } from './Aide.tsx';

type Props = {
  libelle: string; aide: string; valeur: string; changer: (v: string) => void;
  type?: 'text' | 'email' | 'password'; refus?: string | null; autoComplete?: string; inputMode?: 'numeric' | 'text' | 'email';
};

export function Champ({ libelle, aide, valeur, changer, type = 'text', refus = null, autoComplete, inputMode }: Props) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (refus) ref.current?.focus(); }, [refus]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">{libelle}</label>
        <Aide texte={aide} />
      </div>
      <input ref={ref} id={id} type={type} value={valeur} onChange={(e) => changer(e.target.value)}
        aria-invalid={refus ? true : undefined} aria-describedby={refus ? `${id}-refus` : undefined}
        {...(autoComplete ? { autoComplete } : {})} {...(inputMode ? { inputMode } : {})}
        className={`h-11 w-full min-w-0 rounded-lg border bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent ${refus ? 'border-refus' : 'border-trait'}`} />
      <p id={`${id}-refus`} className="min-h-5 text-sm text-refus" role={refus ? 'alert' : undefined}>{refus ?? ''}</p>
    </div>
  );
}
