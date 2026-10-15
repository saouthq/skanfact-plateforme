// Le support (docs/support.md ; serveur/console/support.ts ; 0095 ; sa maquette) : les demandes à gauche, la plus
// urgente en haut (sans réponse depuis 24 h, puis à répondre, puis celles qui attendent le client) ; la conversation au
// milieu, avec la réponse ; la carte du client et de la personne à droite. On répond d'ici : la personne lit la réponse
// dans son application, un e-mail SANS le texte l'en prévient. Les réponses types sont les articles de l'Aide qu'elle
// a sous les yeux, jamais un second texte. Le support ne voit pas son dossier : seulement ce qu'elle a écrit ici.
// Chaque demande a quelqu'un qui la suit (on la prend, on la confie), une priorité (urgente : deux heures au lieu de
// vingt-quatre) et peut attendre la technique (0115 ; l'audit F13) ; répondre à une demande qu'un autre suit se fait
// en le sachant, l'avertissement au-dessus du champ.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { abonnementEnMots, expliquer, type Etat, type Faits } from '../abonnement.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture, useRelireQuandOnRegarde } from '../contexte.ts';
import { quand } from '../temps.ts';
import { AccesDossier } from './AccesDossier.tsx';
import { Alerte, Avatar, Bouton, Champ, Choix, Dialogue, Icone, Lien, maj, MenuLigne, Puce, toast, Vide, Zone, type NomIcone, type TonPuce } from '../ui.tsx';

export type Canal = 'application' | 'email' | 'whatsapp' | 'telephone';
export type EtatDemande =
  | { etat: 'nouvelle' | 'a_repondre'; attendDepuis: string; heures: number; sansReponse: boolean }
  | { etat: 'attend_client'; depuis: string }
  | { etat: 'attend_technique'; depuis: string }
  | { etat: 'close'; le: string; cote: 'client' | 'equipe' };
export type LigneDemande = {
  id: string; numero: number; sujet: string; canal: Canal; ouverteLe: string;
  entreprise: { id: string; nom: string; essai: boolean }; demandeur: { id: string; nom: string };
  noteePar: string | null; suiviePar: string | null; suivieParId: string | null; priorite: 'normale' | 'urgente';
  technique: { le: string; motif: string } | null; dernierClientLe: string | null; dernierEquipeLe: string | null;
  dernierCote: 'client' | 'equipe' | null; messages: number;
  close: { le: string; cote: 'client' | 'equipe'; par: string | null; motif: string | null } | null;
  etat: EtatDemande;
};
type Message = { id: string; cote: 'client' | 'equipe'; texte: string; article: string | null; le: string; nom: string; notePar: string | null };
type Demande = {
  ligne: Omit<LigneDemande, 'etat'>; version: string | null; page: string | null;
  personne: { nom: string; email: string; roles: string[] }; messages: Message[]; etat: EtatDemande; suggestions: string[];
};
type Article = { id: string; titre: string; sous: string };
// Ce qu'on écrit à une demande, gardé le temps de la page : l'écran se relit (le client a réécrit, ou clos sa demande)
// sans rien jeter de ce qu'on avait commencé — une demande close la garde jusqu'à « Rouvrir ».
type Brouillons = Map<string, { texte: string; article: string }>;
type Client = { id: string; nom: string; etat: Etat; faits: Faits; membres: number; pieces: number; derniereActivite: string | null };
type Donnees = {
  aujourdhui: string; comptes: { ouvertes: number; aRepondre: number; sansReponse: number };
  ouvertes: LigneDemande[]; closes: LigneDemande[]; demande: Demande | null; client: Client | null; articles: Article[];
  // Les closes, par pages (0114) : la page lue commence à `debut`, sur `total`.
  pagesCloses?: { debut: number; total: number; parPage: number };
  // À qui une demande se confie (0115) : la direction et le support.
  equipe?: MembreSupport[];
};
type MembreSupport = { id: string; nom: string; role: 'direction' | 'support' };

// Le numéro qu'on se dit au téléphone : « S-0214 ».
export const refDemande = (n: number) => `S-${String(n).padStart(4, '0')}`;
// L'état d'une demande en une puce : « sans réponse » en orange (la promesse est déjà en retard), « nouvelle » et « à
// répondre » en sarcelle (c'est à nous), « attend le client » et « close » en gris.
export function etatEnMots(e: EtatDemande): { ton: TonPuce; texte: string } {
  if (e.etat === 'close') return { ton: 'hors', texte: dire('console.ecran.support.etat.close') };
  if (e.etat === 'attend_client') return { ton: 'hors', texte: dire('console.ecran.support.etat.attend_client') };
  if (e.etat === 'attend_technique') return { ton: 'a_regarder', texte: dire('console.ecran.support.etat.attend_technique') };
  if (e.sansReponse) return { ton: 'aujourdhui', texte: dire('console.ecran.support.etat.sans_reponse') };
  return { ton: 'semaine', texte: dire(`console.ecran.support.etat.${e.etat}`) };
}
// Depuis quand, pour une ligne de la liste : les heures d'attente d'une demande à nous, sinon le dernier mouvement.
export function depuisEnMots(e: EtatDemande, aujourdhui: string): string {
  if (e.etat === 'close') return quand(e.le, aujourdhui);
  if (e.etat === 'attend_client' || e.etat === 'attend_technique') return quand(e.depuis, aujourdhui);
  return e.heures === 0 ? dire('console.ecran.support.depuis_peu') : dire('console.ecran.support.depuis_h', { n: e.heures });
}
const ICONE_CANAL: Record<Canal, NomIcone> = { application: 'decider', email: 'courriel', whatsapp: 'echange', telephone: 'telephone' };
// Les pages de l'application où une demande s'écrit, dites en mots ; une autre se dit telle quelle.
const PAGES = new Set(['dashboard', 'devis', 'factures', 'doc', 'relances', 'autres', 'contrats', 'contrat', 'clients', 'client', 'catalogue', 'achats', 'achat',
  'fournisseurs', 'fournisseur', 'tresorerie', 'marges', 'affaire', 'paie', 'salarie', 'stock', 'article', 'caisse', 'garanties', 'immos', 'immo', 'stats',
  'compta', 'parametres', 'modules', 'licences', 'aide', 'support', 'comptable', 'commandesf', 'commandef', 'reception', 'listesprix', 'listeprix',
  'groupe', 'accords']);
