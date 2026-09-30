// Le moteur de lecture des factures d'achat (brique 84 ; 14 § 2.3 ; 12 § 3 : un moteur libre, sur NOS
// serveurs ; docs/achats.md). Poppler lit le texte d'un PDF qui en a un (exact, rien n'est deviné) ;
// Tesseract (en français) lit une photo, ou un PDF scanné page par page. Rien ne sort du serveur : le
// fichier vit dans un dossier temporaire le temps de la lecture, puis s'efface ; il n'est ni gardé, ni
// écrit dans le journal.
//
// La file de la lecture : au plus `simultanees` lectures à la fois sur ce serveur, les suivantes
// attendent leur tour (au plus `attente` en file, et `attenteMs` d'attente) ; au-delà, « occupé ».
// Chaque programme lancé a sa limite de temps. À la mise en service, la lecture tournera sur son propre
// serveur (09 § 4), sans accès à la base.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type Sorte = 'jpeg' | 'png' | 'webp' | 'pdf';
export type TexteLu = { texte: string; moteur: 'pdf' | 'photo'; pages: number };
export type Moteur = (fichier: Buffer, sorte: Sorte) => Promise<TexteLu>;
export type Lecteur = { disponible: boolean; lire: Moteur };

export class LecteurOccupe extends Error {}
export class LectureImpossible extends Error {}
export class LectureTropLongue extends Error {}

// La sorte d'un fichier, par ses premiers octets (jamais par son nom, ni par ce qu'en dit l'envoyeur).
export function sorteDe(b: Buffer): Sorte | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

// Un programme, sans interpréteur de commandes (aucun texte venu d'ailleurs n'est une commande), avec sa
// limite de temps. Tesseract sur un seul fil : plusieurs lectures côte à côte ne se marchent pas dessus.
function executer(programme: string, args: string[], ms: number): Promise<string> {
  return new Promise((ok, ko) => {
    execFile(programme, args, { timeout: ms, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, OMP_THREAD_LIMIT: '1' } }, (e, sortie) => {
      if (!e) return ok(sortie);
      const x = e as Error & { killed?: boolean; signal?: string | null };
      // Des messages pour le journal de l'exploitant (le nom du programme), jamais montrés à une personne.
      ko(x.killed || x.signal === 'SIGTERM' ? new LectureTropLongue(programme, { cause: e }) : new LectureImpossible(programme, { cause: e }));
    });
  });
}

const LETTRES = /\p{L}/gu;
const lettres = (t: string) => (t.match(LETTRES) ?? []).length;
// Au plus trois pages : une facture d'achat en a une ou deux ; au-delà, c'est un autre document.
const PAGES = 3;

export type Reglages = { ms?: number; simultanees?: number; attente?: number; attenteMs?: number };

// Le moteur réel : Poppler et Tesseract, sur ce serveur.
export function moteurDuServeur(ms = 60_000): Moteur {
  return async (fichier, sorte) => {
    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'skanfact-lecture-'));
    try {
      const piece = path.join(dossier, `piece.${sorte === 'jpeg' ? 'jpg' : sorte}`);
      await fs.writeFile(piece, fichier, { mode: 0o600 });
      const tesseract = (image: string) => executer('tesseract', [image, 'stdout', '-l', 'fra', '--psm', '4'], ms);
      if (sorte !== 'pdf') return { texte: await tesseract(piece), moteur: 'photo', pages: 1 };
      // Un PDF écrit par un logiciel porte son texte : il se lit tel quel, sans rien deviner.
      const texte = await executer('pdftotext', ['-layout', '-enc', 'UTF-8', '-l', String(PAGES), piece, '-'], ms);
      if (lettres(texte) >= 40) return { texte, moteur: 'pdf', pages: texte.split('\f').filter((p) => p.trim()).length || 1 };
      // Un PDF scanné : chaque page devient une image, lue comme une photo.
      await executer('pdftoppm', ['-r', '300', '-gray', '-png', '-l', String(PAGES), piece, path.join(dossier, 'page')], ms);
      const pages = (await fs.readdir(dossier)).filter((f) => /^page-\d+\.png$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
      const textes: string[] = [];
      for (const p of pages) textes.push(await tesseract(path.join(dossier, p)));
      return { texte: textes.join('\n'), moteur: 'photo', pages: pages.length };
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  };
}

// La file : un créneau se passe de main en main, jamais deux lectures de plus que permis.
export function creerLecteur(moteur: Moteur, r: Reglages = {}): Lecteur {
  const simultanees = r.simultanees ?? 2;
  const attente = r.attente ?? 8;
  const attenteMs = r.attenteMs ?? 90_000;
  let actives = 0;
  const file: { ok: () => void; ko: (e: Error) => void }[] = [];
  return {
    disponible: true,
    lire: async (fichier, sorte) => {
      if (actives < simultanees) actives++;
      else {
        if (file.length >= attente) throw new LecteurOccupe('file-pleine');
        await new Promise<void>((ok, ko) => {
          const place = { ok: () => { clearTimeout(minuterie); ok(); }, ko };
          const minuterie = setTimeout(() => {
            const i = file.indexOf(place);
            if (i >= 0) file.splice(i, 1);
            ko(new LecteurOccupe('attente'));
          }, attenteMs);
          file.push(place);
        });
      }
      try { return await moteur(fichier, sorte); } finally {
        const suivant = file.shift();
        if (suivant) suivant.ok(); else actives--;
      }
    },
  };
}

// Le lecteur de ce serveur : Tesseract (avec le français) et Poppler présents, sinon il n'est pas
// branché (et l'écran le dit).
export async function lecteurDuServeur(r: Reglages = {}): Promise<Lecteur> {
  try {
    const langues = await executer('tesseract', ['--list-langs'], 10_000);
    await executer('pdftotext', ['-v'], 10_000);
    await executer('pdftoppm', ['-v'], 10_000);
    if (!/^fra$/m.test(langues)) return { disponible: false, lire: async () => { throw new LectureImpossible('tesseract-sans-fra'); } };
  } catch {
    return { disponible: false, lire: async () => { throw new LectureImpossible('moteur-absent'); } };
  }
  return creerLecteur(moteurDuServeur(r.ms), r);
}
