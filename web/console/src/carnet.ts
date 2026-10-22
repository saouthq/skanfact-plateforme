// Le carnet de crise (1.109.0 ; demandé par Skander le 22/10/2026 : « se préparer à la gestion de crise » ; cadrage 06
// § 9). Le jour où SkanFact tombe, la console peut tomber avec lui : ce qu'on fait se lit alors sur un papier, ou sur le
// téléphone. Un seul fichier HTML, sans rien à charger (ni police, ni script, ni image), qui s'imprime une fiche par page.
// Il est écrit avec les textes de la console — les fiches réflexes, la gravité, les messages prêts —, jamais recopié :
// une fiche changée change le carnet suivant. Il ne porte aucune donnée (ni nom, ni numéro, ni adresse) : « qui appeler »
// se remplit à la main, sur le papier. La console le télécharge (Incidents › les fiches réflexes) ;
// scripts/carnet-de-crise.ts l'écrit hors de la console.
import { echapper } from '../../../commun/page-a-part.ts';
import { texteConnu } from '../../../textes/index.ts';
import { dire, phrase, titre } from './langue.ts';

const I = 'console.ecran.service.in';
const C = 'console.ecran.service.carnet';

// Les fiches qui dépendent d'une décision pas prise, ou du droit : elles le disent (l'écran et le carnet).
export const FICHES_A_DECIDER: Record<string, 'a_decider' | 'a_verifier'> = { site: 'a_decider', fuite: 'a_verifier', rancon: 'a_verifier', empreinte: 'a_verifier' };
export const TEMPS = ['contenir', 'dire', 'reparer', 'ecrire'] as const;

// Les messages prêts d'une fiche : ce que dit la page d'état, l'e-mail aux entreprises touchées. Une fiche qui n'en a pas
// n'en déclare pas (textes.ts).
export type Messages = { public: string | null; courriel: { objet: string; corps: string } | null };
export function messagesDe(f: string): Messages {
  const k = `${I}.fiche.${f}`;
  return {
    public: texteConnu(`${k}.public`) ? dire(`${k}.public`) : null,
    courriel: texteConnu(`${k}.courriel`) ? { objet: dire(`${k}.courriel_objet`), corps: dire(`${k}.courriel`) } : null,
  };
}
// Le premier passage entre crochets qui reste à remplir (« [heure] »), ou null.
export const passageARemplir = (texte: string) => /\[[^\]]*\]/.exec(texte)?.[0] ?? null;

const QUI = ['direction', 'relais', 'seconde', 'hebergeur', 'domaine', 'paiement', 'signature', 'ttn', 'sms', 'courriel', 'banque', 'juriste', 'inpdp', 'comptable'] as const;
const OU = ['console', 'etat', 'secours', 'fermer', 'urgence', 'remise', 'pli', 'procedures'] as const;
const OBJECTIFS = ['programme', 'base', 'site', 'erreur', 'rancon'] as const;
const GRAVITES = ['mineur', 'majeur', 'critique'] as const;
// Une commande, pas une phrase : elle reste telle quelle dans toutes les langues.
const URGENCE = 'sudo bash /opt/skanfact/depot/exploitation/equipe.sh urgence <adresse> "<motif>"';

const e = echapper;
const jourEnMots = (jour: string) => jour.split('-').reverse().join('/');
const liste = (cles: string[]) => `<ol>${cles.map((c) => `<li>${e(phrase(c))}</li>`).join('')}</ol>`;
const section = (id: string, t: string, sous: string | null, corps: string, classe = '') =>
  `<section id="${id}"${classe ? ` class="${classe}"` : ''}><h2>${e(titre(t))}</h2>${sous ? `<p class="sous">${e(phrase(sous))}</p>` : ''}${corps}</section>`;