const prenomDe = (nom: string) => nom.trim().split(/\s+/)[0] ?? nom;

// ── Une ligne de la liste ───────────────────────────────────────────────────────────────────────────────────────────
function Ticket({ l, choisie, choisir, aujourdhui }: { l: LigneDemande; choisie: boolean; choisir: () => void; aujourdhui: string }) {
  const e = etatEnMots(l.etat);
  return (
    <button type="button" className="c-sp-ticket" aria-pressed={choisie} onClick={choisir}>
      <span className="c-sp-ticket-haut"><b data-donnee>{l.entreprise.nom}</b>
        <span className="c-sp-ticket-puces">{l.priorite === 'urgente' && !l.close ? <Puce ton="urgent">{dire('console.ecran.support.urgente')}</Puce> : null}<Puce ton={e.ton}>{e.texte}</Puce></span>
      </span>
      <span className="c-sp-ticket-sujet" data-donnee>{l.sujet}</span>
      <span className="c-sp-ticket-meta">
        <Icone nom={ICONE_CANAL[l.canal]} taille={14} />
        <span>{maj(dire(`console.ecran.support.canal_court.${l.canal}`))}{l.noteePar ? <>{', '}{dire('console.ecran.support.notee_par', { nom: prenomDe(l.noteePar) })}</> : null} · {depuisEnMots(l.etat, aujourdhui)}
          {l.suiviePar && !l.close ? <>{' · '}{dire('console.ecran.support.suivie_par_court', { nom: prenomDe(l.suiviePar) })}</> : null}</span>
      </span>
    </button>
  );
}

