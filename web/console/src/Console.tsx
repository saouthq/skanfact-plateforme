// La console de l'équipe SkanFact (docs/console.md ; skanfact docs/cadrage/10-console.md) : l'entrée, puis la coquille
// (la barre de gauche, la recherche, la page). La barre ne montre que les écrans qui existent, et seulement ceux que le
// rôle ouvre : jamais un lien qui mène à un refus. Les écrans vivent dans l'adresse (#/clients, #/clients/<id>…) :
// « Précédent » revient en arrière, une adresse se recopie.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { dire, phrase, titre, typo } from './langue.ts';
import { appeler, session } from './api.ts';
import { ContexteConsole, panneDe, type Ctx, type Moi, type Role } from './contexte.ts';
import { Abonnements } from './ecrans/Abonnements.tsx';
import { Accueil } from './ecrans/Accueil.tsx';
import { Alertes } from './ecrans/Alertes.tsx';
import { Sauvegardes } from './ecrans/Sauvegardes.tsx';
import { Performances } from './ecrans/Performances.tsx';
import { Cabinet } from './ecrans/Cabinet.tsx';
import { Cabinets } from './ecrans/Cabinets.tsx';
import { Clients } from './ecrans/Clients.tsx';
import { Entree } from './ecrans/Entree.tsx';
import { Equipe } from './ecrans/Equipe.tsx';
import { Fiche } from './ecrans/Fiche.tsx';
import { Journal } from './ecrans/Journal.tsx';
import { Service } from './ecrans/Service.tsx';
import { Alerte, Avatar, Bouton, Icone, Toast, type NomIcone } from './ui.tsx';

