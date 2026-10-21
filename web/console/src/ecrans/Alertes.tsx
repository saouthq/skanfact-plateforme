// Les alertes du service (10 § 2.8 ; 06 § 7 ; serveur/console/routes.ts, GET /console/service/alertes ;
// serveur/console/alertes.ts ; docs/console.md C13) : ce que la veille dit quand quelque chose ne va pas, et ce qu'on y fait.
// L'alerte en cours (ce qu'il faut faire et la commande à copier, qui s'en occupe, sa chronologie : chaque message et par
// quel moyen il est parti), qui est prévenu et comment, le rythme, les règles de la veille (ce que chacune regarde, quand
// elle parle, ce qu'elle voit en ce moment) et les trente derniers jours. Trois règles :
//   - une alerte ne se règle jamais à la main : elle se lève quand la veille ne voit plus le problème ;
//   - chaque geste (prendre en charge, sourdine, essai) dit ce qui va se passer, demande son motif et entre au journal ;
//   - rien n'est vert sans mesure : une veille qui ne relève plus rend chaque règle « non lue », jamais « calme ».
import { useEffect, useRef, useState } from 'react';
import { dire, phrase, titre, typo } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { duree, entier, minutes, pourCent } from '../nombres.ts';
import { heureDe, jourDe, jourMois, quand } from '../temps.ts';
import { nomDeVersion } from '../version.ts';
import { Alerte, Bouton, Dialogue, Icone, maj, MenuLigne, Puce, toast, Vide, Zone, type NomIcone, type TonPuce } from '../ui.tsx';
import { EnteteService, enTitre, faitDeRegle, ICONE_BRIQUE, useRelireTantQueRegarde, type AlertesEnCours, type Brique, type Faits, type IdBrique, type Veille } from './Service.tsx';

const K = 'console.ecran.service';
const A = `${K}.al`;

type Etape = { texte: string; code?: string };
type Prise = { par: string; le: string; motif: string; moi: boolean };
type Sourdine = { id: string; fin: string; par: string; motif: string };
type Evenement =
  | { le: string; sorte: 'ouverte'; grave: boolean; attente: number }
  | { le: string; sorte: 'message'; quoi: 'nouveau' | 'rappel' | 'aggravee' | 'regle'; grave: boolean; courriel: boolean | null; sms: boolean | null; fois: number; jusqua: string }
  | { le: string; sorte: 'prise'; par: string; motif: string }
  | { le: string; sorte: 'sourdine'; par: string; motif: string; fin: string }
  | { le: string; sorte: 'sourdine_levee'; par: string }
  | { le: string; sorte: 'reglee' };
type EnCours = {
  id: string; cle: string; regle: string | null; brique: IdBrique | null; titre: string; grave: boolean; debut: string; etapes: Etape[];
  prise: Prise | null; sourdine: Sourdine | null; prochainRappel: string | null; chronologie: Evenement[];
};
type Moyen = { a: string; pret: boolean } | null;
type Prevenus = {
  destinataires: { courriel: Moyen; sms: Moyen } | null; releveLe: string | null;
  dernierEssai: { le: string; courriel: boolean | null; sms: boolean | null } | null; essaiEnAttente: { le: string; par: string } | null;
};
type EtatDeRegle = 'grave' | 'attention' | 'calme' | 'trop_peu' | 'non_lu' | 'pas_branchee';
type LuDeLaRegle = { etat: 'calme' | 'alerte' | 'trop_peu' | 'non_lu'; part?: number | null; n?: number; p95?: number | null; lectures?: number };
type Regle = {
  id: string; brique: IdBrique | null; branchee: boolean; seuils: Record<string, number>; etat: EtatDeRegle;
  ouvertes: { id: string; titre: string; grave: boolean }[]; lu: LuDeLaRegle | null;
  derniere: { cle: string; debut: string; fin: string | null; grave: boolean } | null; sourdine: Sourdine | null;
};
type Passee = {
  id: string; cle: string; regle: string | null; brique: IdBrique | null; titre: string; grave: boolean; debut: string; fin: string | null;
  minutes: number; reglee: 'en_cours' | 'prise' | 'seule'; prise: Prise | null;
};
type Donnees = {
  maintenant: string; aujourdhui: string; veille: Veille; alertesEnCours: AlertesEnCours; briques: Brique[];
  enCours: EnCours[]; prevenus: Prevenus; rythme: { minutesService: number; rappelH: number; sourdineGraveH: number };
  regles: Regle[]; minutesJugees: { pannes: number; temps: number }; histoire: Passee[];
  faits: Omit<Faits, 'aujourdhui'> & { enLigne: { version: string; depuis: string | null; vueArriver: boolean } | null };
  numeros?: Record<string, string>;
};

