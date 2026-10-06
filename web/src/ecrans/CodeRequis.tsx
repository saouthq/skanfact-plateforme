// Le code du téléphone à mettre en place (le rôle l'exige, 03 § 6) : d'abord pourquoi, en clair (« ton rôle l'exige »
// ne disait rien au débutant, qui ne savait même pas si son entreprise était créée : elle l'est, et l'écran le dit),
// puis SkanFact à ajouter dans l'application d'authentification et les codes de secours, montrés une seule fois.
//
// Brique 145 (vu en essayant l'inscription comme un testeur, 05/10/2026 : l'écran ne montrait qu'une adresse
// « otpauth:// », que personne ne sait ajouter à la main) : un code QR à scanner, la clé en clair pour qui la tape,
// le lien qui ouvre l'application quand on est déjà sur son téléphone, et le premier code vérifié avant de partir.
// Lot entrée (06/10/2026 ; docs/entree.md) : les codes de secours se copient et se téléchargent, et l'écran ne part pas
// avant que la personne dise les avoir mis de côté (ils ne se montreront plus).
import qrcode from 'qrcode-generator';
import { useRef, useState } from 'react';
import { Bouton } from '../composants/Bouton.tsx';
import { Carte } from '../composants/Carte.tsx';
import { Case, Champ } from '../composants/Champ.tsx';
import { Dessin, PageEtapes } from '../composants/Entree.tsx';
import { toast } from '../composants/Toast.tsx';
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

async function copier(texte: string, fait: string) {
  try { await navigator.clipboard.writeText(texte); toast(fait); } catch { toast(phrase('ecran.code_pose.copie_impossible'), true); }
}
// Les codes de secours dans un fichier texte, que le navigateur enregistre.
function telecharger(codes: string[]) {
  const jour = new Date().toLocaleDateString('fr-FR');
  const contenu = `${phrase('ecran.code_pose.fichier', { jour })}\n\n${codes.join('\n')}\n`;
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([contenu], { type: 'text/plain;charset=utf-8' }));
  lien.download = 'skanfact-codes-de-secours.txt';
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
}

const seDeconnecter = (deconnecte: () => void) => <button type="button" className="ent-lien gris" onClick={deconnecte}>{titre('ecran.deconnexion')}</button>;

