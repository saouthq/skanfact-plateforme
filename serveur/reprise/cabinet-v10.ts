// Le portefeuille du Cabinet v10, lu pour la reprise (brique 70 ; docs/cabinet.md, C60). Le fichier du
// cabinet de la v10 porte, avec ses dossiers, la CLÉ PRIVÉE du cabinet, les clés de ses clients et leurs
// licences : il ne part jamais tel quel. Le navigateur le lit sur le poste et n'envoie, de chaque
// dossier, que la liste ci-dessous (`DOSSIER_V10`, comptée et décidée) ; un champ de plus, et la route
// refuse. Ici on la LIT : ce qui se crée (les dossiers tenus, leur fiche), ce qui ne se crée pas (les
// clients sur SkanFact, qui passent par leur mandat ; les dossiers d'exemple), et ce qui ne se
// reprendrait pas tel quel, nommé dossier par dossier.

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import { motif, type Texte } from '../../textes/index.ts';
import './textes.ts';

// Ce qui part du poste, pour chaque dossier (la forme de la v10, cabcore.js migrateDossier) : cette
// liste, et rien d'autre — ni `clePublique`, ni `clientLicence`, ni la correspondance.
export const DOSSIER_V10 = z.object({
  id: z.string().max(100), name: z.string().max(500), matricule: z.string().max(60), manual: z.boolean(), demo: z.boolean(), archived: z.boolean(),
  email: z.string().max(500), phone: z.string().max(100), contact: z.string().max(500), note: z.string().max(5000),
  from: z.string().max(10), regime: z.string().max(100), tvaPeriod: z.string().max(40), fees: z.number(),
  cnssEmployeur: z.string().max(100), cnssCode: z.string().max(40),
  relances: z.array(z.unknown()).max(200), abonnements: z.array(z.unknown()).max(200),
}).strict();
export const PORTEFEUILLE_V10 = z.object({ dossiers: z.array(DOSSIER_V10).max(2000) }).strict();
type DossierV10 = z.infer<typeof DOSSIER_V10>;

export type AnomalieDossier = { dossier: string; nom: string; motif: Texte };
export type DossierRepris = { refV10: string; nom: string; matricule: string | null; fiche: Record<string, unknown> };

// La forme du matricule fiscal que la base garde (0001) : « 1234567A/P/M/000 ».
const MATRICULE = /^[0-9]{7}[A-Z]\/?[A-Z]\/?[A-Z]\/?[0-9]{3}$/;

// Un montant de la v10 (un nombre en dinars, arrondi au millime par elle), en millimes exacts ; null
// s'il a plus de trois décimales (jamais arrondi ici).
function millimes(v: unknown): bigint | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || /e/i.test(String(v))) return null;
  try { return depuisTexte(String(v), 3); } catch { return null; }
}

// La fiche de la plateforme (serveur/cabinet/routes.ts, FICHE) d'un dossier de la v10 — la même
// conversion que le point de contact fait à chaque enregistrement (poserFiche).
function ficheDe(d: DossierV10, fees: bigint): Record<string, unknown> {
  const texte = (v: string) => v.trim();
  return {
    email: texte(d.email), phone: texte(d.phone), contact: texte(d.contact), note: d.note, archived: d.archived, from: d.from,
    regime: texte(d.regime), tvaPeriod: texte(d.tvaPeriod), fees: Number(fees), cnssEmployeur: texte(d.cnssEmployeur), cnssCode: texte(d.cnssCode),
    relances: d.relances,
    abonnements: d.abonnements.map((a) => {
      const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      const m = millimes(x.montant ?? 0);
      return {
        id: String(x.id ?? ''), nom: String(x.nom ?? ''), guideId: String(x.guideId ?? ''), actif: x.actif === true,
        depuis: String(x.depuis ?? ''), jusqua: String(x.jusqua ?? ''), tousLesMois: Math.min(12, Math.max(1, Math.round(Number(x.tousLesMois) || 1))),
        montant: m === null ? String(x.montant) : versTexte(m, 3), piece: String(x.piece ?? ''), libelle: String(x.libelle ?? ''),
        faites: Array.isArray(x.faites) ? x.faites.map(String) : [],
      };
    }),
  };
}

// Lire le portefeuille : les dossiers tenus à créer, les clients sur SkanFact (à relier par leur
// mandat), les dossiers d'exemple (laissés), et ce qui ne se reprendrait pas tel quel.
export function lirePortefeuilleV10(p: z.infer<typeof PORTEFEUILLE_V10>) {
  const anomalies: AnomalieDossier[] = [];
  const dossiers: DossierRepris[] = [];
  const surSkanfact: string[] = [];
  let exemples = 0;
  const matricules = new Set<string>();
  for (const d of p.dossiers) {
    if (d.demo) { exemples++; continue; }
    const nom = d.name.trim();
    if (!d.manual) { surSkanfact.push(nom); continue; }
    const nomme = (m: Texte) => anomalies.push({ dossier: d.id, nom, motif: m });
    if (!nom || nom.length > 200) nomme(motif('reprise.dossier_nom'));
    // Comme « Nouveau client » (le point de contact, newDossier) : sans espaces, points et tirets en « / ».
    const brut = d.matricule.replace(/\s+/g, '').replace(/[.-]/g, '/').toUpperCase();
    const matricule = brut || null;
    if (matricule && !MATRICULE.test(matricule)) nomme(motif('reprise.dossier_matricule', { matricule: d.matricule }));
    else if (matricule && matricules.has(matricule)) nomme(motif('reprise.dossier_matricule_double', { matricule }));
    if (matricule) matricules.add(matricule);
    const fees = millimes(d.fees);
    if (fees === null) nomme(motif('reprise.dossier_honoraires'));
    dossiers.push({ refV10: d.id, nom, matricule, fiche: ficheDe(d, fees ?? 0n) });
  }
  return { dossiers, surSkanfact, exemples, anomalies };
}
