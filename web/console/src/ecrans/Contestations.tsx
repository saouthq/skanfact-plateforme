// Les contestations de nos factures (0129 ; docs/console.md C52 ; serveur/console/contestations.ts) : la noter depuis la
// ligne de sa facture sur la fiche — ce que le client conteste, par quel canal —, puis la régulariser, depuis la fiche ou
// Paiements, d'une de quatre façons : un avoir, un remboursement (chacun avec sa référence), la facture maintenue, ou
// retirée. L'avoir et le remboursement se font dans l'application de SkanFact ; ici, leur trace. La direction seule
// régularise avec de l'argent ; le support note une contestation et la dit retirée.
import { useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole } from '../contexte.ts';
import { jourCourt, jourDe } from '../temps.ts';
import { Alerte, Bouton, Champ, Dialogue, maj, Pilules, toast, Zone } from '../ui.tsx';
import { montant } from '../argent.ts';

export const CANAUX = ['telephone', 'courriel', 'whatsapp', 'support', 'autre'] as const;
export type Canal = typeof CANAUX[number];
export const ISSUES = ['avoir', 'remboursement', 'maintenue', 'retiree'] as const;
export type Issue = typeof ISSUES[number];
export type Contestation = {
  id: string; facture: string; piece: string; numero: string | null; entreprise: { id: string; nom: string };
  canal: Canal; dit: string; ouverteLe: string; ouvertePar: string | null;
  // `rapprochement` (0138, l'audit 1.42.0 A04) : le montant de l'avoir ou du remboursement, s'il couvre moins que la
  // facture, et s'il est rapproché (un avoir l'est toujours ; un remboursement, quand SkanFact l'a noté sur la facture).
  close: { le: string; issue: Issue; reference: string | null; motif: string; par: string | null;
    rapprochement?: { montant: string; le: string | null; partiel: boolean; rapproche: boolean } | null } | null;
};
const K = 'console.ecran.contestation';

// Une contestation en une ligne : « contestée le 12/10 par téléphone », ou « régularisée le 14/10 : avoir AV-2026-0003 ».
export function contestationEnMots(c: Contestation): string {
  if (!c.close) return dire(`${K}.en_cours`, { le: jourCourt(jourDe(c.ouverteLe)), canal: dire(`${K}.canal.${c.canal}`) });
  // Une référence (« AV-2026-0001 ») ne se coupe pas à ses tirets : des tirets insécables.
  const valeurs = { le: jourCourt(jourDe(c.close.le)), reference: (c.close.reference ?? '').replaceAll('-', '\u2011') };
  const r = c.close.rapprochement;
  if (!r || (c.close.issue !== 'avoir' && c.close.issue !== 'remboursement')) return dire(`${K}.close.${c.close.issue}`, valeurs);
  const plus = { ...valeurs, montant: montant(r.montant), jour: jourCourt(r.le), part: dire(`${K}.close.${r.partiel ? 'partiel' : 'complet'}`) };
  return c.close.issue === 'avoir' ? dire(`${K}.close.avoir_montant`, plus)
    : dire(r.rapproche ? `${K}.close.remboursement_note` : `${K}.close.remboursement_declare`, plus);
}
// Un remboursement déclaré que SkanFact n'a pas encore noté sur la facture : il attend (orange, comme une contestation
// en cours).
export const aNoter = (c: Contestation): boolean => c.close?.issue === 'remboursement' && c.close.rapprochement?.rapproche === false;

