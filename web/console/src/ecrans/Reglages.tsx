// Les réglages de la plateforme (docs/console.md C28 ; skanfact docs/cadrage/10-console.md § 2.9 ; maquette
// Reglages.dc.html) : ce qui vaut pour tous les clients, au même endroit, en trois onglets — les offres et leurs prix
// (la grille datée, les abonnés de chaque offre, ce qui se passe autour d'une échéance, tiré du code du serveur), les
// règles fiscales communes (le registre, chaque règle avec sa source et qui l'a relue) et le message affiché en haut de
// l'application des clients. La direction change ; le support lit, pour répondre à un client. Rien n'est inventé : ce que
// la console ne sait pas encore faire (allumer une nouveauté) se dit avec la façon dont il se fait. Un nouveau prix se
// prépare ici (0103), au plus tôt après le préavis, et se retire tant que sa date n'est pas venue.
import { useEffect, useRef, useState } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { montant } from '../argent.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { entier } from '../nombres.ts';
import { jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Bouton, Champ, Choix, Dialogue, Lien, maj, Puce, toast, Vide, Zone } from '../ui.tsx';

const K = 'console.ecran.reglages';

export type OngletReglages = 'prix' | 'regles' | 'formats' | 'messages' | 'nouveautes';
export const ONGLETS_REGLAGES: readonly OngletReglages[] = ['prix', 'regles', 'formats', 'messages', 'nouveautes'];

type Offre = 'essentiel' | 'complet';
type Periodicite = 'annuel' | 'mensuel';
type Case = { ht: string; depuis: string } | null;
// Un prix à venir ; préparé dans la console (0103), avec qui l'a préparé, quand et pourquoi.
type AVenir = { periodicite: Periodicite; ht: string; aPartirDu: string; motif?: string | null; par?: string | null; le?: string | null };
type LigneGrille = { offre: Offre; annuel: Case; mensuel: Case; aVenir: AVenir[]; abonnes: { annuel: number; mensuel: number } };
// Ce qui s'ajoute à l'offre (14c) : ses prix datés, et pour un module, les abonnés d'aujourd'hui qui l'ont acheté.
type Ajout = 'caisse' | 'etablissement' | 'salarie' | 'module_paie' | 'module_compta';
type LigneAjout = { option: Ajout; annuel: Case; mensuel: Case; aVenir: AVenir[]; achetes: number | null };
// Ce qui a un prix : les offres et ce qui s'ajoute ; le préavis d'un nouveau prix (0103).
type QuoiPrix = Offre | Ajout;
const OFFRES_PRIX: readonly Offre[] = ['essentiel', 'complet'];
const AJOUTS_PRIX: readonly Ajout[] = ['caisse', 'etablissement', 'salarie', 'module_paie', 'module_compta'];
type Preavis = { jours: number; aPartirDu: string; motif: string; par: string | null; le: string };
type Relecture = { reluePar: string; avis: 'juste' | 'a_corriger'; dit: string | null; motif: string; par: string; le: string };
type Regle = {
  id: string; code: string; debut: string; fin: string | null; source: string; poseeLe: string; relectures: Relecture[];
  enVigueur: boolean; valeurLue: { connue: boolean; texte: string }; aRelire: boolean;
};
type Message = {
  id: string; sorte: 'nouveaute' | 'maintenance'; texte: string; du: string; au: string; motif: string; par: string; le: string;
  enCours: boolean; retireLe: string | null; retirePar: string | null; retireMotif: string | null; remplace: boolean;
  // Son public (vide : tous) et sa diffusion : combien d'entreprises l'ont vu, et caché (0139, C63) ; null : pas mesuré.
  cible: Public[]; vus: number | null; caches: number | null;
};
// Les publics d'un message (0139, C63), dans l'ordre où la fenêtre les propose, et ce que chacun atteint aujourd'hui.
const PUBLICS = ['essai', 'essentiel', 'complet', 'en_retard', 'lecture_seule'] as const;
type Public = typeof PUBLICS[number];
type Portee = Record<Public | 'tous', number>;
// Pour qui, en mots : « tous les clients », ou le public posé.
const pourQui = (cible: readonly Public[]) => (cible.length ? cible.map((c) => dire(`${K}.m.public.${c}`)).join(dire(`${K}.m.public.et`)) : dire(`${K}.m.public.tous`));
// Sa diffusion, en mots : « vu dans 12 entreprises · caché dans 3 », ou rien tant qu'elle n'est pas lue.
function DitDiffusion({ m }: { m: Message }) {
  if (m.vus === null || m.caches === null) return null;
  return <span className="c-sous c-bloc c-rg-diffusion">{maj(m.vus ? `${selon(m.vus, `${K}.m.vus`)} · ${selon(m.caches, `${K}.m.caches`)}` : selon(0, `${K}.m.vus`))}</span>;
}
type Donnees = {
  aujourdhui: string; role: 'direction' | 'support' | 'technique';
  grille: LigneGrille[]; ajouts: LigneAjout[]; preavis: Preavis | null; essai: { jours: number | null; enCours: number };
  echeance: { relances: number[]; grace: number | null; enGrace: number }; regles: Record<CodeRegle, RegleAbonnement | null>;
  contenu: Contenus; remises: Remises;
  registre: Regle[]; message: Message | null; passes: Message[]; portee: Portee; formats: Format[];
  factures: NosFactures;
  nouveautes: EtatNouveaute[];
};
// Les nouveautés qu'on allume (0120, C43) : celles que la version en service porte, et pour qui chacune est allumée.
type Allumee = { entreprise: string; numero: string | null; nom: string; le: string; par: string; motif: string };
type EtatNouveaute = { code: string; nom: string; quoi: string; ouverte: { le: string; par: string; motif: string } | null; allumees: Allumee[] };
// Nos factures (docs/abonnement.md B1) : l'entreprise de la plateforme où elles naissent, et celles que je pourrais désigner.
type Possible = { entreprise: string; raisonSociale: string; matricule: string | null };
type NosFactures = {
  editeur: (Possible & { poseLe: string; posePar: string | null; proprietaire: boolean; factures: number }) | null;
  possibles: Possible[];
};
type EtatFormat = 'en_place' | 'simule' | 'calcule' | 'pas_encore' | 'non_homologue';
type Format = {
  code: 'teif' | 'signature' | 'ttn' | 'tej' | 'cnss' | 'liasse' | 'ecritures' | 'caisse'; etat: EtatFormat; aVerifier: boolean; version: string | null;
  chiffres: Record<string, number | string | null> | null; branche: boolean | null; alerte: boolean;
};
type Geste = { sorte: 'relire'; regle: Regle } | { sorte: 'ecrire' } | { sorte: 'retirer'; message: Message } | { sorte: 'editeur' }
  | { sorte: 'prix' } | { sorte: 'retirer_prix'; quoi: QuoiPrix; v: AVenir } | { sorte: 'preavis' } | { sorte: 'regle'; code: CodeRegle }
  | { sorte: 'contenu' } | { sorte: 'retirer_contenu'; v: ContenuAVenir } | { sorte: 'remise' } | { sorte: 'retirer_remise'; v: RemiseAVenir }
  | { sorte: 'allumer'; n: EtatNouveaute } | { sorte: 'eteindre'; n: EtatNouveaute; a: Allumee } | { sorte: 'ouvrir'; n: EtatNouveaute } | { sorte: 'refermer'; n: EtatNouveaute };
// Les règles de l'abonnement réglées ici (0104) : chacune telle qu'elle vaut aujourd'hui, qui l'a posée et pourquoi.
type CodeRegle = 'essai' | 'grace' | 'relances';
type RegleAbonnement = { jours: number[]; aPartirDu: string; motif: string; par: string | null; le: string };
// Ce que chaque offre comprend (0105) : un nombre (caisses, établissements, salariés avec la paie) ; pour un module, 1
// compris, 0 acheté seul ; rien quand aucune ligne ne vaut. Chaque changement préparé, avec qui et pourquoi.
type QuoiContenu = 'caisses' | 'etablissements' | 'salaries' | 'paie' | 'compta';
const QUOI_CONTENU: readonly QuoiContenu[] = ['caisses', 'etablissements', 'salaries', 'paie', 'compta'];
type ContenuDuJour = Record<QuoiContenu, number | null>;
type ContenuAVenir = { offre: Offre; quoi: QuoiContenu; nombre: number; aPartirDu: string; motif: string | null; par: string | null; le: string | null };
type Contenus = { duJour: Record<Offre, ContenuDuJour>; aVenir: ContenuAVenir[] };
const estModule = (q: QuoiContenu) => q === 'paie' || q === 'compta';
// Les remises (0106) : celle du groupe et celle du cabinet (un taux, et pour le cabinet une durée en mois), datées comme
// un prix ; combien de sociétés sont dans un groupe aujourd'hui.
type CodeRemise = 'groupe' | 'cabinet';
const CODES_REMISE: readonly CodeRemise[] = ['groupe', 'cabinet'];
type RegleRemise = { taux: number; mois: number | null; aPartirDu: string; motif: string; par: string | null; le: string | null };
type RemiseAVenir = RegleRemise & { code: CodeRemise };
type Remises = { duJour: Record<CodeRemise, RegleRemise | null>; aVenir: RemiseAVenir[]; groupes: number; enGroupe: number };

