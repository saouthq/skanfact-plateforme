// Une TTN simulée (El Fatoora), pour les tests (brique 82 ; docs/facture-electronique.md). Le service de la TTN
// est SOAP (« EfactService ») : saveEfact dépose une facture signée (en base 64), consultEfact dit ce qu'elle
// en a fait : acceptée (la facture validée, qui porte sa référence et son code QR dans « RefTtnVal »), ou
// refusée (les accusés). D'après ce qui en est publié ; les noms, les champs et les codes sont À VÉRIFIER
// avec l'accès de test (démarche en cours).
//
// Le simulé retient chaque dépôt, refuse un fichier non signé et un numéro déjà déposé (le serveur ne doit
// jamais déposer deux fois), et sait tomber en panne, perdre la réponse d'un dépôt, refuser au dépôt ou au
// traitement : ce que le serveur doit savoir vivre.

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type DepotSimule = {
  id: string; matricule: string; numero: string; xml: string; etat: 'en_cours' | 'acceptee' | 'refusee';
  reference?: string; valide?: string; accuses: { code: string; message: string }[]; refus: string | null;
};

const lireCorps = (req: http.IncomingMessage) => new Promise<string>((ok) => {
  let texte = '';
  req.on('data', (c: Buffer) => { texte += c.toString('utf8'); });
  req.on('end', () => ok(texte));
});
const champ = (xml: string, nom: string) => new RegExp(`<(?:[\\w.-]+:)?${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nom}>`).exec(xml)?.[1] ?? null;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const enveloppe = (corps: string) => `<?xml version="1.0" encoding="UTF-8"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>${corps}</S:Body></S:Envelope>`;
const faute = (message: string) => enveloppe(`<S:Fault><faultcode>S:Server</faultcode><faultstring>${esc(message)}</faultstring></S:Fault>`);

