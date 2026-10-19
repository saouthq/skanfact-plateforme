// L'accueil de la console (serveur/console/decider.ts) : le tableau du matin, puis « À décider ». Trois règles, tenues
// par le serveur et dites ici telles quelles : chaque chiffre ouvre la liste qu'il compte (C3) ; rien n'est vert sans
// mesure, ce que la console ne mesure pas encore le dit avec sa raison (C2) ; une console où rien ne se passe affiche une
// liste vide, et le dit. La technique n'y lit que le service ; le support, que les clients.
import { useEffect, useState, type CSSProperties } from 'react';
import { dire, phrase, selon, titre } from '../langue.ts';
import { useConsole, useLecture, type Role } from '../contexte.ts';
import { dans, heureDe, jourCourt, jourDe, jourLong, quand } from '../temps.ts';
import { montant } from '../argent.ts';
import { Alerte, Bouton, Icone, Lien, maj, Puce, Vide, type NomIcone, type TonPuce } from '../ui.tsx';
import type { Canal } from './Support.tsx';
import { sortieAttendEnMots, type Etape } from './Sortie.tsx';

// L'encaissé du mois (docs/console.md C30) : un montant, ou « non mesuré » avec sa raison ; la direction seule le reçoit.
type Mesure = { mesure: true; montant: string; devise: string; reglements: number } | { mesure: false; raison: 'editeur_absent' };
type Support = { ouvertes: number; aRepondre: number; sansReponse: number; attenteMax: number | null };
type Service = { etat: 'ok' } | { etat: 'problemes'; n: number; graves: number } | { etat: 'non_mesure'; raison: 'pas_de_veille' | 'veille_silencieuse'; derniere?: string };
type Tableau = {
  entreprisesDeLaSemaine: number; essais: number; actifs: { total: number; essentiel: number; complet: number };
  enRetard: number; lectureSeule: number; revenusDuMois?: Mesure; support: Support; service: Service;
};
type Qui = { id: string; nom: string };
export type Ligne =
  | { sorte: 'service'; ouvre: 'service'; cle: string; titre: string; faire: string; depuis: string; grave: boolean }
  // 0130 : un secret à renouveler bientôt, ou en retard (jamais sa valeur).
  | { sorte: 'secret'; ouvre: 'service'; nom: string; echeance: string; jours: number }
  | { sorte: 'veille_silencieuse'; ouvre: 'service'; derniere: string }
  // 0135 : un accès d'urgence qui attend, ou qui a servi cette semaine (la direction seule).
  | { sorte: 'urgence'; ouvre: 'equipe'; id: string; nom: string; etat: 'attend' | 'servi'; ouvertLe: string; jusqua: string; serviLe: string | null; par: string | null; machine: boolean }
  | { sorte: 'en_retard'; ouvre: 'fiche'; entreprise: Qui; echeance: string; lectureSeuleLe: string; jours: number; apresEssai: boolean }
  | { sorte: 'lecture_seule'; ouvre: 'fiche'; entreprise: Qui; depuis: string; raison: 'essai_termine' | 'non_renouvele' | 'resilie' | 'suspendu' }
  | { sorte: 'essai_sans_usage'; ouvre: 'fiche'; entreprise: Qui; jusquAu: string; jours: number; proprietaire: { nom: string; email: string } | null }
  | { sorte: 'support'; ouvre: 'support'; demande: { id: string; numero: number; sujet: string; canal: Canal }; entreprise: Qui; demandeur: string; heures: number; depuis: string }
  // L'argent (0113), pour la direction : une facture payée puis défaite, une facture qui attend d'être émise, un trop-perçu.
  | { sorte: 'facture_defaite'; ouvre: 'fiche'; entreprise: Qui; numero: string | null; payeeLe: string; fin: string; ecran: string; cause: 'avoir' | 'reglement'; trop: string | null }
  | { sorte: 'a_emettre'; ouvre: 'facture'; entreprise: Qui; debut: string; fin: string; prepareLe: string; jours: number; ecran: string }
  | { sorte: 'trop_percu'; ouvre: 'paiements'; entreprise: Qui; numero: string | null; trop: string; devise: string; annulee: boolean; ecran: string }
  // 0129 : une facture contestée qui attend sa régularisation depuis une semaine.
  | { sorte: 'contestation'; ouvre: 'fiche'; entreprise: Qui; numero: string | null; ouverteLe: string; jours: number }
  // 0138 : un remboursement déclaré que SkanFact n'a pas encore noté sur la facture.
  | { sorte: 'remboursement_a_noter'; ouvre: 'paiements'; entreprise: Qui; numero: string | null; montant: string; le: string | null }
  // 0131 : la sortie d'un client dont le contrat a pris fin, et ce qui reste à faire.
  | { sorte: 'sortie'; ouvre: 'fiche'; entreprise: Qui; fin: string; jours: number; restantes: Etape[] };
