// Un champ de la v10 : `<label class="field">`, son libellé avec sa bulle « i », puis la saisie. Un
// champ refusé se MONTRE comme dans la v10 (`refus()` de app.js) : il prend le focus et se marque en
// rouge (`champ-faute`), pendant que le message dit pourquoi en bas de l'écran ; le rouge s'efface
// dès qu'on le touche — le laisser serait accuser quelqu'un qui a déjà corrigé.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { titre } from '../langue.ts';
import { Libelle } from './Info.tsx';

// Le refus d'un champ : `n` change à chaque refus, même quand le champ est le même ; `texte`, ce qu'il dit.
export type Faute = { champ: string; n: number; texte?: string; aussi?: Record<string, string> } | null;

function useFaute<T extends HTMLElement>(faute: boolean, n: number | undefined, vise = true) {
  const ref = useRef<T>(null);
  // (issue 4, ENTREE-11) Plusieurs cases refusées d'un coup : seule la première prend le curseur.
  const viseRef = useRef(vise);
  viseRef.current = vise;
  const [rouge, setRouge] = useState(false);
  useEffect(() => { if (faute) setRouge(true); }, [faute, n]);
  // (1.99.2) Le focus vient APRÈS le rendu qui montre le refus : son message sous le champ (1.99.0) rebâtit le champ, et
  // un focus posé avant tombait sur la saisie remplacée (le curseur n'était plus nulle part).
  useEffect(() => {
    if (!faute || !rouge || !viseRef.current) return;
    ref.current?.focus();
    try { ref.current?.scrollIntoView({ block: 'center' }); } catch { /* un vieux navigateur : le focus suffit */ }
  }, [faute, n, rouge]);
  return { ref, rouge, effacer: () => setRouge(false) };
}

type Commun = { libelle: string; aide?: string | undefined; faute?: boolean; n?: number | undefined; refus?: string | undefined; obligatoire?: boolean; classe?: string; vise?: boolean | undefined };

// (1.121.0) Le libellé porte la bulle « i », un bouton : sans `htmlFor`, le navigateur relie le libellé à ce bouton (le
// premier élément actif qu'il contient), et la saisie restait sans nom (un lecteur d'écran disait « champ de texte »,
// un clic sur le libellé ne posait pas le curseur). Son nom est le libellé seul, sans « Explication : … » de la bulle.
// Recette de l'abonnement, 23/10/2026.
function Cadre({ libelle, aide, rouge, obligatoire, classe, pour, children }: Commun & { rouge: boolean; pour: string; children: ReactNode }) {
  return (
    <label htmlFor={pour} className={['field', classe, obligatoire ? 'obligatoire' : '', rouge ? 'champ-faute' : ''].filter(Boolean).join(' ')}>
      <Libelle texte={libelle} aide={aide} />
      {children}
    </label>
  );
}

type PropsChamp = Commun & {
  valeur: string; changer: (v: string) => void; type?: 'text' | 'email' | 'password' | 'date';
  autoComplete?: string; inputMode?: 'numeric' | 'decimal' | 'text' | 'email'; placeholder?: string; propositions?: string[]; nom?: string;
  // Le curseur y attend dès l'ouverture de l'écran (le code du téléphone : on n'a rien d'autre à y faire).
  premier?: boolean;
  // Un mot de passe qu'on peut afficher (« Afficher » / « Cacher », lot entrée) ; ce qui se lit sous la saisie (l'aide
  // qui suit la frappe : la jauge du mot de passe, la forme du matricule).
  revelable?: boolean; dessous?: ReactNode; maxLength?: number;
  // (issue 18, ENT2-3) Une valeur qui ne se change pas sur cet écran (l'adresse d'une invitation, qui lui est réservée).
  lecture?: boolean;
};