export async function ttnSimulee() {
  // Les comptes El Fatoora connus (identifiant → mot de passe et matricule).
  const comptes = new Map<string, { motDePasse: string; matricule: string }>([['nadia-el-fatoora', { motDePasse: 'Mot-de-passe-TTN-7', matricule: '7654321BAM000' }]]);
  const depots: DepotSimule[] = [];
  const reglage = { pannes: 0, perdre: 0, fauteAuDepot: null as string | null, refusAuTraitement: null as string | null, lenteur: 0 };
  let appels = 0;
  let n = 0;
  // Chaque dépôt TENTÉ, par numéro (même refusé) : le serveur ne doit jamais en tenter un second.
  const tentatives = new Map<string, number>();
  const serveur = http.createServer((req, res) => {
    void (async () => {
      const corps = await lireCorps(req);
      appels++;
      if (reglage.lenteur) await new Promise((ok) => setTimeout(ok, reglage.lenteur));
      const repondre = (statut: number, xml: string) => { res.writeHead(statut, { 'content-type': 'text/xml; charset=utf-8' }); res.end(xml); };
      if (reglage.pannes > 0) { reglage.pannes--; return repondre(503, '<html><body>Service Unavailable</body></html>'); }
      const operation = /<(?:[\w.-]+:)?(saveEfact|consultEfact)[\s>]/.exec(corps)?.[1];
      if (!operation) return repondre(500, faute('Operation inconnue'));
      const login = champ(corps, 'login') ?? '';
      const compte = comptes.get(login);
      if (!compte || champ(corps, 'password') !== compte.motDePasse) return repondre(500, faute('Authentification refusee : identifiant ou mot de passe incorrect'));
      const matricule = champ(corps, 'matricule') ?? '';
      if (matricule !== compte.matricule) return repondre(500, faute(`Matricule ${matricule} non autorise pour ce compte`));
      if (operation === 'saveEfact') {
        const xml = Buffer.from(champ(corps, 'documentEfact') ?? '', 'base64').toString('utf8');
        if (!/<ds:Signature[\s>]/.test(xml)) return repondre(500, faute('Document non signe'));
        const numero = champ(xml, 'DocumentIdentifier') ?? '';
        tentatives.set(numero, (tentatives.get(numero) ?? 0) + 1);
        if (depots.some((d) => d.matricule === matricule && d.numero === numero)) return repondre(500, faute(`Document ${numero} deja depose`));
        if (reglage.fauteAuDepot) { const m = reglage.fauteAuDepot; reglage.fauteAuDepot = null; return repondre(500, faute(m)); }
        const refus = reglage.refusAuTraitement;
        reglage.refusAuTraitement = null;
        const id = String(1000 + ++n);
        depots.push({ id, matricule, numero, xml, etat: 'en_cours', accuses: [], refus });
        // La réponse se perd : le dépôt est fait, le serveur ne le sait pas.
        if (reglage.perdre > 0) { reglage.perdre--; return repondre(504, '<html><body>Gateway Timeout</body></html>'); }
        return repondre(200, enveloppe(`<ns2:saveEfactResponse xmlns:ns2="http://services.elfatoura.tradenet.com.tn/"><return>Document recu : ${id}</return></ns2:saveEfactResponse>`));
      }
      // consultEfact : la TTN traite un dépôt quand on le consulte (acceptée, ou refusée par ses accusés).
      const numero = champ(corps, 'documentNumber') ?? '';
      const items = depots.filter((d) => d.matricule === matricule && d.numero === numero).map((d) => {
        if (d.etat === 'en_cours') traiter(d);
        return `<item><documentNumber>${esc(d.numero)}</documentNumber><idSaveEfact>${d.id}</idSaveEfact><documentType>I-11</documentType>`
          + (d.etat === 'acceptee' ? `<generatedRef>${d.reference}</generatedRef><xmlContent>${Buffer.from(d.valide ?? '', 'utf8').toString('base64')}</xmlContent>` : '')
          + d.accuses.map((a) => `<listAcknowlegments><code>${esc(a.code)}</code><message>${esc(a.message)}</message></listAcknowlegments>`).join('')
          + '</item>';
      });
      return repondre(200, enveloppe(`<ns2:consultEfactResponse xmlns:ns2="http://services.elfatoura.tradenet.com.tn/"><return><items>${items.join('')}</items></return></ns2:consultEfactResponse>`));
    })();
  });
  // Accepter : la TTN pose sa référence et le code QR (RefTtnVal) dans la facture, et la signe à son tour.
  function traiter(d: DepotSimule) {
    if (d.refus) { d.etat = 'refusee'; d.accuses = [{ code: 'KO-12', message: d.refus }]; return; }
    d.etat = 'acceptee';
    d.reference = `TTN26${d.id.padStart(10, '0')}`;
    const qr = `https://elfatoora.tn/verif?ref=${d.reference}&m=${d.matricule}&cle=${randomBytes(6).toString('hex')}`;
    const ref = `<RefTtnVal><ReferenceTTN refID="I-88">${d.reference}</ReferenceTTN><ReferenceCEV>${esc(qr)}</ReferenceCEV><ReferenceDate><DateText format="ddMMyy" functionCode="I-37">300926</DateText></ReferenceDate></RefTtnVal>`;
    const signatureTtn = '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="SigTTN"><ds:SignatureValue>SIMULEE-TTN</ds:SignatureValue></ds:Signature>';
    d.valide = d.xml.replace(/<ds:Signature[\s>]/, (m) => `${ref}${m}`).replace('</TEIF>', `${signatureTtn}</TEIF>`);
  }
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/ElfatouraServices/EfactService`;
  return {
    base, comptes, depots, reglage,
    appels: () => appels,
    // Combien de dépôts de ce numéro le serveur a tentés (jamais plus d'un, sauf un renvoi après un refus).
    deposesDe: (numero: string) => tentatives.get(numero) ?? 0,
    // Une TTN neuve (entre deux tests, dont les entreprises portent le même matricule).
    vider: () => { depots.length = 0; tentatives.clear(); Object.assign(reglage, { pannes: 0, perdre: 0, fauteAuDepot: null, refusAuTraitement: null, lenteur: 0 }); },
    fermer: () => new Promise<void>((ok) => serveur.close(() => ok())),
  };
}
