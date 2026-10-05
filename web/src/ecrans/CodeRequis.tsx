// Le code du téléphone à mettre en place (le rôle l'exige, 03 § 6), puis SkanFact à ajouter dans
// l'application d'authentification et les codes de secours, montrés une seule fois. Dans la carte
// d'accueil de la v10 : c'est l'étape suivante, et la seule.
//
// Brique 145 (vu en essayant l'inscription comme un testeur, 05/10/2026 : l'écran ne montrait qu'une adresse
// « otpauth:// », que personne ne sait ajouter à la main) : un code QR à scanner, la clé en clair pour qui la tape,
// le lien qui ouvre l'application quand on est déjà sur son téléphone, et le premier code vérifié avant de partir.
import qrcode from 'qrcode-generator';
import { useState } from 'react';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Champ } from '../composants/Champ.tsx';
import { refusDe, useGeste } from '../geste.ts';
import { phrase, titre } from '../langue.ts';

// Le code QR de l'adresse, en <svg> (une adresse « otpauth:// » est en ASCII).
function svgDuQr(adresse: string): string {
  const q = qrcode(0, 'M');
  q.addData(adresse);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}
// La clé par groupes de quatre, comme les applications l'affichent.
const parQuatre = (cle: string) => cle.replace(/(.{4})(?=.)/g, '$1 ');

export function CodeRequis({ pose, deconnecte }: { pose: () => void; deconnecte: () => void }) {
  const g = useGeste(deconnecte);
  const [codes, setCodes] = useState<{ adresse: string | null; cle: string | null; secours: string[] } | null>(null);
  const [essai, setEssai] = useState('');

  const poser = () => g.geste(async () => {
    const r = await g.api<{ codesDeSecours: string[]; adresseApplication: string | null; cle: string | null }>('POST', '/moi/code', { methode: 'application' });
    if (!r) return;
    if (r.statut === 200) setCodes({ adresse: r.corps.adresseApplication, cle: r.corps.cle, secours: r.corps.codesDeSecours }); else g.refuser(refusDe(r));
  });
  const verifier = () => g.geste(async () => {
    const r = await g.api('POST', '/moi/code/essayer', { code: essai });
    if (!r) return;
    if (r.statut === 200) pose(); else g.refuser({ ...refusDe(r), champ: 'code' });
  });

  if (codes) {
    return (
      <Carte titre={titre('ecran.code_pose.titre')} sous={phrase('ecran.code_pose.application')} onSubmit={() => { void verifier(); }}
        pied={<Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.code_pose.bouton')}</Bouton>}>
        {codes.adresse ? (
          <div className="code-qr">
            <div className="code-qr-image" data-donnee role="img" aria-label={phrase('ecran.code_pose.qr')} dangerouslySetInnerHTML={{ __html: svgDuQr(codes.adresse) }} />
            <div className="code-qr-etapes">
              <p>{phrase('ecran.code_pose.scanner')}</p>
              {codes.cle ? <p>{phrase('ecran.code_pose.cle')}<br /><code className="code-cle" data-donnee>{parQuatre(codes.cle)}</code></p> : null}
              <p><a className="btn" href={codes.adresse}>{titre('ecran.code_pose.ouvrir')}</a></p>
            </div>
          </div>
        ) : null}
        <p>{phrase('ecran.code_pose.secours')}</p>
        <ul className="codes-secours" data-donnee>{codes.secours.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="grid-2">
          <Champ classe="span-2" libelle={titre('ecran.code_pose.essai')} aide={phrase('ecran.code_pose.essai_aide')} valeur={essai} changer={setEssai}
            autoComplete="one-time-code" inputMode="numeric" {...g.sur('code')} />
        </div>
      </Carte>
    );
  }
  return (
    <Carte titre={titre('ecran.code_requis.titre')} sous={phrase('ecran.accueil.sous')}
      pied={<>
        <Bouton discret onClick={deconnecte}>{titre('ecran.deconnexion')}</Bouton>
        <Bouton principal occupe={g.occupe} onClick={() => { void poser(); }}>{titre('ecran.code_requis.bouton')}</Bouton>
      </>}>
      <p>{phrase('ecran.code_requis.aide')}</p>
    </Carte>
  );
}
