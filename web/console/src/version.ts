// Le nom d'une version du service : le numéro que le dépôt déclare (« v1.4.2 », lu par le suiveur dans package.json),
// sinon l'identifiant court de son commit (les versions d'avant la numérotation). Deux commits qui portent le même numéro
// (un envoi qui n'a pas relevé le numéro) se distinguent par leur identifiant : un nom ne désigne jamais deux versions.
export type Numeros = Readonly<Record<string, string>>;
export function nomDeVersion(sha: string, numeros: Numeros | undefined): string {
  const n = numeros?.[sha];
  if (!n) return sha.slice(0, 7);
  const double = Object.entries(numeros ?? {}).some(([s, x]) => x === n && s !== sha);
  return double ? `v${n} · ${sha.slice(0, 7)}` : `v${n}`;
}
