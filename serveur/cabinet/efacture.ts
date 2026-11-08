// (1.325.0) Le fichier El Fatoora qu'un client envoie à son cabinet (docs/revue-modules.md, « La facture électronique reçue,
// jusqu'au comptable ») se lit ICI, sans l'IA : le fichier dit tout, au millime, et rien ne sort du serveur. La lecture est
// celle de l'écran de l'entreprise (web/public/v10/teif.js, `lireTeif`) : une lecture, deux côtés. Ce qui se garde pour le
// cabinet (cabinet.lecture, 0203) : le fournisseur, le numéro, la date et le total, comme une photo lue par l'IA, et le
// détail que seule la facture électronique porte (chaque taux de TVA et sa base, le timbre, les lignes, la signature,
// l'avoir et la facture qu'il diminue, à qui elle est adressée). Les montants en texte au millième, jamais à virgule.

import { lireFichierTeif } from '../v10/teif.ts';

type Json = Record<string, unknown>;
export type TvaLue = { taux: string; base: string; montant: string };
export type LigneLue = { libelle: string; quantite: string; prix: string; taux: string; ht: string; remise?: string; prixBrut?: string };
export type DetailEfacture = {
  avoir: boolean; refFacture: string | null; matricule: string | null; signe: boolean; refTtn: string | null; devise: string;
  ht: string | null; timbre: string; tva: TvaLue[]; lignes: LigneLue[]; echeance: string | null; objet: string | null;
  ailleurs: { nom: string; identifiant: string } | null; remarques: string[];
};
export type EfactureLue = { fournisseur: string | null; numero: string | null; date: string | null; total: string | null; devise: 'TND' | 'EUR' | 'USD' | null; detail: DetailEfacture };

const LIGNES_AU_PLUS = 200;
const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Au millième, en texte : « 154.850 ». Le fichier les donne en nombres (lus du texte du XML) ; l'arrondi au millième rend
// celui du fichier (il n'en a pas plus).
const milliemes = (v: unknown): string | null => { const n = nombre(v); return n === null || n < 0 ? null : (Math.round(n * 1000) / 1000).toFixed(3); };
const texte = (v: unknown, max: number): string | null => { const t = typeof v === 'string' ? v.trim() : ''; return t ? t.slice(0, max) : null; };
const jour = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function lireEfacture(contenu: Buffer, notreMatricule: string | null): { ok: false; motif: string } | { ok: true; lu: EfactureLue } {
  const xml = (contenu.length >= 3 && contenu[0] === 0xef && contenu[1] === 0xbb && contenu[2] === 0xbf ? contenu.subarray(3) : contenu).toString('utf8');
  const r = lireFichierTeif(xml, notreMatricule);
  if (!r.ok) return { ok: false, motif: r.motif };
  const l = r.lecture as Json;
  const code = String(l.currency || 'DT').toUpperCase();
  const devise = code === 'DT' || code === 'TND' ? 'TND' : code === 'EUR' || code === 'USD' ? code : null;
  const parTaux = (l.vatByRate && typeof l.vatByRate === 'object' ? l.vatByRate : {}) as Record<string, { base?: unknown; vat?: unknown }>;
  const tva = Object.keys(parTaux).map((t) => ({ taux: String(Number(t)), base: milliemes(parTaux[t]?.base) ?? '0.000', montant: milliemes(parTaux[t]?.vat) ?? '0.000' }))
    .sort((a, b) => Number(b.taux) - Number(a.taux));
  const lignes = (Array.isArray(l.lines) ? l.lines as Json[] : []).slice(0, LIGNES_AU_PLUS).map((x) => {
    const q = nombre(x.qty) ?? 1, pu = nombre(x.unitPrice) ?? 0;
    const remise = nombre(x.remise), brut = milliemes(x.puBrut);
    return { libelle: texte(x.label, 200) ?? '—', quantite: String(q), prix: milliemes(pu) ?? '0.000', taux: String(nombre(x.vatRate) ?? 0),
      ht: milliemes(q * pu) ?? '0.000', ...(remise && remise > 0 && brut ? { remise: String(remise), prixBrut: brut } : {}) };
  });
  const acheteur = (l.acheteur && typeof l.acheteur === 'object' ? l.acheteur : null) as { nom?: string; identifiant?: string } | null;
  const ailleurs = r.remarques.some((m) => /^Cette facture est adressée à/.test(m)) && acheteur?.identifiant
    ? { nom: texte(acheteur.nom, 200) ?? '', identifiant: texte(acheteur.identifiant, 40) ?? '' } : null;
  const detail: DetailEfacture = {
    avoir: l.kind === 'avoir', refFacture: texte(l.refFacture, 100), matricule: texte(l.matricule, 40), signe: l.signe === true, refTtn: texte(l.refTtn, 100),
    devise: code === 'DT' ? 'TND' : code.slice(0, 3), ht: milliemes(l.totalHT), timbre: milliemes(l.fees) ?? '0.000', tva, lignes,
    echeance: jour(l.dueDate), objet: texte(l.subject, 200), ailleurs,
    remarques: r.remarques.slice(0, 12).map((m) => m.slice(0, 400)),
  };
  const total = devise ? milliemes(l.totalTTC) : null;
  return { ok: true, lu: { fournisseur: texte(l.supplier, 200), numero: texte(l.number, 100), date: jour(l.date), total, devise: total ? devise : null, detail } };
}