type RelancePartie = { entreprise: Qui; rang: 'j15' | 'j7' | 'j1' | 'lecture_seule'; partieLe: string };
// `calculeLe` : l'instant du calcul de la liste des clients que l'équipe partage (C65) ; aucun pour la technique.
type Accueil = { aujourdhui: string; role: Role; tableau: Partial<Tableau> & { service: Service }; decider: Ligne[]; relances?: RelancePartie[]; calculeLe?: string | null };

// ── Le tableau du matin ─────────────────────────────────────────────────────────────────────────────────────────────
// `mot` : une valeur qui est un mot (« non mesuré », « rien à signaler ») et non un nombre : elle se dit en lettres.
// `donnee` : une valeur qui est une donnée (un montant), pas un texte du catalogue.
// `ajuste` : un montant, dont la taille suit la longueur pour tenir dans la tuile.
function Tuile({ titre: t, valeur, sous, href, mot, point, donnee, ajuste }: { titre: string; valeur: string; sous: string; href?: string; mot?: 'attente' | 'ok'; point?: 'ok' | 'pb'; donnee?: boolean; ajuste?: boolean }) {
  const corps = (
    <>
      <span className="c-tuile-titre">{t}</span>
      <span className={mot ? `c-tuile-mot c-tuile-mot-${mot}` : ajuste ? 'c-tuile-valeur c-tuile-ajuste' : 'c-tuile-valeur'} {...(donnee ? { 'data-donnee': true } : {})}
        {...(ajuste ? { style: { '--n': valeur.length } as CSSProperties } : {})}>
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

// Le support : les demandes ouvertes, et ce qui attend NOTRE réponse depuis plus de 24 h (la promesse au client). La tuile
// ouvre l'écran Support, rangé par la même fonction (C3).
function TuileSupport({ s }: { s: Support }) {
  const suite = s.sansReponse ? selon(s.sansReponse, 'console.ecran.tableau.support_sans_reponse', { h: s.attenteMax ?? 24 })
    : s.aRepondre ? selon(s.aRepondre, 'console.ecran.tableau.support_a_repondre') : dire('console.ecran.tableau.support_a_jour');
  const sous = s.ouvertes === 0 ? titre('console.ecran.tableau.support_vide') : `${maj(selon(s.ouvertes, 'console.ecran.tableau.support_ouvertes'))} · ${suite}`;
  return <Tuile titre={titre('console.ecran.tableau.support')} valeur={String(s.ouvertes)} sous={sous} href="#/support" {...(s.sansReponse ? { point: 'pb' as const } : {})} />;
}

// L'encaissé du mois : le même chiffre que l'écran Paiements, qu'elle ouvre (C3) ; sans entreprise SkanFact désignée, rien
// ne s'encaisse par la plateforme, et la tuile le dit (C2), jamais un zéro.
function TuileRevenus({ m }: { m: Mesure }) {
  const t = titre('console.ecran.tableau.revenus');
  if (!m.mesure) return <Tuile titre={t} valeur={dire('console.ecran.tableau.non_mesure')} sous={titre(`console.ecran.tableau.${m.raison}`)} href="#/reglages?onglet=factures" mot="attente" />;
  const sous = m.reglements ? selon(m.reglements, 'console.ecran.tableau.revenus_reglements') : dire('console.ecran.tableau.revenus_aucun');
  return <Tuile titre={t} valeur={m.devise === 'TND' ? montant(m.montant) : `${m.montant} ${m.devise}`} sous={maj(sous)} href="#/paiements" donnee ajuste />;
}

function TableauDuMatin({ t, role, aujourdhui }: { t: Accueil['tableau']; role: Role; aujourdhui: string }) {
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
            {t.support ? <TuileSupport s={t.support} /> : null}
            {t.revenusDuMois ? <TuileRevenus m={t.revenusDuMois} /> : null}
          </>
        ) : null}
        {role !== 'support' ? <TuileService s={t.service} aujourdhui={aujourdhui} /> : null}
      </div>
    </section>
  );
}

