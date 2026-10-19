// L'entrée de la console (docs/console.md ; serveur/console/connexion.ts) : le compte SkanFact, puis le code du téléphone
// à CHAQUE connexion (SMS ou application ; un code de secours le remplace, une fois). La vitrine sombre à gauche dit ce
// qu'est la console et ce qu'elle ne voit pas ; le formulaire, à droite, dit l'étape. Un refus se dit sous le formulaire,
// et montre son champ. Un membre arrivé depuis moins de sept jours sans code le pose ici, à sa première connexion (0118,
// C41) : SkanFact à ajouter dans une application d'authentification, ses dix codes de secours mis de côté, puis le
// premier code juste active le code et ouvre la session. Un accès d'urgence ouvert (0135, C59) mène au même écran, pour
// un NOUVEAU code à la place de l'ancien : l'écran le dit.
import qrcode from 'qrcode-generator';
import { useEffect, useState, type FormEvent } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { appeler, nomDeCetAppareil, session } from '../api.ts';
import { panneDe, refusDe } from '../contexte.ts';
import { Alerte, Bouton, Champ, Icone, maj, toast } from '../ui.tsx';

type Defi = { etat: 'code'; defi: string; appareil: string } & ({ methode: 'application' } | { methode: 'sms'; telephone: string; envoi: 'parti' | 'rate' | 'limite' });
type Pose = { etat: 'pose'; defi: string; appareil: string; adresseApplication: string; cle: string; codesDeSecours: string[]; urgence?: boolean };
type Faute = { champ: string; n: number } | null;
// Le code QR de l'adresse « otpauth:// », en <svg> (comme à l'entrée de l'application).
function svgDuQr(adresse: string): string {
  const q = qrcode(0, 'M');
  q.addData(adresse);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}
const parQuatre = (cle: string) => cle.replace(/(.{4})(?=.)/g, '$1 ');
let n = 0;

