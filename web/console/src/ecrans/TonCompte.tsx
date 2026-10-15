// Ton compte (docs/console.md C40 ; serveur/console/routes.ts, /console/moi/… ; 0117 ; la maquette « Équipe », la vue du
// support). Chaque membre de l'équipe, quel que soit son rôle : son rôle et depuis quand, son code, ses codes de secours,
// le jour où son mot de passe a changé, ses appareils, ses gestes récents, ce que son rôle ouvre (lu dans la liste des
// gestes du serveur). Il change son mot de passe, son code et refait ses codes de secours d'ici, par les mêmes étapes que
// dans l'application (serveur/compte.ts) : un membre de l'équipe n'a pas toujours une entreprise où les faire. Son rôle,
// c'est la direction qui le change ; son code, personne d'autre que lui : on ne le réinitialise pas à sa place.
import qrcode from 'qrcode-generator';
import { useState } from 'react';
import { LONGUEUR_MINIMALE } from '../../../../commun/compte.ts';
import { dire, phrase, selon, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture, type Role } from '../contexte.ts';
import { jourCourt, jourDe, quand } from '../temps.ts';
import { Alerte, Avatar, Bouton, Champ, Dialogue, Icone, Lien, maj, Pilules, toast } from '../ui.tsx';
import { NUANCES, SesAppareils } from './Equipe.tsx';

type Methode = 'sms' | 'application';
type Compte = {
  aujourdhui: string; utilisateur: string; nom: string; email: string; role: Role; depuis: string;
  code: Methode | null; telephone: string | null; secours: number; motDePasseLe: string; motDePasseChange: boolean;
  gestes30: number; gestes: { le: string; geste: string; motif: string; entreprise: string | null }[]; droits: string[];
};
const K = 'console.ecran.compte';
const SECOURS_TOTAL = 10;

// Le code QR de l'adresse « otpauth:// », en <svg> (comme à l'entrée de l'application, web/src/ecrans/CodeRequis.tsx).
function svgDuQr(adresse: string): string {
  const q = qrcode(0, 'M');
  q.addData(adresse);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}
const parQuatre = (cle: string) => cle.replace(/(.{4})(?=.)/g, '$1 ');
const copier = (texte: string, fait: string) => {
  void navigator.clipboard?.writeText(texte).then(() => toast(fait), () => toast(phrase(`${K}.copie_impossible`), true));
};

function CeQuiVa({ points }: { points: string[] }) {
  return (
    <div className="c-al-ce-qui-va">
      <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
      <ul>{points.map((x) => <li key={x}>{phrase(x)}</li>)}</ul>
    </div>
  );
}

// Le code actuel, qui prouve que c'est bien toi : celui de l'application, ou celui qu'on t'envoie par SMS ; un code de
// secours vaut aussi.
function PreuveCode({ parSms, valeur, changer, faute, n, premier }: { parSms: boolean; valeur: string; changer: (v: string) => void; faute: boolean; n: number; premier?: boolean }) {
  const api = useApi();
  const [envoi, setEnvoi] = useState(false);
  const envoyer = () => {
    void (async () => {
      setEnvoi(true);
      try {
        const r = await api<{ telephone: string }>('POST', '/console/moi/code/preuve-sms');
        if (!r) return;
        if (r.statut === 202) toast(phrase(`${K}.preuve.parti`, { numero: r.corps.telephone })); else toast(refusDe(r), true);
      } catch (x) { toast(panneDe(x), true); } finally { setEnvoi(false); }
    })();
  };
  return (
    <div className="c-cp-preuve">
      <Champ libelle={titre(`${K}.preuve.libelle`)} aide={phrase(parSms ? `${K}.preuve.aide_sms` : `${K}.preuve.aide_application`)} inputMode="numeric"
        autoComplete="one-time-code" valeur={valeur} changer={changer} faute={faute} n={n} {...(premier ? { premier } : {})} />
      {parSms ? <Bouton petit icone="telephone" occupe={envoi} onClick={envoyer}>{titre(`${K}.preuve.envoyer`)}</Bouton> : null}
    </div>
  );
}

