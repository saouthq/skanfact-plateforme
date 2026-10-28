// Les écrans partent sans leurs commentaires (05/10/2026 ; docs/leger.md, L6).
//
// Le code de la v10 et de la plateforme est écrit pour être relu : compressé, plus d'un tiers de son poids est fait de
// commentaires en français, dont le navigateur n'a que faire. Mesuré sur la connexion lente de référence : la première
// ouverture était passée à 1 302 Ko pour un seuil de 1 300 (l'exemple rempli et la facture guidée l'avaient fait
// grossir) ; une mesure qui dépasse change le plan, pas le seuil.
//
// À la construction (web/vite.config.ts), chaque script et chaque feuille de style de NOS écrans (la v10, la plateforme,
// l'espace client) perd ses commentaires, et rien d'autre : le code reste octet pour octet, chaque ligne à sa place (un
// commentaire de plusieurs lignes laisse autant de lignes vides), si bien qu'une erreur signalée depuis un poste
// pointe la ligne du dépôt. Ni code réécrit, ni noms raccourcis. Les fichiers d'un tiers (tiers/) gardent leur texte et
// leur licence ; les pages HTML aussi (petites, et refaites à chaque demande).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseSync } from 'rolldown/utils';

// Les dossiers allégés, sous la racine des écrans construits.
export const DOSSIERS_ALLEGES = ['v10', 'plateforme', 'espace'];

// Un commentaire trouvé : où il commence, où il finit, et s'il est de la forme « /* … */ ».
type Commentaire = { start: number; end: number; bloc: boolean };

// Un saut de ligne (« \r\n » en compte un seul).
const FIN_DE_LIGNE = /\r\n|[\n\r\u2028\u2029]/g;

// Le code sans les commentaires trouvés. Un bloc laisse autant de sauts de ligne qu'il en couvrait (en JavaScript, un
// « return » suivi d'un tel bloc rend toujours « undefined »), sinon une espace, que les deux mots qu'il séparait ne se
// collent pas (« typeof/**/x ») ; en fin de ligne, rien. Un « // » s'arrête avant la fin de sa ligne, qui reste. Les
// espaces juste avant un commentaire partent avec lui : ils sont entre deux mots du code (une chaîne se ferme par un
// guillemet).
function sans(code: string, commentaires: Commentaire[]): string {
  const morceaux: string[] = [];
  let pos = 0;
  for (const c of commentaires) {
    morceaux.push(code.slice(pos, c.start).replace(/[ \t]+$/, ''));
    if (c.bloc) {
      const lignes = code.slice(c.start, c.end).match(FIN_DE_LIGNE)?.length ?? 0;
      const finDeLigne = c.end >= code.length || code[c.end] === '\n' || code[c.end] === '\r';
      morceaux.push(lignes ? '\n'.repeat(lignes) : finDeLigne ? '' : ' ');
    }
    pos = c.end;
  }
  morceaux.push(code.slice(pos));
  return morceaux.join('');
}

// Un script sans ses commentaires. L'analyseur que Vite embarque (oxc, par rolldown) les trouve : un « // » ou un
// « /* » dans une chaîne, un gabarit ou une expression régulière n'en est pas un. Un script qu'il ne sait pas lire
// arrête la construction : il ne part pas à moitié.
export function scriptSansCommentaires(nom: string, code: string): string {
  const lu = parseSync(nom, code);
  if (lu.errors.length) throw new Error(`${nom} : ${lu.errors[0]?.message ?? 'illisible'}`);
  return sans(code, lu.comments.map((c) => ({ start: c.start, end: c.end, bloc: c.type === 'Block' })));
}

// Une feuille de style sans ses commentaires. Le CSS n'en a qu'une sorte, « /* … */ », et seuls la cachent une chaîne
// (« content: "/*" »), une adresse sans guillemets (« url(a/*b) ») ou un caractère échappé (« \/ »).
export function styleSansCommentaires(code: string): string {
  const trouves: Commentaire[] = [];
  for (let i = 0; i < code.length;) {
    const c = code[i];
    if (c === '\\') {
      i += 2;
    } else if (c === '"' || c === '\'') {
      for (i++; i < code.length && code[i] !== c && code[i] !== '\n'; i += code[i] === '\\' ? 2 : 1);
      i++;
    } else if (c === '/' && code[i + 1] === '*') {
      const fin = code.indexOf('*/', i + 2);
      const bout = fin < 0 ? code.length : fin + 2;
      trouves.push({ start: i, end: bout, bloc: true });
      i = bout;
    } else if (/^url\(\s*[^\s"')]/i.test(code.slice(i, i + 64)) && !/[\w-]/.test(code[i - 1] ?? '')) {
      const fin = code.indexOf(')', i);
      i = fin < 0 ? code.length : fin + 1;
    } else {
      i++;
    }
  }
  return sans(code, trouves);
}

// Alléger les écrans construits, sur place : ce que Vite vient de copier de public/.
export function allegerLesEcrans(racine: string): { fichiers: number; avant: number; apres: number } {
  const bilan = { fichiers: 0, avant: 0, apres: 0 };
  const parcourir = (dossier: string) => {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, e.name);
      if (e.isDirectory()) { parcourir(chemin); continue; }
      const genre = path.extname(e.name);
      if (genre !== '.js' && genre !== '.css') continue;
      const code = fs.readFileSync(chemin, 'utf8');
      const allege = genre === '.js' ? scriptSansCommentaires(chemin, code) : styleSansCommentaires(code);
      fs.writeFileSync(chemin, allege);
      bilan.fichiers++;
      bilan.avant += Buffer.byteLength(code);
      bilan.apres += Buffer.byteLength(allege);
    }
  };
  for (const d of DOSSIERS_ALLEGES) if (fs.existsSync(path.join(racine, d))) parcourir(path.join(racine, d));
  return bilan;
}

// Les écrans compressés d'avance (28/10/2026 ; docs/leger.md, L7). Le serveur compresse un écran à sa première demande,
// au niveau 9 de brotli, vite fait ; le niveau 11 gagne encore environ 80 Ko sur la première ouverture, mais coûte
// quelques secondes de calcul, qu'aucune première visite ne doit attendre. Il se fait donc une fois, à la construction
// de la production (exploitation/suivre.ts) : chaque script, feuille de style et dessin de nos écrans reçoit à côté de
// lui « nom.br », que le serveur envoie tel quel (serveur/ecrans.ts). Les constructions des tests s'en passent (chacune
// coûterait ces secondes), sauf celle qui mesure ce que la production envoie (tests/web/leger.test.ts).
export const PRECOMPRESSER = 'SKANFACT_PRECOMPRESSER';
export function precompresserLesEcrans(racine: string) {
  const types = /\.(m?js|css|svg|json)$/;
  for (const dossier of [...DOSSIERS_ALLEGES, 'tiers']) {
    const base = path.join(racine, dossier);
    if (!fs.existsSync(base)) continue;
    for (const nom of fs.readdirSync(base, { recursive: true }) as string[]) {
      const fichier = path.join(base, nom);
      if (!types.test(nom) || !fs.statSync(fichier).isFile()) continue;
      const contenu = fs.readFileSync(fichier);
      fs.writeFileSync(`${fichier}.br`, zlib.brotliCompressSync(contenu, { params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: contenu.length } }));
    }
  }
}