// ── Les écrans et leur adresse ──────────────────────────────────────────────────────────────────────────────────────
type Page = 'accueil' | 'clients' | 'fiche' | 'cabinets' | 'cabinet' | 'abonnements' | 'journal' | 'equipe' | 'service';
type Route = { page: Page | 'inconnue'; id?: string; params: URLSearchParams };
const OUVRE: Record<Page, readonly Role[]> = {
  accueil: ['direction', 'support', 'technique'],
  clients: ['direction', 'support'], fiche: ['direction', 'support'], cabinets: ['direction', 'support'], cabinet: ['direction', 'support'],
  abonnements: ['direction', 'support'],
  journal: ['direction'], equipe: ['direction'], service: ['direction', 'technique'],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lireRoute(hash: string): Route {
  const [chemin = '', requete = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(requete);
  const m = chemin.split('/').filter(Boolean);
  if (m.length === 0) return { page: 'accueil', params };
  if (m[0] === 'clients' && m.length === 1) return { page: 'clients', params };
  if (m[0] === 'clients' && m.length === 2 && UUID.test(m[1] ?? '')) return { page: 'fiche', id: m[1] ?? '', params };
  if (m[0] === 'cabinets' && m.length === 1) return { page: 'cabinets', params };
  if (m[0] === 'cabinets' && m.length === 2 && UUID.test(m[1] ?? '')) return { page: 'cabinet', id: m[1] ?? '', params };
  if (m.length === 1 && (m[0] === 'abonnements' || m[0] === 'journal' || m[0] === 'equipe' || m[0] === 'service')) return { page: m[0], params };
  // Les vues du service : « #/service » (la vue d'ensemble), « #/service/alertes », « #/service/sauvegardes »,
  // « #/service/performances ».
  if (m[0] === 'service' && m.length === 2 && (m[1] === 'alertes' || m[1] === 'sauvegardes' || m[1] === 'performances')) return { page: 'service', id: m[1], params };
  return { page: 'inconnue', params };
}
function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const suivre = () => { setHash(location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', suivre);
    return () => window.removeEventListener('hashchange', suivre);
  }, []);
  return useMemo(() => lireRoute(hash), [hash]);
}

// ── Le thème : celui du système, sauf choix fait ici (gardé dans ce navigateur) ─────────────────────────────────────
const CLE_THEME = 'skanfact.console.theme';
export function themeChoisi(): 'clair' | 'sombre' | null {
  try { const v = localStorage.getItem(CLE_THEME); return v === 'clair' || v === 'sombre' ? v : null; } catch { return null; }
}
function useTheme() {
  const media = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [choix, setChoix] = useState(themeChoisi);
  const [systeme, setSysteme] = useState(media.matches);
  useEffect(() => {
    const f = () => setSysteme(media.matches);
    media.addEventListener('change', f);
    return () => media.removeEventListener('change', f);
  }, [media]);
  useEffect(() => { if (choix) document.documentElement.dataset.theme = choix; else delete document.documentElement.dataset.theme; }, [choix]);
  const sombre = choix ? choix === 'sombre' : systeme;
  const basculer = () => {
    const v = sombre ? 'clair' : 'sombre';
    setChoix(v);
    try { localStorage.setItem(CLE_THEME, v); } catch { /* le choix vaut pour cette visite */ }
  };
  return { sombre, basculer };
}

// ── La barre de gauche ──────────────────────────────────────────────────────────────────────────────────────────────
type Entree = { page: Page; href: string; cle: string; icone: NomIcone };
const GROUPES: { cle: string; entrees: Entree[] }[] = [
  { cle: 'chaque_jour', entrees: [{ page: 'accueil', href: '#/', cle: 'decider', icone: 'decider' }, { page: 'clients', href: '#/clients', cle: 'clients', icone: 'clients' }, { page: 'abonnements', href: '#/abonnements', cle: 'abonnements', icone: 'calendrier' }] },
  { cle: 'la_plateforme', entrees: [{ page: 'service', href: '#/service', cle: 'service', icone: 'service' }] },
  { cle: 'l_equipe', entrees: [{ page: 'equipe', href: '#/equipe', cle: 'equipe', icone: 'equipe' }, { page: 'journal', href: '#/journal', cle: 'journal', icone: 'journal' }] },
];

function Cote({ moi, page, decisions, sortir, theme }: { moi: Moi; page: Page | 'inconnue'; decisions: number | null; sortir: () => void; theme: ReturnType<typeof useTheme> }) {
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => { setOuvert(false); }, [page]);
  const groupes = GROUPES.map((g) => ({ ...g, entrees: g.entrees.filter((e) => OUVRE[e.page].includes(moi.role)) })).filter((g) => g.entrees.length);
  // Une fiche, la liste des cabinets et la fiche d'un cabinet vivent sous « Clients » : les deux sortes de clients.
  const actif = page === 'fiche' || page === 'cabinets' || page === 'cabinet' ? 'clients' : page;
  return (
    <aside className={`c-cote${ouvert ? ' c-ouvert' : ''}`}>
      <div className="c-cote-haut">
        <a className="c-marque" href="#/">
          <span className="c-marque-s" aria-hidden="true">S</span>
          <span className="c-marque-nom"><b data-donnee>SkanFact</b><span className="c-marque-pilule">{dire('console.ecran.marque')}</span></span>
        </a>
        <button type="button" className="c-menu-tel" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}><Icone nom={ouvert ? 'croix' : 'menu'} />{titre('console.ecran.menu')}</button>
      </div>
      <nav className="c-nav" aria-label={titre('console.ecran.nav.principal')}>
        {groupes.map((g) => (
          <div key={g.cle} className="c-nav" role="group" aria-labelledby={`nav-${g.cle}`}>
            <span className="c-nav-groupe" id={`nav-${g.cle}`}>{dire(`console.ecran.nav.${g.cle}`)}</span>
            {g.entrees.map((e) => (
              <a key={e.page} href={e.href} aria-current={actif === e.page ? 'page' : undefined}>
                <Icone nom={e.icone} />{titre(`console.ecran.nav.${e.cle}`)}
                {e.page === 'accueil' && decisions ? <span className="c-nav-compte">{decisions}</span> : null}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="c-moi">
        <div className="c-moi-qui">
          <Avatar nom={moi.nom} nuit />
          <div><b data-donnee>{moi.nom}</b><span>{titre(`console.ecran.role.${moi.role}`)}</span></div>
        </div>
        <div className="c-moi-actions">
          <button type="button" onClick={theme.basculer} aria-label={titre(theme.sombre ? 'console.ecran.theme_clair' : 'console.ecran.theme_sombre')}
            title={titre(theme.sombre ? 'console.ecran.theme_clair' : 'console.ecran.theme_sombre')}><Icone nom={theme.sombre ? 'soleil' : 'lune'} /></button>
          <button type="button" className="c-moi-sortir" onClick={sortir}><Icone nom="sortir" />{titre('console.ecran.deconnexion')}</button>
        </div>
      </div>
    </aside>
  );
}

function Recherche({ role }: { role: Role }) {
  const [q, setQ] = useState('');
  if (!OUVRE.clients.includes(role)) return <span />;
  const chercher = (e: FormEvent) => { e.preventDefault(); location.hash = `#/clients${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`; };
  return (
    <form className="c-recherche" role="search" onSubmit={chercher}>
      <label><span className="c-cache">{titre('console.ecran.chercher_label')}</span>
        <Icone nom="chercher" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={titre('console.ecran.chercher')} />
      </label>
    </form>
  );
}

function Page({ route, role }: { route: Route; role: Role }) {
  if (route.page === 'inconnue') return <Alerte ton="info"><span>{phrase('console.ecran.introuvable')}</span><span><a href="#/">{titre('console.ecran.retour_accueil')}</a></span></Alerte>;
  if (!OUVRE[route.page].includes(role)) {
    return (
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.interdit_titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.interdit', { role: dire(`console.ecran.role.${role}`) })}</p>
          <p><a href="#/">{titre('console.ecran.retour_accueil')}</a></p>
        </div>
      </header>
    );
  }
  switch (route.page) {
    case 'accueil': return <Accueil />;
    case 'clients': return <Clients etat={route.params.get('etat')} q={route.params.get('q') ?? ''} nouvelles={route.params.get('nouvelles') === '1'} />;
    case 'fiche': return <Fiche key={route.id} id={route.id ?? ''} />;
    case 'cabinets': return <Cabinets q={route.params.get('q') ?? ''} />;
    case 'cabinet': return <Cabinet key={route.id} id={route.id ?? ''} />;
    case 'abonnements': return <Abonnements vue={route.params.get('vue')} />;
    case 'journal': return <Journal entreprise={UUID.test(route.params.get('entreprise') ?? '') ? route.params.get('entreprise') : null} />;
    case 'equipe': return <Equipe />;
    default: return route.id === 'alertes' ? <Alertes /> : route.id === 'sauvegardes' ? <Sauvegardes /> : route.id === 'performances' ? <Performances periode={route.params.get('periode')} /> : <Service periode={route.params.get('periode')} />;
  }
}

// ── La console ──────────────────────────────────────────────────────────────────────────────────────────────────────
type Etat = { etat: 'lecture' } | { etat: 'entree'; message: string | null } | { etat: 'dedans'; moi: Moi } | { etat: 'panne'; texte: string };

export function Console() {
  const [etat, setEtat] = useState<Etat>(session.jeton() ? { etat: 'lecture' } : { etat: 'entree', message: null });
  const [decisions, setDecisions] = useState<number | null>(null);
  const route = useRoute();
  const theme = useTheme();
  useEffect(() => { document.title = titre('console.ecran.onglet'); }, []);

  // Qui est connecté : relu à chaque entrée (et au chargement, si l'onglet garde une session).
  useEffect(() => {
    if (etat.etat !== 'lecture') return;
    void (async () => {
      try {
        const r = await appeler<Moi>('GET', '/console/moi');
        if (r.statut === 200) setEtat({ etat: 'dedans', moi: r.corps });
        else { session.fermer(); setEtat({ etat: 'entree', message: r.statut === 401 || !r.corps.motif ? null : typo(r.corps.motif) }); }
      } catch (x) { setEtat({ etat: 'panne', texte: panneDe(x) }); }
    })();
  }, [etat]);

  const sortir = useCallback((message?: string) => { session.fermer(); setDecisions(null); setEtat({ etat: 'entree', message: message ?? null }); }, []);
  const deconnecter = useCallback(() => {
    void appeler('POST', '/console/deconnexion').catch(() => undefined).finally(() => { sortir(); location.hash = '#/'; });
  }, [sortir]);
  // La pastille de « À décider » : la même liste que l'accueil (GET /console/accueil), relue à chaque page et après chaque
  // geste. Lue par l'accueil seulement, elle disparaissait dès qu'on rechargeait une autre page, et un geste qui règle une
  // décision la laissait à son ancien compte.
  const [tourDecisions, setTourDecisions] = useState(0);
  const relireDecisions = useCallback(() => setTourDecisions((n) => n + 1), []);
  const dedans = etat.etat === 'dedans';
  useEffect(() => {
    if (!dedans || route.page === 'accueil') return undefined;
    let vivant = true;
    void (async () => {
      try {
        const r = await appeler<{ decider: unknown[] }>('GET', '/console/accueil');
        if (vivant && r.statut === 200) setDecisions(r.corps.decider.length);
      } catch { /* le compte attendra la page suivante : rien d'autre n'en dépend */ }
    })();
    return () => { vivant = false; };
  }, [dedans, route.page, tourDecisions]);
  const ctx = useMemo<Ctx | null>(() => (etat.etat === 'dedans' ? { moi: etat.moi, sortir, compterDecisions: setDecisions, relireDecisions } : null), [etat, sortir, relireDecisions]);

  if (etat.etat === 'lecture') return <div className="c-centre"><p className="c-attente">{titre('console.ecran.lecture')}</p></div>;
  if (etat.etat === 'panne') {
    return (
      <div className="c-centre">
        <Alerte ton="danger"><span>{etat.texte}</span><span><Bouton petit onClick={() => setEtat({ etat: 'lecture' })}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte>
      </div>
    );
  }
  if (etat.etat === 'entree' || !ctx) {
    return <><Entree message={etat.etat === 'entree' ? etat.message : null} entre={() => setEtat({ etat: 'lecture' })} /><Toast /></>;
  }
  return (
    <ContexteConsole.Provider value={ctx}>
      <div className="c-app">
        <Cote moi={ctx.moi} page={route.page} decisions={decisions} sortir={deconnecter} theme={theme} />
        <div className="c-principal">
          <div className="c-haut">
            <Recherche role={ctx.moi.role} />
            <span className="c-trace"><Icone nom="cadenas" taille={16} />{phrase('console.ecran.trace')}</span>
          </div>
          <main className="c-page"><Page route={route} role={ctx.moi.role} /></main>
        </div>
      </div>
      <Toast />
    </ContexteConsole.Provider>
  );
}