// Les dix codes de secours, montrés UNE fois : ils ne sont gardés qu'en empreinte.
function CodesDeSecours({ codes, fait, sous }: { codes: string[]; fait: () => void; sous: string }) {
  return (
    <Dialogue titre={titre(`${K}.s.nouveaux`)} sous={sous} fermer={fait}
      pied={<>
        <Bouton onClick={() => copier(codes.join('\n'), phrase(`${K}.s.copies`))} icone="copier">{titre(`${K}.s.copier`)}</Bouton>
        <Bouton ton="principal" onClick={fait}>{titre(`${K}.s.notes`)}</Bouton>
      </>}>
      <ol className="c-cp-secours" data-donnee>{codes.map((c) => <li key={c}>{c}</li>)}</ol>
      <p className="c-sous">{phrase(`${K}.s.nouveaux_note`)}</p>
    </Dialogue>
  );
}

function FenetreMotDePasse({ fermer, fait }: { fermer: () => void; fait: (n: number) => void }) {
  const api = useApi();
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string | null) => { setRefus(texte); setFaute(champ ? { champ, n: (faute?.n ?? 0) + 1 } : null); };
  const faire = () => {
    if (!actuel) { refuser(phrase(`${K}.m.actuel_vide`), 'actuel'); return; }
    if (!nouveau) { refuser(phrase(`${K}.m.nouveau_vide`), 'nouveau'); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api<{ sessionsFermees: number }>('POST', '/console/moi/mot-de-passe', { actuel, nouveau });
        if (!r) return;
        if (r.statut === 200) { fait(Number(r.corps.sessionsFermees ?? 0)); return; }
        refuser(refusDe(r), r.corps.champ === 'actuel' || r.corps.champ === 'nouveau' ? r.corps.champ : null);
      } catch (x) { refuser(panneDe(x), null); } finally { setOccupe(false); }
    })();
  };
  const sur = (champ: string) => ({ faute: faute?.champ === champ, ...(faute?.champ === champ ? { n: faute.n } : {}) });
  return (
    <Dialogue titre={titre(`${K}.m.titre`)} sous={phrase(`${K}.m.sous`, { min: LONGUEUR_MINIMALE })} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(`${K}.m.bouton`)}</Bouton>
      </>}>
      <CeQuiVa points={[`${K}.m.p1`, `${K}.m.p2`, `${K}.m.p3`]} />
      <Champ libelle={titre(`${K}.m.actuel`)} type="password" autoComplete="current-password" revelable valeur={actuel} changer={setActuel} premier {...sur('actuel')} />
      <Champ libelle={titre(`${K}.m.nouveau`)} aide={phrase(`${K}.m.nouveau_aide`, { min: LONGUEUR_MINIMALE })} type="password" autoComplete="new-password" revelable
        valeur={nouveau} changer={setNouveau} {...sur('nouveau')} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// Changer de code : l'application ou le SMS (jamais l'e-mail pour l'équipe). Le code actuel prouvé, le nouveau préparé
