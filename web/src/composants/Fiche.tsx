// Le haut de la facture qui se dessine pendant la frappe, et ce que l'écran dit du matricule (lot entrée, 06/10/2026 ;
// docs/entree.md) : la porte (« Ton entreprise ») et la vraie entreprise créée depuis l'exemple (lot onboarding) les
// partagent. La forme du matricule se dit avant le geste, avec la même règle que le serveur (commun/matricule.ts).
import { matriculeCanonique, matriculeSansSuite } from '../../../commun/matricule.ts';
import { dire, phrase, titre } from '../langue.ts';

export function etatDuMatricule(m: string): { texte: string; classe: string } {
  if (!m.trim()) return { texte: phrase('ecran.porte.mf_ou'), classe: '' };
  if (matriculeCanonique(m)) return { texte: phrase('ecran.porte.mf_ok'), classe: ' ok' };
  if (matriculeSansSuite(m)) return { texte: phrase('ecran.porte.mf_debut'), classe: ' alerte' };
  return { texte: phrase('ecran.porte.mf_faux'), classe: ' alerte' };
}

export function ApercuEntete({ raison, matricule, note }: { raison: string; matricule: string; note: string }) {
  const lisible = matriculeCanonique(matricule) ?? matricule.trim().toUpperCase();
  return (
    <div className="ent-apercu" aria-hidden="true">
      <span className="ent-apercu-etiquette">{dire('ecran.porte.apercu')}</span>
      <div className="ent-apercu-page">
        <div className="ent-apercu-haut">
          <div className="ent-apercu-qui">
            <span className="ent-apercu-logo">{titre('ecran.porte.apercu_logo')}</span>
            <div className="ent-apercu-nom">
              {raison.trim() ? <strong data-donnee>{raison.trim()}</strong> : <strong className="vide">{titre('ecran.porte.apercu_raison')}</strong>}
              <span>{dire('ecran.porte.apercu_mf')} : {lisible ? <span data-donnee>{lisible}</span> : '—'}</span>
            </div>
          </div>
          <span className="ent-apercu-type">{dire('ecran.porte.apercu_type')}</span>
        </div>
        <div className="ent-apercu-lignes">
          <i style={{ width: '62%' }} /><i style={{ width: '48%' }} />
          <div className="ligne"><i style={{ width: '40%' }} /><i style={{ width: '14%' }} /></div>
          <div className="ligne"><i style={{ width: '34%' }} /><i style={{ width: '12%' }} /></div>
        </div>
      </div>
      <span className="ent-aide">{note}</span>
    </div>
  );
}
