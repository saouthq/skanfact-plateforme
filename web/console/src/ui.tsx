// Les pièces des écrans de la console : les dessins, les boutons, les puces d'état, les champs, la fenêtre et le message
// passager. Dessinés pour la console seulement (console.css) : l'application garde les siens.
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { phrase, titre } from './langue.ts';

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
  version: <><path d="M12 18.5V5.5" /><path d="M6.5 11L12 5.5l5.5 5.5" /><path d="M5 20.5h14" /></>,
  nuage: <path d="M7.5 18.5h9.5a4 4 0 0 0 .7-7.94 5.5 5.5 0 0 0-10.5-1.4A4.5 4.5 0 0 0 7.5 18.5z" />,
  disque: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M3.5 13.5h17" /><path d="M7.5 16.3h.01M10.5 16.3h.01" /></>,
  retour: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" /><path d="M4.5 4.5V9H9" /></>,
  echange: <><path d="M4 8h15" /><path d="M15 4l4 4-4 4" /><path d="M20 16H5" /><path d="M9 12l-4 4 4 4" /></>,
  sourdine: <><path d="M11 5.5L6.5 9H3.5v6h3l4.5 3.5z" /><path d="M21 9.5l-5 5M16 9.5l5 5" /></>,
  copier: <><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
  cloche: <><path d="M6 9.5a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15.5 6 9.5z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  points: <><circle cx="5.5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18.5" cy="12" r="1.4" fill="currentColor" /></>,
} as const;
export type NomIcone = keyof typeof DESSINS;

export function Icone({ nom, taille = 18 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg className="c-icone" width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{DESSINS[nom]}</svg>
  );
}

