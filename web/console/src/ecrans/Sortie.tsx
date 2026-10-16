// La sortie d'un client et la conservation de ses données (1.38.0 ; base 0131 ; docs/console.md C54 ;
// serveur/console/sortie.ts). Quand un client s'en va, la direction ouvre sa sortie (pourquoi il s'en va), et la carte dit
// à chaque instant ce qui reste à faire, dans l'ordre :
//   - le contrat : son abonnement ne se renouvelle plus (le bouton « Résilier » est celui de l'onglet Abonnement) ;
//   - ses données : c'est LUI qui les télécharge ; la console en lit seulement la trace, jamais le fichier ;
//   - le remboursement : rien à rendre, ou rendu (sa référence, son montant, son jour : déclaré, puis rapproché quand
//     SkanFact le note sur ses factures, 0138) ;
//   - la conservation : jusqu'à quand ses données restent, en lecture seule, et que rien ne s'efface avant sans sa demande.
// Elle se clôt « il est parti » (le contrat arrêté, le remboursement réglé) ou « il reste ».
import { useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { panneDe, refusDe, useApi } from '../contexte.ts';
import { jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, Icone, maj, Pilules, Puce, toast, Zone, type NomIcone } from '../ui.tsx';
import { montant } from '../argent.ts';

export const CAUSES = ['prix', 'manque', 'fermeture', 'concurrent', 'autre'] as const;
export type Cause = typeof CAUSES[number];
export type Sortie = {
  id: string; cause: Cause; dit: string; ouverteLe: string; ouvertePar: string | null;
  contrat: { arrete: boolean; fin: string | null; offert: boolean };
  export: { le: string; par: string | null } | null;
  // 0138 (l'audit 1.42.0 A04) : rendu, son montant et son jour, et s'il est rapproché (noté dans SkanFact sur ses factures).
  remboursement: { sorte: 'aucun' | 'fait'; reference: string | null; le: string; par: string | null; montant?: string | null; renduLe?: string | null; rapproche?: boolean | null } | null;
  conserverJusquAu: string | null;
  close: { le: string; issue: 'partie' | 'reste'; motif: string; par: string | null; finContrat: string | null } | null;
};
export type Etape = 'contrat' | 'donnees' | 'remboursement';
const K = 'console.ecran.sortie';

// La même règle que le serveur (serveur/console/sortie.ts) : un téléchargement d'avant l'ouverture ne compte pas.
const donneesRemises = (s: Sortie) => !!s.export && new Date(s.export.le).getTime() >= new Date(s.ouverteLe).getTime();
// Un remboursement déclaré n'est réglé qu'une fois rapproché (0138) : la même règle que le serveur.
const faite = (s: Sortie, e: Etape) => (e === 'contrat' ? s.contrat.arrete && s.contrat.fin !== null : e === 'donnees' ? donneesRemises(s)
  : s.remboursement !== null && s.remboursement.rapproche !== false);
export const sortieEnCours = (s: Sortie | null | undefined): boolean => !!s && !s.close;
// La ligne d'« À décider » (l'accueil et la fiche disent la même phrase) : le contrat a pris fin, et ce qui reste.
export function sortieAttendEnMots(l: { fin: string; restantes: Etape[] }): string {
  if (!l.restantes.length) return phrase(`${K}.attend_tout_fait`, { le: jourCourt(l.fin) });
  return phrase(`${K}.attend`, { le: jourCourt(l.fin), quoi: l.restantes.map((e) => dire(`${K}.reste.${e}`)).join(dire(`${K}.et`)) });
}

export function useEnvoi(fait: () => void) {
  const api = useApi();
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string) => { setRefus(texte); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = (chemin: string, corps: unknown, dit: string) => {
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', chemin, corps);
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(dit); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  // un autre choix : le refus du précédent ne tient plus
  const oublier = () => { setRefus(null); setFaute(null); };
  return { envoyer, refuser, oublier, refus, occupe, faute: (champ: string) => faute?.champ === champ, n: faute?.n ?? 0 };
}
export function Pied({ fermer, occupe, envoyer, bouton, danger }: { fermer: () => void; occupe: boolean; envoyer: () => void; bouton: string; danger?: boolean }) {
  return (
    <>
      <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
      <Bouton ton={danger ? 'danger' : 'principal'} occupe={occupe} onClick={envoyer}>{bouton}</Bouton>
    </>
  );
}
export function CeQuiVa({ lignes }: { lignes: string[] }) {
  return (
    <div className="c-al-ce-qui-va">
      <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
      <ul>{lignes.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

// La conservation en une phrase : jusqu'à quand ses données restent (À VÉRIFIER : la durée).
const conservationEnMots = (s: Sortie) => (s.conserverJusquAu ? phrase(`${K}.conservation`, { le: jourCourt(s.conserverJusquAu) }) : phrase(`${K}.conservation_sans`));

export function CarteSortie({ id, nom, sortie, aujourdhui, relire, resilier }: {
  id: string; nom: string; sortie: Sortie | null | undefined; aujourdhui: string; relire: () => void; resilier?: (() => void) | undefined;
}) {
  const [fenetre, setFenetre] = useState<'ouvrir' | 'remboursement' | 'partie' | 'reste' | null>(null);
  const fait = () => { setFenetre(null); relire(); };

  if (!sortieEnCours(sortie)) {
    const c = sortie?.close;
    return (
      <section className="c-carte c-reprise" aria-labelledby="fiche-sortie">
        <b id="fiche-sortie" className="c-reprise-titre">{titre(`${K}.rare`)}</b>
        <span className="c-reprise-texte">{phrase(`${K}.rare_texte`)}</span>
        {c?.issue === 'partie' && sortie ? <span className="c-reprise-texte c-so-partie">{phrase(`${K}.partie_le`, { le: jourCourt(jourDe(c.le)), fin: c.finContrat ? jourCourt(c.finContrat) : '—', jusqu: sortie.conserverJusquAu ? jourCourt(sortie.conserverJusquAu) : '—' })}</span> : null}
        {c?.issue === 'reste' ? <span className="c-reprise-texte">{phrase(`${K}.reste_le`, { le: jourCourt(jourDe(c.le)), motif: c.motif })}</span> : null}
        <span><Bouton petit onClick={() => setFenetre('ouvrir')}>{titre(`${K}.ouvrir_court`)}</Bouton></span>
        {fenetre === 'ouvrir' ? <OuvrirSortie id={id} nom={nom} fermer={() => setFenetre(null)} fait={fait} /> : null}
      </section>
    );
  }

  const s = sortie as Sortie;
  const etapes: { e: Etape; icone: NomIcone; ok: boolean; titre: string; texte: string; geste?: { texte: string; faire: () => void } | undefined }[] = [
    { e: 'contrat', icone: 'calendrier', ok: faite(s, 'contrat'), titre: titre(`${K}.etape.contrat`),
      texte: faite(s, 'contrat') ? phrase(`${K}.contrat_ok`, { le: jourCourt(s.contrat.fin ?? '') })
        : s.contrat.offert ? phrase(`${K}.contrat_offert`) : phrase(`${K}.contrat_renouvele`),
      geste: !faite(s, 'contrat') && resilier ? { texte: titre(`${K}.resilier`), faire: resilier } : undefined },
    { e: 'donnees', icone: 'telecharger', ok: faite(s, 'donnees'), titre: titre(`${K}.etape.donnees`),
      texte: donneesRemises(s) ? phrase(`${K}.donnees_ok`, { quand: quand(s.export?.le ?? '', aujourdhui), qui: s.export?.par ?? '—' })
        : s.export ? phrase(`${K}.donnees_avant`, { le: jourCourt(jourDe(s.export.le)) }) : phrase(`${K}.donnees_pas`) },
    { e: 'remboursement', icone: 'echange', ok: faite(s, 'remboursement'), titre: titre(`${K}.etape.remboursement`),
      texte: s.remboursement ? phrase(`${K}.remb_${s.remboursement.sorte}${s.remboursement.montant ? (s.remboursement.rapproche ? '_note' : '_declare') : ''}`, {
        reference: s.remboursement.reference ?? '', quand: quand(s.remboursement.le, aujourdhui), qui: s.remboursement.par ?? '—',
        montant: s.remboursement.montant ? montant(s.remboursement.montant) : '', jour: jourCourt(s.remboursement.renduLe ?? null) })
        : phrase(`${K}.remb_pas`),
      geste: { texte: titre(s.remboursement ? `${K}.remb_changer` : `${K}.remb_regler`), faire: () => setFenetre('remboursement') } },
  ];
  const peutPartir = faite(s, 'contrat') && faite(s, 'remboursement');
  const fini = s.contrat.fin !== null && s.contrat.fin < aujourdhui;
  return (
    <section className="c-carte c-reprise c-reprise-en-cours" aria-labelledby="fiche-sortie">
      <div className="c-carte-tete">
        <div>
          <h2 id="fiche-sortie">{titre(`${K}.en_cours`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.ouverte`, { le: jourCourt(jourDe(s.ouverteLe)), qui: s.ouvertePar ?? '—', cause: dire(`${K}.cause.${s.cause}`) })}</p>
        </div>
        <Puce ton={fini ? 'aujourdhui' : 'semaine'}>{s.contrat.fin && faite(s, 'contrat')
          ? titre(fini ? `${K}.puce_fini` : `${K}.puce_jusqu`, { le: jourCourt(s.contrat.fin) }) : titre(`${K}.puce_renouvele`)}</Puce>
      </div>
      <div className="c-so-dit">
        <span className="c-champ-libelle">{titre(`${K}.il_dit`)}</span>
        <p data-donnee>{s.dit}</p>
      </div>
      <ul className="c-so-etapes">
        {etapes.map((x) => (
          <li key={x.e} className={x.ok ? 'c-so-faite' : ''}>
            <span className={`c-ligne-icone ${x.ok ? 'c-ok' : 'c-semaine'}`}><Icone nom={x.ok ? 'ok' : x.icone} taille={16} /></span>
            <span className="c-reprise-piece"><b>{x.titre}</b><small>{x.texte}</small></span>
            <span className="c-cache">{titre(x.ok ? `${K}.fait` : `${K}.a_faire`)}</span>
            {x.geste ? <Bouton petit onClick={x.geste.faire}>{x.geste.texte}</Bouton> : null}
          </li>
        ))}
        <li className="c-so-conservation">
          <span className="c-ligne-icone"><Icone nom="cadenas" taille={16} /></span>
          <span className="c-reprise-piece"><b>{titre(`${K}.etape.conservation`)}</b><small>{conservationEnMots(s)}</small></span>
        </li>
      </ul>
      <div className="c-boutons-ligne c-reprise-gestes">
        <Bouton {...(peutPartir ? { ton: 'principal' as const } : {})} desactive={!peutPartir} onClick={() => setFenetre('partie')}>{titre(`${K}.partie_court`)}</Bouton>
        <Bouton onClick={() => setFenetre('reste')}>{titre(`${K}.reste_court`)}</Bouton>
      </div>
      {!peutPartir ? <small className="c-reprise-note">{phrase(`${K}.manque`, { quoi: etapes.filter((x) => x.e !== 'donnees' && !x.ok).map((x) => x.titre.toLowerCase()).join(dire(`${K}.et`)) })}</small> : null}
      {fenetre === 'remboursement' ? <FenetreRemboursement s={s} nom={nom} fermer={() => setFenetre(null)} fait={fait} /> : null}
      {fenetre === 'partie' || fenetre === 'reste' ? <FenetreClore s={s} nom={nom} issue={fenetre} fermer={() => setFenetre(null)} fait={fait} /> : null}
    </section>
  );
}

function OuvrirSortie({ id, nom, fermer, fait }: { id: string; nom: string; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [cause, setCause] = useState<Cause | null>(null);
  const [dit, setDit] = useState('');
  const envoyer = () => {
    if (!cause) { e.refuser(phrase(`${K}.sans_cause`), 'cause'); return; }
    if (dit.trim().length < 3) { e.refuser(phrase(`${K}.dit_court`), 'dit'); return; }
    e.envoyer(`/console/entreprises/${id}/sorties`, { cause, dit: dit.trim() }, phrase(`${K}.ouverte_toast`));
  };
  return (
    <Dialogue titre={titre(`${K}.ouvrir_titre`)} pour={nom} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${K}.ouvrir_bouton`)} />}>
      <CeQuiVa lignes={['p1', 'p2', 'p3'].map((x) => phrase(`${K}.ouvrir_${x}`))} />
      <Pilules libelle={titre(`${K}.cause_titre`)} valeur={cause} changer={setCause} faute={e.faute('cause')}
        choix={CAUSES.map((x) => ({ valeur: x, texte: maj(dire(`${K}.cause.${x}`)) }))} />
      <Zone libelle={titre(`${K}.dit`)} aide={phrase(`${K}.dit_aide`)} valeur={dit} changer={setDit} max={1000} faute={e.faute('dit')} n={e.n} />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreRemboursement({ s, nom, fermer, fait }: { s: Sortie; nom: string; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [sorte, setSorte] = useState<'aucun' | 'fait'>(s.remboursement?.sorte ?? 'aucun');
  const [reference, setReference] = useState(s.remboursement?.reference ?? '');
  const [motif, setMotif] = useState('');
  // Rendu : combien et quand (0138) — déclaré, puis rapproché quand SkanFact le note sur ses factures.
  const aujourdhui = jourDe(new Date().toISOString());
  const [somme, setSomme] = useState(s.remboursement?.montant ? montant(s.remboursement.montant).replaceAll('\u202f', '') : '');
  const [le, setLe] = useState(s.remboursement?.renduLe ?? aujourdhui);
  const envoyer = () => {
    if (sorte === 'fait' && !reference.trim()) { e.refuser(phrase(`${K}.remb_reference_vide`), 'reference'); return; }
    if (sorte === 'fait' && !somme.trim()) { e.refuser(phrase(`${K}.remb_montant_vide`), 'montant'); return; }
    if (sorte === 'fait' && !le) { e.refuser(phrase(`${K}.remb_jour_vide`), 'le'); return; }
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/sorties/${s.id}/remboursement`, { remboursement: sorte, reference: sorte === 'fait' ? reference.trim() : null,
      ...(sorte === 'fait' ? { montant: somme.trim(), le } : {}), motif: motif.trim() },
      phrase(`${K}.remb_toast_${sorte}`));
  };
  return (
    <Dialogue titre={titre(`${K}.remb_titre`)} pour={nom} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${K}.remb_bouton_${sorte}`)} />}>
      <Pilules libelle={titre(`${K}.remb_choix`)} valeur={sorte} changer={(x) => { e.oublier(); setSorte(x); }}
        choix={(['aucun', 'fait'] as const).map((x) => ({ valeur: x, texte: titre(`${K}.remb_sorte.${x}`) }))} />
      <CeQuiVa lignes={[phrase(`${K}.remb_p_${sorte}`), phrase(`${K}.remb_p_journal`)]} />
      {sorte === 'fait' ? (
        <>
          <Champ libelle={titre(`${K}.remb_reference`)} aide={phrase(`${K}.remb_reference_aide`)} valeur={reference} changer={setReference}
            faute={e.faute('reference')} n={e.n} />
          <div className="c-ct-rembourse">
            <Champ libelle={titre(`${K}.remb_montant`)} aide={phrase(`${K}.remb_montant_aide`)} valeur={somme} changer={setSomme} inputMode="decimal"
              faute={e.faute('montant')} n={e.n} />
            <Champ libelle={titre(`${K}.remb_jour`)} type="date" max={aujourdhui} valeur={le} changer={setLe} faute={e.faute('le')} n={e.n} />
          </div>
        </>
      ) : null}
      <Zone libelle={titre('console.ecran.geste.motif')} valeur={motif} changer={setMotif} faute={e.faute('motif')} n={e.n} />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

function FenetreClore({ s, nom, issue, fermer, fait }: { s: Sortie; nom: string; issue: 'partie' | 'reste'; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [motif, setMotif] = useState('');
  const envoyer = () => {
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/sorties/${s.id}/clore`, { issue, motif: motif.trim() }, phrase(`${K}.${issue}_toast`, { nom }));
  };
  const lignes = issue === 'partie'
    ? [phrase(`${K}.partie_p1`), conservationEnMots(s), phrase(`${K}.partie_p3`)]
    : [phrase(`${K}.reste_p1`), phrase(`${K}.reste_p2`)];
  return (
    <Dialogue titre={titre(`${K}.${issue}_titre`)} pour={nom} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${K}.${issue}_bouton`)} />}>
      {/* Un avertissement se lit avant le geste : il part sans avoir pris ses données (c'est son droit). */}
      {issue === 'partie' && !donneesRemises(s) ? <Alerte ton="attention">{phrase(`${K}.partie_sans_donnees`)}</Alerte> : null}
      <CeQuiVa lignes={lignes} />
      <Zone libelle={titre('console.ecran.geste.motif')} valeur={motif} changer={setMotif} premier faute={e.faute('motif')} n={e.n} />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}
