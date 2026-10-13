// Les pièces des écrans de la console : les dessins, les boutons, les puces d'état, les champs, la fenêtre et le message
// passager. Dessinés pour la console seulement (console.css) : l'application garde les siens.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { titre } from './langue.ts';

// ── Les dessins (24 × 24, un trait) ─────────────────────────────────────────────────────────────────────────────────
const DESSINS = {
  decider: <><path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" /></>,
  clients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 19.5c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18.5 14.4c1.6.7 2.6 2.4 3 5.1" /></>,
  service: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  equipe: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" /><path d="M9 12l2 2 4-4" /></>,
  journal: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  chercher: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  cadenas: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  fleche: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  bas: <path d="M6 9l6 6 6-6" />,
  droite: <path d="M9 6l6 6-6 6" />,
  sortir: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h10" /></>,
  soleil: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></>,
  lune: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />,
  personne: <><circle cx="12" cy="8" r="4" /><path d="M4 20.5c1-3.8 4-6 8-6s7 2.2 8 6" /></>,
  telephone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  cache: <><path d="M3 3l18 18" /><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1-1 2.1-1.9 3.1" /><path d="M6.5 6.6C4.4 8 3.1 10.1 2.5 12c1 2.8 4.5 7 9.5 7 1.6 0 3-.4 4.3-1.1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  alerte: <><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5" /><path d="M12 17.5v.5" /></>,
  base: <><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" /><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></>,
  calendrier: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  ok: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  croix: <path d="M6 6l12 12M18 6L6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  courriel: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
  sablier: <path d="M7 3h10M7 21h10M8 3c0 4 4 5.5 4 9s-4 5-4 9M16 3c0 4-4 5.5-4 9s4 5 4 9" />,
  serveur: <><rect x="3.5" y="4" width="17" height="7" rx="1.5" /><rect x="3.5" y="13" width="17" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><path d="M12 7.5v.5" /></>,
  relire: <><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5" /><path d="M4 4v4.5h4.5" /><path d="M4 13a8 8 0 0 0 14.3 4.6L20 15.5" /><path d="M20 20v-4.5h-4.5" /></>,
} as const;
export type NomIcone = keyof typeof DESSINS;

export function Icone({ nom, taille = 18 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg className="c-icone" width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{DESSINS[nom]}</svg>
  );
}

// ── Les boutons ─────────────────────────────────────────────────────────────────────────────────────────────────────
type PropsBouton = {
  children: ReactNode; ton?: 'principal' | 'secondaire' | 'discret' | 'danger'; petit?: boolean; large?: boolean; occupe?: boolean;
  desactive?: boolean; type?: 'button' | 'submit'; onClick?: () => void; icone?: NomIcone; fleche?: boolean; etiquette?: string; id?: string;
};
export function Bouton({ children, ton = 'secondaire', petit, large, occupe = false, desactive = false, type = 'button', onClick, icone, fleche, etiquette, id }: PropsBouton) {
  const c = ['c-btn', ton === 'secondaire' ? '' : `c-btn-${ton}`, petit ? 'c-btn-petit' : '', large ? 'c-btn-large' : ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={c} onClick={onClick} disabled={occupe || desactive} aria-busy={occupe || undefined}
      {...(etiquette ? { 'aria-label': etiquette } : {})} {...(id ? { id } : {})}>
      {icone ? <Icone nom={icone} taille={17} /> : null}
      {children}
      {fleche ? <Icone nom="fleche" taille={17} /> : null}
    </button>
  );
}

// Un lien qui a l'air d'un bouton (il ouvre un écran de la console).
export function Lien({ href, children, ton = 'secondaire', petit, fleche, icone, etiquette }: { href: string; children: ReactNode; ton?: 'principal' | 'secondaire' | 'discret'; petit?: boolean; fleche?: boolean; icone?: NomIcone; etiquette?: string }) {
  const c = ['c-btn', ton === 'secondaire' ? '' : `c-btn-${ton}`, petit ? 'c-btn-petit' : ''].filter(Boolean).join(' ');
  return (
    <a className={c} href={href} {...(etiquette ? { 'aria-label': etiquette } : {})}>
      {icone ? <Icone nom={icone} taille={17} /> : null}{children}{fleche ? <Icone nom="fleche" taille={17} /> : null}
    </a>
  );
}

// Une majuscule en tête (un morceau de texte posé seul : une cellule, une puce).
export const maj = (s: string) => { const i = s.search(/\p{L}/u); return i < 0 ? s : s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1); };