// ── Les mots ────────────────────────────────────────────────────────────────────────────────────────────────────────
const nomRegle = (id: string) => dire(`${K}.regle.${id}.nom`);
// Un seuil se dit comme la veille le juge : une part en pour cent (0,01 → « 1 % »), le reste en nombre.
function seuilsEnMots(seuils: Record<string, number>): Record<string, string> {
  return Object.fromEntries(Object.entries(seuils).map(([k, v]) => [k, k.startsWith('part') ? pourCent(v, Number.isInteger(Math.round(v * 1e6) / 1e4) ? 0 : 1) : entier(v)]));
}
// Un instant dans une liste du jour : « 03:42 » aujourd'hui, « hier 22:10 », « 12/10 08:01 » plus loin.
function moment(instant: string, aujourdhui: string): string {
  const j = jourDe(instant);
  if (j === aujourdhui) return heureDe(instant);
  const hier = new Date(Date.parse(`${aujourdhui}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${j === hier ? dire('console.ecran.temps.hier') : jourMois(j)} ${heureDe(instant)}`;
}
const depuisMinutes = (de: string, a: string) => (Date.parse(a) - Date.parse(de)) / 60_000;

// ── Copier une commande ─────────────────────────────────────────────────────────────────────────────────────────────
// La commande se lit en entier et se sélectionne d'un clic ; « Copier » la pose dans le presse-papiers. Un navigateur qui
// refuse le dit, sans perdre la commande : elle reste à sélectionner à la main.
export function Commande({ code }: { code: string }) {
  const [copie, setCopie] = useState(false);
  useEffect(() => { if (!copie) return undefined; const t = setTimeout(() => setCopie(false), 2000); return () => clearTimeout(t); }, [copie]);
  const copier = () => {
    if (!navigator.clipboard) { toast(phrase(`${A}.copie_ratee`), true); return; }
    navigator.clipboard.writeText(code).then(() => setCopie(true), () => toast(phrase(`${A}.copie_ratee`), true));
  };
  return (
    <div className="c-al-commande">
      <code className="c-mono" data-donnee>{code}</code>
      <button type="button" className="c-btn c-btn-petit" onClick={copier} aria-label={dire(`${A}.copier_de`, { code })}>
        <Icone nom={copie ? 'ok' : 'copier'} taille={16} />{titre(copie ? `${A}.copie` : `${A}.copier`)}
      </button>
    </div>
  );
}

// ── La chronologie d'une alerte ─────────────────────────────────────────────────────────────────────────────────────
// Ce que le serveur range (serveur/console/alertes.ts, `chronologie`) : elle s'ouvre, chaque message et ses moyens, qui la
// prend, ses sourdines, elle se règle ; puis ce qui vient — le prochain rappel, ou la fin de la sourdine.
type Ton = 'gris' | 'attention' | 'grave' | 'bon' | 'futur';
type Canal = { texte: string; etat: 'ok' | 'ko' | 'non' };
type LigneChrono = { le: string; ton: Ton; titre: string; detail?: string; motif?: string; canaux?: Canal[] };
function canauxDe(courriel: boolean | null, sms: boolean | null): Canal[] {
  const c: Canal[] = [];
  if (courriel !== null) c.push({ texte: dire(`${A}.canal.courriel_${courriel ? 'vrai' : 'faux'}`), etat: courriel ? 'ok' : 'ko' });
  if (sms !== null) c.push({ texte: dire(`${A}.canal.sms_${sms ? 'vrai' : 'faux'}`), etat: sms ? 'ok' : 'ko' });
  return c.length ? c : [{ texte: dire(`${A}.canal.aucun`), etat: 'non' }];
}
function lignesDe(a: EnCours, d: Donnees): LigneChrono[] {
  const l: LigneChrono[] = a.chronologie.map((e): LigneChrono => {
    switch (e.sorte) {
      case 'ouverte': return { le: e.le, ton: e.grave ? 'grave' : 'attention', titre: titre(`${A}.ev.ouverte`), ...(e.attente > 1 ? { detail: phrase(`${A}.ev.ouverte_detail`, { n: e.attente }) } : {}) };
      case 'message': {
        const remis = e.courriel === true || e.sms === true;
        return {
          le: e.le, ton: remis ? (e.quoi === 'regle' ? 'bon' : e.grave ? 'grave' : 'attention') : 'gris', titre: titre(`${A}.ev.${e.quoi}`), canaux: canauxDe(e.courriel, e.sms),
          ...(remis ? {} : { detail: e.fois > 1 ? phrase(`${A}.ev.pas_partie_fois`, { n: e.fois, heure: moment(e.jusqua, d.aujourdhui) }) : phrase(`${A}.ev.pas_partie`) }),
        };
      }
      case 'prise': return { le: e.le, ton: 'bon', titre: titre(`${A}.ev.prise`, { nom: e.par }), motif: e.motif };
      case 'sourdine': return { le: e.le, ton: 'gris', titre: titre(`${A}.ev.sourdine`, { nom: e.par, heure: moment(e.fin, d.aujourdhui) }), motif: e.motif };
      case 'sourdine_levee': return { le: e.le, ton: 'gris', titre: titre(`${A}.ev.sourdine_levee`, { nom: e.par }) };
      default: return { le: e.le, ton: 'bon', titre: titre(`${A}.ev.reglee`) };
    }
  });
  if (a.sourdine) l.push({ le: a.sourdine.fin, ton: 'futur', titre: titre(`${A}.ev.fin_sourdine`), detail: phrase(`${A}.ev.fin_sourdine_detail`) });
  else if (a.prochainRappel) l.push({ le: a.prochainRappel, ton: 'futur', titre: titre(`${A}.ev.prochain`), detail: phrase(`${A}.ev.prochain_${a.grave ? 'grave' : 'normal'}`, { h: d.rythme.rappelH }) });
  return l;
}
function Chronologie({ a, d }: { a: EnCours; d: Donnees }) {
  return (
    <ol className="c-al-chrono">
      {lignesDe(a, d).map((x, k) => (
        <li key={`${x.le}-${k}`} className={`c-al-ev c-al-ev-${x.ton}`}>
          <span className="c-al-ev-h c-num">{moment(x.le, d.aujourdhui)}</span>
          <span className="c-al-ev-point" aria-hidden="true" />
          <div className="c-al-ev-texte">
            <b>{x.titre}</b>
            {x.detail ? <span className="c-sous">{x.detail}</span> : null}
            {x.motif ? <span className="c-motif" data-donnee>{'« '}{x.motif}{' »'}</span> : null}
            {x.canaux ? <span className="c-al-canaux">{x.canaux.map((c) => <span key={c.texte} className={`c-al-canal c-al-canal-${c.etat}`}>{c.texte}</span>)}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Une alerte en cours ─────────────────────────────────────────────────────────────────────────────────────────────
type Geste = { sorte: 'prendre'; a: EnCours } | { sorte: 'sourdine'; regle: string; grave: boolean } | { sorte: 'lever'; regle: string; sourdine: Sourdine } | { sorte: 'essai' };
// `principale` : la carte dont « Prendre en charge » est l'étape suivante — la plus urgente que personne n'a prise ; un
// seul bouton principal à l'écran (C2). `premiere` : la note sur le « réglé » ne se lit qu'une fois, sous la première.
function CarteAlerte({ a, d, faire, principale, premiere }: { a: EnCours; d: Donnees; faire: (g: Geste) => void; principale: boolean; premiere: boolean }) {
  const ton = a.grave ? 'grave' : 'attention';
  const enjeu = a.regle ? dire(`${K}.regle.${a.regle}.enjeu`) : null;
  const rappels = a.sourdine ? dire(`${A}.fait.sourdine`, { heure: moment(a.sourdine.fin, d.aujourdhui) })
    : a.prochainRappel ? dire(`${A}.fait.prochain`, { heure: moment(a.prochainRappel, d.aujourdhui) }) : dire(`${A}.fait.pas_remise`);
  return (
    <section className={`c-carte c-al-alerte c-al-${ton}`} aria-labelledby={`al-${a.id}`}>
      <div className="c-al-tete">
        <span className="c-al-surtitre">
          <span className={`c-al-icone c-ton-${ton}`} aria-hidden="true"><Icone nom={a.brique ? ICONE_BRIQUE[a.brique] : 'alerte'} taille={17} /></span>
          <span>{titre(`${A}.titre_en_cours`)}{a.regle ? <> · {dire(`${A}.regle_de`, { regle: nomRegle(a.regle) })}</> : null}</span>
        </span>
        <Puce ton={a.grave ? 'urgent' : 'en_retard'}>{dire(`${K}.${a.grave ? 'grave' : 'a_regarder'}`)}</Puce>
      </div>
      <h2 id={`al-${a.id}`} className="c-al-titre" data-donnee>{enTitre(a.titre)}</h2>
      {enjeu ? <p className="c-al-enjeu">{maj(typo(enjeu))}</p> : null}
      <dl className="c-al-faits">
        <div><dt>{titre(`${A}.fait.depuis`)}</dt><dd>{dire(`${A}.fait.depuis_valeur`, { heure: moment(a.debut, d.aujourdhui), duree: minutes(depuisMinutes(a.debut, d.maintenant)) })}</dd></div>
        <div>
          <dt>{titre(`${A}.fait.prise`)}</dt>
          <dd className={a.prise ? 'c-al-bon' : 'c-al-manque'}>
            {maj(a.prise ? (a.prise.moi ? dire(`${A}.fait.par_toi`) : dire(`${A}.fait.par`, { nom: a.prise.par })) : dire(`${A}.fait.personne`))}
          </dd>
        </div>
        <div><dt>{titre(`${A}.fait.rappels`)}</dt><dd>{maj(rappels)}</dd></div>
      </dl>
      <div className="c-al-corps">
        <div className="c-al-faire">
          <h3>{titre(`${A}.que_faire`)}</h3>
          <ol className="c-al-etapes">
            {a.etapes.map((e, k) => (
              <li key={k}>
                <span className="c-al-n c-num" aria-hidden="true">{k + 1}</span>
                <div className="c-al-etape">
                  <p data-donnee>{maj(typo(e.texte))}</p>
                  {e.code ? <Commande code={e.code} /> : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="c-al-gestes">
            {!a.prise ? <Bouton {...(principale ? { ton: 'principal' as const } : {})} icone="personne" onClick={() => faire({ sorte: 'prendre', a })}>{titre(`${A}.prendre`)}</Bouton>
              : !a.prise.moi ? <Bouton icone="personne" onClick={() => faire({ sorte: 'prendre', a })}>{titre(`${A}.reprendre`)}</Bouton> : null}
            {a.regle && a.sourdine ? <Bouton icone="cloche" onClick={() => faire({ sorte: 'lever', regle: a.regle ?? '', sourdine: a.sourdine as Sourdine })}>{titre(`${A}.lever`)}</Bouton>
              : a.regle ? <Bouton icone="sourdine" onClick={() => faire({ sorte: 'sourdine', regle: a.regle ?? '', grave: a.grave })}>{titre(`${A}.sourdine`)}</Bouton> : null}
          </div>
          {premiere ? <p className="c-al-note"><Icone nom="info" taille={16} /><span>{phrase(`${A}.seule`)}</span></p> : null}
        </div>
        <div className="c-al-chrono-zone">
          <h3>{titre(`${A}.chronologie`)}</h3>
          <Chronologie a={a} d={d} />
        </div>
      </div>
    </section>
  );
}

// Aucune alerte : la veille regarde, et rien ne dépasse ses seuils — dit seulement quand elle regarde vraiment (C2).
function AucuneAlerte({ d }: { d: Donnees }) {
  const derniere = d.histoire[0];
  return (
    <section className="c-carte c-sv-moment" aria-labelledby="al-aucune">
      <span className="c-sv-pouls" aria-hidden="true" />
      <div className="c-sv-moment-texte">
        <h2 id="al-aucune">{titre(`${A}.aucune_titre`)}</h2>
        <p className="c-carte-sous">{derniere ? phrase(`${A}.aucune`, { quand: quand(derniere.fin ?? derniere.debut, d.aujourdhui) }) : phrase(`${A}.aucune_jamais`)}</p>
      </div>
    </section>
  );
}

// ── Qui est prévenu, et le rythme ───────────────────────────────────────────────────────────────────────────────────
const ICONE_MOYEN: Record<'courriel' | 'sms', NomIcone> = { courriel: 'courriel', sms: 'telephone' };
function QuiEstPrevenu({ d, essai }: { d: Donnees; essai: () => void }) {
  const p = d.prevenus;
  const dest = p.destinataires;
  const prets = dest ? [dest.courriel, dest.sms].filter((m) => m?.pret).length : 0;
  const avertir = !dest ? null
    : !dest.courriel && !dest.sms ? <Alerte ton="danger"><span><b>{titre(`${A}.personne_titre`)}</b> {phrase(`${A}.personne`)}</span></Alerte>
      : !dest.sms ? <p className="c-al-avis"><Icone nom="info" taille={16} /><span>{phrase(`${A}.un_moyen_courriel`)}</span></p>
        : !dest.courriel ? <p className="c-al-avis"><Icone nom="info" taille={16} /><span>{phrase(`${A}.un_moyen_sms`)}</span></p>
          : <p className="c-al-avis"><Icone nom="info" taille={16} /><span>{phrase(`${A}.une_personne`)}</span></p>;
  return (
    <section className="c-carte c-al-prevenus" aria-labelledby="al-prevenus">
      <div>
        <h2 id="al-prevenus">{titre(`${A}.prevenus.titre`)}</h2>
        <p className="c-carte-sous">{phrase(`${A}.prevenus.sous`)}</p>
      </div>
      {!dest ? <Vide icone="info">{phrase(`${A}.prevenus.inconnu`)}</Vide> : (
        <>
          <ul className="c-al-moyens">
            {(['courriel', 'sms'] as const).map((m) => {
              const x = dest[m];
              return (
                <li key={m}>
                  <span className={`c-al-moyen-icone${x?.pret ? '' : ' c-al-moyen-non'}`} aria-hidden="true"><Icone nom={ICONE_MOYEN[m]} taille={17} /></span>
                  <div className="c-al-moyen-texte">
                    <b>{titre(`${A}.moyen.${m}`)}</b>
                    {x ? <span className="c-mono" data-donnee>{x.a}</span> : <span className="c-sous">{dire(`${A}.moyen.pas_regle`)}</span>}
                    {x && !x.pret ? <span className="c-al-avis-court">{phrase(`${A}.moyen.${m === 'courriel' ? 'sans_relais' : 'sans_winsms'}`)}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {p.releveLe ? <p className="c-sous c-al-lu">{phrase(`${A}.prevenus.lu`, { quand: quand(p.releveLe, d.aujourdhui) })}</p> : null}
          {/* L'essai, à côté de ce qu'il a donné la dernière fois : on le relance là où on lit son résultat. */}
          <div className="c-al-essai">
            {/* Le dernier essai dit chaque moyen : c'est un moyen en panne que l'essai doit faire voir. */}
            <div className="c-al-essai-texte">
              <p>
                {p.essaiEnAttente ? phrase(`${A}.essai.attente`, { quand: quand(p.essaiEnAttente.le, d.aujourdhui), nom: p.essaiEnAttente.par })
                  : p.dernierEssai ? titre(`${A}.essai.dernier`, { quand: quand(p.dernierEssai.le, d.aujourdhui) })
                    : phrase(`${A}.essai.jamais`)}
              </p>
              {!p.essaiEnAttente && p.dernierEssai ? (
                <span className="c-al-canaux">{canauxDe(p.dernierEssai.courriel, p.dernierEssai.sms).map((c) => <span key={c.texte} className={`c-al-canal c-al-canal-${c.etat}`}>{c.texte}</span>)}</span>
              ) : null}
            </div>
            <Bouton petit icone="courriel" onClick={essai} desactive={prets === 0 || p.essaiEnAttente !== null}>{titre(`${A}.essai`)}</Bouton>
          </div>
          {avertir}
        </>
      )}
    </section>
  );
}
function Rythme({ d }: { d: Donnees }) {
  const r = d.rythme;
  const lignes: [string, string, NomIcone][] = [
    [titre(`${A}.rythme.nouveau_quand`), phrase(`${A}.rythme.nouveau`, { n: r.minutesService }), 'alerte'],
    [titre(`${A}.rythme.dure_quand`), phrase(`${A}.rythme.dure`, { h: r.rappelH }), 'sablier'],
    [titre(`${A}.rythme.regle_quand`), phrase(`${A}.rythme.regle`), 'ok'],
    [titre(`${A}.rythme.sourdine_quand`), phrase(`${A}.rythme.sourdine`, { h: r.sourdineGraveH }), 'sourdine'],
  ];
  return (
    <section className="c-carte c-al-rythme" aria-labelledby="al-rythme">
      <h2 id="al-rythme">{titre(`${A}.rythme.titre`)}</h2>
      <ul className="c-al-rythme-liste">
        {lignes.map(([q, t, i]) => (
          <li key={q}><span className="c-al-rythme-icone" aria-hidden="true"><Icone nom={i} taille={16} /></span><div><b>{q}</b><span>{t}</span></div></li>
        ))}
      </ul>
    </section>
  );
}

// ── Les règles de la veille ─────────────────────────────────────────────────────────────────────────────────────────
const PUCE_REGLE: Record<EtatDeRegle, TonPuce> = { grave: 'urgent', attention: 'en_retard', calme: 'actif', trop_peu: 'hors', non_lu: 'hors', pas_branchee: 'hors' };
const FILTRES_REGLES = ['toutes', 'branchees', 'prevues'] as const;
type FiltreRegles = (typeof FILTRES_REGLES)[number];
// Ce que la règle voit en ce moment, en une phrase : son alerte ouverte d'abord, sinon ce que la veille a relevé (la même
// fonction que la vue d'ensemble), sinon « rien à redire ».
function maintenant(r: Regle, d: Donnees): { texte: string; ton: 'grave' | 'attention' | 'calme' | 'gris'; donnee?: boolean } {
  if (!r.branchee) return { texte: dire(`${K}.regle.${r.id}.manque`), ton: 'gris' };
  if (r.etat === 'non_lu') return { texte: dire(`${A}.maintenant.non_lu`), ton: 'gris' };
  const ouverte = r.ouvertes[0];
  if (ouverte) return { texte: ouverte.titre, ton: ouverte.grave ? 'grave' : 'attention', donnee: true };
  if (r.etat === 'trop_peu') return { texte: dire(`${A}.maintenant.trop_peu`), ton: 'gris' };
  if (r.id === 'pannes' && typeof r.lu?.part === 'number') return { texte: dire(`${A}.maintenant.pannes`, { part: pourCent(r.lu.part, 1), minutes: d.minutesJugees.pannes, n: entier(r.lu.n ?? 0) }), ton: 'calme' };
  if (r.id === 'temps' && typeof r.lu?.p95 === 'number') return { texte: dire(`${A}.maintenant.temps`, { duree: duree(r.lu.p95), n: entier(r.lu.lectures ?? 0) }), ton: 'calme' };
  if (r.id === 'base') return { texte: dire(`${A}.maintenant.base`), ton: 'calme' };
  if (r.id === 'installation' && d.faits.enLigne) return { texte: dire(`${A}.maintenant.version`, { version: nomDeVersion(d.faits.enLigne.version, d.numeros) }), ton: 'calme' };
  const f = faitDeRegle(r.id, { ...d.faits, aujourdhui: d.aujourdhui });
  return f ? { texte: f.texte, ton: 'calme', ...(f.donnee ? { donnee: true } : {}) } : { texte: dire(`${A}.maintenant.rien`), ton: 'calme' };
}
function MenuRegle({ r, faire, voirHistoire }: { r: Regle; faire: (g: Geste) => void; voirHistoire: () => void }) {
  const grave = r.ouvertes.some((o) => o.grave);
  return (
    <MenuLigne etiquette={dire(`${A}.regles.menu`, { regle: nomRegle(r.id) })} actions={[
      r.sourdine
        ? { icone: 'cloche', titre: titre(`${A}.regles.action.lever`), sous: phrase(`${A}.regles.action.lever_sous`), faire: () => faire({ sorte: 'lever', regle: r.id, sourdine: r.sourdine as Sourdine }) }
        : { icone: 'sourdine', titre: titre(`${A}.regles.action.sourdine`), sous: phrase(`${A}.regles.action.sourdine_sous`), faire: () => faire({ sorte: 'sourdine', regle: r.id, grave }) },
      { icone: 'journal', titre: titre(`${A}.regles.action.histoire`), sous: phrase(`${A}.regles.action.histoire_sous`), faire: voirHistoire },
    ]} />
  );
}
// Un filtre qui raccourcit une liste au bas de la page fait remonter la page : ses pilules glissaient de 90 px sous la
// souris, et le clic suivant tombait sur le titre. La carte garde la plus grande hauteur qu'elle a eue, jusqu'à ce que
// ce qu'elle montre change de sujet (`cle`) : ce qui répond à un clic ne se déplace pas sous le curseur.
function useHauteurGardee(cle: unknown) {
  const zone = useRef<HTMLElement>(null);
  const [haut, setHaut] = useState(0);
  useEffect(() => { setHaut(0); }, [cle]);
  const garder = () => setHaut((h) => Math.max(h, zone.current?.offsetHeight ?? 0));
  return { zone, style: haut ? { minHeight: haut } : undefined, garder };
}
function Regles({ d, faire, voirHistoire }: { d: Donnees; faire: (g: Geste) => void; voirHistoire: (regle: string) => void }) {
  const [filtre, setFiltre] = useState<FiltreRegles>('toutes');
  const stable = useHauteurGardee(null);
  const garde = (f: FiltreRegles, r: Regle) => f === 'toutes' || (f === 'branchees' ? r.branchee : !r.branchee);
  const montrees = d.regles.filter((r) => garde(filtre, r));
  const branchees = d.regles.filter((r) => r.branchee).length;
  return (
    <section ref={stable.zone} className="c-carte c-liste-carte c-al-regles" aria-labelledby="al-regles" style={stable.style}>
      <div className="c-al-section-tete">
        <div>
          <h2 id="al-regles">{titre(`${A}.regles.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${A}.regles.sous`)}</p>
        </div>
        <div className="c-pilules c-sv-filtres" role="group" aria-label={dire(`${A}.regles.filtres`)}>
          {FILTRES_REGLES.map((f) => (
            <button key={f} type="button" className="c-pilule" aria-pressed={filtre === f} onClick={() => { stable.garder(); setFiltre(f); }}>
              {titre(`${A}.regles.filtre.${f}`)}<span className="c-pilule-n">{entier(d.regles.filter((r) => garde(f, r)).length)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="c-defile">
        <table className="c-table c-al-table c-al-t-regles">
          <thead>
            <tr>
              <th scope="col">{titre(`${A}.regles.col.regle`)}</th>
              <th scope="col">{titre(`${A}.regles.col.parle`)}</th>
              <th scope="col">{titre(`${A}.regles.col.maintenant`)}</th>
              <th scope="col">{titre(`${A}.regles.col.derniere`)}</th>
              <th scope="col">{titre(`${A}.regles.col.etat`)}</th>
              <th scope="col"><span className="c-cache">{titre(`${A}.regles.col.actions`)}</span></th>
            </tr>
          </thead>
          <tbody>
            {montrees.map((r) => {
              const v = seuilsEnMots(r.seuils);
              const m = maintenant(r, d);
              const der = r.derniere;
              return (
                <tr key={r.id} className={r.branchee ? undefined : 'c-al-prevue'}>
                  <td>
                    <div className="c-al-regle">
                      <span className={`c-al-regle-icone c-ton-${r.etat === 'grave' ? 'grave' : r.etat === 'attention' ? 'attention' : r.etat === 'calme' ? 'bon' : 'non'}`} aria-hidden="true">
                        <Icone nom={r.brique ? ICONE_BRIQUE[r.brique] : 'info'} taille={16} />
                      </span>
                      <div><b>{maj(nomRegle(r.id))}</b><span className="c-sous">{maj(dire(`${K}.regle.${r.id}.regarde`, v))}</span></div>
                    </div>
                  </td>
                  <td data-libelle={titre(`${A}.regles.col.parle`)}>{maj(dire(`${K}.regle.${r.id}.parle`, v))}</td>
                  <td data-libelle={titre(`${A}.regles.col.maintenant`)}>
                    <span className={`c-al-maintenant c-al-maintenant-${m.ton}`} {...(m.donnee ? { 'data-donnee': true } : {})}>{enTitre(m.texte)}</span>
                    {r.sourdine ? <span className="c-al-sourdine"><Icone nom="sourdine" taille={14} />{dire(`${A}.regles.sourdine`, { heure: moment(r.sourdine.fin, d.aujourdhui) })}</span> : null}
                  </td>
                  <td data-libelle={titre(`${A}.regles.col.derniere`)}>
                    {!r.branchee ? '—' : !der ? maj(dire(`${A}.regles.jamais`))
                      : der.fin === null ? maj(dire(`${A}.regles.derniere_ouverte`)) : (
                        <>
                          <span className="c-al-nw">{maj(quand(der.debut, d.aujourdhui))}</span>
                          <span className="c-sous">{dire(`${A}.regles.a_dure`, { duree: minutes(depuisMinutes(der.debut, der.fin)) })}</span>
                        </>
                      )}
                  </td>
                  <td data-libelle={titre(`${A}.regles.col.etat`)}><Puce ton={PUCE_REGLE[r.etat]}>{dire(`${A}.regles.etat.${r.etat}`)}</Puce></td>
                  <td className="c-droite c-al-menu">{r.branchee ? <MenuRegle r={r} faire={faire} voirHistoire={() => voirHistoire(r.id)} /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="c-liste-pied">{phrase(`${A}.regles.pied`, { branchees, prevues: d.regles.length - branchees })}</p>
    </section>
  );
}

// ── Les trente derniers jours ───────────────────────────────────────────────────────────────────────────────────────
const FILTRES_HISTOIRE = ['toutes', 'graves', 'seules'] as const;
type FiltreHistoire = (typeof FILTRES_HISTOIRE)[number];
const PAR_PAGE = 10;
function Histoire({ d, regle, oublierRegle }: { d: Donnees; regle: string | null; oublierRegle: () => void }) {
  const [filtre, setFiltre] = useState<FiltreHistoire>('toutes');
  const stable = useHauteurGardee(regle);
  const [n, setN] = useState(PAR_PAGE);
  useEffect(() => { setN(PAR_PAGE); }, [filtre, regle]);
  const garde = (f: FiltreHistoire, h: Passee) => (regle === null || h.regle === regle) && (f === 'toutes' || (f === 'graves' ? h.grave : h.reglee === 'seule'));
  const choisies = d.histoire.filter((h) => garde(filtre, h));
  return (
    <section ref={stable.zone} className="c-carte c-liste-carte c-al-histoire" id="al-histoire" aria-labelledby="al-histoire-titre" tabIndex={-1} style={stable.style}>
      <div className="c-al-section-tete">
        <div>
          <h2 id="al-histoire-titre">{titre(`${A}.histoire.titre`)}</h2>
          <p className="c-carte-sous">{phrase(`${A}.histoire.sous`)}</p>
        </div>
        <div className="c-pilules c-sv-filtres" role="group" aria-label={dire(`${A}.histoire.filtres`)}>
          {FILTRES_HISTOIRE.map((f) => (
            <button key={f} type="button" className="c-pilule" aria-pressed={filtre === f} onClick={() => { stable.garder(); setFiltre(f); }}>
              {titre(`${A}.histoire.filtre.${f}`)}<span className="c-pilule-n">{entier(d.histoire.filter((h) => garde(f, h)).length)}</span>
            </button>
          ))}
          {regle ? (
            <button type="button" className="c-pilule c-al-filtre-regle" aria-pressed="true" onClick={oublierRegle} aria-label={dire(`${A}.histoire.filtre.regle_retirer`)}>
              {titre(`${A}.histoire.filtre.regle`, { regle: nomRegle(regle) })}<Icone nom="croix" taille={14} />
            </button>
          ) : null}
        </div>
      </div>
      {choisies.length === 0 ? <Vide icone="ok">{phrase(`${A}.histoire.${d.histoire.length ? 'vide_filtre' : 'vide'}`)}</Vide> : (
        <div className="c-defile">
          <table className="c-table c-al-table c-al-t-histoire">
            <thead>
              <tr>
                <th scope="col">{titre(`${A}.histoire.col.quand`)}</th>
                <th scope="col">{titre(`${A}.histoire.col.alerte`)}</th>
                <th scope="col">{titre(`${A}.histoire.col.gravite`)}</th>
                <th scope="col">{titre(`${A}.histoire.col.duree`)}</th>
                <th scope="col">{titre(`${A}.histoire.col.comment`)}</th>
              </tr>
            </thead>
            <tbody>
              {choisies.slice(0, n).map((h) => (
                <tr key={h.id}>
                  <td className="c-al-nw">{maj(quand(h.debut, d.aujourdhui))}</td>
                  <td><b data-donnee>{enTitre(h.titre)}</b>{h.regle && !regle ? <span className="c-sous">{maj(nomRegle(h.regle))}</span> : null}</td>
                  <td data-libelle={titre(`${A}.histoire.col.gravite`)}><Puce ton={h.grave ? 'urgent' : 'en_retard'}>{dire(`${A}.histoire.${h.grave ? 'grave' : 'normale'}`)}</Puce></td>
                  <td className="c-al-nw c-num" data-libelle={titre(`${A}.histoire.col.duree`)}>{minutes(h.minutes)}{h.fin === null ? <span className="c-sous">{dire(`${A}.histoire.jusqua_maintenant`)}</span> : null}</td>
                  <td data-libelle={titre(`${A}.histoire.col.comment`)}>
                    {maj(h.reglee === 'seule' ? dire(`${A}.histoire.seule`)
                      : h.reglee === 'prise' ? dire(`${A}.histoire.prise`, { nom: h.prise?.par ?? '—' })
                        : h.prise ? dire(`${A}.histoire.en_cours_prise`, { nom: h.prise.par }) : dire(`${A}.histoire.en_cours`))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {choisies.length > n ? (
        <div className="c-liste-pied"><Bouton petit ton="discret" onClick={() => setN(n + PAR_PAGE)}>{titre(`${A}.histoire.plus`, { n: Math.min(PAR_PAGE, choisies.length - n) })}</Bouton></div>
      ) : null}
    </section>
  );
}

// ── Les gestes : chacun dit ce qui va se passer, demande son motif, et entre au journal ─────────────────────────────
const DUREES = [60, 120, 240, 1440] as const;
function FenetreGeste({ g, d, fermer, fait }: { g: Geste; d: Donnees; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [motif, setMotif] = useState('');
  const [duree, setDuree] = useState<number>(60);
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const max = g.sorte === 'sourdine' && g.grave ? d.rythme.sourdineGraveH * 60 : 1440;
  // La fin annoncée se compte depuis l'ouverture de la fenêtre (la page a pu être lue une minute plus tôt) ; une fois la
  // sourdine posée, c'est celle du serveur qui se dit.
  const [ouverteLe] = useState(() => Date.now());
  const fin = new Date(ouverteLe + duree * 60_000).toISOString();
  const dureeEnMots = (m: number) => (m % 60 ? dire(`${A}.duree.m`, { n: m }) : m === 60 ? dire(`${A}.duree.h1`) : dire(`${A}.duree.h`, { n: m / 60 }));

  const envoyer = () => {
    if (motif.trim().length < 3) { setRefus(phrase('console.ecran.geste.motif_court')); setFaute((x) => x + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const corps = { motif: motif.trim() };
        const r = g.sorte === 'prendre' ? await api('POST', `/console/service/alertes/${g.a.id}/prendre`, corps)
          : g.sorte === 'sourdine' ? await api('POST', '/console/service/sourdines', { ...corps, regle: g.regle, minutes: duree })
            : g.sorte === 'lever' ? await api('POST', `/console/service/sourdines/${g.sourdine.id}/lever`, corps)
              : await api('POST', '/console/service/essai', corps);
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) {
          const finPosee = (r.corps as { fin?: unknown }).fin;
          toast(phrase(`${A}.geste.${g.sorte}.fait`, g.sorte === 'sourdine' ? { heure: moment(typeof finPosee === 'string' ? finPosee : fin, d.aujourdhui) } : {}));
          fait();
          return;
        }
        setRefus(refusDe(r));
        if (r.corps.champ === 'motif') setFaute((x) => x + 1);
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };

  const nom = titre(`${A}.geste.${g.sorte}.titre`);
  const sous = g.sorte === 'prendre' ? enTitre(g.a.titre)
    : g.sorte === 'essai' ? phrase(`${A}.geste.essai.sous`) : maj(dire(`${A}.regle_de`, { regle: nomRegle(g.regle) }));
  const points = g.sorte === 'prendre' ? [phrase(`${A}.geste.prendre.p1`), phrase(`${A}.geste.prendre.p2`, { h: d.rythme.rappelH }), phrase(`${A}.geste.prendre.p3`)]
    : g.sorte === 'sourdine' ? [phrase(`${A}.geste.sourdine.p1`), phrase(`${A}.geste.sourdine.p2`), phrase(`${A}.geste.sourdine.p3`, { h: d.rythme.sourdineGraveH })]
      : g.sorte === 'lever' ? [phrase(`${A}.geste.lever.p1`), phrase(`${A}.geste.lever.p2`)]
        : [phrase(`${A}.geste.essai.p1`), phrase(`${A}.geste.essai.p2`), phrase(`${A}.geste.essai.p3`)];
  const reprise = g.sorte === 'prendre' && g.a.prise ? phrase(`${A}.geste.prendre.reprise`, { nom: g.a.prise.par }) : null;
  return (
    <Dialogue titre={nom} sous={sous} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${A}.geste.${g.sorte}.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre(`${A}.geste.ce_qui_va`)}</span>
        <ul>
          {reprise ? <li className="c-al-reprise">{reprise}</li> : null}
          {points.map((x) => <li key={x}>{x}</li>)}
        </ul>
      </div>
      {g.sorte === 'sourdine' ? (
        <div className="c-champ">
          <span className="c-champ-libelle" id="al-duree">{titre(`${A}.geste.sourdine.duree`)}</span>
          <div className="c-pilules c-al-durees" role="group" aria-labelledby="al-duree">
            {DUREES.filter((x) => x <= max).map((x) => (
              <button key={x} type="button" className="c-pilule" aria-pressed={duree === x} onClick={() => setDuree(x)}>{dureeEnMots(x)}</button>
            ))}
          </div>
          <span className="c-champ-aide">{phrase(max < 1440 ? `${A}.geste.sourdine.duree_aide_grave` : `${A}.geste.sourdine.duree_aide`, { h: d.rythme.sourdineGraveH, heure: moment(fin, d.aujourdhui) })}</span>
        </div>
      ) : null}
      <Zone libelle={titre('console.ecran.geste.motif')} aide={phrase(`${A}.geste.${g.sorte}.motif_aide`)} valeur={motif} changer={setMotif} faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase(`${A}.geste.qui`, { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Alertes() {
  const [l, relire] = useLecture<Donnees>('/console/service/alertes', 'service-alertes');
  useRelireTantQueRegarde(relire);
  const [geste, setGeste] = useState<Geste | null>(null);
  const [regle, setRegle] = useState<string | null>(null);
  const d = l.etat === 'lu' ? l.donnees : null;
  const voirHistoire = (r: string) => {
    setRegle(r);
    requestAnimationFrame(() => { const h = document.getElementById('al-histoire'); h?.scrollIntoView({ block: 'start' }); h?.focus({ preventScroll: true }); });
  };
  const v = d?.veille;
  return (
    <>
      <EnteteService vue="alertes" d={d} relire={relire} occupe={l.etat === 'lu' && l.enCours} />
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {d && v ? (
        <>
          {v.etat === 'absente' ? <Alerte ton="attention" icone="serveur"><span>{phrase(`${A}.veille_absente`)}</span></Alerte> : null}
          {v.etat === 'silencieuse' ? <Alerte ton="danger"><span>{phrase(`${A}.veille_silencieuse`, { quand: quand(v.derniere, d.aujourdhui) })}</span></Alerte> : null}
          {d.enCours.length ? d.enCours.map((a, k) => (
            <CarteAlerte key={a.id} a={a} d={d} faire={setGeste} principale={a.id === d.enCours.find((x) => !x.prise)?.id} premiere={k === 0} />
          ))
            : v.etat === 'ok' ? <AucuneAlerte d={d} /> : null}
          <div className="c-al-duo">
            <QuiEstPrevenu d={d} essai={() => setGeste({ sorte: 'essai' })} />
            <Rythme d={d} />
          </div>
          <Regles d={d} faire={setGeste} voirHistoire={voirHistoire} />
          <Histoire d={d} regle={regle} oublierRegle={() => setRegle(null)} />
        </>
      ) : null}
      {geste && d ? <FenetreGeste g={geste} d={d} fermer={() => setGeste(null)} fait={() => { setGeste(null); relire(); }} /> : null}
    </>
  );
}
