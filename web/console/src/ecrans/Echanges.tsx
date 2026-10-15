// Nos échanges avec un client (0110 ; la maquette Fiche, « Noter un appel… », « Écrire… ») :
//   - noter un appel : comment il s'est passé, ce qui s'est dit en deux lignes ; la note se range sur sa fiche, toute
//     l'équipe la lit avant de rappeler, et elle ne part jamais chez le client ;
//   - écrire au contact : le message s'ouvre dans l'application de la personne choisie, comme une demande au support que
//     SkanFact commence ; une alerte par e-mail la prévient, sans le texte ; sa réponse revient dans le Support.
import { useState } from 'react';
import { dire, phrase, titre } from '../langue.ts';
import { panneDe, refusDe, useApi, useConsole, useLecture } from '../contexte.ts';
import { Alerte, Bouton, Champ, Choix, Dialogue, Pilules, toast, Zone } from '../ui.tsx';

export type ResultatAppel = 'parle' | 'sans_reponse' | 'message_laisse';
export const RESULTATS: readonly ResultatAppel[] = ['parle', 'sans_reponse', 'message_laisse'];
const K = 'console.ecran.echanges';

export function NoterAppel({ client, fermer, fait }: { client: { id: string; nom: string }; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [resultat, setResultat] = useState<ResultatAppel>('parle');
  const [resume, setResume] = useState('');
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const envoyer = () => {
    // On s'est parlé : ce qui s'est dit, en deux lignes. Sans réponse, la note peut rester courte.
    if (resultat === 'parle' && resume.trim().length < 3) { setRefus(phrase(`${K}.appel.resume_court`)); setFaute((n) => n + 1); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api('POST', `/console/entreprises/${client.id}/appels`, { resultat, ...(resume.trim() ? { resume: resume.trim() } : {}) });
        if (!r) return;
        if (r.statut === 201) { toast(phrase(`${K}.appel.fait`, { nom: client.nom })); fait(); return; }
        setRefus(refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.appel.titre`)} pour={client.nom} fermer={fermer} occupe={occupe}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} onClick={envoyer}>{titre(`${K}.appel.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2'].map((x) => <li key={x}>{phrase(`${K}.appel.${x}`)}</li>)}</ul>
      </div>
      <Pilules libelle={titre(`${K}.appel.resultat`)} valeur={resultat} changer={setResultat}
        choix={RESULTATS.map((x) => ({ valeur: x, texte: titre(`${K}.resultat.${x}`) }))} />
      <Zone libelle={titre(`${K}.appel.resume`)} aide={phrase(`${K}.appel.resume_aide`)} valeur={resume} changer={setResume} max={1000} premier faute={faute > 0} n={faute} />
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// L'objet et le début du message, selon où en est son abonnement (la maquette : « Ton essai se termine le … »). Un
// brouillon : la personne de l'équipe le relit et l'écrit à sa façon.
export type Contexte = 'essai' | 'en_retard' | 'lecture_seule' | 'envoi' | 'autre';
type Personne = { id: string; nom: string; roles: string[] };
export function EcrireAuContact({ client, contexte, valeurs = {}, fermer, fait }: { client: { id: string; nom: string }; contexte: Contexte; valeurs?: Record<string, string>; fermer: () => void; fait: () => void }) {
  const api = useApi();
  const { moi } = useConsole();
  const [personnes] = useLecture<{ personnes: Personne[] }>(`/console/support/personnes/${client.id}`);
  const liste = personnes.etat === 'lu' ? personnes.donnees.personnes : [];
  // La propriétaire d'abord : c'est à elle qu'on écrit d'abord.
  const tries = [...liste].sort((a, b) => Number(b.roles.includes('proprietaire')) - Number(a.roles.includes('proprietaire')));
  const [qui, setQui] = useState('');
  const choisi = qui || tries[0]?.id || '';
  const prenom = (tries.find((p) => p.id === choisi)?.nom ?? '').split(/\s+/)[0] ?? '';
  const [sujet, setSujet] = useState(() => titre(`${K}.ecrire.objet.${contexte}`, valeurs));
  const [texte, setTexte] = useState('');
  const [touche, setTouche] = useState(false);
  const corps = touche ? texte : dire(`${K}.ecrire.debut.${contexte}`, { ...valeurs, prenom, nom: moi.nom });
  const [refus, setRefus] = useState<string | null>(null);
  const [faute, setFaute] = useState<{ champ: string; n: number } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const refuser = (champ: string, t: string) => { setRefus(t); setFaute((f) => ({ champ, n: (f?.n ?? 0) + 1 })); };
  const fauteDe = (champ: string) => ({ faute: faute?.champ === champ, n: faute?.champ === champ ? faute.n : 0 });
  const envoyer = () => {
    if (!choisi) { refuser('qui', phrase(`${K}.ecrire.sans_personne`)); return; }
    if (sujet.trim().length < 3) { refuser('sujet', phrase(`${K}.ecrire.objet_court`)); return; }
    if (/[<>]/.test(sujet)) { refuser('sujet', phrase(`${K}.ecrire.sans_balise`)); return; }
    if (corps.trim().length < 3) { refuser('texte', phrase(`${K}.ecrire.texte_court`)); return; }
    void (async () => {
      setOccupe(true);
      try {
        const r = await api<{ demande: string }>('POST', `/console/entreprises/${client.id}/ecrire`, { destinataire: choisi, sujet: sujet.trim(), texte: corps.trim() });
        if (!r) return;
        if (r.statut === 201) { toast(phrase(`${K}.ecrire.fait`)); fait(); return; }
        refuser(typeof r.corps.champ === 'string' ? r.corps.champ : '', refusDe(r));
      } catch (x) { setRefus(panneDe(x)); } finally { setOccupe(false); }
    })();
  };
  return (
    <Dialogue titre={titre(`${K}.ecrire.titre`)} pour={client.nom} fermer={fermer} occupe={occupe} pret={personnes.etat !== 'lecture'}
      pied={<>
        <Bouton ferme onClick={fermer} desactive={occupe}>{titre('console.ecran.annuler')}</Bouton>
        <Bouton ton="principal" occupe={occupe} desactive={personnes.etat === 'lu' && !liste.length} onClick={envoyer}>{titre(`${K}.ecrire.bouton`)}</Bouton>
      </>}>
      <div className="c-al-ce-qui-va">
        <span className="c-champ-libelle">{titre('console.ecran.service.al.geste.ce_qui_va')}</span>
        <ul>{['p1', 'p2', 'p3'].map((x) => <li key={x}>{phrase(`${K}.ecrire.${x}`)}</li>)}</ul>
      </div>
      {personnes.etat === 'panne' ? <Alerte ton="danger">{personnes.texte}</Alerte> : null}
      {personnes.etat === 'lu' && !liste.length ? <Alerte ton="info">{phrase(`${K}.ecrire.sans_personne`)}</Alerte> : null}
      {tries.length ? (
        <Choix libelle={titre(`${K}.ecrire.a_qui`)} valeur={choisi} changer={setQui}
          options={tries.map((p) => ({ valeur: p.id, texte: p.roles.length ? `${p.nom} · ${p.roles.map((r) => dire(`role.${r}`).toLowerCase()).join(', ')}` : p.nom, donnee: true }))} />
      ) : null}
      <Champ libelle={titre(`${K}.ecrire.objet`)} valeur={sujet} changer={setSujet} {...fauteDe('sujet')} />
      <div className="c-ech-message">
        <Zone libelle={titre(`${K}.ecrire.texte`)} aide={phrase(`${K}.ecrire.texte_aide`)} valeur={corps} changer={(v) => { setTouche(true); setTexte(v); }} max={4000} premier {...fauteDe('texte')} />
      </div>
      <p className="c-al-qui">{phrase('console.ecran.service.al.geste.qui', { nom: moi.nom, role: dire(`console.ecran.role.${moi.role}`) })}</p>
      {refus ? <Alerte ton="danger">{refus}</Alerte> : null}
    </Dialogue>
  );
}

// Le dernier échange, en une ligne (« Dernier échange : mar. 06/10, Nadia · on s'est parlé »).
export const resultatEnMots = (r: ResultatAppel) => dire(`${K}.resultat.${r}`);
export const contexteDe = (etat: string, raison?: string): Contexte =>
  etat === 'essai' ? 'essai' : etat === 'en_retard' ? 'en_retard' : etat === 'lecture_seule' && raison !== 'suspendu' ? 'lecture_seule' : 'autre';