// (rien ne change), puis activé par son premier code juste : alors seulement l'ancien s'arrête. Une fenêtre fermée en
// route ne change rien.
type EtapeCode = { sorte: 'debut' } | { sorte: 'application'; adresse: string; cle: string; secours: string[] } | { sorte: 'sms'; telephone: string } | { sorte: 'codes'; secours: string[] };
function FenetreCode({ compte, fermer, fait }: { compte: Compte; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [etape, setEtape] = useState<EtapeCode>({ sorte: 'debut' });
  const [methode, setMethode] = useState<Methode>(compte.code ?? 'application');
  const [preuve, setPreuve] = useState('');
  const [telephone, setTelephone] = useState('');
  const [essai, setEssai] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string | null) => { setRefus(texte); setFaute(champ ? { champ, n: (faute?.n ?? 0) + 1 } : null); };
  const sur = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const geste = (f: () => Promise<void>) => {
    void (async () => { setOccupe(true); try { await f(); } catch (x) { refuser(panneDe(x), null); } finally { setOccupe(false); } })();
  };

  const preparer = () => {
    if (!preuve.trim()) { refuser(phrase(compte.code === 'sms' ? 'compte.preuve_sms_manque' : 'compte.code_actuel_manque'), 'code'); return; }
    if (methode === 'sms' && !telephone.trim()) { refuser(phrase(`${K}.c.telephone_vide`), 'telephone'); return; }
    geste(async () => {
      if (methode === 'application') {
        const r = await api<{ adresseApplication: string; cle: string; codesDeSecours: string[] }>('POST', '/console/moi/code/preparer', { code: preuve.trim() });
        if (!r) return;
        if (r.statut === 200) { setEtape({ sorte: 'application', adresse: r.corps.adresseApplication, cle: r.corps.cle, secours: r.corps.codesDeSecours }); setRefus(null); setFaute(null); return; }
        refuser(refusDe(r), r.corps.champ === 'code' ? 'code' : null);
        return;
      }
      const r = await api<{ telephone: string }>('POST', '/console/moi/code/sms/preparer', { telephone: telephone.trim(), code: preuve.trim() });
      if (!r) return;
      if (r.statut === 200) { setEtape({ sorte: 'sms', telephone: r.corps.telephone }); setRefus(null); setFaute(null); return; }
      refuser(refusDe(r), r.corps.champ === 'code' || r.corps.champ === 'telephone' ? r.corps.champ : null);
    });
  };
  const activer = () => {
    if (!essai.trim()) { refuser(phrase(`${K}.c.essai_vide`), 'essai'); return; }
    geste(async () => {
      if (etape.sorte === 'application') {
        const r = await api('POST', '/console/moi/code/activer', { code: essai.trim() });
        if (!r) return;
        if (r.statut === 200) { setEtape({ sorte: 'codes', secours: etape.secours }); return; }
        // Plus d'une heure depuis la préparation : on recommence depuis le début (le refus le dit).
        if (r.corps.champ !== 'code') { setEtape({ sorte: 'debut' }); setEssai(''); setPreuve(''); }
        refuser(refusDe(r), r.corps.champ === 'code' ? 'essai' : null);
        return;
      }
      const r = await api<{ codesDeSecours: string[] }>('POST', '/console/moi/code/sms/activer', { code: essai.trim() });
      if (!r) return;
      if (r.statut === 200) { setEtape({ sorte: 'codes', secours: r.corps.codesDeSecours }); return; }
      refuser(refusDe(r), r.corps.champ === 'code' ? 'essai' : null);
    });
  };

  if (etape.sorte === 'codes') return <CodesDeSecours codes={etape.secours} fait={fait} sous={phrase(`${K}.c.fait`, { methode: dire(`${K}.code.court.${methode}`) })} />;
  const annuler = <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>;
  if (etape.sorte === 'application' || etape.sorte === 'sms') {
    return (
      <Dialogue titre={titre(`${K}.c.titre`)} sous={phrase(etape.sorte === 'application' ? `${K}.c.sous_application` : `${K}.c.sous_sms`, { numero: etape.sorte === 'sms' ? etape.telephone : '' })}
        fermer={fermer} occupe={occupe}
        pied={<>{annuler}<Bouton ton="principal" occupe={occupe} onClick={activer}>{titre(`${K}.c.activer`)}</Bouton></>}>
        {etape.sorte === 'application' ? (
          <div className="c-cp-qr">
            <div className="c-cp-qr-image" data-donnee role="img" aria-label={phrase(`${K}.c.qr`)} dangerouslySetInnerHTML={{ __html: svgDuQr(etape.adresse) }} />
            <div className="c-cp-qr-texte">
              <p className="c-sous">{maj(dire(`${K}.c.scanner`))}</p>
              <code className="c-cp-cle" data-donnee>{parQuatre(etape.cle)}</code>
              <span><Bouton petit icone="copier" onClick={() => copier(etape.cle, phrase(`${K}.c.cle_copiee`))}>{titre(`${K}.c.copier_cle`)}</Bouton></span>
            </div>
          </div>
        ) : null}
        <Champ libelle={titre(etape.sorte === 'application' ? `${K}.c.essai_application` : `${K}.c.essai_sms`)} aide={phrase(`${K}.c.essai_aide`)} inputMode="numeric"
          autoComplete="one-time-code" valeur={essai} changer={setEssai} premier {...sur('essai')} />
        {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
      </Dialogue>
    );
  }
  return (
    <Dialogue titre={titre(`${K}.c.titre`)} sous={phrase(`${K}.c.sous`)} fermer={fermer} occupe={occupe}
      pied={<>{annuler}<Bouton ton="principal" occupe={occupe} onClick={preparer}>{titre(`${K}.c.continuer`)}</Bouton></>}>
      <CeQuiVa points={[`${K}.c.p1`, `${K}.c.p2`, `${K}.c.p3`]} />
      <Pilules libelle={titre(`${K}.c.methode`)} valeur={methode} changer={setMethode}
        choix={[{ valeur: 'application', texte: titre(`${K}.code.court.application`) }, { valeur: 'sms', texte: titre(`${K}.code.court.sms`) }]} />
      {methode === 'sms' ? <Champ libelle={titre(`${K}.c.telephone`)} aide={phrase(`${K}.c.telephone_aide`)} type="tel" inputMode="tel" autoComplete="tel"
        valeur={telephone} changer={setTelephone} {...sur('telephone')} /> : null}
      <PreuveCode parSms={compte.code === 'sms'} valeur={preuve} changer={setPreuve} {...sur('code')} />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// Refaire ses codes de secours : le code actuel d'abord ; les dix nouveaux se montrent UNE fois, ici.
function FenetreSecours({ compte, fermer, fait }: { compte: Compte; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const faire = () => {
    if (!code.trim()) { setRefus(phrase(compte.code === 'sms' ? 'compte.preuve_sms_manque' : 'compte.code_actuel_manque')); setFaute((f) => f + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api<{ codesDeSecours: string[] }>('POST', '/console/moi/codes-secours', { code: code.trim() });
        if (!r) return;
        if (r.statut === 200 && Array.isArray(r.corps.codesDeSecours)) { setCodes(r.corps.codesDeSecours.map(String)); setRefus(null); return; }
        setRefus(refusDe(r)); setFaute((f) => f + 1);
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  if (codes) return <CodesDeSecours codes={codes} fait={fait} sous={phrase(`${K}.s.nouveaux_sous`)} />;
  return (
    <Dialogue titre={titre(`${K}.s.titre`)} sous={phrase(`${K}.s.sous`)} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={faire}>{titre(`${K}.s.bouton`)}</Bouton>
      </>}>
      <CeQuiVa points={[`${K}.s.p1`, `${K}.s.p2`, `${K}.s.p3`]} />
      <PreuveCode parSms={compte.code === 'sms'} valeur={code} changer={setCode} faute={faute > 0} n={faute} premier />
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

export function TonCompte({ direction }: { direction: boolean }) {
  const { moi } = useConsole();
  const [l, relire] = useLecture<Compte>('/console/moi/compte');
  const [geste, setGeste] = useState<'mdp' | 'code' | 'secours' | null>(null);
  const c = l.etat === 'lu' ? l.donnees : null;
  const codeEnMots = (x: Compte) => (x.code === 'application' ? dire(`${K}.code.application`)
    : x.code === 'sms' ? dire(`${K}.code.sms`, { numero: x.telephone ?? '' }) : dire(`${K}.code.aucun`));
  const faits = (x: Compte): [string, string][] => [
    [titre(`${K}.f.role`), x.role === 'direction' ? titre('console.ecran.role.direction') : dire(`${K}.f.role_valeur`, { role: titre(`console.ecran.role.${x.role}`) })],
    [titre(`${K}.f.code`), maj(codeEnMots(x))],
    [titre(`${K}.f.secours`), dire(`${K}.f.secours_valeur`, { n: x.secours, sur: SECOURS_TOTAL })],
    [titre(`${K}.f.mdp`), maj(dire(x.motDePasseChange ? `${K}.f.mdp_change` : `${K}.f.mdp_jamais`, { quand: quand(x.motDePasseLe, x.aujourdhui) }))],
    [titre(`${K}.f.depuis`), dire(`${K}.f.depuis_valeur`, { le: jourCourt(jourDe(x.depuis)) })],
  ];
  return (
    <>
      <header className="c-entete">
        <div className="c-entete-texte">
          <h1>{titre(`${K}.titre`)}</h1>
          <p className="c-entete-sous">{phrase(direction ? `${K}.sous_direction` : `${K}.sous`)}</p>
        </div>
        {direction ? <div className="c-entete-actions"><Lien href="#/equipe" icone="equipe">{titre(`${K}.vers_equipe`)}</Lien></div> : null}
      </header>
      {l.etat === 'panne' ? <Alerte ton="danger"><span>{l.texte}</span><span><Bouton petit onClick={relire}>{titre('console.ecran.reessayer')}</Bouton></span></Alerte> : null}
      {l.etat === 'lecture' ? <p className="c-attente">{titre('console.ecran.lecture')}</p> : null}
      {c ? (
        <div className="c-cp">
          <div className="c-cp-rang">
            <section className="c-carte c-cp-toi" aria-labelledby="cp-toi">
              <div className="c-cp-qui">
                <Avatar nom={c.nom} nuit />
                <div className="c-texte"><h2 id="cp-toi" data-donnee>{c.nom}</h2><span className="c-sous" data-donnee>{c.email}</span></div>
              </div>
              <dl className="c-cp-faits">
                {faits(c).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
              <div className="c-cp-gestes">
                <Bouton onClick={() => setGeste('mdp')}>{titre(`${K}.g.mdp`)}</Bouton>
                <Bouton onClick={() => setGeste('code')}>{titre(`${K}.g.code`)}</Bouton>
                <Bouton onClick={() => setGeste('secours')}>{titre(`${K}.g.secours`)}</Bouton>
              </div>
              <p className="c-sous c-cp-note">{phrase(`${K}.pied`)}</p>
            </section>
            <SesAppareils membre={{ utilisateur: c.utilisateur, nom: c.nom }} enPage />
          </div>
          <div className="c-cp-rang c-cp-rang-large">
            <section className="c-carte c-cp-recents" aria-labelledby="cp-gestes">
              <div className="c-cp-tete">
                <div className="c-texte"><h2 id="cp-gestes">{titre(`${K}.r.titre`)}</h2>
                </div>
                {c.droits.includes('console.journal.voir') ? <Lien petit href={`#/journal?qui=${moi.utilisateur}`}>{titre(`${K}.r.tous`)}</Lien> : null}
              </div>
                <p className="c-sous">{maj(selon(c.gestes30, `${K}.r.compte`))}</p>
              {c.gestes.length ? (
                <ul className="c-cp-liste">
                  {c.gestes.map((g) => (
                    <li key={`${g.le}${g.geste}`}>
                      <span className="c-texte">
                        <b>{titre(`console.ecran.journal.g.${g.geste.replaceAll('-', '_')}`)}{g.entreprise ? <> · <span data-donnee>{g.entreprise}</span></> : null}</b>
                        <span className="c-sous" data-donnee>« {g.motif} »</span>
                      </span>
                      <span className="c-sous c-cp-quand">{quand(g.le, c.aujourdhui)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="c-attente">{phrase(`${K}.r.aucun`)}</p>}
            </section>
            <section className="c-carte c-cp-role" aria-labelledby="cp-role">
              <h2 id="cp-role">{titre(`${K}.o.titre`)}</h2>
              <p className="c-sous">{phrase(`${K}.o.sous.${c.role}`)}</p>
              <ul className="c-cp-liste c-cp-droits">
                {c.droits.map((d) => {
                  // Ce que le rôle n'ouvre qu'en partie : la nuance se dit, en orange, à la place de la coche (comme l'écran de l'équipe).
                  const nuance = NUANCES[d]?.[c.role];
                  return (
                    <li key={d} className={nuance ? 'c-cp-droit-part' : undefined}>
                      <Icone nom={nuance ? 'info' : 'ok'} taille={16} />
                      <span className="c-texte"><b>{maj(dire(`console.ecran.equipe.droit.${d}`))}</b>{nuance ? <span className="c-cp-nuance">{maj(dire(nuance))}</span> : null}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </div>
      ) : null}
      {geste === 'mdp' ? <FenetreMotDePasse fermer={() => setGeste(null)} fait={(n) => { setGeste(null); toast(maj(selon(n, `${K}.m.fait`))); relire(); }} /> : null}
      {geste === 'code' && c ? <FenetreCode compte={c} fermer={() => setGeste(null)} fait={() => { setGeste(null); toast(phrase(`${K}.c.toast`)); relire(); }} /> : null}
      {geste === 'secours' && c ? <FenetreSecours compte={c} fermer={() => setGeste(null)} fait={() => { setGeste(null); toast(phrase(`${K}.s.toast`)); relire(); }} /> : null}
    </>
  );
}
