// Le code reçu par e-mail (lot onboarding, 09/10/2026 ; maquettes validées par Skander ; migration 0076, docs/entree.md).
// Deux raisons, deux écrans :
// - juste après l'inscription, « Vérifie ton e-mail » : l'étape 1 de la page de création du compte, avec l'adresse en
//   entier (une faute de frappe s'y voit) et « Ce n'est pas ton adresse ? La corriger » ;
// - un appareil que SkanFact ne connaît pas, « C'est bien toi ? » : une carte, l'adresse à demi cachée.
// « Renvoyer le code » attend 30 secondes (le serveur aussi : personne ne remplit la boîte d'un autre), et dit quand un
// nouveau code est parti.
import { useEffect, useState } from 'react';
import { appeler, ErreurReseau, session } from '../api.ts';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { Dessin, PageDouble, VitrineCompte } from '../composants/Entree.tsx';
import { toast } from '../composants/Toast.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';
import type { Defi } from './Connexion.tsx';

const rien = () => undefined;
const ATTENTE = 30;
const MINUTES = 15;
type DefiCourriel = Extract<Defi, { methode: 'courriel' }>;

// « amine.gharbi@exemple.tn » → « a•••••@exemple.tn » : sur un appareil inconnu, l'adresse ne se lit pas en entier.
export function masquer(adresse: string): string {
  const i = adresse.indexOf('@');
  return i < 1 ? adresse : `${adresse.charAt(0)}•••••${adresse.slice(i)}`;
}

