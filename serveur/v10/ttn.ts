// La plateforme El Fatoora de Tunisie TradeNet (brique 82 ; docs/facture-electronique.md ; 05 § 3.1) : un
// service SOAP (« EfactService »). D'après ce qui en est publié : saveEfact dépose une facture signée (le
// fichier en base 64), consultEfact dit ce que la TTN en a fait (la facture validée, avec sa référence et son
// code QR ; ou les accusés d'un refus). Les noms, les champs et les codes sont À VÉRIFIER avec l'accès de
// test (démarche en cours) ; tests/ttn-simule.ts suit ce contrat, et ce fichier est le seul à reprendre.
//
// Ce qui part vers la TTN, compté : l'identifiant et le mot de passe El Fatoora de l'entreprise, son
// matricule (celui que porte le fichier), et le fichier signé de la pièce, ou son seul numéro pour la
// consulter. Rien d'autre.

import { t, type Texte } from '../../textes/index.ts';
import './textes.ts';

export const ESPACE_TTN = 'http://services.elfatoura.tradenet.com.tn/';
const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';

export type Compte = { identifiant: string; motDePasse: string; matricule: string };
// Une réponse de la TTN : son contenu ; ou son refus (une faute SOAP : elle a lu la demande et dit non, avec
// son message) ; ou une panne (pas de réponse lisible : on réessaiera).
export type Rendu<T> = { ok: true; valeur: T } | { ok: false; panne: true; motif: Texte } | { ok: false; panne: false; message: string };
// Ce que la TTN dit d'une pièce déposée.
export type Depot = {
  idTtn: string | null; reference: string | null; qr: string | null; xmlValide: string | null;
  accuses: { code: string; message: string }[];
};

const echapper = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lire = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&');
const motifDe = (nom: string) => new RegExp(`<(?:[\\w.-]+:)?${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nom}>`, 'g');
// La valeur du premier élément de ce nom (quel que soit son préfixe d'espace de noms), et de tous.
export function champ(xml: string, nom: string): string | null {
  const m = motifDe(nom).exec(xml);
  return m ? lire(m[1] ?? '') : null;
}
const champs = (xml: string, nom: string) => [...xml.matchAll(motifDe(nom))].map((m) => m[1] ?? '');
// Un élément XML, écrit par le code (ses valeurs échappées).
function balise(nom: string, contenu: string | string[], attributs: Record<string, string> = {}): string {
  const a = Object.entries(attributs).map(([k, v]) => ` ${k}="${echapper(v)}"`).join('');
  return `<${nom}${a}>${Array.isArray(contenu) ? contenu.join('') : echapper(contenu)}</${nom}>`;
}

async function appeler(adresse: string, operation: string, contenu: string[]): Promise<Rendu<string>> {
  let r: Response;
  try {
    r = await fetch(adresse, {
      method: 'POST', headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '""' },
      body: balise('soapenv:Envelope', [balise('soapenv:Header', []), balise('soapenv:Body', [balise(`ser:${operation}`, contenu)])],
        { 'xmlns:soapenv': SOAP, 'xmlns:ser': ESPACE_TTN }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, panne: true, motif: t('ttn.injoignable') };
  }
  const texte = await r.text().catch(() => '');
  const faute = champ(texte, 'faultstring');
  if (faute !== null) return { ok: false, panne: false, message: faute.trim().slice(0, 300) };
  if (!r.ok) return { ok: false, panne: true, motif: t('ttn.panne', { statut: r.status }) };
  return { ok: true, valeur: texte };
}

const identite = (c: Compte) => [balise('login', c.identifiant), balise('password', c.motDePasse), balise('matricule', c.matricule)];

// Déposer une facture signée.
export async function deposer(adresse: string, c: Compte, xmlSigne: string): Promise<Rendu<string | null>> {
  const r = await appeler(adresse, 'saveEfact', [...identite(c), balise('documentEfact', Buffer.from(xmlSigne, 'utf8').toString('base64'))]);
  return r.ok ? { ok: true, valeur: champ(r.valeur, 'return') } : r;
}

// Ce que la TTN a fait de la pièce de ce numéro ; null : elle ne l'a pas.
export async function consulter(adresse: string, c: Compte, numero: string): Promise<Rendu<Depot | null>> {
  const r = await appeler(adresse, 'consultEfact', [...identite(c), balise('efactCriteria', [balise('documentNumber', numero)])]);
  if (!r.ok) return r;
  const item = champs(r.valeur, 'item').find((x) => champ(x, 'documentNumber')?.trim() === numero);
  if (item === undefined) return { ok: true, valeur: null };
  const b64 = champ(item, 'xmlContent');
  const xmlValide = b64 ? Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8') : null;
  const reference = (xmlValide ? champ(xmlValide, 'ReferenceTTN') : null) ?? champ(item, 'generatedRef');
  return {
    ok: true,
    valeur: {
      idTtn: champ(item, 'idSaveEfact')?.trim() || null, reference: reference?.trim() || null,
      qr: xmlValide ? champ(xmlValide, 'ReferenceCEV')?.trim() || null : null, xmlValide,
      accuses: champs(item, 'listAcknowlegments').map((a) => ({ code: champ(a, 'code')?.trim() ?? '', message: champ(a, 'message')?.trim() ?? '' })),
    },
  };
}
