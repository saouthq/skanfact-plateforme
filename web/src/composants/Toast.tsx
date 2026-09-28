// Le message en bas de l'écran de la v10 (`#toast`) : ce qui vient de se faire, ou ce qui est refusé
// (en rouge). Il s'efface seul après 2,6 secondes, comme dans la v10 ; un refus qui tient à un champ
// marque AUSSI ce champ, qui prend le focus (`Champ`).
import { useEffect, useState } from 'react';

type Message = { texte: string; erreur: boolean; n: number };
let poser: ((m: Message) => void) | null = null;
let compte = 0;

export function toast(texte: string, erreur = false) { poser?.({ texte, erreur, n: ++compte }); }

export function Toast() {
  const [m, setM] = useState<Message | null>(null);
  useEffect(() => { poser = setM; return () => { poser = null; }; }, []);
  useEffect(() => {
    if (!m) return;
    const t = setTimeout(() => setM((x) => (x?.n === m.n ? null : x)), 2600);
    return () => clearTimeout(t);
  }, [m]);
  return <div id="toast" role={m?.erreur ? 'alert' : 'status'} className={m ? `show${m.erreur ? ' error' : ''}` : ''}>{m?.texte ?? ''}</div>;
}