function fiche(f: string, n: number, total: number): string {
  const k = `${I}.fiche.${f}`;
  const m = messagesDe(f);
  const badge = FICHES_A_DECIDER[f];
  const pub = m.public
    ? `<blockquote class="pret">${e(m.public)}</blockquote>`
    : `<p class="rien">${e(phrase(`${I}.fiche.public_rien`))}</p>`;
  const courriel = m.courriel
    ? `<div class="courriel"><p class="objet"><b>${e(titre(`${I}.fiche.objet`))}&#8239;:</b> ${e(m.courriel.objet)}</p><pre>${e(m.courriel.corps)}</pre></div>`
    : `<p class="rien">${e(phrase(`${I}.fiche.courriel_rien`))}</p>`;
  return `<article class="fiche" id="fiche-${f}">
<p class="rang">${e(titre(`${C}.fiche.n`, { n, total }))}${badge ? ` · <span class="badge">${e(dire(`${I}.${badge}`))}</span>` : ''}</p>
<h3>${e(titre(`${k}.nom`))}</h3>
<p class="situation">${e(phrase(`${k}.situation`))}</p>
<p class="abord"><b>${e(dire(`${I}.fiches.abord`))}</b> ${e(phrase(`${k}.abord`))}</p>
<ol class="temps">${TEMPS.map((t) => `<li><b>${e(dire(`${I}.temps.${t}`))}</b><p>${e(phrase(`${k}.${t}`))}</p></li>`).join('')}</ol>
${badge ? `<p class="note">${e(phrase(`${I}.fiches.${badge}_dit`))}</p>` : ''}
<div class="messages">
<div><h4>${e(titre(`${I}.fiche.public_titre`))}</h4>${pub}</div>
<div><h4>${e(titre(`${I}.fiche.courriel_titre`))}</h4>${courriel}</div>
${m.public || m.courriel ? `<p class="crochets">${e(phrase(`${I}.fiche.crochets`))}</p>` : ''}
</div>
</article>`;
}

