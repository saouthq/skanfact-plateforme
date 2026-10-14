// Les graphiques de la console (Console 3 : le service). Dessinés à la main, sans bibliothèque : le tracé dans un SVG étiré
// sur toute sa largeur, chaque texte en HTML par-dessus — un texte ne s'étire jamais. Chacun se lit à la souris (survoler,
// toucher) ET au clavier (Tab, puis ← →, Début, Fin, Échap) ; la bulle dit les chiffres exacts, et un lecteur d'écran les
// entend (une région « polie »). Une couleur dit un état, jamais seule : la bulle et la légende le nomment, et ce qui n'est
// pas mesuré est hachuré, pas seulement gris. Les graduations d'une courbe vivent dans une marge à sa gauche : un tracé ne
// passe jamais sur un chiffre.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { reperesGardes } from './axe.ts';

// Un état, jamais seul : sa couleur, la bulle et la légende le nomment. « sansobjet » : rien n'était à faire (la copie hors
// de la machine d'une nuit où la sauvegarde a échoué : il n'y avait rien à envoyer).
export type Ton = 'bon' | 'attention' | 'grave' | 'nonmesure' | 'sansobjet';
// Ce qu'une bulle dit : un titre (le jour, l'heure), puis des lignes, chacune avec sa valeur et la clé de sa série.
export type Contenu = { titre: string; lignes: { texte: string; valeur?: string; cle?: string }[] };
const enTexte = (c: Contenu | null) => (c ? [c.titre, ...c.lignes.map((l) => (l.valeur ? `${l.texte} ${l.valeur}` : l.texte))].join(' · ') : '');

