// L'argent en entiers (cadrage 01 R3). Aucun nombre à virgule ne représente jamais de l'argent :
//   - un montant : un entier dans la plus petite unité de sa devise (millimes, centimes) ;
//   - un prix unitaire : un entier à six décimales (2,525 DT s'écrit 2 525 000) ;
//   - une quantité : un entier en millièmes (2,5 kg s'écrit 2 500) ;
//   - un taux (TVA, remise, retenue) et un cours de devise : un entier à six décimales
//     (19 % s'écrit 190 000 ; 3,35 DT pour 1 € s'écrit 3 350 000).
// Le calcul se fait en `bigint` : un prix à six décimales multiplié par une quantité dépasse vite
// ce qu'un nombre de JavaScript tient exactement (2^53).

export const MILLION = 1_000_000n;
export const MILLE = 1_000n;

export type Devise = { code: string; decimales: number };
export const TND: Devise = { code: 'TND', decimales: 3 };

// 10^décimales : combien d'unités dans une unité entière (1 000 millimes, 100 centimes).
export const echelle = (d: Devise): bigint => 10n ** BigInt(d.decimales);

// Division arrondie au plus proche, la moitié s'éloignant de zéro : 2,5 → 3 et −2,5 → −3. C'est la
// règle de l'application actuelle (`round3`), sans les erreurs de la virgule flottante.
export function diviserArrondi(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error('division par zéro');
  if (d < 0n) { n = -n; d = -d; }
  const q = n / d, r = n % d;
  if (2n * (r < 0n ? -r : r) >= d) return n < 0n ? q - 1n : q + 1n;
  return q;
}

// Une valeur décimale écrite en texte (« 2,525 », « -0.5 », « 19 ») en entier à `decimales`
// décimales, exactement. Refuse ce qui aurait besoin d'arrondir : une donnée ne se tronque pas en
// silence.
export function depuisTexte(texte: string, decimales: number): bigint {
  const m = /^\s*(-?)(\d+)(?:[.,](\d+))?\s*$/.exec(texte);
  if (!m) throw new Error(`nombre illisible : « ${texte} »`);
  const [, signe, entiers = '0', fraction = ''] = m;
  if (fraction.replace(/0+$/, '').length > decimales) throw new Error(`« ${texte} » a plus de ${decimales} décimales`);
  // Les zéros en trop au-delà des décimales permises ne comptent pas (« 2,5000000 » vaut 2,5).
  const v = BigInt(entiers + fraction.slice(0, decimales).padEnd(decimales, '0'));
  return signe ? -v : v;
}

// Un entier à `decimales` décimales, écrit en texte exact (« 1191.000 », « -0.5 ») : c'est ainsi que
// l'argent sort de l'API, jamais en nombre à virgule.
export function versTexte(v: bigint, decimales: number): string {
  const signe = v < 0n ? '-' : '';
  const a = (v < 0n ? -v : v).toString().padStart(decimales + 1, '0');
  return decimales === 0 ? signe + a : `${signe}${a.slice(0, -decimales)}.${a.slice(-decimales)}`;
}