export function Vitrine() {
  const points = [
    { icone: 'personne', titre: 'console.ecran.entree.point_compte_titre', texte: 'console.ecran.entree.point_compte' },
    { icone: 'telephone', titre: 'console.ecran.entree.point_code_titre', texte: 'console.ecran.entree.point_code' },
    { icone: 'cache', titre: 'console.ecran.entree.point_dossiers_titre', texte: 'console.ecran.entree.point_dossiers' },
  ] as const;
  return (
    <section className="c-vitrine">
      <div className="c-marque">
        <span className="c-marque-s" aria-hidden="true">S</span>
        <span className="c-marque-nom"><b data-donnee>SkanFact</b><span className="c-marque-pilule">{dire('console.ecran.marque')}</span></span>
      </div>
      <h2>{titre('console.ecran.entree.vitrine_titre')}</h2>
      <p className="c-vitrine-sous">{phrase('console.ecran.entree.vitrine_sous')}</p>
      <ul className="c-points">
        {points.map((p) => (
          <li key={p.titre}>
            <span className="c-points-icone"><Icone nom={p.icone} /></span>
            <div><b>{titre(p.titre)}</b><span>{phrase(p.texte)}</span></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Entree({ message, entre }: { message: string | null; entre: () => void }) {
  // Venue d'une invitation acceptée (C41), l'adresse est déjà remplie : le curseur va au mot de passe.
  const [email, setEmail] = useState(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('adresse') ?? '');
  // Le curseur se pose UNE fois, à l'ouverture : sur l'adresse, ou sur le mot de passe quand elle arrive remplie. Suivant
  // ce qu'on tape, il sautait au mot de passe dès la première lettre de l'adresse (recette à l'écran, 1.58.0 : « a » dans
  // l'adresse, la suite dans le mot de passe).
  const [adresseDonnee] = useState(() => email !== '');
  const [motDePasse, setMotDePasse] = useState('');
  const [defi, setDefi] = useState<Defi | null>(null);
  const [pose, setPose] = useState<Pose | null>(null);
  const [garde, setGarde] = useState(false);
  const [code, setCode] = useState('');
  const [secours, setSecours] = useState(false);
  const [refus, setRefus] = useState<string | null>(message);
  const [faute, setFaute] = useState<Faute>(null);
  const [occupe, setOccupe] = useState(false);
  const [renvoi, setRenvoi] = useState(0);

  // Le SMS se renvoie au plus toutes les 30 secondes (la base le tient aussi).
  useEffect(() => {
    if (renvoi <= 0) return;
    const t = setTimeout(() => setRenvoi((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [renvoi]);

  const refuser = (texte: string, champ: string | null = null) => { setRefus(texte); setFaute(champ ? { champ, n: ++n } : null); };
  const geste = async (f: () => Promise<void>) => {
    setOccupe(true);
    setRefus(null);
    try { await f(); } catch (x) { refuser(panneDe(x)); } finally { setOccupe(false); }
  };

  const seConnecter = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !motDePasse) { refuser(phrase('console.ecran.entree.manque'), email.trim() ? 'motDePasse' : 'email'); return; }
    void geste(async () => {
      const appareil = session.appareil();
      const r = await appeler<Defi | Pose | { etat: 'connecte'; jeton: string; appareil: string }>('POST', '/console/connexion',
        { email: email.trim(), motDePasse, appareil: { nom: nomDeCetAppareil(), type: 'navigateur', ...(appareil ? { id: appareil } : {}) } });
      // Le serveur nomme le champ quand c'est lui (le mot de passe) ; sans code du téléphone en place, aucun champ n'est faux.
      if (r.statut !== 200) { refuser(refusDe(r), r.corps.champ === 'motDePasse' ? 'motDePasse' : null); return; }
      session.retenirAppareil(r.corps.appareil);
      if (r.corps.etat === 'connecte') { session.ouvrir(r.corps.jeton); entre(); return; }
      setCode('');
      if (r.corps.etat === 'pose') { setPose(r.corps); setGarde(false); return; }
      setDefi(r.corps);
      setCode('');
      setSecours(false);
      if (r.corps.methode === 'sms') setRenvoi(30);
    });
  };

  const valider = (e: FormEvent) => {
    e.preventDefault();
    const ouvert = pose ?? defi;
    if (!ouvert) return;
    // Les codes de secours ne se montreront plus : on n'entre pas sans les avoir mis de côté.
    if (pose && !garde) { refuser(phrase('console.ecran.pose.garde_avant'), 'garde'); return; }
    if (!code.trim()) { refuser(phrase('console.ecran.code.manque'), 'code'); return; }
    void geste(async () => {
      const r = await appeler<{ etat: string; jeton: string; appareil: string }>('POST', '/console/connexion/code', { defi: ouvert.defi, code: code.replace(/\s+/g, '') });
      if (r.statut !== 200 || r.corps.etat !== 'connecte') { refuser(refusDe(r), 'code'); return; }
      session.retenirAppareil(r.corps.appareil);
      session.ouvrir(r.corps.jeton);
      entre();
    });
  };

  const renvoyer = () => void geste(async () => {
    if (!defi) return;
    const r = await appeler('POST', '/console/connexion/code/renvoyer', { defi: defi.defi });
    if (r.statut === 202) { toast(phrase('console.ecran.code.renvoye')); setRenvoi(30); } else refuser(refusDe(r));
  });

  const recommencer = () => { setDefi(null); setPose(null); setCode(''); setRefus(null); setFaute(null); setMotDePasse(''); };
  const copier = (texte: string, fait: string) => {
    void navigator.clipboard?.writeText(texte).then(() => toast(fait), () => toast(phrase('console.ecran.compte.copie_impossible'), true));
  };
  const sur = (champ: string) => ({ faute: faute?.champ === champ, ...(faute?.champ === champ ? { n: faute.n } : {}) });

  return (
    <main className="c-entree">
      <Vitrine />
      <section className="c-forme">
        <div className="c-forme-tete">
          <span className="c-etape">{titre('console.ecran.entree.etape', { n: defi || pose ? 2 : 1 })}</span>
          <span className="c-hote"><Icone nom="cadenas" taille={16} /><span data-donnee>{location.host}</span></span>
        </div>
        {pose ? (
          <form className="c-forme-corps c-pose" onSubmit={valider} noValidate>
            <h1>{titre(pose.urgence ? 'console.ecran.pose.urgence_titre' : 'console.ecran.pose.titre')}</h1>
            <p className="c-forme-sous">{phrase(pose.urgence ? 'console.ecran.pose.urgence_sous' : 'console.ecran.pose.sous')}</p>
            <ol className="c-pose-etapes">
              <li>
                <b>{titre('console.ecran.pose.ajouter')}</b>
                <div className="c-cp-qr">
                  <div className="c-cp-qr-image" data-donnee role="img" aria-label={phrase('console.ecran.compte.c.qr')} dangerouslySetInnerHTML={{ __html: svgDuQr(pose.adresseApplication) }} />
                  <div className="c-cp-qr-texte">
                    <p className="c-sous">{maj(dire('console.ecran.compte.c.scanner'))}</p>
                    <code className="c-cp-cle" data-donnee>{parQuatre(pose.cle)}</code>
                    <span><Bouton petit icone="copier" onClick={() => copier(pose.cle, phrase('console.ecran.compte.c.cle_copiee'))}>{titre('console.ecran.compte.c.copier_cle')}</Bouton></span>
                  </div>
                </div>
              </li>
              <li>
                <b>{titre('console.ecran.pose.secours')}</b>
                <span className="c-sous">{phrase('console.ecran.pose.secours_sous')}</span>
                <ol className="c-cp-secours" data-donnee>{pose.codesDeSecours.map((c) => <li key={c}>{c}</li>)}</ol>
                <span><Bouton petit icone="copier" onClick={() => copier(pose.codesDeSecours.join('\n'), phrase('console.ecran.compte.s.copies'))}>{titre('console.ecran.compte.s.copier')}</Bouton></span>
                <label className={`c-pose-garde${faute?.champ === 'garde' && !garde ? ' c-pose-garde-faute' : ''}`}>
                  <input type="checkbox" checked={garde} onChange={(e) => { setGarde(e.target.checked); if (e.target.checked) setRefus(null); }} />
                  <span>{titre('console.ecran.pose.garde')}</span>
                </label>
              </li>
              <li>
                <Champ classe="c-code" libelle={titre('console.ecran.pose.essai')} aide={phrase('console.ecran.pose.essai_aide')} valeur={code} changer={setCode}
                  autoComplete="one-time-code" inputMode="numeric" {...sur('code')} />
              </li>
            </ol>
            {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
            <Bouton ton="principal" type="submit" large occupe={occupe} fleche>{titre('console.ecran.pose.valider')}</Bouton>
            <div className="c-forme-liens"><Bouton ton="discret" petit onClick={recommencer}>{titre('console.ecran.code.recommencer')}</Bouton></div>
          </form>
        ) : defi ? (
          <form className="c-forme-corps" onSubmit={valider} noValidate>
            <h1>{titre(secours ? 'console.ecran.code.champ_secours' : 'console.ecran.code.titre')}</h1>
            <p className="c-forme-sous">
              {secours ? phrase('console.ecran.code.secours_sous')
                : defi.methode === 'sms' ? <>{phrase('console.ecran.code.sous_sms', { telephone: defi.telephone })}</>
                  : phrase('console.ecran.code.sous_application')}
            </p>
            {defi.methode === 'sms' && !secours && defi.envoi !== 'parti'
              ? <Alerte ton="attention">{phrase(defi.envoi === 'limite' ? 'console.ecran.code.sms_limite' : 'console.ecran.code.sms_rate')}</Alerte> : null}
            <Champ classe={secours ? '' : 'c-code'} libelle={titre(secours ? 'console.ecran.code.champ_secours' : 'console.ecran.code.champ')} valeur={code} changer={setCode}
              autoComplete="one-time-code" inputMode={secours ? 'text' : 'numeric'} premier {...sur('code')} />
            {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
            <Bouton ton="principal" type="submit" large occupe={occupe} fleche>{titre('console.ecran.code.valider')}</Bouton>
            <div className="c-forme-liens">
              {defi.methode === 'sms' && !secours
                ? <Bouton ton="discret" petit desactive={renvoi > 0} onClick={renvoyer}>{renvoi > 0 ? titre('console.ecran.code.renvoyer_dans', { n: renvoi }) : titre('console.ecran.code.renvoyer')}</Bouton>
                : null}
              <Bouton ton="discret" petit onClick={() => { setSecours(!secours); setCode(''); setRefus(null); }}>
                {titre(secours ? 'console.ecran.code.retour_code' : 'console.ecran.code.secours')}
              </Bouton>
              <Bouton ton="discret" petit onClick={recommencer}>{titre('console.ecran.code.recommencer')}</Bouton>
            </div>
          </form>
        ) : (
          <form className="c-forme-corps" onSubmit={seConnecter} noValidate>
            <h1>{titre('console.ecran.entree.titre')}</h1>
            <p className="c-forme-sous">{phrase('console.ecran.entree.sous')}</p>
            <div className="c-champs">
              <Champ libelle={titre('console.ecran.entree.email')} type="email" autoComplete="username" inputMode="email" valeur={email} changer={setEmail} premier={!adresseDonnee} {...sur('email')} />
              <Champ libelle={titre('console.ecran.entree.mot_de_passe')} type="password" autoComplete="current-password" revelable valeur={motDePasse} changer={setMotDePasse} premier={adresseDonnee} {...sur('motDePasse')} />
            </div>
            {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
            <Bouton ton="principal" type="submit" large occupe={occupe} fleche>{titre('console.ecran.entree.continuer')}</Bouton>
            <p className="c-forme-note">{phrase('console.ecran.entree.note')}</p>
          </form>
        )}
      </section>
    </main>
  );
}