function useEnvoi(fait: () => void) {
  const api = useApi();
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (texte: string, champ: string) => { setRefus(texte); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const envoyer = (chemin: string, corps: unknown, dit: string) => {
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', chemin, corps);
        if (!r) return;
        if (r.statut === 200 || r.statut === 201) { toast(dit); fait(); return; }
        setRefus(refusDe(r));
        if (typeof r.corps.champ === 'string') setFaute((f) => ({ champ: r.corps.champ as string, n: (f?.n ?? 0) + 1 }));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  // un autre choix : le refus du précédent ne tient plus
  const oublier = () => { setRefus(null); setFaute(null); };
  return { envoyer, refuser, oublier, refus, occupe, faute: (champ: string) => faute?.champ === champ, n: faute?.n ?? 0 };
}
function Qui() {
  const { moi } = useConsole();
  return <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>;
}
function Pied({ fermer, occupe, envoyer, bouton }: { fermer: () => void; occupe: boolean; envoyer: () => void; bouton: string }) {
  return (
    <>
      <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
      <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{bouton}</Bouton>
    </>
  );
}

// Noter qu'un client conteste une facture.
export function FenetreContester({ facture, client, fermer, fait }: { facture: { id: string; numero: string }; client: string; fermer: () => void; fait: () => void }) {
  const e = useEnvoi(fait);
  const [canal, setCanal] = useState<Canal>('telephone');
  const [dit, setDit] = useState('');
  const envoyer = () => {
    if (dit.trim().length < 3) { e.refuser(phrase(`${K}.noter.dit_court`), 'dit'); return; }
    e.envoyer(`/console/factures-abonnement/${facture.id}/contester`, { canal, dit: dit.trim() }, phrase(`${K}.noter.fait`, { numero: facture.numero }));
  };
  return (
    <Dialogue titre={titre(`${K}.noter.titre`, { numero: facture.numero })} pour={client} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${K}.noter.bouton`)} />}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((x) => <li key={x}>{phrase(`${K}.noter.${x}`)}</li>)}</ul>
      </div>
      <Pilules libelle={titre(`${K}.noter.canal`)} valeur={canal} changer={setCanal} choix={CANAUX.map((x) => ({ valeur: x, texte: maj(dire(`${K}.canal.${x}`)) }))} />
      <Zone libelle={titre(`${K}.noter.dit`)} aide={phrase(`${K}.noter.dit_aide`)} valeur={dit} changer={setDit} max={1000} premier faute={e.faute('dit')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}

// La régulariser : l'issue, la référence de l'avoir ou du remboursement, le motif. Le support ne voit que « retirée ».
export function FenetreRegulariser({ c, fermer, fait }: { c: Contestation; fermer: () => void; fait: () => void }) {
  const { moi } = useConsole();
  const permises = moi.role === 'direction' ? ISSUES : (['retiree'] as const);
  const e = useEnvoi(fait);
  const [issue, setIssue] = useState<Issue>(permises[0]);
  const [reference, setReference] = useState('');
  const [motif, setMotif] = useState('');
  // Un remboursement dit combien et quand (0138) : il est déclaré, puis rapproché quand SkanFact le note sur la facture.
  const aujourdhui = jourDe(new Date().toISOString());
  const [somme, setSomme] = useState('');
  const [le, setLe] = useState(aujourdhui);
  const avecReference = issue === 'avoir' || issue === 'remboursement';
  const envoyer = () => {
    if (avecReference && !reference.trim()) { e.refuser(phrase(`${K}.reg.reference_vide.${issue}`), 'reference'); return; }
    if (issue === 'remboursement' && !somme.trim()) { e.refuser(phrase(`${K}.reg.montant_vide`), 'montant'); return; }
    if (issue === 'remboursement' && !le) { e.refuser(phrase(`${K}.reg.jour_vide`), 'le'); return; }
    if (motif.trim().length < 3) { e.refuser(phrase('console.ecran.geste.motif_court'), 'motif'); return; }
    e.envoyer(`/console/contestations/${c.id}/regulariser`, { issue, reference: avecReference ? reference.trim() : null,
      ...(issue === 'remboursement' ? { montant: somme.trim(), le } : {}), motif: motif.trim() },
      phrase(`${K}.reg.fait.${issue}`, { numero: c.numero ?? '—' }));
  };
  return (
    <Dialogue titre={titre(`${K}.reg.titre`, { numero: c.numero ?? '—' })} pour={c.entreprise.nom} fermer={fermer} occupe={e.occupe}
      pied={<Pied fermer={fermer} occupe={e.occupe} envoyer={envoyer} bouton={titre(`${K}.reg.bouton.${issue}`)} />}>
      <div className="c-ct-dit">
        <span className="c-champ-libelle">{titre(`${K}.reg.conteste`, { le: jourCourt(jourDe(c.ouverteLe)), canal: dire(`${K}.canal.${c.canal}`) })}</span>
        <p data-donnee>{c.dit}</p>
      </div>
      {permises.length > 1 ? (
        <Pilules libelle={titre(`${K}.reg.issue`)} valeur={issue} changer={(x) => { e.oublier(); setIssue(x); }} choix={permises.map((x) => ({ valeur: x, texte: maj(dire(`${K}.issue.${x}`)) }))} />
      ) : null}
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>
          <li>{phrase(`${K}.reg.p.${issue}`)}</li>
          <li>{phrase(`${K}.reg.p_journal`)}</li>
          {moi.role !== 'direction' ? <li>{phrase(`${K}.reg.p_support`)}</li> : null}
        </ul>
      </div>
      {avecReference ? (
        <Champ libelle={titre(`${K}.reg.reference.${issue}`)} aide={phrase(`${K}.reg.reference_aide.${issue}`)} valeur={reference} changer={setReference}
          faute={e.faute('reference')} n={e.n} />
      ) : null}
      {issue === 'remboursement' ? (
        <div className="c-ct-rembourse">
          <Champ libelle={titre(`${K}.reg.montant`)} aide={phrase(`${K}.reg.montant_aide`)} valeur={somme} changer={setSomme} inputMode="decimal"
            faute={e.faute('montant')} n={e.n} />
          <Champ libelle={titre(`${K}.reg.jour`)} type="date" max={aujourdhui} valeur={le} changer={setLe} faute={e.faute('le')} n={e.n} />
        </div>
      ) : null}
      <Zone libelle={titre('console.ecran.geste.motif')} valeur={motif} changer={setMotif} faute={e.faute('motif')} n={e.n} />
      <Qui />
      {e.refus ? <Alerte ton="danger">{e.refus}</Alerte> : null}
    </Dialogue>
  );
}
