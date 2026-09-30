// Le banc de la lecture des factures d'achat (brique 84 ; 12 § 10, point 7 ; 14 § 2.3 ; docs/achats.md) :
// mesurer le moteur sur un lot de VRAIES factures tunisiennes, prêtées avec l'accord de leurs
// propriétaires. Le lot n'entre JAMAIS dans le dépôt (une vraie facture ne s'y met pas) : il vit dans un
// dossier à part, avec son `attendu.json`, écrit à la main en lisant chaque facture :
//
//   { "facture-1.jpg": { "matricule": "1234567A/B/M/000", "date": "2026-09-12", "total": "913.135" }, … }
//
// (« matricule » : null pour un fournisseur sans matricule tunisien ; « total » : le TTC de la pièce.)
// Le seuil est écrit d'avance : le moteur est retenu s'il lit juste le matricule, la date ET le total sur
// au moins 9 factures sur 10. Un lot vide ne prouve rien : il ne passe pas.
//
//   node banc/lecture/mesurer.ts /chemin/du/lot [le matricule de l'acheteur]
//
// Sortie : une ligne par facture (ce qui est juste, ce qui ne l'est pas), puis le verdict ; code 0 si le
// seuil est atteint, 1 sinon, 2 si le lot est illisible.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { depuisTexte } from '../../moteur/argent.ts';
import { compacterMatricule, lireFacture } from '../../serveur/achats/lecture-facture.ts';
import { moteurDuServeur, sorteDe } from '../../serveur/achats/lecteur.ts';

export type Attendu = { matricule: string | null; date: string; total: string };
export type Ligne = { fichier: string; matricule: boolean; date: boolean; total: boolean; lu: { matricule: string | null; date: string | null; total: string | null } };
export type Mesure = { lignes: Ligne[]; justes: number; seuilAtteint: boolean };

// Le seuil : 9 sur 10, écrit d'avance (12 § 10).
export const SEUIL = { justes: 9, sur: 10 };

const memeMontant = (a: string | null, b: string) => {
  try { return a !== null && depuisTexte(a, 3) === depuisTexte(b, 3); } catch { return false; }
};

export async function mesurer(dossier: string, notreMatricule: string | null = null): Promise<Mesure> {
  const attendus = JSON.parse(fs.readFileSync(path.join(dossier, 'attendu.json'), 'utf8')) as Record<string, Attendu>;
  const lire = moteurDuServeur();
  const lignes: Ligne[] = [];
  for (const [fichier, attendu] of Object.entries(attendus)) {
    const contenu = fs.readFileSync(path.join(dossier, fichier));
    const sorte = sorteDe(contenu);
    let lu: Ligne['lu'] = { matricule: null, date: null, total: null };
    if (sorte) {
      const p = lireFacture((await lire(contenu, sorte)).texte, { notreMatricule });
      lu = { matricule: p.lecture.matricule, date: p.lecture.date, total: p.lecture.totalTTC };
    }
    lignes.push({
      fichier, lu,
      matricule: attendu.matricule === null ? lu.matricule === null : lu.matricule !== null && compacterMatricule(lu.matricule) === compacterMatricule(attendu.matricule),
      date: lu.date === attendu.date,
      total: memeMontant(lu.total, attendu.total),
    });
  }
  const justes = lignes.filter((l) => l.matricule && l.date && l.total).length;
  // Au moins 9 sur 10, et un lot qui ne soit pas vide.
  return { lignes, justes, seuilAtteint: lignes.length > 0 && justes * SEUIL.sur >= lignes.length * SEUIL.justes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dossier = process.argv[2];
  if (!dossier || !fs.existsSync(path.join(dossier, 'attendu.json'))) {
    console.error('Usage : node banc/lecture/mesurer.ts /chemin/du/lot [matricule de l\'acheteur] (le dossier contient attendu.json)');
    process.exit(2);
  }
  const m = await mesurer(dossier, process.argv[3] ?? null);
  const oui = (b: boolean) => (b ? 'juste' : 'FAUX ');
  for (const l of m.lignes) {
    console.log(`${l.fichier.padEnd(32)} matricule ${oui(l.matricule)}  date ${oui(l.date)}  total ${oui(l.total)}   (lu : ${l.lu.matricule ?? '—'}, ${l.lu.date ?? '—'}, ${l.lu.total ?? '—'})`);
  }
  console.log(`\n${m.justes} facture(s) sur ${m.lignes.length} lue(s) juste(s) (matricule, date et total) : le seuil de ${SEUIL.justes} sur ${SEUIL.sur} ${m.seuilAtteint ? 'est atteint' : 'n\'est PAS atteint'}.`);
  process.exit(m.seuilAtteint ? 0 : 1);
}