const STYLE = `:root{color-scheme:light;--papier:#fff;--fond:#f6f8f7;--encre:#13211f;--gris:#56655f;--trait:#dce4e1;--lien:#0b7a70;--doux:#e3f4f1;
--doux-texte:#0b5f57;--nuit:#0b2724;--nuit-texte:#e8f3f1;--nuit-gris:#a9c6c1;--menthe:#7fe0d3;--orange:#b4691d;--orange-doux:#fbf0e3;--rouge:#c03636;
--titre:'Bricolage Grotesque Variable','Segoe UI',system-ui,-apple-system,sans-serif;--texte:'Instrument Sans Variable','Segoe UI',system-ui,-apple-system,sans-serif;
--chiffres:ui-monospace,Menlo,Consolas,monospace}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--fond);color:var(--encre);font:15px/1.55 var(--texte)}
.page{max-width:50rem;margin:0 auto;padding:24px 16px 48px;display:grid;gap:20px}
h1,h2,h3,h4{font-family:var(--titre);line-height:1.15;margin:0;text-wrap:balance}
h2{font-size:1.45rem;letter-spacing:-.01em}
h3{font-size:1.35rem}
h4{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--gris);margin-bottom:6px}
p{margin:0}
.couverture{background:var(--nuit);color:var(--nuit-texte);border-radius:14px;padding:32px 28px;display:grid;gap:14px;
background-image:linear-gradient(rgba(127,224,211,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(127,224,211,.07) 1px,transparent 1px);background-size:28px 28px}
.marque{display:flex;align-items:center;gap:10px;font:600 1rem var(--titre)}
.marque i{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--menthe);color:var(--nuit);font-style:normal;font-weight:800}
.couverture h1{font-size:2.6rem;letter-spacing:-.02em}
.couverture .chapo{font-size:1.1rem;color:var(--nuit-texte);max-width:36rem}
.couverture .garder{color:var(--nuit-gris);max-width:36rem}
.couverture .ecrit{font-size:.88rem;color:var(--menthe)}
.couverture nav{border-top:1px solid rgba(127,224,211,.25);padding-top:14px}
.couverture nav h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--nuit-gris);font-family:var(--texte);margin-bottom:8px}
.couverture nav ol{margin:0;padding-left:1.3em;grid-template-columns:1fr 1fr;column-gap:28px}
.couverture nav a{color:var(--nuit-texte)}
section,.fiche{background:var(--papier);border:1px solid var(--trait);border-radius:12px;padding:22px 22px 24px;display:grid;gap:12px}
.sous{color:var(--gris)}
ol{margin:0;padding-left:1.4em;display:grid;gap:6px}
.debut ol{counter-reset:n;list-style:none;padding:0}
.debut li{counter-increment:n;display:grid;grid-template-columns:2rem 1fr;align-items:baseline}
.debut li::before{content:counter(n);font:700 1.1rem var(--titre);color:var(--lien)}
.tableau{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.93rem}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--trait)}
th{font-size:.74rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);font-weight:600}
td.blanc{min-width:12rem;border-bottom:1px solid var(--encre)}
.g{display:inline-block;padding:1px 8px;border-radius:99px;font-weight:600;font-size:.82rem}
.g-mineur{background:var(--doux);color:var(--doux-texte)}.g-majeur{background:var(--orange-doux);color:var(--orange)}.g-critique{background:#fbe6e6;color:var(--rouge)}
code{font-family:var(--chiffres);font-size:.82rem;background:var(--fond);border:1px solid var(--trait);border-radius:6px;padding:2px 6px;word-break:break-all;display:inline-block;margin-top:4px}
.fiche{border-left:5px solid var(--lien)}
.rang{font-family:var(--chiffres);font-size:.8rem;color:var(--gris)}
.badge{color:var(--orange);font-weight:600}
.situation{font-size:1.02rem}
.abord{background:var(--doux);color:var(--doux-texte);border-radius:8px;padding:10px 12px}
.temps{list-style:none;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.temps li{border:1px solid var(--trait);border-radius:8px;padding:10px 12px;display:grid;gap:4px}
.temps b{font-family:var(--titre)}
.note{background:var(--orange-doux);color:var(--orange);border-radius:8px;padding:8px 12px;font-size:.92rem}
.messages{display:grid;grid-template-columns:1fr;gap:14px;border-top:1px dashed var(--trait);padding-top:12px}
.pret{margin:0;border-left:3px solid var(--menthe);background:var(--fond);padding:10px 12px;border-radius:0 8px 8px 0}
.courriel{border:1px solid var(--trait);border-radius:8px;overflow:hidden}
.courriel .objet{background:var(--fond);padding:8px 12px;border-bottom:1px solid var(--trait)}
.courriel pre{margin:0;padding:10px 12px;white-space:pre-wrap;font:inherit;font-size:.93rem}
.rien,.crochets{color:var(--gris);font-size:.9rem}
.rien{font-style:italic}
footer{color:var(--gris);font-size:.82rem;text-align:center;font-family:var(--chiffres)}
@media (max-width:600px){.temps{grid-template-columns:1fr}.couverture nav ol{grid-template-columns:1fr}.couverture h1{font-size:2rem}}
@media print{@page{size:A4;margin:14mm}
body{background:#fff;font-size:9.5pt;line-height:1.45}.page{max-width:none;padding:0;gap:0;display:block}
section,.fiche{border:0;border-radius:0;padding:0;break-before:page}
.couverture{-webkit-print-color-adjust:exact;print-color-adjust:exact;min-height:250mm;align-content:start}
.fiche{border-left:0;break-inside:auto;gap:8px}.fiche h3{font-size:1.25rem}.temps{gap:6px}.temps li{padding:6px 9px}.messages{gap:8px;padding-top:8px}
.abord,.note,.pret,.courriel pre,.courriel .objet{padding:6px 10px}.crochets{break-before:avoid}.temps li,.courriel,tr{break-inside:avoid}
.g,.abord,.note,.pret,.courriel .objet{-webkit-print-color-adjust:exact;print-color-adjust:exact}
footer{display:none}}`;