// ── « À décider » ───────────────────────────────────────────────────────────────────────────────────────────────────
type Urgence = 'urgent' | 'aujourdhui' | 'semaine' | 'a_regarder';
type Vue = { icone: NomIcone; titre: string; desc: string; meta: string | null; urgence: Urgence; href: string; bouton: string; ailleurs?: boolean };

// Une facture payée puis défaite, en mots : sa cause dit le geste (0113). Annulée par un avoir et payée quand même, elle
// dit aussi ce qui est à rendre : une seule ligne pour un seul événement.
export function defaiteEnMots(l: { numero: string | null; payeeLe: string; fin: string; cause: 'avoir' | 'reglement'; trop: string | null }): string {
  const v = { numero: l.numero ?? dire('console.ecran.decider.sans_numero'), le: jourCourt(jourDe(l.payeeLe)), fin: jourCourt(l.fin) };
  if (l.cause === 'reglement') return phrase('console.ecran.decider.defaite', v);
  return l.trop ? phrase('console.ecran.decider.defaite_avoir_trop', { ...v, montant: montant(l.trop) }) : phrase('console.ecran.decider.defaite_avoir', v);
}

function voir(l: Ligne, aujourdhui: string): Vue {
  const fiche = (q: Qui) => `#/clients/${q.id}`;
  switch (l.sorte) {
    case 'service':
      return { icone: 'serveur', titre: maj(l.titre), desc: l.faire, meta: titre('console.ecran.decider.service_depuis', { quand: l.depuis ? quand(l.depuis, aujourdhui) : '—' }), urgence: l.grave ? 'urgent' : 'a_regarder', href: '#/service/alertes', bouton: titre('console.ecran.decider.ouvrir_alerte') };
    case 'secret':
      return { icone: 'cadenas', titre: titre(l.jours < 0 ? 'console.ecran.decider.secret_retard_titre' : 'console.ecran.decider.secret_titre', { nom: l.nom }),
        desc: phrase(l.jours < 0 ? 'console.ecran.decider.secret_retard' : 'console.ecran.decider.secret', { n: Math.abs(l.jours), le: jourCourt(l.echeance) }),
        meta: null, urgence: l.jours < 0 ? 'urgent' : 'a_regarder', href: '#/service/securite', bouton: titre('console.ecran.decider.ouvrir_securite') };
    case 'urgence': {
      const qui = l.machine ? dire('console.ecran.decider.urgence_machine') : l.par ?? dire('console.ecran.decider.urgence_quelquun');
      const le = (x: string) => `${jourCourt(jourDe(x))}, ${heureDe(x)}`;
      return { icone: 'cadenas', titre: titre(l.etat === 'attend' ? 'console.ecran.decider.urgence_attend_titre' : 'console.ecran.decider.urgence_servi_titre', { nom: l.nom }),
        desc: phrase(l.etat === 'attend' ? 'console.ecran.decider.urgence_attend' : 'console.ecran.decider.urgence_servi', { qui, le: le(l.ouvertLe), fin: le(l.jusqua), servi: le(l.serviLe ?? l.ouvertLe) }),
        meta: null, urgence: 'a_regarder', href: '#/equipe', bouton: titre('console.ecran.decider.ouvrir_equipe') };
    }
    case 'veille_silencieuse':
      return { icone: 'alerte', titre: titre('console.ecran.decider.veille_titre'), desc: phrase('console.ecran.decider.veille', { quand: quand(l.derniere, aujourdhui) }), meta: null, urgence: 'urgent', href: '#/service', bouton: titre('console.ecran.decider.ouvrir_service') };
    case 'en_retard':
      return { icone: 'calendrier', titre: titre('console.ecran.decider.retard_titre', { nom: l.entreprise.nom }),
        desc: phrase(l.apresEssai ? 'console.ecran.decider.retard_essai' : 'console.ecran.decider.retard_abonnement', { echeance: jourCourt(l.echeance), le: jourCourt(l.lectureSeuleLe), dans: dans(l.lectureSeuleLe, aujourdhui) }),
        meta: null, urgence: l.jours <= 2 ? 'urgent' : 'semaine', href: fiche(l.entreprise), bouton: titre('console.ecran.decider.ouvrir_fiche') };
    case 'lecture_seule':
      return { icone: 'cadenas', titre: titre('console.ecran.decider.lecture_titre', { nom: l.entreprise.nom }), desc: phrase(`console.ecran.decider.lecture.${l.raison}`, { le: jourCourt(l.depuis) }),
        meta: null, urgence: l.depuis === aujourdhui ? 'aujourdhui' : 'semaine', href: fiche(l.entreprise), bouton: titre('console.ecran.decider.ouvrir_fiche') };
    case 'facture_defaite':
      return { icone: 'alerte', titre: titre('console.ecran.decider.defaite_titre', { nom: l.entreprise.nom }),
        desc: defaiteEnMots(l),
        meta: null, urgence: 'aujourdhui', href: `${fiche(l.entreprise)}?onglet=factures`, bouton: titre('console.ecran.decider.ouvrir_fiche') };
    case 'a_emettre':
      return { icone: 'calendrier', titre: titre('console.ecran.decider.a_emettre_titre', { nom: l.entreprise.nom }),
        desc: phrase('console.ecran.decider.a_emettre', { le: jourCourt(l.prepareLe), debut: jourCourt(l.debut), fin: jourCourt(l.fin) }),
        meta: null, urgence: l.debut <= aujourdhui ? 'aujourdhui' : 'semaine', href: l.ecran, bouton: titre('console.ecran.decider.ouvrir_facture'), ailleurs: true };
    case 'contestation':
      return { icone: 'alerte', titre: titre('console.ecran.decider.contestation_titre', { nom: l.entreprise.nom }),
        desc: phrase('console.ecran.decider.contestation', { numero: l.numero ?? dire('console.ecran.decider.sans_numero'), le: jourCourt(l.ouverteLe), n: l.jours }),
        meta: null, urgence: 'a_regarder', href: `${fiche(l.entreprise)}?onglet=factures`, bouton: titre('console.ecran.decider.ouvrir_fiche') };
    case 'remboursement_a_noter':
      return { icone: 'echange', titre: titre('console.ecran.decider.remb_noter_titre', { nom: l.entreprise.nom, montant: montant(l.montant) }),
        desc: phrase('console.ecran.decider.remb_noter', { numero: l.numero ?? dire('console.ecran.decider.sans_numero'), le: jourCourt(l.le) }),
        meta: null, urgence: 'a_regarder', href: '#/paiements', bouton: titre('console.ecran.decider.ouvrir_paiements') };
    case 'trop_percu':
      return { icone: 'alerte', titre: titre('console.ecran.decider.trop_titre', { nom: l.entreprise.nom, montant: montant(l.trop) }),
        desc: phrase(l.annulee ? 'console.ecran.decider.trop_annulee' : 'console.ecran.decider.trop', { numero: l.numero ?? dire('console.ecran.decider.sans_numero') }),
        meta: null, urgence: 'a_regarder', href: '#/paiements', bouton: titre('console.ecran.decider.ouvrir_paiements') };
    case 'sortie':
      return { icone: 'sortir', titre: titre('console.ecran.decider.sortie_titre', { nom: l.entreprise.nom }), desc: sortieAttendEnMots(l),
        meta: null, urgence: 'semaine', href: fiche(l.entreprise), bouton: titre('console.ecran.decider.ouvrir_fiche') };
    case 'support':
      return { icone: 'courriel', titre: titre('console.ecran.decider.support_titre', { nom: l.entreprise.nom, n: l.heures }),
        desc: phrase('console.ecran.decider.support', { sujet: l.demande.sujet, canal: dire(`console.ecran.support.canal.${l.demande.canal}`), qui: l.demandeur }),
        meta: titre('console.ecran.decider.support_depuis', { quand: quand(l.depuis, aujourdhui) }), urgence: 'aujourdhui', href: `#/support?demande=${l.demande.id}`, bouton: titre('console.ecran.decider.repondre') };
    default:
      return { icone: 'sablier', titre: titre('console.ecran.decider.sans_usage_titre', { nom: l.entreprise.nom }),
        desc: phrase('console.ecran.decider.sans_usage', { le: jourCourt(l.jusquAu), dans: dans(l.jusquAu, aujourdhui) }),
        meta: l.proprietaire ? titre('console.ecran.decider.a_appeler', { nom: l.proprietaire.nom, email: l.proprietaire.email }) : null,
        urgence: l.jours <= 1 ? 'aujourdhui' : 'semaine', href: fiche(l.entreprise), bouton: titre('console.ecran.decider.ouvrir_fiche') };
  }
}

