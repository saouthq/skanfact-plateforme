// Les formats officiels (Console, Réglages ; docs/console.md C28) : les fichiers que l'administration attend, ce que
// SkanFact en fait, contre quoi c'est vérifié, où on en est, et ce qui reste À VÉRIFIER. Le registre s'écrit ICI, à côté
// du code qu'il décrit : un format change avec une nouvelle version de SkanFact, relue et prouvée, jamais depuis la
// console. Les chiffres viennent de la base (0094) : ce que la plateforme a vraiment écrit, signé, déposé, toutes
// entreprises mêlées. Pur (testé : tests/console/formats.test.ts) : la route lit la base et le serveur ; ceci range.

// Où en est un format, dit par le code : en place ; écrit contre un service simulé (l'accès réel n'est pas là) ; calculé
// sans fichier de dépôt ; pas encore fait ; une caisse qui n'est pas homologuée. Rien de plus fin : le détail est dans
// la phrase du format (ses textes : console.ecran.reglages.f.<code>.*).
export type EtatFormat = 'en_place' | 'simule' | 'calcule' | 'pas_encore' | 'non_homologue';
export type CodeFormat = 'teif' | 'signature' | 'ttn' | 'tej' | 'cnss' | 'liasse' | 'ecritures' | 'caisse';
type Declare = { code: CodeFormat; etat: EtatFormat; aVerifier: boolean; doc: string };

// L'ordre est celui d'une facture : le fichier, sa signature, son envoi ; puis les autres déclarations.
export const FORMATS: readonly Declare[] = [
  // Le fichier s'écrit à l'émission, avec le code qui imprime la pièce, validé contre le schéma officiel.
  { code: 'teif', etat: 'en_place', aVerifier: true, doc: 'docs/facture-electronique.md' },
  // DigiGo : écrit d'après ce que TunTrust publie, contre un DigiGo simulé (tests/digigo-simule.ts).
  { code: 'signature', etat: 'simule', aVerifier: true, doc: 'docs/facture-electronique.md' },
  // La TTN : contre une TTN simulée (tests/ttn-simule.ts) tant que l'accès de test El Fatoora n'est pas là.
  { code: 'ttn', etat: 'simule', aVerifier: true, doc: 'docs/facture-electronique.md' },
  // TEJ : le cahier des charges officiel n'a pas été relu ; SkanFact dit où établir l'attestation.
  { code: 'tej', etat: 'pas_encore', aVerifier: true, doc: 'docs/achats.md' },
  // La CNSS du trimestre : calculée salarié par salarié (moteur/paie.ts), sans fichier de dépôt.
  { code: 'cnss', etat: 'calcule', aVerifier: true, doc: 'docs/paie.md' },
  // La liasse : déduite de la balance par la table de rubriques du cabinet (brique 41 ter).
  { code: 'liasse', etat: 'en_place', aVerifier: true, doc: 'docs/cabinet.md' },
  // Les écritures : le livre-journal en CSV et le FEC, au nom et au contenu de la v10 (brique 39 bis).
  { code: 'ecritures', etat: 'en_place', aVerifier: false, doc: 'docs/cabinet.md' },
  // La caisse : série, numéro, chaîne sans réseau ; pas homologuée (le cahier NACEF n'est pas lu).
  { code: 'caisse', etat: 'non_homologue', aVerifier: true, doc: 'docs/caisse.md' },
];

// Ce que la base rend (plateforme.console_formats), lu prudemment : un compte illisible vaut 0, une date illisible null.
export type FormatsLus = {
  soumises: number;
  fichiers: { n: number; entreprises: number; dernier: string | null };
  versions: { version: string; n: number }[];
  aSigner: number;
  signees: { n: number; dernier: string | null };
  ttn: { sansEnvoi: number; enRoute: number; retenues: number; deposees: number; acceptees: number; refusees: number; derniereAcceptee: string | null };
};
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const compte = (x: unknown) => {
  const n = typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : x;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
const instant = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);

export function lireFormats(brut: unknown): FormatsLus {
  const b = objet(brut), f = objet(b.fichiers), s = objet(b.signees), t = objet(b.ttn);
  return {
    soumises: compte(b.soumises),
    fichiers: { n: compte(f.n), entreprises: compte(f.entreprises), dernier: instant(f.dernier) },
    versions: (Array.isArray(b.versions) ? b.versions : []).flatMap((v) => {
      const o = objet(v);
      return typeof o.version === 'string' && o.version && compte(o.n) > 0 ? [{ version: o.version, n: compte(o.n) }] : [];
    }),
    aSigner: compte(b.aSigner),
    signees: { n: compte(s.n), dernier: instant(s.dernier) },
    ttn: { sansEnvoi: compte(t.sansEnvoi), enRoute: compte(t.enRoute), retenues: compte(t.retenues), deposees: compte(t.deposees),
      acceptees: compte(t.acceptees), refusees: compte(t.refusees), derniereAcceptee: instant(t.derniereAcceptee) },
  };
}

// Une ligne du registre, telle que l'écran la montre : le format déclaré, sa version (lue dans le code quand elle y
// est : le TEIF), et ce que la plateforme en a fait. Un service que ce serveur n'a pas d'adresse pour (la TTN, DigiGo)
// le dit : ses pièces attendent.
export type LigneFormat = Declare & {
  version: string | null;
  chiffres: Record<string, number | string | null> | null;
  branche: boolean | null;
  // Ce qui demande un geste chez un client : des pièces retenues ou refusées par la TTN.
  alerte: boolean;
};
export function registreDesFormats(lu: FormatsLus, code: { teif: string | null }, branche: { ttn: boolean; digigo: boolean }): LigneFormat[] {
  return FORMATS.map((f): LigneFormat => {
    switch (f.code) {
      case 'teif':
        return { ...f, version: code.teif, branche: null, alerte: false,
          chiffres: { fichiers: lu.fichiers.n, entreprises: lu.fichiers.entreprises, soumises: lu.soumises, dernier: lu.fichiers.dernier,
            // Des fichiers écrits sous une autre version que celle du code (avant un changement de format) : ils restent tels quels.
            autres: lu.versions.filter((v) => v.version !== code.teif).reduce((n, v) => n + v.n, 0) } };
      case 'signature':
        return { ...f, version: 'XAdES', branche: branche.digigo, alerte: false,
          chiffres: { signees: lu.signees.n, aSigner: lu.aSigner, dernier: lu.signees.dernier } };
      case 'ttn':
        return { ...f, version: 'EfactService', branche: branche.ttn, alerte: lu.ttn.retenues + lu.ttn.refusees > 0,
          chiffres: { ...lu.ttn } };
      case 'tej':
        return { ...f, version: 'TEJ-CCT-RS-V2.0', branche: null, alerte: false, chiffres: null };
      case 'ecritures':
        return { ...f, version: 'CSV, FEC', branche: null, alerte: false, chiffres: null };
      default:
        return { ...f, version: null, branche: null, alerte: false, chiffres: null };
    }
  });
}