export function CodeRequis({ pose, deconnecte, entreprise }: { pose: () => void; deconnecte: () => void; entreprise?: string | undefined }) {
  const g = useGeste(deconnecte);
  const [codes, setCodes] = useState<{ adresse: string | null; cle: string | null; secours: string[] } | null>(null);
  const [essai, setEssai] = useState('');
  const [garde, setGarde] = useState(false);
  const caseGarde = useRef<HTMLDivElement>(null);

  const poser = () => g.geste(async () => {
    const r = await g.api<{ codesDeSecours: string[]; adresseApplication: string | null; cle: string | null }>('POST', '/moi/code', { methode: 'application' });
    if (!r) return;
    if (r.statut === 200) setCodes({ adresse: r.corps.adresseApplication, cle: r.corps.cle, secours: r.corps.codesDeSecours }); else g.refuser(refusDe(r));
  });
  const verifier = () => g.geste(async () => {
    // Les codes de secours ne se montreront plus : on ne part pas sans les avoir mis de côté.
    if (!garde) { toast(phrase('ecran.code_pose.garde_avant'), true); caseGarde.current?.querySelector('input')?.focus(); return; }
    const r = await g.api('POST', '/moi/code/essayer', { code: essai });
    if (!r) return;
    if (r.statut === 200) pose(); else g.refuser({ ...refusDe(r), champ: 'code' });
  });

  if (codes) {
    return (
      <PageEtapes etape={3} droite={seDeconnecter(deconnecte)}>
        <div className="ent-titre-page"><h1>{titre('ecran.code_pose.titre')}</h1><p>{phrase('ecran.code_pose.application')}</p></div>
        <form noValidate className="ent-pose" onSubmit={(e) => { e.preventDefault(); void verifier(); }}>
          <ol>
            <li><span className="num" data-donnee>1</span><div className="contenu">
              <b>{titre('ecran.code_pose.installer')}</b><span>{phrase('ecran.code_pose.installer_texte')}</span>
              <div className="ent-puces" data-donnee><span>Google Authenticator</span><span>Microsoft Authenticator</span></div>
            </div></li>
            {codes.adresse ? (
              <li><span className="num" data-donnee>2</span><div className="contenu"><div className="ent-qr">
                <div>
                  <b>{titre('ecran.code_pose.scanner_titre')}</b>
                  <p>{phrase('ecran.code_pose.scanner')}</p>
                  {codes.cle ? <>
                    <p>{phrase('ecran.code_pose.cle')}</p>
                    <div className="ent-cle"><code className="code-cle" data-donnee>{parQuatre(codes.cle)}</code>
                      <button type="button" className="ent-petit" onClick={() => { void copier(codes.cle ?? '', phrase('ecran.code_pose.cle_copiee')); }}>{titre('ecran.code_pose.copier')}</button></div>
                  </> : null}
                  <a className="ent-lien" href={codes.adresse}>{titre('ecran.code_pose.ouvrir')}</a>
                </div>
                <div className="ent-qr-image" data-donnee role="img" aria-label={phrase('ecran.code_pose.qr')} dangerouslySetInnerHTML={{ __html: svgDuQr(codes.adresse) }} />
              </div></div></li>
            ) : null}
            <li><span className="num" data-donnee>3</span><div className="contenu">
              <Champ classe="ent-code" libelle={titre('ecran.code_pose.essai')} aide={phrase('ecran.code_pose.essai_aide')} valeur={essai} changer={setEssai}
                autoComplete="one-time-code" inputMode="numeric" {...g.sur('code')} />
            </div></li>
          </ol>
          <aside className="ent-secours">
            <h2><Dessin id="bouclier" />{titre('ecran.code_pose.secours_titre')}</h2>
            <p>{phrase('ecran.code_pose.secours')}</p>
            <ul data-donnee>{codes.secours.map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="boutons">
              <button type="button" className="ent-petit" onClick={() => { void copier(codes.secours.join('\n'), phrase('ecran.code_pose.codes_copies')); }}>{titre('ecran.code_pose.copier')}</button>
              <button type="button" className="ent-petit" onClick={() => telecharger(codes.secours)}>{titre('ecran.code_pose.telecharger')}</button>
            </div>
            <div ref={caseGarde}><Case libelle={titre('ecran.code_pose.garde')} coche={garde} changer={setGarde} /></div>
          </aside>
          <div className="ent-pose-pied">
            <span />
            <div className="droite">
              <span className={`ent-aide${garde ? ' ok' : ''}`} aria-live="polite">{phrase(garde ? 'ecran.code_pose.garde_ok' : 'ecran.code_pose.garde_avant')}</span>
              <Bouton principal type="submit" occupe={g.occupe}>{titre('ecran.code_pose.bouton')}<Dessin id="fleche" /></Bouton>
            </div>
          </div>
        </form>
      </PageEtapes>
    );
  }
  return (
    <Carte large etape={3} droite={seDeconnecter(deconnecte)} icone="bouclier" titre={titre('ecran.code_requis.titre')}
      bandeau={entreprise ? titre('ecran.code_requis.creee', { nom: entreprise }) : undefined} sous={phrase('ecran.code_requis.aide')}
      pied={<Bouton principal occupe={g.occupe} onClick={() => { void poser(); }}>{titre('ecran.code_requis.bouton')}<Dessin id="fleche" /></Bouton>}>
      <ol className="ent-etapes-courtes">
        {['ecran.code_requis.etape1', 'ecran.code_requis.etape2', 'ecran.code_requis.etape3'].map((cle, i) => (
          <li key={cle}><span className="num" data-donnee>{i + 1}</span><span>{phrase(cle)}</span></li>
        ))}
      </ol>
    </Carte>
  );
}
