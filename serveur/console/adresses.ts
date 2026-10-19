// Les adresses internet de l'entrée, lues pour l'écran Sécurité (0143 ; docs/console.md C67). Pur (testé :
// tests/console/adresses.test.ts) : la base rend ce qu'elle a compté et bloqué ; ces fonctions le lisent sans rien
// inventer (une valeur qui n'a pas sa forme ne passe pas).

export type AdresseVue = { adresse: string; echecs: number; freins: number; derniere: string | null; bloquee: { id: string; jusquAu: string } | null };
export type Blocage = { id: string; adresse: string; le: string; jusquAu: string; motif: string; par: string };
export type BlocageFini = { adresse: string; le: string; fin: string; levee: boolean };
export type AdressesLues = { vues: AdresseVue[]; bloquees: Blocage[]; finies: BlocageFini[] };

// Les durées d'un blocage, en heures : une heure, ou un jour (jamais plus : une adresse peut être partagée).
export const DUREES_BLOCAGE = [1, 24] as const;

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const entier = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const date = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const texte = (v: unknown) => (typeof v === 'string' ? v : null);

export function lireAdresses(x: unknown): AdressesLues {
  const o = objet(x);
  return {
    vues: liste(o.vues).flatMap((v) => {
      const y = objet(v), b = objet(y.bloquee);
      const adresse = texte(y.adresse);
      if (!adresse) return [];
      const jusquAu = date(b.jusquAu);
      return [{ adresse, echecs: entier(y.echecs), freins: entier(y.freins), derniere: date(y.derniere),
        bloquee: typeof b.id === 'string' && jusquAu ? { id: b.id, jusquAu } : null }];
    }),
    bloquees: liste(o.bloquees).flatMap((v) => {
      const y = objet(v);
      const [id, adresse, le, jusquAu] = [texte(y.id), texte(y.adresse), date(y.le), date(y.jusquAu)];
      return id && adresse && le && jusquAu ? [{ id, adresse, le, jusquAu, motif: texte(y.motif) ?? '', par: texte(y.par) ?? '' }] : [];
    }),
    finies: liste(o.finies).flatMap((v) => {
      const y = objet(v);
      const [adresse, le, fin] = [texte(y.adresse), date(y.le), date(y.fin)];
      return adresse && le && fin ? [{ adresse, le, fin, levee: y.levee === true }] : [];
    }),
  };
}