// ── Une puce d'état (un point de couleur, un mot) ───────────────────────────────────────────────────────────────────
export type TonPuce = 'essai' | 'actif' | 'en_retard' | 'lecture_seule' | 'hors' | 'urgent' | 'aujourdhui' | 'semaine' | 'a_regarder' | 'direction' | 'support' | 'technique';
export function Puce({ ton, children }: { ton: TonPuce; children: string }) {
  return <span className={`c-puce c-puce-${ton}`}>{maj(children)}</span>;
}

// Les initiales d'un nom, pour son pavé (« Quincaillerie El Amel » → « QE »).
export function initiales(nom: string): string {
  const mots = nom.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((m) => m.length > 1 || /\p{N}/u.test(m));
  const lettres = (mots.length > 1 ? [mots[0], mots[1]] : [mots[0] ?? nom]).map((m) => (m ?? '').charAt(0));
  return lettres.join('').toUpperCase() || '·';
}
export function Avatar({ nom, nuit }: { nom: string; nuit?: boolean }) {
  return <span className={`c-avatar${nuit ? ' c-avatar-nuit' : ''}`} aria-hidden="true" data-donnee>{initiales(nom)}</span>;
}

// ── Les champs ──────────────────────────────────────────────────────────────────────────────────────────────────────
type Commun = { libelle: string; aide?: string | undefined; faute?: boolean; n?: number };
// Un champ refusé prend le focus et se montre en rouge, jusqu'à ce qu'on le touche.
function useFaute<T extends HTMLElement>(faute: boolean, n: number | undefined) {
  const ref = useRef<T>(null);
  const [rouge, setRouge] = useState(false);
  useEffect(() => {
    if (!faute) return;
    setRouge(true);
    ref.current?.focus();
  }, [faute, n]);
  return { ref, rouge, effacer: () => setRouge(false) };
}

type PropsChamp = Commun & {
  valeur: string; changer: (v: string) => void; type?: 'text' | 'email' | 'password' | 'number'; autoComplete?: string;
  inputMode?: 'numeric' | 'text' | 'email'; placeholder?: string; premier?: boolean; revelable?: boolean; min?: number; max?: number; classe?: string; nom?: string;
};
export function Champ({ libelle, aide, faute = false, n, valeur, changer, type = 'text', autoComplete, inputMode, placeholder, premier, revelable, min, max, classe, nom }: PropsChamp) {
  const f = useFaute<HTMLInputElement>(faute, n);
  const id = useId();
  const [vu, setVu] = useState(false);
  useEffect(() => { if (premier) f.ref.current?.focus(); }, [premier, f.ref]);
  const saisie = (
    <input ref={f.ref} id={id} type={revelable && vu ? 'text' : type} value={valeur} aria-invalid={f.rouge || undefined}
      aria-describedby={aide ? `${id}-aide` : undefined} onChange={(e) => { f.effacer(); changer(e.target.value); }}
      {...(autoComplete ? { autoComplete } : {})} {...(inputMode ? { inputMode } : {})} {...(placeholder ? { placeholder } : {})}
      {...(min !== undefined ? { min } : {})} {...(max !== undefined ? { max } : {})} {...(nom ? { name: nom } : {})} />
  );
  return (
    <div className={['c-champ', f.rouge ? 'c-champ-faute' : '', classe ?? ''].filter(Boolean).join(' ')}>
      <label className="c-champ-libelle" htmlFor={id}>{libelle}</label>
      {revelable ? (
        <div className="c-champ-oeil">
          {saisie}
          <button type="button" className="c-oeil" aria-pressed={vu} aria-label={titre(vu ? 'console.ecran.entree.cacher_mdp' : 'console.ecran.entree.afficher_mdp')}
            onClick={() => { setVu(!vu); f.ref.current?.focus(); }}>{titre(vu ? 'console.ecran.entree.cacher' : 'console.ecran.entree.afficher')}</button>
        </div>
      ) : saisie}
      {aide ? <span className="c-champ-aide" id={`${id}-aide`}>{aide}</span> : null}
    </div>
  );
}

export function Zone({ libelle, aide, faute = false, n, valeur, changer, premier }: Commun & { valeur: string; changer: (v: string) => void; premier?: boolean }) {
  const f = useFaute<HTMLTextAreaElement>(faute, n);
  const id = useId();
  useEffect(() => { if (premier) f.ref.current?.focus(); }, [premier, f.ref]);
  return (
    <div className={['c-champ', f.rouge ? 'c-champ-faute' : ''].filter(Boolean).join(' ')}>
      <label className="c-champ-libelle" htmlFor={id}>{libelle}</label>
      <textarea ref={f.ref} id={id} value={valeur} rows={3} maxLength={500} aria-invalid={f.rouge || undefined} aria-describedby={aide ? `${id}-aide` : undefined}
        onChange={(e) => { f.effacer(); changer(e.target.value); }} />
      {aide ? <span className="c-champ-aide" id={`${id}-aide`}>{aide}</span> : null}
    </div>
  );
}

