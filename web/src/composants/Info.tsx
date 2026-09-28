// La bulle « i » de la v10 (`button.i`, `#info-pop`) : un titre et son explication, posés par-dessus
// la page, sous le bouton (au-dessus s'il n'y a pas la place). Rien ne bouge dessous ; une seule
// bulle ouverte à la fois ; un clic ailleurs, Échap ou un changement de taille la ferme.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { titre as enTitre } from '../langue.ts';

let fermerLaBulleOuverte: (() => void) | null = null;

export function Info({ titre, texte }: { titre: string; texte: string }) {
  const [ouverte, setOuverte] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const bulle = useRef<HTMLDivElement>(null);

  // Placée comme dans la v10 : centrée sous le bouton, jamais hors de l'écran.
  useLayoutEffect(() => {
    if (!ouverte || !bouton.current || !bulle.current) return;
    const r = bouton.current.getBoundingClientRect();
    const w = bulle.current.offsetWidth;
    const h = bulle.current.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    setPos({ left, top });
  }, [ouverte]);

  useEffect(() => {
    if (!ouverte) return;
    const fermer = () => setOuverte(false);
    const ailleurs = (e: MouseEvent) => {
      if (!bulle.current?.contains(e.target as Node) && !bouton.current?.contains(e.target as Node)) fermer();
    };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') fermer(); };
    document.addEventListener('mousedown', ailleurs);
    document.addEventListener('keydown', echap);
    window.addEventListener('resize', fermer);
    return () => {
      document.removeEventListener('mousedown', ailleurs);
      document.removeEventListener('keydown', echap);
      window.removeEventListener('resize', fermer);
    };
  }, [ouverte]);

  const basculer = () => {
    if (ouverte) { setOuverte(false); return; }
    fermerLaBulleOuverte?.();
    fermerLaBulleOuverte = () => setOuverte(false);
    setPos(null);
    setOuverte(true);
  };

  return (
    <>
      <button ref={bouton} type="button" className="i" aria-expanded={ouverte}
        aria-label={enTitre('ecran.explication', { sujet: titre })} title={enTitre('ecran.quest_ce')}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); basculer(); }}>i</button>
      {ouverte ? createPortal(
        <div id="info-pop" ref={bulle} role="dialog" aria-label={titre} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
          <div className="ip-head">{titre}<button type="button" className="ip-close" aria-label={enTitre('ecran.fermer')} onClick={() => setOuverte(false)}><span data-donnee>✕</span></button></div>
          <div className="ip-body">{texte}</div>
        </div>, document.body) : null}
    </>
  );
}

// Un libellé suivi de sa bulle, sur une seule ligne (`.fl` de la v10).
export function Libelle({ texte, aide }: { texte: string; aide?: string | undefined }) {
  return aide ? <span className="fl">{texte} <Info titre={texte} texte={aide} /></span> : <span>{texte}</span>;
}