export function Champ({ valeur, changer, type = 'text', autoComplete, inputMode, placeholder, propositions, nom, premier = false, revelable = false, dessous, maxLength, lecture = false, faute = false, n, refus, vise = true, ...cadre }: PropsChamp) {
  const f = useFaute<HTMLInputElement>(faute, n, vise);
  const id = useId();
  const [vu, setVu] = useState(false);
  const enveloppe = useRef(false);
  useEffect(() => { if (premier) f.ref.current?.focus(); }, [premier, f.ref]);
  const liste = propositions?.length ? `${nom ?? cadre.libelle}-propositions`.replace(/\s+/g, '-') : undefined;
  const champ = (
    <Cadre {...cadre} rouge={f.rouge} pour={id}>
      <input ref={f.ref} id={id} aria-label={cadre.libelle} type={revelable && vu ? 'text' : type} value={valeur} onChange={(e) => { f.effacer(); changer(e.target.value); }}
        aria-invalid={f.rouge || undefined} {...(nom ? { name: nom } : {})} {...(placeholder ? { placeholder } : {})} {...(maxLength ? { maxLength } : {})} {...(lecture ? { readOnly: true, 'aria-readonly': true } : {})}
        {...(autoComplete ? { autoComplete } : {})} {...(inputMode ? { inputMode } : {})} {...(liste ? { list: liste } : {})} />
      {liste ? <datalist id={liste}>{propositions?.map((p) => <option key={p} value={p} />)}</datalist> : null}
    </Cadre>
  );
  // (1.99.0) Refusé, le champ dit pourquoi sous lui, tant qu'on n'y a pas retouché : le message du bas de l'écran
  // s'efface en quelques secondes, et l'aide d'en dessous (« Matricule complet ») disait le contraire du refus
  // (« déjà celui d'une autre entreprise »), parcours du 21/10/2026.
  const sous = f.rouge && refus ? <span className="ent-aide alerte" role="alert">{refus}</span> : dessous;
  // (issue 4, ENTREE-4) Le refus garde sa place : il part à la première frappe, et tout ce qui suit remontait sous le
  // curseur. Une fois refusé, le champ réserve la hauteur du dernier refus ET celle de son aide (la plus haute décide,
  // `.ent-aide-pile`), et y montre l'un ou l'autre.
  const dernierRefus = useRef<ReactNode>(undefined);
  if (f.rouge && refus) dernierRefus.current = refus;
  const place = dernierRefus.current === undefined ? sous : (
    <span className="ent-aide-pile">
      <span className="ent-aide-gabarit" aria-hidden="true">{dernierRefus.current}</span>
      {sous}
      {sous !== dessous && dessous ? <span className="ent-aide-cache" aria-hidden="true">{dessous}</span> : null}
    </span>
  );
  // (1.373.0) Une fois enveloppé, le champ le reste : au premier caractère tapé après un refus, le message partait, le
  // champ repassait « nu », React le rebâtissait, et le curseur n'était plus nulle part — la suite de la frappe partait
  // dans le vide (un cabinet créé sous le nom « C », revue du 16/11/2026).
  if (sous) enveloppe.current = true;
  if (!revelable && !sous && !enveloppe.current) return champ;
  // Le bouton « Afficher » vit à côté du libellé, jamais dedans : un libellé ne porte qu'une saisie.
  return (
    <div className={['ent-champ', cadre.classe ?? ''].filter(Boolean).join(' ')}>
      {revelable ? (
        <div className="ent-oeil-zone">
          {champ}
          <button type="button" className="ent-oeil" aria-pressed={vu} aria-label={titre(vu ? 'ecran.champ.cacher_mdp' : 'ecran.champ.afficher_mdp')}
            onClick={() => { setVu(!vu); f.ref.current?.focus(); }}>{titre(vu ? 'ecran.champ.cacher' : 'ecran.champ.afficher')}</button>
        </div>
      ) : champ}
      {place}
    </div>
  );
}

type PropsChoix = Commun & { valeur: string; changer: (v: string) => void; options: { valeur: string; texte: string; donnee?: boolean }[] };

export function Choix({ valeur, changer, options, faute = false, n, ...cadre }: PropsChoix) {
  const f = useFaute<HTMLSelectElement>(faute, n);
  const id = useId();
  return (
    <Cadre {...cadre} rouge={f.rouge} pour={id}>
      <select ref={f.ref} id={id} aria-label={cadre.libelle} value={valeur} onChange={(e) => { f.effacer(); changer(e.target.value); }} aria-invalid={f.rouge || undefined}>
        {options.map((o) => <option key={o.valeur} value={o.valeur} {...(o.donnee ? { 'data-donnee': true } : {})}>{o.texte}</option>)}
      </select>
    </Cadre>
  );
}

// Une case à cocher de la v10 (`label.check`), avec sa bulle.
export function Case({ libelle, aide, coche, changer }: { libelle: string; aide?: string; coche: boolean; changer: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={coche} onChange={(e) => changer(e.target.checked)} /> <Libelle texte={libelle} aide={aide} />
    </label>
  );
}