// ── Survoler une suite de cases (des jours, des barres, les pas d'une courbe) ─────────────────────────────────────────
// La case visée suit le pointeur ; au doigt, elle reste jusqu'à ce qu'on touche ailleurs ; au clavier, elle part de la
// plus récente (la dernière) et se déplace aux flèches.
function useSurvol(n: number) {
  const [i, setI] = useState<number | null>(null);
  const cadre = useRef<HTMLDivElement>(null);
  const borne = (x: number) => Math.min(n - 1, Math.max(0, x));
  const viser = (e: PointerEvent<HTMLDivElement>) => {
    const r = cadre.current?.getBoundingClientRect();
    if (r && r.width > 0 && n > 0) setI(borne(Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const pas: Record<string, (x: number) => number> = { ArrowLeft: (x) => x - 1, ArrowRight: (x) => x + 1, Home: () => 0, End: () => n - 1 };
  return {
    i: i === null || n === 0 ? null : borne(i),
    props: {
      ref: cadre,
      tabIndex: 0,
      onPointerMove: viser,
      onPointerDown: viser,
      onPointerLeave: (e: PointerEvent<HTMLDivElement>) => { if (e.pointerType === 'mouse') setI(null); },
      onFocus: () => setI((x) => x ?? n - 1),
      onBlur: () => setI(null),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        const f = pas[e.key];
        if (f) { e.preventDefault(); setI((x) => borne(f(x ?? n - 1))); } else if (e.key === 'Escape') setI(null);
      },
    },
  };
}

// La bulle : au-dessus de la case visée (une bande, des barres), ou à côté du viseur (une courbe : elle ne cache pas le
// tracé qu'on lit). Près d'un bord, elle se range de l'autre côté plutôt que de sortir de l'écran.
function Bulle({ x, c, cote = false }: { x: number; c: Contenu; cote?: boolean }) {
  const place = cote ? (x > 0.6 ? 'gauche' : 'droite') : x < 0.2 ? 'debut' : x > 0.8 ? 'fin' : 'milieu';
  return (
    <div className={`c-bulle c-bulle-${place}`} style={{ insetInlineStart: `${x * 100}%` }} aria-hidden="true">
      <b className="c-bulle-titre">{c.titre}</b>
      {c.lignes.map((l, k) => (
        <span key={k} className="c-bulle-ligne">
          {l.cle ? <i className={`c-cle c-cle-${l.cle}`} /> : null}
          <span>{l.texte}</span>
          {l.valeur ? <b className="c-num">{l.valeur}</b> : null}
        </span>
      ))}
    </div>
  );
}

// ── Une échelle « ronde » : 0, 100, 200, 300, 400 plutôt que 0, 97, 195… ────────────────────────────────────────────
export function echelle(max: number, crans = 4): { haut: number; graduations: number[] } {
  const brut = Math.max(max, Number.EPSILON) / crans;
  const p = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= brut - 1e-12) ?? 10 * p;
  const haut = pas * Math.max(1, Math.ceil(max / pas - 1e-9));
  return { haut, graduations: Array.from({ length: Math.round(haut / pas) + 1 }, (_, k) => k * pas) };
}

// ── Le tracé d'une série : un point par pas, au milieu de son pas ; un trou où il n'y a pas de valeur ───────────────────
const enX = (i: number, n: number) => ((i + 0.5) / n) * 1000;
const enY = (v: number, haut: number) => 100 - (Math.min(v, haut) / haut) * 100;
function cheminDe(v: readonly (number | null)[], haut: number): string {
  const n = v.length;
  let d = '', ouvert = false;
  v.forEach((val, i) => {
    if (val === null) { ouvert = false; return; }
    const x = enX(i, n), y = enY(val, haut).toFixed(2);
    // Un point seul, entre deux trous, n'est pas un trait : `seuls` le dessine en point, hors du SVG étiré (un cercle dans
    // un tracé étiré deviendrait une ellipse, et un court trait flottant se lit comme une erreur de dessin).
    if (!ouvert && (v[i + 1] ?? null) === null) return;
    d += `${ouvert ? 'L' : 'M'}${x.toFixed(1)} ${y}`;
    ouvert = true;
  });
  return d;
}
function aireDe(v: readonly (number | null)[], haut: number): string {
  const n = v.length;
  let d = '';
  let seg: [number, number][] = [];
  const fermer = () => {
    const premier = seg[0], dernier = seg[seg.length - 1];
    if (seg.length > 1 && premier && dernier) d += `M${premier[0].toFixed(1)} 100${seg.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(2)}`).join('')}L${dernier[0].toFixed(1)} 100Z`;
    seg = [];
  };
  v.forEach((val, i) => { if (val === null) fermer(); else seg.push([enX(i, n), enY(val, haut)]); });
  fermer();
  return d;
}
// Les pas mesurés entre deux trous : ni trait ni aire possibles, un point les dit.
const seuls = (v: readonly (number | null)[]) =>
  v.flatMap((val, i) => (val !== null && (v[i - 1] ?? null) === null && (v[i + 1] ?? null) === null ? [i] : []));
// Les suites d'indices qui se suivent (des pas « trop peu », une coupure) : une bande chacune.
function suites(indices: readonly boolean[]): { de: number; a: number }[] {
  const res: { de: number; a: number }[] = [];
  indices.forEach((oui, i) => {
    if (!oui) return;
    const der = res.at(-1);
    if (der && der.a === i - 1) der.a = i; else res.push({ de: i, a: i });
  });
  return res;
}

// ── Une bande de cases (des jours, des nuits) ───────────────────────────────────────────────────────────────────────
export type Case = { ton: Ton; contenu: Contenu };
export function Bande({ cases, etiquette, sombre = false, petite = false }: { cases: readonly Case[]; etiquette: string; sombre?: boolean; petite?: boolean }) {
  const s = useSurvol(cases.length);
  const vue = s.i === null ? null : cases[s.i] ?? null;
  return (
    <div className={['c-bande', sombre ? 'c-bande-sombre' : '', petite ? 'c-bande-petite' : ''].filter(Boolean).join(' ')} role="group" aria-label={etiquette} {...s.props}>
      <div className="c-bande-cases" aria-hidden="true">
        {cases.map((c, k) => <span key={k} className={`c-case c-ton-${c.ton}${k === s.i ? ' c-vise' : ''}`} />)}
      </div>
      {vue && s.i !== null ? <Bulle x={(s.i + 0.5) / cases.length} c={vue.contenu} /> : null}
      <p className="c-cache" aria-live="polite">{enTexte(vue?.contenu ?? null)}</p>
    </div>
  );
}

// ── Les instants nommés sous un graphique ───────────────────────────────────────────────────────────────────────────
// En part de la période (de 0 à 1) : la même liste sert sous une courbe et sous des barres qui couvrent la même période.
export type Abscisse = { x: number; texte: string };
// Jamais un texte sur un autre : la place d'un repère dépend de la largeur du CADRE (une carte étroite, un téléphone), pas de
// la période. Le choix de ceux qu'on garde, régulier, vit dans axe.ts. Ceux qui se taisent gardent leur place
// (`visibility`) : la mesure ne bouge pas la mise en page. Remesuré quand le cadre change de largeur et quand les polices
// arrivent : un texte change de largeur avec elles.
const ECART = 8;
function eclaircir(reperes: readonly HTMLElement[]): void {
  reperes.forEach((r) => r.classList.remove('c-axe-tu'));
  const gardes = reperesGardes(reperes.map((r) => r.getBoundingClientRect()),
    reperes.map((r) => r.classList.contains('c-axe-debut') || r.classList.contains('c-axe-fin')), ECART);
  reperes.forEach((r, j) => { if (!gardes.includes(j)) r.classList.add('c-axe-tu'); });
}
export function Abscisses({ abscisses }: { abscisses: readonly Abscisse[] }) {
  const axe = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = axe.current;
    if (!el) return;
    const mesurer = () => eclaircir(Array.from(el.children) as HTMLElement[]);
    mesurer();
    let vivant = true;
    void document.fonts?.ready.then(() => { if (vivant) mesurer(); });
    const suivi = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mesurer);
    suivi?.observe(el);
    return () => { vivant = false; suivi?.disconnect(); };
  }, [abscisses]);
  return (
    <div ref={axe} className="c-courbe-axe" aria-hidden="true">
      {abscisses.map((a) => (
        <span key={`${a.x}-${a.texte}`} className={`c-num${a.x < 0.06 ? ' c-axe-debut' : a.x > 0.94 ? ' c-axe-fin' : ''}`} style={{ insetInlineStart: `${a.x * 100}%` }} data-donnee>{a.texte}</span>
      ))}
    </div>
  );
}

// ── Une courbe (une ou plusieurs séries, un seuil, des repères) ─────────────────────────────────────────────────────
// « avant » : la même durée juste avant la période, en pointillé derrière la série du moment ; « pannes » : leur part,
// en rouge, sous le trafic.
export type Serie = { valeurs: readonly (number | null)[]; cle: 'p95' | 'p50' | 'trafic' | 'avant' | 'pannes' };
export type Repere = { valeur: number; texte: string };
type PropsCourbe = {
  series: readonly Serie[]; haut: number; graduations: readonly Repere[]; seuil?: Repere | null;
  abscisses?: readonly Abscisse[];
  // Des repères verticaux (une mise en ligne), et des plages (une coupure) : des indices de pas.
  marques?: readonly { i: number; texte: string }[]; plages?: readonly { de: number; a: number }[];
  // Les pas qui ont des mesures, mais trop peu pour un tracé : un trait hachuré au pied du graphique le dit.
  peu?: readonly boolean[];
  aire?: boolean; hauteur: number; etiquette: string; bulle: (i: number) => Contenu;
};
export function Courbe({ series, haut, graduations, seuil = null, abscisses = [], marques = [], plages = [], peu = [], aire = false, hauteur, etiquette, bulle }: PropsCourbe) {
  const n = series[0]?.valeurs.length ?? 0;
  const s = useSurvol(n);
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (v: number) => (Math.min(v, haut) / haut) * 100;
  const largeur = (p: { de: number; a: number }) => ({ insetInlineStart: `${(p.de / n) * 100}%`, width: `${((p.a - p.de + 1) / n) * 100}%` });
  const premiere = series[0];
  return (
    <div className="c-courbe">
      <div className="c-courbe-trace" style={{ height: hauteur }} role="group" aria-label={etiquette} {...s.props}>
        {graduations.map((g) => (
          <span key={g.valeur} className="c-courbe-ligne" style={{ bottom: `${y(g.valeur)}%` }} aria-hidden="true"><span className="c-num">{g.texte}</span></span>
        ))}
        {plages.map((p, k) => <span key={k} className="c-courbe-plage" style={largeur(p)} aria-hidden="true" />)}
        {suites(peu).map((p, k) => <span key={k} className="c-courbe-peu" style={largeur(p)} aria-hidden="true" />)}
        <svg className="c-courbe-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {aire && premiere ? <path className={`c-aire c-aire-${premiere.cle}`} d={aireDe(premiere.valeurs, haut)} /> : null}
          {series.map((sr) => <path key={sr.cle} className={`c-tracer c-tracer-${sr.cle}`} d={cheminDe(sr.valeurs, haut)} vectorEffect="non-scaling-stroke" />)}
        </svg>
        {series.flatMap((sr) => seuls(sr.valeurs).map((i) => (
          <span key={`${sr.cle}-${i}`} className={`c-courbe-seul c-courbe-seul-${sr.cle}`} style={{ insetInlineStart: `${x(i)}%`, bottom: `${y(sr.valeurs[i] ?? 0)}%` }} aria-hidden="true" />
        )))}
        {seuil ? <span className="c-seuil" style={{ bottom: `${y(seuil.valeur)}%` }} aria-hidden="true"><span>{seuil.texte}</span></span> : null}
        {marques.map((m, k) => (
          // Près d'un bord, l'étiquette se range vers l'intérieur : elle ne sort jamais du cadre.
          <span key={k} className={`c-courbe-marque${x(m.i) < 10 ? ' c-marque-debut' : x(m.i) > 90 ? ' c-marque-fin' : ''}`} style={{ insetInlineStart: `${x(m.i)}%` }} aria-hidden="true">
            {m.texte ? <span className="c-mono" data-donnee>{m.texte}</span> : null}
          </span>
        ))}
        {s.i !== null ? (
          <>
            <span className="c-courbe-viseur" style={{ insetInlineStart: `${x(s.i)}%` }} aria-hidden="true" />
            {series.map((sr) => {
              const v = sr.valeurs[s.i ?? 0] ?? null;
              return v === null ? null : <span key={sr.cle} className={`c-courbe-point c-courbe-point-${sr.cle}`} style={{ insetInlineStart: `${x(s.i ?? 0)}%`, bottom: `${y(v)}%` }} aria-hidden="true" />;
            })}
            <Bulle x={x(s.i) / 100} c={bulle(s.i)} cote />
          </>
        ) : null}
        <p className="c-cache" aria-live="polite">{s.i === null ? '' : enTexte(bulle(s.i))}</p>
      </div>
      {abscisses.length ? <Abscisses abscisses={abscisses} /> : null}
    </div>
  );
}

// ── Des bâtons (une part par pas) ───────────────────────────────────────────────────────────────────────────────────
// Un bâton au-dessus du seuil se dit en rouge ; un bâton à zéro garde un trait (mesuré, rien) ; un pas sans requête n'a
// pas de bâton du tout (rien à mesurer). Le nom des classes est le leur : « c-colonne » est déjà la colonne d'une page.
export function Barres({ valeurs, haut, seuil, hauteur, etiquette, bulle, abscisses = [] }: {
  valeurs: readonly (number | null)[]; haut: number; seuil: Repere | null; hauteur: number; etiquette: string; bulle: (i: number) => Contenu;
  abscisses?: readonly Abscisse[];
}) {
  const n = valeurs.length;
  const s = useSurvol(n);
  return (
    <div className="c-courbe">
      <div className="c-batons" style={{ height: hauteur }} role="group" aria-label={etiquette} {...s.props}>
        <div className="c-batons-rangee" aria-hidden="true">
          {valeurs.map((v, k) => (
            <span key={k} className={['c-baton', v === null ? 'c-baton-sans' : v === 0 ? 'c-baton-zero' : '', seuil && v !== null && v > seuil.valeur ? 'c-baton-haut' : '', k === s.i ? 'c-vise' : ''].filter(Boolean).join(' ')}>
              <span style={{ height: v === null || v === 0 ? undefined : `${Math.max(4, (Math.min(v, haut) / haut) * 100)}%` }} />
            </span>
          ))}
        </div>
        {seuil ? <span className="c-seuil" style={{ bottom: `${(Math.min(seuil.valeur, haut) / haut) * 100}%` }} aria-hidden="true"><span>{seuil.texte}</span></span> : null}
        {s.i !== null ? <Bulle x={(s.i + 0.5) / n} c={bulle(s.i)} /> : null}
        <p className="c-cache" aria-live="polite">{s.i === null ? '' : enTexte(bulle(s.i))}</p>
      </div>
      {abscisses.length ? <Abscisses abscisses={abscisses} /> : null}
    </div>
  );
}

// ── Un trait (la tendance d'une tuile) : sans bulle, la tuile dit déjà son chiffre ─────────────────────────────────────
export function Trait({ valeurs, haut, seuil = null }: { valeurs: readonly (number | null)[]; haut: number; seuil?: number | null }) {
  return (
    <svg className="c-trait" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {seuil !== null ? <line className="c-trait-seuil" x1="0" x2="1000" y1={enY(seuil, haut)} y2={enY(seuil, haut)} vectorEffect="non-scaling-stroke" /> : null}
      <path className="c-trait-aire" d={aireDe(valeurs, haut)} />
      <path className="c-trait-ligne" d={cheminDe(valeurs, haut)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