// ── Les boutons ─────────────────────────────────────────────────────────────────────────────────────────────────────
// La fermeture gardée de la fenêtre où un bouton est posé (Dialogue) ; hors d'une fenêtre, rien.
const FermerDuDialogue = createContext<(() => void) | null>(null);
type PropsBouton = {
  children: ReactNode; ton?: 'principal' | 'secondaire' | 'discret' | 'danger'; petit?: boolean; large?: boolean; occupe?: boolean;
  desactive?: boolean; type?: 'button' | 'submit'; onClick?: () => void; icone?: NomIcone; fleche?: boolean; etiquette?: string; id?: string;
  // Le bouton qui referme sa fenêtre sans rien faire (« Annuler », « Garder… ») : dans une fenêtre, il passe par la même
  // garde que la croix et Échap (Dialogue) — une saisie tapée ne se jette pas sans qu'on le demande.
  ferme?: boolean;
};
export function Bouton({ children, ton = 'secondaire', petit, large, occupe = false, desactive = false, type = 'button', onClick, icone, fleche, etiquette, id, ferme }: PropsBouton) {
  const c = ['c-btn', ton === 'secondaire' ? '' : `c-btn-${ton}`, petit ? 'c-btn-petit' : '', large ? 'c-btn-large' : ''].filter(Boolean).join(' ');
  const fermerLaFenetre = useContext(FermerDuDialogue);
  const clic = ferme && fermerLaFenetre ? fermerLaFenetre : onClick;
  return (
    <button type={type} className={c} onClick={clic} disabled={occupe || desactive} aria-busy={occupe || undefined}
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

// ── Le menu d'une ligne (« … ») ─────────────────────────────────────────────────────────────────────────────────────
// Les gestes d'une ligne de tableau derrière un bouton, chacun son icône, son nom et sa phrase (les règles des alertes,
// les membres de l'équipe : un seul mécanisme). Une ligne du bas ouvre son menu vers le haut : dessous, il sortirait de
// la fenêtre, ou du tableau qui défile (qui le couperait). Échap et un clic ailleurs le ferment.
export type ActionLigne = { icone: NomIcone; titre: string; sous?: string; faire: () => void; danger?: boolean };
export function MenuLigne({ etiquette, actions }: { etiquette: string; actions: ActionLigne[] }) {
  const [ouvert, setOuvert] = useState(false);
  // Le menu se pose sur la FENÊTRE (position fixe), jamais dans le tableau : la carte d'une liste coupe ce qui la dépasse,
  // et un menu ouvert vers le haut sur la deuxième ligne n'y montrait que sa moitié. Dessous s'il tient, sinon dessus,
  // et toujours dans l'écran.
  const [place, setPlace] = useState<{ top: number; right: number; haut: boolean } | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  // Sa place, lue sur le bouton : à l'ouverture, puis chaque fois que la page bouge (il suit son bouton ; si le bouton
  // sort de l'écran, il se ferme).
  const placer = useCallback(() => {
    const bouton = zone.current?.querySelector<HTMLElement>('button');
    const liste = zone.current?.querySelector<HTMLElement>('.c-menu-liste');
    if (!bouton || !liste) return;
    const b = bouton.getBoundingClientRect();
    if (b.bottom < 0 || b.top > window.innerHeight) { setOuvert(false); return; }
    const h = liste.getBoundingClientRect().height;
    const dessous = window.innerHeight - b.bottom - 6, dessus = b.top - 6;
    const haut = dessous < h + 6 && dessus > dessous;
    const top = haut ? b.top - 6 - h : b.bottom + 6;
    setPlace({ top: Math.max(8, Math.min(top, window.innerHeight - h - 8)), right: Math.max(8, window.innerWidth - b.right), haut });
  }, []);
  useLayoutEffect(() => {
    if (!ouvert) { setPlace(null); return; }
    placer();
  }, [ouvert, placer]);
  useEffect(() => {
    if (!ouvert) return undefined;
    const ailleurs = (e: MouseEvent) => { if (!zone.current?.contains(e.target as Node)) setOuvert(false); };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOuvert(false); zone.current?.querySelector<HTMLElement>('button')?.focus(); } };
    document.addEventListener('mousedown', ailleurs);
    document.addEventListener('keydown', echap);
    window.addEventListener('scroll', placer, true);
    window.addEventListener('resize', placer);
    // Le premier choix prend le clavier SANS faire défiler la page : sur la dernière ligne, le focus la faisait sauter de
    // 440 points sous la souris.
    zone.current?.querySelector<HTMLElement>('.c-menu-liste button')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', ailleurs); document.removeEventListener('keydown', echap);
      window.removeEventListener('scroll', placer, true); window.removeEventListener('resize', placer);
    };
  }, [ouvert, placer]);
  return (
    <div className="c-menu" ref={zone}>
      <button type="button" className="c-menu-btn" aria-expanded={ouvert} aria-label={etiquette} onClick={() => setOuvert(!ouvert)}>
        <Icone nom="points" taille={20} />
      </button>
      {ouvert ? (
        <div className={`c-menu-liste c-menu-liste-fixe${place?.haut ? ' c-menu-liste-haut' : ''}`}
          style={place ? { top: place.top, right: place.right } : { visibility: 'hidden' }}>
          {actions.map((a) => (
            <button key={a.titre} type="button" className={a.danger ? 'c-menu-danger' : undefined} onClick={() => { setOuvert(false); a.faire(); }}>
              <Icone nom={a.icone} /><span className="c-menu-action"><b>{a.titre}</b>{a.sous ? <span>{a.sous}</span> : null}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Une majuscule en tête (un morceau de texte posé seul : une cellule, une puce). Un texte qui commence par un nombre la
// garde en minuscule : « 6 pièces », jamais « 6 Pièces ».
export const maj = (s: string) => {
  const i = s.search(/[\p{L}\p{N}]/u);
  return i < 0 || !/\p{L}/u.test(s.charAt(i)) ? s : s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
};

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
  valeur: string; changer: (v: string) => void; type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'datetime-local'; autoComplete?: string;
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

export function Zone({ libelle, aide, faute = false, n, valeur, changer, premier, max = 500 }: Commun & { valeur: string; changer: (v: string) => void; premier?: boolean; max?: number }) {
  const f = useFaute<HTMLTextAreaElement>(faute, n);
  const id = useId();
  useEffect(() => { if (premier) f.ref.current?.focus(); }, [premier, f.ref]);
  return (
    <div className={['c-champ', f.rouge ? 'c-champ-faute' : ''].filter(Boolean).join(' ')}>
      <label className="c-champ-libelle" htmlFor={id}>{libelle}</label>
      <textarea ref={f.ref} id={id} value={valeur} rows={3} maxLength={max} aria-invalid={f.rouge || undefined} aria-describedby={aide ? `${id}-aide` : undefined}
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
// Ce qu'on a tapé dans une fenêtre : ses champs de texte. Une liste, une case à cocher se CHOISISSENT : changer d'avis
// n'y coûte qu'un clic, ils ne comptent pas (choisir n'est pas taper).
const CHAMPS_TAPES = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=button]):not([type=submit]):not([type=range]), textarea';
export const saisieDe = (cadre: ParentNode | null | undefined) =>
  JSON.stringify([...(cadre?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(CHAMPS_TAPES) ?? [])].map((c) => c.value));

// Une fenêtre. Échap, la croix et son bouton « Annuler » (`ferme`) la referment ; si l'on y a TAPÉ quelque chose depuis
// son ouverture, ils demandent d'abord « Abandonner cette saisie ? » — un motif d'une ligne ne se perd pas sur une touche.
// L'instantané se prend après le montage : ce que la fenêtre préremplit n'est pas une saisie. Réussi, un geste referme la
// fenêtre par son propre chemin, sans question.
export function Dialogue({ titre: t, sous, fermer, occupe = false, children, pied }: { titre: string; sous?: string | undefined; fermer: () => void; occupe?: boolean; children: ReactNode; pied: ReactNode }) {
  const id = useId();
  const cadre = useRef<HTMLDivElement>(null);
  const corps = useRef<HTMLDivElement>(null);
  const depart = useRef<string | null>(null);
  const [question, setQuestion] = useState(false);
  const enQuestion = useRef(false);
  enQuestion.current = question;
  const demander = useRef(fermer);
  demander.current = () => {
    if (occupe) return;
    if (depart.current !== null && saisieDe(corps.current) !== depart.current) setQuestion(true);
    else fermer();
  };
  const fermerGarde = useCallback(() => { demander.current(); }, []);
  const reprendre = useCallback(() => {
    setQuestion(false);
    requestAnimationFrame(() => corps.current?.querySelector<HTMLElement>(CHAMPS_TAPES)?.focus());
  }, []);
  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    const premier = cadre.current?.querySelector<HTMLElement>('input, textarea, select');
    (premier ?? cadre.current?.querySelector<HTMLElement>('.c-fermer'))?.focus();
    depart.current = saisieDe(corps.current);
    // Échap pendant la question, c'est « reprendre » : la touche qui ferme ne jette jamais ce qu'on a tapé.
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); if (enQuestion.current) reprendre(); else demander.current(); } };
    document.addEventListener('keydown', echap);
    return () => { document.removeEventListener('keydown', echap); avant?.focus?.(); };
  }, [reprendre]);
  // La question pose le curseur sur « Reprendre la saisie » : Entrée ne jette rien par réflexe.
  useEffect(() => { if (question) cadre.current?.querySelector<HTMLElement>('.c-dialogue-question .c-btn-principal')?.focus(); }, [question]);
  return createPortal(
    <div className="c-voile">
      <div className="c-dialogue" role="dialog" aria-modal="true" aria-labelledby={`${id}-titre`} ref={cadre}>
        <FermerDuDialogue.Provider value={fermerGarde}>
          <div className="c-dialogue-tete">
            <div>
              <h2 id={`${id}-titre`}>{t}</h2>
              {sous ? <p className="c-dialogue-sous">{sous}</p> : null}
            </div>
            <button type="button" className="c-fermer" aria-label={titre('console.ecran.fermer')} onClick={fermerGarde}><Icone nom="croix" /></button>
          </div>
          <div className="c-dialogue-corps" ref={corps}>{children}</div>
          <div className="c-dialogue-pied">
            {question ? (
              <div className="c-dialogue-question" role="alert">
                <p><b>{titre('console.ecran.dialogue.abandonner_q')}</b> {phrase('console.ecran.dialogue.perdu')}</p>
                <span className="c-dialogue-question-gestes">
                  <Bouton onClick={fermer}>{titre('console.ecran.dialogue.abandonner')}</Bouton>
                  <Bouton ton="principal" onClick={reprendre}>{titre('console.ecran.dialogue.reprendre')}</Bouton>
                </span>
              </div>
            ) : pied}
          </div>
        </FermerDuDialogue.Provider>
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