// ── Les fenêtres : clore, rouvrir ───────────────────────────────────────────────────────────────────────────────────
function FenetreMotif({ sorte, demande, fermer, fait }: { sorte: 'clore' | 'rouvrir'; demande: Demande; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const k = `console.ecran.support.g.${sorte}`;
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', `/console/support/demandes/${demande.ligne.id}/${sorte}`, { motif: motif.trim() });
        if (!r) return;
        if (r.statut !== 200) { setRefus(refusDe(r)); return; }
        toast(phrase(`${k}.fait`));
        fait();
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${k}.titre`)} sous={`${refDemande(demande.ligne.numero)} · ${demande.ligne.sujet}`} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${k}.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{(sorte === 'clore' ? ['p1', 'p2'] : ['p1']).map((p) => <li key={p}>{phrase(`${k}.${p}`)}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${k}.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Le suivi : la prendre, la confier, sa priorité, l'attente de la technique (0115) ──────────────────────────────────
type SorteSuivi = 'prendre' | 'confier' | 'priorite' | 'technique';
function FenetreSuivi({ sorte, demande, equipe, fermer, fait }: { sorte: SorteSuivi; demande: Demande; equipe: MembreSupport[]; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const l = demande.ligne;
  const autres = equipe.filter((m) => m.id !== l.suivieParId);
  const [a, setA] = useState(autres.find((m) => m.id !== moi.utilisateur)?.id ?? autres[0]?.id ?? '');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  // Ce que le geste devient : la priorité et l'attente basculent ; prendre, c'est confier à soi.
  const vers = sorte === 'priorite' ? (l.priorite === 'urgente' ? 'normale' : 'urgente') : sorte === 'technique' ? (l.technique ? 'levee' : 'attend')
    : sorte === 'prendre' && !l.suiviePar ? 'suivre' : sorte;
  const k = `console.ecran.support.s.${vers}`;
  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((n) => n + 1); return; }
    const corps = sorte === 'prendre' ? { motif: motif.trim() } : sorte === 'confier' ? { membre: a, motif: motif.trim() }
      : sorte === 'priorite' ? { priorite: vers, motif: motif.trim() } : { attend: !l.technique, motif: motif.trim() };
    const chemin = sorte === 'prendre' || sorte === 'confier' ? 'suivre' : sorte;
    void (async () => {
      setOccupe(true);
      try {
        const res = await api('POST', `/console/support/demandes/${l.id}/${chemin}`, corps);
        if (!res) return;
        if (res.statut !== 200) { setRefus(refusDe(res)); return; }
        toast(phrase(`${k}.fait`, { nom: equipe.find((m) => m.id === a)?.nom ?? '' }));
        fait();
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${k}.fenetre`)} sous={`${refDemande(l.numero)} · ${l.sujet}`} sousDonnee fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${k}.bouton`)}</Bouton>
      </>}>
      {sorte === 'confier' ? (
        <Choix libelle={titre('console.ecran.support.s.confier.a')} valeur={a} changer={setA}
          options={autres.map((m) => ({ valeur: m.id, texte: `${m.nom} (${dire(`console.ecran.role.${m.role}`)})`, donnee: true }))} />
      ) : null}
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2'].map((x) => <li key={x}>{phrase(`${k}.${x}`, { nom: l.suiviePar ?? '' })}</li>)}</ul>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${k}.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} premier={sorte !== 'confier'} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// Qui la suit, sa priorité, l'attente de la technique : une ligne sous l'en-tête. Un geste direct (la prendre, quand on ne
// la suit pas), les autres dans le menu.
function Suivi({ d, equipe, choisir }: { d: Demande; equipe: MembreSupport[]; choisir: (s: SorteSuivi) => void }) {
  const { moi } = useConsole();
  const l = d.ligne;
  const mienne = l.suivieParId === moi.utilisateur;
  const K = 'console.ecran.support.s';
  const actions = [
    ...(equipe.some((m) => m.id !== l.suivieParId) ? [{ icone: 'personne' as const, titre: titre(`${K}.confier.titre`), sous: phrase(`${K}.confier.sous`), faire: () => choisir('confier') }] : []),
    { icone: 'alerte' as const, titre: titre(l.priorite === 'urgente' ? `${K}.normale.titre` : `${K}.urgente.titre`), sous: phrase(l.priorite === 'urgente' ? `${K}.normale.sous` : `${K}.urgente.sous`), faire: () => choisir('priorite') },
    { icone: 'serveur' as const, titre: titre(l.technique ? `${K}.levee.titre` : `${K}.attend.titre`), sous: phrase(l.technique ? `${K}.levee.sous` : `${K}.attend.sous`), faire: () => choisir('technique') },
  ];
  return (
    <div className="c-sp-suivi">
      <span className="c-sp-suivi-qui">
        {l.suiviePar ? <Avatar nom={l.suiviePar} /> : null}
        <span>{mienne ? phrase(`${K}.tu_suis`) : l.suiviePar ? dire(`${K}.suivie_par`, { nom: l.suiviePar }) : phrase(`${K}.personne`)}</span>
        {l.priorite === 'urgente' ? <Puce ton="urgent">{dire('console.ecran.support.urgente')}</Puce> : null}
      </span>
      {l.technique ? <span className="c-sous c-sp-suivi-technique" data-donnee>{maj(dire(`${K}.attend_depuis`, { motif: l.technique.motif }))}</span> : null}
      <span className="c-sp-suivi-gestes">
        {!mienne ? <Bouton petit onClick={() => choisir('prendre')}>{titre(l.suiviePar ? `${K}.prendre.court` : `${K}.suivre.court`)}</Bouton> : null}
        <MenuLigne etiquette={titre(`${K}.menu`)} actions={actions} />
      </span>
    </div>
  );
}

// ── Noter une demande reçue ailleurs (depuis la fiche du client) ────────────────────────────────────────────────────
// Un e-mail, un message WhatsApp, un appel : la demande se range au nom d'une personne de ce client, qui la lira dans son
// application avec la réponse. Notée, elle s'ouvre dans l'écran Support pour y répondre tout de suite.
type Personne = { id: string; nom: string; roles: string[] };
export function NoterDemande({ client, fermer }: { client: { id: string; nom: string }; fermer: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [personnes] = useLecture<{ personnes: Personne[] }>(`/console/support/personnes/${client.id}`);
  const [qui, setQui] = useState('');
  const [canal, setCanal] = useState<Canal>('email');
  const [sujet, setSujet] = useState('');
  const [texte, setTexte] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const liste = personnes.etat === 'lu' ? personnes.donnees.personnes : [];
  const choisi = qui || liste[0]?.id || '';
  const refuser = (champ: string, texteRefus: string) => { setRefus(texteRefus); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const envoyer = () => {
    if (!choisi) { refuser('qui', phrase('console.ecran.support.g.noter.sans_personne')); return; }
    if (sujet.trim().length < 3) { refuser('sujet', phrase('console.ecran.support.g.noter.sujet_court')); return; }
    if (/[<>]/.test(sujet)) { refuser('sujet', phrase('console.ecran.support.g.noter.sans_balise')); return; }
    if (texte.trim().length < 3) { refuser('texte', phrase('console.ecran.support.g.noter.texte_court')); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api<{ id: string }>('POST', '/console/support/demandes', { entreprise: client.id, demandeur: choisi, canal, sujet: sujet.trim(), texte: texte.trim() });
        if (!r) return;
        if (r.statut !== 201) { refuser(typeof r.corps.champ === 'string' ? r.corps.champ : '', refusDe(r)); return; }
        toast(phrase('console.ecran.support.g.noter.fait'));
        fermer();
        location.hash = `#/support?demande=${r.corps.id}`;
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const k = 'console.ecran.support.g.noter';
  return (
    <Dialogue titre={titre(`${k}.titre`)} pour={client.nom} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} desactive={personnes.etat === 'lu' && !liste.length} onClick={envoyer}>{titre(`${k}.bouton`)}</Bouton>
      </>}>
      <p className="c-sp-intro">{phrase(`${k}.sous`)}</p>
      {personnes.etat === 'panne' ? <Alerte ton="danger">{personnes.texte}</Alerte> : null}
      {personnes.etat === 'lu' && !liste.length ? <Alerte ton="info">{phrase(`${k}.sans_personne`)}</Alerte> : null}
      {liste.length ? (
        <Choix libelle={titre(`${k}.qui`)} aide={phrase(`${k}.qui_aide`)} valeur={choisi} changer={setQui}
          options={liste.map((p) => ({ valeur: p.id, texte: p.roles.length ? `${p.nom} (${p.roles.map((r) => dire(`role.${r}`)).join(', ')})` : p.nom, donnee: true }))} />
      ) : null}
      <Choix libelle={titre(`${k}.canal`)} valeur={canal} changer={(v) => setCanal(v === 'whatsapp' || v === 'telephone' ? v : 'email')}
        options={(['email', 'whatsapp', 'telephone'] as const).map((c) => ({ valeur: c, texte: maj(dire(`console.ecran.support.canal.${c}`)) }))} />
      <Champ libelle={titre(`${k}.sujet`)} aide={phrase(`${k}.sujet_aide`)} valeur={sujet} changer={setSujet} premier {...fauteDe('sujet')} />
      <Zone libelle={titre(`${k}.texte`)} aide={phrase(`${k}.texte_aide`)} valeur={texte} changer={setTexte} max={4000} {...fauteDe('texte')} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── La réponse ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Écrire d'abord : les réponses types en une rangée au-dessus (un clic joint l'article et, sur une réponse vide, en pose le
