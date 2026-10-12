// Le code du téléphone, après le mot de passe (lot entrée, 06/10/2026 ; docs/entree.md) : une grande case où le curseur
// attend, et sous elle « Téléphone perdu ou changé ? », qui fait taper un code de secours à la place (le serveur prend
// l'un ou l'autre dans la même case ; l'écran dit seulement lequel il attend). Vu au parcours débutant : rien ne parlait
// du téléphone perdu, sauf dans la bulle « i ».
// Le code par SMS (0081, décision de Skander du 12/10/2026) : le numéro masqué, et un SMS qui n'est pas parti se dit
// (le fournisseur n'a pas pu, ou trop de SMS) avec ses deux sorties : le renvoyer, ou un code de secours.
import { useState } from 'react';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Dessin } from '../composants/Entree.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';
import { CodeCourriel, useDecompte } from './CodeCourriel.tsx';
import type { Defi } from './Connexion.tsx';

const rien = () => undefined;

export function Code({ defi, connecte, retour, corrige }: { defi: Defi; connecte: () => void; retour: () => void; corrige?: (adresse: string) => void }) {
  // Le code reçu par e-mail a son écran (0076) ; une adresse corrigée se garde avec le défi.
  if (defi.methode === 'courriel') return <CodeCourriel defi={defi} connecte={connecte} retour={retour} corrige={corrige} />;
  return <CodeTelephone defi={defi} connecte={connecte} retour={retour} />;
}

function CodeTelephone({ defi, connecte, retour }: { defi: Exclude<Defi, { methode: 'courriel' }>; connecte: () => void; retour: () => void }) {
  const g = useGeste(rien);
  const [code, setCode] = useState('');
  const [secours, setSecours] = useState(false);
  const [envoi, setEnvoi] = useState(defi.methode === 'sms' ? defi.envoi : 'parti');
  const [renvoye, setRenvoye] = useState(false);
  const decompte = useDecompte();
  const sms = defi.methode === 'sms';

  const envoyer = () => g.geste(async () => {
    let r;
    try {
      r = await appeler<{ etat: string; jeton?: string }>('POST', '/connexion/code', { defi: defi.defi, code: code.replace(/\s/g, ''), posteDUnAutre: defi.posteDUnAutre });
    } catch (x) { g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null }); return; }
    if (r.corps.etat === 'connecte' && r.corps.jeton) { session.ouvrir(r.corps.jeton, !defi.posteDUnAutre); connecte(); }
    // Un code faux tient au champ du code, même quand le serveur ne le nomme pas.
    else g.refuser({ ...refusDe(r), champ: 'code' });
  });
  // « Renvoyer le SMS » : un nouveau code remplace l'ancien (30 secondes entre deux envois, cinq au plus).
  const renvoyer = () => g.geste(async () => {
    let r;
    try { r = await appeler('POST', '/connexion/code/renvoyer', { defi: defi.defi }); } catch (x) { g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null }); return; }
    if (r.statut === 202) { setEnvoi('parti'); setRenvoye(true); setCode(''); decompte.repartir(); } else g.refuser({ ...refusDe(r), champ: null });
  });
  // Ce que dit la carte d'un défi par SMS : le numéro où le code est parti, ou pourquoi il n'est pas parti.
  const sousSms = defi.methode !== 'sms' ? null : envoi === 'parti'
    ? <>{titre('ecran.code.sms_parti')} <b data-donnee className="ent-numero">{defi.telephone}</b>. {phrase('ecran.code.sms_valable')}</>
    : phrase(envoi === 'limite' ? 'ecran.code.sms_limite' : 'ecran.code.sms_rate');
  const renvoi = sms && !secours && envoi !== 'limite' ? (
    <span className="ent-renvoi"><span>{titre('ecran.courriel.rien_recu_court')}</span>
      <button type="button" className="ent-lien" disabled={decompte.reste > 0 || g.occupe} onClick={() => { void renvoyer(); }}>
        {decompte.reste > 0 ? titre('ecran.code.renvoyer_dans', { n: decompte.reste }) : titre('ecran.code.renvoyer')}
      </button>
      {renvoye ? <span className="ent-aide ok ent-renvoye" aria-live="polite"><Dessin id="coche" />{phrase('ecran.code.renvoye')}</span> : null}
    </span>
  ) : null;

  return (
    <Carte icone={secours ? 'cle' : 'telephone'} titre={titre(secours ? 'ecran.code.titre_secours' : 'ecran.code.titre')}
      sous={secours ? phrase('ecran.code.sous_secours') : sousSms ?? phrase('ecran.code.application')}
      droite={<button type="button" className="ent-lien" onClick={retour}><Dessin id="retour" />{titre('ecran.code.retour')}</button>}
      onSubmit={() => { void envoyer(); }}
      pied={<Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.code.bouton')}</Bouton>}
      aide={<>
        {renvoi}
        <b>{titre(secours ? 'ecran.code.retrouve' : 'ecran.code.perdu')}</b>
        <button type="button" id="code-perdu" className="ent-lien" onClick={() => { setSecours(!secours); setCode(''); }}>{titre(secours ? 'ecran.code.utiliser_telephone' : 'ecran.code.utiliser_secours')}</button>
      </>}>
      <Champ key={secours ? 'secours' : 'telephone'} classe={`ent-code${secours ? ' secours' : ''}`} libelle={titre(secours ? 'ecran.code.champ_secours' : sms ? 'ecran.code.sms_champ' : 'ecran.code.champ')}
        aide={phrase('ecran.code.champ_aide')} valeur={code} changer={setCode} autoComplete="one-time-code" inputMode={secours ? 'text' : 'numeric'} premier
        dessous={<span className="ent-aide">{phrase(secours ? 'ecran.code.secours_aide' : sms ? 'ecran.code.sms_dernier' : 'ecran.code.change')}</span>} {...g.sur('code')} />
    </Carte>
  );
}