// L'accès d'urgence de l'équipe (0135) se range avec le service : la sécurité de la console, pas un client.
const estService = (l: Ligne) => l.ouvre === 'service' || l.ouvre === 'equipe';

function ADecider({ lignes, role, aujourdhui, calculeLe = null }: { lignes: Ligne[]; role: Role; aujourdhui: string; calculeLe?: string | null }) {
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
          <p className="c-carte-sous">{phrase('console.ecran.decider.sous')}{calculeLe ? ` ${phrase('console.ecran.decider.calcule', { heure: heureDe(calculeLe) })}` : ''}</p>
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
              const donnee = l.sorte === 'service' || l.sorte === 'support';
              return (
                <li key={l.sorte === 'service' ? `service-${l.cle}` : l.sorte === 'secret' ? `secret-${l.nom}` : l.sorte === 'urgence' ? `urgence-${l.id}` : l.sorte === 'veille_silencieuse' ? 'veille' : l.sorte === 'support' ? `support-${l.demande.id}`
                  : l.sorte === 'facture_defaite' || l.sorte === 'a_emettre' || l.sorte === 'trop_percu' ? `${l.sorte}-${l.ecran}` : l.sorte === 'contestation' ? `${l.sorte}-${l.entreprise.id}-${l.numero ?? l.ouverteLe}` : `${l.sorte}-${l.entreprise.id}`} className="c-ligne-decision">
                  <span className={`c-ligne-icone c-${v.urgence}`}><Icone nom={v.icone} /></span>
                  <div className="c-ligne-texte">
                    <span className="c-ligne-titre"><span {...(donnee ? { 'data-donnee': true } : {})}>{v.titre}</span> <Puce ton={ton}>{titre(`console.ecran.urgence.${v.urgence}`)}</Puce></span>
                    <span className="c-ligne-desc" {...(donnee ? { 'data-donnee': true } : {})}>{v.desc}</span>
                    {v.meta ? <span className="c-ligne-meta">{v.meta}</span> : null}
                  </div>
                  <Lien href={v.href} ton={v.urgence === 'urgent' ? 'principal' : 'secondaire'} petit fleche {...(v.ailleurs ? { ailleurs: true } : {})}>{v.bouton}</Lien>
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
  const { moi, compterDecisions, compterSupport } = useConsole();
  const [l, relire] = useLecture<Accueil>('/console/accueil');
  const lu = l.etat === 'lu' ? l.donnees : null;
  useEffect(() => { if (lu) { compterDecisions(lu.decider.length); compterSupport(lu.tableau.support?.aRepondre ?? null); } }, [lu, compterDecisions, compterSupport]);
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
              <ADecider lignes={lu.decider} role={lu.role} aujourdhui={aujourdhui} calculeLe={lu.calculeLe ?? null} />
              <Relances liste={lu.relances ?? []} aujourdhui={aujourdhui} />
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