// Le carnet, entier : `fiches`, celles que le serveur connaît (serveur/console/incidents.ts, FICHES) ; `jour`, AAAA-MM-JJ.
export function carnetDeCrise({ fiches, jour }: { fiches: readonly string[]; jour: string }): string {
  const j = jourEnMots(jour);
  const sommaire: [string, string][] = [['debut', `${C}.debut.titre`], ['gravite', `${C}.gravite.titre`], ['objectifs', `${C}.objectifs.titre`],
    ['qui', `${C}.qui.titre`], ['ou', `${C}.ou.titre`], ['fiches', `${C}.fiches.titre`], ['apres', `${C}.apres.titre`]];
  const couverture = `<header class="couverture">
<p class="marque"><i>S</i> SkanFact</p>
<h1>${e(titre(`${C}.titre`))}</h1>
<p class="chapo">${e(phrase(`${C}.chapo`))}</p>
<p class="garder">${e(phrase(`${C}.garder`))}</p>
<p class="ecrit">${e(phrase(`${C}.ecrit`, { jour: j }))} ${e(phrase(`${C}.perime`))}</p>
<nav><h2>${e(titre(`${C}.sommaire`))}</h2><ol>${sommaire.map(([id, t]) => `<li><a href="#${id}">${e(titre(t))}</a></li>`).join('')}</ol></nav>
</header>`;
  const debut = section('debut', `${C}.debut.titre`, null, liste([1, 2, 3, 4, 5, 6].map((n) => `${C}.debut.${n}`)), 'debut');
  const gravite = section('gravite', `${C}.gravite.titre`, `${I}.regles.sous`, `<div class="tableau"><table>
<thead><tr><th></th><th>${e(titre(`${C}.gravite.quand`))}</th><th>${e(titre(`${C}.gravite.qui`))}</th><th>${e(titre(`${C}.gravite.page`))}</th><th>${e(titre(`${C}.gravite.rythme`))}</th></tr></thead>
<tbody>${GRAVITES.map((g) => `<tr><td><span class="g g-${g}">${e(titre(`${I}.gravite.${g}`))}</span></td><td>${e(phrase(`${I}.regles.${g}.quand`))}</td>${(['r1', 'r2', 'r3'] as const).map((r) => `<td>${e(phrase(`${I}.regles.${g}.${r}`))}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div><p class="sous">${e(phrase(`${I}.regles.pied`))}</p>`);
  const objectifs = section('objectifs', `${C}.objectifs.titre`, `${C}.objectifs.sous`, `<div class="tableau"><table>
<thead><tr><th>${e(titre(`${C}.objectifs.cas`))}</th><th>${e(titre(`${C}.objectifs.perdu`))}</th><th>${e(titre(`${C}.objectifs.rendu`))}</th></tr></thead>
<tbody>${OBJECTIFS.map((o) => `<tr><td>${e(titre(`${C}.objectifs.${o}.cas`))}</td><td>${e(titre(`${C}.objectifs.${o}.perdu`))}</td><td>${e(titre(`${C}.objectifs.${o}.rendu`))}</td></tr>`).join('')}</tbody>
</table></div>`);
  const qui = section('qui', `${C}.qui.titre`, `${C}.qui.sous`, `<div class="tableau"><table>
<thead><tr><th>${e(titre(`${C}.qui.qui`))}</th><th>${e(titre(`${C}.qui.pourquoi`))}</th><th>${e(titre(`${C}.qui.numero`))}</th></tr></thead>
<tbody>${QUI.map((q) => `<tr><td><b>${e(titre(`${C}.qui.${q}.qui`))}</b></td><td>${e(phrase(`${C}.qui.${q}.pourquoi`))}</td><td class="blanc"></td></tr>`).join('')}</tbody>
</table></div>`);
  const ou = section('ou', `${C}.ou.titre`, null, `<div class="tableau"><table><tbody>${OU.map((o) => `<tr><td><b>${e(titre(`${C}.ou.${o}.quoi`))}</b></td><td>${e(phrase(`${C}.ou.${o}.ou`))}${o === 'urgence' ? `<br><code>${e(URGENCE)}</code>` : ''}</td></tr>`).join('')}</tbody></table></div>`);
  const tete = section('fiches', `${C}.fiches.titre`, `${C}.fiches.sous`, `<ol>${fiches.map((f) => `<li><a href="#fiche-${f}">${e(titre(`${I}.fiche.${f}.nom`))}</a></li>`).join('')}</ol>`);
  const apres = section('apres', `${C}.apres.titre`, null, liste([1, 2, 3, 4, 5].map((n) => `${C}.apres.${n}`)));
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${e(dire(`${C}.onglet`))}</title><style>${STYLE}</style></head>
<body><main class="page">
${couverture}
${debut}
${gravite}
${objectifs}
${qui}
${ou}
${tete}
${fiches.map((f, n) => fiche(f, n + 1, fiches.length)).join('\n')}
${apres}
<footer>${e(dire(`${C}.pied`, { jour: j }))}</footer>
</main></body></html>
`;
}