// début), le champ, ce que la personne en verra, puis en pied l'article joint (tout autre article de l'Aide se choisit là)
// et « Envoyer ». Ctrl + Entrée envoie, comme dans l'application du client.
function Repondre({ d, articles, brouillons, envoye, relire }: { d: Demande; articles: Article[]; brouillons: Brouillons; envoye: () => void; relire: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  // Un autre la suit (0115) : on le lit AVANT d'écrire, jamais après avoir envoyé.
  const unAutre = d.ligne.suiviePar && d.ligne.suivieParId !== moi.utilisateur ? d.ligne.suiviePar : null;
  const [texte, setTexte] = useState(() => brouillons.get(d.ligne.id)?.texte ?? '');
  const [article, setArticle] = useState(() => brouillons.get(d.ligne.id)?.article ?? '');
  useEffect(() => {
    if (texte.trim() || article) brouillons.set(d.ligne.id, { texte, article });
    else brouillons.delete(d.ligne.id);
  }, [brouillons, d.ligne.id, texte, article]);
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const prenom = prenomDe(d.personne.nom);
  // Trois réponses types au plus : au-delà, elles repoussaient le champ sous le bord de l'écran (l'article de la page d'abord).
  const proposes = d.suggestions.map((id) => articles.find((a) => a.id === id)).filter((a): a is Article => !!a).slice(0, 3);
  // Choisir une réponse type joint l'article ; sur une réponse encore vide, elle pose aussi le début de la réponse.
  // Le début posé, le curseur attend sur la ligne vide sous « Bonjour Lina, » : il ne reste qu'à écrire.
  const choisir = (a: Article) => {
    const pris = article === a.id;
    setArticle(pris ? '' : a.id);
    if (pris || texte.trim()) return;
    const debut = dire('console.ecran.support.modele', { prenom, titre: a.titre });
    setTexte(debut);
    requestAnimationFrame(() => {
      const zone = document.querySelector<HTMLTextAreaElement>('.c-sp-repondre textarea');
      const ici = debut.indexOf('\n\n');
      if (!zone || ici < 0) return;
      zone.focus();
      zone.setSelectionRange(ici + 2, ici + 2);
    });
  };
  const envoyer = async (e?: FormEvent) => {
    e?.preventDefault();
    if (occupe) return;
    if (texte.trim().length < 3) { setRefus(phrase('console.ecran.support.reponse_vide')); setFaute((n) => n + 1); return; }
    setOccupe(true);
    try {
      const r = await api('POST', `/console/support/demandes/${d.ligne.id}/repondre`, { texte: texte.trim(), article: article || null });
      if (!r) return;
      // Un refus qui ne porte pas sur le texte vient de ce qui a bougé ailleurs (la demande close entre-temps) : l'écran se
      // relit pour le montrer, la réponse reste gardée.
      if (r.statut !== 201) { setRefus(refusDe(r)); if (r.corps.champ === 'texte') setFaute((n) => n + 1); else relire(); return; }
      setTexte(''); setArticle(''); setRefus(null);
      toast(phrase('console.ecran.support.envoyee', { prenom }));
      envoye();
    } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
  };
  const touche = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void envoyer(); } };
  return (
    <form className="c-sp-repondre" onSubmit={(e) => void envoyer(e)} aria-label={titre('console.ecran.support.ta_reponse')}>
      {unAutre ? <p className="c-sp-un-autre"><Icone nom="info" taille={16} />{phrase('console.ecran.support.s.un_autre', { nom: prenomDe(unAutre) })}</p> : null}
      {proposes.length ? (
        <div className="c-sp-types" role="group" aria-label={titre('console.ecran.support.types')}>
          <span className="c-sp-types-titre">{titre('console.ecran.support.types_court')}</span>
          {proposes.map((a) => (
            <button key={a.id} type="button" className="c-sp-type" aria-pressed={article === a.id} onClick={() => choisir(a)} title={`${a.titre} — ${a.sous}`}>
              <span data-donnee>{a.titre}</span>
            </button>
          ))}
        </div>
      ) : null}
      <Zone libelle={titre('console.ecran.support.ta_reponse')} libelleCache placeholder={titre('console.ecran.support.repondre_a', { prenom })}
        aide={phrase('console.ecran.support.ta_reponse_aide', { prenom })} valeur={texte} changer={setTexte} max={4000} faute={faute > 0} n={faute} touche={touche} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
      <div className="c-sp-repondre-pied">
        <label className="c-sp-joint">
          <Icone nom="trombone" taille={16} />
          <span className="c-cache">{titre('console.ecran.support.article')}</span>
          <select value={article} onChange={(e) => setArticle(e.target.value)} title={phrase('console.ecran.support.types_aide')}>
            <option value="">{titre('console.ecran.support.sans_article')}</option>
            {articles.map((a) => <option key={a.id} value={a.id} data-donnee>{titre('console.ecran.support.joint', { titre: a.titre })}</option>)}
          </select>
        </label>
        <span className="c-sp-touches" aria-hidden="true"><kbd>{dire('console.ecran.support.touche_ctrl')}</kbd> + <kbd>{dire('console.ecran.support.touche_entree')}</kbd></span>
        <Bouton ton="principal" type="submit" occupe={occupe}>{titre('console.ecran.support.envoyer')}</Bouton>
      </div>
    </form>
  );
}

