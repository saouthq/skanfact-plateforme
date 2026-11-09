// (1.329.0) « Je facturais déjà » : la suite qu'une entreprise annonce dans son dossier (`counters`, « facture-2026 » : 47,
// posée par « Continuer ma numérotation… » ou Paramètres → Documents → Numérotation) n'arrivait jamais à la série du
// serveur. La fenêtre d'émission annonçait FAC-2026-048 et le serveur donnait FAC-2026-001 : deux factures « 001 » la même
// année, l'une dans le carnet, l'autre ici (trouvé en jouant la boulangerie, 1.328.0). Trois règles, une par geste :
//   - ÉCRIRE la suite d'une facture ou d'un avoir est un réglage fiscal : le propriétaire ou un administrateur (le geste
//     de la reprise d'une série, `socle.reglages_fiscaux.modifier`), et jamais pour une année où un numéro a été donné ;
//   - ÉMETTRE la première pièce d'une année encore vierge part de la suite annoncée (base 0204, `ventes.reprendre_v10`),
//     qui que soit celui qui émet ; une année où un numéro a été donné ne bouge jamais (une série légale reste continue) ;
//   - ANNONCER le numéro avant d'émettre se lit au serveur qui le donnera (deux chemins, un chiffre).

import type { Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import { permet } from './droits.ts';
import { estObjet } from './lecture.ts';

export const SERIE_V10: Record<'facture' | 'avoir', string> = { facture: 'FAC', avoir: 'AVO' };
const CLE = /^(facture|avoir)-(\d{4})$/;
const FORMAT = '{P}-{AAAA}-{N:3}';

// La dernière pièce émise ailleurs, telle que l'écran la range (un entier de 1 à 99 999) ; 0 : rien d'annoncé.
function entier(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 99999 ? n : 0;
}

export async function suiteAnnoncee(tx: Transaction, entreprise: string, type: 'facture' | 'avoir', annee: number): Promise<number> {
  const r = (await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'counters'`, [entreprise])).rows[0];
  return estObjet(r?.contenu) ? entier(r.contenu[`${type}-${annee}`]) : 0;
}

// Le compteur du serveur pour une série de la v10 et une année : absent tant qu'aucun numéro n'y a été pris ni repris.
async function compteur(tx: Transaction, entreprise: string, type: 'facture' | 'avoir', annee: number) {
  return (await tx.query(`select c.dernier, c.repris from socle.compteur c join socle.serie s on s.id = c.serie
     where s.entreprise = $1 and s.type = $2 and s.prefixe = $3 and s.legale and c.periode = $4`, [entreprise, type, SERIE_V10[type], annee])).rows[0] as
    { dernier: string | number; repris: string | number | null } | undefined;
}

// Écrire la suite annoncée (appelé par `appliquer`, avant d'écrire quoi que ce soit). `roles` : null pour le serveur lui-même.
export async function garderLaNumerotation(tx: Transaction, entreprise: string, roles: string[] | null,
  lus: { collection: string; cle: string; avant: unknown; apres: unknown }[]) {
  for (const l of lus) {
    if (l.collection !== '_racine' || l.cle !== 'counters') continue;
    const avant: Record<string, unknown> = estObjet(l.avant) ? l.avant : {}, apres: Record<string, unknown> = estObjet(l.apres) ? l.apres : {};
    for (const k of new Set([...Object.keys(avant), ...Object.keys(apres)])) {
      const m = CLE.exec(k);
      if (!m || entier(avant[k]) === entier(apres[k])) continue;
      const type = m[1] as 'facture' | 'avoir', annee = Number(m[2]);
      if (roles && !permet(roles, 'socle.reglages_fiscaux.modifier', true)) {
        throw new Refus('v10.numerotation_role', { valeurs: { serie: `${SERIE_V10[type]}-${annee}` } });
      }
      const c = await compteur(tx, entreprise, type, annee);
      if (c && Number(c.dernier) !== Number(c.repris ?? 0)) {
        throw new Refus('v10.numerotation_tenue', { valeurs: { dernier: `${SERIE_V10[type]}-${annee}-${String(c.dernier).padStart(3, '0')}` } });
      }
    }
  }
}

// Avant de prendre le numéro de la première pièce d'une année vierge : la série part de la suite annoncée.
export async function reprendreAvantEmission(tx: Transaction, entreprise: string, serie: string, type: 'facture' | 'avoir', datePiece: string) {
  const annee = Number(String(datePiece).slice(0, 4));
  if (!Number.isInteger(annee)) return;
  const n = await suiteAnnoncee(tx, entreprise, type, annee);
  if (n) await tx.query('select ventes.reprendre_v10($1, $2, $3)', [serie, annee, n]);
}

// Le numéro que la prochaine facture (ou le prochain avoir) daté de `date` PRENDRA : il se lit, il ne se réserve pas.
export async function prochainNumeroV10(tx: Transaction, entreprise: string, type: 'facture' | 'avoir', date: string) {
  const annee = Number(date.slice(0, 4));
  const s = (await tx.query(`select format from socle.serie where entreprise = $1 and type = $2 and prefixe = $3 and legale and active`,
    [entreprise, type, SERIE_V10[type]])).rows[0] as { format: string } | undefined;
  const c = s ? await compteur(tx, entreprise, type, annee) : undefined;
  const dernier = c ? Number(c.dernier) : await suiteAnnoncee(tx, entreprise, type, annee);
  const texte = String((await tx.query('select socle.formater_numero($1, $2, $3::date, $4) t', [s?.format ?? FORMAT, SERIE_V10[type], date, dernier + 1])).rows[0].t);
  return { numero: dernier + 1, texte, suite: !c && dernier > 0 };
}
