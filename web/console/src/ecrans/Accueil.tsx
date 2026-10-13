// L'accueil de la console (serveur/console/decider.ts) : le tableau du matin, puis « À décider ». Trois règles, tenues
// par le serveur et dites ici telles quelles : chaque chiffre ouvre la liste qu'il compte (C3) ; rien n'est vert sans
// mesure, ce que la console ne mesure pas encore le dit avec sa raison (C2) ; une console où rien ne se passe affiche une
// liste vide, et le dit. La technique n'y lit que le service ; le support, que les clients.
import { useEffect, useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { useConsole, useLecture, type Role } from '../contexte.ts';
import { dans, jourCourt, jourLong, quand } from '../temps.ts';
import { Alerte, Bouton, Icone, Lien, maj, Puce, Vide, type NomIcone, type TonPuce } from '../ui.tsx';

type Mesure = { mesure: true; n: number } | { mesure: false; raison: 'paiements_a_venir' | 'support_a_venir' };
type Service = { etat: 'ok' } | { etat: 'problemes'; n: number; graves: number } | { etat: 'non_mesure'; raison: 'pas_de_veille' | 'veille_silencieuse'; derniere?: string };
type Tableau = {
  entreprisesDeLaSemaine: number; essais: number; actifs: { total: number; essentiel: number; complet: number };
  enRetard: number; lectureSeule: number; revenusDuMois: Mesure; support: Mesure; service: Service;
};
type Qui = { id: string; nom: string };
export type Ligne =
  | { sorte: 'service'; ouvre: 'service'; cle: string; titre: string; faire: string; depuis: string; grave: boolean }
  | { sorte: 'veille_silencieuse'; ouvre: 'service'; derniere: string }
  | { sorte: 'en_retard'; ouvre: 'fiche'; entreprise: Qui; echeance: string; lectureSeuleLe: string; jours: number; apresEssai: boolean }
  | { sorte: 'lecture_seule'; ouvre: 'fiche'; entreprise: Qui; depuis: string; raison: 'essai_termine' | 'non_renouvele' | 'resilie' | 'suspendu' }
  | { sorte: 'essai_sans_usage'; ouvre: 'fiche'; entreprise: Qui; jusquAu: string; jours: number; proprietaire: { nom: string; email: string } | null };
type RelancePartie = { entreprise: Qui; rang: 'j15' | 'j7' | 'j1' | 'lecture_seule'; partieLe: string };
type Accueil = { aujourdhui: string; role: Role; tableau: Partial<Tableau> & { service: Service }; decider: Ligne[]; relances?: RelancePartie[] };

// ── Le tableau du matin ─────────────────────────────────────────────────────────────────────────────────────────────
// `mot` : une valeur qui est un mot (« non mesuré », « rien à signaler ») et non un nombre : elle se dit en lettres.
function Tuile({ titre: t, valeur, sous, href, mot, point }: { titre: string; valeur: string; sous: string; href?: string; mot?: 'attente' | 'ok'; point?: 'ok' | 'pb' }) {
  const corps = (
    <>
      <span className="c-tuile-titre">{t}</span>
      <span className={mot ? `c-tuile-mot c-tuile-mot-${mot}` : 'c-tuile-valeur'}>
        {point ? <span className={`c-tuile-point${point === 'ok' ? ' c-ok' : ''}`} aria-hidden="true" /> : null}
        {valeur}
      </span>
      <span className="c-tuile-sous">{sous}</span>
    </>
  );
  return href ? <a className="c-tuile" href={href}>{corps}</a> : <div className="c-tuile">{corps}</div>;
}

function TuileService({ s, aujourdhui }: { s: Service; aujourdhui: string }) {
  const t = titre('console.ecran.tableau.service');
  if (s.etat === 'ok') return <Tuile titre={t} valeur={titre('console.ecran.tableau.service_ok')} sous={titre('console.ecran.tableau.service_ok_sous')} href="#/service" point="ok" mot="ok" />;
  if (s.etat === 'problemes') {
    const graves = s.graves === 0 ? dire('console.ecran.tableau.aucun_grave') : s.graves === 1 ? dire('console.ecran.tableau.un_grave') : dire('console.ecran.tableau.graves', { n: s.graves });
    return <Tuile titre={t} valeur={String(s.n)} sous={`${titre(s.n === 1 ? 'console.ecran.tableau.probleme' : 'console.ecran.tableau.problemes')}, ${graves}`} href="#/service/alertes" point="pb" />;
  }
  const sous = s.raison === 'pas_de_veille' ? titre('console.ecran.tableau.pas_de_veille')
    : titre('console.ecran.tableau.veille_silencieuse', { quand: s.derniere ? quand(s.derniere, aujourdhui) : '—' });
  return <Tuile titre={t} valeur={dire('console.ecran.tableau.non_mesure')} sous={sous} href="#/service" mot="attente" />;
}

function TableauDuMatin({ t, role, aujourdhui }: { t: Accueil['tableau']; role: Role; aujourdhui: string }) {
  const nonMesure = (m: Mesure | undefined) => (m && !m.mesure ? titre(`console.ecran.tableau.${m.raison}`) : '');
  return (
    <section className="c-matin" aria-labelledby="matin-titre">
      <div className="c-matin-tete">
        <h2 id="matin-titre">{titre('console.ecran.tableau.titre')}</h2>
        <p>{phrase('console.ecran.tableau.sous')}</p>
      </div>
      <div className="c-tuiles">
        {role !== 'technique' && t.actifs ? (
          <>
            <Tuile titre={titre('console.ecran.tableau.inscriptions')} valeur={String(t.entreprisesDeLaSemaine ?? 0)} sous={titre('console.ecran.tableau.inscriptions_sous')} href="#/clients?nouvelles=1" />
            <Tuile titre={titre('console.ecran.tableau.essais')} valeur={String(t.essais ?? 0)} sous={titre('console.ecran.tableau.essais_sous')} href="#/clients?etat=essai" />
            <Tuile titre={titre('console.ecran.tableau.actifs')} valeur={String(t.actifs.total)} sous={dire('console.ecran.tableau.actifs_sous', { e: t.actifs.essentiel, c: t.actifs.complet })} href="#/clients?etat=actif" />
            <Tuile titre={titre('console.ecran.tableau.en_retard')} valeur={String(t.enRetard ?? 0)} sous={titre('console.ecran.tableau.en_retard_sous')} href="#/clients?etat=en_retard" />
            <Tuile titre={titre('console.ecran.tableau.lecture_seule')} valeur={String(t.lectureSeule ?? 0)} sous={titre('console.ecran.tableau.lecture_seule_sous')} href="#/clients?etat=lecture_seule" />
            {/* Ce que la console ne mesure pas encore : une seule tuile, qui dit chaque raison (C2), plutôt que deux « non mesuré ». */}
            <div className="c-tuile c-tuile-large">
              <span className="c-tuile-titre">{titre('console.ecran.tableau.pas_encore')}</span>
              <span className="c-tuile-mot c-tuile-mot-attente">{dire('console.ecran.tableau.non_mesure')}</span>
              <span className="c-tuile-sous">{titre('console.ecran.tableau.revenus')} : {nonMesure(t.revenusDuMois).toLowerCase()} · {titre('console.ecran.tableau.support')} : {nonMesure(t.support).toLowerCase()}</span>
            </div>
          </>
        ) : null}
        {role !== 'support' ? <TuileService s={t.service} aujourdhui={aujourdhui} /> : null}
      </div>
    </section>
  );
}

// ── « À décider » ───────────────────────────────────────────────────────────────────────────────────────────────────
type Urgence = 'urgent' | 'aujourdhui' | 'semaine' | 'a_regarder';
type Vue = { icone: NomIcone; titre: string; desc: string; meta: string | null; urgence: Urgence; href: string; bouton: string };

function voir(l: Ligne, aujourdhui: string): Vue {
  const fiche = (q: Qui) => `#/clients/${q.id}`;
  switch (l.sorte) {
    case 'service':
      return { icone: 'serveur', titre: maj(l.titre), desc: l.faire, meta: titre('console.ecran.decider.service_depuis', { quand: l.depuis ? quand(l.depuis, aujourdhui) : '—' }), urgence: l.grave ? 'urgent' : 'a_regarder', href: '#/service/alertes', bouton: titre('console.ecran.decider.ouvrir_alerte') };
    case 'veille_silencieuse':
      return { icone: 'alerte', titre: titre('console.ecran.decider.veille_titre'), desc: phrase('console.ecran.decider.veille', { quand: quand(l.derniere, aujourdhui) }), meta: null, urgence: 'urgent', href: '#/service', bouton: titre('console.ecran.decider.ouvrir_service') };
    case 'en_retard':
      return { icone: 'calendrier', titre: titre('console.ecran.decider.retard_titre', { nom: l.entreprise.nom }),
        desc: phrase(l.apresEssai ? 'console.ecran.decider.retard_essai' : 'console.ecran.decider.retard_abonnement', { echeance: jourCourt(l.echeance), le: jourCourt(l.lectureSeuleLe), dans: dans(l.lectureSeuleLe, aujourdhui) }),
        meta: null, urgence: l.jours <= 2 ? 'urgent' : 'semaine', href: fiche(l.entreprise), bouton: titre('console.ecran.decider.ouvrir_fiche') };
    case 'lecture_seule':
      return { icone: 'cadenas', titre: titre('console.ecran.decider.lecture_titre', { nom: l.entreprise.nom }), desc: phrase(`console.ecran.decider.lecture.${l.raison}`, { le: jourCourt(l.depuis) }),
        meta: null, urgence: l.depuis === aujourdhui ? 'aujourdhui' : 'semaine', href: fiche(l.entreprise), bouton: titre('console.ecran.decider.ouvrir_fiche') };
    default:
      return { icone: 'sablier', titre: titre('console.ecran.decider.sans_usage_titre', { nom: l.entreprise.nom }),
        desc: phrase('console.ecran.decider.sans_usage', { le: jourCourt(l.jusquAu), dans: dans(l.jusquAu, aujourdhui) }),
        meta: l.proprietaire ? titre('console.ecran.decider.a_appeler', { nom: l.proprietaire.nom, email: l.proprietaire.email }) : null,
        urgence: l.jours <= 1 ? 'aujourdhui' : 'semaine', href: fiche(l.entreprise), bouton: titre('console.ecran.decider.ouvrir_fiche') };
  }
}

const estService = (l: Ligne) => l.ouvre === 'service';

function ADecider({ lignes, role, aujourdhui }: { lignes: Ligne[]; role: Role; aujourdhui: string }) {
  const [filtre, setFiltre] = useState<'tout' | 'service' | 'clients'>('tout');
  const nService = lignes.filter(estService).length;
  const nClients = lignes.length - nService;
  const gardees = lignes.filter((l) => filtre === 'tout' || (filtre === 'service') === estService(l));
  const pilules: { v: 'tout' | 'service' | 'clients'; n: number; texte: string }[] = [
    { v: 'tout', n: lignes.length, texte: titre('console.ecran.decider.tout') },
    ...(nService && nClients ? [{ v: 'service' as const, n: nService, texte: titre('console.ecran.decider.filtre_service') }, { v: 'clients' as const, n: nClients, texte: titre('console.ecran.decider.filtre_clients') }] : []),
  ];
  return (
    <section className="c-carte c-decider" aria-labelledby="decider-titre">
      <div className="c-carte-tete">
        <div>
          <h2 id="decider-titre">{titre('console.ecran.decider.titre')} <span className="c-compte-titre">{lignes.length}</span></h2>
          <p className="c-carte-sous">{phrase('console.ecran.decider.sous')}</p>
        </div>
      </div>
      {lignes.length ? (
        <>
          {pilules.length > 1 ? (
            <div className="c-pilules" role="group">
              {pilules.map((p) => (
                <button key={p.v} type="button" className="c-pilule" aria-pressed={filtre === p.v} onClick={() => setFiltre(p.v)}>
                  {p.texte} <span className="c-pilule-n">{p.n}</span>
                </button>
              ))}
            </div>
          ) : null}
          <ul className="c-lignes">
            {gardees.map((l) => {
              const v = voir(l, aujourdhui);
              const ton: TonPuce = v.urgence;
              const donnee = l.sorte === 'service';
              return (
                <li key={l.sorte === 'service' ? `service-${l.cle}` : l.sorte === 'veille_silencieuse' ? 'veille' : `${l.sorte}-${l.entreprise.id}`} className="c-ligne-decision">
                  <span className={`c-ligne-icone c-${v.urgence}`}><Icone nom={v.icone} /></span>
                  <div className="c-ligne-texte">
                    <span className="c-ligne-titre"><span {...(donnee ? { 'data-donnee': true } : {})}>{v.titre}</span> <Puce ton={ton}>{titre(`console.ecran.urgence.${v.urgence}`)}</Puce></span>
                    <span className="c-ligne-desc" {...(donnee ? { 'data-donnee': true } : {})}>{v.desc}</span>
                    {v.meta ? <span className="c-ligne-meta">{v.meta}</span> : null}
                  </div>
                  <Lien href={v.href} ton={v.urgence === 'urgent' ? 'principal' : 'secondaire'} petit fleche>{v.bouton}</Lien>
                </li>
              );
            })}
          </ul>
        </>
      ) : <Vide>{phrase(`console.ecran.decider.vide_${role}`)}</Vide>}
    </section>
  );
}

// ── Les relances parties depuis hier ───────────────────────────────────────────────────────────────────────────────
// Ce que le serveur a fait tout seul : la console le montre pour que personne ne relance une seconde fois à la main.
function Relances({ liste, aujourdhui }: { liste: RelancePartie[]; aujourdhui: string }) {
  return (
    <section className="c-carte c-relances" aria-labelledby="relances-titre">
      <h2 id="relances-titre">{titre('console.ecran.relances.titre')}</h2>
      <p className="c-carte-sous">{phrase('console.ecran.relances.sous')}</p>
      {liste.length ? (
        <ul className="c-relances-liste">
          {liste.map((r) => (
            <li key={`${r.entreprise.id}-${r.rang}`}>
              <div>
                <a href={`#/clients/${r.entreprise.id}`}><b data-donnee>{r.entreprise.nom}</b></a>
                <span className="c-sous">{maj(r.rang === 'j15' || r.rang === 'j7'
                  ? dire('console.ecran.abonnements.rang_long.jours', { n: r.rang === 'j15' ? 15 : 7 })
                  : dire(`console.ecran.abonnements.rang_long.${r.rang}`))}</span>
              </div>
              <span className="c-relances-quand">{titre('console.ecran.relances.partie')}<span className="c-sous">{maj(quand(r.partieLe, aujourdhui))}</span></span>
            </li>
          ))}
        </ul>
      ) : <p className="c-relances-vide">{phrase('console.ecran.relances.vide')}</p>}
      <p className="c-relances-pied">{phrase('console.ecran.relances.pied')}</p>
    </section>
  );
}

export function Accueil() {
  const { moi, compterDecisions } = useConsole();
  const [l, relire] = useLecture<Accueil>('/console/accueil');
  const lu = l.etat === 'lu' ? l.donnees : null;
  useEffect(() => { if (lu) compterDecisions(lu.decider.length); }, [lu, compterDecisions]);
  const prenom = moi.nom.split(/\s+/)[0] ?? moi.nom;
  const aujourdhui = lu?.aujourdhui ?? moi.aujourdhui;
  const n = lu?.decider.length ?? 0;
  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <span className="c-surtitre" data-donnee>{jourLong(aujourdhui)}</span>
          <h1>{titre('console.ecran.accueil.bonjour', { nom: prenom })}</h1>
          {lu ? <p className="c-entete-sous">{n === 0 ? phrase('console.ecran.accueil.aucune_decision') : n === 1 ? phrase('console.ecran.accueil.une_decision') : phrase('console.ecran.accueil.n_decisions', { n })}</p> : null}
        </div>
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {lu ? (
        <>
          <TableauDuMatin t={lu.tableau} role={lu.role} aujourdhui={aujourdhui} />
          {lu.role === 'technique' ? <ADecider lignes={lu.decider} role={lu.role} aujourdhui={aujourdhui} /> : (
            <div className="c-accueil-bas">
              <ADecider lignes={lu.decider} role={lu.role} aujourdhui={aujourdhui} />
              <Relances liste={lu.relances ?? []} aujourdhui={aujourdhui} />
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
