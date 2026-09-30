// DigiGo (TunTrust), la signature à distance (brique 81 ; docs/facture-electronique.md ; vision § 5) : le
// certificat du signataire reste chez TunTrust ; SkanFact (l'« entité d'intégration ») ouvre une session pour
// lui, il reçoit un code sur SON téléphone, et ce code autorise la signature des fichiers de la session. Les
// noms et les champs du service sont À VÉRIFIER avec la documentation d'intégration (tests/digigo-simule.ts
// suit ce que TunTrust en publie). Rien du client ne part : le fichier TEIF, et l'identifiant du signataire.

import { t, type Texte } from '../../textes/index.ts';
import './textes.ts';

type Reponse<T> = { ok: true; valeur: T } | { ok: false; statut: number; motif: Texte };

async function appeler<T>(base: string, cle: string, chemin: string, corps: unknown): Promise<Reponse<T>> {
  let r: Response;
  try {
    r = await fetch(`${base}/${chemin}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-cle-integrateur': cle },
      body: JSON.stringify(corps), signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, statut: 0, motif: t('efacture.digigo_injoignable') };
  }
  const lu = await r.json().catch(() => null) as (T & { message?: string }) | null;
  if (!r.ok || !lu) return { ok: false, statut: r.status, motif: t('efacture.digigo_refus', { statut: r.status }) };
  return { ok: true, valeur: lu };
}

// Ouvrir une session pour le titulaire : un code part sur son téléphone.
export const ouvrirSession = (base: string, cle: string, identifiant: string) =>
  appeler<{ session: string; nom?: string }>(base, cle, 'session', { identifiant });
// Le code qu'il a reçu active la session.
export const activer = (base: string, cle: string, session: string, otp: string) =>
  appeler<{ ok: boolean }>(base, cle, 'setOtpAuth', { session, otp });
// Un fichier XML, signé en XAdES (enveloppée) dans la session activée.
export async function signer(base: string, cle: string, session: string, xml: string): Promise<Reponse<string>> {
  const r = await appeler<{ fichier: string }>(base, cle, 'sign', { session, fichier: Buffer.from(xml, 'utf8').toString('base64'), format: 'XAdES' });
  return r.ok ? { ok: true, valeur: Buffer.from(r.valeur.fichier, 'base64').toString('utf8') } : r;
}

// Deux chemins, un fichier : ce que DigiGo rend est le fichier envoyé, avec SA signature enveloppée, rien de
// plus ni de moins (une signature retirée, on retrouve le fichier au caractère près).
export function signatureEnveloppe(original: string, signe: string): boolean {
  const signatures = signe.match(/<ds:Signature[\s>][\s\S]*?<\/ds:Signature>/g) ?? [];
  return signatures.length === 1 && signe.replace(signatures[0] ?? '', '') === original;
}