// Un jour de calendrier lu par une personne : 19/11/2026 (le serveur rend « 2026-11-19 »).
const jour = (j: string) => jourCourt(j);
const plusJours = (j: string, n: number) => {
  const d = new Date(Date.UTC(Number(j.slice(0, 4)), Number(j.slice(5, 7)) - 1, Number(j.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
};
// Le nom d'une règle, quand la console la connaît ; sinon son code, tel quel (jamais un nom deviné).
const nomDeRegle = (r: Regle) => (r.valeurLue.connue ? titre(`${K}.r.nom.${r.code.replace('.', '_')}`) : r.code);
// Sous le titre d'une fenêtre : le nom de la règle ET son code (le code seul, pour une règle qu'on ne sait pas nommer).
const nomEtCode = (r: Regle) => (r.valeurLue.connue ? `${nomDeRegle(r)} · ${r.code}` : r.code);

// Ce qui change de prix, dans une phrase : « Essentiel », « une caisse de plus ».
const nomDe = (q: QuoiPrix) => (q === 'essentiel' || q === 'complet' ? dire(`${K}.p.offre.${q}`) : dire(`${K}.a.nom.${q}`));

// La case d'un prix dans une grille : le montant en dinars, ou « — » quand aucun n'est posé (jamais un prix deviné).
function CasePrix({ c }: { c: Case }) {
  return c ? <span data-donnee>{montant(c.ht)}</span> : <>—</>;
}

// ── Offres et prix ──────────────────────────────────────────────────────────────────────────────────────────────────
function Prix({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  const r = d.echeance.relances.slice().sort((a, b) => b - a);
  const etapes = [
    ...r.map((n, i) => ({ quand: n === 1 ? dire(`${K}.p.f.veille`) : dire(`${K}.p.f.avant`, { n }),
      quoi: phrase(i === 0 ? `${K}.p.f.annonce` : i === r.length - 1 ? `${K}.p.f.dernier` : `${K}.p.f.rappel`), ton: 'calme' })),
    { quand: dire(`${K}.p.f.echeance`), quoi: phrase(`${K}.p.f.echeance_quoi`), ton: 'jour' },
    { quand: d.echeance.grace === null ? dire(`${K}.p.f.grace_inconnue`) : selon(d.echeance.grace, `${K}.p.f.grace`), quoi: phrase(`${K}.p.f.grace_quoi`), ton: 'grace' },
    { quand: dire(`${K}.p.f.lecture_seule`), quoi: phrase(`${K}.p.f.lecture_seule_quoi`), ton: 'fin' },
  ];
  return (
    <>
      <section className="c-carte c-rg" aria-labelledby="rg-grille">
        <div className="c-al-section-tete">
          <div>
            <h2 id="rg-grille">{titre(`${K}.p.titre`)}</h2>
            <p className="c-carte-sous">{phrase(`${K}.p.sous`)}</p>
          </div>
          {peut ? <Bouton icone="plus" onClick={() => geste({ sorte: 'prix' })}>{titre(`${K}.p.preparer`)}</Bouton> : null}
        </div>
        <div className="c-defile">
          <table className="c-table c-rg-grille">
            <thead><tr>
              <th scope="col">{titre(`${K}.p.col.offre`)}</th>
              <th scope="col" className="c-droite">{titre(`${K}.p.col.an`)}</th>
              <th scope="col" className="c-droite">{titre(`${K}.p.col.mois`)}</th>
              <th scope="col">{titre(`${K}.p.col.depuis`)}</th>
              <th scope="col" className="c-droite">{titre(`${K}.p.col.abonnes`)}</th>
            </tr></thead>
            <tbody>
              <tr>
                <td><b>{titre(`${K}.p.essai`)}</b><span className="c-sous c-bloc">
                  {d.essai.jours === null ? phrase(`${K}.p.essai_sous_inconnu`) : phrase(`${K}.p.essai_sous`, { jours: d.essai.jours })}</span></td>
                <td className="c-droite" data-libelle={titre(`${K}.p.col.an`)}>{titre(`${K}.p.gratuit`)}</td>
                <td className="c-droite" data-libelle={titre(`${K}.p.col.mois`)}>—</td>
                <td data-libelle={titre(`${K}.p.col.depuis`)}>—</td>
                <td className="c-droite" data-libelle={titre(`${K}.p.col.abonnes`)}>{selon(d.essai.enCours, `${K}.p.essais`)}</td>
              </tr>
              {d.grille.map((l) => {
                const depuis = [l.annuel?.depuis, l.mensuel?.depuis].filter((x): x is string => !!x).sort()[0] ?? null;
                const n = l.abonnes.annuel + l.abonnes.mensuel;
                return (
                  <tr key={l.offre}>
                    <td>
                      <b>{titre(`${K}.p.offre.${l.offre}`)}</b>
                      {l.aVenir.map((v) => (
                        <span key={`${v.periodicite}${v.aPartirDu}`} className="c-rg-avenir">
                          {phrase(`${K}.p.a_venir`, { prix: montant(v.ht), periode: dire(`${K}.p.periode.${v.periodicite}`), jour: jour(v.aPartirDu) })}
                        </span>
                      ))}
                    </td>
                    <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.p.col.an`)}><CasePrix c={l.annuel} /></td>
                    <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.p.col.mois`)}><CasePrix c={l.mensuel} /></td>
                    <td data-libelle={titre(`${K}.p.col.depuis`)}>{depuis ? dire(`${K}.p.depuis_le`, { jour: jour(depuis) }) : '—'}</td>
                    <td className="c-droite" data-libelle={titre(`${K}.p.col.abonnes`)}>
                      {selon(n, `${K}.p.entreprises`)}
                      {/* Le détail ne dit que ce qui existe : « 1 au mois », jamais « 0 à l'année · 1 au mois ». */}
                      {n ? <span className="c-sous c-bloc">{(['annuel', 'mensuel'] as const).filter((p) => l.abonnes[p] > 0)
                        .map((p) => dire(`${K}.p.detail_${p}`, { n: entier(l.abonnes[p]) })).join(' · ')}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PrixAVenir lignes={d.grille.flatMap((l) => l.aVenir.map((v) => ({ quoi: l.offre as QuoiPrix, v })))} aujourdhui={d.aujourdhui} geste={geste} peut={peut} />
        <p className="c-sous">{phrase(`${K}.p.note`)}</p>
        <LePreavis d={d} geste={geste} peut={peut} />
      </section>
      <CeQueComprend d={d} geste={geste} peut={peut} />
      <Ajouts d={d} geste={geste} peut={peut} />
      <LesRemises d={d} geste={geste} peut={peut} />
      <section className="c-carte c-rg" aria-labelledby="rg-echeance">
        <div className="c-al-section-tete"><div>
          <h2 id="rg-echeance">{titre(`${K}.p.f.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.p.f.sous`)}</p>
        </div></div>
        <ol className="c-rg-frise">
          {etapes.map((e) => (
            <li key={e.quand} className={`c-rg-etape c-rg-etape-${e.ton}`}>
              <span className="c-rg-etape-quand">{maj(e.quand)}</span>
              <span className="c-rg-etape-quoi">{e.quoi}</span>
            </li>
          ))}
        </ol>
        <ul className="c-rg-regles">
          {(['essai', 'relances', 'grace'] as const).map((code) => <UneRegle key={code} code={code} d={d} geste={geste} peut={peut} />)}
        </ul>
      </section>
      <NosFacturesCarte f={d.factures} aujourdhui={d.aujourdhui} geste={geste} peut={peut} />
    </>
  );
}

// Ce qui s'ajoute à l'offre (14c ; docs/abonnement.md C7) : la grille que l'application montre sous les offres et que la
// facture compte, datée comme celle des offres ; pour un module acheté seul, combien d'abonnés l'ont aujourd'hui.
function Ajouts({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  return (
    <section className="c-carte c-rg c-rg-ajouts-carte" aria-labelledby="rg-ajouts">
      <div className="c-al-section-tete"><div>
        <h2 id="rg-ajouts">{titre(`${K}.a.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${K}.a.sous`)}</p>
      </div></div>
      <div className="c-defile">
        <table className="c-table c-rg-grille c-rg-ajouts">
          <thead><tr>
            <th scope="col">{titre(`${K}.a.col.ajout`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.p.col.an`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.p.col.mois`)}</th>
            <th scope="col">{titre(`${K}.p.col.depuis`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.a.col.achetes`)}</th>
          </tr></thead>
          <tbody>
            {d.ajouts.map((l) => {
              const depuis = [l.annuel?.depuis, l.mensuel?.depuis].filter((x): x is string => !!x).sort()[0] ?? null;
              return (
                <tr key={l.option} data-option={l.option}>
                  <td>
                    <b>{titre(`${K}.a.nom.${l.option}`)}</b>
                    <span className="c-sous c-bloc">{comprisDe(l.option, d.contenu.duJour)}</span>
                    {l.aVenir.map((v) => (
                      <span key={`${v.periodicite}${v.aPartirDu}`} className="c-rg-avenir">
                        {phrase(`${K}.p.a_venir`, { prix: montant(v.ht), periode: dire(`${K}.p.periode.${v.periodicite}`), jour: jour(v.aPartirDu) })}
                      </span>
                    ))}
                  </td>
                  <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.p.col.an`)}><CasePrix c={l.annuel} /></td>
                  <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.p.col.mois`)}><CasePrix c={l.mensuel} /></td>
                  <td className="c-rg-nowrap" data-libelle={titre(`${K}.p.col.depuis`)}>{depuis ? dire(`${K}.p.depuis_le`, { jour: jour(depuis) }) : '—'}</td>
                  <td className="c-droite" data-libelle={titre(`${K}.a.col.achetes`)}>{l.achetes === null ? '—' : selon(l.achetes, `${K}.p.entreprises`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PrixAVenir lignes={d.ajouts.flatMap((l) => l.aVenir.map((v) => ({ quoi: l.option as QuoiPrix, v })))} aujourdhui={d.aujourdhui} geste={geste} peut={peut} />
      <p className="c-sous">{phrase(`${K}.a.note`)}</p>
    </section>
  );
}

// Sous chaque ajout : ce que chaque offre en comprend aujourd'hui (0105), lu comme la carte de l'application le dit.
function comprisDe(option: Ajout, c: Record<Offre, ContenuDuJour>): string {
  const e = c.essentiel, x = c.complet;
  if (option === 'caisse' || option === 'etablissement') {
    const q = option === 'caisse' ? 'caisses' : 'etablissements';
    return e[q] === null || x[q] === null ? phrase(`${K}.a.compris.inconnu`) : phrase(`${K}.a.compris.${option}`, { e: entier(e[q]), c: entier(x[q]) });
  }
  if (option === 'salarie') return e.salaries === null || x.salaries === null ? phrase(`${K}.a.compris.inconnu`)
    : phrase(`${K}.a.compris.salarie`, { e: entier(e.salaries), c: entier(x.salaries) });
  const m = option === 'module_paie' ? 'paie' : 'compta';
  if (e[m] === null || x[m] === null) return phrase(`${K}.a.compris.inconnu`);
  return phrase(`${K}.a.compris.module_e${e[m]}c${x[m]}`);
}

// Ce qu'une ligne comprend, en mots : « 2 caisses comprises », « la paie comprise », « la paie achetée seule ».
const contenuEnMots = (q: QuoiContenu, n: number) => selon(n, `${K}.c.dit.${q}`);
// La case d'un contenu : le nombre, ou pour un module « comprise » / « achetée seule », ou « — » quand rien ne vaut.
const caseDeContenu = (q: QuoiContenu, n: number | null) => (n === null ? '—' : estModule(q) ? dire(`${K}.c.module_${n === 1 ? 'compris' : 'seul'}`) : entier(n));

// ── Ce que chaque offre comprend (0105) : la grille datée que l'application dit sur ses cartes, que la facture compte
// avant d'ajouter, et que la porte des modules lit ; un changement se prépare avec le préavis d'un prix ──────────────
function CeQueComprend({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  const c = d.contenu;
  return (
    <section className="c-carte c-rg c-rg-contenu-carte" aria-labelledby="rg-contenu">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-contenu">{titre(`${K}.c.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.c.sous`)}</p>
        </div>
        {peut ? <Bouton icone="plus" onClick={() => geste({ sorte: 'contenu' })}>{titre(`${K}.c.preparer`)}</Bouton> : null}
      </div>
      <div className="c-defile">
        <table className="c-table c-rg-grille c-rg-contenu">
          <thead><tr>
            <th scope="col">{titre(`${K}.c.col.quoi`)}</th>
            {OFFRES_PRIX.map((o) => <th key={o} scope="col" className="c-droite">{titre(`${K}.p.offre.${o}`)}</th>)}
          </tr></thead>
          <tbody>
            {QUOI_CONTENU.map((q) => (
              <tr key={q} data-quoi={q}>
                <td><b>{titre(`${K}.c.quoi.${q}`)}</b><span className="c-sous c-bloc">{phrase(`${K}.c.aide.${q}`)}</span></td>
                {OFFRES_PRIX.map((o) => (
                  <td key={o} className="c-droite" data-libelle={titre(`${K}.p.offre.${o}`)} data-offre={o}>
                    {/* Un nombre, en chiffres ; un module, comprise ou achetée seule, en pastille. */}
                    {estModule(q) && c.duJour[o][q] !== null ? <Puce ton={c.duJour[o][q] === 1 ? 'actif' : 'hors'}>{caseDeContenu(q, c.duJour[o][q])}</Puce>
                      : <span className="c-rg-montant" data-donnee>{caseDeContenu(q, c.duJour[o][q])}</span>}
                    {c.aVenir.filter((v) => v.offre === o && v.quoi === q).map((v) => (
                      <span key={v.aPartirDu} className="c-rg-avenir c-rg-avenir-droite">
                        {dire(`${K}.c.a_venir`, { valeur: caseDeContenu(q, v.nombre), jour: jour(v.aPartirDu) })}
                      </span>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.aVenir.length ? (
        <ul className="c-rg-venir-liste">
          {c.aVenir.map((v) => (
            <li key={`${v.offre}-${v.quoi}-${v.aPartirDu}`} className="c-rg-venir" data-offre={v.offre} data-quoi={v.quoi}>
              <div className="c-rg-venir-texte">
                <b>{titre(`${K}.c.venir.titre`, { offre: dire(`${K}.p.offre.${v.offre}`), jour: jour(v.aPartirDu), dit: contenuEnMots(v.quoi, v.nombre) })}</b>
                <span className="c-sous c-bloc">
                  {v.par && v.le ? titre(`${K}.p.venir.par`, { nom: v.par, quand: quand(v.le, d.aujourdhui) }) : phrase(`${K}.p.venir.migration`)}
                  {v.motif ? <> <span data-donnee>« {v.motif} »</span></> : null}
                </span>
              </div>
              {peut ? <Bouton petit onClick={() => geste({ sorte: 'retirer_contenu', v })}>{titre(`${K}.p.venir.retirer`)}</Bouton> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="c-sous">{phrase(`${K}.c.note`)}</p>
    </section>
  );
}

// ── Les remises (0106 ; docs/abonnement.md C17) : celle du groupe et celle du cabinet, jamais additionnées ; datées comme
// un prix, avec son préavis ; chacune avec qui l'a posée et pourquoi ─────────────────────────────────────────────────
// Une remise en mots : « 20 % », et pour le cabinet « 20 % pendant 12 mois ».
const remiseEnMots = (code: CodeRemise, taux: number, mois: number | null) => (code === 'cabinet' && mois !== null
  ? dire(`${K}.rm.taux_mois`, { taux, mois: selon(mois, `${K}.rm.mois`) }) : dire(`${K}.rm.taux`, { taux }));
function LesRemises({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  const r = d.remises;
  return (
    <section className="c-carte c-rg c-rg-remises-carte" aria-labelledby="rg-remises">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-remises">{titre(`${K}.rm.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.rm.sous`)}</p>
        </div>
        {peut ? <Bouton icone="plus" onClick={() => geste({ sorte: 'remise' })}>{titre(`${K}.rm.preparer`)}</Bouton> : null}
      </div>
      <div className="c-defile">
        <table className="c-table c-rg-grille c-rg-remises">
          <thead><tr>
            <th scope="col">{titre(`${K}.rm.col.remise`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.rm.col.taux`)}</th>
            <th scope="col" className="c-droite">{titre(`${K}.rm.col.duree`)}</th>
          </tr></thead>
          <tbody>
            {CODES_REMISE.map((code) => {
              const x = r.duJour[code];
              return (
                <tr key={code} data-code={code}>
                  <td>
                    <b>{titre(`${K}.rm.nom.${code}`)}</b>
                    <span className="c-sous c-bloc">{code === 'groupe' ? phrase(`${K}.rm.aide.groupe`, { n: selon(r.enGroupe, `${K}.rm.societes`), g: selon(r.groupes, `${K}.rm.groupes`) })
                      : phrase(`${K}.rm.aide.cabinet`)}</span>
                    {x ? <span className="c-sous c-bloc">{x.par && x.le ? titre(`${K}.r.par`, { nom: x.par, quand: quand(x.le, d.aujourdhui) }) : titre(`${K}.r.depart`)}{' '}
                      <span data-donnee>« {x.motif} »</span></span> : null}
                    {r.aVenir.filter((v) => v.code === code).map((v) => (
                      <span key={v.aPartirDu} className="c-rg-avenir">{dire(`${K}.c.a_venir`, { valeur: remiseEnMots(code, v.taux, v.mois), jour: jour(v.aPartirDu) })}</span>
                    ))}
                  </td>
                  <td className="c-droite c-rg-montant" data-libelle={titre(`${K}.rm.col.taux`)}><span data-donnee>{x ? dire(`${K}.rm.taux`, { taux: x.taux }) : '—'}</span></td>
                  <td className="c-droite" data-libelle={titre(`${K}.rm.col.duree`)}>{!x ? '—' : code === 'cabinet' && x.mois !== null ? selon(x.mois, `${K}.rm.mois`) : dire(`${K}.rm.toujours`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {r.aVenir.length ? (
        <ul className="c-rg-venir-liste">
          {r.aVenir.map((v) => (
            <li key={`${v.code}-${v.aPartirDu}`} className="c-rg-venir" data-code={v.code}>
              <div className="c-rg-venir-texte">
                <b>{titre(`${K}.rm.venir`, { nom: dire(`${K}.rm.nom.${v.code}`), dit: remiseEnMots(v.code, v.taux, v.mois), jour: jour(v.aPartirDu) })}</b>
                <span className="c-sous c-bloc">
                  {v.par && v.le ? titre(`${K}.p.venir.par`, { nom: v.par, quand: quand(v.le, d.aujourdhui) }) : phrase(`${K}.p.venir.migration`)}
                  {' '}<span data-donnee>« {v.motif} »</span>
                </span>
              </div>
              {peut ? <Bouton petit onClick={() => geste({ sorte: 'retirer_remise', v })}>{titre(`${K}.p.venir.retirer`)}</Bouton> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="c-sous">{phrase(`${K}.rm.note`)}</p>
    </section>
  );
}

// Les prix à venir d'une grille, chacun avec qui l'a préparé et pourquoi, et le geste qui le retire avant sa date.
function PrixAVenir({ lignes, aujourdhui, geste, peut }: { lignes: { quoi: QuoiPrix; v: AVenir }[]; aujourdhui: string; geste: (g: Geste) => void; peut: boolean }) {
  if (!lignes.length) return null;
  return (
    <ul className="c-rg-venir-liste">
      {lignes.map(({ quoi, v }) => (
        <li key={`${quoi}-${v.periodicite}-${v.aPartirDu}`} className="c-rg-venir" data-quoi={quoi} data-periodicite={v.periodicite}>
          <div className="c-rg-venir-texte">
            <b>{titre(`${K}.p.venir.titre`, { quoi: nomDe(quoi), periode: dire(`${K}.p.periode.${v.periodicite}`), prix: montant(v.ht), jour: jour(v.aPartirDu) })}</b>
            <span className="c-sous c-bloc">
              {v.par && v.le ? titre(`${K}.p.venir.par`, { nom: v.par, quand: quand(v.le, aujourdhui) }) : phrase(`${K}.p.venir.migration`)}
              {v.motif ? <> <span data-donnee>« {v.motif} »</span></> : null}
            </span>
          </div>
          {peut ? <Bouton petit onClick={() => geste({ sorte: 'retirer_prix', quoi, v })}>{titre(`${K}.p.venir.retirer`)}</Bouton> : null}
        </li>
      ))}
    </ul>
  );
}

// Une règle de l'abonnement dite en mots : « l'essai dure 30 jours… », « une relance part 15 jours avant l'échéance, 7 jours
// avant et la veille », « 7 jours de grâce… ». Aucune règle : elle le dit (jamais un nombre deviné).
const listeDesRelances = (j: number[]) => {
  const mots = j.map((n, i) => (n === 1 ? dire(`${K}.r.relance_veille${i === 0 ? '_premiere' : ''}`) : dire(`${K}.r.relance_${i === 0 ? 'premiere' : 'autre'}`, { n })));
  return mots.length > 1 ? `${mots.slice(0, -1).join(', ')} ${dire('console.ecran.et')} ${mots.at(-1)}` : mots[0] ?? '';
};
function regleEnMots(code: CodeRegle, jours: number[] | null): string {
  if (!jours?.length) return phrase(`${K}.r.inconnue`);
  if (code === 'essai') return phrase(`${K}.r.essai`, { n: jours[0] ?? 0 });
  if (code === 'grace') return `${maj(selon(jours[0] ?? 0, `${K}.r.grace`))}.`;
  return phrase(`${K}.r.relances`, { liste: listeDesRelances([...jours].sort((a, b) => b - a)) });
}
function UneRegle({ code, d, geste, peut }: { code: CodeRegle; d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  const r = d.regles[code];
  return (
    <li className="c-rg-regle-abo" data-code={code}>
      <p className="c-sous">
        {regleEnMots(code, r?.jours ?? null)}
        {r ? <span className="c-bloc">{r.par ? titre(`${K}.r.par`, { nom: r.par, quand: quand(r.le, d.aujourdhui) }) : titre(`${K}.r.depart`)}{' '}
          <span data-donnee>« {r.motif} »</span></span> : null}
      </p>
      {peut ? <Bouton petit onClick={() => geste({ sorte: 'regle', code })}>{titre(`${K}.r.changer.${code}`)}</Bouton> : null}
    </li>
  );
}

// Le préavis d'un nouveau prix (0103) : ce qu'il est, qui l'a posé, et le geste qui le change.
function LePreavis({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  const p = d.preavis;
  return (
    <div className="c-rg-preavis">
      <p className="c-sous">
        {/* Une phrase entière : sa majuscule et son point, comme `phrase`. */}
        {p ? `${maj(selon(p.jours, `${K}.p.preavis`))}.` : phrase(`${K}.p.preavis_aucun`)}
        {p ? <span className="c-bloc">{p.par ? titre(`${K}.p.preavis_par`, { nom: p.par, quand: quand(p.le, d.aujourdhui) }) : titre(`${K}.p.preavis_depuis`, { jour: jour(p.aPartirDu) })}{' '}
          <span data-donnee>« {p.motif} »</span></span> : null}
      </p>
      {peut ? <Bouton petit onClick={() => geste({ sorte: 'preavis' })}>{titre(`${K}.p.changer_preavis`)}</Bouton> : null}
    </div>
  );
}

// Nos factures : où elles naissent. Désignée, l'entreprise se nomme, avec qui l'a désignée ; tant qu'aucune facture n'y est
// préparée, elle se change encore. Sans elle, la carte dit ce qui ne se fait pas, et le geste qui le rend possible.
function NosFacturesCarte({ f, aujourdhui, geste, peut }: { f: NosFactures; aujourdhui: string; geste: (g: Geste) => void; peut: boolean }) {
  const e = f.editeur;
  const autre = f.possibles.some((p) => p.entreprise !== e?.entreprise);
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-factures">
      <div className="c-al-section-tete">
        <div>
          <h2 id="rg-factures">{titre(`${K}.nf.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.nf.sous`)}</p>
        </div>
        {peut && !e && autre ? <Bouton ton="principal" onClick={() => geste({ sorte: 'editeur' })}>{titre(`${K}.nf.designer`)}</Bouton> : null}
        {peut && e && e.factures === 0 && autre ? <Bouton petit onClick={() => geste({ sorte: 'editeur' })}>{titre(`${K}.nf.changer`)}</Bouton> : null}
      </div>
      {e ? (
        <div className="c-rg-actuel">
          <div className="c-rg-actuel-tete">
            <div>
              <b data-donnee>{e.raisonSociale}</b>{e.matricule ? <span className="c-sous" data-donnee> · {e.matricule}</span> : null}
              <span className="c-sous c-bloc">{phrase(`${K}.nf.designee`, { nom: e.posePar ?? '—', quand: quand(e.poseLe, aujourdhui) })}</span>
            </div>
            <Puce ton="actif">{selon(e.factures, `${K}.nf.preparees`)}</Puce>
          </div>
          <p className="c-sous">{phrase(`${K}.nf.offert`)}</p>
          {e.proprietaire ? null : <Alerte ton="info" icone="cadenas"><span>{phrase(`${K}.nf.pas_proprietaire`)}</span></Alerte>}
          {e.factures ? <p className="c-sous">{phrase(`${K}.nf.fixe`)}</p> : null}
        </div>
      ) : autre ? <Vide icone="info">{phrase(`${K}.nf.aucune`)}</Vide> : (
        // (1.82.0) « Crée l'entreprise SkanFact dans l'application » mène à l'application : sans ce lien, il fallait
        // deviner son adresse depuis la console.
        <Vide icone="info">{phrase(`${K}.nf.aucune_possible`)} <Lien href="/" petit fleche ailleurs>{titre(`${K}.nf.ouvrir_app`)}</Lien></Vide>
      )}
    </section>
  );
}

// ── Règles fiscales ─────────────────────────────────────────────────────────────────────────────────────────────────
function etatDeRegle(r: Regle, aujourdhui: string): { texte: string; ton: 'a_regarder' | 'actif' | 'hors' } {
  if (r.fin && r.fin < aujourdhui) return { texte: dire(`${K}.r.etat.finie`, { jour: jour(r.fin) }), ton: 'hors' };
  if (r.debut > aujourdhui) return { texte: dire(`${K}.r.etat.a_venir`, { jour: jour(r.debut) }), ton: 'hors' };
  const l = r.relectures[0];
  if (!l) return { texte: dire(`${K}.r.etat.a_relire`), ton: 'a_regarder' };
  if (l.avis === 'a_corriger') return { texte: dire(`${K}.r.etat.a_corriger`), ton: 'a_regarder' };
  return { texte: dire(`${K}.r.etat.relue`, { jour: jour(jourDe(l.le)) }), ton: 'actif' };
}
function Regles({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  return (
    <>
      <section className="c-carte c-rg" aria-labelledby="rg-registre">
        <div className="c-al-section-tete"><div>
          <h2 id="rg-registre">{titre(`${K}.r.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.r.sous`)}</p>
        </div></div>
        {d.registre.length ? (
          <ul className="c-rg-registre">
            {d.registre.map((r) => {
              const e = etatDeRegle(r, d.aujourdhui);
              const [derniere, ...avant] = r.relectures;
              return (
                <li key={r.id} className={r.aRelire ? 'c-rg-regle c-rg-regle-a-relire' : 'c-rg-regle'}>
                  <div className="c-rg-regle-tete">
                    <div><b {...(r.valeurLue.connue ? {} : { 'data-donnee': '' })}>{nomDeRegle(r)}</b> <code className="c-rg-code" data-donnee>{r.code}</code></div>
                    <Puce ton={e.ton}>{e.texte}</Puce>
                  </div>
                  <dl className="c-rg-chiffres">
                    <div><dt>{titre(`${K}.r.valeur`)}</dt><dd>{r.valeurLue.connue ? dire(`${K}.r.valeur.${r.code.replace('.', '_')}`, { valeur: montant(r.valeurLue.texte) }) : <span data-donnee>{r.valeurLue.texte}</span>}</dd></div>
                    <div><dt>{titre(`${K}.r.vigueur`)}</dt><dd>{r.fin ? dire(`${K}.r.du_au`, { du: jour(r.debut), au: jour(r.fin) }) : dire(`${K}.r.depuis_sans_fin`, { du: jour(r.debut) })}</dd></div>
                    <div><dt>{titre(`${K}.r.posee`)}</dt><dd>{dire(`${K}.r.posee_le`, { jour: jour(jourDe(r.poseeLe)) })}</dd></div>
                  </dl>
                  <p className="c-rg-source"><span className="c-champ-libelle">{titre(`${K}.r.source`)}</span> <span>« <span data-donnee>{r.source}</span> »</span></p>
                  <p className={derniere ? 'c-rg-relue' : 'c-rg-relue c-rg-pas-relue'}>
                    {derniere ? phrase(derniere.avis === 'juste' ? `${K}.r.relue_juste` : `${K}.r.relue_corriger`,
                      { jour: jour(jourDe(derniere.le)), qui: derniere.reluePar, par: derniere.par })
                      : phrase(`${K}.r.jamais_relue`)}
                    {derniere?.dit ? <span className="c-bloc">« <span data-donnee>{derniere.dit}</span> »</span> : null}
                  </p>
                  {avant.length ? (
                    <details className="c-rg-avant">
                      <summary>{selon(avant.length, `${K}.r.relectures_avant`)}</summary>
                      <ul>
                        {avant.map((l) => (
                          <li key={l.le}>{phrase(l.avis === 'juste' ? `${K}.r.relue_juste` : `${K}.r.relue_corriger`, { jour: jour(jourDe(l.le)), qui: l.reluePar, par: l.par })}
                            {l.dit ? <> « <span data-donnee>{l.dit}</span> »</> : null}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {peut ? <div className="c-rg-geste"><Bouton petit onClick={() => geste({ sorte: 'relire', regle: r })}>{titre(`${K}.r.relire`)}</Bouton></div> : null}
                </li>
              );
            })}
          </ul>
        ) : <Vide icone="info">{phrase(`${K}.r.vide`)}</Vide>}
      </section>
      <div className="c-rg-duo">
        <section className="c-carte c-rg" aria-labelledby="rg-hors">
          <div className="c-al-section-tete"><div>
            <h2 id="rg-hors">{titre(`${K}.r.hors.titre`)}</h2>
            <p className="c-carte-sous">{phrase(`${K}.r.hors.sous`)}</p>
          </div></div>
          <ul className="c-rg-liste">
            {['paie', 'tva', 'retenue', 'echeances'].map((h) => (
              <li key={h}><b>{titre(`${K}.r.hors.${h}`)}</b><span className="c-sous c-bloc">{phrase(`${K}.r.hors.${h}_ou`)}</span></li>
            ))}
          </ul>
        </section>
        <section className="c-carte c-rg" aria-labelledby="rg-lf">
          <div className="c-al-section-tete"><div>
            <h2 id="rg-lf">{titre(`${K}.r.lf.titre`)}</h2>
            <p className="c-carte-sous">{phrase(`${K}.r.lf.sous`)}</p>
          </div></div>
          <ol className="c-rg-etapes">
            {['lire', 'ecrire', 'relire', 'publier'].map((e) => (
              <li key={e}><b>{titre(`${K}.r.lf.${e}`)}</b><span className="c-sous c-bloc">{phrase(`${K}.r.lf.${e}_quoi`)}</span></li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

// ── Formats officiels ───────────────────────────────────────────────────────────────────────────────────────────────
// Le registre que le code déclare (serveur/console/formats.ts) et ce que la plateforme en a fait : des comptes, toutes
// entreprises ensemble. Ce qui demande un geste chez un client (une pièce retenue ou refusée par la TTN) se dit en
// couleur ; un service dont ce serveur n'a pas l'adresse le dit, ses pièces attendent.
const TON_FORMAT: Record<EtatFormat, 'actif' | 'a_regarder' | 'hors'> = {
  en_place: 'actif', calcule: 'actif', simule: 'a_regarder', pas_encore: 'hors', non_homologue: 'hors',
};
// Ce que le format a fait, en phrases courtes ; seulement ce qui existe (« 3 acceptées », jamais « 0 refusée »).
function chiffresDuFormat(f: Format, aujourdhui: string): { texte: string; alerte?: boolean }[] {
  const c = f.chiffres ?? {};
  const n = (k: string) => (typeof c[k] === 'number' ? c[k] as number : 0);
  const compte = (k: string, cle: string) => selon(n(k), `${K}.f.${cle}`, { n: entier(n(k)) });
  // Le dernier, accordé à ce qu'il date : un fichier écrit, une pièce signée, une pièce acceptée.
  const dernier = (k: string) => (typeof c[k] === 'string' ? [{ texte: dire(`${K}.f.${f.code}.dernier`, { quand: quand(c[k] as string, aujourdhui) }) }] : []);
  if (f.code === 'teif') {
    return [{ texte: [compte('fichiers', 'teif.fichiers'), n('entreprises') ? compte('entreprises', 'teif.chez') : ''].filter(Boolean).join(' ') },
      ...(n('autres') ? [{ texte: compte('autres', 'teif.autres') }] : []), ...dernier('dernier'), { texte: compte('soumises', 'teif.soumises') }];
  }
  if (f.code === 'signature') {
    return [{ texte: compte('signees', 'signature.signees') }, ...(n('aSigner') ? [{ texte: compte('aSigner', 'signature.a_signer') }] : []), ...dernier('dernier')];
  }
  if (f.code === 'ttn') {
    const lignes = ([['acceptees', 'acceptees', false], ['deposees', 'deposees', false], ['enRoute', 'en_route', false], ['sansEnvoi', 'sans_envoi', false],
      ['retenues', 'retenues', true], ['refusees', 'refusees', true]] as const)
      .filter(([k]) => n(k) > 0).map(([k, cle, alerte]) => ({ texte: compte(k, `ttn.${cle}`), alerte }));
    return lignes.length ? [...lignes, ...dernier('derniereAcceptee')] : [{ texte: dire(`${K}.f.ttn.rien`) }];
  }
  return [];
}
function Formats({ d }: { d: Donnees }) {
  return (
    <section className="c-carte c-rg c-rg-formats-carte" aria-labelledby="rg-formats">
      <div className="c-al-section-tete"><div>
        <h2 id="rg-formats">{titre(`${K}.f.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${K}.f.sous`)}</p>
      </div></div>
      <div className="c-defile">
        <table className="c-table c-rg-formats">
          <thead><tr>
            <th scope="col">{titre(`${K}.f.col.format`)}</th><th scope="col">{titre(`${K}.f.col.version`)}</th>
            <th scope="col">{titre(`${K}.f.col.fait`)}</th><th scope="col">{titre(`${K}.f.col.contre`)}</th><th scope="col">{titre(`${K}.f.col.etat`)}</th>
          </tr></thead>
          <tbody>
            {d.formats.map((f) => {
              const v = { version: f.version ?? '—' };
              return (
                <tr key={f.code} className={f.alerte ? 'c-rg-format-alerte' : undefined}>
                  <td><b>{titre(`${K}.f.${f.code}.nom`)}</b><span className="c-sous c-bloc">{dire(`${K}.f.${f.code}.pour`)}</span></td>
                  <td className="c-rg-nowrap" data-libelle={titre(`${K}.f.col.version`)}>{f.code === 'teif' ? dire(`${K}.f.teif.version`, v) : f.version ? <span data-donnee>{f.version}</span> : '—'}</td>
                  <td data-libelle={titre(`${K}.f.col.fait`)}>{phrase(`${K}.f.${f.code}.fait`, v)}</td>
                  <td data-libelle={titre(`${K}.f.col.contre`)}>{phrase(`${K}.f.${f.code}.contre`, v)}</td>
                  <td data-libelle={titre(`${K}.f.col.etat`)}>
                    <Puce ton={TON_FORMAT[f.etat]}>{dire(`${K}.f.etat.${f.etat}`)}</Puce>
                    {chiffresDuFormat(f, d.aujourdhui).map((c) => (
                      <span key={c.texte} className={c.alerte ? 'c-sous c-bloc c-rg-format-geste' : 'c-sous c-bloc'}>{maj(c.texte)}</span>
                    ))}
                    {f.branche !== null ? (
                      <span className={f.branche ? 'c-sous c-bloc' : 'c-sous c-bloc c-rg-format-attend'}>
                        {phrase(`${K}.f.branche.${f.code === 'ttn' ? 'ttn' : 'digigo'}_${f.branche ? 'oui' : 'non'}`)}
                      </span>
                    ) : null}
                    {f.aVerifier ? <span className="c-sous c-bloc c-rg-verifier">{dire(`${K}.f.a_verifier`, { quoi: dire(`${K}.f.${f.code}.verifier`) })}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="c-sous">{phrase(`${K}.f.note`)}</p>
    </section>
  );
}

// ── Messages aux clients ────────────────────────────────────────────────────────────────────────────────────────────
// Ce que voient les clients : la même forme que le bandeau de leur application (web/public/plateforme/message.js).
function Apercu({ sorte, texte }: { sorte: Message['sorte']; texte: string }) {
  return (
    <div className={`c-rg-apercu c-rg-apercu-${sorte}`} role="note">
      <span className="c-rg-apercu-sorte">{titre(`${K}.m.sorte.${sorte}`)}</span>
      <span className="c-rg-apercu-texte" data-donnee>{texte || '…'}</span>
      <span className="c-rg-apercu-fermer" aria-hidden="true">{titre(`${K}.m.plus_tard`)}</span>
    </div>
  );
}
function Messages({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  const m = d.message;
  const futur = m ? m.du > d.aujourdhui : false;
  return (
    <>
      <section className="c-carte c-rg" aria-labelledby="rg-message">
        <div className="c-al-section-tete">
          <div>
            <h2 id="rg-message">{titre(`${K}.m.titre`)}</h2>
            <p className="c-carte-sous">{phrase(`${K}.m.sous`)}</p>
          </div>
          {peut ? <Bouton ton={m ? 'secondaire' : 'principal'} icone="plus" onClick={() => geste({ sorte: 'ecrire' })}>{titre(`${K}.m.ecrire`)}</Bouton> : null}
        </div>
        {m ? (
          <div className="c-rg-actuel">
            <div className="c-rg-actuel-tete">
              <div>
                <Puce ton={futur ? 'semaine' : 'actif'}>{titre(`${K}.m.sorte.${m.sorte}`)}</Puce>{' '}
                <span className="c-sous">{phrase(futur ? `${K}.m.paraitra` : `${K}.m.affiche`, { du: jour(m.du), au: jour(m.au) })}</span>
                <span className="c-sous c-bloc c-rg-pour">{maj(dire(`${K}.m.pour`, { qui: pourQui(m.cible) }))}</span>
                <DitDiffusion m={m} />
              </div>
              {peut ? <Bouton petit onClick={() => geste({ sorte: 'retirer', message: m })}>{titre(`${K}.m.retirer`)}</Bouton> : null}
            </div>
            <span className="c-champ-libelle">{titre(`${K}.m.ce_que_voient`)}</span>
            <Apercu sorte={m.sorte} texte={m.texte} />
            <p className="c-sous">{titre(`${K}.m.ecrit_par`, { nom: m.par, quand: quand(m.le, d.aujourdhui) })} <span data-donnee>« {m.motif} »</span></p>
          </div>
        ) : <Vide icone="info">{phrase(`${K}.m.aucun`)}</Vide>}
      </section>
      <section className="c-carte c-rg" aria-labelledby="rg-passes">
        <div className="c-al-section-tete"><div>
          <h2 id="rg-passes">{titre(`${K}.m.passes`)}</h2>
          <p className="c-carte-sous">{phrase(`${K}.m.passes_sous`)}</p>
        </div></div>
        {d.passes.length ? (
          <div className="c-defile">
            <table className="c-table">
              <thead><tr>
                <th scope="col">{titre(`${K}.m.col.sorte`)}</th><th scope="col">{titre(`${K}.m.col.texte`)}</th>
                <th scope="col">{titre(`${K}.m.col.quand`)}</th><th scope="col">{titre(`${K}.m.col.fin`)}</th>
              </tr></thead>
              <tbody>
                {d.passes.map((p) => (
                  <tr key={p.id}>
                    <td><Puce ton="hors">{titre(`${K}.m.sorte.${p.sorte}`)}</Puce></td>
                    <td data-libelle={titre(`${K}.m.col.texte`)}><span data-donnee>{p.texte}</span>
                      <span className="c-sous c-bloc c-rg-pour">{maj(dire(`${K}.m.pour`, { qui: pourQui(p.cible) }))}</span><DitDiffusion m={p} /></td>
                    <td className="c-rg-nowrap" data-libelle={titre(`${K}.m.col.quand`)}>{dire(`${K}.m.du_au`, { du: jour(p.du), au: jour(p.au) })}
                      <span className="c-sous c-bloc">{dire(`${K}.m.par`, { nom: p.par })}</span></td>
                    <td data-libelle={titre(`${K}.m.col.fin`)}>
                      {p.remplace ? maj(dire(`${K}.m.fin.remplace`, { jour: jour(jourDe(p.retireLe ?? p.le)) }))
                        : p.retireLe ? <>{maj(dire(`${K}.m.fin.retire`, { jour: jour(jourDe(p.retireLe)), nom: p.retirePar ?? '—' }))}{p.retireMotif ? <span className="c-sous c-bloc" data-donnee>« {p.retireMotif} »</span> : null}</>
                          : maj(dire(`${K}.m.fin.fini`, { jour: jour(p.au) }))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vide icone="info">{phrase(d.message ? `${K}.m.passes_vide_premier` : `${K}.m.passes_vide`)}</Vide>}
      </section>
    </>
  );
}

// ── Les nouveautés qu'on allume (0120, C43) : d'abord pour des entreprises volontaires, puis pour tous ─────────────────
// Le nombre de l'onglet : les nouveautés allumées pour quelqu'un (des volontaires, ou tout le monde).
const allumees = (d: Donnees) => d.nouveautes.filter((n) => n.ouverte || n.allumees.length).length;
function Nouveautes({ d, geste, peut }: { d: Donnees; geste: (g: Geste) => void; peut: boolean }) {
  return (
    <section className="c-carte c-rg" aria-labelledby="rg-nouveautes">
      <div className="c-al-section-tete"><div>
        <h2 id="rg-nouveautes">{titre(`${K}.n.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${K}.n.sous`)}</p>
      </div></div>
      {d.nouveautes.length ? d.nouveautes.map((n) => (
        <div key={n.code} className="c-rg-actuel c-rg-nv" data-nouveaute={n.code}>
          <div className="c-rg-actuel-tete">
            <div>
              <h3 className="c-rg-nv-nom" data-donnee>{n.nom}</h3>{' '}
              <Puce ton={n.ouverte ? 'actif' : n.allumees.length ? 'semaine' : 'hors'}>
                {n.ouverte ? titre(`${K}.n.pour_tous`) : n.allumees.length ? selon(n.allumees.length, `${K}.n.volontaires`, { n: entier(n.allumees.length) }) : titre(`${K}.n.personne`)}
              </Puce>
            </div>
            {peut ? (
              <div className="c-rg-nv-gestes">
                {n.ouverte ? <Bouton petit onClick={() => geste({ sorte: 'refermer', n })}>{titre(`${K}.n.refermer`)}</Bouton> : (
                  <>
                    <Bouton petit icone="plus" onClick={() => geste({ sorte: 'allumer', n })}>{titre(`${K}.n.allumer`)}</Bouton>
                    <Bouton petit ton="danger" onClick={() => geste({ sorte: 'ouvrir', n })}>{titre(`${K}.n.ouvrir`)}</Bouton>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <p className="c-sous" data-donnee>{n.quoi}</p>
          {n.ouverte ? (
            <p className="c-sous">{maj(dire(`${K}.n.ouverte_par`, { jour: jour(jourDe(n.ouverte.le)), nom: n.ouverte.par }))} <span data-donnee>« {n.ouverte.motif} »</span></p>
          ) : null}
          {n.allumees.length ? (
            <div className="c-defile">
              <table className="c-table c-rg-nv-table">
                <caption className="c-cache">{titre(`${K}.n.qui`, { nom: n.nom })}</caption>
                <thead><tr>
                  <th scope="col">{titre(`${K}.n.col.entreprise`)}</th><th scope="col">{titre(`${K}.n.col.depuis`)}</th>
                  <th scope="col">{titre(`${K}.n.col.motif`)}</th>{peut ? <th scope="col"><span className="c-cache">{titre(`${K}.n.col.geste`)}</span></th> : null}
                </tr></thead>
                <tbody>
                  {n.allumees.map((a) => (
                    <tr key={a.entreprise}>
                      <td><span data-donnee>{a.nom}</span>{a.numero ? <span className="c-sous c-bloc" data-donnee>{a.numero}</span> : null}</td>
                      <td className="c-rg-nowrap" data-libelle={titre(`${K}.n.col.depuis`)}>{jour(jourDe(a.le))}<span className="c-sous c-bloc">{dire(`${K}.n.par`, { nom: a.par })}</span></td>
                      <td data-libelle={titre(`${K}.n.col.motif`)}><span data-donnee>« {a.motif} »</span></td>
                      {peut ? <td><Bouton petit onClick={() => geste({ sorte: 'eteindre', n, a })} etiquette={titre(`${K}.n.eteindre_pour`, { nom: a.nom })}>{titre(`${K}.n.eteindre`)}</Bouton></td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )) : <Vide icone="info">{phrase(`${K}.n.aucune`)}</Vide>}
    </section>
  );
}

// Ouvrir ou refermer une nouveauté : ce qu'il advient des volontaires d'avant se dit selon leur nombre (aucune, une, plusieurs).
const volontaires = (g: Geste, p: string) => {
  if (!((g.sorte === 'ouvrir' && p === 'p3') || (g.sorte === 'refermer' && p === 'p2'))) return '';
  const n = g.n.allumees.length;
  return n === 0 ? '_0' : n === 1 ? '_1' : '_n';
};

// ── Les gestes : chacun dit ce qui va se passer, demande son motif, et entre au journal ─────────────────────────────
function FenetreGeste({ g, d, fermer, fait }: { g: Exclude<Geste, { sorte: 'prix' } | { sorte: 'regle' } | { sorte: 'contenu' } | { sorte: 'remise' }>; d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [reluePar, setReluePar] = useState('');
  const [avis, setAvis] = useState<'juste' | 'a_corriger'>('juste');
  const [dit, setDit] = useState('');
  const [sorte, setSorte] = useState<Message['sorte']>('nouveaute');
  const [texte, setTexte] = useState('');
  const [du, setDu] = useState(d.aujourdhui);
  const [au, setAu] = useState(plusJours(d.aujourdhui, 7));
  const [cible, setCible] = useState<Public | 'tous'>('tous');
  const [jours, setJours] = useState(d.preavis ? String(d.preavis.jours) : '');
  const [numero, setNumero] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const choisissables = d.factures.possibles.filter((p) => p.entreprise !== d.factures.editeur?.entreprise);
  const [entreprise, setEntreprise] = useState(choisissables[0]?.entreprise ?? '');
  const refuser = (champ: string, cle: string) => { setRefus(phrase(cle)); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = () => {
    if (g.sorte === 'relire' && reluePar.trim().length < 3) { refuser('qui', `${K}.g.relire.qui_court`); return; }
    if (g.sorte === 'ecrire') {
      const t = texte.trim();
      if (t.length < 10 || t.length > 240) { refuser('texte', `${K}.g.ecrire.texte_longueur`); return; }
      if (/[<>]/.test(t)) { refuser('texte', `${K}.g.ecrire.sans_balise`); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || du < d.aujourdhui) { refuser('du', `${K}.g.ecrire.du_passe`); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(au) || au < du) { refuser('au', `${K}.g.ecrire.au_avant`); return; }
      if (au > plusJours(du, 30)) { refuser('au', `${K}.g.ecrire.trente_jours`); return; }
    }
    if (g.sorte === 'preavis' && (!/^\d{1,3}$/.test(jours.trim()) || Number(jours) > 365)) { refuser('jours', `${K}.g.preavis.jours_illisible`); return; }
    // Le numéro de client, tel qu'on se le dit (« E-0012 », « e12 ») ; la base retrouve l'entreprise.
    if (g.sorte === 'allumer' && !/^E-?\d{1,9}$/i.test(numero.trim())) { refuser('numero', `${K}.g.allumer.numero_illisible`); return; }
    if (motif.trim().length < 3) { refuser('motif', 'console.ecran.geste.motif_court'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = g.sorte === 'relire' ? await api('POST', `/console/reglages/regles/${g.regle.id}/relire`, { reluePar: reluePar.trim(), avis, dit: dit.trim() || null, motif: motif.trim() })
          : g.sorte === 'ecrire' ? await api('POST', '/console/reglages/messages', { sorte, texte: texte.trim(), du, au, motif: motif.trim(), cible })
            : g.sorte === 'editeur' ? await api('POST', '/console/reglages/factures/editeur', { entreprise, motif: motif.trim() })
              : g.sorte === 'retirer_prix' ? await api('POST', '/console/reglages/prix/retirer', { quoi: g.quoi, periodicite: g.v.periodicite, aPartirDu: g.v.aPartirDu, motif: motif.trim() })
                : g.sorte === 'retirer_contenu' ? await api('POST', '/console/reglages/contenu/retirer', { offre: g.v.offre, quoi: g.v.quoi, aPartirDu: g.v.aPartirDu, motif: motif.trim() })
                : g.sorte === 'retirer_remise' ? await api('POST', '/console/reglages/remise/retirer', { code: g.v.code, aPartirDu: g.v.aPartirDu, motif: motif.trim() })
                : g.sorte === 'preavis' ? await api('POST', '/console/reglages/preavis', { jours: Number(jours.trim()), motif: motif.trim() })
                : g.sorte === 'allumer' ? await api('POST', `/console/reglages/nouveautes/${g.n.code}/allumer`, { numero: numero.trim(), motif: motif.trim() })
                : g.sorte === 'eteindre' ? await api('POST', `/console/reglages/nouveautes/${g.n.code}/eteindre`, { entreprise: g.a.entreprise, motif: motif.trim() })
                : g.sorte === 'ouvrir' || g.sorte === 'refermer' ? await api('POST', `/console/reglages/nouveautes/${g.n.code}/${g.sorte}`, { motif: motif.trim() })
                  : await api('POST', `/console/reglages/messages/${g.message.id}/retirer`, { motif: motif.trim() });
        if (!res) return;
        if (res.statut === 200 || res.statut === 201) { toast(phrase(`${K}.g.${g.sorte}.fait`)); fait(); return; }
        setRefus(refusDe(res));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const choisie = choisissables.find((p) => p.entreprise === entreprise);
  const valeurs = g.sorte === 'relire' ? { regle: nomDeRegle(g.regle) } : g.sorte === 'retirer' ? { du: jour(g.message.du), au: jour(g.message.au) }
    : g.sorte === 'editeur' ? { nom: choisie?.raisonSociale ?? '—' } : g.sorte === 'retirer_prix' || g.sorte === 'retirer_contenu' || g.sorte === 'retirer_remise' ? { jour: jour(g.v.aPartirDu) }
      : g.sorte === 'preavis' ? { n: d.preavis?.jours ?? '—' }
        : g.sorte === 'eteindre' ? { nom: g.n.nom, entreprise: g.a.nom } : g.sorte === 'allumer' || g.sorte === 'ouvrir' || g.sorte === 'refermer' ? { nom: g.n.nom, n: entier(g.n.allumees.length) } : {};
  const sous = g.sorte === 'relire' ? nomEtCode(g.regle) : g.sorte === 'retirer' ? g.message.texte
    : g.sorte === 'retirer_prix' ? titre(`${K}.p.venir.titre`, { quoi: nomDe(g.quoi), periode: dire(`${K}.p.periode.${g.v.periodicite}`), prix: montant(g.v.ht), jour: jour(g.v.aPartirDu) })
      : g.sorte === 'retirer_contenu' ? titre(`${K}.c.venir.titre`, { offre: dire(`${K}.p.offre.${g.v.offre}`), jour: jour(g.v.aPartirDu), dit: contenuEnMots(g.v.quoi, g.v.nombre) })
        : g.sorte === 'retirer_remise' ? titre(`${K}.rm.venir`, { nom: dire(`${K}.rm.nom.${g.v.code}`), dit: remiseEnMots(g.v.code, g.v.taux, g.v.mois), jour: jour(g.v.aPartirDu) })
          : g.sorte === 'eteindre' ? `${g.n.nom} · ${g.a.nom}` : g.sorte === 'allumer' || g.sorte === 'ouvrir' || g.sorte === 'refermer' ? g.n.nom
            : undefined;
  const remplace = g.sorte === 'ecrire' && d.message;
  return (
    <Dialogue titre={titre(`${K}.g.${g.sorte}.titre`, valeurs)} sous={sous}
      sousDonnee={g.sorte === 'retirer' || (g.sorte === 'relire' && !g.regle.valeurLue.connue) || g.sorte === 'allumer' || g.sorte === 'eteindre' || g.sorte === 'ouvrir' || g.sorte === 'refermer'}
      fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton={g.sorte === 'ouvrir' ? 'danger' : 'principal'} occupe={occupe} onClick={envoyer}>{titre(`${K}.g.${g.sorte}.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          {g.sorte === 'ecrire'
            ? [remplace ? 'p1_remplace' : 'p1', 'p2', 'p3', 'p4'].map((p) => <li key={p}>{phrase(`${K}.g.ecrire.${p}`)}</li>)
            : ['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${K}.g.${g.sorte}.${p}${volontaires(g, p)}`, valeurs)}</li>)}
        </ul>
      </div>
      {g.sorte === 'relire' ? (
        <>
          <Champ libelle={titre(`${K}.g.relire.qui`)} aide={phrase(`${K}.g.relire.qui_aide`)} valeur={reluePar} changer={setReluePar} premier {...fauteDe('qui')} />
          <Choix libelle={titre(`${K}.g.relire.avis`)} valeur={avis} changer={(v) => setAvis(v === 'a_corriger' ? 'a_corriger' : 'juste')}
            options={[{ valeur: 'juste', texte: titre(`${K}.g.relire.avis_juste`) }, { valeur: 'a_corriger', texte: titre(`${K}.g.relire.avis_corriger`) }]} />
          <Zone libelle={titre(`${K}.g.relire.dit`)} aide={phrase(`${K}.g.relire.dit_aide`)} valeur={dit} changer={setDit} max={1000} />
        </>
      ) : null}
      {g.sorte === 'preavis' ? (
        <Champ libelle={titre(`${K}.g.preavis.jours`)} aide={phrase(`${K}.g.preavis.jours_aide`, valeurs)} type="number" inputMode="numeric" min={0} max={365}
          valeur={jours} changer={setJours} premier {...fauteDe('jours')} />
      ) : null}
      {g.sorte === 'allumer' ? (
        <Champ libelle={titre(`${K}.g.allumer.numero`)} aide={phrase(`${K}.g.allumer.numero_aide`)} valeur={numero} changer={setNumero} premier {...fauteDe('numero')} />
      ) : null}
      {g.sorte === 'editeur' ? (
        <Choix libelle={titre(`${K}.g.editeur.laquelle`)} aide={phrase(`${K}.g.editeur.laquelle_aide`)} valeur={entreprise} changer={setEntreprise}
          options={choisissables.map((p) => ({ valeur: p.entreprise, texte: p.matricule ? `${p.raisonSociale} · ${p.matricule}` : p.raisonSociale, donnee: true }))} />
      ) : null}
      {g.sorte === 'ecrire' ? (
        <>
          <Choix libelle={titre(`${K}.g.ecrire.sorte`)} valeur={sorte} changer={(v) => setSorte(v === 'maintenance' ? 'maintenance' : 'nouveaute')}
            options={[{ valeur: 'nouveaute', texte: titre(`${K}.m.sorte.nouveaute`) }, { valeur: 'maintenance', texte: titre(`${K}.m.sorte.maintenance`) }]} />
          {/* À qui (0139, C63) : chaque public dit combien d'entreprises il atteint aujourd'hui, avant le geste. */}
          <Choix libelle={titre(`${K}.g.ecrire.qui`)} aide={maj(`${selon(d.portee[cible], `${K}.g.ecrire.qui_aide`)}.`)} valeur={cible}
            changer={(v) => setCible((['tous', ...PUBLICS] as const).find((x) => x === v) ?? 'tous')}
            options={(['tous', ...PUBLICS] as const).map((x) => ({ valeur: x, texte: titre(`${K}.g.ecrire.qui_choix`, { qui: dire(`${K}.m.public.${x}`), n: entier(d.portee[x]) }) }))} />
          <Zone libelle={titre(`${K}.g.ecrire.texte`)} aide={phrase(`${K}.g.ecrire.texte_aide`, { n: entier(texte.trim().length) })} valeur={texte} changer={setTexte} max={240} premier {...fauteDe('texte')} />
          <div className="c-rg-dates">
            <Champ libelle={titre(`${K}.g.ecrire.du`)} type="date" valeur={du} changer={setDu} {...fauteDe('du')} />
            <Champ libelle={titre(`${K}.g.ecrire.au`)} type="date" valeur={au} changer={setAu} {...fauteDe('au')} />
          </div>
          <span className="c-champ-libelle">{titre(`${K}.m.ce_que_verront`)}</span>
          <Apercu sorte={sorte} texte={texte.trim()} />
        </>
      ) : null}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.${g.sorte}.motif_aide`, valeurs)} valeur={motif} changer={setMotif} {...fauteDe('motif')} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Préparer un nouveau prix (0103) : ce qui change, le montant, la date ; l'aperçu du serveur dit le prix d'aujourd'hui,
// l'écart et qui l'a aujourd'hui, avant le geste ─────────────────────────────────────────────────────────────────────
type ApercuPrix = { avant: string | null; apres: string; ecart: { sens: 'hausse' | 'baisse'; dixiemes: number } | null; plusTot: string | null;
  abonnes: number | null; dejaAVenir: string | null };
const CHOIX_PRIX = [...OFFRES_PRIX, ...AJOUTS_PRIX].flatMap((q) => (['annuel', 'mensuel'] as const).map((p) => ({ quoi: q as QuoiPrix, periodicite: p })));
function FenetrePrix({ d, fermer, fait }: { d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const plusTot = d.preavis ? plusJours(d.aujourdhui, d.preavis.jours) : d.aujourdhui;
  const [choix, setChoix] = useState(0);
  const [tape, setTape] = useState('');
  const [date, setDate] = useState(plusTot);
  const [motif, setMotif] = useState('');
  const [apercu, setApercu] = useState<ApercuPrix | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const tour = useRef(0);
  const { quoi, periodicite } = CHOIX_PRIX[choix] ?? { quoi: 'essentiel' as QuoiPrix, periodicite: 'annuel' as Periodicite };
  const ligne = quoi === 'essentiel' || quoi === 'complet' ? d.grille.find((l) => l.offre === quoi) : d.ajouts.find((l) => l.option === quoi);
  const aujourdhui = ligne?.[periodicite]?.ht ?? null;
  const dateLisible = /^\d{4}-\d{2}-\d{2}$/.test(date);
  useEffect(() => {
    const t = ++tour.current;
    if (!tape.trim() || !dateLisible) { setApercu(null); return undefined; }
    const minuteur = setTimeout(() => {
      void (async () => {
        try {
          const r = await api<ApercuPrix>('POST', '/console/reglages/prix', { quoi, periodicite, montant: tape, aPartirDu: date, motif: '', apercu: true });
          if (!r || t !== tour.current) return;
          if (r.statut === 200) { setApercu(r.corps); setRefus(null); } else { setApercu(null); setRefus(refusDe(r)); }
        } catch (x) { if (t === tour.current) setRefus(panneDe(x)); }
      })();
    }, 300);
    return () => clearTimeout(minuteur);
  }, [choix, tape, date]);
  const refuser = (champ: string, cle: string, valeurs = {}) => { setRefus(phrase(cle, valeurs)); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const faire = () => {
    if (!tape.trim() || !apercu) { refuser('montant', `${K}.g.prix.montant_illisible`); return; }
    if (!dateLisible || date < plusTot) { refuser('date', `${K}.g.prix.trop_tot`, { jour: jour(plusTot) }); return; }
    if (motif.trim().length < 3) { refuser('motif', 'console.ecran.geste.motif_court'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/reglages/prix', { quoi, periodicite, montant: tape, aPartirDu: date, motif: motif.trim() });
        if (!r) return;
        if (r.statut === 201) { toast(phrase(`${K}.g.prix.fait`)); fait(); return; }
        setRefus(refusDe(r));
        if (typeof r.corps.champ === 'string') setFaute((f) => ({ champ: r.corps.champ as string, n: (f?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const pourcent = (dixiemes: number) => `${Math.floor(dixiemes / 10)},${dixiemes % 10}`;
  // Un écart de moitié ou plus, dans un sens ou dans l'autre, est presque toujours une faute de période (le prix à l'année
  // tapé pour le mois) : il se dit avant le geste, en couleur, à la place de l'écart.
  const fort = (apercu?.ecart?.dixiemes ?? 0) >= 500;
  return (
    <Dialogue titre={titre(`${K}.g.prix.titre`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} desactive={!apercu || !!apercu.dejaAVenir} onClick={faire}>{titre(`${K}.g.prix.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${K}.g.prix.${p}`, { jour: dateLisible ? jour(date) : '…' })}</li>)}</ul>
      </div>
      <Choix libelle={titre(`${K}.g.prix.quoi`)} valeur={String(choix)} changer={(v) => setChoix(Number(v))}
        options={CHOIX_PRIX.map((c, i) => ({ valeur: String(i), texte: `${maj(nomDe(c.quoi))}, ${dire(`${K}.p.periode.${c.periodicite}`)}` }))} />
      <div className="c-rg-dates">
        <Champ libelle={titre(`${K}.g.prix.montant`)} inputMode="decimal" autoComplete="off" valeur={tape} changer={setTape} premier {...fauteDe('montant')}
          aide={aujourdhui ? phrase(`${K}.g.prix.montant_aide`, { prix: montant(aujourdhui) }) : phrase(`${K}.g.prix.montant_aide_sans`)} />
        <Champ libelle={titre(`${K}.g.prix.date`)} type="date" min={plusTot} valeur={date} changer={setDate} {...fauteDe('date')}
          aide={phrase(`${K}.g.prix.date_aide`, { jour: jour(plusTot) })} />
      </div>
      {/* L'aperçu garde sa place dès l'ouverture, comme dans la fenêtre de facture : le motif, dessous, ne bouge pas pendant
          qu'on tape le prix. Un prix déjà préparé pour ce choix se dit à la place du nombre d'abonnés, sans rien pousser. */}
      <div className="c-champs">
        <span className="c-champ-libelle">{titre(`${K}.g.prix.apercu`)}</span>
        <div className="c-apercu-zone c-rg-prix-zone">
          {apercu ? (
            <div className="c-rg-prix-apercu" role="status">
              <p>
                {apercu.avant ? <><del data-donnee>{montant(apercu.avant)}</del> → </> : null}<ins data-donnee>{montant(apercu.apres)}</ins>
                {' '}{dire(`${K}.g.prix.ht`, { periode: dire(`${K}.p.periode.${periodicite}`) })}
                {apercu.ecart ? <span className={`c-sous c-bloc${fort ? ' c-rg-prix-attention' : ''}`}>{maj(dire(`${K}.g.prix.${apercu.ecart.sens}${fort ? '_forte' : ''}`,
                  { pourcent: pourcent(apercu.ecart.dixiemes), periode: dire(`${K}.p.periode.${periodicite}`) }))}</span> : null}
              </p>
              {apercu.dejaAVenir ? <p className="c-rg-prix-attention">{phrase(`${K}.g.prix.deja`, { jour: jour(apercu.dejaAVenir) })}</p>
                : apercu.abonnes !== null ? <p className="c-sous">{maj(selon(apercu.abonnes, `${K}.g.prix.abonnes`))}</p> : null}
            </div>
          ) : refus ? <p className="c-apercu-attente c-apercu-refus">{refus}</p>
            : <p className="c-apercu-attente">{phrase(tape.trim() ? 'console.ecran.geste.apercu_calcul' : `${K}.g.prix.apercu_attente`)}</p>}
        </div>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.prix.motif_aide`)} valeur={motif} changer={setMotif} {...fauteDe('motif')} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus && apercu ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Changer une règle de l'abonnement (0104) : la nouvelle valeur, ce qu'elle change, son motif ─────────────────────────
// L'aperçu se calcule ici, sur ce que l'écran a lu : la règle d'aujourd'hui et la nouvelle, en mots ; pour la grâce,
// les entreprises qui y sont aujourd'hui (elles gardent la leur). La base vérifie les bornes à son tour.
const BORNES: Record<CodeRegle, { min: number; max: number; plusieurs: boolean }> = {
  essai: { min: 7, max: 90, plusieurs: false }, grace: { min: 0, max: 30, plusieurs: false }, relances: { min: 1, max: 60, plusieurs: true },
};
// Ce qu'on a tapé, lu : une liste de jours entiers dans les bornes, chacun une fois (les relances du plus loin au plus près),
// ou rien si ce n'est pas lisible.
function lireJours(code: CodeRegle, tape: string): number[] | null {
  const b = BORNES[code];
  const morceaux = tape.split(/[\s,;]+/).filter(Boolean);
  if (!morceaux.length || (!b.plusieurs && morceaux.length > 1) || morceaux.length > 5 || !morceaux.every((m) => /^\d{1,3}$/.test(m))) return null;
  const jours = morceaux.map(Number);
  if (jours.some((n) => n < b.min || n > b.max) || new Set(jours).size !== jours.length) return null;
  return jours.sort((a, b2) => b2 - a);
}
function FenetreRegle({ code, d, fermer, fait }: { code: CodeRegle; d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const avant = d.regles[code]?.jours ?? null;
  const [tape, setTape] = useState(avant ? [...avant].sort((a, b) => b - a).join(', ') : '');
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const jours = lireJours(code, tape);
  const meme = jours !== null && avant !== null && jours.join(',') === [...avant].sort((a, b) => b - a).join(',');
  const refuser = (champ: string, cle: string) => { setRefus(phrase(cle)); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = () => {
    if (jours === null) { refuser('jours', `${K}.g.regle.illisible.${code}`); return; }
    if (meme) { refuser('jours', `${K}.g.regle.meme`); return; }
    if (motif.trim().length < 3) { refuser('motif', 'console.ecran.geste.motif_court'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const res = await api('POST', '/console/reglages/regle', { code, jours, motif: motif.trim() });
        if (!res) return;
        if (res.statut === 200) { toast(phrase(`${K}.g.regle.fait`)); fait(); return; }
        setRefus(refusDe(res));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const enMots = (j: number[] | null) => (code === 'relances' && j ? listeDesRelances(j) : code === 'grace' && j ? selon(j[0] ?? 0, `${K}.p.f.grace`) : j ? dire(`${K}.g.regle.n_jours`, { n: j[0] ?? 0 }) : '—');
  return (
    <Dialogue titre={titre(`${K}.g.regle.titre.${code}`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} desactive={jours === null || meme} onClick={envoyer}>{titre(`${K}.g.regle.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{[`${code}.p1`, `${code}.p2`, 'p3'].map((p) => <li key={p}>{phrase(`${K}.g.regle.${p}`)}</li>)}</ul>
      </div>
      <Champ libelle={titre(`${K}.g.regle.jours.${code}`)} aide={phrase(`${K}.g.regle.aide.${code}`, { avant: enMots(avant) })}
        inputMode={code === 'relances' ? 'text' : 'numeric'} autoComplete="off" valeur={tape} changer={setTape} premier {...fauteDe('jours')} />
      {/* L'aperçu garde sa place dès l'ouverture : le motif, dessous, ne bouge pas pendant qu'on tape. */}
      <div className="c-champs">
        <span className="c-champ-libelle">{titre(`${K}.g.regle.apercu`)}</span>
        <div className="c-apercu-zone c-rg-prix-zone">
          {jours && !meme ? (
            <div className="c-rg-prix-apercu" role="status">
              <p>{avant ? <><del data-donnee>{maj(enMots(avant))}</del> → </> : null}<ins data-donnee>{maj(enMots(jours))}</ins></p>
              {code !== 'relances' ? <p className="c-sous">{regleEnMots(code, jours)}</p> : null}
              {code === 'grace' ? <p className="c-sous">{maj(selon(d.echeance.enGrace, `${K}.g.regle.en_grace`))}</p> : null}
              {code === 'essai' ? <p className="c-sous">{maj(selon(d.essai.enCours, `${K}.p.essais`))}.</p> : null}
            </div>
          ) : <p className={`c-apercu-attente${tape.trim() && jours === null ? ' c-apercu-refus' : ''}`}>
            {phrase(meme ? `${K}.g.regle.meme` : tape.trim() && jours === null ? `${K}.g.regle.illisible.${code}` : `${K}.g.regle.apercu_attente`)}</p>}
        </div>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.regle.motif_aide`)} valeur={motif} changer={setMotif} {...fauteDe('motif')} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus && jours !== null && !meme ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Changer ce qu'une offre comprend (0105) : la ligne, la nouvelle valeur, la date ; l'aperçu, calculé sur ce que
// l'écran a lu, dit ce qui change, qui l'a aujourd'hui, et ce qui demande un regard (une offre qui comprendrait plus que
// Complet, un module que des abonnés perdraient). La base vérifie le préavis et les bornes à son tour.
// Ce que comprendra une offre un jour donné : le dernier changement préparé avant ce jour, sinon celui d'aujourd'hui.
function contenuAu(c: Contenus, offre: Offre, quoi: QuoiContenu, jourVise: string): number | null {
  const prepares = c.aVenir.filter((v) => v.offre === offre && v.quoi === quoi && v.aPartirDu <= jourVise).sort((a, b) => (a.aPartirDu < b.aPartirDu ? -1 : 1));
  return prepares.at(-1)?.nombre ?? c.duJour[offre][quoi];
}
function FenetreContenu({ d, fermer, fait }: { d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const plusTot = d.preavis ? plusJours(d.aujourdhui, d.preavis.jours) : d.aujourdhui;
  // L'offre, puis ce qui change : deux listes courtes plutôt qu'une longue. Le nombre tapé reste quand on change d'offre,
  // pas quand on change de ligne (il ne compterait plus la même chose). Un module se propose d'emblée dans l'autre état
  // que le sien aujourd'hui : c'est le seul changement possible.
  const [offre, setOffre] = useState<Offre>('essentiel');
  const [quoi, setQuoi] = useState<QuoiContenu>('caisses');
  const [tape, setTape] = useState('');
  const inverseDe = (o: Offre, q: QuoiContenu): '1' | '0' => (d.contenu.duJour[o][q] === 1 ? '0' : '1');
  const [module, setModule] = useState<'1' | '0'>(inverseDe('essentiel', 'caisses'));
  const [refus, setRefus] = useState<string | null>(null);
  const choisir = (o: Offre, q: QuoiContenu) => {
    if (q !== quoi) setTape('');
    setOffre(o); setQuoi(q); setModule(inverseDe(o, q)); setRefus(null);
  };
  const [date, setDate] = useState(plusTot);
  const [motif, setMotif] = useState('');
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const avant = d.contenu.duJour[offre][quoi];
  const dateLisible = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const nombre = estModule(quoi) ? Number(module) : /^\d{1,4}$/.test(tape.trim()) && Number(tape) <= 1000 ? Number(tape) : null;
  const deja = d.contenu.aVenir.find((v) => v.offre === offre && v.quoi === quoi) ?? null;
  const meme = nombre !== null && nombre === avant;
  // Ce jour-là, l'autre offre : Essentiel ne devrait jamais comprendre plus que Complet (la carte de Complet dit « Tout
  // Essentiel »).
  const autre: Offre = offre === 'essentiel' ? 'complet' : 'essentiel';
  const chezLAutre = dateLisible ? contenuAu(d.contenu, autre, quoi, date) : null;
  const inverse = nombre !== null && chezLAutre !== null && (offre === 'essentiel' ? nombre > chezLAutre : nombre < chezLAutre);
  const ligne = d.grille.find((l) => l.offre === offre);
  const abonnes = ligne ? ligne.abonnes.annuel + ligne.abonnes.mensuel : 0;
  const refuser = (champ: string, cle: string, valeurs = {}) => { setRefus(phrase(cle, valeurs)); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const faire = () => {
    if (nombre === null) { refuser('nombre', `${K}.g.contenu.illisible`); return; }
    if (deja) { refuser('nombre', `${K}.g.contenu.deja`, { jour: jour(deja.aPartirDu) }); return; }
    if (meme) { refuser('nombre', `${K}.g.contenu.meme`); return; }
    if (!dateLisible || date < plusTot) { refuser('date', `${K}.g.contenu.trop_tot`, { jour: jour(plusTot) }); return; }
    if (motif.trim().length < 3) { refuser('motif', 'console.ecran.geste.motif_court'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/reglages/contenu', { offre, quoi, nombre, aPartirDu: date, motif: motif.trim() });
        if (!r) return;
        if (r.statut === 201) { toast(phrase(`${K}.g.contenu.fait`)); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const valeurs = { offre: dire(`${K}.p.offre.${offre}`), autre: dire(`${K}.p.offre.${autre}`), jour: dateLisible ? jour(date) : '…' };
  const pret = nombre !== null && !meme && !deja;
  return (
    <Dialogue titre={titre(`${K}.g.contenu.titre`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} desactive={!pret} onClick={faire}>{titre(`${K}.g.contenu.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${K}.g.contenu.${p}`, valeurs)}</li>)}</ul>
      </div>
      <div className="c-rg-dates">
        <Choix libelle={titre(`${K}.g.contenu.offre`)} valeur={offre} changer={(v) => choisir(v === 'complet' ? 'complet' : 'essentiel', quoi)}
          options={OFFRES_PRIX.map((o) => ({ valeur: o, texte: titre(`${K}.p.offre.${o}`) }))} />
        <Choix libelle={titre(`${K}.g.contenu.quoi`)} valeur={quoi} changer={(v) => choisir(offre, QUOI_CONTENU.find((q) => q === v) ?? 'caisses')}
          options={QUOI_CONTENU.map((q) => ({ valeur: q, texte: titre(`${K}.c.quoi.${q}`) }))} />
      </div>
      <div className="c-rg-dates">
        {estModule(quoi)
          ? <Choix libelle={titre(`${K}.c.quoi.${quoi}`)} valeur={module} changer={(v) => setModule(v === '0' ? '0' : '1')}
            aide={phrase(`${K}.g.contenu.module_aide`, { quoi: dire(`${K}.c.quoi.${quoi}`), etat: caseDeContenu(quoi, avant) })}
            options={[{ valeur: '1', texte: titre(`${K}.g.contenu.module_compris`) }, { valeur: '0', texte: titre(`${K}.g.contenu.module_seul`) }]} />
          : <Champ libelle={titre(`${K}.g.contenu.nombre`)} type="number" inputMode="numeric" min={0} max={1000} autoComplete="off" valeur={tape} changer={setTape}
            premier {...fauteDe('nombre')} aide={phrase(`${K}.g.contenu.nombre_aide`, { avant: caseDeContenu(quoi, avant) })} />}
        <Champ libelle={titre(`${K}.g.prix.date`)} type="date" min={plusTot} valeur={date} changer={setDate} {...fauteDe('date')}
          aide={phrase(`${K}.g.contenu.date_aide`, { jour: jour(plusTot) })} />
      </div>
      {/* L'aperçu garde sa place dès l'ouverture : le motif, dessous, ne bouge pas pendant qu'on tape. */}
      <div className="c-champs">
        <span className="c-champ-libelle">{titre(`${K}.g.prix.apercu`)}</span>
        <div className="c-apercu-zone c-rg-prix-zone">
          {deja ? <p className="c-apercu-attente c-apercu-refus">{phrase(`${K}.g.contenu.deja`, { jour: jour(deja.aPartirDu) })}</p>
            : nombre === null ? <p className={`c-apercu-attente${tape.trim() ? ' c-apercu-refus' : ''}`}>{phrase(tape.trim() ? `${K}.g.contenu.illisible` : `${K}.g.contenu.apercu_attente`)}</p>
              : meme ? <p className="c-apercu-attente c-apercu-refus">{phrase(`${K}.g.contenu.meme`)}</p>
                : (
                  <div className="c-rg-prix-apercu" role="status">
                    <p>{maj(dire(`${K}.p.offre.${offre}`))} : {avant !== null ? <><del data-donnee>{contenuEnMots(quoi, avant)}</del> → </> : null}
                      <ins data-donnee>{contenuEnMots(quoi, nombre)}</ins></p>
                    {inverse ? <p className="c-rg-prix-attention">{phrase(`${K}.g.contenu.inverse.${offre}`, { ...valeurs, chez: contenuEnMots(quoi, chezLAutre ?? 0) })}</p>
                      : estModule(quoi) && nombre === 0 && abonnes > 0 ? <p className="c-rg-prix-attention">{maj(selon(abonnes, `${K}.g.contenu.perdent`, valeurs))}.</p>
                        : <p className="c-sous">{maj(selon(abonnes, `${K}.g.contenu.abonnes`, valeurs))}.</p>}
                  </div>
                )}
        </div>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.contenu.motif_aide`)} valeur={motif} changer={setMotif} {...fauteDe('motif')} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus && pret ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── Préparer une remise (0106) : laquelle, son taux (et pour le cabinet sa durée), sa date ; l'aperçu, calculé sur ce
// que l'écran a lu, dit ce qui change et qui l'a aujourd'hui. La base vérifie le préavis et les bornes à son tour ──────
function FenetreRemise({ d, fermer, fait }: { d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const plusTot = d.preavis ? plusJours(d.aujourdhui, d.preavis.jours) : d.aujourdhui;
  const [code, setCode] = useState<CodeRemise>('groupe');
  const [taux, setTaux] = useState('');
  // La durée part vide : vide, elle reste celle d'aujourd'hui (choisir la remise du cabinet n'est pas taper une durée).
  const [mois, setMois] = useState('');
  const [date, setDate] = useState(plusTot);
  const [motif, setMotif] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const avant = d.remises.duJour[code];
  const dateLisible = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const t = /^\d{1,2}$/.test(taux.trim()) && Number(taux) <= 90 ? Number(taux) : null;
  const m = code === 'groupe' ? null : !mois.trim() ? avant?.mois ?? undefined
    : /^\d{1,2}$/.test(mois.trim()) && Number(mois) >= 1 && Number(mois) <= 60 ? Number(mois) : undefined;
  const lisible = t !== null && m !== undefined;
  const deja = d.remises.aVenir.find((v) => v.code === code) ?? null;
  const meme = lisible && avant !== null && avant.taux === t && avant.mois === m;
  const refuser = (champ: string, cle: string, valeurs = {}) => { setRefus(phrase(cle, valeurs)); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const faire = () => {
    if (t === null) { refuser('taux', `${K}.g.remise.taux_illisible`); return; }
    if (m === undefined) { refuser('mois', `${K}.g.remise.mois_illisible`); return; }
    if (deja) { refuser('taux', `${K}.g.remise.deja`, { jour: jour(deja.aPartirDu) }); return; }
    if (meme) { refuser('taux', `${K}.g.remise.meme`); return; }
    if (!dateLisible || date < plusTot) { refuser('date', `${K}.g.remise.trop_tot`, { jour: jour(plusTot) }); return; }
    if (motif.trim().length < 3) { refuser('motif', 'console.ecran.geste.motif_court'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', '/console/reglages/remise', { code, taux: t, mois: m, aPartirDu: date, motif: motif.trim() });
        if (!r) return;
        if (r.statut === 201) { toast(phrase(`${K}.g.remise.fait`)); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const valeurs = { nom: dire(`${K}.rm.nom.${code}`), jour: dateLisible ? jour(date) : '…' };
  const pret = lisible && !meme && !deja;
  return (
    <Dialogue titre={titre(`${K}.g.remise.titre`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} desactive={!pret} onClick={faire}>{titre(`${K}.g.remise.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((p) => <li key={p}>{phrase(`${K}.g.remise.${p}`, valeurs)}</li>)}</ul>
      </div>
      <Choix libelle={titre(`${K}.g.remise.laquelle`)} valeur={code} changer={(v) => { setCode(v === 'cabinet' ? 'cabinet' : 'groupe'); setRefus(null); }}
        options={CODES_REMISE.map((c) => ({ valeur: c, texte: titre(`${K}.rm.nom.${c}`) }))} />
      <div className="c-rg-dates">
        <Champ libelle={titre(`${K}.g.remise.taux`)} type="number" inputMode="numeric" min={0} max={90} autoComplete="off" valeur={taux} changer={setTaux}
          premier {...fauteDe('taux')} aide={phrase(`${K}.g.remise.taux_aide`, { avant: avant ? dire(`${K}.rm.taux`, { taux: avant.taux }) : '—' })} />
        <Champ libelle={titre(`${K}.g.prix.date`)} type="date" min={plusTot} valeur={date} changer={setDate} {...fauteDe('date')}
          aide={phrase(`${K}.g.contenu.date_aide`, { jour: jour(plusTot) })} />
      </div>
      {/* La durée, au cabinet seulement : dessous, pour que le taux et la date ne bougent pas quand on change de remise. */}
      {code === 'cabinet' ? (
        <div className="c-rg-dates">
          <Champ libelle={titre(`${K}.g.remise.mois`)} type="number" inputMode="numeric" min={1} max={60} autoComplete="off" valeur={mois} changer={setMois}
            {...(avant?.mois ? { placeholder: String(avant.mois) } : {})}
            {...fauteDe('mois')} aide={phrase(`${K}.g.remise.mois_aide`, { avant: avant?.mois ? selon(avant.mois, `${K}.rm.mois`) : '—' })} />
        </div>
      ) : null}
      {/* L'aperçu garde sa place dès l'ouverture : le motif, dessous, ne bouge pas pendant qu'on tape. */}
      <div className="c-champs">
        <span className="c-champ-libelle">{titre(`${K}.g.prix.apercu`)}</span>
        <div className="c-apercu-zone c-rg-prix-zone">
          {deja ? <p className="c-apercu-attente c-apercu-refus">{phrase(`${K}.g.remise.deja`, { jour: jour(deja.aPartirDu) })}</p>
            : !lisible ? <p className={`c-apercu-attente${taux.trim() ? ' c-apercu-refus' : ''}`}>{phrase(!taux.trim() ? `${K}.g.remise.apercu_attente` : t === null ? `${K}.g.remise.taux_illisible` : `${K}.g.remise.mois_illisible`)}</p>
              : meme ? <p className="c-apercu-attente c-apercu-refus">{phrase(`${K}.g.remise.meme`)}</p>
                : (
                  <div className="c-rg-prix-apercu" role="status">
                    <p>{maj(dire(`${K}.rm.nom.${code}`))} : {avant ? <><del data-donnee>{remiseEnMots(code, avant.taux, avant.mois)}</del> → </> : null}
                      <ins data-donnee>{remiseEnMots(code, t, m)}</ins></p>
                    {t === 0 ? <p className="c-rg-prix-attention">{phrase(`${K}.g.remise.zero.${code}`, valeurs)}</p>
                      : code === 'groupe' ? <p className="c-sous">{maj(selon(d.remises.enGroupe, `${K}.g.remise.en_groupe`, valeurs))}.</p>
                        : <p className="c-sous">{phrase(`${K}.g.remise.cabinet_dit`, valeurs)}</p>}
                  </div>
                )}
        </div>
      </div>
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${K}.g.remise.motif_aide`)} valeur={motif} changer={setMotif} {...fauteDe('motif')} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus && pret ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Reglages({ onglet: demande }: { onglet: string | null }) {
  const [l, relire] = useLecture<Donnees>('/console/reglages', 'reglages');
  const [geste, setGeste] = useState<Geste | null>(null);
  const onglet: OngletReglages = ONGLETS_REGLAGES.includes(demande as OngletReglages) ? demande as OngletReglages : 'prix';
  const d = l.etat === 'lu' ? l.donnees : null;
  // « Désigner l'entreprise SkanFact » (Paiements, Nos factures, l'accueil) mène à `onglet=factures` : la carte « Nos factures »
  // est au bas des offres et prix ; on y descend (1.80.0, recette du 20/10/2026 : on restait en haut, sans le geste).
  useEffect(() => {
    if (demande === 'factures' && d) document.getElementById('rg-factures')?.scrollIntoView({ block: 'start' });
  }, [demande, d]);
  const peut = d?.role === 'direction';
  const aRelire = d ? d.registre.filter((r) => r.aRelire).length : 0;
  // Les pièces qui demandent un geste chez un client : retenues ou refusées par la TTN.
  const ttn = d?.formats.find((f) => f.code === 'ttn')?.chiffres;
  const aRegarder = ttn ? Number(ttn.retenues ?? 0) + Number(ttn.refusees ?? 0) : 0;
  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${K}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(`${K}.sous`)}</p>
        </div>
      </header>
      {d && !peut ? <Alerte ton="info" icone="cadenas"><span><b>{titre(`${K}.reserve`)}</b> {phrase(`${K}.reserve_texte`)}</span></Alerte> : null}
      <nav className="c-onglets" aria-label={titre(`${K}.onglets`)}>
        {ONGLETS_REGLAGES.map((o) => (
          <a key={o} href={o === 'prix' ? '#/reglages' : `#/reglages?onglet=${o}`} aria-current={onglet === o ? 'page' : undefined}>
            {titre(`${K}.onglet.${o}`)}
            {o === 'regles' && aRelire ? (
              <><span className="c-onglet-n" aria-hidden="true">{entier(aRelire)}</span><span className="c-cache">{selon(aRelire, `${K}.onglet.a_relire`)}</span></>
            ) : null}
            {o === 'formats' && aRegarder ? (
              <><span className="c-onglet-n" aria-hidden="true">{entier(aRegarder)}</span><span className="c-cache">{selon(aRegarder, `${K}.onglet.a_regarder`, { n: entier(aRegarder) })}</span></>
            ) : null}
            {o === 'messages' && d?.message ? <><span className="c-onglet-n" aria-hidden="true">1</span><span className="c-cache">{dire(`${K}.onglet.affiche`)}</span></> : null}
            {o === 'nouveautes' && d && allumees(d) ? <><span className="c-onglet-n" aria-hidden="true">{entier(allumees(d))}</span><span className="c-cache">{selon(allumees(d), `${K}.onglet.allumees`, { n: entier(allumees(d)) })}</span></> : null}
          </a>
        ))}
      </nav>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d && onglet === 'prix' ? <Prix d={d} geste={setGeste} peut={peut} /> : null}
      {d && onglet === 'regles' ? <Regles d={d} geste={setGeste} peut={peut} /> : null}
      {d && onglet === 'formats' ? <Formats d={d} /> : null}
      {d && onglet === 'messages' ? <Messages d={d} geste={setGeste} peut={peut} /> : null}
      {d && onglet === 'nouveautes' ? <Nouveautes d={d} geste={setGeste} peut={peut} /> : null}
      {geste && d ? (geste.sorte === 'prix' ? <FenetrePrix d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} />
        : geste.sorte === 'regle' ? <FenetreRegle code={geste.code} d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} />
        : geste.sorte === 'contenu' ? <FenetreContenu d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} />
        : geste.sorte === 'remise' ? <FenetreRemise d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} />
          : <FenetreGeste g={geste} d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} />) : null}
    </>
  );
}