// `donnee` : une option qui est une donnée (le nom d'un membre) et non un texte du catalogue.
export function Choix({ libelle, aide, valeur, changer, options }: Commun & { valeur: string; changer: (v: string) => void; options: { valeur: string; texte: string; donnee?: boolean }[] }) {
  const id = useId();
  return (
    <div className="c-champ">
      <label className="c-champ-libelle" htmlFor={id}>{libelle}</label>
      <select id={id} value={valeur} onChange={(e) => changer(e.target.value)} aria-describedby={aide ? `${id}-aide` : undefined}>
        {options.map((o) => <option key={o.valeur} value={o.valeur} {...(o.donnee ? { 'data-donnee': true } : {})}>{o.texte}</option>)}
      </select>
      {aide ? <span className="c-champ-aide" id={`${id}-aide`}>{aide}</span> : null}
    </div>
  );
}

// ── La fenêtre : un titre, sa phrase, le corps, et les boutons en pied. Échap, la croix ou « Annuler » la ferment (sauf
// pendant un geste) ; un clic à côté, jamais : c'est le geste le plus accidentel, et il jetterait ce qu'on vient de taper
// (un nombre de jours, un motif). Le curseur entre dans le premier champ, sinon sur « Fermer ».
export function Dialogue({ titre: t, sous, fermer, occupe = false, children, pied }: { titre: string; sous?: string | undefined; fermer: () => void; occupe?: boolean; children: ReactNode; pied: ReactNode }) {
  const id = useId();
  const cadre = useRef<HTMLDivElement>(null);
  const fermerSiLibre = useRef(fermer);
  fermerSiLibre.current = () => { if (!occupe) fermer(); };
  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    const premier = cadre.current?.querySelector<HTMLElement>('input, textarea, select');
    (premier ?? cadre.current?.querySelector<HTMLElement>('.c-fermer'))?.focus();
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); fermerSiLibre.current(); } };
    document.addEventListener('keydown', echap);
    return () => { document.removeEventListener('keydown', echap); avant?.focus?.(); };
  }, []);
  return createPortal(
    <div className="c-voile">
      <div className="c-dialogue" role="dialog" aria-modal="true" aria-labelledby={`${id}-titre`} ref={cadre}>
        <div className="c-dialogue-tete">
          <div>
            <h2 id={`${id}-titre`}>{t}</h2>
            {sous ? <p className="c-dialogue-sous">{sous}</p> : null}
          </div>
          <button type="button" className="c-fermer" aria-label={titre('console.ecran.fermer')} onClick={() => fermerSiLibre.current()}><Icone nom="croix" /></button>
        </div>
        <div className="c-dialogue-corps">{children}</div>
        <div className="c-dialogue-pied">{pied}</div>
      </div>
    </div>, document.body);
}

// ── Le message passager : ce qui vient de se faire, ou ce qui est refusé (en rouge) ─────────────────────────────────
type Message = { texte: string; erreur: boolean; n: number };
let poser: ((m: Message) => void) | null = null;
let compte = 0;
export function toast(texte: string, erreur = false) { poser?.({ texte, erreur, n: ++compte }); }
export function Toast() {
  const [m, setM] = useState<Message | null>(null);
  useEffect(() => { poser = setM; return () => { poser = null; }; }, []);
  useEffect(() => {
    if (!m) return;
    const t = setTimeout(() => setM((x) => (x?.n === m.n ? null : x)), 3600);
    return () => clearTimeout(t);
  }, [m]);
  return <div id="c-toast" role={m?.erreur ? 'alert' : 'status'} className={m ? `c-montre${m.erreur ? ' c-erreur' : ''}` : ''}>{m?.texte ?? ''}</div>;
}

// ── Ce qui se dit à la place d'une liste : vide, en lecture, ou en panne ────────────────────────────────────────────
export function Vide({ children, icone = 'ok' }: { children: ReactNode; icone?: NomIcone }) {
  return <div className="c-vide"><span className="c-vide-icone"><Icone nom={icone} /></span><p>{children}</p></div>;
}
export function Alerte({ ton, children, icone }: { ton: 'danger' | 'attention' | 'info'; children: ReactNode; icone?: NomIcone }) {
  return <div className={`c-alerte c-alerte-${ton}`} role={ton === 'danger' ? 'alert' : undefined}><Icone nom={icone ?? (ton === 'info' ? 'info' : 'alerte')} /><div className="c-alerte-texte">{children}</div></div>;
}
