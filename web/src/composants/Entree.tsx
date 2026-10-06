// L'habit de l'entrée (lot entrée, 06/10/2026 ; maquettes validées par Skander, docs/entree.md) : la marque, la page en
// deux (la vitrine sombre et le formulaire : se connecter, créer son compte) et la page des étapes (un fond pointé, la
// barre du haut avec le fil compte → entreprise → sécurité). Les dessins sont tracés ici, jamais venus d'une donnée.
import type { ReactNode } from 'react';
import { dire, phrase, titre } from '../langue.ts';

const DESSINS: Record<string, string> = {
  fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  retour: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  coche: '<path d="M20 6 9 17l-5-5"/>',
  telephone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M9.5 10.5l1.8 1.8 3.4-3.6"/>',
  cadenas: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bouclier: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  lignes: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  equipe: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.8 6 5.5"/>',
  coupure: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M3 3l18 18"/>',
  boussole: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  batiment: '<path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6"/>',
  cabinet: '<path d="M4 19V9l8-5 8 5v10M9 19v-5h6v5M4 19h16"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
  enveloppe: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  cle: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
};

export function Dessin({ id }: { id: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: DESSINS[id] ?? '' }} />;
}

// La marque : le nom ne se traduit pas (une donnée, pour l'instrument de rendu).
export function Marque() {
  return <span className="ent-marque"><span className="ent-logo" aria-hidden="true" data-donnee>S</span><span data-donnee>SkanFact</span></span>;
}

// La facture d'exemple de la vitrine : des montants justes au millime (828,000 + 157,320 + 1,000 = 986,320).
function FactureExemple() {
  return (
    <div className="ent-facture" aria-hidden="true">
      <div className="ent-facture-haut">
        <div><div className="ent-facture-type">{dire('ecran.vitrine.facture')}</div><div data-chiffres data-donnee>FAC-2026-0142</div></div>
        <span className="ent-facture-badge"><Dessin id="coche" />{titre('ecran.vitrine.acceptee')}</span>
      </div>
      <div className="ent-facture-client" data-donnee>Librairie Ennour · 06/10/2026</div>
      <div className="ent-facture-lignes" data-donnee>
        <div><span>Écran 24 pouces · 2 × 389,000</span><span>778,000</span></div>
        <div><span>Câble HDMI 2 m · 4 × 12,500</span><span>50,000</span></div>
      </div>
      <div className="ent-facture-lignes totaux">
        <div><span>{titre('ecran.vitrine.total_ht')}</span><span>828,000</span></div>
        <div><span>{titre('ecran.vitrine.tva')}</span><span>157,320</span></div>
        <div><span>{titre('ecran.vitrine.timbre')}</span><span>1,000</span></div>
      </div>
      <div className="ent-facture-bas">
        <div className="ent-facture-ttc"><span>{titre('ecran.vitrine.ttc')}</span><strong>986,320 <small>{dire('ecran.vitrine.devise')}</small></strong></div>
        <svg className="ent-facture-qr" viewBox="0 0 7 7" shapeRendering="crispEdges"><rect width="7" height="7" fill="#fff" /><path fill="#13211f" d="M0 0h3v3H0zM4 0h3v3H4zM0 4h3v3H0zM4 4h1v1H4zM6 4h1v2H6zM4 6h2v1H4zM5 5h1v1H5z" /><path fill="#fff" d="M1 1h1v1H1zM5 1h1v1H5zM1 5h1v1H1z" /></svg>
      </div>
    </div>
  );
}

// La vitrine de « se connecter » : ce qu'est SkanFact, et une vraie facture.
export function VitrineConnexion() {
  return (
    <>
      <div className="ent-vitrine-titre"><h2>{titre('ecran.vitrine.titre')}</h2><p>{phrase('ecran.vitrine.sous')}</p></div>
      <div className="ent-vitrine-milieu"><FactureExemple /></div>
      <ul className="ent-points">
        <li><Dessin id="lignes" />{titre('ecran.vitrine.point_ttn')}</li>
        <li><Dessin id="equipe" />{titre('ecran.vitrine.point_cabinet')}</li>
        <li><Dessin id="coupure" />{titre('ecran.vitrine.point_coupure')}</li>
      </ul>
    </>
  );
}

// La vitrine de « créer ton compte » : les trois étapes, sans surprise.
export function VitrineCompte() {
  const etapes = [['compte', 'ecran.etape.compte_texte'], ['entreprise', 'ecran.etape.entreprise_texte'], ['securite', 'ecran.etape.securite_texte']] as const;
  return (
    <>
      <div className="ent-vitrine-titre"><h2>{titre('ecran.vitrine.compte_titre')}</h2><p>{phrase('ecran.vitrine.compte_sous')}</p></div>
      <ol className="ent-etapes-liste">
        {etapes.map(([e, texte], i) => (
          <li key={e} className={i === 0 ? 'actuelle' : ''}>
            <span className="num" data-donnee>{i + 1}</span>
            <span className="txt"><b>{titre(`ecran.etape.${e}`)}</b><span>{phrase(texte)}</span></span>
          </li>
        ))}
      </ol>
    </>
  );
}

// La page en deux : la vitrine à gauche (au téléphone, la marque seule en haut), le formulaire à droite.
export function PageDouble({ vitrine, haut, bas, children }: { vitrine: ReactNode; haut?: ReactNode; bas?: ReactNode; children: ReactNode }) {
  return (
    <div className="ent ent-double">
      <aside className="ent-vitrine"><Marque />{vitrine}</aside>
      <main className="ent-cote">
        <div className="ent-cote-haut">{haut}</div>
        <div className="ent-cote-milieu">{children}</div>
        {bas ? <div className="ent-cote-bas">{bas}</div> : null}
      </main>
    </div>
  );
}

// Le fil des étapes de la première fois : ton compte → ton entreprise → la sécurité.
export function Fil({ etape }: { etape: 1 | 2 | 3 }) {
  const noms = ['compte', 'entreprise', 'securite'];
  return (
    <ol className="ent-fil" aria-label={titre('ecran.etape.fil')}>
      {noms.map((n, i) => {
        const etat = i + 1 < etape ? 'fait' : i + 1 === etape ? 'actuelle' : '';
        return [
          i > 0 ? <li key={`t${n}`} className={`trait${i + 1 <= etape ? ' fait' : ''}`} aria-hidden="true" /> : null,
          <li key={n} className={etat} {...(etat === 'actuelle' ? { 'aria-current': 'step' as const } : {})}>
            <span className="rond">{etat === 'fait' ? <Dessin id="coche" /> : <span data-donnee>{i + 1}</span>}</span>
            <span className="nom">{titre(`ecran.etape.${n}`)}</span>
          </li>,
        ];
      })}
    </ol>
  );
}

// La page des étapes : la marque, le fil (s'il y en a un) et ce qui se fait à droite (se déconnecter, revenir).
export function PageEtapes({ etape, droite, etroite = false, children }: { etape?: 1 | 2 | 3 | undefined; droite?: ReactNode; etroite?: boolean; children: ReactNode }) {
  return (
    <div className="ent ent-etapes">
      <header className="ent-barre"><Marque />{etape ? <Fil etape={etape} /> : null}{droite ?? <span />}</header>
      <main className={`ent-scene${etroite ? ' etroite' : ''}`}>{children}</main>
    </div>
  );
}