// ── La demande ouverte à l'écran ────────────────────────────────────────────────────────────────────────────────────
// En tête : ce qu'elle demande (ses mots), qui et d'où, puis où elle en est ; le seul geste de l'en-tête, clore ou
// rouvrir, à droite. La conversation défile dans sa carte, la dernière réponse en bas, sous les yeux, avec le champ.
function Fil({ d, articles, brouillons, aujourdhui, relire, equipe }: { d: Demande; articles: Article[]; brouillons: Brouillons; aujourdhui: string; relire: () => void; equipe: MembreSupport[] }) {
  const { relireDecisions } = useConsole();
  const [fenetre, setFenetre] = useState<'clore' | 'rouvrir' | null>(null);
  const [suivi, setSuivi] = useState<SorteSuivi | null>(null);
  const l = d.ligne;
  const e = d.etat;
  const badge = e.etat === 'close' ? dire(e.cote === 'client' ? 'console.ecran.support.badge.close_client' : 'console.ecran.support.badge.close_equipe', { quand: quand(e.le, aujourdhui) })
    : e.etat === 'attend_client' ? dire('console.ecran.support.badge.attend_client', { quand: quand(e.depuis, aujourdhui) })
      : e.etat === 'attend_technique' ? dire('console.ecran.support.badge.attend_technique', { quand: quand(e.depuis, aujourdhui) })
      : e.sansReponse ? dire('console.ecran.support.badge.sans_reponse', { n: e.heures }) : dire('console.ecran.support.badge.attend', { depuis: depuisEnMots(e, aujourdhui) });
  const ton = etatEnMots(e).ton;
  const titreArticle = (id: string) => articles.find((a) => a.id === id)?.titre ?? id;
  const apres = () => { setFenetre(null); relire(); relireDecisions(); };
  const relireTout = () => { relire(); relireDecisions(); };
  // Le dernier mot à l'écran : à l'ouverture, et quand un message arrive — sauf si on lisait plus haut dans la conversation.
  const liste = useRef<HTMLOListElement>(null);
  const enBas = useRef(true);
  const nombre = d.messages.length;
  useLayoutEffect(() => {
    const el = liste.current;
    if (el && enBas.current) el.scrollTop = el.scrollHeight;
  }, [nombre]);
  // La fenêtre change de taille (la conversation passe de la page entière à sa colonne) : on garde le bas en vue.
  useEffect(() => {
    const garder = () => { const el = liste.current; if (el && enBas.current) el.scrollTop = el.scrollHeight; };
    window.addEventListener('resize', garder);
    return () => window.removeEventListener('resize', garder);
  }, []);
  const defiler = () => { const el = liste.current; if (el) enBas.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };
  const garde = brouillons.get(l.id)?.texte.trim();
  return (
    <section className="c-sp-fil" id="sp-fil" aria-labelledby="sp-fil-titre">
      <div className="c-sp-fil-tete">
        <div className="c-sp-fil-quoi">
          <h2 id="sp-fil-titre"><span data-donnee>{'« '}{l.sujet}{' »'}</span></h2>
          <span className="c-sp-fil-sous">
            <span className="c-mono" data-donnee>{refDemande(l.numero)}</span>{' · '}
            <a href={`#/clients/${l.entreprise.id}`} data-donnee>{l.entreprise.nom}</a>{' · '}
            <span data-donnee>{d.personne.nom}</span>{d.personne.roles.length ? <>{', '}{d.personne.roles.map((r) => dire(`role.${r}`)).join(', ')}</> : null}{' · '}
            {dire(`console.ecran.support.canal.${l.canal}`)}{l.noteePar ? <>{', '}{dire('console.ecran.support.notee_par', { nom: prenomDe(l.noteePar) })}</> : null}
          </span>
          <span className={`c-puce c-puce-${ton} c-sp-fil-etat`}>{maj(badge)}</span>
        </div>
        {e.etat === 'close' ? <Bouton petit onClick={() => setFenetre('rouvrir')}>{titre('console.ecran.support.rouvrir')}</Bouton>
          : <Bouton petit onClick={() => setFenetre('clore')}>{titre('console.ecran.support.clore')}</Bouton>}
      </div>
      {e.etat === 'close' ? null : <Suivi d={d} equipe={equipe} choisir={setSuivi} />}
      {/* Son dossier (Support S2) : sous l'en-tête, à portée de la conversation qui le motive — demander l'accès, le temps
          qui reste, l'ouvrir en lecture. */}
      <AccesDossier forme="bande" client={{ id: l.entreprise.id, nom: l.entreprise.nom }} demande={{ id: l.id, numero: l.numero }} aujourdhui={aujourdhui} />
      <ol className="c-sp-messages" aria-label={titre('console.ecran.support.conversation')} ref={liste} onScroll={defiler} tabIndex={0}>
        {d.messages.map((m) => (
          <li key={m.id} className={`c-sp-msg c-sp-msg-${m.cote}`}>
            <span className="c-sp-msg-qui">
              <b data-donnee>{m.cote === 'equipe' ? prenomDe(m.nom) : m.nom}</b>{' · '}{quand(m.le, aujourdhui)}
              {m.notePar ? <>{' · '}{dire('console.ecran.support.note_par', { nom: prenomDe(m.notePar) })}</> : null}
            </span>
            <div className="c-sp-bulle" data-donnee>{m.texte}</div>
            {m.article ? <span className="c-sp-article"><Icone nom="trombone" taille={14} />{dire('console.ecran.support.article_joint', { titre: titreArticle(m.article) })}</span> : null}
          </li>
        ))}
      </ol>
      {e.etat === 'close' ? (
        <div className="c-sp-close">
          {/* Une réponse commencée avant que la demande soit close (par la personne, entre deux lectures) : gardée, et le
              bouton qui la rend à l'écran est là où on lit qu'elle est gardée. */}
          <Alerte ton="info">
            <span>
              {e.cote === 'client' ? phrase('console.ecran.support.close_par_client', { quand: quand(e.le, aujourdhui) })
                : phrase('console.ecran.support.close_par_equipe', { quand: quand(e.le, aujourdhui), nom: l.close?.par ?? '—', motif: l.close?.motif ?? '' })}
              {garde ? <>{' '}{phrase('console.ecran.support.brouillon_garde')}</> : null}
            </span>
            {garde ? <span><Bouton petit onClick={() => setFenetre('rouvrir')}>{titre('console.ecran.support.rouvrir')}</Bouton></span> : null}
          </Alerte>
        </div>
      ) : <Repondre key={l.id} d={d} articles={articles} brouillons={brouillons} envoye={relireTout} relire={relireTout} />}
      {fenetre ? <FenetreMotif sorte={fenetre} demande={d} fermer={() => setFenetre(null)} fait={apres} /> : null}
      {suivi ? <FenetreSuivi sorte={suivi} demande={d} equipe={equipe} fermer={() => setSuivi(null)} fait={() => { setSuivi(null); relire(); relireDecisions(); }} /> : null}
    </section>
  );
}