// Le décompte avant de pouvoir redemander un code ; `repartir` le relance après un envoi.
function useDecompte() {
  const [reste, setReste] = useState(ATTENTE);
  useEffect(() => {
    if (reste <= 0) return undefined;
    const t = setTimeout(() => setReste((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [reste]);
  return { reste, repartir: () => setReste(ATTENTE) };
}

export function CodeCourriel({ defi, connecte, retour, corrige }: { defi: DefiCourriel; connecte: () => void; retour: () => void; corrige?: ((adresse: string) => void) | undefined }) {
  const g = useGeste(rien);
  const [code, setCode] = useState('');
  const [adresse, setAdresse] = useState(defi.adresse);
  const [corriger, setCorriger] = useState(false);
  const [nouvelle, setNouvelle] = useState('');
  const [parti, setParti] = useState(false);
  const decompte = useDecompte();
  const inscription = defi.raison === 'inscription';

  const panne = (x: unknown) => g.refuser({ texte: phrase(x instanceof ErreurReseau ? 'ecran.erreur_reseau' : 'ecran.erreur_serveur'), champ: null });
  const valider = () => g.geste(async () => {
    let r;
    try {
      r = await appeler<{ etat: string; jeton?: string }>('POST', '/connexion/code', { defi: defi.defi, code: code.replace(/\s/g, ''), posteDUnAutre: defi.posteDUnAutre });
    } catch (x) { panne(x); return; }
    if (r.corps.etat === 'connecte' && r.corps.jeton) {
      session.ouvrir(r.corps.jeton, !defi.posteDUnAutre);
      if (inscription) toast(phrase('ecran.courriel.verifiee'));
      connecte();
    } else g.refuser({ ...refusDe(r), champ: 'code' });
  });
  const renvoyer = () => g.geste(async () => {
    let r;
    try { r = await appeler('POST', '/connexion/code/renvoyer', { defi: defi.defi }); } catch (x) { panne(x); return; }
    if (r.statut === 202) { setParti(true); setCode(''); decompte.repartir(); } else g.refuser({ ...refusDe(r), champ: null });
  });
  const envoyerCorrection = () => g.geste(async () => {
    let r;
    try { r = await appeler<{ adresse: string }>('POST', '/connexion/code/corriger', { defi: defi.defi, adresse: nouvelle.trim() }); } catch (x) { panne(x); return; }
    if (r.statut === 202) {
      setAdresse(r.corps.adresse);
      corrige?.(r.corps.adresse);
      setCorriger(false);
      setNouvelle('');
      setCode('');
      setParti(false);
      decompte.repartir();
      toast(phrase('ecran.courriel.corrigee'));
    } else g.refuser({ ...refusDe(r), champ: 'adresse' });
  });

  // « Renvoyer le code », éteint (avec son décompte) tant que les 30 secondes ne sont pas passées.
  const boutonRenvoi = (
    <button type="button" className="ent-lien" disabled={decompte.reste > 0 || g.occupe} onClick={() => { void renvoyer(); }}>
      {decompte.reste > 0 ? titre('ecran.courriel.renvoyer_dans', { n: decompte.reste }) : titre('ecran.courriel.renvoyer')}
    </button>
  );
  const renvoye = parti ? <span className="ent-aide ok ent-renvoye" aria-live="polite"><Dessin id="coche" />{phrase('ecran.courriel.renvoye')}</span> : null;

  if (!inscription) {
    return (
      <Carte icone="ecran" titre={titre('ecran.courriel.titre_appareil')}
        sous={<>{titre('ecran.courriel.appareil')} <b data-donnee>{masquer(adresse)}</b>.</>}
        droite={<button type="button" className="ent-lien" onClick={retour}><Dessin id="retour" />{titre('ecran.code.retour')}</button>}
        onSubmit={() => { void valider(); }}
        pied={<Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.courriel.bouton')}</Bouton>}
        aide={<>
          <span className="ent-renvoi"><span>{titre('ecran.courriel.rien_recu_court')}</span>{boutonRenvoi}{renvoye}</span>
          <span className="ent-aide">{phrase('ecran.courriel.telephone')}</span>
        </>}>
        <Champ classe="ent-code" libelle={titre('ecran.courriel.champ_appareil')} aide={phrase('ecran.courriel.champ_aide')} valeur={code} changer={setCode}
          autoComplete="one-time-code" inputMode="numeric" premier
          dessous={<span className="ent-aide">{phrase(defi.posteDUnAutre ? 'ecran.courriel.poste_autre' : 'ecran.courriel.reconnu')}</span>} {...g.sur('code')} />
      </Carte>
    );
  }

  return (
    <PageDouble vitrine={<VitrineCompte code />}
      haut={<>
        <span className="etape">{titre('ecran.inscription.etape')}</span>
        {corriger ? <span /> : <span>{titre('ecran.courriel.pas_ton_adresse')} <button type="button" className="ent-lien" onClick={() => { setCorriger(true); setNouvelle(adresse); }}>{titre('ecran.courriel.corriger')}</button></span>}
      </>}
      bas={<span className="sur"><Dessin id="cadenas" />{phrase('ecran.courriel.chiffree')}</span>}>
      {corriger ? (
        <form noValidate className="ent-formulaire" onSubmit={(e) => { e.preventDefault(); void envoyerCorrection(); }}>
          <span className="ent-carte-ico"><Dessin id="enveloppe" /></span>
          <div className="ent-entete"><h1>{titre('ecran.courriel.titre_inscription')}</h1></div>
          <Champ libelle={titre('ecran.courriel.corriger_champ')} aide={phrase('ecran.courriel.corriger_aide')} valeur={nouvelle} changer={setNouvelle}
            type="email" autoComplete="email" inputMode="email" premier {...g.sur('adresse')} />
          <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.courriel.corriger_bouton')}<Dessin id="fleche" /></Bouton>
          <button type="button" className="ent-lien ent-centre" onClick={() => setCorriger(false)}>{titre('ecran.courriel.corriger_annuler')}</button>
        </form>
      ) : (
        <form noValidate className="ent-formulaire" onSubmit={(e) => { e.preventDefault(); void valider(); }}>
          <span className="ent-carte-ico"><Dessin id="enveloppe" /></span>
          <div className="ent-entete">
            <h1>{titre('ecran.courriel.titre_inscription')}</h1>
            <p>{titre('ecran.courriel.envoye')} <b data-donnee>{adresse}</b>. {phrase('ecran.courriel.valable', { minutes: MINUTES })}</p>
          </div>
          <Champ classe="ent-code" libelle={titre('ecran.courriel.champ_inscription')} aide={phrase('ecran.courriel.champ_aide')} valeur={code} changer={setCode}
            autoComplete="one-time-code" inputMode="numeric" premier dessous={<span className="ent-aide">{phrase('ecran.courriel.dernier')}</span>} {...g.sur('code')} />
          <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.courriel.bouton_inscription')}<Dessin id="fleche" /></Bouton>
          <div className="ent-rien-recu">
            <span>{phrase('ecran.courriel.rien_recu')}</span>
            <span className="ent-renvoi">{boutonRenvoi}{renvoye}</span>
          </div>
          <p className="ent-message"><b>{titre('ecran.courriel.pourquoi_titre')}</b> {phrase('ecran.courriel.pourquoi')}</p>
        </form>
      )}
    </PageDouble>
  );
}