// ── Le client et la personne : une seule carte, à côté de la conversation ──────────────────────────────────────────
// Le client d'abord (qui il est pour nous : son abonnement, sa vie dans l'application, sa fiche), puis la personne qui
// a écrit, et ce que le support ne voit pas. Une carte : deux cartes pleine largeur sous la conversation se lisaient
// comme deux sujets de plus.
function Cote({ d, client, aujourdhui }: { d: Demande; client: Client | null; aujourdhui: string }) {
  const page = d.page ? (PAGES.has(d.page) ? dire(`console.ecran.support.page.${d.page}`) : d.page) : null;
  return (
    <aside className="c-sp-cote" aria-label={titre('console.ecran.support.contexte')}>
      <div className="c-carte c-sp-contexte">
        {client ? (
          <section className="c-sp-client" aria-labelledby="sp-client">
            <span className="c-sp-client-tete">
              <Avatar nom={client.nom} />
              <span><b id="sp-client" data-donnee>{client.nom}</b><span>{maj(abonnementEnMots(client.etat, client.faits))}{client.etat.etat === 'hors' ? '' : ` · ${expliquer(client.etat, aujourdhui)}`}</span></span>
            </span>
            <span className="c-sp-client-chiffres">{maj(dire('console.ecran.support.client_chiffres', {
              membres: selon(client.membres, 'console.ecran.support.membres'), pieces: selon(client.pieces, 'console.ecran.support.pieces'),
              quand: quand(client.derniereActivite, aujourdhui),
            }))}</span>
            <span className="c-sp-liens">
              <Lien href={`#/clients/${client.id}`} petit fleche>{titre('console.ecran.support.ouvrir_fiche')}</Lien>
              <a href={`#/clients/${client.id}?onglet=support`}>{titre('console.ecran.support.ses_demandes')}</a>
            </span>
          </section>
        ) : null}
        <section className="c-sp-personne" aria-labelledby="sp-personne">
          <h3 id="sp-personne" className="c-surtitre">{titre('console.ecran.support.personne')}</h3>
          <span className="c-sp-personne-nom"><b data-donnee>{d.personne.nom}</b>{d.personne.roles.length ? <>{' · '}{d.personne.roles.map((r) => dire(`role.${r}`)).join(', ')}</> : null}</span>
          {d.personne.email ? <a href={`mailto:${d.personne.email}`} data-donnee>{d.personne.email}</a> : null}
          {d.version ? <span className="c-sp-depuis">{maj(page ? dire('console.ecran.support.ecrite_depuis', { page, version: d.version }) : dire('console.ecran.support.ecrite_depuis_sans_page', { version: d.version }))}</span> : null}
        </section>
      </div>
    </aside>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Les closes se lisent par pages de cinquante (serveur/console/support.ts, CLOSES_PAR_PAGE).
const CLOSES_PAR_PAGE = 50;
function sousLesDoigts(): boolean {
  if (document.querySelector('.c-dialogue')) return true;
  const zone = document.activeElement?.closest('.c-sp-repondre')?.querySelector('textarea');
  return !!zone && zone.value.trim() !== '';
}

export function Support({ demande: demandee, vue: vueDemandee }: { demande: string | null; vue: string | null }) {
  const [choisie, setChoisie] = useState<string | null>(demandee);
  const [vue, setVue] = useState<'ouvertes' | 'closes'>(vueDemandee === 'closes' ? 'closes' : 'ouvertes');
  // Les ouvertes que je suis (0115) : un filtre de la liste, qui ne change pas l'adresse.
  const [miennes, setMiennes] = useState(false);
  const { moi } = useConsole();
  // Une demande nommée d'ailleurs (« Répondre », dans « À décider ») remplace celle-ci ; l'adresse suit le choix, sans
  // recharger la page ni la remonter en haut.
  useEffect(() => { if (demandee) setChoisie(demandee); }, [demandee]);
  useEffect(() => { if (vueDemandee) setVue(vueDemandee === 'closes' ? 'closes' : 'ouvertes'); }, [vueDemandee]);
  useEffect(() => {
    const p = new URLSearchParams();
    if (choisie) p.set('demande', choisie);
    if (vue === 'closes') p.set('vue', 'closes');
    const s = p.toString();
    history.replaceState(null, '', `#/support${s ? `?${s}` : ''}`);
  }, [choisie, vue]);
  // La page des closes (0114) : elle ne vit qu'ici, et revient à la première quand on revient aux ouvertes.
  const [debutCloses, setDebutCloses] = useState(0);
  const q = new URLSearchParams();
  if (choisie) q.set('demande', choisie);
  if (debutCloses) q.set('closes', String(debutCloses));
  const [l, relire] = useLecture<Donnees>(`/console/support${q.toString() ? `?${q.toString()}` : ''}`, 'support');
  const lu = l.etat === 'lu' ? l.donnees : null;
  // Une réponse du client arrive pendant qu'on regarde : l'écran se relit toutes les trente secondes et au retour sur
  // l'onglet (comme l'application du client), avec la pastille de « À décider » — sauf sous les doigts : une fenêtre
  // ouverte, ou une réponse en train de s'écrire (le curseur dans la réponse, déjà commencée).
  const { relireDecisions } = useConsole();
  const brouillons = useRef<Brouillons>(new Map());
  const relireTout = useCallback(() => { relire(); relireDecisions(); }, [relire, relireDecisions]);
  useRelireQuandOnRegarde(relireTout, { periode: 30_000, attendre: sousLesDoigts });
  // Sans demande choisie, la plus urgente s'ouvre (à l'ordinateur ; au téléphone, la liste d'abord).
  useEffect(() => {
    if (!lu || choisie || window.matchMedia('(max-width: 860px)').matches) return;
    const premiere = (vue === 'closes' ? lu.closes : lu.ouvertes)[0];
    if (premiere) setChoisie(premiere.id);
  }, [lu, choisie, vue]);
  // Au téléphone, choisir une demande amène sa conversation à l'écran.
  const vient = useRef(false);
  useEffect(() => {
    if (!vient.current || !lu?.demande || lu.demande.ligne.id !== choisie) return;
    vient.current = false;
    if (window.matchMedia('(max-width: 860px)').matches) document.getElementById('sp-fil')?.scrollIntoView({ block: 'start' });
  }, [lu, choisie]);
  const choisir = (id: string) => { vient.current = true; setChoisie(id); };
  // À l'ordinateur, l'écran tient dans la fenêtre : la grille prend la hauteur qui reste sous l'en-tête (mesurée : une
  // alerte au-dessus la déplace), et chaque colonne défile seule — la dernière réponse et le champ restent à l'écran.
  const grille = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const g = grille.current;
    if (!g) return undefined;
    const poser = () => g.style.setProperty('--c-sp-haut', `${Math.max(0, Math.round(g.getBoundingClientRect().top + window.scrollY))}px`);
    poser();
    window.addEventListener('resize', poser);
    return () => window.removeEventListener('resize', poser);
  });
  const nMiennes = lu ? lu.ouvertes.filter((x) => x.suivieParId === moi.utilisateur).length : 0;
  const liste = lu ? (vue === 'closes' ? lu.closes : miennes ? lu.ouvertes.filter((x) => x.suivieParId === moi.utilisateur) : lu.ouvertes) : [];
  const d = lu?.demande && lu.demande.ligne.id === choisie ? lu.demande : null;

  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre('console.ecran.support.titre')}</h1>
          <p className="c-entete-sous">{phrase('console.ecran.support.sous')}</p>
        </div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {lu ? (
        <div className="c-sp-grille" ref={grille}>
          <div className="c-sp-gauche">
            <section className="c-carte c-liste-carte c-sp-liste" aria-label={titre('console.ecran.support.demandes')}>
              <div className="c-sp-liste-tete c-pilules" role="group" aria-label={titre('console.ecran.support.demandes')}>
                <button type="button" className="c-pilule" aria-pressed={vue === 'ouvertes' && !miennes} onClick={() => { setVue('ouvertes'); setMiennes(false); setDebutCloses(0); }}>
                  {titre('console.ecran.support.ouvertes')} <span className="c-pilule-n">{lu.ouvertes.length}</span>
                </button>
                <button type="button" className="c-pilule" aria-pressed={vue === 'ouvertes' && miennes} onClick={() => { setVue('ouvertes'); setMiennes(true); setDebutCloses(0); }}>
                  {titre('console.ecran.support.miennes')} <span className="c-pilule-n">{nMiennes}</span>
                </button>
                <button type="button" className="c-pilule" aria-pressed={vue === 'closes'} onClick={() => { setVue('closes'); setMiennes(false); }}>{titre('console.ecran.support.closes')}</button>
              </div>
              {vue === 'closes' && liste.length ? <p className="c-sp-liste-sous">{phrase('console.ecran.support.closes_sous')}</p> : null}
              {liste.length ? (
                <div className="c-sp-tickets">
                  {liste.map((x) => <Ticket key={x.id} l={x} choisie={x.id === choisie} choisir={() => choisir(x.id)} aujourdhui={lu.aujourdhui} />)}
                </div>
              ) : vue === 'ouvertes' && miennes ? <Vide icone="courriel">{phrase('console.ecran.support.vide_miennes')}</Vide>
                : vue === 'ouvertes' ? (
                <Vide icone="courriel"><span>{phrase('console.ecran.support.vide_ouvertes')}</span> <Lien href="#/clients" petit>{titre('console.ecran.support.vers_clients')}</Lien></Vide>
              ) : <Vide icone="courriel">{phrase('console.ecran.support.vide_closes')}</Vide>}
              {vue === 'closes' && lu.pagesCloses && lu.pagesCloses.total > lu.pagesCloses.parPage ? (
                <nav className="c-sp-pages" aria-label={titre('console.ecran.support.pages_closes')}>
                  <span>{dire('console.ecran.support.closes_de_a', { debut: lu.pagesCloses.debut + 1, fin: lu.pagesCloses.debut + liste.length, total: lu.pagesCloses.total })}</span>
                  <span className="c-liste-pied-boutons">
                    <Bouton petit desactive={lu.pagesCloses.debut === 0} onClick={() => setDebutCloses(Math.max(0, debutCloses - CLOSES_PAR_PAGE))}>{titre('console.ecran.support.plus_recentes')}</Bouton>
                    <Bouton petit desactive={lu.pagesCloses.debut + lu.pagesCloses.parPage >= lu.pagesCloses.total} onClick={() => setDebutCloses(debutCloses + CLOSES_PAR_PAGE)}>{titre('console.ecran.support.plus_anciennes')}</Bouton>
                  </span>
                </nav>
              ) : null}
            </section>
            {d ? <Cote d={d} client={lu.client} aujourdhui={lu.aujourdhui} /> : null}
          </div>
          {d ? (
            <Fil key={d.ligne.id} d={d} articles={lu.articles} brouillons={brouillons.current} aujourdhui={lu.aujourdhui} relire={relire} equipe={lu.equipe ?? []} />
          ) : (
            <section className="c-carte c-sp-fil c-sp-fil-vide">
              {choisie && l.etat === 'lu' && !l.enCours ? <Vide icone="chercher">{phrase('console.ecran.support.introuvable')}</Vide>
                : choisie ? <p className="c-attente">{titre('console.ecran.lecture')}</p>
                  : liste.length ? <Vide icone="courriel">{phrase('console.ecran.support.choisir')}</Vide> : null}
            </section>
          )}
        </div>
      ) : null}
    </>
  );
}
